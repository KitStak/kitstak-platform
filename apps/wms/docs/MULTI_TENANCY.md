# WMS multi-tenancy: one separate warehouse per organization

Every organization that holds the `wms` module gets its **own WMS**: its own Postgres
schema with its own stock, orders, clients, users, settings and history. Nothing is shared
between two orgs' warehouses except the platform tables in `core` (identity, orgs,
entitlements).

| Org | Schema |
| --- | --- |
| Platform org (slug `kitstak`) | `wms` — the original schema; its data and query path are unchanged |
| Any other org | `wms_<32 hex of the org uuid>` |

The mapping is `core.wms_tenants` (`packages/db/drizzle/0005_core_wms_tenants.sql`,
mirrored by `drizzle/0012_core_wms_tenants.sql`): `org_id → schema_name`, `status`
`provisioning | active`.

## How a request finds its warehouse

1. Better Auth validates the session against `core` (platform handle).
2. `resolveSession` (`src/server/auth/session-store.ts`) picks the org: the
   `kitstak.wms_org` cookie (header org switcher), else the Better Auth active org, else
   the platform org, else the user's first org — among orgs the user is a **member** of,
   that hold WMS and have an **active** warehouse. The WMS profile and user row are read
   from that org's schema; `SessionUser` carries `orgId` and `tenantSchema`.
3. `defineRoute` hands the handler that org's handle as `ctx.db` and binds it for the
   request (`runWithTenant`), so `getAppDb()` anywhere below returns the same warehouse.
   Server components get it from `getAppDb()` via the session.

Signed in but no warehouse → `/setup-warehouse` (owners/admins of an entitled org can
create it there; everyone else is told who can).

## How isolation is enforced (`src/server/db/tenant.ts`)

Drizzle renders every WMS table as `"wms"."x"`, and ~2,000 raw SQL statements use
unqualified names. A tenant handle, for **every** statement:

- rewrites `"wms".` and bare `wms.` table references to the tenant schema, and
- pins `search_path = <tenant>, public` with a transaction-local `set_config`, sent in the
  same transaction as the statement (pipelined `BEGIN; set_config; stmt; COMMIT` — one
  round trip).

It has to be transaction-local: the Supabase pooler runs in **transaction mode**, so a
session-level `SET` could carry over to another org's next statement. Tenant connections
also come from a separate pool whose default `search_path` is `public`, so a statement that
somehow skipped the tenant path fails on a missing table instead of reading the platform's
data. The write lock (`takeWriteLock`) is per schema, so orgs never block each other's
writes.

`tests/unit/tenancy/tenancy.test.ts` proves it for Drizzle reads/writes, raw SQL and
transactions.

## Provisioning (`src/server/tenancy/provision.ts`)

`POST /api/tenancy/warehouse` (form at `/setup-warehouse`):

1. caller must be an owner/admin member of the org; the org must hold `wms`;
2. one platform transaction registers the schema as `provisioning` and **clones the
   structure** of `wms` from the live catalog (`clone-schema.ts`: tables, defaults,
   identity, CHECKs, PK/unique constraints and indexes under their original names, FKs,
   functions, triggers, views, RLS flags/policies — no data);
3. the starter data is seeded on the new schema (`starter-seed.ts`): company settings,
   system roles + permissions, Data Setup lookups, printout templates, add-on catalog (all
   off), numbering from 1, the caller as the first admin, and the org's first warehouse with
   its starter Receiving/Shipping/Returns locations;
4. the registry row becomes `active`.

A failure after step 2 drops the schema and the registry row, so a retry starts clean; a
`provisioning` row older than 10 minutes is treated as a crashed attempt.

## Schema changes: the tenant migration stream

The legacy `drizzle/` stream only ever targets the platform `wms` schema (it builds tables
in `public` and moves them, and mixes in `core` DDL). **It is frozen for WMS table
changes.** Every change to a WMS table from now on is an entry in `TENANT_MIGRATIONS`
(`src/server/tenancy/migrations.ts`) written against `__TENANT__`:

```ts
{ name: '0001_orders_add_priority', sql: 'ALTER TABLE __TENANT__.shipment_orders ADD COLUMN priority integer' }
```

`npm run db:migrate` applies the legacy stream to `wms`, then each pending tenant entry to
`wms` and every registered tenant schema, recording it in that schema's
`__tenant_migrations` ledger. New tenants are cloned from `wms` (already at head) and copy
its ledger. Update the Drizzle definitions in `src/server/db/schema/*` as before.

## Identities are shared — guarded

Users are platform-wide (`core."user"`), and one person can belong to several orgs. A WMS
admin may change a person's **password, email or credential, delete it, or end their
sessions everywhere** only when that person belongs to no organization other than the
warehouse's own (`identityManagedHere`). Otherwise the admin manages only the warehouse-local
record (roles, warehouses, clients, active state — deactivation then applies to this
warehouse only; its sessions are neither listed nor revocable from here). No WMS flow ever
deletes a core identity because of an email clash: changing a user's email to one another
account holds is refused (only the demo seed may replace its own leftovers). Adding a user whose email already has a KitStak account links that
account (it must already be a member of the org — invite them in the portal first) instead
of creating or deleting one. Portal-granted owner/admin org roles are never downgraded by
WMS user edits.

## Other apps

Portal (onboarding counts, launcher tile), CRM (WMS link card) and Projects read an org's
WMS data through `findWmsTenantSchema` / `wmsTable` from `@kitstak/db/wms-tenants` — never a
hard-coded `wms.` — and treat "no warehouse" as "WMS not installed". CRM's customer search
no longer falls back to the platform org's registry.

## Known limits (follow-ups)

- WMS-local password reset (`/forgot-password`) and SAML SSO (`/api/auth/sso/*`) are
  pre-login, so they act on the platform warehouse only. Members of other orgs reset their
  password in the portal.
- `restore-snapshot` / the demo seed (`db:seed`, `/api/admin/bootstrap`) target the
  platform schema only.
- The in-process writer gate (`enterWriteGate`) is per server instance, not per org.
- Better Auth's sign-in hooks run on the platform handle: WMS sign-in audit events of every
  org land in the platform warehouse's `audit_log`, and the platform password policy applies
  to WMS sign-ins (each warehouse's own policy still governs passwords its admins set).
- `getAppDb()` fails closed in production outside a request; background work must use the
  warehouse handle it was given (`after()` callbacks: `getTenantDbFor(auth.user.tenantSchema)`).
