/**
 * World ID Agent Pass over OIDC (authorization code + PKCE) using openid-client.
 *
 * openid-client does the generic work: discovery, signature and `iss`/`aud`/
 * `exp` checks, `state` and `nonce` matching, and the RFC 9207 `iss` response
 * parameter. This module adds what is specific to us: forcing a fresh login,
 * the `acr` claims request, and turning verified claims into an `AuthResult`
 * for the Rust binding check (which re-checks nonce, freshness and `acr`).
 *
 * The PKCE verifier is not stored: it is HMAC(client secret, attempt id), so
 * it is stable across the redirect and unguessable without the secret.
 */

import { createHmac } from "node:crypto";
import * as client from "openid-client";
import type { AuthResult } from "@/core";

export type WorldErrorKind =
  | "NOT_CONFIGURED"
  | "DISCOVERY_FAILED"
  | "AUTHORIZATION_ERROR"
  | "TOKEN_FAILED"
  | "MISSING_CLAIMS";

export class WorldError extends Error {
  constructor(
    readonly kind: WorldErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "WorldError";
  }
}

export interface WorldOidcConfig {
  issuer: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string;
  /** Injected in tests, and used to reach the in-process simulator. */
  fetch?: typeof fetch;
  /** Allow an http:// issuer. Only the simulator on localhost needs this; never set it for World. */
  allowInsecure?: boolean;
}

export interface AuthRequest {
  attemptId: string;
  state: string;
  nonce: string;
  /** Output of `acrClaimsParam`, or undefined when the tier has no acr constraint. */
  claims: string | undefined;
}

export interface WorldOidc {
  authorizationUrl(req: AuthRequest): Promise<URL>;
  /** Validates the callback and returns the verified ID token claims we bind on. */
  exchange(
    callbackUrl: URL,
    req: Pick<AuthRequest, "attemptId" | "state" | "nonce">,
  ): Promise<AuthResult>;
}

export function pkceVerifier(clientSecret: string, attemptId: string): string {
  return createHmac("sha256", clientSecret)
    .update(`kavach402-pkce:${attemptId}`)
    .digest("base64url");
}

export function createWorldOidc(config: WorldOidcConfig): WorldOidc {
  const { clientId, clientSecret } = config;
  if (!clientId || !clientSecret)
    throw new WorldError(
      "NOT_CONFIGURED",
      "WORLD_CLIENT_ID and WORLD_CLIENT_SECRET are required",
    );

  const customFetch: client.CustomFetch | undefined = config.fetch
    ? (url, options) =>
        (config.fetch as typeof fetch)(url, options as RequestInit)
    : undefined;

  let discovered: Promise<client.Configuration> | undefined;
  const getConfiguration = () => {
    discovered ??= client
      .discovery(
        new URL(config.issuer),
        clientId,
        undefined,
        client.ClientSecretPost(clientSecret),
        customFetch || config.allowInsecure
          ? {
              ...(customFetch && { [client.customFetch]: customFetch }),
              ...(config.allowInsecure && {
                execute: [client.allowInsecureRequests],
              }),
            }
          : undefined,
      )
      .then((c) => {
        if (customFetch) c[client.customFetch] = customFetch;
        return c;
      })
      .catch((e: unknown) => {
        discovered = undefined; // retry on the next request
        throw new WorldError(
          "DISCOVERY_FAILED",
          e instanceof Error ? e.message : String(e),
        );
      });
    return discovered;
  };

  return {
    async authorizationUrl(req) {
      const configuration = await getConfiguration();
      const params: Record<string, string> = {
        redirect_uri: config.redirectUri,
        scope: "openid",
        state: req.state,
        nonce: req.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(
          pkceVerifier(clientSecret, req.attemptId),
        ),
        code_challenge_method: "S256",
        // Every approval needs a login that happens now, not an old session.
        max_age: "0",
        prompt: "login",
      };
      if (req.claims) params.claims = req.claims;
      return client.buildAuthorizationUrl(configuration, params);
    },

    async exchange(callbackUrl, req) {
      const configuration = await getConfiguration();
      let claims: ReturnType<client.TokenEndpointResponseHelpers["claims"]>;
      try {
        const tokens = await client.authorizationCodeGrant(
          configuration,
          callbackUrl,
          {
            pkceCodeVerifier: pkceVerifier(clientSecret, req.attemptId),
            expectedState: req.state,
            expectedNonce: req.nonce,
            idTokenExpected: true,
          },
        );
        claims = tokens.claims();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (e instanceof client.AuthorizationResponseError)
          throw new WorldError("AUTHORIZATION_ERROR", e.error);
        throw new WorldError("TOKEN_FAILED", message);
      }
      if (!claims || typeof claims.nonce !== "string")
        throw new WorldError("MISSING_CLAIMS", "ID token has no nonce");

      return {
        iss: claims.iss,
        sub: claims.sub,
        nonce: claims.nonce,
        // A missing auth_time becomes NaN, which the binding check fails closed as STALE_AUTH.
        authTime:
          typeof claims.auth_time === "number" ? claims.auth_time : Number.NaN,
        acr: typeof claims.acr === "string" ? claims.acr : undefined,
      };
    },
  };
}
