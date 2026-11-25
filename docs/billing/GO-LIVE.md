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

## Open item 1: real Stripe, what is proven and what a person still has to see

Until 2026-11-24 every payment in the tests and reviews used the built in test gateway or a fake Stripe
client. On 2026-11-24 the whole billing flow was run against the real Stripe sandbox
"KitStak LLC sandbox" (`acct_1TYwSo3PaLKIRZri`, test mode). The full record is `STRIPE-SANDBOX-RUN.md`:
what was run, the Stripe object ids, the six defects it found and how each was fixed, and what could
not be run. The run can be repeated with one command: `deploy/dev/stripe-sandbox-test.sh` (`DEV.md`,
"Real Stripe test mode").

**Proven on real Stripe** (Stripe objects and our tables checked after every step): products, prices
and the portal configuration from `stripe:setup`; a trial with no card; the real Checkout Session the
app makes; a card saved during the trial and the first charge when the trial ends; a first payment
with no trial; a declined card and a card that needs bank approval grant nothing; seats and warehouses
up and down, to the cent of the preview; the bundle discount on and off; monthly to yearly; pause,
"Start again now" and a pause that runs out; cancel at period end and "Keep my plan"; a failed renewal,
all of Stripe's retries, and the plan ending when Stripe gives up; a new card and "Pay now"; a renewal
the bank wants approved; the invoice list and the PDF links; every event delivered twice and newest
first.

**Not seen yet, because the run was made from a container that can reach `api.stripe.com` only.** A
browser there is refused on `checkout.stripe.com`, `js.stripe.com`, `billing.stripe.com`,
`pay.stripe.com`, `invoice.stripe.com` and `hooks.stripe.com`. In the run, the step a person does on
each of those pages was done through the Stripe API instead. So one short pass by a person, on a normal
machine, is still open. It takes about 30 minutes. Use the sandbox, not the live account.

Setup for the pass: `STRIPE_SECRET_KEY=sk_test_... deploy/dev/stripe-env.sh`, then
`KITSTAK_STRIPE=1 deploy/dev/app-start.sh portal` and `deploy/dev/stripe-events.sh watch` (or
`stripe listen`). Record the screen. Each line is pass or fail.

- [ ] Three carts: Pulse monthly ($29.00), CRM 5 seats and WMS 1 warehouse monthly ($395.20), the same cart
      yearly ($4,031.04). For each, the total on the Stripe pay page equals our review page to the cent.
- [ ] Pay with `4242 4242 4242 4242` on the pay page: back on the success page, billing home is active
      within seconds. (The event `checkout.session.completed` only exists when the page itself is paid.
      Its handler is proven with the test gateway, not yet with a real one.)
- [ ] Pay with `4000 0000 0000 0002` (declined): Stripe's page shows the message, nothing is granted.
- [ ] Pay with `4000 0027 6000 3184` (bank approval): approve finishes it, fail grants nothing, and no
      "your bank needs you to approve" email goes out for it.
- [ ] A promo code made in the Stripe dashboard, during a trial: the success page and billing home show the
      reduced first charge with the line "Promo code", and the first invoice equals it.
- [ ] Open two pay pages in two tabs: the first one says it is closed. Only one can be paid.
- [ ] "Update card" opens the Billing Portal. Save `5555 5555 5555 4444`: back on billing home the card is
      "Mastercard ending 4444", and the activity list says so.
- [ ] "Download PDF" on an invoice opens Stripe's PDF.
- [ ] A renewal the bank wants approved (card `4000 0027 6000 3184` on a plan, then a test clock past the
      renewal): the email arrives, "Pay now" sends you to Stripe's page for that invoice, approving there
      pays it, and billing home is active again.
- [ ] Cancel while a bill is open, and a second payment for one organization. Both end a subscription at
      once (`DELETE /v1/subscriptions/:id`). The key used for the sandbox run needs a person to approve
      that call in Stripe, so these two could not be finished there. See "The Stripe key" below.

Until every line above passes, the honest state is: **the server side is proven against real Stripe. The
pages Stripe hosts have not been seen with our sessions in them.**

### The Stripe key must be allowed to end a subscription

Two things KitStak does end a subscription at once: a customer cancels while a bill is open (the bill is
dropped), and a second payment comes in for an organization that already has a plan (it is canceled and
refunded). Both call `DELETE /v1/subscriptions/:id`. The sandbox key used on 2026-11-24 answered that
call with "This action requires human approval before it can be completed". The app handled it the safe
way (nothing changed, the person saw "Something went wrong on our side. Nothing was charged."), but the
cancel did not happen.

- [ ] Before go live, check the live key: it must be able to cancel a subscription, void an invoice and
      create a credit note with no approval step. A restricted key needs write access to Subscriptions,
      Invoices, Credit notes, Customers, Checkout Sessions, Customer portal, and read access to Prices,
      Products, Payment methods and Events.
- [ ] In the sandbox, with a key that has those rights, run
      `deploy/dev/stripe-sandbox-test.sh 06-failed 07-webhook` with no
      `STRIPE_SANDBOX_CANCEL_NEEDS_APPROVAL` line in `deploy/dev/.run/stripe.env`. The two flows then run.

## What is and is not proven

Say this out loud before go live, so nobody assumes more than is true.

| Part | State |
|:-|:-|
| Prices, quotes, discounts | Proven by unit tests to the cent, for 9 reference carts. |
| Test gateway, webhooks, sync, access rows | Proven by unit tests and by the browser tests in `TESTING.md`. |
| Emails, reminders, the one minute job | Proven by unit tests and the browser tests, with the dev outbox. |
| Stripe adapter | **Run against the real Stripe sandbox on 2026-11-24** (`STRIPE-SANDBOX-RUN.md`), with test cards and test clocks. Six defects were found and fixed. The suite is in `packages/billing/tests/stripe-sandbox` and is rerun with `deploy/dev/stripe-sandbox-test.sh`. Not run: the two flows that end a subscription at once (the key needs approval for that call), and anything that needs a page Stripe hosts. |
| Credit, the real next charge, the one plan rule, whole day proration | Proven on the test gateway by database tests and browser tests, and now on real Stripe: the preview equals the charge to the cent for seats, warehouses, the bundle and monthly to yearly, and Stripe takes a proration date up to one day ahead. `creditNotes.create` with a refund was run for one cent. The refund of a second payment was not run (see the key note above). |
| Stripe hosted pages (pay page, Billing Portal, invoice page, PDF) | **Not seen.** The app makes the real sessions and links, and Stripe accepts them. No person or browser has opened them yet. Open item 1 lists the pass. |
| Stripe setup script | Run against the real sandbox: 4 products, 16 prices, 1 portal configuration, and `check` says ok. |
| Sending with Resend | Proven with a fake HTTP layer only. Step 3 is its first real test. |

The sandbox "KitStak LLC sandbox" (`acct_1TYwSo3PaLKIRZri`) now exists. Use it for every trial run. Run
steps 1, 8 and 9 there with test keys before you touch live mode. Nothing in the build, the dev scripts or
the sandbox suite creates, changes or disables a webhook endpoint, in the sandbox or in the live account:
step 8 is done by a person, by hand.

## Env vars

All of these are for the **portal** project only. The four product apps and the marketing site need nothing
new. No value ever goes in the repo. Put them in `deploy/secrets.env` (untracked) and run
`node deploy/push-env.mjs`, which sends the payment, mail and sign in secrets to the **production** target
only and removes them from preview and development, so a preview build can never charge a card.

| Variable | Needed | What it is |
|:-|:-|:-|
| `STRIPE_SECRET_KEY` | yes, for billing | The Stripe secret key (`sk_live_...`, or a restricted key `rk_live_...`). With no key, production billing is off. The key must be allowed to cancel a subscription with no approval step (Open item 1, "The Stripe key"). |
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
| `NEXT_PUBLIC_SITE_URL` | optional | The marketing site. Default `https://kitstak.com` in production. In local dev the default is the local site on port 3600. |
| `BILLING_SUPPORT_EMAIL` | optional | The billing help address at the foot of every billing page. Default `hello@kitstak.com`, the address on the marketing site. |
| `BILLING_SUPPORT_REPLY_TIME` | set before launch | How fast you answer, for example `1 business day`. The page then says "We reply within 1 business day." Until it is set, no reply time is promised. Set only a time you can keep. |
| `BILLING_SELLER_NAME` | optional | The company name in the "From" block of every invoice. Default `KitStak LLC`, the name on the Stripe account. |
| `BILLING_SELLER_ADDRESS` | set before launch | The seller address on invoices. Split the lines with a bar, like `1 Main St\|Austin, TX 78701\|US`. Not printed until it is set. |
| `BILLING_SELLER_TAX_ID` | optional | The seller tax ID on invoices. Not printed until it is set. |
| `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL` | optional | Legal links. Default: the pages the CRM serves. |
| `ENTITLEMENTS_DEV_ALLOW_ALL` | set to `1` until step 11 | Every organization can open every app. `push-env.mjs` keeps it at `1` in all five product projects until `ENFORCE_ENTITLEMENTS=1` is in `deploy/secrets.env`. |

Make a `CRON_SECRET` like this, and paste it into `deploy/secrets.env` without showing it on screen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`BILLING_TEST_WEBHOOK_SECRET` is for the test gateway only. Never set it in production.

`STRIPE_HTTP_CLIENT` and `NODE_USE_ENV_PROXY` are for a dev container behind a proxy only (`DEV.md`, "Real
Stripe test mode"). Never set them in production. `KITSTAK_STRIPE`, `STRIPE_SANDBOX` and the other
`STRIPE_SANDBOX_...` names are read by the dev scripts and the sandbox suite only. The apps ignore them.

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
      ended and view only, and says why: "We could not collect $164.00 after 4 tries, so your plan ended."
      On the same page, set the invoice to **marked uncollectible** after the last retry, so it is not
      left open.
      What the sandbox does today (seen on 2026-11-24): 8 retries, about one every 2 days, so 9 tries in
      15 days. Then the subscription is canceled and **the invoice stays open**. KitStak shows the plan as
      ended and says "We could not collect $58.00 after 9 tries", but the invoice list still shows that
      bill as "Due". Set "marked uncollectible" in the live account so no bill is left open for a plan
      that has ended. The number of tries in the sentence is Stripe's own count, whatever you set.
- [ ] Nothing to set for Stripe's billing mode. New subscriptions use Stripe's "flexible" mode. The adapter
      was fixed for the three places where that mode differs from what the screens say (a change of
      billing period, a decrease, and starting again in a pause). See `STRIPE-SANDBOX-RUN.md`.
- [ ] A customer who cancels while a payment is late: KitStak ends the subscription at once and voids the
      open invoice (`cancelNow` in the Stripe adapter). Nothing to set in the dashboard. Check it once in
      test mode as part of Open item 1: the invoice shows as void and no retry runs.
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
- [ ] Invite emails go out the moment a person presses "Send invite" (review round 4). `push-env.mjs`
      gives `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_REPLY_TO` to every product project (production
      only), so an invite leaves at once from any app. A project without them waits for the Portal's one
      minute job, and nothing is lost. WMS also needs them for password resets, welcome emails and report
      links when a company has no SMTP server of its own: without them that mail is only logged.
- [ ] Set `BILLING_SELLER_ADDRESS` (and `BILLING_SELLER_TAX_ID` if you have one). Until then an invoice shows
      the seller name and site only, with no address.
- [ ] Set `BILLING_SUPPORT_REPLY_TIME` to a reply time you can keep, for example `1 business day`. Check that
      mail to `BILLING_SUPPORT_EMAIL` reaches a person.

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

Review round 4 added migration `0011_core_sign_in_round4` (and `0013_core_sign_in_blocks` in the WMS
stream, which makes the same two tables on a WMS only database). Run the WMS migration, then the core
one, before the new code serves traffic:

```bash
node deploy/with-prod-db.mjs pnpm -F kitstak-wms db:migrate
node deploy/with-prod-db.mjs pnpm -F @kitstak/db db:migrate
```

It makes `core.sign_in_blocks` (a person who is switched off) and `core.user_last_org` (the
organization a person used last). It also writes a block row for every person who is inactive in a
warehouse and has no password row today, so "Forgot password" cannot bring them back. Check it:

```sql
SELECT count(*) FROM core.sign_in_blocks;
```

The number is the count of people who are switched off right now. If the new code runs for a few
minutes before the migration, nothing breaks: a database with no such table has nobody switched off,
which is what the old code did too. A warehouse admin who deactivates a person in those minutes gets an
error and can try again after the migration.

One more thing changes on the day the new code goes out: the sign in layer no longer keeps a copy of
the session in the browser (the `kitstak.session_data` cookie). Nobody is signed out by this. Each
request now reads the session row, which is one lookup on a unique index.

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
- [ ] An organization whose trial has ended now reads "Your apps are view only" on billing home. (While the
      switch was on, no screen said "view only", because every app was open. The "Dev override" badge is for
      local work only and never shows in production.)

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
- [ ] 2. Stripe settings: Smart Retries, cancel after the last retry, invoice marked uncollectible, Stripe emails off, public details, tax decided. The live key can end a subscription with no approval step.
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
- [ ] Migration `0010_core_billing_round3.sql` must be applied (step 4), before the new code is deployed or
      in the same release. It adds `core.billing_stamps` with its triggers, and three columns on
      `core.billing_subscriptions`. The apps work without the stamp table (they fall back to the 60 second
      rule), but the plan row is written with the new columns, so the Portal needs the migration.
- [ ] Migration `0009_core_billing_locks.sql` must be applied (step 4). It adds `core.billing_locks`. Without
      it, opening checkout and confirming a plan change answer "Something went wrong on our side".
- [ ] Alert on the log line `RECONCILE FAILED FOR A LIVE PLAN`. It means our copy says a plan is live, a date
      on it has passed, and the gateway would not confirm it. A person has to look.
- [ ] A row in `core.billing_locks` older than 2 minutes means a server stopped in the middle of a billing
      step. It ends by itself. If you see many, look at the gateway's response times.

## Review round 5, second pass: what changed and what you decide

No database migration. Production stays at core migration 0011. Deploy the Portal, the CRM and the WMS
together: the three fixes below span them.

- [ ] **Accounts made in the WMS are born unverified.** "Add user" in the WMS used to write
      `email_verified = true` for any address the warehouse admin typed. That flag is the proof every invite
      door trusts, so a warehouse admin could take an invite meant for someone else. Now such an account is
      born with `email_verified = false`, and the flag goes back to false whenever the WMS changes an
      account's email. Only the mailbox proves the mailbox: the emailed code in the Portal, or the proof in
      an invite email. At that first proof the Portal removes any password that was on the account and
      every session, and tells the person in one sentence.
- [ ] **A warehouse admin can no longer set or reset the password of an account whose email is verified.**
      "Reset password" and a password typed in "Edit user" answer: "This person confirmed their email, so
      only they can change their password. They can use "Forgot password" on the sign in page." For an
      account that is not verified yet, both work as before.
- [ ] **DECISION FOR YOU: WMS accounts that exist today.** Every account the WMS made before this release
      has `email_verified = true`, because it was born that way. This release does not touch them. What that
      means:
      1. They keep working. Nobody is signed out, no password changes, invites work as before.
      2. Their warehouse admin can no longer reset their password. The person uses "Forgot password" on
         the sign in page, which mails a code.
      3. A person whose address cannot receive mail (a made up address for a shared scanner login) can no
         longer get a new password from anyone. For those accounts run the statement below. It marks them
         unverified, and the admin reset works again. It is safe to run more than once.
      Look first:
      `select u.email, o.slug from core."user" u join core.member m on m.user_id = u.id join core.organization o on o.id = m.organization_id where u.email_verified and o.slug = '<organization slug>' order by 1;`
      Then, for the addresses that cannot receive mail:
      `update core."user" set email_verified = false, updated_at = now() where lower(email) in ('<address 1>', '<address 2>');`
      If you would rather treat every old WMS account as unproven (the strict reading: nobody ever proved
      those mailboxes), run the update for all members of the organizations that own a warehouse. The cost:
      each of those people sees "Verify your email" in the Portal, must enter a code before they can pay or
      invite, and loses their password the first time they sign in with an emailed code. We did not do this
      by default because it changes what every existing warehouse user sees on day one.
- [ ] **A new cookie.** The Portal sets `kitstak.known_device` at every sign in: HttpOnly, one year, signed
      with `BETTER_AUTH_SECRET`, holds the ids of up to 5 people who signed in on that browser. It gives no
      access. It only puts that browser's requests for email codes on counters that strangers cannot fill.
      Add it to the cookie list of the privacy page if you keep one.
- [ ] **Email code limits changed.** The "20 codes a day per address" wall is gone: any stranger could use
      it up and lock the owner of a no password account out for a day. Sends are now spaced per address and
      per kind of code: two at once, then one a minute, then one every 10 minutes, then one every 30
      minutes (`CODE_SEND_GAPS` in `packages/billing/src/server/code-limits.ts`). The tries at a code are
      counted as before (5 per code, 10 per 10 minutes and 30 a day per address for sign in codes), and a
      browser that signed in to the account before has counters of its own. One limit is new: tries at a
      reset code and at a verification code are now also counted per address (100 and 30 a day).
- [ ] **Invites from the CRM send the invite email now**, through the same door as the Portal: the inviter's
      own email must be verified (accounts made before `INVITE_NEEDS_VERIFIED_EMAIL_SINCE` may still
      invite), the day's count applies, and the link in the email proves the mailbox. The CRM has no mail
      key of its own, so the email is queued and the Portal's one minute job sends it. "Copy link" in the
      CRM now copies the Portal's invite page. A copied link carries no proof: the person confirms the
      address with an emailed code on that page.
- [ ] **Joining from an invite needs no password.** The form asks for a name. "Set a password" is one click
      away. A person who joins without one signs in with an emailed code.

## Questions the owner still has to answer

These do not block go live. Each sits in one place and is a small change later (`SPEC.md` section 17).

1. What should a 6th Pulse seat cost? Today the screens link to "Talk to us".
2. Should the welcome screen promise a contact time for guided setup? Today the request is only stored.
3. Should the marketing site host the Terms and Privacy pages? Today the links point at the CRM pages.
4. Stripe Tax: on or off? It is off until registrations are in place.
5. A postal address in the email footer. Transactional mail does not require one, but many senders add it.
