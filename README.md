# Kavach402

**A payment agent that checks a payment request before paying it.** Kavach402 reads the bill, link or screenshot privately on **0G Private Computer**, buys evidence from specialist checkers over **Hedera x402**, and if the risk is high it asks for **World ID Agent Pass** approval, with stronger proof required as the risk rises.

Built for ETHGlobal Mumbai 2026. Target tracks: Hedera "AI Agents That Pay: x402 on Hedera", World "Agent Pass", and 0G "Build with 0G Private Computer".

> **Status:** piece 1 of 9. The pure core is done: the risk policy engine and the approval binding. No sponsor integrations yet. See [HANDOFF.md](HANDOFF.md) for exact status and [HOW_IT_WORKS.md](HOW_IT_WORKS.md) for the design.

## Quick start

Needs Node 22+ and pnpm 11.

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm dev
```

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm lint` | Biome lint + format check |
| `pnpm format` | Biome format, writing changes |
| `pnpm typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `pnpm test` | Vitest unit + integration suites (no network) |
| `pnpm test:coverage` | Same, with coverage thresholds on `src/core` |
| `pnpm test:live` | Live testnet smoke tests (`LIVE=1`, needs `.env`; added in piece 9) |
| `pnpm check` | lint + typecheck + coverage tests (run before every commit) |

## Layout

```text
src/
  core/        Pure logic with no I/O: money, policy, assurance tiers, approval binding, hashing
  adapters/    (piece 2+) 0G, Hedera/x402, World OIDC, Postgres; each behind a small interface
  app/         Next.js routes and UI
tests/
  unit/        Pure-function tests, including property-based tests (fast-check)
  integration/ (piece 2+) Route handlers with fake adapters and msw-stubbed HTTP
  live/        (piece 9) Real testnet calls, only run with LIVE=1
```

## Tech stack

Next.js 16 (Node runtime), TypeScript strict, pnpm with exact version pins, zod, Vitest + fast-check, Biome. Coming in later pieces: Drizzle + Neon Postgres, `@x402/*` 2.30 + `@hiero-ledger/sdk`, `openai` SDK pointed at the 0G router, `openid-client` for World Agent Pass. Deploys to Vercel.

## Docs

- [HOW_IT_WORKS.md](HOW_IT_WORKS.md): the flow, the policy table, the binding rules
- [HANDOFF.md](HANDOFF.md): current state, next steps, open questions, change log
