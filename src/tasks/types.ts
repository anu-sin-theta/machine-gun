/**
 * The task marketplace's data model. A buyer agent (an account with its own
 * token) proposes a task; Kavach402 picks a worker from the registry, vets
 * paying it exactly as it vets any payment (0G reading, verifier evidence,
 * policy, World ID when needed), pays it over x402, and keeps the answer.
 */

import { z } from "zod";
import { skillSchema } from "@/marketplace/types";

export type AccountStatus = "active" | "revoked";

export interface AccountRecord {
  id: string;
  name: string;
  /** SHA-256 of the token, hex. The token itself is shown once and never stored. */
  tokenHash: string;
  status: AccountStatus;
  createdAt: number;
}

export const TASK_STATUSES = [
  "queued",
  "vetting",
  "awaiting-approval",
  "running",
  "completed",
  "blocked",
  "failed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Not finished yet: counts toward an account's open-task limit. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  "queued",
  "vetting",
  "awaiting-approval",
  "running",
];

export interface TaskEvent {
  at: number;
  type: string;
  detail?: string;
}

/** A link in a worker's answer that the link engine did not like. */
export interface OutputWarning {
  url: string;
  level: "medium" | "high";
  signals: string[];
}

export interface TaskRecord {
  id: string;
  accountId: string;
  workerId: string;
  prompt: string;
  /** The most the buyer will pay, tinybars. */
  maxPriceTinybars: bigint;
  status: TaskStatus;
  /** The Kavach402 check that vetted the payment. */
  checkId: string | null;
  approvalUrl: string | null;
  output: string | null;
  warnings: OutputWarning[];
  events: TaskEvent[];
  createdAt: number;
  updatedAt: number;
}

export type TaskPatch = Partial<
  Pick<
    TaskRecord,
    | "status"
    | "checkId"
    | "approvalUrl"
    | "output"
    | "warnings"
    | "events"
    | "updatedAt"
  >
>;

export const taskInputSchema = z
  .object({
    /** What the worker should do. */
    prompt: z.string().min(1).max(3000),
    /** A specific worker, or… */
    agentId: z.string().max(40).optional(),
    /** …the cheapest active worker with this skill. */
    skill: skillSchema.optional(),
    /** Tinybars, decimal string. */
    maxPriceTinybars: z.string().regex(/^[1-9]\d{0,17}$/),
  })
  .refine((t) => Boolean(t.agentId) !== Boolean(t.skill), {
    message: "give exactly one of agentId or skill",
  });
export type TaskInput = z.infer<typeof taskInputSchema>;
