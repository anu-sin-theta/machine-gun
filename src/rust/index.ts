/**
 * Typed bridge to the Rust core (rust/kavach-core, compiled to WASM).
 *
 * The API mirrors `@/core` so the two implementations can be compared
 * directly. Money crosses the boundary as decimal strings and comes back as
 * bigint. Failures from Rust arrive as an error envelope and are thrown as
 * `KavachError` with a stable `kind`.
 */

import type {
  AcrRequirements,
  ApprovalCheck,
  ApprovalStatus,
  AssuranceTier,
  AuthResult,
  BoundAction,
  CreatePendingInput,
  Decision,
  PaymentContext,
  PendingApproval,
  PolicyConfig,
  ValidateOptions,
} from "@/core";
import * as wasm from "./pkg/kavach_wasm";
import { initSync } from "./pkg/kavach_wasm";
import { WASM_BASE64 } from "./pkg/kavach_wasm_bytes";
import type { LinkInput, LinkIntelConfig, LinkReport } from "./types";

export type { LinkInput, LinkIntelConfig, LinkReport } from "./types";

export type KavachErrorKind =
  | "InvalidAmount"
  | "InvalidConfig"
  | "InvalidAction"
  | "InvalidInput"
  | "IllegalTransition"
  | "Canonicalization";

export class KavachError extends Error {
  readonly kind: KavachErrorKind;
  constructor(kind: KavachErrorKind, message: string) {
    super(message);
    this.name = "KavachError";
    this.kind = kind;
  }
}

let initialised = false;
function ensureInit(): void {
  if (initialised) return;
  initSync({ module: Buffer.from(WASM_BASE64, "base64") });
  initialised = true;
}

/** JSON.stringify that turns bigint into decimal strings. NaN/Infinity become null. */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

type Envelope =
  | { ok: true; value: unknown }
  | { ok: false; error: { kind: KavachErrorKind; message: string } };

function unwrap(raw: string): unknown {
  const env = JSON.parse(raw) as Envelope;
  if (!env.ok) throw new KavachError(env.error.kind, env.error.message);
  return env.value;
}

function call(fn: () => string): unknown {
  ensureInit();
  return unwrap(fn());
}

// --- bigint revival: Rust emits money as decimal strings -------------------

type WireAmount = { asset: unknown; units: string };
type WireAction = Omit<BoundAction, "amount"> & { amount: WireAmount };
type WirePending = Omit<PendingApproval, "action"> & { action: WireAction };
type WireLimits = { autoCap: string; hardCap: string; dailyAutoBudget: string };

const reviveAmount = (a: WireAmount) =>
  ({ ...a, units: BigInt(a.units) }) as BoundAction["amount"];
const reviveAction = (a: WireAction): BoundAction => ({
  ...a,
  amount: reviveAmount(a.amount),
});
const revivePending = (p: WirePending): PendingApproval => ({
  ...p,
  action: reviveAction(p.action),
});

// --- policy ----------------------------------------------------------------

export function decide(ctx: PaymentContext, config: PolicyConfig): Decision {
  return call(() => wasm.decide(toJson(ctx), toJson(config))) as Decision;
}

export function parsePolicyConfig(input: unknown): PolicyConfig {
  const wire = call(() => wasm.parsePolicyConfig(toJson(input))) as {
    limits: Record<string, WireLimits>;
  };
  const limits: PolicyConfig["limits"] = {};
  for (const [key, l] of Object.entries(wire.limits)) {
    limits[key] = {
      autoCap: BigInt(l.autoCap),
      hardCap: BigInt(l.hardCap),
      dailyAutoBudget: BigInt(l.dailyAutoBudget),
    };
  }
  return { limits };
}

// --- hashing ---------------------------------------------------------------

/** RFC 8785 canonical JSON. Pass bigints as strings (or let `toJson` do it). */
export function canonicalJson(value: unknown): string {
  return call(() => wasm.canonicalJson(toJson(value))) as string;
}

export function hashCanonical(value: unknown): string {
  return call(() => wasm.hashCanonical(toJson(value))) as string;
}

export function hashAction(action: BoundAction): string {
  return call(() => wasm.hashAction(toJson(action))) as string;
}

// --- approval binding ------------------------------------------------------

export function createPendingApproval(
  input: CreatePendingInput,
): PendingApproval {
  const { acrRequirements, subjectBinding, ...rest } = input;
  const wire = {
    ...rest,
    subjectBinding: subjectBinding ?? null,
    acrRequirements: acrRequirements ?? null,
  };
  return revivePending(
    call(() => wasm.createPendingApproval(toJson(wire))) as WirePending,
  );
}

export function validateApproval(
  pending: PendingApproval,
  result: AuthResult,
  currentAction: BoundAction,
  opts: ValidateOptions,
): ApprovalCheck {
  return call(() =>
    wasm.validateApproval(
      toJson(pending),
      toJson(result),
      toJson(currentAction),
      toJson(opts),
    ),
  ) as ApprovalCheck;
}

export function statusAfterValidation(check: ApprovalCheck): ApprovalStatus {
  return call(() =>
    wasm.statusAfterValidation(toJson(check)),
  ) as ApprovalStatus;
}

export function statusAfterAuthorizationError(error: string): ApprovalStatus {
  return call(() =>
    wasm.statusAfterAuthorizationError(error),
  ) as ApprovalStatus;
}

export function consumeApproval(
  pending: PendingApproval,
  now: number,
): PendingApproval {
  return revivePending(
    call(() => wasm.consumeApproval(toJson(pending), now)) as WirePending,
  );
}

/** The OIDC `claims` parameter for a tier, or undefined when the tier has no acr constraint. */
export function acrClaimsParam(
  tier: AssuranceTier,
  requirements?: AcrRequirements,
): string | undefined {
  const out = call(() =>
    wasm.acrClaims(tier, requirements ? toJson(requirements) : ""),
  ) as string | null;
  return out ?? undefined;
}

// --- link intel ------------------------------------------------------------

export function analyzeLink(
  input: LinkInput,
  config?: LinkIntelConfig,
): LinkReport {
  return call(() =>
    wasm.analyzeLink(toJson(input), config ? toJson(config) : ""),
  ) as LinkReport;
}

export function defaultLinkConfig(): LinkIntelConfig {
  return call(() => wasm.defaultLinkConfig()) as LinkIntelConfig;
}

export function wasmVersion(): string {
  ensureInit();
  return wasm.version();
}
