import { NextResponse } from "next/server";
import { z } from "zod";
import { getDirectory, getOnboardDeps, registerAgent } from "@/marketplace";
import { toPublic } from "@/marketplace/public";
import {
  AGENT_ROLES,
  AGENT_STATUSES,
  skillSchema,
  VERIFIER_INPUTS,
} from "@/marketplace/types";

const querySchema = z.object({
  role: z.enum(AGENT_ROLES).optional(),
  status: z.enum(AGENT_STATUSES).optional(),
  input: z.enum(VERIFIER_INPUTS).optional(),
  skill: skillSchema.optional(),
});

/**
 * The agent registry, public: who the buyer agent can pay for evidence and
 * what they charge, and the workers willing to take tasks. Active agents
 * unless `status` says otherwise. Filters: `role`, `status`, `input`, `skill`.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const query = querySchema.safeParse({
    role: params.get("role") ?? undefined,
    status: params.get("status") ?? undefined,
    input: params.get("input") ?? undefined,
    skill: params.get("skill") ?? undefined,
  });
  if (!query.success)
    return NextResponse.json(
      { error: "role, status, input and skill must be valid values" },
      { status: 400 },
    );

  const agents = await getDirectory().all({
    ...query.data,
    status: query.data.status ?? "active",
  });
  return NextResponse.json(
    { agents: agents.map(toPublic) },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Asks to be listed. Public, because that is what onboarding is, but nothing
 * happens to a buyer until an operator activates the listing: it is created
 * `suspended`, and only if the endpoint proves it pays the listed account.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const result = await registerAgent(getOnboardDeps(), body);
  if (!result.ok)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  return NextResponse.json(
    { agent: toPublic(result.listing) },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
