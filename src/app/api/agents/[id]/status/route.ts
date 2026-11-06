import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/agent/auth";
import { getConfig } from "@/config/env";
import {
  activateAgent,
  getOnboardDeps,
  suspendAgent,
  toPublic,
} from "@/marketplace";

const bodySchema = z.object({ status: z.enum(["active", "suspended"]) });

/**
 * Operator action: activate a listing (after proving control again) or
 * suspend it. Requires `API_TOKEN`; with none configured nobody can do this,
 * unlike the read routes, which stay open in a demo.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { apiToken } = getConfig();
  if (!apiToken)
    return NextResponse.json(
      { error: "set API_TOKEN to manage listings" },
      { status: 403 },
    );
  if (!isAuthorized(req.headers.get("authorization"), apiToken))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return NextResponse.json(
      { error: "status must be active or suspended" },
      { status: 400 },
    );

  const { id } = await ctx.params;
  const deps = getOnboardDeps();
  const result =
    body.data.status === "active"
      ? await activateAgent(deps, id)
      : await suspendAgent(deps, id);
  if (!result.ok)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  return NextResponse.json({ agent: toPublic(result.listing) });
}
