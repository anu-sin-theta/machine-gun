//! Money is integer base units (tinybars for HBAR, token base units for HTS).
//! On the wire, units are decimal strings, never JSON numbers, so nothing can
//! round through an f64.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub const TINYBARS_PER_HBAR: i128 = 100_000_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Asset {
    #[serde(rename = "HBAR")]
    Hbar,
    #[serde(rename = "HTS", rename_all = "camelCase")]
    Hts { token_id: String, decimals: u8 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Amount {
    pub asset: Asset,
    #[serde(with = "i128_string")]
    pub units: i128,
}

/// Stable key for an asset: `"HBAR"` or `"HTS:0.0.6001"`.
pub fn asset_key(asset: &Asset) -> String {
    match asset {
        Asset::Hbar => "HBAR".to_string(),
        Asset::Hts { token_id, .. } => format!("HTS:{token_id}"),
    }
}

pub fn same_asset(a: &Asset, b: &Asset) -> bool {
    asset_key(a) == asset_key(b)
}

/// True for `shard.realm.num` with decimal digits only, e.g. `0.0.5001`.
pub fn is_hedera_entity_id(value: &str) -> bool {
    let mut parts = 0;
    for part in value.split('.') {
        parts += 1;
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    parts == 3
}

pub fn hbar(whole: i64) -> Amount {
    Amount {
        asset: Asset::Hbar,
        units: i128::from(whole) * TINYBARS_PER_HBAR,
    }
}

pub fn tinybars(units: i128) -> Amount {
    Amount {
        asset: Asset::Hbar,
        units,
    }
}

/// Exact human-readable amount, e.g. `"12.5 HBAR"`.
pub fn format_amount(amount: &Amount) -> Result<String> {
    let (decimals, symbol) = match &amount.asset {
        Asset::Hbar => (8u32, "HBAR".to_string()),
        Asset::Hts { token_id, decimals } => (u32::from(*decimals), token_id.clone()),
    };
    let base = 10i128
        .checked_pow(decimals)
        .ok_or_else(|| Error::InvalidAmount("decimals too large".into()))?;
    let negative = amount.units < 0;
    let abs = amount.units.unsigned_abs();
    let base_u = base.unsigned_abs();
    let whole = abs / base_u;
    let frac = abs % base_u;
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    out.push_str(&whole.to_string());
    if frac != 0 {
        let padded = format!("{:0>width$}", frac, width = decimals as usize);
        out.push('.');
        out.push_str(padded.trim_end_matches('0'));
    }
    out.push(' ');
    out.push_str(&symbol);
    Ok(out)
}

/// serde adapter: `i128` <-> decimal string. Rejects JSON numbers on purpose.
pub mod i128_string {
    use serde::{Deserialize, Deserializer, Serializer, de::Error as _};

    pub fn serialize<S: Serializer>(v: &i128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i128, D::Error> {
        let raw = String::deserialize(d)?;
        let digits = raw.strip_prefix('-').unwrap_or(&raw);
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return Err(D::Error::custom("expected a decimal integer string"));
        }
        raw.parse::<i128>().map_err(D::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hbar_converts_exactly() {
        assert_eq!(hbar(1).units, 100_000_000);
        assert_eq!(hbar(12).units, 1_200_000_000);
    }

    #[test]
    fn formats_without_rounding() {
        assert_eq!(format_amount(&hbar(12)).unwrap_or_default(), "12 HBAR");
        assert_eq!(
            format_amount(&tinybars(1)).unwrap_or_default(),
            "0.00000001 HBAR"
        );
        assert_eq!(
            format_amount(&tinybars(1_250_000_000)).unwrap_or_default(),
            "12.5 HBAR"
        );
        assert_eq!(
            format_amount(&tinybars(-150_000_000)).unwrap_or_default(),
            "-1.5 HBAR"
        );
        let usdc = Amount {
            asset: Asset::Hts {
                token_id: "0.0.6001".into(),
                decimals: 6,
            },
            units: 1_500_000,
        };
        assert_eq!(format_amount(&usdc).unwrap_or_default(), "1.5 0.0.6001");
    }

    #[test]
    fn asset_keys_and_equality() {
        let usdc = Asset::Hts {
            token_id: "0.0.6001".into(),
            decimals: 6,
        };
        assert_eq!(asset_key(&Asset::Hbar), "HBAR");
        assert_eq!(asset_key(&usdc), "HTS:0.0.6001");
        assert!(same_asset(&usdc, &usdc.clone()));
        assert!(!same_asset(&usdc, &Asset::Hbar));
    }

    #[test]
    fn entity_id_validation() {
        assert!(is_hedera_entity_id("0.0.5001"));
        for bad in [
            "0.0.",
            "0.0.5001 ",
            "0.0",
            "a.b.c",
            "0.0.5.1",
            "",
            "0..1",
            "-1.0.1",
            "٣.0.1",
        ] {
            assert!(!is_hedera_entity_id(bad), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn json_roundtrip_uses_strings_and_rejects_numbers() {
        let a = hbar(12);
        let json = serde_json::to_string(&a).unwrap_or_default();
        assert_eq!(json, r#"{"asset":{"kind":"HBAR"},"units":"1200000000"}"#);
        let back: Amount = serde_json::from_str(&json).unwrap_or_else(|_| tinybars(0));
        assert_eq!(back, a);

        assert!(
            serde_json::from_str::<Amount>(r#"{"asset":{"kind":"HBAR"},"units":1200000000}"#)
                .is_err()
        );
        assert!(
            serde_json::from_str::<Amount>(r#"{"asset":{"kind":"HBAR"},"units":"1.5"}"#).is_err()
        );
        assert!(serde_json::from_str::<Amount>(r#"{"asset":{"kind":"HBAR"},"units":""}"#).is_err());
        assert!(
            serde_json::from_str::<Amount>(r#"{"asset":{"kind":"HBAR"},"units":"+5"}"#).is_err()
        );
    }

    #[test]
    fn hts_asset_json_shape_matches_typescript() {
        let a = Asset::Hts {
            token_id: "0.0.6001".into(),
            decimals: 6,
        };
        assert_eq!(
            serde_json::to_string(&a).unwrap_or_default(),
            r#"{"kind":"HTS","tokenId":"0.0.6001","decimals":6}"#
        );
    }
}
