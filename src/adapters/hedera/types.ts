/**
 * Hedera ports. HCS carries two public logs:
 *  - the audit topic: one tamper-evident record per step of a check
 *  - the reputation topic: outcome reports about payee accounts, which other
 *    checks read back as evidence
 *
 * Messages are small JSON documents (HCS limit 1024 bytes) holding hashes and
 * ids only: never raw payment text, names or links.
 */

import { z } from "zod";
import { isHederaEntityId } from "@/core";

const hederaId = z.string().refine(isHederaEntityId, "not a Hedera id");
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const AUDIT_EVENT_TYPES = [
  "check.received",
  "check.verdict",
  "check.decision",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "payment.settled",
  "payment.blocked",
  "payment.failed",
] as const;

export const auditEventSchema = z.object({
  v: z.literal(1),
  type: z.enum(AUDIT_EVENT_TYPES),
  checkId: z.string().min(1).max(48),
  /** Epoch ms. */
  at: z.number().int().nonnegative(),
  verdictHash: hex64.optional(),
  actionHash: hex64.optional(),
  decision: z.enum(["auto-pay", "step-up", "block"]).optional(),
  /** 0G request ids behind the verdict, for later verification. */
  zgRequestIds: z.array(z.string().max(64)).max(4).optional(),
  /** Evidence names of the verifiers that answered, so evidence can be traced to who sold it. */
  verifiers: z.array(z.string().max(30)).max(6).optional(),
  /** Hedera transaction id of the settlement. */
  txId: z.string().max(80).optional(),
  /** Short machine reason, e.g. "ACTION_CHANGED". */
  detail: z.string().max(100).optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const REPUTATION_OUTCOMES = ["paid-ok", "flagged", "disputed"] as const;

export const reputationReportSchema = z.object({
  v: z.literal(1),
  payee: hederaId,
  checkId: z.string().min(1).max(64),
  outcome: z.enum(REPUTATION_OUTCOMES),
  at: z.number().int().nonnegative(),
});
export type ReputationReport = z.infer<typeof reputationReportSchema>;

export interface SubmitResult {
  topicId: string;
  sequenceNumber: number;
  transactionId: string;
}

/** Submits raw bytes to an HCS topic. The SDK implementation lives in `hcs.ts`. */
export interface TopicSubmitter {
  submit(topicId: string, message: Uint8Array): Promise<SubmitResult>;
}

export interface TopicMessage {
  sequenceNumber: number;
  /** Consensus timestamp, "seconds.nanos". */
  consensusTimestamp: string;
  payload: Uint8Array;
}

export interface MirrorNode {
  listTopicMessages(
    topicId: string,
    options?: { afterSequence?: number; maxMessages?: number },
  ): Promise<TopicMessage[]>;
  /** Account balance in tinybars, or null if the account is unknown. */
  getHbarBalance(accountId: string): Promise<bigint | null>;
}

export type HederaErrorKind =
  | "NOT_CONFIGURED"
  | "INVALID_MESSAGE"
  | "MESSAGE_TOO_LARGE"
  | "SUBMIT_FAILED"
  | "MIRROR_FAILED";

export class HederaError extends Error {
  readonly kind: HederaErrorKind;
  constructor(kind: HederaErrorKind, message: string) {
    super(message);
    this.name = "HederaError";
    this.kind = kind;
  }
}
