import { NextResponse } from "next/server";
import { editTask, toPublicTask } from "@/tasks";
import { respond, withAccount } from "../respond";

/** One task with its suggestions, progress events and, once done, the answer. Only its owner sees it. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await withAccount(req);
  if ("denied" in auth) return auth.denied;
  const { id } = await ctx.params;
  const task = await auth.deps.repos.tasks.get(id);
  // Someone else's task looks exactly like a missing one.
  if (!task || task.accountId !== auth.account.id)
    return NextResponse.json({ error: "unknown task" }, { status: 404 });
  return NextResponse.json(
    { task: toPublicTask(task) },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Edits the prompt, skill, agentId or maximum before a worker is paid; Kavach402 suggests again. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await withAccount(req);
  if ("denied" in auth) return auth.denied;
  const { id } = await ctx.params;
  return respond(
    auth.deps,
    await editTask(
      auth.deps,
      auth.account,
      id,
      await req.json().catch(() => null),
    ),
  );
}
