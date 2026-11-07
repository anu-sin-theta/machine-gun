import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepositories, type Repositories } from "@/adapters/db";
import type { MirrorNode } from "@/adapters/hedera";
import { type AppConfig, loadConfig } from "@/config/env";
import {
  checkReadiness,
  formatReadiness,
  type ReadinessItem,
  summarize,
} from "@/ops/readiness";

// The route tests reload modules per test, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 30_000 });

const HEDERA = {
  HEDERA_AGENT_ACCOUNT_ID: "0.0.1001",
  HEDERA_AGENT_PRIVATE_KEY: "key",
  HEDERA_PAYEE_ACCOUNT_ID: "0.0.1002",
  HEDERA_HCS_AUDIT_TOPIC_ID: "0.0.2001",
  HEDERA_HCS_REPUTATION_TOPIC_ID: "0.0.2002",
};
const ZG = { ZG_API_KEY: "sk-test", ZG_MODEL_TEXT: "glm-5.3" };
const WORLD = { WORLD_CLIENT_ID: "app_x", WORLD_CLIENT_SECRET: "secret" };
const LIVE = {
  ...HEDERA,
  ...ZG,
  ...WORLD,
  DATABASE_URL: "postgres://x",
  API_TOKEN: "0123456789abcdef",
};
const SERVER = { production: false, serverless: false };

const cfg = (env: Record<string, string> = {}): AppConfig => loadConfig(env);
const by = (items: ReadinessItem[], id: string) =>
  items.find((i) => i.id === id);

function mirror(
  balances: Record<string, bigint | null>,
  readable = true,
): MirrorNode {
  return {
    async getHbarBalance(id) {
      return balances[id] ?? null;
    },
    async listTopicMessages() {
      if (!readable) throw new Error("mirror node returned 500");
      return [];
    },
  };
}

interface Routes {
  x402?: { status?: number; body?: unknown };
  zerog?: { status?: number; body?: unknown };
  world?: { status?: number; body?: unknown };
}

function fakeFetch(routes: Routes = {}): typeof fetch {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/supported"))
      return ok(
        routes.x402?.body ?? {
          kinds: [{ scheme: "exact", network: "hedera:testnet" }],
        },
        routes.x402?.status,
      );
    if (url.endsWith("/models"))
      return ok(
        routes.zerog?.body ?? { data: [{ id: "glm-5.3" }] },
        routes.zerog?.status,
      );
    if (url.endsWith("/.well-known/openid-configuration"))
      return ok(
        routes.world?.body ?? {
          acr_values_supported: [
            "https://world.org/oidc/acr/orb",
            "https://world.org/oidc/acr/orb-face",
          ],
        },
        routes.world?.status,
      );
    return ok({}, 404);
  }) as typeof fetch;
}

const GOOD_BALANCES = { "0.0.1001": 1_000_000_000n, "0.0.1002": 5n };

describe("demo and simulated modes", () => {
  it("is ready, flags the stand-ins, and needs no services", async () => {
    const items = await checkReadiness(
      cfg({ AGENT_MODE: "demo", WORLD_MODE: "simulated" }),
      { runtime: SERVER },
    );
    expect(by(items, "modes")?.status).toBe("warn");
    expect(by(items, "modes")?.detail).toContain("stand-ins");
    expect(by(items, "hedera")?.status).toBe("missing");
    expect(by(items, "world")).toMatchObject({
      status: "ok",
      detail: "simulated issuer",
    });
    expect(by(items, "api-token")?.status).toBe("ok");
    expect(summarize(items)).toMatchObject({ ready: true, fail: 0 });
    expect(items.some((i) => i.id === "zerog" || i.id === "x402")).toBe(false);
  });

  it("fails a serverless deploy that has no database, because memory is per instance", async () => {
    const config = cfg({ AGENT_MODE: "demo", WORLD_MODE: "simulated" });
    const local = await checkReadiness(config, { runtime: SERVER });
    expect(by(local, "database")?.status).toBe("warn");
    const cloud = await checkReadiness(config, {
      runtime: { production: true, serverless: true },
    });
    expect(by(cloud, "database")?.status).toBe("fail");
    expect(summarize(cloud).ready).toBe(false);
  });

  it("warns about a simulated World in production and about a missing shared simulator key", async () => {
    const config = cfg({
      AGENT_MODE: "demo",
      WORLD_MODE: "simulated",
      DATABASE_URL: "postgres://x",
    });
    const items = await checkReadiness(config, {
      runtime: { production: true, serverless: true },
    });
    expect(by(items, "world")).toMatchObject({ status: "warn" });
    expect(by(items, "world")?.detail).toContain("checks no one");
    expect(by(items, "world-sim-key")?.status).toBe("warn");

    const keyed = cfg({
      AGENT_MODE: "demo",
      WORLD_MODE: "simulated",
      DATABASE_URL: "postgres://x",
      WORLD_SIM_KEY: "k".repeat(120),
    });
    const withKey = await checkReadiness(keyed, {
      runtime: { production: true, serverless: true },
    });
    expect(by(withKey, "world-sim-key")).toBeUndefined();
  });
});

describe("live mode, nothing configured", () => {
  it("fails the services it cannot work without and is not ready", async () => {
    const items = await checkReadiness(cfg(), {
      runtime: SERVER,
      fetch: fakeFetch(),
    });
    expect(by(items, "hedera")?.status).toBe("fail");
    expect(by(items, "zerog")?.status).toBe("fail");
    expect(by(items, "world")?.status).toBe("fail");
    expect(by(items, "hcs-audit")?.status).toBe("warn");
    expect(by(items, "api-token")?.status).toBe("warn");
    expect(summarize(items).ready).toBe(false);
  });
});

describe("live mode, fully configured", () => {
  const run = (
    routes: Routes = {},
    balances: Record<string, bigint | null> = GOOD_BALANCES,
    extra: Record<string, string> = {},
    readable = true,
  ) =>
    checkReadiness(cfg({ ...LIVE, ...extra }), {
      runtime: SERVER,
      fetch: fakeFetch(routes),
      mirror: mirror(balances, readable),
      repos: createMemoryRepositories(),
    });

  it("is ready when every service answers", async () => {
    const items = await run();
    expect(items.filter((i) => i.status !== "ok")).toEqual(
      [expect.objectContaining({ id: "modes", status: "ok" })].slice(1),
    );
    expect(summarize(items)).toEqual({ ready: true, fail: 0, warn: 0 });
    expect(by(items, "hedera-agent")?.detail).toContain("10 HBAR");
    expect(by(items, "zerog")?.detail).toContain("glm-5.3");
  });

  it("warns on a low agent balance and fails on a missing account", async () => {
    expect(
      by(
        await run({}, { ...GOOD_BALANCES, "0.0.1001": 100_000_000n }),
        "hedera-agent",
      ),
    ).toMatchObject({
      status: "warn",
      detail: expect.stringContaining("top up"),
    });
    expect(by(await run({}, { "0.0.1002": 1n }), "hedera-agent")?.status).toBe(
      "fail",
    );
    expect(
      by(await run({}, { "0.0.1001": 1_000_000_000n }), "hedera-payee")?.status,
    ).toBe("fail");
  });

  it("fails a topic the mirror node cannot read", async () => {
    const items = await run({}, GOOD_BALANCES, {}, false);
    expect(by(items, "hcs-audit")).toMatchObject({
      status: "fail",
      detail: "mirror node returned 500",
    });
  });

  it("checks the x402 facilitator lists exact on our network", async () => {
    expect(
      by(
        await run({
          x402: { body: { kinds: [{ scheme: "exact", network: "eip155:1" }] } },
        }),
        "x402",
      )?.status,
    ).toBe("fail");
    expect(by(await run({ x402: { status: 500 } }), "x402")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("500"),
    });
  });

  it("checks the 0G key and model", async () => {
    expect(by(await run({ zerog: { status: 401 } }), "zerog")).toMatchObject({
      status: "fail",
      detail: "API key rejected",
    });
    expect(by(await run({ zerog: { status: 503 } }), "zerog")?.status).toBe(
      "fail",
    );
    expect(
      by(await run({ zerog: { body: { data: [{ id: "other" }] } } }), "zerog")
        ?.status,
    ).toBe("warn");
    const unlisted = by(await run({ zerog: { body: {} } }), "zerog");
    expect(unlisted?.status).toBe("ok");
    expect(unlisted?.detail).toContain("unverified");
  });

  it("checks World's discovery document against the acr values we will ask for", async () => {
    expect(by(await run({ world: { status: 500 } }), "world")?.status).toBe(
      "fail",
    );
    const lacking = await run({
      world: {
        body: { acr_values_supported: ["https://world.org/oidc/acr/orb"] },
      },
    });
    expect(by(lacking, "world")).toMatchObject({
      status: "warn",
      detail: expect.stringContaining("orb-face"),
    });
    expect(by(await run({ world: { body: {} } }), "world")?.status).toBe(
      "warn",
    );
    expect(by(await run(), "world")?.detail).toContain("must be registered");
  });

  it("reports an exception from a service as a failure with its message", async () => {
    const throwing = (() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const items = await checkReadiness(cfg(LIVE), {
      runtime: SERVER,
      fetch: throwing,
      mirror: mirror(GOOD_BALANCES),
    });
    expect(by(items, "x402")).toMatchObject({
      status: "fail",
      detail: "network down",
    });
  });

  it("proves the database is reachable with the tables present, or says it is not", async () => {
    expect(by(await run(), "database")?.detail).toContain("tables present");
    const broken = {
      ...createMemoryRepositories(),
      checks: {
        async get() {
          throw new Error('relation "checks" does not exist');
        },
      },
    } as unknown as Repositories;
    const items = await checkReadiness(cfg(LIVE), {
      runtime: SERVER,
      fetch: fakeFetch(),
      mirror: mirror(GOOD_BALANCES),
      repos: broken,
    });
    expect(by(items, "database")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("does not exist"),
    });
  });

  it("says when it did not probe", async () => {
    const items = await checkReadiness(cfg(LIVE), {
      runtime: SERVER,
      fetch: fakeFetch(),
    });
    expect(by(items, "database")?.detail).toContain("not probed");
    expect(by(items, "hedera")?.detail).toContain("not probed");
    expect(by(items, "hcs-audit")?.detail).toContain("not probed");
  });

  it("warns that live JSON routes are open when no API token is set", async () => {
    expect(
      by(await run({}, GOOD_BALANCES, { API_TOKEN: "" }), "api-token")?.status,
    ).toBe("warn");
  });
});

describe("summarize and formatReadiness", () => {
  const items: ReadinessItem[] = [
    { id: "a", label: "A", status: "ok", detail: "fine" },
    { id: "b", label: "B", status: "warn", detail: "hmm" },
    { id: "c", label: "C", status: "missing", detail: "n/a" },
    { id: "d", label: "D", status: "fail", detail: "broken" },
  ];
  it("counts failures and warnings and is ready only without failures", () => {
    expect(summarize(items)).toEqual({ ready: false, fail: 1, warn: 1 });
    expect(summarize(items.slice(0, 3)).ready).toBe(true);
  });
  it("prints one aligned line per item", () => {
    expect(formatReadiness(items).split("\n")).toEqual([
      "OK      A: fine",
      "WARN    B: hmm",
      "MISSING C: n/a",
      "FAIL    D: broken",
    ]);
  });
});

describe("/api/status", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function status(
    env: Record<string, string>,
    headers: Record<string, string> = {},
  ) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { GET } = await import("@/app/api/status/route");
    return GET(new Request("http://localhost:3000/api/status", { headers }));
  }

  it("reports the checklist outside production", async () => {
    const res = await status({ AGENT_MODE: "demo", WORLD_MODE: "simulated" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ready: true, fail: 0 });
    expect(body.items.length).toBeGreaterThan(3);
  });

  it("answers 503 when something configured is broken", async () => {
    const res = await status({});
    expect(res.status).toBe(503);
    expect((await res.json()).ready).toBe(false);
  });

  it("does not exist in production without an API token", async () => {
    const res = await status({
      NODE_ENV: "production",
      AGENT_MODE: "demo",
      WORLD_MODE: "simulated",
    });
    expect(res.status).toBe(404);
  });

  it("requires the bearer token whenever one is set", async () => {
    const env = {
      API_TOKEN: "0123456789abcdef",
      AGENT_MODE: "demo",
      WORLD_MODE: "simulated",
      NODE_ENV: "production",
    };
    expect((await status(env)).status).toBe(401);
    expect(
      (await status(env, { authorization: "Bearer wrong-token-value" })).status,
    ).toBe(401);
    expect(
      (await status(env, { authorization: "Bearer 0123456789abcdef" })).status,
    ).toBe(200);
  });
});
