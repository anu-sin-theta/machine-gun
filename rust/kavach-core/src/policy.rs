//! Risk-adaptive payment policy. Pure: same input, same decision. Mirrors
//! `src/core/policy.ts`; see HOW_IT_WORKS.md for the rule table.
//!
//! Rules, first match wins:
//!  1. non-positive amount                  -> block (INVALID_AMOUNT)
//!  2. asset has no configured limits       -> block (ASSET_NOT_ALLOWED)
//!  3. amount above the asset's hard cap    -> block (OVER_HARD_CAP), no override
//!  4. missing or unknown verdict           -> treated as high risk (fail closed)
//!  5. high   -> step-up "strong", blocked unless the human overrides
//!  6. medium -> step-up "human"
//!  7. low    -> auto-pay, unless over the auto cap or the daily auto budget,
//!     in which case step-up "fresh"

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::assurance::AssuranceTier;
use crate::error::{Error, Result};
use crate::money::{Amount, asset_key, i128_string};

/// `Unknown` absorbs any level we don't recognise so untyped input fails
/// closed (treated as high) instead of failing to parse.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RiskVerdict {
    pub level: RiskLevel,
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DecisionReason {
    InvalidAmount,
    AssetNotAllowed,
    OverHardCap,
    VerdictMissing,
    RiskLow,
    RiskMedium,
    RiskHigh,
    OverAutoCap,
    OverDailyAutoBudget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Decision {
    AutoPay {
        reasons: Vec<DecisionReason>,
    },
    #[serde(rename_all = "camelCase")]
    StepUp {
        tier: AssuranceTier,
        /// True when the default outcome is "don't pay" and approval is an override.
        blocked_by_default: bool,
        reasons: Vec<DecisionReason>,
    },
    Block {
        reasons: Vec<DecisionReason>,
    },
}

impl Decision {
    /// How much human involvement this decision demands. Higher is stricter.
    /// Used for monotonicity checks: risk or amount going up never lowers it.
    pub fn strictness(&self) -> u8 {
        match self {
            Decision::AutoPay { .. } => 0,
            Decision::StepUp {
                tier,
                blocked_by_default,
                ..
            } => {
                1 + match tier {
                    AssuranceTier::Fresh => 0,
                    AssuranceTier::Human => 1,
                    AssuranceTier::Strong => 2,
                } + u8::from(*blocked_by_default)
            }
            Decision::Block { .. } => 10,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLimits {
    /// Largest single payment the agent may make without a human.
    #[serde(with = "i128_string")]
    pub auto_cap: i128,
    /// Largest payment allowed at all, even with approval.
    #[serde(with = "i128_string")]
    pub hard_cap: i128,
    /// Total the agent may auto-pay per day in this asset.
    #[serde(with = "i128_string")]
    pub daily_auto_budget: i128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyConfig {
    /// Keyed by `asset_key()`: `"HBAR"` or `"HTS:<tokenId>"`.
    pub limits: BTreeMap<String, AssetLimits>,
}

impl PolicyConfig {
    /// Validates invariants that deserialization alone can't express.
    pub fn validate(&self) -> Result<()> {
        for (key, l) in &self.limits {
            if key.is_empty() {
                return Err(Error::InvalidConfig("empty asset key".into()));
            }
            if l.auto_cap < 0 || l.hard_cap < 0 || l.daily_auto_budget < 0 {
                return Err(Error::InvalidConfig(format!("{key}: limits must be >= 0")));
            }
            if l.auto_cap > l.hard_cap {
                return Err(Error::InvalidConfig(format!(
                    "{key}: autoCap must be <= hardCap"
                )));
            }
            if l.auto_cap > l.daily_auto_budget {
                return Err(Error::InvalidConfig(format!(
                    "{key}: autoCap must be <= dailyAutoBudget"
                )));
            }
        }
        Ok(())
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let cfg: PolicyConfig =
            serde_json::from_str(json).map_err(|e| Error::InvalidConfig(e.to_string()))?;
        cfg.validate()?;
        Ok(cfg)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentContext {
    pub amount: Amount,
    /// `None` when the verdict could not be produced; the policy fails closed.
    pub verdict: Option<RiskVerdict>,
    /// Already auto-paid today in the same asset, in base units.
    #[serde(with = "i128_string")]
    pub auto_spent_today: i128,
}

/// Returns `Err` only for malformed input (negative `auto_spent_today`);
/// every business outcome is a `Decision`.
pub fn decide(ctx: &PaymentContext, config: &PolicyConfig) -> Result<Decision> {
    use DecisionReason as R;

    if ctx.auto_spent_today < 0 {
        return Err(Error::InvalidInput("autoSpentToday must be >= 0".into()));
    }
    if ctx.amount.units <= 0 {
        return Ok(Decision::Block {
            reasons: vec![R::InvalidAmount],
        });
    }
    let Some(limits) = config.limits.get(&asset_key(&ctx.amount.asset)) else {
        return Ok(Decision::Block {
            reasons: vec![R::AssetNotAllowed],
        });
    };
    if ctx.amount.units > limits.hard_cap {
        return Ok(Decision::Block {
            reasons: vec![R::OverHardCap],
        });
    }

    let mut reasons = Vec::new();
    let level = match &ctx.verdict {
        None => {
            reasons.push(R::VerdictMissing);
            RiskLevel::High
        }
        Some(v) => match v.level {
            RiskLevel::Unknown => RiskLevel::High,
            other => other,
        },
    };

    Ok(match level {
        RiskLevel::Low => {
            reasons.push(R::RiskLow);
            if ctx.amount.units > limits.auto_cap {
                reasons.push(R::OverAutoCap);
                step_up(AssuranceTier::Fresh, false, reasons)
            } else if ctx.auto_spent_today.saturating_add(ctx.amount.units)
                > limits.daily_auto_budget
            {
                reasons.push(R::OverDailyAutoBudget);
                step_up(AssuranceTier::Fresh, false, reasons)
            } else {
                Decision::AutoPay { reasons }
            }
        }
        RiskLevel::Medium => {
            reasons.push(R::RiskMedium);
            step_up(AssuranceTier::Human, false, reasons)
        }
        RiskLevel::High | RiskLevel::Unknown => {
            reasons.push(R::RiskHigh);
            step_up(AssuranceTier::Strong, true, reasons)
        }
    })
}

fn step_up(
    tier: AssuranceTier,
    blocked_by_default: bool,
    reasons: Vec<DecisionReason>,
) -> Decision {
    Decision::StepUp {
        tier,
        blocked_by_default,
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::money::{Asset, hbar, tinybars};
    use DecisionReason as R;

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

    fn verdict(level: RiskLevel) -> Option<RiskVerdict> {
        Some(RiskVerdict {
            level,
            reasons: vec!["test".into()],
        })
    }

    fn run(amount: Amount, verdict: Option<RiskVerdict>, spent: i128) -> Decision {
        decide(
            &PaymentContext {
                amount,
                verdict,
                auto_spent_today: spent,
            },
            &policy(),
        )
        .unwrap_or(Decision::Block { reasons: vec![] })
    }

    #[test]
    fn blocks_zero_and_negative_amounts() {
        assert_eq!(
            run(tinybars(0), verdict(RiskLevel::Low), 0),
            Decision::Block {
                reasons: vec![R::InvalidAmount]
            }
        );
        assert_eq!(
            run(tinybars(-1), verdict(RiskLevel::Low), 0),
            Decision::Block {
                reasons: vec![R::InvalidAmount]
            }
        );
    }

    #[test]
    fn blocks_assets_without_limits() {
        let usdc = Amount {
            asset: Asset::Hts {
                token_id: "0.0.6001".into(),
                decimals: 6,
            },
            units: 1,
        };
        assert_eq!(
            run(usdc, verdict(RiskLevel::Low), 0),
            Decision::Block {
                reasons: vec![R::AssetNotAllowed]
            }
        );
    }

    #[test]
    fn hard_cap_blocks_even_low_risk_and_boundary_is_inclusive() {
        assert_eq!(
            run(hbar(51), verdict(RiskLevel::Low), 0),
            Decision::Block {
                reasons: vec![R::OverHardCap]
            }
        );
        assert!(matches!(
            run(hbar(50), verdict(RiskLevel::Medium), 0),
            Decision::StepUp { .. }
        ));
    }

    #[test]
    fn negative_spent_today_is_an_input_error() {
        let ctx = PaymentContext {
            amount: hbar(1),
            verdict: verdict(RiskLevel::Low),
            auto_spent_today: -1,
        };
        assert!(matches!(
            decide(&ctx, &policy()),
            Err(Error::InvalidInput(_))
        ));
    }

    #[test]
    fn auto_pays_low_risk_within_limits_including_the_cap_boundary() {
        assert_eq!(
            run(hbar(2), verdict(RiskLevel::Low), 0),
            Decision::AutoPay {
                reasons: vec![R::RiskLow]
            }
        );
    }

    #[test]
    fn low_risk_over_auto_cap_needs_fresh_auth() {
        assert_eq!(
            run(tinybars(hbar(2).units + 1), verdict(RiskLevel::Low), 0),
            Decision::StepUp {
                tier: AssuranceTier::Fresh,
                blocked_by_default: false,
                reasons: vec![R::RiskLow, R::OverAutoCap]
            }
        );
    }

    #[test]
    fn low_risk_over_daily_budget_needs_fresh_auth_and_exact_budget_is_ok() {
        assert_eq!(
            run(hbar(2), verdict(RiskLevel::Low), hbar(4).units),
            Decision::StepUp {
                tier: AssuranceTier::Fresh,
                blocked_by_default: false,
                reasons: vec![R::RiskLow, R::OverDailyAutoBudget]
            }
        );
        assert!(matches!(
            run(hbar(2), verdict(RiskLevel::Low), hbar(3).units),
            Decision::AutoPay { .. }
        ));
    }

    #[test]
    fn medium_risk_needs_human_at_any_amount() {
        for amount in [tinybars(1), hbar(2), hbar(40)] {
            assert_eq!(
                run(amount, verdict(RiskLevel::Medium), 0),
                Decision::StepUp {
                    tier: AssuranceTier::Human,
                    blocked_by_default: false,
                    reasons: vec![R::RiskMedium]
                }
            );
        }
    }

    #[test]
    fn high_risk_is_blocked_by_default_with_strong_override() {
        assert_eq!(
            run(tinybars(1), verdict(RiskLevel::High), 0),
            Decision::StepUp {
                tier: AssuranceTier::Strong,
                blocked_by_default: true,
                reasons: vec![R::RiskHigh]
            }
        );
    }

    #[test]
    fn missing_verdict_fails_closed() {
        assert_eq!(
            run(tinybars(1), None, 0),
            Decision::StepUp {
                tier: AssuranceTier::Strong,
                blocked_by_default: true,
                reasons: vec![R::VerdictMissing, R::RiskHigh]
            }
        );
    }

    #[test]
    fn unknown_level_from_untyped_json_fails_closed() {
        let v: RiskVerdict =
            serde_json::from_str(r#"{"level":"none","reasons":[]}"#).unwrap_or(RiskVerdict {
                level: RiskLevel::Low,
                reasons: vec![],
            });
        assert_eq!(v.level, RiskLevel::Unknown);
        assert!(matches!(
            run(tinybars(1), Some(v), 0),
            Decision::StepUp {
                tier: AssuranceTier::Strong,
                blocked_by_default: true,
                ..
            }
        ));
    }

    #[test]
    fn decision_json_matches_typescript_shapes() {
        let auto = serde_json::to_string(&Decision::AutoPay {
            reasons: vec![R::RiskLow],
        })
        .unwrap_or_default();
        assert_eq!(auto, r#"{"kind":"auto-pay","reasons":["RISK_LOW"]}"#);
        let step = serde_json::to_string(&Decision::StepUp {
            tier: AssuranceTier::Strong,
            blocked_by_default: true,
            reasons: vec![R::RiskHigh],
        })
        .unwrap_or_default();
        assert_eq!(
            step,
            r#"{"kind":"step-up","tier":"strong","blockedByDefault":true,"reasons":["RISK_HIGH"]}"#
        );
        let block = serde_json::to_string(&Decision::Block {
            reasons: vec![R::OverHardCap],
        })
        .unwrap_or_default();
        assert_eq!(block, r#"{"kind":"block","reasons":["OVER_HARD_CAP"]}"#);
    }

    #[test]
    fn config_validation() {
        let bad_cap =
            r#"{"limits":{"HBAR":{"autoCap":"10","hardCap":"5","dailyAutoBudget":"10"}}}"#;
        assert!(
            matches!(PolicyConfig::from_json(bad_cap), Err(Error::InvalidConfig(m)) if m.contains("hardCap"))
        );
        let bad_budget =
            r#"{"limits":{"HBAR":{"autoCap":"10","hardCap":"50","dailyAutoBudget":"5"}}}"#;
        assert!(
            matches!(PolicyConfig::from_json(bad_budget), Err(Error::InvalidConfig(m)) if m.contains("dailyAutoBudget"))
        );
        let negative =
            r#"{"limits":{"HBAR":{"autoCap":"-1","hardCap":"50","dailyAutoBudget":"5"}}}"#;
        assert!(PolicyConfig::from_json(negative).is_err());
        let numbers = r#"{"limits":{"HBAR":{"autoCap":1,"hardCap":2,"dailyAutoBudget":3}}}"#;
        assert!(
            PolicyConfig::from_json(numbers).is_err(),
            "float/number money must be rejected"
        );
        let ok = r#"{"limits":{"HBAR":{"autoCap":"2","hardCap":"50","dailyAutoBudget":"5"}}}"#;
        assert!(PolicyConfig::from_json(ok).is_ok());
    }
}
