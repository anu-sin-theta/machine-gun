/** Fakes for the agent's ports, with call recording, plus a wired-up `AgentDeps`. */

import { createMemoryRepositories } from "@/adapters/db";
import type { AuditEvent, ReputationReport } from "@/adapters/hedera";
import { createWorldOidc } from "@/adapters/world";
import type { Evidence, Extraction, ZeroG } from "@/adapters/zerog";
import type { AgentDeps, AgentError, Challenge, CheckInput } from "@/agent";
import { hbar, parsePolicyConfig, type RiskVerdict } from "@/core";
import { builtInListings } from "@/marketplace/builtins";
import type { AgentListing } from "@/marketplace/types";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  createFakeIssuer,
  ISSUER,
  REDIRECT_URI,
} from "../world/fakeIssuer";

export const PAYEE = "0.0.5001";
export const RESOURCE = "http://localhost:3000/api/x402/merchant/electricity";
export const INPUT: CheckInput = {
  text: "Electricity bill November, pay 1.5 HBAR to 0.0.5001",
  resource: RESOURCE,
};

const ORB = "https://world.org/oidc/acr/orb";
const ORB_FACE = "https://world.org/oidc/acr/orb-face";

export const EXTRACTION: Extraction = {
  payeeName: "Mumbai Power",
  payeeAccount: PAYEE,
  amountText: "1.5",
  currency: "HBAR",
  link: "https://pay.example.com/inv/1",
  deadlineText: null,
  pressureTactics: [],
  summary: "Electricity bill.",
};

export interface Script {
  /** Challenge the probe returns, or an error to throw. */
  challenge?: Challenge | AgentError;
  extraction?: Extraction | Error;
  verdict?: RiskVerdict | Error;
  /** What the "reputation" verifier answers. */
  reputation?: Evidence | Error;
  /** What the "link-intel" verifier answers. */
  link?: Evidence | Error;
  /** Replaces the registry's answer to `list`: other verifiers, none, or a failing directory. */
  listings?: AgentListing[] | Error;
  /** What a specific verifier id answers (checked before the two above). */
  byId?: Record<string, Evidence | Error>;
  pay?: { transactionId?: string } | Error;
  /** Throw from the audit/reputation log. */
  logFails?: boolean;
  noLogs?: boolean;
}

/** The built-in verifiers the pipeline tests run against (two of the three; link has one here). */
export const LISTINGS = builtInListings({
  baseUrl: "http://localhost:3000",
  payTo: PAYEE,
  now: 0,
}).filter((l) => l.evidenceSource !== "domain-heuristics");

export async function makeHarness(script: Script = {}) {
  const calls = {
    extract: 0,
    judge: [] as Array<readonly Evidence[]>,
    link: [] as string[],
    reputation: [] as string[],
    /** Ids of every verifier the pipeline paid, in order. */
    called: [] as string[],
    listed: [] as string[],
    pay: [] as Array<{ resourceUrl: string; challenge: Challenge }>,
    audit: [] as AuditEvent[],
    reports: [] as ReputationReport[],
  };
  const issuer = await createFakeIssuer();
  const clock = { t: Date.now() };
  let n = 0;

  const orThrow = <T>(v: T | Error): Exclude<T, Error> => {
    if (v instanceof Error) throw v;
    return v as Exclude<T, Error>;
  };

  const zerog: ZeroG = {
    async extract() {
      calls.extract += 1;
      return {
        value: orThrow(script.extraction ?? EXTRACTION),
        requestId: "req_extract",
        model: "m",
      };
    },
    async judge(_extraction, evidence) {
      calls.judge.push(evidence);
      return {
        value: orThrow(
          script.verdict ?? { level: "low", reasons: ["looks normal"] },
        ),
        requestId: "req_judge",
        model: "m",
      };
    },
  };

  const repos = createMemoryRepositories();
  const policy = parsePolicyConfig({
    limits: {
      HBAR: {
        autoCap: hbar(2).units,
        hardCap: hbar(50).units,
        dailyAutoBudget: hbar(5).units,
      },
    },
  });

  const deps: AgentDeps = {
    repos,
    zerog,
    verifiers: {
      async list(kind) {
        calls.listed.push(kind);
        const all = orThrow(script.listings ?? LISTINGS);
        return all.filter((l) => l.input === kind);
      },
      async call(verifier, subject) {
        calls.called.push(verifier.id);
        if (subject.kind === "link") calls.link.push(subject.url);
        else calls.reputation.push(subject.account);
        const scripted =
          script.byId?.[verifier.id] ??
          (verifier.evidenceSource === "reputation"
            ? script.reputation
            : verifier.evidenceSource === "link-intel"
              ? script.link
              : undefined);
        return orThrow(
          scripted ?? {
            source: verifier.evidenceSource,
            level: "low" as const,
            detail: "ok",
          },
        );
      },
    },
    probe: {
      async challenge() {
        return orThrow(
          script.challenge ?? { payTo: PAYEE, amount: 150_000_000n },
        );
      },
    },
    payer: {
      async pay(resourceUrl, challenge) {
        calls.pay.push({ resourceUrl, challenge });
        return orThrow(script.pay ?? { transactionId: "0.0.1001@1.1" });
      },
    },
    logs: script.noLogs
      ? null
      : {
          async recordAudit(event) {
            if (script.logFails) throw new Error("hcs down");
            calls.audit.push(event);
            return {
              topicId: "0.0.100",
              sequenceNumber: calls.audit.length,
              transactionId: "t",
              hash: "h",
            };
          },
          async reportPayee(report) {
            if (script.logFails) throw new Error("hcs down");
            calls.reports.push(report);
            return {
              topicId: "0.0.200",
              sequenceNumber: calls.reports.length,
              transactionId: "t",
              hash: "h",
            };
          },
        },
    approval: {
      repos,
      oidc: createWorldOidc({
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI,
        fetch: issuer.fetch,
      }),
      issuer: ISSUER,
      acr: {
        fresh: null,
        human: [ORB, ORB_FACE] as never,
        strong: [ORB_FACE] as never,
      },
      ttlMs: 600_000,
      now: () => clock.t,
      random: (bytes) =>
        `${String(++n).padStart(bytes, "0")}${"x".repeat(bytes)}`,
      getCurrentAction: async (checkId) => {
        const { actionFromCheck } = await import("@/adapters/world");
        const check = await repos.checks.get(checkId);
        return check ? actionFromCheck(check) : null;
      },
    },
    policy,
    now: () => clock.t,
    random: (bytes) =>
      `${String(++n).padStart(bytes, "0")}${"y".repeat(bytes)}`,
  };

  return { deps, calls, clock, issuer, repos };
}
