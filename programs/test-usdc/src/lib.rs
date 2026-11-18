//! Devnet-only faucet for the Clamp test USDC mint (tUSDC, 6 decimals).
//!
//! M0 skeleton: the program id and an empty instruction set. The faucet
//! instructions arrive in M2, as described in docs/architecture.md.

use anchor_lang::prelude::*;

declare_id!("5QZihvTBjqZkmbX2gFcQjqnNBBq1AB3W8nRD2VeVUZLP");

#[program]
pub mod test_usdc {}
