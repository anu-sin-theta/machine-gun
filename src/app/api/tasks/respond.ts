import { after, NextResponse } from "next/server";
import {
  type AccountRecord,
  authenticate,
  getTaskDeps,
  runTask,
  type TaskDeps,
  type TaskResult,
  toPublicTask,
} from "@/tasks";

/** The deps and the calling account, or the 401 to send. */
export async function withAccount(
  req: Request,
): Promise<
  { deps: TaskDeps; account: AccountRecord } | { denied: NextResponse }
> {
  const deps = getTaskDeps();
  const account = await authenticate(
    deps.repos.accounts,
    req.headers.get("authorization"),
  );
  if (!account)
    return {
      denied: NextResponse.json(
        { error: "send Authorization: Bearer <account token>" },
        { status: 401 },
      ),
    };
  return { deps, account };
}

/**
 * Turns a task result into a response. A queued task starts running after the
 * response (202); anything else answers at once.
 */
export function respond(
  deps: TaskDeps,
  result: TaskResult,
  created = false,
): NextResponse {
  if (!result.ok)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  const id = result.task.id;
  if (result.run)
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
      status: result.run ? 202 : created ? 201 : 200,
      headers: {
        "cache-control": "no-store",
        ...(created && { location: `/api/tasks/${id}` }),
      },
    },
  );
}
