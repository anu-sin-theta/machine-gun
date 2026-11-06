import { describe, expect, it } from "vitest";
import { createX402Agent } from "@/agent/x402";
import { loadConfig } from "@/config/env";
import { createSafeFetch, proveControl } from "@/marketplace";
import type { AgentListing } from "@/marketplace/types";

const { hedera } = loadConfig(process.env);
const endpoint = process.env.LIVE_VERIFIER_ENDPOINT;
const payTo = process.env.LIVE_VERIFIER_PAYTO;
const input = process.env.LIVE_VERIFIER_INPUT === "payee" ? "payee" : "link";
const price = BigInt(process.env.LIVE_VERIFIER_PRICE_TINYBARS ?? "5000000");
const ready = Boolean(
  hedera.agentAccountId && hedera.agentPrivateKey && endpoint && payTo,
);

const listing = (): AgentListing => ({
  id: "live-verifier",
  role: "verifier",
  name: "Live verifier",
  description: "A verifier under test.",
  endpoint: endpoint as string,
  input,
  payTo: payTo as string,
  priceTinybars: price,
  evidenceSource: "live-verifier",
  model: null,
  skills: [],
  status: "active",
  builtIn: false,
  createdAt: 0,
});

describe.skipIf(!ready)(
  "A verifier paid over x402 (live): needs HEDERA_AGENT_*, LIVE_VERIFIER_ENDPOINT and LIVE_VERIFIER_PAYTO; spends up to LIVE_VERIFIER_PRICE_TINYBARS of real testnet HBAR",
  () => {
    const safeFetch = createSafeFetch({ allowLocal: true });

    it("proves control: its unpaid 402 names the listed account", async () => {
      expect(
        await proveControl(listing(), {
          fetch: safeFetch,
          network: `hedera:${hedera.network}`,
          allowLocalEndpoints: true,
        }),
      ).toEqual({ ok: true });
    });

    it("is paid through its own guard and answers with evidence under the listing's name", async () => {
      const agent = createX402Agent({
        network: `hedera:${hedera.network}`,
        accountId: hedera.agentAccountId as string,
        privateKey: hedera.agentPrivateKey as string,
        merchantOrigins: [],
        allowLocalEndpoints: true,
        safeFetch,
      });
      const evidence = await agent.callVerifier(
        listing(),
        input === "payee"
          ? { kind: "payee", account: payTo as string }
          : { kind: "link", url: "https://example.com/" },
      );
      expect(evidence.source).toBe("live-verifier");
      expect(["low", "medium", "high"]).toContain(evidence.level);
      expect(evidence.detail.length).toBeLessThanOrEqual(200);
    });
  },
);
