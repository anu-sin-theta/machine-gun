import { afterEach, describe, expect, it, vi } from "vitest";

// Each test loads the route modules afresh, which is slow under coverage.
vi.setConfig({ testTimeout: 30_000 });

const TOKEN = "0123456789abcdef";

/** Fresh modules per test: the config is read once per process. `after` runs its callback at once. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const background: Array<Promise<unknown>> = [];
  vi.doMock("next/server", async (original) => ({
    ...(await original<typeof import("next/server")>()),
    connection: async () => {},
    after: (fn: () => Promise<unknown>) => {
      background.push(fn());
    },
  }));
  return {
    accounts: await import("@/app/api/accounts/route"),
    tasks: await import("@/app/api/tasks/route"),
    task: await import("@/app/api/tasks/[id]/route"),
    action: await import("@/app/api/tasks/[id]/[action]/route"),
    card: await import("@/app/.well-known/agent-card.json/route"),
    settle: () => Promise.all(background),
  };
}

const DEMO = {
  AGENT_MODE: "demo",
  WORLD_MODE: "simulated",
  API_TOKEN: TOKEN,
};

afterEach(() => {
  vi.doUnmock("next/server");
  vi.unstubAllEnvs();
});

const json = (url: string, body: unknown, token?: string) =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
const get = (url: string, token?: string) =>
  new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const actionCtx = (id: string, action: string) => ({
  params: Promise.resolve({ id, action }),
});

async function signUp(
  m: Awaited<ReturnType<typeof load>>,
  name = "my agent",
): Promise<string> {
  const res = await m.accounts.POST(
    json("http://localhost/api/accounts", { name }),
  );
  expect(res.status).toBe(201);
  return (await res.json()).token;
}

describe("POST /api/accounts", () => {
  it("in demo mode anyone gets an account, and the token is shown once", async () => {
    const m = await load(DEMO);
    const res = await m.accounts.POST(
      json("http://localhost/api/accounts", { name: "bot" }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.token).toMatch(/^kvk_/);
    expect(body.account).toMatchObject({ name: "bot", status: "active" });
    expect(body.account.tokenHash).toBeUndefined();
  });

  it("answers 400 to a bad body", async () => {
    const m = await load(DEMO);
    expect(
      (await m.accounts.POST(json("http://localhost/api/accounts", {}))).status,
    ).toBe(400);
  });

  it("in live mode only the operator issues accounts", async () => {
    const live = await load({ API_TOKEN: TOKEN });
    expect(
      (
        await live.accounts.POST(
          json("http://localhost/api/accounts", { name: "x" }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await live.accounts.POST(
          json("http://localhost/api/accounts", { name: "x" }, TOKEN),
        )
      ).status,
    ).toBe(201);

    const noToken = await load({ API_TOKEN: "" });
    expect(
      (
        await noToken.accounts.POST(
          json("http://localhost/api/accounts", { name: "x" }),
        )
      ).status,
    ).toBe(403);
  });
});

describe("tasks API", () => {
  it("refuses calls without an account token", async () => {
    const m = await load(DEMO);
    expect((await m.tasks.GET(get("http://localhost/api/tasks"))).status).toBe(
      401,
    );
    expect(
      (await m.tasks.POST(json("http://localhost/api/tasks", {}, "kvk_nope")))
        .status,
    ).toBe(401);
    expect(
      (await m.task.GET(get("http://localhost/api/tasks/x"), ctx("x"))).status,
    ).toBe(401);
  });

  it("proposes a task, lets the requester accept a suggestion, runs it in the background, and shows progress and the answer", async () => {
    const m = await load(DEMO);
    const token = await signUp(m);
    const res = await m.tasks.POST(
      json(
        "http://localhost/api/tasks",
        {
          prompt: "Summarise: Agents pay agents. Kavach402 checks first.",
          skill: "summarize",
          maxPriceTinybars: "20000000",
        },
        token,
      ),
    );
    expect(res.status).toBe(201);
    const { task } = await res.json();
    expect(res.headers.get("location")).toBe(`/api/tasks/${task.id}`);
    expect(task).toMatchObject({
      status: "awaiting-choice",
      actions: ["accept", "research", "edit", "withdraw"],
      workerId: null,
      maxPriceTinybars: "20000000",
      maxPrice: "0.2 HBAR",
    });
    expect(task.candidates[0]).toMatchObject({
      workerId: "kavach-scribe",
      price: "0.1 HBAR",
      recommended: true,
    });

    const accepted = await m.action.POST(
      json(`http://localhost/api/tasks/${task.id}/accept`, {}, token),
      actionCtx(task.id, "accept"),
    );
    expect(accepted.status).toBe(202);
    expect((await accepted.json()).task).toMatchObject({
      status: "queued",
      workerId: "kavach-scribe",
      actions: ["withdraw"],
    });

    await m.settle();
    const done = await (
      await m.task.GET(
        get(`http://localhost/api/tasks/${task.id}`, token),
        ctx(task.id),
      )
    ).json();
    expect(done.task.status).toBe("completed");
    expect(done.task.output).toContain(
      "Summary: Summarise: Agents pay agents.",
    );
    expect(done.task.events.map((e: { type: string }) => e.type)).toContain(
      "worker.called",
    );

    const list = await (
      await m.tasks.GET(get("http://localhost/api/tasks", token))
    ).json();
    expect(list.tasks.map((t: { id: string }) => t.id)).toContain(task.id);
  });

  it("with autoAccept, runs at once (202)", async () => {
    const m = await load(DEMO);
    const token = await signUp(m);
    const res = await m.tasks.POST(
      json(
        "http://localhost/api/tasks",
        {
          prompt: "Summarise: quick.",
          skill: "summarize",
          maxPriceTinybars: "20000000",
          autoAccept: true,
        },
        token,
      ),
    );
    expect(res.status).toBe(202);
    await m.settle();
  });

  it("edits, searches again and withdraws over HTTP", async () => {
    const m = await load(DEMO);
    const token = await signUp(m);
    const { task } = await (
      await m.tasks.POST(
        json(
          "http://localhost/api/tasks",
          {
            prompt: "Translate this.",
            skill: "translate",
            maxPriceTinybars: "20000000",
          },
          token,
        ),
      )
    ).json();
    expect(task.candidates).toEqual([]);

    const edited = await m.task.PATCH(
      new Request(`http://localhost/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ skill: "summarize", prompt: "Summarise this." }),
      }),
      ctx(task.id),
    );
    expect(edited.status).toBe(200);
    const e = (await edited.json()).task;
    expect(e).toMatchObject({ skill: "summarize", prompt: "Summarise this." });
    expect(e.candidates[0].workerId).toBe("kavach-scribe");

    const researched = await m.action.POST(
      json(
        `http://localhost/api/tasks/${task.id}/research`,
        { exclude: ["kavach-scribe"] },
        token,
      ),
      actionCtx(task.id, "research"),
    );
    expect((await researched.json()).task).toMatchObject({
      candidates: [],
      excluded: ["kavach-scribe"],
    });

    const withdrawn = await m.action.POST(
      json(`http://localhost/api/tasks/${task.id}/withdraw`, {}, token),
      actionCtx(task.id, "withdraw"),
    );
    expect((await withdrawn.json()).task).toMatchObject({
      status: "withdrawn",
      actions: [],
    });

    const again = await m.action.POST(
      json(`http://localhost/api/tasks/${task.id}/accept`, {}, token),
      actionCtx(task.id, "accept"),
    );
    expect(again.status).toBe(409);
    const unknown = await m.action.POST(
      json(`http://localhost/api/tasks/${task.id}/pause`, {}, token),
      actionCtx(task.id, "pause"),
    );
    expect(unknown.status).toBe(404);
    const noAuth = await m.action.POST(
      json(`http://localhost/api/tasks/${task.id}/withdraw`, {}),
      actionCtx(task.id, "withdraw"),
    );
    expect(noAuth.status).toBe(401);
    const noAuthEdit = await m.task.PATCH(
      json(`http://localhost/api/tasks/${task.id}`, {}),
      ctx(task.id),
    );
    expect(noAuthEdit.status).toBe(401);
  });

  it("hides one account's tasks from another", async () => {
    const m = await load(DEMO);
    const alice = await signUp(m, "alice");
    const bob = await signUp(m, "bob");
    const { task } = await (
      await m.tasks.POST(
        json(
          "http://localhost/api/tasks",
          {
            prompt: "Summarise: secret plans.",
            skill: "summarize",
            maxPriceTinybars: "20000000",
          },
          alice,
        ),
      )
    ).json();
    await m.settle();
    expect(
      (
        await m.task.GET(
          get(`http://localhost/api/tasks/${task.id}`, bob),
          ctx(task.id),
        )
      ).status,
    ).toBe(404);
    const bobs = await (
      await m.tasks.GET(get("http://localhost/api/tasks", bob))
    ).json();
    expect(bobs.tasks).toEqual([]);
  });

  it("passes on why a task cannot be proposed", async () => {
    const m = await load(DEMO);
    const token = await signUp(m);
    const res = await m.tasks.POST(
      json(
        "http://localhost/api/tasks",
        { prompt: "x", maxPriceTinybars: "1" },
        token,
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/agentId or skill/);
  });
});

describe("GET /.well-known/agent-card.json", () => {
  it("describes Kavach402, how to authenticate, and the skills workers offer", async () => {
    const m = await load(DEMO);
    const res = await m.card.GET();
    expect(res.status).toBe(200);
    const card = await res.json();
    for (const field of [
      "name",
      "description",
      "supportedInterfaces",
      "version",
      "capabilities",
      "defaultInputModes",
      "defaultOutputModes",
      "skills",
    ])
      expect(card[field]).toBeDefined();
    expect(card.supportedInterfaces[0].url).toBe(
      "http://localhost:3000/api/tasks",
    );
    expect(
      card.securitySchemes.accountToken.httpAuthSecurityScheme.scheme,
    ).toBe("Bearer");
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual([
      "extract-links",
      "summarize",
    ]);
    expect(card.skills[1]).toMatchObject({
      tags: ["summarize"],
      description: expect.stringContaining("kavach-scribe"),
    });
  });
});
