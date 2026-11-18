use anchor_lang::prelude::*;

use crate::constants::{
    CLASS_SEED, INDEX_SEED, MAX_GAP, MAX_REPORTERS, MAX_SOURCES, MIN_UPDATE_INTERVAL,
    OBS_CARDINALITY, REPORT_WAIT, REPORT_WINDOW,
};
use crate::errors::ClampError;
use crate::events::{IndexUpdated, ReportSubmitted, SourceUsed};
use crate::math::median::{
    apply_step_limit, combine_source, source_weight, weighted_median, Sample, Weighted,
};
use crate::math::twap::{next_observation, Observation};
use crate::state::{ClassConfig, IndexState, ObservationSlot, Observations, Report};

/// A registered reporter stores its view of every source, then the index
/// updates when the interval and the quorum allow it (spec 6.2, 6.3).
#[derive(Accounts)]
#[instruction(class_id: u8)]
pub struct SubmitReport<'info> {
    pub reporter: Signer<'info>,
    #[account(seeds = [CLASS_SEED, &[class_id]], bump = class_config.bump)]
    pub class_config: Box<Account<'info, ClassConfig>>,
    #[account(
        mut,
        seeds = [INDEX_SEED, &[class_id]],
        bump = index_state.bump,
        has_one = observations
    )]
    pub index_state: Box<Account<'info, IndexState>>,
    #[account(mut)]
    pub observations: AccountLoader<'info, Observations>,
}

pub fn handle_submit_report(
    ctx: Context<SubmitReport>,
    class_id: u8,
    prices: [u64; MAX_SOURCES],
    capacities: [u32; MAX_SOURCES],
    raw_hashes: [[u8; 32]; MAX_SOURCES],
) -> Result<()> {
    let class = &ctx.accounts.class_config;
    require!(class.enabled, ClampError::ClassDisabled);
    let reporter = ctx.accounts.reporter.key();
    let slot = class
        .reporter_slot(&reporter)
        .ok_or(ClampError::NotReporter)?;
    let source_count = usize::from(class.source_count);
    require!(
        prices[source_count..].iter().all(|p| *p == 0)
            && capacities[source_count..].iter().all(|c| *c == 0),
        ClampError::InvalidReport
    );
    // Every price needs public evidence: the hash of its raw API answer (D-055).
    require!(
        prices
            .iter()
            .zip(raw_hashes.iter())
            .all(|(p, h)| *p == 0 || *h != [0u8; 32]),
        ClampError::MissingRawHash
    );

    let now = Clock::get()?.unix_timestamp;
    let index = &mut ctx.accounts.index_state;
    index.reports[slot] = Report {
        reporter,
        ts: now,
        used: false,
        prices,
        capacities,
    };
    emit!(ReportSubmitted {
        class_id,
        reporter,
        ts: now,
        prices,
        capacities,
        raw_hashes,
    });

    try_update(class, index, &ctx.accounts.observations, now)
}

/// Spec 6.2 steps 1 to 7. Every "stop" returns `Ok(())` and keeps the report.
fn try_update(
    class: &ClassConfig,
    index: &mut IndexState,
    observations: &AccountLoader<Observations>,
    now: i64,
) -> Result<()> {
    // 1. Interval since the last accepted update.
    if index.update_count > 0 && now.saturating_sub(index.last_ts) < MIN_UPDATE_INTERVAL {
        return Ok(());
    }

    // 2. Fresh reports: current reporter, recent, not used yet.
    let mut fresh = [false; MAX_REPORTERS];
    let mut fresh_count: u8 = 0;
    let mut oldest_fresh = i64::MAX;
    for (i, r) in index
        .reports
        .iter()
        .enumerate()
        .take(usize::from(class.reporter_count))
    {
        let is_fresh = r.ts > 0
            && !r.used
            && r.reporter == class.reporters[i]
            && now.saturating_sub(r.ts) <= REPORT_WINDOW;
        if is_fresh {
            fresh[i] = true;
            fresh_count += 1;
            oldest_fresh = oldest_fresh.min(r.ts);
        }
    }
    if fresh_count < class.min_reporters {
        return Ok(());
    }
    // Wait for the missing reporters, at most REPORT_WAIT after the oldest fresh report.
    if fresh_count < class.reporter_count && now.saturating_sub(oldest_fresh) < REPORT_WAIT {
        return Ok(());
    }

    // 3 and 4. Combine reporters per source, then weight the sources.
    let mut used = [SourceUsed::default(); MAX_SOURCES];
    let mut weighted = [Weighted::default(); MAX_SOURCES];
    let mut source_total: u8 = 0;
    let mut weight_total: u16 = 0;
    for (s, source) in class
        .sources
        .iter()
        .enumerate()
        .take(usize::from(class.source_count))
    {
        used[s].source_id = source.source_id;
        let mut samples = [Sample::default(); MAX_REPORTERS];
        let mut n = 0;
        for (r, report) in index.reports.iter().enumerate() {
            if fresh[r] {
                samples[n] = Sample {
                    price: report.prices[s],
                    capacity: u64::from(report.capacities[s]),
                };
                n += 1;
            }
        }
        let Some(combined) = combine_source(
            &samples[..n],
            class.min_price,
            class.max_price,
            class.min_reporters,
        ) else {
            continue;
        };
        let weight = source_weight(source.has_capacity, combined.capacity, source.fixed_weight);
        used[s].price = combined.price;
        used[s].capacity = u32::try_from(combined.capacity).unwrap_or(u32::MAX);
        used[s].weight = weight;
        if weight > 0 {
            weighted[s] = Weighted {
                price: combined.price,
                weight,
            };
            source_total += 1;
            weight_total += u16::from(weight);
        }
    }
    if source_total < class.min_sources || weight_total < u16::from(class.min_total_weight) {
        return Ok(());
    }

    // 5. Weighted median.
    let Some(candidate) = weighted_median(&mut weighted) else {
        return Ok(());
    };

    // 6. Step limit against the last recorded price.
    let last = if index.update_count > 0 {
        index.last_price
    } else {
        0
    };
    let price = apply_step_limit(candidate, last, u64::from(class.max_step_ppm))
        .map_err(ClampError::from)?;

    // 7. Record (spec 6.3) and mark the fresh reports as used.
    let prev = (index.update_count > 0).then_some(Observation {
        ts: index.last_ts,
        price: index.last_price,
        cum_price: index.cum_price,
        cum_valid: index.cum_valid,
    });
    let obs = next_observation(prev.as_ref(), now, price, MAX_GAP).map_err(ClampError::from)?;

    let slot = if index.update_count == 0 {
        0
    } else {
        (usize::from(index.obs_index) + 1) % OBS_CARDINALITY
    };
    observations.load_mut()?.items[slot] = ObservationSlot::from(&obs);

    index.obs_index = slot as u16;
    index.obs_count = (usize::from(index.obs_count) + 1).min(OBS_CARDINALITY) as u16;
    index.last_ts = obs.ts;
    index.last_price = obs.price;
    index.cum_price = obs.cum_price;
    index.cum_valid = obs.cum_valid;
    index.update_count = index
        .update_count
        .checked_add(1)
        .ok_or(ClampError::MathOverflow)?;
    for (r, report) in index.reports.iter_mut().enumerate() {
        if fresh[r] {
            report.used = true;
        }
    }

    emit!(IndexUpdated {
        class_id: class.class_id,
        ts: now,
        price,
        candidate,
        reporter_count: fresh_count,
        sources: used,
        cum_price: obs.cum_price,
        cum_valid: obs.cum_valid,
        update_count: index.update_count,
    });
    Ok(())
}
