/**
 * x402-backed implementations of the agent's network ports: reading a
 * merchant's 402 challenge, buying evidence from registered verifiers, and paying the
 * merchant. Every payment goes through a `SpendGuard` built for that one
 * payment, so a hostile server cannot make the agent sign anything else.
 */

import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from "@x402/core/http";
import type { SchemeNetworkClient } from "@x402/core/types";
import {
  createPayingFetch,
  HBAR_ASSET_ID,
  type PayingFetch,
} from "@/adapters/x402";
import { isHederaEntityId } from "@/core";
import { validateEndpoint } from "@/marketplace/endpoint";
import { parseVerifierResponse } from "@/marketplace/evidence";
import {
  AgentError,
  type Challenge,
  type MerchantPayer,
  type ResourceProbe,
  type VerifierNetwork,
} from "./types";

export interface X402AgentConfig {
  network: "hedera:testnet" | "hedera:mainnet";
  /** Agent's paying account. */
  accountId: string;
  privateKey: string;
  /** Origins merchant resources may live on. Anything else is never fetched. */
  merchantOrigins: readonly string[];
  /** Origins of the active merchants in the registry. Asked on every probe, so a suspension takes effect at once. */
  registeredMerchantOrigins?: () => Promise<readonly string[]>;
  /** Fetch for URLs a registrant chose (verifier and registered-merchant endpoints). Defaults to `fetch`; production passes the address-checking one. */
  safeFetch?: typeof fetch;
  /** Allow http listings on this machine (development). Never set on a public deployment. */
  allowLocalEndpoints?: boolean;
  /** Ceiling on what the agent will pay any one verifier call, tinybars, whatever the listing says. */
  maxPerVerifierCall?: bigint;
  /** Injected in tests. */
  fetch?: typeof fetch;
  scheme?: SchemeNetworkClient;
}

export function createX402Agent(config: X402AgentConfig): {
  probe: ResourceProbe;
  callVerifier: VerifierNetwork["call"];
  payer: MerchantPayer;
} {
  const baseFetch = config.fetch ?? fetch;
  const origins = new Set(config.merchantOrigins);
  const safeFetch = config.safeFetch ?? baseFetch;
  const maxPerVerifierCall = config.maxPerVerifierCall ?? 10_000_000n;

  const paying = (
    payTo: string,
    maxPerPayment: bigint,
    fetchImpl: typeof fetch = baseFetch,
  ): PayingFetch =>
    createPayingFetch({
      network: config.network,
      allowedPayTo: [payTo],
      maxPerPayment,
      budget: maxPerPayment,
      accountId: config.accountId,
      privateKey: config.privateKey,
      baseFetch: fetchImpl,
      ...(config.scheme && { scheme: config.scheme }),
    });

  /** Configured origins use the plain fetch; registry merchants use the address-checking one. Null when not allowed. */
  const fetcherFor = async (origin: string): Promise<typeof fetch | null> => {
    if (origins.has(origin)) return baseFetch;
    if (!config.registeredMerchantOrigins) return null;
    try {
      return (await config.registeredMerchantOrigins()).includes(origin)
        ? safeFetch
        : null;
    } catch {
      return null; // an unreadable registry allows nothing extra
    }
  };

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
      const fetchImpl = await fetcherFor(url.origin);
      if (!fetchImpl) throw notPayable("origin not allowed");

      let res: Response;
      try {
        res = await fetchImpl(url, { redirect: "manual" });
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

  /**
   * Pays one registered verifier and returns its evidence. The listing is only
   * a claim, so before any money moves: the endpoint must pass the SSRF rules,
   * the listing must accept this kind of question, and its price must be
   * within the ceiling. The payment guard then allows exactly the listed
   * account and at most the listed price, so a verifier that asks for more, or
   * for another account, is refused before anything is signed.
   */
  const callVerifier: VerifierNetwork["call"] = async (listing, subject) => {
    const reject = (why: string) => new AgentError("VERIFIER_REJECTED", why);
    if (listing.role !== "verifier" || listing.status !== "active")
      throw reject("not an active verifier");
    if (listing.input !== subject.kind)
      throw reject(`${listing.id} does not answer ${subject.kind} questions`);
    if (listing.priceTinybars > maxPerVerifierCall)
      throw reject("listed price is above the ceiling");
    const endpoint = validateEndpoint(listing.endpoint, {
      allowLocalHttp: config.allowLocalEndpoints ?? false,
    });
    if (!endpoint.ok) throw reject(`endpoint refused: ${endpoint.reason}`);

    const url = new URL(endpoint.url);
    if (subject.kind === "link") url.searchParams.set("url", subject.url);
    else url.searchParams.set("payee", subject.account);

    const res = await paying(listing.payTo, listing.priceTinybars, safeFetch)
      .fetch(url)
      .catch((e: unknown) => {
        throw new AgentError(
          "PAYMENT_FAILED",
          e instanceof Error ? e.message : String(e),
        );
      });
    if (!res.ok)
      throw new AgentError(
        "PAYMENT_FAILED",
        `${listing.id} returned ${res.status}`,
      );
    return parseVerifierResponse(await res.json(), listing);
  };

  const payer: MerchantPayer = {
    async pay(resourceUrl, challenge) {
      // Exactly this payee and at most this amount, for this one payment.
      const client = paying(
        challenge.payTo,
        challenge.amount,
        (await fetcherFor(new URL(resourceUrl).origin)) ?? baseFetch,
      );
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

  return { probe, callVerifier, payer };
}
