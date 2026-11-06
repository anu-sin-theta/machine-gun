import type { AgentsRepo } from "@/adapters/db";
import { selectVerifiers } from "./select";
import type { AgentFilter, AgentListing, VerifierInput } from "./types";

export interface VerifierDirectory {
  /** The verifiers the agent will pay for this kind of question: active, cheapest first, within budget. */
  list(input: VerifierInput): Promise<AgentListing[]>;
  /** Everything in the registry that matches, for the API and the page. */
  all(filter?: AgentFilter): Promise<AgentListing[]>;
  /** One listing by id. */
  get(id: string): Promise<AgentListing | null>;
}

/**
 * The directory over a registry. The first call seeds the built-in listings
 * (idempotent: an id or evidence name that already exists is left alone, so a
 * suspension or edit made later is never undone by a restart).
 */
export function createDirectory(
  agents: AgentsRepo,
  builtIns: () => AgentListing[],
): VerifierDirectory {
  let seeded: Promise<void> | undefined;
  const ensureSeeded = () => {
    seeded ??= (async () => {
      for (const listing of builtIns()) await agents.create(listing);
    })().catch((error: unknown) => {
      seeded = undefined; // try again on the next call
      throw error;
    });
    return seeded;
  };

  return {
    async list(input) {
      await ensureSeeded();
      return selectVerifiers(
        await agents.list({ role: "verifier", status: "active", input }),
      );
    },
    async all(filter) {
      await ensureSeeded();
      return agents.list(filter);
    },
    async get(id) {
      await ensureSeeded();
      return agents.get(id);
    },
  };
}
