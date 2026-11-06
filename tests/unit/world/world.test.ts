import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/adapters/db";
import {
  type ApprovalDeps,
  actionFromCheck,
  type CallbackOutcome,
  completeApproval,
  consumeApprovalOnce,
  createWorldOidc,
  pkceVerifier,
  startApproval,
  WorldError,
} from "@/adapters/world";
import { type BoundAction, hbar } from "@/core";
import { demoAction } from "../core/fixtures";
import {
  type AuthorizeOverrides,
  CLIENT_ID,
  CLIENT_SECRET,
  createFakeIssuer,
  ISSUER,
  REDIRECT_URI,
} from "./fakeIssuer";

const ORB = "https://world.org/oidc/acr/orb";
const ORB_FACE = "https://world.org/oidc/acr/orb-face";

async function setup(
  opts: {
    failDiscoveryTimes?: number;
    current?: (checkId: string) => Promise<BoundAction | null>;
  } = {},
) {
  const issuer = await createFakeIssuer({
    failDiscoveryTimes: opts.failDiscoveryTimes,
  });
  const repos = createMemoryRepositories();
  const clock = { t: Date.now() };
  let n = 0;
  const action = demoAction();
  const deps: ApprovalDeps = {
    repos,
    oidc: createWorldOidc({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      fetch: issuer.fetch,
    }),
    issuer: ISSUER,
    acr: {
      fresh: null,
      human: [ORB, ORB_FACE] as never,
      strong: [ORB_FACE] as never,
    },
    ttlMs: 600_000,
    now: () => clock.t,
    random: (bytes) =>
      `${String(++n).padStart(bytes, "0")}${"x".repeat(bytes)}`,
    getCurrentAction: opts.current ?? (async () => action),
  };
  return { issuer, repos, clock, deps, action };
}

async function flow(
  s: Awaited<ReturnType<typeof setup>>,
  overrides: AuthorizeOverrides = {},
  tier: "fresh" | "human" | "strong" = "human",
) {
  const started = await startApproval(s.deps, { action: s.action, tier });
  const callback = s.issuer.approve(started.url, overrides);
  return { started, callback };
}

const kind = (o: CallbackOutcome) => o.kind;

describe("startApproval", () => {
  it("builds an authorization URL that forces a fresh login and requests the tier's acr", async () => {
    const s = await setup();
    const { url, attemptId } = await startApproval(s.deps, {
      action: s.action,
      tier: "strong",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://auth.world.org/api/v1/authorize",
    );
    const p = u.searchParams;
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid");
    expect(p.get("max_age")).toBe("0");
    expect(p.get("prompt")).toBe("login");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.parse(p.get("claims") ?? "null")).toEqual({
      id_token: { acr: { essential: true, values: [ORB_FACE] } },
    });
    const stored = await s.repos.approvals.getById(attemptId);
    expect(stored?.status).toBe("pending");
    expect(stored?.state).toBe(p.get("state"));
    expect(stored?.nonce).toBe(p.get("nonce"));
    expect(stored?.requiredAcr).toEqual([ORB_FACE]);
  });

  it("sends no acr constraint for the fresh tier", async () => {
    const s = await setup();
    const { url } = await startApproval(s.deps, {
      action: s.action,
      tier: "fresh",
    });
    expect(new URL(url).searchParams.has("claims")).toBe(false);
  });

  it("uses a different state, nonce and PKCE challenge per attempt", async () => {
    const s = await setup();
    const a = new URL(
      (await startApproval(s.deps, { action: s.action, tier: "human" })).url,
    );
    const b = new URL(
      (await startApproval(s.deps, { action: s.action, tier: "human" })).url,
    );
    for (const k of ["state", "nonce", "code_challenge"])
      expect(a.searchParams.get(k)).not.toBe(b.searchParams.get(k));
  });

  it("reuses one discovery document across calls and retries after a failed discovery", async () => {
    const s = await setup({ failDiscoveryTimes: 1 });
    await expect(
      startApproval(s.deps, { action: s.action, tier: "human" }),
    ).rejects.toMatchObject({
      kind: "DISCOVERY_FAILED",
    });
    await startApproval(s.deps, { action: s.action, tier: "human" });
    await startApproval(s.deps, { action: s.action, tier: "human" });
    expect(
      s.issuer.log.filter((l) => l.includes("openid-configuration")),
    ).toHaveLength(2);
  });
});

describe("completeApproval", () => {
  it("approves a valid orb-face callback and stores the new status", async () => {
    const s = await setup();
    const { started, callback } = await flow(s);
    const out = await completeApproval(s.deps, callback);
    expect(out).toMatchObject({
      kind: "approved",
      attemptId: started.attemptId,
      checkId: "chk_01",
    });
    expect((await s.repos.approvals.getById(started.attemptId))?.status).toBe(
      "approved",
    );
  });

  it("accepts orb for the human tier but rejects it for the strong tier", async () => {
    const human = await setup();
    const h = await flow(human, { claims: { acr: ORB } }, "human");
    expect(kind(await completeApproval(human.deps, h.callback))).toBe(
      "approved",
    );

    const strong = await setup();
    const st = await flow(strong, { claims: { acr: ORB } }, "strong");
    expect(await completeApproval(strong.deps, st.callback)).toMatchObject({
      kind: "rejected",
      reason: "INSUFFICIENT_ASSURANCE",
    });
  });

  it("rejects a missing or weaker acr", async () => {
    for (const acr of [undefined, "https://world.org/oidc/acr/selfie"]) {
      const s = await setup();
      const { callback } = await flow(s, { claims: { acr } });
      expect(await completeApproval(s.deps, callback)).toMatchObject({
        kind: "rejected",
        reason: "INSUFFICIENT_ASSURANCE",
      });
    }
  });

  it("rejects a login that happened before the attempt started (stale session)", async () => {
    const s = await setup();
    const { callback } = await flow(s, {
      authTime: Math.floor(s.clock.t / 1000) - 3600,
    });
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "STALE_AUTH",
    });
  });

  it("fails closed when the token has no auth_time", async () => {
    const s = await setup();
    const { callback } = await flow(s, { claims: { auth_time: undefined } });
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "STALE_AUTH",
    });
  });

  it("rejects an auth_time in the future", async () => {
    const s = await setup();
    const { callback } = await flow(s, {
      authTime: Math.floor(s.clock.t / 1000) + 3600,
    });
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "AUTH_TIME_IN_FUTURE",
    });
  });

  it("rejects when the token's nonce is not ours (WORLD_ERROR from the OIDC layer)", async () => {
    const s = await setup();
    const { callback } = await flow(s, {
      claims: { nonce: "someone-elses-nonce-0000" },
    });
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "WORLD_ERROR",
    });
  });

  it("rejects when the token endpoint fails", async () => {
    const s = await setup();
    const { callback } = await flow(s, { tokenStatus: 500 });
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "WORLD_ERROR",
    });
  });

  it("rejects when the callback carries a state that does not match the attempt", async () => {
    const s = await setup();
    const { callback } = await flow(s);
    const other = await flow(s);
    // Valid code from attempt B, state from attempt A.
    callback.searchParams.set(
      "code",
      other.callback.searchParams.get("code") ?? "",
    );
    expect(kind(await completeApproval(s.deps, callback))).toBe("rejected");
  });

  it("marks the attempt expired when the callback arrives after the TTL", async () => {
    const s = await setup();
    const { callback, started } = await flow(s);
    s.clock.t += 600_001;
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "expired",
      reason: "EXPIRED",
    });
    expect((await s.repos.approvals.getById(started.attemptId))?.status).toBe(
      "expired",
    );
  });

  it("rejects when the payment changed after the approval started", async () => {
    const changed: BoundAction = { ...demoAction(), amount: hbar(13) };
    const s = await setup({ current: async () => changed });
    const { callback } = await flow(s);
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "ACTION_CHANGED",
    });
  });

  it("rejects when the check no longer exists", async () => {
    const s = await setup({ current: async () => null });
    const { callback } = await flow(s);
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "ACTION_CHANGED",
    });
  });

  it("rejects an approval whose nonce was already used elsewhere", async () => {
    const s = await setup();
    const { callback, started } = await flow(s);
    const pending = await s.repos.approvals.getById(started.attemptId);
    await s.repos.nonces.markUsed(pending?.nonce ?? "", s.clock.t);
    expect(await completeApproval(s.deps, callback)).toMatchObject({
      kind: "rejected",
      reason: "NONCE_REPLAY",
    });
  });

  it("records a user denial as denied and other IdP errors as rejected", async () => {
    for (const [error, expected] of [
      ["access_denied", "denied"],
      ["server_error", "rejected"],
    ] as const) {
      const s = await setup();
      const started = await startApproval(s.deps, {
        action: s.action,
        tier: "human",
      });
      const state = new URL(started.url).searchParams.get("state") ?? "";
      const cb = new URL(REDIRECT_URI);
      cb.searchParams.set("error", error);
      cb.searchParams.set("state", state);
      expect(kind(await completeApproval(s.deps, cb))).toBe(expected);
      expect((await s.repos.approvals.getById(started.attemptId))?.status).toBe(
        expected,
      );
    }
  });

  it("changes nothing for an unknown or missing state", async () => {
    const s = await setup();
    expect(
      await completeApproval(
        s.deps,
        new URL(`${REDIRECT_URI}?code=c&state=nope`),
      ),
    ).toEqual({
      kind: "unknown_state",
    });
    expect(
      await completeApproval(s.deps, new URL(`${REDIRECT_URI}?code=c`)),
    ).toEqual({
      kind: "unknown_state",
    });
  });

  it("treats a replayed callback as not_pending and leaves the status alone", async () => {
    const s = await setup();
    const { callback, started } = await flow(s);
    expect(kind(await completeApproval(s.deps, callback))).toBe("approved");
    expect(await completeApproval(s.deps, callback)).toEqual({
      kind: "not_pending",
      attemptId: started.attemptId,
    });
    expect((await s.repos.approvals.getById(started.attemptId))?.status).toBe(
      "approved",
    );
  });

  it("lets only one of two concurrent callbacks settle the attempt", async () => {
    const s = await setup();
    const { callback } = await flow(s);
    const [a, b] = await Promise.all([
      completeApproval(s.deps, callback),
      completeApproval(s.deps, callback),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["approved", "not_pending"]);
  });
});

describe("consumeApprovalOnce", () => {
  async function approved() {
    const s = await setup();
    const { callback, started } = await flow(s);
    await completeApproval(s.deps, callback);
    return { s, id: started.attemptId };
  }

  it("spends an approval exactly once", async () => {
    const { s, id } = await approved();
    expect(await consumeApprovalOnce(s.deps, id)).toBe(true);
    expect(await consumeApprovalOnce(s.deps, id)).toBe(false);
    expect((await s.repos.approvals.getById(id))?.status).toBe("consumed");
  });

  it("lets exactly one of many concurrent spenders win", async () => {
    const { s, id } = await approved();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeApprovalOnce(s.deps, id)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses pending, rejected, unknown and expired approvals", async () => {
    const s = await setup();
    const started = await startApproval(s.deps, {
      action: s.action,
      tier: "human",
    });
    expect(await consumeApprovalOnce(s.deps, started.attemptId)).toBe(false);
    expect(await consumeApprovalOnce(s.deps, "att_missing")).toBe(false);

    const bad = await flow(s, { claims: { acr: undefined } });
    await completeApproval(s.deps, bad.callback);
    expect(await consumeApprovalOnce(s.deps, bad.started.attemptId)).toBe(
      false,
    );

    const { s: s2, id } = await approved();
    s2.clock.t += 600_001;
    expect(await consumeApprovalOnce(s2.deps, id)).toBe(false);
    expect((await s2.repos.approvals.getById(id))?.status).toBe("approved");
  });
});

describe("createWorldOidc", () => {
  it("refuses to build without credentials", () => {
    const base = { issuer: ISSUER, redirectUri: REDIRECT_URI };
    expect(() =>
      createWorldOidc({ ...base, clientId: undefined, clientSecret: "s" }),
    ).toThrow(WorldError);
    expect(() =>
      createWorldOidc({ ...base, clientId: "c", clientSecret: undefined }),
    ).toThrow(/WORLD_CLIENT_ID/);
  });

  it("derives a stable, per-attempt, secret-dependent PKCE verifier", () => {
    const v = pkceVerifier("secret", "att_1");
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceVerifier("secret", "att_1")).toBe(v);
    expect(pkceVerifier("secret", "att_2")).not.toBe(v);
    expect(pkceVerifier("other", "att_1")).not.toBe(v);
  });
});

describe("actionFromCheck", () => {
  const base = {
    id: "chk_9",
    createdAt: 0,
    inputKind: "link",
    inputText: null,
    payee: "0.0.5001",
    resource: "https://m.test/r",
    amount: hbar(1),
    verdict: null,
    verdictHash: "a".repeat(64),
    decision: null,
    transactionId: null,
    status: "verdict" as const,
  };

  it("builds the bound action from a complete check", () => {
    expect(actionFromCheck(base)).toEqual({
      checkId: "chk_9",
      payee: "0.0.5001",
      resource: "https://m.test/r",
      amount: hbar(1),
      verdictHash: "a".repeat(64),
      version: 1,
    });
  });

  it.each([
    "payee",
    "resource",
    "amount",
    "verdictHash",
  ] as const)("returns null without %s", (field) => {
    expect(actionFromCheck({ ...base, [field]: null })).toBeNull();
  });
});
