import { NextResponse } from "next/server";
import {
  completeApproval,
  getApprovalDeps,
  WorldError,
} from "@/adapters/world";
import { getAgentDeps, handleApprovalOutcome } from "@/agent";
import { getConfig } from "@/config/env";

/** Settling an approved payment happens in this request: allow more than the platform default. */
export const maxDuration = 60;

/** World redirects the user's browser here after the step-up. */
export async function GET(req: Request) {
  const { baseUrl } = getConfig();
  let outcome: Awaited<ReturnType<typeof completeApproval>>;
  try {
    outcome = await completeApproval(getApprovalDeps(), new URL(req.url));
  } catch (e) {
    if (e instanceof WorldError)
      return NextResponse.json({ error: e.kind }, { status: 503 });
    throw e;
  }
  if (outcome.kind === "unknown_state" || outcome.kind === "not_pending")
    return NextResponse.json({ error: outcome.kind }, { status: 400 });

  // Approved: spend the approval and pay. Otherwise: record the block.
  let status: string = outcome.kind;
  let reason: string | undefined = outcome.reason;
  try {
    const result = await handleApprovalOutcome(getAgentDeps(), outcome);
    if (result) {
      status = result.status;
      reason = result.reason ?? reason;
    }
  } catch (e) {
    console.error("approval follow-up failed", e);
    status = "error";
  }

  const back = new URL("/", baseUrl);
  back.searchParams.set("check", outcome.checkId);
  back.searchParams.set("approval", outcome.kind);
  back.searchParams.set("status", status);
  if (reason) back.searchParams.set("reason", reason);
  return NextResponse.redirect(back);
}
