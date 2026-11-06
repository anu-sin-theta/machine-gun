/**
 * The agent marketplace's data model. A listing is one agent that sells
 * something to the buyer agent: a verifier sells evidence, a worker does a
 * task (behind an OpenAI-compatible endpoint), a merchant is paid for a
 * resource. The registry is where those agents
 * are onboarded; the directory (directory.ts) turns it into the set the buyer
 * agent will actually pay.
 *
 * A listing is a claim by whoever registered it. Nothing in the pipeline
 * trusts it beyond what the payment guard and the evidence rules allow: the
 * payee and price are re-checked against the endpoint's own 402 challenge when
 * paying, the evidence name is forced to the listing's, and evidence can only
 * raise risk.
 */

import { z } from "zod";
import { isHederaEntityId } from "@/core";

export const AGENT_ROLES = ["verifier", "worker", "merchant"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_STATUSES = ["active", "suspended"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** What a verifier checks. `link` takes a URL, `payee` takes a Hedera account id. */
export const VERIFIER_INPUTS = ["link", "payee"] as const;
export type VerifierInput = (typeof VERIFIER_INPUTS)[number];

/** A worker's skill tag, e.g. "summarize". Used to find workers for a task. */
export const skillSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,23}$/,
    "lowercase letters, digits and hyphens, 2 to 24 characters",
  );

/** What the buyer agent asks a verifier about. */
export type Subject =
  | { kind: "link"; url: string }
  | { kind: "payee"; account: string };

/**
 * Evidence names the pipeline itself produces. A listing may not use them,
 * or a verifier could pass its opinion off as the agent's own check.
 */
export const RESERVED_EVIDENCE_SOURCES = ["payee-check", "verifier-directory"];

export const agentListingSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]{2,39}$/,
        "lowercase letters, digits and hyphens, 3 to 40 characters",
      ),
    role: z.enum(AGENT_ROLES),
    name: z.string().min(1).max(60),
    description: z.string().max(280),
    /** Absolute URL without a query. Checked again by `validateEndpoint` before every request. */
    endpoint: z.url().max(300),
    /** Set for verifiers, null for merchants. */
    input: z.enum(VERIFIER_INPUTS).nullable(),
    /** Hedera account that is paid. Re-checked against the endpoint's 402 challenge. */
    payTo: z.string().refine(isHederaEntityId, "must look like 0.0.12345"),
    /** HBAR tinybars per call. The most the agent will pay this listing. */
    priceTinybars: z.bigint().positive(),
    /** The name this verifier's evidence appears under. Unique across the registry. */
    evidenceSource: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]{2,29}$/,
        "lowercase letters, digits and hyphens, 3 to 30 characters",
      )
      .refine((s) => !RESERVED_EVIDENCE_SOURCES.includes(s), "reserved name"),
    /** Workers: the model name sent in `/chat/completions` requests. Null for the others. */
    model: z.string().min(1).max(100).nullable(),
    /** Workers: what they do (1 to 8 tags). Empty for the others. */
    skills: z.array(skillSchema).max(8),
    status: z.enum(AGENT_STATUSES),
    /** True for the verifiers that ship with Kavach402. */
    builtIn: z.boolean(),
    createdAt: z.number().int().nonnegative(),
  })
  .refine((l) => (l.role === "verifier") === (l.input !== null), {
    message: "a verifier needs an input and the others must not have one",
    path: ["input"],
  })
  .refine(
    (l) =>
      l.role === "worker"
        ? l.model !== null && l.skills.length > 0
        : l.model === null && l.skills.length === 0,
    {
      message:
        "a worker needs a model and at least one skill; the others have neither",
      path: ["skills"],
    },
  );

export type AgentListing = z.infer<typeof agentListingSchema>;

export interface AgentFilter {
  role?: AgentRole;
  status?: AgentStatus;
  input?: VerifierInput;
  skill?: string;
}
