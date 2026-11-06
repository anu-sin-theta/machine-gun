/**
 * Plain-language wording for what the agent decided and why. Pure functions
 * over the data the pipeline already returns, so they are tested without a
 * browser and shared by the server-rendered page and the client form.
 */

import type { CheckStatus } from "@/adapters/db";
import type { AssuranceTier, Decision } from "@/core";

const REASONS: Record<string, string> = {
  // Policy
  INVALID_AMOUNT: "The amount is not a valid positive number.",
  ASSET_NOT_ALLOWED: "The agent has no spending limits for this currency.",
  OVER_HARD_CAP: "This is above the largest payment the agent will ever make.",
  VERDICT_MISSING:
    "The risk review could not be completed, so the agent treats it as high risk.",
  RISK_LOW: "The request looks ordinary.",
  RISK_MEDIUM: "The request has some warning signs.",
  RISK_HIGH: "The request looks like a scam or a mistake.",
  OVER_AUTO_CAP:
    "This is more than the agent may pay on its own in a single payment.",
  OVER_DAILY_AUTO_BUDGET:
    "Paying this would go past the agent's daily limit for automatic payments.",
  // Pipeline
  RESOURCE_NOT_PAYABLE:
    "The merchant did not return a usable payment request, so nothing was paid.",
  PAYMENT_FAILED: "The payment was attempted but did not go through.",
  UNKNOWN_CHECK: "That check no longer exists.",
  NOT_AWAITING_APPROVAL: "This check is not waiting for an approval.",
  APPROVAL_MISMATCH: "That approval belongs to a different payment.",
  APPROVAL_NOT_USABLE: "That approval was already used or has expired.",
  // Approval outcomes
  INSUFFICIENT_ASSURANCE:
    "The World ID login was not strong enough for how risky this payment is.",
  STALE_AUTH: "The World ID login was not recent enough.",
  AUTH_TIME_IN_FUTURE: "The World ID login time was not valid.",
  ACTION_CHANGED:
    "The payment changed after approval started, so it was refused.",
  NONCE_MISMATCH: "The World ID response did not match this request.",
  SUBJECT_MISMATCH: "A different person than expected approved this.",
  ISSUER_MISMATCH: "The approval did not come from World ID.",
  NONCE_REPLAY: "That World ID response was already used.",
  WORLD_ERROR: "World ID could not confirm the login.",
  DENIED: "You declined the approval.",
  REJECTED: "The approval was rejected.",
  EXPIRED: "The approval took too long and expired.",
};

export function explainReason(code: string): string {
  return REASONS[code] ?? code;
}

/**
 * A reason code that came back in a URL. Only the shape we produce is accepted,
 * so a crafted link cannot put arbitrary text on the page.
 */
export function safeReasonCode(
  value: string | null | undefined,
): string | null {
  return value && /^[A-Z][A-Z_]{2,40}$/.test(value) ? value : null;
}

export const TIER_LABEL: Record<AssuranceTier, string> = {
  fresh: "a fresh World ID login",
  human: "a verified human (World ID, Orb)",
  strong: "the strongest World ID check (Orb + face)",
};

export interface DecisionText {
  headline: string;
  detail: string;
}

export function explainDecision(decision: Decision): DecisionText {
  switch (decision.kind) {
    case "auto-pay":
      return {
        headline: "Paid on its own",
        detail:
          "Low risk and within the agent's limits, so no approval was needed.",
      };
    case "step-up":
      return {
        headline: decision.blockedByDefault
          ? "Blocked unless you override"
          : "Needs your approval",
        detail: decision.blockedByDefault
          ? `This looks high risk, so the agent will not pay by default. Only ${TIER_LABEL[decision.tier]} can override that.`
          : `The agent needs ${TIER_LABEL[decision.tier]} before it pays.`,
      };
    case "block":
      return {
        headline: "Blocked",
        detail: "The agent will not make this payment, even with approval.",
      };
  }
}

/**
 * What to say once we know how a check ended. While a check is still open the
 * decision wording applies; after it ends, the headline must describe the
 * outcome ("Paid after your approval"), not the earlier "blocked unless you override".
 */
export function explainOutcome(view: {
  status: CheckStatus;
  decision: Decision | null;
}): DecisionText | null {
  const { status, decision } = view;
  if (!decision) return null;
  if (status === "paid" && decision.kind === "step-up")
    return {
      headline: "Paid after your approval",
      detail:
        "A World ID approval at the required level was accepted once, and the agent paid.",
    };
  if (status === "blocked" && decision.kind === "step-up")
    return {
      headline: "Not paid",
      detail: "The approval did not go through, so nothing was paid.",
    };
  if (status === "failed")
    return {
      headline: "Not completed",
      detail: "Something stopped the payment. Check the details below.",
    };
  return explainDecision(decision);
}

export const STATUS_LABEL: Record<CheckStatus, string> = {
  received: "Checking",
  verdict: "Deciding",
  "awaiting-approval": "Waiting for approval",
  paid: "Paid",
  blocked: "Blocked",
  failed: "Not completed",
};

/** Tone for status pills and risk badges. */
export type Tone = "good" | "warn" | "bad" | "neutral";

export function statusTone(status: CheckStatus): Tone {
  switch (status) {
    case "paid":
      return "good";
    case "awaiting-approval":
      return "warn";
    case "blocked":
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

export function riskTone(level: "low" | "medium" | "high"): Tone {
  return level === "low" ? "good" : level === "medium" ? "warn" : "bad";
}

export const AUDIT_LABEL: Record<string, string> = {
  "check.received": "Request received",
  "check.verdict": "Risk review recorded",
  "check.decision": "Decision recorded",
  "approval.requested": "Approval requested",
  "approval.approved": "Approval accepted",
  "approval.rejected": "Approval refused",
  "payment.settled": "Payment settled",
  "payment.blocked": "Payment blocked",
  "payment.failed": "Payment failed",
};

export function hashscanUrl(
  transactionId: string,
  network: "testnet" | "mainnet",
): string {
  return `https://hashscan.io/${network}/transaction/${encodeURIComponent(transactionId)}`;
}
