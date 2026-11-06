//! World ID Agent Pass assurance classes (`acr`) and the tiers the policy asks
//! for. Mirrors `src/core/assurance.ts`.

use serde::{Deserialize, Serialize};

pub const ACR_ORB: &str = "https://world.org/oidc/acr/orb";
pub const ACR_SELFIE: &str = "https://world.org/oidc/acr/selfie";
pub const ACR_ORB_FACE: &str = "https://world.org/oidc/acr/orb-face";
pub const ACR_SELFIE_FACE: &str = "https://world.org/oidc/acr/selfie-face";

/// Ordered weakest to strongest; the derived `Ord` is the strictness order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssuranceTier {
    Fresh,
    Human,
    Strong,
}

/// Accepted `acr` values per tier. `None` means "any fresh authentication".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcrRequirements {
    pub fresh: Option<Vec<String>>,
    pub human: Option<Vec<String>>,
    pub strong: Option<Vec<String>>,
}

impl Default for AcrRequirements {
    fn default() -> Self {
        Self {
            fresh: None,
            human: Some(vec![
                ACR_SELFIE.into(),
                ACR_SELFIE_FACE.into(),
                ACR_ORB.into(),
                ACR_ORB_FACE.into(),
            ]),
            strong: Some(vec![ACR_ORB_FACE.into()]),
        }
    }
}

impl AcrRequirements {
    pub fn for_tier(&self, tier: AssuranceTier) -> Option<&Vec<String>> {
        match tier {
            AssuranceTier::Fresh => self.fresh.as_ref(),
            AssuranceTier::Human => self.human.as_ref(),
            AssuranceTier::Strong => self.strong.as_ref(),
        }
    }
}

pub fn stronger_tier(a: AssuranceTier, b: AssuranceTier) -> AssuranceTier {
    a.max(b)
}

/// The OIDC `claims` request parameter for a tier, or `None` when the tier
/// places no constraint on `acr`.
pub fn acr_claims_param(tier: AssuranceTier, reqs: &AcrRequirements) -> Option<String> {
    let values = reqs.for_tier(tier)?;
    let claims =
        serde_json::json!({ "id_token": { "acr": { "essential": true, "values": values } } });
    serde_json::to_string(&claims).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiers_are_ordered() {
        assert!(AssuranceTier::Fresh < AssuranceTier::Human);
        assert!(AssuranceTier::Human < AssuranceTier::Strong);
        assert_eq!(
            stronger_tier(AssuranceTier::Fresh, AssuranceTier::Strong),
            AssuranceTier::Strong
        );
        assert_eq!(
            stronger_tier(AssuranceTier::Human, AssuranceTier::Fresh),
            AssuranceTier::Human
        );
    }

    #[test]
    fn claims_param_per_tier() {
        let reqs = AcrRequirements::default();
        assert_eq!(acr_claims_param(AssuranceTier::Fresh, &reqs), None);
        assert_eq!(
            acr_claims_param(AssuranceTier::Strong, &reqs).as_deref(),
            Some(
                r#"{"id_token":{"acr":{"essential":true,"values":["https://world.org/oidc/acr/orb-face"]}}}"#
            )
        );
    }

    #[test]
    fn every_strong_acr_also_satisfies_human() {
        let reqs = AcrRequirements::default();
        let human = reqs
            .for_tier(AssuranceTier::Human)
            .cloned()
            .unwrap_or_default();
        for acr in reqs
            .for_tier(AssuranceTier::Strong)
            .cloned()
            .unwrap_or_default()
        {
            assert!(human.contains(&acr));
        }
    }

    #[test]
    fn tier_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&AssuranceTier::Strong).unwrap_or_default(),
            "\"strong\""
        );
    }
}
