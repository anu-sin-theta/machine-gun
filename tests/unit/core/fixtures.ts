import {
  type BoundAction,
  hbar,
  type PolicyConfig,
  parsePolicyConfig,
  sha256Hex,
} from "@/core";

export const HOUR = 60 * 60 * 1000;
export const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
export const ISSUER = "https://auth.world.org";

/** 2 HBAR auto cap, 50 HBAR hard cap, 5 HBAR/day auto budget. */
export function demoPolicy(): PolicyConfig {
  return parsePolicyConfig({
    limits: {
      HBAR: {
        autoCap: hbar(2).units,
        hardCap: hbar(50).units,
        dailyAutoBudget: hbar(5).units,
      },
    },
  });
}

export function demoAction(overrides: Partial<BoundAction> = {}): BoundAction {
  return {
    checkId: "chk_01",
    payee: "0.0.5001",
    resource: "https://kavach.test/api/x402/merchant/electricity",
    amount: hbar(12),
    verdictHash: sha256Hex("verdict-v1"),
    version: 1,
    ...overrides,
  };
}

export const STATE = "state_aaaaaaaaaaaaaaaa";
export const NONCE = "nonce_bbbbbbbbbbbbbbbb";
