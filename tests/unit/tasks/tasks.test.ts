import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/adapters/db";
import { completeApproval } from "@/adapters/world";
import { handleApprovalOutcome } from "@/agent/pipeline";
import { builtInListings } from "@/marketplace/builtins";
import { chatRequestSchema, scribe, scribeReply } from "@/marketplace/scribe";
import type { AgentListing } from "@/marketplace/types";
import {
  type AccountRecord,
  acceptTask,
  allowedActions,
  authenticate,
  createAccount,
  createDemoWorkerPorts,
  editTask,
  hashToken,
  MAX_OPEN_TASKS,
  MAX_OUTPUT,
  proposeTask,
  readAnswer,
  researchTask,
  resumeTask,
  runTask,
  scanAnswer,
  type TaskDeps,
  taskCheckText,
  taskInputSchema,
  toPublicAccount,
  toPublicTask,
  type WorkerPorts,
  withdrawTask,
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

/** Proposed and accepted at once, so the runTask tests start from a queued task. */
const SUMMARY_TASK = {
  prompt: "Summarise: Kavach402 vets payments. It uses World ID.",
  skill: "summarize",
  maxPriceTinybars: "20000000",
  autoAccept: true,
};
/** Proposed only: the requester decides. */
const { autoAccept: _auto, ...PROPOSAL } = SUMMARY_TASK;

const types = (t: { events: Array<{ type: string }> } | null) =>
  (t?.events ?? []).map((e) => e.type);

/** Adds a cheaper third-party worker with the same skills as Scribe. */
async function addWorker(
  h: Awaited<ReturnType<typeof setup>>["h"],
  id: string,
  price: bigint,
) {
  const scribeListing = (await h.repos.agents.get(
    "kavach-scribe",
  )) as AgentListing;
  await h.repos.agents.create({
    ...scribeListing,
    id,
    name: id,
    evidenceSource: id,
    priceTinybars: price,
    builtIn: false,
  });
}

async function proposed(deps: TaskDeps, account: AccountRecord, input = {}) {
  const r = await proposeTask(deps, account, { ...PROPOSAL, ...input });
  if (!r.ok) throw new Error(r.error);
  return r.task;
}

describe("proposeTask", () => {
  it("suggests workers and pays nobody until the requester decides", async () => {
    const { deps, account, h } = await setup();
    await addWorker(h, "cheap-writer", 1_000_000n);
    const r = await proposeTask(deps, account, PROPOSAL);
    if (!r.ok) throw new Error(r.error);
    expect(r.run).toBe(false);
    expect(r.task).toMatchObject({
      accountId: "acct_1",
      status: "awaiting-choice",
      workerId: null,
      skill: "summarize",
      requestedAgentId: null,
      maxPriceTinybars: 20_000_000n,
    });
    expect(r.task.candidates.map((c) => [c.workerId, c.recommended])).toEqual([
      ["cheap-writer", true],
      ["kavach-scribe", false],
    ]);
    expect(r.task.candidates[1]).toMatchObject({
      priceTinybars: "10000000",
      builtIn: true,
      model: "kavach-scribe-1",
    });
    expect(types(r.task)).toEqual(["task.created", "workers.suggested"]);
    expect(r.task.events[1]?.detail).toBe(
      "2 worker(s); recommended cheap-writer at 0.01 HBAR",
    );
    expect(h.calls.pay).toHaveLength(0);
    expect(h.calls.extract).toBe(0);
  });

  it("with autoAccept, takes the recommended worker and queues the task", async () => {
    const { deps, account } = await setup();
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    expect(r.run).toBe(true);
    expect(r.task).toMatchObject({
      status: "queued",
      workerId: "kavach-scribe",
    });
    expect(types(r.task)).toEqual([
      "task.created",
      "workers.suggested",
      "worker.accepted",
    ]);
  });

  it("suggests only the named worker when one is asked for", async () => {
    const { deps, account, h } = await setup();
    await addWorker(h, "cheap-writer", 1_000_000n);
    const task = await proposed(deps, account, {
      skill: undefined,
      agentId: "kavach-scribe",
    });
    expect(task.candidates.map((c) => c.workerId)).toEqual(["kavach-scribe"]);
    expect(task.requestedAgentId).toBe("kavach-scribe");

    for (const agentId of ["kavach-link-intel", "nobody"])
      expect(
        (await proposed(deps, account, { skill: undefined, agentId }))
          .candidates,
      ).toEqual([]);
  });

  it("waits, instead of failing, when no worker fits yet", async () => {
    const { deps, account } = await setup();
    for (const input of [
      { maxPriceTinybars: "9999999" },
      { skill: "translate" },
    ]) {
      const task = await proposed(deps, account, input);
      expect(task).toMatchObject({ status: "awaiting-choice", candidates: [] });
      expect(task.events[1]?.detail).toMatch(/no worker matches yet/);
    }
    // autoAccept with nothing to accept also waits.
    const r = await proposeTask(deps, account, {
      ...SUMMARY_TASK,
      skill: "translate",
    });
    expect(r.ok && r.run).toBe(false);
  });

  it("rejects an invalid task", async () => {
    const { deps, account } = await setup();
    for (const bad of [null, {}, { ...PROPOSAL, prompt: "" }])
      expect(await proposeTask(deps, account, bad)).toMatchObject({
        ok: false,
        status: 400,
      });
  });

  it("limits how many unfinished tasks an account may have, including ones waiting for a choice", async () => {
    const { deps, account } = await setup();
    for (let i = 0; i < MAX_OPEN_TASKS; i++)
      expect((await proposeTask(deps, account, PROPOSAL)).ok).toBe(true);
    expect(await proposeTask(deps, account, PROPOSAL)).toMatchObject({
      ok: false,
      status: 429,
    });
  });
});

describe("the requester decides", () => {
  it("accepts the recommended worker by default, or a chosen suggestion", async () => {
    const { deps, account, h } = await setup();
    await addWorker(h, "cheap-writer", 1_000_000n);

    const a = await proposed(deps, account);
    const byDefault = await acceptTask(deps, account, a.id, {});
    expect(byDefault).toMatchObject({
      ok: true,
      run: true,
      task: { status: "queued", workerId: "cheap-writer" },
    });

    const b = await proposed(deps, account);
    const chosen = await acceptTask(deps, account, b.id, {
      workerId: "kavach-scribe",
    });
    expect(chosen.ok && chosen.task.workerId).toBe("kavach-scribe");
    expect(chosen.ok && chosen.task.events.at(-1)).toMatchObject({
      type: "worker.accepted",
      detail: "kavach-scribe at 0.1 HBAR",
    });
  });

  it("will not accept a worker that was not suggested, has gone, or a task in the wrong state", async () => {
    const { deps, account, h } = await setup();
    const task = await proposed(deps, account);
    expect(
      await acceptTask(deps, account, task.id, {
        workerId: "kavach-link-intel",
      }),
    ).toMatchObject({ ok: false, status: 422 });
    expect(
      await acceptTask(deps, account, task.id, { workerId: 5 }),
    ).toMatchObject({ ok: false, status: 400 });

    await h.repos.agents.setStatus("kavach-scribe", "suspended");
    expect(await acceptTask(deps, account, task.id, {})).toMatchObject({
      ok: false,
      status: 409,
    });
    await h.repos.agents.setStatus("kavach-scribe", "active");

    await acceptTask(deps, account, task.id, {});
    expect(await acceptTask(deps, account, task.id, {})).toMatchObject({
      ok: false,
      status: 409,
      error: "cannot accept a task that is queued",
    });

    const empty = await proposed(deps, account, { skill: "translate" });
    expect(await acceptTask(deps, account, empty.id, {})).toMatchObject({
      ok: false,
      status: 422,
    });
  });

  it("acts only on the requester's own tasks", async () => {
    const { deps, account } = await setup();
    const task = await proposed(deps, account);
    const stranger = { ...account, id: "acct_2" };
    for (const result of [
      await acceptTask(deps, stranger, task.id, {}),
      await researchTask(deps, stranger, task.id, {}),
      await editTask(deps, stranger, task.id, { prompt: "x" }),
      await withdrawTask(deps, stranger, task.id),
      await withdrawTask(deps, account, "task_missing"),
    ])
      expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("searches again, ruling workers out for good, and finds workers that joined since", async () => {
    const { deps, account, h } = await setup();
    const task = await proposed(deps, account, { skill: "translate" });
    expect(task.candidates).toEqual([]);

    // A translator joins later: searching again finds it (the task waited in the meantime).
    const scribeListing = (await h.repos.agents.get(
      "kavach-scribe",
    )) as AgentListing;
    await h.repos.agents.create({
      ...scribeListing,
      id: "translator",
      evidenceSource: "translator",
      skills: ["translate"],
      builtIn: false,
    });
    const found = await researchTask(deps, account, task.id, {});
    expect(found.ok && found.task.candidates.map((c) => c.workerId)).toEqual([
      "translator",
    ]);

    const ruledOut = await researchTask(deps, account, task.id, {
      exclude: ["translator"],
    });
    expect(ruledOut.ok && ruledOut.task).toMatchObject({
      candidates: [],
      excluded: ["translator"],
    });
    const again = await researchTask(deps, account, task.id, {});
    expect(again.ok && again.task.candidates).toEqual([]);
    expect(
      await researchTask(deps, account, task.id, { exclude: "translator" }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("edits the prompt, target and maximum, then suggests again", async () => {
    const { deps, account, h } = await setup();
    await addWorker(h, "cheap-writer", 1_000_000n);
    const task = await proposed(deps, account, { maxPriceTinybars: "5000000" });
    expect(task.candidates.map((c) => c.workerId)).toEqual(["cheap-writer"]);

    const edited = await editTask(deps, account, task.id, {
      prompt: "Summarise this instead.",
      maxPriceTinybars: "20000000",
    });
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.task).toMatchObject({
      status: "awaiting-choice",
      prompt: "Summarise this instead.",
      maxPriceTinybars: 20_000_000n,
    });
    expect(edited.task.candidates.map((c) => c.workerId)).toEqual([
      "cheap-writer",
      "kavach-scribe",
    ]);
    expect(edited.task.events.at(-2)).toMatchObject({
      type: "task.edited",
      detail: "prompt, maxPriceTinybars",
    });

    const named = await editTask(deps, account, task.id, {
      agentId: "kavach-scribe",
    });
    expect(named.ok && named.task).toMatchObject({
      skill: null,
      requestedAgentId: "kavach-scribe",
    });
    const back = await editTask(deps, account, task.id, { skill: "summarize" });
    expect(back.ok && back.task).toMatchObject({
      skill: "summarize",
      requestedAgentId: null,
    });

    for (const bad of [
      {},
      { agentId: "a", skill: "summarize" },
      { maxPriceTinybars: "0" },
      null,
    ])
      expect(await editTask(deps, account, task.id, bad)).toMatchObject({
        ok: false,
        status: 400,
      });
  });

  it("cannot edit, search again or withdraw once the worker is being paid or done", async () => {
    const { deps, account } = await setup();
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    await runTask(deps, r.task.id);
    for (const result of [
      await editTask(deps, account, r.task.id, { prompt: "x" }),
      await researchTask(deps, account, r.task.id, {}),
      await withdrawTask(deps, account, r.task.id),
    ])
      expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("withdraws a task before it runs, and a withdrawn task never runs", async () => {
    const { deps, account, h } = await setup();
    const choosing = await proposed(deps, account);
    expect(await withdrawTask(deps, account, choosing.id)).toMatchObject({
      ok: true,
      task: { status: "withdrawn" },
    });

    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    await withdrawTask(deps, account, r.task.id);
    expect(await runTask(deps, r.task.id)).toMatchObject({
      status: "withdrawn",
    });
    expect(h.calls.pay).toHaveLength(0);
    expect(await withdrawTask(deps, account, r.task.id)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("withdrawing during a pending approval cancels it: approving later pays nothing", async () => {
    const { deps, account, h } = await setup({
      verdict: { level: "medium", reasons: ["new worker"] },
    });
    const r = await proposeTask(deps, account, SUMMARY_TASK);
    if (!r.ok) throw new Error(r.error);
    const waiting = await runTask(deps, r.task.id);
    expect(waiting?.status).toBe("awaiting-approval");

    const w = await withdrawTask(deps, account, r.task.id);
    expect(w.ok && types(w.task).slice(-2)).toEqual([
      "approval.cancelled",
      "task.withdrawn",
    ]);
    expect((await h.repos.checks.get(waiting?.checkId as string))?.status).toBe(
      "blocked",
    );

    // The human approves anyway, on the old link: nothing is paid.
    const outcome = await completeApproval(
      h.deps.approval,
      h.issuer.approve(waiting?.approvalUrl as string),
    );
    const current = (await h.repos.tasks.get(r.task.id)) as never;
    expect(await resumeTask(deps, current, outcome)).toBeNull();
    const settled = await handleApprovalOutcome(h.deps, outcome);
    expect(settled?.reason).toBe("NOT_AWAITING_APPROVAL");
    expect(h.calls.pay).toHaveLength(0);
  });

  it("after a block, searches again without the worker that was tried", async () => {
    const { deps, account, h } = await setup(
      { verdict: { level: "medium", reasons: ["new worker"] } },
      (listing) => ({
        probe: {
          async challenge() {
            return { payTo: listing.payTo, amount: listing.priceTinybars };
          },
        },
        payer: {
          async pay() {
            return {};
          },
        },
      }),
    );
    await addWorker(h, "cheap-writer", 1_000_000n);
    const task = await proposed(deps, account);
    await acceptTask(deps, account, task.id, {});
    const waiting = await runTask(deps, task.id);
    expect(waiting?.workerId).toBe("cheap-writer");

    const again = await researchTask(deps, account, task.id, {});
    if (!again.ok) throw new Error(again.error);
    expect(again.task).toMatchObject({
      status: "awaiting-choice",
      workerId: null,
      checkId: null,
      approvalUrl: null,
      excluded: ["cheap-writer"],
    });
    expect(again.task.candidates.map((c) => c.workerId)).toEqual([
      "kavach-scribe",
    ]);
    expect((await h.repos.checks.get(waiting?.checkId as string))?.status).toBe(
      "blocked",
    );
    expect(types(again.task)).toContain("approval.cancelled");
  });

  it("lists what the requester may do next", () => {
    expect(allowedActions("awaiting-choice")).toEqual([
      "accept",
      "research",
      "edit",
      "withdraw",
    ]);
    expect(allowedActions("awaiting-approval")).toEqual([
      "research",
      "edit",
      "withdraw",
    ]);
    expect(allowedActions("queued")).toEqual(["withdraw"]);
    for (const s of ["vetting", "running", "completed", "withdrawn"] as const)
      expect(allowedActions(s)).toEqual([]);
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
      "workers.suggested",
      "worker.accepted",
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
