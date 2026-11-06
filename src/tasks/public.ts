import { formatAmount } from "@/core";
import type { AccountRecord, TaskRecord } from "./types";

/** A task as its owner sees it: plain JSON, money as exact strings. */
export function toPublicTask(task: TaskRecord) {
  return {
    id: task.id,
    status: task.status,
    workerId: task.workerId,
    prompt: task.prompt,
    maxPriceTinybars: task.maxPriceTinybars.toString(),
    maxPrice: formatAmount({
      asset: { kind: "HBAR" },
      units: task.maxPriceTinybars,
    }),
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
