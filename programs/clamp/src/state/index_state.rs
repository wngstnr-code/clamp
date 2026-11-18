use anchor_lang::prelude::*;

use crate::constants::{MAX_REPORTERS, MAX_SOURCES};

/// The latest report of one reporter slot.
#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Default, Debug, PartialEq, Eq,
)]
pub struct Report {
    /// Who sent it. A report counts only while this key is still in the slot.
    pub reporter: Pubkey,
    pub ts: i64,
    /// Already part of an accepted update.
    pub used: bool,
    /// By source slot. 0 = the source did not answer.
    pub prices: [u64; MAX_SOURCES],
    pub capacities: [u32; MAX_SOURCES],
}

/// Live index of one class. PDA `["index", class_id]`.
///
/// `last_*` and `cum_*` equal the newest observation once `update_count > 0`.
#[account]
#[derive(InitSpace)]
pub struct IndexState {
    pub class_id: u8,
    /// The `Observations` account bound by `init_index`.
    pub observations: Pubkey,
    pub last_ts: i64,
    pub last_price: u64,
    pub cum_price: u128,
    pub cum_valid: u64,
    /// Ring slot of the newest observation.
    pub obs_index: u16,
    /// Filled ring slots.
    pub obs_count: u16,
    pub update_count: u64,
    /// Indexed by reporter slot of the class.
    pub reports: [Report; MAX_REPORTERS],
    pub bump: u8,
    pub _reserved: [u8; 64],
}
