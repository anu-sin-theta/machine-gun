/**
 * Behaviour every `Repositories` implementation must have. Run against the
 * in-memory fake always, and against Neon with LIVE=1 (tests/live).
 */

import { describe, expect, it } from "vitest";
import { type CheckRecord, type Repositories, utcDay } from "@/adapters/db";
import { createPendingApproval, hbar } from "@/core";
import type { AgentListing } from "@/marketplace/types";
import type { AccountRecord, TaskRecord } from "@/tasks/types";
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
    describe("agents", () => {
      /** Unique per call, so tests do not collide in a shared database. */
      const fresh = (over: Partial<AgentListing> = {}): AgentListing => {
        const n = uid();
        return {
          id: `agent-${n}`,
          role: "verifier",
          name: "Test verifier",
          description: "For the contract suite.",
          endpoint: "https://verifier.example/api/check",
          input: "link",
          payTo: "0.0.7001",
          priceTinybars: 2_000_000n,
          evidenceSource: `src-${n}`,
          model: null,
          skills: [],
          status: "active",
          builtIn: false,
          createdAt: T0,
          ...over,
        };
      };

      it("round-trips a listing exactly, including prices beyond 2^53 and a merchant with no input", async () => {
        const { agents } = create();
        const verifier = fresh({ priceTinybars: 9007199254740993n });
        const merchant = fresh({
          role: "merchant",
          input: null,
          builtIn: true,
        });
        expect(await agents.create(verifier)).toBe(true);
        expect(await agents.create(merchant)).toBe(true);
        expect(await agents.get(verifier.id)).toEqual(verifier);
        expect(await agents.get(merchant.id)).toEqual(merchant);
      });

      it("returns null for an unknown id", async () => {
        expect(await create().agents.get("agent-missing")).toBeNull();
      });

      it("refuses a duplicate id and a duplicate evidence name, and keeps the original", async () => {
        const { agents } = create();
        const original = fresh();
        expect(await agents.create(original)).toBe(true);
        expect(await agents.create({ ...original, name: "Overwrite" })).toBe(
          false,
        );
        expect(
          await agents.create(
            fresh({ evidenceSource: original.evidenceSource }),
          ),
        ).toBe(false);
        expect(await agents.get(original.id)).toEqual(original);
      });

      it("lists by role, status and input, oldest first and stable", async () => {
        const { agents } = create();
        const tag = uid();
        const mk = (suffix: string, over: Partial<AgentListing>) =>
          fresh({
            id: `agent-${tag}-${suffix}`,
            evidenceSource: `src-${tag}-${suffix}`,
            ...over,
          });
        const a = mk("a", { createdAt: T0 + 2, input: "link" });
        const b = mk("b", { createdAt: T0 + 1, input: "payee" });
        const c = mk("c", {
          createdAt: T0 + 1,
          input: "link",
          status: "suspended",
        });
        const m = mk("d", { createdAt: T0 + 3, role: "merchant", input: null });
        for (const l of [a, b, c, m]) await agents.create(l);

        const mine = async (filter?: Parameters<typeof agents.list>[0]) =>
          (await agents.list(filter))
            .filter((l) => l.id.startsWith(`agent-${tag}-`))
            .map((l) => l.id.slice(-1));

        expect(await mine()).toEqual(["b", "c", "a", "d"]); // by createdAt, then id
        expect(await mine({ role: "verifier" })).toEqual(["b", "c", "a"]);
        expect(await mine({ role: "merchant" })).toEqual(["d"]);
        expect(await mine({ status: "active" })).toEqual(["b", "a", "d"]);
        expect(await mine({ status: "suspended" })).toEqual(["c"]);
        expect(await mine({ input: "link" })).toEqual(["c", "a"]);
        expect(
          await mine({ role: "verifier", status: "active", input: "link" }),
        ).toEqual(["a"]);
        expect(await mine({ role: "merchant", input: "link" })).toEqual([]);
      });

      it("changes status and reports whether the agent existed", async () => {
        const { agents } = create();
        const listing = fresh();
        await agents.create(listing);
        expect(await agents.setStatus(listing.id, "suspended")).toBe(true);
        expect((await agents.get(listing.id))?.status).toBe("suspended");
        expect(await agents.setStatus(listing.id, "active")).toBe(true);
        expect((await agents.get(listing.id))?.status).toBe("active");
        expect(await agents.setStatus("agent-missing", "suspended")).toBe(
          false,
        );
      });

      it("lets exactly one of many concurrent registrations of the same agent win", async () => {
        const { agents } = create();
        const listing = fresh();
        const results = await Promise.all(
          Array.from({ length: 6 }, () => agents.create(listing)),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
      });
    });

    describe("agents: workers", () => {
      it("stores a worker's model and skills, and finds workers by skill", async () => {
        const repos = create();
        const n = uid();
        const worker: AgentListing = {
          id: `worker-${n}`,
          role: "worker",
          name: "Writer",
          description: "Writes.",
          endpoint: "https://writer.example/v1",
          input: null,
          payTo: "0.0.7001",
          priceTinybars: 3_000_000n,
          evidenceSource: `w-${n}`,
          model: "writer-large",
          skills: [`skill-${n}`, "shared-skill"],
          status: "active",
          builtIn: false,
          createdAt: T0,
        };
        expect(await repos.agents.create(worker)).toBe(true);
        expect(await repos.agents.get(worker.id)).toEqual(worker);
        expect(
          (await repos.agents.list({ skill: `skill-${n}` })).map((a) => a.id),
        ).toEqual([worker.id]);
        expect(
          await repos.agents.list({ role: "worker", skill: `none-${n}` }),
        ).toEqual([]);
      });
    });

    describe("accounts", () => {
      const account = (): AccountRecord => {
        const n = uid();
        return {
          id: `acct_${n}`,
          name: "buyer",
          tokenHash: `hash_${n}`,
          status: "active",
          createdAt: T0,
        };
      };

      it("creates, finds by id and by token hash", async () => {
        const repos = create();
        const a = account();
        expect(await repos.accounts.create(a)).toBe(true);
        expect(await repos.accounts.get(a.id)).toEqual(a);
        expect(await repos.accounts.getByTokenHash(a.tokenHash)).toEqual(a);
        expect(await repos.accounts.get("acct_missing")).toBeNull();
        expect(await repos.accounts.getByTokenHash("nope")).toBeNull();
      });

      it("refuses a taken id or token hash", async () => {
        const repos = create();
        const a = account();
        await repos.accounts.create(a);
        expect(await repos.accounts.create({ ...a, tokenHash: "other" })).toBe(
          false,
        );
        expect(await repos.accounts.create({ ...a, id: `acct_${uid()}` })).toBe(
          false,
        );
      });
    });

    describe("tasks", () => {
      const task = (accountId: string, createdAt = T0): TaskRecord => ({
        id: `task_${uid()}`,
        accountId,
        workerId: null,
        prompt: "Summarise.",
        skill: "summarize",
        requestedAgentId: null,
        maxPriceTinybars: 9007199254740993n,
        status: "awaiting-choice",
        candidates: [
          {
            workerId: "kavach-scribe",
            name: "Scribe",
            model: "m",
            skills: ["summarize"],
            priceTinybars: "10000000",
            builtIn: true,
            recommended: true,
          },
        ],
        excluded: ["someone"],
        checkId: null,
        approvalUrl: null,
        output: null,
        warnings: [],
        events: [{ at: createdAt, type: "task.created" }],
        createdAt,
        updatedAt: createdAt,
      });

      it("round-trips a task, keeping a big price exact", async () => {
        const repos = create();
        const t = task(`acct_${uid()}`);
        await repos.tasks.create(t);
        expect(await repos.tasks.get(t.id)).toEqual(t);
        expect(await repos.tasks.get("task_missing")).toBeNull();
      });

      it("updates fields, finds a task by its check, and lists an account's tasks newest first", async () => {
        const repos = create();
        const owner = `acct_${uid()}`;
        const older = task(owner, T0);
        const newer = task(owner, T0 + 1);
        const other = task(`acct_${uid()}`, T0 + 2);
        for (const t of [older, newer, other]) await repos.tasks.create(t);

        const checkId = `chk_${uid()}`;
        const updated = await repos.tasks.update(older.id, {
          status: "completed",
          workerId: "kavach-scribe",
          maxPriceTinybars: 20_000_000n,
          prompt: "Edited.",
          candidates: [],
          excluded: ["a", "b"],
          checkId,
          output: "done",
          warnings: [
            { url: "http://x.example", level: "high", signals: ["A"] },
          ],
          events: [
            ...older.events,
            { at: T0 + 5, type: "task.completed", detail: "d" },
          ],
          updatedAt: T0 + 5,
        });
        expect(updated).toMatchObject({
          workerId: "kavach-scribe",
          maxPriceTinybars: 20_000_000n,
          prompt: "Edited.",
          candidates: [],
          excluded: ["a", "b"],
          status: "completed",
          output: "done",
          checkId,
        });
        expect(updated?.events).toHaveLength(2);
        expect(await repos.tasks.getByCheckId(checkId)).toEqual(updated);
        expect(await repos.tasks.getByCheckId("chk_missing")).toBeNull();
        expect(await repos.tasks.update(older.id, {})).toEqual(updated);
        expect(
          await repos.tasks.update("task_missing", { status: "failed" }),
        ).toBeNull();

        expect(
          (await repos.tasks.listByAccount(owner, 10)).map((t) => t.id),
        ).toEqual([newer.id, older.id]);
        expect(await repos.tasks.listByAccount(owner, 1)).toHaveLength(1);
      });
    });

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
