import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Decision,
  decide,
  hbar,
  parsePolicyConfig,
  RISK_LEVELS,
  type RiskLevel,
  tierRank,
  tinybars,
} from "@/core";
import { demoPolicy } from "./fixtures";

const policy = demoPolicy();
const verdict = (level: RiskLevel) => ({ level, reasons: ["test"] });

describe("decide: hard rules", () => {
  it("blocks zero and negative amounts", () => {
    expect(
      decide(
        { amount: tinybars(0n), verdict: verdict("low"), autoSpentToday: 0n },
        policy,
      ),
    ).toEqual({
      kind: "block",
      reasons: ["INVALID_AMOUNT"],
    });
    expect(
      decide(
        { amount: tinybars(-1n), verdict: verdict("low"), autoSpentToday: 0n },
        policy,
      ).kind,
    ).toBe("block");
  });

  it("blocks assets with no configured limits", () => {
    const usdc = {
      asset: { kind: "HTS" as const, tokenId: "0.0.6001", decimals: 6 },
      units: 1n,
    };
    expect(
      decide(
        { amount: usdc, verdict: verdict("low"), autoSpentToday: 0n },
        policy,
      ),
    ).toEqual({
      kind: "block",
      reasons: ["ASSET_NOT_ALLOWED"],
    });
  });

  it("blocks above the hard cap even at low risk, with no override", () => {
    const d = decide(
      { amount: hbar(51), verdict: verdict("low"), autoSpentToday: 0n },
      policy,
    );
    expect(d).toEqual({ kind: "block", reasons: ["OVER_HARD_CAP"] });
  });

  it("allows exactly the hard cap (boundary)", () => {
    const d = decide(
      { amount: hbar(50), verdict: verdict("medium"), autoSpentToday: 0n },
      policy,
    );
    expect(d.kind).toBe("step-up");
  });

  it("rejects a negative autoSpentToday as a programming error", () => {
    expect(() =>
      decide(
        { amount: hbar(1), verdict: verdict("low"), autoSpentToday: -1n },
        policy,
      ),
    ).toThrow(RangeError);
  });
});

describe("decide: risk tiers", () => {
  it("auto-pays low risk under the auto cap and daily budget", () => {
    expect(
      decide(
        { amount: hbar(2), verdict: verdict("low"), autoSpentToday: 0n },
        policy,
      ),
    ).toEqual({
      kind: "auto-pay",
      reasons: ["RISK_LOW"],
    });
  });

  it("steps up 'fresh' for low risk over the auto cap", () => {
    const justOverCap = tinybars(hbar(2).units + 1n);
    const d = decide(
      { amount: justOverCap, verdict: verdict("low"), autoSpentToday: 0n },
      policy,
    );
    expect(d).toEqual({
      kind: "step-up",
      tier: "fresh",
      blockedByDefault: false,
      reasons: ["RISK_LOW", "OVER_AUTO_CAP"],
    });
  });

  it("steps up 'fresh' for low risk that would exceed the daily auto budget", () => {
    const d = decide(
      {
        amount: hbar(2),
        verdict: verdict("low"),
        autoSpentToday: hbar(4).units,
      },
      policy,
    );
    expect(d).toEqual({
      kind: "step-up",
      tier: "fresh",
      blockedByDefault: false,
      reasons: ["RISK_LOW", "OVER_DAILY_AUTO_BUDGET"],
    });
  });

  it("auto-pays when landing exactly on the daily budget (boundary)", () => {
    const d = decide(
      {
        amount: hbar(2),
        verdict: verdict("low"),
        autoSpentToday: hbar(3).units,
      },
      policy,
    );
    expect(d.kind).toBe("auto-pay");
  });

  it("steps up 'human' for medium risk regardless of amount", () => {
    for (const amount of [tinybars(1n), hbar(2), hbar(40)]) {
      expect(
        decide(
          { amount, verdict: verdict("medium"), autoSpentToday: 0n },
          policy,
        ),
      ).toEqual({
        kind: "step-up",
        tier: "human",
        blockedByDefault: false,
        reasons: ["RISK_MEDIUM"],
      });
    }
  });

  it("blocks high risk by default, overridable only with 'strong' assurance", () => {
    expect(
      decide(
        { amount: tinybars(1n), verdict: verdict("high"), autoSpentToday: 0n },
        policy,
      ),
    ).toEqual({
      kind: "step-up",
      tier: "strong",
      blockedByDefault: true,
      reasons: ["RISK_HIGH"],
    });
  });

  it("fails closed when the verdict is missing", () => {
    expect(
      decide(
        { amount: tinybars(1n), verdict: null, autoSpentToday: 0n },
        policy,
      ),
    ).toEqual({
      kind: "step-up",
      tier: "strong",
      blockedByDefault: true,
      reasons: ["VERDICT_MISSING", "RISK_HIGH"],
    });
  });

  it("fails closed on an unknown risk level from untyped input", () => {
    const bogus = { level: "none", reasons: [] } as unknown as {
      level: RiskLevel;
      reasons: string[];
    };
    const d = decide(
      { amount: tinybars(1n), verdict: bogus, autoSpentToday: 0n },
      policy,
    );
    expect(d).toMatchObject({
      kind: "step-up",
      tier: "strong",
      blockedByDefault: true,
    });
  });
});

describe("parsePolicyConfig", () => {
  it("rejects autoCap above hardCap", () => {
    expect(() =>
      parsePolicyConfig({
        limits: { HBAR: { autoCap: 10n, hardCap: 5n, dailyAutoBudget: 10n } },
      }),
    ).toThrow(/autoCap must be <= hardCap/);
  });

  it("rejects autoCap above dailyAutoBudget", () => {
    expect(() =>
      parsePolicyConfig({
        limits: { HBAR: { autoCap: 10n, hardCap: 50n, dailyAutoBudget: 5n } },
      }),
    ).toThrow(/dailyAutoBudget/);
  });

  it("rejects numbers in place of bigints (no float money)", () => {
    expect(() =>
      parsePolicyConfig({
        limits: { HBAR: { autoCap: 1, hardCap: 2, dailyAutoBudget: 3 } },
      }),
    ).toThrow();
  });
});

// Strictness score: higher means more human involvement required.
function strictness(d: Decision): number {
  if (d.kind === "auto-pay") return 0;
  if (d.kind === "step-up")
    return 1 + tierRank(d.tier) + (d.blockedByDefault ? 1 : 0);
  return 10;
}

describe("decide: properties", () => {
  const amountArb = fc.bigInt({ min: 1n, max: hbar(60).units }).map(tinybars);
  const spentArb = fc.bigInt({ min: 0n, max: hbar(10).units });
  const levelArb = fc.constantFrom(...RISK_LEVELS);

  it("never auto-pays anything but low risk", () => {
    fc.assert(
      fc.property(amountArb, spentArb, levelArb, (amount, spent, level) => {
        const d = decide(
          { amount, verdict: verdict(level), autoSpentToday: spent },
          policy,
        );
        if (d.kind === "auto-pay") expect(level).toBe("low");
      }),
    );
  });

  it("never auto-pays above the auto cap or past the daily budget", () => {
    fc.assert(
      fc.property(amountArb, spentArb, (amount, spent) => {
        const d = decide(
          { amount, verdict: verdict("low"), autoSpentToday: spent },
          policy,
        );
        if (d.kind === "auto-pay") {
          const limits = policy.limits.HBAR!;
          expect(amount.units <= limits.autoCap).toBe(true);
          expect(spent + amount.units <= limits.dailyAutoBudget).toBe(true);
        }
      }),
    );
  });

  it("raising the risk level never relaxes the decision", () => {
    fc.assert(
      fc.property(amountArb, spentArb, (amount, spent) => {
        const scores = RISK_LEVELS.map((level) =>
          strictness(
            decide(
              { amount, verdict: verdict(level), autoSpentToday: spent },
              policy,
            ),
          ),
        );
        expect(scores[0]! <= scores[1]! && scores[1]! <= scores[2]!).toBe(true);
      }),
    );
  });

  it("raising the amount never relaxes the decision", () => {
    fc.assert(
      fc.property(
        amountArb,
        amountArb,
        spentArb,
        levelArb,
        (a, b, spent, level) => {
          const [lo, hi] = a.units <= b.units ? [a, b] : [b, a];
          const dLo = decide(
            { amount: lo, verdict: verdict(level), autoSpentToday: spent },
            policy,
          );
          const dHi = decide(
            { amount: hi, verdict: verdict(level), autoSpentToday: spent },
            policy,
          );
          expect(strictness(dLo) <= strictness(dHi)).toBe(true);
        },
      ),
    );
  });
});
