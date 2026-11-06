# Kavach402

**A payment agent that checks a payment request before it pays.**

Give it a bill, a message or a link. It reads the request privately on **0G Private Computer**, buys evidence from specialist checkers over **Hedera x402**, decides with a spending policy, and when the risk is high it asks a human for a **World ID Agent Pass** approval, with a stronger proof required the riskier the payment looks.

Built for ETHGlobal Mumbai 2026. Tracks: Hedera "AI Agents That Pay: x402 on Hedera", World "Agent Pass", 0G "Build with 0G Private Computer". Per-track write-up: [docs/TRACKS.md](docs/TRACKS.md).

## Try it in one minute, no keys

```bash
pnpm install
AGENT_MODE=demo WORLD_MODE=simulated pnpm dev
```

Open http://localhost:3000 and click an example. Five requests cover every path: an ordinary bill (paid on its own), a phishing scam (held for the strongest World ID), a request that names the wrong account, rent over the agent's limit (needs approval) and tuition over the hard cap (blocked). The 3-minute walkthrough is in [docs/DEMO.md](docs/DEMO.md).

In this mode three things are **labelled stand-ins**, and the page says so: the 0G model (a keyword heuristic), merchant settlement (an invented transaction id) and World ID (a consent page where you choose the result). Everything else is the real code.

## What is real and what is verified

| | Status |
|---|---|
| Spending policy, approval binding, canonical hashing, link analysis | **Verified.** Rust compiled to WebAssembly; 80 Rust tests incl. property tests; a TypeScript copy is checked against it on random inputs (parity suite) |
| Agent loop (probe, read, buy evidence, judge, decide, step up, pay, audit) | **Verified with fakes.** Scenario tests incl. concurrency and replay |
| World ID flow (PKCE, state, nonce, `acr`, fresh `auth_time`, single use) | **Verified** end to end against a built-in OIDC issuer using the same code path as the real one; World's real discovery document is accepted (live test) |
| Postgres adapter and migration | **Verified** against a real Postgres engine (PGlite). Not yet run on Neon itself |
| x402 server | **Partly verified live.** A real request returned a correct HBAR payment challenge, with the fee payer from the Blocky402 testnet facilitator. **No payment has been settled** |
| Agent registry and verifier directory | **Verified** with fakes and on real Postgres (PGlite): listing rules, endpoint safety, selection, per-verifier payment guard. Only the three built-in verifiers exist; other agents can ask to be listed (proof of control, then an operator activates), merchants can come from the registry, a third party's lone `high` counts as `medium`, and endpoints are fetched through an address-checking fetch; **none of it has touched Hedera or a real DNS attacker** (see [docs/MARKETPLACE.md](docs/MARKETPLACE.md)) |
| Task marketplace (workers, accounts, tasks, agent card) | **Verified** with fakes, on real Postgres (PGlite) and over HTTP against the production build in demo mode. **No task has paid a worker on Hedera yet**; the built-in worker is rules, not a model (see [docs/TASKS.md](docs/TASKS.md)) |
| Browser behaviour | **Verified.** 17 Playwright tests on the production build |
| 0G calls, Hedera writes (HCS), x402 settlement, a real World login, Neon, Vercel | **Not yet verified live.** Written and unit-tested; they need credentials. The live tests exist and skip with a reason until you add them (`pnpm test:live`) |

Counts at the time of writing: 634 JavaScript tests (33 files), 80 Rust tests, 17 browser tests.

## How it decides

```text
 request + merchant URL
   1. merchant's own 402 challenge  -> who gets paid, how much   (the text is never trusted for this)
   2. 0G (private mode)             -> payee, link, pressure tactics
   3. registered verifiers over x402 -> link analysis (two), payee reputation   (per-verifier spend guard)
   4. 0G                            -> risk verdict; evidence can raise it, never lower it
   5. Rust policy                   -> auto-pay | step-up(tier) | block
   6. World ID                      -> approval tied to the exact payment; stronger tier for higher risk
   7. x402 payment on Hedera        -> every step logged to HCS
```

Rules that hold everywhere: money moves in exactly one function, reached only from an `auto-pay` decision or a consumed approval (spent once, by a database compare-and-set); a missing risk review counts as high risk; an unreachable checker counts as medium; a request that names a different payee than the merchant's challenge is high risk. Details and the policy table are in [HOW_IT_WORKS.md](HOW_IT_WORKS.md).

## Modes

| Setting | Values | Meaning |
|---|---|---|
| `AGENT_MODE` | `live` (default), `demo` | `demo` replaces 0G, settlement and the on-chain logs with labelled local stand-ins |
| `WORLD_MODE` | `real` (default), `simulated` | `simulated` runs the same OIDC flow against an issuer inside the app. It checks no one: anyone who can reach the app can approve a payment |

Adding real World credentials changes only the client id and secret (a checklist is in [HANDOFF.md](HANDOFF.md)). Never run `simulated` where real money can move.

## Prerequisites

- Node 22+ and pnpm 11
- Rust 1.99.1 and `wasm-bindgen-cli` 0.2.130, **only if you change the Rust code**. The compiled WASM is committed in `src/rust/pkg`, so `pnpm install && pnpm dev` works without them:

```bash
cargo install wasm-bindgen-cli --version 0.2.130 --locked
```

## Going live

```bash
cp .env.example .env     # fill in the keys you have
pnpm db:migrate          # needs DATABASE_URL (Neon)
pnpm setup:hedera        # creates the two HCS topics, prints their ids for .env
pnpm test:live           # each live test skips with a reason if its credentials are missing
```

`GET /api/status` (bearer `API_TOKEN`) lists what is configured and reachable and what is wrong. Deploying to Vercel: [docs/DEPLOY.md](docs/DEPLOY.md).

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server, production build, production server |
| `pnpm check` | Lint, Rust lint, typecheck, Rust tests, WASM freshness, unit tests with coverage. Run before every commit |
| `pnpm test` / `pnpm test:coverage` | Vitest: unit, bridge and parity suites (no network) |
| `pnpm test:rust` | `cargo test --workspace` |
| `pnpm test:e2e` | Build, then Playwright in demo + simulated mode (`pnpm exec playwright install chromium` once) |
| `pnpm test:live` | Live smoke tests; need real credentials in `.env` |
| `pnpm lint` / `pnpm lint:rust` / `pnpm format` / `pnpm typecheck` | Biome, rustfmt + clippy, Biome with fixes, strict `tsc` |
| `pnpm build:wasm` / `pnpm build:wasm:check` | Rebuild the WASM and regenerate `src/rust/pkg` / fail if it is stale |
| `pnpm db:migrate` | Apply `drizzle/` migrations to `DATABASE_URL` |
| `pnpm setup:hedera` | Create the HCS audit and reputation topics |
| `pnpm gen:sim-key` | Print a `WORLD_SIM_KEY` for multi-instance deployments of the simulator |

After changing anything under `rust/`, run `pnpm build:wasm` and commit the regenerated `src/rust/pkg`.

## Layout

```text
rust/
  kavach-core/   Pure Rust, no I/O: money, canonical JSON, assurance, policy, binding, linkintel, JSON api
  kavach-wasm/   wasm-bindgen wrapper (string in, string out)
src/
  core/          TypeScript reference implementation of the same logic (the executable spec)
  rust/          Typed bridge to the WASM, plus generated pkg/ (committed)
  adapters/      db (Postgres/Neon, memory), zerog, hedera (HCS, mirror), x402, world (OIDC, simulator)
  marketplace/   Agent registry: listings, endpoint safety, verifier directory, onboarding, built-in verifiers and demo worker
  tasks/         Accounts, task flow (a task payment is a Kavach402 check), worker ports, answer screening, agent card
  agent/         The loop (pipeline.ts), x402-backed ports, demo mode
  ops/           Readiness checklist behind /api/status
  ui/            Plain-language wording and the view model
  components/    Result card and request form
  app/           Next.js page, server action and API routes
e2e/             Playwright tests (demo + simulated mode)
frontend/        A separate animated front end (own package.json, port 3001) that was added outside this build. It is excluded from this repo's lint and typecheck and is not covered by the tests or checks described here
tests/
  unit/          Pure-function, adapter, route and agent tests
  parity/        Differential tests: TypeScript core vs Rust/WASM on random inputs
  contract/      One repository contract run against memory, PGlite and (live) Neon
  live/          Real-service tests; skip with a reason without credentials
drizzle/         SQL migration
scripts/         WASM build, migrate, HCS topic setup, simulator key
docs/            DEMO.md, DEPLOY.md, TRACKS.md
```

## Why Rust for the core

Policy, approval binding, hashing and link analysis decide whether money moves, so they get the strictest tooling: no `unwrap`/`expect`/`panic`/unchecked indexing (enforced by clippy), integer money (`i128` in Rust, `bigint` in TypeScript, decimal strings on the wire) and fail-closed defaults. The TypeScript copy in `src/core` is an executable spec: the parity suite feeds both the same random inputs and requires identical results, including identical failures. It found a real bug in the first TypeScript canonical-JSON implementation (see HANDOFF.md).

## Tech stack

Next.js 16 and React 19 (Node runtime), TypeScript strict, Rust 1.99 compiled to WebAssembly (`wasm-bindgen`), Drizzle with Neon Postgres, `@x402/*` and `@hiero-ledger/sdk` for Hedera, the `openai` SDK pointed at the 0G router, `openid-client` for World ID, zod, Tailwind 4, Vitest, fast-check, proptest, PGlite, Playwright, Biome. Exact version pins throughout.

## Docs

- [docs/DEMO.md](docs/DEMO.md): a 3-minute walkthrough and a live-demo checklist
- [docs/TRACKS.md](docs/TRACKS.md): what we built for each sponsor track, where it is in the code, and how to check it
- [docs/TASKS.md](docs/TASKS.md): agents hiring agents: list a worker (OpenAI-compatible endpoint), get an account token, propose a task, watch its progress; every task payment goes through the firewall
- [docs/MARKETPLACE.md](docs/MARKETPLACE.md): the agent registry, what a verifier agent must build to be listed, and what is not built yet
- [docs/DEPLOY.md](docs/DEPLOY.md): Vercel and Neon, environment variables, preflight, limits
- [HOW_IT_WORKS.md](HOW_IT_WORKS.md): the flow, the policy table, the binding rules, link signals, the WASM boundary
- [WORLD_FEEDBACK.md](WORLD_FEEDBACK.md): notes for the World team from building against the OIDC issuer
- [HANDOFF.md](HANDOFF.md): current state, open questions, bugs found, decisions, change log
