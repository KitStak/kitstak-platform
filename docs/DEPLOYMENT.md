# Deploying KitStak Platform to Vercel

Four Vercel projects (portal, crm, wms + the `kitstak-website` marketing site at `apps/web`), all importing the same repo `KitStak/kitstak-platform`,
distinguished only by **Root Directory**.

## Per-project settings

| Setting | kitstak-portal | kitstak-crm | kitstak-wms |
|---|---|---|---|
| Root Directory | `apps/portal` | `apps/crm` | `apps/wms` |
| Framework | Next.js (auto) | Next.js (auto) | Next.js (auto) |
| Install Command | default (`pnpm install`) | default | default |
| Build Command | default | default (`vercel-build` runs migrations — needs `DATABASE_URL`) | default |
| Node | 22.x | 22.x | 22.x |

Enable "Include files outside the Root Directory" (on by default for pnpm
workspaces — the apps import `packages/*`).

## Environment variables

`BETTER_AUTH_SECRET` **must be the same value in all three projects** (the
session cookie is shared). Generate once:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Database (Supabase project `kitstak-platform`, ref `uvrcwgyzbtcujcbdwjom`):
- Pooled (runtime): `postgres://postgres.uvrcwgyzbtcujcbdwjom:<PASSWORD>@aws-0-us-west-1.pooler.supabase.com:6543/postgres`
- Direct (migrations): `postgres://postgres:<PASSWORD>@db.uvrcwgyzbtcujcbdwjom.supabase.co:5432/postgres`

### All three projects

| Var | Value |
|---|---|
| `BETTER_AUTH_SECRET` | shared value (above) |
| `BETTER_AUTH_URL` | that app's own origin (e.g. `https://kitstak-portal.vercel.app`) |
| `TRUSTED_ORIGINS` | comma list of all three deployed origins |
| `DATABASE_URL` | pooled connection string |
| `ENTITLEMENTS_DEV_ALLOW_ALL` | `1` until Stripe lands (else nothing is entitled) |

### kitstak-portal only

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | portal origin |
| `NEXT_PUBLIC_CRM_URL` / `NEXT_PUBLIC_WMS_URL` | the other two origins |

### kitstak-crm only

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | CRM origin |
| `DATABASE_URL_UNPOOLED` | direct connection string (**required** — realtime LISTEN/NOTIFY cannot go through the transaction pooler) |
| `WEBHOOK_KDF_SECRET` | its own random 32+ chars (webhook secret encryption) |
| `NEXT_PUBLIC_PORTAL_URL` | portal origin |

### kitstak-wms only

| Var | Value |
|---|---|
| `DIRECT_URL` | direct connection string (deploy-time migrations) |
| `INTEGRATION_KEY` | its own random 32+ chars (integration config encryption) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from the Supabase dashboard (file storage bucket `wms-files`) |
| `NEXT_PUBLIC_PORTAL_URL` / `NEXT_PUBLIC_CRM_URL` | the other origins |

## Database schema (first deploy)

Migrations must run once against the cloud DB, **in this order** (each app's
runner tracks its own table, so they compose):

```bash
DATABASE_URL=<direct> pnpm --filter kitstak-crm db:migrate
```

```bash
DATABASE_URL=<direct> DIRECT_URL=<direct> pnpm --filter kitstak-wms db:migrate
```

(CRM's `vercel-build.sh` also runs its migrations on deploy; WMS deploys run
theirs. Seeding is optional — `db:seed` in each app for demo data.)

## After first deploy

- `TRUSTED_ORIGINS` / `NEXT_PUBLIC_*_URL`: come back and fill with the real
  assigned origins, then redeploy.
- Production domains: portal `kitstak.app` (apex; `www.` and `app.kitstak.app`
  308-redirect to it), CRM `crm.kitstak.app`, WMS `wms.kitstak.app`.
  `AUTH_COOKIE_DOMAIN=.kitstak.app` in all three for cross-app SSO (covers the apex).
  `deploy/secrets.env` `URL_PORTAL` must be `https://kitstak.app`.
  On `*.vercel.app` origins the apps work but sessions don't carry across
  (different sites) — SSO is fully seamless once custom subdomains exist.
- WMS cron (`/api/cron/tick` every minute) comes from `apps/wms/vercel.json`
  automatically.
- Entitlements: when ready to enforce, remove `ENTITLEMENTS_DEV_ALLOW_ALL` and
  grant modules: `pnpm --filter @kitstak/entitlements grant grant <org-slug> <crm|wms>`.
- Stripe: deferred — nothing to configure yet.

## Marketing site (`apps/web` → kitstak.com)

Vercel project `kitstak-website`, Root Directory `apps/web`, no env vars
(fully static). Domains: `kitstak.com` (primary) and `www.kitstak.com`
(redirects to apex). The legacy hub app that previously held these domains is
retired. The product apps stay on `*.kitstak.app`.
