import { randomBytes } from "node:crypto";
import { getRepositories } from "@/adapters/db";
import { HederaError } from "@/adapters/hedera";
import { getAgentDeps } from "@/agent";
import { getConfig } from "@/config/env";
import { getDirectory } from "@/marketplace";
import { isLocalOrigin } from "@/marketplace/endpoint";
import { createSafeFetch } from "@/marketplace/network";
import type { TaskDeps } from "./service";
import { createDemoWorkerPorts, createLiveWorkerPorts } from "./worker";

export * from "./accounts";
export * from "./answer";
export * from "./public";
export * from "./service";
export * from "./types";
export * from "./worker";

/** What the task flow needs for the running process. */
export function getTaskDeps(): TaskDeps {
  const config = getConfig();
  const now = () => Date.now();
  const base = {
    repos: getRepositories(),
    registry: getDirectory(),
    agent: getAgentDeps,
    now,
    random: (bytes: number) => randomBytes(bytes).toString("base64url"),
  };
  if (config.agentMode === "demo")
    return {
      ...base,
      workerPorts: (listing, task, hooks) =>
        createDemoWorkerPorts(listing, task, hooks, now),
    };

  const { hedera } = config;
  const local = isLocalOrigin(config.baseUrl);
  return {
    ...base,
    workerPorts: (listing, task, hooks) => {
      if (!hedera.agentAccountId || !hedera.agentPrivateKey)
        throw new HederaError(
          "NOT_CONFIGURED",
          "HEDERA_AGENT_ACCOUNT_ID and HEDERA_AGENT_PRIVATE_KEY are required",
        );
      return createLiveWorkerPorts(
        {
          network: `hedera:${hedera.network}`,
          accountId: hedera.agentAccountId,
          privateKey: hedera.agentPrivateKey,
          safeFetch: createSafeFetch({ allowLocal: local }),
          allowLocalEndpoints: local,
        },
        listing,
        task,
        hooks,
      );
    },
  };
}
