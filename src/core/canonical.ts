import { createHash } from "node:crypto";

/**
 * Canonical JSON per RFC 8785 (JCS): object keys sorted by UTF-16 code unit,
 * ES6 number formatting, no whitespace. Extensions: bigints become decimal
 * strings, Dates become ISO strings, undefined object members are dropped
 * and undefined array items become null. Used for hashing anything we commit
 * to (approval bindings, verdicts, HCS payloads); the Rust core produces
 * byte-identical output.
 *
 * The string is built by hand rather than via `JSON.stringify(object)`:
 * JavaScript enumerates integer-like keys ("0", "10") before all others
 * regardless of insertion order, which would break the required key order.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new TypeError("canonicalJson: undefined is not JSON");
  }
  return serialize(value);
}

function serialize(value: unknown): string {
  switch (typeof value) {
    case "bigint":
      return JSON.stringify(value.toString());
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("canonicalJson: non-finite number");
      }
      return JSON.stringify(value);
    case "function":
    case "symbol":
    case "undefined":
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : serialize(v))).join(",")}]`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());

  const record = value as Record<string, unknown>;
  const members: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const member = record[key];
    if (member !== undefined) {
      members.push(`${JSON.stringify(key)}:${serialize(member)}`);
    }
  }
  return `{${members.join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
