//! Mint and merge claim pairs (spec 7.2). No fee. Allowed until settlement.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        burn, mint_to, transfer_checked, Burn, Mint, MintTo, TokenAccount, TokenInterface,
        TransferChecked,
    },
};

use crate::constants::SERIES_SEED;
use crate::errors::ClampError;
use crate::events::{PairsMerged, PairsMinted};
use crate::state::Series;

impl Series {
    /// Signs CPIs as the series PDA, which owns the mints and token accounts.
    pub fn with_signer<R>(&self, f: impl FnOnce(&[&[&[u8]]]) -> R) -> R {
        let seq = self.seq.to_le_bytes();
        let seeds: &[&[u8]] = &[
            SERIES_SEED,
            core::slice::from_ref(&self.class_id),
            core::slice::from_ref(&self.kind),
            &seq,
            core::slice::from_ref(&self.bump),
        ];
        f(&[seeds])
    }
}

#[derive(Accounts)]
pub struct Pairs<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        has_one = up_mint @ ClampError::WrongMint,
        has_one = down_mint @ ClampError::WrongMint,
        has_one = collateral @ ClampError::WrongTokenAccount,
    )]
    pub series: Box<Account<'info, Series>>,
    #[account(mut)]
    pub up_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub down_mint: Box<InterfaceAccount<'info, Mint>>,
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
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = up_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_up: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = down_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_down: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Pays `amount` collateral into the series, mints `amount` UP and DOWN.
pub fn handle_mint_pairs(ctx: Context<Pairs>, amount: u64) -> Result<()> {
    require!(amount > 0, ClampError::ZeroAmount);
    require!(!ctx.accounts.series.settled, ClampError::SeriesSettled);
    let a = &ctx.accounts;
    let tp = a.token_program.key();

    transfer_checked(
        CpiContext::new(
            tp,
            TransferChecked {
                from: a.user_collateral.to_account_info(),
                mint: a.collateral_mint.to_account_info(),
                to: a.collateral.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        amount,
        a.collateral_mint.decimals,
    )?;
    a.series.with_signer(|signer| -> Result<()> {
        for (mint, to) in [(&a.up_mint, &a.user_up), (&a.down_mint, &a.user_down)] {
            mint_to(
                CpiContext::new_with_signer(
                    tp,
                    MintTo {
                        mint: mint.to_account_info(),
                        to: to.to_account_info(),
                        authority: a.series.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )?;
        }
        Ok(())
    })?;

    let series = &mut ctx.accounts.series;
    series.pairs_outstanding = series
        .pairs_outstanding
        .checked_add(amount)
        .ok_or(ClampError::MathOverflow)?;
    emit!(PairsMinted {
        series: series.key(),
        user: ctx.accounts.user.key(),
        amount,
    });
    Ok(())
}

/// Burns `amount` UP and DOWN of the user, pays `amount` collateral back.
pub fn handle_merge_pairs(ctx: Context<Pairs>, amount: u64) -> Result<()> {
    require!(amount > 0, ClampError::ZeroAmount);
    require!(!ctx.accounts.series.settled, ClampError::SeriesSettled);
    let a = &ctx.accounts;
    let tp = a.token_program.key();

    for (mint, from) in [(&a.up_mint, &a.user_up), (&a.down_mint, &a.user_down)] {
        burn(
            CpiContext::new(
                tp,
                Burn {
                    mint: mint.to_account_info(),
                    from: from.to_account_info(),
                    authority: a.user.to_account_info(),
                },
            ),
            amount,
        )?;
    }
    a.series.with_signer(|signer| {
        transfer_checked(
            CpiContext::new_with_signer(
                tp,
                TransferChecked {
                    from: a.collateral.to_account_info(),
                    mint: a.collateral_mint.to_account_info(),
                    to: a.user_collateral.to_account_info(),
                    authority: a.series.to_account_info(),
                },
                signer,
            ),
            amount,
            a.collateral_mint.decimals,
        )
    })?;

    let series = &mut ctx.accounts.series;
    series.pairs_outstanding = series
        .pairs_outstanding
        .checked_sub(amount)
        .ok_or(ClampError::MathOverflow)?;
    emit!(PairsMerged {
        series: series.key(),
        user: ctx.accounts.user.key(),
        amount,
    });
    Ok(())
}
