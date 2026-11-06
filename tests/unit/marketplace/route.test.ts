import { describe, expect, it } from "vitest";
import { getRepositories } from "@/adapters/db";
import { GET } from "@/app/api/agents/route";
import { agentListingSchema } from "@/marketplace";
import { toPublic } from "@/marketplace/public";

const get = (query = "") =>
  GET(new Request(`http://localhost:3000/api/agents${query}`));
const body = async (query = "") => (await get(query)).json();

describe("GET /api/agents", () => {
  it("lists the active agents, seeding the built-ins on first use", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { agents } = await res.json();
    expect(agents.map((a: { id: string }) => a.id).sort()).toEqual([
      "kavach-domain-heuristics",
      "kavach-link-intel",
      "kavach-reputation",
      "kavach-scribe",
    ]);
  });

  it("shows money as an exact string and in words, and no private fields", async () => {
    const { agents } = await body();
    const rep = agents.find(
      (a: { id: string }) => a.id === "kavach-reputation",
    );
    expect(rep).toMatchObject({
      role: "verifier",
      input: "payee",
      priceTinybars: "5000000",
      price: "0.05 HBAR",
      evidenceSource: "reputation",
      status: "active",
      builtIn: true,
    });
    const heuristics = agents.find(
      (a: { id: string }) => a.id === "kavach-domain-heuristics",
    );
    expect(heuristics).toMatchObject({
      priceTinybars: "2000000",
      price: "0.02 HBAR",
    });
    expect(Object.keys(rep).sort()).toEqual([
      "builtIn",
      "createdAt",
      "description",
      "endpoint",
      "evidenceSource",
      "id",
      "input",
      "model",
      "name",
      "payTo",
      "price",
      "priceTinybars",
      "role",
      "skills",
      "status",
    ]);
  });

  it("filters by input and role", async () => {
    expect((await body("?input=link")).agents).toHaveLength(2);
    expect((await body("?input=payee")).agents).toHaveLength(1);
    expect((await body("?role=verifier")).agents).toHaveLength(3);
    expect((await body("?role=merchant")).agents).toEqual([]);
    expect((await body("?role=verifier&input=link")).agents).toHaveLength(2);
  });

  it("lists the workers willing to do a kind of task", async () => {
    const workers = (await body("?role=worker&skill=summarize")).agents;
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatchObject({
      id: "kavach-scribe",
      model: "kavach-scribe-1",
      skills: ["summarize", "extract-links"],
      price: "0.1 HBAR",
    });
    expect((await body("?skill=translate")).agents).toEqual([]);
  });

  it("hides suspended agents unless asked for them", async () => {
    await getRepositories().agents.setStatus("kavach-link-intel", "suspended");
    expect(
      (await body()).agents.map((a: { id: string }) => a.id),
    ).not.toContain("kavach-link-intel");
    expect(
      (await body("?status=suspended")).agents.map((a: { id: string }) => a.id),
    ).toEqual(["kavach-link-intel"]);
    await getRepositories().agents.setStatus("kavach-link-intel", "active");
    expect((await body()).agents).toHaveLength(4);
  });

  it.each([
    "?role=oracle",
    "?status=pending",
    "?input=email",
    "?role=",
    "?role=Verifier",
    "?skill=Not%20A%20Skill",
  ])("rejects %s with a 400", async (query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "role, status, input and skill must be valid values",
    });
  });
});

describe("toPublic", () => {
  it("keeps a price beyond 2^53 exact", () => {
    const listing = agentListingSchema.parse({
      id: "big-price",
      role: "verifier",
      name: "Big",
      description: "d",
      endpoint: "https://v.example/x",
      input: "link",
      payTo: "0.0.7001",
      priceTinybars: 9007199254740993n,
      evidenceSource: "big-price",
      model: null,
      skills: [],
      status: "active",
      builtIn: false,
      createdAt: 0,
    });
    expect(toPublic(listing).priceTinybars).toBe("9007199254740993");
    expect(toPublic(listing).price).toBe("90071992.54740993 HBAR");
    expect(JSON.parse(JSON.stringify(toPublic(listing)))).toEqual(
      toPublic(listing),
    );
  });
});
