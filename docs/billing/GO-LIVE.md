# Signup and billing: go live

This is the runbook for turning on real billing. Do the steps in order. Each step says what to run, what
you should see, and what to do if you do not see it. Nothing here is automatic: a person runs every step.

Read `DECISIONS.md` first. `SPEC.md` section 15 is the outline this file fills in. `TESTING.md` is how to
prove the code before you start.

Three rules for the whole day:

1. **Fail closed.** With no Stripe key, production billing is off and says so. It never fakes a charge. If
   a step fails, stop. Do not work around it.
2. **Nothing locks anyone out until step 11.** `ENTITLEMENTS_DEV_ALLOW_ALL=1` stays in production until
   then, so every organization can open every app the whole time.
3. **The old webhook stays on until step 10.** Do not disable the Supabase endpoint earlier.

## Open item 1: real Stripe has never been run end to end

This is the first thing to close. It is written first so nobody can miss it.

Every payment in the tests and in the reviews used the built in test gateway or a fake Stripe client. No
Stripe test key exists in this repo, in the dev container or with the team that built this (checked on
2026-11-23: no `STRIPE_*` variable is set anywhere, and keys never go in the repo). So hosted Checkout,
wallets, the Billing Portal, live signed webhooks, Stripe's invoice PDF and how Stripe's invoice lines look
on our invoice page are all **unseen**. The adapter is proven only against the Stripe SDK types and a fake
client (`packages/billing/src/gateway/stripe.test.ts`, 39 tests).

**What the owner must do:** make a Stripe account in test mode (or a sandbox) and hand over two values,
`sk_test_...` and the `whsec_...` that `stripe listen` prints. Nothing else is needed.

**The run, one hour, in this order.** Record the screen. Each line is pass or fail.

- [ ] `STRIPE_SECRET_KEY=sk_test_... pnpm -F @kitstak/billing stripe:setup apply`, then `stripe:setup check`
      prints every product and price as `ok`.
- [ ] Portal started with the two keys (`DEV.md`, "To try real Stripe test mode"). Billing shows "Test mode".
- [ ] Three carts: Pulse monthly ($29.00), CRM 5 seats and WMS 1 warehouse monthly ($395.20), the same cart
      yearly ($4,031.04). For each, the total on the Stripe pay page equals our review page to the cent.
- [ ] Checkout with `4242 4242 4242 4242`: back on the success page, billing home is active within seconds.
- [ ] Checkout with `4000 0000 0000 0002` (declined): the message shows, nothing is granted.
- [ ] Checkout with `4000 0027 6000 3184` (bank approval): approve finishes it, fail grants nothing.
- [ ] A promo code made in the Stripe dashboard, during a trial: the success page and billing home show the
      reduced first charge with the line "Promo code", and the first invoice equals it.
- [ ] Open two pay pages in two tabs: the first one says it is closed. Only one can be paid.
- [ ] Add 1 seat on a paid plan: the confirm panel amount equals the new Stripe invoice to the cent, and the
      words say "for the N days left".
- [ ] Remove 1 seat: credit shows on billing home, and "Next charge" is the plan price less the credit. The
      server prorates a credit from a date up to one day ahead (full days only). **Watch the portal log
      here.** If Stripe refuses a proration date in the future, the adapter logs one line and counts credits
      from the start of the hour instead. Both are safe. Write down which one Stripe does.
- [ ] Card update in the Billing Portal: the new last 4 shows on billing home and in the activity list.
- [ ] `stripe events resend <id>` for a processed event: the route answers 200 `duplicate`.
- [ ] Download an invoice PDF from the invoice page.

Until every line passes, the honest state is: **built and unit tested, not proven against Stripe.**

## What is and is not proven

Say this out loud before go live, so nobody assumes more than is true.

| Part | State |
|:-|:-|
| Prices, quotes, discounts | Proven by unit tests to the cent, for 9 reference carts. |
| Test gateway, webhooks, sync, access rows | Proven by unit tests and by the browser tests in `TESTING.md`. |
| Emails, reminders, the one minute job | Proven by unit tests and the browser tests, with the dev outbox. |
| Stripe adapter | Checked against the Stripe SDK types and a mocked SDK only. **It has never talked to Stripe.** Open item 1 above is its first real test. |
| Credit, the real next charge, the one plan rule, whole day proration | Proven on the test gateway by database tests (`round1.test.ts`) and browser tests. On Stripe they rest on `invoices.createPreview`, `checkout.sessions.expire`, `creditNotes.create` and `proration_date`, which are only checked against a fake client. |
| Stripe setup script | Proven against a fake account in unit tests. **It has never talked to Stripe.** Step 1 is its first real test. |
| Sending with Resend | Proven with a fake HTTP layer only. Step 3 is its first real test. |

There is no Stripe sandbox for this account (`DECISIONS.md` section 2). If you can make a second Stripe
account in test mode first, run steps 1, 8 and 9 there with test keys before you touch live mode. That is
the safer path and it costs one hour.

## Env vars

All of these are for the **portal** project only. The four product apps and the marketing site need nothing
new. No value ever goes in the repo. Put them in `deploy/secrets.env` (untracked) and run
`node deploy/push-env.mjs`, which sends the payment, mail and sign in secrets to the **production** target
only and removes them from preview and development, so a preview build can never charge a card.

| Variable | Needed | What it is |
|:-|:-|:-|
| `STRIPE_SECRET_KEY` | yes, for billing | The Stripe secret key (`sk_live_...`, or a restricted key `rk_live_...`). With no key, production billing is off. |
| `STRIPE_WEBHOOK_SECRET` | yes, with the key | The signing secret (`whsec_...`) of the portal webhook endpoint from step 8. A key with no secret keeps billing off. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | recommended | The Billing Portal configuration id (`bpc_...`) that step 1 prints. Card updates only. |
| `STRIPE_AUTOMATIC_TAX` | optional | `1` turns Stripe Tax on. Leave it out until tax registrations are set in Stripe. |
| `CRON_SECRET` | yes | A long random value. Vercel Cron sends it to `/api/billing/jobs/tick` every minute. With no value the job answers 503 and no email goes out. |
| `RESEND_API_KEY` | yes | The Resend key. With no key, production mail stays queued. |
| `EMAIL_FROM` | yes, with the key | The sender, for example `KitStak <billing@your-domain>`. The domain must be verified in Resend. |
| `EMAIL_REPLY_TO` | optional | Where replies go. |
| `EMAIL_PROVIDER` | optional | Leave it out. `resend` is chosen by itself when the key is set. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Google sign in. The button shows only when both are set. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | optional | Microsoft sign in. Tenant defaults to `common`. |
| `NEXT_PUBLIC_SITE_URL` | optional | The marketing site. Default `https://kitstak.com`. |
| `BILLING_SELLER_NAME` | optional | The company name in the "From" block of every invoice. Default `KitStak LLC`, the name on the Stripe account. |
| `BILLING_SELLER_ADDRESS` | optional | The seller address on invoices. Split the lines with a bar, like `1 Main St\|Austin, TX 78701\|US`. Not printed until it is set. |
| `BILLING_SELLER_TAX_ID` | optional | The seller tax ID on invoices. Not printed until it is set. |
| `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL` | optional | Legal links. Default: the pages the CRM serves. |
| `ENTITLEMENTS_DEV_ALLOW_ALL` | set to `1` until step 11 | Every organization can open every app. `push-env.mjs` keeps it at `1` in all five product projects until `ENFORCE_ENTITLEMENTS=1` is in `deploy/secrets.env`. |

Make a `CRON_SECRET` like this, and paste it into `deploy/secrets.env` without showing it on screen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`BILLING_TEST_WEBHOOK_SECRET` is for the test gateway only. Never set it in production.

## Step 0. Before the day

- [ ] `pnpm -F @kitstak/billing test`, `pnpm -F kitstak-portal test` and `pnpm -F kitstak-portal e2e` pass
      on the commit you will deploy (`TESTING.md`).
- [ ] `pnpm -F kitstak-portal build` passes (stop the local dev server first).
- [ ] You have the Stripe dashboard open on the KitStak LLC account, with rights to make products, prices,
      webhook endpoints and restricted keys.
- [ ] You have the Resend dashboard open, with rights to add a domain and a key.
- [ ] You have `deploy/secrets.env` with the database password, and the Vercel CLI signed in.
- [ ] Two people know this runbook. One runs it, one watches.

## Step 1. Stripe products, prices and portal configuration

The catalog needs 4 products, 16 prices and 1 Billing Portal configuration in Stripe (`CONTRACTS.md`
section 5). The orchestrating session may already have made the products and prices through the Stripe
connector. The script finds them by fixed id and lookup key, so it is safe either way.

See what it looks for, with no key (this touches nothing):

```bash
pnpm -F @kitstak/billing stripe:setup check
```

Then with the key in your shell for this one command only (do not save it in your shell history):

```bash
read -rs STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY
pnpm -F @kitstak/billing stripe:setup check
```

Each line says `ok`, `missing` or `differs`, and it exits with 1 when anything is not `ok`. Create what is
missing:

```bash
pnpm -F @kitstak/billing stripe:setup apply
pnpm -F @kitstak/billing stripe:setup check
unset STRIPE_SECRET_KEY
```

You should see: the second `check` prints `All ok. Stripe matches the catalog.` and a line
`Portal configuration: bpc_...`. Put that id in `deploy/secrets.env` as `STRIPE_PORTAL_CONFIGURATION_ID`.

What the script will and will not do:

- It creates missing products (ids `kitstak_crm`, `kitstak_wms`, `kitstak_projects`, `kitstak_pulse`),
  missing prices (16 lookup keys that start with `kitstak_`) and one portal configuration that allows card
  updates and nothing about the plan.
- It fixes labels (names, nicknames, metadata) on objects that are already there.
- It never changes an amount. If a price has the wrong amount it says `differs` and skips it. Only
  `stripe:setup apply reprice` replaces it: a new price takes the lookup key and the old one is switched
  off. Read the `differs` line and decide on purpose.
- It never touches the old tier products (Starter, Professional, Enterprise) or any object that does not
  start with `kitstak_`.
- It never creates, changes or disables a webhook endpoint.

If a line says a price "belongs to a product KitStak billing does not manage": stop. Someone reused a
lookup key. Fix it in the Stripe dashboard by hand, then run `check` again.

## Step 2. Stripe settings

In the Stripe dashboard:

- [ ] **Smart Retries** on (Billing, Revenue recovery, Retries).
- [ ] After the last failed retry: **cancel the subscription** (same page). KitStak then shows the plan as
      ended and view only.
- [ ] **Customer emails:** turn off Stripe's own emails for successful payments and failed payments
      (Settings, Emails, and Billing, Revenue recovery, Emails). KitStak sends both. If you leave them on,
      customers get two emails for each event. Do that only on purpose.
- [ ] **Public details:** business name, support email and branding (Settings, Business, Public details and
      Branding). These show on the Checkout page and on invoices.
- [ ] **Invoices:** numbering and footer as you want them (Settings, Billing, Invoices).
- [ ] **Stripe Tax:** decide. If on, add your tax registrations first, then set `STRIPE_AUTOMATIC_TAX=1`.
      If off, leave the variable out. Tax is always its own line.
- [ ] **A restricted key** for the portal is better than the full secret key. Start with write access to
      Checkout Sessions, Customers, Subscriptions, Invoices, Customer portal sessions and Payment Methods,
      and read access to Prices and Products. Keys that start with `rk_live_` work. This list is a
      starting point and has not been tried against Stripe: if a call in step 9 is refused, the error
      names the missing permission. The setup script in step 1 needs write access to Products, Prices and
      Customer portal configurations instead, so run it with a separate key.

### Microsoft sign in (only if you set `MICROSOFT_CLIENT_ID`)

Skip this if you do not offer "Continue with Microsoft". If you do, the app registration needs one extra
claim, or Microsoft sign in will never join an account that already exists.

Why: with the multi tenant endpoint (`MICROSOFT_TENANT_ID` not set, so `common`) anyone can make their own
Microsoft tenant and put a customer's address in a user's `email`. So KitStak does not trust that field by
itself. Microsoft is not a trusted provider for joining accounts (`TRUSTED_LINK_PROVIDERS` in
`packages/auth/src/create-auth.ts`). A Microsoft sign in joins an existing KitStak account only when the
token carries `xms_edov: true`, which Microsoft itself sets when the email's domain is verified in that
tenant. Without the claim the person sees "This email already has a KitStak account. Sign in with your
email and password." A brand new account made with Microsoft starts unverified and gets the 6 digit code.

In the Microsoft Entra admin center, on the app registration:

- [ ] **Authentication:** platform Web, redirect URI `https://<portal host>/api/auth/callback/microsoft`.
- [ ] **Supported account types:** pick on purpose. "Accounts in any organizational directory and personal
      Microsoft accounts" matches `common`. For one company only, set `MICROSOFT_TENANT_ID` to that tenant.
- [ ] **Token configuration, Add optional claim, token type ID:** add `email` and `xms_edov`. Say yes when
      it asks to turn on the Microsoft Graph `email` permission.
- [ ] **API permissions:** `openid`, `profile`, `email`, `User.Read`, `offline_access` (delegated).
- [ ] In the **manifest**, leave `acceptMappedClaims` unset. It must not be `true`.
- [ ] Test with two accounts: one whose domain is verified in its tenant (joins the existing account), and
      one from a throwaway tenant with a made up email (must be refused with the sentence above).

Personal Microsoft accounts carry no `xms_edov`. They can make a new KitStak account but are not joined to an
existing password account by email. That is on purpose.

## Step 3. Mail

- [ ] In Resend, add the sending domain and publish the DNS records it shows (SPF, DKIM, and a DMARC
      record). Wait until Resend says the domain is verified.
- [ ] Make a Resend key that can send. Put it in `deploy/secrets.env` as `RESEND_API_KEY`.
- [ ] Set `EMAIL_FROM` to an address on that exact domain, for example `KitStak <billing@mail.kitstak.com>`.
      If the domain in `EMAIL_FROM` is not the verified one, Resend answers 403 and mail stays queued.
- [ ] Optional: `EMAIL_REPLY_TO`.

The first real send happens in step 9. Volume note: a new sending domain should start slow. Signup codes,
receipts and reminders for a launch week are well inside that.

## Step 4. Database

Migration `0007_core_billing` adds the billing tables. Run it on production:

```bash
node deploy/with-prod-db.mjs pnpm -F @kitstak/db db:migrate
```

You should see `applied 0007_core_billing` the first time and `applied 0 migration(s)` when you run it
again. Then check that the module rule lists four apps:

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'entitlements_module_check';
```

You should see `crm`, `wms`, `projects` and `pulse` in the answer. And the new tables exist:

```sql
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'core' AND table_name LIKE 'billing_%';
```

You should see 10 (`billing_events` from before, plus 9 new ones). `core.signup_intents` is new too.

## Step 5. Backfill access rows

Today every organization can open every app because of the allow all switch. When that switch goes away
in step 11, an organization with no rows in `core.entitlements` would be locked out. Give them rows now.

```bash
node deploy/with-prod-db.mjs pnpm -F @kitstak/billing backfill check
```

It lists every organization with no access rows. Pick one of these for them:

```bash
# Keep exactly what they have today: all four apps, never billed, shown as "Included".
node deploy/with-prod-db.mjs pnpm -F @kitstak/billing backfill apply manual

# Or: start a 14 day free trial of all four apps for each of them.
node deploy/with-prod-db.mjs pnpm -F @kitstak/billing backfill apply trial

# The same, without the "your trial has started" email.
node deploy/with-prod-db.mjs pnpm -F @kitstak/billing backfill apply trial quiet
```

`manual` is the safe choice for internal and friendly organizations. `trial` is for organizations that
should become paying customers. You can run `manual` for everyone and move single organizations later.
A trial is started in the name of an owner. An organization with no owner, or whose owner already used
their one free trial, is skipped and named: handle those with the grant command in `DEV.md`.

- [ ] Run `backfill check` again. You should see `All N organizations have entitlement rows.`

## Step 6. Push env

- [ ] `deploy/secrets.env` has the portal values from the table above, except `STRIPE_WEBHOOK_SECRET`
      (you get it in step 8). **Leave `STRIPE_SECRET_KEY` out for now too**: `push-env.mjs` refuses a key
      with no webhook secret, because that pair keeps billing off anyway.
- [ ] `ENFORCE_ENTITLEMENTS` is **not** in the file.

```bash
node deploy/push-env.mjs
```

You should see, near the top, `ENTITLEMENTS_DEV_ALLOW_ALL=1 stays in every product project` and
`No STRIPE_SECRET_KEY in deploy/secrets.env: billing stays off in production`. The script prints variable
names only, never a value.

## Step 7. Deploy

- [ ] Deploy the portal, the four apps and the marketing site from the release commit.
- [ ] Open `https://kitstak.app/billing` as an owner. You should see the notice "Billing is not available
      right now. Nothing will be charged. Please try again later." and disabled pay buttons. That is the
      fail closed state, and it is correct for now.
- [ ] Open `https://kitstak.app/dev/outbox`. You should see a 404. The dev outbox does not exist in
      production.
- [ ] In Vercel, the portal project lists one cron job: `/api/billing/jobs/tick`, every minute. Call it by
      hand once and check the answer:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://kitstak.app/api/billing/jobs/tick
```

You should see JSON with `"ok":true` and `"errors":[]`. Without the header you should see 401.

## Step 8. The portal webhook

- [ ] In Stripe (Developers, Webhooks) add an endpoint:
      `https://kitstak.app/api/billing/webhooks/stripe`
- [ ] Select exactly these 15 events (`CONTRACTS.md` section 5.6): `checkout.session.completed`,
      `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`,
      `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
      `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
      `invoice.voided`, `invoice.marked_uncollectible`, `customer.updated`, `payment_method.attached`.
- [ ] Copy the endpoint's signing secret into `deploy/secrets.env` as `STRIPE_WEBHOOK_SECRET`, and add
      `STRIPE_SECRET_KEY` now.
- [ ] `node deploy/push-env.mjs`. You should see `Stripe key found: LIVE mode.`
- [ ] Redeploy the portal.
- [ ] Open `https://kitstak.app/billing`. The "not available" notice is gone. There is no "Test mode" label.
- [ ] In Stripe, send a test event to the endpoint (for example `customer.updated`). Then:

```sql
SELECT id, type, status, processed_at FROM core.billing_events ORDER BY processed_at DESC LIMIT 5;
```

You should see the event with status `ignored` (it belongs to no KitStak organization). A row here proves
the signature check and the ledger work. A 400 in Stripe's delivery log means the secret is wrong. A 503
means the key or the secret did not reach the deployment.

The old Supabase endpoint is still on. Both receive events for now. That is fine: the portal ignores
objects it does not know, and the old function never sees the new products.

## Step 9. Live smoke test

Use an internal organization and a real card you own. Every amount is real and is refunded at the end.
This step is the first time the Stripe adapter talks to Stripe, so go slowly and compare every number.

- [ ] **Signup.** Sign up as a new person from `https://kitstak.com/pricing` with Pulse only. You should
      land in the product in under a minute. The welcome email and the code email arrive from your domain.
- [ ] **Trial row.** `core.entitlements` has one `pulse` row with source `trial` and an end 14 days out.
- [ ] **Pay during the trial.** Billing, "Add a card". The review page says "Due today $0.00" and the first
      charge date. Stripe Checkout shows $29.00 with the trial. Pay. You should be back on "You are all
      set." within seconds. The row is now source `stripe`. The "plan is set" email arrives.
- [ ] **Card update.** Billing, "Update card". The Stripe page offers a card update and no plan change or
      cancel. Save another card. Billing home shows the new last 4.
- [ ] **A second organization, charged today.** Sign up again, do not add a card, and ask a developer to
      end the trial early in the database for this one organization (set `trial_ends_at` in
      `core.billing_accounts` and `current_period_end` in `core.entitlements` to a past time). "Pick a
      plan", CRM with 2 seats, pay. You are charged $58.00. The invoice and the receipt email show $58.00.
- [ ] **Plan change preview equals the invoice.** On that plan add 1 seat. Write down "Due today" from the
      confirm panel. Confirm. The new invoice in Stripe has the same amount to the cent.
- [ ] **A declined change changes nothing.** In Stripe set the customer's card to one that declines if you
      have one, or skip this in live mode and note it as not tested.
- [ ] **Cancel, undo, cancel.** "Cancel plan", "Cancel my plan". Billing home shows the end date. "Keep my
      plan". Then cancel again. Stripe shows `cancel_at_period_end`.
- [ ] **Pause and start again now.** On a monthly plan: pause for 1 month, then undo. Nothing is charged.
- [ ] **The activity page** (`/billing/activity`) lists every step above in plain words, and the invoices
      page opens each PDF.
- [ ] **Refund** every charge in the Stripe dashboard, and cancel the test subscriptions there.

Check the ledger has no failures:

```sql
SELECT status, count(*) FROM core.billing_events GROUP BY status;
```

You should see only `processed` and `ignored`. Any `failed` row: read its `error` column and stop.

## Step 10. Turn off the old webhook

Only after steps 8 and 9 passed (`DECISIONS.md` section 4).

- [ ] In Stripe, disable the endpoint that ends in `/functions/v1/stripe-webhook`. Do not delete it yet: a
      disabled endpoint can be enabled again in one click.
- [ ] Send one more test event and confirm it still lands in `core.billing_events`.

## Step 11. Turn enforcement on

From here access follows `core.entitlements`. Step 5 made sure every organization has rows.

- [ ] Run `backfill check` one more time. New organizations made since step 5 show up here.
- [ ] Add this line to `deploy/secrets.env`:

```
ENFORCE_ENTITLEMENTS=1
```

- [ ] `node deploy/push-env.mjs`. You should see `removing ENTITLEMENTS_DEV_ALLOW_ALL everywhere`.
- [ ] Redeploy all five product projects.
- [ ] As an existing organization, open each app. Everything that was open is still open.
- [ ] As a brand new signup with CRM only, open the WMS. You should see the lock screen "WMS is not in your
      trial yet" with one button to add it.
- [ ] Billing home no longer shows the "Dev override" badge.

## Step 12. Watch

Run these daily for the first two weeks, and after any incident.

Webhook events that failed (should be empty):

```sql
SELECT id, type, attempts, error, processed_at FROM core.billing_events
 WHERE status = 'failed' ORDER BY processed_at DESC LIMIT 50;
```

Emails that are stuck (should be empty; the job runs every minute):

```sql
SELECT template, to_email, attempts, error, created_at FROM core.billing_emails
 WHERE status = 'queued' AND send_after < now() - interval '5 minutes' ORDER BY created_at LIMIT 50;
```

Emails that failed for good (3 tries):

```sql
SELECT template, to_email, error, created_at FROM core.billing_emails
 WHERE status = 'failed' ORDER BY created_at DESC LIMIT 50;
```

Organizations whose payment is late (view only after 7 days):

```sql
SELECT o.slug, s.status, s.past_due_since, s.amount_due_cents, s.next_payment_attempt
  FROM core.billing_subscriptions s JOIN core.organization o ON o.id = s.org_id
 WHERE s.status IN ('past_due', 'unpaid') ORDER BY s.past_due_since;
```

Plans that have not been checked against Stripe for a day (the job should keep this empty):

```sql
SELECT o.slug, s.status, s.gateway_synced_at FROM core.billing_subscriptions s
  JOIN core.organization o ON o.id = s.org_id
 WHERE s.status IN ('past_due', 'incomplete') AND s.gateway_synced_at < now() - interval '1 day';
```

Also check, in Vercel, that the cron for `/api/billing/jobs/tick` runs every minute with status 200. The
server log lines for billing start with `[kitstak-billing]`.

## Step 13. Roll back

Pick the smallest step that fixes the problem.

| Problem | Do this | What it does |
|:-|:-|:-|
| People are locked out who should not be | Remove `ENFORCE_ENTITLEMENTS=1` from `deploy/secrets.env`, run `push-env.mjs`, redeploy | Sets `ENTITLEMENTS_DEV_ALLOW_ALL=1` again. Every app opens for everyone. Billing keeps running. |
| One organization has wrong access | `pnpm -F @kitstak/entitlements grant grant <org-slug> <app>` with `deploy/with-prod-db.mjs` | A manual grant. It wins over billing and is never billed. |
| Checkout or plan changes misbehave | Remove `STRIPE_SECRET_KEY` from `deploy/secrets.env`, run `push-env.mjs`, redeploy the portal | Billing is off and says so. Nobody can be charged. Trials and reading still work. |
| Billing state must stop moving | Disable the portal webhook endpoint in Stripe. Enable the old endpoint again only if the old function is still needed | Stripe stops delivering. When you enable it again, the one minute job asks Stripe about every late, unfinished or overdue plan and repairs our copy. Single events can be sent again from the Stripe dashboard. |
| Emails are wrong | Remove `RESEND_API_KEY`, push env, redeploy | Mail stays queued, nothing is lost, and it goes out when the key is back. Rows older than you want can be marked `skipped` by hand first. |

Nothing in a roll back deletes customer data. A trial ending, a failed payment, a pause and a cancel never
delete anything either.

## Launch checklist

The short form, for the day itself.

- [ ] 0. Tests and build pass on the release commit. Two people have read this file.
- [ ] 1. `stripe:setup check` prints `All ok`. Portal configuration id noted.
- [ ] 2. Stripe settings: Smart Retries, cancel after the last retry, Stripe emails off, public details, tax decided.
- [ ] 3. Resend domain verified. Key and sender in `deploy/secrets.env`.
- [ ] 4. Migration 0007 applied. Module rule lists four apps.
- [ ] 5. Backfill done. `backfill check` says every organization has rows.
- [ ] 6. Env pushed, with no Stripe key yet. Allow all is still `1`.
- [ ] 7. Deployed. Billing says "not available". `/dev/outbox` is a 404. The cron answers 200.
- [ ] 8. Portal webhook made with 15 events. Key and secret pushed. A test event is in the ledger.
- [ ] 9. Live smoke test done and refunded. Ledger has no `failed` row.
- [ ] 10. Old Supabase endpoint disabled.
- [ ] 11. Enforcement on. Existing and new organizations checked in every app.
- [ ] 12. Watch queries saved. Someone owns them for two weeks.
- [ ] 13. Roll back steps are understood by both people.

## Dates and limits set in code in review round 1

- [ ] `INVITE_NEEDS_VERIFIED_EMAIL_SINCE` in `packages/billing/src/server/auth-hooks.ts` is `2026-11-23`.
      Accounts made before that day were never asked to verify an email and may keep inviting people (the
      CRM has no verify screen). Every account made on or after it must verify first, in every app. **If
      the launch is later than that day, set the date to the launch day** so nobody who signed up in the
      CRM before launch is blocked from inviting.
- [ ] `INVITES_PER_DAY` in the same file: 50 invite emails a day for an organization with no paid plan, 500
      with one. Raise it for a customer by hand only after you know who they are.
- [ ] Migration `0008_core_billing_credit.sql` must be applied (step 4). It adds the credit columns and the
      trigger that removes a billing manager's role when the person leaves.

## Questions the owner still has to answer

These do not block go live. Each sits in one place and is a small change later (`SPEC.md` section 17).

1. What should a 6th Pulse seat cost? Today the screens link to "Talk to us".
2. Should the welcome screen promise a contact time for guided setup? Today the request is only stored.
3. Should the marketing site host the Terms and Privacy pages? Today the links point at the CRM pages.
4. Stripe Tax: on or off? It is off until registrations are in place.
5. A postal address in the email footer. Transactional mail does not require one, but many senders add it.
