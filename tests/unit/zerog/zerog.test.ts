import { describe, expect, it } from "vitest";
import {
  applyEvidenceFloor,
  createZeroG,
  type Evidence,
  type Extraction,
  hashVerdict,
  maxLevel,
  ZeroGError,
} from "@/adapters/zerog";
import { parseJsonObject } from "@/adapters/zerog/client";

const EXTRACTION: Extraction = {
  payeeName: "Mumbai Power Co",
  payeeAccount: "0.0.5001",
  amountText: "12.50",
  currency: "HBAR",
  link: "https://pay.example.com/inv/1",
  deadlineText: "today",
  pressureTactics: ["pay now or power cut"],
  summary: "Electricity bill.",
};

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeFetch(
  replies: Array<{ status?: number; content?: string | null; raw?: unknown }>,
  captured: Captured[] = [],
): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    const reply = replies[Math.min(i++, replies.length - 1)];
    if (!reply) throw new Error("no reply configured");
    const body =
      reply.raw ??
      (reply.status && reply.status >= 400
        ? { error: { message: "nope", code: "insufficient_balance" } }
        : {
            id: `req_${i}`,
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: reply.content ?? null },
              },
            ],
          });
    return new Response(JSON.stringify(body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const base = {
  baseUrl: "https://router.test/v1",
  apiKey: "sk-test",
  modelText: "glm-5.3",
  modelVision: undefined,
  trustMode: "private" as const,
};

describe("createZeroG", () => {
  it("refuses to build without a key or text model", () => {
    expect(() => createZeroG({ ...base, apiKey: undefined })).toThrow(
      ZeroGError,
    );
    expect(() => createZeroG({ ...base, modelText: undefined })).toThrow(
      /ZG_API_KEY/,
    );
  });

  it("extracts fields, sends the trust-mode header and returns the request id", async () => {
    const seen: Captured[] = [];
    const zg = createZeroG({
      ...base,
      fetch: fakeFetch(
        [{ content: `\`\`\`json\n${JSON.stringify(EXTRACTION)}\n\`\`\`` }],
        seen,
      ),
    });
    const out = await zg.extract({ kind: "text", text: "Pay 12.50 HBAR now" });
    expect(out.value).toEqual(EXTRACTION);
    expect(out.requestId).toBe("req_1");
    expect(out.model).toBe("glm-5.3");
    expect(seen[0]?.url).toBe("https://router.test/v1/chat/completions");
    expect(seen[0]?.headers.get("x-0g-provider-trust-mode")).toBe("private");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer sk-test");
    expect(seen[0]?.body.model).toBe("glm-5.3");
    expect(JSON.stringify(seen[0]?.body.messages)).toContain("<<<REQUEST>>>");
  });

  it("rejects model output that fails the schema", async () => {
    const zg = createZeroG({
      ...base,
      fetch: fakeFetch([
        { content: JSON.stringify({ ...EXTRACTION, payeeAccount: "abc" }) },
      ]),
    });
    await expect(zg.extract({ kind: "text", text: "x" })).rejects.toMatchObject(
      {
        kind: "INVALID_OUTPUT",
      },
    );
  });

  it("maps empty content, 402 and server errors to typed errors", async () => {
    const empty = createZeroG({
      ...base,
      fetch: fakeFetch([{ content: null }]),
    });
    await expect(
      empty.extract({ kind: "text", text: "x" }),
    ).rejects.toMatchObject({
      kind: "EMPTY_RESPONSE",
    });

    const broke = createZeroG({ ...base, fetch: fakeFetch([{ status: 402 }]) });
    await expect(
      broke.extract({ kind: "text", text: "x" }),
    ).rejects.toMatchObject({
      kind: "INSUFFICIENT_BALANCE",
    });

    const down = createZeroG({
      ...base,
      fetch: fakeFetch([{ status: 400, raw: { error: { message: "bad" } } }]),
    });
    await expect(
      down.extract({ kind: "text", text: "x" }),
    ).rejects.toMatchObject({
      kind: "HTTP",
    });
  });

  it("refuses images in private mode (no private vision model on 0G)", async () => {
    const zg = createZeroG({
      ...base,
      modelVision: "qwen3-vl-plus",
      fetch: fakeFetch([]),
    });
    await expect(
      zg.extract({ kind: "image", mimeType: "image/png", base64: "AAAA" }),
    ).rejects.toMatchObject({ kind: "VISION_NOT_PRIVATE" });
  });

  it("sends images only when the operator opts in and a vision model is set", async () => {
    const seen: Captured[] = [];
    const noModel = createZeroG({
      ...base,
      allowNonPrivateVision: true,
      fetch: fakeFetch([]),
    });
    await expect(
      noModel.extract({ kind: "image", mimeType: "image/png", base64: "AAAA" }),
    ).rejects.toMatchObject({ kind: "NOT_CONFIGURED" });

    const zg = createZeroG({
      ...base,
      modelVision: "qwen3-vl-plus",
      allowNonPrivateVision: true,
      fetch: fakeFetch([{ content: JSON.stringify(EXTRACTION) }], seen),
    });
    const out = await zg.extract({
      kind: "image",
      mimeType: "image/png",
      base64: "AAAA",
    });
    expect(out.model).toBe("qwen3-vl-plus");
    expect(JSON.stringify(seen[0]?.body.messages)).toContain(
      "data:image/png;base64,AAAA",
    );
  });

  it("judges, and evidence can raise but never lower the model's level", async () => {
    const evidence: Evidence[] = [
      {
        source: "linkintel",
        level: "high",
        detail: "BRAND_IMPERSONATION on pay.example.com",
      },
    ];
    const zg = createZeroG({
      ...base,
      fetch: fakeFetch([
        { content: '{"level":"low","reasons":["Looks like a normal bill"]}' },
      ]),
    });
    const out = await zg.judge(EXTRACTION, evidence);
    expect(out.value.level).toBe("high");
    expect(out.value.reasons[0]).toContain("linkintel");
    expect(out.value.reasons).toContain("Looks like a normal bill");
  });

  it("keeps a higher model verdict even when evidence is low", async () => {
    const zg = createZeroG({
      ...base,
      fetch: fakeFetch([
        { content: '{"level":"high","reasons":["asks for OTP"]}' },
      ]),
    });
    const out = await zg.judge(EXTRACTION, [
      { source: "s", level: "low", detail: "ok" },
    ]);
    expect(out.value).toEqual({ level: "high", reasons: ["asks for OTP"] });
  });

  it("rejects a verdict with an unknown level or no reasons", async () => {
    for (const content of [
      '{"level":"safe","reasons":["x"]}',
      '{"level":"low","reasons":[]}',
    ]) {
      const zg = createZeroG({ ...base, fetch: fakeFetch([{ content }]) });
      await expect(zg.judge(EXTRACTION, [])).rejects.toMatchObject({
        kind: "INVALID_OUTPUT",
      });
    }
  });
});

describe("parseJsonObject", () => {
  it("finds JSON inside prose and fences", () => {
    expect(parseJsonObject('Sure! {"a":1} done')).toEqual({ a: 1 });
  });
  it("throws INVALID_OUTPUT for missing or broken JSON", () => {
    expect(() => parseJsonObject("no json")).toThrow(/no JSON/);
    expect(() => parseJsonObject("{oops}")).toThrow(/not valid JSON/);
  });
});

describe("verdict helpers", () => {
  it("maxLevel orders low < medium < high", () => {
    expect(maxLevel("low", "medium")).toBe("medium");
    expect(maxLevel("high", "medium")).toBe("high");
    expect(maxLevel("low", "low")).toBe("low");
  });

  it("applyEvidenceFloor de-duplicates reasons and caps the list", () => {
    const model = { level: "medium" as const, reasons: ["a", "a", "b"] };
    const many: Evidence[] = Array.from({ length: 20 }, (_, i) => ({
      source: `s${i}`,
      level: "high" as const,
      detail: "d",
    }));
    const out = applyEvidenceFloor(model, many);
    expect(out.level).toBe("high");
    expect(out.reasons).toHaveLength(12);
    expect(new Set(out.reasons).size).toBe(12);
  });

  it("hashVerdict is stable and sensitive to level and reasons", () => {
    const v = { level: "low" as const, reasons: ["ok"] };
    expect(hashVerdict(v)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashVerdict(v)).toBe(hashVerdict({ ...v }));
    expect(hashVerdict(v)).not.toBe(hashVerdict({ ...v, level: "medium" }));
    expect(hashVerdict(v)).not.toBe(hashVerdict({ ...v, reasons: ["ok."] }));
  });
});
