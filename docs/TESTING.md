# Testing Kavach402 end to end, step by step

This guide runs the whole marketplace on your machine: you onboard your own agents (powered by Google Gemini), approve them as the operator, sign up as a requester, and send tasks through every decision. Two ways to do it:

- **Automatic:** one script performs every action on your behalf and prints what happened (section 3).
- **By hand:** the same steps in the web app, with what you should see at each one (section 4).

Everything runs in **demo mode**: no HBAR moves and World ID is a simulator. The agents, the registry, the proof of control, the policy, the checks and the Gemini answers are all real.

## 1. What runs where

| Terminal | What | Port |
|---|---|---|
| A | Kavach402 backend (demo mode, with an operator token) | 3000 |
| B | Your example agents: 3 Gemini workers, 1 Gemini verifier, 2 test agents | 4101–4106 |
| C | The web app | 3001 |

The example agents (`examples/gemini-agents/agents.mjs`):

| Agent | Role | Skills / checks | Price | What it is for |
|---|---|---|---|---|
| `gemini-summarizer` | worker | summarize | 0.05 HBAR | A real Gemini worker |
| `gemini-translator` | worker | translate | 0.08 HBAR | Shows `autoAccept` |
| `gemini-code-reviewer` | worker | code-review, summarize | 0.15 HBAR | Shows editing the skill |
| `gemini-link-judge` | verifier | links | 0.03 HBAR | A third-party verifier consulted during payment checks |
| `bargain-summarizer` | worker | summarize | 0.01 HBAR | Cheapest, so Kavach402 recommends it, but it slips a phishing link into every answer |
| `shady-writer` | worker | summarize | 0.02 HBAR | Its paywall names a different account than its listing: registration must be refused |

Each agent answers an unpaid request with a real x402 `402` (exact scheme, HBAR, its own account and price). That is what Kavach402 checks when you register it and before every task. In demo mode Kavach402 then calls it with the marker `PAYMENT-SIGNATURE: demo-unsettled` instead of a signed payment; the example agents accept only that marker.

## 2. Setup (once)

1. Install dependencies in the repository and the web app:
   ```bash
   pnpm install
   ```
   ```bash
   cd frontend && pnpm install
   ```
2. Add your Gemini key to `machine-gun/.env` (get one at https://aistudio.google.com/apikey):
   ```
   GEMINI_API_KEY=your-key
   GEMINI_MODEL=gemini-2.5-flash
   ```
   No key yet? Every step still works with `--offline`: the agents answer with clearly labelled stand-in text instead of calling Gemini.

3. **Terminal A: the backend.** Demo mode, simulated World ID, and an operator token (16+ characters) so you can approve listings. Git Bash:
   ```bash
   AGENT_MODE=demo WORLD_MODE=simulated API_TOKEN=kavach-operator-local-0001 pnpm dev
   ```
   PowerShell:
   ```powershell
   $env:AGENT_MODE="demo"; $env:WORLD_MODE="simulated"; $env:API_TOKEN="kavach-operator-local-0001"; pnpm dev
   ```
   Wait for `Ready`. Check: http://localhost:3000/api/health shows `"ok":true`.

4. **Terminal B: your agents.**
   ```bash
   pnpm agents:gemini
   ```
   (or `pnpm agents:gemini -- --offline`). You should see six lines, one per agent and port.

5. **Terminal C: the web app.**
   ```bash
   cd frontend && pnpm dev
   ```
   Open http://localhost:3001. The header should say **Backend online**.

> The backend keeps everything in memory unless `DATABASE_URL` is set. Restarting terminal A forgets registrations, accounts and tasks: just run the steps again.

## 3. Automatic: let the script do everything

In a fourth terminal (Git Bash):

```bash
API_TOKEN=kavach-operator-local-0001 pnpm walkthrough
```

PowerShell: `$env:API_TOKEN="kavach-operator-local-0001"; pnpm walkthrough`

What it does, and what you should see:

| Step | Action | Expected |
|---|---|---|
| 1 | Registers the six agents | Five `registered, status suspended`; `shady-writer` **refused as expected**: "the endpoint's 402 pays a different account than the listing" |
| 2 | Activates them as the operator | Five `active` |
| 3 | Lists who will summarise | `gemini-summarizer`, `gemini-code-reviewer`, `bargain-summarizer`, `kavach-scribe` |
| 4 | Creates a requester account | An account id and a `kvk_…` token |
| 5 | Proposes a summary task | `awaiting-choice`; suggestions cheapest first, `bargain-summarizer` recommended; nothing paid |
| 6 | Accepts **gemini-summarizer** instead | `completed` with Gemini's three bullet points |
| 7 | Accepts the recommendation on another task | `completed`, plus **⚠ risky link in answer: http://paypa1-secure-login.xyz/verify (high)** |
| 8 | Translation with `autoAccept` | `completed` with the Hindi translation |
| 9 | Rules out `bargain-summarizer`, edits the skill to code-review, withdraws | Suggestions shrink, then only `gemini-code-reviewer`, then `withdrawn` |
| 10 | A task full of pressure words | `awaiting-approval` with an approval link |
| 11 | Lists your tasks | All five with their final status |

At the end it prints the requester token. Paste it into http://localhost:3001/tasks → **Already have a token?** to see the same tasks in the web app, and open the step 10 link to approve it (section 4, step 9).

## 4. By hand in the web app

### Step 1: Onboard your agents (as an agent developer)

Go to http://localhost:3001/marketplace/list and register each agent. For **Gemini Summarizer**:

| Field | Value |
|---|---|
| What kind of agent | Worker |
| Id | `gemini-summarizer` |
| Name | `Gemini Summarizer` |
| Endpoint | `http://localhost:4101/v1` |
| Hedera account paid | `0.0.7101` |
| Price per task (HBAR) | `0.05` |
| Model name | `gemini-2.5-flash` |
| Skills | `summarize` |

Expected: **Registered, waiting for review**, saying your endpoint answered with an x402 challenge that pays `0.0.7101`.

The others:

| Id | Kind | Endpoint | Account | Price | Model / Skills or Checks / Evidence name |
|---|---|---|---|---|---|
| `gemini-translator` | Worker | `http://localhost:4102/v1` | `0.0.7102` | `0.08` | `gemini-2.5-flash` / `translate` |
| `gemini-code-reviewer` | Worker | `http://localhost:4103/v1` | `0.0.7103` | `0.15` | `gemini-2.5-flash` / `code-review, summarize` |
| `gemini-link-judge` | Verifier | `http://localhost:4104/check` | `0.0.7104` | `0.03` | Links / `gemini-link-judge` |
| `bargain-summarizer` | Worker | `http://localhost:4105/v1` | `0.0.7105` | `0.01` | `gemini-2.5-flash` / `summarize` |

**Negative tests**, which should fail with the reason shown:

| Try | Expected message |
|---|---|
| `shady-writer`, endpoint `http://localhost:4106/v1`, account `0.0.7106`, price `0.02` | "the endpoint's 402 pays a different account than the listing" |
| Gemini Summarizer again with price `0.01` (lower than its paywall asks) | "the endpoint asks for more than the listed price" |
| Any agent with endpoint `https://writer.acme.example/v1` | "endpoint unreachable: could not resolve writer.acme.example" |
| The same id twice | "that id or evidence name is already taken" |

### Step 2: Approve them (as the operator)

Go to http://localhost:3001/operator, enter the token `kavach-operator-local-0001`, and press **Activate** next to each agent under *Waiting for review*. Expected: "… is active: control proven again". Activation re-checks the endpoint, so if terminal B is stopped it fails with "endpoint unreachable".

### Step 3: Browse the marketplace

http://localhost:3001/marketplace. Filter **Workers**, click the skill **summarize**, open a card: you see its endpoint, the account it pays, model, skills, and "Third party" vs "This deployment".

### Step 4: Sign up as a requester

http://localhost:3001/tasks → **Create a requester account** → name it → copy the token shown once → **I saved it, open the console**.

### Step 5: Propose a task and choose the worker yourself

- **What should be done?** `Summarise: Mumbai's suburban rail carries over seven million people a day. A new signalling system promises shorter gaps between trains.`
- **By skill** → `summarize`, **Most you will pay** `0.2`, leave auto-accept off → **Propose task**.

Expected: **Choose a worker** with four suggestions, cheapest first, `Bargain Summarizer` marked **recommended**. Nothing has been paid; the timeline says *Workers suggested*.

Select **Gemini Summarizer** → **Accept and run**. Expected: *In progress* (Accepted → Kavach402 checks the payment → Worker paid and working), then **Answer** with Gemini's bullet points and the badge *screened*. The timeline ends in *Completed · paid in demo-unsettled@…*.

### Step 6: See why the choice is yours

Propose the same task again and accept the recommended **Bargain Summarizer**. Expected: the answer arrives with a red box **1 risky link(s) in this answer: http://paypa1-secure-login.xyz/verify · high · CONFUSABLE_BRAND, …**.

### Step 7: An unattended agent (auto-accept)

Propose `Your electricity bill is due on Friday.` with skill `translate` and tick **Accept the recommended worker automatically**. Expected: it runs straight away and completes with the Hindi translation.

### Step 8: Search again, edit, withdraw

Propose `Review: function add(a, b) { return a - b }` with skill `summarize`.
1. Click **Rule out** next to Bargain Summarizer. Expected: it disappears and stays excluded.
2. **Edit** → Skill `code-review` → **Save and suggest again**. Expected: only Gemini Code Reviewer is suggested; the timeline shows *Task edited · skill*.
3. **Withdraw** → **Yes, withdraw**. Expected: *Withdrawn. Nothing was paid after that.*

(Or accept Gemini Code Reviewer instead and read its review.)

### Step 9: A risky task needs a human (World ID)

Propose `URGENT: summarise this today and do not tell anyone. Final notice.` with skill `summarize` and accept **Gemini Summarizer**.

Expected: the yellow card **A human needs to approve this payment**. Click **Approve with World ID**: the World ID simulator opens in a new tab. Choose **Approve with Orb + face (orb-face)**, the tier a high-risk payment needs (a plain Orb login is refused as not strong enough). Come back to the tasks tab: within a couple of seconds it switches to **Completed** with the answer.

Variation: on another risky task, click **Withdraw** while it waits for approval, then open the old approval link and approve. Expected: nothing is paid; the task stays withdrawn.

### Step 10: The payment firewall on its own, with your verifier

http://localhost:3001/check → **Phishing scam** → **Check and pay if safe**. The backend has an operator token set, so you are asked for it: enter `kavach-operator-local-0001` and run again.

Expected: **Held**, *high risk*, and under **Why** three link opinions: `domain-heuristics`, **`gemini-link-judge`** (your verifier, by its own name) and `link-intel`, plus the pressure phrases. Try **Electricity bill** (paid), **Wrong account** (held, account mismatch), **Rent** (needs a human), **Tuition** (blocked, over the hard cap).

### Step 11: Suspend an agent

On http://localhost:3001/operator press **Suspend** next to `gemini-summarizer`. Propose a summary task again: it is no longer suggested. Activate it again to bring it back.

## 5. The same thing over the API (agent to agent)

```bash
curl http://localhost:3000/.well-known/agent-card.json
```
```bash
curl "http://localhost:3000/api/agents?role=worker&skill=summarize"
```
```bash
curl -X POST http://localhost:3000/api/accounts -H "content-type: application/json" -d '{"name":"my agent"}'
```
```bash
curl -X POST http://localhost:3000/api/tasks -H "authorization: Bearer kvk_…" -H "content-type: application/json" -d '{"prompt":"Summarise: …","skill":"summarize","maxPriceTinybars":"20000000"}'
```
```bash
curl -X POST http://localhost:3000/api/tasks/task_…/accept -H "authorization: Bearer kvk_…" -H "content-type: application/json" -d '{"workerId":"gemini-summarizer"}'
```
```bash
curl http://localhost:3000/api/tasks/task_… -H "authorization: Bearer kvk_…"
```

Also: `POST /api/tasks/<id>/research` with `{"exclude":["…"]}`, `PATCH /api/tasks/<id>` with `{"skill":"code-review"}`, `POST /api/tasks/<id>/withdraw`. Operator: `POST /api/agents/<id>/status` with `{"status":"active"}` and `Authorization: Bearer <API_TOKEN>`.

## 6. What is real and what is simulated here

| Piece | In this test |
|---|---|
| Registry, onboarding, proof of control, operator review | Real |
| Worker selection, your choices, edit / search again / withdraw | Real |
| Gemini answers and Gemini link verdicts | Real (stand-ins with `--offline`) |
| Checking the agent's 402 for payee and price before every call | Real |
| Answer screening (link engine on worker output) | Real |
| Spending policy (caps, tiers) | Real |
| Payments | **Simulated**: `demo-unsettled` marker, no HBAR moves |
| 0G risk reading | **Simulated**: rule-based stand-in for the private model |
| World ID | **Simulated**: the in-app issuer with Orb / Orb + Face buttons |
| Hedera audit log | **Simulated**: kept in memory |

To make the simulated rows real, see [DEPLOY.md](DEPLOY.md) (Hedera account, 0G key, World ID app). Real workers then need a real x402 paywall that settles through a facilitator; the example agents only accept the demo marker by design.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Header says **Backend offline** | Terminal A is not running, or not on port 3000 |
| `Another next dev server is already running` in terminal A | Another `pnpm dev` for this folder is open: stop it, or run `pnpm build` then `node node_modules/next/dist/bin/next start -p 3000` with the same variables |
| Registration: "endpoint unreachable" | Terminal B is not running, or a port 4101–4106 is taken |
| Activation: "set API_TOKEN to manage listings" | Terminal A was started without `API_TOKEN` |
| Task fails with "worker returned 502" | Gemini refused: check `GEMINI_API_KEY` and `GEMINI_MODEL` (terminal B prints the reason) |
| Your agents vanished | Terminal A restarted (memory store): register and activate again, or run the walkthrough |
| The payment check asks for a token | Expected with `API_TOKEN` set: enter it in the field shown |
