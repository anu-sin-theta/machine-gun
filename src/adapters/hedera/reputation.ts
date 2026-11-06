/**
 * Payee reputation from the public reputation topic. The topic is open to
 * anyone who can pay for a message, so reports are weak evidence: they can
 * raise concern, never lower it (the evidence floor only ever goes up), and
 * duplicates per check are ignored so one reporter cannot stack a score.
 */

import type { Evidence } from "@/adapters/zerog";
import { decodeReputationReport } from "./messages";
import type { MirrorNode, ReputationReport } from "./types";

export function reputationEvidence(
  payee: string,
  reports: readonly ReputationReport[],
): Evidence {
  const byCheck = new Map<string, ReputationReport>();
  for (const r of reports) {
    if (r.payee !== payee) continue;
    const prev = byCheck.get(r.checkId);
    // Keep the most severe report per check.
    if (!prev || severity(r) > severity(prev)) byCheck.set(r.checkId, r);
  }
  const counts = { "paid-ok": 0, flagged: 0, disputed: 0 };
  for (const r of byCheck.values()) counts[r.outcome] += 1;

  const summary = `${counts["paid-ok"]} paid ok, ${counts.flagged} flagged, ${counts.disputed} disputed`;
  if (counts.disputed > 0 || counts.flagged >= 2)
    return {
      source: "reputation",
      level: "high",
      detail: `payee history: ${summary}`,
    };
  if (counts.flagged === 1)
    return {
      source: "reputation",
      level: "medium",
      detail: `payee history: ${summary}`,
    };
  if (byCheck.size === 0)
    return {
      source: "reputation",
      level: "low",
      detail: "no history for this payee",
    };
  return {
    source: "reputation",
    level: "low",
    detail: `payee history: ${summary}`,
  };
}

function severity(r: ReputationReport): number {
  return r.outcome === "disputed" ? 2 : r.outcome === "flagged" ? 1 : 0;
}

/** Reads the reputation topic and builds evidence for one payee. */
export async function loadPayeeReputation(
  mirror: MirrorNode,
  reputationTopicId: string,
  payee: string,
  maxMessages = 500,
): Promise<Evidence> {
  const messages = await mirror.listTopicMessages(reputationTopicId, {
    maxMessages,
  });
  const reports: ReputationReport[] = [];
  for (const m of messages) {
    const report = decodeReputationReport(m.payload);
    if (report) reports.push(report);
  }
  return reputationEvidence(payee, reports);
}
