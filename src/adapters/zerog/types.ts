/**
 * 0G Private Computer port. The agent loop depends on `ZeroG` only; `client.ts`
 * talks to the 0G router (OpenAI-compatible) and tests use a fake transport.
 *
 * Everything that comes back from a model is validated with zod before it is
 * trusted, and every failure is a `ZeroGError`. Callers must treat any error
 * from `judge` as "verdict missing", which the policy engine fails closed on.
 */

import { z } from "zod";
import type { RiskVerdict } from "@/core";

export const extractionSchema = z.object({
  /** Who is asking to be paid, as written (business name, person, domain). */
  payeeName: z.string().max(200).nullable(),
  /** Hedera account id if one appears, else null. */
  payeeAccount: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .nullable(),
  /** Amount as written, e.g. "12.50"; never used for payment, only shown. */
  amountText: z.string().max(50).nullable(),
  currency: z.string().max(10).nullable(),
  /** First payment link or URL found, if any. */
  link: z.string().max(2000).nullable(),
  deadlineText: z.string().max(100).nullable(),
  /** Urgency or threat phrases quoted from the request. */
  pressureTactics: z.array(z.string().max(200)).max(10),
  /** One or two sentences describing what is being asked. */
  summary: z.string().max(500),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const modelVerdictSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  reasons: z.array(z.string().min(1).max(300)).min(1).max(8),
});

/** One piece of paid or computed evidence handed to the verdict model. */
export interface Evidence {
  source: string;
  /** Deterministic floor: the verdict may not be lower than this. */
  level: "low" | "medium" | "high";
  detail: string;
}

export type PaymentInput =
  | { kind: "text"; text: string }
  | { kind: "image"; mimeType: string; base64: string };

export interface Traced<T> {
  value: T;
  /** 0G request id (the router's completion id), for the audit log. */
  requestId: string;
  model: string;
}

export interface ZeroG {
  extract(input: PaymentInput): Promise<Traced<Extraction>>;
  judge(
    extraction: Extraction,
    evidence: readonly Evidence[],
  ): Promise<Traced<RiskVerdict>>;
}

export type ZeroGErrorKind =
  | "NOT_CONFIGURED"
  | "VISION_NOT_PRIVATE"
  | "INSUFFICIENT_BALANCE"
  | "HTTP"
  | "EMPTY_RESPONSE"
  | "INVALID_OUTPUT";

export class ZeroGError extends Error {
  readonly kind: ZeroGErrorKind;
  constructor(kind: ZeroGErrorKind, message: string) {
    super(message);
    this.name = "ZeroGError";
    this.kind = kind;
  }
}
