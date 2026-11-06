# Handoff

_Read this first when picking up the project. Update it after every change._

## Current state: piece 1 of 9 done

**Done:**
- Next.js 16.4.5 scaffold (App Router, `src/`, Tailwind v4, Biome), pnpm with exact pins (`.npmrc` `save-exact=true`).
- Stricter TypeScript: target ES2022 (needed for bigint literals), `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- The pure core in `src/core`: `money`, `canonical`, `assurance`, `policy`, `binding`. See HOW_IT_WORKS.md.
- Tests in `tests/unit/core`: example-based and property-based (fast-check). Coverage thresholds on `src/core` are 95% lines, 90% branches.
- GitHub Actions CI (`.github/workflows/ci.yml`): lint → typecheck → coverage tests → build.

**Verified locally (Nov 6):** `pnpm check` passes: lint clean, typecheck clean, 70/70 tests. Coverage on `src/core`: 100% lines, 96.9% branches; `policy.ts` and `assurance.ts` are at 100% lines and branches. `pnpm build` succeeds.

**Tooling notes:**
- pnpm 11 reads settings from `pnpm-workspace.yaml` (`saveExact`, fetch timeouts), not `.npmrc`.
- `typecheck` runs `next typegen` first, because `LayoutProps` is a generated type.
- `vitest.config.mts` uses Vite's native `resolve.tsconfigPaths`. Biome allows `!` in `tests/**` only.
- The npm registry was very slow on install (timeouts at 40 KiB/s); fetch timeout was raised to 10 min.

**Not done / not verified:**
- Git is initialized on `main`, but **nothing is committed yet**, so CI hasn't run on GitHub.
- No `.env.example` or config loading yet (piece 2).
- The home page is still the create-next-app placeholder.

## Next: piece 2, config and database

1. `src/config/env.ts`: zod-validated env (`HEDERA_*`, `ZG_*`, `WORLD_*`, `DATABASE_URL`, policy limits). Fail fast at startup with readable errors. Add `.env.example`.
2. Policy limits come from env and are parsed with `parsePolicyConfig`.
3. Drizzle + Neon: tables `checks`, `pending_approvals` (with a unique index on `state`), `auto_spend_ledger` (per day per asset), `used_nonces`.
4. Repository interfaces in `src/adapters/db`, plus an in-memory fake for tests.
5. Atomic state changes: consuming an approval must be a single conditional `UPDATE ... WHERE status='approved'` so two concurrent callbacks can't both pay.
6. Tests: env parsing (good, missing and bad values), repository contract tests run against both the fake and (with `LIVE=1`) Neon.

## Open questions / risks

| # | Question | Where it matters | How to resolve |
|---|---|---|---|
| 1 | Can World's test environment issue `selfie`/`orb-face` `acr` values? | `assurance.ts` tier mapping | Try it once the portal client exists. If not, change `DEFAULT_ACR_REQUIREMENTS` and note it in WORLD_FEEDBACK.md |
| 2 | Does the World `claims` parameter use `value` or `values`? The docs show both | piece 6 | Test against the live issuer |
| 3 | Is there a 0G model with private mode + vision? | piece 3 | Check `pc.0g.ai/models`. Fallback: tesseract.js OCR, then a private text model |
| 4 | Does the Blocky402 testnet facilitator accept HBAR or only HTS? | piece 5 | `curl https://api.testnet.blocky402.com/supported` |
| 5 | 0G balance must be funded before the demo, or every call returns `402 insufficient_balance` | piece 3 / demo | Fund early, add a balance check to the health endpoint |

## Decisions log

- **Tracks:** Hedera x402, World Agent Pass, 0G Private Computer. Dropped "Agents That Pay for Themselves": HBAR earnings can't fund 0G compute without a bridge.
- **Stack:** a single layered Next.js app in `machine-gun/`, Vercel + Neon, pure core with adapters behind interfaces.
- **Fail closed everywhere:** a missing or invalid verdict counts as high risk, and an unknown risk level counts as high.
- **Money is `bigint` base units only.** zod rejects numbers in the policy config.
- **Approval binding is stored server-side** (World has no `authorization_details`). The action hash is re-checked on callback.

## Change log

- **Piece 1:** scaffold (package renamed `kavach402`, `engines.node >= 22`, `@types/node` 22), strict TS, Biome, Vitest + fast-check, CI, `src/core` (money, canonical, assurance, policy, binding) with 70 unit and property tests, and the README / HOW_IT_WORKS / HANDOFF docs.
