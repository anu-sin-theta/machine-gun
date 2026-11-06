import { type AgentListing, agentListingSchema } from "./types";

/** The demo payee account (also the demo merchants' account). */
export const DEMO_PAYEE = "0.0.5001";

/**
 * What each built-in verifier charges per call, in tinybars. The paid routes
 * (src/app/api/x402/checkers/*) and the listings below both read these, so a
 * listed price can never drift from what the endpoint actually asks for.
 */
export const BUILT_IN_PRICES = {
  reputation: 5_000_000n, // 0.05 HBAR
  linkIntel: 5_000_000n, // 0.05 HBAR
  domainHeuristics: 2_000_000n, // 0.02 HBAR
  scribe: 10_000_000n, // 0.1 HBAR per task
} as const;

/** The verifiers and the demo worker that ship with Kavach402, operated by the same deployment. */
export function builtInListings(options: {
  /** The app's own URL; the checker routes live under it. */
  baseUrl: string;
  /** The account that receives their payments. */
  payTo: string;
  now: number;
}): AgentListing[] {
  const origin = new URL(options.baseUrl).origin;
  const base = {
    role: "verifier" as const,
    model: null,
    skills: [] as string[],
    payTo: options.payTo,
    status: "active" as const,
    builtIn: true,
    createdAt: options.now,
  };
  return [
    {
      ...base,
      id: "kavach-reputation",
      name: "Payee reputation",
      description:
        "What the public Hedera reputation topic says about the payee account: paid, flagged and disputed reports.",
      endpoint: `${origin}/api/x402/checkers/reputation`,
      input: "payee" as const,
      priceTinybars: BUILT_IN_PRICES.reputation,
      evidenceSource: "reputation",
    },
    {
      ...base,
      id: "kavach-link-intel",
      name: "Link intelligence",
      description:
        "Rust engine: lookalike brands, homoglyphs, punycode, redirects and domain-age signals on a payment link.",
      endpoint: `${origin}/api/x402/checkers/link`,
      input: "link" as const,
      priceTinybars: BUILT_IN_PRICES.linkIntel,
      evidenceSource: "link-intel",
    },
    {
      ...base,
      id: "kavach-domain-heuristics",
      name: "Domain heuristics",
      description:
        "A lightweight, independent second opinion on a link: risky TLDs, shorteners, IP hosts, punycode. Different code from link intelligence, so they can disagree.",
      endpoint: `${origin}/api/x402/checkers/domain-heuristics`,
      input: "link" as const,
      priceTinybars: BUILT_IN_PRICES.domainHeuristics,
      evidenceSource: "domain-heuristics",
    },
    {
      ...base,
      role: "worker" as const,
      id: "kavach-scribe",
      name: "Scribe (demo worker)",
      description:
        "Summarises text and lists the links in it. Deterministic rules, not a language model: it is here so the task flow can be shown end to end.",
      endpoint: `${origin}/api/x402/workers/scribe/v1`,
      input: null,
      model: "kavach-scribe-1",
      skills: ["summarize", "extract-links"],
      priceTinybars: BUILT_IN_PRICES.scribe,
      evidenceSource: "scribe",
    },
  ].map((l) => agentListingSchema.parse(l));
}
