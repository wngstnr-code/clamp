use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{BPS, CONFIG_SEED, MAX_TRADE_FEE_BPS};
use crate::errors::ClampError;
use crate::program::Clamp;
use crate::state::Config;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct InitializeParams {
    pub trade_fee_bps: u16,
    pub protocol_share_bps: u16,
    pub series_alloc_bps: u16,
}

/// Creates the global config. Only the program's upgrade authority can call
/// it, so nobody else can take the admin role between deploy and setup.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(constraint = treasury.mint == collateral_mint.key() @ ClampError::TreasuryMintMismatch)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, Clamp>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()))]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    require!(
        params.trade_fee_bps <= MAX_TRADE_FEE_BPS
            && params.protocol_share_bps <= BPS
            && params.series_alloc_bps > 0
            && params.series_alloc_bps <= BPS,
        ClampError::InvalidFeeParams
    );
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.collateral_mint = ctx.accounts.collateral_mint.key();
    config.treasury = ctx.accounts.treasury.key();
    config.trade_fee_bps = params.trade_fee_bps;
    config.protocol_share_bps = params.protocol_share_bps;
    config.series_alloc_bps = params.series_alloc_bps;
    config.bump = ctx.bumps.config;
    Ok(())
}
