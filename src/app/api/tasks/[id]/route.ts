import { NextResponse } from "next/server";
import { getRepositories } from "@/adapters/db";
import { authenticate, toPublicTask } from "@/tasks";

/** One task with its progress events and, once done, the answer. Only its owner sees it. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const repos = getRepositories();
  const account = await authenticate(
    repos.accounts,
    req.headers.get("authorization"),
  );
  if (!account)
    return NextResponse.json(
      { error: "send Authorization: Bearer <account token>" },
      { status: 401 },
    );
  const { id } = await ctx.params;
  const task = await repos.tasks.get(id);
  // Someone else's task looks exactly like a missing one.
  if (!task || task.accountId !== account.id)
    return NextResponse.json({ error: "unknown task" }, { status: 404 });
  return NextResponse.json(
    { task: toPublicTask(task) },
    { headers: { "cache-control": "no-store" } },
  );
}
