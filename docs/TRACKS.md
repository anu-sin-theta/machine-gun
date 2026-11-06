# Sponsor tracks

What Kavach402 does for each track, where the code is, what has been checked, and what has not. "Verified" means an automated test or a command run during the build; "not verified live" means it is written and unit-tested but has not touched the real service yet because no credentials were available. See [README.md](../README.md) for the whole picture.

## Hedera: "AI Agents That Pay: x402 on Hedera"

**What the agent does with Hedera**

- **It pays other services on its own.** To judge a request it buys evidence from two checkers, a link-analysis service and a payee-reputation service, each behind an x402 paywall priced in HBAR (0.05 HBAR a call). The agent pays the challenge with Hedera's `exact` scheme and no human is involved. Code: `src/agent/x402.ts`, `src/adapters/x402/`, routes in `src/app/api/x402/checkers/`.
- **It cannot be talked into paying anything else.** Every autonomous payment goes through a spend guard built for that one payment: HBAR only, the `exact` scheme, one network, one allowed payee, a per-call cap and a total budget. A hostile server asking for another asset, payee or a higher price is refused before the agent signs (`src/adapters/x402/guard.ts`; tests in `tests/unit/x402`, `tests/unit/agent/x402.test.ts`).
- **It pays the merchant only after the policy or a human says so**, with a guard pinned to the merchant's own challenge: that payee and at most that amount, so a price rise or payee swap between reading and paying aborts.
- **Everything it does is written to Hedera.** Each step of a check is an audit message on an HCS topic (hashes and ids only, never the request text), and outcomes about payees go to a second HCS topic that later checks read back as reputation evidence. The mirror node is used to read them. Code: `src/adapters/hedera/`, `scripts/create-topics.mjs`.

**Checked**

- Verified: a real request to our checker route returned a correct x402 challenge (asset `0.0.0` = HBAR, amount, payee, and the fee payer supplied by the Blocky402 testnet facilitator, which lists `hedera:testnet` with the `exact` scheme).
- Verified: the 402 challenge, guard, signature and retry flow through the real `@x402/fetch` client against a fake server; guard rejections for payee, asset, price and budget.
- Verified: HCS message encoding (canonical JSON, 1024-byte limit), reputation scoring, mirror node reading (pagination stays on the configured host).
- **Not verified live:** an actual settlement, an actual HCS write, and reading it back. The tests exist (`tests/live/hedera.live.test.ts`, `tests/live/deployed.live.test.ts`) and run with `pnpm test:live` once an account is funded.

**Open question:** whether the Blocky402 facilitator settles native HBAR transfers. Its challenge accepts HBAR pricing; settlement is untested.

## World: "Agent Pass"

**What the agent does with World ID**

- **Human approval whose strength matches the risk.** Low risk over a limit needs a fresh login; medium risk a verified human (Orb); high risk, where the default is *do not pay*, only the strongest check (Orb plus face) can override. The tier is sent as an `acr` claims request and enforced again on the way back. Code: `src/adapters/world/`, `src/core/assurance.ts`, `rust/kavach-core/src/assurance.rs`.
- **An approval is for one exact payment.** World's OIDC has no way to put the payment in the token, so the attempt is stored server-side with a hash of the payment (amount, payee, merchant, verdict). On the callback the hash is recomputed from the payment as it stands now; any change refuses the approval.
- **Fresh and single use.** The authorization request forces a new login (`max_age=0`, `prompt=login`); `auth_time` must be after the attempt started; nonce, state and PKCE are checked; an approval moves `approved` to `consumed` by one conditional database update, so concurrent callbacks and replays pay at most once.
- **Fails closed.** Anything wrong after the redirect leaves the attempt `rejected` and nothing is paid. A request's strength is never inferred; a missing `acr` or `auth_time` is a rejection.

**Checked**

- Verified: the whole flow, including every rejection (weak `acr`, stale or future `auth_time`, wrong nonce, changed payment, expired attempt, replay, denial), through `openid-client` against a built-in OIDC issuer that signs real RS256 tokens, in unit tests and in the browser.
- Verified live: World's real discovery document is accepted and an authorization URL is built from it.
- **Not verified live:** a real login and code exchange (no credentials yet). Two questions can only be answered by one: whether the test environment issues `orb-face`, and whether the `claims` parameter wants `values` (what we send) or `value`. Notes for World in [WORLD_FEEDBACK.md](../WORLD_FEEDBACK.md).
- Honest labelling: because there are no credentials, the demo runs against our simulator. It is opt-in (`WORLD_MODE=simulated`), says so on every page it serves, and every approval it produces is logged as `source:simulated`. Switching to real World changes only the client id and secret.

## 0G: "Build with 0G Private Computer"

**What the agent does with 0G**

- **Reads the request privately.** The payment request (invoice text, message) can contain names, accounts and amounts, so extraction and the risk verdict go through the 0G router with the trust mode set to `private` (header `X-0G-Provider-Trust-Mode`). Code: `src/adapters/zerog/`.
- **Treats the model as untrusted.** The request text is wrapped and the model is told to treat it as data; replies are validated against a schema; and the verdict can only be raised by the other evidence, never lowered below it (`applyEvidenceFloor`). If injected text persuades the model that a request is safe, the link analysis, payee reputation and payee-mismatch checks still raise the level, so those signals cannot be talked away. It is not a complete defence: a request with no deterministic signal that fools the model can still be rated low, and what it can then do is bounded by the per-payment and daily limits.
- **A failed model is a high-risk request.** If 0G is down, slow or returns nonsense, there is no verdict, and the policy requires the strongest approval. The agent never pays because a model failed.
- **Keeps the receipt.** The 0G request ids behind a verdict are written to the audit log so a decision can be traced.

**A constraint we found, and how we handled it.** On pc.0g.ai/models the models labelled *Private* (for example `glm-5.3`) are text-only, and the vision models carry no Private label. So an image cannot be read privately today. The adapter refuses images in private mode (`VISION_NOT_PRIVATE`) instead of quietly sending them to a non-private model; the planned route is local OCR, then a private text model. Not built yet.

**Checked**

- Verified: schema validation, the evidence floor, error mapping (empty balance, bad key, empty reply), the private-mode header, the image refusal (`tests/unit/zerog`).
- **Not verified live:** any call to 0G, including whether the trust-mode header is honoured. The header comes from 0G's public page. `tests/live/zerog.live.test.ts` exists and runs once `ZG_API_KEY` and `ZG_MODEL_TEXT` are set. In demo mode a labelled keyword heuristic stands in for the model.

## What ties them together

The decision itself is not a model's: it is a small Rust policy engine compiled to WebAssembly (no panics, integer money, fail-closed defaults), with a TypeScript copy checked against it on random inputs. The models and services provide evidence and approvals; the engine decides whether money moves. Design in [HOW_IT_WORKS.md](../HOW_IT_WORKS.md).
