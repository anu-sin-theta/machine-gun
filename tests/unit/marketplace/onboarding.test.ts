import { encodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/adapters/db";
import {
  activateAgent,
  createSafeFetch,
  isPublicAddress,
  MAX_PENDING_LISTINGS,
  proveControl,
  registerAgent,
  suspendAgent,
  UNCORROBORATED_NOTE,
  weighEvidence,
} from "@/marketplace";

const NETWORK = "hedera:testnet" as const;
const ev = (
  source: string,
  level: "low" | "medium" | "high",
  detail = "d",
) => ({ source, level, detail });

describe("weighEvidence", () => {
  it("counts a lone third-party high as medium, and says so", () => {
    const [out] = weighEvidence([
      { evidence: ev("acme", "high", "scam"), trusted: false },
    ]);
    expect(out?.level).toBe("medium");
    expect(out?.detail).toBe(`scam${UNCORROBORATED_NOTE}`);
    expect(out?.source).toBe("acme");
  });

  it("keeps trusted evidence and non-high evidence as it is", () => {
    const inputs = [
      { evidence: ev("link-intel", "high"), trusted: true },
      { evidence: ev("acme", "low"), trusted: false },
      { evidence: ev("beta", "medium"), trusted: false },
    ];
    expect(weighEvidence(inputs)).toEqual(inputs.map((i) => i.evidence));
  });

  it("keeps a third-party high when another verifier also says high", () => {
    const out = weighEvidence([
      { evidence: ev("acme", "high"), trusted: false },
      { evidence: ev("link-intel", "high"), trusted: true },
    ]);
    expect(out.map((e) => e.level)).toEqual(["high", "high"]);
  });

  it("does not let one verifier corroborate itself", () => {
    const out = weighEvidence([
      { evidence: ev("acme", "high"), trusted: false },
      { evidence: ev("acme", "high"), trusted: false },
    ]);
    expect(out.map((e) => e.level)).toEqual(["medium", "medium"]);
  });

  it("keeps the detail within its cap", () => {
    const [out] = weighEvidence([
      { evidence: ev("acme", "high", "x".repeat(200)), trusted: false },
    ]);
    expect(out?.detail.length).toBeLessThanOrEqual(200);
    expect(out?.detail.endsWith(UNCORROBORATED_NOTE)).toBe(true);
  });
});

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("accepts %s", (a) => expect(isPublicAddress(a)).toBe(true));

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "ff02::1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("refuses %s", (a) => expect(isPublicAddress(a)).toBe(false));

  it("treats the edges of the private ranges correctly", () => {
    expect(isPublicAddress("172.15.0.1")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
    expect(isPublicAddress("100.63.0.1")).toBe(true);
    expect(isPublicAddress("100.128.0.1")).toBe(true);
  });
});

describe("createSafeFetch", () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init && { init }) });
    return new Response("ok");
  }) as typeof fetch;
  const make = (
    answers: Record<string, string[] | Error>,
    allowLocal = false,
  ) =>
    createSafeFetch({
      fetch: base,
      allowLocal,
      resolve: async (host) => {
        const a = answers[host];
        if (a instanceof Error || a === undefined) throw new Error("nxdomain");
        return a;
      },
    });

  it("fetches a public host and never follows redirects", async () => {
    calls.length = 0;
    const f = make({ "good.example": ["93.184.216.34"] });
    await f("https://good.example/x", { redirect: "follow" });
    expect(calls[0]?.init?.redirect).toBe("manual");
  });

  it("refuses a hostname that resolves to a private address", async () => {
    calls.length = 0;
    const f = make({ "evil.example": ["10.0.0.5"] });
    await expect(f("https://evil.example/x")).rejects.toThrow(/public address/);
    expect(calls).toHaveLength(0);
  });

  it("refuses when any answer is private, not just the first", async () => {
    const f = make({ "mixed.example": ["93.184.216.34", "169.254.169.254"] });
    await expect(f("https://mixed.example/")).rejects.toThrow(/public address/);
  });

  it("refuses when the name does not resolve or has no addresses", async () => {
    const f = make({ "empty.example": [] });
    await expect(f("https://missing.example/")).rejects.toThrow(
      /could not resolve/,
    );
    await expect(f("https://empty.example/")).rejects.toThrow(/public address/);
  });

  it("checks IP literals directly", async () => {
    const f = make({});
    await expect(f("https://127.0.0.1/")).rejects.toThrow(/public address/);
    await expect(f("http://[::1]/")).rejects.toThrow(/public address/);
    await expect(f("https://8.8.8.8/")).resolves.toBeInstanceOf(Response);
  });

  it("lets this machine's own host through only when local is allowed", async () => {
    await expect(make({}, false)("http://localhost:3000/")).rejects.toThrow();
    await expect(
      make({}, true)("http://localhost:3000/"),
    ).resolves.toBeInstanceOf(Response);
    // Allowing local does not open any other host.
    await expect(
      make({ "evil.example": ["10.0.0.5"] }, true)("https://evil.example/"),
    ).rejects.toThrow();
  });

  it("accepts a Request object", async () => {
    const f = make({ "good.example": ["93.184.216.34"] });
    await expect(
      f(new Request("https://good.example/")),
    ).resolves.toBeInstanceOf(Response);
  });
});

const PAY_TO = "0.0.7001";
const registration = {
  id: "acme-links",
  role: "verifier",
  name: "Acme link checks",
  description: "Checks links.",
  endpoint: "https://verifier.acme.example/api/check",
  input: "link",
  payTo: PAY_TO,
  priceTinybars: "3000000",
  evidenceSource: "acme-links",
};

interface Challenge {
  payTo?: string;
  amount?: string;
  network?: string;
  asset?: string;
}

/** A fake endpoint: answers a 402 with the given challenge, or something else. */
function endpoint(c: Challenge | Response | Error = {}) {
  const seen: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    if (c instanceof Error) throw c;
    if (c instanceof Response) return c;
    return new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
          x402Version: 2,
          resource: { url: "https://verifier.acme.example/api/check" },
          accepts: [
            {
              scheme: "exact",
              network: (c.network ?? NETWORK) as `${string}:${string}`,
              asset: c.asset ?? "0.0.0",
              amount: c.amount ?? "3000000",
              payTo: c.payTo ?? PAY_TO,
              maxTimeoutSeconds: 300,
              extra: {},
            },
          ],
        }),
      },
    });
  }) as typeof fetch;
  return { fn, seen };
}

function setup(c: Challenge | Response | Error = {}) {
  const repos = createMemoryRepositories();
  const ep = endpoint(c);
  return {
    agents: repos.agents,
    ep,
    deps: {
      agents: repos.agents,
      fetch: ep.fn,
      network: NETWORK,
      now: () => 1_000,
    },
  };
}

describe("registerAgent", () => {
  it("lists a proven agent as suspended, so no buyer pays it yet", async () => {
    const { deps, agents } = setup();
    const result = await registerAgent(deps, registration);
    expect(result).toMatchObject({
      ok: true,
      listing: {
        id: "acme-links",
        status: "suspended",
        builtIn: false,
        createdAt: 1_000,
      },
    });
    expect((await agents.get("acme-links"))?.status).toBe("suspended");
    expect(await agents.list({ role: "verifier", status: "active" })).toEqual(
      [],
    );
  });

  it("asks a link verifier about a harmless link and a payee verifier about a payee", async () => {
    const link = setup();
    await registerAgent(link.deps, registration);
    expect(new URL(link.ep.seen[0] ?? "").searchParams.get("url")).toBe(
      "https://example.com/",
    );

    const payee = setup();
    await registerAgent(payee.deps, { ...registration, input: "payee" });
    expect(new URL(payee.ep.seen[0] ?? "").searchParams.get("payee")).toBe(
      "0.0.2",
    );
  });

  it("rejects a bad registration without calling the endpoint", async () => {
    const { deps, ep } = setup();
    for (const bad of [
      null,
      {},
      { ...registration, priceTinybars: "0" },
      { ...registration, priceTinybars: "1.5" },
      { ...registration, priceTinybars: 3 },
      { ...registration, id: "A" },
      { ...registration, payTo: "me" },
      { ...registration, evidenceSource: "payee-check" },
      { ...registration, evidenceSource: undefined },
      { ...registration, input: null },
      { ...registration, role: "admin" },
    ]) {
      const result = await registerAgent(deps, bad);
      expect(result).toMatchObject({ ok: false, status: 400 });
    }
    expect(ep.seen).toHaveLength(0);
  });

  it("refuses an endpoint that breaks the endpoint rules", async () => {
    const { deps, ep } = setup();
    const result = await registerAgent(deps, {
      ...registration,
      endpoint: "https://10.0.0.1/check",
    });
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(ep.seen).toHaveLength(0);
  });

  it.each([
    [
      "answers something other than 402",
      new Response("{}", { status: 200 }),
      /expected an x402 402, got 200/,
    ],
    ["is unreachable", new Error("boom"), /unreachable/],
    [
      "has no payment header",
      new Response("{}", { status: 402 }),
      /without payment requirements/,
    ],
    [
      "has an unreadable payment header",
      new Response("{}", {
        status: 402,
        headers: { "PAYMENT-REQUIRED": "!!!" },
      }),
      /unreadable/,
    ],
  ])("refuses an endpoint that %s", async (_n, c, reason) => {
    const { deps, agents } = setup(c);
    const result = await registerAgent(deps, registration);
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(result.ok ? "" : result.error).toMatch(reason);
    expect(await agents.get("acme-links")).toBeNull();
  });

  it.each([
    ["names a different account", { payTo: "0.0.9999" }, /different account/],
    [
      "asks more than the listed price",
      { amount: "3000001" },
      /more than the listed price/,
    ],
    [
      "is on another network",
      { network: "hedera:mainnet" },
      /no HBAR exact option/,
    ],
    ["asks for another asset", { asset: "0.0.429274" }, /no HBAR exact option/],
  ])("refuses an endpoint whose 402 %s", async (_n, challenge, reason) => {
    const { deps, agents } = setup(challenge);
    const result = await registerAgent(deps, registration);
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(result.ok ? "" : result.error).toMatch(reason);
    expect(await agents.get("acme-links")).toBeNull();
  });

  it("accepts a price below the ceiling", async () => {
    const { deps } = setup({ amount: "1000000" });
    expect((await registerAgent(deps, registration)).ok).toBe(true);
  });

  it("refuses a taken id or evidence name", async () => {
    const { deps } = setup();
    expect((await registerAgent(deps, registration)).ok).toBe(true);
    expect(await registerAgent(deps, registration)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(
      await registerAgent(deps, { ...registration, id: "acme-two" }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("stops accepting once too many listings are waiting", async () => {
    const { deps } = setup();
    for (let i = 0; i < MAX_PENDING_LISTINGS; i++) {
      const r = await registerAgent(deps, {
        ...registration,
        id: `agent-${i}`,
        evidenceSource: `source-${i}`,
      });
      expect(r.ok).toBe(true);
    }
    expect(
      await registerAgent(deps, {
        ...registration,
        id: "one-more",
        evidenceSource: "one-more",
      }),
    ).toMatchObject({ ok: false, status: 429 });
  });

  it("registers a merchant with a derived evidence name and no input", async () => {
    const { deps } = setup();
    const merchant = {
      id: "shop-one",
      role: "merchant",
      name: "Shop",
      endpoint: "https://shop.example/pay",
      payTo: PAY_TO,
      priceTinybars: "5000000",
    };
    const a = await registerAgent(deps, merchant);
    expect(a).toMatchObject({
      ok: true,
      listing: { role: "merchant", input: null },
    });
    const b = await registerAgent(deps, { ...merchant, id: "shop-two" });
    if (!a.ok || !b.ok) throw new Error("expected both to register");
    expect(a.listing.evidenceSource).toMatch(/^m-[0-9a-f]{12}$/);
    expect(b.listing.evidenceSource).not.toBe(a.listing.evidenceSource);
  });

  it("ignores a verifier's input on a merchant, and cannot choose the status", async () => {
    const { deps } = setup();
    const result = await registerAgent(deps, {
      id: "shop-one",
      role: "merchant",
      name: "Shop",
      endpoint: "https://shop.example/pay",
      payTo: PAY_TO,
      priceTinybars: "5000000",
      input: "link",
      status: "active",
      builtIn: true,
    });
    expect(result).toMatchObject({
      ok: true,
      listing: { input: null, status: "suspended", builtIn: false },
    });
  });

  it("allows an http endpoint on this machine only when asked to", async () => {
    const local = {
      ...registration,
      endpoint: "http://localhost:3000/api/check",
    };
    const refused = setup();
    expect(await registerAgent(refused.deps, local)).toMatchObject({
      ok: false,
      status: 422,
    });
    const allowed = setup();
    expect(
      (
        await registerAgent(
          { ...allowed.deps, allowLocalEndpoints: true },
          local,
        )
      ).ok,
    ).toBe(true);
  });
});

describe("activateAgent and suspendAgent", () => {
  it("activates a listing that still proves control", async () => {
    const { deps, agents } = setup();
    await registerAgent(deps, registration);
    const result = await activateAgent(deps, "acme-links");
    expect(result).toMatchObject({ ok: true, listing: { status: "active" } });
    expect(
      (await agents.list({ role: "verifier", status: "active" })).map(
        (l) => l.id,
      ),
    ).toEqual(["acme-links"]);
  });

  it("does not activate when the endpoint changed its payee since registration", async () => {
    const { deps, agents } = setup();
    await registerAgent(deps, registration);
    const result = await activateAgent(
      { ...deps, fetch: endpoint({ payTo: "0.0.9999" }).fn },
      "acme-links",
    );
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect((await agents.get("acme-links"))?.status).toBe("suspended");
  });

  it("reports an unknown agent", async () => {
    const { deps } = setup();
    expect(await activateAgent(deps, "nobody")).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await suspendAgent(deps, "nobody")).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("suspends without contacting the endpoint", async () => {
    const { deps, agents, ep } = setup();
    await registerAgent(deps, registration);
    await activateAgent(deps, "acme-links");
    const before = ep.seen.length;
    const result = await suspendAgent(deps, "acme-links");
    expect(result).toMatchObject({
      ok: true,
      listing: { status: "suspended" },
    });
    expect((await agents.get("acme-links"))?.status).toBe("suspended");
    expect(ep.seen).toHaveLength(before);
  });
});

describe("proveControl", () => {
  it("passes a matching 402", async () => {
    const { deps } = setup();
    await registerAgent(deps, registration);
    const listing = await deps.agents.get("acme-links");
    if (!listing) throw new Error("missing");
    expect(await proveControl(listing, deps)).toEqual({ ok: true });
  });
});

describe("registering a worker", () => {
  const worker = {
    id: "acme-writer",
    role: "worker",
    name: "Acme writer",
    description: "Writes summaries.",
    endpoint: "https://writer.acme.example/v1/",
    payTo: PAY_TO,
    priceTinybars: "3000000",
    model: "acme-large",
    skills: ["summarize", "translate"],
  };

  it("proves control with an unpaid chat-completions POST and lists the worker suspended", async () => {
    const repos = createMemoryRepositories();
    const seen: Request[] = [];
    const base = endpoint().fn;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return base(input, init);
    }) as typeof fetch;
    const result = await registerAgent(
      {
        agents: repos.agents,
        fetch: fetchImpl,
        network: NETWORK,
        now: () => 1,
      },
      worker,
    );
    expect(result).toMatchObject({
      ok: true,
      listing: {
        role: "worker",
        model: "acme-large",
        skills: ["summarize", "translate"],
        input: null,
        status: "suspended",
      },
    });
    expect(result.ok && result.listing.evidenceSource).toMatch(/^m-/);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe(
      "https://writer.acme.example/v1/chat/completions",
    );
    expect(await seen[0]?.json()).toEqual({
      model: "acme-large",
      messages: [{ role: "user", content: "ping" }],
    });
  });

  it("needs a model and at least one valid skill", async () => {
    const { deps } = setup();
    for (const bad of [
      { ...worker, model: undefined },
      { ...worker, skills: [] },
      { ...worker, skills: undefined },
      { ...worker, skills: ["Not Valid"] },
      { ...worker, skills: Array.from({ length: 9 }, (_, i) => `s-${i}`) },
    ])
      expect(await registerAgent(deps, bad)).toMatchObject({
        ok: false,
        status: 400,
      });
  });

  it("ignores model and skills on a verifier", async () => {
    const { deps } = setup();
    const result = await registerAgent(deps, {
      ...registration,
      model: "x",
      skills: ["summarize"],
    });
    expect(result).toMatchObject({
      ok: true,
      listing: { model: null, skills: [] },
    });
  });
});
