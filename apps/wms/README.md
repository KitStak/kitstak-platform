# KitStak WMS

The warehouse app in KitStak. It runs receiving, inventory, orders, picking, packing, shipping and
returns for 3PL, kitting and contract packaging shops that hold stock for more than one client.
Every unit has a location and every location has a count.

It runs on its own or alongside Portal, CRM, Projects and Pulse with the same login. Product page:
[kitstak.com/wms](https://kitstak.com/wms).

## What's in it

| Area                    | What it covers                                                   |
| ----------------------- | ---------------------------------------------------------------- |
| Dashboard and analytics | Today on the floor, KPIs, activity                               |
| Receiving               | Purchase orders, vendors, inbound receipts, lots                 |
| Inventory               | Stock by SKU, client and location, adjustments, cycle counts     |
| Products                | Per-client catalogs and kit definitions                          |
| Orders and shipments    | Outbound orders, allocation, shortages, shipment plans, carriers |
| Work orders and jobs    | Kit builds and pick/pack jobs, with exceptions                   |
| Packing and returns     | Packing station and return station screens                       |
| Clients and billing     | 3PL client accounts and what to bill them                        |
| Integrations            | Sales channels (Shopify) and carriers                            |
| Imports and reports     | CSV and Excel in, inventory and transaction reports out          |
| Automation and tasks    | Rules, and floor problems turned into tasks                      |
| Settings                | Users, roles, locations and the organization                     |

## One warehouse per organization

Every organization that has the WMS gets its own Postgres schema (`wms_<org id>`) with its own stock,
orders, clients and history. Nothing is shared between two warehouses except the platform tables in
`core`. How a request finds its warehouse and how that's enforced is in
[`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md).

## Running it

From the repo root, with the shared database running (see the [root README](../../README.md#running-it-locally)):

```bash
cp apps/wms/.env.example apps/wms/.env.local
export DATABASE_URL=postgres://postgres:postgres@localhost:5544/kitstak
export BETTER_AUTH_SECRET=<the same secret the other apps use>

pnpm --filter @kitstak/db db:migrate            # core tables first
pnpm --filter kitstak-wms db:migrate
pnpm --filter kitstak-wms db:seed

pnpm dev:wms                                    # http://localhost:3000
```

Sign in as `admin@kitstak.io`. The password is `SEED_PASSWORD` if you set one, otherwise the local demo
password in `src/server/db/seed`.

Export `DATABASE_URL` before running the `db:` scripts. They don't read `.env.local`, and with no URL
set they quietly use a local PGlite database in `.data/pglite` instead of the Postgres the app runs on.

## Scripts

Run them with `pnpm --filter kitstak-wms <script>`.

| Script                                  | What it does                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `dev` / `build` / `start`               | Next.js on port 3000                                                                                      |
| `typecheck` / `lint`                    | `tsc --noEmit` and ESLint                                                                                 |
| `test` / `test:watch` / `test:coverage` | Vitest                                                                                                    |
| `test:e2e`                              | Playwright end to end tests                                                                               |
| `audit:dead-clicks`                     | Playwright pass that clicks every control and fails on ones that do nothing                               |
| `db:generate`                           | New Drizzle migration from the schema                                                                     |
| `db:migrate`                            | Apply the migrations in `drizzle/` (to `DATABASE_URL`, or to local PGlite when it is unset)               |
| `db:seed` / `db:fixtures`               | Demo data, then acceptance fixtures (safe to rerun)                                                       |
| `db:reset`                              | Drop, migrate, seed and load fixtures. Wipes whatever `DATABASE_URL` points at, and refuses in production |
| `db:verify`                             | Check that stock on hand matches the inventory ledger                                                     |
| `auth:verify-login`                     | Check that a seeded user can sign in                                                                      |

## Built with

Next.js 16 and React 19, TypeScript, PostgreSQL with Drizzle ORM, Better Auth (shared with the other
apps through `@kitstak/auth`), Zod, Tailwind CSS 4, Radix, TanStack Table, Query and Virtual,
Recharts, and React Flow for the automation builder.

## More docs

- [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md): one schema per organization
- [`docs/POSTGRES_MIGRATION.md`](docs/POSTGRES_MIGRATION.md): the move from SQLite to Postgres
- [`docs/DESIGN_SPEC.md`](docs/DESIGN_SPEC.md): the design system
