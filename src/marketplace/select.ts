import type { AgentListing } from "./types";

/** Most verifiers the agent will pay for one kind of question. */
export const MAX_VERIFIERS_PER_SUBJECT = 3;

/** Most the agent will spend on one kind of question, tinybars (0.1 HBAR). */
export const SUBJECT_BUDGET_TINYBARS = 10_000_000n;

/**
 * Picks which verifiers to pay: cheapest first, at most `max`, within the
 * budget, one per evidence name. Deterministic (ties break on id), so the
 * same registry always gives the same choice.
 */
export function selectVerifiers(
  listings: readonly AgentListing[],
  options: { max?: number; budget?: bigint } = {},
): AgentListing[] {
  const max = options.max ?? MAX_VERIFIERS_PER_SUBJECT;
  const budget = options.budget ?? SUBJECT_BUDGET_TINYBARS;
  const ordered = [...listings].sort((a, b) =>
    a.priceTinybars < b.priceTinybars
      ? -1
      : a.priceTinybars > b.priceTinybars
        ? 1
        : a.id.localeCompare(b.id),
  );

  const chosen: AgentListing[] = [];
  const names = new Set<string>();
  let spent = 0n;
  for (const listing of ordered) {
    if (chosen.length >= max) break;
    if (names.has(listing.evidenceSource)) continue;
    if (spent + listing.priceTinybars > budget) continue;
    chosen.push(listing);
    names.add(listing.evidenceSource);
    spent += listing.priceTinybars;
  }
  return chosen;
}
