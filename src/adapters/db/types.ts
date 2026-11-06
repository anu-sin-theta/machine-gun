/**
 * Persistence ports. The app depends on these interfaces only; `memory.ts` is
 * the in-memory fake used by tests and `neon.ts` is the Postgres adapter.
 * Both must pass the shared contract suite in tests/contract.
 *
 * Atomicity lives here, not in the core: `consumeApproval` is the pure state
 * transition, and `ApprovalsRepo.transition` is the compare-and-set that stops
 * two concurrent callbacks from both paying.
 */

import type {
  Amount,
  ApprovalStatus,
  Decision,
  PendingApproval,
  RiskVerdict,
} from "@/core";

export type CheckStatus =
  | "received"
  | "verdict"
  | "awaiting-approval"
  | "paid"
  | "blocked"
  | "failed";

export interface CheckRecord {
  id: string;
  createdAt: number;
  /** What the user submitted: "text" | "link" | "image" | "x402". */
  inputKind: string;
  /** Raw text or URL; images are not stored. */
  inputText: string | null;
  payee: string | null;
  resource: string | null;
  amount: Amount | null;
  verdict: RiskVerdict | null;
  verdictHash: string | null;
  decision: Decision | null;
  /** Hedera transaction id of the settlement, once paid. */
  transactionId: string | null;
  status: CheckStatus;
}

export type CheckPatch = Partial<Omit<CheckRecord, "id" | "createdAt">>;

export interface ChecksRepo {
  create(check: CheckRecord): Promise<void>;
  get(id: string): Promise<CheckRecord | null>;
  /** Returns the updated record, or null if the id is unknown. */
  update(id: string, patch: CheckPatch): Promise<CheckRecord | null>;
}

export interface ApprovalsRepo {
  /** Throws if `attemptId` or `state` already exists (state is unique). */
  create(approval: PendingApproval): Promise<void>;
  getById(attemptId: string): Promise<PendingApproval | null>;
  getByState(state: string): Promise<PendingApproval | null>;
  /**
   * Atomic compare-and-set on status. Returns true only for the single caller
   * that moved the row from `from` to `to`.
   */
  transition(
    attemptId: string,
    from: ApprovalStatus,
    to: ApprovalStatus,
  ): Promise<boolean>;
}

export interface SpendLedgerRepo {
  /** Auto-spent so far on `day` (UTC, YYYY-MM-DD) in `assetKey`. */
  get(day: string, assetKey: string): Promise<bigint>;
  /** Atomically adds `units` and returns the new total. */
  add(day: string, assetKey: string, units: bigint): Promise<bigint>;
}

export interface NoncesRepo {
  /** True the first time a nonce is seen, false on every replay. */
  markUsed(nonce: string, now: number): Promise<boolean>;
}

export interface Repositories {
  checks: ChecksRepo;
  approvals: ApprovalsRepo;
  spend: SpendLedgerRepo;
  nonces: NoncesRepo;
}

/** UTC calendar day used as the spend-ledger key. */
export function utcDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
