import { NextResponse } from "next/server";
import { getRepositories } from "@/adapters/db";
import { isAuthorized } from "@/agent/auth";
import { getConfig } from "@/config/env";

/** Public view of a check (no input text), with money as decimal strings. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(req.headers.get("authorization"), getConfig().apiToken))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const check = await getRepositories().checks.get(id);
  if (!check)
    return NextResponse.json({ error: "unknown check" }, { status: 404 });
  const { inputText: _omit, amount, ...rest } = check;
  return NextResponse.json({
    ...rest,
    amount: amount && { asset: amount.asset, units: amount.units.toString() },
  });
}
