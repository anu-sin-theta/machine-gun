import { formatAmount } from "@/core";
import type { AccountRecord, TaskRecord, TaskStatus } from "./types";

const hbar = (units: bigint) =>
  formatAmount({ asset: { kind: "HBAR" }, units });

export type TaskAction = "accept" | "research" | "edit" | "withdraw";

/** What the requester may do next, so an agent need not hard-code the state machine. */
export function allowedActions(status: TaskStatus): TaskAction[] {
  switch (status) {
    case "awaiting-choice":
      return ["accept", "research", "edit", "withdraw"];
    case "awaiting-approval":
    case "blocked":
    case "failed":
      return ["research", "edit", "withdraw"];
    case "queued":
      return ["withdraw"];
    default:
      return [];
  }
}

/** A task as its owner sees it: plain JSON, money as exact strings. */
export function toPublicTask(task: TaskRecord) {
  return {
    id: task.id,
    status: task.status,
    actions: allowedActions(task.status),
    prompt: task.prompt,
    skill: task.skill,
    requestedAgentId: task.requestedAgentId,
    maxPriceTinybars: task.maxPriceTinybars.toString(),
    maxPrice: hbar(task.maxPriceTinybars),
    candidates: task.candidates.map((c) => ({
      ...c,
      price: hbar(BigInt(c.priceTinybars)),
    })),
    excluded: task.excluded,
    workerId: task.workerId,
    checkId: task.checkId,
    /** Open it to approve with World ID; present only while approval is pending. */
    approvalUrl: task.status === "awaiting-approval" ? task.approvalUrl : null,
    output: task.output,
    warnings: task.warnings,
    events: task.events,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** An account without its token hash. */
export const toPublicAccount = (account: AccountRecord) => ({
  id: account.id,
  name: account.name,
  status: account.status,
  createdAt: account.createdAt,
});
