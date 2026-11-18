use anchor_lang::prelude::*;

use crate::constants::{MAX_REPORTERS, MAX_SOURCES};

/// One price source of a class, in the order of the report slots.
#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Default, Debug, PartialEq, Eq,
)]
pub struct Source {
    /// 1 Vast.ai, 2 RunPod, 3 Akash, 4 Nosana.
    pub source_id: u8,
    /// True: weight by capacity tier. False: use `fixed_weight`.
    pub has_capacity: bool,
    pub fixed_weight: u8,
}

/// Settings of one GPU class. PDA `["class", class_id]`.
///
/// Reporters, quorum, bounds and widths affect future updates and future
/// series only. The sources are fixed when the class is created, because the
/// stored reports are read by source slot.
#[account]
#[derive(InitSpace)]
pub struct ClassConfig {
    /// 1 = RTX 4090, 2 = H100. 0 means the account was just created.
    pub class_id: u8,
    pub name: [u8; 16],
    pub enabled: bool,
    pub reporters: [Pubkey; MAX_REPORTERS],
    pub reporter_count: u8,
    pub min_reporters: u8,
    pub sources: [Source; MAX_SOURCES],
    pub source_count: u8,
    pub min_sources: u8,
    pub min_total_weight: u8,
    /// Sanity bounds for one reported price, micro-USD per GPU-hour.
    pub min_price: u64,
    pub max_price: u64,
    pub max_step_ppm: u32,
    /// Band half width per series kind: daily, weekly, monthly.
    pub half_width_ppm: [u32; 3],
    /// The latest series per kind (set from M2 on).
    pub current_series: [Pubkey; 3],
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl ClassConfig {
    /// Slot of `key` in the reporter list, if it is registered.
    pub fn reporter_slot(&self, key: &Pubkey) -> Option<usize> {
        self.reporters[..usize::from(self.reporter_count)]
            .iter()
            .position(|r| r == key)
    }
}
