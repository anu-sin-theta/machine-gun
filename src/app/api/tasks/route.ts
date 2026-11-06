import { after, NextResponse } from "next/server";
import { getRepositories } from "@/adapters/db";
import {
  authenticate,
  getTaskDeps,
  proposeTask,
  runTask,
  TASK_LIST_LIMIT,
  toPublicTask,
} from "@/tasks";

/** Vetting and paying the worker run after the response: allow the platform maximum. */
export const maxDuration = 60;

const unauthorized = () =>
  NextResponse.json(
    { error: "send Authorization: Bearer <account token>" },
    { status: 401 },
  );

/** The caller's own tasks, newest first. */
export async function GET(req: Request) {
  const repos = getRepositories();
  const account = await authenticate(
    repos.accounts,
    req.headers.get("authorization"),
  );
  if (!account) return unauthorized();
  const tasks = await repos.tasks.listByAccount(account.id, TASK_LIST_LIMIT);
  return NextResponse.json(
    { tasks: tasks.map(toPublicTask) },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Proposes a task. Answers 202 at once with the queued task; the check, the
 * payment and the worker call continue in the background. Poll
 * `GET /api/tasks/<id>` for progress.
 */
export async function POST(req: Request) {
  const deps = getTaskDeps();
  const account = await authenticate(
    deps.repos.accounts,
    req.headers.get("authorization"),
  );
  if (!account) return unauthorized();

  const result = await proposeTask(
    deps,
    account,
    await req.json().catch(() => null),
  );
  if (!result.ok)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );

  const id = result.task.id;
  after(async () => {
    try {
      await runTask(deps, id);
    } catch (e) {
      console.error("task run failed", id, e);
    }
  });
  return NextResponse.json(
    { task: toPublicTask(result.task) },
    {
      status: 202,
      headers: { "cache-control": "no-store", location: `/api/tasks/${id}` },
    },
  );
}
