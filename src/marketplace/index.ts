import { getRepositories } from "@/adapters/db";
import { getConfig } from "@/config/env";
import { builtInListings, DEMO_PAYEE } from "./builtins";
import { createDirectory, type VerifierDirectory } from "./directory";
import { isLocalOrigin } from "./endpoint";
import { createSafeFetch } from "./network";
import type { OnboardDeps } from "./onboard";

export * from "./builtins";
export * from "./directory";
export * from "./endpoint";
export * from "./evidence";
export * from "./heuristics";
export * from "./network";
export * from "./onboard";
export * from "./public";
export * from "./select";
export * from "./trust";
export * from "./types";

// One directory for the process even if Next loads this module per route bundle.
const g = globalThis as { __kavachDirectory?: VerifierDirectory };

/** The registry-backed directory for the running process. */
export function getDirectory(): VerifierDirectory {
  if (!g.__kavachDirectory) {
    const config = getConfig();
    g.__kavachDirectory = createDirectory(getRepositories().agents, () =>
      builtInListings({
        baseUrl: config.baseUrl,
        payTo: config.hedera.payeeAccountId ?? DEMO_PAYEE,
        now: Date.now(),
      }),
    );
  }
  return g.__kavachDirectory;
}

/** What onboarding needs for the running process. */
export function getOnboardDeps(): OnboardDeps {
  const config = getConfig();
  const local = isLocalOrigin(config.baseUrl);
  return {
    agents: getRepositories().agents,
    fetch: createSafeFetch({ allowLocal: local }),
    network: `hedera:${config.hedera.network}`,
    now: () => Date.now(),
    allowLocalEndpoints: local,
  };
}
