import { describe, expect, it, vi } from "vitest";

// `connection()` only works inside a Next request scope; it is a no-op here.
vi.mock("next/server", () => ({ connection: async () => {} }));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("reports healthy when the WASM core loads and agrees with the TypeScript core", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      wasmVersion: "0.1.0",
      hashesAgree: true,
      linkEngineWorks: true,
    });
  });

  it("does not leak configuration or secrets", async () => {
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toMatch(/key|secret|token|password|DATABASE_URL/i);
  });
});
