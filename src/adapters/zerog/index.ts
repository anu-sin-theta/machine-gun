import { getConfig } from "@/config/env";
import { createZeroG } from "./client";
import type { ZeroG } from "./types";

export { createZeroG, type ZeroGClientConfig } from "./client";
export * from "./types";
export { applyEvidenceFloor, hashVerdict, maxLevel } from "./verdict";

let cached: ZeroG | undefined;

/** Client for the running process. Throws `ZeroGError("NOT_CONFIGURED")` without keys. */
export function getZeroG(): ZeroG {
  cached ??= createZeroG(getConfig().zeroG);
  return cached;
}
