use anchor_lang::prelude::*;

/// A Bill Lock (UP) or Revenue Lock (DOWN) of one owner in one series
/// (spec 10). PDA `["lock", owner, series, side]`. The claims sit in the
/// escrow token account `["escrow", lock]`, whose authority is the lock.
#[account]
#[derive(InitSpace)]
pub struct Lock {
    pub owner: Pubkey,
    pub series: Pubkey,
    /// 0 UP, 1 DOWN.
    pub side: u8,
    /// Claims bought into the escrow by `open_lock`.
    pub claims: u64,
    /// Collateral paid for them, fees included.
    pub paid: u64,
    /// GPU-hours the owner expects in the period (display, and the size of a roll).
    pub hours: u32,
    /// The owner's own rate from the bill, micro-USD per GPU-hour (display only).
    pub ref_rate: u64,
    pub auto_roll: bool,
    /// Receives the rent of the lock and the escrow when they close.
    pub rent_payer: Pubkey,
    pub created_ts: i64,
    pub escrow: Pubkey,
    pub bump: u8,
    pub _reserved: [u8; 32],
}
