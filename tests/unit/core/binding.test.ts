import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACR,
  type AuthResult,
  consumeApproval,
  createPendingApproval,
  hashAction,
  hbar,
  type PendingApproval,
  sha256Hex,
  statusAfterAuthorizationError,
  statusAfterValidation,
  validateApproval,
} from "@/core";
import { demoAction, HOUR, ISSUER, NONCE, STATE, T0 } from "./fixtures";

const TTL = 10 * 60 * 1000;

function pending(
  overrides: Partial<Parameters<typeof createPendingApproval>[0]> = {},
): PendingApproval {
  return createPendingApproval({
    attemptId: "att_01",
    state: STATE,
    nonce: NONCE,
    action: demoAction(),
    tier: "human",
    now: T0,
    ttlMs: TTL,
    ...overrides,
  });
}

function auth(overrides: Partial<AuthResult> = {}): AuthResult {
  return {
    iss: ISSUER,
    sub: "pairwise_sub_1",
    nonce: NONCE,
    authTime: Math.floor((T0 + 30_000) / 1000),
    acr: ACR.orb,
    ...overrides,
  };
}

const NOW = T0 + 60_000;
const opts = { expectedIssuer: ISSUER, now: NOW };

describe("createPendingApproval", () => {
  it("records the action hash, acr set for the tier, and expiry", () => {
    const p = pending({ tier: "strong" });
    expect(p.status).toBe("pending");
    expect(p.actionHash).toBe(hashAction(demoAction()));
    expect(p.requiredAcr).toEqual([ACR.orbFace]);
    expect(p.expiresAt).toBe(T0 + TTL);
  });

  it("uses null acr requirement for the 'fresh' tier", () => {
    expect(pending({ tier: "fresh" }).requiredAcr).toBeNull();
  });

  it.each([
    ["short state", { state: "short" }],
    ["short nonce", { nonce: "short" }],
    ["state equals nonce", { state: NONCE }],
    ["zero ttl", { ttlMs: 0 }],
    ["bad payee", { action: demoAction({ payee: "alice" }) }],
    ["non-http resource", { action: demoAction({ resource: "ftp://x" }) }],
    [
      "zero amount",
      {
        action: demoAction({ amount: { asset: { kind: "HBAR" }, units: 0n } }),
      },
    ],
    ["bad verdict hash", { action: demoAction({ verdictHash: "abc" }) }],
    ["version 0", { action: demoAction({ version: 0 }) }],
  ])("rejects %s", (_name, overrides) => {
    expect(() => pending(overrides)).toThrow();
  });
});

describe("validateApproval: happy path", () => {
  it("accepts a fresh, matching, sufficiently assured auth", () => {
    expect(validateApproval(pending(), auth(), demoAction(), opts)).toEqual({
      ok: true,
    });
  });

  it("accepts any acr for the 'fresh' tier", () => {
    const p = pending({ tier: "fresh" });
    expect(
      validateApproval(p, auth({ acr: undefined }), demoAction(), opts),
    ).toEqual({ ok: true });
  });

  it("accepts a matching linked subject", () => {
    const p = pending({
      subjectBinding: { iss: ISSUER, sub: "pairwise_sub_1" },
    });
    expect(validateApproval(p, auth(), demoAction(), opts).ok).toBe(true);
  });
});

describe("validateApproval: every failure path blocks", () => {
  const cases: Array<
    [
      string,
      PendingApproval,
      AuthResult,
      ReturnType<typeof demoAction>,
      typeof opts,
      string,
    ]
  > = [
    [
      "already used",
      { ...pending(), status: "consumed" },
      auth(),
      demoAction(),
      opts,
      "NOT_PENDING",
    ],
    [
      "already denied",
      { ...pending(), status: "denied" },
      auth(),
      demoAction(),
      opts,
      "NOT_PENDING",
    ],
    [
      "expired attempt",
      pending(),
      auth(),
      demoAction(),
      { ...opts, now: T0 + TTL + 1 },
      "EXPIRED",
    ],
    [
      "wrong issuer",
      pending(),
      auth({ iss: "https://evil.example" }),
      demoAction(),
      opts,
      "ISSUER_MISMATCH",
    ],
    [
      "wrong nonce",
      pending(),
      auth({ nonce: "nonce_cccccccccccccccc" }),
      demoAction(),
      opts,
      "NONCE_MISMATCH",
    ],
    [
      "nonce length differs",
      pending(),
      auth({ nonce: "x" }),
      demoAction(),
      opts,
      "NONCE_MISMATCH",
    ],
    [
      "different human",
      pending({ subjectBinding: { iss: ISSUER, sub: "pairwise_sub_1" } }),
      auth({ sub: "pairwise_sub_2" }),
      demoAction(),
      opts,
      "SUBJECT_MISMATCH",
    ],
    [
      "reused older session",
      pending(),
      auth({ authTime: Math.floor((T0 - HOUR) / 1000) }),
      demoAction(),
      opts,
      "STALE_AUTH",
    ],
    [
      "NaN auth_time",
      pending(),
      auth({ authTime: Number.NaN }),
      demoAction(),
      opts,
      "STALE_AUTH",
    ],
    [
      "auth_time in the future",
      pending(),
      auth({ authTime: Math.floor((NOW + HOUR) / 1000) }),
      demoAction(),
      opts,
      "AUTH_TIME_IN_FUTURE",
    ],
    [
      "missing acr",
      pending(),
      auth({ acr: undefined }),
      demoAction(),
      opts,
      "INSUFFICIENT_ASSURANCE",
    ],
    [
      "acr too weak for strong tier",
      pending({ tier: "strong" }),
      auth({ acr: ACR.selfie }),
      demoAction(),
      opts,
      "INSUFFICIENT_ASSURANCE",
    ],
    [
      "acr prefix trick",
      pending({ tier: "strong" }),
      auth({ acr: `${ACR.orbFace}x` }),
      demoAction(),
      opts,
      "INSUFFICIENT_ASSURANCE",
    ],
    [
      "amount changed",
      pending(),
      auth(),
      demoAction({ amount: hbar(13) }),
      opts,
      "ACTION_CHANGED",
    ],
    [
      "payee changed",
      pending(),
      auth(),
      demoAction({ payee: "0.0.6666" }),
      opts,
      "ACTION_CHANGED",
    ],
    [
      "verdict changed",
      pending(),
      auth(),
      demoAction({ verdictHash: sha256Hex("verdict-v2") }),
      opts,
      "ACTION_CHANGED",
    ],
    [
      "version bumped",
      pending(),
      auth(),
      demoAction({ version: 2 }),
      opts,
      "ACTION_CHANGED",
    ],
  ];

  it.each(cases)("%s", (_name, p, a, action, o, reason) => {
    expect(validateApproval(p, a, action, o)).toEqual({ ok: false, reason });
  });

  it("tolerates small clock skew on auth_time", () => {
    const skewed = auth({ authTime: Math.floor((T0 - 3000) / 1000) });
    expect(validateApproval(pending(), skewed, demoAction(), opts).ok).toBe(
      true,
    );
  });
});

describe("status transitions", () => {
  it("maps validation results to statuses", () => {
    expect(statusAfterValidation({ ok: true })).toBe("approved");
    expect(statusAfterValidation({ ok: false, reason: "EXPIRED" })).toBe(
      "expired",
    );
    expect(statusAfterValidation({ ok: false, reason: "ACTION_CHANGED" })).toBe(
      "rejected",
    );
  });

  it("maps IdP errors: access_denied is a denial, anything else a rejection", () => {
    expect(statusAfterAuthorizationError("access_denied")).toBe("denied");
    expect(
      statusAfterAuthorizationError("unmet_authentication_requirements"),
    ).toBe("rejected");
    expect(statusAfterAuthorizationError("login_required")).toBe("rejected");
  });

  it("consumes an approval exactly once", () => {
    const approved: PendingApproval = { ...pending(), status: "approved" };
    const consumed = consumeApproval(approved, NOW);
    expect(consumed.status).toBe("consumed");
    expect(() => consumeApproval(consumed, NOW)).toThrow(/consumed/);
  });

  it("refuses to consume pending, denied or expired approvals", () => {
    expect(() => consumeApproval(pending(), NOW)).toThrow();
    expect(() =>
      consumeApproval({ ...pending(), status: "denied" }, NOW),
    ).toThrow();
    expect(() =>
      consumeApproval({ ...pending(), status: "approved" }, T0 + TTL + 1),
    ).toThrow(/expired/);
  });
});

describe("binding: properties", () => {
  it("any change to the amount voids the approval", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 12n }), (units) => {
        fc.pre(units !== hbar(12).units);
        const changed = demoAction({
          amount: { asset: { kind: "HBAR" }, units },
        });
        expect(validateApproval(pending(), auth(), changed, opts)).toEqual({
          ok: false,
          reason: "ACTION_CHANGED",
        });
      }),
    );
  });

  it("only an exact acr from the required set passes the strong tier", () => {
    fc.assert(
      fc.property(fc.string(), (acr) => {
        const res = validateApproval(
          pending({ tier: "strong" }),
          auth({ acr }),
          demoAction(),
          opts,
        );
        expect(res.ok).toBe(acr === ACR.orbFace);
      }),
    );
  });
});
