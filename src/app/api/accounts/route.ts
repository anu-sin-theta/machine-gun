import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getRepositories } from "@/adapters/db";
import { isAuthorized } from "@/agent/auth";
import { getConfig } from "@/config/env";
import { createAccount, toPublicAccount } from "@/tasks";

/**
 * Creates a buyer account and returns its token, once. In demo mode anyone
 * may sign up (nothing is paid). In live mode tasks are paid from this
 * deployment's wallet, so only the operator (`API_TOKEN`) can issue accounts.
 */
export async function POST(req: Request) {
  const config = getConfig();
  if (config.agentMode !== "demo") {
    if (!config.apiToken)
      return NextResponse.json(
        { error: "set API_TOKEN to issue accounts in live mode" },
        { status: 403 },
      );
    if (!isAuthorized(req.headers.get("authorization"), config.apiToken))
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await createAccount(
    getRepositories().accounts,
    await req.json().catch(() => null),
    {
      now: () => Date.now(),
      random: (bytes) => randomBytes(bytes).toString("base64url"),
    },
  );
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(
    {
      account: toPublicAccount(result.account),
      token: result.token,
      note: "Store the token now; it is not shown again.",
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
