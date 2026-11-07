/**
 * Demo mode (`AGENT_MODE=demo`): the agent loop with its network ports replaced
 * by local, deterministic stand-ins, so the product can be shown and tested
 * with no 0G key, no Hedera account and no money.
 *
 * What is real: the Rust policy engine and approval binding, link-intel, the
 * reputation scoring, the evidence floor, the World flow (real or simulated),
 * and every guard in the pipeline.
 * What is faked, and labelled so in the UI: the 0G model (a keyword heuristic
 * that stands in for private reading and judging), merchant settlement (a made
 * up transaction id) and the on-chain audit and reputation logs (kept in memory).
 */

import type { AuditEvent, ReputationReport } from "@/adapters/hedera";
import { reputationEvidence } from "@/adapters/hedera";
import { checkLink } from "@/adapters/x402/checkers";
import type { Extraction, ZeroG } from "@/adapters/zerog";
import { DEMO_PAYEE } from "@/marketplace/builtins";
import { DEMO_PAYMENT, readChallenge } from "@/marketplace/challenge";
import { validateEndpoint } from "@/marketplace/endpoint";
import { parseVerifierResponse } from "@/marketplace/evidence";
import { domainHeuristics } from "@/marketplace/heuristics";
import {
  type AgentDeps,
  AgentError,
  type Challenge,
  type MerchantPayer,
  type ResourceProbe,
  type VerifierNetwork,
} from "./types";

export { DEMO_PAYEE };

/** Pretend merchants. The price is what their 402 challenge would say. */
export const DEMO_MERCHANTS: Record<string, { label: string; amount: bigint }> =
  {
    "/api/x402/merchant/electricity": {
      label: "Electricity bill (1.5 HBAR)",
      amount: 150_000_000n,
    },
    "/api/x402/merchant/rent": {
      label: "Monthly rent (12 HBAR)",
      amount: 1_200_000_000n,
    },
    "/api/x402/merchant/tuition": {
      label: "Tuition fee (60 HBAR)",
      amount: 6_000_000_000n,
    },
  };

interface DemoState {
  audit: AuditEvent[];
  reports: ReputationReport[];
  counter: number;
}

// One state for the whole process even if Next loads this module per route bundle.
const g = globalThis as { __kavachDemo?: DemoState };
const state = (): DemoState =>
  (g.__kavachDemo ??= { audit: [], reports: [], counter: 0 });

export function getDemoAudit(checkId: string): AuditEvent[] {
  return state().audit.filter((e) => e.checkId === checkId);
}

export function resetDemoState(): void {
  g.__kavachDemo = { audit: [], reports: [], counter: 0 };
}

// --- the stand-in for 0G -----------------------------------------------------

const PRESSURE: Array<[RegExp, number]> = [
  [/\b(urgent(ly)?|immediately|right now|last warning|final notice)\b/i, 1],
  [/\b(today|within \d+ (hours?|minutes?))\b/i, 1],
  [
    /\b(account|card|sim|service) (will be |is )?(blocked|suspended|closed|disconnected)\b/i,
    1,
  ],
  [/\b(legal action|arrest|police|penalty|fine)\b/i, 1],
  [
    /\b(do not|don't|dont) (tell|share this with) (anyone|anybody)\b|\bkeep (this )?(a )?secret\b/i,
    2,
  ],
  [/\b(otp|pin|password|cvv)\b/i, 2],
  [/\bkyc\b/i, 1],
];

function quoted(text: string): { phrases: string[]; weight: number } {
  const phrases: string[] = [];
  let weight = 0;
  for (const [re, w] of PRESSURE) {
    const m = re.exec(text);
    if (m) {
      phrases.push(m[0]);
      weight += w;
    }
  }
  return { phrases, weight };
}

export function demoExtract(text: string): Extraction {
  const account = /\b(\d+\.\d+\.\d+)\b/.exec(text)?.[1] ?? null;
  const link = /https?:\/\/[^\s)>"']+/i.exec(text)?.[0] ?? null;
  const amount = /(\d+(?:\.\d+)?)\s*(HBAR|INR|Rs\.?|USD)\b/i.exec(text);
  const { phrases } = quoted(text);
  return {
    payeeName: null,
    payeeAccount: account,
    amountText: amount?.[1] ?? null,
    currency: amount?.[2]?.toUpperCase() ?? null,
    link,
    deadlineText: /\b(today|tomorrow|by \w+day)\b/i.exec(text)?.[0] ?? null,
    pressureTactics: phrases.slice(0, 10),
    summary: text.replace(/\s+/g, " ").trim().slice(0, 300),
  };
}

const demoZeroG = (): ZeroG => ({
  async extract(input) {
    if (input.kind !== "text") throw new Error("demo mode reads text only");
    return {
      value: demoExtract(input.text),
      requestId: `demo_req_${++state().counter}`,
      model: "demo-heuristic",
    };
  },
  async judge(extraction) {
    const weight = quoted(extraction.pressureTactics.join(" ")).weight;
    const level = weight >= 2 ? "high" : weight === 1 ? "medium" : "low";
    return {
      value: {
        level,
        reasons:
          extraction.pressureTactics.length > 0
            ? extraction.pressureTactics.map(
                (p) => `Pressure or secrecy language: "${p}"`,
              )
            : ["Nothing suspicious in the wording of the request"],
      },
      requestId: `demo_req_${++state().counter}`,
      model: "demo-heuristic",
    };
  },
});

// --- the stand-ins for x402 and Hedera ---------------------------------------

/**
 * Runs a listed verifier's check locally instead of paying its endpoint. The
 * analysis is the real code (the same Rust link engine, the same heuristics,
 * the same reputation scoring); only the x402 payment is skipped. Evidence is
 * labelled with the listing's name, exactly as in live mode.
 */
const demoCallVerifier: VerifierNetwork["call"] = async (listing, subject) => {
  switch (listing.evidenceSource) {
    case "link-intel":
      if (subject.kind === "link")
        return {
          ...checkLink(subject.url).evidence,
          source: listing.evidenceSource,
        };
      break;
    case "domain-heuristics":
      if (subject.kind === "link")
        return {
          ...domainHeuristics(subject.url),
          source: listing.evidenceSource,
        };
      break;
    case "reputation":
      if (subject.kind === "payee")
        return {
          ...reputationEvidence(subject.account, state().reports),
          source: listing.evidenceSource,
        };
      break;
  }
  throw new AgentError(
    "VERIFIER_REJECTED",
    `no local stand-in for ${listing.id} on ${subject.kind} checks`,
  );
};

function demoProbe(origins: readonly string[]): ResourceProbe {
  const allowed = new Set(origins);
  return {
    async challenge(resourceUrl): Promise<Challenge> {
      let url: URL;
      try {
        url = new URL(resourceUrl);
      } catch {
        throw new AgentError("RESOURCE_NOT_PAYABLE", "bad url");
      }
      if (!allowed.has(url.origin))
        throw new AgentError("RESOURCE_NOT_PAYABLE", "origin not allowed");
      const merchant = DEMO_MERCHANTS[url.pathname];
      if (!merchant)
        throw new AgentError("RESOURCE_NOT_PAYABLE", "unknown demo merchant");
      return { payTo: DEMO_PAYEE, amount: merchant.amount };
    },
  };
}

const demoPayer = (): MerchantPayer => ({
  async pay() {
    const seconds = Math.floor(Date.now() / 1000);
    return {
      transactionId: `0.0.1001@${seconds}.${String(++state().counter).padStart(9, "0")}`,
    };
  },
});

const demoLogs = (): NonNullable<AgentDeps["logs"]> => ({
  async recordAudit(event) {
    const s = state();
    s.audit.push(event);
    return {
      topicId: "demo",
      sequenceNumber: s.audit.length,
      transactionId: "demo",
      hash: "demo",
    };
  },
  async reportPayee(report) {
    const s = state();
    s.reports.push(report);
    return {
      topicId: "demo",
      sequenceNumber: s.reports.length,
      transactionId: "demo",
      hash: "demo",
    };
  },
});

/** The ports for demo mode. The caller adds repos, approval, policy, clock and randomness. */
/** How demo mode reaches third-party agents: the address-checking fetch, on the configured network. */
export interface DemoRemote {
  network: "hedera:testnet" | "hedera:mainnet";
  safeFetch: typeof fetch;
  allowLocalEndpoints?: boolean;
}

/** Most demo mode will "pay" any one verifier call, like live mode's ceiling. */
const DEMO_VERIFIER_CEILING = 10_000_000n;

/**
 * A third-party verifier in demo mode: its unpaid 402 is probed and checked
 * as in live mode (payee, price), then it is asked with `DEMO_PAYMENT` in
 * place of a signed payment. Its evidence goes through the same relabelling
 * and cleaning as live evidence.
 */
function remoteVerifier(remote: DemoRemote): VerifierNetwork["call"] {
  return async (listing, subject) => {
    const reject = (why: string) => new AgentError("VERIFIER_REJECTED", why);
    if (listing.role !== "verifier" || listing.status !== "active")
      throw reject("not an active verifier");
    if (listing.input !== subject.kind)
      throw reject(`${listing.id} does not answer ${subject.kind} questions`);
    if (listing.priceTinybars > DEMO_VERIFIER_CEILING)
      throw reject("listed price is above the ceiling");
    const endpoint = validateEndpoint(listing.endpoint, {
      allowLocalHttp: remote.allowLocalEndpoints ?? false,
    });
    if (!endpoint.ok) throw reject(`endpoint refused: ${endpoint.reason}`);
    const url = new URL(endpoint.url);
    if (subject.kind === "link") url.searchParams.set("url", subject.url);
    else url.searchParams.set("payee", subject.account);

    const challenge = readChallenge(
      await remote.safeFetch(url),
      remote.network,
    );
    if (!challenge.ok) throw reject(challenge.reason);
    if (challenge.payTo !== listing.payTo)
      throw reject("verifier asks to be paid to another account");
    if (challenge.amount > listing.priceTinybars)
      throw reject("verifier asks for more than its listed price");

    const res = await remote.safeFetch(url, {
      headers: { "PAYMENT-SIGNATURE": DEMO_PAYMENT },
    });
    if (!res.ok) throw reject(`${listing.id} returned ${res.status}`);
    return parseVerifierResponse(await res.json(), listing);
  };
}

export function createDemoPorts(
  merchantOrigins: readonly string[],
  remote?: DemoRemote,
): Pick<AgentDeps, "zerog" | "probe" | "payer" | "logs"> & {
  callVerifier: VerifierNetwork["call"];
} {
  return {
    zerog: demoZeroG(),
    // Built-in verifiers run locally; third-party ones are called over HTTP when possible.
    callVerifier: async (listing, subject) =>
      !listing.builtIn && remote
        ? remoteVerifier(remote)(listing, subject)
        : demoCallVerifier(listing, subject),
    probe: demoProbe(merchantOrigins),
    payer: demoPayer(),
    logs: demoLogs(),
  };
}
