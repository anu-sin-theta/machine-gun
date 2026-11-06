//! Property tests for the policy engine. Same invariants as the TypeScript
//! suite in tests/unit/core/policy.test.ts.

use std::collections::BTreeMap;

use kavach_core::money::{hbar, tinybars};
use kavach_core::policy::{
    AssetLimits, Decision, PaymentContext, PolicyConfig, RiskLevel, RiskVerdict, decide,
};
use proptest::prelude::*;

fn policy() -> PolicyConfig {
    let mut limits = BTreeMap::new();
    limits.insert(
        "HBAR".to_string(),
        AssetLimits {
            auto_cap: hbar(2).units,
            hard_cap: hbar(50).units,
            daily_auto_budget: hbar(5).units,
        },
    );
    PolicyConfig { limits }
}

fn level() -> impl Strategy<Value = RiskLevel> {
    prop_oneof![
        Just(RiskLevel::Low),
        Just(RiskLevel::Medium),
        Just(RiskLevel::High)
    ]
}

fn units() -> impl Strategy<Value = i128> {
    1i128..=hbar(60).units
}

fn spent() -> impl Strategy<Value = i128> {
    0i128..=hbar(10).units
}

fn run(units: i128, level: RiskLevel, spent: i128) -> Decision {
    let ctx = PaymentContext {
        amount: tinybars(units),
        verdict: Some(RiskVerdict {
            level,
            reasons: vec![],
        }),
        auto_spent_today: spent,
    };
    decide(&ctx, &policy()).unwrap_or(Decision::Block { reasons: vec![] })
}

proptest! {
    #[test]
    fn only_low_risk_is_ever_auto_paid(u in units(), l in level(), s in spent()) {
        if matches!(run(u, l, s), Decision::AutoPay { .. }) {
            prop_assert_eq!(l, RiskLevel::Low);
        }
    }

    #[test]
    fn never_auto_pays_past_the_auto_cap_or_daily_budget(u in units(), s in spent()) {
        if matches!(run(u, RiskLevel::Low, s), Decision::AutoPay { .. }) {
            prop_assert!(u <= hbar(2).units);
            prop_assert!(s + u <= hbar(5).units);
        }
    }

    #[test]
    fn raising_risk_never_relaxes_the_decision(u in units(), s in spent()) {
        let low = run(u, RiskLevel::Low, s).strictness();
        let med = run(u, RiskLevel::Medium, s).strictness();
        let high = run(u, RiskLevel::High, s).strictness();
        prop_assert!(low <= med && med <= high);
    }

    #[test]
    fn raising_the_amount_never_relaxes_the_decision(a in units(), b in units(), l in level(), s in spent()) {
        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
        prop_assert!(run(lo, l, s).strictness() <= run(hi, l, s).strictness());
    }

    #[test]
    fn spending_more_today_never_relaxes_the_decision(u in units(), l in level(), s1 in spent(), s2 in spent()) {
        let (lo, hi) = if s1 <= s2 { (s1, s2) } else { (s2, s1) };
        prop_assert!(run(u, l, lo).strictness() <= run(u, l, hi).strictness());
    }

    #[test]
    fn decide_never_panics_on_extreme_amounts(u in any::<i128>(), s in 0i128..=i128::MAX, l in level()) {
        let _ = run(u, l, s);
    }
}
