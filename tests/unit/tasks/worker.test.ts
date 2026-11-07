import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { SchemeNetworkClient } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import { DEMO_PAYMENT } from "@/marketplace/challenge";
import type { AgentListing } from "@/marketplace/types";
import {
  createDemoWorkerPorts,
  createLiveWorkerPorts,
  type TaskRecord,
  taskCeiling,
  type WorkerHooks,
} from "@/tasks";

const NETWORK = "hedera:testnet" as const;
const WORKER: AgentListing = {
  id: "acme-writer",
  role: "worker",
  name: "Acme writer",
  description: "Writes.",
  endpoint: "https://writer.acme.example/v1",
  input: null,
  payTo: "0.0.7001",
  priceTinybars: 3_000_000n,
  evidenceSource: "m-0123456789ab",
  model: "acme-large",
  skills: ["summarize"],
  status: "active",
  builtIn: false,
  createdAt: 0,
};
const TASK = {
  id: "task_1",
  prompt: "Summarise this.",
  maxPriceTinybars: 5_000_000n,
} as TaskRecord;

const scheme: SchemeNetworkClient = {
  scheme: "exact",
  async createPaymentPayload(x402Version) {
    return { x402Version, payload: { transaction: "dGVzdA==" } };
  },
};

interface Server {
  payTo?: string;
  amount?: string;
  /** What a paid request gets back. */
  paid?: () => Response;
}

/** A worker behind x402: 402 until paid, then a chat completion. */
function worker(s: Server = {}) {
  const seen: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push(request.clone());
    if (new URL(request.url).pathname !== "/v1/chat/completions")
      return new Response("{}", { status: 404 });
    if (request.headers.get("PAYMENT-SIGNATURE"))
      return (
        s.paid?.() ??
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Done." } }],
          }),
          {
            status: 200,
            headers: {
              "PAYMENT-RESPONSE": encodePaymentResponseHeader({
                success: true,
                transaction: "0.0.1001@5.5",
                network: NETWORK,
                payer: "0.0.1001",
              }),
            },
          },
        )
      );
    return new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
          x402Version: 2,
          resource: { url: request.url },
          accepts: [
            {
              scheme: "exact",
              network: NETWORK,
              asset: "0.0.0",
              amount: s.amount ?? "3000000",
              payTo: s.payTo ?? WORKER.payTo,
              maxTimeoutSeconds: 300,
              extra: {},
            },
          ],
        }),
      },
    });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

function ports(
  s: Server = {},
  listing: AgentListing = WORKER,
  task: TaskRecord = TASK,
) {
  const w = worker(s);
  const log: Array<string | null> = [];
  const hooks: WorkerHooks = {
    async started() {
      log.push("started");
    },
    async answered(text) {
      log.push(text);
    },
  };
  return {
    ...createLiveWorkerPorts(
      {
        network: NETWORK,
        accountId: "0.0.1001",
        privateKey: "unused",
        safeFetch: w.fetchImpl,
        scheme,
      },
      listing,
      task,
      hooks,
    ),
    seen: w.seen,
    log,
  };
}

describe("createLiveWorkerPorts", () => {
  it("reads the worker's challenge from an unpaid chat-completions POST", async () => {
    const p = ports();
    expect(await p.probe.challenge("ignored")).toEqual({
      payTo: WORKER.payTo,
      amount: 3_000_000n,
    });
    const req = p.seen[0] as Request;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://writer.acme.example/v1/chat/completions");
    expect(await req.json()).toEqual({
      model: "acme-large",
      messages: [{ role: "user", content: "Summarise this." }],
    });
  });

  it.each([
    ["pays another account", { payTo: "0.0.9999" }, /another account/],
    ["asks more than the listing", { amount: "3000001" }, /more than allowed/],
  ])("refuses a worker that %s", async (_n, s, reason) => {
    await expect(ports(s).probe.challenge("x")).rejects.toMatchObject({
      kind: "RESOURCE_NOT_PAYABLE",
      message: expect.stringMatching(reason),
    });
  });

  it("never goes above the buyer's maximum, even when the listing allows more", async () => {
    const cheapTask = { ...TASK, maxPriceTinybars: 2_000_000n };
    expect(taskCeiling(WORKER, cheapTask)).toBe(2_000_000n);
    await expect(
      ports({}, WORKER, cheapTask).probe.challenge("x"),
    ).rejects.toMatchObject({ message: "worker asks for more than allowed" });
  });

  it("refuses an endpoint that breaks the endpoint rules, without fetching", async () => {
    const p = ports({}, { ...WORKER, endpoint: "https://10.0.0.1/v1" });
    await expect(p.probe.challenge("x")).rejects.toMatchObject({
      message: "worker endpoint refused",
    });
    await expect(
      p.payer.pay("x", { payTo: WORKER.payTo, amount: 1n }),
    ).rejects.toMatchObject({ kind: "PAYMENT_FAILED" });
    expect(p.seen).toHaveLength(0);
  });

  it("reports an unreachable worker as not payable", async () => {
    const p = createLiveWorkerPorts(
      {
        network: NETWORK,
        accountId: "0.0.1001",
        privateKey: "unused",
        safeFetch: (async () => {
          throw new Error("no route");
        }) as typeof fetch,
        scheme,
      },
      WORKER,
      TASK,
      { started: async () => {}, answered: async () => {} },
    );
    await expect(p.probe.challenge("x")).rejects.toMatchObject({
      message: "worker unreachable",
    });
  });

  it("pays exactly the challenge, sends the task, and hands over the answer", async () => {
    const p = ports();
    const result = await p.payer.pay("ignored", {
      payTo: WORKER.payTo,
      amount: 3_000_000n,
    });
    expect(result).toEqual({ transactionId: "0.0.1001@5.5" });
    expect(p.log).toEqual(["started", "Done."]);
    const paid = p.seen.find((r) => r.headers.get("PAYMENT-SIGNATURE"));
    expect(await paid?.json()).toMatchObject({ model: "acme-large" });
  });

  it("refuses to sign when the worker's challenge changed to another account after vetting", async () => {
    const p = ports({ payTo: "0.0.9999" });
    await expect(
      p.payer.pay("x", { payTo: WORKER.payTo, amount: 3_000_000n }),
    ).rejects.toMatchObject({ kind: "PAYMENT_FAILED" });
    expect(p.seen.some((r) => r.headers.get("PAYMENT-SIGNATURE"))).toBe(false);
  });

  it("fails on an error status and passes on a missing answer as null", async () => {
    const failing = ports({ paid: () => new Response("{}", { status: 500 }) });
    await expect(
      failing.payer.pay("x", { payTo: WORKER.payTo, amount: 3_000_000n }),
    ).rejects.toMatchObject({ message: "worker returned 500" });

    const empty = ports({ paid: () => new Response("not json") });
    expect(
      await empty.payer.pay("x", { payTo: WORKER.payTo, amount: 3_000_000n }),
    ).toEqual({});
    expect(empty.log).toEqual(["started", null]);

    const badHeader = ports({
      paid: () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { headers: { "PAYMENT-RESPONSE": "!!!" } },
        ),
    });
    expect(
      await badHeader.payer.pay("x", {
        payTo: WORKER.payTo,
        amount: 3_000_000n,
      }),
    ).toEqual({});
  });
});

describe("createDemoWorkerPorts with a third-party worker", () => {
  const demo = (s: Server = {}, listing: AgentListing = WORKER) => {
    const w = worker(s);
    const log: Array<string | null> = [];
    return {
      ...createDemoWorkerPorts(
        listing,
        TASK,
        {
          started: async () => {
            log.push("started");
          },
          answered: async (t) => {
            log.push(t);
          },
        },
        () => 1_700_000_000_000,
        { network: NETWORK, safeFetch: w.fetchImpl },
      ),
      seen: w.seen,
      log,
    };
  };

  it("probes the real 402 with the same payee and price rules as live mode", async () => {
    expect(await demo().probe.challenge("x")).toEqual({
      payTo: WORKER.payTo,
      amount: 3_000_000n,
    });
    await expect(
      demo({ payTo: "0.0.9999" }).probe.challenge("x"),
    ).rejects.toMatchObject({ kind: "RESOURCE_NOT_PAYABLE" });
    await expect(
      demo({ amount: "9000000" }).probe.challenge("x"),
    ).rejects.toMatchObject({ kind: "RESOURCE_NOT_PAYABLE" });
  });

  it("sends the task with the demo payment marker, never a signed payment, and hands over the answer", async () => {
    const p = demo();
    const r = await p.payer.pay("x", {
      payTo: WORKER.payTo,
      amount: 3_000_000n,
    });
    expect(r.transactionId).toMatch(/^demo-unsettled@/);
    expect(p.log).toEqual(["started", "Done."]);
    const sent = p.seen.at(-1) as Request;
    expect(sent.headers.get("PAYMENT-SIGNATURE")).toBe(DEMO_PAYMENT);
    expect(await sent.json()).toMatchObject({ model: "acme-large" });
  });

  it("fails on an error status, an unreachable worker, or a refused endpoint", async () => {
    await expect(
      demo({ paid: () => new Response("{}", { status: 500 }) }).payer.pay("x", {
        payTo: WORKER.payTo,
        amount: 1n,
      }),
    ).rejects.toMatchObject({ kind: "PAYMENT_FAILED" });
    const down = createDemoWorkerPorts(
      WORKER,
      TASK,
      { started: async () => {}, answered: async () => {} },
      () => 0,
      {
        network: NETWORK,
        safeFetch: (async () => {
          throw new Error("refused");
        }) as typeof fetch,
      },
    );
    await expect(
      down.payer.pay("x", { payTo: WORKER.payTo, amount: 1n }),
    ).rejects.toMatchObject({ kind: "PAYMENT_FAILED", message: "refused" });
    const bad = demo({}, { ...WORKER, endpoint: "https://10.0.0.1/v1" });
    await expect(
      bad.payer.pay("x", { payTo: WORKER.payTo, amount: 1n }),
    ).rejects.toMatchObject({ message: "worker endpoint refused" });
  });

  it("still refuses a third-party worker when no remote access is configured", async () => {
    const p = createDemoWorkerPorts(
      WORKER,
      TASK,
      { started: async () => {}, answered: async () => {} },
      () => 0,
    );
    await expect(p.probe.challenge("x")).rejects.toMatchObject({
      message: "demo mode runs only the built-in worker",
    });
  });
});
