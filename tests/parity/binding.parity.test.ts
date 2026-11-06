import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as ts from "@/core";
import * as rust from "@/rust";
import {
  arbAction,
  arbAuthResult,
  arbMaybeInvalidAction,
  arbTier,
  expectSame,
  ISSUER,
  NONCE,
  outcome,
  STATE,
  T0,
} from "./helpers";

const arbCreateInput = fc.record({
  attemptId: fc.constant("att_01"),
  state: fc.constantFrom(STATE, STATE, STATE, "short", NONCE),
  nonce: fc.constantFrom(NONCE, NONCE, NONCE, "short", STATE),
  action: arbMaybeInvalidAction,
  tier: arbTier,
  now: fc.constant(T0),
  ttlMs: fc.constantFrom(600_000, 600_000, 600_000, 1, 0, -5),
  subjectBinding: fc.option(
    fc.record({
      iss: fc.constant(ISSUER),
      sub: fc.constantFrom("sub_1", "sub_2"),
    }),
    { nil: null },
  ),
  acrRequirements: fc.option(
    fc.constant({
      fresh: null,
      human: [ts.ACR.orb],
      strong: [ts.ACR.orbFace, ts.ACR.orb],
    } as ts.AcrRequirements),
    { nil: undefined },
  ),
});

const arbStatus = fc.constantFrom<ts.ApprovalStatus>(
  "pending",
  "pending",
  "pending",
  "pending",
  "approved",
  "denied",
  "expired",
  "rejected",
  "consumed",
);

const arbOpts = fc.record({
  expectedIssuer: fc.constantFrom(
    ISSUER,
    ISSUER,
    ISSUER,
    "https://other.example",
  ),
  now: fc.oneof(
    { weight: 6, arbitrary: fc.integer({ min: T0, max: T0 + 600_000 }) },
    {
      weight: 1,
      arbitrary: fc.constantFrom(
        T0 - 1,
        T0 + 600_000,
        T0 + 600_001,
        T0 + 10_000_000,
      ),
    },
  ),
  clockToleranceSec: fc.option(fc.constantFrom(0, 5, 10, 60), {
    nil: undefined,
  }),
});

describe("parity: approval binding (TypeScript core vs Rust/WASM)", () => {
  it("createPendingApproval agrees, including on every invalid input", () => {
    fc.assert(
      fc.property(arbCreateInput, (input) => {
        const i = {
          ...input,
          acrRequirements: input.acrRequirements ?? undefined,
        } as ts.CreatePendingInput;
        expectSame(
          outcome(() => ts.createPendingApproval(i)),
          outcome(() => rust.createPendingApproval(i)),
          i,
        );
      }),
      { numRuns: 1500 },
    );
  });

  it("validateApproval, statusAfterValidation and consumeApproval agree on random scenarios", () => {
    let validated = 0;
    let accepted = 0;
    fc.assert(
      fc.property(
        arbCreateInput,
        arbStatus,
        arbAuthResult,
        arbMaybeInvalidAction,
        fc.boolean(),
        arbOpts,
        (input, status, auth, otherAction, useOtherAction, opts) => {
          const i = {
            ...input,
            acrRequirements: input.acrRequirements ?? undefined,
          } as ts.CreatePendingInput;
          const made = outcome(() => ts.createPendingApproval(i));
          if (!made.ok) return; // invalid inputs are covered by the previous test
          const pending = { ...made.value, status };
          const current = useOtherAction ? otherAction : pending.action;
          const o = opts as ts.ValidateOptions;

          const a = outcome(() =>
            ts.validateApproval(pending, auth, current, o),
          );
          const b = outcome(() =>
            rust.validateApproval(pending, auth, current, o),
          );
          expectSame(a, b, { pending, auth, current, o });
          validated++;

          if (a.ok && b.ok) {
            if (a.value.ok) accepted++;
            expectSame(
              outcome(() => ts.statusAfterValidation(a.value)),
              outcome(() => rust.statusAfterValidation(b.value)),
              a.value,
            );
          }

          expectSame(
            outcome(() => ts.consumeApproval(pending, o.now)),
            outcome(() => rust.consumeApproval(pending, o.now)),
            { pending, now: o.now },
          );
        },
      ),
      { numRuns: 3000 },
    );
    // Guard against a vacuous test: plenty of scenarios actually reached validation.
    expect(validated).toBeGreaterThan(200);
    void accepted;
  });

  // Purely random scenarios almost never satisfy all nine checks at once, so
  // this starts from an approval that validates and applies one defect at a
  // time. Every outcome, including "approved", must be reached and must agree.
  it("agrees on mutation-based scenarios and reaches every outcome", () => {
    const mutations = [
      "none",
      "none",
      "none",
      "status-consumed",
      "status-denied",
      "status-approved",
      "expired",
      "issuer-in-result",
      "issuer-in-options",
      "nonce",
      "nonce-length",
      "other-human",
      "stale-auth",
      "future-auth",
      "nan-auth",
      "inf-auth",
      "missing-acr",
      "weak-acr",
      "acr-prefix",
      "amount-changed",
      "payee-changed",
      "verdict-changed",
      "version-bumped",
      "skew-inside",
      "skew-outside",
      "wide-tolerance",
    ] as const;

    const seen = new Set<string>();
    const mismatches: unknown[] = [];

    fc.assert(
      fc.property(
        arbAction,
        arbTier,
        fc.constantFrom(null, "sub_1"),
        fc.constantFrom(...mutations),
        (action, tier, boundSub, mutation) => {
          const pending = ts.createPendingApproval({
            attemptId: "att_01",
            state: STATE,
            nonce: NONCE,
            action,
            tier,
            now: T0,
            ttlMs: 600_000,
            subjectBinding: boundSub ? { iss: ISSUER, sub: boundSub } : null,
          });

          const required = pending.requiredAcr;
          let auth: ts.AuthResult = {
            iss: ISSUER,
            sub: boundSub ?? "sub_9",
            nonce: NONCE,
            authTime: Math.floor(T0 / 1000) + 30,
            acr: required ? required[0] : undefined,
          };
          let current: ts.BoundAction = action;
          let p: ts.PendingApproval = pending;
          let opts: ts.ValidateOptions = {
            expectedIssuer: ISSUER,
            now: T0 + 60_000,
          };

          switch (mutation) {
            case "status-consumed":
              p = { ...pending, status: "consumed" };
              break;
            case "status-denied":
              p = { ...pending, status: "denied" };
              break;
            case "status-approved":
              p = { ...pending, status: "approved" };
              break;
            case "expired":
              opts = { ...opts, now: T0 + 600_001 };
              break;
            case "issuer-in-result":
              auth = { ...auth, iss: "https://evil.example" };
              break;
            case "issuer-in-options":
              opts = { ...opts, expectedIssuer: "https://other.example" };
              break;
            case "nonce":
              auth = { ...auth, nonce: "nonce_cccccccccccccccc" };
              break;
            case "nonce-length":
              auth = { ...auth, nonce: "n" };
              break;
            case "other-human":
              auth = { ...auth, sub: "sub_2" };
              break;
            case "stale-auth":
              auth = { ...auth, authTime: Math.floor(T0 / 1000) - 3600 };
              break;
            case "future-auth":
              auth = { ...auth, authTime: Math.floor(T0 / 1000) + 3600 };
              break;
            case "nan-auth":
              auth = { ...auth, authTime: Number.NaN };
              break;
            case "inf-auth":
              auth = { ...auth, authTime: Number.POSITIVE_INFINITY };
              break;
            case "missing-acr":
              auth = { ...auth, acr: undefined };
              break;
            case "weak-acr":
              auth = { ...auth, acr: "https://world.org/oidc/acr/selfie" };
              break;
            case "acr-prefix":
              auth = { ...auth, acr: `${required?.[0] ?? ts.ACR.orb}x` };
              break;
            case "amount-changed":
              current = {
                ...action,
                amount: { ...action.amount, units: action.amount.units + 1n },
              };
              break;
            case "payee-changed":
              current = { ...action, payee: "0.0.6666" };
              break;
            case "verdict-changed":
              current = { ...action, verdictHash: ts.sha256Hex("changed") };
              break;
            case "version-bumped":
              current = { ...action, version: action.version + 1 };
              break;
            case "skew-inside":
              auth = { ...auth, authTime: Math.floor(T0 / 1000) - 3 };
              break;
            case "skew-outside":
              auth = { ...auth, authTime: Math.floor(T0 / 1000) - 10 };
              break;
            case "wide-tolerance":
              auth = { ...auth, authTime: Math.floor(T0 / 1000) - 10 };
              opts = { ...opts, clockToleranceSec: 60 };
              break;
            default:
              break;
          }

          const a = outcome(() => ts.validateApproval(p, auth, current, opts));
          const b = outcome(() =>
            rust.validateApproval(p, auth, current, opts),
          );
          try {
            expectSame(a, b, { mutation, tier, boundSub });
          } catch (e) {
            mismatches.push({ mutation, tier, boundSub, e });
            throw e;
          }
          if (a.ok) seen.add(a.value.ok ? "OK" : a.value.reason);
        },
      ),
      { numRuns: 3000 },
    );

    expect(mismatches).toEqual([]);
    expect([...seen].sort()).toEqual(
      [
        "OK",
        "NOT_PENDING",
        "EXPIRED",
        "ISSUER_MISMATCH",
        "NONCE_MISMATCH",
        "SUBJECT_MISMATCH",
        "STALE_AUTH",
        "AUTH_TIME_IN_FUTURE",
        "INSUFFICIENT_ASSURANCE",
        "ACTION_CHANGED",
      ].sort(),
    );
  });

  it("statusAfterAuthorizationError agrees", () => {
    for (const e of [
      "access_denied",
      "login_required",
      "unmet_authentication_requirements",
      "",
      "ACCESS_DENIED",
    ]) {
      expect(rust.statusAfterAuthorizationError(e)).toBe(
        ts.statusAfterAuthorizationError(e),
      );
    }
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (e) => {
        expect(rust.statusAfterAuthorizationError(e)).toBe(
          ts.statusAfterAuthorizationError(e),
        );
      }),
    );
  });

  it("acrClaimsParam agrees for every tier, with default and custom requirements", () => {
    const custom: ts.AcrRequirements = {
      fresh: [ts.ACR.selfie],
      human: [ts.ACR.orb],
      strong: null,
    };
    for (const tier of ts.ASSURANCE_TIERS) {
      expect(rust.acrClaimsParam(tier)).toBe(ts.acrClaimsParam(tier));
      expect(rust.acrClaimsParam(tier, custom)).toBe(
        ts.acrClaimsParam(tier, custom),
      );
    }
  });
});
