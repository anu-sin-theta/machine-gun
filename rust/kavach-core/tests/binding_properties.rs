//! Property tests for approval binding.

use kavach_core::assurance::{ACR_ORB_FACE, AcrRequirements, AssuranceTier};
use kavach_core::binding::*;
use kavach_core::canonical::sha256_hex;
use kavach_core::money::{hbar, tinybars};
use proptest::prelude::*;

const T0: i64 = 1_793_966_400_000;
const ISSUER: &str = "https://auth.world.org";
const NONCE: &str = "nonce_bbbbbbbbbbbbbbbb";

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

fn pending(tier: AssuranceTier) -> Option<PendingApproval> {
    create_pending_approval(CreatePendingInput {
        attempt_id: "att_01".into(),
        state: "state_aaaaaaaaaaaaaaaa".into(),
        nonce: NONCE.into(),
        action: action(),
        tier,
        now: T0,
        ttl_ms: 600_000,
        subject_binding: None,
        acr_requirements: AcrRequirements::default(),
    })
    .ok()
}

fn auth(acr: Option<String>) -> AuthResult {
    AuthResult {
        iss: ISSUER.into(),
        sub: "sub".into(),
        nonce: NONCE.into(),
        auth_time: ((T0 + 30_000) / 1000) as f64,
        acr,
    }
}

proptest! {
    #[test]
    fn any_change_to_the_amount_voids_the_approval(units in 1i128..10i128.pow(12)) {
        prop_assume!(units != hbar(12).units);
        let Some(p) = pending(AssuranceTier::Human) else { return Err(TestCaseError::fail("setup")); };
        let mut changed = action();
        changed.amount = tinybars(units);
        let opts = ValidateOptions::new(ISSUER, T0 + 60_000);
        prop_assert_eq!(
            validate_approval(&p, &auth(Some(ACR_ORB_FACE.into())), &changed, &opts),
            Err(ApprovalFailure::ActionChanged)
        );
    }

    #[test]
    fn only_the_exact_required_acr_passes_the_strong_tier(acr in ".*") {
        let Some(p) = pending(AssuranceTier::Strong) else { return Err(TestCaseError::fail("setup")); };
        let opts = ValidateOptions::new(ISSUER, T0 + 60_000);
        let ok = validate_approval(&p, &auth(Some(acr.clone())), &action(), &opts).is_ok();
        prop_assert_eq!(ok, acr == ACR_ORB_FACE);
    }

    #[test]
    fn a_wrong_nonce_never_validates(nonce in ".*") {
        prop_assume!(nonce != NONCE);
        let Some(p) = pending(AssuranceTier::Fresh) else { return Err(TestCaseError::fail("setup")); };
        let mut a = auth(None);
        a.nonce = nonce;
        let opts = ValidateOptions::new(ISSUER, T0 + 60_000);
        prop_assert_eq!(validate_approval(&p, &a, &action(), &opts), Err(ApprovalFailure::NonceMismatch));
    }

    #[test]
    fn validate_never_panics_on_arbitrary_auth_times(t in any::<f64>(), now in any::<i64>(), tol in any::<i64>()) {
        let Some(p) = pending(AssuranceTier::Fresh) else { return Err(TestCaseError::fail("setup")); };
        let mut a = auth(None);
        a.auth_time = t;
        let opts = ValidateOptions { expected_issuer: ISSUER.into(), now, clock_tolerance_sec: tol };
        let _ = validate_approval(&p, &a, &action(), &opts);
    }
}
