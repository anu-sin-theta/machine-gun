import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/adapters/db";
import {
  actionFromCheck,
  getApprovalDeps,
  startApproval,
  WorldError,
} from "@/adapters/world";

const bodySchema = z.object({ checkId: z.string().min(1).max(64) });

/** Begins a World ID step-up for a check whose policy decision is `step-up`. */
export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "checkId is required" }, { status: 400 });

  const check = await getRepositories().checks.get(body.data.checkId);
  if (!check)
    return NextResponse.json({ error: "unknown check" }, { status: 404 });
  if (check.decision?.kind !== "step-up")
    return NextResponse.json(
      { error: "check does not need approval" },
      { status: 409 },
    );
  const action = actionFromCheck(check);
  if (!action)
    return NextResponse.json({ error: "check is incomplete" }, { status: 409 });

  try {
    const started = await startApproval(getApprovalDeps(), {
      action,
      tier: check.decision.tier,
    });
    return NextResponse.json(started);
  } catch (e) {
    if (e instanceof WorldError)
      return NextResponse.json({ error: e.kind }, { status: 503 });
    throw e;
  }
}
