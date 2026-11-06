/**
 * What the paid checker endpoints compute. Pure functions, so the routes stay
 * thin and the logic is testable without x402.
 */

import { z } from "zod";
import type { Evidence } from "@/adapters/zerog";
import { isHederaEntityId } from "@/core";
import { analyzeLink, type LinkReport } from "@/rust";

export const linkQuerySchema = z.object({ url: z.string().min(1).max(2000) });
export const payeeQuerySchema = z.object({
  payee: z.string().refine(isHederaEntityId, "must look like 0.0.12345"),
});

/** Turns a link-intel report into evidence with the report's own level as the floor. */
export function linkEvidence(report: LinkReport): Evidence {
  const top = report.signals
    .slice(0, 3)
    .map((s) => `${s.code}${s.stage === "landing" ? " (landing)" : ""}`);
  return {
    source: "link-intel",
    level: report.level,
    detail: top.length
      ? `${top.join(", ")} (score ${report.score})`
      : `no signals (score ${report.score})`,
  };
}

export function checkLink(url: string): {
  evidence: Evidence;
  report: LinkReport;
} {
  const report = analyzeLink({ url });
  return { evidence: linkEvidence(report), report };
}
