//! Vault: create, deposit, withdraw (spec 9.2).

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        burn, mint_to, transfer_checked, Burn, Mint, MintTo, TokenAccount, TokenInterface,
        TransferChecked,
    },
};

use crate::constants::{CLAIM_DECIMALS, CONFIG_SEED};
use crate::errors::ClampError;
use crate::events::{VaultDeposit, VaultWithdraw};
use crate::instructions::valuation::vault_nav;
use crate::math::vault::{deposit_shares, withdraw_amount, Rounding};
use crate::state::{Config, Vault};

pub const VAULT_SEED: &[u8] = b"vault";
pub const SHARES_SEED: &[u8] = b"shares";
pub const IDLE_SEED: &[u8] = b"idle";

impl Vault {
    /// Signs CPIs as the vault PDA, which owns the share mint and idle USDC.
    pub fn with_signer<R>(&self, f: impl FnOnce(&[&[&[u8]]]) -> R) -> R {
        let seeds: &[&[u8]] = &[VAULT_SEED, core::slice::from_ref(&self.bump)];
        f(&[seeds])
    }

    /// Total shares for every price: the minted supply plus the locked units.
    pub fn total_shares(&self, supply: u64) -> Result<u64> {
        Ok(supply
            .checked_add(self.locked_shares)
            .ok_or(ClampError::MathOverflow)?)
    }
}

/// Creates the vault, its share mint and its idle USDC account. Admin, once.
#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin, has_one = collateral_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = admin, space = 8 + Vault::INIT_SPACE, seeds = [VAULT_SEED], bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init,
        payer = admin,
        seeds = [SHARES_SEED],
        bump,
        mint::decimals = CLAIM_DECIMALS,
        mint::authority = vault,
        mint::token_program = token_program,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        seeds = [IDLE_SEED],
        bump,
        token::mint = collateral_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub idle: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = token_program)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_vault(ctx: Context<InitVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.idle = ctx.accounts.idle.key();
    vault.bump = ctx.bumps.vault;
    Ok(())
}

/// Deposit and withdraw share these accounts. Remaining accounts: every
/// active series followed by the IndexState of its class, in vault order.
#[derive(Accounts)]
pub struct VaultFlow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = vault.bump,
        has_one = share_mint @ ClampError::WrongMint,
        has_one = idle @ ClampError::WrongTokenAccount,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub idle: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = idle.mint @ ClampError::WrongMint)]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_collateral: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_shares: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit<'info>(ctx: Context<'info, VaultFlow<'info>>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let total = a.vault.total_shares(a.share_mint.supply)?;
    // Deposits use the NAV rounded up: fewer shares, never at the holders' cost.
    let nav_up = vault_nav(
        &a.vault,
        a.idle.amount,
        ctx.remaining_accounts,
        now,
        Rounding::Up,
    )?;
    let (shares, locked) =
        deposit_shares(amount, total, nav_up).map_err(|_| ClampError::InvalidDeposit)?;
    let tp = a.token_program.key();

    transfer_checked(
        CpiContext::new(
            tp,
            TransferChecked {
                from: a.user_collateral.to_account_info(),
                mint: a.collateral_mint.to_account_info(),
                to: a.idle.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        amount,
        a.collateral_mint.decimals,
    )?;
    a.vault.with_signer(|signer| {
        mint_to(
            CpiContext::new_with_signer(
                tp,
                MintTo {
                    mint: a.share_mint.to_account_info(),
                    to: a.user_shares.to_account_info(),
                    authority: a.vault.to_account_info(),
                },
                signer,
            ),
            shares,
        )
    })?;
    let vault = &mut ctx.accounts.vault;
    vault.locked_shares = vault
        .locked_shares
        .checked_add(locked)
        .ok_or(ClampError::MathOverflow)?;
    emit!(VaultDeposit {
        user: ctx.accounts.user.key(),
        amount,
        shares,
        nav: nav_up,
        total_shares: total,
    });
    Ok(())
}

pub fn handle_withdraw<'info>(ctx: Context<'info, VaultFlow<'info>>, shares: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let total = a.vault.total_shares(a.share_mint.supply)?;
    // Withdrawals use the NAV rounded down: fewer USDC, never at the holders' cost.
    let nav_down = vault_nav(
        &a.vault,
        a.idle.amount,
        ctx.remaining_accounts,
        now,
        Rounding::Down,
    )?;
    let amount =
        withdraw_amount(shares, total, nav_down).map_err(|_| ClampError::InvalidWithdraw)?;
    require!(amount > 0, ClampError::ZeroAmount);
    require!(amount <= a.idle.amount, ClampError::NotEnoughIdle);
    let tp = a.token_program.key();

    burn(
        CpiContext::new(
            tp,
            Burn {
                mint: a.share_mint.to_account_info(),
                from: a.user_shares.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        shares,
    )?;
    a.vault.with_signer(|signer| {
        transfer_checked(
            CpiContext::new_with_signer(
                tp,
                TransferChecked {
                    from: a.idle.to_account_info(),
                    mint: a.collateral_mint.to_account_info(),
                    to: a.user_collateral.to_account_info(),
                    authority: a.vault.to_account_info(),
                },
                signer,
            ),
            amount,
            a.collateral_mint.decimals,
        )
    })?;
    emit!(VaultWithdraw {
        user: a.user.key(),
        shares,
        amount,
        nav: nav_down,
        total_shares: total,
    });
    Ok(())
}
