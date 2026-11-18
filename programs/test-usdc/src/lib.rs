//! Devnet-only faucet for the Clamp test USDC mint (tUSDC, 6 decimals).
//!
//! The program's PDA `["mint_authority"]` is the mint authority of tUSDC.
//! `claim` mints 1,000 tUSDC to the caller's associated token account, at most
//! once per 24 hours per wallet (PDA `["faucet", wallet]`, spec 12). Any mint
//! whose authority is this PDA can be claimed; only tUSDC is set up that way.
//! This program is never deployed to mainnet.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface},
};

declare_id!("5QZihvTBjqZkmbX2gFcQjqnNBBq1AB3W8nRD2VeVUZLP");

/// 1,000 tUSDC at 6 decimals.
pub const CLAIM_AMOUNT: u64 = 1_000_000_000;
/// One claim per wallet per 24 hours.
pub const COOLDOWN_SECS: i64 = 86_400;
pub const DECIMALS: u8 = 6;
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";
pub const FAUCET_SEED: &[u8] = b"faucet";

#[program]
pub mod test_usdc {
    use super::*;

    /// Mints 1,000 tUSDC to the signer, once per 24 hours.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let record = &mut ctx.accounts.faucet_record;
        if record.claims > 0 {
            let next = record
                .last_claim_ts
                .checked_add(COOLDOWN_SECS)
                .ok_or(FaucetError::Overflow)?;
            require!(now >= next, FaucetError::CooldownActive);
        }
        record.wallet = ctx.accounts.user.key();
        record.last_claim_ts = now;
        record.claims = record.claims.checked_add(1).ok_or(FaucetError::Overflow)?;
        record.bump = ctx.bumps.faucet_record;

        let seeds: &[&[u8]] = &[MINT_AUTHORITY_SEED, &[ctx.bumps.mint_authority]];
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[seeds],
            ),
            CLAIM_AMOUNT,
        )?;
        emit!(Claimed {
            wallet: ctx.accounts.user.key(),
            mint: ctx.accounts.mint.key(),
            amount: CLAIM_AMOUNT,
            ts: now,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + FaucetRecord::INIT_SPACE,
        seeds = [FAUCET_SEED, user.key().as_ref()],
        bump
    )]
    pub faucet_record: Account<'info, FaucetRecord>,
    #[account(
        mut,
        mint::decimals = DECIMALS,
        mint::authority = mint_authority,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: PDA that signs as the mint authority; it holds no data.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// When a wallet last claimed. PDA `["faucet", wallet]`.
#[account]
#[derive(InitSpace)]
pub struct FaucetRecord {
    pub wallet: Pubkey,
    pub last_claim_ts: i64,
    pub claims: u32,
    pub bump: u8,
}

#[event]
pub struct Claimed {
    pub wallet: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub ts: i64,
}

#[error_code]
pub enum FaucetError {
    #[msg("This wallet already claimed in the last 24 hours")]
    CooldownActive,
    #[msg("Arithmetic overflow")]
    Overflow,
}
