/**
 * Postgres repositories over any Drizzle Postgres database: Neon over HTTP in
 * production, PGlite (an in-process Postgres) in the tests. The SQL is the same
 * either way, so the contract suite exercises the real statements, including the
 * atomic compare-and-set and the upserts.
 */

import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
  Amount,
  ApprovalStatus,
  BoundAction,
  PendingApproval,
} from "@/core";
import {
  autoSpendLedger,
  checks,
  pendingApprovals,
  usedNonces,
} from "./schema";
import type {
  ApprovalsRepo,
  CheckPatch,
  CheckRecord,
  ChecksRepo,
  NoncesRepo,
  Repositories,
  SpendLedgerRepo,
} from "./types";

// biome-ignore lint/suspicious/noExplicitAny: the schema type parameter does not matter here.
type Db = PgDatabase<PgQueryResultHKT, any>;

// --- bigint <-> JSON -------------------------------------------------------

type WireAmount = { asset: Amount["asset"]; units: string };
type WireAction = Omit<BoundAction, "amount"> & { amount: WireAmount };

const toWireAmount = (a: Amount): WireAmount => ({
  asset: a.asset,
  units: a.units.toString(),
});
const fromWireAmount = (w: WireAmount): Amount => ({
  asset: w.asset,
  units: BigInt(w.units),
});

const toWireAction = (a: BoundAction): WireAction => ({
  ...a,
  amount: toWireAmount(a.amount),
});
const fromWireAction = (w: WireAction): BoundAction => ({
  ...w,
  amount: fromWireAmount(w.amount),
});

// --- rows <-> records ------------------------------------------------------

type CheckRow = typeof checks.$inferSelect;
type ApprovalRow = typeof pendingApprovals.$inferSelect;

function toCheck(row: CheckRow): CheckRecord {
  return {
    id: row.id,
    createdAt: row.createdAt,
    inputKind: row.inputKind,
    inputText: row.inputText,
    payee: row.payee,
    resource: row.resource,
    amount: row.amount ? fromWireAmount(row.amount as WireAmount) : null,
    verdict: row.verdict as CheckRecord["verdict"],
    verdictHash: row.verdictHash,
    decision: row.decision as CheckRecord["decision"],
    transactionId: row.transactionId,
    status: row.status as CheckRecord["status"],
  };
}

function toApproval(row: ApprovalRow): PendingApproval {
  return {
    attemptId: row.attemptId,
    state: row.state,
    nonce: row.nonce,
    action: fromWireAction(row.action as WireAction),
    actionHash: row.actionHash,
    tier: row.tier as PendingApproval["tier"],
    requiredAcr: row.requiredAcr as PendingApproval["requiredAcr"],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    subjectBinding: row.subjectBinding as PendingApproval["subjectBinding"],
    status: row.status as ApprovalStatus,
  };
}

// --- repositories ----------------------------------------------------------

class PgChecks implements ChecksRepo {
  constructor(private readonly db: Db) {}

  async create(check: CheckRecord): Promise<void> {
    await this.db.insert(checks).values({
      ...check,
      amount: check.amount ? toWireAmount(check.amount) : null,
    });
  }

  async get(id: string): Promise<CheckRecord | null> {
    const [row] = await this.db.select().from(checks).where(eq(checks.id, id));
    return row ? toCheck(row) : null;
  }

  async update(id: string, patch: CheckPatch): Promise<CheckRecord | null> {
    const { amount, ...rest } = patch;
    const set = {
      ...rest,
      ...(amount !== undefined && {
        amount: amount ? toWireAmount(amount) : null,
      }),
    };
    if (Object.keys(set).length === 0) return this.get(id);
    const [row] = await this.db
      .update(checks)
      .set(set)
      .where(eq(checks.id, id))
      .returning();
    return row ? toCheck(row) : null;
  }
}

class PgApprovals implements ApprovalsRepo {
  constructor(private readonly db: Db) {}

  async create(a: PendingApproval): Promise<void> {
    await this.db.insert(pendingApprovals).values({
      ...a,
      action: toWireAction(a.action),
    });
  }

  async getById(attemptId: string): Promise<PendingApproval | null> {
    const [row] = await this.db
      .select()
      .from(pendingApprovals)
      .where(eq(pendingApprovals.attemptId, attemptId));
    return row ? toApproval(row) : null;
  }

  async getByState(state: string): Promise<PendingApproval | null> {
    const [row] = await this.db
      .select()
      .from(pendingApprovals)
      .where(eq(pendingApprovals.state, state));
    return row ? toApproval(row) : null;
  }

  async transition(
    attemptId: string,
    from: ApprovalStatus,
    to: ApprovalStatus,
  ): Promise<boolean> {
    // One conditional UPDATE: only one concurrent caller sees a returned row.
    const rows = await this.db
      .update(pendingApprovals)
      .set({ status: to })
      .where(
        and(
          eq(pendingApprovals.attemptId, attemptId),
          eq(pendingApprovals.status, from),
        ),
      )
      .returning({ id: pendingApprovals.attemptId });
    return rows.length === 1;
  }
}

class PgSpend implements SpendLedgerRepo {
  constructor(private readonly db: Db) {}

  async get(day: string, assetKey: string): Promise<bigint> {
    const [row] = await this.db
      .select({ units: autoSpendLedger.units })
      .from(autoSpendLedger)
      .where(
        and(
          eq(autoSpendLedger.day, day),
          eq(autoSpendLedger.assetKey, assetKey),
        ),
      );
    return row ? BigInt(row.units) : 0n;
  }

  async add(day: string, assetKey: string, units: bigint): Promise<bigint> {
    if (units < 0n) throw new RangeError("units must be >= 0");
    const [row] = await this.db
      .insert(autoSpendLedger)
      .values({ day, assetKey, units: units.toString() })
      .onConflictDoUpdate({
        target: [autoSpendLedger.day, autoSpendLedger.assetKey],
        set: {
          units: sql`${autoSpendLedger.units} + ${units.toString()}::numeric`,
        },
      })
      .returning({ units: autoSpendLedger.units });
    if (!row) throw new Error("spend upsert returned no row");
    return BigInt(row.units);
  }
}

class PgNonces implements NoncesRepo {
  constructor(private readonly db: Db) {}

  async markUsed(nonce: string, now: number): Promise<boolean> {
    const rows = await this.db
      .insert(usedNonces)
      .values({ nonce, usedAt: now })
      .onConflictDoNothing()
      .returning({ nonce: usedNonces.nonce });
    return rows.length === 1;
  }
}

export function createPostgresRepositories(db: Db): Repositories {
  return {
    checks: new PgChecks(db),
    approvals: new PgApprovals(db),
    spend: new PgSpend(db),
    nonces: new PgNonces(db),
  };
}
