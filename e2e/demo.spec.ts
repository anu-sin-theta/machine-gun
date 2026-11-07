import { expect, type Page, test } from "@playwright/test";

const result = (page: Page) => page.getByTestId("result");

/** Pick an example, submit, and wait for the result card. */
async function run(page: Page, example: string) {
  await page.goto("/demo");
  await page.getByTestId(`example-${example}`).click();
  await page.getByTestId("submit").click();
  await expect(result(page)).toBeVisible();
}

/** On the simulated World consent page, press one button and land back in the app. */
async function chooseOnWorld(page: Page, button: RegExp) {
  await page.getByTestId("approve-link").click();
  await expect(page.getByText("SIMULATION.")).toBeVisible();
  await page.getByRole("button", { name: button }).click();
  await page.waitForURL(/\/demo\?check=/);
  await expect(result(page)).toBeVisible();
}

test.describe("the page", () => {
  test("explains itself and says that it is running on stand-ins", async ({
    page,
  }) => {
    await page.goto("/demo");
    await expect(page).toHaveTitle(/Classic demo/);
    await expect(
      page.getByRole("heading", { name: "Kavach402" }),
    ).toBeVisible();
    const banner = page.getByTestId("mode-banner");
    await expect(banner).toContainText("Demo mode");
    await expect(banner).toContainText("World ID is simulated");
    await expect(page.getByLabel("Payment request")).toBeVisible();
    await expect(page.getByLabel("Merchant")).toBeVisible();
  });

  test("shows a clear message for a check it does not know", async ({
    page,
  }) => {
    await page.goto("/demo?check=chk_does_not_exist");
    await expect(page.getByTestId("unknown-check")).toContainText("not found");
  });

  test("serves the simulated World issuer", async ({ request }) => {
    const res = await request.get(
      "/api/sim-world/.well-known/openid-configuration",
    );
    expect(res.status()).toBe(200);
    expect((await res.json()).issuer).toContain("/api/sim-world");
  });
});

test.describe("paying", () => {
  test("pays an ordinary bill on its own and records it", async ({ page }) => {
    await run(page, "electricity");
    await expect(result(page)).toHaveAttribute("data-status", "paid");
    await expect(page.getByTestId("decision-headline")).toHaveText(
      "Paid on its own",
    );
    await expect(page.getByTestId("tx")).toContainText("0.0.1001@");
    await expect(result(page)).toContainText("demo, not on Hedera");
    await expect(result(page)).toContainText("1.5 HBAR");
    const audit = page.getByTestId("audit");
    await expect(audit).toContainText("Request received");
    await expect(audit).toContainText("Payment settled");
  });

  test("holds a payment over the limit until a verified human approves", async ({
    page,
  }) => {
    await run(page, "rent");
    await expect(result(page)).toHaveAttribute(
      "data-status",
      "awaiting-approval",
    );
    await expect(page.getByTestId("decision-headline")).toHaveText(
      "Needs your approval",
    );
    await expect(page.getByTestId("why")).toContainText(
      "more than the agent may pay on its own",
    );

    await chooseOnWorld(page, /Approve with Orb \(orb\)/);
    await expect(result(page)).toHaveAttribute("data-status", "paid");
    await expect(page.getByTestId("decision-headline")).toHaveText(
      "Paid after your approval",
    );
    await expect(result(page)).toContainText("12 HBAR");
    await expect(page.getByTestId("audit")).toContainText("Approval accepted");
  });

  test("refuses to pay a payment that is simply too large", async ({
    page,
  }) => {
    await run(page, "tuition");
    await expect(result(page)).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("decision-headline")).toHaveText("Blocked");
    await expect(page.getByTestId("approve-link")).toHaveCount(0);
    await expect(page.getByTestId("why")).toContainText(
      "largest payment the agent will ever make",
    );
  });
});

test.describe("a scam", () => {
  test("is not paid by default and shows why", async ({ page }) => {
    await run(page, "scam");
    await expect(result(page)).toHaveAttribute(
      "data-status",
      "awaiting-approval",
    );
    await expect(page.getByTestId("decision-headline")).toHaveText(
      "Blocked unless you override",
    );
    await expect(result(page)).toContainText("high risk");
    await expect(page.getByTestId("why")).toContainText("OTP");
    await expect(page.getByTestId("why")).toContainText("BRAND_IMPERSONATION");
  });

  test("is paid only with the strongest World ID, and a replayed approval cannot pay twice", async ({
    page,
    request,
  }) => {
    let callback = "";
    page.on("request", (r) => {
      if (r.url().includes("/api/worldid/callback")) callback = r.url();
    });

    await run(page, "scam");
    await chooseOnWorld(page, /orb-face/);
    await expect(result(page)).toHaveAttribute("data-status", "paid");
    await expect(page.getByTestId("audit")).toContainText("Payment settled");
    await expect(
      page.getByTestId("audit").getByText("Payment settled"),
    ).toHaveCount(1);

    expect(callback).not.toBe("");
    const replay = await request.get(callback, { maxRedirects: 0 });
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toEqual({ error: "not_pending" });

    await page.reload();
    await expect(
      page.getByTestId("audit").getByText("Payment settled"),
    ).toHaveCount(1);
  });

  test("is refused when the World ID login is weaker than the risk calls for", async ({
    page,
  }) => {
    await run(page, "scam");
    await chooseOnWorld(page, /Approve with Orb \(orb\)/);
    await expect(result(page)).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("decision-headline")).toHaveText("Not paid");
    await expect(page.getByTestId("reason")).toContainText("not strong enough");
    await expect(page.getByTestId("tx")).toHaveCount(0);
  });

  test("stays blocked when the person denies the approval", async ({
    page,
  }) => {
    await run(page, "scam");
    await chooseOnWorld(page, /^Deny/);
    await expect(result(page)).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("reason")).toContainText("declined");
    await expect(page.getByTestId("tx")).toHaveCount(0);
  });
});

test.describe("a request that names another account", () => {
  test("is stopped because the merchant would pay a different payee", async ({
    page,
  }) => {
    await run(page, "wrong-account");
    await expect(result(page)).toHaveAttribute(
      "data-status",
      "awaiting-approval",
    );
    await expect(page.getByTestId("decision-headline")).toHaveText(
      "Blocked unless you override",
    );
    await expect(page.getByTestId("why")).toContainText("0.0.9999");
    await expect(page.getByTestId("why")).toContainText("0.0.5001");
  });
});

test.describe("input handling", () => {
  test("keeps the chosen merchant after a check, so a second check pays the right one", async ({
    page,
  }) => {
    await run(page, "rent");
    await expect(result(page)).toContainText("12 HBAR");
    await expect(page.getByLabel("Merchant")).toHaveValue(/\/merchant\/rent$/);
    await expect(page.getByLabel("Payment request")).toHaveValue(
      /November rent is 12 HBAR/,
    );

    // Submit again without touching the form: it must still be the rent merchant.
    await page.getByTestId("submit").click();
    await expect(result(page)).toContainText("12 HBAR");
    await expect(result(page)).toContainText("/merchant/rent");
  });

  test("keeps what was typed and shows an error when the merchant is not allowed", async ({
    page,
  }) => {
    await page.goto("/demo");
    await page
      .getByLabel("Payment request")
      .fill("Please pay 1 HBAR to 0.0.5001");
    // The demo merchant list is fixed, so tamper with the select to simulate a hostile URL.
    await page.getByLabel("Merchant").evaluate((el) => {
      const select = el as HTMLSelectElement;
      const option = document.createElement("option");
      option.value = "http://169.254.169.254/latest/meta-data";
      option.text = "hostile";
      select.append(option);
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.getByTestId("submit").click();
    await expect(result(page)).toHaveAttribute("data-status", "failed");
    await expect(page.getByTestId("reason")).toContainText(
      "did not return a usable payment request",
    );
    await expect(page.getByLabel("Payment request")).toHaveValue(
      "Please pay 1 HBAR to 0.0.5001",
    );
  });
});

test.describe("the verifier network", () => {
  test("shows the registered verifiers with what they charge", async ({
    page,
  }) => {
    await page.goto("/demo");
    const network = page.getByTestId("verifier-network");
    await expect(network).toBeVisible();
    await expect(page.getByTestId("verifier")).toHaveCount(3);
    await expect(network).toContainText("Payee reputation");
    await expect(network).toContainText("Link intelligence");
    await expect(network).toContainText("Domain heuristics");
    await expect(network).toContainText("0.05 HBAR per call");
    await expect(network).toContainText("0.02 HBAR per call");
  });

  test("consults more than one verifier on a link and shows each by name", async ({
    page,
  }) => {
    await run(page, "scam");
    const why = page.getByTestId("why");
    await expect(why).toContainText("link-intel: BRAND_IMPERSONATION");
    await expect(why).toContainText("domain-heuristics: RISKY_TLD");
  });

  test("serves the registry over the API, with filters", async ({
    request,
  }) => {
    const all = await (await request.get("/api/agents")).json();
    expect(all.agents.map((a: { id: string }) => a.id).sort()).toEqual([
      "kavach-domain-heuristics",
      "kavach-link-intel",
      "kavach-reputation",
      "kavach-scribe",
    ]);
    const payee = await (await request.get("/api/agents?input=payee")).json();
    expect(payee.agents).toHaveLength(1);
    expect(payee.agents[0]).toMatchObject({
      price: "0.05 HBAR",
      priceTinybars: "5000000",
    });
    expect((await request.get("/api/agents?role=oracle")).status()).toBe(400);
  });
});
