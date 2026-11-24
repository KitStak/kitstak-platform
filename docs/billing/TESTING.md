# Signup and billing: how it is tested

Three layers. Unit tests prove the rules. Database tests prove the rules against a real Postgres. Browser
tests prove the screens, end to end, with the test gateway. `SPEC.md` section 14 is the plan this file
reports on. `DEV.md` is how to start the local stack.

Everything runs from the repo root. Nothing here needs a Stripe key, a mail key or the network.

## Quick start

```bash
deploy/dev/db-setup.sh                 # Postgres, migrations, demo data
pnpm -F @kitstak/billing test          # catalog, quote, gateways, webhooks, emails, jobs, setup, backfill
pnpm -F kitstak-portal test            # portal unit tests, including the copy rules
deploy/dev/app-start.sh portal         # the portal on http://localhost:3300
pnpm -F kitstak-portal e2e             # browser tests, signup to cancel
```

## Layer 1 and 2: unit and database tests (vitest)

`pnpm -F @kitstak/billing test`. Database tests talk to the local Postgres from `DEV.md` and skip
themselves, with a note, when it is not reachable. Each one makes its own organizations and removes them
again. Files run one at a time, because they share one database.

The files the lifecycle lane added:

| File | What it proves |
|:-|:-|
| `src/emails/render.test.ts` | All 14 templates: the subject and button from `SPEC.md` section 10, an HTML and a text version that say the same, at most one link, no image and no script, the copy rules. Names are escaped. A subject is one line. A link that is not http or https is dropped. A payload with a missing value is refused. |
| `src/emails/provider.test.ts` | The provider table (`resend`, `outbox`, `none`). The Resend call: address, key header, idempotency key, both bodies. Which answers are a setup problem, which can be tried again, which are final. The key is never in an error text. |
| `src/emails/deliver.test.ts` | Database. A queued email goes out once, is stored with HTML and text in the outbox, and writes one activity row. `send_after` is respected. A code is sent at once and wiped from the payload. A bad payload fails, an unknown template is skipped, the rest still goes. Three tries five minutes apart, then failed. A wrong key stops the run and costs no email a try. Production with no key keeps mail queued. |
| `src/jobs/jobs.test.ts` | Database. Trial reminders at 7, 3 and 1 days and once at the end, each exactly once, to the billing email, owners and billing managers only, and never when a card is on file. The last day reminder for a late payment, once. Reconcile repairs a plan a lost event left behind and leaves fresh rows alone. A tick reports what it did, and a step that throws does not stop the others. |
| `tests/price-parity.test.ts` | For the 9 reference carts: the quote, the Stripe mapping total and the first test gateway invoice are the same number, to the cent. The Stripe mapping holds exactly the 16 amounts of `CONTRACTS.md` section 5.2. |
| `tests/stripe-setup.test.ts` | The setup logic against a fake Stripe account: an empty account gets 4 products, 16 prices and 1 portal configuration; a second run changes nothing; `check` never writes; a wrong amount is skipped unless `reprice` is given; labels are fixed in place; a price on a foreign product is never touched; foreign portal configurations are ignored. |
| `tests/backfill.test.ts` | Database. `check` lists an organization with no rows. `apply manual` grants four apps once. `apply trial` starts a real 14 day trial in the owner's name. `quiet` holds back the welcome email. No owner means skipped, with the reason. |
| `src/server/round1.test.ts` | Database. Review round 1. Two pay pages: the older one closes, two paid at the same moment leave one subscription and one charge, and a second live subscription that still got through is canceled and refunded. Opening the pay page four times with the same cart writes one `checkout.started` row. The server picks the proration date: whole days, the same amount all day, and five rounds of adding 499 seats and taking them off with a back dated date lose one day each and never gain. A stale confirm panel is refused even when the dollars match. Credit and the real next charge after monthly to yearly and back, after removing seats, and across a plan that ends. A promo code: the pay page, the plan state, the email and the first invoice all say $355.68. An open invite holds a seat. A billing manager who is removed or deactivated loses the role. `POST /organization/invite-member` from an unverified account answers 403 `EMAIL_NOT_VERIFIED`; the daily cap answers `INVITE_LIMIT_REACHED`. |
| `src/gateway/test-pdf.test.ts` | The test invoice PDF reads like the invoice screen: the KitStak mark, a seller block and a buyer block with address and tax ID, the picker lines, then list price, bundle discount, subtotal, the promo code once, tax, total and paid, in that order. A plan change falls back to the gateway lines and names what is still due. Long names wrap. Only seller facts that are set are printed. |
| `src/proration.test.ts` | The whole day rule: a plan paid minutes ago charges the full period, the date is the same all day, a credit never counts more days than a charge. |
| `src/server/round2.test.ts` | Database. Review round 2. A failed payment event that arrives after the invoice was paid writes no line; a second paid event under a new event id adds no payment or credit line; a real failed renewal is one line per try. Two checkouts opened at the same moment: one gateway customer, one open pay page, and the plan gets its renewal, failed payment, cancel and end. A plan whose customer is not the stored one (data from before the fix) is taken back in by its next event, by the card page and by reconcile, and another organization's subscription is still refused. Three confirms of one plan change at once: one invoice, one charge, one `plan.changed` line, one receipt; two different changes at once: one lands, one is asked to look again. The confirm panel sentences for adding a seat, removing it, and monthly to yearly with credit, with amounts that add up. The 0341 card saved on the card page fails the next renewal; used at checkout it pays the first bill and a plan change. The lease in `core.billing_locks`: one step at a time per organization, it ends by itself, and it is given back when a step throws. The billing role: free as an invite and as a member, a billing manager by itself, removed with the person. |
| `src/change-words.test.ts` | The confirm panel sentences, pure: 14 cases. Every amount named adds up to what is due or to the credit, and numbers that would not add up are never shown. |
| `tests/copy-rules.test.ts` | No em dash, en dash, double dash, "coming soon" or lorem in anything the billing package or the shared plan banner and lock screen can show. Every error message, email and catalog sentence is 20 words or fewer. The checker itself is tested. |

Portal files (`pnpm -F kitstak-portal test`):

| File | What it proves |
|:-|:-|
| `src/lib/copy-rules.test.ts` | The same copy rules for every screen in the portal. |
| `src/app/api/billing/jobs/tick/auth.test.ts` | Who may call the billing job: the right bearer secret only, local dev with no secret, production with no secret answers 503. |
| `src/server/billing-actions.test.ts` | The stale tab rule. Every exported billing action is called with the id of organization A while the session's active organization is B: each answers `org_changed` and nothing is read or written. The list of actions is read from the module, so a new action without the rule fails. A page that sends no organization is refused the same way. |
| `src/features/billing/invoices/invoice-view.test.ts` | The invoice lines shared by the invoice screen and the test PDF (`@kitstak/billing/invoice-view`): a plan invoice repeats the picker lines, a promo code or credit is listed once, the subtotal is the sum of the lines above it, and an invoice the catalog cannot rebuild falls back to the gateway lines. |
| `src/features/billing-activity/model.test.ts` | Every activity action sits in one filter. Rows group by day in the viewer's time zone. Invoice ids are checked before they become a link. CSV cells cannot start a formula. |

## Layer 3: browser tests (Playwright)

`pnpm -F kitstak-portal e2e`. The tests drive a real browser against a running dev server in **test gateway
mode** (no Stripe keys). They make their own accounts through the real signup form, read emails from
`/dev/outbox`, pay with the test cards and move time with the test tools on billing home. They only read
the database, to prove what the screens say.

Settings (all optional):

| Variable | Default | Meaning |
|:-|:-|:-|
| `E2E_BASE_URL` | `http://localhost:3300` | The portal to test. |
| `E2E_DATABASE_URL` | the local database from `DEV.md` | Where to read rows from. |
| `E2E_CRM_URL`, `E2E_WMS_URL`, `E2E_PROJECTS_URL`, `E2E_PULSE_URL` | the local ports | The other apps, for the integration spec. |
| `E2E_CHROMIUM` | found by itself | A Chromium to use. The dev container ships one fixed build; the config finds it. |
| `E2E_ALLOW_ALL` | read from the page | Set `0` or `1` to say whether the portal runs with the allow all switch (the tile check). |
| `E2E_BILLING_OFF_URL` | not set | A second portal started in production mode with no keys, for `billing-off.spec.ts`. |

The suite runs with one worker. It clears the signup rate limit counters before each signup (5 signups per
10 minutes is the real limit).

### What needs which setup

| Setup | Specs that need it | Without it |
|:-|:-|:-|
| Portal in test gateway mode | all | The suite stops at once with a plain message. |
| Portal with `ENTITLEMENTS_DEV_ALLOW_ALL=0` | the launcher tile check at the end of `apps-integration.spec.ts` | That part is skipped and the test output says so. Under the allow all switch every tile says "Included" by design. Everything else, the seat limit included, runs either way. |
| CRM, Projects, Pulse, WMS running with `ENTITLEMENTS_DEV_ALLOW_ALL=0` | `apps-integration.spec.ts` | Each app that does not answer is skipped by name. |
| A second portal in production mode with no keys | `billing-off.spec.ts` | Skipped, with the command to start one. |

Start the product apps in enforced mode like this (the variable on the command line wins over
`.env.local`). Add `portal` to both lines to run the tile check too:

```bash
deploy/dev/stop.sh crm projects pulse wms
ENTITLEMENTS_DEV_ALLOW_ALL=0 deploy/dev/app-start.sh crm projects pulse wms
```

### The specs

| Spec | Journey |
|:-|:-|
| `signup-trial.spec.ts` | A handoff link for CRM (5 seats) and WMS (1 warehouse). Name, email and company are prefilled and the fragment leaves the address bar. 4 fields with the right browser hints. The picker shows $494.00, the bundle discount of $98.80 and $395.20, and follows every change. The trial starts with no card, verification can be skipped, the wizard opens on its last step, and the database has two trial rows that end 14 days out. |
| `signup-resume.spec.ts` | Close the tab at the picker, sign in again: the picker with the same cart. Field errors name the problem, move focus and keep what was typed. A taken email says so with a way to sign in. |
| `verify-email.spec.ts` | A wrong code shows the plain message. The code from the outbox works, also pasted with a space. The banner goes away and the code is wiped from the table. Skipping never blocks, and paying asks for the code first. |
| `checkout-success.spec.ts` | From a trial: "Pick a plan" opens the picker, which shows "Due today $0.00", the first charge amount and date, and no card field. Its button opens the test pay page: two clicks to the card field. The review page still shows the same facts for links that land on it. The pay page says the same. Paying lands on success in seconds. Access rows came through the webhook ledger. Billing home shows plan, cost, next charge, card and invoices. |
| `checkout-decline.spec.ts` | A declined card: the message, still on the pay page, the typed number kept, no access row changed. Back: the canceled page, the cart kept, and a working card then succeeds. |
| `checkout-3ds.spec.ts` | "Needs bank approval": fail shows a plain message and grants nothing; approve finishes the checkout. |
| `plan-change.spec.ts` | On a paid plan, half way through the month: add 1 seat and the amount in the confirm panel equals the new invoice to the cent. Remove it: credit, nothing to pay. The seat stepper stops at the people the team has. Add Projects: the bundle discount on every app. Switch to yearly. The invoice PDF opens. |
| `trial-end.spec.ts` | 3 days left: the warning banner and the reminder email with the price. The trial ends: view only, nothing deleted, one "trial has ended" email. "Pick a plan" pays today and full access is back at once, with one invoice and one receipt. |
| `payment-failed.spec.ts` | A card that fails at renewal. Banner and email with the amount, the last 4, the retry date and the access date. "Pay now" with the bad card says so. A new card pays the open invoice at once. Second test: not fixed, so the last day email goes out once, then view only, then paying restores everything. |
| `cancel-undo.spec.ts` | Cancel in two clicks with a reason, stored. The end date shows. "Keep my plan" undoes it in one click. Cancel again with no reason, pass the end: ended, view only, data still there, and "Pick a plan" opens checkout with the old cart. |
| `pause.spec.ts` | Pause 2 months: both dates shown. Past the start: view only and no invoice. Past the end: active again, then billed again. A pause can be undone before it starts. |
| `stale-tab.spec.ts` | Two tabs. Billing details open for organization A, the person switches to B in the other tab, "Save" in the first tab says "You switched organizations. Reload this page." and neither organization changes. After a reload the page works for B. |
| `billing-only.spec.ts` | An owner invites a bookkeeper by email on the Billing team page. The invite and the person use no seat, the person lands on Billing, can read, download and change, cannot add managers, and CRM, WMS, Projects and Pulse each turn them away with every app in the plan. Removing them removes them from the organization. |
| `round2-money.spec.ts` | The confirm panel in a browser: adding seats names the days, removing them names one full day fewer and says why, and monthly to yearly with credit reads "for the next year. Less ... Less ... from your credit." with amounts that add up to "Due today" and to the invoice. The 0341 card saved on the Update card page: the next renewal fails. |
| `roles.spec.ts` | Two people join from invite emails. A plain member sees only the small card, with no amount, and cannot open any billing page, the activity CSV or an invoice PDF. An admin can read billing and has no change, cancel or card button. The owner makes the member a billing manager, who can then read everything, download an invoice and change the plan, while staying a plain member of the organization. |
| `seat-limit.spec.ts` | With 2 seats paid, one person and one open invite: the next invite shows the price and asks before anything is sent. Yes adds the seat, charges exactly the amount shown, and sends the invite, and the invite email is in the outbox. |
| `credit-promo.spec.ts` | A promo code typed on the test pay page: the summary gains the promo line at once, and the success page, billing home and the first invoice all say $355.68. Credit from removing seats: billing home shows "Credit", "Next charge" is the plan price less the credit, the cancel page says the credit stays, the renewal invoice equals the number shown, and a seat added right after costs the whole $29.00 with the rest of the credit named in the panel. |
| `invite-verified.spec.ts` | Joining from the emailed invite link: the email is verified, no code email is sent, no banner on the launcher or on billing, and the proof is not left in the address bar. The same invite opened without the proof still works and that person verifies with a code. "Change email" on the verify screen keeps the account, the organization and the trial, and the new code verifies the new address. |
| `webhook-replay.spec.ts` | The same signed test event twice: 200 then 200 `duplicate`, one ledger row. A changed body with the old signature: 400, no row. No signature: 400. The Stripe route with no key: 503. The job route with a wrong secret. |
| `lifecycle.spec.ts` | The whole road in one test: signup, trial, paid, plan change, failed payment, fix, cancel. Then the activity page lists it in plain words, the filters and the CSV work, and the outbox shows every email with its HTML and text. |
| `apps-integration.spec.ts` | The trial banner in the CRM says the same words as the portal's. Projects, Pulse and WMS, which are not in the trial, show the lock screen with the end date, the price after the trial and one button. Adding an app from its lock screen takes 2 clicks, and the app then opens. The test prints which apps it checked and which it skipped. A second test ends a trial and proves view only is told before a form opens: in the CRM, "New board", "Invite" and "Import" open the view only dialog with the banner's words and button, no form opens, and no board or invite row is written. A third test does the same for the WMS and Pulse: the first WMS screen needs one press and logs no console error; after the trial ends "Add client", "Create client", "Bulk import/update", "New job", "Other ways to start" and "Add a labor class" are dimmed and open the dialog, by mouse and by keyboard; a create screen opened by its address shows the message inside the app frame; and Projects, which is not in the plan, shows the shared lock frame with no "New task" button. |
| `a11y-mobile.spec.ts` | At 360 px: no sideways scroll on signup, picker, verify, welcome, billing home, plan, review, the test pay page with a two app plan, the success page, invoices, details, team, cancel, activity, the outbox and the template gallery. The main buttons are 44 px tall. Signup to trial with the keyboard alone: Tab, Space on a switch, arrow keys on the stepper, Enter. Reduced motion: no confetti, and with motion allowed the confetti is there. |
| `billing-off.spec.ts` | A portal in production mode with no key: pay buttons are disabled with the plain message, the test gateway and the outbox do not exist, and a trial can still start. |

### Last full run

2026-11-23, on this branch, after the lanes were joined. Portal, CRM, Projects, Pulse and WMS all ran with
`ENTITLEMENTS_DEV_ALLOW_ALL=0`:

- `pnpm -F kitstak-portal e2e`: 27 tests, 26 passed, 1 skipped (`billing-off`, no second portal in that run),
  3.8 minutes. The integration spec printed: checked CRM trial banner, Projects, Pulse and WMS lock screens
  with price, Pulse added from its lock screen in 2 clicks, Portal tiles follow the plan. Skipped: nothing.
- `E2E_BILLING_OFF_URL=http://localhost:3310 pnpm -F kitstak-portal e2e billing-off`, with a built portal
  started in production mode with no keys: 1 passed.

2026-11-24, gate round 1, after the review round 1 fixes. Portal, CRM, Projects, Pulse and WMS ran with
`ENTITLEMENTS_DEV_ALLOW_ALL=0`, and a built portal ran in production mode with no keys on port 3310:

- `E2E_BILLING_OFF_URL=http://localhost:3310 pnpm -F kitstak-portal e2e`: 33 tests, 33 passed, none skipped,
  5.7 minutes. The integration spec printed: checked CRM trial banner, Projects, Pulse and WMS lock screens
  with price, Pulse added from its lock screen in 2 clicks. Skipped: nothing.
- Unit tests: billing 449, portal 149, shared UI 71, entitlements 44, CRM 842, Projects 291, marketing site
  589, all passed. WMS: 2589 passed, 5 failed in 4 files that this work does not touch (task grid query,
  page header crumbs, token alias rule, one timing budget). Pulse: 905 passed, and one test that is older
  than this work (`production-day.db.test.ts`, the order of two lines saved in the same moment) failed in
  1 run of 5.
- Signup, sign in, the launcher, every billing tab and organization settings were opened at 1440 px in light
  and at 390 px in dark: no console error and no failed request.

2026-11-24, gate round 2, after the review round 2 fixes. Portal, CRM, Projects, Pulse and WMS ran with
`ENTITLEMENTS_DEV_ALLOW_ALL=0`, and a built portal ran in production mode with no keys on port 3310:

- `E2E_BILLING_OFF_URL=http://localhost:3310 pnpm -F kitstak-portal e2e`: 40 tests, 40 passed, none skipped,
  8.1 minutes. The integration spec printed: checked CRM trial banner, Projects, Pulse and WMS lock screens
  with price, Pulse added from its lock screen in 2 clicks, Portal tiles follow the plan. Skipped: nothing.
  The first full run of this round had 38 passed and 2 failed. Both were faults in the tests, not in the
  product, and both are fixed: the three tab test waited for `notice=plan_updated` in an address that
  billing home cleans as soon as the message shows, and the test tool helper waited for a button that
  leaves the page when the trial ends.
- Unit tests: billing 484, portal 215, shared UI 77, entitlements 44, CRM 843, Projects 291, Pulse 906,
  marketing site 589, all passed. The Pulse test that used to fail now and then
  (`production-day.db.test.ts`) passes: a saved day now comes back in the order its lines were sent.
  WMS: 2593 passed, and the same 5 tests in 4 files as before failed. This work does not touch those files
  (task grid query, page header crumbs, token alias rule, one timing budget).
- Signup, sign in, the launcher, every billing tab, organization settings and the 404 page were opened at
  1440 px in light and at 390 px in dark: no console error and no failed request.

Real Stripe and real email were not part of any run. Do not trust this file for a pass count: run the
suite.

### When a test fails

- `test-results/` holds a screenshot and a trace for each failure. Open a trace with
  `npx playwright show-trace <file>`.
- "Too many tries": another run made many accounts. `deploy/dev/rate-limit-reset.sh` clears the counters.
- A page that never loads on the first run: Next compiles each route on first use. Run the spec again.
- The dev server stops answering when the machine is short of memory (six dev servers are about 6 GB).
  `deploy/dev/status.sh` shows what is up. Start the portal again and run in smaller groups, for example
  `pnpm -F kitstak-portal e2e checkout`.
- Each spec leaves its own organization behind (`e2e-...@kitstak-e2e.example`). They are harmless. To
  start clean, rebuild the local database as `DEV.md` describes.

## Manual checks

Things a script cannot judge.

- **Look.** `node deploy/dev/shot.mjs /billing/activity` for light and dark, desktop and phone.
  `node deploy/dev/shot.mjs` with the word for signed out pages from `DEV.md`, on `/dev/outbox` and
  `/dev/outbox/templates`.
- **Emails.** Open `http://localhost:3300/dev/outbox/templates`. Read all 14 in "Email" and "Plain text",
  in "Light" and "Dark". Send one to a real inbox from a Stripe test mode setup before go live, because
  mail clients differ.
- **Real Stripe.** Not covered by any test here. `GO-LIVE.md` "Open item 1" is the run to do first, line by line, with test keys from the owner. With
  test keys in `apps/portal/.env.local` and `stripe listen` forwarding to
  `localhost:3300/api/billing/webhooks/stripe`, the same browser journeys can be walked by hand.

## What is not tested, said plainly

- The Stripe adapter and the setup script have never talked to Stripe. No sandbox exists for the account.
- Resend has never been called for real.
- Browser tests run in Chromium only, at 1280 by 800 and at 360 by 740.
- No load test. The one minute job handles 50 emails per run with a real provider, on purpose (Resend
  allows 2 requests a second).
