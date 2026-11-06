/**
 * Money is always held in integer base units (tinybars for HBAR, token base
 * units for HTS) as `bigint`. Floats never touch an amount.
 */

export const TINYBARS_PER_HBAR = 100_000_000n;

export type Asset =
  | { kind: "HBAR" }
  | { kind: "HTS"; tokenId: string; decimals: number };

export interface Amount {
  asset: Asset;
  /** Integer base units. Must be > 0 for a payment. */
  units: bigint;
}

const HEDERA_ENTITY_ID = /^\d+\.\d+\.\d+$/;

export function isHederaEntityId(value: string): boolean {
  return HEDERA_ENTITY_ID.test(value);
}

/** Stable string key for an asset, e.g. "HBAR" or "HTS:0.0.6001". */
export function assetKey(asset: Asset): string {
  return asset.kind === "HBAR" ? "HBAR" : `HTS:${asset.tokenId}`;
}

export function sameAsset(a: Asset, b: Asset): boolean {
  return assetKey(a) === assetKey(b);
}

export function hbar(whole: number | bigint): Amount {
  if (typeof whole === "number" && !Number.isInteger(whole)) {
    throw new RangeError(
      "hbar() takes whole HBAR; use tinybars() for fractions",
    );
  }
  return { asset: { kind: "HBAR" }, units: BigInt(whole) * TINYBARS_PER_HBAR };
}

export function tinybars(units: bigint): Amount {
  return { asset: { kind: "HBAR" }, units };
}

/** Human-readable amount, e.g. "12.5 HBAR". Exact: no float conversion. */
export function formatAmount(amount: Amount): string {
  const decimals = amount.asset.kind === "HBAR" ? 8 : amount.asset.decimals;
  const symbol = amount.asset.kind === "HBAR" ? "HBAR" : amount.asset.tokenId;
  const negative = amount.units < 0n;
  const abs = negative ? -amount.units : amount.units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""} ${symbol}`;
}
