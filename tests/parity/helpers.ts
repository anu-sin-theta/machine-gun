import fc from "fast-check";
import { expect } from "vitest";
import {
  ACR,
  type Amount,
  type AssuranceTier,
  type AuthResult,
  type BoundAction,
  type PaymentContext,
  type PolicyConfig,
  type RiskLevel,
  sha256Hex,
} from "@/core";

/** Runs `fn`; records either its value or the fact that it threw. */
export type Outcome<T> = { ok: true; value: T } | { ok: false };

export function outcome<T>(fn: () => T): Outcome<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

/** The two implementations must either both succeed with equal values or both throw. */
export function expectSame<T>(
  ts: Outcome<T>,
  rust: Outcome<T>,
  context?: unknown,
): void {
  if (!ts.ok || !rust.ok) {
    expect(
      { tsThrew: !ts.ok, rustThrew: !rust.ok, context },
      "TypeScript and Rust disagree about whether this input is valid",
    ).toEqual({ tsThrew: !ts.ok, rustThrew: !ts.ok, context });
    return;
  }
  expect(
    rust.value,
    JSON.stringify(context, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)),
  ).toEqual(ts.value);
}

const HBAR = 100_000_000n;

export const arbAsset = fc.oneof(
  { weight: 8, arbitrary: fc.constant({ kind: "HBAR" } as const) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("HTS" as const),
      tokenId: fc.constantFrom("0.0.6001", "0.0.7002"),
      decimals: fc.integer({ min: 0, max: 8 }),
    }),
  },
);

export const arbUnits = fc.oneof(
  { weight: 6, arbitrary: fc.bigInt({ min: 1n, max: 60n * HBAR }) },
  { weight: 1, arbitrary: fc.bigInt({ min: -5n, max: 5n }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      2n * HBAR,
      2n * HBAR + 1n,
      50n * HBAR,
      50n * HBAR + 1n,
    ),
  },
);

export const arbAmount: fc.Arbitrary<Amount> = fc.record({
  asset: arbAsset,
  units: arbUnits,
});

export const arbLevel = fc.constantFrom<RiskLevel>("low", "medium", "high");

export const arbVerdict = fc.option(
  fc.record({
    level: arbLevel,
    reasons: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
  }),
  { nil: null },
);

export const arbPaymentContext: fc.Arbitrary<PaymentContext> = fc.record({
  amount: arbAmount,
  verdict: arbVerdict,
  autoSpentToday: fc.oneof(
    { weight: 8, arbitrary: fc.bigInt({ min: 0n, max: 10n * HBAR }) },
    {
      weight: 1,
      arbitrary: fc.constantFrom(-1n, 3n * HBAR, 4n * HBAR, 5n * HBAR),
    },
  ),
});

/** Valid configs: autoCap <= hardCap and autoCap <= dailyAutoBudget. */
export const arbPolicyConfig: fc.Arbitrary<PolicyConfig> = fc
  .tuple(
    fc.bigInt({ min: 0n, max: 10n * HBAR }),
    fc.bigInt({ min: 0n, max: 100n * HBAR }),
    fc.bigInt({ min: 0n, max: 100n * HBAR }),
    fc.boolean(),
  )
  .map(([auto, hardExtra, dailyExtra, withUsdc]) => {
    const limits: PolicyConfig["limits"] = {
      HBAR: {
        autoCap: auto,
        hardCap: auto + hardExtra,
        dailyAutoBudget: auto + dailyExtra,
      },
    };
    if (withUsdc)
      limits["HTS:0.0.6001"] = {
        autoCap: 1000n,
        hardCap: 100000n,
        dailyAutoBudget: 5000n,
      };
    return { limits };
  });

export const arbTier = fc.constantFrom<AssuranceTier>(
  "fresh",
  "human",
  "strong",
);

const hex64 = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => sha256Hex(s));

export const arbAction: fc.Arbitrary<BoundAction> = fc.record({
  checkId: fc.constantFrom("chk_01", "chk_02", "x"),
  payee: fc.constantFrom("0.0.5001", "0.0.5002", "0.0.99999999"),
  resource: fc.constantFrom(
    "https://kavach.test/a",
    "http://localhost:3000/b",
    "https://x.test/c?d=é",
  ),
  amount: fc.record({
    asset: fc.constant({ kind: "HBAR" } as const),
    units: fc.bigInt({ min: 1n, max: 60n * HBAR }),
  }),
  verdictHash: hex64,
  version: fc.integer({ min: 1, max: 5 }),
});

/** Mostly valid actions with a chance of each kind of malformation. */
export const arbMaybeInvalidAction: fc.Arbitrary<BoundAction> = fc
  .tuple(
    arbAction,
    fc.constantFrom<
      null | "payee" | "resource" | "amount" | "hash" | "version" | "checkId"
    >(
      null,
      null,
      null,
      null,
      "payee",
      "resource",
      "amount",
      "hash",
      "version",
      "checkId",
    ),
  )
  .map(([a, bad]) => {
    switch (bad) {
      case "payee":
        return { ...a, payee: "alice" };
      case "resource":
        return { ...a, resource: "ftp://x" };
      case "amount":
        return { ...a, amount: { ...a.amount, units: 0n } };
      case "hash":
        return { ...a, verdictHash: "ABC" };
      case "version":
        return { ...a, version: 0 };
      case "checkId":
        return { ...a, checkId: "" };
      default:
        return a;
    }
  });

export const T0 = 1_793_966_400_000;
export const ISSUER = "https://auth.world.org";
export const STATE = "state_aaaaaaaaaaaaaaaa";
export const NONCE = "nonce_bbbbbbbbbbbbbbbb";

const acrs = [
  undefined,
  ACR.orb,
  ACR.selfie,
  ACR.orbFace,
  ACR.selfieFace,
  `${ACR.orbFace}x`,
  "",
  "https://evil.example",
] as const;

export const arbAuthResult: fc.Arbitrary<AuthResult> = fc.record({
  iss: fc.constantFrom(ISSUER, ISSUER, ISSUER, "https://evil.example"),
  sub: fc.constantFrom("sub_1", "sub_2"),
  nonce: fc.constantFrom(
    NONCE,
    NONCE,
    NONCE,
    "nonce_cccccccccccccccc",
    "x",
    "",
  ),
  authTime: fc.oneof(
    {
      weight: 6,
      arbitrary: fc.integer({
        min: Math.floor(T0 / 1000) - 20,
        max: Math.floor(T0 / 1000) + 700,
      }),
    },
    {
      weight: 1,
      arbitrary: fc.constantFrom(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        0,
        -1,
        Math.floor(T0 / 1000) - 3,
        Math.floor(T0 / 1000) - 10,
        Math.floor(T0 / 1000) + 1_000_000,
      ),
    },
  ),
  acr: fc.constantFrom(...acrs),
});
