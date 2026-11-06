/**
 * Pure verdict helpers: the model's opinion can raise risk but never lower it
 * below what deterministic evidence already established.
 */

import {
  hashCanonical,
  RISK_LEVELS,
  type RiskLevel,
  type RiskVerdict,
} from "@/core";
import type { Evidence } from "./types";

const rank = (level: RiskLevel) => RISK_LEVELS.indexOf(level);

export function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return rank(a) >= rank(b) ? a : b;
}

/**
 * Merge the model verdict with evidence floors. Reasons from evidence that
 * forced the level up are prepended so the user sees why.
 */
export function applyEvidenceFloor(
  model: RiskVerdict,
  evidence: readonly Evidence[],
): RiskVerdict {
  let level = model.level;
  const forced: string[] = [];
  for (const e of evidence) {
    if (rank(e.level) > rank(level)) {
      level = e.level;
      forced.push(`${e.source}: ${e.detail}`);
    } else if (
      e.level === "high" ||
      (e.level === "medium" && level !== "low")
    ) {
      forced.push(`${e.source}: ${e.detail}`);
    }
  }
  const reasons = [...forced, ...model.reasons];
  return { level, reasons: [...new Set(reasons)].slice(0, 12) };
}

/** sha256 hex of the canonical verdict: the value bound into the approval. */
export function hashVerdict(verdict: RiskVerdict): string {
  return hashCanonical({ level: verdict.level, reasons: [...verdict.reasons] });
}
