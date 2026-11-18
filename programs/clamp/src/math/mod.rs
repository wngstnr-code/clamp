//! Pure math used by the program. No accounts, no Anchor types, so every
//! function can be unit tested on the host and mirrored in the SDK.

pub mod median;
pub mod twap;

/// Parts per million: 1_000_000 = 100%.
pub const PPM: u64 = 1_000_000;

/// Errors from the pure math. The instructions map them to program errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// An intermediate or final value does not fit its type.
    Overflow,
    /// The inputs break a precondition (for example time going backwards).
    InvalidInput,
}
