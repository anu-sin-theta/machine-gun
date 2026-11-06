//! Pure safety logic for Kavach402. No I/O, no clock, no randomness: callers
//! pass time and random values in, so every function is deterministic and
//! testable. The TypeScript app calls this crate through WASM.

pub mod api;
pub mod assurance;
pub mod binding;
pub mod canonical;
pub mod error;
pub mod linkintel;
pub mod money;
pub mod policy;

pub use error::Error;
