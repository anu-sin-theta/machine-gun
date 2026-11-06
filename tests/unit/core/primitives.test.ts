import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACR,
  acrClaimsParam,
  assetKey,
  canonicalJson,
  DEFAULT_ACR_REQUIREMENTS,
  formatAmount,
  hashCanonical,
  hbar,
  isHederaEntityId,
  sameAsset,
  strongerTier,
  tinybars,
} from "@/core";

describe("money", () => {
  it("converts whole HBAR to tinybars exactly", () => {
    expect(hbar(1).units).toBe(100_000_000n);
    expect(hbar(12n).units).toBe(1_200_000_000n);
  });

  it("refuses fractional HBAR numbers", () => {
    expect(() => hbar(1.5)).toThrow(RangeError);
  });

  it("formats without float rounding", () => {
    expect(formatAmount(hbar(12))).toBe("12 HBAR");
    expect(formatAmount(tinybars(1n))).toBe("0.00000001 HBAR");
    expect(formatAmount(tinybars(1_250_000_000n))).toBe("12.5 HBAR");
    expect(
      formatAmount({
        asset: { kind: "HTS", tokenId: "0.0.6001", decimals: 6 },
        units: 1_500_000n,
      }),
    ).toBe("1.5 0.0.6001");
  });

  it("keys and compares assets", () => {
    const usdc = { kind: "HTS" as const, tokenId: "0.0.6001", decimals: 6 };
    expect(assetKey({ kind: "HBAR" })).toBe("HBAR");
    expect(assetKey(usdc)).toBe("HTS:0.0.6001");
    expect(sameAsset(usdc, { ...usdc })).toBe(true);
    expect(sameAsset(usdc, { kind: "HBAR" })).toBe(false);
  });

  it("validates Hedera entity ids", () => {
    expect(isHederaEntityId("0.0.5001")).toBe(true);
    expect(isHederaEntityId("0.0.")).toBe(false);
    expect(isHederaEntityId("0.0.5001 ")).toBe(false);
  });
});

describe("canonical JSON", () => {
  it("is independent of key order", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(obj));
      }),
    );
  });

  it("serialises bigints as strings and drops undefined members", () => {
    expect(canonicalJson({ b: 2n, a: undefined, c: [undefined, 1] })).toBe(
      '{"b":"2","c":[null,1]}',
    );
  });

  it("rejects values that cannot be committed to", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: () => 1 })).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson({ x: Symbol("s") })).toThrow();
  });

  // Regression: JavaScript enumerates integer-like keys first regardless of
  // insertion order, so building an object and JSON.stringify-ing it put "0"
  // before "". Found by the Rust/TypeScript differential tests.
  it("orders keys by UTF-16 code unit even when they look like integers (RFC 8785)", () => {
    expect(canonicalJson({ b: 1, "10": 2, "2": 3, "": 4, a: 5 })).toBe(
      '{"":4,"10":2,"2":3,"a":5,"b":1}',
    );
    expect(canonicalJson({ "0": 0, "": "" })).toBe('{"":"","0":0}');
  });

  it("sorts by UTF-16 code unit, not by code point or UTF-8 bytes", () => {
    // U+1F600 is the surrogate pair D83D DE00, which sorts before U+FFFF.
    expect(canonicalJson({ "￿": 1, "\u{1F600}": 2 })).toBe(
      '{"\u{1F600}":2,"￿":1}',
    );
  });

  it("formats numbers per ES6 / RFC 8785 and normalises negative zero", () => {
    expect(canonicalJson([0, -0, 1e21, 1e-7, 2 ** 53, 0.1 + 0.2])).toBe(
      "[0,0,1e+21,1e-7,9007199254740992,0.30000000000000004]",
    );
  });

  it("serialises dates as ISO strings and nested structures canonically", () => {
    expect(canonicalJson({ d: new Date(Date.UTC(2026, 10, 6)) })).toBe(
      '{"d":"2026-11-06T00:00:00.000Z"}',
    );
    expect(canonicalJson({ z: [{ b: 1, a: [] }, null, true], a: {} })).toBe(
      '{"a":{},"z":[{"a":[],"b":1},null,true]}',
    );
  });

  it("hashes to 64 hex chars and changes with content", () => {
    const h = hashCanonical({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCanonical({ a: 2 })).not.toBe(h);
  });
});

describe("assurance", () => {
  it("orders tiers", () => {
    expect(strongerTier("fresh", "strong")).toBe("strong");
    expect(strongerTier("human", "fresh")).toBe("human");
  });

  it("builds the OIDC claims parameter per tier", () => {
    expect(acrClaimsParam("fresh")).toBeUndefined();
    expect(JSON.parse(acrClaimsParam("strong")!)).toEqual({
      id_token: { acr: { essential: true, values: [ACR.orbFace] } },
    });
  });

  it("requires every 'strong' acr to also satisfy 'human'", () => {
    for (const acr of DEFAULT_ACR_REQUIREMENTS.strong ?? []) {
      expect(DEFAULT_ACR_REQUIREMENTS.human).toContain(acr);
    }
  });
});
