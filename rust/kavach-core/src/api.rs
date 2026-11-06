//! String-in, string-out JSON API over the core. This is the surface the WASM
//! crate exports, kept here so it is unit-tested natively.
//!
//! Every function returns an envelope, never panics, never throws:
//! `{"ok":true,"value":...}` or `{"ok":false,"error":{"kind":"...","message":"..."}}`.
//! Money crosses the boundary as decimal strings, never JSON numbers.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::assurance::{AcrRequirements, AssuranceTier, acr_claims_param};
use crate::binding::{
    self, ApprovalFailure, AuthResult, BoundAction, CreatePendingInput, PendingApproval,
    SubjectBinding, ValidateOptions,
};
use crate::canonical;
use crate::error::{Error, Result};
use crate::linkintel::{self, LinkInput, LinkIntelConfig};
use crate::policy::{self, PaymentContext, PolicyConfig};

fn parse<T: DeserializeOwned>(what: &str, json: &str) -> Result<T> {
    serde_json::from_str(json).map_err(|e| Error::InvalidInput(format!("{what}: {e}")))
}

fn to_value<T: Serialize>(v: &T) -> Result<Value> {
    serde_json::to_value(v).map_err(|e| Error::InvalidInput(format!("serialize: {e}")))
}

/// Wraps a result in the envelope. Falls back to a fixed error envelope if
/// serialization itself fails, so the caller always gets valid JSON.
fn envelope(result: Result<Value>) -> String {
    let value = match result {
        Ok(v) => json!({ "ok": true, "value": v }),
        Err(e) => json!({ "ok": false, "error": { "kind": e.kind(), "message": e.to_string() } }),
    };
    serde_json::to_string(&value).unwrap_or_else(|_| {
        r#"{"ok":false,"error":{"kind":"InvalidInput","message":"serialization failed"}}"#
            .to_string()
    })
}

/// Runs a fallible body and wraps its result in the envelope.
fn run(body: impl FnOnce() -> Result<Value>) -> String {
    envelope(body())
}

/// `PaymentContext` + `PolicyConfig` -> `Decision`.
pub fn decide(ctx_json: &str, config_json: &str) -> String {
    run(|| {
        let ctx: PaymentContext = parse("context", ctx_json)?;
        let config = PolicyConfig::from_json(config_json)?;
        to_value(&policy::decide(&ctx, &config)?)
    })
}

/// Validates a policy config and returns it normalised.
pub fn parse_policy_config(config_json: &str) -> String {
    run(|| to_value(&PolicyConfig::from_json(config_json)?))
}

/// Canonical JSON (RFC 8785) of any JSON value, as a string value.
pub fn canonical_json(value_json: &str) -> String {
    run(|| {
        let v: Value = parse("value", value_json)?;
        Ok(Value::String(canonical::canonical_json(&v)?))
    })
}

/// sha256 hex of the canonical JSON of any JSON value.
pub fn hash_canonical(value_json: &str) -> String {
    run(|| {
        let v: Value = parse("value", value_json)?;
        Ok(Value::String(canonical::hash_canonical(&v)?))
    })
}

pub fn hash_action(action_json: &str) -> String {
    run(|| {
        let action: BoundAction = parse("action", action_json)?;
        Ok(Value::String(binding::hash_action(&action)?))
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePendingJson {
    attempt_id: String,
    state: String,
    nonce: String,
    action: BoundAction,
    tier: AssuranceTier,
    now: i64,
    ttl_ms: i64,
    #[serde(default)]
    subject_binding: Option<SubjectBinding>,
    #[serde(default)]
    acr_requirements: Option<AcrRequirements>,
}

pub fn create_pending_approval(input_json: &str) -> String {
    run(|| {
        let i: CreatePendingJson = parse("input", input_json)?;
        let pending = binding::create_pending_approval(CreatePendingInput {
            attempt_id: i.attempt_id,
            state: i.state,
            nonce: i.nonce,
            action: i.action,
            tier: i.tier,
            now: i.now,
            ttl_ms: i.ttl_ms,
            subject_binding: i.subject_binding,
            acr_requirements: i.acr_requirements.unwrap_or_default(),
        })?;
        to_value(&pending)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateOptionsJson {
    expected_issuer: String,
    now: i64,
    #[serde(default)]
    clock_tolerance_sec: Option<i64>,
}

/// Returns `{"ok":true}` or `{"ok":false,"reason":"..."}` as the envelope value.
pub fn validate_approval(
    pending_json: &str,
    result_json: &str,
    current_action_json: &str,
    opts_json: &str,
) -> String {
    run(|| {
        let pending: PendingApproval = parse("pending", pending_json)?;
        let result: AuthResult = parse("result", result_json)?;
        let action: BoundAction = parse("currentAction", current_action_json)?;
        let o: ValidateOptionsJson = parse("options", opts_json)?;
        let mut opts = ValidateOptions::new(o.expected_issuer, o.now);
        if let Some(t) = o.clock_tolerance_sec {
            opts.clock_tolerance_sec = t;
        }
        Ok(
            match binding::validate_approval(&pending, &result, &action, &opts) {
                Ok(()) => json!({ "ok": true }),
                Err(reason) => json!({ "ok": false, "reason": to_value(&reason)? }),
            },
        )
    })
}

/// `{"ok":true}` / `{"ok":false,"reason":"EXPIRED"}` -> status string.
pub fn status_after_validation(check_json: &str) -> String {
    run(|| {
        let v: Value = parse("check", check_json)?;
        let check: std::result::Result<(), ApprovalFailure> =
            match v.get("ok").and_then(Value::as_bool) {
                Some(true) => Ok(()),
                Some(false) => Err(serde_json::from_value(
                    v.get("reason").cloned().unwrap_or(Value::Null),
                )
                .map_err(|e| Error::InvalidInput(format!("check.reason: {e}")))?),
                None => return Err(Error::InvalidInput("check.ok must be a boolean".into())),
            };
        to_value(&binding::status_after_validation(&check))
    })
}

pub fn status_after_authorization_error(error: &str) -> String {
    run(|| to_value(&binding::status_after_authorization_error(error)))
}

pub fn consume_approval(pending_json: &str, now: i64) -> String {
    run(|| {
        let pending: PendingApproval = parse("pending", pending_json)?;
        to_value(&binding::consume_approval(&pending, now)?)
    })
}

/// `tier` is `"fresh" | "human" | "strong"`; `reqs_json` may be empty for defaults.
/// Returns the claims string, or null when the tier has no `acr` constraint.
pub fn acr_claims(tier: &str, reqs_json: &str) -> String {
    run(|| {
        let tier: AssuranceTier = parse("tier", &Value::String(tier.to_string()).to_string())?;
        let reqs: AcrRequirements = if reqs_json.trim().is_empty() {
            AcrRequirements::default()
        } else {
            parse("requirements", reqs_json)?
        };
        Ok(acr_claims_param(tier, &reqs).map_or(Value::Null, Value::String))
    })
}

/// `config_json` may be empty for the built-in brand list.
pub fn analyze_link(input_json: &str, config_json: &str) -> String {
    run(|| {
        let input: LinkInput = parse("input", input_json)?;
        let cfg: LinkIntelConfig = if config_json.trim().is_empty() {
            LinkIntelConfig::default()
        } else {
            parse("config", config_json)?
        };
        to_value(&linkintel::analyze(&input, &cfg))
    })
}

/// The built-in link-intel config, so callers can extend it.
pub fn default_link_config() -> String {
    run(|| to_value(&LinkIntelConfig::default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn val(envelope: &str) -> Value {
        serde_json::from_str(envelope).unwrap_or(Value::Null)
    }

    fn ok_value(envelope: &str) -> Value {
        let v = val(envelope);
        assert_eq!(v.get("ok"), Some(&json!(true)), "{envelope}");
        v.get("value").cloned().unwrap_or(Value::Null)
    }

    fn err_kind(envelope: &str) -> String {
        let v = val(envelope);
        assert_eq!(v.get("ok"), Some(&json!(false)), "{envelope}");
        v.pointer("/error/kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    }

    const CONFIG: &str = r#"{"limits":{"HBAR":{"autoCap":"200000000","hardCap":"5000000000","dailyAutoBudget":"500000000"}}}"#;

    fn action_json() -> String {
        let h = canonical::sha256_hex(b"verdict-v1");
        format!(
            r#"{{"checkId":"chk_01","payee":"0.0.5001","resource":"https://kavach.test/api/x402/merchant/electricity","amount":{{"asset":{{"kind":"HBAR"}},"units":"1200000000"}},"verdictHash":"{h}","version":1}}"#
        )
    }

    #[test]
    fn decide_roundtrip() {
        let ctx = r#"{"amount":{"asset":{"kind":"HBAR"},"units":"100000000"},"verdict":{"level":"low","reasons":[]},"autoSpentToday":"0"}"#;
        assert_eq!(
            ok_value(&decide(ctx, CONFIG)),
            json!({"kind":"auto-pay","reasons":["RISK_LOW"]})
        );

        let missing = r#"{"amount":{"asset":{"kind":"HBAR"},"units":"100000000"},"verdict":null,"autoSpentToday":"0"}"#;
        assert_eq!(
            ok_value(&decide(missing, CONFIG)),
            json!({"kind":"step-up","tier":"strong","blockedByDefault":true,"reasons":["VERDICT_MISSING","RISK_HIGH"]})
        );
    }

    #[test]
    fn decide_rejects_bad_input_with_typed_errors_and_never_throws() {
        let ctx = r#"{"amount":{"asset":{"kind":"HBAR"},"units":"1"},"verdict":null,"autoSpentToday":"0"}"#;
        assert_eq!(err_kind(&decide("not json", CONFIG)), "InvalidInput");
        assert_eq!(err_kind(&decide(ctx, "{}")), "InvalidConfig");
        assert_eq!(err_kind(&decide(ctx, "")), "InvalidConfig");
        let numbers =
            r#"{"amount":{"asset":{"kind":"HBAR"},"units":1},"verdict":null,"autoSpentToday":"0"}"#;
        assert_eq!(
            err_kind(&decide(numbers, CONFIG)),
            "InvalidInput",
            "numeric money is rejected"
        );
        let negative = r#"{"amount":{"asset":{"kind":"HBAR"},"units":"1"},"verdict":null,"autoSpentToday":"-1"}"#;
        assert_eq!(err_kind(&decide(negative, CONFIG)), "InvalidInput");
    }

    #[test]
    fn hashing_matches_the_typescript_golden_value() {
        assert_eq!(
            ok_value(&hash_action(&action_json())),
            json!("062b70655d1cf5c4f7e280a422f1c3b23f49120ce5a8a5496ceaaa15adaa700d")
        );
        assert_eq!(
            ok_value(&canonical_json(r#"{"b":1,"a":[true,null]}"#)),
            json!(r#"{"a":[true,null],"b":1}"#)
        );
        assert_eq!(
            ok_value(&hash_canonical(r#"{"a":1}"#)),
            json!(canonical::hash_canonical(&json!({"a":1})).unwrap_or_default())
        );
        assert_eq!(err_kind(&hash_action("{}")), "InvalidInput");
    }

    fn pending_json(tier: &str) -> String {
        let input = format!(
            r#"{{"attemptId":"att_01","state":"state_aaaaaaaaaaaaaaaa","nonce":"nonce_bbbbbbbbbbbbbbbb","action":{},"tier":"{tier}","now":1793966400000,"ttlMs":600000}}"#,
            action_json()
        );
        serde_json::to_string(&ok_value(&create_pending_approval(&input))).unwrap_or_default()
    }

    const AUTH: &str = r#"{"iss":"https://auth.world.org","sub":"s","nonce":"nonce_bbbbbbbbbbbbbbbb","authTime":1793966430,"acr":"https://world.org/oidc/acr/orb"}"#;
    const OPTS: &str = r#"{"expectedIssuer":"https://auth.world.org","now":1793966460000}"#;

    #[test]
    fn approval_lifecycle_through_the_json_api() {
        let pending = pending_json("human");
        let p: Value = val(&pending);
        assert_eq!(p.get("status"), Some(&json!("pending")));
        assert_eq!(
            p.get("actionHash"),
            Some(&json!(
                "062b70655d1cf5c4f7e280a422f1c3b23f49120ce5a8a5496ceaaa15adaa700d"
            ))
        );

        let check = ok_value(&validate_approval(&pending, AUTH, &action_json(), OPTS));
        assert_eq!(check, json!({"ok": true}));
        let status = ok_value(&status_after_validation(&check.to_string()));
        assert_eq!(status, json!("approved"));

        let mut approved: Value = val(&pending);
        if let Some(obj) = approved.as_object_mut() {
            obj.insert("status".into(), status);
        }
        let consumed = ok_value(&consume_approval(&approved.to_string(), 1_793_966_460_000));
        assert_eq!(consumed.get("status"), Some(&json!("consumed")));
        assert_eq!(
            err_kind(&consume_approval(&consumed.to_string(), 1_793_966_460_000)),
            "IllegalTransition"
        );
    }

    #[test]
    fn validation_failures_are_values_not_errors() {
        let pending = pending_json("strong");
        let weak = AUTH.replace("orb\"", "selfie\"");
        let check = ok_value(&validate_approval(&pending, &weak, &action_json(), OPTS));
        assert_eq!(
            check,
            json!({"ok": false, "reason": "INSUFFICIENT_ASSURANCE"})
        );
        assert_eq!(
            ok_value(&status_after_validation(&check.to_string())),
            json!("rejected")
        );

        let expired = r#"{"ok":false,"reason":"EXPIRED"}"#;
        assert_eq!(
            ok_value(&status_after_validation(expired)),
            json!("expired")
        );
        assert_eq!(
            err_kind(&status_after_validation(r#"{"ok":false,"reason":"NOPE"}"#)),
            "InvalidInput"
        );
        assert_eq!(err_kind(&status_after_validation(r#"{}"#)), "InvalidInput");
    }

    #[test]
    fn custom_clock_tolerance_is_honoured() {
        let pending = pending_json("fresh");
        let early = AUTH.replace("1793966430", "1793966392"); // 8s before the attempt started
        let strict = ok_value(&validate_approval(&pending, &early, &action_json(), OPTS));
        assert_eq!(strict, json!({"ok": false, "reason": "STALE_AUTH"}));
        let lax = r#"{"expectedIssuer":"https://auth.world.org","now":1793966460000,"clockToleranceSec":10}"#;
        assert_eq!(
            ok_value(&validate_approval(&pending, &early, &action_json(), lax)),
            json!({"ok": true})
        );
    }

    #[test]
    fn null_auth_time_fails_closed_like_a_non_finite_number() {
        // JSON.stringify(NaN) and JSON.stringify(Infinity) both produce null.
        let pending = pending_json("fresh");
        let nan = AUTH.replace("1793966430", "null");
        assert_eq!(
            ok_value(&validate_approval(&pending, &nan, &action_json(), OPTS)),
            json!({"ok": false, "reason": "STALE_AUTH"})
        );
    }

    #[test]
    fn authorization_error_mapping() {
        assert_eq!(
            ok_value(&status_after_authorization_error("access_denied")),
            json!("denied")
        );
        assert_eq!(
            ok_value(&status_after_authorization_error("login_required")),
            json!("rejected")
        );
    }

    #[test]
    fn create_pending_rejects_invalid_actions_with_a_typed_error() {
        let input = format!(
            r#"{{"attemptId":"a","state":"state_aaaaaaaaaaaaaaaa","nonce":"nonce_bbbbbbbbbbbbbbbb","action":{},"tier":"human","now":1,"ttlMs":1}}"#,
            action_json().replace("0.0.5001", "alice")
        );
        assert_eq!(err_kind(&create_pending_approval(&input)), "InvalidAction");
        let bad_tier = input.replace("\"human\"", "\"god\"");
        assert_eq!(
            err_kind(&create_pending_approval(&bad_tier)),
            "InvalidInput"
        );
    }

    #[test]
    fn acr_claims_and_defaults() {
        assert_eq!(ok_value(&acr_claims("fresh", "")), Value::Null);
        assert_eq!(
            ok_value(&acr_claims("strong", "")),
            json!(
                r#"{"id_token":{"acr":{"essential":true,"values":["https://world.org/oidc/acr/orb-face"]}}}"#
            )
        );
        assert_eq!(err_kind(&acr_claims("god", "")), "InvalidInput");
    }

    #[test]
    fn link_analysis_through_the_json_api() {
        let report = ok_value(&analyze_link(r#"{"url":"https://hdfcbamk.com/pay"}"#, ""));
        assert_eq!(report.get("level"), Some(&json!("high")));
        let clean = ok_value(&analyze_link(r#"{"url":"https://www.hdfcbank.com/"}"#, ""));
        assert_eq!(clean.get("level"), Some(&json!("low")));
        assert_eq!(err_kind(&analyze_link("nope", "")), "InvalidInput");

        let cfg = ok_value(&default_link_config());
        assert!(
            cfg.get("brands")
                .and_then(Value::as_array)
                .is_some_and(|b| !b.is_empty())
        );
        let custom = r#"{"brands":[],"suspiciousTlds":[],"shorteners":[]}"#;
        let no_brands = ok_value(&analyze_link(r#"{"url":"https://hdfcbamk.com/"}"#, custom));
        assert_eq!(
            no_brands.get("level"),
            Some(&json!("low")),
            "custom config replaces defaults"
        );
    }

    #[test]
    fn every_entry_point_survives_garbage() {
        for junk in [
            "",
            "null",
            "[]",
            "\"x\"",
            "{",
            "{\"a\":1}",
            "\u{0}",
            "9".repeat(10_000).as_str(),
        ] {
            for out in [
                decide(junk, junk),
                parse_policy_config(junk),
                canonical_json(junk),
                hash_canonical(junk),
                hash_action(junk),
                create_pending_approval(junk),
                validate_approval(junk, junk, junk, junk),
                status_after_validation(junk),
                status_after_authorization_error(junk),
                consume_approval(junk, 0),
                acr_claims(junk, junk),
                analyze_link(junk, junk),
            ] {
                let v: Value = val(&out);
                assert!(v.get("ok").is_some(), "not an envelope for {junk:?}: {out}");
            }
        }
    }
}
