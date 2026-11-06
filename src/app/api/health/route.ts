import { connection } from "next/server";
import { hashAction, hbar, sha256Hex } from "@/core";
import { analyzeLink, hashAction as rustHashAction, wasmVersion } from "@/rust";

/**
 * Deploy health check. Proves the WASM module loads on this platform and that
 * the Rust and TypeScript cores still agree on a fixed vector. Reports no
 * secrets and no configuration.
 *
 * With `cacheComponents` enabled, route handlers run on the Node runtime and
 * are dynamic by default, so no `runtime` / `dynamic` segment config is needed
 * (and Next rejects it). The Rust core needs Node: it is WebAssembly loaded
 * from inlined bytes.
 */
export async function GET() {
  // Opt out of build-time prerendering: the check must run on the live server.
  await connection();
  try {
    const action = {
      checkId: "health",
      payee: "0.0.5001",
      resource: "https://kavach.test/health",
      amount: hbar(1),
      verdictHash: sha256Hex("health"),
      version: 1,
    };
    const hashesAgree = rustHashAction(action) === hashAction(action);
    const linkEngineWorks =
      analyzeLink({ url: "https://hdfcbamk.com/" }).level === "high";
    const ok = hashesAgree && linkEngineWorks;
    return Response.json(
      { ok, wasmVersion: wasmVersion(), hashesAgree, linkEngineWorks },
      { status: ok ? 200 : 503 },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 503 },
    );
  }
}
