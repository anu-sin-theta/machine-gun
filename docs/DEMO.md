# Demo script

Two ways to show Kavach402. Use the offline one by default: it needs nothing and cannot fail on a network. Use the live one only after `GET /api/status` is green.

## Offline demo (about 3 minutes)

```bash
AGENT_MODE=demo WORLD_MODE=simulated pnpm dev
```

Open http://localhost:3000. Point at the amber banner first and say what it says: the 0G model, settlement and World ID are stand-ins here; the policy, link analysis and approval checks are the real code.

**1. An ordinary bill pays itself.** Click *Electricity bill*, then *Check, then pay if it is safe*.
Say: the agent asked the merchant what it would be paid first, so the payee and amount come from the merchant, not from the text. It read the request, bought link and reputation evidence, and the policy found low risk under the 2 HBAR limit. It paid without bothering anyone. The audit trail at the bottom is what would be written to Hedera.

**2. A scam is not paid by default.** Click *Phishing scam*, check.
Say: high risk. Look at *Why*: the link analysis flagged brand impersonation and a suspicious domain (this is the real Rust engine, not a stand-in), plus the pressure language. The headline says blocked unless you override, and only the strongest World ID check can override.

**3. A weaker login is refused.** Click *Continue to World ID*. The page says SIMULATION. Choose *Approve with Orb (orb)*.
Say: with real World that would be a human with an Orb credential, but the policy asked for Orb plus face because the risk is high. The card now says Not paid, because the login was not strong enough. Strength is matched to risk, not just "a human approved".

**4. The strongest login pays, once.** Run *Phishing scam* again, continue to World ID, choose *Approve with Orb + face (orb-face)*.
Say: the approval is bound to this exact payment (amount, payee, merchant, verdict) and can be spent once. The audit trail says `source:simulated`, so a simulated approval is never mistaken for a real one.
Optional: copy the callback URL from the browser history and open it again. It answers `not_pending`: a replay cannot pay twice.

**5. The other three cases, quickly.**
- *Wrong account*: the text asks to pay `0.0.9999` but the merchant would pay `0.0.5001`. High risk, held.
- *Rent (over the limit)*: low risk but 12 HBAR is over the 2 HBAR auto-pay cap, so it asks for an ordinary login.
- *Tuition (too large)*: 60 HBAR is over the hard cap. Blocked outright, no approval offered.

**Close with:** the decision engine is Rust compiled to WebAssembly with a TypeScript copy checked against it on random inputs; it fails closed everywhere (no risk review counts as high risk); and what is real versus stand-in is on the page and in [README.md](../README.md).

## Live demo checklist

Do this the day before, not in the room.

1. `.env` filled in (see `.env.example`): Hedera agent and payee accounts, both HCS topic ids (`pnpm setup:hedera`), `ZG_API_KEY` and `ZG_MODEL_TEXT`, World client id and secret, `DATABASE_URL` (`pnpm db:migrate`), `API_TOKEN`.
2. Fund the agent account with testnet HBAR from portal.hedera.com. The payee account must already exist.
3. The World redirect URI registered with World must equal `<APP_BASE_URL>/api/worldid/callback`.
4. `curl -H "Authorization: Bearer $API_TOKEN" <app>/api/status` shows no `FAIL`. Anything yellow, read it.
5. `pnpm test:live` (and `LIVE_BASE_URL=<app> pnpm test:live` for the deployed app, which makes one real 1.5 HBAR payment).
6. Keep the page behind something: in live mode anyone who can submit a request spends HBAR and 0G credits.

In the room, the same five examples work. After a paid check, open the transaction on HashScan from the link on the card, and the audit and reputation topics on the mirror node.

## If something breaks

- **0G is down or slow.** Show it as a feature: the card says *no risk review* and the decision is a strong step-up. The agent never pays because a model failed.
- **A checker is unreachable.** The evidence shows as medium ("checker unavailable"), which also forces approval.
- **World redirect fails.** The attempt stays pending or rejected and nothing is paid. Start the check again.
- **Hedera is slow.** The mirror node lags a few seconds behind consensus; refresh the explorer.
- **Anything else.** Switch to the offline demo above. It is the same product with three labelled stand-ins.
