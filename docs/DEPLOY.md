# Deploying to Vercel with Neon

Nothing here has been run on Vercel or Neon yet (no accounts were available while building). The pieces it relies on are tested separately: the production build, the migration and every SQL statement against a real Postgres engine, and the app's behaviour in the browser. Treat the first deploy as the first live test, and run the preflight below.

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
   It is idempotent. A serverless deployment **needs** a database: the in-memory store is per instance, so an approval started on one instance could not be completed on another. `GET /api/status` fails the deployment if `DATABASE_URL` is missing on Vercel.
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
| `API_TOKEN` | optional | **yes** | 16+ characters. Protects `/api/checks`, `/api/checks/[id]`, `/api/status` |
| `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` | no | yes | Funded testnet account. The key is the DER string from portal.hedera.com |
| `HEDERA_PAYEE_ACCOUNT_ID` | no | yes | Must already exist |
| `HEDERA_HCS_AUDIT_TOPIC_ID`, `HEDERA_HCS_REPUTATION_TOPIC_ID` | no | recommended | From `pnpm setup:hedera`. Without them logging is off |
| `ZG_API_KEY`, `ZG_MODEL_TEXT` | no | yes | A text model labelled *Private* on pc.0g.ai/models, for example `glm-5.3` |
| `ZG_TRUST_MODE` | no | optional | `private` (default) or `verified` |
| `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET` | no | yes | From the World developer portal. Setting these together with `WORLD_MODE=simulated` is an error |
| `WORLD_REDIRECT_URI` | no | optional | Only if it differs from the default |
| `MERCHANT_ORIGINS` | no | optional | Extra origins the agent may fetch merchants from (the app's own origin is always allowed) |
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

Redeploy the previous deployment in Vercel. The migration only creates tables, so there is nothing to undo for a code rollback. To start over on the database, drop the four tables (`checks`, `pending_approvals`, `auto_spend_ledger`, `used_nonces`) and the `drizzle` schema, then run `pnpm db:migrate` again.
