//! Pool: seed, buy, sell, sweep (spec 8, 9.2).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, TokenAccount, TokenInterface,
    TransferChecked,
};

use crate::constants::{CONFIG_SEED, INDEX_SEED, SIDE_DOWN, SIDE_UP};
use crate::errors::ClampError;
use crate::events::{Recentered, SeriesSeeded, SeriesSwept, Trade};
use crate::instructions::valuation::{fair_value_ppm, vault_nav};
use crate::instructions::vault_flow::VAULT_SEED;
use crate::math::pool::{self, pool_paused, recenter, split_fee, Holdings};
use crate::math::vault::{series_allocation, Rounding};
use crate::math::PPM;
use crate::state::{Config, IndexState, Series, Vault, MAX_ACTIVE_SERIES};

/// Accounts of a series that the pool moves tokens through.
#[derive(Accounts)]
pub struct SeriesTokens<'info> {
    #[account(
        mut,
        has_one = up_mint @ ClampError::WrongMint,
        has_one = down_mint @ ClampError::WrongMint,
        has_one = collateral @ ClampError::WrongTokenAccount,
        has_one = up_vault @ ClampError::WrongTokenAccount,
        has_one = down_vault @ ClampError::WrongTokenAccount,
    )]
    pub series: Box<Account<'info, Series>>,
    #[account(seeds = [INDEX_SEED, &[series.class_id]], bump = index_state.bump)]
    pub index_state: Box<Account<'info, IndexState>>,
    #[account(mut)]
    pub up_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub down_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub up_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub down_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = collateral.mint @ ClampError::WrongMint)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
}

fn holdings(s: &Series) -> Holdings {
    Holdings {
        pool_up: s.pool_up,
        inv_up: s.inv_up,
        pool_down: s.pool_down,
        inv_down: s.inv_down,
    }
}

fn set_holdings(s: &mut Series, h: &Holdings) {
    s.pool_up = h.pool_up;
    s.inv_up = h.inv_up;
    s.pool_down = h.pool_down;
    s.inv_down = h.inv_down;
}

/// Mints `amount` pairs into the series' own UP and DOWN vault accounts.
fn mint_pairs_to_vault<'info>(t: &SeriesTokens<'info>, tp: Pubkey, amount: u64) -> Result<()> {
    t.series.with_signer(|signer| -> Result<()> {
        for (mint, to) in [(&t.up_mint, &t.up_vault), (&t.down_mint, &t.down_vault)] {
            mint_to(
                CpiContext::new_with_signer(
                    tp,
                    MintTo {
                        mint: mint.to_account_info(),
                        to: to.to_account_info(),
                        authority: t.series.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )?;
        }
        Ok(())
    })
}

/// Burns `up` and `down` units from the series' own vault accounts.
fn burn_from_vault<'info>(t: &SeriesTokens<'info>, tp: Pubkey, up: u64, down: u64) -> Result<()> {
    t.series.with_signer(|signer| -> Result<()> {
        for (mint, from, amount) in [
            (&t.up_mint, &t.up_vault, up),
            (&t.down_mint, &t.down_vault, down),
        ] {
            if amount == 0 {
                continue;
            }
            burn(
                CpiContext::new_with_signer(
                    tp,
                    Burn {
                        mint: mint.to_account_info(),
                        from: from.to_account_info(),
                        authority: t.series.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )?;
        }
        Ok(())
    })
}

/// Pays collateral out of the series to `to`.
pub(crate) fn pay_from_series<'info>(
    t: &SeriesTokens<'info>,
    tp: Pubkey,
    to: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    t.series.with_signer(|signer| {
        transfer_checked(
            CpiContext::new_with_signer(
                tp,
                TransferChecked {
                    from: t.collateral.to_account_info(),
                    mint: t.collateral_mint.to_account_info(),
                    to,
                    authority: t.series.to_account_info(),
                },
                signer,
            ),
            amount,
            t.collateral_mint.decimals,
        )
    })
}

/// Fair value now; re-centers the pool once per index update (spec 8.2).
pub(crate) fn value_and_recenter(t: &mut SeriesTokens, now: i64) -> Result<u64> {
    let v = fair_value_ppm(&t.series, &t.index_state, now)?;
    let index_ts = t.index_state.last_ts;
    if index_ts > t.series.last_recenter_ts {
        let h = recenter(&holdings(&t.series), v).map_err(ClampError::from)?;
        let series = &mut t.series;
        set_holdings(series, &h);
        series.last_recenter_ts = index_ts;
        emit!(Recentered {
            series: series.key(),
            fair_value_ppm: v,
            pool_up: h.pool_up,
            pool_down: h.pool_down,
            inv_up: h.inv_up,
            inv_down: h.inv_down,
        });
    }
    Ok(v)
}

// ---------------------------------------------------------------- seed

/// Anyone, once per series: the vault puts its allocation into the pool.
/// Remaining accounts: the vault's active series and their IndexStates.
#[derive(Accounts)]
pub struct SeedSeries<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = idle @ ClampError::WrongTokenAccount)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub idle: Box<InterfaceAccount<'info, TokenAccount>>,
    pub tokens: SeriesTokens<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_seed_series<'info>(ctx: Context<'info, SeedSeries<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let series = &a.tokens.series;
    require!(!series.seeded, ClampError::AlreadySeeded);
    require!(
        !series.settled && now < series.close_ts,
        ClampError::TradingClosed
    );
    require!(
        usize::from(a.vault.active_count) < MAX_ACTIVE_SERIES,
        ClampError::ActiveListFull
    );
    let nav = vault_nav(
        &a.vault,
        a.idle.amount,
        ctx.remaining_accounts,
        now,
        Rounding::Down,
    )?;
    let alloc = series_allocation(nav, a.idle.amount, a.config.series_alloc_bps)
        .map_err(ClampError::from)?;
    require!(alloc > 0, ClampError::NotEnoughIdle);
    let tp = a.token_program.key();

    a.vault.with_signer(|signer| {
        transfer_checked(
            CpiContext::new_with_signer(
                tp,
                TransferChecked {
                    from: a.idle.to_account_info(),
                    mint: a.tokens.collateral_mint.to_account_info(),
                    to: a.tokens.collateral.to_account_info(),
                    authority: a.vault.to_account_info(),
                },
                signer,
            ),
            alloc,
            a.tokens.collateral_mint.decimals,
        )
    })?;
    mint_pairs_to_vault(&a.tokens, tp, alloc)?;

    let v = fair_value_ppm(&a.tokens.series, &a.tokens.index_state, now)?;
    let start = Holdings {
        pool_up: 0,
        inv_up: alloc,
        pool_down: 0,
        inv_down: alloc,
    };
    let h = recenter(&start, v).map_err(ClampError::from)?;
    let index_ts = a.tokens.index_state.last_ts;
    let series = &mut ctx.accounts.tokens.series;
    set_holdings(series, &h);
    series.last_recenter_ts = index_ts;
    series.seeded = true;
    series.pairs_outstanding = series
        .pairs_outstanding
        .checked_add(alloc)
        .ok_or(ClampError::MathOverflow)?;
    let key = series.key();
    let vault = &mut ctx.accounts.vault;
    let n = usize::from(vault.active_count);
    vault.active_series[n] = key;
    vault.active_count += 1;
    emit!(SeriesSeeded {
        series: key,
        allocation: alloc,
        fair_value_ppm: v,
        pool_up: h.pool_up,
        pool_down: h.pool_down,
    });
    Ok(())
}

// ---------------------------------------------------------------- buy and sell

#[derive(Accounts)]
pub struct TradeAccounts<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = treasury @ ClampError::WrongTokenAccount)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = idle @ ClampError::WrongTokenAccount)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub idle: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    pub tokens: SeriesTokens<'info>,
    /// The user's collateral account (its mint is checked by every transfer).
    #[account(mut, token::authority = user, token::token_program = token_program)]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The user's token account of the traded side (UP or DOWN mint).
    #[account(mut, token::authority = user, token::token_program = token_program)]
    pub user_claims: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Checks the side and the user's claim account; returns (pool_s, pool_o).
pub(crate) fn side_pools(
    t: &SeriesTokens,
    user_claims: &TokenAccount,
    side: u8,
) -> Result<(u64, u64)> {
    let s = &t.series;
    let (mint, pools) = match side {
        SIDE_UP => (s.up_mint, (s.pool_up, s.pool_down)),
        SIDE_DOWN => (s.down_mint, (s.pool_down, s.pool_up)),
        _ => return err!(ClampError::InvalidSide),
    };
    require_keys_eq!(user_claims.mint, mint, ClampError::WrongMint);
    Ok(pools)
}

fn store_pools(s: &mut Series, side: u8, new_s: u64, new_o: u64) {
    if side == SIDE_UP {
        s.pool_up = new_s;
        s.pool_down = new_o;
    } else {
        s.pool_down = new_s;
        s.pool_up = new_o;
    }
}

fn check_tradable(s: &Series, now: i64, v: u64) -> Result<()> {
    require!(s.seeded, ClampError::NotSeeded);
    require!(!s.settled && now < s.close_ts, ClampError::TradingClosed);
    require!(!pool_paused(v), ClampError::PoolPaused);
    Ok(())
}

/// The UP or DOWN vault account and mint of `side`.
pub(crate) fn side_tokens<'a, 'info>(
    t: &'a SeriesTokens<'info>,
    side: u8,
) -> (
    &'a InterfaceAccount<'info, TokenAccount>,
    &'a InterfaceAccount<'info, Mint>,
) {
    if side == SIDE_UP {
        (&t.up_vault, &t.up_mint)
    } else {
        (&t.down_vault, &t.down_mint)
    }
}

/// Where the two parts of a trade fee go (spec 8.3).
pub struct FeeTargets<'info> {
    pub idle: AccountInfo<'info>,
    pub treasury: AccountInfo<'info>,
}

/// Buys claims of `side` with `usdc_in` (spec 8.3). `payer` is the authority
/// of `payer_collateral`; `payer_seeds` signs for it when it is a PDA (empty
/// for a wallet). The claims go to `claims_to`, which must hold the side's
/// mint. `user` is the owner named in the event. Returns the claims bought.
/// Used by `buy`, `open_lock` and `roll_lock`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn execute_buy<'info>(
    t: &mut SeriesTokens<'info>,
    fees: FeeTargets<'info>,
    user: Pubkey,
    payer: AccountInfo<'info>,
    payer_collateral: AccountInfo<'info>,
    payer_seeds: &[&[&[u8]]],
    claims_to: &InterfaceAccount<'info, TokenAccount>,
    tp: Pubkey,
    side: u8,
    usdc_in: u64,
    min_out: u64,
    now: i64,
) -> Result<u64> {
    let v = value_and_recenter(t, now)?;
    check_tradable(&t.series, now, v)?;
    let (pool_s, pool_o) = side_pools(t, claims_to, side)?;
    let r = pool::buy(pool_s, pool_o, usdc_in, t.series.trade_fee_bps).map_err(ClampError::from)?;
    require!(r.out > 0 && r.out >= min_out, ClampError::SlippageExceeded);
    let (vault_fee, protocol_fee) =
        split_fee(r.fee, t.series.protocol_share_bps).map_err(ClampError::from)?;
    let decimals = t.collateral_mint.decimals;

    for (to, amount) in [
        (t.collateral.to_account_info(), r.pairs),
        (fees.idle, vault_fee),
        (fees.treasury, protocol_fee),
    ] {
        if amount == 0 {
            continue;
        }
        transfer_checked(
            CpiContext::new(
                tp,
                TransferChecked {
                    from: payer_collateral.clone(),
                    mint: t.collateral_mint.to_account_info(),
                    to,
                    authority: payer.clone(),
                },
            )
            .with_signer(payer_seeds),
            amount,
            decimals,
        )?;
    }
    mint_pairs_to_vault(t, tp, r.pairs)?;
    let (from, mint) = side_tokens(t, side);
    t.series.with_signer(|signer| {
        transfer_checked(
            CpiContext::new_with_signer(
                tp,
                TransferChecked {
                    from: from.to_account_info(),
                    mint: mint.to_account_info(),
                    to: claims_to.to_account_info(),
                    authority: t.series.to_account_info(),
                },
                signer,
            ),
            r.out,
            mint.decimals,
        )
    })?;

    let series = &mut t.series;
    store_pools(series, side, r.new_pool_s, r.new_pool_o);
    series.pairs_outstanding = series
        .pairs_outstanding
        .checked_add(r.pairs)
        .ok_or(ClampError::MathOverflow)?;
    emit!(Trade {
        series: series.key(),
        user,
        side,
        is_buy: true,
        usdc: usdc_in,
        claims: r.out,
        fee: r.fee,
        pool_up: series.pool_up,
        pool_down: series.pool_down,
        fair_value_ppm: v,
    });
    Ok(r.out)
}

/// Sells `amount` claims of `side` from `claims_from` (spec 8.4) and pays
/// the proceeds to `usdc_to`. `seller` is the authority of `claims_from`;
/// `seller_seeds` signs for it when it is a PDA (empty for a wallet).
/// `user` is the owner named in the event. Returns the USDC paid out.
/// Used by `sell` and `close_lock`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn execute_sell<'info>(
    t: &mut SeriesTokens<'info>,
    fees: FeeTargets<'info>,
    user: Pubkey,
    seller: AccountInfo<'info>,
    seller_seeds: &[&[&[u8]]],
    claims_from: &InterfaceAccount<'info, TokenAccount>,
    usdc_to: AccountInfo<'info>,
    tp: Pubkey,
    side: u8,
    amount: u64,
    min_usdc_out: u64,
    now: i64,
) -> Result<u64> {
    let v = value_and_recenter(t, now)?;
    check_tradable(&t.series, now, v)?;
    let (pool_s, pool_o) = side_pools(t, claims_from, side)?;
    let r = pool::sell(pool_s, pool_o, amount, t.series.trade_fee_bps).map_err(ClampError::from)?;
    require!(r.out >= min_usdc_out, ClampError::SlippageExceeded);
    let (vault_fee, protocol_fee) =
        split_fee(r.fee, t.series.protocol_share_bps).map_err(ClampError::from)?;

    let (to, mint) = side_tokens(t, side);
    transfer_checked(
        CpiContext::new(
            tp,
            TransferChecked {
                from: claims_from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: seller,
            },
        )
        .with_signer(seller_seeds),
        amount,
        mint.decimals,
    )?;
    burn_from_vault(t, tp, r.pairs, r.pairs)?;
    pay_from_series(t, tp, usdc_to, r.out)?;
    pay_from_series(t, tp, fees.idle, vault_fee)?;
    pay_from_series(t, tp, fees.treasury, protocol_fee)?;

    let series = &mut t.series;
    store_pools(series, side, r.new_pool_s, r.new_pool_o);
    series.pairs_outstanding = series
        .pairs_outstanding
        .checked_sub(r.pairs)
        .ok_or(ClampError::MathOverflow)?;
    emit!(Trade {
        series: series.key(),
        user,
        side,
        is_buy: false,
        usdc: r.out,
        claims: amount,
        fee: r.fee,
        pool_up: series.pool_up,
        pool_down: series.pool_down,
        fair_value_ppm: v,
    });
    Ok(r.out)
}

/// Buy claims of `side` with `usdc_in` (spec 8.3).
pub fn handle_buy(ctx: Context<TradeAccounts>, side: u8, usdc_in: u64, min_out: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let tp = a.token_program.key();
    let fees = FeeTargets {
        idle: a.idle.to_account_info(),
        treasury: a.treasury.to_account_info(),
    };
    execute_buy(
        &mut a.tokens,
        fees,
        a.user.key(),
        a.user.to_account_info(),
        a.user_collateral.to_account_info(),
        &[],
        &a.user_claims,
        tp,
        side,
        usdc_in,
        min_out,
        now,
    )?;
    Ok(())
}

/// Sell `amount` claims of `side` (spec 8.4).
pub fn handle_sell(
    ctx: Context<TradeAccounts>,
    side: u8,
    amount: u64,
    min_usdc_out: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let tp = a.token_program.key();
    let fees = FeeTargets {
        idle: a.idle.to_account_info(),
        treasury: a.treasury.to_account_info(),
    };
    execute_sell(
        &mut a.tokens,
        fees,
        a.user.key(),
        a.user.to_account_info(),
        &[],
        &a.user_claims,
        a.user_collateral.to_account_info(),
        tp,
        side,
        amount,
        min_usdc_out,
        now,
    )?;
    Ok(())
}

// ---------------------------------------------------------------- sweep

/// Anyone, after settlement: redeems all vault units of the series into idle
/// USDC and removes the series from the active list (spec 9.2).
#[derive(Accounts)]
pub struct SweepSeries<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = idle @ ClampError::WrongTokenAccount)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub idle: Box<InterfaceAccount<'info, TokenAccount>>,
    pub tokens: SeriesTokens<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_sweep_series(ctx: Context<SweepSeries>) -> Result<()> {
    let a = &ctx.accounts;
    let s = &a.tokens.series;
    require!(s.settled, ClampError::NotSettled);
    require!(s.seeded && !s.swept, ClampError::NothingToSweep);
    let t_up = s
        .pool_up
        .checked_add(s.inv_up)
        .ok_or(ClampError::MathOverflow)?;
    let t_down = s
        .pool_down
        .checked_add(s.inv_down)
        .ok_or(ClampError::MathOverflow)?;
    let up_value = u128::from(s.up_value);
    let ppm = u128::from(PPM);
    let payout = u128::from(t_up) * up_value / ppm + u128::from(t_down) * (ppm - up_value) / ppm;
    let payout = u64::try_from(payout).map_err(|_| ClampError::MathOverflow)?;
    let tp = a.token_program.key();

    burn_from_vault(&a.tokens, tp, t_up, t_down)?;
    pay_from_series(&a.tokens, tp, a.idle.to_account_info(), payout)?;

    let series = &mut ctx.accounts.tokens.series;
    set_holdings(series, &Holdings::default());
    series.swept = true;
    let key = series.key();
    let vault = &mut ctx.accounts.vault;
    let n = usize::from(vault.active_count);
    if let Some(i) = vault.active_series[..n].iter().position(|k| *k == key) {
        vault.active_series.copy_within(i + 1..n, i);
        vault.active_series[n - 1] = Pubkey::default();
        vault.active_count -= 1;
    }
    emit!(SeriesSwept {
        series: key,
        up_units: t_up,
        down_units: t_down,
        payout,
    });
    Ok(())
}
