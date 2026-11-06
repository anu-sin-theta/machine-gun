import { describe, expect, it } from "vitest";
import { utcDay } from "@/adapters/db";
import { completeApproval } from "@/adapters/world";
import {
  AgentError,
  handleApprovalOutcome,
  type RunResult,
  runCheck,
  settleApproved,
} from "@/agent";
import { hbar } from "@/core";
import type { AuthorizeOverrides } from "../world/fakeIssuer";
import { INPUT, makeHarness, PAYEE, RESOURCE, type Script } from "./harness";

type H = Awaited<ReturnType<typeof makeHarness>>;

const types = (h: H) => h.calls.audit.map((e) => e.type);
const spent = (h: H) => h.repos.spend.get(utcDay(h.clock.t), "HBAR");

/** Plays the user approving in World, then continues the agent. */
async function approve(
  h: H,
  result: RunResult,
  overrides: AuthorizeOverrides = {},
) {
  expect(result.approvalUrl).toBeTruthy();
  const callback = h.issuer.approve(result.approvalUrl as string, overrides);
  const outcome = await completeApproval(h.deps.approval, callback);
  return { outcome, final: await handleApprovalOutcome(h.deps, outcome) };
}

describe("auto-pay path", () => {
  it("pays a low-risk bill under the cap, records everything and reports the payee as ok", async () => {
    const h = await makeHarness();
    const out = await runCheck(h.deps, INPUT);

    expect(out).toMatchObject({
      status: "paid",
      transactionId: "0.0.1001@1.1",
      decision: { kind: "auto-pay" },
      verdict: { level: "low" },
    });
    expect(h.calls.pay).toEqual([
      {
        resourceUrl: RESOURCE,
        challenge: { payTo: PAYEE, amount: 150_000_000n },
      },
    ]);
    expect(await spent(h)).toBe(150_000_000n);
    expect(types(h)).toEqual([
      "check.received",
      "check.verdict",
      "check.decision",
      "payment.settled",
    ]);
    expect(h.calls.audit[1]).toMatchObject({
      zgRequestIds: ["req_extract", "req_judge"],
    });
    expect(h.calls.audit[1]?.verdictHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.calls.reports).toMatchObject([
      { payee: PAYEE, outcome: "paid-ok" },
    ]);

    const stored = await h.repos.checks.get(out.checkId);
    expect(stored).toMatchObject({
      status: "paid",
      payee: PAYEE,
      resource: RESOURCE,
    });
    expect(stored?.amount?.units).toBe(150_000_000n);
  });

  it("takes payee and amount from the merchant's challenge, and stops if the text names someone else", async () => {
    const h = await makeHarness({
      challenge: { payTo: "0.0.7777", amount: 90_000_000n },
    });
    const out = await runCheck(h.deps, INPUT);
    const stored = await h.repos.checks.get(out.checkId);
    expect(stored?.payee).toBe("0.0.7777");
    expect(stored?.amount?.units).toBe(90_000_000n);
    expect(h.calls.reputation).toEqual(["0.0.7777"]);
    // The request text named `0.0.5001`, but the money would go to 0.0.7777.
    expect(
      h.calls.judge[0]?.some(
        (e) => e.source === "payee-check" && e.level === "high",
      ),
    ).toBe(true);
    expect(out.decision).toMatchObject({ kind: "step-up", tier: "strong" });
    expect(h.calls.pay).toHaveLength(0);
  });

  it("pays the challenge's payee and amount when the text agrees", async () => {
    const h = await makeHarness({
      challenge: { payTo: PAYEE, amount: 90_000_000n },
    });
    await runCheck(h.deps, INPUT);
    expect(h.calls.pay[0]?.challenge).toEqual({
      payTo: PAYEE,
      amount: 90_000_000n,
    });
  });

  it("buys evidence only for what exists: no link in the request means no link check", async () => {
    const h = await makeHarness({
      extraction: { ...(await import("./harness")).EXTRACTION, link: null },
    });
    await runCheck(h.deps, INPUT);
    expect(h.calls.link).toEqual([]);
    expect(h.calls.reputation).toEqual([PAYEE]);
  });

  it("works without on-chain logging, and a failing log never changes the outcome", async () => {
    const none = await makeHarness({ noLogs: true });
    expect((await runCheck(none.deps, INPUT)).status).toBe("paid");
    const broken = await makeHarness({ logFails: true });
    expect((await runCheck(broken.deps, INPUT)).status).toBe("paid");
  });

  it("blocks a payment that would overshoot the daily budget after reserving it", async () => {
    const h = await makeHarness();
    await h.repos.spend.add(utcDay(h.clock.t), "HBAR", 350_000_000n);
    const [a, b] = await Promise.all([
      runCheck(h.deps, INPUT),
      runCheck(h.deps, INPUT),
    ]);
    expect([a.status, b.status].sort()).toEqual(["blocked", "paid"]);
    expect(h.calls.pay).toHaveLength(1);
    const blocked = [a, b].find((r) => r.status === "blocked");
    expect(blocked?.reason).toBe("OVER_DAILY_AUTO_BUDGET");
  });

  it("asks for approval instead of auto-paying once today's budget is used", async () => {
    const h = await makeHarness();
    await h.repos.spend.add(utcDay(h.clock.t), "HBAR", 400_000_000n);
    const out = await runCheck(h.deps, INPUT);
    expect(out.decision).toMatchObject({ kind: "step-up", tier: "fresh" });
    expect(out.status).toBe("awaiting-approval");
  });

  it("records a failed payment as failed and never reports the payee as ok", async () => {
    const h = await makeHarness({
      pay: new AgentError("PAYMENT_FAILED", "merchant returned 500"),
    });
    const out = await runCheck(h.deps, INPUT);
    expect(out).toMatchObject({ status: "failed", reason: "PAYMENT_FAILED" });
    expect(types(h).at(-1)).toBe("payment.failed");
    expect(h.calls.reports).toEqual([]);
    expect((await h.repos.checks.get(out.checkId))?.status).toBe("failed");
  });

  it("treats an unexpected payer error as a failed payment", async () => {
    const h = await makeHarness({ pay: new Error("boom") });
    expect(await runCheck(h.deps, INPUT)).toMatchObject({
      status: "failed",
      reason: "PAYMENT_FAILED",
    });
  });
});

describe("fail closed", () => {
  it("stops before reading or paying anything if the merchant has no usable challenge", async () => {
    const h = await makeHarness({
      challenge: new AgentError("RESOURCE_NOT_PAYABLE", "origin not allowed"),
    });
    const out = await runCheck(h.deps, INPUT);
    expect(out).toMatchObject({
      status: "failed",
      reason: "RESOURCE_NOT_PAYABLE",
      decision: null,
    });
    expect(h.calls.extract).toBe(0);
    expect(h.calls.pay).toHaveLength(0);
    expect(types(h)).toEqual(["check.received", "payment.failed"]);
  });

  it("treats an unexpected probe error as not payable", async () => {
    const h = await makeHarness({ challenge: new Error("dns") as never });
    expect((await runCheck(h.deps, INPUT)).reason).toBe("RESOURCE_NOT_PAYABLE");
  });

  it.each([
    ["the private reading fails", { extraction: new Error("0g down") }, 0],
    ["the verdict model fails", { verdict: new Error("0g down") }, 1],
  ] as [
    string,
    Script,
    number,
  ][])("never auto-pays when %s: missing verdict means strong step-up", async (_name, script, judgeCalls) => {
    const h = await makeHarness(script);
    const out = await runCheck(h.deps, INPUT);
    expect(out.verdict).toBeNull();
    expect(out.decision).toMatchObject({
      kind: "step-up",
      tier: "strong",
      blockedByDefault: true,
      reasons: expect.arrayContaining(["VERDICT_MISSING"]),
    });
    expect(h.calls.judge).toHaveLength(judgeCalls);
    expect(h.calls.pay).toHaveLength(0);
    const stored = await h.repos.checks.get(out.checkId);
    expect(stored?.verdict).toBeNull();
    expect(stored?.verdictHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats an unreachable checker as medium evidence rather than silence", async () => {
    const h = await makeHarness({
      reputation: new Error("402 refused"),
      link: new Error("timeout"),
    });
    const out = await runCheck(h.deps, INPUT);
    const evidence = h.calls.judge[0] ?? [];
    expect(evidence.map((e) => [e.source, e.level])).toEqual([
      ["reputation", "medium"],
      ["link-intel", "medium"],
    ]);
    // Medium evidence lifts a "low" model verdict, so a human must approve.
    expect(out.verdict?.level).toBe("medium");
    expect(out.decision).toMatchObject({ kind: "step-up", tier: "human" });
  });

  it("lets evidence raise but not lower the model's verdict", async () => {
    const h = await makeHarness({
      verdict: { level: "low", reasons: ["fine"] },
      link: {
        source: "link-intel",
        level: "high",
        detail: "BRAND_IMPERSONATION",
      },
    });
    const out = await runCheck(h.deps, INPUT);
    expect(out.verdict?.level).toBe("high");
    expect(out.decision).toMatchObject({ kind: "step-up", tier: "strong" });
  });

  it("blocks a payment over the hard cap without asking anyone, and flags a high-risk payee", async () => {
    const h = await makeHarness({
      challenge: { payTo: PAYEE, amount: hbar(60).units },
      verdict: { level: "high", reasons: ["scam"] },
    });
    const out = await runCheck(h.deps, INPUT);
    expect(out).toMatchObject({
      status: "blocked",
      reason: "OVER_HARD_CAP",
      decision: { kind: "block" },
    });
    expect(out.approvalUrl).toBeUndefined();
    expect(h.calls.reports).toMatchObject([
      { payee: PAYEE, outcome: "flagged" },
    ]);
    expect(types(h).at(-1)).toBe("payment.blocked");
  });

  it("does not flag a payee when the block was only about the amount", async () => {
    const h = await makeHarness({
      challenge: { payTo: PAYEE, amount: hbar(60).units },
    });
    await runCheck(h.deps, INPUT);
    expect(h.calls.reports).toEqual([]);
  });
});

describe("approval path", () => {
  it("holds a payment over the auto cap, then pays exactly once after a World approval", async () => {
    const h = await makeHarness({
      challenge: { payTo: PAYEE, amount: hbar(3).units },
    });
    const started = await runCheck(h.deps, INPUT);
    expect(started).toMatchObject({
      status: "awaiting-approval",
      decision: { kind: "step-up", tier: "fresh" },
    });
    expect(h.calls.pay).toHaveLength(0);
    expect(types(h).at(-1)).toBe("approval.requested");

    const { outcome, final } = await approve(h, started);
    expect(outcome.kind).toBe("approved");
    expect(final).toMatchObject({
      status: "paid",
      transactionId: "0.0.1001@1.1",
    });
    expect(h.calls.pay).toEqual([
      {
        resourceUrl: RESOURCE,
        challenge: { payTo: PAYEE, amount: hbar(3).units },
      },
    ]);
    // An approved payment is not "auto" spend.
    expect(await spent(h)).toBe(0n);
    expect(types(h)).toEqual(
      expect.arrayContaining(["approval.approved", "payment.settled"]),
    );

    // Replaying the same approval cannot pay again.
    expect(
      await settleApproved(
        h.deps,
        started.checkId,
        outcome.kind === "approved" ? outcome.attemptId : "",
      ),
    ).toMatchObject({
      reason: "NOT_AWAITING_APPROVAL",
    });
    expect(h.calls.pay).toHaveLength(1);
  });

  it("labels who approved in the audit log, so a simulated World is never passed off as real", async () => {
    for (const [source, expected] of [
      [undefined, "source:world"],
      ["world", "source:world"],
      ["simulated", "source:simulated"],
    ] as const) {
      const h = await makeHarness({
        challenge: { payTo: PAYEE, amount: hbar(3).units },
      });
      if (source) h.deps.approval.source = source;
      await approve(h, await runCheck(h.deps, INPUT));
      expect(
        h.calls.audit.find((e) => e.type === "approval.approved")?.detail,
      ).toBe(expected);
    }
  });

  it("lets only one of two concurrent settlements pay", async () => {
    const h = await makeHarness({
      challenge: { payTo: PAYEE, amount: hbar(3).units },
    });
    const started = await runCheck(h.deps, INPUT);
    const outcome = await completeApproval(
      h.deps.approval,
      h.issuer.approve(started.approvalUrl as string),
    );
    if (outcome.kind !== "approved") throw new Error("expected approval");
    const [a, b] = await Promise.all([
      settleApproved(h.deps, started.checkId, outcome.attemptId),
      settleApproved(h.deps, started.checkId, outcome.attemptId),
    ]);
    expect(h.calls.pay).toHaveLength(1);
    expect([a.status, b.status].filter((s) => s === "paid")).toHaveLength(1);
  });

  it("does not pay a high-risk request on a human-level login; only the strong tier overrides", async () => {
    const weak = await makeHarness({
      verdict: { level: "high", reasons: ["scam"] },
    });
    const started = await runCheck(weak.deps, INPUT);
    expect(started.decision).toMatchObject({
      kind: "step-up",
      tier: "strong",
      blockedByDefault: true,
    });
    const rejected = await approve(weak, started, {
      claims: { acr: "https://world.org/oidc/acr/orb" },
    });
    expect(rejected.outcome).toMatchObject({
      kind: "rejected",
      reason: "INSUFFICIENT_ASSURANCE",
    });
    expect(rejected.final).toMatchObject({
      status: "blocked",
      reason: "INSUFFICIENT_ASSURANCE",
    });
    expect(weak.calls.pay).toHaveLength(0);
    expect(types(weak)).toEqual(
      expect.arrayContaining(["approval.rejected", "payment.blocked"]),
    );

    const strong = await makeHarness({
      verdict: { level: "high", reasons: ["scam"] },
    });
    const ok = await approve(strong, await runCheck(strong.deps, INPUT));
    expect(ok.final?.status).toBe("paid");
  });

  it("records a denial as a block and pays nothing", async () => {
    const h = await makeHarness({
      challenge: { payTo: PAYEE, amount: hbar(3).units },
    });
    const started = await runCheck(h.deps, INPUT);
    const stateParam =
      new URL(started.approvalUrl as string).searchParams.get("state") ?? "";
    const outcome = await completeApproval(
      h.deps.approval,
      new URL(
        `http://localhost:3000/api/worldid/callback?error=access_denied&state=${stateParam}`,
      ),
    );
    const final = await handleApprovalOutcome(h.deps, outcome);
    expect(outcome.kind).toBe("denied");
    expect(final).toMatchObject({ status: "blocked", reason: "DENIED" });
    expect(h.calls.pay).toHaveLength(0);
  });

  it("refuses an approval that belongs to a different check", async () => {
    const h = await makeHarness({
      challenge: { payTo: PAYEE, amount: hbar(3).units },
    });
    const first = await runCheck(h.deps, INPUT);
    const second = await runCheck(h.deps, INPUT);
    const outcome = await completeApproval(
      h.deps.approval,
      h.issuer.approve(first.approvalUrl as string),
    );
    if (outcome.kind !== "approved") throw new Error("expected approval");
    const result = await settleApproved(
      h.deps,
      second.checkId,
      outcome.attemptId,
    );
    expect(result.reason).toBe("APPROVAL_MISMATCH");
    expect(h.calls.pay).toHaveLength(0);
  });

  it("refuses to settle an unknown check, a missing approval, or an unapproved attempt", async () => {
    const h = await makeHarness({
      challenge: { payTo: PAYEE, amount: hbar(3).units },
    });
    expect(await settleApproved(h.deps, "chk_nope", "att_x")).toMatchObject({
      reason: "UNKNOWN_CHECK",
    });
    const started = await runCheck(h.deps, INPUT);
    expect(
      await settleApproved(h.deps, started.checkId, "att_missing"),
    ).toMatchObject({ reason: "APPROVAL_MISMATCH" });
    const attempt = new URL(started.approvalUrl as string).searchParams.get(
      "state",
    );
    expect(attempt).toBeTruthy();
    const pending = await h.repos.approvals.getByState(attempt as string);
    expect(
      await settleApproved(h.deps, started.checkId, pending?.attemptId ?? ""),
    ).toMatchObject({
      reason: "APPROVAL_NOT_USABLE",
    });
    expect(h.calls.pay).toHaveLength(0);
  });

  it("ignores callbacks that matched no attempt, and unknown checks", async () => {
    const h = await makeHarness();
    expect(
      await handleApprovalOutcome(h.deps, { kind: "unknown_state" }),
    ).toBeNull();
    expect(
      await handleApprovalOutcome(h.deps, {
        kind: "not_pending",
        attemptId: "a",
      }),
    ).toBeNull();
    expect(
      await handleApprovalOutcome(h.deps, {
        kind: "rejected",
        attemptId: "a",
        checkId: "chk_nope",
      }),
    ).toBeNull();
  });
});
