use anchor_lang::prelude::*;

/// One series of a class and kind (spec 7). PDA
/// `["series", class_id, kind, seq (u32 LE)]`, `seq` = the class's
/// `series_count[kind]` at creation (D-056).
///
/// The layout is final from M2 on (architecture 3.1): the pool and vault
/// fields are here from the start, so a live weekly series survives the M2
/// pool work. New fields go into `_reserved`.
#[account]
#[derive(InitSpace)]
pub struct Series {
    pub class_id: u8,
    pub kind: u8,
    pub seq: u32,
    pub start_ts: i64,
    pub close_ts: i64,
    pub expiry_ts: i64,
    /// Band, micro-USD per GPU-hour.
    pub center: u64,
    pub lower: u64,
    pub upper: u64,
    /// Index price at creation (used when the period has no counted time).
    pub start_index: u64,
    /// Running sums of the class index at `start_ts`.
    pub start_cum_price: u128,
    pub start_cum_valid: u64,
    pub trade_fee_bps: u16,
    pub protocol_share_bps: u16,
    pub up_mint: Pubkey,
    pub down_mint: Pubkey,
    /// Collateral token account of the series (owner: the series PDA).
    pub collateral: Pubkey,
    /// Vault-owned UP and DOWN units (pool plus inventory), owner: the series PDA.
    pub up_vault: Pubkey,
    pub down_vault: Pubkey,
    /// Pairs minted and not merged yet, including the vault's.
    pub pairs_outstanding: u64,
    pub pool_up: u64,
    pub pool_down: u64,
    pub inv_up: u64,
    pub inv_down: u64,
    pub last_recenter_ts: i64,
    pub seeded: bool,
    pub settled: bool,
    /// Period average, micro-USD per GPU-hour.
    pub avg: u64,
    /// Value of one UP claim in micro-USDC (ppm of 1 USDC).
    pub up_value: u32,
    /// Counted time of the period in ppm of its duration.
    pub coverage_ppm: u32,
    pub settled_ts: i64,
    pub swept: bool,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl Series {
    pub fn duration(&self) -> i64 {
        self.expiry_ts - self.start_ts
    }
}
