/**
 * The agent loop's ports. The pipeline depends only on these, so it runs in
 * tests with fakes and in production with the 0G, Hedera, x402 and World
 * adapters wired in `index.ts`.
 */

import { z } from "zod";
import type { CheckStatus, Repositories } from "@/adapters/db";
import type { HcsLogs } from "@/adapters/hedera";
import type { ApprovalDeps } from "@/adapters/world";
import type { Evidence, ZeroG } from "@/adapters/zerog";
import type { Decision, PolicyConfig, RiskVerdict } from "@/core";
import type { AgentListing, Subject } from "@/marketplace/types";

export const checkInputSchema = z.object({
  /** The payment request as the user received it: invoice text, message, note. */
  text: z.string().min(1).max(4000),
  /** x402 URL of the thing to be paid for. Its 402 challenge defines payee and amount. */
  resource: z.url().max(2000),
});
export type CheckInput = z.infer<typeof checkInputSchema>;

/** What the merchant's own 402 challenge says will be signed: the only source of payee and amount. */
export interface Challenge {
  payTo: string;
  /** HBAR tinybars. */
  amount: bigint;
}

export interface ResourceProbe {
  /** Throws `AgentError("RESOURCE_NOT_PAYABLE")` unless the URL answers with a usable HBAR challenge. */
  challenge(resourceUrl: string): Promise<Challenge>;
}

/**
 * The agent's paid evidence market. `list` says which registered verifiers to
 * consult for a kind of question (the directory already picked them: active,
 * cheapest first, within budget); `call` pays one and returns its evidence
 * under that verifier's own name.
 */
export interface VerifierNetwork {
  list(kind: Subject["kind"]): Promise<AgentListing[]>;
  call(verifier: AgentListing, subject: Subject): Promise<Evidence>;
}

export interface MerchantPayer {
  /** Pays the challenge and returns the settlement transaction id if the server reports one. */
  pay(
    resourceUrl: string,
    challenge: Challenge,
  ): Promise<{ transactionId?: string }>;
}

export type AuditLog = Pick<HcsLogs, "recordAudit" | "reportPayee">;

export interface AgentDeps {
  repos: Repositories;
  zerog: ZeroG;
  verifiers: VerifierNetwork;
  probe: ResourceProbe;
  payer: MerchantPayer;
  /** null disables on-chain logging (audit and reputation). */
  logs: AuditLog | null;
  approval: ApprovalDeps;
  policy: PolicyConfig;
  now: () => number;
  random: (bytes: number) => string;
}

export type AgentErrorKind =
  | "RESOURCE_NOT_PAYABLE"
  | "PAYMENT_FAILED"
  | "VERIFIER_REJECTED";

export class AgentError extends Error {
  constructor(
    readonly kind: AgentErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export interface RunResult {
  checkId: string;
  status: CheckStatus;
  decision: Decision | null;
  verdict: RiskVerdict | null;
  /** Where to send the user for World ID step-up. */
  approvalUrl?: string;
  /** Hedera settlement transaction id. */
  transactionId?: string;
  /** Short machine reason when the check ended in `blocked` or `failed`. */
  reason?: string;
}
