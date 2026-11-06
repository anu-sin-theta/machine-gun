import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/sim-world/[...path]/route";

describe("/api/sim-world route", () => {
  it("is invisible unless WORLD_MODE=simulated (this test run is in real mode)", async () => {
    for (const handler of [GET, POST]) {
      const res = await handler(
        new Request(
          "http://localhost:3000/api/sim-world/.well-known/openid-configuration",
        ),
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not found" });
    }
  });
});
