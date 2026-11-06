import { getConfig } from "@/config/env";
import { createMemoryRepositories } from "./memory";
import { createNeonRepositories } from "./neon";
import type { Repositories } from "./types";

export { createMemoryRepositories } from "./memory";
export * from "./types";

// Next can load this module once per route bundle; the memory store must still be one object,
// or a check created by a server action would be invisible to the World callback route.
const g = globalThis as { __kavachRepos?: Repositories };

/** Neon when DATABASE_URL is set, otherwise a process-wide memory store (dev and demo only). */
export function getRepositories(): Repositories {
  if (!g.__kavachRepos) {
    const { databaseUrl } = getConfig();
    g.__kavachRepos = databaseUrl
      ? createNeonRepositories(databaseUrl)
      : createMemoryRepositories();
  }
  return g.__kavachRepos;
}
