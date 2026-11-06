/**
 * The agent loop, as plain functions over `AgentDeps`:
 *
 *   runCheck:            probe the merchant's 402, read the request privately (0G),
 *                        buy evidence (x402), judge (0G), decide (Rust policy), then
 *                        block, ask for World ID approval, or auto-pay.
 *   handleApprovalOutcome / settleApproved: continue after the World callback.
 *
 * Rules that hold everywhere below:
 *  - The merchant's own 402 challenge is the only source of payee and amount;
 *    the text of the request is never trusted for either.
 *  - Money moves only through `payAndRecord`, which is reached from exactly two
 *    places: an `auto-pay` decision, or a consumed approval (one winner).
 *  - Missing information fails closed: a failed model call is a missing verdict
 *    (the policy treats it as high risk) and an unreachable checker is evidence
 *    at medium, never silence.
 *  - On-chain logging is best effort and never blocks or changes a payment.
 */

import type { CheckRecord } from "@/adapters/db";
import { utcDay } from "@/adapters/db";
import {
  actionFromCheck,
  type CallbackOutcome,
  consumeApprovalOnce,
  startApproval,
} from "@/adapters/world";
import {
  applyEvidenceFloor,
  type Evidence,
  type Extraction,
  hashVerdict,
  type Traced,
} from "@/adapters/zerog";
import { type Amount, assetKey, type RiskVerdict } from "@/core";
import { weighEvidence } from "@/marketplace/trust";
import type { AgentListing, Subject } from "@/marketplace/types";
import { decide, hashAction } from "@/rust";
import {
  type AgentDeps,
  AgentError,
  type Challenge,
  type CheckInput,
  type RunResult,
} from "./types";

const HBAR = { kind: "HBAR" } as const;

/** Hash bound into an approval when the model produced no verdict. */
const MISSING_VERDICT: RiskVerdict = {
  level: "high",
  reasons: ["VERDICT_MISSING"],
};

type AuditFields = {
  verdictHash?: string;
  actionHash?: string;
  decision?: "auto-pay" | "step-up" | "block";
  zgRequestIds?: string[];
  /** Evidence names of the verifiers that answered. */
  verifiers?: string[];
  txId?: string;
  detail?: string;
};

function auditor(deps: AgentDeps, checkId: string) {
  return async (
    type: Parameters<NonNullable<AgentDeps["logs"]>["recordAudit"]>[0]["type"],
    fields: AuditFields = {},
  ): Promise<void> => {
    if (!deps.logs) return;
    try {
      await deps.logs.recordAudit({
        v: 1,
        type,
        checkId,
        at: deps.now(),
        ...fields,
      });
    } catch {
      // Logging must never change the outcome of a payment decision.
    }
  };
}

async function report(
  deps: AgentDeps,
  check: CheckRecord,
  outcome: "paid-ok" | "flagged",
): Promise<void> {
  if (!deps.logs || !check.payee) return;
  try {
    await deps.logs.reportPayee({
      v: 1,
      payee: check.payee,
      checkId: check.id,
      outcome,
      at: deps.now(),
    });
  } catch {
    // best effort
  }
}

const unavailable = (source: string): Evidence => ({
  source,
  level: "medium",
  detail: "checker unavailable, treated as medium",
});

/**
 * Asks every listed verifier about one subject. Silence is never "fine": a
 * verifier that fails is medium evidence under its own name, a directory that
 * fails or is empty is medium evidence too.
 */
async function consult(
  deps: AgentDeps,
  subject: Subject,
): Promise<{ evidence: Evidence[]; used: string[] }> {
  let verifiers: AgentListing[];
  try {
    verifiers = await deps.verifiers.list(subject.kind);
  } catch {
    return {
      evidence: [
        {
          source: "verifier-directory",
          level: "medium",
          detail: `could not list verifiers for ${subject.kind} checks, treated as medium`,
        },
      ],
      used: [],
    };
  }
  if (verifiers.length === 0)
    return {
      evidence: [
        {
          source: "verifier-directory",
          level: "medium",
          detail: `no active verifier for ${subject.kind} checks, treated as medium`,
        },
      ],
      used: [],
    };

  const results = await Promise.all(
    verifiers.map(async (verifier) => {
      try {
        return {
          evidence: await deps.verifiers.call(verifier, subject),
          id: verifier.evidenceSource,
          trusted: verifier.builtIn,
        };
      } catch {
        return {
          evidence: unavailable(verifier.evidenceSource),
          id: null,
          trusted: true,
        };
      }
    }),
  );
  return {
    // A third party's lone "high" counts as medium until another verifier confirms it.
    evidence: weighEvidence(results),
    used: results.flatMap((r) => (r.id ? [r.id] : [])),
  };
}

async function gather(
  deps: AgentDeps,
  extraction: Extraction | null,
  challenge: Challenge,
): Promise<{ evidence: Evidence[]; verifierIds: string[] }> {
  const subjects: Subject[] = [{ kind: "payee", account: challenge.payTo }];
  if (extraction?.link) subjects.push({ kind: "link", url: extraction.link });

  const consulted = await Promise.all(subjects.map((s) => consult(deps, s)));
  const evidence = consulted.flatMap((c) => c.evidence);
  const verifierIds = consulted.flatMap((c) => c.used);

  // The request names a different account than the merchant will actually be paid to.
  if (extraction?.payeeAccount && extraction.payeeAccount !== challenge.payTo)
    evidence.push({
      source: "payee-check",
      level: "high",
      detail: `request names ${extraction.payeeAccount} but payment goes to ${challenge.payTo}`,
    });
  return { evidence, verifierIds };
}

export async function runCheck(
  deps: AgentDeps,
  input: CheckInput,
): Promise<RunResult> {
  const checkId = `chk_${deps.random(12)}`;
  let check: CheckRecord = {
    id: checkId,
    createdAt: deps.now(),
    inputKind: "text",
    inputText: input.text,
    payee: null,
    resource: input.resource,
    amount: null,
    verdict: null,
    verdictHash: null,
    decision: null,
    transactionId: null,
    status: "received",
  };
  await deps.repos.checks.create(check);
  const audit = auditor(deps, checkId);
  await audit("check.received");

  // 1. What would actually be paid, and to whom.
  let challenge: Challenge;
  try {
    challenge = await deps.probe.challenge(input.resource);
  } catch (e) {
    const reason = e instanceof AgentError ? e.kind : "RESOURCE_NOT_PAYABLE";
    await deps.repos.checks.update(checkId, { status: "failed" });
    await audit("payment.failed", { detail: reason });
    return { checkId, status: "failed", decision: null, verdict: null, reason };
  }
  const amount: Amount = { asset: HBAR, units: challenge.amount };
  check =
    (await deps.repos.checks.update(checkId, {
      payee: challenge.payTo,
      amount,
    })) ?? check;

  // 2. Private reading. A failure means "no verdict", never "low risk".
  const requestIds: string[] = [];
  let extracted: Traced<Extraction> | null = null;
  try {
    extracted = await deps.zerog.extract({ kind: "text", text: input.text });
    requestIds.push(extracted.requestId);
  } catch {
    extracted = null;
  }

  // 3. Paid evidence, then the verdict.
  const { evidence, verifierIds } = await gather(
    deps,
    extracted?.value ?? null,
    challenge,
  );
  let verdict: RiskVerdict | null = null;
  if (extracted) {
    try {
      const judged = await deps.zerog.judge(extracted.value, evidence);
      // Applied here as well as in the 0G client: evidence can only raise risk.
      verdict = applyEvidenceFloor(judged.value, evidence);
      requestIds.push(judged.requestId);
    } catch {
      verdict = null;
    }
  }
  const verdictHash = hashVerdict(verdict ?? MISSING_VERDICT);

  // 4. Policy.
  const autoSpentToday = await deps.repos.spend.get(
    utcDay(deps.now()),
    assetKey(HBAR),
  );
  const decision = decide({ amount, verdict, autoSpentToday }, deps.policy);
  check =
    (await deps.repos.checks.update(checkId, {
      verdict,
      verdictHash,
      decision,
      status: "verdict",
    })) ?? check;
  await audit("check.verdict", {
    verdictHash,
    // An audit message must fit one HCS message; an oversized id must not cost us the record.
    zgRequestIds: requestIds.map((id) => id.slice(0, 64)),
    verifiers: verifierIds,
  });
  await audit("check.decision", { decision: decision.kind });

  // 5. Act on it.
  if (decision.kind === "block") {
    await deps.repos.checks.update(checkId, { status: "blocked" });
    await audit("payment.blocked", { detail: decision.reasons[0] });
    if (verdict?.level === "high") await report(deps, check, "flagged");
    return {
      checkId,
      status: "blocked",
      decision,
      verdict,
      reason: decision.reasons[0],
    };
  }

  if (decision.kind === "step-up") {
    const action = actionFromCheck(check);
    if (!action) throw new Error("check is missing fields after decision");
    const started = await startApproval(deps.approval, {
      action,
      tier: decision.tier,
    });
    await deps.repos.checks.update(checkId, { status: "awaiting-approval" });
    await audit("approval.requested", { actionHash: hashAction(action) });
    return {
      checkId,
      status: "awaiting-approval",
      decision,
      verdict,
      approvalUrl: started.url,
    };
  }

  return payAndRecord(deps, check, { auto: true }, verdict, decision);
}

/** The only function that moves money. */
async function payAndRecord(
  deps: AgentDeps,
  check: CheckRecord,
  mode: { auto: boolean },
  verdict: RiskVerdict | null,
  decision: RunResult["decision"],
): Promise<RunResult> {
  const audit = auditor(deps, check.id);
  const base = { checkId: check.id, decision, verdict };
  if (!check.payee || !check.amount || !check.resource)
    throw new Error("cannot pay an incomplete check");

  if (mode.auto) {
    // Reserve before paying so concurrent auto-pays cannot overshoot the daily budget.
    const limit = deps.policy.limits[assetKey(check.amount.asset)];
    const total = await deps.repos.spend.add(
      utcDay(deps.now()),
      assetKey(check.amount.asset),
      check.amount.units,
    );
    if (!limit || total > limit.dailyAutoBudget) {
      await deps.repos.checks.update(check.id, { status: "blocked" });
      await audit("payment.blocked", { detail: "OVER_DAILY_AUTO_BUDGET" });
      return {
        ...base,
        status: "blocked",
        reason: "OVER_DAILY_AUTO_BUDGET",
      };
    }
  }

  try {
    const { transactionId } = await deps.payer.pay(check.resource, {
      payTo: check.payee,
      amount: check.amount.units,
    });
    await deps.repos.checks.update(check.id, {
      status: "paid",
      transactionId: transactionId ?? null,
    });
    await audit("payment.settled", { txId: transactionId });
    await report(deps, check, "paid-ok");
    return { ...base, status: "paid", ...(transactionId && { transactionId }) };
  } catch (e) {
    const reason = e instanceof AgentError ? e.kind : "PAYMENT_FAILED";
    await deps.repos.checks.update(check.id, { status: "failed" });
    await audit("payment.failed", { detail: reason });
    return { ...base, status: "failed", reason };
  }
}

/** Pays after a World approval, spending the approval exactly once. */
export async function settleApproved(
  deps: AgentDeps,
  checkId: string,
  attemptId: string,
): Promise<RunResult> {
  const check = await deps.repos.checks.get(checkId);
  if (!check)
    return {
      checkId,
      status: "failed",
      decision: null,
      verdict: null,
      reason: "UNKNOWN_CHECK",
    };
  const refuse = (reason: string): RunResult => ({
    checkId,
    status: check.status,
    decision: check.decision,
    verdict: check.verdict,
    reason,
  });
  if (check.status !== "awaiting-approval")
    return refuse("NOT_AWAITING_APPROVAL");

  // The approval must belong to this check before it is spent.
  const pending = await deps.repos.approvals.getById(attemptId);
  if (!pending || pending.action.checkId !== checkId)
    return refuse("APPROVAL_MISMATCH");
  if (!(await consumeApprovalOnce(deps.approval, attemptId)))
    return refuse("APPROVAL_NOT_USABLE");

  await auditor(deps, checkId)("approval.approved", {
    actionHash: pending.actionHash,
    // Honest labelling: a simulated World approval is never passed off as a real one.
    detail: `source:${deps.approval.source ?? "world"}`,
  });
  return payAndRecord(
    deps,
    check,
    { auto: false },
    check.verdict,
    check.decision,
  );
}

/** Continues a check after the World callback, whatever its outcome. */
export async function handleApprovalOutcome(
  deps: AgentDeps,
  outcome: CallbackOutcome,
): Promise<RunResult | null> {
  if (outcome.kind === "unknown_state" || outcome.kind === "not_pending")
    return null;
  if (outcome.kind === "approved")
    return settleApproved(deps, outcome.checkId, outcome.attemptId);

  const check = await deps.repos.checks.get(outcome.checkId);
  if (!check) return null;
  if (check.status === "awaiting-approval")
    await deps.repos.checks.update(check.id, { status: "blocked" });
  const reason = outcome.reason ?? outcome.kind.toUpperCase();
  const audit = auditor(deps, check.id);
  await audit("approval.rejected", { detail: reason });
  await audit("payment.blocked", { detail: reason });
  return {
    checkId: check.id,
    status: "blocked",
    decision: check.decision,
    verdict: check.verdict,
    reason,
  };
}
