/**
 * The task flow. The requester stays in charge: Kavach402 suggests workers and
 * nothing is paid until the requester accepts one. Before that it can search
 * again (ruling workers out), edit the task, or withdraw it; a task nobody
 * matches waits until the requester searches again.
 *
 * Once accepted, paying the worker is an ordinary Kavach402 check: the
 * worker's own 402 sets payee and price, 0G reads the request, verifiers
 * report on the payee, the policy decides, World ID approves when the policy
 * says so, and only then is the worker paid and called. Its answer is cleaned
 * and its links are checked before the requester sees it. While a human
 * approval is pending the requester can still withdraw, edit or search again;
 * the pending approval is then cancelled so it can never pay.
 *
 * Every step is appended to the task's events, which is what a requester
 * polls for progress.
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
  acceptSchema,
  researchSchema,
  type TaskCandidate,
  type TaskEvent,
  type TaskPatch,
  type TaskRecord,
  type TaskStatus,
  taskEditSchema,
  taskInputSchema,
  UNFINISHED_TASK_STATUSES,
} from "./types";
import { taskCeiling, type WorkerHooks, type WorkerPorts } from "./worker";

/** Most unfinished tasks one account may have at once. */
export const MAX_OPEN_TASKS = 5;
/** Most tasks a listing call returns. */
export const TASK_LIST_LIMIT = 50;
/** Most workers suggested for one task. */
export const MAX_CANDIDATES = 5;

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

export type TaskResult =
  | {
      ok: true;
      task: TaskRecord /** The task is queued: run it. */;
      run: boolean;
    }
  | { ok: false; status: 400 | 404 | 409 | 422 | 429; error: string };

const fail = (
  status: 400 | 404 | 409 | 422 | 429,
  error: string,
): TaskResult => ({ ok: false, status, error });

const hbar = (units: bigint) =>
  formatAmount({ asset: { kind: "HBAR" }, units });

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

/** Active workers that fit the request, cheapest first; the first is the recommendation. */
async function findCandidates(
  registry: TaskDeps["registry"],
  want: {
    skill: string | null;
    requestedAgentId: string | null;
    max: bigint;
    excluded: readonly string[];
  },
): Promise<TaskCandidate[]> {
  let listings: AgentListing[];
  if (want.requestedAgentId) {
    const one = await registry.get(want.requestedAgentId);
    listings = one ? [one] : [];
  } else {
    listings = await registry.all({
      role: "worker",
      status: "active",
      ...(want.skill && { skill: want.skill }),
    });
  }
  return listings
    .filter(
      (l) =>
        l.role === "worker" &&
        l.status === "active" &&
        l.priceTinybars <= want.max &&
        !want.excluded.includes(l.id),
    )
    .sort((a, b) =>
      a.priceTinybars < b.priceTinybars
        ? -1
        : a.priceTinybars > b.priceTinybars
          ? 1
          : a.id.localeCompare(b.id),
    )
    .slice(0, MAX_CANDIDATES)
    .map((l, i) => ({
      workerId: l.id,
      name: l.name,
      model: l.model,
      skills: l.skills,
      priceTinybars: l.priceTinybars.toString(),
      builtIn: l.builtIn,
      recommended: i === 0,
    }));
}

function suggestedEvent(candidates: TaskCandidate[]): Omit<TaskEvent, "at"> {
  const pick = candidates[0];
  return {
    type: "workers.suggested",
    detail: pick
      ? `${candidates.length} worker(s); recommended ${pick.workerId} at ${hbar(BigInt(pick.priceTinybars))}`
      : "no worker matches yet; search again later, edit or withdraw",
  };
}

/** Back to choosing: forget the accepted worker and anything from its run. */
const CHOOSING: TaskPatch = {
  status: "awaiting-choice",
  workerId: null,
  checkId: null,
  approvalUrl: null,
  output: null,
  warnings: [],
};

/**
 * A pending World ID approval must never pay once the requester has moved on:
 * close its check so the callback refuses it.
 */
async function cancelPendingApproval(deps: TaskDeps, task: TaskRecord) {
  if (task.status !== "awaiting-approval" || !task.checkId) return false;
  const check = await deps.repos.checks.get(task.checkId);
  if (check?.status === "awaiting-approval")
    await deps.repos.checks.update(task.checkId, { status: "blocked" });
  return true;
}

/** The caller's own task, in one of the allowed states. */
async function ownTask(
  deps: TaskDeps,
  account: AccountRecord,
  id: string,
  allowed: readonly TaskStatus[],
  action: string,
): Promise<TaskRecord | TaskResult> {
  const task = await deps.repos.tasks.get(id);
  if (!task || task.accountId !== account.id) return fail(404, "unknown task");
  if (!allowed.includes(task.status))
    return fail(409, `cannot ${action} a task that is ${task.status}`);
  return task;
}

const isResult = (v: TaskRecord | TaskResult): v is TaskResult => "ok" in v;

export async function proposeTask(
  deps: TaskDeps,
  account: AccountRecord,
  raw: unknown,
): Promise<TaskResult> {
  const input = taskInputSchema.safeParse(raw);
  if (!input.success)
    return fail(400, input.error.issues[0]?.message ?? "invalid task");
  const max = BigInt(input.data.maxPriceTinybars);

  const recent = await deps.repos.tasks.listByAccount(
    account.id,
    TASK_LIST_LIMIT,
  );
  if (
    recent.filter((t) => UNFINISHED_TASK_STATUSES.includes(t.status)).length >=
    MAX_OPEN_TASKS
  )
    return fail(429, `at most ${MAX_OPEN_TASKS} unfinished tasks at a time`);

  const skill = input.data.skill ?? null;
  const requestedAgentId = input.data.agentId ?? null;
  const candidates = await findCandidates(deps.registry, {
    skill,
    requestedAgentId,
    max,
    excluded: [],
  });

  const at = deps.now();
  const task: TaskRecord = {
    id: `task_${deps.random(12)}`,
    accountId: account.id,
    prompt: input.data.prompt,
    skill,
    requestedAgentId,
    maxPriceTinybars: max,
    status: "awaiting-choice",
    candidates,
    excluded: [],
    workerId: null,
    checkId: null,
    approvalUrl: null,
    output: null,
    warnings: [],
    events: [
      { at, type: "task.created" },
      { at, ...suggestedEvent(candidates) },
    ],
    createdAt: at,
    updatedAt: at,
  };
  await deps.repos.tasks.create(task);

  if (input.data.autoAccept && candidates.length > 0)
    return acceptTask(deps, account, task.id, {});
  return { ok: true, task, run: false };
}

/** The requester picks a suggested worker (the recommended one by default). Queues the task. */
export async function acceptTask(
  deps: TaskDeps,
  account: AccountRecord,
  id: string,
  raw: unknown,
): Promise<TaskResult> {
  const input = acceptSchema.safeParse(raw ?? {});
  if (!input.success) return fail(400, "workerId must be a worker id");
  const task = await ownTask(deps, account, id, ["awaiting-choice"], "accept");
  if (isResult(task)) return task;

  const choice = input.data.workerId
    ? task.candidates.find((c) => c.workerId === input.data.workerId)
    : task.candidates.find((c) => c.recommended);
  if (!choice)
    return fail(
      422,
      task.candidates.length
        ? "that worker is not one of the suggestions; search again first"
        : "no worker to accept; search again later, edit or withdraw",
    );
  // The suggestion may be stale: the worker must still be active and within the maximum.
  const listing = await deps.registry.get(choice.workerId);
  if (
    listing?.role !== "worker" ||
    listing.status !== "active" ||
    listing.priceTinybars > task.maxPriceTinybars
  )
    return fail(409, "that worker is no longer available; search again");

  const updated = await record(
    deps,
    id,
    {
      type: "worker.accepted",
      detail: `${listing.id} at ${hbar(listing.priceTinybars)}`,
    },
    { status: "queued", workerId: listing.id },
  );
  return updated
    ? { ok: true, task: updated, run: true }
    : fail(404, "unknown task");
}

/** Fresh suggestions, ruling out the given workers (and, after a failed or blocked run, the worker that was tried). */
export async function researchTask(
  deps: TaskDeps,
  account: AccountRecord,
  id: string,
  raw: unknown,
): Promise<TaskResult> {
  const input = researchSchema.safeParse(raw ?? {});
  if (!input.success) return fail(400, "exclude must be a list of worker ids");
  const task = await ownTask(
    deps,
    account,
    id,
    ["awaiting-choice", "awaiting-approval", "blocked", "failed"],
    "search again for",
  );
  if (isResult(task)) return task;

  const tried =
    task.status !== "awaiting-choice" && task.workerId ? [task.workerId] : [];
  const excluded = [
    ...new Set([...task.excluded, ...(input.data.exclude ?? []), ...tried]),
  ];
  const cancelled = await cancelPendingApproval(deps, task);
  const candidates = await findCandidates(deps.registry, {
    skill: task.skill,
    requestedAgentId: task.requestedAgentId,
    max: task.maxPriceTinybars,
    excluded,
  });
  if (cancelled)
    await record(deps, id, {
      type: "approval.cancelled",
      detail: "searched again",
    });
  const updated = await record(deps, id, suggestedEvent(candidates), {
    ...CHOOSING,
    candidates,
    excluded,
  });
  return updated
    ? { ok: true, task: updated, run: false }
    : fail(404, "unknown task");
}

/** Changes the prompt, target or maximum before a worker is paid, then suggests again. */
export async function editTask(
  deps: TaskDeps,
  account: AccountRecord,
  id: string,
  raw: unknown,
): Promise<TaskResult> {
  const input = taskEditSchema.safeParse(raw);
  if (!input.success)
    return fail(400, input.error.issues[0]?.message ?? "invalid edit");
  const task = await ownTask(
    deps,
    account,
    id,
    ["awaiting-choice", "awaiting-approval", "blocked", "failed"],
    "edit",
  );
  if (isResult(task)) return task;

  const edit = input.data;
  const skill = edit.skill ?? (edit.agentId ? null : task.skill);
  const requestedAgentId =
    edit.agentId ?? (edit.skill ? null : task.requestedAgentId);
  const max =
    edit.maxPriceTinybars !== undefined
      ? BigInt(edit.maxPriceTinybars)
      : task.maxPriceTinybars;
  const cancelled = await cancelPendingApproval(deps, task);
  const candidates = await findCandidates(deps.registry, {
    skill,
    requestedAgentId,
    max,
    excluded: task.excluded,
  });

  const changed = Object.entries(edit)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
  if (cancelled)
    await record(deps, id, {
      type: "approval.cancelled",
      detail: "task edited",
    });
  await record(deps, id, { type: "task.edited", detail: changed.join(", ") });
  const updated = await record(deps, id, suggestedEvent(candidates), {
    ...CHOOSING,
    prompt: edit.prompt ?? task.prompt,
    skill,
    requestedAgentId,
    maxPriceTinybars: max,
    candidates,
  });
  return updated
    ? { ok: true, task: updated, run: false }
    : fail(404, "unknown task");
}

/** Calls the task off. Nothing is paid after this; a pending approval is cancelled. */
export async function withdrawTask(
  deps: TaskDeps,
  account: AccountRecord,
  id: string,
): Promise<TaskResult> {
  const task = await ownTask(
    deps,
    account,
    id,
    ["awaiting-choice", "queued", "awaiting-approval", "blocked", "failed"],
    "withdraw",
  );
  if (isResult(task)) return task;
  if (await cancelPendingApproval(deps, task))
    await record(deps, id, { type: "approval.cancelled", detail: "withdrawn" });
  const updated = await record(
    deps,
    id,
    { type: "task.withdrawn" },
    { status: "withdrawn", approvalUrl: null },
  );
  return updated
    ? { ok: true, task: updated, run: false }
    : fail(404, "unknown task");
}

/** What the check reads: who is paid, how much at most, and the task itself. */
export function taskCheckText(listing: AgentListing, task: TaskRecord): string {
  return `Payment for a task. Worker agent "${listing.name}" (${listing.id}) is paid at most ${hbar(taskCeiling(listing, task))} to account ${listing.payTo} to do this task:\n\n${task.prompt}`;
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
  if (!task.workerId) return null;
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
  // The requester may have withdrawn, edited or searched again since.
  if (task.status !== "awaiting-approval") return null;
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
