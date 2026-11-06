/**
 * The two ports that turn a Kavach402 check into a task: the "merchant" is the
 * worker's chat-completions endpoint and the "resource" is the answer. The
 * check pipeline does everything else (0G reading, verifier evidence, policy,
 * World ID, audit) exactly as it does for any payment.
 *
 * Both ports talk only to the listed worker, through the address-checking
 * fetch. The probe refuses a challenge that pays anyone but the listed
 * account, or more than the listing's price or the buyer's maximum. The payer
 * signs for exactly that challenge, once.
 */

import { decodePaymentResponseHeader } from "@x402/core/http";
import type { SchemeNetworkClient } from "@x402/core/types";
import { createPayingFetch } from "@/adapters/x402";
import {
  AgentError,
  type Challenge,
  type MerchantPayer,
  type ResourceProbe,
} from "@/agent/types";
import { chatCompletionsUrl, readChallenge } from "@/marketplace/challenge";
import { validateEndpoint } from "@/marketplace/endpoint";
import { scribeReply } from "@/marketplace/scribe";
import type { AgentListing } from "@/marketplace/types";
import { readAnswer } from "./answer";
import type { TaskRecord } from "./types";

export interface WorkerHooks {
  /** Payment is about to be signed and the worker called. */
  started(): Promise<void>;
  /** The worker's cleaned answer, or null when it sent none. */
  answered(text: string | null): Promise<void>;
}

export interface WorkerPorts {
  probe: ResourceProbe;
  payer: MerchantPayer;
}

export const chatBody = (listing: AgentListing, task: TaskRecord) =>
  JSON.stringify({
    model: listing.model,
    messages: [{ role: "user", content: task.prompt }],
  });

/** The most this task may pay: the listing's price, and never above the buyer's maximum. */
export const taskCeiling = (listing: AgentListing, task: TaskRecord) =>
  listing.priceTinybars < task.maxPriceTinybars
    ? listing.priceTinybars
    : task.maxPriceTinybars;

export interface LiveWorkerConfig {
  network: "hedera:testnet" | "hedera:mainnet";
  accountId: string;
  privateKey: string;
  safeFetch: typeof fetch;
  allowLocalEndpoints?: boolean;
  scheme?: SchemeNetworkClient;
}

export function createLiveWorkerPorts(
  config: LiveWorkerConfig,
  listing: AgentListing,
  task: TaskRecord,
  hooks: WorkerHooks,
): WorkerPorts {
  const endpoint = validateEndpoint(listing.endpoint, {
    allowLocalHttp: config.allowLocalEndpoints ?? false,
  });
  const url = endpoint.ok ? chatCompletionsUrl(endpoint.url) : null;
  const request = (): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: chatBody(listing, task),
  });

  const probe: ResourceProbe = {
    async challenge(): Promise<Challenge> {
      const notPayable = (why: string) =>
        new AgentError("RESOURCE_NOT_PAYABLE", why);
      if (!url) throw notPayable("worker endpoint refused");
      let res: Response;
      try {
        res = await config.safeFetch(url, request());
      } catch {
        throw notPayable("worker unreachable");
      }
      const read = readChallenge(res, config.network);
      if (!read.ok) throw notPayable(read.reason);
      if (read.payTo !== listing.payTo)
        throw notPayable("worker asks to be paid to another account");
      if (read.amount > taskCeiling(listing, task))
        throw notPayable("worker asks for more than allowed");
      return { payTo: read.payTo, amount: read.amount };
    },
  };

  const payer: MerchantPayer = {
    async pay(_resourceUrl, challenge) {
      if (!url)
        throw new AgentError("PAYMENT_FAILED", "worker endpoint refused");
      const client = createPayingFetch({
        network: config.network,
        allowedPayTo: [challenge.payTo],
        maxPerPayment: challenge.amount,
        budget: challenge.amount,
        accountId: config.accountId,
        privateKey: config.privateKey,
        baseFetch: config.safeFetch,
        ...(config.scheme && { scheme: config.scheme }),
      });
      await hooks.started();
      let res: Response;
      try {
        res = await client.fetch(url, request());
      } catch (e) {
        throw new AgentError(
          "PAYMENT_FAILED",
          e instanceof Error ? e.message : String(e),
        );
      }
      if (!res.ok)
        throw new AgentError("PAYMENT_FAILED", `worker returned ${res.status}`);
      await hooks.answered(readAnswer(await res.json().catch(() => null)));
      let transactionId: string | undefined;
      const header = res.headers.get("PAYMENT-RESPONSE");
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

  return { probe, payer };
}

/**
 * Demo mode: no money moves. Only the built-in worker runs, called in-process;
 * a registered third-party worker would want real payment.
 */
export function createDemoWorkerPorts(
  listing: AgentListing,
  task: TaskRecord,
  hooks: WorkerHooks,
  now: () => number,
): WorkerPorts {
  return {
    probe: {
      async challenge() {
        if (!listing.builtIn)
          throw new AgentError(
            "RESOURCE_NOT_PAYABLE",
            "demo mode runs only the built-in worker",
          );
        return { payTo: listing.payTo, amount: taskCeiling(listing, task) };
      },
    },
    payer: {
      async pay() {
        await hooks.started();
        const reply = scribeReply(
          { messages: [{ role: "user", content: task.prompt }] },
          now(),
        );
        await hooks.answered(readAnswer(reply));
        const seconds = Math.floor(now() / 1000);
        return { transactionId: `0.0.1001@${seconds}.000000001` };
      },
    },
  };
}
