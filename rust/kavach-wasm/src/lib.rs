//! WASM surface for the TypeScript app. Every export is string-in, string-out
//! and returns the JSON envelope defined in `kavach_core::api`; nothing here
//! throws across the boundary.

use kavach_core::api;
use wasm_bindgen::prelude::wasm_bindgen;

/// Crate version, to confirm which build is loaded.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn decide(ctx_json: &str, config_json: &str) -> String {
    api::decide(ctx_json, config_json)
}

#[wasm_bindgen(js_name = parsePolicyConfig)]
pub fn parse_policy_config(config_json: &str) -> String {
    api::parse_policy_config(config_json)
}

#[wasm_bindgen(js_name = canonicalJson)]
pub fn canonical_json(value_json: &str) -> String {
    api::canonical_json(value_json)
}

#[wasm_bindgen(js_name = hashCanonical)]
pub fn hash_canonical(value_json: &str) -> String {
    api::hash_canonical(value_json)
}

#[wasm_bindgen(js_name = hashAction)]
pub fn hash_action(action_json: &str) -> String {
    api::hash_action(action_json)
}

#[wasm_bindgen(js_name = createPendingApproval)]
pub fn create_pending_approval(input_json: &str) -> String {
    api::create_pending_approval(input_json)
}

#[wasm_bindgen(js_name = validateApproval)]
pub fn validate_approval(
    pending_json: &str,
    result_json: &str,
    current_action_json: &str,
    opts_json: &str,
) -> String {
    api::validate_approval(pending_json, result_json, current_action_json, opts_json)
}

#[wasm_bindgen(js_name = statusAfterValidation)]
pub fn status_after_validation(check_json: &str) -> String {
    api::status_after_validation(check_json)
}

#[wasm_bindgen(js_name = statusAfterAuthorizationError)]
pub fn status_after_authorization_error(error: &str) -> String {
    api::status_after_authorization_error(error)
}

/// `now` is epoch milliseconds, passed as f64 because JS numbers are doubles.
#[wasm_bindgen(js_name = consumeApproval)]
pub fn consume_approval(pending_json: &str, now: f64) -> String {
    // Epoch ms is far below 2^53, so the cast is exact for any real clock value.
    api::consume_approval(pending_json, now as i64)
}

#[wasm_bindgen(js_name = acrClaims)]
pub fn acr_claims(tier: &str, reqs_json: &str) -> String {
    api::acr_claims(tier, reqs_json)
}

#[wasm_bindgen(js_name = analyzeLink)]
pub fn analyze_link(input_json: &str, config_json: &str) -> String {
    api::analyze_link(input_json, config_json)
}

#[wasm_bindgen(js_name = defaultLinkConfig)]
pub fn default_link_config() -> String {
    api::default_link_config()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_delegate_to_the_core_api() {
        assert_eq!(version(), env!("CARGO_PKG_VERSION"));
        assert_eq!(
            hash_canonical(r#"{"a":1}"#),
            api::hash_canonical(r#"{"a":1}"#)
        );
        assert!(
            analyze_link(r#"{"url":"https://hdfcbamk.com/"}"#, "").contains(r#""level":"high""#)
        );
        assert!(consume_approval("{}", 0.0).contains(r#""ok":false"#));
    }
}
