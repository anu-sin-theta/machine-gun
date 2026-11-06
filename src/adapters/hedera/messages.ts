/**
 * Encoding and the audit / reputation logs on top of a `TopicSubmitter`.
 * Everything here is deterministic given the submitter, so it is tested with a
 * fake and never needs a network.
 */

import { canonicalJson, hashCanonical } from "@/rust";
import {
  type AuditEvent,
  auditEventSchema,
  HederaError,
  type ReputationReport,
  reputationReportSchema,
  type SubmitResult,
  type TopicSubmitter,
} from "./types";

/** HCS accepts up to 1024 bytes per message. */
export const MAX_MESSAGE_BYTES = 1024;

const encoder = new TextEncoder();

export interface Encoded {
  bytes: Uint8Array;
  /** sha256 hex of the canonical JSON, so anyone can recompute it. */
  hash: string;
}

function encode(value: unknown): Encoded {
  const bytes = encoder.encode(canonicalJson(value));
  if (bytes.length > MAX_MESSAGE_BYTES)
    throw new HederaError(
      "MESSAGE_TOO_LARGE",
      `message is ${bytes.length} bytes, limit is ${MAX_MESSAGE_BYTES}`,
    );
  return { bytes, hash: hashCanonical(value) };
}

export function encodeAuditEvent(event: AuditEvent): Encoded {
  const parsed = auditEventSchema.safeParse(event);
  if (!parsed.success)
    throw new HederaError(
      "INVALID_MESSAGE",
      parsed.error.issues[0]?.message ?? "invalid",
    );
  return encode(parsed.data);
}

export function encodeReputationReport(report: ReputationReport): Encoded {
  const parsed = reputationReportSchema.safeParse(report);
  if (!parsed.success)
    throw new HederaError(
      "INVALID_MESSAGE",
      parsed.error.issues[0]?.message ?? "invalid",
    );
  return encode(parsed.data);
}

/** Decode a topic message; returns null for anything that is not a valid report. */
export function decodeReputationReport(
  payload: Uint8Array,
): ReputationReport | null {
  try {
    const json = JSON.parse(new TextDecoder().decode(payload));
    const parsed = reputationReportSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface Published extends SubmitResult {
  /** Hash of the message as published. */
  hash: string;
}

export interface HcsLogs {
  recordAudit(event: AuditEvent): Promise<Published>;
  reportPayee(report: ReputationReport): Promise<Published>;
}

export function createHcsLogs(options: {
  submitter: TopicSubmitter;
  auditTopicId: string;
  reputationTopicId: string;
}): HcsLogs {
  const { submitter, auditTopicId, reputationTopicId } = options;

  async function publish(
    topicId: string,
    encoded: Encoded,
  ): Promise<Published> {
    try {
      const result = await submitter.submit(topicId, encoded.bytes);
      return { ...result, hash: encoded.hash };
    } catch (e) {
      if (e instanceof HederaError) throw e;
      throw new HederaError(
        "SUBMIT_FAILED",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return {
    recordAudit: async (event) =>
      publish(auditTopicId, encodeAuditEvent(event)),
    reportPayee: async (report) =>
      publish(reputationTopicId, encodeReputationReport(report)),
  };
}
