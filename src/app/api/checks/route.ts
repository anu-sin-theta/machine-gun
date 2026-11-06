import { NextResponse } from "next/server";
import { getAgentDeps, runCheck } from "@/agent";
import { isAuthorized } from "@/agent/auth";
import { checkInputSchema } from "@/agent/types";
import { getConfig } from "@/config/env";

/** The agent calls 0G, pays checkers and settles on Hedera in one request: allow more than the platform default. */
export const maxDuration = 60;

/** Runs the whole agent loop for one payment request. */
export async function POST(req: Request) {
  if (!isAuthorized(req.headers.get("authorization"), getConfig().apiToken))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const input = checkInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "text and resource (URL) are required" },
      { status: 400 },
    );

  let deps: ReturnType<typeof getAgentDeps>;
  try {
    deps = getAgentDeps();
  } catch {
    return NextResponse.json(
      { error: "agent not configured" },
      { status: 503 },
    );
  }
  return NextResponse.json(await runCheck(deps, input.data));
}
