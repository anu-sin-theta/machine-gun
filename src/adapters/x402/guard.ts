/**
 * Spend guard for the agent's autonomous x402 payments (paying checkers).
 *
 * The x402 client signs whatever a server asks for, so everything the agent is
 * willing to pay must be decided here, before a payload is created: HBAR only,
 * `exact` scheme, one network, a fixed set of payee accounts, a per-payment cap
 * and a total budget. Every rejection carries a stable reason code.
 *
 * Pure and synchronous apart from its own counters, so it is tested without a
 * network. Amounts are bigint tinybars; the wire amount is a decimal string.
 */

export const HBAR_ASSET_ID = "0.0.0";

export type GuardReason =
  | "BAD_SCHEME"
  | "BAD_NETWORK"
  | "BAD_ASSET"
  | "BAD_AMOUNT"
  | "PAYEE_NOT_ALLOWED"
  | "OVER_PER_PAYMENT_CAP"
  | "OVER_BUDGET";

export interface GuardConfig {
  network: "hedera:testnet" | "hedera:mainnet";
  /** Accounts the agent may pay without a human (the checker operators). */
  allowedPayTo: readonly string[];
  /** Largest single payment, tinybars. */
  maxPerPayment: bigint;
  /** Total the guard will let through before it must be replaced, tinybars. */
  budget: bigint;
}

export interface Requirement {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}

export type GuardResult =
  | { ok: true; amount: bigint }
  | { ok: false; reason: GuardReason };

export class SpendGuard {
  private spent = 0n;
  private readonly allowed: ReadonlySet<string>;

  constructor(private readonly config: GuardConfig) {
    if (config.maxPerPayment <= 0n || config.budget <= 0n)
      throw new RangeError("maxPerPayment and budget must be > 0");
    if (config.maxPerPayment > config.budget)
      throw new RangeError("maxPerPayment must be <= budget");
    this.allowed = new Set(config.allowedPayTo);
  }

  get spentTinybars(): bigint {
    return this.spent;
  }

  get remainingTinybars(): bigint {
    return this.config.budget - this.spent;
  }

  /** Checks a requirement and, if it passes, reserves its amount. */
  reserve(req: Requirement): GuardResult {
    if (req.scheme !== "exact") return { ok: false, reason: "BAD_SCHEME" };
    if (req.network !== this.config.network)
      return { ok: false, reason: "BAD_NETWORK" };
    if (req.asset !== HBAR_ASSET_ID) return { ok: false, reason: "BAD_ASSET" };
    if (!/^[1-9]\d*$/.test(req.amount))
      return { ok: false, reason: "BAD_AMOUNT" };
    if (!this.allowed.has(req.payTo))
      return { ok: false, reason: "PAYEE_NOT_ALLOWED" };
    const amount = BigInt(req.amount);
    if (amount > this.config.maxPerPayment)
      return { ok: false, reason: "OVER_PER_PAYMENT_CAP" };
    if (this.spent + amount > this.config.budget)
      return { ok: false, reason: "OVER_BUDGET" };
    this.spent += amount;
    return { ok: true, amount };
  }

  /** Returns a reservation whose payment was never created. */
  release(amount: bigint): void {
    this.spent = this.spent >= amount ? this.spent - amount : 0n;
  }
}
