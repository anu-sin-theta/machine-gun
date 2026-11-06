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
 └──────────┬───────────┘   (payee reputation, link intel ◄── BUILT, second opinion)
            ▼
 ┌──────────────────────┐   0G turns the evidence into a verdict:
 │ 3. Verdict            │── low | medium | high + reasons, request ID #2
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐   rust/kavach-core/src/policy.rs  ◄── BUILT (pieces 1-2)
 │ 4. Policy decision    │── auto-pay | step-up(tier) | block
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐   World ID Agent Pass, OIDC max_age=0 + acr claims
 │ 5. Human step-up      │── approval tied to the exact payment
 └──────────┬───────────┘   rust/kavach-core/src/binding.rs  ◄── BUILT (pieces 1-2)
            ▼
 ┌──────────────────────┐
 │ 6. Settle or block    │── x402 payment on Hedera; every outcome logged to HCS
 └──────────────────────┘
```

Steps 1, 3, 5 (the OIDC transport) and 6, and the network half of step 2, are later pieces. The pure logic for steps 2 (link analysis), 4 and 5 (approval checking) is built and tested.

**Where the code lives.** The logic below is implemented twice: in Rust (`rust/kavach-core`, compiled to WASM and used by the app through `src/rust`) and in TypeScript (`src/core`, kept as an executable spec). The section names the TypeScript file; the Rust file has the same name under `rust/kavach-core/src/`. See "The Rust/WASM boundary" at the end.

## Policy engine (`policy.ts` / `policy.rs`)

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

## Assurance tiers (`assurance.ts` / `assurance.rs`)

| Tier | Used for | Accepted `acr` values (World OIDC) |
|---|---|---|
| `fresh` | low risk but over a limit | any; freshness comes from `max_age=0` |
| `human` | medium risk | `selfie`, `selfie-face`, `orb`, `orb-face` |
| `strong` | high risk (override) | `orb-face` only |

These are sent as the OIDC `claims` parameter: `{"id_token":{"acr":{"essential":true,"values":[...]}}}`. The mapping is configurable, because we haven't yet confirmed which classes World's test environment can issue (see HANDOFF.md).

## Approval binding (`binding.ts` / `binding.rs`)

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

- `money`: amounts are integer base units (`bigint` in TypeScript, `i128` in Rust; 1 HBAR = 10⁸ tinybars). Formatting is exact. On the wire they are decimal **strings**, never JSON numbers.
- `canonical`: **RFC 8785 (JCS)** canonical JSON + sha256. Keys are ordered by UTF-16 code unit (so U+1F600 sorts before U+FFFF, and `""` before `"0"`), numbers use ES6 formatting, bigints become strings. Both implementations produce byte-identical output, verified on thousands of random values. Used for action hashes now, and later for verdict hashes and HCS payloads.

## Link intelligence (`rust/kavach-core/src/linkintel.rs`)

Static analysis of a payment link and its redirect chain, written only in Rust (no TypeScript copy). It is **pure**: it never touches the network. A TypeScript adapter will follow redirects and look up domain age (RDAP) and pass the results in, so the engine stays deterministic and testable.

`analyze(input, config) → report`, where the input is `{ url, redirectChain?, domainAgeDays? }`.

**Signals** (each has a severity, a stage of `entry` or `landing`, and a human-readable detail):

| Signal | Severity | Triggers on |
|---|---|---|
| `INVALID_URL`, `NON_HTTP_SCHEME` | high | unparseable link; `javascript:`, `data:`, `upi:`, `ftp:` and so on |
| `USERINFO_IN_URL` | high | `https://paypal.com@evil.example`: the real host is after the `@` |
| `IP_HOST` | high | raw IPv4/IPv6 (including `http://3232235777` decimal form) |
| `INVALID_PUNYCODE`, `MIXED_SCRIPT` | high | broken `xn--` labels; a label mixing scripts (Latin + Cyrillic) |
| `CONFUSABLE_BRAND` | high | a host token whose Unicode *skeleton* equals a brand token (`аррӏе` ↔ `apple`) |
| `BRAND_IMPERSONATION` | high | brand name used in a host that isn't one of its domains: `paypal.com.evil.xyz`, `sbi-secure-login.top` |
| `LOOKALIKE_BRAND` | high / medium | character swaps (`paypa1`, `rnicrosoft`), a hyphen-split name (`hdfc-bank`), or one edit from a brand token (`hdfcbamk`). **Medium** when the brand token is only 4-5 letters, since `apply`/`apple` are ordinary words. Checked on every host token, subdomains included |
| `NEW_DOMAIN` | high < 7 days, medium < 30, low < 90 | only when `domainAgeDays` is supplied; unknown age is *not* a signal |
| `REDIRECT_DOWNGRADE` | high | https → http hop |
| `REDIRECT_CROSS_DOMAIN` | medium | hop to a different registrable domain |
| `HTTP_NOT_HTTPS`, `URL_SHORTENER` | medium | unencrypted link; bit.ly-style destination hiding |
| `SUSPICIOUS_TLD`, `NONSTANDARD_PORT`, `NO_REGISTRABLE_DOMAIN`, `EXCESSIVE_SUBDOMAINS`, `LONG_HOST`, `MANY_HYPHENS`, `LONG_REDIRECT_CHAIN`, `IDN_DOMAIN` | low | weak hints |

The landing page of a redirect chain gets the same host and URL checks as the entry URL (stage `landing`), so a shortener that lands on a fake bank is caught.

**Scoring.** Weights are info 0, low 10, medium 25, high 50; the score is the sum capped at 100. Level is `high` if any signal is high or the score is at least 50, `medium` if at least 20, else `low`. Signals are sorted most severe first and de-duplicated, so output is deterministic. An unparseable link is simply `high`, never an error.

**The brand list** (`LinkIntelConfig`) ships with Indian and global brands (SBI, HDFC, ICICI, Axis, Paytm, PhonePe, NPCI, IRCTC, UIDAI, Income Tax, Jio, Airtel, Amazon, Flipkart, PayPal, Google, Microsoft, Apple), each with identifying tokens and the registrable domains it really owns. It is configurable per call and still needs curation and false-positive tuning.

**Invariants, enforced by property tests:** never panics on arbitrary strings or URL-shaped input; deterministic and sorted; any high signal implies a high level; a brand's own domains (and their subdomains) never trigger impersonation or lookalike signals.

## The Rust/WASM boundary

```text
 TypeScript app ──► src/rust/index.ts ──► generated glue ──► kavach_wasm (inlined bytes)
   bigint money      typed wrappers        wasm-bindgen          rust/kavach-wasm
                     toJson / unwrap                                  │
                                                                      ▼
                                                      rust/kavach-core  src/api.rs
```

- **Strings in, strings out.** Every export takes JSON strings and returns one JSON string. Money is a decimal string; `JSON.stringify` of a `bigint` is handled by the bridge's replacer.
- **Envelope, never an exception.** Success is `{"ok":true,"value":…}`; failure is `{"ok":false,"error":{"kind","message"}}` with kinds `InvalidAmount | InvalidConfig | InvalidAction | InvalidInput | IllegalTransition | Canonicalization`. The bridge turns failures into `KavachError`. Business outcomes ("blocked", `ACTION_CHANGED`) are *values*, not errors.
- **No panics.** `unwrap`, `expect`, `panic!` and unchecked indexing are denied by clippy; release builds use `panic = "abort"`; a property test throws garbage at every export and requires a valid envelope back.
- **Non-finite numbers.** JSON has no `NaN`/`Infinity`; `JSON.stringify` writes `null`. Rust reads a `null` `authTime` as NaN, which fails closed as `STALE_AUTH`, exactly like the TypeScript core.
- **Loading.** The `.wasm` is inlined as base64 in `src/rust/pkg/kavach_wasm_bytes.ts` and loaded with `initSync`. There are no filesystem lookups and no output-file-tracing config, so it behaves the same under Node, Next.js on Vercel and Vitest. The async init path in the glue is patched out so bundlers don't look for a missing asset.
- **Committed build output.** `src/rust/pkg` is generated by `pnpm build:wasm` and committed (Vercel's build has no Rust). CI runs `pnpm build:wasm:check` to fail if it's stale. The build remaps absolute paths so it's reproducible across machines.
- **Health.** `GET /api/health` runs on every request, loads the WASM, and checks that Rust and TypeScript hash a fixed action identically and that the link engine flags a known lookalike.

## How we know the two implementations agree

`tests/parity` runs the TypeScript core and the Rust bridge on the **same random inputs** and requires identical results, *including identical failures*:

| Suite | What it compares |
|---|---|
| policy | `decide` over random amounts, assets, verdicts (incl. missing/unknown), spend and configs, plus every boundary of the demo policy; `parsePolicyConfig` accept/reject and value |
| hashing | `canonicalJson` / `hashCanonical` over arbitrary JSON, full-range Unicode and handpicked tricky values (key order, escapes, number formats); `hashAction` against a golden hash |
| binding | `createPendingApproval` (including every invalid input), then `validateApproval`, `statusAfterValidation` and `consumeApproval` over random scenarios, plus a mutation-based generator that starts from a valid approval and applies one defect at a time so **every outcome** (approved and all nine failure reasons) is reached and checked; `acrClaimsParam` |

The suite has been mutation-checked: breaking either implementation in a small way makes it fail. It already found a real bug in the TypeScript `canonicalJson` (see HANDOFF.md).
