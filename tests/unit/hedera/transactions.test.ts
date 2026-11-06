import { describe, expect, it } from "vitest";
import {
  fetchMirrorTransaction,
  toMirrorTransactionId,
} from "@/adapters/hedera";

describe("toMirrorTransactionId", () => {
  it("converts the SDK form to the mirror node form", () => {
    expect(toMirrorTransactionId("0.0.1001@1700000000.123456789")).toBe(
      "0.0.1001-1700000000-123456789",
    );
    expect(toMirrorTransactionId("0.0.1001@1700000000.5")).toBe(
      "0.0.1001-1700000000-5",
    );
  });
  it("keeps an id that is already in mirror form", () => {
    expect(toMirrorTransactionId("0.0.1001-1700000000-123456789")).toBe(
      "0.0.1001-1700000000-123456789",
    );
  });
  it.each([
    "",
    "demo",
    "0.0.1001@abc.def",
    "0.0.1001@1.1/../../x",
    "1001@1.1",
    "0.0.1001@1700000000.1234567890",
  ])("rejects %j", (bad) => {
    expect(toMirrorTransactionId(bad)).toBeNull();
  });
});

describe("fetchMirrorTransaction", () => {
  const ok = {
    transactions: [
      {
        result: "SUCCESS",
        name: "CRYPTOTRANSFER",
        transfers: [
          { account: "0.0.1001", amount: -150_000_100 },
          { account: "0.0.5001", amount: 150_000_000 },
        ],
      },
    ],
  };

  it("reads result, type and transfers", async () => {
    const seen: string[] = [];
    const doFetch = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(ok));
    }) as unknown as typeof fetch;
    const tx = await fetchMirrorTransaction(
      "https://testnet.mirrornode.hedera.com/ignored/path",
      "0.0.1001@1700000000.123456789",
      doFetch,
    );
    expect(tx).toEqual({
      result: "SUCCESS",
      name: "CRYPTOTRANSFER",
      transfers: ok.transactions[0]?.transfers,
    });
    expect(seen).toEqual([
      "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.1001-1700000000-123456789",
    ]);
  });

  it("returns null while the transaction has not reached the mirror node", async () => {
    const doFetch = (async () =>
      new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect(
      await fetchMirrorTransaction("https://m.test", "0.0.1@1.1", doFetch),
    ).toBeNull();
  });

  it("rejects a bad id before any request, and surfaces server errors and odd bodies", async () => {
    let called = false;
    const never = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    await expect(
      fetchMirrorTransaction("https://m.test", "demo", never),
    ).rejects.toMatchObject({ kind: "INVALID_MESSAGE" });
    expect(called).toBe(false);

    const broken = (async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchMirrorTransaction("https://m.test", "0.0.1@1.1", broken),
    ).rejects.toMatchObject({ kind: "MIRROR_FAILED" });
    const odd = (async () =>
      new Response(
        JSON.stringify({ transactions: [] }),
      )) as unknown as typeof fetch;
    await expect(
      fetchMirrorTransaction("https://m.test", "0.0.1@1.1", odd),
    ).rejects.toMatchObject({ kind: "MIRROR_FAILED" });
  });
});
