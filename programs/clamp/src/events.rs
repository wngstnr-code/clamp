use anchor_lang::prelude::*;

use crate::constants::MAX_SOURCES;

/// A reporter's report was stored (spec 6.2). Carries the raw response hashes.
#[event]
pub struct ReportSubmitted {
    pub class_id: u8,
    pub reporter: Pubkey,
    pub ts: i64,
    /// By source slot of the class. 0 = the source did not answer.
    pub prices: [u64; MAX_SOURCES],
    pub capacities: [u32; MAX_SOURCES],
    /// SHA-256 of the archived raw API response, by source slot.
    pub raw_hashes: [[u8; 32]; MAX_SOURCES],
}

/// One source as it entered an index update.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct SourceUsed {
    pub source_id: u8,
    /// Combined price across reporters. 0 = the source was left out.
    pub price: u64,
    pub capacity: u32,
    /// Weight in the weighted median. 0 = left out.
    pub weight: u8,
}

/// An index update was accepted and recorded (spec 6.2 step 7, 6.3).
#[event]
pub struct IndexUpdated {
    pub class_id: u8,
    pub ts: i64,
    /// Recorded price after the step limit.
    pub price: u64,
    /// Weighted median before the step limit.
    pub candidate: u64,
    /// Fresh reports that formed this update.
    pub reporter_count: u8,
    pub sources: [SourceUsed; MAX_SOURCES],
    pub cum_price: u128,
    pub cum_valid: u64,
    pub update_count: u64,
}

/// A series was created (spec 7.1).
#[event]
pub struct SeriesCreated {
    pub series: Pubkey,
    pub class_id: u8,
    pub kind: u8,
    pub seq: u32,
    pub start_ts: i64,
    pub close_ts: i64,
    pub expiry_ts: i64,
    pub center: u64,
    pub lower: u64,
    pub upper: u64,
    pub start_index: u64,
}

#[event]
pub struct PairsMinted {
    pub series: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PairsMerged {
    pub series: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

/// A series was settled (spec 11).
#[event]
pub struct SeriesSettled {
    pub series: Pubkey,
    pub avg: u64,
    pub up_value: u32,
    pub coverage_ppm: u32,
    pub settled_ts: i64,
}

#[event]
pub struct Redeemed {
    pub series: Pubkey,
    pub user: Pubkey,
    pub side: u8,
    pub amount: u64,
    pub payout: u64,
}

#[event]
pub struct VaultDeposit {
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u64,
    pub nav: u64,
    pub total_shares: u64,
}

#[event]
pub struct VaultWithdraw {
    pub user: Pubkey,
    pub shares: u64,
    pub amount: u64,
    pub nav: u64,
    pub total_shares: u64,
}

#[event]
pub struct SeriesSeeded {
    pub series: Pubkey,
    pub allocation: u64,
    pub fair_value_ppm: u64,
    pub pool_up: u64,
    pub pool_down: u64,
}

#[event]
pub struct Recentered {
    pub series: Pubkey,
    pub fair_value_ppm: u64,
    pub pool_up: u64,
    pub pool_down: u64,
    pub inv_up: u64,
    pub inv_down: u64,
}

/// A pool trade (spec 8.3, 8.4). `usdc` is paid in (buy) or paid out (sell).
#[event]
pub struct Trade {
    pub series: Pubkey,
    pub user: Pubkey,
    pub side: u8,
    pub is_buy: bool,
    pub usdc: u64,
    pub claims: u64,
    pub fee: u64,
    pub pool_up: u64,
    pub pool_down: u64,
    pub fair_value_ppm: u64,
}

#[event]
pub struct SeriesSwept {
    pub series: Pubkey,
    pub up_units: u64,
    pub down_units: u64,
    pub payout: u64,
}
