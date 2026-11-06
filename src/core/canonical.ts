import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted, bigints as decimal strings,
 * undefined object members dropped. Used for hashing anything we commit to
 * (approval bindings, verdicts, HCS payloads).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("canonicalJson: non-finite number");
    }
    if (typeof value === "function" || typeof value === "symbol") {
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
    }
    return value;
  }
  if (Array.isArray(value))
    return value.map((v) => (v === undefined ? null : normalize(v)));
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const member = (value as Record<string, unknown>)[key];
    if (member !== undefined) out[key] = normalize(member);
  }
  return out;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
