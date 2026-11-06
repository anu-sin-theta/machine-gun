import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import { describe, expect, it } from "vitest";
import { AgentError } from "@/agent";
import { isAuthorized } from "@/agent/auth";
import { createX402Agent } from "@/agent/x402";

const NETWORK = "hedera:testnet" as const;
const MERCHANT = "http://localhost:3000/api/x402/merchant/electricity";
const CHECKER_PAYEE = "0.0.8001";

const option = (
  over: Partial<PaymentRequirements> = {},
): PaymentRequirements => ({
  scheme: "exact",
  network: NETWORK,
  asset: "0.0.0",
  amount: "150000000",
  payTo: "0.0.5001",
  maxTimeoutSeconds: 300,
  extra: {},
  ...over,
});

const scheme: SchemeNetworkClient = {
  scheme: "exact",
  async createPaymentPayload(x402Version) {
    return { x402Version, payload: { transaction: "dGVzdA==" } };
  },
};

interface Route {
  accepts: PaymentRequirements[];
  /** What a paid request returns. */
  paid?: () => Response;
  /** Answer unpaid requests with this instead of a 402 challenge. */
  unpaid?: () => Response;
}

/** A tiny x402 server: 402 challenge until a PAYMENT-SIGNATURE arrives. */
function server(routes: Record<string, Route>, seen: Request[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push(request);
    const route = routes[new URL(request.url).pathname];
    if (!route) return new Response("{}", { status: 404 });
    if (request.headers.get("PAYMENT-SIGNATURE"))
      return route.paid?.() ?? new Response("{}", { status: 200 });
    if (route.unpaid) return route.unpaid();
    return new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
          x402Version: 2,
          resource: { url: request.url },
          accepts: route.accepts,
        }),
      },
    });
  }) as typeof fetch;
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers });

const make = (fetchImpl: typeof fetch) =>
  createX402Agent({
    network: NETWORK,
    accountId: "0.0.1001",
    privateKey: "unused",
    baseUrl: "http://localhost:3000",
    checkerPayTo: CHECKER_PAYEE,
    merchantOrigins: ["http://localhost:3000", "https://merchant.example"],
    fetch: fetchImpl,
    scheme,
  });

describe("probe.challenge", () => {
  it("reads payee and amount from the merchant's HBAR challenge", async () => {
    const agent = make(
      server({ "/api/x402/merchant/electricity": { accepts: [option()] } }),
    );
    expect(await agent.probe.challenge(MERCHANT)).toEqual({
      payTo: "0.0.5001",
      amount: 150_000_000n,
    });
  });

  it("picks the HBAR exact option on our network and ignores the rest", async () => {
    const agent = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [
            option({ asset: "0.0.429274" }),
            option({ network: "hedera:mainnet" }),
            option({ scheme: "upto" }),
            option({ amount: "0" }),
            option({ payTo: "not-an-account" }),
            option({ payTo: "0.0.6001", amount: "42" }),
          ],
        },
      }),
    );
    expect(await agent.probe.challenge(MERCHANT)).toEqual({
      payTo: "0.0.6001",
      amount: 42n,
    });
  });

  it("never fetches an origin that is not allowed (no SSRF)", async () => {
    const seen: Request[] = [];
    const agent = make(server({}, seen));
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "http://localhost.evil.test:3000/x",
      "http://localhost:3001/x",
      "https://merchant.example:8443/x",
    ])
      await expect(agent.probe.challenge(url)).rejects.toMatchObject({
        kind: "RESOURCE_NOT_PAYABLE",
        message: "origin not allowed",
      });
    expect(seen).toHaveLength(0);
  });

  it("allows an extra configured origin", async () => {
    const agent = make(server({ "/pay": { accepts: [option()] } }));
    await expect(
      agent.probe.challenge("https://merchant.example/pay"),
    ).resolves.toMatchObject({ payTo: "0.0.5001" });
  });

  it.each([
    ["a malformed url", "::::", "bad url"],
    ["a non-402 answer", `${MERCHANT}?free`, "expected 402, got 200"],
  ])("rejects %s", async (_name, url, message) => {
    const agent = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [],
          unpaid: () => new Response("free", { status: 200 }),
        },
      }),
    );
    await expect(agent.probe.challenge(url)).rejects.toMatchObject({
      kind: "RESOURCE_NOT_PAYABLE",
      message,
    });
  });

  it("does not follow redirects", async () => {
    const agent = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [],
          unpaid: () =>
            new Response(null, {
              status: 302,
              headers: { location: "http://169.254.169.254/" },
            }),
        },
      }),
    );
    await expect(agent.probe.challenge(MERCHANT)).rejects.toMatchObject({
      message: "expected 402, got 302",
    });
  });

  it("rejects a 402 with no header, an unreadable header, or no usable option", async () => {
    const noHeader = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [],
          unpaid: () => new Response("{}", { status: 402 }),
        },
      }),
    );
    await expect(noHeader.probe.challenge(MERCHANT)).rejects.toMatchObject({
      message: "no payment requirements",
    });

    const garbage = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [],
          unpaid: () =>
            new Response("{}", {
              status: 402,
              headers: { "PAYMENT-REQUIRED": "!!!not base64 json" },
            }),
        },
      }),
    );
    await expect(garbage.probe.challenge(MERCHANT)).rejects.toMatchObject({
      message: "unreadable payment requirements",
    });

    const usdcOnly = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [option({ asset: "0.0.429274" })],
        },
      }),
    );
    await expect(usdcOnly.probe.challenge(MERCHANT)).rejects.toMatchObject({
      message: "no HBAR exact option on this network",
    });
  });

  it("reports an unreachable merchant as not payable", async () => {
    const agent = make((async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    await expect(agent.probe.challenge(MERCHANT)).rejects.toMatchObject({
      message: "unreachable",
    });
  });
});

describe("checkers", () => {
  const evidence = {
    source: "link-intel",
    level: "high",
    detail: "BRAND_IMPERSONATION (score 80)",
  };
  const routes = (paid: () => Response): Record<string, Route> => ({
    "/api/x402/checkers/link": {
      accepts: [option({ payTo: CHECKER_PAYEE, amount: "5000000" })],
      paid,
    },
    "/api/x402/checkers/reputation": {
      accepts: [option({ payTo: CHECKER_PAYEE, amount: "5000000" })],
      paid,
    },
  });

  it("pays the checker and returns validated evidence, passing the query", async () => {
    const seen: Request[] = [];
    const agent = make(
      server(
        routes(() => json({ evidence })),
        seen,
      ),
    );
    expect(
      await agent.checkers.link("https://paypa1.com/login?a=b&c=d"),
    ).toEqual(evidence);
    expect(new URL(seen[0]?.url ?? "").searchParams.get("url")).toBe(
      "https://paypa1.com/login?a=b&c=d",
    );
    expect(seen).toHaveLength(2);
    expect(await agent.checkers.reputation("0.0.5001")).toEqual(evidence);
  });

  it("will not pay a checker that asks for more than the cap or for another account", async () => {
    const tooMuch = make(
      server({
        "/api/x402/checkers/link": {
          accepts: [option({ payTo: CHECKER_PAYEE, amount: "999000000" })],
        },
      }),
    );
    await expect(tooMuch.checkers.link("https://a.b")).rejects.toMatchObject({
      kind: "PAYMENT_FAILED",
      message: "OVER_PER_PAYMENT_CAP",
    });
    const wrongPayee = make(
      server({
        "/api/x402/checkers/link": {
          accepts: [option({ payTo: "0.0.6666", amount: "5000000" })],
        },
      }),
    );
    await expect(wrongPayee.checkers.link("https://a.b")).rejects.toMatchObject(
      { kind: "PAYMENT_FAILED", message: "PAYEE_NOT_ALLOWED" },
    );
  });

  it("rejects a checker error status and a malformed evidence body", async () => {
    const failing = make(
      server(routes(() => new Response("{}", { status: 500 }))),
    );
    await expect(failing.checkers.link("https://a.b")).rejects.toBeInstanceOf(
      AgentError,
    );
    const malformed = make(
      server(
        routes(() =>
          json({ evidence: { source: "x", level: "fine", detail: "" } }),
        ),
      ),
    );
    await expect(malformed.checkers.link("https://a.b")).rejects.toBeInstanceOf(
      Error,
    );
  });
});

describe("payer.pay", () => {
  const challenge = { payTo: "0.0.5001", amount: 150_000_000n };
  const settled = (tx: string) =>
    encodePaymentResponseHeader({
      success: true,
      transaction: tx,
      network: NETWORK,
    });

  it("pays the merchant and returns the settlement transaction id", async () => {
    const agent = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [option()],
          paid: () =>
            json(
              { receipt: "r" },
              { "PAYMENT-RESPONSE": settled("0.0.1001@1700000000.1") },
            ),
        },
      }),
    );
    expect(await agent.payer.pay(MERCHANT, challenge)).toEqual({
      transactionId: "0.0.1001@1700000000.1",
    });
  });

  it("succeeds without a transaction id when the server sends no or a broken settlement header", async () => {
    const none = make(
      server({ "/api/x402/merchant/electricity": { accepts: [option()] } }),
    );
    expect(await none.payer.pay(MERCHANT, challenge)).toEqual({});
    const broken = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [option()],
          paid: () => json({}, { "PAYMENT-RESPONSE": "###" }),
        },
      }),
    );
    expect(await broken.payer.pay(MERCHANT, challenge)).toEqual({});
  });

  it("refuses to sign if the price rose after the probe, or the payee changed", async () => {
    const seen: Request[] = [];
    const pricier = make(
      server(
        {
          "/api/x402/merchant/electricity": {
            accepts: [option({ amount: "150000001" })],
          },
        },
        seen,
      ),
    );
    await expect(pricier.payer.pay(MERCHANT, challenge)).rejects.toMatchObject({
      kind: "PAYMENT_FAILED",
      message: "OVER_PER_PAYMENT_CAP",
    });
    const switched = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [option({ payTo: "0.0.9999" })],
        },
      }),
    );
    await expect(switched.payer.pay(MERCHANT, challenge)).rejects.toMatchObject(
      { message: "PAYEE_NOT_ALLOWED" },
    );
    expect(seen.every((r) => !r.headers.get("PAYMENT-SIGNATURE"))).toBe(true);
  });

  it("reports a merchant error after payment as a failure", async () => {
    const agent = make(
      server({
        "/api/x402/merchant/electricity": {
          accepts: [option()],
          paid: () => new Response("{}", { status: 500 }),
        },
      }),
    );
    await expect(agent.payer.pay(MERCHANT, challenge)).rejects.toMatchObject({
      kind: "PAYMENT_FAILED",
      message: "merchant returned 500",
    });
  });

  it("reports a signing failure as a failed payment", async () => {
    const failing: SchemeNetworkClient = {
      scheme: "exact",
      async createPaymentPayload() {
        throw new Error("signer offline");
      },
    };
    const agent = createX402Agent({
      network: NETWORK,
      accountId: "0.0.1001",
      privateKey: "unused",
      baseUrl: "http://localhost:3000",
      checkerPayTo: CHECKER_PAYEE,
      merchantOrigins: ["http://localhost:3000"],
      fetch: server({
        "/api/x402/merchant/electricity": { accepts: [option()] },
      }),
      scheme: failing,
    });
    await expect(agent.payer.pay(MERCHANT, challenge)).rejects.toMatchObject({
      kind: "PAYMENT_FAILED",
      message: expect.stringContaining("signer offline"),
    });
  });
});

describe("isAuthorized", () => {
  it("is open when no token is configured", () => {
    expect(isAuthorized(null, undefined)).toBe(true);
  });
  it("requires the exact bearer token when one is configured", () => {
    const token = "0123456789abcdef-token";
    expect(isAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(isAuthorized(null, token)).toBe(false);
    expect(isAuthorized("Bearer wrong", token)).toBe(false);
    expect(isAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(isAuthorized(token, token)).toBe(false);
    expect(isAuthorized("Basic abc", token)).toBe(false);
  });
});
