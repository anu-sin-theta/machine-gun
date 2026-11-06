/**
 * A stand-in for World's OIDC issuer, for demos and local development when
 * there are no World credentials yet.
 *
 * It is a real (if tiny) OIDC provider: discovery document, JWKS, an
 * authorization endpoint that shows a consent page, and a token endpoint that
 * checks the client secret, redirect URI and PKCE and signs RS256 ID tokens.
 * Our code talks to it through exactly the same openid-client path it uses for
 * World, so nothing but the issuer URL, client id and secret changes when the
 * real credentials are added.
 *
 * What it is not: an identity check. The consent page lets whoever is at the
 * browser pick the outcome, including an `acr` the request did not ask for, so
 * a rejected approval can be demonstrated. Never enable it where real money
 * can move. Every approval it produces is labelled `simulated` in the audit log.
 *
 * Stateless apart from the signing key: authorization codes are HS256 JWTs, so
 * any instance can redeem a code issued by another. Set the same signing key
 * on every instance (WORLD_SIM_KEY) or run a single instance.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import {
  exportJWK,
  generateKeyPair,
  importPKCS8,
  type JWK,
  jwtVerify,
  SignJWT,
} from "jose";
import { ACR } from "@/core";

export interface SimulatorConfig {
  /** Public issuer URL, e.g. `http://localhost:3000/api/sim-world`. */
  issuer: string;
  clientId: string;
  /** Client secret and HMAC key for authorization codes. */
  secret: string;
  /** The only redirect URI the simulator will send a user back to. */
  redirectUri: string;
  /** Base64 of a PKCS#8 PEM RSA private key; generated per process if absent. */
  privateKeyBase64?: string | undefined;
  now?: () => number;
}

export interface Simulator {
  handle(req: Request): Promise<Response>;
}

const CODE_TTL_SEC = 300;
const ID_TOKEN_TTL_SEC = 600;
const KID = "sim-1";

/** What the consent page offers. `selfie` is deliberately below what World advertises. */
const CHOICES = [
  {
    id: "orb-face",
    acr: ACR.orbFace,
    label: "Approve with Orb + face (orb-face)",
  },
  { id: "orb", acr: ACR.orb, label: "Approve with Orb (orb)" },
  {
    id: "selfie",
    acr: ACR.selfie,
    label: "Approve with a weaker login (selfie)",
  },
] as const;

type KeyPair = { privateKey: CryptoKey; jwk: JWK };
const keyCache = new Map<string, Promise<KeyPair>>();

function loadKey(privateKeyBase64: string | undefined): Promise<KeyPair> {
  const cacheKey = privateKeyBase64 ?? "ephemeral";
  let pending = keyCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      if (privateKeyBase64) {
        const pem = Buffer.from(privateKeyBase64, "base64").toString("utf8");
        const privateKey = await importPKCS8(pem, "RS256", {
          extractable: true,
        });
        const {
          d: _d,
          p: _p,
          q: _q,
          dp: _dp,
          dq: _dq,
          qi: _qi,
          ...pub
        } = await exportJWK(privateKey);
        return {
          privateKey,
          jwk: { ...pub, kid: KID, alg: "RS256", use: "sig" },
        };
      }
      const pair = await generateKeyPair("RS256", { extractable: true });
      const pub = await exportJWK(pair.publicKey);
      return {
        privateKey: pair.privateKey,
        jwk: { ...pub, kid: KID, alg: "RS256", use: "sig" },
      };
    })();
    keyCache.set(cacheKey, pending);
  }
  return pending;
}

const esc = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const sha256b64url = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const noStore = { "cache-control": "no-store", pragma: "no-cache" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...noStore },
  });

const tokenError = (error: string, status = 400) => json({ error }, status);

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      ...noStore,
    },
  });

interface AuthorizeRequest {
  state: string;
  nonce: string;
  challenge: string;
  /** acr values the relying party asked for, or null if it set no constraint. */
  requestedAcr: string[] | null;
}

function requestedAcrValues(claims: string | null): string[] | null {
  if (!claims) return null;
  try {
    const values = JSON.parse(claims)?.id_token?.acr?.values;
    return Array.isArray(values) ? values.map(String) : null;
  } catch {
    return null;
  }
}

export function createSimulator(config: SimulatorConfig): Simulator {
  const issuerUrl = new URL(config.issuer);
  const basePath = issuerUrl.pathname.replace(/\/$/, "");
  const now = config.now ?? (() => Date.now());
  const secretKey = new TextEncoder().encode(config.secret);

  const discovery = {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    jwks_uri: `${config.issuer}/jwks`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    scopes_supported: ["openid"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: [
      "iss",
      "sub",
      "aud",
      "exp",
      "iat",
      "nonce",
      "auth_time",
      "acr",
    ],
    acr_values_supported: [ACR.orb, ACR.orbFace],
    prompt_values_supported: ["login"],
    claims_parameter_supported: true,
    authorization_response_iss_parameter_supported: true,
  };

  /** Validates the parts of an authorization request the simulator relies on. */
  function parseAuthorize(
    params: URLSearchParams,
  ): { ok: true; req: AuthorizeRequest } | { ok: false; error: string } {
    const get = (k: string) => params.get(k) ?? "";
    if (get("client_id") !== config.clientId)
      return { ok: false, error: "unknown client_id" };
    // Never redirect anywhere but the registered URI.
    if (get("redirect_uri") !== config.redirectUri)
      return {
        ok: false,
        error: "redirect_uri does not match the registered one",
      };
    if (get("response_type") !== "code")
      return { ok: false, error: "only response_type=code is supported" };
    if (!get("scope").split(" ").includes("openid"))
      return { ok: false, error: "scope must include openid" };
    if (get("code_challenge_method") !== "S256")
      return { ok: false, error: "PKCE with S256 is required" };
    if (!/^[A-Za-z0-9_-]{43}$/.test(get("code_challenge")))
      return { ok: false, error: "malformed code_challenge" };
    if (!get("state")) return { ok: false, error: "state is required" };
    if (!get("nonce")) return { ok: false, error: "nonce is required" };
    return {
      ok: true,
      req: {
        state: get("state"),
        nonce: get("nonce"),
        challenge: get("code_challenge"),
        requestedAcr: requestedAcrValues(params.get("claims")),
      },
    };
  }

  const errorPage = (message: string) =>
    html(
      `<!doctype html><meta charset="utf-8"><title>Simulated World ID</title>
<body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem">
<h1>Simulated World ID: request rejected</h1><p>${esc(message)}</p></body>`,
      400,
    );

  function consentPage(
    params: URLSearchParams,
    req: AuthorizeRequest,
  ): Response {
    const hidden = [...params.entries()]
      .map(
        ([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`,
      )
      .join("");
    const asked = req.requestedAcr
      ? req.requestedAcr.map((a) => `<code>${esc(a)}</code>`).join(", ")
      : "any login";
    const buttons = CHOICES.map((c) => {
      const meets =
        req.requestedAcr === null || req.requestedAcr.includes(c.acr);
      return `<button name="choice" value="${c.id}">${esc(c.label)}<small>${
        meets ? "meets the request" : "does NOT meet the request"
      }</small></button>`;
    }).join("");
    return html(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulated World ID</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:34rem;margin:2.5rem auto;padding:0 1rem;line-height:1.45}
 .banner{background:#fff3cd;border:1px solid #e0b100;border-radius:8px;padding:.75rem 1rem;margin-bottom:1.25rem}
 button{display:block;width:100%;text-align:left;margin:.5rem 0;padding:.75rem 1rem;font:inherit;border:1px solid #888;border-radius:8px;background:#fff;cursor:pointer}
 button small{display:block;color:#555}
 button.deny{border-color:#b00020;color:#b00020}
</style>
<body>
<div class="banner"><strong>SIMULATION.</strong> This is not World ID and checks no one's identity.
It stands in for World while no credentials are configured. You choose the result.</div>
<h1>Approve this payment?</h1>
<p>Kavach402 asked for a fresh login with: ${asked}.</p>
<form method="post" action="${esc(`${basePath}/authorize`)}">${hidden}${buttons}
<button class="deny" name="choice" value="deny">Deny<small>return access_denied</small></button></form>
</body></html>`);
  }

  async function issueCode(
    req: AuthorizeRequest,
    acr: string,
  ): Promise<string> {
    return new SignJWT({
      typ: "code",
      cid: config.clientId,
      ru: config.redirectUri,
      nonce: req.nonce,
      cc: req.challenge,
      acr,
      at: Math.floor(now() / 1000),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(now() / 1000))
      .setExpirationTime(Math.floor(now() / 1000) + CODE_TTL_SEC)
      .sign(secretKey);
  }

  function redirectBack(query: Record<string, string>): Response {
    const url = new URL(config.redirectUri);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set("iss", config.issuer);
    return new Response(null, {
      status: 303,
      headers: { location: url.toString(), ...noStore },
    });
  }

  async function authorizePost(req: Request): Promise<Response> {
    const form = await req.formData().catch(() => null);
    if (!form) return errorPage("expected a form submission");
    const params = new URLSearchParams();
    let choice = "";
    for (const [k, v] of form.entries()) {
      if (typeof v !== "string") continue;
      if (k === "choice") choice = v;
      else params.set(k, v);
    }
    const parsed = parseAuthorize(params);
    if (!parsed.ok) return errorPage(parsed.error);
    if (choice === "deny")
      return redirectBack({ error: "access_denied", state: parsed.req.state });
    const picked = CHOICES.find((c) => c.id === choice);
    if (!picked) return errorPage("unknown choice");
    const code = await issueCode(parsed.req, picked.acr);
    return redirectBack({ code, state: parsed.req.state });
  }

  async function tokenPost(req: Request): Promise<Response> {
    const form = new URLSearchParams(await req.text());
    const get = (k: string) => form.get(k) ?? "";
    if (get("grant_type") !== "authorization_code")
      return tokenError("unsupported_grant_type");
    if (
      get("client_id") !== config.clientId ||
      !safeEqual(get("client_secret"), config.secret)
    )
      return tokenError("invalid_client", 401);

    let claims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(get("code"), secretKey, {
        algorithms: ["HS256"],
        currentDate: new Date(now()),
      });
      claims = payload;
    } catch {
      return tokenError("invalid_grant");
    }
    if (claims.typ !== "code" || claims.cid !== config.clientId)
      return tokenError("invalid_grant");
    if (claims.ru !== get("redirect_uri")) return tokenError("invalid_grant");
    if (
      !get("code_verifier") ||
      sha256b64url(get("code_verifier")) !== claims.cc
    )
      return tokenError("invalid_grant");

    const { privateKey } = await loadKey(config.privateKeyBase64);
    const issuedAt = Math.floor(now() / 1000);
    const idToken = await new SignJWT({
      nonce: claims.nonce as string,
      auth_time: claims.at as number,
      acr: claims.acr as string,
    })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(config.issuer)
      // A single fixed pairwise-looking subject: one simulated human.
      .setSubject(
        `sim-${sha256b64url(`${config.clientId}:simulated-human`).slice(0, 24)}`,
      )
      .setAudience(config.clientId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ID_TOKEN_TTL_SEC)
      .sign(privateKey);
    return json({
      access_token: sha256b64url(`${get("code")}:at`),
      token_type: "Bearer",
      expires_in: ID_TOKEN_TTL_SEC,
      id_token: idToken,
    });
  }

  return {
    async handle(req) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith(basePath))
        return json({ error: "not found" }, 404);
      const path = url.pathname.slice(basePath.length) || "/";
      const method = req.method.toUpperCase();

      if (method === "GET" && path === "/.well-known/openid-configuration")
        return json(discovery);
      if (method === "GET" && path === "/jwks")
        return json({ keys: [(await loadKey(config.privateKeyBase64)).jwk] });
      if (method === "GET" && path === "/authorize") {
        const parsed = parseAuthorize(url.searchParams);
        return parsed.ok
          ? consentPage(url.searchParams, parsed.req)
          : errorPage(parsed.error);
      }
      if (method === "POST" && path === "/authorize") return authorizePost(req);
      if (method === "POST" && path === "/token") return tokenPost(req);
      return json({ error: "not found" }, 404);
    },
  };
}
