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
