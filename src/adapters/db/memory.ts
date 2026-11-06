import type { ApprovalStatus, PendingApproval } from "@/core";
import type {
  AgentFilter,
  AgentListing,
  AgentStatus,
} from "@/marketplace/types";
import type { AccountRecord, TaskPatch, TaskRecord } from "@/tasks/types";
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

class MemoryAgents implements AgentsRepo {
  private readonly rows = new Map<string, AgentListing>();

  async create(listing: AgentListing): Promise<boolean> {
    if (this.rows.has(listing.id)) return false;
    for (const row of this.rows.values())
      if (row.evidenceSource === listing.evidenceSource) return false;
    this.rows.set(listing.id, structuredClone(listing));
    return true;
  }

  async get(id: string): Promise<AgentListing | null> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async list(filter: AgentFilter = {}): Promise<AgentListing[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          (!filter.role || r.role === filter.role) &&
          (!filter.status || r.status === filter.status) &&
          (!filter.input || r.input === filter.input) &&
          (!filter.skill || r.skills.includes(filter.skill)),
      )
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((r) => structuredClone(r));
  }

  async setStatus(id: string, status: AgentStatus): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    row.status = status;
    return true;
  }
}

class MemoryAccounts implements AccountsRepo {
  private readonly rows = new Map<string, AccountRecord>();

  async create(account: AccountRecord): Promise<boolean> {
    if (this.rows.has(account.id)) return false;
    for (const row of this.rows.values())
      if (row.tokenHash === account.tokenHash) return false;
    this.rows.set(account.id, structuredClone(account));
    return true;
  }

  async get(id: string): Promise<AccountRecord | null> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async getByTokenHash(tokenHash: string): Promise<AccountRecord | null> {
    for (const row of this.rows.values())
      if (row.tokenHash === tokenHash) return structuredClone(row);
    return null;
  }
}

class MemoryTasks implements TasksRepo {
  private readonly rows = new Map<string, TaskRecord>();

  async create(task: TaskRecord): Promise<void> {
    if (this.rows.has(task.id)) throw new Error(`duplicate task ${task.id}`);
    this.rows.set(task.id, structuredClone(task));
  }

  async get(id: string): Promise<TaskRecord | null> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async getByCheckId(checkId: string): Promise<TaskRecord | null> {
    for (const row of this.rows.values())
      if (row.checkId === checkId) return structuredClone(row);
    return null;
  }

  async listByAccount(accountId: string, limit: number): Promise<TaskRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.accountId === accountId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  async update(id: string, patch: TaskPatch): Promise<TaskRecord | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const next = { ...row, ...structuredClone(patch) };
    this.rows.set(id, next);
    return structuredClone(next);
  }
}

class MemoryChecks implements ChecksRepo {
  private readonly rows = new Map<string, CheckRecord>();

  async create(check: CheckRecord): Promise<void> {
    if (this.rows.has(check.id)) throw new Error(`duplicate check ${check.id}`);
    this.rows.set(check.id, structuredClone(check));
  }

  async get(id: string): Promise<CheckRecord | null> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async update(id: string, patch: CheckPatch): Promise<CheckRecord | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const next = { ...row, ...structuredClone(patch) };
    this.rows.set(id, next);
    return structuredClone(next);
  }
}

class MemoryApprovals implements ApprovalsRepo {
  private readonly rows = new Map<string, PendingApproval>();

  async create(approval: PendingApproval): Promise<void> {
    if (this.rows.has(approval.attemptId))
      throw new Error(`duplicate attempt ${approval.attemptId}`);
    for (const row of this.rows.values())
      if (row.state === approval.state) throw new Error("duplicate state");
    this.rows.set(approval.attemptId, structuredClone(approval));
  }

  async getById(attemptId: string): Promise<PendingApproval | null> {
    const row = this.rows.get(attemptId);
    return row ? structuredClone(row) : null;
  }

  async getByState(state: string): Promise<PendingApproval | null> {
    for (const row of this.rows.values())
      if (row.state === state) return structuredClone(row);
    return null;
  }

  async transition(
    attemptId: string,
    from: ApprovalStatus,
    to: ApprovalStatus,
  ): Promise<boolean> {
    const row = this.rows.get(attemptId);
    if (!row || row.status !== from) return false;
    row.status = to;
    return true;
  }
}

class MemorySpend implements SpendLedgerRepo {
  private readonly totals = new Map<string, bigint>();

  async get(day: string, assetKey: string): Promise<bigint> {
    return this.totals.get(`${day}|${assetKey}`) ?? 0n;
  }

  async add(day: string, assetKey: string, units: bigint): Promise<bigint> {
    if (units < 0n) throw new RangeError("units must be >= 0");
    const key = `${day}|${assetKey}`;
    const next = (this.totals.get(key) ?? 0n) + units;
    this.totals.set(key, next);
    return next;
  }
}

class MemoryNonces implements NoncesRepo {
  private readonly seen = new Set<string>();

  async markUsed(nonce: string): Promise<boolean> {
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    return true;
  }
}

export function createMemoryRepositories(): Repositories {
  return {
    agents: new MemoryAgents(),
    accounts: new MemoryAccounts(),
    tasks: new MemoryTasks(),
    checks: new MemoryChecks(),
    approvals: new MemoryApprovals(),
    spend: new MemorySpend(),
    nonces: new MemoryNonces(),
  };
}
