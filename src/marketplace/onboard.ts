/**
 * How an agent gets listed. Anyone can ask; nothing a stranger submits is paid
 * or fetched for a buyer until two things have happened:
 *
 *  1. Proof of control: the endpoint, asked without paying, must answer with an
 *     x402 challenge on the right network that pays exactly the listed
 *     account, at no more than the listed price. A registrant who does not run
 *     (or cannot change) the endpoint cannot make it name their account.
 *  2. An operator activates the listing. Until then it is `suspended`, which
 *     the directory never selects.
 *
 * Activation runs the proof again, because the endpoint may have changed since.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentsRepo } from "@/adapters/db";
import { chatCompletionsUrl, readChallenge } from "./challenge";
import { validateEndpoint } from "./endpoint";
import {
  AGENT_ROLES,
  type AgentListing,
  agentListingSchema,
  skillSchema,
  VERIFIER_INPUTS,
} from "./types";

/** Most suspended listings the registry will hold at once, so it cannot be filled by spam. */
export const MAX_PENDING_LISTINGS = 25;

export const registrationSchema = z.object({
  id: z.string(),
  role: z.enum(AGENT_ROLES),
  name: z.string(),
  description: z.string().default(""),
  endpoint: z.string(),
  input: z.enum(VERIFIER_INPUTS).nullable().default(null),
  payTo: z.string(),
  /** Tinybars as a decimal string (JSON numbers lose precision). */
  priceTinybars: z.string().regex(/^[1-9]\d{0,17}$/),
  /** Verifiers only. Workers and merchants get a derived one. */
  evidenceSource: z.string().optional(),
  /** Workers only: the model name to send in chat-completions requests. */
  model: z.string().optional(),
  /** Workers only. */
  skills: z.array(skillSchema).max(8).optional(),
});

export interface OnboardDeps {
  agents: AgentsRepo;
  /** Must be the address-checking fetch (`createSafeFetch`) on a public deployment. */
  fetch: typeof fetch;
  network: "hedera:testnet" | "hedera:mainnet";
  now: () => number;
  allowLocalEndpoints?: boolean;
}

export type OnboardResult =
  | { ok: true; listing: AgentListing }
  | { ok: false; status: 400 | 404 | 409 | 422 | 429; error: string };

const fail = (
  status: 400 | 404 | 409 | 422 | 429,
  error: string,
): OnboardResult => ({ ok: false, status, error });

/** A harmless unpaid request for the listing's paid endpoint: a verifier question, a worker task, or the merchant resource. */
function probeRequest(
  listing: AgentListing,
  endpoint: string,
): { url: string; init: RequestInit } {
  if (listing.role === "worker")
    return {
      url: chatCompletionsUrl(endpoint),
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: listing.model,
          messages: [{ role: "user", content: "ping" }],
        }),
      },
    };
  const url = new URL(endpoint);
  if (listing.input === "link")
    url.searchParams.set("url", "https://example.com/");
  if (listing.input === "payee") url.searchParams.set("payee", "0.0.2");
  return { url: url.toString(), init: {} };
}

/** Checks the endpoint's unpaid 402 names the listed account, network and asset at no more than the listed price. */
export async function proveControl(
  listing: AgentListing,
  deps: Pick<OnboardDeps, "fetch" | "network" | "allowLocalEndpoints">,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const endpoint = validateEndpoint(listing.endpoint, {
    allowLocalHttp: deps.allowLocalEndpoints ?? false,
  });
  if (!endpoint.ok) return { ok: false, reason: endpoint.reason };

  let res: Response;
  try {
    const probe = probeRequest(listing, endpoint.url);
    res = await deps.fetch(probe.url, probe.init);
  } catch (e) {
    return {
      ok: false,
      reason: `endpoint unreachable: ${e instanceof Error ? e.message : "error"}`,
    };
  }
  const named = readChallenge(res, deps.network);
  if (!named.ok) return named;
  if (named.payTo !== listing.payTo)
    return {
      ok: false,
      reason: "the endpoint's 402 pays a different account than the listing",
    };
  if (named.amount > listing.priceTinybars)
    return {
      ok: false,
      reason: "the endpoint asks for more than the listed price",
    };
  return { ok: true };
}

/** Workers and merchants sell no evidence; derive a unique, valid name for them. */
const derivedEvidenceName = (id: string) =>
  `m-${createHash("sha256").update(id).digest("hex").slice(0, 12)}`;

export async function registerAgent(
  deps: OnboardDeps,
  raw: unknown,
): Promise<OnboardResult> {
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid registration");
  const r = parsed.data;

  const candidate = agentListingSchema.safeParse({
    id: r.id,
    role: r.role,
    name: r.name,
    description: r.description,
    endpoint: r.endpoint,
    input: r.role === "verifier" ? r.input : null,
    payTo: r.payTo,
    priceTinybars: BigInt(r.priceTinybars),
    evidenceSource:
      r.role === "verifier"
        ? (r.evidenceSource ?? "")
        : derivedEvidenceName(r.id),
    model: r.role === "worker" ? (r.model ?? null) : null,
    skills: r.role === "worker" ? (r.skills ?? []) : [],
    status: "suspended",
    builtIn: false,
    createdAt: deps.now(),
  });
  if (!candidate.success)
    return fail(400, candidate.error.issues[0]?.message ?? "invalid listing");
  const listing = candidate.data;

  const pending = await deps.agents.list({ status: "suspended" });
  if (pending.length >= MAX_PENDING_LISTINGS)
    return fail(429, "too many listings are waiting for review; try later");

  const proof = await proveControl(listing, deps);
  if (!proof.ok) return fail(422, proof.reason);

  if (!(await deps.agents.create(listing)))
    return fail(409, "that id or evidence name is already taken");
  return { ok: true, listing };
}

/** Operator action. Re-proves control, then makes the listing selectable. */
export async function activateAgent(
  deps: OnboardDeps,
  id: string,
): Promise<OnboardResult> {
  const listing = await deps.agents.get(id);
  if (!listing) return fail(404, "no such agent");
  const proof = await proveControl(listing, deps);
  if (!proof.ok) return fail(422, proof.reason);
  await deps.agents.setStatus(id, "active");
  return { ok: true, listing: { ...listing, status: "active" } };
}

export async function suspendAgent(
  deps: Pick<OnboardDeps, "agents">,
  id: string,
): Promise<OnboardResult> {
  const listing = await deps.agents.get(id);
  if (!listing) return fail(404, "no such agent");
  await deps.agents.setStatus(id, "suspended");
  return { ok: true, listing: { ...listing, status: "suspended" } };
}
