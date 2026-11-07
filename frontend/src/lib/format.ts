/** Money, time and wording helpers. Amounts stay as exact decimal strings: never floats. */

const TINYBARS_PER_HBAR = 100_000_000n;

/** "0.25" or "2" HBAR -> tinybars as a decimal string, or null if it is not a valid positive amount. */
export function hbarToTinybars(input: string): string | null {
  const m = /^\s*(\d{1,10})(?:\.(\d{1,8}))?\s*$/.exec(input);
  if (!m) return null;
  const whole = BigInt(m[1] ?? "0");
  const frac = BigInt((m[2] ?? "").padEnd(8, "0") || "0");
  const total = whole * TINYBARS_PER_HBAR + frac;
  return total > 0n ? total.toString() : null;
}

/** Tinybars (decimal string) -> "0.1 HBAR". */
export function formatHbar(tinybars: string): string {
  const v = BigInt(tinybars);
  const whole = v / TINYBARS_PER_HBAR;
  const frac = (v % TINYBARS_PER_HBAR)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} HBAR`;
}

export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(at).toLocaleDateString();
}

export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

/** Policy and pipeline reason codes, in plain words. Mirrors the backend's src/ui/explain.ts. */
const REASONS: Record<string, string> = {
  INVALID_AMOUNT: "The amount is not a valid positive number.",
  ASSET_NOT_ALLOWED: "There are no spending limits for this currency.",
  OVER_HARD_CAP: "Above the largest payment the agent will ever make.",
  VERDICT_MISSING:
    "The risk review could not finish, so it is treated as high risk.",
  RISK_LOW: "The request looks ordinary.",
  RISK_MEDIUM: "The request has some warning signs.",
  RISK_HIGH: "The request looks like a scam or a mistake.",
  OVER_AUTO_CAP: "More than the agent may pay on its own in one payment.",
  OVER_DAILY_AUTO_BUDGET:
    "Paying this would pass the daily limit for automatic payments.",
  RESOURCE_NOT_PAYABLE:
    "The payee did not return a usable payment request, so nothing was paid.",
  PAYMENT_FAILED: "The payment was attempted but did not go through.",
  WORKER_UNAVAILABLE: "The worker is no longer available.",
  CHECK_ERROR: "The check could not run.",
  NOT_AWAITING_APPROVAL: "This is not waiting for an approval.",
  DENIED: "The approval was declined.",
  EXPIRED: "The approval took too long and expired.",
};

const FIELDS: Record<string, string> = {
  prompt: "task",
  skill: "skill",
  agentId: "worker",
  maxPriceTinybars: "maximum price",
};

/** A reason code in words; a list of edited field names (from "task.edited") in words too. */
export function explainReason(code: string): string {
  const known = REASONS[code];
  if (known) return known;
  const parts = code.split(", ");
  return parts.every((p) => p in FIELDS)
    ? parts.map((p) => FIELDS[p]).join(", ")
    : code;
}

/** What each task event means, for the timeline. */
export const EVENT_LABELS: Record<string, string> = {
  "task.created": "Task created",
  "workers.suggested": "Workers suggested",
  "worker.accepted": "Worker accepted",
  "task.edited": "Task edited",
  "approval.cancelled": "Pending approval cancelled",
  "check.started": "Kavach402 check started",
  "approval.requested": "Human approval requested",
  "worker.called": "Worker paid and called",
  "answer.received": "Answer received and screened",
  "answer.missing": "Worker sent no answer",
  "task.completed": "Completed",
  "task.blocked": "Blocked",
  "task.failed": "Failed",
  "task.withdrawn": "Withdrawn",
  "check.update": "Check update",
};
