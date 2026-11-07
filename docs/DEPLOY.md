# Deploying to Vercel with Neon

Nothing here has been run on Vercel or Neon yet (no accounts were available while building). The pieces it relies on are tested separately: the production build, the migration and every SQL statement against a real Postgres engine, and the app's behaviour in the browser. Treat the first deploy as the first live test, and run the preflight below.

## What gets deployed

| Service | Folder | Where | Notes |
|---|---|---|---|
| **Backend** (API, firewall, registry, tasks, World ID callback) | repository root | Vercel project 1 | Needs Neon (`DATABASE_URL`) |
| **Web app** | `frontend/` | Vercel project 2, root directory `frontend` | Set `BACKEND_URL` to the backend's URL; it proxies `/api/*` there |
| **Example agents** (optional: Gemini workers and verifier) | `examples/gemini-agents/` | Any Node host or container (Render, Railway, Fly, Cloud Run) | One port, every agent under `/agents/<id>`; needs `GEMINI_API_KEY` |

### Quick recipe: a public demo of the whole thing

1. **Neon:** create a database, then from the repository root:
   ```bash
   DATABASE_URL="postgres://..." pnpm db:migrate
   ```
2. **Backend on Vercel:** import the repository (root directory: the repository root). Set:
   `AGENT_MODE=demo`, `WORLD_MODE=simulated`, `WORLD_SIM_KEY` (from `pnpm gen:sim-key`), `DATABASE_URL`, `API_TOKEN` (16+ characters), and `APP_BASE_URL=https://<backend>.vercel.app`. Deploy, then open `https://<backend>.vercel.app/api/health`.
3. **Web app on Vercel:** import the same repository as a second project with root directory `frontend`, and set `BACKEND_URL=https://<backend>.vercel.app`. The build fails with a clear message if it is missing.
4. **Agents (optional):** deploy `examples/gemini-agents` as a Node web service. Build: `npm install`. Start: `npm start`. Environment: `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.8-flash`. The platform's `PORT` switches it to one-port mode. Or use the Dockerfile there:
   ```bash
   docker build -t kavach-agents examples/gemini-agents
   ```
   ```bash
   docker run -p 8080:8080 -e GEMINI_API_KEY=... kavach-agents
   ```
   `GET /` on the service lists the agents and the model.
5. **Onboard the agents** into the deployed backend, from your machine:
   ```bash
   KAVACH_URL=https://<backend>.vercel.app AGENTS_BASE_URL=https://<agents-host> API_TOKEN=<API_TOKEN> pnpm walkthrough
   ```
   It registers and activates them and runs the sample tasks. Or register them by hand at `/marketplace/list` on the web app (endpoints `https://<agents-host>/agents/<id>/v1`, verifier `…/agents/gemini-link-judge/check`) and activate them at `/operator`.

A deployed backend accepts only public `https` agent endpoints: `http://localhost` agents work only when the backend itself runs on localhost or a private LAN address.

The example agents accept only the demo payment marker, so they work with a **demo** backend. A live backend pays with real x402; real workers must verify and settle those payments through a facilitator.

## Pick a mode first

| | Demo deployment | Live deployment |
|---|---|---|
| `AGENT_MODE` | `demo` | unset (live) |
| `WORLD_MODE` | `simulated` | unset (real) |
| Spends real money or credits | No | Yes (testnet HBAR, 0G credits) |
| Safe to leave public | Reasonably, see below | **No**: anyone who can submit a request spends your HBAR and credits. Put it behind authentication, or keep it private |

A simulated World approves whoever is at the keyboard. A public demo deployment is fine for showing the product, but it is a demonstration, and the page says so.

## Steps

1. **Neon.** Create a project and copy the connection string.
   ```bash
   DATABASE_URL="postgres://..." pnpm db:migrate
   ```
   It is idempotent and creates the tables, including the agent registry (`agents`, seeded on first use with the three built-in verifiers and the demo worker), buyer `accounts` and `tasks`. A serverless deployment **needs** a database: the in-memory store is per instance, so an approval started on one instance could not be completed on another. `GET /api/status` fails the deployment if `DATABASE_URL` is missing on Vercel.
2. **Simulator key (demo deployments).** `pnpm gen:sim-key` prints a `WORLD_SIM_KEY` line. Without it each serverless instance signs World ID tokens with its own key and an approval can fail at random.
3. **Vercel project.** Import the repository. The root directory is the folder that contains `package.json`. Framework: Next.js. Node 22. The default install and build commands work: the WebAssembly is committed, so the build needs no Rust.
4. **Environment variables** (Production), below.
5. **Set `APP_BASE_URL` to the deployed URL** (no trailing path). The World redirect URI defaults to `<APP_BASE_URL>/api/worldid/callback`; for real World it must be registered under exactly that value.
6. **Preflight** after the first deploy:
   ```bash
   curl -H "Authorization: Bearer $API_TOKEN" https://<app>/api/status
   ```
   It lists every item as OK, WARN, MISSING or FAIL. Fix every FAIL. Read every WARN.
7. **Live smoke test** (live deployments only; makes one real 1.5 HBAR testnet payment):
   ```bash
   LIVE_BASE_URL=https://<app> API_TOKEN=... pnpm test:live
   ```

## Environment variables

| Variable | Demo | Live | Notes |
|---|---|---|---|
| `APP_BASE_URL` | yes | yes | The deployed URL |
| `DATABASE_URL` | yes | yes | Neon |
| `AGENT_MODE` | `demo` | unset | |
| `WORLD_MODE` | `simulated` | unset | |
| `WORLD_SIM_KEY` | yes | no | From `pnpm gen:sim-key`. Secret |
| `WORLD_SIM_SECRET` | optional | no | 16+ characters; replaces the built-in dev value |
| `API_TOKEN` | optional | **yes** | 16+ characters. Protects `/api/checks`, `/api/checks/[id]`, `/api/status`, and is the only way to activate or suspend a registry listing (`POST /api/agents/[id]/status`) and, in live mode, to issue buyer accounts (`POST /api/accounts`); with no token nobody can |
| `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` | no | yes | Funded testnet account. The key is the DER string from portal.hedera.com |
| `HEDERA_PAYEE_ACCOUNT_ID` | no | yes | Must already exist |
| `HEDERA_HCS_AUDIT_TOPIC_ID`, `HEDERA_HCS_REPUTATION_TOPIC_ID` | no | recommended | From `pnpm setup:hedera`. Without them logging is off |
| `ZG_API_KEY`, `ZG_MODEL_TEXT` | no | yes | A text model labelled *Private* on pc.0g.ai/models, for example `glm-5.3` |
| `ZG_TRUST_MODE` | no | optional | `private` (default) or `verified` |
| `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET` | no | yes | From the World developer portal. Setting these together with `WORLD_MODE=simulated` is an error |
| `WORLD_REDIRECT_URI` | no | optional | Only if it differs from the default |
| `MERCHANT_ORIGINS` | no | optional | Extra origins the agent may fetch merchants from (the app's own origin is always allowed). Live mode also accepts the origins of active merchant listings in the registry |
| `POLICY_HBAR_AUTO_CAP`, `POLICY_HBAR_HARD_CAP`, `POLICY_HBAR_DAILY_AUTO_BUDGET` | optional | optional | Tinybars. Defaults 2, 50 and 5 HBAR |
| `APPROVAL_TTL_SECONDS` | optional | optional | 30 to 3600, default 600 |

A malformed value stops the app with a message that names the variable; a half-filled group (for example a Hedera account without its key) is an error, not a silent skip.

## Known limits

- **Demo audit trail and reputation are in memory.** In demo mode the audit list on the result card and the payee reputation live in the instance that handled the request. On serverless the card can show an empty audit trail after the World redirect. Checks themselves are in the database. Live mode reads nothing from memory for decisions.
- **Function time.** The request that runs the agent, and the World callback that pays, call out to 0G, the checkers and Hedera. They set `maxDuration = 60` seconds; check what your Vercel plan allows.
- **The mirror node lags** a few seconds behind consensus. The live tests poll for it.
- **`build:wasm:check` in CI compares the committed WebAssembly byte for byte with a fresh build.** It was produced on Windows with the GNU toolchain and has not yet run on the Linux CI image. If that step fails on the first run, the cause is a toolchain or path difference, not a logic bug: rebuild with `pnpm build:wasm` in an environment matching CI and commit the result. The parity and Rust tests are independent of it.
- **No rate limiting** and no per-user accounts. `API_TOKEN` is one shared secret.

## Rollback

Redeploy the previous deployment in Vercel. The migration only creates tables, so there is nothing to undo for a code rollback. To start over on the database, drop the tables (`checks`, `pending_approvals`, `auto_spend_ledger`, `used_nonces`, `agents`, `accounts`, `tasks`) and the `drizzle` schema, then run `pnpm db:migrate` again.
