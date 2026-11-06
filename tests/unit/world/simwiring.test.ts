import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoAction } from "../core/fixtures";

/** Boots the real app wiring (config -> getApprovalDeps -> simulator) with WORLD_MODE=simulated. */
async function boot() {
  vi.resetModules();
  vi.stubEnv("WORLD_MODE", "simulated");
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  const world = await import("@/adapters/world");
  return { world, deps: world.getApprovalDeps() };
}

describe("simulated mode wiring", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("runs a full approval through getApprovalDeps with no World credentials and labels it simulated", async () => {
    const { world, deps } = await boot();
    expect(deps.source).toBe("simulated");
    expect(deps.issuer).toBe("http://localhost:3000/api/sim-world");

    const started = await world.startApproval(deps, {
      action: demoAction(),
      tier: "strong",
    });
    expect(
      started.url.startsWith("http://localhost:3000/api/sim-world/authorize?"),
    ).toBe(true);

    const sim = world.getSimulator();
    expect(sim).not.toBeNull();
    const form = new URLSearchParams(new URL(started.url).searchParams);
    form.set("choice", "orb-face");
    const res = await (sim as NonNullable<typeof sim>).handle(
      new Request("http://localhost:3000/api/sim-world/authorize", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      }),
    );
    const outcome = await world.completeApproval(
      { ...deps, getCurrentAction: async () => demoAction() },
      new URL(res.headers.get("location") ?? ""),
    );
    expect(outcome).toMatchObject({ kind: "approved", checkId: "chk_01" });
  });

  it("serves the simulator through the route only in simulated mode", async () => {
    await boot();
    const { GET } = await import("@/app/api/sim-world/[...path]/route");
    const res = await GET(
      new Request(
        "http://localhost:3000/api/sim-world/.well-known/openid-configuration",
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).issuer).toBe(
      "http://localhost:3000/api/sim-world",
    );
  });

  it("has no simulator in real mode", async () => {
    vi.resetModules();
    const world = await import("@/adapters/world");
    expect(world.getSimulator()).toBeNull();
  });
});
