//! Settlement and redeem (spec 11).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{INDEX_SEED, SIDE_DOWN, SIDE_UP};
use crate::errors::ClampError;
use crate::events::{Redeemed, SeriesSettled};
use crate::instructions::index_view::sums_at_time;
use crate::math::pool::band_value_ppm;
use crate::math::twap::{average, counted_between, Sums};
use crate::math::PPM;
use crate::state::{IndexState, Observations, Series};

/// Anyone, once `now >= expiry_ts`. The result does not depend on who calls
/// it or when.
#[derive(Accounts)]
pub struct SettleSeries<'info> {
    #[account(mut)]
    pub series: Box<Account<'info, Series>>,
    #[account(
        seeds = [INDEX_SEED, &[series.class_id]],
        bump = index_state.bump,
        has_one = observations
    )]
    pub index_state: Box<Account<'info, IndexState>>,
    pub observations: AccountLoader<'info, Observations>,
}

pub fn handle_settle_series(ctx: Context<SettleSeries>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let series = &ctx.accounts.series;
    require!(!series.settled, ClampError::SeriesSettled);
    require!(now >= series.expiry_ts, ClampError::NotExpired);

    let observations = ctx.accounts.observations.load()?;
    let end = sums_at_time(&ctx.accounts.index_state, &observations, series.expiry_ts)?
        .map(|(s, _)| s)
        .ok_or(ClampError::IndexStale)?;
    drop(observations);
    let start = Sums {
        cum_price: series.start_cum_price,
        cum_valid: series.start_cum_valid,
    };
    // An end older than the start (the ring lost the whole period) counts as
    // no counted time.
    let counted = counted_between(&start, &end).unwrap_or(0);
    let avg = if counted == 0 {
        series.start_index
    } else {
        average(&start, &end)
            .map_err(ClampError::from)?
            .unwrap_or(series.start_index)
    };
    let up_value = band_value_ppm(avg, series.lower, series.upper).map_err(ClampError::from)?;
    let duration = u64::try_from(series.duration()).map_err(|_| ClampError::MathOverflow)?;
    let coverage = (u128::from(counted) * u128::from(PPM) / u128::from(duration.max(1)))
        .min(u128::from(PPM)) as u32;

    let series = &mut ctx.accounts.series;
    series.settled = true;
    series.avg = avg;
    series.up_value = up_value as u32;
    series.coverage_ppm = coverage;
    series.settled_ts = now;
    emit!(SeriesSettled {
        series: series.key(),
        avg,
        up_value: series.up_value,
        coverage_ppm: coverage,
        settled_ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    pub user: Signer<'info>,
    #[account(has_one = collateral @ ClampError::WrongTokenAccount)]
    pub series: Box<Account<'info, Series>>,
    /// The UP or DOWN mint of the series, matching `side`.
    #[account(mut)]
    pub claim_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = claim_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_claims: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = collateral.mint @ ClampError::WrongMint)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Burns `amount` claims of `side` and pays `floor(amount * value / 1e6)`.
pub fn handle_redeem(ctx: Context<Redeem>, side: u8, amount: u64) -> Result<()> {
    require!(amount > 0, ClampError::ZeroAmount);
    let a = &ctx.accounts;
    let series = &a.series;
    require!(series.settled, ClampError::NotSettled);
    let (expected_mint, value) = match side {
        SIDE_UP => (series.up_mint, u64::from(series.up_value)),
        SIDE_DOWN => (series.down_mint, PPM - u64::from(series.up_value)),
        _ => return err!(ClampError::InvalidSide),
    };
    require_keys_eq!(a.claim_mint.key(), expected_mint, ClampError::WrongMint);
    let payout = u64::try_from(u128::from(amount) * u128::from(value) / u128::from(PPM))
        .map_err(|_| ClampError::MathOverflow)?;
    let tp = a.token_program.key();

    burn(
        CpiContext::new(
            tp,
            Burn {
                mint: a.claim_mint.to_account_info(),
                from: a.user_claims.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        amount,
    )?;
    if payout > 0 {
        series.with_signer(|signer| {
            transfer_checked(
                CpiContext::new_with_signer(
                    tp,
                    TransferChecked {
                        from: a.collateral.to_account_info(),
                        mint: a.collateral_mint.to_account_info(),
                        to: a.user_collateral.to_account_info(),
                        authority: series.to_account_info(),
                    },
                    signer,
                ),
                payout,
                a.collateral_mint.decimals,
            )
        })?;
    }
    emit!(Redeemed {
        series: series.key(),
        user: a.user.key(),
        side,
        amount,
        payout,
    });
    Ok(())
}
