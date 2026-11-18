use anchor_lang::prelude::*;

/// Series the vault can hold at once (spec 9.3).
pub const MAX_ACTIVE_SERIES: usize = 8;

/// The liquidity vault (spec 9). PDA `["vault"]`. Owns the share mint
/// `["shares"]` and the idle collateral account `["idle"]`.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub share_mint: Pubkey,
    pub idle: Pubkey,
    /// Seeded and not yet swept series, in seeding order.
    pub active_series: [Pubkey; MAX_ACTIVE_SERIES],
    pub active_count: u8,
    /// Share units of the first deposit that nobody owns (spec 9.2). They
    /// count in the total supply for every share price.
    pub locked_shares: u64,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl Vault {
    pub fn active(&self) -> &[Pubkey] {
        &self.active_series[..usize::from(self.active_count)]
    }
}
