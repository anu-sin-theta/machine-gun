//! Canonical JSON (RFC 8785 / JCS) and SHA-256. Everything we commit to,
//! such as approval bindings and verdicts, is hashed through here so the
//! same value always yields the same digest.

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// Canonical JSON bytes of any serializable value.
pub fn canonical_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json_canonicalizer::to_string(value).map_err(|e| Error::Canonicalization(e.to_string()))
}

pub fn sha256_hex(input: &[u8]) -> String {
    let digest = Sha256::digest(input);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push(char::from_digit(u32::from(byte >> 4), 16).unwrap_or('0'));
        out.push(char::from_digit(u32::from(byte & 0x0f), 16).unwrap_or('0'));
    }
    out
}

pub fn hash_canonical<T: Serialize>(value: &T) -> Result<String> {
    Ok(sha256_hex(canonical_json(value)?.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn key_order_does_not_matter() {
        let a = json!({"b": 1, "a": {"y": [1, 2], "x": null}});
        let b = json!({"a": {"x": null, "y": [1, 2]}, "b": 1});
        assert_eq!(
            canonical_json(&a).unwrap_or_default(),
            canonical_json(&b).unwrap_or_default()
        );
        assert_eq!(
            canonical_json(&a).unwrap_or_default(),
            r#"{"a":{"x":null,"y":[1,2]},"b":1}"#
        );
    }

    #[test]
    fn hashes_are_64_hex_and_content_sensitive() {
        let h = hash_canonical(&json!({"a": 1})).unwrap_or_default();
        assert_eq!(h.len(), 64);
        assert!(
            h.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        );
        assert_ne!(h, hash_canonical(&json!({"a": 2})).unwrap_or_default());
    }

    #[test]
    fn unicode_and_escapes_are_stable() {
        let v = json!({"s": "é\n\"\\\u{1F600}"});
        assert_eq!(
            canonical_json(&v).unwrap_or_default(),
            "{\"s\":\"é\\n\\\"\\\\😀\"}"
        );
    }
}
