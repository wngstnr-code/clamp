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
}

impl From<MathError> for ClampError {
    fn from(e: MathError) -> Self {
        match e {
            MathError::Overflow => ClampError::MathOverflow,
            MathError::InvalidInput => ClampError::MathInvalidInput,
        }
    }
}
