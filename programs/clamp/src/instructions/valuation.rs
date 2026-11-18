//! Fair value of a series and the vault NAV (spec 8.1, 9.1).

use anchor_lang::prelude::*;

use crate::constants::{INDEX_SEED, MAX_GAP};
use crate::errors::ClampError;
use crate::math::pool::{band_value_ppm, projected_avg};
use crate::math::twap::{sums_at, Observation};
use crate::math::vault::{nav, series_value, Rounding};
use crate::math::PPM;
use crate::state::{IndexState, Series, Vault};

/// Fair value of one UP claim of a live series at `now`, in ppm (spec 8.1):
/// the average so far with the last index price assumed for the rest.
pub fn fair_value_ppm(series: &Series, index: &IndexState, now: i64) -> Result<u64> {
    require!(index.update_count > 0, ClampError::IndexStale);
    let at = now.min(series.expiry_ts).max(index.last_ts);
    let latest = Observation {
        ts: index.last_ts,
        price: index.last_price,
        cum_price: index.cum_price,
        cum_valid: index.cum_valid,
    };
    let sums = sums_at(&latest, at, MAX_GAP).map_err(ClampError::from)?;
    // Before the start snapshot (cannot happen for a live series) counts as nothing.
    let counted_price = sums.cum_price.saturating_sub(series.start_cum_price);
    let counted_secs = sums.cum_valid.saturating_sub(series.start_cum_valid);
    let remaining = u64::try_from(series.expiry_ts.saturating_sub(now).max(0))
        .map_err(|_| ClampError::MathOverflow)?;
    let avg = projected_avg(counted_price, counted_secs, index.last_price, remaining)
        .map_err(ClampError::from)?
        .unwrap_or(series.start_index);
    Ok(band_value_ppm(avg, series.lower, series.upper).map_err(ClampError::from)?)
}

/// Value of the vault's units in a series (spec 9.1). A series past expiry
/// must be settled first, so the NAV never uses a stale projection.
pub fn vault_value_of(
    series: &Series,
    index: &IndexState,
    now: i64,
    rounding: Rounding,
) -> Result<u64> {
    let t_up = series
        .pool_up
        .checked_add(series.inv_up)
        .ok_or(ClampError::MathOverflow)?;
    let t_down = series
        .pool_down
        .checked_add(series.inv_down)
        .ok_or(ClampError::MathOverflow)?;
    let v = if series.settled {
        u64::from(series.up_value)
    } else {
        require!(now < series.expiry_ts, ClampError::SeriesNeedsSettlement);
        fair_value_ppm(series, index, now)?
    };
    debug_assert!(v <= PPM);
    Ok(series_value(t_up, t_down, v, rounding).map_err(ClampError::from)?)
}

/// NAV of the vault. `remaining` holds, for every active series in order,
/// the series account followed by the IndexState of its class.
pub fn vault_nav<'info>(
    vault: &Vault,
    idle_amount: u64,
    remaining: &'info [AccountInfo<'info>],
    now: i64,
    rounding: Rounding,
) -> Result<u64> {
    let active = vault.active();
    require!(
        remaining.len() == active.len() * 2,
        ClampError::ActiveSeriesMismatch
    );
    let mut values = [0u64; crate::state::MAX_ACTIVE_SERIES];
    for (i, key) in active.iter().enumerate() {
        let series_info = &remaining[2 * i];
        let index_info = &remaining[2 * i + 1];
        require_keys_eq!(*series_info.key, *key, ClampError::ActiveSeriesMismatch);
        let series: Account<Series> = Account::try_from(series_info)?;
        let (index_key, _) =
            Pubkey::find_program_address(&[INDEX_SEED, &[series.class_id]], &crate::ID);
        require_keys_eq!(*index_info.key, index_key, ClampError::ActiveSeriesMismatch);
        let index: Account<IndexState> = Account::try_from(index_info)?;
        values[i] = vault_value_of(&series, &index, now, rounding)?;
    }
    Ok(nav(idle_amount, &values[..active.len()]).map_err(ClampError::from)?)
}
