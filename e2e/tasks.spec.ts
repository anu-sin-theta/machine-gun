import { expect, test } from "@playwright/test";

/**
 * The agent-to-agent flow over HTTP, against the production build in demo
 * mode: an outside agent finds Kavach402, gets an account, finds a worker,
 * proposes a task and polls until the answer is there. The check, payment and
 * worker call run after the 202 response, inside Next.
 */
test.describe("the task API", () => {
  test("an outside agent discovers, signs up, proposes a task and gets the answer", async ({
    request,
    page,
  }) => {
    const card = await (
      await request.get("/.well-known/agent-card.json")
    ).json();
    expect(card.name).toBe("Kavach402");
    expect(card.skills.map((s: { id: string }) => s.id)).toContain("summarize");

    const workers = await (
      await request.get("/api/agents?role=worker&skill=summarize")
    ).json();
    expect(workers.agents[0]).toMatchObject({
      id: "kavach-scribe",
      price: "0.1 HBAR",
    });

    const signUp = await request.post("/api/accounts", {
      data: { name: "e2e agent" },
    });
    expect(signUp.status()).toBe(201);
    const { token } = await signUp.json();
    const auth = { authorization: `Bearer ${token}` };

    const proposed = await request.post("/api/tasks", {
      headers: auth,
      data: {
        prompt:
          "Summarise: Kavach402 lets agents hire agents. Every payment is checked first.",
        skill: "summarize",
        maxPriceTinybars: "20000000",
      },
    });
    expect(proposed.status()).toBe(202);
    const { task } = await proposed.json();

    // Poll for progress until the task leaves the running states.
    const poll = async () =>
      (
        await (
          await request.get(`/api/tasks/${task.id}`, { headers: auth })
        ).json()
      ).task;
    let current = await poll();
    await expect
      .poll(
        async () => {
          current = await poll();
          return current.status;
        },
        { timeout: 15_000 },
      )
      .toMatch(/^(completed|awaiting-approval|blocked|failed)$/);

    if (current.status === "awaiting-approval") {
      // The buyer's human approves on (simulated) World ID.
      await page.goto(current.approvalUrl);
      await page
        .getByRole("button", { name: /Approve with Orb/ })
        .first()
        .click();
      await expect
        .poll(async () => (await poll()).status, { timeout: 15_000 })
        .toBe("completed");
      current = await poll();
    }

    expect(current.status).toBe("completed");
    expect(current.output).toContain(
      "Summary: Summarise: Kavach402 lets agents hire agents.",
    );
    expect(current.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining([
        "worker.matched",
        "check.started",
        "worker.called",
        "task.completed",
      ]),
    );

    // Another agent cannot read it.
    const other = await (
      await request.post("/api/accounts", { data: { name: "other" } })
    ).json();
    const peek = await request.get(`/api/tasks/${task.id}`, {
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(peek.status()).toBe(404);
  });
});
