use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    CENTER_WINDOW, CLAIM_DECIMALS, CLASS_SEED, COLLATERAL_SEED, CONFIG_SEED, DOWN_MINT_SEED,
    DOWN_VAULT_SEED, DURATIONS, INDEX_SEED, MAX_GAP, MIN_CENTER_COUNTED, SERIES_SEED, UP_MINT_SEED,
    UP_VAULT_SEED,
};
use crate::errors::ClampError;
use crate::events::SeriesCreated;
use crate::instructions::index_view::sums_at_time;
use crate::math::twap::average;
use crate::math::PPM;
use crate::state::{ClassConfig, Config, IndexState, Observations, Series};

impl ClassConfig {
    /// Sequence number the next series of `kind` gets (0 for an invalid kind,
    /// which the handler refuses).
    pub fn next_seq(&self, kind: u8) -> u32 {
        self.series_count
            .get(usize::from(kind))
            .copied()
            .unwrap_or(0)
    }
}

/// Anyone creates the next series of a class and kind (spec 7.1) once the
/// previous one has expired. Creates the series, its two claim mints and its
/// three token accounts. The creator pays the rent.
#[derive(Accounts)]
#[instruction(class_id: u8, kind: u8)]
pub struct CreateSeries<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [CLASS_SEED, &[class_id]], bump = class_config.bump)]
    pub class_config: Box<Account<'info, ClassConfig>>,
    #[account(seeds = [INDEX_SEED, &[class_id]], bump = index_state.bump, has_one = observations)]
    pub index_state: Box<Account<'info, IndexState>>,
    pub observations: AccountLoader<'info, Observations>,
    #[account(
        init,
        payer = creator,
        space = 8 + Series::INIT_SPACE,
        seeds = [SERIES_SEED, &[class_id], &[kind], &class_config.next_seq(kind).to_le_bytes()],
        bump
    )]
    pub series: Box<Account<'info, Series>>,
    #[account(address = config.collateral_mint @ ClampError::WrongMint, mint::token_program = token_program)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        seeds = [UP_MINT_SEED, series.key().as_ref()],
        bump,
        mint::decimals = CLAIM_DECIMALS,
        mint::authority = series,
        mint::token_program = token_program,
    )]
    pub up_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        seeds = [DOWN_MINT_SEED, series.key().as_ref()],
        bump,
        mint::decimals = CLAIM_DECIMALS,
        mint::authority = series,
        mint::token_program = token_program,
    )]
    pub down_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        seeds = [COLLATERAL_SEED, series.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = series,
        token::token_program = token_program,
    )]
    pub collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = creator,
        seeds = [UP_VAULT_SEED, series.key().as_ref()],
        bump,
        token::mint = up_mint,
        token::authority = series,
        token::token_program = token_program,
    )]
    pub up_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = creator,
        seeds = [DOWN_VAULT_SEED, series.key().as_ref()],
        bump,
        token::mint = down_mint,
        token::authority = series,
        token::token_program = token_program,
    )]
    pub down_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_series(ctx: Context<CreateSeries>, class_id: u8, kind: u8) -> Result<()> {
    let k = usize::from(kind);
    require!(k < DURATIONS.len(), ClampError::InvalidKind);
    let class = &ctx.accounts.class_config;
    require!(class.enabled, ClampError::ClassDisabled);
    let now = Clock::get()?.unix_timestamp;
    require!(
        class.current_expiry[k] == 0 || now >= class.current_expiry[k],
        ClampError::SeriesStillLive
    );

    // A fresh index: the last update is at most MAX_GAP old.
    let index = &ctx.accounts.index_state;
    require!(
        index.update_count > 0 && now.saturating_sub(index.last_ts) <= MAX_GAP,
        ClampError::IndexStale
    );

    // Center: the index average of the 72 hours before creation, with at least
    // 6 hours of counted time (spec 7.1). If the history is shorter than 72 h,
    // the window starts at the oldest stored observation.
    let observations = ctx.accounts.observations.load()?;
    let (end, _) = sums_at_time(index, &observations, now)?.ok_or(ClampError::IndexStale)?;
    let (window_start, _) =
        sums_at_time(index, &observations, now - CENTER_WINDOW)?.ok_or(ClampError::IndexStale)?;
    drop(observations);
    let counted = end
        .cum_valid
        .checked_sub(window_start.cum_valid)
        .ok_or(ClampError::MathInvalidInput)?;
    require!(counted >= MIN_CENTER_COUNTED, ClampError::NotEnoughHistory);
    let center = average(&window_start, &end)
        .map_err(ClampError::from)?
        .ok_or(ClampError::NotEnoughHistory)?;

    let half_width = u128::from(class.half_width_ppm[k]);
    let ppm = u128::from(PPM);
    let lower = u64::try_from(u128::from(center) * (ppm - half_width) / ppm)
        .map_err(|_| ClampError::MathOverflow)?;
    let upper = u64::try_from(u128::from(center) * (ppm + half_width) / ppm)
        .map_err(|_| ClampError::MathOverflow)?;
    require!(lower > 0 && lower < upper, ClampError::InvalidBand);

    let duration = DURATIONS[k];
    let expiry_ts = now.checked_add(duration).ok_or(ClampError::MathOverflow)?;
    let close_ts = expiry_ts - duration / 24;
    let seq = class.next_seq(kind);
    let series_key = ctx.accounts.series.key();

    let series = &mut ctx.accounts.series;
    series.class_id = class_id;
    series.kind = kind;
    series.seq = seq;
    series.start_ts = now;
    series.close_ts = close_ts;
    series.expiry_ts = expiry_ts;
    series.center = center;
    series.lower = lower;
    series.upper = upper;
    series.start_index = index.last_price;
    series.start_cum_price = end.cum_price;
    series.start_cum_valid = end.cum_valid;
    series.trade_fee_bps = ctx.accounts.config.trade_fee_bps;
    series.protocol_share_bps = ctx.accounts.config.protocol_share_bps;
    series.up_mint = ctx.accounts.up_mint.key();
    series.down_mint = ctx.accounts.down_mint.key();
    series.collateral = ctx.accounts.collateral.key();
    series.up_vault = ctx.accounts.up_vault.key();
    series.down_vault = ctx.accounts.down_vault.key();
    series.bump = ctx.bumps.series;

    let class = &mut ctx.accounts.class_config;
    class.current_series[k] = series_key;
    class.current_expiry[k] = expiry_ts;
    class.series_count[k] = seq.checked_add(1).ok_or(ClampError::MathOverflow)?;

    emit!(SeriesCreated {
        series: series_key,
        class_id,
        kind,
        seq,
        start_ts: now,
        close_ts,
        expiry_ts,
        center,
        lower,
        upper,
        start_index: index.last_price,
    });
    Ok(())
}
