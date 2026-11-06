import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as ts from "@/core";
import * as rust from "@/rust";
import {
  arbAction,
  arbMaybeInvalidAction,
  expectSame,
  outcome,
} from "./helpers";

describe("parity: canonical JSON and hashing", () => {
  it("canonicalJson agrees on arbitrary JSON values", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expectSame(
          outcome(() => ts.canonicalJson(value)),
          outcome(() => rust.canonicalJson(value)),
          value,
        );
      }),
      { numRuns: 1500 },
    );
  });

  it("hashCanonical agrees on arbitrary JSON values", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expectSame(
          outcome(() => ts.hashCanonical(value)),
          outcome(() => rust.hashCanonical(value)),
          value,
        );
      }),
      { numRuns: 500 },
    );
  });

  it("agrees on strings that stress escaping and Unicode (full code point range)", () => {
    fc.assert(
      fc.property(
        fc.record({ s: fc.string({ unit: "binary", maxLength: 20 }) }),
        (value) => {
          // Lone surrogates are not valid JSON text in Rust; only compare well-formed strings.
          fc.pre(value.s.isWellFormed());
          expectSame(
            outcome(() => ts.canonicalJson(value)),
            outcome(() => rust.canonicalJson(value)),
            value,
          );
        },
      ),
      { numRuns: 1500 },
    );
  });

  it("agrees on handpicked tricky values", () => {
    const cases: unknown[] = [
      // Key order is by UTF-16 code unit: U+1F600 (D83D DE00) sorts before U+FFFF, unlike UTF-8 order.
      { "\u{1F600}": 1, "￿": 2, a: 3, é: 4, Z: 5 },
      { "": 0, " ": 1 },
      { s: '  \u007f\u0000\u001f"\\/' },
      {
        n: [
          0,
          -0,
          1,
          -1,
          1e21,
          1e-7,
          123456789012345680000,
          0.1 + 0.2,
          1.5e300,
          5e-324,
          2 ** 53,
        ],
      },
      { nested: { z: [{ b: 1, a: [] }, null, true, false], a: {} } },
      [],
      {},
      "plain string",
      42,
      null,
      true,
    ];
    for (const value of cases) {
      expectSame(
        outcome(() => ts.canonicalJson(value)),
        outcome(() => rust.canonicalJson(value)),
        value,
      );
    }
  });

  it("hashAction agrees on valid and invalid actions, and matches the recorded golden hash", () => {
    fc.assert(
      fc.property(arbMaybeInvalidAction, (action) => {
        // hashAction itself doesn't validate in TS; Rust's parse does. Only compare valid ones.
        expectSame(
          outcome(() => ts.hashAction(action)),
          outcome(() => rust.hashAction(action)),
          action,
        );
      }),
      { numRuns: 800 },
    );
    fc.assert(
      fc.property(arbAction, (action) => {
        expect(rust.hashAction(action)).toBe(ts.hashAction(action));
      }),
      { numRuns: 800 },
    );

    const golden = {
      checkId: "chk_01",
      payee: "0.0.5001",
      resource: "https://kavach.test/api/x402/merchant/electricity",
      amount: { asset: { kind: "HBAR" as const }, units: ts.hbar(12).units },
      verdictHash: ts.sha256Hex("verdict-v1"),
      version: 1,
    };
    expect(rust.hashAction(golden)).toBe(
      "062b70655d1cf5c4f7e280a422f1c3b23f49120ce5a8a5496ceaaa15adaa700d",
    );
  });
});
