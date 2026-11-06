//! Property tests for link intel: it must never panic on hostile input.

use kavach_core::linkintel::{LinkInput, LinkIntelConfig, SignalCode, analyze};
use kavach_core::policy::RiskLevel;
use proptest::prelude::*;

proptest! {
    #[test]
    fn never_panics_on_arbitrary_strings(url in ".*", hop in ".*", age in proptest::option::of(any::<u32>())) {
        let input = LinkInput { url, redirect_chain: vec![hop], domain_age_days: age };
        let r = analyze(&input, &LinkIntelConfig::default());
        prop_assert!(r.score <= 100);
    }

    #[test]
    fn never_panics_on_urlish_strings(
        scheme in prop_oneof![Just("http"), Just("https"), Just("ftp"), Just("javascript")],
        host in "[a-zA-Z0-9.\\-_@:\\[\\]%\u{0080}-\u{FFFF}]{0,60}",
        path in "[a-zA-Z0-9/?=&#%._\\-]{0,30}",
    ) {
        let input = LinkInput { url: format!("{scheme}://{host}/{path}"), ..LinkInput::default() };
        let r = analyze(&input, &LinkIntelConfig::default());
        prop_assert!(r.score <= 100);
    }

    #[test]
    fn analysis_is_deterministic_and_sorted(url in ".*") {
        let input = LinkInput { url, ..LinkInput::default() };
        let cfg = LinkIntelConfig::default();
        let a = analyze(&input, &cfg);
        prop_assert_eq!(&a, &analyze(&input, &cfg));
        let severities: Vec<_> = a.signals.iter().map(|s| s.severity).collect();
        prop_assert!(severities.is_sorted_by(|x, y| x >= y));
    }

    #[test]
    fn a_high_signal_always_means_high_risk(url in ".*") {
        let r = analyze(&LinkInput { url, ..LinkInput::default() }, &LinkIntelConfig::default());
        if r.signals.iter().any(|s| s.severity == kavach_core::linkintel::Severity::High) {
            prop_assert_eq!(r.level, RiskLevel::High);
        }
    }

    #[test]
    fn real_brand_domains_never_trigger_impersonation(
        sub in "[a-z]{0,8}",
        path in "[a-z0-9/]{0,20}",
    ) {
        let cfg = LinkIntelConfig::default();
        for brand in &cfg.brands {
            for domain in &brand.domains {
                let host = if sub.is_empty() { domain.clone() } else { format!("{sub}.{domain}") };
                let r = analyze(&LinkInput { url: format!("https://{host}/{path}"), ..LinkInput::default() }, &cfg);
                prop_assert!(
                    !r.signals.iter().any(|s| matches!(s.code, SignalCode::BrandImpersonation | SignalCode::LookalikeBrand)),
                    "{host}: {:?}", r.signals
                );
            }
        }
    }
}
