//! Bill Lock and Revenue Lock: open, close, withdraw, auto-roll switch (spec 10.4).
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

use crate::constants::{CONFIG_SEED, ESCROW_SEED, LOCK_SEED, SIDE_DOWN, SIDE_UP};
use crate::errors::ClampError;
use crate::events::{LockAutoRollSet, LockClosed, LockOpened, Redeemed};
use crate::instructions::trade::*;
use crate::instructions::vault_flow::VAULT_SEED;
use crate::math::PPM;
use crate::state::{Config, Lock, Vault};

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
        a.owner.to_account_info(),
        a.owner_collateral.to_account_info(),
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
