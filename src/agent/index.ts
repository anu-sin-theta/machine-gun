import { randomBytes } from "node:crypto";
import { getRepositories } from "@/adapters/db";
import { getHcsLogs, HederaError } from "@/adapters/hedera";
import { getApprovalDeps } from "@/adapters/world";
import { getZeroG } from "@/adapters/zerog";
import { getConfig } from "@/config/env";
import { createDemoPorts } from "./demo";
import type { AgentDeps } from "./types";
import { createX402Agent } from "./x402";

export { DEMO_MERCHANTS, getDemoAudit } from "./demo";
export * from "./pipeline";
export * from "./types";

/** Everything the agent needs for the running process. Throws if a required integration is not configured. */
export function getAgentDeps(): AgentDeps {
  const config = getConfig();
  const { hedera } = config;

  if (config.agentMode === "demo") {
    return {
      repos: getRepositories(),
      ...createDemoPorts(config.merchantOrigins),
      approval: getApprovalDeps(),
      policy: config.policy,
      now: () => Date.now(),
      random: (bytes) => randomBytes(bytes).toString("base64url"),
    };
  }

  if (
    !hedera.agentAccountId ||
    !hedera.agentPrivateKey ||
    !hedera.payeeAccountId
  )
    throw new HederaError(
      "NOT_CONFIGURED",
      "HEDERA_AGENT_ACCOUNT_ID, HEDERA_AGENT_PRIVATE_KEY and HEDERA_PAYEE_ACCOUNT_ID are required",
    );

  const x402 = createX402Agent({
    network: `hedera:${hedera.network}`,
    accountId: hedera.agentAccountId,
    privateKey: hedera.agentPrivateKey,
    baseUrl: config.baseUrl,
    checkerPayTo: hedera.payeeAccountId,
    merchantOrigins: config.merchantOrigins,
  });

  // Audit and reputation logging is optional: without topics the agent still works.
  let logs: AgentDeps["logs"] = null;
  if (hedera.auditTopicId && hedera.reputationTopicId) logs = getHcsLogs();

  return {
    repos: getRepositories(),
    zerog: getZeroG(),
    ...x402,
    logs,
    approval: getApprovalDeps(),
    policy: config.policy,
    now: () => Date.now(),
    random: (bytes) => randomBytes(bytes).toString("base64url"),
  };
}
