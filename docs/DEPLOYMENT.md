# Deploying KitStak Platform to Vercel

Six Vercel projects (portal, crm, wms, projects, pulse + the `kitstak-website` marketing site at `apps/web`), all importing the same repo `KitStak/kitstak-platform`,
distinguished only by **Root Directory**. KitStak Pulse is the fifth product app: see "KitStak Pulse" below for the one-time
steps to add its project.

## Per-project settings

| Setting | kitstak-portal | kitstak-crm | kitstak-wms | projects | pulse |
|---|---|---|---|---|---|
| Root Directory | `apps/portal` | `apps/crm` | `apps/wms` | `apps/projects` | `apps/pulse` |
| Framework | Next.js (auto) | Next.js (auto) | Next.js (auto) | Next.js (auto) | Next.js (auto) |
| Install Command | default (`pnpm install`) | default | default | default | default |
| Build Command | default | default (`vercel-build` runs migrations — needs `DATABASE_URL`) | default | default | default (migrations are run by hand, see below) |
| Node | 22.x | 22.x | 22.x | 22.x | 22.x |
| Domain (prod) | `kitstak.app` | `crm.kitstak.app` | `wms.kitstak.app` | `projects.kitstak.app` | `pulse.kitstak.app` |

Enable "Include files outside the Root Directory" (on by default for pnpm
workspaces — the apps import `packages/*`).

## Environment variables

`BETTER_AUTH_SECRET` **must be the same value in all five product projects** (the
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
`WMS_PLATFORM_ORG_SLUG` (default `kitstak`) are optional. For Pulse add `URL_PULSE` (the Pulse origin,
`https://pulse.kitstak.app`) and `PROJECT_PULSE` (the Vercel project name). Both or neither: with neither the
script pushes the other four apps exactly as before, so it keeps working until the Pulse project exists.

### All five product projects

| Var | Value |
|---|---|
| `BETTER_AUTH_SECRET` | shared value (above) |
| `BETTER_AUTH_URL` | that app's own origin (e.g. `https://kitstak-portal.vercel.app`) |
| `TRUSTED_ORIGINS` | comma list of the other deployed origins |
| `DATABASE_URL` | pooled connection string |
| `ENTITLEMENTS_DEV_ALLOW_ALL` | `1` until billing is enforced (else an organization with no access rows is locked out). `deploy/push-env.mjs` keeps it at `1` in all five until `ENFORCE_ENTITLEMENTS=1` is in `deploy/secrets.env`. See `docs/billing/GO-LIVE.md` step 11 |

### kitstak-portal only

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | portal origin |
| `NEXT_PUBLIC_CRM_URL` / `NEXT_PUBLIC_WMS_URL` / `NEXT_PUBLIC_PROJECTS_URL` | the other origins (launcher tiles, app switcher, command palette) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | signup and billing. Both or neither. With neither, production billing is off and says so (it fails closed). Production target only |
| `STRIPE_PORTAL_CONFIGURATION_ID`, `STRIPE_AUTOMATIC_TAX` | optional. The Billing Portal configuration from `pnpm -F @kitstak/billing stripe:setup apply`, and `1` to turn Stripe Tax on |
| `CRON_SECRET` | required for billing. Vercel Cron sends it to `/api/billing/jobs/tick` every minute (`apps/portal/vercel.json`): queued emails, trial and late payment reminders, and a second look at plans a lost webhook could have left behind. Without it the route answers 503 and no email goes out |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | platform mail through Resend (`packages/mail`). With no key, production mail stays queued in `core.billing_emails` until a key is set. `push-env.mjs` also sends these three to CRM, WMS, Projects and Pulse (production only): invites leave at once from any app, and WMS sends password resets, welcome emails and report links through Resend when a company has no SMTP server of its own |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` | optional sign in buttons. Each shows only when its id and secret are both set |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL` | optional links (marketing site, legal pages) |

The full list with meanings, and the order to set them in, is `docs/billing/GO-LIVE.md`. The payment, mail
and sign in secrets are pushed to the production target only and removed from preview and development, so
a preview build can never charge a card or send real mail.

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

### pulse only

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_PULSE_URL` | Pulse origin |
| `DIRECT_URL` | direct connection string (run `db:migrate` with it) |
| `NEXT_PUBLIC_PORTAL_URL` / `NEXT_PUBLIC_CRM_URL` / `NEXT_PUBLIC_WMS_URL` / `NEXT_PUBLIC_PROJECTS_URL` | sibling origins (app switcher, links from a job to its deal, work order or project) |
| `CRON_SECRET` | 16+ chars, strongly advised. Vercel Cron sends it to the three routes in `apps/pulse/vercel.json`: `/api/v1/cron/tick` (every 15 min: sibling sync, change notes from the other apps, day rollover, alerts), `/api/v1/cron/reports` (hourly: scheduled report builds) and `/api/v1/cron/cleanup` (daily). Without it each answers 503 and that work only happens while someone has Pulse open |

The other four apps each need `NEXT_PUBLIC_PULSE_URL` (app switcher row, the Profit tab in CRM, the Job profit card
in WMS, the Job profit strip in Projects, the Portal tile) and the Pulse origin in `TRUSTED_ORIGINS`.
`deploy/push-env.mjs` adds both once `URL_PULSE` and `PROJECT_PULSE` are set.

### How the apps talk to each other

- **Shared database, no service-to-service HTTP.** CRM and WMS use `@kitstak/pm-bridge`
  (packages/pm-bridge) to read linked projects/tasks, create tasks and links in the `pm`
  schema, and queue events in `pm.integration_events` (deal stage changed, order shipped).
  Projects drains that inbox (after the unread-count poll, plus the cron above) into its
  automation engine.
- **Pulse works the same way, in both directions.** Portal, CRM, WMS and Projects read Pulse
  through `@kitstak/pulse-bridge` (packages/pulse-bridge) on their own servers: job profit for a
  deal, work order or project, client profit, and the launcher numbers. They leave change notes
  in `pulse.bridge_events` (deal stage changed, work order changed, time logged). Pulse reads
  `crm.*`, the org's own warehouse schema and `pm.*` directly (read only), copies what it needs
  into `pulse.*` rows with a `source_ref`, and never counts a thing twice. The Pulse HTTP API is
  same origin only and sends no CORS headers: no browser ever calls Pulse from another app.
- **Session cookie.** One Better Auth cookie (`AUTH_COOKIE_DOMAIN`) signs you into all five.
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
DATABASE_URL=<direct> DIRECT_URL=<direct> pnpm --filter kitstak-pulse db:migrate  # pulse schema, always last
```

Pulse migrates last: `@kitstak/db` migration `0006_core_pulse_module` must already have widened the
`core.entitlements` module check to include `pulse`, and Pulse's own first migration reads `core.*`.

(CRM's `vercel-build.sh` also runs its migrations on deploy; WMS deploys run
theirs. Seeding is optional — `db:seed` in each app for demo data.)

## After first deploy

- `TRUSTED_ORIGINS` / `NEXT_PUBLIC_*_URL`: come back and fill with the real
  assigned origins, then redeploy.
- Production domains: portal `kitstak.app` (apex; `www.` and `app.kitstak.app`
  308-redirect to it), CRM `crm.kitstak.app`, WMS `wms.kitstak.app`, Projects `projects.kitstak.app`.
  Pulse `pulse.kitstak.app`.
  `AUTH_COOKIE_DOMAIN=.kitstak.app` in all five for cross-app SSO (covers the apex).
  `deploy/secrets.env` `URL_PORTAL` must be `https://kitstak.app`.
  On `*.vercel.app` origins the apps work but sessions don't carry across
  (different sites) — SSO is fully seamless once custom subdomains exist.
- WMS cron (`/api/cron/tick` every minute) comes from `apps/wms/vercel.json`
  automatically.
- Entitlements: do not remove `ENTITLEMENTS_DEV_ALLOW_ALL` by hand. Follow `docs/billing/GO-LIVE.md`:
  backfill access rows first (step 5), then add `ENFORCE_ENTITLEMENTS=1` to `deploy/secrets.env` and run
  `deploy/push-env.mjs` (step 11). A single organization can still be granted an app by hand:
  `pnpm --filter @kitstak/entitlements grant grant <org-slug> <crm|wms|projects|pulse>`.
- Projects cron (`/api/v1/integrations/events` every 5 minutes) comes from
  `apps/projects/vercel.json`; set `CRON_SECRET` or the route answers 401.
- Portal cron (`/api/billing/jobs/tick` every minute) comes from `apps/portal/vercel.json`
  automatically. It needs `CRON_SECRET`.
- Signup and billing: follow `docs/billing/GO-LIVE.md` step by step. It covers the Stripe objects
  (`pnpm -F @kitstak/billing stripe:setup check`), the mail domain, migration 0007, the access row
  backfill (`pnpm -F @kitstak/billing backfill check`), the portal webhook, the live smoke test, turning
  off the old Supabase webhook, and only then removing `ENTITLEMENTS_DEV_ALLOW_ALL`.

## KitStak Pulse (the fifth product project)

One-time steps, done by a person in the Vercel dashboard. Nothing in this repo creates the
project for you, and `deploy/push-env.mjs` only pushes variables to a project that exists.

1. **Create the project.** Import `KitStak/kitstak-platform` again, name it `pulse`, set
   **Root Directory** to `apps/pulse`, leave install and build on their defaults, keep "Include
   files outside the Root Directory" on (the app imports `packages/*`), Node 22.x.
2. **Domain.** Add `pulse.kitstak.app`. Until it exists the app runs on its `*.vercel.app`
   origin, but the shared sign-in only carries across apps on `*.kitstak.app`.
3. **Migrate, in order** (see "Database schema" above): `@kitstak/db` first, then
   `pnpm --filter kitstak-pulse db:migrate` with the direct URL. Check afterwards that the
   database role the apps use owns the `pulse` tables: row level security is on for every
   table with no policies, so only the owner role reads them (the same setup as `pm`).
4. **Secrets.** Add `URL_PULSE=https://pulse.kitstak.app` and `PROJECT_PULSE=pulse` to
   `deploy/secrets.env`, set `CRON_SECRET` if it is not there yet, run
   `node deploy/push-env.mjs`, then redeploy all five product projects so each one picks up
   `NEXT_PUBLIC_PULSE_URL` and the new trusted origin.
5. **Crons** come from `apps/pulse/vercel.json` on the first deploy (three routes, listed
   above). No other setup.
6. **Check.** Open `https://pulse.kitstak.app/api/health`, sign in through the Portal, open
   Pulse from the app switcher, and look at Settings, Connected apps: each sibling app should
   read "Connected" with a "last synced" time for an org that uses it, and "Not set up yet"
   or "Not on your plan" otherwise. Pulse must work either way.
7. **Entitlements.** While `ENTITLEMENTS_DEV_ALLOW_ALL=1` every org can open Pulse. When
   entitlements are enforced, grant it per org:
   `pnpm --filter @kitstak/entitlements grant grant <org-slug> pulse`.

Optional: load the demo data with `pnpm --filter kitstak-pulse db:seed --org=<slug>`.

## Marketing site (`apps/web` → kitstak.com)

Vercel project `kitstak-website`, Root Directory `apps/web`, no env vars
(fully static). Domains: `kitstak.com` (primary) and `www.kitstak.com`
(redirects to apex). The legacy hub app that previously held these domains is
retired. The product apps stay on `*.kitstak.app`.
