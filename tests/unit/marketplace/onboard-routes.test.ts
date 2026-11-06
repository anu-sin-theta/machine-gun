import { encodePaymentRequiredHeader } from "@x402/core/http";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each test loads the route modules afresh, which is slow under coverage.
vi.setConfig({ testTimeout: 30_000 });

const TOKEN = "0123456789abcdef";
const PAY_TO = "0.0.7001";

/** An endpoint that proves control: an unpaid request gets a 402 naming PAY_TO. */
const fakeEndpoint = (async () =>
  new Response("{}", {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
        x402Version: 2,
        resource: { url: "https://verifier.acme.example/api/check" },
        accepts: [
          {
            scheme: "exact",
            network: "hedera:testnet",
            asset: "0.0.0",
            amount: "3000000",
            payTo: PAY_TO,
            maxTimeoutSeconds: 300,
            extra: {},
          },
        ],
      }),
    },
  })) as typeof fetch;

/** Fresh modules per test: the config is read once per process. */
async function load(token: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("API_TOKEN", token);
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.doMock("@/marketplace/network", async (original) => ({
    ...(await original<typeof import("@/marketplace/network")>()),
    createSafeFetch: () => fakeEndpoint,
  }));
  return {
    agents: await import("@/app/api/agents/route"),
    status: await import("@/app/api/agents/[id]/status/route"),
    repos: (await import("@/adapters/db")).getRepositories(),
  };
}

afterEach(() => {
  vi.doUnmock("@/marketplace/network");
  vi.unstubAllEnvs();
});

const registration = (id: string) => ({
  id,
  role: "verifier",
  name: "Acme",
  description: "Checks links.",
  endpoint: "https://verifier.acme.example/api/check",
  input: "link",
  payTo: PAY_TO,
  priceTinybars: "3000000",
  evidenceSource: id,
});

const post = (url: string, body: unknown, token?: string) =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/agents", () => {
  it("accepts a registration as suspended and hides it from buyers", async () => {
    const { agents, repos } = await load(TOKEN);
    const res = await agents.POST(
      post("http://localhost/api/agents", registration("route-one")),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).agent).toMatchObject({
      id: "route-one",
      status: "suspended",
      priceTinybars: "3000000",
      builtIn: false,
    });
    expect(
      (await repos.agents.list({ role: "verifier", status: "active" })).map(
        (a) => a.id,
      ),
    ).not.toContain("route-one");
  });

  it("answers 400 to a body that is not a registration", async () => {
    const { agents } = await load(TOKEN);
    for (const body of ["not json", "{}", "null", { ...registration("x") }]) {
      const res = await agents.POST(post("http://localhost/api/agents", body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toEqual(expect.any(String));
    }
  });

  it("answers 409 for a taken id", async () => {
    const { agents } = await load(TOKEN);
    const send = () =>
      agents.POST(
        post("http://localhost/api/agents", registration("route-dupe")),
      );
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(409);
  });
});

describe("POST /api/agents/[id]/status", () => {
  const url = "http://localhost/api/agents/x/status";

  it("refuses everyone when no API_TOKEN is configured", async () => {
    const { status } = await load("");
    const res = await status.POST(
      post(url, { status: "active" }, TOKEN),
      ctx("kavach-link-intel"),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a missing or wrong token", async () => {
    const { status } = await load(TOKEN);
    for (const t of [undefined, "wrong-token-value"]) {
      const res = await status.POST(
        post(url, { status: "suspended" }, t),
        ctx("kavach-link-intel"),
      );
      expect(res.status).toBe(401);
    }
  });

  it("answers 400 to a bad status and 404 to an unknown agent", async () => {
    const { status } = await load(TOKEN);
    expect(
      (await status.POST(post(url, { status: "pending" }, TOKEN), ctx("a")))
        .status,
    ).toBe(400);
    expect((await status.POST(post(url, "{{", TOKEN), ctx("a"))).status).toBe(
      400,
    );
    expect(
      (
        await status.POST(
          post(url, { status: "suspended" }, TOKEN),
          ctx("nobody-here"),
        )
      ).status,
    ).toBe(404);
  });

  it("activates a registered agent so the directory selects it, then suspends it", async () => {
    const { agents, status, repos } = await load(TOKEN);
    await agents.POST(
      post("http://localhost/api/agents", registration("route-live")),
    );

    const on = await status.POST(
      post(url, { status: "active" }, TOKEN),
      ctx("route-live"),
    );
    expect(on.status).toBe(200);
    expect((await on.json()).agent.status).toBe("active");
    expect((await repos.agents.get("route-live"))?.status).toBe("active");

    const off = await status.POST(
      post(url, { status: "suspended" }, TOKEN),
      ctx("route-live"),
    );
    expect((await off.json()).agent.status).toBe("suspended");
  });
});
