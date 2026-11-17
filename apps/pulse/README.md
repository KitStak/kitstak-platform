# KitStak Pulse

Profit by job, client and service for kitting, 3PL and contract packaging shops. Runs on its own
(CSV in and out for every data stream) or bundled with Portal, CRM, WMS and Projects (shared Better
Auth session, shared Postgres, `pulse` schema). Product spec: `docs/pulse/SPEC.md`; team contracts:
`docs/pulse/CONTRACTS.md`; house rules: `AGENTS.md`.

## Run it

```bash
# once: shared platform tables, then this app's pulse schema, then demo data
pnpm --filter @kitstak/db db:migrate
pnpm --filter kitstak-pulse db:migrate
pnpm --filter kitstak-pulse db:seed

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
