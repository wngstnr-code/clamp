use anchor_lang::prelude::*;

use crate::math::MathError;

#[error_code]
pub enum ClampError {
    #[msg("Fee or allocation parameter out of range")]
    InvalidFeeParams,
    #[msg("Class parameter out of range")]
    InvalidClassParams,
    #[msg("Class id must be 1 or higher")]
    InvalidClassId,
    #[msg("The sources of a class cannot change after it is created")]
    SourcesLocked,
    #[msg("The class is disabled")]
    ClassDisabled,
    #[msg("The signer is not a registered reporter of this class")]
    NotReporter,
    #[msg("A price was sent for a source slot the class does not use")]
    InvalidReport,
    #[msg("The observations account has the wrong size")]
    InvalidObservationsAccount,
    #[msg("Collateral mint and treasury do not match")]
    TreasuryMintMismatch,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Invalid input to a math function")]
    MathInvalidInput,
    #[msg("A price above 0 needs the hash of its raw API answer")]
    MissingRawHash,
    #[msg("Series kind must be 0 (daily), 1 (weekly) or 2 (monthly)")]
    InvalidKind,
    #[msg("The current series of this class and kind has not expired yet")]
    SeriesStillLive,
    #[msg("The index has no update within MAX_GAP")]
    IndexStale,
    #[msg("Less than 6 hours of index history in the center window")]
    NotEnoughHistory,
    #[msg("The band is empty")]
    InvalidBand,
    #[msg("Wrong mint for this series")]
    WrongMint,
    #[msg("Wrong token account for this series")]
    WrongTokenAccount,
    #[msg("Amount must be above 0")]
    ZeroAmount,
    #[msg("The series is already settled")]
    SeriesSettled,
    #[msg("The series has not expired yet")]
    NotExpired,
    #[msg("The series is not settled yet")]
    NotSettled,
    #[msg("Side must be 0 (UP) or 1 (DOWN)")]
    InvalidSide,
    #[msg("A series past expiry must be settled before the vault can be valued")]
    SeriesNeedsSettlement,
    #[msg("Remaining accounts must be every active series and its IndexState, in vault order")]
    ActiveSeriesMismatch,
    #[msg("Deposit refused (zero, below the 10 USDC first deposit, or worth no share)")]
    InvalidDeposit,
    #[msg("Withdrawal refused (zero or more shares than exist)")]
    InvalidWithdraw,
    #[msg("Not enough idle USDC in the vault")]
    NotEnoughIdle,
    #[msg("The series is already seeded")]
    AlreadySeeded,
    #[msg("The series is not seeded")]
    NotSeeded,
    #[msg("The vault already holds the maximum number of series")]
    ActiveListFull,
    #[msg("Trading is closed for this series")]
    TradingClosed,
    #[msg("The pool is paused: the outcome is almost certain")]
    PoolPaused,
    #[msg("The result is below the minimum you set")]
    SlippageExceeded,
    #[msg("Nothing to sweep")]
    NothingToSweep,
    #[msg("Trading is closed and the series is not settled yet: wait for settlement")]
    LockWaitsForSettlement,
    #[msg("The lock belongs to another series")]
    WrongLockSeries,
}

impl From<MathError> for ClampError {
    fn from(e: MathError) -> Self {
        match e {
            MathError::Overflow => ClampError::MathOverflow,
            MathError::InvalidInput => ClampError::MathInvalidInput,
        }
    }
}
