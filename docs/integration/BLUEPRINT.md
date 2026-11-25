# KitStak Platform — Integration Blueprint

**Scope:** merge `apps/crm` (kitstak-crm, Next 16.4.5, port 3100, Better Auth 1.7.18 + Drizzle/pg) and `apps/wms` (kitstak-wms, Next 16.4.5, port 3000, hand-rolled jose/bcryptjs auth + Drizzle/postgres-js) into one platform on one Supabase Postgres, one Better Auth SSO, Stripe test-mode entitlements, a `packages/` layer, and a portal/launcher — while each app stays independently buildable and runnable at every phase.

Root: `C:/Users/Mike Lunsford/Desktop/Work/Projects/KitStak WMS CRM Bridge` (pnpm@10.18.1 workspace, turbo 2.5.8, `pnpm-workspace.yaml` already declares `apps/*`, `packages/*`; `packages/` does not exist yet).

---

## 0. Target topology

| Surface | Dev | Prod |
|---|---|---|
| Portal/launcher | `http://localhost:3300` (`apps/portal`) | `app.kitstak.io` |
| CRM | `http://localhost:3100` (`apps/crm`, already pinned) | `crm.kitstak.io` |
| WMS | `http://localhost:3000` (`apps/wms`, pin `-p 3000`) | `wms.kitstak.io` |
| Database | one Supabase project (reuse existing "KitStak WMS" project), schemas `core` / `crm` / `wms` | same |
| Session cookie | `kitstak.session_token` (+ `kitstak.session_data` cache cookie), host-only on localhost (ports share cookies already) | same names with `Domain=.kitstak.io` (`__Secure-` prefix, NOT `__Host-`) |

Key architectural choice: **every app mounts the same Better Auth instance** (same `BETTER_AUTH_SECRET`, same DB, same cookie names) at its own `/api/auth/[...all]`. No cross-origin auth calls, no CORS work, no auth proxying. SSO = shared cookie domain + shared session table. Each app keeps its own `BETTER_AUTH_URL` (its own origin) and lists all sibling origins in `TRUSTED_ORIGINS`.

---

## 1. Shared Better Auth SSO — `packages/auth`

### 1.1 Package contents (`packages/auth`, npm name `@kitstak/auth`)

Extracted from CRM (sources noted), generalized:

| File | Origin | Contents |
|---|---|---|
| `src/options.ts` | `apps/crm/src/server/auth/options.ts` | DB-agnostic shared options: `appName: 'KitStak'`, `advanced.cookiePrefix: 'kitstak'`, `advanced.database.generateId: 'uuid'`, `defaultCookieAttributes { httpOnly, sameSite:'lax', path:'/' }`, `emailAndPassword` (min 10 / max 128, `autoSignIn`, `revokeSessionsOnPasswordReset`), `session { expiresIn: 14d, updateAge: 1d, freshAge: 15m, cookieCache { enabled, maxAge: 300 } }`, `user.additionalFields { title, timezone }`, organization plugin config. Exports `SESSION_COOKIE_PREFIX`, `SESSION_COOKIE_NAMES` (`kitstak.session_token`, `__Secure-kitstak.session_token`). |
| `src/access-control.ts` | `apps/crm/src/server/auth/access-control.ts` | `orgAccessControl`, `orgRoles` (owner/admin/member/viewer/guest) |
| `src/create-auth.ts` | `apps/crm/src/server/auth/auth.ts` | `createAuth({ db, schema, secret, baseURL, trustedOrigins, cookieDomain?, extraPlugins?, hooks? })` → `betterAuth({...sharedOptions, database: drizzleAdapter(db,{provider:'pg',schema,transaction:true}), rateLimit (memory, customRules for sign-in/sign-up/reset as CRM has today), advanced.crossSubDomainCookies: cookieDomain ? { enabled:true, domain:cookieDomain } : undefined, plugins: [organization, ...extraPlugins, nextCookies()] })`. **`nextCookies()` must stay last** (CRM invariant). CRM's org-metadata guard hooks (`redactOrgMetadata`, `kitstak` metadata-key blocks from `admin-policy.ts`) are passed in by CRM as `hooks`, not baked into the package. |
| `src/password-compat.ts` | new | `emailAndPassword.password: { hash, verify }` override: `verify` detects `$2a$/$2b$/$2y$` → `bcryptjs.compare` (WMS legacy hashes), else delegates to better-auth default scrypt verify; successful bcrypt login triggers rehash-to-default in an `after` hook. `hash` = better-auth default. |
| `src/password-policy-plugin.ts` | ports `apps/wms/src/server/auth/{password-policy.ts,login.ts}` | Better Auth plugin: `before` hooks on `/sign-in/email` and `/change-password` implementing company-configurable policy (minLength/upper/number/symbol/maxAgeDays), lockout (`failed_login_count`, `locked_until`, threshold 5 / 15 min defaults), 72-byte bcrypt rule, and audit emission callbacks. Policy source is injected (WMS passes a loader reading `wms.company_settings.password_policy`); CRM passes nothing and gets defaults. |
| `src/create-auth-client.ts` | `apps/crm/src/lib/auth-client.ts` | `createKitstakAuthClient({ baseURL? })` with `organizationClient` + `inferAdditionalFields`. |
| `src/session-cookie.ts` | `apps/crm/src/proxy.ts` usage | re-export `getSessionCookie` helpers bound to prefix `kitstak` for both proxies. |
| `src/schema.config.ts` | `apps/crm/scripts/auth-schema.config.ts` | single auth-schema generation config; `auth:schema` script moves to this package and outputs to `packages/db/src/schema/core/auth.ts`. Keep the `npx --yes auth@1.7.18` pin in lockstep with the `better-auth` dep. |

Dependencies: `better-auth ^1.7.18`, `bcryptjs ^3.0.3` (compat verify only), peer `drizzle-orm ^0.45.4`.

### 1.2 Cookie / origin decisions

- **Prod:** `AUTH_COOKIE_DOMAIN=.kitstak.io` → `crossSubDomainCookies`. The `__Secure-` prefix survives a Domain attribute (CRM deliberately avoids `__Host-`). HSTS `includeSubDomains; preload` already set by CRM — every subdomain must be HTTPS (fine).
- **Dev:** localhost ignores ports, so :3000/:3100/:3300 already share `kitstak.*` cookies — this is now a feature, not a clobber risk, because all apps validate against the same session table.
- **TRUSTED_ORIGINS** on every app = all three origins (satisfies CRM `checkRequestOrigin()` in `apps/crm/src/server/http/origin.ts` and WMS `isSameOriginRequest`). Keep `Cross-Origin-Resource-Policy: same-origin` and `X-Frame-Options: DENY` — the portal navigates (top-level), never embeds.
- **Session TTL decision:** standardize on CRM's 14-day DB session + 5-min cookie cache. WMS's 12h absolute TTL is replaced by its existing **idle sign-out** (`apps/wms/src/components/layout/idle-sign-out.tsx`, company-configurable minutes — keep, point it at `authClient.signOut()`), plus Better Auth session revocation for the hard cases (below). If a hard 12h ceiling is a compliance requirement, set `session.expiresIn` per-app is NOT possible with one shared table — flag as the one real behavioral compromise.
- WMS `session_version` bump semantics → `auth.api.revokeUserSessions({ userId })` called from the same places (`apps/wms/src/server/repositories/users.ts`: password change, admin access change, deactivation). Admin per-session revoke endpoints (`/api/users/[id]/sessions*`) rewrap `auth.api.listSessions`/`revokeSession`.

### 1.3 CRM changes (small, non-breaking)

- `apps/crm/src/server/auth/auth.ts` → thin: `createAuth({ db, schema, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL, trustedOrigins: trustedOrigins(), cookieDomain: env.AUTH_COOKIE_DOMAIN, hooks: kitstakOrgMetadataHooks })`. `options.ts`/`access-control.ts` become re-exports from `@kitstak/auth` then delete.
- `apps/crm/src/lib/auth-client.ts` → `createKitstakAuthClient()`.
- Fix the pre-existing inconsistency before the proxy pattern is reused: `apps/crm/src/proxy.ts` `PUBLIC_PATHS` lists `/invite(/.*)?` but the real route is `/welcome/invite/[invitationId]`; `apps/crm/src/app/(auth)/signup/signup-form.tsx` `isInviteFlow()` still checks `/invite/`. Align both to `/welcome/invite/`.

### 1.4 WMS migration — file-by-file

**Replace / delete (session & credentials):**

| File | Action |
|---|---|
| `apps/wms/src/server/auth/session-store.ts` | Replace. New `resolveSession()` calls `auth.api.getSession({ headers })` and adapts to the existing `SessionUser` shape `{id,email,name,role,userType,allClients,isApiUser,sessionId,sessionVersion,sessionExpiresAt}` — `role/userType/allClients/isApiUser` come from `wms.user_profiles` (see §2.4), `sessionVersion` hardcoded/removed, `sessionId` = Better Auth session id. This is the single seam: the finding confirms all 526 `defineRoute()` handlers and 63 pages consume `SessionUser`/`AuthContext` only. |
| `apps/wms/src/server/auth/session.ts` | Keep API (`getSessionUser`, React-cache memoized; `getRequestSession`), reimplement on the adapter. `SESSION_COOKIE` constant → `kitstak.session_token` (also fix the duplicated literal at `apps/wms/src/proxy.ts` line 12). |
| `apps/wms/src/server/auth/login.ts` | Delete. Password login = Better Auth `/api/auth/sign-in/email`. Lockout/policy/audit move to the `password-policy-plugin` + audit hooks. The browser soft-failure contract (`x-ks-soft-auth-failure` → 200 `{success:false}`) disappears: `login-form.tsx` switches to `authClient.signIn.email()` which already returns errors without a thrown 401. |
| `apps/wms/src/app/api/auth/{login,logout,logout-all,forgot,reset,change-password,sessions}/route.ts` | Delete (logout-all → `auth.api.revokeSessions`; sessions → `auth.api.listSessions`; forgot/reset → Better Auth request-password-reset/reset-password — note neither app has a mailer, so keep WMS's admin-reset flow: `adminResetPassword` in `repositories/users.ts` reimplemented via `auth.api.setUserPassword` + revoke). Mount `apps/wms/src/app/api/auth/[...all]/route.ts` = `toNextJsHandler(auth)`. |
| `apps/wms/src/server/auth/password.ts`, `password-reset.ts`, `password-policy.ts` | password.ts/password-reset.ts delete (`password_reset_tokens` table retired in favor of Better Auth `verification`); password-policy.ts becomes the loader injected into the plugin. |
| `apps/wms/src/server/auth/csrf.ts`, `csrf-shared.ts`, `apps/wms/src/app/api/auth/csrf/route.ts` | Delete. Better Auth + `defineRoute`'s origin check (keep that) replace double-submit. Strip `x-csrf-token` fetch/attach/retry logic from `apps/wms/src/lib/api-client.ts`; remove `ks_csrf` issuance from `src/proxy.ts`. |
| `apps/wms/src/server/auth/rate-limit.ts` | Keep (Postgres `rate_limits` still backs mutation/bulk-io limiting in `defineRoute`); delete only the `login-ip`/`login-account` buckets — Better Auth `customRules` covers auth paths. |
| `apps/wms/src/proxy.ts` | Cookie name → `kitstak.session_token` via `getSessionCookie(request,{cookiePrefix:'kitstak'})`; add `/api/auth/` to PUBLIC_PREFIXES (already there). |
| SSO: `apps/wms/src/server/repositories/apps-sso.ts`, `src/app/api/auth/sso/{start,callback,acs,metadata,status}/route.ts` | Replace OIDC+PKCE flow with Better Auth `genericOAuth` plugin registered dynamically from the `apps` table row `key='sso'` (keep AES config storage via `INTEGRATION_KEY`). Keep custom: `enforce` + admin break-glass (`passwordLoginBlockedBySso`) as a `before` hook on `/sign-in/email`; `allowedDomains`; never-auto-create (hook rejects unknown emails). `/acs` + `/metadata` SAML stubs can stay as-is (they only reject / serve metadata). `/status` stays public for the login page. |
| Seeds: `apps/wms/src/server/db/seed/access.ts`, `apps/wms/src/app/api/admin/bootstrap/route.ts` | Create users via `auth.api.signUpEmail` (or shared hasher) so hashes land in `account.password`; seed admin `admin@kitstak.io` / `SEED_PASSWORD` unchanged. |
| Tests: `apps/wms/tests/e2e/fixtures/auth.setup.ts`, `auth.ts` | New login call (`POST /api/auth/sign-in/email`) + new cookie names in storage state. `tests/unit/foundation-f3/*` (rate limit / csrf / session) rewritten or retired per module. |
| `apps/wms/src/components/layout/idle-sign-out.tsx`, `user-menu.tsx` | Point sign-out at `authClient.signOut()` (`/api/auth/sign-out`). |

**Stays WMS-owned, untouched except the SessionUser seam:** `src/server/auth/{permissions.ts, permission-catalog.ts, permission-catalog-data.ts, scope.ts, context.ts, audit.ts}`, `src/server/api/define-route.ts`, restrictions redaction, warehouse/client scoping, `user_warehouses`/`user_clients`, `/api/me` + `src/lib/permissions-client.tsx`. Better Auth has no equivalent; they only need `user.id/role/userType/allClients`.

**Identity data migration (script `packages/db/scripts/migrate-wms-identity.ts`):** for each `wms.users` row → upsert `core.user` by email (id cast text→uuid, keep original uuid value), insert `account` row (`provider_id='credential'`, `password=<bcrypt hash verbatim>` — the compat verifier makes it valid), insert `core.member` row in the platform org with role mapped `admin→admin, manager→member, operator→member, viewer→viewer`, insert `wms.user_profiles` (legacy role, user_type, is_api_user, all_clients, preferences). `user_sessions` and `password_reset_tokens` are dropped (everyone re-logs-in once). WMS `audit_log` behavior preserved via Better Auth `hooks.after` on sign-in/out/reset writing the same rows.

### 1.5 Auth env vars (final)

| Var | Scope | Value |
|---|---|---|
| `BETTER_AUTH_SECRET` | all apps, **identical** | ≥32 chars (also CRM webhook-secret KDF input — rotating it invalidates CRM `webhooks.secret_ciphertext`; re-encrypt via `apps/crm/src/server/services/automations-webhooks.ts`) |
| `BETTER_AUTH_URL` | per app | own origin (`http://localhost:3100` / `:3000` / `:3300`) |
| `AUTH_COOKIE_DOMAIN` | per env | unset in dev; `.kitstak.io` in prod |
| `TRUSTED_ORIGINS` | all apps | comma list of all three origins |
| Retired (WMS) | — | `SESSION_SECRET` (keep temporarily: it's also the HKDF fallback for `INTEGRATION_KEY` in `apps/wms/src/server/integrations/crypto.ts` — set `INTEGRATION_KEY` explicitly first, then drop) |

---

## 2. One Supabase Postgres — `core` / `crm` / `wms` schemas

### 2.1 Placement

- Reuse the existing Supabase project ("KitStak WMS"). Runtime = transaction pooler :6543 (`prepare:false` already in WMS driver; CRM pg Pool works against it; CRM `DATABASE_URL_UNPOOLED` → Supabase session/direct conn for LISTEN/NOTIFY — **required**, CRM realtime (`src/server/realtime/listener.ts`) cannot LISTEN through a transaction pooler).
- `wms.*`: move all 111+4 WMS tables from `public` → `wms` via generated migration of `ALTER TABLE public.<t> SET SCHEMA wms;` (plus the trigger fn `billing_reports_period_guard` and the 4 runtime tables in `0004`). Drizzle: wrap every table in `pgSchema('wms')` (mechanical edit across the 16 schema files; `drizzle-kit generate` diff must be hand-checked — remember the `0003_rowid_columns.sql` warning: **never `drizzle-kit push`**).
- `crm.*`: CRM domain tables (workspaces/boards/items/collaboration/dashboards/automations/platform) via `pgSchema('crm')`. CRM moves off embedded-postgres for shared-platform dev (keep `db:start` embedded mode working for isolated CRM dev until Phase 2 completes, then retire).
- `core.*`: Better Auth tables + shared business tables below. Better Auth tables are the **existing CRM auth tables relocated**: `user, session, account, verification, organization, team, team_member, member, invitation` → `ALTER TABLE ... SET SCHEMA core` (drizzleAdapter receives the pgSchema-wrapped schema objects; regenerate via `auth:schema` then wrap).
- RLS: keep WMS's deny-by-default pattern and extend it — `ENABLE ROW LEVEL SECURITY` with no policies on every `core` and `crm` table (app connects as owner `postgres`, PostgREST sees nothing). Port `apps/wms/tests/unit/foundation/pg-schema.test.ts` coverage assertion to all three schemas.

### 2.2 Conventions for `core` (resolving the two apps' conflicts)

uuid PKs with `DEFAULT gen_random_uuid()` (CRM style — stronger); `timestamptz` timestamps (CRM style); plus `created_by/updated_by uuid NULL REFERENCES core."user"(id) ON DELETE SET NULL` and `version integer NOT NULL DEFAULT 1` (WMS style — stronger); soft delete `deleted_at timestamptz` + `is_active boolean` where "disabled but visible" matters. Enums as `text` + CHECK (WMS style — avoids pg-enum migration pain across apps).

### 2.3 Core DDL

```sql
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS wms;

-- core.user / core.session / core.account / core.verification /
-- core.organization / core.member / core.team / core.team_member / core.invitation
--   = Better Auth generated tables (CRM's apps/crm/src/server/db/schema/auth.ts), relocated.
--   organizations = tenants. memberships = core.member (role text, comma-separated multi-role).

-- Shared company/depositor registry (canonicalizes wms.clients; CRM accounts link to it)
CREATE TABLE core.customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
  code          text NOT NULL,                      -- wms clients.code
  name          text NOT NULL,
  official_name text,
  contact_name  text,
  contact_email text,
  phone         text,
  tax_id        text,
  currency      text NOT NULL DEFAULT 'USD',
  billing_plan  text,                               -- wms CLIENT_BILLING_PLANS
  status        text NOT NULL DEFAULT 'Active',     -- wms ACTIVE_STATUSES
  settings      jsonb NOT NULL DEFAULT '{}',
  custom_fields jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES core."user"(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES core."user"(id) ON DELETE SET NULL,
  version    integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  UNIQUE (org_id, code)
);
CREATE INDEX customers_org_idx ON core.customers(org_id) WHERE deleted_at IS NULL;

-- Shared item/SKU registry (identity only; WMS keeps operational detail)
CREATE TABLE core.items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES core.customers(id) ON DELETE CASCADE, -- depositor-scoped like wms.products.client_id
  sku          text NOT NULL,
  name         text NOT NULL,
  barcode      text,
  uom          text NOT NULL DEFAULT 'Each',
  is_kit       boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'Active',
  category     text,
  attrs        jsonb NOT NULL DEFAULT '{}',
  custom_fields jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES core."user"(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES core."user"(id) ON DELETE SET NULL,
  version    integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  UNIQUE (org_id, customer_id, sku)
);
CREATE INDEX items_barcode_idx ON core.items(barcode);

-- Billing / entitlements
CREATE TABLE core.stripe_customers (
  org_id             uuid PRIMARY KEY REFERENCES core.organization(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.entitlements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
  module                 text NOT NULL CHECK (module IN ('crm','wms')),
  status                 text NOT NULL CHECK (status IN ('active','trialing','past_due','canceled')),
  source                 text NOT NULL DEFAULT 'stripe' CHECK (source IN ('stripe','manual','trial')),
  stripe_subscription_id text,
  stripe_price_id        text,
  seats                  integer,
  current_period_end     timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, module)
);

CREATE TABLE core.billing_events (        -- webhook idempotency ledger
  id           text PRIMARY KEY,          -- stripe event id (evt_...)
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Cross-app link bridges (keep each app's native model intact)
CREATE TABLE crm.customer_links (         -- CRM account board item <-> core customer
  core_customer_id uuid NOT NULL REFERENCES core.customers(id) ON DELETE CASCADE,
  org_id   uuid NOT NULL,
  board_id uuid NOT NULL,                 -- crm.boards.id (kind='accounts')
  item_id  uuid NOT NULL,                 -- crm.items.id
  PRIMARY KEY (core_customer_id, item_id)
);
CREATE TABLE crm.item_links (             -- CRM board item <-> core item (deal line / catalog ref)
  core_item_id uuid NOT NULL REFERENCES core.items(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL,
  column_key   text,
  PRIMARY KEY (core_item_id, item_id)
);

-- WMS user profile extension (WMS-only identity columns off core.user)
CREATE TABLE wms.user_profiles (
  user_id      uuid PRIMARY KEY REFERENCES core."user"(id) ON DELETE CASCADE,
  legacy_role  text NOT NULL DEFAULT 'viewer',   -- admin|manager|operator|viewer
  user_type    text NOT NULL DEFAULT 'Operation',
  is_api_user  boolean NOT NULL DEFAULT false,
  all_clients  boolean NOT NULL DEFAULT true,
  preferences  jsonb NOT NULL DEFAULT '{}',
  password_changed_at timestamptz,
  last_login_at timestamptz
);
```

Enable RLS (no policies) on all of the above.

### 2.4 Mapping from existing tables

| Core table | CRM source | WMS source | Migration notes |
|---|---|---|---|
| `core.organization` | `organization` (Better Auth) — relocate as-is | `company_settings` singleton → **one** org row ("KitStak" or company display_name; slug from it); later, per-tenant SaaS can map WMS deployments 1:1 to orgs | WMS has no org_id anywhere; all WMS rows implicitly belong to the platform org. Add `PLATFORM_ORG_ID` constant/env during transition. |
| `core.user` | `user` — relocate | `wms.users` (id text→uuid cast, email dedupe key, `name` kept; `first_name/last_name` concatenate into `name`, originals preserved in `wms.user_profiles.preferences` or dropped) | password_hash → `core.account.password` (bcrypt, compat verify). `session_version/failed_login_count/locked_until` → plugin-managed columns on `wms.user_profiles` or `core.account` metadata; lockout state lives in the password-policy plugin's own table if preferred. |
| `core.member` (memberships) | `member` — relocate | derived: every wms user → member of platform org, role mapped (admin→admin, manager→member, operator→member, viewer→viewer; WMS real authz stays in `wms.roles/role_permissions/user_roles`) | |
| `core.customers` | `crm.items` on boards `kind='accounts'` — **not migrated**, linked via `crm.customer_links` (sync job or manual link UI) | `wms.clients` → 1:1 copy (ids cast text→uuid, values preserved so WMS FKs remain valid as text-uuid strings) | After copy, `wms.clients` is replaced by a **compatibility view** `wms.clients AS SELECT id::text, ... FROM core.customers` for read paths, while `packages/db` exposes the canonical repo; WMS writes to clients go through the new repo. All `client_id` text columns across WMS (products, inventory, shipment_orders, user_clients, …) stay text and join via cast — no FK rewrite in v1. |
| `core.items` | none (CRM has no product table — only text strings in deal fixtures) | `wms.products` identity columns (client_id→customer_id, sku, barcode, name, category, uom, is_kit, status) | WMS keeps `wms.products` as the operational record; add `wms.products.core_item_id uuid` and a sync trigger/repo hook (insert/rename/status propagate to `core.items`). Do **not** attempt to split products' ~60 operational columns in v1. Naming hazard: CRM `crm.items` (board rows) ≠ `core.items` (SKUs) — never alias across. |
| `core.entitlements` etc. | new | new | §3 |
| CRM `audit_log`/`activity_log`, WMS `audit_log`/`change_log` | stay app-schema-local (name collision resolved by schemas) | | unify later, not in scope |

### 2.5 `packages/db` (npm `@kitstak/db`)

- `src/schema/core/*` (auth.ts generated, customers.ts, items.ts, billing.ts, links.ts), `src/schema/index.ts`.
- `src/client-pg.ts` (node-postgres factory, from `apps/crm/src/server/db/index.ts` pattern) and `src/client-postgres-js.ts` (postgres-js factory, `prepare:false`, from `apps/wms/src/server/db/index.ts`) — both apps keep their driver; `core` tables are plain Drizzle objects usable from either (`drizzle-orm ^0.45.4` identical in both).
- `drizzle/` migrations for `core` + the two `SET SCHEMA` migration files; runner `scripts/db-migrate.ts` (session connection via `DIRECT_URL`, advisory lock like WMS `migrate.ts`).
- Env: canonical `DATABASE_URL` (pooled :6543), `DIRECT_URL` (session :5432). **Namespace the per-app overrides** to defuse the collision the tooling audit flagged: apps read `CRM_DATABASE_URL` / `WMS_DATABASE_URL` first, falling back to `DATABASE_URL` — per-app `.env.local` stays authoritative, never hoist a root `.env`.
- WMS PGlite fallback and CRM embedded-postgres remain app-local dev conveniences until Phase 2; after cutover, local dev = one shared local Postgres (keep CRM's embedded-postgres on :5544 as the workspace-wide dev DB — `pnpm --filter kitstak-crm db:start` serves both apps — or a Supabase branch).

---

## 3. Stripe test-mode billing & per-module entitlements — `packages/entitlements`

> **Replaced on 2026-11-23.** This section is kept as history. Signup and billing are now built to
> `docs/billing/`: read `DECISIONS.md` (owner decisions), then `SPEC.md` (what a person sees) and
> `CONTRACTS.md` (names, types, routes, tables, file ownership). Where this section and those files
> disagree, `docs/billing/` wins. The main differences:
>
> - Prices are per app (CRM, WMS, Projects, Pulse) from one catalog in `packages/billing/src/catalog.ts`.
>   There is no "KitStak Bundle" product and no `STRIPE_PRICE_*` env. Prices are found by lookup key.
> - Billing code lives in `@kitstak/billing` (catalog, quote, plan state, the Stripe and test gateways,
>   webhook sync). `@kitstak/entitlements` keeps the reads, the access rule and manual grants, and holds
>   no gateway code. The files `src/sync.ts` and `src/stripe.ts` named below were never added there.
> - The webhook route is `/api/billing/webhooks/stripe`, not `/api/stripe/webhook`.
> - Access has three levels (full, view only, locked) instead of entitled or blocked.
> - There are four modules: `crm`, `wms`, `projects`, `pulse`.

### 3.1 Stripe objects (test mode)

Products: `KitStak CRM`, `KitStak WMS`, `KitStak Bundle`. Prices (monthly, test): referenced only via env — `STRIPE_PRICE_CRM_MONTHLY`, `STRIPE_PRICE_WMS_MONTHLY`, `STRIPE_PRICE_BUNDLE_MONTHLY`. Bundle price carries metadata `modules=crm,wms`; single-module prices `modules=crm` / `modules=wms`. One Stripe Customer per org (`core.stripe_customers`), metadata `org_id=<uuid>`.

Env (portal app only holds the secret): `STRIPE_SECRET_KEY` (`sk_test_...`), `STRIPE_WEBHOOK_SECRET` (`whsec_...`), the three price ids, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_...`) if Checkout-embedded; recommend hosted Checkout + Billing Portal (no publishable key needed).

### 3.2 Package contents (`@kitstak/entitlements`)

- `src/modules.ts`: `type Module = 'crm' | 'wms'`; `MODULES` const.
- `src/read.ts`: `getEntitlements(db, orgId): Promise<Record<Module,{status,periodEnd}>>` + 60-second per-process cache keyed by orgId (`Map` with TTL; both apps already accept in-memory per-process caches — same posture as CRM rate limiting). `hasModule(db, orgId, module)` treats `active|trialing` as entitled; `past_due` entitled-with-banner for `GRACE_DAYS=7` past `current_period_end`, then blocked.
- `src/sync.ts`: `applySubscriptionState(db, stripeSubscription)` — expands price metadata `modules` into `core.entitlements` upserts (bundle writes two rows), idempotent via `core.billing_events`.
- `src/stripe.ts`: lazy Stripe SDK client (`stripe` npm, pinned exact), `createCheckoutSession({orgId, priceId, successUrl, cancelUrl})`, `createBillingPortalSession`.
- `src/dev.ts`: `ENTITLEMENTS_DEV_ALLOW_ALL=1` short-circuits everything to entitled (default in dev/seeds so both apps run without Stripe configured — buildability guarantee).

Webhook endpoint lives in **portal**: `apps/portal/src/app/api/stripe/webhook/route.ts` — verifies `STRIPE_WEBHOOK_SECRET`, handles `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`, writes `core.billing_events` then `applySubscriptionState`. Local dev: `stripe listen --forward-to localhost:3300/api/stripe/webhook`.

### 3.3 Gating per app

**CRM** (choke points from findings):
- API: `withApi()` in `apps/crm/src/server/api.ts` — insert `requireEntitlement('crm')` immediately after org resolution / before RBAC; failure → envelope `{ ok:false, error:{ code:'entitlement.missing' } }` 402. Routes with `org:'none'` (health, public forms) skip it.
- Pages: `getPageOrgMembership()` in `apps/crm/src/server/auth/session.ts` — after membership + IP allow-list, check entitlement; redirect to `${PORTAL_URL}/billing?module=crm&org=<slug>` (dev: render an in-app "CRM not enabled" page so CRM still works portal-less).
- Admin/billing UI link: owner-only (`org:billing` permission already exists in `apps/crm/src/server/rbac/permissions.ts`) → deep-link to portal Billing Portal session.

**WMS:**
- API: `defineRoute()` guard pipeline in `apps/wms/src/server/api/define-route.ts` — after session resolution, `requireEntitlement('wms')` for the platform org (exempt: `auth:"public"` routes, `/api/health`, `/api/cron/tick`, `/api/admin/bootstrap`).
- Pages: `loadShellProps()` in `apps/wms/src/server/shell/shell-props.ts` (single layout gate) + `requirePagePermission` → redirect to portal billing page / in-app blocked screen.
- The existing add-on gating precedent (`labor-analytics` / `operational-analytics` apps in Settings>Apps) is the UX model: an unentitled module renders like a locked add-on.

**Portal:** launcher tiles reflect `getEntitlements`; "Enable" → Checkout; "Manage" → Billing Portal.

---

## 4. `packages/` layout

```
packages/
  config/          @kitstak/config
    tsconfig/base.json            # extracted — apps' tsconfig.json are byte-identical today
    eslint/base.mjs               # flat config: eslint-config-next core-web-vitals + typescript + shared ignores
    prettier/index.json           # adopt CRM's .prettierrc.json (semi, singleQuote, trailingComma all, printWidth 110); root prettier ^3.6.2 upgraded to ^3.9.10
    vitest/base.ts                # shared thresholds (lines/fn 80, branches 75), restoreMocks
  ui/              @kitstak/ui
    src/styles/tokens.css         # THE shared 858-line token file — single source replacing the two
                                  # byte-identical copies; each app's globals.css does
                                  # @import '@kitstak/ui/styles/tokens.css'; retire the SHA-256
                                  # pin tests (apps/*/src/components/ui/design-system.test.ts →
                                  # assert the import path instead)
    src/theme/{theme-script.ts, theme-cookie.ts}   # unify localStorage key: pick 'ks-theme' (WMS)
                                  # vs cookie 'kitstak-theme' (CRM) — standardize on cookie
                                  # 'kitstak-theme' + localStorage 'kitstak-theme', shared
                                  # THEME_INIT_SCRIPT, so dark mode follows the user across apps
    src/components/{button,badge,dialog,dropdown-menu,popover,select,tabs,tooltip,kbd,
                    spinner,empty-state,avatar,toast,cn}.tsx
                                  # extraction order: primitives both apps duplicate; standardize
                                  # on the monolith `radix-ui@1.8.1` import style (WMS pattern),
                                  # CRM drops its 12 scoped @radix-ui/react-* deps as components move
    src/app-switcher/app-switcher.tsx              # §6 shared launcher menu
  auth/            @kitstak/auth                   # §1
  db/              @kitstak/db                     # §2.5
  entitlements/    @kitstak/entitlements           # §3
```

All packages ship TypeScript source (`"exports": { ".": "./src/index.ts" }`), consumed via `transpilePackages: ['@kitstak/ui','@kitstak/auth','@kitstak/db','@kitstak/entitlements','@kitstak/config']` in both `next.config.ts` — no build step, which keeps turbo's `lint/typecheck/test dependsOn ^build` from forcing package builds (then relax that turbo config, see §5 step 8).

Dependency direction: `config ← (ui, db) ← auth ← entitlements ← apps`. No package imports from an app.

---

## 5. Monorepo tooling harmonization — dependency order

All from the verified tooling audit; each step leaves both apps buildable.

1. **Delete stale npm lockfiles** `apps/crm/package-lock.json`, `apps/wms/package-lock.json` (pnpm-lock.yaml authoritative). Simultaneously fix `apps/wms` `db:reset` script: `npm run db:drop && ...` → `pnpm run db:drop && pnpm run db:migrate && pnpm run db:seed && pnpm run db:fixtures`.
2. **Fix the three confirmed phantom deps** (pnpm strict isolation breaks them today): add `eslint-plugin-react-hooks` to `apps/wms` devDependencies; add `@next/env` and `jsdom` to `apps/crm` devDependencies. (`pnpm --filter kitstak-wms lint`, CRM `drizzle.config.ts`/`scripts/load-env.ts`, and CRM's vitest `dom` project are all broken until this lands.)
3. **Dedupe Playwright**: move WMS from pinned `@playwright/test`/`playwright`/`playwright-core` 1.55.0 → `^1.65.0` (match CRM); verify `@axe-core/playwright 4.14.0` compat; one browser-binary set. Normalize script names: WMS `test:e2e` stays, add CRM alias `test:e2e` (keep `e2e` as alias) so turbo gets one task name.
4. **Engines + pins**: root already `node >=22`; set `apps/wms` `"engines": { "node": ">=22.12.0" }` (match CRM); add `.nvmrc`/`.node-version` `22.12.0`. Pin WMS dev port: `"dev": "next dev -p 3000"`, `"start": "next start -p 3000"`. Pick one dependency pin policy (recommend caret, matching CRM) and align drifted specs.
5. **Prettier**: single root config = CRM's settings (`.prettierrc.json` hoisted to root), root `prettier ^3.9.10`, remove CRM-local dep/config; **accept the one-time wholesale reformat of apps/wms** (double→single quotes) as its own isolated commit; add `format`/`format:check` scripts to wms or rely on root `pnpm format`.
6. **Create `packages/config`** (step 4 outputs feed it): shared tsconfig base (apps extend it — zero diff), shared eslint base (WMS keeps its react-hooks/react-compiler warn overrides and per-glob rules as app-local additions), shared vitest base.
7. **Create `packages/ui`** with `tokens.css` + theme unification (the wms `globals.css` comment literally asks for this). Both apps' `globals.css` switch to the package import; delete the duplicated files and SHA-pin tests.
8. **turbo.json**: now that packages exist (source-shipped, no build output), change `lint/typecheck/test` `dependsOn` from `^build` to `[]` (or `^topo`); add `e2e` task (`cache:false`); add `db:migrate` task; keep `build` `dependsOn ^build` for future built packages.
9. **Env hygiene**: per-app `.env.local` stays; introduce `CRM_DATABASE_URL`/`WMS_DATABASE_URL` precedence in each app's env loader (`apps/crm/src/server/env.ts` `withIntegrationFallbacks`, `apps/wms/src/server/db/index.ts databaseUrl()`); never create a root `.env` with `DATABASE_URL`.
10. **Deploy configs stay separate**: three Vercel projects (crm, wms, portal) with distinct root directories; wms keeps `vercel.json` cron `* * * * *` → `/api/cron/tick` + `.vercelignore` + `outputFileTracing*`; crm keeps `scripts/vercel-build.sh` (note: POSIX sh — Windows contributors run `pnpm --filter kitstak-crm build` locally). Vercel monorepo: set `installCommand: pnpm install --frozen-lockfile` at repo root per project.
11. **Defer, don't merge**: CSP strategies (CRM per-request nonce in `src/proxy.ts` vs WMS static `unsafe-inline` in `next.config.ts` — WMS CSP must keep `connect-src http://127.0.0.1:9101` for the Direct Print agent), `cacheComponents/partialPrefetching` (on only in WMS, incompatible with CRM's nonce), WMS's exported-logic `next.config.ts`. These are app-intrinsic; harmonizing them is not required for integration.

---

## 6. Portal / launcher strategy

**`apps/portal`** (new, `kitstak-portal`, Next 16.4.5, port 3300, deliberately thin — no DB schema of its own beyond `core`):

- Routes: `/` (launcher: CRM + WMS tiles with entitlement state, org switcher via Better Auth organization client), `/login` `/signup` `/welcome` (reuse CRM's auth UI patterns from `apps/crm/src/app/(auth)/*` via copy — auth *flows* are identical since the instance is shared), `/billing` (Checkout + Billing Portal launch), `/settings/organization` (org profile, members, invitations — Better Auth organization endpoints), `/api/auth/[...all]`, `/api/stripe/webhook`, `/api/v1/launcher` (entitlements + membership summary for the tiles).
- Env: `BETTER_AUTH_*`, `TRUSTED_ORIGINS`, `DATABASE_URL`/`DIRECT_URL`, `STRIPE_*`, `NEXT_PUBLIC_CRM_URL=http://localhost:3100`, `NEXT_PUBLIC_WMS_URL=http://localhost:3000`.

**"Feels like one product" mechanics:**
- **Subdomains, not path rewrites.** Two independent Next 16 apps (one with PPR/cacheComponents, one with nonce-CSP) under one domain via rewrites/microfrontends is brittle; top-level navigation between `app.` / `crm.` / `wms.kitstak.io` with a shared session cookie is seamless and preserves each app's headers (XFO DENY / CORP same-origin untouched — nothing embeds anything).
- **Shared `AppSwitcher`** (`packages/ui/src/app-switcher`): 9-dot/module menu rendered in CRM's `TopBar` (`apps/crm/src/features/shell/top-nav/top-nav.tsx`) and WMS's `AppShell` top bar (`apps/wms/src/components/layout/app-shell.tsx`), listing Portal / CRM / WMS with entitlement-aware enablement; links are absolute URLs from `NEXT_PUBLIC_*_URL`. Shared tokens.css + unified theme cookie (§4) make the hop visually invisible.
- **Login redirect contract:** each app keeps its own `/login` gate (standalone capability preserved); `?next=` stays host-local (CRM's `safeNextPath` guard pattern adopted by WMS). Portal is the default `successUrl` after signup; cross-app deep links just work because the cookie is shared.
- **Run separately:** every app functions with only its own env + `DATABASE_URL` + shared secret; portal absent → apps still authenticate (they host the same auth endpoints); Stripe absent → `ENTITLEMENTS_DEV_ALLOW_ALL=1`.

---

## 7. Phased execution plan

Every phase ends with: `pnpm build && pnpm lint && pnpm typecheck && pnpm test` green for **both** apps, plus `apps/wms` `pnpm db:verify` (ledger invariants) wherever its DB was touched.

**Phase 0 — Workspace stabilization (no behavior change).** §5 steps 1–5. Exit: clean pnpm install, wms lint passes, crm drizzle/vitest-dom pass, single Playwright version.

**Phase 1 — `packages/config` + `packages/ui` (tokens/theme).** §5 steps 6–8. Both apps import tokens from the package; prettier reformat lands. Exit: visual no-op verified by each app's existing Playwright screenshot/dead-click suites.

**Phase 2 — One database.** Create `core`/`crm`/`wms` schemas in Supabase. (a) WMS: `SET SCHEMA wms` migration + `pgSchema('wms')` Drizzle edits; bootstrap/seed/verify-ledger re-run. (b) CRM: point at the same Supabase project (`CRM_DATABASE_URL` pooled + `DATABASE_URL_UNPOOLED` session for LISTEN/NOTIFY), tables created in `crm` schema via `pgSchema('crm')` + regenerated migration; demo seed re-run. (c) `packages/db` package with both driver factories and the migration runner; RLS-coverage test extended. Apps still have fully separate data. Exit: both apps run against one project; CRM realtime SSE works over the unpooled conn.

**Phase 3 — Shared auth package, CRM first.** Build `@kitstak/auth`; relocate Better Auth tables to `core` (`SET SCHEMA core` + regenerate `auth:schema` into `packages/db`); CRM consumes `createAuth`/`createKitstakAuthClient`; fix the `/invite` PUBLIC_PATHS inconsistency. WMS untouched. Exit: CRM auth e2e green; WMS unaffected.

**Phase 4 — WMS onto Better Auth.** §1.4 file-by-file swap behind the `SessionUser` seam + identity migration script (bcrypt hashes carried into `core.account.password`, compat verifier live). Password-policy/lockout plugin, SSO genericOAuth port, audit hooks, CSRF removal, e2e fixture rewrite. Feature-flag the cutover with `WMS_AUTH=better|legacy` env switch for one release if desired. Exit: WMS e2e auth suite green; all WMS sessions re-established via new cookie; `user_sessions`/`password_reset_tokens`/`rate_limits` login buckets retired.

**Phase 5 — Core business tables.** `core.customers` + `core.items` DDL + wms.clients copy/view + `wms.products.core_item_id` sync + `crm.customer_links`/`crm.item_links` bridges and a minimal CRM "link account to WMS client" affordance. Exit: WMS clients/products CRUD round-trips through core; CRM boards unaffected; `db:verify` green.

**Phase 6 — Stripe entitlements.** `@kitstak/entitlements`, `core.entitlements`/`stripe_customers`/`billing_events`, gating inserted at the four choke points (`withApi`, `getPageOrgMembership`, `defineRoute`, `loadShellProps`), `ENTITLEMENTS_DEV_ALLOW_ALL=1` default in dev/seed/e2e env so suites stay green. Exit: toggling an entitlement row blocks/unblocks each app; test-mode Checkout round-trip verified via `stripe listen`.

**Phase 7 — Portal + SSO polish.** `apps/portal` (launcher, billing, org settings, webhook), `AppSwitcher` wired into both shells, prod `AUTH_COOKIE_DOMAIN=.kitstak.io` + three Vercel projects + `TRUSTED_ORIGINS` finalized, unified theme cookie live. Exit: sign in at portal → open CRM and WMS tiles with no re-auth; each app still runs standalone with portal stopped.

**Cross-phase risk register:** (1) `BETTER_AUTH_SECRET` doubles as CRM webhook-secret KDF and WMS `INTEGRATION_KEY` fallback — set `INTEGRATION_KEY` explicitly before Phase 4 and never rotate the shared secret without re-encrypting CRM `webhooks.secret_ciphertext`. (2) WMS `drizzle-kit push` is forbidden (hidden `rowid` identity columns from `0003`). (3) CRM LISTEN/NOTIFY requires the non-pooled Supabase connection — a transaction-pooler-only config silently kills CRM realtime. (4) Session TTL compromise (14d + idle sign-out replacing WMS 12h absolute) is the one user-visible auth behavior change; confirm acceptable before Phase 4. (5) The name `items` means three different things (`crm.items` board rows, `core.items` SKUs, WMS "Total Inventory") — enforce schema-qualified references in all shared code.
