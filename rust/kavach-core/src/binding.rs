//! Binds a World ID Agent Pass step-up to one exact payment. Mirrors
//! `src/core/binding.ts`.
//!
//! World's OIDC has no `authorization_details`, so the action is stored
//! server-side keyed to the attempt's `state`/`nonce` and re-checked on the
//! callback. Any drift (amount, payee, verdict, version) voids the approval.
//!
//! Pure: randomness (state, nonce) and time are passed in.

use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::assurance::{AcrRequirements, AssuranceTier};
use crate::canonical::hash_canonical;
use crate::error::{Error, Result};
use crate::money::{Amount, is_hedera_entity_id};

const MIN_RANDOM_LENGTH: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundAction {
    pub check_id: String,
    /// Hedera account that receives the payment (x402 `payTo`).
    pub payee: String,
    /// x402 resource URL being paid for.
    pub resource: String,
    pub amount: Amount,
    /// sha256 hex of the canonical verdict shown to the user.
    pub verdict_hash: String,
    /// Bumped whenever the action is edited; any edit requires new approval.
    pub version: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
    Expired,
    Rejected,
    Consumed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubjectBinding {
    pub iss: String,
    pub sub: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub attempt_id: String,
    pub state: String,
    pub nonce: String,
    pub action: BoundAction,
    pub action_hash: String,
    pub tier: AssuranceTier,
    /// Exact acr values accepted, or `None` for "any fresh auth".
    pub required_acr: Option<Vec<String>>,
    /// Epoch ms when the attempt started (lower bound for `auth_time`).
    pub created_at: i64,
    /// Epoch ms after which the attempt can no longer be approved.
    pub expires_at: i64,
    /// If the account is already linked to a World ID, the callback must match it.
    pub subject_binding: Option<SubjectBinding>,
    pub status: ApprovalStatus,
}

/// Validated claims from the ID token, as returned by the OIDC adapter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResult {
    pub iss: String,
    pub sub: String,
    pub nonce: String,
    /// OIDC `auth_time`, epoch seconds. JSON `null` (what `JSON.stringify`
    /// emits for NaN/Infinity) is read as NaN, which fails closed as `StaleAuth`.
    #[serde(deserialize_with = "nan_if_null")]
    pub auth_time: f64,
    pub acr: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalFailure {
    NotPending,
    Expired,
    IssuerMismatch,
    NonceMismatch,
    SubjectMismatch,
    StaleAuth,
    AuthTimeInFuture,
    InsufficientAssurance,
    ActionChanged,
}

fn nan_if_null<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<f64, D::Error> {
    Ok(Option::<f64>::deserialize(d)?.unwrap_or(f64::NAN))
}

pub fn hash_action(action: &BoundAction) -> Result<String> {
    hash_canonical(action)
}

pub fn assert_valid_action(action: &BoundAction) -> Result<()> {
    let bad = |m: &str| Err(Error::InvalidAction(m.to_string()));
    if action.check_id.is_empty() {
        return bad("checkId is required");
    }
    if !is_hedera_entity_id(&action.payee) {
        return bad("payee must be a Hedera account id");
    }
    if !(action.resource.starts_with("http://") || action.resource.starts_with("https://")) {
        return bad("resource must be an http(s) URL");
    }
    if action.amount.units <= 0 {
        return bad("amount must be > 0");
    }
    let v = &action.verdict_hash;
    if v.len() != 64 || !v.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return bad("verdictHash must be lowercase sha256 hex");
    }
    if action.version < 1 {
        return bad("version must be a positive integer");
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct CreatePendingInput {
    pub attempt_id: String,
    pub state: String,
    pub nonce: String,
    pub action: BoundAction,
    pub tier: AssuranceTier,
    pub now: i64,
    pub ttl_ms: i64,
    pub subject_binding: Option<SubjectBinding>,
    pub acr_requirements: AcrRequirements,
}

pub fn create_pending_approval(input: CreatePendingInput) -> Result<PendingApproval> {
    assert_valid_action(&input.action)?;
    if input.state.chars().count() < MIN_RANDOM_LENGTH
        || input.nonce.chars().count() < MIN_RANDOM_LENGTH
    {
        return Err(Error::InvalidInput(format!(
            "state and nonce must be at least {MIN_RANDOM_LENGTH} chars"
        )));
    }
    if input.state == input.nonce {
        return Err(Error::InvalidInput("state and nonce must differ".into()));
    }
    if input.ttl_ms <= 0 {
        return Err(Error::InvalidInput("ttlMs must be > 0".into()));
    }
    let expires_at = input
        .now
        .checked_add(input.ttl_ms)
        .ok_or_else(|| Error::InvalidInput("now + ttlMs overflows".into()))?;
    Ok(PendingApproval {
        attempt_id: input.attempt_id,
        state: input.state,
        nonce: input.nonce,
        action_hash: hash_action(&input.action)?,
        action: input.action,
        tier: input.tier,
        required_acr: input.acr_requirements.for_tier(input.tier).cloned(),
        created_at: input.now,
        expires_at,
        subject_binding: input.subject_binding,
        status: ApprovalStatus::Pending,
    })
}

#[derive(Clone, Debug)]
pub struct ValidateOptions {
    pub expected_issuer: String,
    pub now: i64,
    /// Allowed clock skew in seconds for `auth_time` checks. Keep small.
    pub clock_tolerance_sec: i64,
}

impl ValidateOptions {
    pub fn new(expected_issuer: impl Into<String>, now: i64) -> Self {
        Self {
            expected_issuer: expected_issuer.into(),
            now,
            clock_tolerance_sec: 5,
        }
    }
}

/// Re-checks everything at the moment of execution. `current_action` is the
/// action as it stands now (re-read from storage), not the stored copy.
/// Checks run in a fixed order; the first failure wins.
pub fn validate_approval(
    pending: &PendingApproval,
    result: &AuthResult,
    current_action: &BoundAction,
    opts: &ValidateOptions,
) -> std::result::Result<(), ApprovalFailure> {
    use ApprovalFailure as F;
    let tolerance_ms = opts.clock_tolerance_sec.saturating_mul(1000) as f64;

    if pending.status != ApprovalStatus::Pending {
        return Err(F::NotPending);
    }
    if opts.now > pending.expires_at {
        return Err(F::Expired);
    }
    if result.iss != opts.expected_issuer {
        return Err(F::IssuerMismatch);
    }
    if !safe_equal(&result.nonce, &pending.nonce) {
        return Err(F::NonceMismatch);
    }
    if let Some(bound) = &pending.subject_binding
        && (bound.iss != result.iss || bound.sub != result.sub)
    {
        return Err(F::SubjectMismatch);
    }

    if !result.auth_time.is_finite() {
        return Err(F::StaleAuth);
    }
    let auth_ms = result.auth_time * 1000.0;
    // max_age=0 semantics: the auth must belong to this attempt, not an older session.
    if auth_ms < pending.created_at as f64 - tolerance_ms {
        return Err(F::StaleAuth);
    }
    if auth_ms > opts.now as f64 + tolerance_ms {
        return Err(F::AuthTimeInFuture);
    }

    if let Some(required) = &pending.required_acr {
        match &result.acr {
            Some(acr) if required.iter().any(|r| r == acr) => {}
            _ => return Err(F::InsufficientAssurance),
        }
    }

    // A hashing failure means we can't prove the action is unchanged: block.
    match hash_action(current_action) {
        Ok(h) if h == pending.action_hash => Ok(()),
        _ => Err(F::ActionChanged),
    }
}

/// Status after a callback was validated.
pub fn status_after_validation(check: &std::result::Result<(), ApprovalFailure>) -> ApprovalStatus {
    match check {
        Ok(()) => ApprovalStatus::Approved,
        Err(ApprovalFailure::Expired) => ApprovalStatus::Expired,
        Err(_) => ApprovalStatus::Rejected,
    }
}

/// Status when the IdP returned an error (user denied or cancelled).
pub fn status_after_authorization_error(error: &str) -> ApprovalStatus {
    if error == "access_denied" {
        ApprovalStatus::Denied
    } else {
        ApprovalStatus::Rejected
    }
}

/// `approved` -> `consumed`, exactly once. Errors otherwise so a replayed
/// approval can never trigger a second payment.
pub fn consume_approval(pending: &PendingApproval, now: i64) -> Result<PendingApproval> {
    if pending.status != ApprovalStatus::Approved {
        return Err(Error::IllegalTransition(format!(
            "cannot consume approval in status {:?}",
            pending.status
        )));
    }
    if now > pending.expires_at {
        return Err(Error::IllegalTransition(
            "cannot consume an expired approval".into(),
        ));
    }
    let mut next = pending.clone();
    next.status = ApprovalStatus::Consumed;
    Ok(next)
}

fn safe_equal(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assurance::{ACR_ORB, ACR_ORB_FACE, ACR_SELFIE};
    use crate::canonical::sha256_hex;
    use crate::money::{hbar, tinybars};
    use ApprovalFailure as F;

    const HOUR: i64 = 3_600_000;
    const T0: i64 = 1_793_966_400_000; // 2026-11-06T12:00:00Z
    const TTL: i64 = 600_000;
    const NOW: i64 = T0 + 60_000;
    const ISSUER: &str = "https://auth.world.org";
    const STATE: &str = "state_aaaaaaaaaaaaaaaa";
    const NONCE: &str = "nonce_bbbbbbbbbbbbbbbb";
    /// Produced by the TypeScript `hashAction(demoAction())`.
    const TS_GOLDEN_ACTION_HASH: &str =
        "062b70655d1cf5c4f7e280a422f1c3b23f49120ce5a8a5496ceaaa15adaa700d";

    fn action() -> BoundAction {
        BoundAction {
            check_id: "chk_01".into(),
            payee: "0.0.5001".into(),
            resource: "https://kavach.test/api/x402/merchant/electricity".into(),
            amount: hbar(12),
            verdict_hash: sha256_hex(b"verdict-v1"),
            version: 1,
        }
    }

    fn input(tier: AssuranceTier) -> CreatePendingInput {
        CreatePendingInput {
            attempt_id: "att_01".into(),
            state: STATE.into(),
            nonce: NONCE.into(),
            action: action(),
            tier,
            now: T0,
            ttl_ms: TTL,
            subject_binding: None,
            acr_requirements: AcrRequirements::default(),
        }
    }

    fn pending(tier: AssuranceTier) -> PendingApproval {
        create_pending_approval(input(tier)).unwrap_or_else(|e| unreachable_pending(&e.to_string()))
    }

    // Tests never use unwrap/expect (denied by lint); build a poisoned value instead.
    fn unreachable_pending(msg: &str) -> PendingApproval {
        PendingApproval {
            attempt_id: msg.into(),
            state: String::new(),
            nonce: String::new(),
            action: action(),
            action_hash: String::new(),
            tier: AssuranceTier::Strong,
            required_acr: None,
            created_at: 0,
            expires_at: 0,
            subject_binding: None,
            status: ApprovalStatus::Rejected,
        }
    }

    fn auth() -> AuthResult {
        AuthResult {
            iss: ISSUER.into(),
            sub: "pairwise_sub_1".into(),
            nonce: NONCE.into(),
            auth_time: ((T0 + 30_000) / 1000) as f64,
            acr: Some(ACR_ORB.into()),
        }
    }

    fn opts() -> ValidateOptions {
        ValidateOptions::new(ISSUER, NOW)
    }

    fn check(
        p: &PendingApproval,
        a: &AuthResult,
        act: &BoundAction,
        o: &ValidateOptions,
    ) -> std::result::Result<(), F> {
        validate_approval(p, a, act, o)
    }

    #[test]
    fn action_hash_matches_the_typescript_implementation() {
        assert_eq!(
            hash_action(&action()).unwrap_or_default(),
            TS_GOLDEN_ACTION_HASH
        );
    }

    #[test]
    fn creates_with_hash_acr_set_and_expiry() {
        let p = pending(AssuranceTier::Strong);
        assert_eq!(p.status, ApprovalStatus::Pending);
        assert_eq!(p.action_hash, TS_GOLDEN_ACTION_HASH);
        assert_eq!(p.required_acr, Some(vec![ACR_ORB_FACE.to_string()]));
        assert_eq!(p.expires_at, T0 + TTL);
        assert_eq!(pending(AssuranceTier::Fresh).required_acr, None);
    }

    #[test]
    fn rejects_bad_inputs() {
        type Mutation = Box<dyn Fn(&mut CreatePendingInput)>;
        let cases: Vec<(&str, Mutation)> = vec![
            ("short state", Box::new(|i| i.state = "short".into())),
            ("short nonce", Box::new(|i| i.nonce = "short".into())),
            ("state equals nonce", Box::new(|i| i.state = NONCE.into())),
            ("zero ttl", Box::new(|i| i.ttl_ms = 0)),
            ("ttl overflow", Box::new(|i| i.ttl_ms = i64::MAX)),
            ("bad payee", Box::new(|i| i.action.payee = "alice".into())),
            (
                "non-http resource",
                Box::new(|i| i.action.resource = "ftp://x".into()),
            ),
            ("zero amount", Box::new(|i| i.action.amount = tinybars(0))),
            (
                "bad verdict hash",
                Box::new(|i| i.action.verdict_hash = "abc".into()),
            ),
            (
                "uppercase verdict hash",
                Box::new(|i| i.action.verdict_hash = "A".repeat(64)),
            ),
            ("version 0", Box::new(|i| i.action.version = 0)),
            ("empty check id", Box::new(|i| i.action.check_id.clear())),
        ];
        for (name, mutate) in cases {
            let mut i = input(AssuranceTier::Human);
            mutate(&mut i);
            assert!(
                create_pending_approval(i).is_err(),
                "{name} should be rejected"
            );
        }
    }

    #[test]
    fn happy_paths() {
        assert_eq!(
            check(&pending(AssuranceTier::Human), &auth(), &action(), &opts()),
            Ok(())
        );
        let mut a = auth();
        a.acr = None;
        assert_eq!(
            check(&pending(AssuranceTier::Fresh), &a, &action(), &opts()),
            Ok(()),
            "fresh accepts any acr"
        );
        let mut i = input(AssuranceTier::Human);
        i.subject_binding = Some(SubjectBinding {
            iss: ISSUER.into(),
            sub: "pairwise_sub_1".into(),
        });
        assert_eq!(
            check(
                &create_pending_approval(i).unwrap_or_else(|e| unreachable_pending(&e.to_string())),
                &auth(),
                &action(),
                &opts()
            ),
            Ok(())
        );
    }

    #[test]
    fn every_failure_path_blocks() {
        let strong = pending(AssuranceTier::Strong);
        let human = pending(AssuranceTier::Human);
        let mut bound = input(AssuranceTier::Human);
        bound.subject_binding = Some(SubjectBinding {
            iss: ISSUER.into(),
            sub: "pairwise_sub_1".into(),
        });
        let bound =
            create_pending_approval(bound).unwrap_or_else(|e| unreachable_pending(&e.to_string()));

        let with = |f: &dyn Fn(&mut AuthResult)| {
            let mut a = auth();
            f(&mut a);
            a
        };
        let act_with = |f: &dyn Fn(&mut BoundAction)| {
            let mut a = action();
            f(&mut a);
            a
        };
        let mut consumed = human.clone();
        consumed.status = ApprovalStatus::Consumed;
        let mut denied = human.clone();
        denied.status = ApprovalStatus::Denied;
        let late = ValidateOptions::new(ISSUER, T0 + TTL + 1);

        assert_eq!(
            check(&consumed, &auth(), &action(), &opts()),
            Err(F::NotPending)
        );
        assert_eq!(
            check(&denied, &auth(), &action(), &opts()),
            Err(F::NotPending)
        );
        assert_eq!(check(&human, &auth(), &action(), &late), Err(F::Expired));
        assert_eq!(
            check(
                &human,
                &with(&|a| a.iss = "https://evil.example".into()),
                &action(),
                &opts()
            ),
            Err(F::IssuerMismatch)
        );
        assert_eq!(
            check(
                &human,
                &with(&|a| a.nonce = "nonce_cccccccccccccccc".into()),
                &action(),
                &opts()
            ),
            Err(F::NonceMismatch)
        );
        assert_eq!(
            check(&human, &with(&|a| a.nonce = "x".into()), &action(), &opts()),
            Err(F::NonceMismatch)
        );
        assert_eq!(
            check(
                &bound,
                &with(&|a| a.sub = "pairwise_sub_2".into()),
                &action(),
                &opts()
            ),
            Err(F::SubjectMismatch)
        );
        assert_eq!(
            check(
                &human,
                &with(&|a| a.auth_time = ((T0 - HOUR) / 1000) as f64),
                &action(),
                &opts()
            ),
            Err(F::StaleAuth)
        );
        assert_eq!(
            check(
                &human,
                &with(&|a| a.auth_time = f64::NAN),
                &action(),
                &opts()
            ),
            Err(F::StaleAuth)
        );
        assert_eq!(
            check(
                &human,
                &with(&|a| a.auth_time = f64::INFINITY),
                &action(),
                &opts()
            ),
            Err(F::StaleAuth)
        );
        assert_eq!(
            check(
                &human,
                &with(&|a| a.auth_time = ((NOW + HOUR) / 1000) as f64),
                &action(),
                &opts()
            ),
            Err(F::AuthTimeInFuture)
        );
        assert_eq!(
            check(&human, &with(&|a| a.acr = None), &action(), &opts()),
            Err(F::InsufficientAssurance)
        );
        assert_eq!(
            check(
                &strong,
                &with(&|a| a.acr = Some(ACR_SELFIE.into())),
                &action(),
                &opts()
            ),
            Err(F::InsufficientAssurance)
        );
        assert_eq!(
            check(
                &strong,
                &with(&|a| a.acr = Some(format!("{ACR_ORB_FACE}x"))),
                &action(),
                &opts()
            ),
            Err(F::InsufficientAssurance)
        );
        assert_eq!(
            check(
                &human,
                &auth(),
                &act_with(&|a| a.amount = hbar(13)),
                &opts()
            ),
            Err(F::ActionChanged)
        );
        assert_eq!(
            check(
                &human,
                &auth(),
                &act_with(&|a| a.payee = "0.0.6666".into()),
                &opts()
            ),
            Err(F::ActionChanged)
        );
        assert_eq!(
            check(
                &human,
                &auth(),
                &act_with(&|a| a.verdict_hash = sha256_hex(b"verdict-v2")),
                &opts()
            ),
            Err(F::ActionChanged)
        );
        assert_eq!(
            check(&human, &auth(), &act_with(&|a| a.version = 2), &opts()),
            Err(F::ActionChanged)
        );
    }

    #[test]
    fn tolerates_small_clock_skew_only() {
        let mut a = auth();
        a.auth_time = ((T0 - 3_000) / 1000) as f64;
        assert_eq!(
            check(&pending(AssuranceTier::Human), &a, &action(), &opts()),
            Ok(())
        );
        a.auth_time = ((T0 - 10_000) / 1000) as f64;
        assert_eq!(
            check(&pending(AssuranceTier::Human), &a, &action(), &opts()),
            Err(F::StaleAuth)
        );
    }

    #[test]
    fn status_transitions() {
        assert_eq!(status_after_validation(&Ok(())), ApprovalStatus::Approved);
        assert_eq!(
            status_after_validation(&Err(F::Expired)),
            ApprovalStatus::Expired
        );
        assert_eq!(
            status_after_validation(&Err(F::ActionChanged)),
            ApprovalStatus::Rejected
        );
        assert_eq!(
            status_after_authorization_error("access_denied"),
            ApprovalStatus::Denied
        );
        assert_eq!(
            status_after_authorization_error("unmet_authentication_requirements"),
            ApprovalStatus::Rejected
        );
        assert_eq!(
            status_after_authorization_error("login_required"),
            ApprovalStatus::Rejected
        );
    }

    #[test]
    fn consumes_an_approval_exactly_once() {
        let mut approved = pending(AssuranceTier::Human);
        approved.status = ApprovalStatus::Approved;
        let consumed = consume_approval(&approved, NOW)
            .unwrap_or_else(|e| unreachable_pending(&e.to_string()));
        assert_eq!(consumed.status, ApprovalStatus::Consumed);
        assert!(
            consume_approval(&consumed, NOW).is_err(),
            "second consume must fail"
        );
        assert!(consume_approval(&pending(AssuranceTier::Human), NOW).is_err());
        let mut denied = pending(AssuranceTier::Human);
        denied.status = ApprovalStatus::Denied;
        assert!(consume_approval(&denied, NOW).is_err());
        assert!(
            consume_approval(&approved, T0 + TTL + 1).is_err(),
            "expired approvals can't be consumed"
        );
    }

    #[test]
    fn json_shape_is_camel_case_like_typescript() {
        let json = serde_json::to_value(pending(AssuranceTier::Human)).unwrap_or_default();
        for key in [
            "attemptId",
            "actionHash",
            "requiredAcr",
            "createdAt",
            "expiresAt",
            "subjectBinding",
            "status",
        ] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
        assert_eq!(json.pointer("/status"), Some(&serde_json::json!("pending")));
        assert_eq!(
            json.pointer("/action/amount/units"),
            Some(&serde_json::json!("1200000000"))
        );
    }
}
