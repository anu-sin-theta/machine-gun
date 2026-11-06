import type { ApprovalStatus, PendingApproval } from "@/core";
import type {
  ApprovalsRepo,
  CheckPatch,
  CheckRecord,
  ChecksRepo,
  NoncesRepo,
  Repositories,
  SpendLedgerRepo,
} from "./types";

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
    checks: new MemoryChecks(),
    approvals: new MemoryApprovals(),
    spend: new MemorySpend(),
    nonces: new MemoryNonces(),
  };
}
