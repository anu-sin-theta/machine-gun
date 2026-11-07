import { NextResponse } from "next/server";
import { getRepositories } from "@/adapters/db";
import {
  completeApproval,
  getApprovalDeps,
  WorldError,
} from "@/adapters/world";
import { getAgentDeps, handleApprovalOutcome } from "@/agent";
import { getConfig } from "@/config/env";
import { getTaskDeps, resumeTask } from "@/tasks";

/** Settling an approved payment happens in this request: allow more than the platform default. */
export const maxDuration = 60;

/** World redirects the user's browser here after the step-up. */
export async function GET(req: Request) {
  const { baseUrl, world } = getConfig();
  // The token exchange must name the redirect URI the authorization used. The
  // URL the server sees can differ (another host name, a proxy, a LAN address),
  // so rebuild it from the configured one with the parameters World sent.
  const callbackUrl = new URL(world.redirectUri);
  callbackUrl.search = new URL(req.url).search;
  let outcome: Awaited<ReturnType<typeof completeApproval>>;
  try {
    outcome = await completeApproval(getApprovalDeps(), callbackUrl);
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
    // A check that pays a worker continues as that task; any other as a plain payment.
    const task = await getRepositories().tasks.getByCheckId(outcome.checkId);
    const result = task
      ? await resumeTask(getTaskDeps(), task, outcome)
      : await handleApprovalOutcome(getAgentDeps(), outcome);
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
