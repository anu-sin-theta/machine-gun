import { describe, expect, it } from "vitest";
import { createWorldOidc } from "@/adapters/world";
import { loadConfig } from "@/config/env";

const { world } = loadConfig(process.env);

describe("World ID issuer (live)", () => {
  it("accepts the real discovery document and builds an authorization URL", async () => {
    // Discovery and URL building need no valid credentials; only the code exchange does.
    const oidc = createWorldOidc({
      ...world,
      clientId: world.clientId ?? "app_placeholder",
      clientSecret: world.clientSecret ?? "placeholder-secret",
    });
    const url = await oidc.authorizationUrl({
      attemptId: "att_live_check",
      state: "s".repeat(24),
      nonce: "n".repeat(24),
      claims: JSON.stringify({
        id_token: { acr: { essential: true, values: world.acr.strong } },
      }),
    });
    expect(url.origin + url.pathname).toBe(
      "https://auth.world.org/api/v1/authorize",
    );
    expect(url.searchParams.get("max_age")).toBe("0");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
