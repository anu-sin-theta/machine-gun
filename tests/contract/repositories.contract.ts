/**
 * Behaviour every `Repositories` implementation must have. Run against the
 * in-memory fake always, and against Neon with LIVE=1 (tests/live).
 */

import { describe, expect, it } from "vitest";
import { type CheckRecord, type Repositories, utcDay } from "@/adapters/db";
import { createPendingApproval, hbar } from "@/core";
import { demoAction, T0 } from "../unit/core/fixtures";

const uid = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");

function makeApproval(over: { attemptId?: string; state?: string } = {}) {
  const id = uid();
  return createPendingApproval({
    attemptId: over.attemptId ?? `att_${id}`,
    state: over.state ?? `state_${id}${id}`,
    nonce: `nonce_${id}${id}`,
    action: demoAction({ checkId: `chk_${id}` }),
    tier: "human",
    now: T0,
    ttlMs: 600_000,
  });
}

function makeCheck(): CheckRecord {
  return {
    id: `chk_${uid()}`,
    createdAt: T0,
    inputKind: "link",
    inputText: "https://example.com/pay",
    payee: "0.0.5001",
    resource: null,
    amount: null,
    verdict: null,
    verdictHash: null,
    decision: null,
    transactionId: null,
    status: "received",
  };
}

export function repositoryContract(
  name: string,
  create: () => Repositories,
): void {
  describe(`${name} repositories`, () => {
    describe("checks", () => {
      it("round-trips a record, including bigint amounts", async () => {
        const { checks } = create();
        const base = makeCheck();
        await checks.create(base);
        expect(await checks.get(base.id)).toEqual(base);

        const amount = { ...hbar(1), units: 9007199254740993n };
        const updated = await checks.update(base.id, {
          amount,
          verdict: { level: "high", reasons: ["lookalike"] },
          verdictHash: "a".repeat(64),
          decision: { kind: "block", reasons: ["OVER_HARD_CAP"] },
          status: "blocked",
        });
        expect(updated?.amount?.units).toBe(9007199254740993n);
        expect(await checks.get(base.id)).toEqual(updated);
      });

      it("returns null for unknown ids and rejects duplicates", async () => {
        const { checks } = create();
        expect(await checks.get("chk_missing")).toBeNull();
        expect(
          await checks.update("chk_missing", { status: "failed" }),
        ).toBeNull();
        const base = makeCheck();
        await checks.create(base);
        await expect(checks.create(base)).rejects.toThrow();
      });

      it("keeps untouched fields when patching", async () => {
        const { checks } = create();
        const base = makeCheck();
        await checks.create(base);
        const updated = await checks.update(base.id, { status: "verdict" });
        expect(updated).toEqual({ ...base, status: "verdict" });
      });
    });

    describe("approvals", () => {
      it("round-trips a pending approval by id and by state", async () => {
        const { approvals } = create();
        const a = makeApproval();
        await approvals.create(a);
        expect(await approvals.getById(a.attemptId)).toEqual(a);
        expect(await approvals.getByState(a.state)).toEqual(a);
        expect(
          (await approvals.getById(a.attemptId))?.action.amount.units,
        ).toBe(a.action.amount.units);
      });

      it("returns null for unknown ids and states", async () => {
        const { approvals } = create();
        expect(await approvals.getById("att_missing")).toBeNull();
        expect(await approvals.getByState("state_missing_xxxxxxx")).toBeNull();
      });

      it("rejects a duplicate attempt id or a duplicate state", async () => {
        const { approvals } = create();
        const a = makeApproval();
        await approvals.create(a);
        await expect(approvals.create(a)).rejects.toThrow();
        await expect(
          approvals.create(makeApproval({ state: a.state })),
        ).rejects.toThrow();
      });

      it("transitions only from the expected status", async () => {
        const { approvals } = create();
        const a = makeApproval();
        await approvals.create(a);
        expect(
          await approvals.transition(a.attemptId, "approved", "consumed"),
        ).toBe(false);
        expect(
          await approvals.transition(a.attemptId, "pending", "approved"),
        ).toBe(true);
        expect((await approvals.getById(a.attemptId))?.status).toBe("approved");
        expect(
          await approvals.transition("att_missing", "pending", "approved"),
        ).toBe(false);
      });

      it("lets exactly one of many concurrent callers consume an approval", async () => {
        const { approvals } = create();
        const a = makeApproval();
        await approvals.create(a);
        await approvals.transition(a.attemptId, "pending", "approved");
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            approvals.transition(a.attemptId, "approved", "consumed"),
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await approvals.getById(a.attemptId))?.status).toBe("consumed");
      });
    });

    describe("spend ledger", () => {
      it("starts at zero and accumulates per day and asset", async () => {
        const { spend } = create();
        const day = utcDay(T0);
        const asset = `HBAR-${uid()}`;
        expect(await spend.get(day, asset)).toBe(0n);
        expect(await spend.add(day, asset, 100n)).toBe(100n);
        expect(await spend.add(day, asset, 50n)).toBe(150n);
        expect(await spend.get(day, asset)).toBe(150n);
        expect(await spend.get("2026-11-07", asset)).toBe(0n);
        expect(await spend.get(day, `${asset}-other`)).toBe(0n);
      });

      it("never loses concurrent additions and handles values beyond 2^53", async () => {
        const { spend } = create();
        const asset = `HBAR-${uid()}`;
        const big = 9007199254740993n;
        await Promise.all(
          Array.from({ length: 10 }, () => spend.add("2026-11-06", asset, big)),
        );
        expect(await spend.get("2026-11-06", asset)).toBe(big * 10n);
      });

      it("rejects negative additions", async () => {
        const { spend } = create();
        await expect(spend.add("2026-11-06", "HBAR", -1n)).rejects.toThrow(
          RangeError,
        );
      });
    });

    describe("nonces", () => {
      it("accepts a nonce once and rejects every replay", async () => {
        const { nonces } = create();
        const nonce = `nonce_${uid()}${uid()}`;
        expect(await nonces.markUsed(nonce, T0)).toBe(true);
        expect(await nonces.markUsed(nonce, T0)).toBe(false);
        expect(await nonces.markUsed(`${nonce}x`, T0)).toBe(true);
      });

      it("lets exactly one concurrent caller win", async () => {
        const { nonces } = create();
        const nonce = `nonce_${uid()}${uid()}`;
        const results = await Promise.all(
          Array.from({ length: 8 }, () => nonces.markUsed(nonce, T0)),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
      });
    });
  });
}
