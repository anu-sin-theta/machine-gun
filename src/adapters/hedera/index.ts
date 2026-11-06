import { getConfig } from "@/config/env";
import { createSdkSubmitter } from "./hcs";
import { createHcsLogs, type HcsLogs } from "./messages";
import { createMirrorNode } from "./mirror";
import { HederaError, type MirrorNode } from "./types";

export * from "./messages";
export {
  createMirrorNode,
  fetchMirrorTransaction,
  type MirrorTransaction,
  toMirrorTransactionId,
} from "./mirror";
export { loadPayeeReputation, reputationEvidence } from "./reputation";
export * from "./types";

let mirror: MirrorNode | undefined;
let logs: HcsLogs | undefined;

export function getMirrorNode(): MirrorNode {
  mirror ??= createMirrorNode({ baseUrl: getConfig().hedera.mirrorNodeUrl });
  return mirror;
}

/** Audit + reputation logs for the running process. Throws NOT_CONFIGURED without keys and topics. */
export function getHcsLogs(): HcsLogs {
  if (!logs) {
    const { hedera } = getConfig();
    const { agentAccountId, agentPrivateKey, auditTopicId, reputationTopicId } =
      hedera;
    if (
      !agentAccountId ||
      !agentPrivateKey ||
      !auditTopicId ||
      !reputationTopicId
    )
      throw new HederaError(
        "NOT_CONFIGURED",
        "HEDERA_AGENT_* and both HEDERA_HCS_*_TOPIC_ID are required (run pnpm setup:hedera)",
      );
    logs = createHcsLogs({
      submitter: createSdkSubmitter({
        network: hedera.network,
        accountId: agentAccountId,
        privateKey: agentPrivateKey,
      }),
      auditTopicId,
      reputationTopicId,
    });
  }
  return logs;
}
