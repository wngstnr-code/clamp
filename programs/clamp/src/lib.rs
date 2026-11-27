//! Clamp: a fully collateralized two-way price lock on a GPU rental price index.
//!
//! M1: the Clamp Index (config, classes, reporters, updates, period average).
//! M2: series, claim pairs, settlement and redeem, the pool and the vault.
//! M3: Bill Lock and Revenue Lock (docs/architecture.md 3.3).

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

    /// Creates the next series of a class and kind. Anyone, after the previous one expired.
    pub fn create_series(ctx: Context<CreateSeries>, class_id: u8, kind: u8) -> Result<()> {
        instructions::create_series::handle_create_series(ctx, class_id, kind)
    }

    /// Pays `amount` collateral, receives `amount` UP and `amount` DOWN.
    pub fn mint_pairs(ctx: Context<Pairs>, amount: u64) -> Result<()> {
        instructions::pairs::handle_mint_pairs(ctx, amount)
    }

    /// Returns `amount` UP and `amount` DOWN, receives `amount` collateral.
    pub fn merge_pairs(ctx: Context<Pairs>, amount: u64) -> Result<()> {
        instructions::pairs::handle_merge_pairs(ctx, amount)
    }

    /// Settles an expired series from the index period average. Anyone.
    pub fn settle_series(ctx: Context<SettleSeries>) -> Result<()> {
        instructions::settle::handle_settle_series(ctx)
    }

    /// Burns settled claims of one side for their value in collateral.
    pub fn redeem(ctx: Context<Redeem>, side: u8, amount: u64) -> Result<()> {
        instructions::settle::handle_redeem(ctx, side, amount)
    }

    /// Creates the vault, its share mint and idle account. Admin, once.
    pub fn init_vault(ctx: Context<InitVault>) -> Result<()> {
        instructions::vault_flow::handle_init_vault(ctx)
    }

    /// Deposits collateral for vault shares. Remaining accounts: active series and their IndexStates.
    pub fn deposit<'info>(ctx: Context<'info, VaultFlow<'info>>, amount: u64) -> Result<()> {
        instructions::vault_flow::handle_deposit(ctx, amount)
    }

    /// Burns vault shares for idle collateral. Remaining accounts as for `deposit`.
    pub fn withdraw<'info>(ctx: Context<'info, VaultFlow<'info>>, shares: u64) -> Result<()> {
        instructions::vault_flow::handle_withdraw(ctx, shares)
    }

    /// Puts the vault's allocation into the pool of a series. Anyone, once.
    pub fn seed_series<'info>(ctx: Context<'info, SeedSeries<'info>>) -> Result<()> {
        instructions::trade::handle_seed_series(ctx)
    }

    /// Buys claims of one side through the pool.
    pub fn buy(ctx: Context<TradeAccounts>, side: u8, usdc_in: u64, min_out: u64) -> Result<()> {
        instructions::trade::handle_buy(ctx, side, usdc_in, min_out)
    }

    /// Sells claims of one side through the pool.
    pub fn sell(
        ctx: Context<TradeAccounts>,
        side: u8,
        amount: u64,
        min_usdc_out: u64,
    ) -> Result<()> {
        instructions::trade::handle_sell(ctx, side, amount, min_usdc_out)
    }

    /// Returns the vault's units of a settled series to idle USDC. Anyone.
    pub fn sweep_series(ctx: Context<SweepSeries>) -> Result<()> {
        instructions::trade::handle_sweep_series(ctx)
    }

    /// Buys claims of `side` into the owner's lock for this series (spec 10.4).
    #[allow(clippy::too_many_arguments)]
    pub fn open_lock(
        ctx: Context<OpenLock>,
        side: u8,
        usdc_in: u64,
        min_claims_out: u64,
        hours: u32,
        ref_rate: u64,
        auto_roll: bool,
    ) -> Result<()> {
        instructions::lock_flow::handle_open_lock(
            ctx,
            side,
            usdc_in,
            min_claims_out,
            hours,
            ref_rate,
            auto_roll,
        )
    }

    /// Sells (before close) or redeems (after settlement) the lock's claims, pays the owner, closes the lock.
    pub fn close_lock(ctx: Context<CloseLock>, min_usdc_out: u64) -> Result<()> {
        instructions::lock_flow::handle_close_lock(ctx, min_usdc_out)
    }

    /// Moves the lock's claims to the owner's wallet and closes the lock.
    pub fn withdraw_lock_claims(ctx: Context<WithdrawLockClaims>) -> Result<()> {
        instructions::lock_flow::handle_withdraw_lock_claims(ctx)
    }

    /// Turns auto-roll of a lock on or off. Owner only.
    pub fn set_auto_roll(ctx: Context<SetAutoRoll>, on: bool) -> Result<()> {
        instructions::lock_flow::handle_set_auto_roll(ctx, on)
    }
}
