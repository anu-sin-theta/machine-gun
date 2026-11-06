/**
 * Validated runtime configuration.
 *
 * `loadConfig(source)` is pure (the environment is passed in) so it can be
 * tested without touching `process.env`. Empty strings count as unset, which
 * lets `.env.example` ship with blank placeholders.
 *
 * Integration groups (database, Hedera, 0G, World) are optional until their
 * piece lands, but a group that is only partly filled in is an error: half a
 * config is always a mistake. Policy limits go through the Rust
 * `parsePolicyConfig`, so the app and the policy engine share one validator.
 */

import { z } from "zod";
import type { AcrRequirements, PolicyConfig } from "@/core";
import { ACR, isHederaEntityId } from "@/core";
import { parsePolicyConfig } from "@/rust";

const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());
const withDefault = <T extends z.ZodType>(schema: T, value: z.output<T>) =>
  z.preprocess(blankToUndefined, schema.default(value as never));

const url = z.url();
const hederaId = z
  .string()
  .refine(isHederaEntityId, "must look like 0.0.12345");
const acrValue = z.enum([ACR.orb, ACR.orbFace, ACR.selfie, ACR.selfieFace]);
/** Comma-separated acr URIs, e.g. "https://world.org/oidc/acr/orb,https://world.org/oidc/acr/orb-face". */
const acrList = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(acrValue).min(1));
/** Comma-separated URLs; only their origins are kept. */
const originList = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()))
  .transform((urls) => urls.map((u) => new URL(u).origin));
const units = z.string().regex(/^[1-9]\d*$/, "must be a positive integer");

const envSchema = z.object({
  APP_BASE_URL: withDefault(url, "http://localhost:3000"),

  // "demo" replaces 0G, merchant settlement and the on-chain logs with labelled local stand-ins (no keys, no money).
  AGENT_MODE: withDefault(z.enum(["live", "demo"]), "live"),
  // Extra origins the agent may fetch merchant payment requests from (the app's own origin is always allowed).
  MERCHANT_ORIGINS: withDefault(originList, []),

  // When set, /api/checks requires "Authorization: Bearer <token>" (it spends money and 0G credits).
  API_TOKEN: optional(z.string().min(16)),

  DATABASE_URL: optional(z.string().min(1)),

  HEDERA_NETWORK: withDefault(z.enum(["testnet", "mainnet"]), "testnet"),
  HEDERA_AGENT_ACCOUNT_ID: optional(hederaId),
  HEDERA_AGENT_PRIVATE_KEY: optional(z.string().min(1)),
  HEDERA_PAYEE_ACCOUNT_ID: optional(hederaId),
  HEDERA_HCS_AUDIT_TOPIC_ID: optional(hederaId),
  HEDERA_HCS_REPUTATION_TOPIC_ID: optional(hederaId),
  HEDERA_MIRROR_NODE_URL: withDefault(
    url,
    "https://testnet.mirrornode.hedera.com",
  ),

  X402_FACILITATOR_URL: withDefault(url, "https://api.testnet.blocky402.com"),

  ZG_BASE_URL: withDefault(url, "https://router-api.0g.ai/v1"),
  ZG_API_KEY: optional(z.string().min(1)),
  ZG_MODEL_TEXT: optional(z.string().min(1)),
  ZG_MODEL_VISION: optional(z.string().min(1)),
  ZG_TRUST_MODE: withDefault(z.enum(["private", "verified"]), "private"),

  // "simulated" runs World's OIDC flow against an issuer built into this app (demo and dev only).
  WORLD_MODE: withDefault(z.enum(["real", "simulated"]), "real"),
  // Secret for the simulator's authorization codes. Optional: a built-in dev value is used.
  WORLD_SIM_SECRET: optional(z.string().min(16)),
  // Base64 of a PKCS#8 PEM RSA key so every instance signs with the same key. Optional: generated per process.
  WORLD_SIM_KEY: optional(z.string().min(100)),
  WORLD_ISSUER: withDefault(url, "https://auth.world.org"),
  WORLD_CLIENT_ID: optional(z.string().min(1)),
  WORLD_CLIENT_SECRET: optional(z.string().min(1)),
  // Defaults to <APP_BASE_URL>/api/worldid/callback. Must match what is registered with World.
  WORLD_REDIRECT_URI: optional(url),

  // World's discovery document advertises only orb and orb-face, so those are the defaults.
  WORLD_ACR_HUMAN: withDefault(acrList, [ACR.orb, ACR.orbFace]),
  WORLD_ACR_STRONG: withDefault(acrList, [ACR.orbFace]),

  POLICY_HBAR_AUTO_CAP: withDefault(units, "200000000"),
  POLICY_HBAR_HARD_CAP: withDefault(units, "5000000000"),
  POLICY_HBAR_DAILY_AUTO_BUDGET: withDefault(units, "500000000"),
  APPROVAL_TTL_SECONDS: withDefault(
    z.coerce.number().int().min(30).max(3600),
    600,
  ),
});

type Env = z.infer<typeof envSchema>;

/** Keys that must be set together, or not at all. */
const GROUPS: Record<string, readonly (keyof Env)[]> = {
  hedera: [
    "HEDERA_AGENT_ACCOUNT_ID",
    "HEDERA_AGENT_PRIVATE_KEY",
    "HEDERA_PAYEE_ACCOUNT_ID",
  ],
  zeroG: ["ZG_API_KEY", "ZG_MODEL_TEXT"],
  world: ["WORLD_CLIENT_ID", "WORLD_CLIENT_SECRET"],
};

export const SIM_CLIENT_ID = "sim_client";
/** Not a secret: simulated approvals are open to anyone who can reach the app anyway. */
export const SIM_DEV_SECRET = "kavach402-simulated-world-dev-secret";

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(
      `Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export interface AppConfig {
  baseUrl: string;
  /** Origins merchant resources may be fetched from. Includes the app's own. */
  merchantOrigins: string[];
  agentMode: "live" | "demo";
  apiToken: string | undefined;
  databaseUrl: string | undefined;
  hedera: {
    network: "testnet" | "mainnet";
    agentAccountId: string | undefined;
    agentPrivateKey: string | undefined;
    payeeAccountId: string | undefined;
    auditTopicId: string | undefined;
    reputationTopicId: string | undefined;
    mirrorNodeUrl: string;
  };
  x402: { facilitatorUrl: string };
  zeroG: {
    baseUrl: string;
    apiKey: string | undefined;
    modelText: string | undefined;
    modelVision: string | undefined;
    trustMode: "private" | "verified";
  };
  world: {
    issuer: string;
    clientId: string | undefined;
    clientSecret: string | undefined;
    redirectUri: string;
    /** Accepted `acr` values per assurance tier. */
    acr: AcrRequirements;
    /** "simulated" means the issuer is this app's own simulator, not World. */
    mode: "real" | "simulated";
    /** Only set in simulated mode. */
    simulator: { secret: string; privateKeyBase64: string | undefined } | null;
  };
  policy: PolicyConfig;
  approvalTtlMs: number;
}

export function loadConfig(
  source: Record<string, string | undefined>,
): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const env = parsed.data;

  const issues: string[] = [];
  const simulated = env.WORLD_MODE === "simulated";
  if (simulated && (env.WORLD_CLIENT_ID || env.WORLD_CLIENT_SECRET))
    issues.push(
      "world: WORLD_MODE=simulated ignores WORLD_CLIENT_ID/WORLD_CLIENT_SECRET; remove them or set WORLD_MODE=real",
    );
  for (const [group, keys] of Object.entries(GROUPS)) {
    if (group === "world" && simulated) continue;
    const set = keys.filter((k) => env[k] !== undefined);
    if (set.length > 0 && set.length < keys.length) {
      const missing = keys.filter((k) => env[k] === undefined);
      issues.push(`${group}: ${missing.join(", ")} must be set too`);
    }
  }

  for (const acr of env.WORLD_ACR_STRONG) {
    if (!env.WORLD_ACR_HUMAN.includes(acr))
      issues.push(
        `world: WORLD_ACR_STRONG value ${acr} must also be in WORLD_ACR_HUMAN`,
      );
  }

  let policy: PolicyConfig | undefined;
  try {
    policy = parsePolicyConfig({
      limits: {
        HBAR: {
          autoCap: env.POLICY_HBAR_AUTO_CAP,
          hardCap: env.POLICY_HBAR_HARD_CAP,
          dailyAutoBudget: env.POLICY_HBAR_DAILY_AUTO_BUDGET,
        },
      },
    });
  } catch (e) {
    issues.push(`policy: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (issues.length > 0 || !policy) throw new ConfigError(issues);

  return {
    baseUrl: env.APP_BASE_URL,
    apiToken: env.API_TOKEN,
    agentMode: env.AGENT_MODE,
    merchantOrigins: [
      ...new Set([new URL(env.APP_BASE_URL).origin, ...env.MERCHANT_ORIGINS]),
    ],
    databaseUrl: env.DATABASE_URL,
    hedera: {
      network: env.HEDERA_NETWORK,
      agentAccountId: env.HEDERA_AGENT_ACCOUNT_ID,
      agentPrivateKey: env.HEDERA_AGENT_PRIVATE_KEY,
      payeeAccountId: env.HEDERA_PAYEE_ACCOUNT_ID,
      auditTopicId: env.HEDERA_HCS_AUDIT_TOPIC_ID,
      reputationTopicId: env.HEDERA_HCS_REPUTATION_TOPIC_ID,
      mirrorNodeUrl: env.HEDERA_MIRROR_NODE_URL,
    },
    x402: { facilitatorUrl: env.X402_FACILITATOR_URL },
    zeroG: {
      baseUrl: env.ZG_BASE_URL,
      apiKey: env.ZG_API_KEY,
      modelText: env.ZG_MODEL_TEXT,
      modelVision: env.ZG_MODEL_VISION,
      trustMode: env.ZG_TRUST_MODE,
    },
    world: {
      issuer: simulated
        ? `${new URL(env.APP_BASE_URL).origin}/api/sim-world`
        : env.WORLD_ISSUER,
      clientId: simulated ? SIM_CLIENT_ID : env.WORLD_CLIENT_ID,
      clientSecret: simulated
        ? (env.WORLD_SIM_SECRET ?? SIM_DEV_SECRET)
        : env.WORLD_CLIENT_SECRET,
      redirectUri:
        env.WORLD_REDIRECT_URI ??
        `${new URL(env.APP_BASE_URL).origin}/api/worldid/callback`,
      mode: env.WORLD_MODE,
      simulator: simulated
        ? {
            secret: env.WORLD_SIM_SECRET ?? SIM_DEV_SECRET,
            privateKeyBase64: env.WORLD_SIM_KEY,
          }
        : null,
      acr: {
        fresh: null,
        human: env.WORLD_ACR_HUMAN,
        strong: env.WORLD_ACR_STRONG,
      },
    },
    policy,
    approvalTtlMs: env.APPROVAL_TTL_SECONDS * 1000,
  };
}

let cached: AppConfig | undefined;

/** Config for the running process, validated once on first use. */
export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env);
  return cached;
}
