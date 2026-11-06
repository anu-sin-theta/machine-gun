# Handoff

_Read this first when picking up the project. Update it after every change._

> **Starting fresh?** Read [NEXT_DEVELOPER.md](NEXT_DEVELOPER.md) first: it explains the reasoning behind the decisions, the researched API facts, the working style the user expects, and a detailed plan for pieces 3-10.

## Current state: piece 2 of 10 done

Build plan: 1 scaffold + TS core ✅ · **2 Rust core + WASM bridge ✅** · 3 config + database · 4 0G adapter · 5 Hedera adapter (HCS, mirror node) · 6 x402 checker/merchant endpoints + paying client · 7 World Agent Pass · 8 agent loop · 9 UI + Playwright · 10 live smoke tests, Vercel deploy, submission docs.

### What exists

| Area | Where | Notes |
|---|---|---|
| TypeScript core (**reference implementation**) | `src/core` | money, canonical JSON + sha256, assurance tiers, policy, approval binding |
| Rust core (**production implementation**) | `rust/kavach-core` | the same five modules, plus the new `linkintel` engine and a JSON `api` layer |
| WASM crate | `rust/kavach-wasm` | thin `wasm-bindgen` wrapper, string-in/string-out |
| Generated WASM + glue | `src/rust/pkg` | **committed**, produced by `pnpm build:wasm`; binary inlined as base64 |
| Typed TS bridge | `src/rust/index.ts` | mirrors `@/core`; bigint in/out; throws `KavachError` |
| Health endpoint | `src/app/api/health/route.ts` | dynamic; proves WASM loads on the live server and Rust == TS on a fixed vector |
| Env template | `.env.example`, local `.env` (git-ignored, empty values) | validated by zod in piece 3 |

**Rule for later pieces:** production code calls `@/rust`. `@/core` stays as the executable spec that the parity tests compare against (and as the source of shared types and tiny helpers like `hbar()`). Do not change one implementation without the other: the parity suite will fail.

### Verified (Nov 6, this machine)

`pnpm check` is green end to end: Biome, rustfmt, clippy (`-D warnings`, with `unwrap`/`expect`/`panic`/indexing denied), 80 Rust tests, WASM-is-up-to-date check, 99 JS tests (100% line coverage, 98.6% branch). `pnpm build` succeeds. A real `next start` server returned 200 from `/api/health` (WASM loaded, ~2.5 ms/request).

The differential tests were mutation-checked: deliberately breaking the TS hard-cap comparison (`>` → `>=`) and the TS auth-time skew direction both made the parity suite fail. Both were reverted.

### Real bugs found along the way (so nobody re-introduces them)

1. **TS `canonicalJson` was not RFC 8785.** It built an object in sorted order then `JSON.stringify`-ed it, but JavaScript enumerates integer-like keys (`"0"`, `"10"`) first regardless of insertion order, so `{"0":0,"":""}` came out as `{"0":0,"":""}` instead of `{"":"","0":0}`. Found by the Rust/TS differential test, fixed by hand-building the string, regression tests added. It was deterministic, so approval binding was never unsafe, but the hashes would not have matched any other implementation (or an HCS verifier).
2. **Link-intel missed lookalikes in subdomains** (`paypa1.com.account-verify.top`). I only ran the lookalike/swap/confusable checks on the registrable label. Now run over all host tokens. Found by probing the engine's actual signals after a score assertion failed.
3. **`LinkIntelConfig` serialised as `suspicious_tlds`** while everything else is camelCase. Fixed with `rename_all = "camelCase"`.
4. **JSON can't carry `NaN`/`Infinity`**: `JSON.stringify(NaN)` is `null`, so a non-finite `authTime` made Rust reject the input while TS returned `STALE_AUTH`. Rust now reads `null` as NaN (fails closed as `STALE_AUTH`).
5. **Next 16 `cacheComponents` is on** (from the scaffold): route handlers may not export `runtime`/`dynamic`, and a handler with no request-time API is **prerendered at build time**. The health check calls `await connection()` to stay dynamic. Remember this for every new route handler.

### Tooling notes

- Rust is installed via rustup (1.99.1, pinned in `rust/rust-toolchain.toml`) with the `wasm32-unknown-unknown` target, plus `wasm-bindgen-cli 0.2.130` (**must match the `wasm-bindgen` crate pin exactly**).
- If `cargo: command not found` in a shell that was open before the install: `. "$HOME/.cargo/env"`.
- `scripts/build-wasm.mjs` remaps absolute paths (`--remap-path-prefix`) so the binary is identical on every machine, patches the async-init `new URL(...)` line out of the glue (bundlers would otherwise try to resolve a missing asset) and **fails the build if wasm-bindgen's glue format changes**.
- The committed WASM is 2.09 MB (2.79 MB as base64). Most of it is ICU/Unicode data pulled in by `idna`/`url`/`psl`/`unicode-security`. Fine for Vercel; shrink later with `wasm-opt` or by trimming features if cold starts matter.
- pnpm 11 reads settings from `pnpm-workspace.yaml`, not `.npmrc`. The npm registry was very slow during install (fetch timeout raised to 10 min).
- Biome ignores `src/rust/pkg` (generated) and `rust/target`.

### Not done / not verified

- **Nothing is committed.** Git is initialised on `main`; CI has never run on GitHub. The `build:wasm:check` step (byte-identical rebuild on Linux CI) is **unverified**: if it fails on the first CI run, the cause is a toolchain or path difference, not a logic bug.
- No `.env` values yet (the file exists with empty placeholders). Nothing reads env until piece 3.
- Link intel has **no TypeScript oracle** (it is new code), so it's covered by Rust unit + property tests and bridge smoke tests only. The default brand list is a starting point and needs curation.
- `src/app/page.tsx` is still the create-next-app placeholder.

## Next: piece 3, config and database

1. `src/config/env.ts`: zod-validated env mirroring `.env.example`. Fail fast with readable errors. Policy limits come from `POLICY_*` and go through `parsePolicyConfig` (the Rust one).
2. Drizzle + Neon: tables `checks`, `pending_approvals` (unique index on `state`), `auto_spend_ledger` (per day per asset), `used_nonces`.
3. Repository interfaces in `src/adapters/db` with an in-memory fake for tests.
4. Atomic consume: a single conditional `UPDATE ... WHERE status='approved'` so two concurrent callbacks can't both pay. (`consumeApproval` in the core is the pure state transition; the DB enforces atomicity.)
5. Tests: env parsing (good / missing / bad), repository contract tests run against the fake and, with `LIVE=1`, Neon.

## Open questions / risks

| # | Question | Where it matters | How to resolve |
|---|---|---|---|
| 1 | Can World's test environment issue `selfie` / `orb-face` `acr` values? | tier mapping (`AcrRequirements`, configurable in both cores) | Try once the portal client exists; if not, change the defaults in both cores and note it in WORLD_FEEDBACK.md |
| 2 | Does World's `claims` parameter want `value` or `values`? The docs show both | piece 7 | Test against the live issuer |
| 3 | Is there a 0G model with private mode + vision? | piece 4 | Check `pc.0g.ai/models`; fallback tesseract.js OCR then a private text model |
| 4 | Does the Blocky402 testnet facilitator accept HBAR or only HTS? | piece 6 | `curl https://api.testnet.blocky402.com/supported` |
| 5 | 0G balance must be funded before the demo or every call returns `402 insufficient_balance` | piece 4 / demo | Fund early; add a balance check to `/api/health` |
| 6 | Link-intel false positives: one-letter edits of 4-5 letter brands (`apply`/`apple`) are only *medium*; real-world tuning is untested | piece 8 | Run it over a list of real payee domains; adjust `LinkIntelConfig` |
| 7 | Domain age (RDAP) and redirect-chain following are *inputs* to link intel; nothing fetches them yet | piece 6/8 | A TS adapter does the network work and passes results in |
| 8 | Does `build:wasm:check` reproduce byte-for-byte on the Linux CI runner? | CI | First CI run |

## Decisions log

- **Tracks:** Hedera x402, World Agent Pass, 0G Private Computer. Dropped "Agents That Pay for Themselves": HBAR earnings can't fund 0G compute without a bridge.
- **Stack:** one layered Next.js app in `machine-gun/`, Vercel + Neon, pure core with adapters behind interfaces.
- **Safety-critical core in Rust (WASM),** at the user's request: policy, approval binding, canonical JSON + hashing, assurance tiers, and the new link-intel engine. WASM (not napi, not a separate service) so it deploys to Vercel with no native binaries. Binary is inlined and committed because Vercel's build has no Rust toolchain.
- **TypeScript core kept as the spec.** Differential/property tests run both implementations on the same random inputs and require identical outputs, including identical failures.
- **JSON string boundary.** Money crosses as decimal strings, never numbers. Every WASM export returns an envelope `{"ok":true,"value":…}` / `{"ok":false,"error":{"kind","message"}}` and never throws or panics (`panic = "deny"` lints, `panic = "abort"` in release).
- **Fail closed everywhere:** missing/unknown verdict → high risk; non-finite `auth_time` → stale; any hashing failure → `ACTION_CHANGED`.
- **Approval binding is stored server-side** (World has no `authorization_details`); the action hash is re-checked on callback.

## Change log

- **Piece 2 (Rust core + WASM bridge):** `.env.example` + local `.env` (fixed `.gitignore` so `.env.example` is tracked); Rust workspace (`kavach-core`, `kavach-wasm`) with money, canonical, assurance, policy, binding, linkintel and a JSON API; WASM build script + committed output; typed TS bridge; parity/differential test suite; fixed the TS canonical-JSON bug above; `/api/health`; CI now builds and tests Rust; docs updated.
- **Piece 1:** scaffold (package `kavach402`, Node ≥ 22), strict TS, Biome, Vitest + fast-check, `src/core` with unit and property tests, docs.
