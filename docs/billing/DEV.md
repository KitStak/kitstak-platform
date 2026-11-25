# Local dev for signup and billing

How to run the whole KitStak platform on your machine (or in the dev container), sign in,
and take screenshots. Every command here was run for real in the dev container.

All commands run from the repo root.

## Quick start

```bash
pnpm install                       # once
deploy/dev/db-setup.sh             # start Postgres, migrate, load demo data
deploy/dev/app-start.sh portal     # Portal on http://localhost:3300
deploy/dev/status.sh               # what is up, on which port, where the logs are
```

That is all you need for signup and billing work. Start the other apps when you need them:

```bash
deploy/dev/app-start.sh crm wms projects pulse web
deploy/dev/app-start.sh all        # same as naming all six
```

Stop things:

```bash
deploy/dev/stop.sh crm wms         # only these apps
deploy/dev/stop.sh apps            # every app, keep the database
deploy/dev/stop.sh                 # every app and the database
```

## The scripts

All live in `deploy/dev/`. All are safe to run again.

| Script | What it does |
| --- | --- |
| `db-start.sh` | Starts local Postgres on port 5544. First run creates the cluster and the `kitstak` database. Does nothing if it is already running. |
| `db-setup.sh` | Runs `db-start.sh`, then every migration in the right order, then the demo seeds if the demo orgs are missing. |
| `db-setup.sh --migrate` | Migrations only. Use it after you add a migration. |
| `db-setup.sh --reseed` | Migrations, then reload all demo data. Only the two demo orgs are rebuilt. Orgs you made by signing up stay. |
| `env-init.sh` | Writes an untracked `.env.local` into each app that has none. Never overwrites one. `--print` shows what it would write. |
| `app-start.sh <app> ...` | Starts each named app in the background and waits until it answers a real page. An app that is already listening is reused. A new start begins from a clean dev cache (`apps/<app>/.next/dev` is removed first). |
| `stop.sh [apps or db]` | Stops apps, the database, or both. Waits until each server is really gone. |
| `status.sh` | One line per service: up or down, URL, log file. |
| `shot.mjs` | Signs in and takes screenshots in light and dark, desktop and phone. See below. |
| `rate-limit-reset.sh` | Clears the sign in and sign up rate limit counters in the local database. |
| `billing-tick.sh` | Runs the billing job once on the local portal: sends waiting emails to the dev outbox, queues trial and late payment reminders, runs what is due for test subscriptions. With the word `watch` it runs every 15 seconds. |
| `billing-reset.sh <org-slug>` | Shows the billing rows of one organization. With the word `yes` after the slug it removes them, so the organization is back to "never had a trial". Keeps the organization, its people, its data and manual grants. Refuses any database that is not on this machine. |
| `stripe-env.sh` | Writes `deploy/dev/.run/stripe.env`: the settings that put the Portal in real Stripe test mode. Refuses a live key. Only reads from Stripe. See "Real Stripe test mode" below. |
| `stripe-events.sh` | Fetches real Stripe test events and posts them to the local Portal webhook route, signed with the local webhook secret. `watch` keeps going. Only reads from Stripe, only posts to `localhost`. |
| `stripe-sandbox-test.sh` | Runs the real Stripe sandbox suite (`packages/billing/tests/stripe-sandbox`). Every other test command skips it. |

Runtime files (logs, pid files, saved sessions, screenshots, the generated sign-in secret)
go to `deploy/dev/.run/`, which is gitignored.

## Ports and logs

| App | URL | Log |
| --- | --- | --- |
| Portal | http://localhost:3300 | `deploy/dev/.run/logs/portal.log` |
| CRM | http://localhost:3100 | `deploy/dev/.run/logs/crm.log` |
| WMS | http://localhost:3000 | `deploy/dev/.run/logs/wms.log` |
| Projects | http://localhost:3400 | `deploy/dev/.run/logs/projects.log` |
| Pulse | http://localhost:3500 | `deploy/dev/.run/logs/pulse.log` |
| Web (marketing) | http://localhost:3600 | `deploy/dev/.run/logs/web.log` |
| Postgres | `postgres://postgres:postgres@127.0.0.1:5544/kitstak` | `apps/crm/.data/pg.log` |

Follow a log with `tail -f deploy/dev/.run/logs/portal.log`.

The marketing site runs on 3600, both from its own `dev` script and from the dev scripts, so
it never collides with Projects on 3400.

## The database

One Postgres holds every app. Each app has its own schema: `core` (users, orgs, sessions,
entitlements, billing), `crm`, `wms`, `pm` (Projects) and `pulse`.

- The server is PostgreSQL 18 from the `embedded-postgres` npm package. No Docker needed.
- Data lives in `apps/crm/.data/pg`. This is the same place, port and login that
  `pnpm --filter kitstak-crm db:start` uses, so both ways share one database.
- Migration order (from `docs/DEPLOYMENT.md`): CRM, WMS, core (`@kitstak/db`), Projects,
  Pulse. `db-setup.sh` does this for you. Each runner keeps its own bookkeeping table, so
  running them again applies nothing new.
- A new core migration goes in `packages/db/drizzle/` and must be added to
  `packages/db/drizzle/meta/_journal.json`. Only files in the journal are applied. Then run
  `deploy/dev/db-setup.sh --migrate`.
- Never edit a migration that has been applied. The runner checks a hash and stops.
- Never run `drizzle-kit push` in this repo.

Look inside the database:

```bash
psql postgres://postgres:postgres@127.0.0.1:5544/kitstak
```

Useful billing queries:

```sql
select o.slug, e.module, e.status, e.source, e.current_period_end
  from core.entitlements e join core.organization o on o.id = e.org_id order by 1, 2;
select id, type, processed_at from core.billing_events order by processed_at desc limit 20;
select * from core.stripe_customers;
```

Start over from nothing (this deletes all local data):

```bash
deploy/dev/stop.sh
rm -rf apps/crm/.data/pg apps/crm/.data/pg.log
deploy/dev/db-setup.sh
```

## Env files

`deploy/dev/env-init.sh` writes `apps/<app>/.env.local` for portal, crm, wms, projects and
pulse. These files are gitignored. Never commit them. The marketing site needs none.

| Variable | Value in local dev | Why |
| --- | --- | --- |
| `DATABASE_URL`, `DIRECT_URL` | `postgres://postgres:postgres@127.0.0.1:5544/kitstak` | The shared local database. |
| `BETTER_AUTH_SECRET` | random, made on your machine | Must be the same in every app. One sign in then works in all of them. Kept in `deploy/dev/.run/auth-secret`. |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | the app's own URL | Each app needs to know its own address. |
| `TRUSTED_ORIGINS` | the five app URLs | Lets the apps call each other's sign in routes. |
| `NEXT_PUBLIC_PORTAL_URL`, `NEXT_PUBLIC_CRM_URL`, `NEXT_PUBLIC_WMS_URL`, `NEXT_PUBLIC_PROJECTS_URL`, `NEXT_PUBLIC_PULSE_URL` | the five app URLs | App switcher and links between apps. |
| `ENTITLEMENTS_DEV_ALLOW_ALL` | `1` | Every org can open every app. See the next section. |
| `DEMO_MODE` (WMS only) | `1` | Shows the demo login on the WMS's own sign in page (`/login?local=1`). |

The file for Portal also lists the billing, mail and sign in variables, all commented out. With none of them
set and `NODE_ENV` not set to `production`:

- billing uses the built-in **test gateway**, and every billing screen says "Test mode",
- every email goes to the **dev outbox** at http://localhost:3300/dev/outbox instead of a real inbox,
- the billing job needs no secret.

`NEXT_PUBLIC_SITE_URL` points at the local marketing site (port 3600), so "Talk to us", Terms and Privacy stay local. An older `.env.local` without that line works too: with no value and `NODE_ENV` not `production`, the Portal uses `http://localhost:3600` by itself. The full
list of variables and what each one does is in `GO-LIVE.md`. Keys never go in the repo.

Real Stripe test mode has its own switch and its own section: "Real Stripe test mode" below.

After you change an env file, restart that app:

```bash
deploy/dev/stop.sh portal && deploy/dev/app-start.sh portal
```

### Testing real plans, trials and locked screens

With `ENTITLEMENTS_DEV_ALLOW_ALL=1` every app is open to every org and the Billing page
shows "Dev override". That hides the thing you want to test. To see real trial and paid
states, set `ENTITLEMENTS_DEV_ALLOW_ALL=0` in the `.env.local` of the Portal and of each
app you want to check, then restart those apps. Now access comes only from rows in
`core.entitlements`.

You do not have to edit a file for that. A variable on the command line wins over `.env.local`:

```bash
deploy/dev/stop.sh portal crm projects pulse
ENTITLEMENTS_DEV_ALLOW_ALL=0 deploy/dev/app-start.sh portal crm projects pulse
```

What the switch changes in the Portal: the home page shows a tile for every app, and no tile says "View only".
Trials, checkout, plan changes, the seat limit on invites, emails and the billing pages work the same either
way, so most billing work does not need it off. In the product apps the switch decides whether an app that
is not in the plan shows its lock screen, so those need it off to test plans.

Grant a module by hand (the existing manual path, which must keep working):

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5544/kitstak \
  pnpm --filter @kitstak/entitlements grant grant northwind-robotics crm

DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5544/kitstak \
  pnpm --filter @kitstak/entitlements grant list northwind-robotics
```

Right after `db-setup.sh` no org has any entitlement row, so `list` shows every module as
blocked. That is the true starting state for trial and checkout testing.

## Real Stripe test mode

The default billing mode of the local Portal is the built in test gateway. That is what every test
suite expects, and it is the mode to leave the shared dev stack in. Real Stripe test mode is one
switch away. It talks to a real Stripe account in **test mode** (a sandbox). No real money moves, and
every billing screen still says "Test mode".

### Turn it on

```bash
deploy/dev/stripe-env.sh                              # once: writes deploy/dev/.run/stripe.env
deploy/dev/stop.sh portal
KITSTAK_STRIPE=1 deploy/dev/app-start.sh portal       # the Portal in real Stripe test mode
deploy/dev/status.sh                                  # portal line says "billing: REAL STRIPE TEST MODE"
deploy/dev/stripe-events.sh watch                     # in a second terminal: brings Stripe's events in
```

### Turn it off again

```bash
deploy/dev/stop.sh portal
deploy/dev/app-start.sh portal                        # back to the test gateway, the default
```

`app-start.sh` refuses to "reuse" a Portal that runs in the other mode. It says `WRONG MODE` and tells
you to stop it first, so nobody tests against the wrong gateway by accident.

### Where the key comes from

- **In the cloud dev container** the sandbox key is not in any file or variable. The network proxy adds
  it to every request to `api.stripe.com`. Code sends the placeholder `sk_test_proxyinjected` and never
  sees the real key. `stripe-env.sh` writes that placeholder, and two more lines the proxy needs:
  `STRIPE_HTTP_CLIENT=fetch` (the Stripe SDK then uses `fetch`) and `NODE_USE_ENV_PROXY=1` (Node then
  follows `HTTPS_PROXY`). `curl` works as it is.
- **On your own machine** export your own test key first, then run the script:
  `STRIPE_SECRET_KEY=sk_test_yours deploy/dev/stripe-env.sh`. The key is stored in the untracked file.

`stripe-env.sh` refuses a live key, and it refuses a key that answers in live mode. `deploy/dev/.run/`
is gitignored. Never commit that file. `deploy/dev/stripe-env.sh --print` shows it with secrets hidden.

A new Stripe account needs its products, prices and Billing Portal configuration once:

```bash
STRIPE_SECRET_KEY=sk_test_proxyinjected STRIPE_HTTP_CLIENT=fetch NODE_USE_ENV_PROXY=1 \
  pnpm -F @kitstak/billing stripe:setup apply          # 4 products, 16 prices, 1 portal configuration
```

(On your own machine use your own key and leave the two proxy variables out.) The sandbox
"KitStak LLC sandbox" (`acct_1TYwSo3PaLKIRZri`) already has them. `stripe-env.sh` finds the portal
configuration by its label and writes its id (`bpc_1UfR5Q3PaLKIRZriUCmhs1PW`).

### Webhooks with no tunnel

Stripe cannot reach a Portal on a laptop or in a container. So nothing is registered at Stripe at all.
`stripe-env.sh` makes a signing secret on your machine (`STRIPE_WEBHOOK_SECRET=whsec_local_...`), the
Portal checks signatures with it, and `stripe-events.sh` does the delivery:

1. it reads new events from Stripe (`GET /v1/events`), oldest first,
2. it signs each one the way Stripe does (HMAC SHA-256 of `<time>.<body>` with the local secret),
3. it posts it to `http://localhost:3300/api/billing/webhooks/stripe`.

So the real webhook route and the real handler run on real event bodies.

```bash
deploy/dev/stripe-events.sh                 # everything new, once
deploy/dev/stripe-events.sh watch           # every 3 seconds, until Ctrl C
deploy/dev/stripe-events.sh status          # what is waiting. Sends nothing.
deploy/dev/stripe-events.sh since 30        # start again from the last 30 minutes
deploy/dev/stripe-events.sh replay evt_1 evt_2      # send these again: the Portal answers "duplicate"
deploy/dev/stripe-events.sh since 30 --reverse --twice   # newest first, each one two times
```

Each line it prints is one delivery: the HTTP status, what the Portal answered (`processed`,
`duplicate`, `ignored`, `failed`), the event id and its type. `ignored` is normal for events of
customers this database does not know (other people's test runs in the same sandbox). The tool keeps
the id of the last event it forwarded in `deploy/dev/.run/stripe-events.cursor.json`. An event the
Portal answers 500 for stops the run and is tried again next time, so order is kept. A 503 means the
Portal is not in Stripe mode. A 400 means the Portal was started with another webhook secret: restart it.

The tool only reads from Stripe, only posts to `localhost`, refuses a live key and never forwards a
live event. It never creates, changes or disables a webhook endpoint. On your own machine
`stripe listen -f localhost:3300/api/billing/webhooks/stripe` works too: put the `whsec_` value it
prints into `deploy/dev/.run/stripe.env` and restart the Portal.

### What does not work in the cloud dev container

The container's network lets `api.stripe.com` through and nothing else of Stripe. A browser there is
refused (HTTP 403 from the proxy, `net::ERR_TUNNEL_CONNECTION_FAILED` in Chromium) on:

| Host | What lives there | What to do instead |
|:-|:-|:-|
| `checkout.stripe.com`, `js.stripe.com` | The hosted pay page | The Portal still makes the real Checkout Session. Do the pay step through the API (below). |
| `billing.stripe.com` | The Billing Portal (card update) | The Portal still makes the real session. Attach a test card and make it the customer's default through the API. |
| `pay.stripe.com`, `invoice.stripe.com` | Invoice PDF and the hosted invoice page | The Portal still answers with the right link. Open it on a machine with normal internet. |
| `hooks.stripe.com` | The 3D Secure bank step | Cannot be finished. A card that needs it stays "needs approval". |

This is the container, not the product. On a normal machine all of these open.

The pay step through the API, for the Checkout Session the Portal just made (`cs_test_...` is in the
address the browser was sent to, and in the portal log):

```bash
K=sk_test_proxyinjected; CS=cs_test_...; ORG=<organization id>
CUS=$(curl -s -u $K: https://api.stripe.com/v1/checkout/sessions/$CS | node -pe 'JSON.parse(require("fs").readFileSync(0)).customer')
curl -s -u $K: https://api.stripe.com/v1/checkout/sessions/$CS/line_items       # the prices and quantities
PM=$(curl -s -u $K: https://api.stripe.com/v1/payment_methods/pm_card_visa/attach -d customer=$CUS | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -s -u $K: https://api.stripe.com/v1/subscriptions -d customer=$CUS \
  -d "items[0][price]=price_..." -d "items[0][quantity]=2" \
  -d "metadata[kitstak_org_id]=$ORG" -d default_payment_method=$PM \
  -d "payment_settings[save_default_payment_method]=on_subscription"          # add -d trial_end=<unix time> while a trial runs
curl -s -u $K: -X POST https://api.stripe.com/v1/checkout/sessions/$CS/expire   # the pay page is not used
deploy/dev/stripe-events.sh                                                     # bring the events in
```

Test cards for this: `pm_card_visa` works, `pm_card_chargeDeclined` is declined,
`pm_card_authenticationRequired` needs the bank step, `pm_card_chargeCustomerFail` can be saved and
fails when it is charged later (a failed renewal).

### The real Stripe sandbox suite

```bash
deploy/dev/stripe-sandbox-test.sh              # all of it, about 15 minutes
deploy/dev/stripe-sandbox-test.sh 03-plan      # one file
```

It runs the same server code and the same webhook handler against real Stripe, with Stripe test
clocks for time. The Portal does not have to run, in either mode. Each flow makes its own organization
and its own Stripe customer on its own test clock, checks the Stripe objects and our tables after
every step, and removes its local rows when it is done. `pnpm -F @kitstak/billing test` skips these
files: they only run with `STRIPE_SANDBOX=1`, which this script sets. What the suite covers, what it
found and what it cannot cover is in `STRIPE-SANDBOX-RUN.md`.

- Stripe objects are kept after a run, so you can look at them. `STRIPE_SANDBOX_CLEANUP=1` deletes the
  test clocks the run made (their customers and plans go with them).
- Evidence (the Stripe ids and the events of each flow) is written to
  `deploy/dev/.run/stripe-sandbox/*.json`.
- Some Stripe keys need a person to approve `DELETE /v1/subscriptions/:id` in the Stripe dashboard
  (Stripe answers "This action requires human approval"). The key of the cloud dev container is one.
  With such a key put `STRIPE_SANDBOX_CANCEL_NEEDS_APPROVAL=1` in `deploy/dev/.run/stripe.env`: the two
  flows that end a subscription at once are then skipped and say so. `=check` instead runs the test that
  proves a refusal changes nothing. Each refusal leaves one approval request in Stripe, so use it rarely.

## Emails, the billing job and test time

**The dev outbox.** http://localhost:3300/dev/outbox lists every email the platform would send, newest first:
the subject, the email as a mail client shows it (light and dark), and the plain text. A code email shows its
code at the top with a copy button. Use the search box to see one address. Opening the page also delivers
anything still waiting, so a signup code is there at once. You do not have to be signed in, because a person
who forgot a password is not. The page does not exist in production.

**Sign in with a code.** "Email me a code instead" on http://localhost:3300/login mails a 6 digit code. Locally
it is in the dev outbox like every other email, and the code step links there.

**All templates.** http://localhost:3300/dev/outbox/templates renders all 14 emails with sample data. Nothing
is sent or saved. Use it to read copy and check the look.

**The billing job.** In production Vercel Cron calls `/api/billing/jobs/tick` once a minute. Locally nothing
calls it by itself:

```bash
deploy/dev/billing-tick.sh          # once. Prints what it did.
deploy/dev/billing-tick.sh watch    # every 15 seconds, until Ctrl C
```

It sends queued emails, queues the trial reminders (7, 3 and 1 days left, and "trial ended") and the last day
reminder for a late payment, asks the gateway again about plans a lost event could have left behind, and in
test gateway mode runs renewals that are due.

**Test time.** On billing home, in test gateway mode, owners and billing managers see a "Test tools" panel:
skip ahead 1, 7, 14 or 30 days, skip to the end of the trial, run renewals now, make the next payment fail.
The tools move one organization's dates back, so the rest of the database is not touched. After a skip, run
`deploy/dev/billing-tick.sh` to send the reminder emails that are now due.

**Test cards** on the test checkout page: 4242 4242 4242 4242 works, 4000 0000 0000 0002 is declined,
4000 0000 0000 9995 has not enough money, 4000 0027 6000 3184 needs bank approval, and
4000 0000 0000 0341 fails at renewals. The promo code `TEST10` takes 10% off.

What 4000 0000 0000 0341 does, exactly: saving it always works. It pays a first bill (at checkout, or the
first charge when a free trial ends) and it pays a plan change, such as an added seat. It fails every
renewal charge: the renewal itself, each retry, and "Pay now" on a renewal bill. It does not matter
whether you typed it at checkout or saved it later on the Update card page. To show a failed payment on a
plan that is active: Update card, tap "Fails at next renewal", save, then skip ahead 30 days.

**Start over for one organization.** `deploy/dev/billing-reset.sh <org-slug>` shows its billing rows. Add the
word `yes` to remove them.

**Tests.** `TESTING.md` lists every test and how to run the browser tests (`pnpm -F kitstak-portal e2e`).

## Seeded logins

| Org | Email | Password | Org role |
| --- | --- | --- | --- |
| Northwind Robotics (`northwind-robotics`) | `maya@northwind-robotics.example` | `Northwind-Demo-2026!` | owner |
| Northwind Robotics | `daniel@northwind-robotics.example` | `Northwind-Demo-2026!` | admin |
| Northwind Robotics | `sofia@northwind-robotics.example` | `Northwind-Demo-2026!` | member |
| Northwind Robotics | `aisha@northwind-robotics.example` | `Northwind-Demo-2026!` | viewer |
| KitStak (`kitstak`) | `admin@kitstak.io` | `KitStak!demo2026` | member in `core.member`, admin inside WMS |

- Use Maya for billing work. She is the only seeded org owner.
- The `kitstak` org owns the WMS install. Sign in to WMS as `admin@kitstak.io`.
- Northwind has four more users (liam, hannah, ethan as members, lucas as guest). The
  `kitstak` org has ten users. Full lists: `apps/crm/src/server/db/seed/README.md` and
  `apps/wms/src/server/db/seed/access.ts`.
- The Projects and Pulse READMEs give `KitStak-Demo-2026!` for `admin@kitstak.io`. In a
  database built by `db-setup.sh` the password that works is `KitStak!demo2026`, because
  the WMS seed creates that user.
- Signing up at http://localhost:3300/signup makes a new user and a new org. That is the
  best way to test the first run. Reseeding does not remove these.

Because all apps run on `localhost`, the browser shares the session cookie across ports.
Sign in once at the Portal and the other apps know you.

## Screenshots with Playwright

Chromium and Playwright are preinstalled in the dev container. Do not install browsers.
`require('playwright')` works from any folder.

```bash
# Billing page as Maya: light and dark, desktop (1440x900) and phone (390x844). Four files.
node deploy/dev/shot.mjs /billing

# Public pages, not signed in
node deploy/dev/shot.mjs --anon /signup /login

# One theme, one size, whole page
node deploy/dev/shot.mjs --theme dark --size phone --full /billing

# Another app, another user
node deploy/dev/shot.mjs --app crm /northwind-robotics
node deploy/dev/shot.mjs --app wms --user admin@kitstak.io --password 'KitStak!demo2026' /dashboard

# Open something first, or test reduced motion
node deploy/dev/shot.mjs --click '<css selector>' --prefix menu /
node deploy/dev/shot.mjs --reduced-motion /billing
```

Files go to `deploy/dev/.run/shots/` as `<path>-<size>-<theme>.png`, for example
`billing-phone-dark.png`. Change the folder with `--out <dir>`. Sizes are `desktop`,
`phone`, `tablet`, or any `WIDTHxHEIGHT` such as `--size 320x568`. The script prints the
HTTP status of each page, where a redirect ended, and any browser console errors. It exits
with 1 when a page answers 500 or above. Run `node deploy/dev/shot.mjs --help` for all
options.

How it works, in case you write your own Playwright script:

1. Sign in with a real request: `POST /api/auth/sign-in/email` on the app's origin, JSON
   body `{ "email", "password", "rememberMe": true }`, with an `origin` header equal to the
   app's origin. Use `context.request.post(...)` so the cookie lands in the browser context.
2. Pick the theme with a cookie named `kitstak-theme` set to `light` or `dark` on host
   `localhost`. Also set `colorScheme` on the context so "follow the system" pages match.
3. Phone: viewport 390x844 with `isMobile: true` and `hasTouch: true`.
4. Wait for `networkidle`, then a short pause, before the capture.

A minimal script:

```js
const { chromium } = require('playwright');
(async () => {
  const base = 'http://localhost:3300';
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await context.request.post(`${base}/api/auth/sign-in/email`, {
    data: { email: 'maya@northwind-robotics.example', password: 'Northwind-Demo-2026!', rememberMe: true },
    headers: { origin: base, 'content-type': 'application/json' },
  });
  await context.addCookies([{ name: 'kitstak-theme', value: 'dark', domain: 'localhost', path: '/' }]);
  const page = await context.newPage();
  await page.goto(`${base}/billing`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'billing-phone-dark.png', fullPage: true });
  await browser.close();
})();
```

## One sign in page, and what that means locally

KitStak has one sign in page: the Portal's (http://localhost:3300/login). A signed out visit to the CRM,
the WMS, Projects or Pulse goes there, with the full address of the page you asked for, and comes back
signed in. `/forgot-password` in every app goes to the Portal's too.

- Each app still has its own form at `/login?local=1`. Use it in a test that runs one app alone, or when
  the Portal is down. The WMS demo login (`DEMO_MODE=1`) is on that page:
  http://localhost:3000/login?local=1.
- The WMS also keeps its own page when the warehouse turned on company single sign on.
- Sessions are checked against the database on every request. There is no cached copy in the browser, so a
  session you delete from `core.session` is gone on the next click, in every app.
- A person is switched off by a row in `core.sign_in_blocks` (the WMS writes it when it deactivates a
  person). To try it by hand:

  ```sql
  insert into core.sign_in_blocks (user_id) select id from core."user" where email = 'sofia@northwind-robotics.example';
  delete from core.session where user_id = (select id from core."user" where email = 'sofia@northwind-robotics.example');
  /* and back on: */
  delete from core.sign_in_blocks where user_id = (select id from core."user" where email = 'sofia@northwind-robotics.example');
  ```

- A link that names an organization (`?org=<organization id>`, as every billing email and every app banner
  does) goes through `/org/switch` in the Portal and opens the page for that organization.
- "My account" (name, email, "Set a password") is at http://localhost:3300/settings/account and in the
  account menu.
- An invite email goes out at once. You do not need `billing-tick.sh` to see it in the outbox.

## Known pitfalls

- **Root container and Postgres.** Postgres will not run as root. In the dev container the
  scripts run it as the `postgres` system user, and that user owns `apps/crm/.data/pg`.
  So in the container use `deploy/dev/db-start.sh` and `deploy/dev/stop.sh db`. The CRM
  scripts `pnpm --filter kitstak-crm db:start`, `db:stop` and `db:status` fail there
  ("cannot be run as root" or "Permission denied"). On a normal machine, where you are not
  root, both ways work.
- **Rate limits.** Sign in allows 10 tries a minute and sign up allows 5 tries per 10
  minutes, per address. Counters live in `core.rate_limit`. When a test gets a 429, run
  `deploy/dev/rate-limit-reset.sh`. `shot.mjs` saves its session and reuses it for this
  reason. If a saved session goes stale, delete `deploy/dev/.run/sessions/`.
- **First load is slow.** Next compiles each route the first time you open it. The first
  hit on a page can take 5 to 20 seconds. Later hits are fast. `app-start.sh` waits for
  the first page, so READY means the server really answers.
- **Env changes need a restart.** Next reads `.env.local` at start.
- **Sign in rules need a restart too.** Each app builds its sign in instance once and keeps it. After a
  change in `packages/auth`, or in the organization rules of `packages/billing` (`auth-hooks.ts`), restart
  the apps you test against, or they keep the old rules: `deploy/dev/stop.sh crm && deploy/dev/app-start.sh crm`.
- **Use `localhost`, not `127.0.0.1`,** in the browser. The apps trust the `localhost`
  origins, and the shared cookie is tied to the host name.
- **Memory.** All six apps together use about 6 GB, and a dev server that has compiled many routes can
  grow past 4 GB by itself. When the machine runs short, the system stops the biggest one without a word:
  pages stop loading and `deploy/dev/status.sh` shows it as DOWN. Start it again with `app-start.sh`.
  Start only what you need.
- **A page reloads itself over and over.** That is a broken dev cache, not the product. A production
  build never does this. The dev server keeps its work in `apps/<app>/.next/dev`. With that folder in a bad
  state, the server sends "HMR hash mismatch" to the browser, the tab reloads about five times a second,
  and it grows until the system stops it. It was seen in the CRM and in Pulse on gate round 4, after
  servers had been stopped by the memory limit and started again many times. A restart on the same folder
  kept the fault. Removing the folder fixed it every time. The exact cause was not found, so the scripts
  now close both likely doors: `stop.sh` waits until the server is really gone, and `app-start.sh` removes
  the folder before it starts a server, so every start is clean. `KITSTAK_KEEP_DEV_CACHE=1` keeps the
  folder if you want a faster start. If you start an app some other way and see the reloads, stop it and
  run `rm -rf apps/crm/.next/dev` (with your app's name) before you start it again.
- **The seeded admin answers 401 with the right password.** Five wrong passwords lock an account for 15
  minutes. The Projects and Pulse smoke specs still sign in as `admin@kitstak.io` with the README password
  that does not work in this database, so one run of them locks that person. Clear it with
  `update core.password_policy_state set locked_until = null, failed_login_count = 0 where email = 'admin@kitstak.io';`
- **No email arrives.** There is no real email locally. Look in http://localhost:3300/dev/outbox. Reminder
  emails are only queued when the billing job runs: `deploy/dev/billing-tick.sh`.
- **Playwright cannot find its browser.** The dev container ships one Chromium build. `shot.mjs` and the
  portal's `playwright.config.ts` find it by themselves. Do not download another.
- **`next-env.d.ts` changes by itself.** `next dev` rewrites this tracked file in some
  apps (seen in `apps/pulse`). Do not commit that change.
- **Do not run `pnpm build` in an app while its dev server is up.** Stop the app first.
- **Shared working tree.** If several people or agents share this checkout, they share
  these servers too. `app-start.sh` takes a lock per app, so two starts at once are safe.
  Ask before you run `deploy/dev/stop.sh` with no arguments or `db-setup.sh --reseed`.
- **Port already in use.** `app-start.sh` treats a listening port as "already running" and
  reuses it. If the wrong thing holds the port, run `deploy/dev/stop.sh <app>` first.
- **WMS log shows `NEXT_REDIRECT` on `/`.** That is the signed out redirect to the login
  page in dev mode. It is not a failure.
- **Production stays strict.** None of this applies when `NODE_ENV=production`. There the
  test gateway is off, and billing without Stripe keys must fail closed with an honest
  message.
- **`app-start.sh portal` says `WRONG MODE`.** The Portal runs in real Stripe test mode and you asked
  for the default (or the other way round). Run `deploy/dev/stop.sh portal` and start it again the
  way you want it. `deploy/dev/status.sh` shows the mode of the running Portal.
- **A Stripe call from Node hangs or fails in the cloud container, and `curl` works.** Node ignores the
  proxy unless it is told. The process needs `STRIPE_HTTP_CLIENT=fetch` and `NODE_USE_ENV_PROXY=1`.
  The three Stripe scripts in `deploy/dev/` set both from `deploy/dev/.run/stripe.env`.
