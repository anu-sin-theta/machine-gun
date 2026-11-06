import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createSimulator } from "@/adapters/world";

const ISSUER = "http://localhost:3000/api/sim-world";

const generate = () =>
  execFileSync(process.execPath, ["scripts/gen-sim-key.mjs"], {
    encoding: "utf8",
  }).trim();

const jwks = async (privateKeyBase64?: string) =>
  (
    await createSimulator({
      issuer: ISSUER,
      clientId: "sim_client",
      secret: "simulator-test-secret-0123456789",
      redirectUri: "http://localhost:3000/api/worldid/callback",
      privateKeyBase64,
    }).handle(new Request(`${ISSUER}/jwks`))
  ).json();

describe("pnpm gen:sim-key", () => {
  it("prints a WORLD_SIM_KEY line the simulator accepts and shares across instances", async () => {
    const line = generate();
    expect(line).toMatch(/^WORLD_SIM_KEY=[A-Za-z0-9+/]+=*$/);
    const key = line.slice("WORLD_SIM_KEY=".length);
    const a = await jwks(key);
    const b = await jwks(key);
    expect(a.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256" });
    expect(a).toEqual(b);
  });

  it("generates a different key each time, and one different from the per-process key", async () => {
    const first = generate();
    const second = generate();
    expect(first).not.toBe(second);
    const a = await jwks(first.slice("WORLD_SIM_KEY=".length));
    const ephemeral = await jwks();
    expect(a.keys[0].n).not.toBe(ephemeral.keys[0].n);
  });

  it("passes the length rule of the config", () => {
    expect(generate().length - "WORLD_SIM_KEY=".length).toBeGreaterThan(100);
  });
});
