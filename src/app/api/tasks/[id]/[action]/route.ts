import { NextResponse } from "next/server";
import { acceptTask, researchTask, withdrawTask } from "@/tasks";
import { respond, withAccount } from "../../respond";

/** Accepting starts the check, payment and worker call in the background. */
export const maxDuration = 60;

/**
 * The requester's decisions on a task:
 * - `accept` `{workerId?}`: go with a suggested worker (the recommended one by default)
 * - `research` `{exclude?}`: fresh suggestions, ruling workers out
 * - `withdraw`: call it off
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; action: string }> },
) {
  const auth = await withAccount(req);
  if ("denied" in auth) return auth.denied;
  const { id, action } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  switch (action) {
    case "accept":
      return respond(
        auth.deps,
        await acceptTask(auth.deps, auth.account, id, body),
      );
    case "research":
      return respond(
        auth.deps,
        await researchTask(auth.deps, auth.account, id, body),
      );
    case "withdraw":
      return respond(
        auth.deps,
        await withdrawTask(auth.deps, auth.account, id),
      );
    default:
      return NextResponse.json(
        { error: "action must be accept, research or withdraw" },
        { status: 404 },
      );
  }
}
