import { z } from "zod";
import type { AssuranceTier } from "./assurance";
import { type Amount, assetKey } from "./money";

/**
 * Risk-adaptive payment policy. Pure: same input, same decision.
 *
 * Rules, in order (first match wins):
 *  1. Non-positive amount                      -> block (INVALID_AMOUNT)
 *  2. Asset has no configured limits           -> block (ASSET_NOT_ALLOWED)
 *  3. Amount above the asset's hard cap        -> block (OVER_HARD_CAP), no override
 *  4. Missing verdict is treated as high risk  (fail closed, VERDICT_MISSING)
 *  5. high risk   -> step-up "strong", blocked unless the human overrides
 *  6. medium risk -> step-up "human"
 *  7. low risk    -> auto-pay, unless over the auto cap or the daily auto
 *                    budget, in which case step-up "fresh"
 */

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface RiskVerdict {
  level: RiskLevel;
  reasons: readonly string[];
}

export type DecisionReason =
  | "INVALID_AMOUNT"
  | "ASSET_NOT_ALLOWED"
  | "OVER_HARD_CAP"
  | "VERDICT_MISSING"
  | "RISK_LOW"
  | "RISK_MEDIUM"
  | "RISK_HIGH"
  | "OVER_AUTO_CAP"
  | "OVER_DAILY_AUTO_BUDGET";

export type Decision =
  | { kind: "auto-pay"; reasons: DecisionReason[] }
  | {
      kind: "step-up";
      tier: AssuranceTier;
      /** True when the default outcome is "don't pay" and approval is an override. */
      blockedByDefault: boolean;
      reasons: DecisionReason[];
    }
  | { kind: "block"; reasons: DecisionReason[] };

const units = z.bigint().nonnegative();

const assetLimitsSchema = z
  .object({
    /** Largest single payment the agent may make without a human. */
    autoCap: units,
    /** Largest payment allowed at all, even with approval. */
    hardCap: units,
    /** Total the agent may auto-pay per day in this asset. */
    dailyAutoBudget: units,
  })
  .refine((l) => l.autoCap <= l.hardCap, {
    message: "autoCap must be <= hardCap",
  })
  .refine((l) => l.autoCap <= l.dailyAutoBudget, {
    message: "autoCap must be <= dailyAutoBudget",
  });

export const policyConfigSchema = z.object({
  /** Keyed by assetKey(): "HBAR" or "HTS:<tokenId>". */
  limits: z.record(z.string().min(1), assetLimitsSchema),
});

export type AssetLimits = z.infer<typeof assetLimitsSchema>;
export type PolicyConfig = z.infer<typeof policyConfigSchema>;

export function parsePolicyConfig(input: unknown): PolicyConfig {
  return policyConfigSchema.parse(input);
}

export interface PaymentContext {
  amount: Amount;
  /** null when the verdict could not be produced; the policy fails closed. */
  verdict: RiskVerdict | null;
  /** Already auto-paid today in the same asset, in base units. */
  autoSpentToday: bigint;
}

export function decide(ctx: PaymentContext, config: PolicyConfig): Decision {
  if (ctx.autoSpentToday < 0n) {
    throw new RangeError("autoSpentToday must be >= 0");
  }
  if (ctx.amount.units <= 0n) {
    return { kind: "block", reasons: ["INVALID_AMOUNT"] };
  }

  const limits = config.limits[assetKey(ctx.amount.asset)];
  if (!limits) {
    return { kind: "block", reasons: ["ASSET_NOT_ALLOWED"] };
  }
  if (ctx.amount.units > limits.hardCap) {
    return { kind: "block", reasons: ["OVER_HARD_CAP"] };
  }

  const reasons: DecisionReason[] = [];
  let level: RiskLevel;
  if (ctx.verdict === null) {
    reasons.push("VERDICT_MISSING");
    level = "high";
  } else {
    level = ctx.verdict.level;
  }

  switch (level) {
    case "high":
      reasons.push("RISK_HIGH");
      return {
        kind: "step-up",
        tier: "strong",
        blockedByDefault: true,
        reasons,
      };
    case "medium":
      reasons.push("RISK_MEDIUM");
      return {
        kind: "step-up",
        tier: "human",
        blockedByDefault: false,
        reasons,
      };
    case "low": {
      reasons.push("RISK_LOW");
      if (ctx.amount.units > limits.autoCap) {
        reasons.push("OVER_AUTO_CAP");
        return {
          kind: "step-up",
          tier: "fresh",
          blockedByDefault: false,
          reasons,
        };
      }
      if (ctx.autoSpentToday + ctx.amount.units > limits.dailyAutoBudget) {
        reasons.push("OVER_DAILY_AUTO_BUDGET");
        return {
          kind: "step-up",
          tier: "fresh",
          blockedByDefault: false,
          reasons,
        };
      }
      return { kind: "auto-pay", reasons };
    }
    default: {
      // Unknown level from an untyped caller: fail closed.
      const _exhaustive: never = level;
      void _exhaustive;
      reasons.push("RISK_HIGH");
      return {
        kind: "step-up",
        tier: "strong",
        blockedByDefault: true,
        reasons,
      };
    }
  }
}
