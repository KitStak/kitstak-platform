# KitStak Pulse

Profit by job, client and service for kitting, 3PL and contract packaging shops. Runs on its own
(CSV in and out for every data stream) or bundled with Portal, CRM, WMS and Projects (shared Better
Auth session, shared Postgres, `pulse` schema). Product spec: `docs/pulse/SPEC.md`; team contracts:
`docs/pulse/CONTRACTS.md`; house rules: `AGENTS.md`.

## Run it

```bash
# once: shared platform tables, then this app's pulse schema, then demo data
pnpm --filter @kitstak/db db:migrate
pnpm --filter kitstak-pulse db:migrate      # with the sibling apps: db, CRM, WMS, Projects, then Pulse last
pnpm --filter kitstak-pulse db:seed         # the rich demo for both demo workspaces, about 50 seconds

pnpm --filter kitstak-pulse dev          # http://localhost:3500
# or from the repo root: pnpm dev:pulse
```

Sign in with `admin@kitstak.io` / `KitStak-Demo-2026!` (org `kitstak`) or
`maya@northwind-robotics.example` / `Northwind-Demo-2026!` (org `northwind-robotics`).

Several dev servers side by side (one per person or agent): pick a port in 3501 to 3520 and your own
dist dir **inside `.next/`** (`.next-<name>` is mapped there automatically):

```bash
NEXT_DIST_DIR=.next/alice pnpm --filter kitstak-pulse exec next dev -p 3505
```

Do not run `pnpm build` while dev servers are running (it rewrites `next-env.d.ts`); if a dev server
starts reloading in a loop, restart it.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` / `build` / `start` | Next.js 16 (Turbopack) on port 3500 |
| `typecheck` / `lint` / `test` | `tsc --noEmit`, ESLint (flat config, with the no dash copy rule), Vitest |
| `db:migrate` | Applies `drizzle/*.sql` (journaled, advisory locked, own table `drizzle.__kitstak_pulse_migrations`) |
| `db:seed` | Seeds demo data through the real domain layer (`src/server/db/seed`) |
| `shot` | `node scripts/shot.mjs --base http://localhost:3505 / /jobs` saves light and dark screenshots |
| `e2e` | Playwright checks against a running dev server (`E2E_BASE_URL`) |

## Tests

```bash
pnpm --filter kitstak-pulse typecheck
pnpm --filter kitstak-pulse lint
pnpm --filter kitstak-pulse test            # Vitest: pure math, render tests, and database tests on throwaway orgs

# Browser suite, against a running dev server with the seeded demo. One worker: the specs share the demo data.
cd apps/pulse
E2E_BASE_URL=http://localhost:3500 pnpm exec playwright test --workers=1
```

| Spec | What it proves |
| --- | --- |
| `e2e/routes.spec.ts` | Every route renders for both demo workspaces: status 200, its own title, a heading, no script error, no console error, no failed request. Unknown records answer 404. |
| `e2e/core-flows.spec.ts` | The five day one flows on one job (create a job, log a day, see its profit change, import a CSV, export a CSV), then the seams: shared ledgers on the job tabs, the command palette and go to keys, list state in the address bar and saved views. |
| `e2e/smoke.spec.ts` | Sign in, the top navigation, search, the app switcher, device link pages, health. |
| `e2e/production.spec.ts`, `profit.spec.ts`, `money-ops.spec.ts`, `data.spec.ts` | Each team's write screens: do the thing, reload to prove it was saved, put the data back. |

Sign in happens once per login and the cookies are kept in `test-results/.auth` (the auth server
rate limits sign-ins). When the installed browser is older than the one `@playwright/test` wants, point
`E2E_CHROMIUM` at it. Never run `playwright install` on a shared machine.

## Layout

| Path | What lives there |
| --- | --- |
| `src/app` | Thin route files. `(app)` is the signed-in shell, `(auth)` the sign-in pages, `kiosk` and `wall/t` the device link pages with no shell. |
| `src/features/<area>` | One folder per product area: the server page and its client views. `shell` is the frame, `command` the command palette. |
| `src/components/ui`, `layout`, `pulse` | Design system primitives, the page frame, Pulse building blocks. |
| `src/server` | `env`, `auth`, `session`, `db`, `entitlements`, `errors`, `http/api`, `actions`, `domain`, `integrations`. |
| `src/lib` | Pure helpers safe on the client: `routes`, `nav`, `permissions`, `dates`, `constants`, `streams`, `reports`, hooks. |
| `drizzle` | Hand-written SQL migrations for the `pulse` schema. |
| `public/brand` | Brand pack: the Pulse mark and loader, sibling marks, the company loader. |

## Environment

See `.env.example`. `BETTER_AUTH_SECRET` must match the other apps. `ENTITLEMENTS_DEV_ALLOW_ALL=1`
unlocks the module locally; production needs
`pnpm --filter @kitstak/entitlements grant grant <org-slug> pulse`.

`PULSE_DB_GUARD=1` turns the database guard on: the app runs every query as the plain role
`pulse_app` with the workspace set, so the row level security policies apply to the app itself.
Set it in `.env.local` for local dev (the tests turn it on by themselves). Production stays off
until it is set there; the steps are in `docs/pulse/CONTRACTS.md`, section 12, rule 13. It needs
migration `0009_db_guard_role.sql`; `GET /api/health` shows `guard: { on, ready }`.
