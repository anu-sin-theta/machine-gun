import { randomBytes } from "node:crypto";
import type { CheckRecord } from "@/adapters/db";
import { getRepositories } from "@/adapters/db";
import { getConfig } from "@/config/env";
import type { BoundAction } from "@/core";
import type { ApprovalDeps } from "./approvals";
import { createWorldOidc, type WorldOidc } from "./oidc";
import { createSimulator, type Simulator } from "./simulator";

export * from "./approvals";
export * from "./oidc";
export {
  createSimulator,
  type Simulator,
  type SimulatorConfig,
} from "./simulator";

/**
 * The payment a check asks for, as bound into an approval. Null until the
 * check has a payee, resource, amount and verdict hash. The version is fixed at
 * 1 until editing a check is supported (any edit must bump it).
 */
export function actionFromCheck(check: CheckRecord): BoundAction | null {
  if (!check.payee || !check.resource || !check.amount || !check.verdictHash)
    return null;
  return {
    checkId: check.id,
    payee: check.payee,
    resource: check.resource,
    amount: check.amount,
    verdictHash: check.verdictHash,
    version: 1,
  };
}

let oidc: WorldOidc | undefined;
let simulator: Simulator | null | undefined;

/** The in-app issuer, or null unless `WORLD_MODE=simulated`. */
export function getSimulator(): Simulator | null {
  if (simulator !== undefined) return simulator;
  const { world } = getConfig();
  simulator =
    world.mode === "simulated" && world.simulator && world.clientId
      ? createSimulator({
          issuer: world.issuer,
          clientId: world.clientId,
          secret: world.simulator.secret,
          redirectUri: world.redirectUri,
          privateKeyBase64: world.simulator.privateKeyBase64,
        })
      : null;
  return simulator;
}

/** Calls to the simulated issuer stay in-process; everything else goes out normally. */
function simulatorFetch(sim: Simulator, issuer: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.url.startsWith(issuer)
      ? sim.handle(request)
      : fetch(request);
  }) as typeof fetch;
}

/** Dependencies for the running process. Throws `WorldError("NOT_CONFIGURED")` without World credentials. */
export function getApprovalDeps(): ApprovalDeps {
  const config = getConfig();
  const sim = getSimulator();
  oidc ??= createWorldOidc(
    sim
      ? {
          ...config.world,
          fetch: simulatorFetch(sim, config.world.issuer),
          allowInsecure: config.world.issuer.startsWith("http:"),
        }
      : config.world,
  );
  const repos = getRepositories();
  return {
    repos,
    oidc,
    issuer: config.world.issuer,
    source: config.world.mode === "simulated" ? "simulated" : "world",
    acr: config.world.acr,
    ttlMs: config.approvalTtlMs,
    now: () => Date.now(),
    random: (bytes) => randomBytes(bytes).toString("base64url"),
    getCurrentAction: async (checkId) => {
      const check = await repos.checks.get(checkId);
      return check ? actionFromCheck(check) : null;
    },
  };
}
