import { describe, expect, it } from "vitest";
import type { CheckRecord } from "@/adapters/db";
import { type Decision, hbar } from "@/core";
import {
  AUDIT_LABEL,
  explainDecision,
  explainOutcome,
  explainReason,
  hashscanUrl,
  riskTone,
  STATUS_LABEL,
  safeReasonCode,
  statusTone,
  TIER_LABEL,
} from "@/ui/explain";
import { toView } from "@/ui/view";

describe("explainReason", () => {
  it("turns policy, pipeline and approval codes into sentences", () => {
    expect(explainReason("OVER_HARD_CAP")).toMatch(/largest payment/);
    expect(explainReason("INSUFFICIENT_ASSURANCE")).toMatch(
      /not strong enough/,
    );
    expect(explainReason("DENIED")).toMatch(/declined/);
    expect(explainReason("RESOURCE_NOT_PAYABLE")).toMatch(/nothing was paid/);
  });

  it("passes unknown text through unchanged (React escapes it)", () => {
    expect(explainReason("PAYEE: request names 0.0.1")).toBe(
      "PAYEE: request names 0.0.1",
    );
  });
});

describe("explainDecision", () => {
  it("describes each kind of decision", () => {
    expect(explainDecision({ kind: "auto-pay", reasons: [] }).headline).toBe(
      "Paid on its own",
    );
    expect(explainDecision({ kind: "block", reasons: [] }).headline).toBe(
      "Blocked",
    );
    const human = explainDecision({
      kind: "step-up",
      tier: "human",
      blockedByDefault: false,
      reasons: [],
    });
    expect(human.headline).toBe("Needs your approval");
    expect(human.detail).toContain(TIER_LABEL.human);
  });

  it("says a high-risk step-up is blocked unless overridden, naming the strong tier", () => {
    const d = explainDecision({
      kind: "step-up",
      tier: "strong",
      blockedByDefault: true,
      reasons: [],
    });
    expect(d.headline).toBe("Blocked unless you override");
    expect(d.detail).toContain("Orb + face");
  });
});

describe("explainOutcome", () => {
  const stepUp: Decision = {
    kind: "step-up",
    tier: "strong",
    blockedByDefault: true,
    reasons: [],
  };

  it("describes the result, not the earlier hold, once the check has ended", () => {
    expect(explainOutcome({ status: "paid", decision: stepUp })?.headline).toBe(
      "Paid after your approval",
    );
    expect(
      explainOutcome({ status: "blocked", decision: stepUp })?.headline,
    ).toBe("Not paid");
    expect(
      explainOutcome({
        status: "failed",
        decision: { kind: "auto-pay", reasons: [] },
      })?.headline,
    ).toBe("Not completed");
  });

  it("keeps the decision wording while the check is open or settled on its own", () => {
    expect(
      explainOutcome({ status: "awaiting-approval", decision: stepUp })
        ?.headline,
    ).toBe("Blocked unless you override");
    expect(
      explainOutcome({
        status: "paid",
        decision: { kind: "auto-pay", reasons: [] },
      })?.headline,
    ).toBe("Paid on its own");
    expect(
      explainOutcome({
        status: "blocked",
        decision: { kind: "block", reasons: [] },
      })?.headline,
    ).toBe("Blocked");
  });

  it("says nothing when there is no decision yet", () => {
    expect(explainOutcome({ status: "failed", decision: null })).toBeNull();
  });
});

describe("tones and labels", () => {
  it("colours statuses and risk levels", () => {
    expect(statusTone("paid")).toBe("good");
    expect(statusTone("awaiting-approval")).toBe("warn");
    expect(statusTone("blocked")).toBe("bad");
    expect(statusTone("failed")).toBe("bad");
    expect(statusTone("received")).toBe("neutral");
    expect(riskTone("low")).toBe("good");
    expect(riskTone("medium")).toBe("warn");
    expect(riskTone("high")).toBe("bad");
  });

  it("labels every check status and every audit event the pipeline writes", () => {
    for (const s of [
      "received",
      "verdict",
      "awaiting-approval",
      "paid",
      "blocked",
      "failed",
    ] as const)
      expect(STATUS_LABEL[s]).toBeTruthy();
    for (const t of [
      "check.received",
      "check.verdict",
      "check.decision",
      "approval.requested",
      "approval.approved",
      "approval.rejected",
      "payment.settled",
      "payment.blocked",
      "payment.failed",
    ])
      expect(AUDIT_LABEL[t]).toBeTruthy();
  });
});

describe("hashscanUrl", () => {
  it("links the network's explorer and encodes the transaction id", () => {
    expect(hashscanUrl("0.0.1001@1700000000.123456789", "testnet")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.1001%401700000000.123456789",
    );
    expect(hashscanUrl("x/../y", "mainnet")).toBe(
      "https://hashscan.io/mainnet/transaction/x%2F..%2Fy",
    );
  });
});

describe("safeReasonCode", () => {
  it("accepts only the shape of codes we produce", () => {
    expect(safeReasonCode("INSUFFICIENT_ASSURANCE")).toBe(
      "INSUFFICIENT_ASSURANCE",
    );
    for (const bad of [
      null,
      undefined,
      "",
      "lowercase",
      "<script>",
      "HAS SPACE",
      "A",
      "X".repeat(60),
      "A1_B2",
    ])
      expect(safeReasonCode(bad)).toBeNull();
  });
});

describe("toView", () => {
  const base: CheckRecord = {
    id: "chk_1",
    createdAt: 0,
    inputKind: "text",
    inputText: "secret invoice text",
    payee: "0.0.5001",
    resource: "https://m.test/r",
    amount: hbar(2),
    verdict: { level: "low", reasons: ["fine"] },
    verdictHash: "a".repeat(64),
    decision: { kind: "auto-pay", reasons: ["RISK_LOW"] },
    transactionId: "0.0.1@1.1",
    status: "paid",
  };

  it("formats money exactly, carries extras, and never includes the input text", () => {
    const view = toView(base, {
      approvalUrl: "https://w/x",
      reason: "R_X",
      audit: [],
    });
    expect(view).toMatchObject({
      id: "chk_1",
      amount: "2 HBAR",
      payee: "0.0.5001",
      transactionId: "0.0.1@1.1",
      approvalUrl: "https://w/x",
      reason: "R_X",
    });
    expect(JSON.stringify(view)).not.toContain("secret invoice text");
  });

  it("defaults the optional parts to null and empty", () => {
    const view = toView({ ...base, amount: null, transactionId: null });
    expect(view).toMatchObject({
      amount: null,
      transactionId: null,
      approvalUrl: null,
      reason: null,
      audit: [],
    });
  });

  it("survives JSON, so it can cross the server-action boundary", () => {
    expect(JSON.parse(JSON.stringify(toView(base)))).toEqual(toView(base));
  });
});
