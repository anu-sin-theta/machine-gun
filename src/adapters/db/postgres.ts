/**
 * Postgres repositories over any Drizzle Postgres database: Neon over HTTP in
 * production, PGlite (an in-process Postgres) in the tests. The SQL is the same
 * either way, so the contract suite exercises the real statements, including the
 * atomic compare-and-set and the upserts.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
  Amount,
  ApprovalStatus,
  BoundAction,
  PendingApproval,
} from "@/core";
import type {
  AgentFilter,
  AgentListing,
  AgentStatus,
} from "@/marketplace/types";
import type { AccountRecord, TaskPatch, TaskRecord } from "@/tasks/types";
import {
  accounts,
  agents,
  autoSpendLedger,
  checks,
  pendingApprovals,
  tasks,
  usedNonces,
} from "./schema";
import type {
  AccountsRepo,
  AgentsRepo,
  ApprovalsRepo,
  CheckPatch,
  CheckRecord,
  ChecksRepo,
  NoncesRepo,
  Repositories,
  SpendLedgerRepo,
  TasksRepo,
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

type AgentRow = typeof agents.$inferSelect;

function toAgent(row: AgentRow): AgentListing {
  return {
    id: row.id,
    role: row.role as AgentListing["role"],
    name: row.name,
    description: row.description,
    endpoint: row.endpoint,
    input: row.input as AgentListing["input"],
    payTo: row.payTo,
    priceTinybars: BigInt(row.priceTinybars),
    evidenceSource: row.evidenceSource,
    model: row.model,
    skills: row.skills as string[],
    status: row.status as AgentListing["status"],
    builtIn: row.builtIn,
    createdAt: row.createdAt,
  };
}

class PgAgents implements AgentsRepo {
  constructor(private readonly db: Db) {}

  async create(listing: AgentListing): Promise<boolean> {
    // No conflict target: either unique constraint (id, evidence name) counts as "taken".
    const rows = await this.db
      .insert(agents)
      .values({ ...listing, priceTinybars: listing.priceTinybars.toString() })
      .onConflictDoNothing()
      .returning({ id: agents.id });
    return rows.length === 1;
  }

  async get(id: string): Promise<AgentListing | null> {
    const [row] = await this.db.select().from(agents).where(eq(agents.id, id));
    return row ? toAgent(row) : null;
  }

  async list(filter: AgentFilter = {}): Promise<AgentListing[]> {
    const conditions = [
      filter.role ? eq(agents.role, filter.role) : undefined,
      filter.status ? eq(agents.status, filter.status) : undefined,
      filter.input ? eq(agents.input, filter.input) : undefined,
      filter.skill
        ? sql`${agents.skills} @> ${JSON.stringify([filter.skill])}::jsonb`
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => Boolean(c));
    const rows = await this.db
      .select()
      .from(agents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(agents.createdAt), asc(agents.id));
    return rows.map(toAgent);
  }

  async setStatus(id: string, status: AgentStatus): Promise<boolean> {
    const rows = await this.db
      .update(agents)
      .set({ status })
      .where(eq(agents.id, id))
      .returning({ id: agents.id });
    return rows.length === 1;
  }
}

class PgAccounts implements AccountsRepo {
  constructor(private readonly db: Db) {}

  async create(account: AccountRecord): Promise<boolean> {
    const rows = await this.db
      .insert(accounts)
      .values(account)
      .onConflictDoNothing()
      .returning({ id: accounts.id });
    return rows.length === 1;
  }

  async get(id: string): Promise<AccountRecord | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id));
    return row ? toAccount(row) : null;
  }

  async getByTokenHash(tokenHash: string): Promise<AccountRecord | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.tokenHash, tokenHash));
    return row ? toAccount(row) : null;
  }
}

type AccountRow = typeof accounts.$inferSelect;
const toAccount = (row: AccountRow): AccountRecord => ({
  ...row,
  status: row.status as AccountRecord["status"],
});

type TaskRow = typeof tasks.$inferSelect;
const toTask = (row: TaskRow): TaskRecord => ({
  ...row,
  maxPriceTinybars: BigInt(row.maxPriceTinybars),
  status: row.status as TaskRecord["status"],
  candidates: row.candidates as TaskRecord["candidates"],
  excluded: row.excluded as string[],
  warnings: row.warnings as TaskRecord["warnings"],
  events: row.events as TaskRecord["events"],
});

class PgTasks implements TasksRepo {
  constructor(private readonly db: Db) {}

  async create(task: TaskRecord): Promise<void> {
    await this.db.insert(tasks).values({
      ...task,
      maxPriceTinybars: task.maxPriceTinybars.toString(),
    });
  }

  async get(id: string): Promise<TaskRecord | null> {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id));
    return row ? toTask(row) : null;
  }

  async getByCheckId(checkId: string): Promise<TaskRecord | null> {
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.checkId, checkId));
    return row ? toTask(row) : null;
  }

  async listByAccount(accountId: string, limit: number): Promise<TaskRecord[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.accountId, accountId))
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(limit);
    return rows.map(toTask);
  }

  async update(id: string, patch: TaskPatch): Promise<TaskRecord | null> {
    if (Object.keys(patch).length === 0) return this.get(id);
    const { maxPriceTinybars, ...rest } = patch;
    const rows = await this.db
      .update(tasks)
      .set({
        ...rest,
        ...(maxPriceTinybars !== undefined && {
          maxPriceTinybars: maxPriceTinybars.toString(),
        }),
      })
      .where(eq(tasks.id, id))
      .returning();
    return rows[0] ? toTask(rows[0]) : null;
  }
}

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
    agents: new PgAgents(db),
    accounts: new PgAccounts(db),
    tasks: new PgTasks(db),
    checks: new PgChecks(db),
    approvals: new PgApprovals(db),
    spend: new PgSpend(db),
    nonces: new PgNonces(db),
  };
}
