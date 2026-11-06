# Kavach402

**A payment agent that checks a payment request before paying it.** Kavach402 reads the bill, link or screenshot privately on **0G Private Computer**, buys evidence from specialist checkers over **Hedera x402**, and if the risk is high it asks for **World ID Agent Pass** approval, with stronger proof required as the risk rises.

Built for ETHGlobal Mumbai 2026. Target tracks: Hedera "AI Agents That Pay: x402 on Hedera", World "Agent Pass", and 0G "Build with 0G Private Computer".

> **Status:** piece 2 of 10. The safety-critical core (risk policy, approval binding, canonical hashing, link intelligence) is written in **Rust**, compiled to WebAssembly and called from the Next.js app. No sponsor integrations yet. See [HANDOFF.md](HANDOFF.md) for exact status and [HOW_IT_WORKS.md](HOW_IT_WORKS.md) for the design.

## Prerequisites

- Node 22+ and pnpm 11
- Rust 1.99.1 (installed through [rustup](https://rustup.rs); `rust/rust-toolchain.toml` pins it and adds the `wasm32-unknown-unknown` target)
- `wasm-bindgen-cli` at **exactly** 0.2.130 (it must match the crate pin):

```bash
cargo install wasm-bindgen-cli --version 0.2.130 --locked
```

You only need Rust to change the Rust code. The compiled WASM is committed in `src/rust/pkg`, so `pnpm install && pnpm dev` works without it.

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm test
pnpm dev
```

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server, production build, production server |
| `pnpm lint` | Biome lint + format check (TypeScript) |
| `pnpm lint:rust` | `cargo fmt --check` + `cargo clippy -D warnings` |
| `pnpm format` | Biome, writing fixes |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `pnpm test` | Vitest: unit, bridge and **parity** suites (no network) |
| `pnpm test:coverage` | Same, with coverage thresholds on `src/core` and `src/rust/index.ts` |
| `pnpm test:rust` | `cargo test --workspace` (unit + property tests) |
| `pnpm build:wasm` | Rebuild the WASM and regenerate `src/rust/pkg` |
| `pnpm build:wasm:check` | Fail if the committed `src/rust/pkg` is stale (used in CI) |
| `pnpm test:live` | Live testnet smoke tests (`LIVE=1`, needs `.env`; added in piece 10) |
| `pnpm check` | Everything above except the dev server: run before every commit |

After changing anything under `rust/`, run `pnpm build:wasm` and commit the regenerated `src/rust/pkg`.

## Layout

```text
rust/
  kavach-core/   Pure Rust, no I/O: money, canonical JSON, assurance, policy, binding, linkintel, JSON api
  kavach-wasm/   wasm-bindgen wrapper (string in, string out)
src/
  core/          TypeScript reference implementation of the same logic (the executable spec)
  rust/          Typed bridge to the WASM, plus generated pkg/ (committed)
  adapters/      (piece 3+) 0G, Hedera/x402, World OIDC, Postgres, each behind a small interface
  app/           Next.js routes and UI (api/health today)
tests/
  unit/          Pure-function tests, bridge tests, route tests
  parity/        Differential tests: TypeScript core vs Rust/WASM on random inputs
  live/          (piece 10) real testnet calls, only with LIVE=1
scripts/
  build-wasm.mjs Reproducible WASM build + generated glue
```

## Why Rust for the core

Policy, approval binding, hashing and link analysis decide whether money moves, so they get the strictest tooling: no `unwrap`/`expect`/`panic`/unchecked indexing (enforced by clippy), `bigint`-style integer money, and fail-closed defaults. The TypeScript copy in `src/core` is kept as an executable spec: the parity suite feeds both the same random inputs and requires identical results, including identical failures.

## Tech stack

Next.js 16 (Node runtime), TypeScript strict, Rust 1.99 → WebAssembly (`wasm-bindgen`), pnpm with exact version pins, zod, Vitest + fast-check, proptest, Biome. Coming later: Drizzle + Neon Postgres, `@x402/*` + `@hiero-ledger/sdk`, the `openai` SDK pointed at the 0G router, `openid-client` for World Agent Pass. Deploys to Vercel.

## Docs

- [NEXT_DEVELOPER.md](NEXT_DEVELOPER.md): start here if you are continuing the work: reasoning, research, working style, build plan
- [docs/PLAN_v2.md](docs/PLAN_v2.md): the product plan (v1 kept as `docs/PLAN_v1_superseded.md`)
- [HOW_IT_WORKS.md](HOW_IT_WORKS.md): the flow, the policy table, the binding rules, the link-intel signals, the WASM boundary
- [HANDOFF.md](HANDOFF.md): current state, next steps, open questions, bugs found, change log
