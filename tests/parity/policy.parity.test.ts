import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as ts from "@/core";
import * as rust from "@/rust";
import {
  arbPaymentContext,
  arbPolicyConfig,
  expectSame,
  outcome,
} from "./helpers";

describe("parity: policy (TypeScript core vs Rust/WASM)", () => {
  it("decide agrees on random payments, verdicts and configs", () => {
    fc.assert(
      fc.property(arbPaymentContext, arbPolicyConfig, (ctx, config) => {
        expectSame(
          outcome(() => ts.decide(ctx, config)),
          outcome(() => rust.decide(ctx, config)),
          { ctx, config },
        );
      }),
      { numRuns: 1500 },
    );
  });

  it("decide agrees on the demo policy at every boundary", () => {
    const config = ts.parsePolicyConfig({
      limits: {
        HBAR: {
          autoCap: ts.hbar(2).units,
          hardCap: ts.hbar(50).units,
          dailyAutoBudget: ts.hbar(5).units,
        },
      },
    });
    const amounts = [
      0n,
      1n,
      ts.hbar(2).units,
      ts.hbar(2).units + 1n,
      ts.hbar(50).units,
      ts.hbar(50).units + 1n,
    ];
    const spent = [
      0n,
      ts.hbar(3).units,
      ts.hbar(3).units + 1n,
      ts.hbar(5).units,
    ];
    const verdicts = [
      null,
      ...(["low", "medium", "high"] as const).map((level) => ({
        level,
        reasons: [],
      })),
    ];
    for (const units of amounts)
      for (const autoSpentToday of spent)
        for (const verdict of verdicts) {
          const ctx = {
            amount: { asset: { kind: "HBAR" as const }, units },
            verdict,
            autoSpentToday,
          };
          expectSame(
            outcome(() => ts.decide(ctx, config)),
            outcome(() => rust.decide(ctx, config)),
            ctx,
          );
        }
  });

  it("an unknown risk level from untyped input fails closed in both", () => {
    const config = ts.parsePolicyConfig({
      limits: { HBAR: { autoCap: 10n, hardCap: 100n, dailyAutoBudget: 100n } },
    });
    const ctx = {
      amount: { asset: { kind: "HBAR" as const }, units: 1n },
      verdict: { level: "none", reasons: [] } as unknown as ts.RiskVerdict,
      autoSpentToday: 0n,
    };
    const a = ts.decide(ctx, config);
    const b = rust.decide(ctx, config);
    expect(b).toEqual(a);
    expect(b).toMatchObject({
      kind: "step-up",
      tier: "strong",
      blockedByDefault: true,
    });
  });

  it("parsePolicyConfig agrees on valid and invalid configs", () => {
    const inputs: unknown[] = [
      { limits: { HBAR: { autoCap: 1n, hardCap: 2n, dailyAutoBudget: 3n } } },
      { limits: { HBAR: { autoCap: 3n, hardCap: 2n, dailyAutoBudget: 3n } } }, // autoCap > hardCap
      { limits: { HBAR: { autoCap: 3n, hardCap: 5n, dailyAutoBudget: 2n } } }, // autoCap > daily
      { limits: { HBAR: { autoCap: -1n, hardCap: 5n, dailyAutoBudget: 2n } } }, // negative
      { limits: { HBAR: { autoCap: 1, hardCap: 2, dailyAutoBudget: 3 } } }, // numbers, not bigint
      { limits: {} },
      { limits: { "": { autoCap: 0n, hardCap: 0n, dailyAutoBudget: 0n } } },
      {},
      null,
    ];
    for (const input of inputs) {
      expectSame(
        outcome(() => ts.parsePolicyConfig(input)),
        outcome(() => rust.parsePolicyConfig(input)),
        input,
      );
    }
    fc.assert(
      fc.property(arbPolicyConfig, (config) => {
        expectSame(
          outcome(() => ts.parsePolicyConfig(config)),
          outcome(() => rust.parsePolicyConfig(config)),
          config,
        );
      }),
    );
  });
});
