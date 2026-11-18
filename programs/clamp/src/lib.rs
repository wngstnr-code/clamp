//! Clamp: a fully collateralized two-way price lock on a GPU rental price index.
//!
//! M1: the Clamp Index (config, classes, reporters, updates, period average).
//! The market, vault and locks follow from M2 on (docs/architecture.md 3.3).

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC");

#[program]
pub mod clamp {
    use super::*;

    /// Creates the global config. Upgrade authority only, once.
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, params)
    }

    /// Creates or updates a GPU class. Admin only.
    pub fn set_class(ctx: Context<SetClass>, class_id: u8, params: ClassParams) -> Result<()> {
        instructions::set_class::handle_set_class(ctx, class_id, params)
    }

    /// Creates the index of a class and binds its observation ring. Admin only.
    pub fn init_index(ctx: Context<InitIndex>, class_id: u8) -> Result<()> {
        instructions::init_index::handle_init_index(ctx, class_id)
    }

    /// Stores a reporter's report and updates the index when allowed.
    pub fn submit_report(
        ctx: Context<SubmitReport>,
        class_id: u8,
        prices: [u64; MAX_SOURCES],
        capacities: [u32; MAX_SOURCES],
        raw_hashes: [[u8; 32]; MAX_SOURCES],
    ) -> Result<()> {
        instructions::submit_report::handle_submit_report(
            ctx, class_id, prices, capacities, raw_hashes,
        )
    }
}
