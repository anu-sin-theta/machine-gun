import { timingSafeEqual } from "node:crypto";
import {
  type AcrRequirements,
  type AssuranceTier,
  DEFAULT_ACR_REQUIREMENTS,
} from "./assurance";
import { hashCanonical } from "./canonical";
import { type Amount, isHederaEntityId } from "./money";

/**
 * Binds a World ID Agent Pass step-up to one exact payment.
 *
 * World's OIDC flow has no `authorization_details`, so the action is stored
 * server-side, keyed to the attempt's `state`/`nonce`, and re-checked on the
 * callback. Any drift (amount, payee, verdict, version) voids the approval.
 *
 * Pure: randomness (state, nonce) and time are passed in.
 */

export interface BoundAction {
  checkId: string;
  /** Hedera account that receives the payment (x402 `payTo`). */
  payee: string;
  /** x402 resource URL being paid for. */
  resource: string;
  amount: Amount;
  /** sha256 hex of the canonical verdict shown to the user. */
  verdictHash: string;
  /** Bumped whenever the action is edited; any edit requires new approval. */
  version: number;
}

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "rejected"
  | "consumed";

export interface SubjectBinding {
  iss: string;
  sub: string;
}

export interface PendingApproval {
  attemptId: string;
  state: string;
  nonce: string;
  action: BoundAction;
  actionHash: string;
  tier: AssuranceTier;
  /** Exact acr values accepted, or null for "any fresh auth". */
  requiredAcr: readonly string[] | null;
  /** Epoch ms when the attempt started (lower bound for auth_time). */
  createdAt: number;
  /** Epoch ms after which the attempt can no longer be approved. */
  expiresAt: number;
  /** If the account is already linked to a World ID, the callback must match it. */
  subjectBinding: SubjectBinding | null;
  status: ApprovalStatus;
}

/** Validated claims from the ID token, as returned by the OIDC adapter. */
export interface AuthResult {
  iss: string;
  sub: string;
  nonce: string;
  /** OIDC auth_time, epoch seconds. */
  authTime: number;
  acr: string | undefined;
}

export type ApprovalFailure =
  | "NOT_PENDING"
  | "EXPIRED"
  | "ISSUER_MISMATCH"
  | "NONCE_MISMATCH"
  | "SUBJECT_MISMATCH"
  | "STALE_AUTH"
  | "AUTH_TIME_IN_FUTURE"
  | "INSUFFICIENT_ASSURANCE"
  | "ACTION_CHANGED";

export type ApprovalCheck =
  | { ok: true }
  | { ok: false; reason: ApprovalFailure };

const MIN_RANDOM_LENGTH = 16;
const HEX_64 = /^[0-9a-f]{64}$/;

export function hashAction(action: BoundAction): string {
  return hashCanonical(action);
}

export function assertValidAction(action: BoundAction): void {
  if (!action.checkId) throw new TypeError("action.checkId is required");
  if (!isHederaEntityId(action.payee))
    throw new TypeError("action.payee must be a Hedera account id");
  if (!/^https?:\/\//.test(action.resource))
    throw new TypeError("action.resource must be an http(s) URL");
  if (action.amount.units <= 0n)
    throw new RangeError("action.amount must be > 0");
  if (!HEX_64.test(action.verdictHash))
    throw new TypeError("action.verdictHash must be sha256 hex");
  if (!Number.isInteger(action.version) || action.version < 1) {
    throw new RangeError("action.version must be a positive integer");
  }
}

export interface CreatePendingInput {
  attemptId: string;
  state: string;
  nonce: string;
  action: BoundAction;
  tier: AssuranceTier;
  now: number;
  ttlMs: number;
  subjectBinding?: SubjectBinding | null;
  acrRequirements?: AcrRequirements;
}

export function createPendingApproval(
  input: CreatePendingInput,
): PendingApproval {
  assertValidAction(input.action);
  if (
    input.state.length < MIN_RANDOM_LENGTH ||
    input.nonce.length < MIN_RANDOM_LENGTH
  ) {
    throw new RangeError(
      `state and nonce must be at least ${MIN_RANDOM_LENGTH} chars`,
    );
  }
  if (input.state === input.nonce)
    throw new RangeError("state and nonce must differ");
  if (!(input.ttlMs > 0)) throw new RangeError("ttlMs must be > 0");

  const requirements = input.acrRequirements ?? DEFAULT_ACR_REQUIREMENTS;
  return {
    attemptId: input.attemptId,
    state: input.state,
    nonce: input.nonce,
    action: input.action,
    actionHash: hashAction(input.action),
    tier: input.tier,
    requiredAcr: requirements[input.tier],
    createdAt: input.now,
    expiresAt: input.now + input.ttlMs,
    subjectBinding: input.subjectBinding ?? null,
    status: "pending",
  };
}

export interface ValidateOptions {
  expectedIssuer: string;
  now: number;
  /** Allowed clock skew in seconds for auth_time checks. Keep small. */
  clockToleranceSec?: number;
}

/**
 * Re-checks everything at the moment of execution. `currentAction` is the
 * action as it stands now (re-read from storage), not the stored copy.
 */
export function validateApproval(
  pending: PendingApproval,
  result: AuthResult,
  currentAction: BoundAction,
  opts: ValidateOptions,
): ApprovalCheck {
  const toleranceMs = (opts.clockToleranceSec ?? 5) * 1000;

  if (pending.status !== "pending") return fail("NOT_PENDING");
  if (opts.now > pending.expiresAt) return fail("EXPIRED");
  if (result.iss !== opts.expectedIssuer) return fail("ISSUER_MISMATCH");
  if (!safeEqual(result.nonce, pending.nonce)) return fail("NONCE_MISMATCH");
  if (
    pending.subjectBinding &&
    (pending.subjectBinding.iss !== result.iss ||
      pending.subjectBinding.sub !== result.sub)
  ) {
    return fail("SUBJECT_MISMATCH");
  }

  if (!Number.isFinite(result.authTime)) return fail("STALE_AUTH");
  const authMs = result.authTime * 1000;
  // max_age=0 semantics: the auth must belong to this attempt, not an older session.
  if (authMs < pending.createdAt - toleranceMs) return fail("STALE_AUTH");
  if (authMs > opts.now + toleranceMs) return fail("AUTH_TIME_IN_FUTURE");

  if (pending.requiredAcr !== null) {
    if (result.acr === undefined || !pending.requiredAcr.includes(result.acr)) {
      return fail("INSUFFICIENT_ASSURANCE");
    }
  }

  if (hashAction(currentAction) !== pending.actionHash)
    return fail("ACTION_CHANGED");

  return { ok: true };
}

/** Status after a callback was validated. */
export function statusAfterValidation(check: ApprovalCheck): ApprovalStatus {
  if (check.ok) return "approved";
  if (check.reason === "EXPIRED") return "expired";
  return "rejected";
}

/** Status when the IdP returned an error (user denied or cancelled). */
export function statusAfterAuthorizationError(error: string): ApprovalStatus {
  return error === "access_denied" ? "denied" : "rejected";
}

/**
 * Approved -> consumed, exactly once. Throws otherwise so a replayed
 * approval can never trigger a second payment.
 */
export function consumeApproval(
  pending: PendingApproval,
  now: number,
): PendingApproval {
  if (pending.status !== "approved") {
    throw new Error(`cannot consume approval in status ${pending.status}`);
  }
  if (now > pending.expiresAt) {
    throw new Error("cannot consume an expired approval");
  }
  return { ...pending, status: "consumed" };
}

function fail(reason: ApprovalFailure): ApprovalCheck {
  return { ok: false, reason };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
