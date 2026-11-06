/**
 * How much a verifier's word counts. Built-in verifiers are run by this
 * deployment, so their evidence is taken as given. Anyone else's `high` is
 * only a claim: on its own it counts as `medium`, and it counts as `high` only
 * when a second, distinct verifier independently says `high` too. So one
 * verifier cannot force the strongest approval for an honest payee, while a
 * real finding that another verifier confirms still goes through.
 *
 * Limits: two verifiers that are run by the same person corroborate each
 * other. Stopping that needs identity per operator and a track record per
 * verifier, neither of which exists yet.
 */

import type { Evidence } from "@/adapters/zerog";

export interface WeighedInput {
  evidence: Evidence;
  /** Run by this deployment (built in). */
  trusted: boolean;
}

export const UNCORROBORATED_NOTE = " (unconfirmed, counted as medium)";

export function weighEvidence(inputs: readonly WeighedInput[]): Evidence[] {
  const highSources = new Set(
    inputs
      .filter((i) => i.evidence.level === "high")
      .map((i) => i.evidence.source),
  );
  return inputs.map(({ evidence, trusted }) => {
    if (trusted || evidence.level !== "high" || highSources.size > 1)
      return evidence;
    return {
      ...evidence,
      level: "medium",
      detail: `${evidence.detail.slice(0, 200 - UNCORROBORATED_NOTE.length)}${UNCORROBORATED_NOTE}`,
    };
  });
}
