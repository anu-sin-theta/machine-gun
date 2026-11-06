/**
 * What comes back from a verifier is written by whoever runs it. Before it
 * reaches the judge prompt it is validated, relabelled and cleaned:
 *  - the evidence name is always the listing's, never what the response says,
 *    so a verifier cannot speak as another verifier or as the agent itself;
 *  - the level must be one of ours;
 *  - the detail loses control characters and newlines and is cut short, which
 *    limits (but does not eliminate) text aimed at the model. The judge prompt
 *    also treats evidence as data, and evidence can only raise risk.
 */

import { z } from "zod";
import type { Evidence } from "@/adapters/zerog";
import type { AgentListing } from "./types";

export const MAX_DETAIL = 200;

const responseSchema = z.object({
  evidence: z.object({
    level: z.enum(["low", "medium", "high"]),
    detail: z.string().max(2000),
    // Accepted and ignored: the listing decides the name.
    source: z.string().optional(),
  }),
});

// C0 and C1 control characters, DEL, and the Unicode line and paragraph separators.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

export function cleanDetail(detail: string): string {
  const cleaned = detail
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DETAIL)
    .trim();
  return cleaned || "no detail";
}

/** Parses a verifier's JSON reply into evidence under the listing's name. Throws if it is malformed. */
export function parseVerifierResponse(
  json: unknown,
  listing: Pick<AgentListing, "evidenceSource">,
): Evidence {
  const { evidence } = responseSchema.parse(json);
  return {
    source: listing.evidenceSource,
    level: evidence.level,
    detail: cleanDetail(evidence.detail),
  };
}
