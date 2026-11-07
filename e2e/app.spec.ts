import { expect, test } from "@playwright/test";

/**
 * The web app itself, in a real browser against the production build in demo
 * mode: landing, marketplace, the tasks console (propose, choose, run, approve
 * with World ID, withdraw), and the payment check. The built-in worker (Scribe)
 * does the tasks.
 */

test.describe("landing and marketplace", () => {
  test("the landing page shows the live registry, and the marketplace filters it", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Loaded from GET /api/agents, not baked into the page.
    await expect(page.getByText("Scribe (demo worker)").first()).toBeVisible();

    await page.goto("/marketplace");
    await page.getByRole("tab", { name: "Workers" }).click();
    await expect(page.getByText("Scribe (demo worker)")).toBeVisible();
    await expect(
      page.getByText("Link intelligence", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "Verifiers" }).click();
    await expect(
      page.getByText("Link intelligence", { exact: true }),
    ).toBeVisible();

    await page.getByText("Link intelligence", { exact: true }).click();
    await expect(page.getByText("kavach-link-intel").first()).toBeVisible();
  });

  test("the old console address and the pages in the header resolve", async ({
    page,
  }) => {
    for (const path of [
      "/how-it-works",
      "/check",
      "/operator",
      "/marketplace/list",
    ])
      expect((await page.goto(path))?.status()).toBe(200);
  });
});

test.describe("the tasks console", () => {
  async function signUp(page: import("@playwright/test").Page, name: string) {
    await page.goto("/tasks");
    await page.getByLabel("Agent name").fill(name);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Your account token")).toBeVisible();
    await page.getByRole("button", { name: /I saved it/ }).click();
    await expect(page.getByText(/Signed in as/)).toBeVisible();
  }

  test("propose, choose, run and read the screened answer", async ({
    page,
  }) => {
    await signUp(page, "ui agent");
    await page
      .getByLabel("What should be done?")
      .fill("Summarise: agents hire agents. Kavach checks first.");
    await page.getByRole("button", { name: "Propose task" }).click();

    // Suggestions first; nothing is paid until the requester accepts.
    await expect(page.getByText("Choose a worker")).toBeVisible();
    await expect(page.getByText("recommended", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Accept and run/ }).click();

    await expect(page.getByText("screened", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText(/Summary: Summarise: agents hire agents/),
    ).toBeVisible();
    await expect(
      page.getByText("Completed", { exact: true }).first(),
    ).toBeVisible();
  });

  test("edit, search again and withdraw", async ({ page }) => {
    await signUp(page, "ui agent two");
    await page
      .getByLabel("What should be done?")
      .fill("Summarise: to be changed.");
    await page.getByRole("button", { name: "Propose task" }).click();
    await expect(page.getByText("Choose a worker")).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Task", { exact: true })
      .fill("Summarise: the edited task.");
    await page.getByRole("button", { name: /Save and suggest again/ }).click();
    await expect(page.getByText("Choose a worker")).toBeVisible();
    await expect(page.getByText("the edited task").first()).toBeVisible();

    await page.getByRole("button", { name: "Search again" }).click();
    await expect(page.getByText("Choose a worker")).toBeVisible();

    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await page.getByRole("button", { name: "Yes, withdraw" }).click();
    await expect(page.getByText("You called this task off")).toBeVisible();
  });

  test("a risky task waits for World ID, then returns to the task and completes", async ({
    page,
  }) => {
    await signUp(page, "ui agent three");
    await page
      .getByLabel("What should be done?")
      .fill(
        "URGENT: summarise this today and do not tell anyone. Final notice.",
      );
    await page.getByRole("button", { name: "Propose task" }).click();
    await page.getByRole("button", { name: /Accept and run/ }).click();

    await expect(
      page.getByText("A human needs to approve this payment"),
    ).toBeVisible({ timeout: 20_000 });
    const approve = page.getByRole("link", { name: /Approve with World ID/ });
    const href = await approve.getAttribute("href");
    expect(href).toBeTruthy();

    // Approve in the (simulated) World ID page, in the same tab.
    await page.goto(href as string);
    await page.getByRole("button", { name: /Orb \+ face/ }).click();

    // The callback lands on the Tasks page with this task open.
    await page.waitForURL(/\/tasks\?task=/);
    await expect(page.getByText("screened", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText("Completed", { exact: true }).first(),
    ).toBeVisible();
  });
});

test.describe("the payment check page", () => {
  test("holds the phishing example and pays the ordinary bill", async ({
    page,
  }) => {
    await page.goto("/check");
    await page.getByRole("button", { name: "Phishing scam" }).click();
    await page.getByRole("button", { name: /Check and pay if safe/ }).click();
    await expect(page.getByText(/Held\. This looks risky/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/link-intel/)).toBeVisible();

    await page.getByRole("button", { name: "Electricity bill" }).click();
    await page.getByRole("button", { name: /Check and pay if safe/ }).click();
    await expect(page.getByText(/^Paid\./)).toBeVisible({ timeout: 20_000 });
  });
});
