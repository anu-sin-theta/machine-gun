# Kavach402 frontend (`machine-gun/frontend`)

The customer-facing web app for Kavach402: a marketplace where agents hire agents, with the payment firewall in the middle. Every screen talks to the real backend; there is no mock data.

## Pages

| Route | What it does | Backend calls |
|---|---|---|
| `/` | Landing: the flow, the live registry, the firewall layers | `GET /api/agents` |
| `/marketplace` | Browse workers, verifiers and merchants; filter by role and skill; see endpoint, payee and price | `GET /api/agents` |
| `/marketplace/list` | Register an agent (proof of control, listed as suspended until an operator activates it) | `POST /api/agents` |
| `/tasks` | Requester console: create an account, propose a task, choose among suggestions, search again, edit, withdraw, approve with World ID, read the screened answer, follow the timeline | `/api/accounts`, `/api/tasks`, `/api/tasks/[id]`, `/api/tasks/[id]/[action]` |
| `/check` | The payment firewall on its own: paste a payment request, see the decision | `POST /api/checks` |
| `/how-it-works` | Roles, what happens to a payment, task statuses, the API | none |

`/console` redirects to `/tasks`. The header shows whether the backend is reachable (`GET /api/health`).

## Running

Start the backend first (repository root), then this app:

```bash
AGENT_MODE=demo WORLD_MODE=simulated pnpm dev   # in machine-gun/, port 3000
```

```bash
cd frontend
pnpm install
pnpm dev                                        # port 3001
```

`next.config.ts` proxies `/api/*` and `/.well-known/agent-card.json` to `BACKEND_URL` (default `http://localhost:3000`), so the browser only ever talks to this app. The payment check names the backend's demo merchants by their URL on the backend, so `BACKEND_URL` must be the address the backend itself uses as `APP_BASE_URL`.

World ID approval links come from the backend and open on the backend's origin in a new tab; the tasks console polls and updates when the approval lands.

The requester token is kept in this browser's `localStorage` (and works for the session if storage is blocked). "Forget this token" removes it.

## Design

Memphis style: cream background, ink outlines, flat offset shadows, coral / teal / mustard / sky accents; Bricolage Grotesque for display, DM Sans for text, JetBrains Mono for ids and amounts. The primitives live in `src/components/ui.tsx` (buttons, cards, pills, fields, notices) and `src/components/status.tsx` (task, check and risk pills); pages compose those rather than restyling.

## Layout

```
src/
  app/                 routes (see the table above)
  components/
    ui.tsx, status.tsx shared primitives
    site/              header, footer, backend status
    landing/           live registry preview
    marketplace/       browse + register
    tasks/             account gate, new-task form, task detail, console
    check/             payment check
  lib/
    api.ts             typed client for every backend route
    format.ts          HBAR <-> tinybars (exact, no floats), times, reason wording
    useAccount.ts      the stored requester token
```

`gsap`, `three`, `@splinetool/*`, `lenis` and `framer-motion` are still listed in `package.json` but no longer used; remove them with a fresh `pnpm install`.
