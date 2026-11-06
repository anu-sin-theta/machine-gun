import { describe, expect, it } from "vitest";
import {
  type AuditEvent,
  createHcsLogs,
  createMirrorNode,
  decodeReputationReport,
  encodeAuditEvent,
  encodeReputationReport,
  HederaError,
  loadPayeeReputation,
  MAX_MESSAGE_BYTES,
  type MirrorNode,
  type ReputationReport,
  reputationEvidence,
  type TopicSubmitter,
} from "@/adapters/hedera";
import { hashCanonical } from "@/rust";

const HASH = "a".repeat(64);
const EVENT: AuditEvent = {
  v: 1,
  type: "check.verdict",
  checkId: "chk_01",
  at: 1_762_430_400_000,
  verdictHash: HASH,
  decision: "step-up",
  zgRequestIds: ["req_1"],
};
const report = (over: Partial<ReputationReport> = {}): ReputationReport => ({
  v: 1,
  payee: "0.0.5001",
  checkId: "chk_01",
  outcome: "paid-ok",
  at: 1,
  ...over,
});

describe("encoding", () => {
  it("encodes audit events as canonical JSON with a recomputable hash", () => {
    const { bytes, hash } = encodeAuditEvent(EVENT);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('{"at":')).toBe(true);
    expect(hash).toBe(hashCanonical(JSON.parse(text)));
    expect(bytes.length).toBeLessThan(MAX_MESSAGE_BYTES);
  });

  it("rejects invalid events and oversized messages with typed errors", () => {
    expect(() => encodeAuditEvent({ ...EVENT, verdictHash: "xyz" })).toThrow(
      HederaError,
    );
    expect(() => encodeAuditEvent({ ...EVENT, type: "nope" as never })).toThrow(
      /Invalid/i,
    );
    const err = (() => {
      try {
        encodeReputationReport(report({ payee: "bad" }));
      } catch (e) {
        return e as HederaError;
      }
    })();
    expect(err?.kind).toBe("INVALID_MESSAGE");
  });

  it("keeps the largest valid event under the HCS limit", () => {
    const largest: AuditEvent = {
      ...EVENT,
      checkId: "c".repeat(64),
      actionHash: HASH,
      txId: "t".repeat(80),
      detail: "d".repeat(120),
      zgRequestIds: Array.from({ length: 4 }, () => "r".repeat(80)),
    };
    expect(encodeAuditEvent(largest).bytes.length).toBeLessThan(
      MAX_MESSAGE_BYTES,
    );
  });

  it("round-trips reputation reports and ignores junk payloads", () => {
    const r = report({ outcome: "flagged" });
    expect(decodeReputationReport(encodeReputationReport(r).bytes)).toEqual(r);
    expect(
      decodeReputationReport(new TextEncoder().encode("not json")),
    ).toBeNull();
    expect(
      decodeReputationReport(new TextEncoder().encode('{"v":2}')),
    ).toBeNull();
  });
});

describe("createHcsLogs", () => {
  function fakeSubmitter(fail = false) {
    const sent: Array<{ topicId: string; text: string }> = [];
    const submitter: TopicSubmitter = {
      async submit(topicId, message) {
        if (fail) throw new Error("INSUFFICIENT_PAYER_BALANCE");
        sent.push({ topicId, text: new TextDecoder().decode(message) });
        return {
          topicId,
          sequenceNumber: sent.length,
          transactionId: "0.0.1@1.2",
        };
      },
    };
    return { submitter, sent };
  }

  it("routes audit events and reputation reports to their own topics", async () => {
    const { submitter, sent } = fakeSubmitter();
    const logs = createHcsLogs({
      submitter,
      auditTopicId: "0.0.100",
      reputationTopicId: "0.0.200",
    });
    const a = await logs.recordAudit(EVENT);
    const r = await logs.reportPayee(report());
    expect(a).toMatchObject({
      topicId: "0.0.100",
      sequenceNumber: 1,
      hash: encodeAuditEvent(EVENT).hash,
    });
    expect(r).toMatchObject({ topicId: "0.0.200", sequenceNumber: 2 });
    expect(sent.map((s) => s.topicId)).toEqual(["0.0.100", "0.0.200"]);
  });

  it("does not submit invalid messages", async () => {
    const { submitter, sent } = fakeSubmitter();
    const logs = createHcsLogs({
      submitter,
      auditTopicId: "0.0.100",
      reputationTopicId: "0.0.200",
    });
    await expect(
      logs.recordAudit({ ...EVENT, checkId: "" }),
    ).rejects.toMatchObject({ kind: "INVALID_MESSAGE" });
    expect(sent).toHaveLength(0);
  });

  it("wraps submit failures as SUBMIT_FAILED", async () => {
    const { submitter } = fakeSubmitter(true);
    const logs = createHcsLogs({
      submitter,
      auditTopicId: "0.0.100",
      reputationTopicId: "0.0.200",
    });
    await expect(logs.recordAudit(EVENT)).rejects.toMatchObject({
      kind: "SUBMIT_FAILED",
      message: "INSUFFICIENT_PAYER_BALANCE",
    });
  });

  it("passes HederaError from the submitter through unchanged", async () => {
    const submitter: TopicSubmitter = {
      async submit() {
        throw new HederaError("NOT_CONFIGURED", "x");
      },
    };
    const logs = createHcsLogs({
      submitter,
      auditTopicId: "0.0.100",
      reputationTopicId: "0.0.200",
    });
    await expect(logs.recordAudit(EVENT)).rejects.toMatchObject({
      kind: "NOT_CONFIGURED",
    });
  });
});

describe("reputationEvidence", () => {
  it("is low with a clear note when there is no history", () => {
    expect(reputationEvidence("0.0.5001", [])).toMatchObject({
      level: "low",
      detail: "no history for this payee",
    });
  });

  it("stays low for clean history and ignores other payees", () => {
    const reports = [
      report({ checkId: "a" }),
      report({ checkId: "b" }),
      report({ checkId: "c", payee: "0.0.9", outcome: "disputed" }),
    ];
    expect(reputationEvidence("0.0.5001", reports)).toMatchObject({
      level: "low",
      detail: "payee history: 2 paid ok, 0 flagged, 0 disputed",
    });
  });

  it("is medium for one flag and high for two flags or any dispute", () => {
    expect(
      reputationEvidence("0.0.5001", [report({ outcome: "flagged" })]).level,
    ).toBe("medium");
    expect(
      reputationEvidence("0.0.5001", [
        report({ checkId: "a", outcome: "flagged" }),
        report({ checkId: "b", outcome: "flagged" }),
      ]).level,
    ).toBe("high");
    expect(
      reputationEvidence("0.0.5001", [report({ outcome: "disputed" })]).level,
    ).toBe("high");
  });

  it("counts one report per check, keeping the most severe", () => {
    const stacked = Array.from({ length: 5 }, () =>
      report({ outcome: "flagged" }),
    );
    expect(reputationEvidence("0.0.5001", stacked).level).toBe("medium");
    const mixed = [
      report({ outcome: "paid-ok" }),
      report({ outcome: "disputed" }),
      report({ outcome: "flagged" }),
    ];
    expect(reputationEvidence("0.0.5001", mixed).detail).toContain(
      "1 disputed",
    );
  });
});

describe("loadPayeeReputation", () => {
  it("reads topic messages, skipping malformed ones", async () => {
    const mirror: MirrorNode = {
      async listTopicMessages(topicId) {
        expect(topicId).toBe("0.0.200");
        return [
          {
            sequenceNumber: 1,
            consensusTimestamp: "1.0",
            payload: encodeReputationReport(report({ outcome: "flagged" }))
              .bytes,
          },
          {
            sequenceNumber: 2,
            consensusTimestamp: "2.0",
            payload: new TextEncoder().encode("spam"),
          },
        ];
      },
      async getHbarBalance() {
        return null;
      },
    };
    const evidence = await loadPayeeReputation(mirror, "0.0.200", "0.0.5001");
    expect(evidence.level).toBe("medium");
  });
});

describe("createMirrorNode", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  function route(
    map: Record<string, unknown | number>,
    seen: string[] = [],
  ): typeof fetch {
    return (async (url: string | URL | Request) => {
      const u = String(url);
      seen.push(u);
      const hit = Object.entries(map).find(([k]) => u.includes(k));
      const body = hit?.[1];
      if (typeof body === "number") return new Response("{}", { status: body });
      if (body === undefined) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
  }
  const base = "https://mirror.test";

  it("lists messages in order and decodes base64 payloads", async () => {
    const seen: string[] = [];
    const mirror = createMirrorNode({
      baseUrl: base,
      fetch: route(
        {
          "/topics/0.0.200/messages": {
            messages: [
              {
                sequence_number: 1,
                consensus_timestamp: "1.1",
                message: b64("one"),
              },
              {
                sequence_number: 2,
                consensus_timestamp: "2.2",
                message: b64("two"),
              },
            ],
            links: { next: null },
          },
        },
        seen,
      ),
    });
    const msgs = await mirror.listTopicMessages("0.0.200", {
      afterSequence: 0,
    });
    expect(msgs.map((m) => new TextDecoder().decode(m.payload))).toEqual([
      "one",
      "two",
    ]);
    expect(msgs[1]?.consensusTimestamp).toBe("2.2");
    expect(seen[0]).toContain("order=asc");
    expect(seen[0]).toContain("sequencenumber=gt%3A0");
  });

  it("follows pagination links on the same origin and respects maxMessages", async () => {
    const seen: string[] = [];
    const mirror = createMirrorNode({
      baseUrl: base,
      fetch: route(
        {
          "page=2": {
            messages: [
              {
                sequence_number: 3,
                consensus_timestamp: "3.3",
                message: b64("c"),
              },
            ],
            links: { next: null },
          },
          "/topics/0.0.200/messages?": {
            messages: [
              {
                sequence_number: 1,
                consensus_timestamp: "1.1",
                message: b64("a"),
              },
              {
                sequence_number: 2,
                consensus_timestamp: "2.2",
                message: b64("b"),
              },
            ],
            links: { next: "/api/v1/topics/0.0.200/messages?page=2" },
          },
        },
        seen,
      ),
    });
    expect(await mirror.listTopicMessages("0.0.200")).toHaveLength(3);
    expect(
      await mirror.listTopicMessages("0.0.200", { maxMessages: 2 }),
    ).toHaveLength(2);
  });

  it("returns an empty list for an unknown topic and errors on bad responses", async () => {
    const missing = createMirrorNode({ baseUrl: base, fetch: route({}) });
    expect(await missing.listTopicMessages("0.0.1")).toEqual([]);

    const broken = createMirrorNode({
      baseUrl: base,
      fetch: route({ "/topics/": 500 }),
    });
    await expect(broken.listTopicMessages("0.0.1")).rejects.toMatchObject({
      kind: "MIRROR_FAILED",
    });

    const weird = createMirrorNode({
      baseUrl: base,
      fetch: route({ "/topics/": { nope: true } }),
    });
    await expect(weird.listTopicMessages("0.0.1")).rejects.toMatchObject({
      kind: "MIRROR_FAILED",
    });

    const offline = createMirrorNode({
      baseUrl: base,
      fetch: (async () => {
        throw new Error("ECONNRESET");
      }) as typeof fetch,
    });
    await expect(offline.listTopicMessages("0.0.1")).rejects.toMatchObject({
      kind: "MIRROR_FAILED",
    });
  });

  it("validates ids before building URLs", async () => {
    const mirror = createMirrorNode({ baseUrl: base, fetch: route({}) });
    await expect(mirror.listTopicMessages("../../etc")).rejects.toMatchObject({
      kind: "INVALID_MESSAGE",
    });
    await expect(mirror.getHbarBalance("nope")).rejects.toMatchObject({
      kind: "INVALID_MESSAGE",
    });
  });

  it("reads an HBAR balance as bigint, or null when the account is unknown", async () => {
    const mirror = createMirrorNode({
      baseUrl: base,
      fetch: route({
        "account.id=0.0.5": { balances: [{ balance: "9007199254740993" }] },
        "account.id=0.0.6": { balances: [] },
      }),
    });
    expect(await mirror.getHbarBalance("0.0.5")).toBe(9007199254740993n);
    expect(await mirror.getHbarBalance("0.0.6")).toBeNull();
    expect(await mirror.getHbarBalance("0.0.7")).toBeNull();
  });

  it("does not follow a next link to another origin", async () => {
    const seen: string[] = [];
    const mirror = createMirrorNode({
      baseUrl: base,
      fetch: route(
        {
          "/topics/0.0.9/messages": {
            messages: [
              {
                sequence_number: 1,
                consensus_timestamp: "1.1",
                message: b64("a"),
              },
            ],
            links: { next: "//evil.test/x" },
          },
        },
        seen,
      ),
    });
    await mirror.listTopicMessages("0.0.9");
    expect(seen.every((u) => u.startsWith(base))).toBe(true);
  });
});
