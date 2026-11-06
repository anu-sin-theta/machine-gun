import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/adapters/db";
import {
  type ApprovalDeps,
  completeApproval,
  consumeApprovalOnce,
  createSimulator,
  createWorldOidc,
  pkceVerifier,
  startApproval,
} from "@/adapters/world";
import { loadConfig, SIM_CLIENT_ID, SIM_DEV_SECRET } from "@/config/env";
import { demoAction } from "../core/fixtures";

const ISSUER = "http://localhost:3000/api/sim-world";
const REDIRECT = "http://localhost:3000/api/worldid/callback";
const SECRET = "simulator-test-secret-0123456789";
const CLIENT = "sim_client";
const ORB = "https://world.org/oidc/acr/orb";
const ORB_FACE = "https://world.org/oidc/acr/orb-face";

function setup(opts: { now?: () => number; privateKeyBase64?: string } = {}) {
  const sim = createSimulator({
    issuer: ISSUER,
    clientId: CLIENT,
    secret: SECRET,
    redirectUri: REDIRECT,
    ...opts,
  });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    sim.handle(new Request(input, init))) as typeof fetch;
  const repos = createMemoryRepositories();
  let n = 0;
  const action = demoAction();
  const deps: ApprovalDeps = {
    repos,
    oidc: createWorldOidc({
      issuer: ISSUER,
      clientId: CLIENT,
      clientSecret: SECRET,
      redirectUri: REDIRECT,
      fetch: fetchImpl,
      allowInsecure: true,
    }),
    issuer: ISSUER,
    source: "simulated",
    acr: {
      fresh: null,
      human: [ORB, ORB_FACE] as never,
      strong: [ORB_FACE] as never,
    },
    ttlMs: 600_000,
    now: () => Date.now(),
    random: (bytes) =>
      `${String(++n).padStart(bytes, "0")}${"x".repeat(bytes)}`,
    getCurrentAction: async () => action,
  };
  return { sim, deps, repos, action, fetchImpl };
}

/** The browser: open the consent page, then press a button. Returns the redirect target. */
async function choose(
  sim: ReturnType<typeof setup>["sim"],
  authorizeUrl: string,
  choice: string,
): Promise<URL> {
  const page = await sim.handle(new Request(authorizeUrl));
  expect(page.status).toBe(200);
  const body = new URLSearchParams(new URL(authorizeUrl).searchParams);
  body.set("choice", choice);
  const res = await sim.handle(
    new Request(`${ISSUER}/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
  expect(res.status).toBe(303);
  return new URL(res.headers.get("location") ?? "");
}

describe("simulated World through the real OIDC path", () => {
  it("approves an orb-face login for the strong tier and the approval can be spent once", async () => {
    const s = setup();
    const { url, attemptId } = await startApproval(s.deps, {
      action: s.action,
      tier: "strong",
    });
    const callback = await choose(s.sim, url, "orb-face");
    expect(callback.searchParams.get("iss")).toBe(ISSUER);
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "approved",
      attemptId,
    });
    expect(await consumeApprovalOnce(s.deps, attemptId)).toBe(true);
    expect(await consumeApprovalOnce(s.deps, attemptId)).toBe(false);
  });

  it("accepts orb for the human tier but rejects it for the strong tier", async () => {
    const human = setup();
    const h = await startApproval(human.deps, {
      action: human.action,
      tier: "human",
    });
    expect(
      (
        await completeApproval(
          human.deps,
          await choose(human.sim, h.url, "orb"),
        )
      ).kind,
    ).toBe("approved");

    const strong = setup();
    const st = await startApproval(strong.deps, {
      action: strong.action,
      tier: "strong",
    });
    expect(
      await completeApproval(
        strong.deps,
        await choose(strong.sim, st.url, "orb"),
      ),
    ).toMatchObject({
      kind: "rejected",
      reason: "INSUFFICIENT_ASSURANCE",
    });
  });

  it("lets a demo show a rejection: a weaker login is not accepted", async () => {
    const s = setup();
    const { url } = await startApproval(s.deps, {
      action: s.action,
      tier: "human",
    });
    expect(
      await completeApproval(s.deps, await choose(s.sim, url, "selfie")),
    ).toMatchObject({
      kind: "rejected",
      reason: "INSUFFICIENT_ASSURANCE",
    });
  });

  it("returns access_denied when the user denies", async () => {
    const s = setup();
    const { url } = await startApproval(s.deps, {
      action: s.action,
      tier: "human",
    });
    const callback = await choose(s.sim, url, "deny");
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect((await completeApproval(s.deps, callback)).kind).toBe("denied");
  });

  it("rejects a login whose code has expired", async () => {
    let clock = Date.now();
    const s = setup({ now: () => clock });
    const { url } = await startApproval(s.deps, {
      action: s.action,
      tier: "human",
    });
    const callback = await choose(s.sim, url, "orb-face");
    clock += 301_000;
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "WORLD_ERROR",
    });
  });
});

describe("consent page", () => {
  async function page(extra: Record<string, string> = {}, claims?: string) {
    const s = setup();
    const { url } = await startApproval(s.deps, {
      action: s.action,
      tier: "strong",
    });
    const u = new URL(url);
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    if (claims !== undefined) u.searchParams.set("claims", claims);
    const res = await s.sim.handle(new Request(u));
    return { res, text: await res.text() };
  }

  it("says plainly that it is a simulation and shows what was requested", async () => {
    const { res, text } = await page();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(text).toContain("SIMULATION");
    expect(text).toContain("not World ID");
    expect(text).toContain(ORB_FACE);
  });

  it("marks which choices meet the request", async () => {
    const { text } = await page();
    const button = (value: string) =>
      text.split(`value="${value}"`)[1]?.split("</button>")[0] ?? "";
    expect(button("orb-face")).toContain("meets the request");
    expect(button("orb")).toContain("does NOT meet the request");
    expect(button("selfie")).toContain("does NOT meet the request");
  });

  it("treats a request with no acr constraint as any login", async () => {
    const { text } = await page({}, "");
    expect(text).toContain("any login");
    expect(text.match(/meets the request/g)?.length).toBe(3);
  });

  it("escapes request parameters instead of echoing markup", async () => {
    const { text } = await page({ state: `s"><script>alert(1)</script>` });
    expect(text).not.toContain("<script>alert(1)</script>");
    expect(text).toContain("&#60;script&#62;");
  });
});

describe("authorization endpoint validation", () => {
  const validQuery = () => {
    const q = new URLSearchParams({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: "openid",
      state: "s".repeat(24),
      nonce: "n".repeat(24),
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
    });
    return q;
  };
  const get = (mutate: (q: URLSearchParams) => void) => {
    const q = validQuery();
    mutate(q);
    return setup().sim.handle(new Request(`${ISSUER}/authorize?${q}`));
  };

  it("accepts a well-formed request", async () => {
    expect((await get(() => {})).status).toBe(200);
  });

  it.each([
    [
      "an unknown client",
      (q: URLSearchParams) => q.set("client_id", "someone_else"),
    ],
    [
      "a different redirect URI",
      (q: URLSearchParams) => q.set("redirect_uri", "https://evil.test/cb"),
    ],
    [
      "a non-code response type",
      (q: URLSearchParams) => q.set("response_type", "token"),
    ],
    [
      "a scope without openid",
      (q: URLSearchParams) => q.set("scope", "profile"),
    ],
    [
      "plain PKCE",
      (q: URLSearchParams) => q.set("code_challenge_method", "plain"),
    ],
    [
      "a malformed challenge",
      (q: URLSearchParams) => q.set("code_challenge", "short"),
    ],
    ["a missing state", (q: URLSearchParams) => q.delete("state")],
    ["a missing nonce", (q: URLSearchParams) => q.delete("nonce")],
  ])("rejects %s with an error page and no redirect", async (_name, mutate) => {
    const res = await get(mutate);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("request rejected");
  });

  it("re-validates on submit: a forged form cannot redirect elsewhere or pick an unknown outcome", async () => {
    const sim = setup().sim;
    const post = (mutate: (q: URLSearchParams) => void, choice: string) => {
      const q = validQuery();
      mutate(q);
      q.set("choice", choice);
      return sim.handle(
        new Request(`${ISSUER}/authorize`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: q,
        }),
      );
    };
    const evil = await post(
      (q) => q.set("redirect_uri", "https://evil.test/cb"),
      "orb-face",
    );
    expect(evil.status).toBe(400);
    expect(evil.headers.get("location")).toBeNull();
    expect((await post(() => {}, "godmode")).status).toBe(400);
    expect((await post(() => {}, "orb-face")).status).toBe(303);
    const noForm = await sim.handle(
      new Request(`${ISSUER}/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(noForm.status).toBe(400);
  });
});

describe("token endpoint", () => {
  async function codeFor(
    s: ReturnType<typeof setup>,
    attemptId: string,
    url: string,
  ) {
    const callback = await choose(s.sim, url, "orb-face");
    return {
      code: callback.searchParams.get("code") ?? "",
      verifier: pkceVerifier(SECRET, attemptId),
    };
  }
  const post = (s: ReturnType<typeof setup>, fields: Record<string, string>) =>
    s.sim.handle(
      new Request(`${ISSUER}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      }),
    );

  async function valid() {
    const s = setup();
    const { url, attemptId } = await startApproval(s.deps, {
      action: s.action,
      tier: "strong",
    });
    const { code, verifier } = await codeFor(s, attemptId, url);
    const fields = {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      client_id: CLIENT,
      client_secret: SECRET,
    };
    return { s, fields };
  }

  it("issues a signed ID token for a valid exchange", async () => {
    const { s, fields } = await valid();
    const res = await post(s, fields);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.token_type).toBe("Bearer");
    expect(body.id_token.split(".")).toHaveLength(3);
  });

  it.each([
    [
      "a wrong client secret",
      { client_secret: "nope-nope-nope-nope" },
      401,
      "invalid_client",
    ],
    ["a wrong client id", { client_id: "other" }, 401, "invalid_client"],
    [
      "a wrong PKCE verifier",
      { code_verifier: "v".repeat(43) },
      400,
      "invalid_grant",
    ],
    ["a missing PKCE verifier", { code_verifier: "" }, 400, "invalid_grant"],
    [
      "a different redirect URI",
      { redirect_uri: "https://evil.test/cb" },
      400,
      "invalid_grant",
    ],
    ["a tampered code", { code: "x.y.z" }, 400, "invalid_grant"],
    [
      "an unsupported grant type",
      { grant_type: "password" },
      400,
      "unsupported_grant_type",
    ],
  ])("rejects %s", async (_name, override, status, error) => {
    const { s, fields } = await valid();
    const res = await post(s, { ...fields, ...override });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it("does not accept a code signed with a different secret", async () => {
    const { s, fields } = await valid();
    const other = createSimulator({
      issuer: ISSUER,
      clientId: CLIENT,
      secret: "a-completely-different-secret-1234",
      redirectUri: REDIRECT,
    });
    const res = await other.handle(
      new Request(`${ISSUER}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...fields,
          client_secret: "a-completely-different-secret-1234",
        }),
      }),
    );
    expect(await res.json()).toEqual({ error: "invalid_grant" });
    expect(s).toBeTruthy();
  });
});

describe("discovery, keys and routing", () => {
  it("serves a discovery document that matches the issuer and advertises what it supports", async () => {
    const res = await setup().sim.handle(
      new Request(`${ISSUER}/.well-known/openid-configuration`),
    );
    const doc = await res.json();
    expect(doc).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: ["RS256"],
      claims_parameter_supported: true,
    });
    expect(doc.acr_values_supported).toEqual([ORB, ORB_FACE]);
  });

  it("serves a public key set with no private parameters", async () => {
    const { keys } = await (
      await setup().sim.handle(new Request(`${ISSUER}/jwks`))
    ).json();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      kty: "RSA",
      alg: "RS256",
      use: "sig",
      kid: "sim-1",
    });
    for (const secret of ["d", "p", "q", "dp", "dq", "qi"])
      expect(keys[0][secret]).toBeUndefined();
  });

  it("uses a configured key so every instance shares one key set", async () => {
    const { privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const privateKeyBase64 = Buffer.from(
      await exportPKCS8(privateKey),
    ).toString("base64");
    const a = await (
      await setup({ privateKeyBase64 }).sim.handle(
        new Request(`${ISSUER}/jwks`),
      )
    ).json();
    const b = await (
      await setup({ privateKeyBase64 }).sim.handle(
        new Request(`${ISSUER}/jwks`),
      )
    ).json();
    const ephemeral = await (
      await setup().sim.handle(new Request(`${ISSUER}/jwks`))
    ).json();
    expect(a).toEqual(b);
    expect(a.keys[0].n).not.toBe(ephemeral.keys[0].n);
  });

  it("returns 404 for unknown paths and for URLs outside its issuer path", async () => {
    const { sim } = setup();
    expect((await sim.handle(new Request(`${ISSUER}/nope`))).status).toBe(404);
    expect((await sim.handle(new Request(`${ISSUER}/token`))).status).toBe(404);
    expect(
      (await sim.handle(new Request("http://localhost:3000/api/health")))
        .status,
    ).toBe(404);
  });
});

describe("simulated mode configuration", () => {
  it("is off by default: the issuer and credentials are World's own", () => {
    const { world } = loadConfig({});
    expect(world.mode).toBe("real");
    expect(world.simulator).toBeNull();
    expect(world.issuer).toBe("https://auth.world.org");
    expect(world.clientId).toBeUndefined();
  });

  it("points the app at its own simulator when WORLD_MODE=simulated", () => {
    const { world } = loadConfig({
      WORLD_MODE: "simulated",
      APP_BASE_URL: "https://demo.example/app",
    });
    expect(world).toMatchObject({
      mode: "simulated",
      issuer: "https://demo.example/api/sim-world",
      clientId: SIM_CLIENT_ID,
      clientSecret: SIM_DEV_SECRET,
      simulator: { secret: SIM_DEV_SECRET, privateKeyBase64: undefined },
    });
  });

  it("uses the configured simulator secret and key", () => {
    const key = "k".repeat(120);
    const { world } = loadConfig({
      WORLD_MODE: "simulated",
      WORLD_SIM_SECRET: "a-custom-simulator-secret",
      WORLD_SIM_KEY: key,
    });
    expect(world.clientSecret).toBe("a-custom-simulator-secret");
    expect(world.simulator).toEqual({
      secret: "a-custom-simulator-secret",
      privateKeyBase64: key,
    });
  });

  it("refuses real World credentials in simulated mode, so the two cannot be mixed up", () => {
    expect(() =>
      loadConfig({
        WORLD_MODE: "simulated",
        WORLD_CLIENT_ID: "app_x",
        WORLD_CLIENT_SECRET: "s",
      }),
    ).toThrow(/ignores WORLD_CLIENT_ID/);
  });

  it("does not require credentials in simulated mode, and still requires both in real mode", () => {
    expect(() => loadConfig({ WORLD_MODE: "simulated" })).not.toThrow();
    expect(() => loadConfig({ WORLD_CLIENT_ID: "app_x" })).toThrow(
      /WORLD_CLIENT_SECRET/,
    );
  });

  it("rejects an unknown mode and a too-short simulator secret", () => {
    expect(() => loadConfig({ WORLD_MODE: "demo" })).toThrow(/WORLD_MODE/);
    expect(() =>
      loadConfig({ WORLD_MODE: "simulated", WORLD_SIM_SECRET: "short" }),
    ).toThrow(/WORLD_SIM_SECRET/);
  });
});
