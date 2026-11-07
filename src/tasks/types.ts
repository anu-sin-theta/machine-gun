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
  /** Kavach402 has suggested workers; the requester decides what to do. */
  "awaiting-choice",
  "queued",
  "vetting",
  "awaiting-approval",
  "running",
  "completed",
  "blocked",
  "failed",
  /** The requester called it off. */
  "withdrawn",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Not finished yet: counts toward an account's unfinished-task limit. */
export const UNFINISHED_TASK_STATUSES: readonly TaskStatus[] = [
  "awaiting-choice",
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

/** A worker Kavach402 suggests for a task, as the registry described it when suggested. */
export interface TaskCandidate {
  workerId: string;
  name: string;
  model: string | null;
  skills: string[];
  /** Tinybars, decimal string. */
  priceTinybars: string;
  /** Run by this deployment. */
  builtIn: boolean;
  /** Kavach402's pick: the cheapest suitable worker. */
  recommended: boolean;
}

export interface TaskRecord {
  id: string;
  accountId: string;
  prompt: string;
  /** What the requester asked for: a skill, or one named worker. */
  skill: string | null;
  requestedAgentId: string | null;
  /** The most the buyer will pay, tinybars. */
  maxPriceTinybars: bigint;
  status: TaskStatus;
  /** The current suggestions. */
  candidates: TaskCandidate[];
  /** Workers the requester ruled out; never suggested again for this task. */
  excluded: string[];
  /** The worker the requester accepted; null while choosing. */
  workerId: string | null;
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
  Omit<TaskRecord, "id" | "accountId" | "createdAt">
>;

const price = z.string().regex(/^[1-9]\d{0,17}$/);

export const taskInputSchema = z
  .object({
    /** What the worker should do. */
    prompt: z.string().min(1).max(3000),
    /** A specific worker, or… */
    agentId: z.string().max(40).optional(),
    /** …workers with this skill. */
    skill: skillSchema.optional(),
    /** Tinybars, decimal string. */
    maxPriceTinybars: price,
    /** Skip the choice: accept Kavach402's recommended worker at once (for unattended agents). */
    autoAccept: z.boolean().optional(),
  })
  .refine((t) => Boolean(t.agentId) !== Boolean(t.skill), {
    message: "give exactly one of agentId or skill",
  });
export type TaskInput = z.infer<typeof taskInputSchema>;

/** Changing a task before a worker is paid. A new skill or agentId replaces the old target. */
export const taskEditSchema = z
  .object({
    prompt: z.string().min(1).max(3000).optional(),
    agentId: z.string().max(40).optional(),
    skill: skillSchema.optional(),
    maxPriceTinybars: price.optional(),
  })
  .refine((t) => !(t.agentId && t.skill), {
    message: "give at most one of agentId or skill",
  })
  .refine((t) => Object.values(t).some((v) => v !== undefined), {
    message: "nothing to change",
  });

export const acceptSchema = z.object({
  /** One of the current candidates; defaults to the recommended one. */
  workerId: z.string().max(40).optional(),
});

export const researchSchema = z.object({
  /** Workers to rule out from now on. */
  exclude: z.array(z.string().max(40)).max(20).optional(),
});
