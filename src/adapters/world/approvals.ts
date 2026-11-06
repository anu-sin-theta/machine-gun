/**
 * The step-up flow around World ID: start an approval for an exact payment,
 * finish it on the callback, and spend it exactly once. All decisions are made
 * by the Rust core (`createPendingApproval`, `validateApproval`, ...); this
 * file only sequences them with storage and the OIDC transport.
 *
 * Everything fails closed: any problem after the redirect leaves the attempt
 * `rejected`, and only an `approved` attempt that is still unexpired can be
 * consumed, once, by a compare-and-set in the database.
 */

import type { Repositories } from "@/adapters/db";
import type {
  AcrRequirements,
  ApprovalFailure,
  AssuranceTier,
  BoundAction,
  SubjectBinding,
} from "@/core";
import {
  acrClaimsParam,
  consumeApproval,
  createPendingApproval,
  statusAfterAuthorizationError,
  statusAfterValidation,
  validateApproval,
} from "@/rust";
import { WorldError, type WorldOidc } from "./oidc";

export interface ApprovalDeps {
  repos: Pick<Repositories, "approvals" | "nonces" | "checks">;
  oidc: WorldOidc;
  issuer: string;
  /** Where approvals come from. "simulated" is recorded in the audit log. */
  source?: "world" | "simulated";
  acr: AcrRequirements;
  ttlMs: number;
  now: () => number;
  /** Cryptographically random URL-safe string with the given number of bytes. */
  random: (bytes: number) => string;
  /** The action as it stands now, re-read at callback time. null if it no longer exists. */
  getCurrentAction: (checkId: string) => Promise<BoundAction | null>;
}

export interface StartInput {
  action: BoundAction;
  tier: AssuranceTier;
  subjectBinding?: SubjectBinding | null;
}

export interface Started {
  attemptId: string;
  url: string;
}

export async function startApproval(
  deps: ApprovalDeps,
  input: StartInput,
): Promise<Started> {
  const attemptId = `att_${deps.random(12)}`;
  const state = deps.random(24);
  const nonce = deps.random(24);

  const pending = createPendingApproval({
    attemptId,
    state,
    nonce,
    action: input.action,
    tier: input.tier,
    now: deps.now(),
    ttlMs: deps.ttlMs,
    subjectBinding: input.subjectBinding ?? null,
    acrRequirements: deps.acr,
  });
  await deps.repos.approvals.create(pending);

  const url = await deps.oidc.authorizationUrl({
    attemptId,
    state,
    nonce,
    claims: acrClaimsParam(input.tier, deps.acr),
  });
  return { attemptId, url: url.toString() };
}

export type CallbackOutcome =
  | {
      kind: "approved" | "denied" | "expired" | "rejected";
      attemptId: string;
      checkId: string;
      reason?: ApprovalFailure | "WORLD_ERROR" | "NONCE_REPLAY";
    }
  /** No attempt matches this `state`. Nothing was changed. */
  | { kind: "unknown_state" }
  /** The attempt already left `pending` (replayed or duplicate callback). Nothing was changed. */
  | { kind: "not_pending"; attemptId: string };

export async function completeApproval(
  deps: ApprovalDeps,
  callbackUrl: URL,
): Promise<CallbackOutcome> {
  const state = callbackUrl.searchParams.get("state");
  if (!state) return { kind: "unknown_state" };
  const pending = await deps.repos.approvals.getByState(state);
  if (!pending) return { kind: "unknown_state" };
  const { attemptId } = pending;
  const checkId = pending.action.checkId;

  if (pending.status !== "pending") return { kind: "not_pending", attemptId };

  const settle = async (
    status: "approved" | "denied" | "expired" | "rejected",
    reason?: Extract<CallbackOutcome, { checkId: string }>["reason"],
  ): Promise<CallbackOutcome> => {
    const won = await deps.repos.approvals.transition(
      attemptId,
      "pending",
      status,
    );
    if (!won) return { kind: "not_pending", attemptId };
    return { kind: status, attemptId, checkId, ...(reason && { reason }) };
  };

  // The user said no, or World reported a problem.
  const error = callbackUrl.searchParams.get("error");
  if (error) {
    const status = statusAfterAuthorizationError(error);
    return settle(status === "denied" ? "denied" : "rejected");
  }

  let auth: Awaited<ReturnType<WorldOidc["exchange"]>>;
  try {
    auth = await deps.oidc.exchange(callbackUrl, {
      attemptId,
      state: pending.state,
      nonce: pending.nonce,
    });
  } catch (e) {
    if (e instanceof WorldError) return settle("rejected", "WORLD_ERROR");
    throw e;
  }

  const current = await deps.getCurrentAction(checkId);
  if (!current) return settle("rejected", "ACTION_CHANGED");

  const check = validateApproval(pending, auth, current, {
    expectedIssuer: deps.issuer,
    now: deps.now(),
  });
  if (!check.ok)
    return settle(
      statusAfterValidation(check) as "rejected" | "expired",
      check.reason,
    );

  // A nonce is good for one approval, even across attempts.
  if (!(await deps.repos.nonces.markUsed(auth.nonce, deps.now())))
    return settle("rejected", "NONCE_REPLAY");

  return settle("approved");
}

/**
 * Spends an approval. True for exactly one caller: the one that moves
 * `approved` to `consumed` while the attempt is still unexpired.
 */
export async function consumeApprovalOnce(
  deps: Pick<ApprovalDeps, "repos" | "now">,
  attemptId: string,
): Promise<boolean> {
  const pending = await deps.repos.approvals.getById(attemptId);
  if (!pending) return false;
  try {
    consumeApproval(pending, deps.now()); // throws unless approved and unexpired
  } catch {
    return false;
  }
  return deps.repos.approvals.transition(attemptId, "approved", "consumed");
}
