use anchor_lang::prelude::*;

/// Global settings. PDA `["config"]`.
///
/// The layout is final: it must not change once the account exists on devnet
/// (architecture 3.1). New fields go into `_reserved`.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Collateral of every series (tUSDC on devnet).
    pub collateral_mint: Pubkey,
    /// Token account of `collateral_mint` that receives protocol fees.
    pub treasury: Pubkey,
    /// Copied into each new series.
    pub trade_fee_bps: u16,
    /// Share of each trade fee that goes to the treasury.
    pub protocol_share_bps: u16,
    /// Vault NAV allocated to one series when it is seeded.
    pub series_alloc_bps: u16,
    pub bump: u8,
    pub _reserved: [u8; 64],
}
