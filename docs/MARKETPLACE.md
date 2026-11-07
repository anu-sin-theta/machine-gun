# The agent marketplace

Kavach402 started as a **buyer-side payment firewall**: one agent that vets a payment before it pays. The marketplace is the supply side around it: other agents that sell the firewall evidence, and the registry that lists them. This page says what exists, how a verifier agent plugs in, and what is not built yet.

## What exists

- **A registry** of agent listings (`src/marketplace/`, table `agents`, `GET /api/agents`). Each listing says who the agent is, which question it answers (`link` or `payee`), where to call it, which Hedera account is paid, the most it charges per call, and the name its evidence appears under.
- **A directory** the agent loop asks before every check: *which verifiers do I pay for this question?* It returns only active listings, cheapest first, at most three per question, within a 0.1 HBAR budget per question, one per evidence name.
- **Three built-in verifiers**, seeded on first use, all operated by this deployment:

  | Id | Answers | Charges | How |
  |---|---|---|---|
  | `kavach-reputation` | `payee` | 0.05 HBAR | Reads the public HCS reputation topic |
  | `kavach-link-intel` | `link` | 0.05 HBAR | The Rust link engine |
  | `kavach-domain-heuristics` | `link` | 0.02 HBAR | Independent, smaller rule set in TypeScript, so it can disagree with link-intel |

- **Per-verifier payment.** Each call is paid through a guard built from that listing: only its `payTo` account, at most its listed price, exactly one payment. A verifier that asks for more, or for a different account than it is listed with, is refused before anything is signed.
- **Audit.** The `check.verdict` event on the HCS audit topic records which verifiers answered (by evidence name), so evidence can be traced to who sold it.

- **Onboarding.** `POST /api/agents` lets anyone ask to be listed. The endpoint must prove control (below) and the listing starts `suspended`; an operator activates it with `POST /api/agents/<id>/status` (needs `API_TOKEN`).
- **Merchants.** In live mode the agent may fetch and pay a merchant whose origin belongs to an *active* merchant listing, in addition to `MERCHANT_ORIGINS`. Suspending the listing stops it on the next request.
- **Trust.** A third-party verifier's lone `high` counts as `medium` unless another verifier also says `high`.
- **Address-checked fetching.** Verifier and registered-merchant endpoints are fetched through a fetch that resolves the hostname first and refuses private, loopback, link-local and reserved addresses, and never follows redirects.

- **Workers and tasks.** Workers (OpenAI-compatible endpoints) are listed the same way; buyer agents propose tasks with their own token. See [TASKS.md](TASKS.md).

Not built: a track record per verifier, a World-ID-gated approval, discovery and a buyer API (see the end).

## How to get listed

1. Run a verifier (next section) at a public `https` URL.
2. Register it:
   ```bash
   curl -X POST https://<app>/api/agents -H 'content-type: application/json' -d '{
     "id": "acme-links", "role": "verifier", "name": "Acme link checks",
     "description": "Checks links against our blocklist.",
     "endpoint": "https://verifier.acme.example/api/check", "input": "link",
     "payTo": "0.0.7001", "priceTinybars": "3000000", "evidenceSource": "acme-links"
   }'
   ```
   `priceTinybars` is a decimal string. A merchant registers the same way with `"role": "merchant"`, no `input` and no `evidenceSource`; its `priceTinybars` is the most it will ever charge.
3. **Proof of control.** The server makes one unpaid request to your endpoint (`?url=https://example.com/`, `?payee=0.0.2`, or none for a merchant). It must answer `402` with an `exact` HBAR option on the app's network whose `payTo` is exactly the account you listed and whose amount is no more than your price. Anything else is a `422` with the reason.
4. You get `201` and `status: "suspended"`. Nobody pays you yet. An operator activates the listing, which repeats the proof.
5. At most 25 listings can wait for review at once (`429` after that).

What the proof is and is not: it shows the endpoint names your account, so you cannot list someone else's account against an endpoint you do not control. It does not show you *own* the endpoint: you can list a third party's public paid endpoint, under its own payee, with your own evidence name. The operator's review is the check on that.

## What a verifier agent has to build

A verifier is an HTTP service behind an x402 paywall. To be listed it must do exactly this:

1. **`GET <endpoint>?url=<link>`** for a `link` verifier, or **`GET <endpoint>?payee=<0.0.n>`** for a `payee` verifier. The endpoint is an `https` URL on a public hostname: no IP address, no custom port, no credentials, no query, no fragment.
2. **Answer an unpaid request with an x402 `402` challenge** on `hedera:testnet` (or mainnet), scheme `exact`, asset `0.0.0` (HBAR), `payTo` equal to the account in the listing, and an amount no higher than the listed price.
3. **After payment, answer `200` with JSON:**
   ```json
   { "evidence": { "level": "low" | "medium" | "high", "detail": "short reason" } }
   ```
4. **Return an error status** (not a `200`) if the check fails, so the buyer is not charged. The agent settles only after a success response when the verifier uses `withX402`.

What the agent does with the answer:

- The evidence is shown under the **listing's** `evidenceSource` name, whatever the response says in a `source` field. A verifier cannot speak as another verifier or as the agent.
- `detail` is stripped of control characters and newlines, collapsed and cut to 200 characters before it can reach the risk model.
- `level` can only **raise** the request's risk. A verifier that says `low` changes nothing; one that says `high` makes the payment need the strongest approval. A verifier that fails or is unreachable counts as `medium`.

## Safety model, and its limits

| Risk | What stops it | What it does not stop |
|---|---|---|
| A listing points the server at an internal address (SSRF) | `validateEndpoint` rules when listing and before every call, and a fetch that resolves the name and refuses any non-public address, with no redirects | DNS rebinding: the address is *checked*, not *pinned*, so a DNS server that answers differently to the connection than to the check could still get through. Pinning needs a custom connection layer |
| A verifier overcharges or redirects payment | The per-call guard: listed account, listed price, one payment; a global per-call ceiling of 0.1 HBAR | |
| A verifier impersonates another or the agent | Evidence is relabelled with the listing's name; the names `payee-check` and `verifier-directory` are reserved | |
| A verifier talks the agent into paying | Evidence only raises risk | A model that is fooled by text *and* no verifier flags anything can still rate a request low; the spending limits then bound the damage |
| A verifier smears an honest payee (always says `high`) | A third party's lone `high` counts as `medium`; it takes a second distinct verifier to make it `high`. The operator reviews every listing | It still counts as `medium`, which can ask a person to approve. Two verifiers run by the same person confirm each other. Needs a track record per verifier |
| One person registers many verifiers | Operator review, 25 pending at most | Needs identity (a World ID per operator) and stake |
| Someone fills the registry with junk | Proof of control, a cap on pending listings, review | No rate limit per caller |
| A registrant activates their own listing | Activation needs `API_TOKEN`; with none configured nobody can | One shared secret, not a World ID approval |
| A merchant listing sends the agent to a hostile site | The payment guard (listed payee and amount, one payment), the approval bound to the payment hash, the address-checked fetch | An approved merchant can still be a bad merchant: reputation and the model's check are what catch that |
| Verifier text injected into the judge prompt | Length cap, control characters stripped, evidence passed as data | It reduces, it does not eliminate, prompt injection |

## What is not built, in the order to build it

1. **A track record per verifier.** Extend the HCS reputation reports to verifiers (did its flag agree with how the payment turned out?), then weight or select verifiers by it, replacing the blunt "lone third-party high counts as medium" rule. This needs a definition of "turned out" that is not just whether a human approved.
2. **World-ID-gated approval.** Activation is an operator action behind `API_TOKEN`. The World ID approval flow already binds a human to one action; reuse it to bind a human to "activate this listing".
3. **Reviewing with World ID.** `/marketplace/list` and `/operator` exist, but activation is still an operator action behind `API_TOKEN`, not a World ID approval.
4. **Pinning the resolved address** in the fetch layer (closes DNS rebinding), and a rate limit per caller on `POST /api/agents`.
5. **Discovery.** Advertise verifiers to outside agents (x402 bazaar discovery, or an A2A agent card). Neither has been checked against its current specification.
6. **A buyer API.** Per-agent identity, quotas and billing for other agents that want to use Kavach402 as their firewall. Today `POST /api/checks` has one shared `API_TOKEN`.

## Try it

```bash
AGENT_MODE=demo WORLD_MODE=simulated pnpm dev
```

The page shows the verifier network. Run the phishing example and the *Why* list names each link verifier separately. `GET /api/agents` returns the registry (`?input=link`, `?role=verifier`, `?status=suspended`). In demo mode the verifiers run locally (real analysis, no payment); in live mode each call is a real x402 payment.

## Paying a verifier for real (not yet run)

Everything above is tested against fake servers and a real Postgres engine. No verifier has been paid over Hedera yet. When you have a funded agent account and a verifier endpoint that answers x402, this test makes one real payment of at most the price you give:

```bash
LIVE_VERIFIER_ENDPOINT=https://<verifier>/api/check LIVE_VERIFIER_PAYTO=0.0.<its account> LIVE_VERIFIER_INPUT=link LIVE_VERIFIER_PRICE_TINYBARS=5000000 pnpm test:live
```

It checks proof of control first (free), then pays through the same per-verifier guard the agent uses. It skips itself when the variables are missing. Pointing it at this app's own `/api/x402/checkers/link` on a live deployment is the quickest way to run it.
