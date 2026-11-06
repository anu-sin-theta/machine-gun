/**
 * A fake World OIDC issuer: discovery, JWKS and a token endpoint that signs
 * real RS256 ID tokens, so openid-client's own validation (signature, iss, aud,
 * exp, nonce, state, PKCE) runs for real in the tests.
 */

import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export const ISSUER = "https://auth.world.org";
export const CLIENT_ID = "app_test";
export const CLIENT_SECRET = "secret_test_value";
export const REDIRECT_URI = "http://localhost:3000/api/worldid/callback";

export interface TokenClaims {
  iss: string;
  sub: string;
  nonce: string | undefined;
  auth_time: number | undefined;
  acr: string | undefined;
}

export interface AuthorizeOverrides {
  /** Merged over the claims the issuer would normally sign. */
  claims?: Partial<TokenClaims>;
  /** Make the token endpoint answer with this HTTP status instead. */
  tokenStatus?: number;
  /** Seconds since epoch to use for auth_time (default: now). */
  authTime?: number;
}

interface Issued {
  nonce: string;
  challenge: string;
  overrides: AuthorizeOverrides;
}

export async function createFakeIssuer(
  options: { failDiscoveryTimes?: number } = {},
) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  const codes = new Map<string, Issued>();
  const log: string[] = [];
  let failures = options.failDiscoveryTimes ?? 0;
  let counter = 0;

  const discovery = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/api/v1/authorize`,
    token_endpoint: `${ISSUER}/api/v1/token`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    claims_parameter_supported: true,
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    log.push(`${init?.method ?? "GET"} ${url.pathname}`);

    if (url.pathname === "/.well-known/openid-configuration") {
      if (failures > 0) {
        failures -= 1;
        return json({ error: "down" }, 503);
      }
      return json(discovery);
    }
    if (url.pathname === "/.well-known/jwks.json") return json({ keys: [jwk] });

    if (url.pathname === "/api/v1/token") {
      const form = new URLSearchParams(String(init?.body));
      const issued = codes.get(form.get("code") ?? "");
      if (!issued) return json({ error: "invalid_grant" }, 400);
      if (issued.overrides.tokenStatus)
        return json({ error: "server_error" }, issued.overrides.tokenStatus);
      if (
        form.get("client_id") !== CLIENT_ID ||
        form.get("client_secret") !== CLIENT_SECRET
      )
        return json({ error: "invalid_client" }, 401);
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (challenge !== issued.challenge)
        return json({ error: "invalid_grant", error_description: "PKCE" }, 400);

      const claims: TokenClaims = {
        iss: ISSUER,
        sub: "pairwise-sub-1",
        nonce: issued.nonce,
        auth_time: issued.overrides.authTime ?? Math.floor(Date.now() / 1000),
        acr: "https://world.org/oidc/acr/orb-face",
        ...issued.overrides.claims,
      };
      const { nonce, auth_time, acr, iss, sub, ...rest } = claims;
      const jwt = new SignJWT({
        ...rest,
        ...(nonce !== undefined && { nonce }),
        ...(auth_time !== undefined && { auth_time }),
        ...(acr !== undefined && { acr }),
      })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(iss)
        .setSubject(sub)
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime("10m");
      return json({
        access_token: "at",
        token_type: "Bearer",
        id_token: await jwt.sign(privateKey),
      });
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    log,
    /** Plays the user's browser: approves the authorize URL and returns the callback URL. */
    approve(authorizeUrl: string, overrides: AuthorizeOverrides = {}): URL {
      const u = new URL(authorizeUrl);
      const code = `code_${++counter}`;
      codes.set(code, {
        nonce: u.searchParams.get("nonce") ?? "",
        challenge: u.searchParams.get("code_challenge") ?? "",
        overrides,
      });
      const cb = new URL(u.searchParams.get("redirect_uri") ?? REDIRECT_URI);
      cb.searchParams.set("code", code);
      cb.searchParams.set("state", u.searchParams.get("state") ?? "");
      cb.searchParams.set("iss", ISSUER);
      return cb;
    },
  };
}
