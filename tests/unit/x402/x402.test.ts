import { encodePaymentRequiredHeader } from "@x402/core/http";
import type {
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import {
  checkLink,
  createPayingFetch,
  HBAR_ASSET_ID,
  hbarRouteConfig,
  linkEvidence,
  linkQuerySchema,
  paidRoute,
  payeeQuerySchema,
  SpendGuard,
  X402Error,
} from "@/adapters/x402";

const CHECKER = "0.0.7001";
const NETWORK = "hedera:testnet" as const;
const guardConfig = {
  network: NETWORK,
  allowedPayTo: [CHECKER],
  maxPerPayment: 10_000_000n,
  budget: 25_000_000n,
};
const req = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: NETWORK,
  asset: HBAR_ASSET_ID,
  amount: "5000000",
  payTo: CHECKER,
  maxTimeoutSeconds: 60,
  extra: {},
  ...over,
});

describe("SpendGuard", () => {
  it("accepts an HBAR exact payment to an allowed payee and reserves it", () => {
    const g = new SpendGuard(guardConfig);
    expect(g.reserve(req())).toEqual({ ok: true, amount: 5_000_000n });
    expect(g.spentTinybars).toBe(5_000_000n);
    expect(g.remainingTinybars).toBe(20_000_000n);
  });

  it.each([
    ["BAD_SCHEME", { scheme: "upto" }],
    ["BAD_NETWORK", { network: "hedera:mainnet" }],
    ["BAD_NETWORK", { network: "eip155:84532" }],
    ["BAD_ASSET", { asset: "0.0.429274" }],
    ["BAD_AMOUNT", { amount: "0" }],
    ["BAD_AMOUNT", { amount: "-5" }],
    ["BAD_AMOUNT", { amount: "1.5" }],
    ["BAD_AMOUNT", { amount: "" }],
    ["BAD_AMOUNT", { amount: "0x10" }],
    ["PAYEE_NOT_ALLOWED", { payTo: "0.0.9999" }],
    ["OVER_PER_PAYMENT_CAP", { amount: "10000001" }],
  ] as const)("rejects %s", (reason, over) => {
    const g = new SpendGuard(guardConfig);
    expect(g.reserve(req(over))).toEqual({ ok: false, reason });
    expect(g.spentTinybars).toBe(0n);
  });

  it("stops at the total budget and keeps earlier reservations", () => {
    const g = new SpendGuard(guardConfig);
    for (let i = 0; i < 2; i++)
      expect(g.reserve(req({ amount: "10000000" })).ok).toBe(true);
    expect(g.reserve(req({ amount: "6000000" }))).toEqual({
      ok: false,
      reason: "OVER_BUDGET",
    });
    expect(g.reserve(req({ amount: "5000000" })).ok).toBe(true);
    expect(g.remainingTinybars).toBe(0n);
  });

  it("releases a reservation, never going below zero", () => {
    const g = new SpendGuard(guardConfig);
    g.reserve(req());
    g.release(5_000_000n);
    expect(g.spentTinybars).toBe(0n);
    g.release(1n);
    expect(g.spentTinybars).toBe(0n);
  });

  it("refuses inconsistent limits", () => {
    expect(() => new SpendGuard({ ...guardConfig, maxPerPayment: 0n })).toThrow(
      RangeError,
    );
    expect(() => new SpendGuard({ ...guardConfig, budget: 0n })).toThrow(
      RangeError,
    );
    expect(
      () => new SpendGuard({ ...guardConfig, maxPerPayment: 30_000_000n }),
    ).toThrow(/<= budget/);
  });
});

describe("createPayingFetch", () => {
  const scheme: SchemeNetworkClient = {
    scheme: "exact",
    async createPaymentPayload(x402Version) {
      return { x402Version, payload: { transaction: "dGVzdA==" } };
    },
  };

  function challengeServer(
    requirements: PaymentRequirements,
    calls: Request[] = [],
  ) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push(request);
      if (request.headers.get("PAYMENT-SIGNATURE"))
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response("{}", {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
            x402Version: 2,
            resource: { url: "https://checker.test/api" },
            accepts: [requirements],
          }),
        },
      });
    }) as typeof fetch;
  }

  const make = (requirements: PaymentRequirements, calls: Request[] = []) =>
    createPayingFetch({
      ...guardConfig,
      accountId: "0.0.1001",
      privateKey: "unused",
      scheme,
      baseFetch: challengeServer(requirements, calls),
    });

  it("pays an allowed challenge and retries with a payment header", async () => {
    const calls: Request[] = [];
    const paying = make(req(), calls);
    const res = await paying.fetch("https://checker.test/api");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get("PAYMENT-SIGNATURE")).toBeTruthy();
    expect(paying.guard.spentTinybars).toBe(5_000_000n);
  });

  it.each([
    ["PAYEE_NOT_ALLOWED", { payTo: "0.0.666" }],
    ["OVER_PER_PAYMENT_CAP", { amount: "99000000" }],
    ["BAD_ASSET", { asset: "0.0.429274" }],
  ] as const)("refuses to sign a challenge that fails the guard (%s)", async (reason, over) => {
    const calls: Request[] = [];
    const paying = make(req(over), calls);
    await expect(
      paying.fetch("https://checker.test/api"),
    ).rejects.toMatchObject({
      name: "X402Error",
      kind: "GUARD_REJECTED",
      message: reason,
    });
    expect(calls).toHaveLength(1);
    expect(paying.guard.spentTinybars).toBe(0n);
  });

  it("releases the reservation when creating the payment fails", async () => {
    const failing: SchemeNetworkClient = {
      scheme: "exact",
      async createPaymentPayload() {
        throw new Error("signer offline");
      },
    };
    const paying = createPayingFetch({
      ...guardConfig,
      accountId: "0.0.1001",
      privateKey: "unused",
      scheme: failing,
      baseFetch: challengeServer(req()),
    });
    const err = await paying.fetch("https://checker.test/api").catch((e) => e);
    expect(err).toBeInstanceOf(X402Error);
    expect(err.kind).toBe("PAYMENT_FAILED");
    expect(paying.guard.spentTinybars).toBe(0n);
  });

  it("passes non-402 responses through untouched", async () => {
    const paying = createPayingFetch({
      ...guardConfig,
      accountId: "0.0.1001",
      privateKey: "unused",
      scheme,
      baseFetch: (async () =>
        new Response("free", { status: 200 })) as typeof fetch,
    });
    expect(await (await paying.fetch("https://x.test")).text()).toBe("free");
    expect(paying.guard.spentTinybars).toBe(0n);
  });
});

describe("route helpers", () => {
  it("builds an HBAR exact route config with the amount as a decimal string", () => {
    const cfg = hbarRouteConfig(
      { amount: 150_000_000n, description: "d" },
      NETWORK,
      CHECKER,
    );
    expect(cfg.accepts).toEqual([
      {
        scheme: "exact",
        price: { asset: "0.0.0", amount: "150000000" },
        network: NETWORK,
        payTo: CHECKER,
      },
    ]);
    expect(() =>
      hbarRouteConfig({ amount: 0n, description: "d" }, NETWORK, CHECKER),
    ).toThrow(RangeError);
  });

  it("returns 503 instead of serving for free when no payee account is configured", async () => {
    let ran = false;
    const handler = paidRoute(
      async () => {
        ran = true;
        return NextResponse.json({ secret: true });
      },
      { amount: 1n, description: "d" },
    );
    const res = await handler(
      new NextRequest("http://localhost/api/x402/test"),
    );
    expect(res.status).toBe(503);
    expect(ran).toBe(false);
  });
});

describe("checkers", () => {
  it("flags a lookalike link at high level with the signals as detail", () => {
    const { evidence, report } = checkLink(
      "https://paypa1.com.account-verify.top/login",
    );
    expect(evidence.source).toBe("link-intel");
    expect(evidence.level).toBe("high");
    expect(evidence.detail).toMatch(/score \d+/);
    expect(report.signals.length).toBeGreaterThan(0);
  });

  it("reports a clean brand domain as low with no signals", () => {
    const { evidence } = checkLink("https://www.paypal.com/");
    expect(evidence).toMatchObject({
      level: "low",
      detail: "no signals (score 0)",
    });
  });

  it("marks landing-page signals in the detail", () => {
    const evidence = linkEvidence({
      host: "a.example",
      unicodeHost: "a.example",
      registrableDomain: "a.example",
      landingHost: "b.example",
      score: 50,
      level: "high",
      signals: [
        {
          code: "REDIRECT_DOWNGRADE",
          severity: "high",
          stage: "landing",
          detail: "x",
        },
      ],
    });
    expect(evidence.detail).toBe("REDIRECT_DOWNGRADE (landing) (score 50)");
  });

  it("validates query inputs", () => {
    expect(linkQuerySchema.safeParse({ url: "" }).success).toBe(false);
    expect(linkQuerySchema.safeParse({ url: "x".repeat(2001) }).success).toBe(
      false,
    );
    expect(linkQuerySchema.safeParse({ url: "https://a.b" }).success).toBe(
      true,
    );
    expect(payeeQuerySchema.safeParse({ payee: "nope" }).success).toBe(false);
    expect(payeeQuerySchema.safeParse({ payee: "0.0.5001" }).success).toBe(
      true,
    );
  });
});
