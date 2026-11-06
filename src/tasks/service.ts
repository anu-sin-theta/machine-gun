/**
 * The task flow. A buyer agent proposes a task; this picks a worker, then runs
 * paying that worker through the ordinary Kavach402 check: the worker's own
 * 402 sets payee and price, 0G reads the request, verifiers report on the
 * payee, the policy decides, World ID approves when the policy says so, and
 * only then is the worker paid and called. Its answer is cleaned and its
 * links are checked before the buyer sees it.
 *
 * Every step is appended to the task's events, which is what a buyer polls
 * for progress.
 */

import type { Repositories } from "@/adapters/db";
import type { CallbackOutcome } from "@/adapters/world";
import { handleApprovalOutcome, runCheck } from "@/agent/pipeline";
import type { AgentDeps, RunResult } from "@/agent/types";
import { formatAmount } from "@/core";
import { chatCompletionsUrl } from "@/marketplace/challenge";
import type { VerifierDirectory } from "@/marketplace/directory";
import type { AgentListing } from "@/marketplace/types";
import { scanAnswer } from "./answer";
import {
  type AccountRecord,
  OPEN_TASK_STATUSES,
  type TaskEvent,
  type TaskPatch,
  type TaskRecord,
  taskInputSchema,
} from "./types";
import { taskCeiling, type WorkerHooks, type WorkerPorts } from "./worker";

/** Most unfinished tasks one account may have at once. */
export const MAX_OPEN_TASKS = 5;
/** Most tasks a listing call returns. */
export const TASK_LIST_LIMIT = 50;

export interface TaskDeps {
  repos: Repositories;
  /** Where workers are looked up (seeds the built-ins on first use). */
  registry: Pick<VerifierDirectory, "all" | "get">;
  /** The check pipeline's dependencies; the worker ports replace its probe and payer. */
  agent: () => AgentDeps;
  workerPorts: (
    listing: AgentListing,
    task: TaskRecord,
    hooks: WorkerHooks,
  ) => WorkerPorts;
  now: () => number;
  random: (bytes: number) => string;
}

export type ProposeResult =
  | { ok: true; task: TaskRecord }
  | { ok: false; status: 400 | 404 | 422 | 429; error: string };

const fail = (status: 400 | 404 | 422 | 429, error: string): ProposeResult => ({
  ok: false,
  status,
  error,
});

/** Appends an event and applies a patch in one write. */
async function record(
  deps: TaskDeps,
  id: string,
  event: Omit<TaskEvent, "at">,
  patch: TaskPatch = {},
): Promise<TaskRecord | null> {
  const task = await deps.repos.tasks.get(id);
  if (!task) return null;
  const at = deps.now();
  return deps.repos.tasks.update(id, {
    ...patch,
    events: [...task.events, { at, ...event }],
    updatedAt: at,
  });
}

/** The worker for a task: the named one, or the cheapest active one with the skill, within the buyer's maximum. */
async function pickWorker(
  registry: TaskDeps["registry"],
  input: { agentId?: string | undefined; skill?: string | undefined },
  max: bigint,
): Promise<AgentListing | ProposeResult> {
  if (input.agentId) {
    const listing = await registry.get(input.agentId);
    if (listing?.role !== "worker" || listing.status !== "active")
      return fail(404, "no active worker with that id");
    if (listing.priceTinybars > max)
      return fail(422, "that worker charges more than maxPriceTinybars");
    return listing;
  }
  const candidates = (
    await registry.all({
      role: "worker",
      status: "active",
      ...(input.skill && { skill: input.skill }),
    })
  )
    .filter((l) => l.priceTinybars <= max)
    .sort((a, b) =>
      a.priceTinybars < b.priceTinybars
        ? -1
        : a.priceTinybars > b.priceTinybars
          ? 1
          : a.id.localeCompare(b.id),
    );
  return (
    candidates[0] ??
    fail(404, "no active worker with that skill within maxPriceTinybars")
  );
}

export async function proposeTask(
  deps: TaskDeps,
  account: AccountRecord,
  raw: unknown,
): Promise<ProposeResult> {
  const input = taskInputSchema.safeParse(raw);
  if (!input.success)
    return fail(400, input.error.issues[0]?.message ?? "invalid task");
  const max = BigInt(input.data.maxPriceTinybars);

  const recent = await deps.repos.tasks.listByAccount(
    account.id,
    TASK_LIST_LIMIT,
  );
  if (
    recent.filter((t) => OPEN_TASK_STATUSES.includes(t.status)).length >=
    MAX_OPEN_TASKS
  )
    return fail(429, `at most ${MAX_OPEN_TASKS} unfinished tasks at a time`);

  const worker = await pickWorker(deps.registry, input.data, max);
  if ("ok" in worker) return worker;

  const at = deps.now();
  const task: TaskRecord = {
    id: `task_${deps.random(12)}`,
    accountId: account.id,
    workerId: worker.id,
    prompt: input.data.prompt,
    maxPriceTinybars: max,
    status: "queued",
    checkId: null,
    approvalUrl: null,
    output: null,
    warnings: [],
    events: [
      { at, type: "task.created" },
      {
        at,
        type: "worker.matched",
        detail: `${worker.id} at ${formatAmount({ asset: { kind: "HBAR" }, units: worker.priceTinybars })}`,
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  await deps.repos.tasks.create(task);
  return { ok: true, task };
}

/** What the check reads: who is paid, how much at most, and the task itself. */
export function taskCheckText(listing: AgentListing, task: TaskRecord): string {
  const price = formatAmount({
    asset: { kind: "HBAR" },
    units: taskCeiling(listing, task),
  });
  return `Payment for a task. Worker agent "${listing.name}" (${listing.id}) is paid at most ${price} to account ${listing.payTo} to do this task:\n\n${task.prompt}`;
}

function hooksFor(deps: TaskDeps, taskId: string): WorkerHooks {
  return {
    async started() {
      await record(
        deps,
        taskId,
        { type: "worker.called" },
        { status: "running" },
      );
    },
    async answered(text) {
      if (text === null) {
        await record(deps, taskId, { type: "answer.missing" });
        return;
      }
      const warnings = scanAnswer(text);
      await record(
        deps,
        taskId,
        {
          type: "answer.received",
          detail: warnings.length
            ? `${warnings.length} risky link(s) flagged`
            : "no risky links",
        },
        { output: text, warnings },
      );
    },
  };
}

/** Moves the task to where the check ended up. */
async function applyResult(
  deps: TaskDeps,
  taskId: string,
  result: RunResult,
): Promise<TaskRecord | null> {
  switch (result.status) {
    case "paid": {
      const task = await deps.repos.tasks.get(taskId);
      if (task?.output === null)
        return record(
          deps,
          taskId,
          {
            type: "task.failed",
            detail: "paid, but the worker sent no answer",
          },
          { status: "failed" },
        );
      return record(
        deps,
        taskId,
        {
          type: "task.completed",
          ...(result.transactionId && {
            detail: `paid in ${result.transactionId}`,
          }),
        },
        { status: "completed" },
      );
    }
    case "awaiting-approval":
      return record(
        deps,
        taskId,
        {
          type: "approval.requested",
          detail:
            result.decision?.kind === "step-up"
              ? `${result.decision.tier} approval needed`
              : "approval needed",
        },
        {
          status: "awaiting-approval",
          approvalUrl: result.approvalUrl ?? null,
        },
      );
    case "blocked":
      return record(
        deps,
        taskId,
        { type: "task.blocked", detail: result.reason ?? "blocked" },
        { status: "blocked", approvalUrl: null },
      );
    case "failed":
      return record(
        deps,
        taskId,
        { type: "task.failed", detail: result.reason ?? "failed" },
        { status: "failed", approvalUrl: null },
      );
    default:
      return record(deps, taskId, {
        type: "check.update",
        detail: result.reason ?? result.status,
      });
  }
}

async function activeWorker(
  deps: TaskDeps,
  task: TaskRecord,
): Promise<AgentListing | null> {
  const listing = await deps.registry.get(task.workerId);
  return listing?.role === "worker" && listing.status === "active"
    ? listing
    : null;
}

/** Runs a queued task through the check. Safe to call twice: only a queued task runs. */
export async function runTask(
  deps: TaskDeps,
  taskId: string,
): Promise<TaskRecord | null> {
  const task = await deps.repos.tasks.get(taskId);
  if (task?.status !== "queued") return task;
  const listing = await activeWorker(deps, task);
  if (!listing)
    return record(
      deps,
      taskId,
      { type: "task.failed", detail: "WORKER_UNAVAILABLE" },
      { status: "failed" },
    );

  await record(deps, taskId, { type: "check.started" }, { status: "vetting" });
  let result: RunResult;
  try {
    const agent = {
      ...deps.agent(),
      ...deps.workerPorts(listing, task, hooksFor(deps, taskId)),
    };
    result = await runCheck(agent, {
      text: taskCheckText(listing, task),
      resource: chatCompletionsUrl(listing.endpoint),
    });
  } catch {
    return record(
      deps,
      taskId,
      { type: "task.failed", detail: "CHECK_ERROR" },
      { status: "failed" },
    );
  }
  await deps.repos.tasks.update(taskId, { checkId: result.checkId });
  return applyResult(deps, taskId, result);
}

/** Continues a task after the World ID callback for its check. */
export async function resumeTask(
  deps: TaskDeps,
  task: TaskRecord,
  outcome: CallbackOutcome,
): Promise<RunResult | null> {
  const listing = await activeWorker(deps, task);
  if (!listing) {
    // Never pay a worker that was suspended while the human was approving.
    await record(
      deps,
      task.id,
      { type: "task.failed", detail: "WORKER_UNAVAILABLE" },
      { status: "failed", approvalUrl: null },
    );
    return null;
  }
  const agent = {
    ...deps.agent(),
    ...deps.workerPorts(listing, task, hooksFor(deps, task.id)),
  };
  const result = await handleApprovalOutcome(agent, outcome);
  if (result) await applyResult(deps, task.id, result);
  return result;
}
