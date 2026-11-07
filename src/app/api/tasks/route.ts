import { NextResponse } from "next/server";
import { proposeTask, TASK_LIST_LIMIT, toPublicTask } from "@/tasks";
import { respond, withAccount } from "./respond";

/** Vetting and paying the worker run after the response: allow the platform maximum. */
export const maxDuration = 60;

/** The caller's own tasks, newest first. */
export async function GET(req: Request) {
  const auth = await withAccount(req);
  if ("denied" in auth) return auth.denied;
  const tasks = await auth.deps.repos.tasks.listByAccount(
    auth.account.id,
    TASK_LIST_LIMIT,
  );
  return NextResponse.json(
    { tasks: tasks.map(toPublicTask) },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Proposes a task. Answers 201 with Kavach402's suggested workers and nothing
 * paid; the requester then accepts, searches again, edits or withdraws. With
 * `autoAccept: true` the recommended worker is accepted at once and the task
 * runs in the background (202).
 */
export async function POST(req: Request) {
  const auth = await withAccount(req);
  if ("denied" in auth) return auth.denied;
  const result = await proposeTask(
    auth.deps,
    auth.account,
    await req.json().catch(() => null),
  );
  return respond(auth.deps, result, true);
}
