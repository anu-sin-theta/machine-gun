import { NextResponse } from "next/server";
import { getRepositories } from "@/adapters/db";
import { getMirrorNode } from "@/adapters/hedera";
import { isAuthorized } from "@/agent/auth";
import { getConfig } from "@/config/env";
import { checkReadiness, summarize } from "@/ops/readiness";

/**
 * Readiness checklist for a deployment: modes, accounts, balances, reachability.
 * Reveals which integrations are configured, so it needs the bearer token when
 * one is set and does not exist in production without one.
 */
export async function GET(req: Request) {
  const config = getConfig();
  const locked = Boolean(config.apiToken);
  if (!locked && process.env.NODE_ENV === "production")
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!isAuthorized(req.headers.get("authorization"), config.apiToken))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const items = await checkReadiness(config, {
    mirror: getMirrorNode(),
    repos: getRepositories(),
  });
  const summary = summarize(items);
  return NextResponse.json(
    { ...summary, items },
    { status: summary.ready ? 200 : 503 },
  );
}
