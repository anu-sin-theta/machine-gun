use thiserror::Error;

/// Errors for malformed *input* (programming or config errors). Business
/// outcomes such as "payment blocked" are values, not errors.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("invalid amount: {0}")]
    InvalidAmount(String),
    #[error("invalid config: {0}")]
    InvalidConfig(String),
    #[error("invalid action: {0}")]
    InvalidAction(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("illegal state transition: {0}")]
    IllegalTransition(String),
    #[error("canonicalization failed: {0}")]
    Canonicalization(String),
}

impl Error {
    /// Stable machine-readable name, used across the WASM boundary.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::InvalidAmount(_) => "InvalidAmount",
            Error::InvalidConfig(_) => "InvalidConfig",
            Error::InvalidAction(_) => "InvalidAction",
            Error::InvalidInput(_) => "InvalidInput",
            Error::IllegalTransition(_) => "IllegalTransition",
            Error::Canonicalization(_) => "Canonicalization",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
