import { describe, expect, it } from "vitest";
import {
  createHcsLogs,
  createMirrorNode,
  decodeReputationReport,
  encodeAuditEvent,
  loadPayeeReputation,
} from "@/adapters/hedera";
import { createSdkSubmitter } from "@/adapters/hedera/hcs";
import { loadConfig } from "@/config/env";
import { eventually } from "./helpers";

const { hedera } = loadConfig(process.env);
const ready = Boolean(
  hedera.agentAccountId &&
    hedera.agentPrivateKey &&
    hedera.auditTopicId &&
    hedera.reputationTopicId,
);

function setup() {
  const mirror = createMirrorNode({ baseUrl: hedera.mirrorNodeUrl });
  const logs = createHcsLogs({
    submitter: createSdkSubmitter({
      network: hedera.network,
      accountId: hedera.agentAccountId as string,
      privateKey: hedera.agentPrivateKey as string,
    }),
    auditTopicId: hedera.auditTopicId as string,
    reputationTopicId: hedera.reputationTopicId as string,
  });
  return { mirror, logs };
}

describe.skipIf(!ready)(
  "Hedera HCS (live): needs HEDERA_AGENT_* and both HCS topic ids (pnpm setup:hedera)",
  () => {
    it("has an agent account with HBAR to pay fees", async () => {
      const { mirror } = setup();
      const balance = await mirror.getHbarBalance(
        hedera.agentAccountId as string,
      );
      expect(balance).not.toBeNull();
      expect(balance ?? 0n).toBeGreaterThan(100_000_000n);
    });

    it("writes an audit event that the mirror node returns byte for byte", async () => {
      const { mirror, logs } = setup();
      const event = {
        v: 1 as const,
        type: "check.received" as const,
        checkId: `live_${Date.now()}`,
        at: Date.now(),
      };
      const published = await logs.recordAudit(event);
      expect(published.hash).toBe(encodeAuditEvent(event).hash);

      const message = await eventually(
        async () =>
          (
            await mirror.listTopicMessages(hedera.auditTopicId as string, {
              afterSequence: published.sequenceNumber - 1,
              maxMessages: 5,
            })
          ).find((m) => m.sequenceNumber === published.sequenceNumber),
        { what: "the audit message on the mirror node" },
      );
      expect(JSON.parse(new TextDecoder().decode(message.payload))).toEqual(
        event,
      );
    });

    it("writes a reputation report that payee reputation then reads back", async () => {
      const { mirror, logs } = setup();
      const payee = hedera.payeeAccountId ?? "0.0.5001";
      const published = await logs.reportPayee({
        v: 1,
        payee,
        checkId: `live_${Date.now()}`,
        outcome: "paid-ok",
        at: Date.now(),
      });
      const message = await eventually(
        async () =>
          (
            await mirror.listTopicMessages(hedera.reputationTopicId as string, {
              afterSequence: published.sequenceNumber - 1,
              maxMessages: 5,
            })
          ).find((m) => m.sequenceNumber === published.sequenceNumber),
        { what: "the reputation message on the mirror node" },
      );
      expect(decodeReputationReport(message.payload)).toMatchObject({
        payee,
        outcome: "paid-ok",
      });

      const evidence = await loadPayeeReputation(
        mirror,
        hedera.reputationTopicId as string,
        payee,
      );
      expect(evidence.level).toBe("low");
      expect(evidence.detail).toMatch(/paid ok/);
    });
  },
);
