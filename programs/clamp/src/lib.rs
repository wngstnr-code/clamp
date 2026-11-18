//! Clamp: a fully collateralized two-way price lock on a GPU rental price index.
//!
//! M0 skeleton: the program id and an empty instruction set. Instructions arrive
//! from M1 on, as listed in docs/architecture.md section 4.

use anchor_lang::prelude::*;

declare_id!("wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC");

#[program]
pub mod clamp {}
