# Deploying KitStak Platform to Vercel

Five Vercel projects (portal, crm, wms, projects + the `kitstak-website` marketing site at `apps/web`), all importing the same repo `KitStak/kitstak-platform`,
distinguished only by **Root Directory**.

## Per-project settings

| Setting | kitstak-portal | kitstak-crm | kitstak-wms | projects |
|---|---|---|---|---|
| Root Directory | `apps/portal` | `apps/crm` | `apps/wms` | `apps/projects` |
| Framework | Next.js (auto) | Next.js (auto) | Next.js (auto) | Next.js (auto) |
| Install Command | default (`pnpm install`) | default | default | default |
| Build Command | default | default (`vercel-build` runs migrations — needs `DATABASE_URL`) | default | default |
| Node | 22.x | 22.x | 22.x | 22.x |
| Domain (prod) | `kitstak.app` | `crm.kitstak.app` | `wms.kitstak.app` | `projects.kitstak.app` |

Enable "Include files outside the Root Directory" (on by default for pnpm
workspaces — the apps import `packages/*`).

## Environment variables

`BETTER_AUTH_SECRET` **must be the same value in all four projects** (the
session cookie is shared). Generate once:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Database (Supabase project `kitstak-platform`, ref `uvrcwgyzbtcujcbdwjom`):
- Pooled (runtime): `postgres://postgres.uvrcwgyzbtcujcbdwjom:<PASSWORD>@aws-0-us-west-1.pooler.supabase.com:6543/postgres`
- Direct (migrations): `postgres://postgres:<PASSWORD>@db.uvrcwgyzbtcujcbdwjom.supabase.co:5432/postgres`

`deploy/push-env.mjs` pushes everything below from `deploy/secrets.env`. Besides the
existing keys it needs `URL_PROJECTS` (Projects origin) and `PROJECT_PROJECTS` (the Vercel
project name, `projects`); `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN` and
`WMS_PLATFORM_ORG_SLUG` (default `kitstak`) are optional.

### All four projects

| Var | Value |
|---|---|
| `BETTER_AUTH_SECRET` | shared value (above) |
| `BETTER_AUTH_URL` | that app's own origin (e.g. `https://kitstak-portal.vercel.app`) |
| `TRUSTED_ORIGINS` | comma list of the other deployed origins |
| `DATABASE_URL` | pooled connection string |
| `ENTITLEMENTS_DEV_ALLOW_ALL` | `1` until Stripe lands (else nothing is entitled) |

### kitstak-portal only

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | portal origin |
| `NEXT_PUBLIC_CRM_URL` / `NEXT_PUBLIC_WMS_URL` / `NEXT_PUBLIC_PROJECTS_URL` | the other origins (launcher tiles, app switcher, command palette) |

### kitstak-crm only

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | CRM origin |
| `DATABASE_URL_UNPOOLED` | direct connection string (**required** — realtime LISTEN/NOTIFY cannot go through the transaction pooler) |
| `WEBHOOK_KDF_SECRET` | its own random 32+ chars (webhook secret encryption) |
| `NEXT_PUBLIC_PORTAL_URL` / `NEXT_PUBLIC_WMS_URL` / `NEXT_PUBLIC_PROJECTS_URL` | sibling origins (app switcher; the item panel's Projects tab links) |

### kitstak-wms only

| Var | Value |
|---|---|
| `DIRECT_URL` | direct connection string (deploy-time migrations) |
| `INTEGRATION_KEY` | its own random 32+ chars (integration config encryption) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from the Supabase dashboard (file storage bucket `wms-files`) |
| `NEXT_PUBLIC_PORTAL_URL` / `NEXT_PUBLIC_CRM_URL` / `NEXT_PUBLIC_WMS_URL` / `NEXT_PUBLIC_PROJECTS_URL` | the other origins (and its own, for links Projects stores) |

### projects only

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Projects origin |
| `DIRECT_URL` | direct connection string (run `db:migrate` with it) |
| `NEXT_PUBLIC_PORTAL_URL` / `NEXT_PUBLIC_CRM_URL` / `NEXT_PUBLIC_WMS_URL` | sibling origins (deep links on linked CRM/WMS records) |
| `WMS_PLATFORM_ORG_SLUG` | org that owns the single-tenant WMS (default `kitstak`); only it can link WMS records |
| `CRON_SECRET` | optional, 16+ chars. Vercel Cron sends it to `/api/v1/integrations/events` (every 5 min, `apps/projects/vercel.json`) so CRM/WMS events and scheduled rules (due soon, overdue, deal stage, order shipped) run Projects automations even when nobody has Projects open |
| `BLOB_READ_WRITE_TOKEN` | optional; attachments go to Vercel Blob instead of the database |

### How the apps talk to each other

- **Shared database, no service-to-service HTTP.** CRM and WMS use `@kitstak/pm-bridge`
  (packages/pm-bridge) to read linked projects/tasks, create tasks and links in the `pm`
  schema, and queue events in `pm.integration_events` (deal stage changed, order shipped).
  Projects drains that inbox (after the unread-count poll, plus the cron above) into its
  automation engine.
- **Session cookie.** One Better Auth cookie (`AUTH_COOKIE_DOMAIN`) signs you into all four.
- **Graceful when not bundled.** Every cross-app panel hides itself when the org isn't
  entitled to the other module or that app's schema isn't installed.

## Database schema (first deploy)

Migrations must run once against the cloud DB, **in this order** (each app's
runner tracks its own table, so they compose):

```bash
DATABASE_URL=<direct> pnpm --filter kitstak-crm db:migrate
```

```bash
DATABASE_URL=<direct> DIRECT_URL=<direct> pnpm --filter kitstak-wms db:migrate
```

```bash
DATABASE_URL=<direct> pnpm --filter @kitstak/db db:migrate     # core (adds the `projects` module)
DATABASE_URL=<direct> pnpm --filter kitstak-projects db:migrate  # pm schema
```

(CRM's `vercel-build.sh` also runs its migrations on deploy; WMS deploys run
theirs. Seeding is optional — `db:seed` in each app for demo data.)

## After first deploy

- `TRUSTED_ORIGINS` / `NEXT_PUBLIC_*_URL`: come back and fill with the real
  assigned origins, then redeploy.
- Production domains: portal `kitstak.app` (apex; `www.` and `app.kitstak.app`
  308-redirect to it), CRM `crm.kitstak.app`, WMS `wms.kitstak.app`, Projects `projects.kitstak.app`.
  `AUTH_COOKIE_DOMAIN=.kitstak.app` in all four for cross-app SSO (covers the apex).
  `deploy/secrets.env` `URL_PORTAL` must be `https://kitstak.app`.
  On `*.vercel.app` origins the apps work but sessions don't carry across
  (different sites) — SSO is fully seamless once custom subdomains exist.
- WMS cron (`/api/cron/tick` every minute) comes from `apps/wms/vercel.json`
  automatically.
- Entitlements: when ready to enforce, remove `ENTITLEMENTS_DEV_ALLOW_ALL` and
  grant modules: `pnpm --filter @kitstak/entitlements grant grant <org-slug> <crm|wms|projects>`.
- Projects cron (`/api/v1/integrations/events` every 5 minutes) comes from
  `apps/projects/vercel.json`; set `CRON_SECRET` or the route answers 401.
- Stripe: deferred — nothing to configure yet.

## Marketing site (`apps/web` → kitstak.com)

Vercel project `kitstak-website`, Root Directory `apps/web`, no env vars
(fully static). Domains: `kitstak.com` (primary) and `www.kitstak.com`
(redirects to apex). The legacy hub app that previously held these domains is
retired. The product apps stay on `*.kitstak.app`.
