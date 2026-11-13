# KitStak Projects

Projects, tasks and timelines for KitStak — runs on its own or bundled with Portal, CRM and WMS
(shared Better Auth session, shared Postgres, `pm` schema). Product spec: `docs/projects/SPEC.md`;
team contracts: `docs/projects/CONTRACTS.md`.

## Run it

```bash
# once: shared platform tables, then this app's pm schema, then demo data
pnpm --filter @kitstak/db db:migrate
pnpm --filter kitstak-projects db:migrate
pnpm --filter kitstak-projects db:seed

pnpm --filter kitstak-projects dev          # http://localhost:3400
# or from the repo root: pnpm dev:projects
```

Sign in with `admin@kitstak.io` / `KitStak-Demo-2026!` (org `kitstak`).

Several dev servers side by side (one per person/agent): pick a port in 3400-3420 and your own dist dir
**inside `.next/`** (`.next-<name>` is mapped there automatically):

```bash
NEXT_DIST_DIR=.next/alice pnpm --filter kitstak-projects exec next dev -p 3405
```

Don't run `pnpm build` while dev servers are running (it rewrites `next-env.d.ts`); if a dev server starts
reloading in a loop, restart it.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` / `build` / `start` | Next.js 16 (Turbopack) on port 3400 |
| `typecheck` / `lint` / `test` | `tsc --noEmit`, ESLint (flat config), Vitest |
| `db:migrate` | Applies `drizzle/*.sql` (journaled, advisory-locked, own table `drizzle.__kitstak_projects_migrations`) |
| `db:seed` | Seeds demo data through the real domain layer (`src/server/db/seed`) |
| `shot` | `node scripts/shot.mjs --base http://localhost:3405 /p/OPS/board` → light + dark screenshots in `/tmp/claude-0/shots` |

## Environment

See `.env.example`. `BETTER_AUTH_SECRET` must match the other apps. `BLOB_READ_WRITE_TOKEN` (optional)
stores attachments in Vercel Blob; otherwise they go into the database. `ENTITLEMENTS_DEV_ALLOW_ALL=1`
unlocks the module locally; production needs `pnpm --filter @kitstak/entitlements grant grant <org> projects`.
