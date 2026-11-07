import { encodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, it } from "vitest";
import { createDemoPorts } from "@/agent/demo";
import { builtInListings } from "@/marketplace/builtins";
import { DEMO_PAYMENT } from "@/marketplace/challenge";
import type { AgentListing } from "@/marketplace/types";

const NETWORK = "hedera:testnet" as const;
const JUDGE: AgentListing = {
  id: "acme-link-judge",
  role: "verifier",
  name: "Acme link judge",
  description: "Judges links.",
  endpoint: "https://judge.acme.example/check",
  input: "link",
  payTo: "0.0.7104",
  priceTinybars: 3_000_000n,
  evidenceSource: "acme-link-judge",
  model: null,
  skills: [],
  status: "active",
  builtIn: false,
  createdAt: 0,
};
const LINK = {
  kind: "link" as const,
  url: "https://sbi-secure-login.top/verify",
};

/** A third-party verifier: 402 until it sees the demo marker, then its answer. */
function judge(
  opts: { payTo?: string; amount?: string; answer?: () => Response } = {},
) {
  const seen: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    if (req.headers.get("PAYMENT-SIGNATURE") === DEMO_PAYMENT)
      return (
        opts.answer?.() ??
        Response.json({
          evidence: {
            level: "high",
            detail: "lookalike bank domain",
            source: "link-intel",
          },
        })
      );
    return new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
          x402Version: 2,
          resource: { url: req.url },
          accepts: [
            {
              scheme: "exact",
              network: NETWORK,
              asset: "0.0.0",
              amount: opts.amount ?? "3000000",
              payTo: opts.payTo ?? JUDGE.payTo,
              maxTimeoutSeconds: 300,
              extra: {},
            },
          ],
        }),
      },
    });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const ports = (j = judge()) =>
  createDemoPorts(["http://localhost:3000"], {
    network: NETWORK,
    safeFetch: j.fetchImpl,
  });

describe("demo mode with a third-party verifier", () => {
  it("probes its 402, asks it with the demo marker, and keeps its evidence under its own name", async () => {
    const j = judge();
    const evidence = await ports(j).callVerifier(JUDGE, LINK);
    expect(evidence).toEqual({
      source: "acme-link-judge",
      level: "high",
      detail: "lookalike bank domain",
    });
    expect(j.seen).toHaveLength(2);
    expect(new URL(j.seen[0]?.url ?? "").searchParams.get("url")).toBe(
      LINK.url,
    );
    expect(j.seen[0]?.headers.get("PAYMENT-SIGNATURE")).toBeNull();
    expect(j.seen[1]?.headers.get("PAYMENT-SIGNATURE")).toBe(DEMO_PAYMENT);
  });

  it.each([
    ["names another account", { payTo: "0.0.9999" }, /another account/],
    [
      "asks more than its listing",
      { amount: "3000001" },
      /more than its listed price/,
    ],
  ])("refuses a verifier whose 402 %s, before asking it", async (_n, o, reason) => {
    const j = judge(o);
    await expect(ports(j).callVerifier(JUDGE, LINK)).rejects.toMatchObject({
      kind: "VERIFIER_REJECTED",
      message: expect.stringMatching(reason),
    });
    expect(j.seen).toHaveLength(1);
  });

  it("refuses listings that do not fit, without calling them", async () => {
    const j = judge();
    const p = ports(j);
    for (const bad of [
      { ...JUDGE, status: "suspended" as const },
      { ...JUDGE, input: "payee" as const },
      { ...JUDGE, priceTinybars: 10_000_001n },
      { ...JUDGE, endpoint: "https://10.0.0.1/check" },
    ])
      await expect(p.callVerifier(bad, LINK)).rejects.toMatchObject({
        kind: "VERIFIER_REJECTED",
      });
    expect(j.seen).toHaveLength(0);
  });

  it("asks a payee verifier about the payee", async () => {
    const j = judge();
    await ports(j).callVerifier(
      { ...JUDGE, input: "payee" },
      { kind: "payee", account: "0.0.5001" },
    );
    expect(new URL(j.seen[0]?.url ?? "").searchParams.get("payee")).toBe(
      "0.0.5001",
    );
  });

  it("treats an error answer as a failure", async () => {
    const j = judge({ answer: () => new Response("{}", { status: 502 }) });
    await expect(ports(j).callVerifier(JUDGE, LINK)).rejects.toMatchObject({
      message: "acme-link-judge returned 502",
    });
  });

  it("still runs built-in verifiers locally, without any network call", async () => {
    const j = judge();
    const linkIntel = builtInListings({
      baseUrl: "http://localhost:3000",
      payTo: "0.0.5001",
      now: 0,
    }).find((l) => l.evidenceSource === "link-intel") as AgentListing;
    const evidence = await ports(j).callVerifier(linkIntel, LINK);
    expect(evidence.source).toBe("link-intel");
    expect(j.seen).toHaveLength(0);
  });
});
