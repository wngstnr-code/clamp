//! Bill Lock and Revenue Lock: open, close, withdraw, auto-roll, roll (spec 10.4).
//!
//! A lock is a pool buy whose claims stay in an escrow token account owned by
//! the lock PDA. Buys and sells go through the same code as `buy` and `sell`.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        burn, close_account, transfer_checked, Burn, CloseAccount, Mint, TokenAccount,
        TokenInterface, TransferChecked,
    },
};

use crate::constants::{
    CLASS_SEED, CONFIG_SEED, ESCROW_SEED, LOCK_SEED, ROLL_MAX_PREMIUM_PPM, SIDE_DOWN, SIDE_UP,
};
use crate::errors::ClampError;
use crate::events::{LockAutoRollSet, LockClosed, LockOpened, LockRolled, Redeemed};
use crate::instructions::trade::*;
use crate::instructions::vault_flow::VAULT_SEED;
use crate::math::pool::cost_exact_out;
use crate::math::PPM;
use crate::state::{ClassConfig, Config, Lock, Vault};

/// `LockClosed.how` values.
pub const CLOSED_SOLD: u8 = 0;
pub const CLOSED_REDEEMED: u8 = 1;
pub const CLOSED_WITHDRAWN: u8 = 2;

impl Lock {
    /// Signs CPIs as the lock PDA, the authority of its escrow.
    pub fn with_signer<R>(&self, f: impl FnOnce(&[&[&[u8]]]) -> R) -> R {
        let seeds: &[&[u8]] = &[
            LOCK_SEED,
            self.owner.as_ref(),
            self.series.as_ref(),
            core::slice::from_ref(&self.side),
            core::slice::from_ref(&self.bump),
        ];
        f(&[seeds])
    }
}

/// Closes the empty escrow; its rent goes to `rent_payer`.
fn close_escrow<'info>(
    lock: &Account<'info, Lock>,
    escrow: &InterfaceAccount<'info, TokenAccount>,
    rent_payer: AccountInfo<'info>,
    tp: Pubkey,
) -> Result<()> {
    lock.with_signer(|signer| {
        close_account(CpiContext::new_with_signer(
            tp,
            CloseAccount {
                account: escrow.to_account_info(),
                destination: rent_payer,
                authority: lock.to_account_info(),
            },
            signer,
        ))
    })
}

// ---------------------------------------------------------------- open

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct OpenLock<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = treasury @ ClampError::WrongTokenAccount)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = idle @ ClampError::WrongTokenAccount)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub idle: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    pub tokens: SeriesTokens<'info>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Lock::INIT_SPACE,
        seeds = [LOCK_SEED, owner.key().as_ref(), tokens.series.key().as_ref(), &[side]],
        bump,
    )]
    pub lock: Box<Account<'info, Lock>>,
    /// The mint of the locked side (checked against the series in the handler).
    pub claim_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = owner,
        seeds = [ESCROW_SEED, lock.key().as_ref()],
        bump,
        token::mint = claim_mint,
        token::authority = lock,
        token::token_program = token_program,
    )]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The owner's collateral account (its mint is checked by every transfer).
    #[account(mut, token::authority = owner, token::token_program = token_program)]
    pub owner_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Buys `side` claims with `usdc_in` into the lock's escrow. A second call
/// adds to the same lock; `ref_rate` and `auto_roll` take the new values.
#[allow(clippy::too_many_arguments)]
pub fn handle_open_lock(
    ctx: Context<OpenLock>,
    side: u8,
    usdc_in: u64,
    min_claims_out: u64,
    hours: u32,
    ref_rate: u64,
    auto_roll: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bump = ctx.bumps.lock;
    let a = ctx.accounts;
    let expected_mint = match side {
        SIDE_UP => a.tokens.series.up_mint,
        SIDE_DOWN => a.tokens.series.down_mint,
        _ => return err!(ClampError::InvalidSide),
    };
    require_keys_eq!(a.claim_mint.key(), expected_mint, ClampError::WrongMint);
    let tp = a.token_program.key();
    let fees = FeeTargets {
        idle: a.idle.to_account_info(),
        treasury: a.treasury.to_account_info(),
    };
    let claims = execute_buy(
        &mut a.tokens,
        fees,
        a.owner.key(),
        a.owner.to_account_info(),
        a.owner_collateral.to_account_info(),
        &[],
        &a.escrow,
        tp,
        side,
        usdc_in,
        min_claims_out,
        now,
    )?;

    let series = a.tokens.series.key();
    let escrow = a.escrow.key();
    let owner = a.owner.key();
    let lock = &mut a.lock;
    if lock.owner == Pubkey::default() {
        lock.owner = owner;
        lock.series = series;
        lock.side = side;
        lock.rent_payer = owner;
        lock.created_ts = now;
        lock.escrow = escrow;
        lock.bump = bump;
    }
    lock.claims = lock
        .claims
        .checked_add(claims)
        .ok_or(ClampError::MathOverflow)?;
    lock.paid = lock
        .paid
        .checked_add(usdc_in)
        .ok_or(ClampError::MathOverflow)?;
    lock.hours = lock
        .hours
        .checked_add(hours)
        .ok_or(ClampError::MathOverflow)?;
    lock.ref_rate = ref_rate;
    lock.auto_roll = auto_roll;
    emit!(LockOpened {
        lock: lock.key(),
        owner,
        series,
        side,
        usdc_in,
        claims,
        total_claims: lock.claims,
        total_paid: lock.paid,
        hours: lock.hours,
        ref_rate,
        auto_roll,
    });
    Ok(())
}

// ---------------------------------------------------------------- close

#[derive(Accounts)]
pub struct CloseLock<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = treasury @ ClampError::WrongTokenAccount)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = idle @ ClampError::WrongTokenAccount)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub idle: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    pub tokens: SeriesTokens<'info>,
    #[account(
        mut,
        close = rent_payer,
        has_one = owner,
        has_one = escrow @ ClampError::WrongTokenAccount,
        has_one = rent_payer,
        constraint = lock.series == tokens.series.key() @ ClampError::WrongLockSeries,
    )]
    pub lock: Box<Account<'info, Lock>>,
    #[account(mut)]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: receives the rent of the lock and the escrow; must be `lock.rent_payer`.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    /// The owner's collateral account (its mint is checked by every transfer).
    #[account(mut, token::authority = owner, token::token_program = token_program)]
    pub owner_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Before `close_ts`: sells every escrowed claim through the pool. After
/// settlement: redeems them. Pays the owner and closes the lock.
pub fn handle_close_lock(ctx: Context<CloseLock>, min_usdc_out: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let tp = a.token_program.key();
    let side = a.lock.side;
    let amount = a.escrow.amount;
    let owner = a.owner.key();

    let (usdc_out, how) = if a.tokens.series.settled {
        let value = if side == SIDE_UP {
            u64::from(a.tokens.series.up_value)
        } else {
            PPM - u64::from(a.tokens.series.up_value)
        };
        let payout = u64::try_from(u128::from(amount) * u128::from(value) / u128::from(PPM))
            .map_err(|_| ClampError::MathOverflow)?;
        require!(payout >= min_usdc_out, ClampError::SlippageExceeded);
        if amount > 0 {
            let (_, mint) = side_tokens(&a.tokens, side);
            a.lock.with_signer(|signer| {
                burn(
                    CpiContext::new_with_signer(
                        tp,
                        Burn {
                            mint: mint.to_account_info(),
                            from: a.escrow.to_account_info(),
                            authority: a.lock.to_account_info(),
                        },
                        signer,
                    ),
                    amount,
                )
            })?;
        }
        pay_from_series(&a.tokens, tp, a.owner_collateral.to_account_info(), payout)?;
        emit!(Redeemed {
            series: a.tokens.series.key(),
            user: owner,
            side,
            amount,
            payout,
        });
        (payout, CLOSED_REDEEMED)
    } else if now < a.tokens.series.close_ts && amount == 0 {
        (0, CLOSED_SOLD)
    } else if now < a.tokens.series.close_ts {
        let fees = FeeTargets {
            idle: a.idle.to_account_info(),
            treasury: a.treasury.to_account_info(),
        };
        let lock_info = a.lock.to_account_info();
        let usdc_to = a.owner_collateral.to_account_info();
        let lock = &a.lock;
        let tokens = &mut a.tokens;
        let escrow = &a.escrow;
        let out = lock.with_signer(|signer| {
            execute_sell(
                tokens,
                fees,
                owner,
                lock_info,
                signer,
                escrow,
                usdc_to,
                tp,
                side,
                amount,
                min_usdc_out,
                now,
            )
        })?;
        (out, CLOSED_SOLD)
    } else {
        return err!(ClampError::LockWaitsForSettlement);
    };

    close_escrow(&a.lock, &a.escrow, a.rent_payer.to_account_info(), tp)?;
    emit!(LockClosed {
        lock: a.lock.key(),
        owner,
        series: a.lock.series,
        side,
        claims: amount,
        usdc_out,
        how,
    });
    Ok(())
}

// ---------------------------------------------------------------- withdraw

#[derive(Accounts)]
pub struct WithdrawLockClaims<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        close = rent_payer,
        has_one = owner,
        has_one = escrow @ ClampError::WrongTokenAccount,
        has_one = rent_payer,
    )]
    pub lock: Box<Account<'info, Lock>>,
    #[account(mut)]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = escrow.mint @ ClampError::WrongMint)]
    pub claim_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = claim_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_claims: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: receives the rent of the lock and the escrow; must be `lock.rent_payer`.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Moves every escrowed claim to the owner's wallet and closes the lock.
/// Allowed at any time.
pub fn handle_withdraw_lock_claims(ctx: Context<WithdrawLockClaims>) -> Result<()> {
    let a = ctx.accounts;
    let tp = a.token_program.key();
    let amount = a.escrow.amount;
    if amount > 0 {
        a.lock.with_signer(|signer| {
            transfer_checked(
                CpiContext::new_with_signer(
                    tp,
                    TransferChecked {
                        from: a.escrow.to_account_info(),
                        mint: a.claim_mint.to_account_info(),
                        to: a.owner_claims.to_account_info(),
                        authority: a.lock.to_account_info(),
                    },
                    signer,
                ),
                amount,
                a.claim_mint.decimals,
            )
        })?;
    }
    close_escrow(&a.lock, &a.escrow, a.rent_payer.to_account_info(), tp)?;
    emit!(LockClosed {
        lock: a.lock.key(),
        owner: a.owner.key(),
        series: a.lock.series,
        side: a.lock.side,
        claims: amount,
        usdc_out: 0,
        how: CLOSED_WITHDRAWN,
    });
    Ok(())
}

// ---------------------------------------------------------------- auto-roll

#[derive(Accounts)]
pub struct SetAutoRoll<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub lock: Box<Account<'info, Lock>>,
}

pub fn handle_set_auto_roll(ctx: Context<SetAutoRoll>, on: bool) -> Result<()> {
    let lock = &mut ctx.accounts.lock;
    lock.auto_roll = on;
    emit!(LockAutoRollSet {
        lock: lock.key(),
        owner: lock.owner,
        on,
    });
    Ok(())
}

// ---------------------------------------------------------------- roll

/// Anyone, after settlement, when auto-roll is on (spec 10.4, D-063). The
/// caller pays the rent of a new lock and gets it back when that lock closes.
#[derive(Accounts)]
pub struct RollLock<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = treasury @ ClampError::WrongTokenAccount)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = idle @ ClampError::WrongTokenAccount)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub idle: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The settled series of the lock.
    pub old_tokens: SeriesTokens<'info>,
    /// The current series of the same class and kind.
    pub new_tokens: SeriesTokens<'info>,
    #[account(seeds = [CLASS_SEED, &[new_tokens.series.class_id]], bump = class_config.bump)]
    pub class_config: Box<Account<'info, ClassConfig>>,
    #[account(
        mut,
        close = old_rent_payer,
        constraint = old_lock.series == old_tokens.series.key() @ ClampError::WrongLockSeries,
    )]
    pub old_lock: Box<Account<'info, Lock>>,
    #[account(mut, address = old_lock.escrow @ ClampError::WrongTokenAccount)]
    pub old_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: receives the rent of the old lock and escrow; must be `old_lock.rent_payer`.
    #[account(mut, address = old_lock.rent_payer)]
    pub old_rent_payer: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = caller,
        space = 8 + Lock::INIT_SPACE,
        seeds = [LOCK_SEED, old_lock.owner.as_ref(), new_tokens.series.key().as_ref(), &[old_lock.side]],
        bump,
    )]
    pub new_lock: Box<Account<'info, Lock>>,
    /// The mint of the lock's side in the new series (checked in the handler).
    pub new_claim_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = caller,
        seeds = [ESCROW_SEED, new_lock.key().as_ref()],
        bump,
        token::mint = new_claim_mint,
        token::authority = new_lock,
        token::token_program = token_program,
    )]
    pub new_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The owner's collateral account: receives what the new buy does not spend.
    #[account(mut, token::authority = old_lock.owner, token::token_program = token_program)]
    pub owner_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_roll_lock(ctx: Context<RollLock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bump = ctx.bumps.new_lock;
    let a = ctx.accounts;
    let tp = a.token_program.key();
    let old = &a.old_lock;
    let (owner, side, hours) = (old.owner, old.side, old.hours);
    require!(old.auto_roll, ClampError::AutoRollOff);
    let old_s = &a.old_tokens.series;
    let new_s = &a.new_tokens.series;
    require!(old_s.settled, ClampError::NotSettled);
    require!(
        new_s.key() != old_s.key()
            && new_s.class_id == old_s.class_id
            && new_s.kind == old_s.kind
            && a.class_config.current_series[usize::from(new_s.kind)] == new_s.key(),
        ClampError::NotCurrentSeries
    );
    let expected_mint = if side == SIDE_UP {
        new_s.up_mint
    } else {
        new_s.down_mint
    };
    require_keys_eq!(a.new_claim_mint.key(), expected_mint, ClampError::WrongMint);

    // 1. Redeem the old claims (spec 11).
    let amount = a.old_escrow.amount;
    let value = if side == SIDE_UP {
        u64::from(old_s.up_value)
    } else {
        PPM - u64::from(old_s.up_value)
    };
    let payout = u64::try_from(u128::from(amount) * u128::from(value) / u128::from(PPM))
        .map_err(|_| ClampError::MathOverflow)?;
    let width = new_s
        .upper
        .checked_sub(new_s.lower)
        .ok_or(ClampError::InvalidBand)?;
    let target = u64::from(hours)
        .checked_mul(width)
        .ok_or(ClampError::MathOverflow)?;
    require!(payout > 0 && target > 0, ClampError::NothingToRoll);
    let old_series_key = old_s.key();
    if amount > 0 {
        let (_, mint) = side_tokens(&a.old_tokens, side);
        a.old_lock.with_signer(|signer| {
            burn(
                CpiContext::new_with_signer(
                    tp,
                    Burn {
                        mint: mint.to_account_info(),
                        from: a.old_escrow.to_account_info(),
                        authority: a.old_lock.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )
        })?;
    }
    emit!(Redeemed {
        series: old_series_key,
        user: owner,
        side,
        amount,
        payout,
    });

    // 2. Buy hours * W_new claims in the new series, spending at most the
    //    payout, paid straight from the old series' collateral.
    let v = value_and_recenter(&mut a.new_tokens, now)?;
    let (pool_s, pool_o) = side_pools(&a.new_tokens, &a.new_escrow, side)?;
    let cost = cost_exact_out(pool_s, pool_o, target, a.new_tokens.series.trade_fee_bps)
        .unwrap_or(u64::MAX);
    let usdc_in = cost.min(payout);
    let fees = FeeTargets {
        idle: a.idle.to_account_info(),
        treasury: a.treasury.to_account_info(),
    };
    let payer = a.old_tokens.series.to_account_info();
    let payer_collateral = a.old_tokens.collateral.to_account_info();
    let old_series = &a.old_tokens.series;
    let new_tokens = &mut a.new_tokens;
    let new_escrow = &a.new_escrow;
    let new_claims = old_series.with_signer(|signer| {
        execute_buy(
            new_tokens,
            fees,
            owner,
            payer,
            payer_collateral,
            signer,
            new_escrow,
            tp,
            side,
            usdc_in,
            1,
            now,
        )
    })?;
    // the average price per claim stays within the premium over fair value
    let fair = if side == SIDE_UP { v } else { PPM - v };
    require!(
        u128::from(usdc_in) * u128::from(PPM)
            <= u128::from(new_claims) * u128::from(fair + ROLL_MAX_PREMIUM_PPM),
        ClampError::RollPriceTooHigh
    );

    // 3. What the buy did not spend goes to the owner.
    let leftover = payout - usdc_in;
    pay_from_series(
        &a.old_tokens,
        tp,
        a.owner_collateral.to_account_info(),
        leftover,
    )?;

    // 4. Close the old lock (Anchor closes the lock account itself).
    close_escrow(
        &a.old_lock,
        &a.old_escrow,
        a.old_rent_payer.to_account_info(),
        tp,
    )?;

    let new_series_key = a.new_tokens.series.key();
    let escrow_key = a.new_escrow.key();
    let caller = a.caller.key();
    let ref_rate = a.old_lock.ref_rate;
    let lock = &mut a.new_lock;
    if lock.owner == Pubkey::default() {
        lock.owner = owner;
        lock.series = new_series_key;
        lock.side = side;
        lock.rent_payer = caller;
        lock.created_ts = now;
        lock.escrow = escrow_key;
        lock.bump = bump;
        lock.ref_rate = ref_rate;
    }
    lock.claims = lock
        .claims
        .checked_add(new_claims)
        .ok_or(ClampError::MathOverflow)?;
    lock.paid = lock
        .paid
        .checked_add(usdc_in)
        .ok_or(ClampError::MathOverflow)?;
    lock.hours = lock
        .hours
        .checked_add(hours)
        .ok_or(ClampError::MathOverflow)?;
    lock.auto_roll = true;
    emit!(LockRolled {
        old_lock: a.old_lock.key(),
        new_lock: lock.key(),
        owner,
        old_series: old_series_key,
        new_series: new_series_key,
        side,
        old_claims: amount,
        payout,
        usdc_in,
        new_claims,
        leftover,
        caller,
    });
    Ok(())
}
