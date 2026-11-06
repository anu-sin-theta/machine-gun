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
import {
  type AgentDeps,
  AgentError,
  type Challenge,
  type Checkers,
  type MerchantPayer,
  type ResourceProbe,
} from "./types";

export const DEMO_PAYEE = "0.0.5001";

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

const demoCheckers = (): Checkers => ({
  // Real analysis: the same Rust engine the paid checker endpoint runs.
  async link(url) {
    return checkLink(url).evidence;
  },
  async reputation(payee) {
    return reputationEvidence(payee, state().reports);
  },
});

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
export function createDemoPorts(
  merchantOrigins: readonly string[],
): Pick<AgentDeps, "zerog" | "checkers" | "probe" | "payer" | "logs"> {
  return {
    zerog: demoZeroG(),
    checkers: demoCheckers(),
    probe: demoProbe(merchantOrigins),
    payer: demoPayer(),
    logs: demoLogs(),
  };
}
