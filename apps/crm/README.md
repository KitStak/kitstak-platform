# KitStak CRM

Enterprise CRM / work OS. Read `docs/ARCHITECTURE.md` first — it is the binding contract.

## Requirements

Node >= 22.12 (developed on Node 24). No Docker needed: local Postgres is embedded.

## First run

```bash
npm install
cp .env.example .env.local      # then set BETTER_AUTH_SECRET
npm run db:start                # embedded Postgres on :5544 (data in .data/pg), detached, idempotent
npm run db:migrate
npm run db:seed
npm run dev                     # http://localhost:3100
```

## Scripts

| Script                                        | Purpose                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `dev` / `build` / `start`                     | Next.js on port 3100                                                              |
| `typecheck`, `lint`, `format`, `format:check` | Static checks                                                                     |
| `test`, `test:watch`, `test:coverage`         | Vitest unit/integration tests                                                     |
| `e2e`                                         | Playwright (boots `npm run dev` if nothing is listening)                          |
| `db:start` / `db:stop` / `db:status`          | Embedded Postgres lifecycle                                                       |
| `db:generate`                                 | Generate a Drizzle migration from `src/server/db/schema`                          |
| `db:migrate`                                  | Apply migrations in `drizzle/`                                                    |
| `vercel-build`                                | Build used by Vercel: applies migrations on production deploys, then `next build` |
| `db:seed`                                     | Seed dev data (idempotent, refuses production)                                    |
| `db:reset`                                    | Drop schemas, migrate, seed (local databases only)                                |
| `db:studio`                                   | Drizzle Studio                                                                    |
| `auth:schema`                                 | Regenerate Better Auth tables (`src/server/db/schema/auth.ts`)                    |

## Backend building blocks

- `src/server/api.ts` — `withApi()` wrapper for every `/api/v1` handler (auth, org scoping via route param or `x-org-id`, RBAC, rate limit, Zod, envelope, audit).
- `src/server/rbac` — role → permission matrix. `src/server/http/errors.ts` — typed `AppError`s.
- `src/server/auth` — Better Auth (email/password + organizations/teams), session helpers.
- `src/server/db/schema/cell-values.ts` — CellValue types, Zod schemas and the column-type registry (client-safe).
- `src/proxy.ts` — CSP nonce, origin check for API mutations, login redirect.
- `GET /api/v1/health` — liveness + DB connectivity.



