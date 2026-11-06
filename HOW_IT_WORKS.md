# How Kavach402 works

## The flow

```text
 payment request (screenshot / invoice / link / x402 402-challenge)
            │
            ▼
 ┌──────────────────────┐   0G Private Computer, private (TEE) mode
 │ 1. Private reading    │── extracts payee, amount, deadline, pressure tactics
 └──────────┬───────────┘   request ID #1
            ▼
 ┌──────────────────────┐   the agent pays specialist checkers over Hedera x402,
 │ 2. Paid evidence      │── no human involved, within a per-check budget
 └──────────┬───────────┘   (payee reputation, link intel, second opinion)
            ▼
 ┌──────────────────────┐   0G turns the evidence into a verdict:
 │ 3. Verdict            │── low | medium | high + reasons, request ID #2
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐   src/core/policy.ts  ◄── BUILT (piece 1)
 │ 4. Policy decision    │── auto-pay | step-up(tier) | block
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐   World ID Agent Pass, OIDC max_age=0 + acr claims
 │ 5. Human step-up      │── approval tied to the exact payment
 └──────────┬───────────┘   src/core/binding.ts  ◄── BUILT (piece 1)
            ▼
 ┌──────────────────────┐
 │ 6. Settle or block    │── x402 payment on Hedera; every outcome logged to HCS
 └──────────────────────┘
```

Steps 1–3, 5 (the OIDC transport) and 6 are later pieces. Steps 4 and 5's checking logic are built and tested.

## Policy engine (`src/core/policy.ts`)

A pure function `decide(ctx, config) → Decision`. Rules are checked in order and the first match wins:

| # | Condition | Decision | Overridable? |
|---|---|---|---|
| 1 | amount ≤ 0 | `block` `INVALID_AMOUNT` | no |
| 2 | asset has no configured limits | `block` `ASSET_NOT_ALLOWED` | no |
| 3 | amount > asset `hardCap` | `block` `OVER_HARD_CAP` | no |
| 4 | verdict missing | treated as **high** (`VERDICT_MISSING`), so it fails closed | — |
| 5 | high risk | `step-up` tier **strong**, `blockedByDefault: true` | only with strong proof |
| 6 | medium risk | `step-up` tier **human** | yes |
| 7a | low risk, amount > `autoCap` | `step-up` tier **fresh** (`OVER_AUTO_CAP`) | yes |
| 7b | low risk, today's auto spend + amount > `dailyAutoBudget` | `step-up` tier **fresh** (`OVER_DAILY_AUTO_BUDGET`) | yes |
| 7c | low risk, within both limits | `auto-pay` | — |

**Invariants, enforced by property tests:**
- Only low risk is ever auto-paid.
- Nothing is auto-paid above `autoCap` or past `dailyAutoBudget`.
- Raising the risk level or the amount never makes the decision more lenient.
- Config is validated with zod: `autoCap ≤ hardCap`, `autoCap ≤ dailyAutoBudget`, and amounts are `bigint` only (no float money).

## Assurance tiers (`src/core/assurance.ts`)

| Tier | Used for | Accepted `acr` values (World OIDC) |
|---|---|---|
| `fresh` | low risk but over a limit | any; freshness comes from `max_age=0` |
| `human` | medium risk | `selfie`, `selfie-face`, `orb`, `orb-face` |
| `strong` | high risk (override) | `orb-face` only |

These are sent as the OIDC `claims` parameter: `{"id_token":{"acr":{"essential":true,"values":[...]}}}`. The mapping is configurable, because we haven't yet confirmed which classes World's test environment can issue (see HANDOFF.md).

## Approval binding (`src/core/binding.ts`)

World's OIDC has no `authorization_details`, so we can't put the payment inside the token. Instead:

1. **Before redirecting,** `createPendingApproval` stores the exact `BoundAction` (check ID, payee account, x402 resource, amount, verdict hash, version). It also stores its sha256 `actionHash`, the required `acr` set, `state` and `nonce` (at least 16 characters each, and different from each other), and an expiry.
2. **On callback,** `validateApproval` re-checks everything against the action **as it stands now**. A failure at any step blocks the payment:

| Check | Failure reason |
|---|---|
| attempt is still `pending` (blocks replay) | `NOT_PENDING` |
| not past `expiresAt` | `EXPIRED` |
| `iss` is World's issuer | `ISSUER_MISMATCH` |
| `nonce` matches (constant-time comparison) | `NONCE_MISMATCH` |
| same `(iss, sub)` if the account is already linked | `SUBJECT_MISMATCH` |
| `auth_time` is after the attempt started (within 5 s clock skew), so an old session can't be reused | `STALE_AUTH` |
| `auth_time` is not in the future | `AUTH_TIME_IN_FUTURE` |
| `acr` is **exactly** one of the required values | `INSUFFICIENT_ASSURANCE` |
| hash of the current action equals the stored hash | `ACTION_CHANGED` |

3. **Status changes:** `pending → approved | denied (access_denied) | expired | rejected`, then `approved → consumed` **exactly once**. `consumeApproval` throws on a second call, so a replayed approval can't pay twice.

## Money and hashing

- `src/core/money.ts`: amounts are integer base units as `bigint` (1 HBAR = 10⁸ tinybars). Formatting is exact.
- `src/core/canonical.ts`: canonical JSON (sorted keys, bigints as strings) + sha256. Used for action hashes now, and later for verdict hashes and HCS payloads.
