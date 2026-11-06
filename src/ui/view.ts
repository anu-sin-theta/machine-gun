/**
 * What the UI shows for one check. Plain JSON (no bigint), so it can cross the
 * server-action boundary and be rendered by server and client components alike.
 */

import type { CheckRecord, CheckStatus } from "@/adapters/db";
import type { AuditEvent } from "@/adapters/hedera";
import { type Decision, formatAmount, type RiskVerdict } from "@/core";

export interface CheckView {
  id: string;
  status: CheckStatus;
  verdict: RiskVerdict | null;
  decision: Decision | null;
  /** e.g. "1.5 HBAR". */
  amount: string | null;
  payee: string | null;
  resource: string | null;
  transactionId: string | null;
  /** Only while the approval is pending. */
  approvalUrl: string | null;
  /** Machine reason when blocked or failed. */
  reason: string | null;
  audit: AuditEvent[];
}

export function toView(
  check: CheckRecord,
  extra: {
    approvalUrl?: string | null;
    reason?: string | null;
    audit?: AuditEvent[];
  } = {},
): CheckView {
  return {
    id: check.id,
    status: check.status,
    verdict: check.verdict,
    decision: check.decision,
    amount: check.amount ? formatAmount(check.amount) : null,
    payee: check.payee,
    resource: check.resource,
    transactionId: check.transactionId,
    approvalUrl: extra.approvalUrl ?? null,
    reason: extra.reason ?? null,
    audit: extra.audit ?? [],
  };
}
