/**
 * Drives the whole marketplace on your behalf against a running backend:
 * onboard the example agents, activate them as the operator, sign up a
 * requester, and run tasks through every decision (accept, choose, search
 * again, edit, withdraw). Prints what happened at each step.
 *
 * Needs: the backend in demo mode with API_TOKEN set, and the example agents
 * running (node examples/gemini-agents/server.mjs). See docs/TESTING.md.
 *
 *   API_TOKEN=... node scripts/walkthrough.mjs
 */

import { AGENTS, registration } from "../examples/gemini-agents/agents.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // Optional.
}

const BASE = process.env.KAVACH_URL ?? "http://localhost:3000";
const OPERATOR = process.env.API_TOKEN;

const c = {
  step: (s) => console.log(`\n\x1b[1m\x1b[36m== ${s}\x1b[0m`),
  ok: (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`),
  no: (s) => console.log(`  \x1b[31m✗\x1b[0m ${s}`),
  info: (s) => console.log(`    ${s}`),
};

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls a task until it stops moving (or needs a human). */
async function settle(token, id) {
  for (let i = 0; i < 60; i++) {
    const { json } = await call("GET", `/api/tasks/${id}`, { token });
    const t = json.task;
    if (!["queued", "vetting", "running"].includes(t.status)) return t;
    await sleep(1000);
  }
  throw new Error(`task ${id} did not settle`);
}

function showTask(t) {
  c.info(`status: ${t.status}   actions: [${t.actions.join(", ")}]`);
  if (t.status === "awaiting-choice" && t.candidates.length)
    c.info(
      `suggested: ${t.candidates
        .map(
          (k) =>
            `${k.workerId} (${k.price}${k.recommended ? ", recommended" : ""})`,
        )
        .join(" | ")}`,
    );
  if (t.approvalUrl) c.info(`approve here: ${t.approvalUrl}`);
  if (t.output)
    c.info(`answer:\n      ${t.output.split("\n").join("\n      ")}`);
  for (const w of t.warnings)
    c.info(
      `\x1b[33m⚠ risky link in answer: ${w.url} (${w.level}: ${w.signals.join(", ")})\x1b[0m`,
    );
}

async function main() {
  c.step("0. Backend");
  const health = await call("GET", "/api/health").catch(() => null);
  if (!health?.json?.ok) {
    c.no(`backend not reachable at ${BASE}`);
    process.exit(1);
  }
  c.ok(`backend up, Rust/WASM core ${health.json.wasmVersion}`);
  if (!OPERATOR) {
    c.no(
      "API_TOKEN is not set: the operator steps (activation) will be refused",
    );
  }

  c.step("1. Onboard the example agents (POST /api/agents)");
  for (const agent of AGENTS) {
    const r = await call("POST", "/api/agents", { body: registration(agent) });
    if (r.status === 201)
      c.ok(`${agent.id}: registered, status ${r.json.agent.status}`);
    else if (r.status === 409) c.ok(`${agent.id}: already registered`);
    else if (agent.expectRefused)
      c.ok(`${agent.id}: refused as expected (${r.status}): ${r.json?.error}`);
    else c.no(`${agent.id}: refused (${r.status}) ${r.json?.error}`);
  }

  c.step("2. Operator activates them (POST /api/agents/<id>/status)");
  for (const agent of AGENTS.filter((a) => !a.expectRefused)) {
    const r = await call("POST", `/api/agents/${agent.id}/status`, {
      body: { status: "active" },
      token: OPERATOR,
    });
    if (r.status === 200) c.ok(`${agent.id}: active`);
    else c.no(`${agent.id}: not activated (${r.status}) ${r.json?.error}`);
  }

  c.step(
    "3. Discovery: who will summarise? (GET /api/agents?role=worker&skill=summarize)",
  );
  const workers = await call("GET", "/api/agents?role=worker&skill=summarize");
  for (const a of workers.json.agents) c.info(`${a.id.padEnd(22)} ${a.price}`);

  c.step("4. Sign up a requester (POST /api/accounts)");
  const acct = await call("POST", "/api/accounts", {
    body: { name: "Walkthrough agent" },
  });
  if (acct.status !== 201) {
    c.no(`could not create an account (${acct.status}) ${acct.json?.error}`);
    process.exit(1);
  }
  const token = acct.json.token;
  c.ok(`account ${acct.json.account.id}, token ${token.slice(0, 10)}…`);

  c.step("5. Propose a summary task: Kavach402 suggests, nothing is paid");
  const article =
    "Summarise: Mumbai's suburban rail carries over seven million people a day. A new signalling system promises shorter gaps between trains. Commuter groups want more ladies' coaches and better station access.";
  let r = await call("POST", "/api/tasks", {
    token,
    body: { prompt: article, skill: "summarize", maxPriceTinybars: "20000000" },
  });
  const t1 = r.json.task;
  showTask(t1);

  c.step(
    "6. Choose Gemini Summarizer instead of the cheaper recommendation (accept)",
  );
  r = await call("POST", `/api/tasks/${t1.id}/accept`, {
    token,
    body: { workerId: "gemini-summarizer" },
  });
  c.ok(
    `accepted, status ${r.json.task.status}; Kavach402 now checks the payment`,
  );
  showTask(await settle(token, t1.id));

  c.step(
    "7. Accept the cheap recommendation on another task: answer screening flags its link",
  );
  r = await call("POST", "/api/tasks", {
    token,
    body: { prompt: article, skill: "summarize", maxPriceTinybars: "20000000" },
  });
  const t2 = r.json.task;
  await call("POST", `/api/tasks/${t2.id}/accept`, { token, body: {} });
  showTask(await settle(token, t2.id));

  c.step("8. Translation with autoAccept (unattended agent)");
  r = await call("POST", "/api/tasks", {
    token,
    body: {
      prompt: "Your electricity bill is due on Friday.",
      skill: "translate",
      maxPriceTinybars: "20000000",
      autoAccept: true,
    },
  });
  showTask(await settle(token, r.json.task.id));

  c.step("9. Code review: rule out a worker, edit the task, then withdraw");
  r = await call("POST", "/api/tasks", {
    token,
    body: {
      prompt: "Review: function add(a, b) { return a - b }",
      skill: "summarize",
      maxPriceTinybars: "20000000",
    },
  });
  const t4 = r.json.task;
  showTask(t4);
  r = await call("POST", `/api/tasks/${t4.id}/research`, {
    token,
    body: { exclude: ["bargain-summarizer"] },
  });
  c.ok("searched again without bargain-summarizer");
  showTask(r.json.task);
  r = await call("PATCH", `/api/tasks/${t4.id}`, {
    token,
    body: { skill: "code-review" },
  });
  c.ok("edited: skill -> code-review");
  showTask(r.json.task);
  r = await call("POST", `/api/tasks/${t4.id}/withdraw`, { token, body: {} });
  c.ok(`withdrawn, status ${r.json.task.status}; nothing was paid`);

  c.step("10. A risky task: the policy asks for a human");
  r = await call("POST", "/api/tasks", {
    token,
    body: {
      prompt:
        "URGENT: summarise this today and do not tell anyone. Final notice.",
      skill: "summarize",
      maxPriceTinybars: "20000000",
    },
  });
  await call("POST", `/api/tasks/${r.json.task.id}/accept`, {
    token,
    body: { workerId: "gemini-summarizer" },
  });
  const t5 = await settle(token, r.json.task.id);
  showTask(t5);
  if (t5.status === "awaiting-approval")
    c.info(
      "Open the link above, choose an Orb approval, and the task completes. (Or withdraw it.)",
    );

  c.step("11. Your tasks (GET /api/tasks)");
  const list = await call("GET", "/api/tasks", { token });
  for (const t of list.json.tasks)
    c.info(`${t.id}  ${t.status.padEnd(18)} ${t.workerId ?? "-"}`);

  console.log(
    `\nToken for the web console (http://localhost:3001/tasks → "Already have a token?"):\n  ${token}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
