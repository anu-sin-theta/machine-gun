/**
 * "Is this deployment ready to demo?" A checklist over the configuration and,
 * for what is configured, one cheap read-only call to each service. Used by
 * `GET /api/status` and the live tests. It never spends anything: no payment,
 * no model call, no on-chain write.
 *
 * Statuses: `ok` works, `warn` works but is risky or degraded, `missing` is
 * not configured (fine for a demo that stands it in), `fail` is configured
 * and broken.
 */

import type { Repositories } from "@/adapters/db";
import type { MirrorNode } from "@/adapters/hedera";
import type { AppConfig } from "@/config/env";

export type ReadinessStatus = "ok" | "warn" | "missing" | "fail";

export interface ReadinessItem {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface ReadinessDeps {
  fetch?: typeof fetch;
  mirror?: MirrorNode;
  repos?: Repositories;
  /** `process.env.NODE_ENV` and friends, injected for tests. */
  runtime?: { production: boolean; serverless: boolean };
}

/** Below this the agent can run out of HBAR mid-demo (tinybars). */
const LOW_BALANCE = 500_000_000n; // 5 HBAR

const item = (
  id: string,
  label: string,
  status: ReadinessStatus,
  detail: string,
): ReadinessItem => ({ id, label, status, detail });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function guarded(
  id: string,
  label: string,
  run: () => Promise<ReadinessItem>,
): Promise<ReadinessItem> {
  try {
    return await run();
  } catch (e) {
    return item(id, label, "fail", message(e));
  }
}

const hbar = (tinybars: bigint) => {
  const whole = tinybars / 100_000_000n;
  const frac = (tinybars % 100_000_000n)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} HBAR`;
};

export async function checkReadiness(
  config: AppConfig,
  deps: ReadinessDeps = {},
): Promise<ReadinessItem[]> {
  const doFetch = deps.fetch ?? fetch;
  const runtime = deps.runtime ?? {
    production: process.env.NODE_ENV === "production",
    serverless: Boolean(process.env.VERCEL),
  };
  const demo = config.agentMode === "demo";
  const simulated = config.world.mode === "simulated";
  const { hedera } = config;
  const items: ReadinessItem[] = [];

  items.push(
    item(
      "modes",
      "Modes",
      demo || simulated ? "warn" : "ok",
      `agent: ${config.agentMode}${demo ? " (0G, settlement and logs are stand-ins)" : ""}; World ID: ${config.world.mode}${simulated ? " (anyone can approve)" : ""}`,
    ),
  );

  // Storage
  if (!config.databaseUrl) {
    items.push(
      item(
        "database",
        "Database",
        runtime.serverless ? "fail" : "warn",
        runtime.serverless
          ? "no DATABASE_URL (or STORAGE_URL): the in-memory store is per instance, so approvals will break on serverless"
          : "no DATABASE_URL (or STORAGE_URL): using the in-memory store (lost on restart)",
      ),
    );
  } else if (deps.repos) {
    const repos = deps.repos;
    items.push(
      await guarded("database", "Database", async () => {
        await repos.checks.get("__readiness_probe__");
        return item("database", "Database", "ok", "reachable, tables present");
      }),
    );
  } else {
    items.push(item("database", "Database", "ok", "configured (not probed)"));
  }

  // Hedera
  const haveHedera =
    hedera.agentAccountId && hedera.agentPrivateKey && hedera.payeeAccountId;
  if (demo) {
    items.push(
      item("hedera", "Hedera accounts", "missing", "not needed in demo mode"),
    );
  } else if (!haveHedera) {
    items.push(
      item(
        "hedera",
        "Hedera accounts",
        "fail",
        "HEDERA_AGENT_ACCOUNT_ID, HEDERA_AGENT_PRIVATE_KEY and HEDERA_PAYEE_ACCOUNT_ID are required in live mode",
      ),
    );
  } else if (deps.mirror) {
    const mirror = deps.mirror;
    items.push(
      await guarded("hedera-agent", "Agent account", async () => {
        const balance = await mirror.getHbarBalance(
          hedera.agentAccountId as string,
        );
        if (balance === null)
          return item(
            "hedera-agent",
            "Agent account",
            "fail",
            `${hedera.agentAccountId} not found on ${hedera.network}`,
          );
        return item(
          "hedera-agent",
          "Agent account",
          balance < LOW_BALANCE ? "warn" : "ok",
          `${hedera.agentAccountId} holds ${hbar(balance)}${balance < LOW_BALANCE ? " (low: top up before the demo)" : ""}`,
        );
      }),
      await guarded("hedera-payee", "Payee account", async () => {
        const balance = await mirror.getHbarBalance(
          hedera.payeeAccountId as string,
        );
        return balance === null
          ? item(
              "hedera-payee",
              "Payee account",
              "fail",
              `${hedera.payeeAccountId} not found: the account must exist to receive payments`,
            )
          : item(
              "hedera-payee",
              "Payee account",
              "ok",
              `${hedera.payeeAccountId} exists`,
            );
      }),
    );
  } else {
    items.push(
      item("hedera", "Hedera accounts", "ok", "configured (not probed)"),
    );
  }

  if (!demo) {
    const topics = [
      ["audit", hedera.auditTopicId],
      ["reputation", hedera.reputationTopicId],
    ] as const;
    for (const [name, topicId] of topics) {
      const id = `hcs-${name}`;
      const label = `HCS ${name} topic`;
      if (!topicId) {
        items.push(
          item(
            id,
            label,
            "warn",
            "not set (run pnpm setup:hedera): logging is off",
          ),
        );
      } else if (deps.mirror) {
        const mirror = deps.mirror;
        items.push(
          await guarded(id, label, async () => {
            await mirror.listTopicMessages(topicId, { maxMessages: 1 });
            return item(id, label, "ok", `${topicId} readable`);
          }),
        );
      } else {
        items.push(item(id, label, "ok", `${topicId} configured (not probed)`));
      }
    }

    items.push(
      await guarded("x402", "x402 facilitator", async () => {
        const res = await doFetch(`${config.x402.facilitatorUrl}/supported`);
        if (!res.ok)
          return item(
            "x402",
            "x402 facilitator",
            "fail",
            `/supported returned ${res.status}`,
          );
        const body = (await res.json()) as {
          kinds?: Array<{ scheme: string; network: string }>;
        };
        const network = `hedera:${hedera.network}`;
        const ok = body.kinds?.some(
          (k) => k.scheme === "exact" && k.network === network,
        );
        return ok
          ? item(
              "x402",
              "x402 facilitator",
              "ok",
              `supports exact on ${network}`,
            )
          : item(
              "x402",
              "x402 facilitator",
              "fail",
              `does not list exact on ${network}`,
            );
      }),
    );

    const { zeroG } = config;
    if (!zeroG.apiKey || !zeroG.modelText) {
      items.push(
        item(
          "zerog",
          "0G Private Computer",
          "fail",
          "ZG_API_KEY and ZG_MODEL_TEXT are required in live mode",
        ),
      );
    } else {
      items.push(
        await guarded("zerog", "0G Private Computer", async () => {
          const res = await doFetch(`${zeroG.baseUrl}/models`, {
            headers: { authorization: `Bearer ${zeroG.apiKey}` },
          });
          if (res.status === 401 || res.status === 403)
            return item(
              "zerog",
              "0G Private Computer",
              "fail",
              "API key rejected",
            );
          if (!res.ok)
            return item(
              "zerog",
              "0G Private Computer",
              "fail",
              `/models returned ${res.status}`,
            );
          const body = (await res.json()) as { data?: Array<{ id: string }> };
          if (!Array.isArray(body.data))
            return item(
              "zerog",
              "0G Private Computer",
              "ok",
              `key works (the model list was not returned, so ${zeroG.modelText} is unverified)`,
            );
          const listed = body.data.some((m) => m.id === zeroG.modelText);
          return !listed
            ? item(
                "zerog",
                "0G Private Computer",
                "warn",
                `key works but model ${zeroG.modelText} is not in the list`,
              )
            : item(
                "zerog",
                "0G Private Computer",
                "ok",
                `key works, trust mode ${zeroG.trustMode}, model ${zeroG.modelText}`,
              );
        }),
      );
    }
  }

  // World ID
  if (simulated) {
    items.push(
      item(
        "world",
        "World ID",
        runtime.production ? "warn" : "ok",
        runtime.production
          ? "simulated in production: the approval page checks no one"
          : "simulated issuer",
      ),
    );
    if (runtime.serverless && !config.world.simulator?.privateKeyBase64)
      items.push(
        item(
          "world-sim-key",
          "Simulator signing key",
          "warn",
          "WORLD_SIM_KEY unset: each serverless instance signs with its own key (run pnpm gen:sim-key)",
        ),
      );
  } else if (!config.world.clientId || !config.world.clientSecret) {
    items.push(
      item(
        "world",
        "World ID",
        "fail",
        "WORLD_CLIENT_ID and WORLD_CLIENT_SECRET are required (or WORLD_MODE=simulated)",
      ),
    );
  } else {
    items.push(
      await guarded("world", "World ID", async () => {
        const res = await doFetch(
          `${config.world.issuer}/.well-known/openid-configuration`,
        );
        if (!res.ok)
          return item(
            "world",
            "World ID",
            "fail",
            `discovery returned ${res.status}`,
          );
        const doc = (await res.json()) as { acr_values_supported?: string[] };
        const advertised = doc.acr_values_supported ?? [];
        const wanted = [
          ...(config.world.acr.human ?? []),
          ...(config.world.acr.strong ?? []),
        ];
        const missing = wanted.filter((a) => !advertised.includes(a));
        return missing.length
          ? item(
              "world",
              "World ID",
              "warn",
              `issuer reachable, but does not advertise ${missing.join(", ")}`,
            )
          : item(
              "world",
              "World ID",
              "ok",
              `issuer reachable; redirect URI ${config.world.redirectUri} must be registered`,
            );
      }),
    );
  }

  // The page and JSON routes spend money in live mode.
  items.push(
    config.apiToken
      ? item(
          "api-token",
          "API token",
          "ok",
          "JSON routes require a bearer token",
        )
      : item(
          "api-token",
          "API token",
          demo ? "ok" : "warn",
          demo
            ? "not set (nothing real can be spent in demo mode)"
            : "API_TOKEN unset: /api/checks is open and spends money and 0G credits",
        ),
  );

  return items;
}

export function summarize(items: readonly ReadinessItem[]): {
  ready: boolean;
  fail: number;
  warn: number;
} {
  const fail = items.filter((i) => i.status === "fail").length;
  const warn = items.filter((i) => i.status === "warn").length;
  return { ready: fail === 0, fail, warn };
}

export function formatReadiness(items: readonly ReadinessItem[]): string {
  const mark: Record<ReadinessStatus, string> = {
    ok: "OK     ",
    warn: "WARN   ",
    missing: "MISSING",
    fail: "FAIL   ",
  };
  return items
    .map((i) => `${mark[i.status]} ${i.label}: ${i.detail}`)
    .join("\n");
}
