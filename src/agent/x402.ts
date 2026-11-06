/**
 * x402-backed implementations of the agent's network ports: reading a
 * merchant's 402 challenge, buying evidence from the checkers, and paying the
 * merchant. Every payment goes through a `SpendGuard` built for that one
 * payment, so a hostile server cannot make the agent sign anything else.
 */

import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from "@x402/core/http";
import type { SchemeNetworkClient } from "@x402/core/types";
import { z } from "zod";
import {
  createPayingFetch,
  HBAR_ASSET_ID,
  type PayingFetch,
} from "@/adapters/x402";
import type { Evidence } from "@/adapters/zerog";
import { isHederaEntityId } from "@/core";
import {
  AgentError,
  type Challenge,
  type Checkers,
  type MerchantPayer,
  type ResourceProbe,
} from "./types";

export interface X402AgentConfig {
  network: "hedera:testnet" | "hedera:mainnet";
  /** Agent's paying account. */
  accountId: string;
  privateKey: string;
  /** Base URL of this app, where the checker routes live. */
  baseUrl: string;
  /** Account that receives checker payments (the only payee the agent pays on its own). */
  checkerPayTo: string;
  /** Origins merchant resources may live on. Anything else is never fetched. */
  merchantOrigins: readonly string[];
  /** Most the agent will pay one checker call, tinybars. */
  maxPerCheckerCall?: bigint;
  /** Injected in tests. */
  fetch?: typeof fetch;
  scheme?: SchemeNetworkClient;
}

const evidenceSchema = z.object({
  source: z.string().min(1).max(50),
  level: z.enum(["low", "medium", "high"]),
  detail: z.string().max(300),
});

export function createX402Agent(config: X402AgentConfig): {
  probe: ResourceProbe;
  checkers: Checkers;
  payer: MerchantPayer;
} {
  const baseFetch = config.fetch ?? fetch;
  const origins = new Set(config.merchantOrigins);
  const maxPerCheckerCall = config.maxPerCheckerCall ?? 10_000_000n;

  const paying = (payTo: string, maxPerPayment: bigint): PayingFetch =>
    createPayingFetch({
      network: config.network,
      allowedPayTo: [payTo],
      maxPerPayment,
      budget: maxPerPayment,
      accountId: config.accountId,
      privateKey: config.privateKey,
      baseFetch,
      ...(config.scheme && { scheme: config.scheme }),
    });

  const probe: ResourceProbe = {
    async challenge(resourceUrl): Promise<Challenge> {
      const notPayable = (why: string) =>
        new AgentError("RESOURCE_NOT_PAYABLE", why);
      let url: URL;
      try {
        url = new URL(resourceUrl);
      } catch {
        throw notPayable("bad url");
      }
      // The URL comes from the user: never fetch anywhere we did not allow.
      if (!origins.has(url.origin)) throw notPayable("origin not allowed");

      let res: Response;
      try {
        res = await baseFetch(url, { redirect: "manual" });
      } catch {
        throw notPayable("unreachable");
      }
      if (res.status !== 402)
        throw notPayable(`expected 402, got ${res.status}`);
      const header = res.headers.get("PAYMENT-REQUIRED");
      if (!header) throw notPayable("no payment requirements");

      let accepts: Array<{
        scheme: string;
        network: string;
        asset: string;
        amount: string;
        payTo: string;
      }>;
      try {
        accepts = decodePaymentRequiredHeader(header).accepts;
      } catch {
        throw notPayable("unreadable payment requirements");
      }
      const option = accepts.find(
        (a) =>
          a.scheme === "exact" &&
          a.network === config.network &&
          a.asset === HBAR_ASSET_ID &&
          /^[1-9]\d*$/.test(a.amount) &&
          isHederaEntityId(a.payTo),
      );
      if (!option) throw notPayable("no HBAR exact option on this network");
      return { payTo: option.payTo, amount: BigInt(option.amount) };
    },
  };

  async function callChecker(
    path: string,
    query: Record<string, string>,
  ): Promise<Evidence> {
    const url = new URL(path, config.baseUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await paying(config.checkerPayTo, maxPerCheckerCall)
      .fetch(url)
      .catch((e: unknown) => {
        throw new AgentError(
          "PAYMENT_FAILED",
          e instanceof Error ? e.message : String(e),
        );
      });
    if (!res.ok)
      throw new AgentError("PAYMENT_FAILED", `checker returned ${res.status}`);
    const body = z.object({ evidence: evidenceSchema }).parse(await res.json());
    return body.evidence;
  }

  const checkers: Checkers = {
    link: (link) => callChecker("/api/x402/checkers/link", { url: link }),
    reputation: (payee) =>
      callChecker("/api/x402/checkers/reputation", { payee }),
  };

  const payer: MerchantPayer = {
    async pay(resourceUrl, challenge) {
      // Exactly this payee and at most this amount, for this one payment.
      const client = paying(challenge.payTo, challenge.amount);
      let res: Response;
      try {
        res = await client.fetch(resourceUrl);
      } catch (e) {
        // createPayingFetch already wraps every failure as an X402Error.
        throw new AgentError(
          "PAYMENT_FAILED",
          e instanceof Error ? e.message : String(e),
        );
      }
      if (!res.ok)
        throw new AgentError(
          "PAYMENT_FAILED",
          `merchant returned ${res.status}`,
        );
      const header = res.headers.get("PAYMENT-RESPONSE");
      let transactionId: string | undefined;
      if (header) {
        try {
          transactionId =
            decodePaymentResponseHeader(header).transaction || undefined;
        } catch {
          transactionId = undefined;
        }
      }
      return transactionId ? { transactionId } : {};
    },
  };

  return { probe, checkers, payer };
}
