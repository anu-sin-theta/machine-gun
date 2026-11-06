import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/adapters/db";
import { completeApproval } from "@/adapters/world";
import { builtInListings } from "@/marketplace/builtins";
import { chatRequestSchema, scribe, scribeReply } from "@/marketplace/scribe";
import type { AgentListing } from "@/marketplace/types";
import {
  type AccountRecord,
  authenticate,
  createAccount,
  createDemoWorkerPorts,
  hashToken,
  MAX_OPEN_TASKS,
  MAX_OUTPUT,
  proposeTask,
  readAnswer,
  resumeTask,
  runTask,
  scanAnswer,
  type TaskDeps,
  taskCheckText,
  taskInputSchema,
  toPublicAccount,
  toPublicTask,
  type WorkerPorts,
} from "@/tasks";
import { makeHarness, PAYEE, type Script } from "../agent/harness";

const SCRIBE_PRICE = 10_000_000n;

describe("accounts", () => {
  const deps = { now: () => 5, random: (n: number) => "a".repeat(n) };

  it("issues a token once and stores only its hash", async () => {
    const repos = createMemoryRepositories();
    const r = await createAccount(repos.accounts, { name: " Bot " }, deps);
    if (!r.ok) throw new Error("expected an account");
    expect(r.token).toMatch(/^kvk_a{32}$/);
    expect(r.account).toMatchObject({
      name: "Bot",
      status: "active",
      createdAt: 5,
    });
    expect(r.account.tokenHash).toBe(hashToken(r.token));
    expect(JSON.stringify(toPublicAccount(r.account))).not.toContain(
      r.account.tokenHash,
    );
  });

  it("rejects a missing or overlong name", async () => {
    const repos = createMemoryRepositories();
    for (const bad of [null, {}, { name: "" }, { name: "x".repeat(61) }])
      expect((await createAccount(repos.accounts, bad, deps)).ok).toBe(false);
  });

  it("reports a collision instead of overwriting", async () => {
    const repos = createMemoryRepositories();
    expect((await createAccount(repos.accounts, { name: "a" }, deps)).ok).toBe(
      true,
    );
    expect(await createAccount(repos.accounts, { name: "b" }, deps)).toEqual({
      ok: false,
      error: "could not create the account, try again",
    });
  });

  it("authenticates only a well-formed bearer token of an active account", async () => {
    const repos = createMemoryRepositories();
    const r = await createAccount(repos.accounts, { name: "a" }, deps);
    if (!r.ok) throw new Error("expected an account");
    expect((await authenticate(repos.accounts, `Bearer ${r.token}`))?.id).toBe(
      r.account.id,
    );
    for (const header of [
      null,
      "",
      r.token,
      `Basic ${r.token}`,
      `Bearer ${r.token}x`,
      "Bearer kvk_short",
      `Bearer ${"kvk_"}${"b".repeat(32)}`,
    ])
      expect(await authenticate(repos.accounts, header)).toBeNull();

    const revoked: AccountRecord = {
      ...r.account,
      id: "acct_revoked",
      tokenHash: hashToken(`kvk_${"c".repeat(32)}`),
      status: "revoked",
    };
    await repos.accounts.create(revoked);
    expect(
      await authenticate(repos.accounts, `Bearer kvk_${"c".repeat(32)}`),
    ).toBeNull();
  });
});

describe("worker answers", () => {
  const reply = (content: unknown) => ({
    choices: [{ message: { role: "assistant", content } }],
  });

  it("keeps only the assistant text, without control characters, capped", () => {
    expect(readAnswer(reply("hi\tthere\nfriend\u0007 "))).toBe(
      "hi\tthere\nfriend",
    );
    expect(readAnswer(reply("x".repeat(MAX_OUTPUT + 5)))?.length).toBe(
      MAX_OUTPUT,
    );
  });

  it("returns null when there is no usable answer", () => {
    for (const bad of [
      null,
      {},
      { choices: [] },
      reply(42),
      reply("   "),
      reply(null),
    ])
      expect(readAnswer(bad)).toBeNull();
  });

  it("flags risky links in an answer and leaves ordinary ones alone", () => {
    const warnings = scanAnswer(
      "See https://www.wikipedia.org/ and pay at http://paypa1-secure-login.xyz/verify now",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.url).toBe("http://paypa1-secure-login.xyz/verify");
    expect(["medium", "high"]).toContain(warnings[0]?.level);
    expect(warnings[0]?.signals.length).toBeGreaterThan(0);
    expect(scanAnswer("no links here")).toEqual([]);
  });
});

describe("the demo worker (scribe)", () => {
  it("summarises and lists links in the chat-completions shape", () => {
    const out = scribeReply(
      {
        messages: [
          { role: "system", content: "ignored" },
          {
            role: "user",
            content:
              "First point. Second point! Third point? See https://a.example/x and https://a.example/x.",
          },
        ],
      },
      1_700_000_000_000,
    );
    expect(out.object).toBe("chat.completion");
    expect(out.created).toBe(1_700_000_000);
    const text = out.choices[0]?.message.content ?? "";
    expect(text).toContain("Summary: First point. Second point!");
    expect(text).toContain("4 sentences");
    expect(text.match(/- https:\/\/a\.example\/x/g)).toHaveLength(1);
  });

  it("handles empty text and no links", () => {
    expect(scribe("")).toContain("Summary: (empty)");
    expect(scribe("plain words")).toContain("Links: none");
  });

  it("validates requests", () => {
    expect(chatRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(
      chatRequestSchema.safeParse({
        messages: [{ role: "tool", content: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("taskInputSchema", () => {
  it("needs exactly one of agentId or skill, and a price as a string", () => {
    const ok = { prompt: "p", maxPriceTinybars: "1" };
    expect(
      taskInputSchema.safeParse({ ...ok, skill: "summarize" }).success,
    ).toBe(true);
    expect(taskInputSchema.safeParse({ ...ok, agentId: "a" }).success).toBe(
      true,
    );
    expect(taskInputSchema.safeParse(ok).success).toBe(false);
    expect(
      taskInputSchema.safeParse({ ...ok, agentId: "a", skill: "summarize" })
        .success,
    ).toBe(false);
    expect(
      taskInputSchema.safeParse({
        ...ok,
        skill: "summarize",
        maxPriceTinybars: 1,
      }).success,
    ).toBe(false);
  });
});

/** A harness for the task flow on top of the agent harness. */
async function setup(
  script: Script = {},
  ports?: (
    listing: AgentListing,
    hooks: Parameters<TaskDeps["workerPorts"]>[2],
  ) => WorkerPorts,
) {
  const h = await makeHarness(script);
  for (const l of builtInListings({
    baseUrl: "http://localhost:3000",
    payTo: PAYEE,
    now: 0,
  }))
    await h.repos.agents.create(l);
  let n = 0;
  const deps: TaskDeps = {
    repos: h.repos,
    registry: {
      all: (filter) => h.repos.agents.list(filter),
      get: (id) => h.repos.agents.get(id),
    },
    agent: () => h.deps,
    workerPorts: (listing, task, hooks) =>
      ports
        ? ports(listing, hooks)
        : createDemoWorkerPorts(listing, task, hooks, h.deps.now),
    now: h.deps.now,
    random: (bytes) => `${++n}`.padStart(bytes, "0"),
  };
  const account: AccountRecord = {
    id: "acct_1",
    name: "buyer",
    tokenHash: "h",
    status: "active",
    createdAt: 0,
  };
  await h.repos.accounts.create(account);
  return { h, deps, account };
}

const SUMMARY_TASK = {
  prompt: "Summarise: Kavach402 vets payments. It uses World ID.",
  skill: "summarize",
  maxPriceTinybars: "20000000",
};

const types = (t: { events: Array<{ type: string }> } | null) =>
  (t?.events ?? []).map((e) => e.type);

describe("proposeTask", () => {
  it("queues a task with the cheapest active worker that has the skill", async () => {
    const { deps, account } = await setup();
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    expect(r.task).toMatchObject({
      accountId: "acct_1",
      workerId: "kavach-scribe",
      status: "queued",
      maxPriceTinybars: 20_000_000n,
    });
    expect(types(r.task)).toEqual(["task.created", "worker.matched"]);
    expect(r.task.events[1]?.detail).toBe("kavach-scribe at 0.1 HBAR");
  });

  it("prefers a cheaper worker with the same skill", async () => {
    const { deps, account, h } = await setup();
    const scribeListing = await h.repos.agents.get("kavach-scribe");
    await h.repos.agents.create({
      ...(scribeListing as AgentListing),
      id: "cheap-writer",
      evidenceSource: "cheap-writer",
      priceTinybars: 1_000_000n,
      builtIn: false,
    });
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    expect(r.ok && r.task.workerId).toBe("cheap-writer");
  });

  it("accepts a named worker and refuses one that is not an active worker", async () => {
    const { deps, account, h } = await setup();
    const named = await proposeTask(deps, account, {
      prompt: "p",
      agentId: "kavach-scribe",
      maxPriceTinybars: "10000000",
    });
    expect(named.ok).toBe(true);

    for (const agentId of ["kavach-link-intel", "nobody"])
      expect(
        await proposeTask(deps, account, {
          prompt: "p",
          agentId,
          maxPriceTinybars: "10000000",
        }),
      ).toMatchObject({ ok: false, status: 404 });

    await h.repos.agents.setStatus("kavach-scribe", "suspended");
    expect(
      await proposeTask(deps, account, {
        prompt: "p",
        agentId: "kavach-scribe",
        maxPriceTinybars: "10000000",
      }),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses when no worker fits the buyer's maximum", async () => {
    const { deps, account } = await setup();
    expect(
      await proposeTask(deps, account, {
        ...SUMMARY_TASK,
        maxPriceTinybars: "9999999",
      }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await proposeTask(deps, account, {
        prompt: "p",
        agentId: "kavach-scribe",
        maxPriceTinybars: "9999999",
      }),
    ).toMatchObject({ ok: false, status: 422 });
    expect(
      await proposeTask(deps, account, { ...SUMMARY_TASK, skill: "translate" }),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects an invalid task", async () => {
    const { deps, account } = await setup();
    for (const bad of [null, {}, { ...SUMMARY_TASK, prompt: "" }])
      expect(await proposeTask(deps, account, bad)).toMatchObject({
        ok: false,
        status: 400,
      });
  });

  it("limits how many unfinished tasks an account may have", async () => {
    const { deps, account } = await setup();
    for (let i = 0; i < MAX_OPEN_TASKS; i++)
      expect((await proposeTask(deps, account, SUMMARY_TASK)).ok).toBe(true);
    expect(await proposeTask(deps, account, SUMMARY_TASK)).toMatchObject({
      ok: false,
      status: 429,
    });
  });
});

describe("runTask", () => {
  it("vets the payment, pays the worker and keeps its screened answer", async () => {
    const { deps, account, h } = await setup();
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const done = await runTask(deps, r.task.id);

    expect(done).toMatchObject({ status: "completed", warnings: [] });
    expect(done?.output).toContain(
      "Summary: Summarise: Kavach402 vets payments. It uses World ID.",
    );
    expect(done?.checkId).toMatch(/^chk_/);
    expect(types(done)).toEqual([
      "task.created",
      "worker.matched",
      "check.started",
      "worker.called",
      "answer.received",
      "task.completed",
    ]);

    // The check really ran: 0G read the task, verifiers reported on the worker's account.
    const check = await h.repos.checks.get(done?.checkId as string);
    expect(check).toMatchObject({
      status: "paid",
      payee: PAYEE,
      amount: { units: SCRIBE_PRICE },
      resource:
        "http://localhost:3000/api/x402/workers/scribe/v1/chat/completions",
    });
    expect(check?.inputText).toContain(SUMMARY_TASK.prompt);
    expect(h.calls.extract).toBe(1);
    expect(h.calls.reputation).toEqual([PAYEE]);
  });

  it("runs only once", async () => {
    const { deps, account } = await setup();
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    await runTask(deps, r.task.id);
    const again = await runTask(deps, r.task.id);
    expect(types(again).filter((t) => t === "check.started")).toHaveLength(1);
    expect(await runTask(deps, "task_missing")).toBeNull();
  });

  it("stops at a human approval, then pays after World ID", async () => {
    const { deps, account, h } = await setup({
      verdict: { level: "medium", reasons: ["new worker"] },
    });
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const waiting = await runTask(deps, r.task.id);
    expect(waiting).toMatchObject({
      status: "awaiting-approval",
      output: null,
    });
    expect(waiting?.approvalUrl).toBeTruthy();
    expect(toPublicTask(waiting as never).approvalUrl).toBe(
      waiting?.approvalUrl,
    );

    const outcome = await completeApproval(
      h.deps.approval,
      h.issuer.approve(waiting?.approvalUrl as string),
    );
    const result = await resumeTask(deps, waiting as never, outcome);
    expect(result?.status).toBe("paid");
    const done = await h.repos.tasks.get(r.task.id);
    expect(done).toMatchObject({ status: "completed" });
    expect(done?.output).toContain("Summary:");
    expect(toPublicTask(done as never).approvalUrl).toBeNull();
  });

  it("blocks the task when the human says no", async () => {
    const { deps, account } = await setup({
      verdict: { level: "medium", reasons: ["new worker"] },
    });
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const waiting = await runTask(deps, r.task.id);
    await resumeTask(
      deps,
      waiting as never,
      {
        kind: "denied",
        attemptId: "a",
        checkId: waiting?.checkId as string,
        reason: "user said no",
      } as never,
    );
    const done = await deps.repos.tasks.get(r.task.id);
    expect(done).toMatchObject({ status: "blocked", output: null });
  });

  it("never pays a worker that was suspended while the human was approving", async () => {
    const { deps, account, h } = await setup({
      verdict: { level: "medium", reasons: ["new worker"] },
    });
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const waiting = await runTask(deps, r.task.id);
    await h.repos.agents.setStatus("kavach-scribe", "suspended");
    const outcome = await completeApproval(
      h.deps.approval,
      h.issuer.approve(waiting?.approvalUrl as string),
    );
    expect(await resumeTask(deps, waiting as never, outcome)).toBeNull();
    expect(await deps.repos.tasks.get(r.task.id)).toMatchObject({
      status: "failed",
    });
    expect((await h.repos.checks.get(waiting?.checkId as string))?.status).toBe(
      "awaiting-approval",
    );
  });

  it("blocks a high-risk task without paying", async () => {
    const { deps, account } = await setup({
      verdict: { level: "high", reasons: ["asks to steal credentials"] },
    });
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const done = await runTask(deps, r.task.id);
    // High risk asks for the strongest approval and is blocked by default.
    expect(["awaiting-approval", "blocked"]).toContain(done?.status);
    expect(done?.output).toBeNull();
    expect(types(done)).not.toContain("worker.called");
  });

  it("fails a task whose worker disappeared before it ran", async () => {
    const { deps, account, h } = await setup();
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    await h.repos.agents.setStatus("kavach-scribe", "suspended");
    expect(await runTask(deps, r.task.id)).toMatchObject({
      status: "failed",
      checkId: null,
    });
  });

  it("does not run third-party workers in demo mode", async () => {
    const { deps, account, h } = await setup();
    const s = (await h.repos.agents.get("kavach-scribe")) as AgentListing;
    await h.repos.agents.create({
      ...s,
      id: "acme-writer",
      evidenceSource: "acme-writer",
      priceTinybars: 1_000_000n,
      builtIn: false,
    });
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const done = await runTask(deps, r.task.id);
    expect(done).toMatchObject({ status: "failed" });
    expect(done?.events.at(-1)?.detail).toBe("RESOURCE_NOT_PAYABLE");
  });

  it("fails, honestly, when a paid worker sends no answer", async () => {
    const { deps, account } = await setup({}, (listing, hooks) => ({
      probe: {
        async challenge() {
          return { payTo: listing.payTo, amount: listing.priceTinybars };
        },
      },
      payer: {
        async pay() {
          await hooks.started();
          await hooks.answered(null);
          return { transactionId: "0.0.1001@9.9" };
        },
      },
    }));
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const done = await runTask(deps, r.task.id);
    expect(done).toMatchObject({ status: "failed", output: null });
    expect(types(done)).toContain("answer.missing");
  });

  it("flags risky links the worker put in its answer", async () => {
    const { deps, account } = await setup({}, (listing, hooks) => ({
      probe: {
        async challenge() {
          return { payTo: listing.payTo, amount: listing.priceTinybars };
        },
      },
      payer: {
        async pay() {
          await hooks.started();
          await hooks.answered(
            "Done. Claim your refund at http://paypa1-secure-login.xyz/verify",
          );
          return {};
        },
      },
    }));
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const done = await runTask(deps, r.task.id);
    expect(done?.status).toBe("completed");
    expect(done?.warnings).toHaveLength(1);
    expect(done?.events.find((e) => e.type === "answer.received")?.detail).toBe(
      "1 risky link(s) flagged",
    );
  });

  it("marks the task failed when the check itself throws", async () => {
    const { deps, account } = await setup();
    const broken: TaskDeps = {
      ...deps,
      agent: () => {
        throw new Error("not configured");
      },
    };
    const r = await proposeTask(broken, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    expect(await runTask(broken, r.task.id)).toMatchObject({
      status: "failed",
    });
  });
});

describe("taskCheckText", () => {
  it("names the worker, its account, the ceiling and the task", () => {
    const [scribeListing] = builtInListings({
      baseUrl: "http://localhost:3000",
      payTo: PAYEE,
      now: 0,
    }).filter((l) => l.role === "worker");
    const text = taskCheckText(
      scribeListing as AgentListing,
      {
        prompt: "do it",
        maxPriceTinybars: 5_000_000n,
      } as never,
    );
    expect(text).toContain("(kavach-scribe)");
    expect(text).toContain(`at most 0.05 HBAR to account ${PAYEE}`);
    expect(text.endsWith("do it")).toBe(true);
  });
});
