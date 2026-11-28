# KitStak Ledger: product + build spec

Status: draft for owner review (2026-11-27).

The money app for kitting, 3PL and contract packaging shops: invoices and collections, vendor bills and payments, expenses, bank reconciliation and month-end
close. Tagline: *Bill it. Pay it. Close it.* It runs alone (only Ledger, CSV in and out, customers kept in `core`) or bundled with WMS, Pulse, Projects, CRM,
Crew and Portal. It syncs every posted entry to the shop's accounting tool, QuickBooks Online first, and keeps its own double entry books from day one so that
becoming the books of record later is a switch, not a rewrite.

Read with: [`REFERENCE.md`](REFERENCE.md) (scope, flows, open questions; the source of truth for what is in and out), `docs/pulse/SPEC.md` (house style; 4.2
money, 4.8 earned vs billed, 4.16 month close), `docs/programs/SPEC.md` 1.3 (money rules), `docs/integration/BLUEPRINT.md` 2.2 (core conventions),
`docs/integration/ONBOARDING.md`, and `docs/crew/SPEC.md` when it exists. Written with the build and kept in step with this spec: `apps/ledger/AGENTS.md` (house
rules), `apps/ledger/drizzle/README.md` (migration list) and `packages/ledger-bridge/README.md`.

Copy rule for every user-facing string: plain 8th grade words, short sentences, no em dash, no en dash and no double dash. Ranges read "to". Enforced by ESLint
and `copy-rules.test.ts`, copied from Pulse.

**Words we use on screen.** Code keeps short technical names. People only see the right hand side.

| In code | On screen |
|-|-|
| AR, accounts receivable | Money owed to you |
| AP, accounts payable | Bills to pay |
| invoice | Invoice (what you send a customer) |
| bill | Bill (what a vendor sends you) |
| credit note | Credit note |
| journal entry, posting | Entry (only on the Journal and Reports screens) |
| debit, credit | Only on the Journal, the chart of accounts and accounting reports. Never on an invoice, bill or expense screen. |
| undeposited funds | Payments not deposited yet |
| unbilled receivable, accrual | Work done, not billed yet |
| write off | Write off |
| reconcile | Match to the bank |
| period, period lock | Month, Closed |
| KitStak's own subscription | Never shown in Ledger. "Billing" is a Portal word. Ledger says "invoicing". |
| cents, millionths, basis points | never shown |

Status words are one shared constant, `LEDGER_STATUS_LABELS` in `@kitstak/ledger-bridge`, used by Ledger, CRM, Pulse and Portal: `draft` Draft, `sent` Sent,
`partially_paid` Part paid, `paid` Paid, `void` Void, `overdue` Overdue (derived, never stored), `in_dispute` In dispute (derived), and for bills `approved`
Approved, `scheduled` Scheduled.

## 0. Decisions

### 0.1 Decided by the owner (binding)

| # | Decision |
|-|-|
| D1 | **Sync first, double entry inside** (reference option C). Ledger owns invoices, collections, vendor bills, payments and expenses, and syncs entries to the shop's accounting tool. Inside, every posted document writes a balanced journal entry against a chart of accounts (4.3, 4.4). Becoming books of record later turns off the sync and turns on statements. |
| D2 | **QuickBooks Online first**, behind a provider interface (8.1). Xero later behind the same interface. |
| D3 | **Vendors move into `core`.** One table `core.vendors`, shared by Ledger, Crew (temp agencies) and later WMS, owned by `@kitstak/db` migrations (5.1). Customers stay `core.customers`. |
| D4 | **Price**: $49 each month for the whole team, up to 5 seats. It lives in `PLANNED_PRODUCTS.ledger` in `packages/billing/src/catalog.ts`. This spec never restates the cents. |
| D5 | **Before launch, access is a preview gate, not billing** (3.1). Ledger is not in `PRODUCT_IDS`, `MODULES` or the `core.entitlements.module` CHECK until launch. |
| D6 | App `apps/ledger`, package `kitstak-ledger`, dev port **3700**, schema `ledger`, bridge `@kitstak/ledger-bridge`, origin `ledger.kitstak.app` (`NEXT_PUBLIC_LEDGER_URL`). Same stack as Pulse and Projects. |
| D7 | Money: whole cents as `bigint`, unit prices to 4 decimals, work dates plain `YYYY-MM-DD`. Billing (KitStak's subscription) and invoicing (the shop's customers) never share tables or wording. |

### 0.2 Proposed, owner to confirm

| # | Open question (reference 9) | Proposed default |
|-|-|-|
| P1 | Ledger close vs Pulse close | When an org has both, the Ledger close is the close. It runs the Pulse close checks as one step and locks Pulse's month in the same action (4.11). Pulse alone closes as today. |
| P2 | WMS invoice export | WMS 3PL Billing keeps its own "Export to integration" action and gains **Send to Ledger** (9.3). Ledger never edits WMS line amounts. |
| P3 | Card and ACH pay links | Through the shop's own Stripe Connect account, after the first release (Phase 11). The data model leaves room (`payments.method = 'card' / 'ach'`, `payments.external_ref`). |
| P4 | Bank feeds | A bank feed provider interface with CSV and OFX statement import first (4.9). A live feed provider is chosen later and plugs into the same interface. |
| P5 | Sales tax | A per org rate table applied per line. No tax engine (4.5.5). |

### 0.3 Small calls made in this spec (listed again in the report so the owner can look)

Each is marked "(call)" where it appears. The main ones: invoice numbers are given when an invoice is sent, not while it is a draft (4.5.2); accruals book only
positive gaps (work done ahead of billing), never deferred revenue (4.10); a write off goes wholly to bad debt with no sales tax relief (4.5.7); expense
submitters do not use one of the 5 seats (3.3); PDFs are made with `pdf-lib` and sent as an attachment plus a view link, which needs a small `@kitstak/mail`
change (4.5.8).

## 1. Topology

| | Dev | Prod |
|-|-|-|
| App | `apps/ledger` (npm `kitstak-ledger`), `http://localhost:3700` (personal dev servers 3701 to 3720) | `ledger.kitstak.app` (new Vercel project `ledger`, Root Directory `apps/ledger`) |
| DB | shared Postgres, new schema **`ledger`** | same Supabase DB |
| Auth | Better Auth via `@kitstak/auth` (copy `apps/pulse/src/server/auth.ts`; cookie `kitstak.session_token`) | `AUTH_COOKIE_DOMAIN=.kitstak.app` |
| Access before launch | preview gate, `KITSTAK_PREVIEW_ORGS` (3.1) | same |
| Access after launch | entitlement module **`ledger`** (3.1, Phase 12) | grant: `pnpm -F @kitstak/entitlements grant grant <org-slug> ledger` |
| URL env var | `NEXT_PUBLIC_LEDGER_URL` (default `http://localhost:3700`), read by Portal, CRM, WMS, Projects, Pulse and Crew | `https://ledger.kitstak.app` |
| Migrations | `apps/ledger/drizzle`, runner `scripts/db-migrate.ts` (copy of Pulse's), table `drizzle.__kitstak_ledger_migrations`, advisory lock key `7_202_611_507` (next free key after Pulse 505 and Crew 506) | fresh database order: `@kitstak/db`, CRM, WMS, Projects, Pulse, then `pnpm -F kitstak-ledger db:migrate` last |
| Shared migrations | `packages/db/drizzle/0012_core_vendors.sql` (journal idx 13) creates `core.vendors`. Sibling migrations in 9.8. No entitlement CHECK change before launch. | |
| Bridge package | `packages/ledger-bridge` (`@kitstak/ledger-bridge`), raw SQL over the host's Drizzle executor, same shape as `@kitstak/pulse-bridge` | |
| Cron | `vercel.json`: `/api/v1/cron/tick` every 5 minutes (sync outbox, bridge events, reminders due, recurring invoices due, promise checks), `/api/v1/cron/cleanup` daily at 07:20 UTC (retention). Both need `Authorization: Bearer $CRON_SECRET` and return 503 when it is not set. | |

Env (`src/server/env.ts`, lazy): `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PORTAL_URL`,
`NEXT_PUBLIC_CRM_URL`, `NEXT_PUBLIC_WMS_URL`, `NEXT_PUBLIC_PROJECTS_URL`, `NEXT_PUBLIC_PULSE_URL`, `NEXT_PUBLIC_CREW_URL`, `TRUSTED_ORIGINS`,
`AUTH_COOKIE_DOMAIN`, `KITSTAK_PREVIEW_ORGS` (3.1), `ENTITLEMENTS_DEV_ALLOW_ALL`, `CRON_SECRET`, `HEALTH_TOKEN`, `LEDGER_DB_GUARD` (5, rule R13),
`LEDGER_INTEGRATION_KEY` (32 byte key, AES-256-GCM for provider tokens; required when a provider is connected), `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`,
`QBO_REDIRECT_URI`, `QBO_ENVIRONMENT` (`sandbox` or `production`), `QBO_WEBHOOK_VERIFIER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` (through
`@kitstak/mail`), `BLOB_READ_WRITE_TOKEN` (optional, 5.7). `appUrls()` returns `{portal, crm, wms, projects, pulse, crew, ledger}`. `trustedOrigins()` adds the
sibling URLs and dev ports 3700 to 3720 only when `NODE_ENV !== 'production'`.

Local dev: copy `apps/pulse/.env.local` to `apps/ledger/.env.local`, set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to `http://localhost:3700`, and add the
`QBO_*` sandbox keys only when working on Phase 8. Logins are the Pulse demo logins (seed 11).

Ops surface, same as the siblings: `GET /api/health` (database ping; migration version, guard state and provider status only with the health token), structured
error logs with org id and request id, `error.tsx`, `not-found.tsx`, `global-error.tsx`, security headers and CSP in `next.config.ts` matching the sibling
policy (`connect-src 'self'`), and `robots` disallow all. The public invoice page (6) adds `noindex` and `Referrer-Policy: no-referrer`.

## 2. Stack (match apps/pulse exactly)

Next.js 16.4.5 App Router (read `node_modules/next/dist/docs/` first: `src/proxy.ts`, not middleware; `params` are Promises), React 19.3, Tailwind 4,
`@kitstak/ui` tokens, theme, logo, app switcher and handoff, Drizzle and pg via `@kitstak/db/client-pg`, zod 4, lucide-react, radix, cmdk, sonner, zustand,
`@tanstack/react-query`, `@tanstack/react-virtual`, date-fns, vitest, Playwright. Charts are the house SVG kit copied from `apps/pulse/src/components/charts`.
CSV is Pulse's `src/lib/csv.ts` copied with its tests. OFX parsing is our own small tested module `src/lib/ofx.ts` (OFX 1.x SGML and 2.x XML), no dependency.
PDF is `pdf-lib` 1.17.1 (the version WMS and Projects already pin). Money math imports `@kitstak/programs-engine/money` (`divRound`, `mulQuantityPrice`,
`sumCents`, `toCents`) like Pulse does.

Layering is the house pattern: thin pages, `src/features/<area>` holds the server page and client view, all data access goes through `src/server/domain/*`
(first argument `ctx: DomainContext`, every export wrapped in `scoped(...)`), mutations are server actions returning `ActionResult<T>`, client reads are same
origin `/api/v1/*` with the `{ data } | { error }` envelope, every write runs in one transaction with an activity row. Posting is one module,
`src/server/domain/posting.ts`, and no other file inserts journal rows. Background work is `after()` from `next/server` on a route with an explicit
`maxDuration`, never a detached promise.

Wire types: `pg` returns `bigint` and `numeric` as strings. Cents leave the server as decimal strings (`"1598566"`), as the Programs spec does (M7), so there is
no safe integer edge. Prices and quantities leave as decimal strings. Display uses `formatCents` (fixed `en-US`). JS floats never touch money.

## 3. Access: the preview gate, roles and permissions

### 3.1 The preview gate (until launch)

One function decides whether an org may open Ledger at all: `orgLedgerAccess(org)` in `src/server/entitlements.ts`, which calls the shared
`previewAccess('ledger', org.slug, env)` from `@kitstak/entitlements` (`packages/entitlements/src/preview.ts`, added on this branch with the Crew work, so Crew
and Ledger use one rule). It answers `full` or `locked`, never view only:

```
ENTITLEMENTS_DEV_ALLOW_ALL is true                         full
NODE_ENV is not production and the switch is not false     full   (local dev, tests)
otherwise                                                  full when lower(org.slug) is in KITSTAK_PREVIEW_ORGS (comma list, trimmed,
                                                           lowercased, blanks dropped), else locked
```

Every `(app)` layout, route handler, server action and cron fan out calls it, the same places Pulse calls `assertPlanAllows`.

- A locked org sees: "Ledger is in early preview. Ask KitStak to add your workspace." There is no Portal billing link, because Ledger cannot be bought yet. The
  API answers 402 `NOT_ENTITLED` with the same sentence.
- Siblings call the same `previewAccess('ledger', ...)`, so the app switcher row, the Portal tile, the CRM balance tab, the WMS Send to Ledger button and the
  Pulse "Create invoice" button all hide for an org that is not let in. Each sibling that shows Ledger UI reads `KITSTAK_PREVIEW_ORGS` too (`.env.example` and
  `deploy/push-env.mjs` gain it).
- One list opens both preview apps today: a slug in `KITSTAK_PREVIEW_ORGS` lets that org into Crew and Ledger.
- Seed and tests: seed orgs are let in by the dev rule. E2E runs with `ENTITLEMENTS_DEV_ALLOW_ALL=0` and `KITSTAK_PREVIEW_ORGS=kitstak,ledger-only`, so the
  locked screen is proven for `northwind-robotics`.

**Replaced at launch (Phase 12).** `orgLedgerAccess` stops calling `previewAccess` and becomes a copy of Pulse's `orgPulseAccess`
(`getModuleAccess(db, orgId, 'ledger')`, allow all in dev unless `ENTITLEMENTS_DEV_ALLOW_ALL=0`), and the plan gate (full, view only, locked) is copied from
`apps/pulse/src/server/plan-gate.ts` with Ledger's sentences. Siblings replace `previewAccess('ledger', ...)` with their normal entitlement flag
(`entitled.ledger`), and `ledger` leaves `PREVIEW_APPS`. Before the switch, each org in `KITSTAK_PREVIEW_ORGS` gets a manual grant so nobody loses access mid
day. Then the variable is removed from Ledger's env. The full list is in 13, Phase 12.

### 3.2 Roles

Ledger has seven roles. Money is never inherited from another app: a WMS manager, a WMS operator or a Pulse supervisor gets **none** in Ledger. A person's
Ledger role is the first that applies:

1. Their row in `ledger.member_roles` (set by an admin, or by the claim step).
2. Their org role (`core.member.role`): `owner` gives **owner**, `admin` gives **admin**, everyone else gives `settings.default_member_role`, which is `none`
   and can only be set to `none` or `submitter`.

So a floor role never sees payables unless an admin gives that person a Ledger role by name. The resolver is one SQL statement plus one pure function in
`packages/ledger-bridge/src/access.ts` (`resolveLedgerAccess`), imported by the app and the bridge so they cannot drift.

**Who runs Ledger.** If nobody resolves to `owner`, the first person who resolves to `admin` and opens Ledger is offered "Run Ledger for this workspace", which
writes an explicit `owner` row. The welcome flow then asks "Who handles money here?" with a role picker per member.

| Role | Who it is | Sees money owed to you | Sees bills to pay | Can do |
|-|-|-|-|-|
| **owner** | business owner | yes | yes | everything, including reopen a closed month and delete all data |
| **admin** | finance lead, controller | yes | yes | everything except reopen and delete all data: settings, chart of accounts, roles, connect QuickBooks, close a month, approve and pay |
| **bookkeeper** | does the books day to day | yes | yes | invoices, payments, collections, enter and pay bills, expenses, bank matching, journal entries, imports. Not approve bills by default, not close. |
| **approver** | ops or purchasing manager | no | yes, the bills and expenses sent to them | approve or send back bills and expenses |
| **viewer** | owner's partner, outside accountant | yes | yes | read every screen, export |
| **submitter** | anyone with a company card | no | no | add and see their own expenses only |
| **none** | everyone else | no | no | a friendly "Ask an admin for access" screen |

### 3.3 Rights (`src/lib/permissions.ts`)

Rights are a table, not ranks, because approving and paying are kept apart.

| Right | owner | admin | bookkeeper | approver | viewer | submitter |
|-|-|-|-|-|-|-|
| `money:read` (invoices, customers, payments, balances, reports) | x | x | x | | x | |
| `ap:read` (bills, vendors, payments out) | x | x | x | own queue | x | |
| `invoice:write` (draft, send, void, credit notes, recurring) | x | x | x | | | |
| `payment:record` (customer payments, deposits, refunds) | x | x | x | | | |
| `collections:manage` (reminders, promises, disputes, write offs up to the limit) | x | x | x | | | |
| `writeoff:approve` (write offs above `settings.write_off_limit_cents`) | x | x | | | | |
| `bill:enter` | x | x | x | | | |
| `bill:approve` | x | x | per person switch | x | | |
| `bill:pay` (schedule and record payment) | x | x | x | | | |
| `expense:submit` (own) | x | x | x | x | | x |
| `expense:approve` (others') | x | x | x | x | | |
| `bank:reconcile` | x | x | x | | | |
| `journal:post` (manual entries) | x | x | x | | | |
| `period:close` | x | x | | | | |
| `period:reopen` | x | | | | | |
| `settings:manage`, `roles:manage`, `sync:manage` | x | x | | | | |
| `import:run` | x | x | x | | | |
| `export:run` | x | x | x | | x | |
| `data:purge` | x | | | | | |

- **Approve vs pay.** `settings.separate_approval` (default on) means the person who entered a bill cannot approve it, and the person who approved it cannot be
  the only one to pay it, when the org has two or more people with `bill:approve`. With one person (a small shop) the rule is off and the screen says so: "You
  are the only approver. Ledger lets you approve your own bills."
- **Seats.** Ledger includes 5 people with a role other than `none`. Submitters do not count (call). Giving a sixth person a role is refused: "Ledger includes 5
  people. Remove someone first." Before launch the limit is shown but not enforced.
- **Balance readers outside Ledger.** `member_roles.sees_balances` (default off) lets a person with role `none`, for example a salesperson, see a customer's
  balance and days past due in CRM and Portal. Without it, sibling screens show days past due and the invoice count but no amount (9.1).
- **Money hiding is on the server.** Every DTO builder takes the reader's rights. Without `money:read` every AR amount is `null` with `moneyHidden: true`;
  without `ap:read` bills, vendor balances and payments out are not returned at all (404 on detail routes). Exports drop what the reader cannot see. Activity
  `before` and `after` are redacted by a field allow list per entity type. Reminders, notifications and tasks Ledger creates in Projects store
  `{ rule, params }` and are rendered per reader, as in Pulse 3. A unit test walks every DTO as a submitter and as an approver and fails on any AR amount, and a
  second test fails if an approver DTO holds any invoice field.

People who leave an org: the cron tick removes their `member_roles` row, reassigns their open close tasks to the owner, and keeps their name in history through
`core."user"`. Roles are per org, as in Pulse.

## 4. The money model

### 4.1 Plain words (this is also the in-app "How Ledger does the math" page)

- An **invoice** asks a customer to pay for work. Each line is a quantity times a price. Sales tax is added line by line when you charge it.
- When you **send** an invoice, it gets its number and counts as money owed to you. A draft counts for nothing.
- A **payment** lowers what a customer owes. One payment can pay several invoices, or part of one.
- A **credit note** takes money off what a customer owes, for example for one wrong line.
- A **bill** is what a vendor asks you to pay. It counts as money you owe once it is approved.
- An **expense** is money already spent, on a company card or by a person you will pay back.
- **Matching to the bank** proves that each deposit and each payment out really happened.
- **Closing a month** locks it. Nothing dated in it can change unless the owner reopens it and says why.
- Behind every screen is one set of books: each thing that counts writes an entry where what goes in equals what goes out, to the cent. You never need to look
  at it. Your accountant can, and the same entries go to QuickBooks.

### 4.2 Units, precision and rounding

- Totals are `bigint` cents (`*_cents`). Unit prices are `numeric(14,4)` in currency units. Quantities are `numeric(14,3)`. Hours are `numeric(10,2)`. Tax rates
  are integer **millionths** of the amount (`rate_millionths`; 8.25% is 82500, 7.125% is 71250), because state and local rates go to three decimals of a
  percent. Percents shown to people are computed, never stored as floats.
- **One rounding rule**, Pulse 4.2: `divRound(n, d)` rounds half away from zero. Line amount
  `= mulQuantityPrice(quantity, unit_price) = divRound(qty x 1000 x price x 10000, 100000)`. Line tax `= divRound(line_cents x rate_millionths, 1000000)`. Hours
  times a rate in cents `= divRound(hours x 100 x rate_cents, 100)`.
- **Stamp once, sum always.** Every line stores its `amount_cents` and `tax_cents` when it is saved. Document totals are plain sums of stamped lines, and every
  journal line is a stamped amount. Totals never drift from their rows (property test, 14).
- Tax is rounded **per line**, then summed (call). The invoice PDF prints the tax per rate as the sum of its lines, so it adds up on paper.
- CHECK bounds: quantities `>= -100,000,000` and `< 100,000,000` (credit lines can be negative), unit prices `>= 0` and `< 1,000,000`, cents between plus and
  minus 10^13, `rate_millionths` between 0 and 250000 (25%).
- Dates are `date` columns as `YYYY-MM-DD`. "Today" is today in `settings.timezone` (from the WMS default warehouse when there is one, else the browser time
  zone captured on the welcome screen). One currency per org (`settings.currency`, default `USD`); a document in another currency is refused, and a sibling row
  in another currency is skipped and listed.

Worked example (the seed's INV-1042, Harbor Roast Collective, tax on supplies only, 8.25%):

| Line | Quantity x price | Amount | Tax |
|-|-|-|-|
| Storage, pallet months | 412 x $18.5000 | `divRound(412000 x 185000, 100000) = 762200` | 0 |
| Kit assembly | 3,000 x $2.7500 | `825000` | 0 |
| Labels (taxable) | 3,000 x $0.0350 | `divRound(3000000 x 350, 100000) = 10500` | `divRound(10500 x 82500, 1000000) = 866` |
| | | subtotal `1597700` | tax `866` |

Total `1598566` ($15,985.66).

### 4.3 Double entry inside

**Chart of accounts.** `ledger.accounts` holds the org's accounts. Every account has a `type` (`asset`, `liability`, `equity`, `revenue`, `expense`) that sets
its normal side (debit for asset and expense, credit for the rest), a `subtype`, and an optional `system_key` for the accounts posting needs. A new org gets
this default chart for a kitting and 3PL shop. Admins can rename, renumber, add and archive. A system account can be renamed but not archived or retyped.

| Group | Accounts (number, name, `system_key` in brackets) |
|-|-|
| Assets | 1000 Checking [`default_bank`] (one per real bank account) · 1050 Payments not deposited yet [`undeposited`] · 1100 Money owed to you [`ar`] · 1150 Work done, not billed yet [`unbilled`] · 1300 Prepaid expenses · 1400 Supplies on hand (optional; supplies are normally an expense, reference 3.1) · 1500 Equipment · 1510 Equipment depreciation to date (contra, by journal entry) |
| Liabilities | 2000 Bills to pay [`ap`] · 2100 Company card [`default_card`] (one per card) · 2200 Sales tax to pay [`sales_tax`] (each rate may point at its own) · 2300 Payroll to pay [`payroll`] · 2310 Payroll taxes to pay · 2350 Owed to people (reimbursements) [`reimbursements`] · 2400 Customer credits [`customer_credit`] (unapplied payments) |
| Equity | 3000 Owner's equity · 3100 Retained earnings [`retained_earnings`] (reports roll prior years in; no closing entry) · 3900 Opening balances [`opening_equity`] (migration only, 7.2) |
| Revenue | 4000 Kitting and assembly [`default_revenue`] (WMS Work Order) · 4100 Storage (WMS Storage) · 4200 Receiving · 4300 Pick and pack · 4400 Extra services (WMS VAS, Pulse services) · 4500 Shipping and freight billed (WMS Shipment) · 4600 Program fees (Programs batch, hourly, monthly and minimum fees) · 4800 Other revenue · 4900 Credits and discounts (contra) · 4950 Work done, not billed yet (revenue) [`accrued_revenue`] |
| Cost of service | 5000 Floor wages · 5100 Temp agency labor (both labor: never sent to Pulse, 9.4) · 5200 Packaging and supplies (Pulse `packaging`) · 5300 Freight out (`freight`) · 5400 Outside services (`outside_service`) |
| Expenses | 6000 Rent (Pulse company cost `rent`) · 6100 Utilities (`utilities`) · 6200 Equipment and repairs (`equipment`) · 6300 Insurance (`insurance`) · 6400 Office salaries (`salaried_staff`) · 6410 Payroll taxes and 6420 Benefits (never sent to Pulse) · 6500 Software and subscriptions, 6600 Office and admin, 6700 Travel and meals, 6950 Other expenses (`other`) · 6800 Bank and card fees [`bank_fees`] · 6900 Bad debt [`bad_debt`] |

**Journal.** `ledger.journal_entries` (one per posting) and `ledger.journal_lines` (two or more per entry). Each line has an account, and exactly one of
`debit_cents > 0` or `credit_cents > 0`. Rules, each enforced in the database:

- **Balanced.** A deferred constraint trigger (`DEFERRABLE INITIALLY DEFERRED`, so it runs at commit) refuses any entry where
  `sum(debit_cents) <> sum(credit_cents)` or that has fewer than two lines.
- **Append only.** `BEFORE UPDATE OR DELETE` on both tables raises, except under `SET LOCAL ledger.allow_purge = 'on'` (purge, seed wipe, "Clear sample data")
  or when the org row is gone (org cascade). A mistake is fixed by a reversing entry, never an edit.
- **Closed month.** `BEFORE INSERT` on `journal_entries` raises `month_closed` when `ledger.periods` has a closed row for the month of `entry_date`.
- **One posting per document version.** Unique `(org_id, source_type, source_id, posting_seq)`. A document that changes while its month is open is reposted as:
  reverse the last entry (same date, `reverses_entry_id` set), then post the new one, `posting_seq + 1`.
- **One writer.** Only `src/server/domain/posting.ts` inserts journal rows, under
  `pg_advisory_xact_lock(hashtext('ledger:' || org_id || ':' || source_type || ':' || source_id))`. A lint rule fails on any other insert.

Every journal line also carries the subledger ids it belongs to: `customer_id`, `vendor_id`, `invoice_id`, `bill_id`, plus the tags `pulse_job_id` and
`tax_rate_id`. AR for a customer is the sum of their AR lines, and the invoice level balances (stored on invoices for speed) are tested to equal it.

### 4.4 Posting rules (every document type)

Each rule writes one entry dated the document date. "Bank" means the bank or card account the person picked.

| Document and event | Debit | Credit |
|-|-|-|
| Invoice sent | AR, total | each line's revenue account, line amount (a negative line debits it); sales tax account per rate, tax |
| Invoice changed while open and unpaid (4.5.1) | reverse, then post again | |
| Invoice voided (month open, nothing applied) | reversing entry on the issue date | |
| Credit note issued | each line's revenue account; sales tax per rate | AR, total |
| Payment received | Payments not deposited yet, or Bank when "Deposited straight to the bank" | AR, the applied part; Customer credits, the unapplied part |
| Unapplied credit applied later | Customer credits | AR (dated the day it is applied) |
| Refund of a customer credit | Customer credits | Bank |
| Deposit | Bank, the net amount; Bank and card fees, any fee line | Payments not deposited yet, the sum of the payments in it |
| Write off | Bad debt (or the account picked) | AR |
| Bill approved | each line's expense or asset account | Bills to pay, total |
| Bill voided (month open, nothing paid) | reversing entry on the bill date | |
| Vendor credit approved | Bills to pay | each line's account |
| Bill payment recorded | Bills to pay | Bank or Company card |
| Expense on a card or from the bank | each line's account | Company card or Bank |
| Reimbursement approved | each line's account | Owed to people |
| Reimbursement paid | Owed to people | Bank |
| Transfer (including paying the card) | to account | from account |
| Month end accrual (4.10) | Work done, not billed yet (1150) | Work done, not billed yet (revenue, 4950) |
| Accrual reversal (first day of next month) | 4950 | 1150 |
| Manual journal entry | as typed, balanced | as typed |
| Opening balances (7.2) | each account's opening debit | each account's opening credit; Opening balances (3900) for the difference |
| Open invoice imported | AR | Opening balances (3900), dated the opening date |
| Open bill imported | Opening balances (3900), dated the opening date | Bills to pay |
| Payroll journal imported | as in the file, balanced | as in the file |

Worked example: INV-1042 sent posts Dr 1100 `1598566`; Cr 4100 `762200`, Cr 4000 `825000`, Cr 4400 `10500`, Cr 2200 `866`. Credits sum to `1598566`. A payment
of `800000` to undeposited funds posts Dr 1050 `800000`, Cr 1100 `800000`; the invoice is now Part paid with `798566` due.

A posting into a closed month is refused with the house sentence: "October 2026 is closed. Date it in November, or ask the owner to reopen October." Nothing in
Ledger moves a date on its own.

### 4.5 Invoices

#### 4.5.1 Lifecycle

`ledger.invoices.kind` is `invoice` or `credit_note`. Statuses (`status`):

| Kind | Status | Means | Next |
|-|-|-|-|
| invoice | `draft` | being written; not posted; no number | send, delete |
| invoice | `sent` | posted, numbered, nothing paid yet | part paid, paid, void |
| invoice | `partially_paid` | `0 < balance_cents < total_cents`: some of it is paid, credited or written off | paid |
| invoice | `paid` | `balance_cents = 0` (paid, credited or written off) | stays paid; removing an application reopens it |
| invoice | `void` | posted then reversed; keeps its number; shows a Void stamp | final |
| credit_note | `draft` | being written | issue, delete |
| credit_note | `open` | issued and posted; credit left to apply | applied, void |
| credit_note | `applied` | all of it applied to invoices or refunded | final |
| credit_note | `void` | reversed | final |

`balance_cents = total_cents - applied_cents - credited_cents - written_off_cents`, stored and kept in the write transaction. Overdue and In dispute are derived
for display, never stored.

**No silent edits.** A sent invoice can be changed only while its month is open **and** nothing is applied to it. The change is logged with before and after,
posts the reverse and the new entry, and is resent only if the person says so. In every other case the screen offers a credit note ("Credit a line") or void.
Void needs a reason, nothing applied, and an open month; otherwise: "This invoice is in a closed month. Make a credit note instead."

#### 4.5.2 Numbering

`ledger.number_sequences` has one row per `(org_id, doc_type)`: `invoice` (prefix `INV-`, next 1001), `credit_note` (`CN-`, 1001), `journal` (`JE-`, 1), `bill`
(`BILL-`, 1001; the internal number, the vendor's own number is `vendor_ref`), `payment` (`PMT-`, 1001), `expense` (`EXP-`, 1001). A number is taken with
`UPDATE ... SET next_value = next_value + 1 RETURNING` inside the posting transaction, so a rolled back send leaves no gap. **Invoice and credit note numbers
are given when the document is sent, not while it is a draft** (call), so deleted drafts leave no holes. The number is repeated while `prefix || value` is
already taken by an imported invoice. Admins can change prefix and next number in Settings (never lower than a number already used). Unique live
`(org_id, kind, lower(number))`.

#### 4.5.3 Terms and due dates

`ledger.terms` rows: `kind` `due_on_receipt` (due = issue date), `net_days` (due = issue + `days`), `day_of_next_month` (due = day `day` of the month after the
issue month, clamped to that month's last day). Seeded: Due on receipt, Net 15, Net 30 (default), Net 45, Net 60, 1st of next month. A customer's terms come
from `customer_profiles.terms_id`, else the CRM won deal's terms when they parse (9.6), else the org default. The invoice stores `terms_id` and `due_date`;
changing terms on a draft recomputes the due date, and a typed due date wins.

#### 4.5.4 Lines

`ledger.invoice_lines`: `position`, `item_id` (optional; sets the default account, description, price and tax), `description`, `quantity numeric(14,3)`,
`unit_price numeric(14,4)`, `amount_cents`, `account_id` (revenue), `tax_rate_id` (null = not taxed), `rate_millionths` (stamped from the rate at save),
`tax_cents`, `pulse_job_id`, `service_date` (optional, for the PDF), and `amount_from_source boolean`. For a normal line
`amount_cents = mulQuantityPrice(quantity, unit_price)`. A line from WMS keeps the WMS amount exactly, even when quantity times price differs (WMS minimum and
maximum adjustments), with `amount_from_source = true`; the PDF shows quantity and price only when they multiply to the amount. A discount is a negative line on
the Credits and discounts account.

#### 4.5.5 Sales tax (proposed P5)

`ledger.tax_rates`: `name` ("Texas: Austin 8.25%"), `rate_millionths`, `account_id` (default Sales tax to pay), `agency` (text), `active`. A rate is never
edited once used: a new rate is a new row and the old one is archived. Items carry a default `tax_rate_id` and customers can be marked tax exempt
(`customer_profiles.tax_exempt`, with an exemption note), which blanks the rate on new lines. Ledger does no tax logic: whether storage is taxed in a state is
the shop's choice, set on the item. The **Sales tax collected** report sums `tax_cents` of sent invoices minus credit notes, by rate and month.

#### 4.5.6 Credit notes

A credit note has its own lines (same math) and optional `credit_for_invoice_id`. "Credit a line" on an invoice makes a draft credit note with that line's
quantity, price and tax rate. Credit note lines are positive; the credit note as a whole takes the amount off. Issuing posts (4.4). Applying an open credit note
to an invoice is a `ledger.payment_applications` row with `credit_note_id` set and no new journal entry (both sides are AR). An unapplied credit note can be
refunded (a refund payment, kind `refund`). Credit notes count in Pulse as negative billed rows (9.4).

#### 4.5.7 Write offs

`ledger.write_offs`: `invoice_id`, `write_off_date`, `amount_cents` (`> 0`, `<= balance`), `account_id` (default Bad debt), `reason` (required). Above
`settings.write_off_limit_cents` (default 50000) it needs `writeoff:approve`. It writes off the amount as it stands, including any sales tax in it, to the
expense account (call: no sales tax relief; that is the accountant's call). A write off can be reversed by an admin while its month is open.

#### 4.5.8 Sending, the PDF and the view link

- **Send** posts, numbers, and emails the billing contacts (`customer_profiles.billing_emails`, at least one needed) through `@kitstak/mail` with the PDF
  attached and a link to the public invoice page `/i/[token]`. `@kitstak/mail` gains an optional `attachments: { filename, contentType, base64 }[]` on
  `MailMessage` (Resend supports it; a small change in `packages/mail`, Phase 2). Every send uses `dedupeKey = invoice:<id>:send:<n>`.
- The PDF is rendered on demand with `pdf-lib` from stored rows (`src/server/pdf/invoice.ts`): shop logo and address from settings, customer, number, dates,
  terms, PO, lines, tax by rate, total, paid so far, balance, payment instructions (`settings.remit_text`), and for WMS invoices an optional detail page listing
  the WMS detail lines. Same rows, same PDF, every time.
- `/i/[token]`: `ledger.public_links` holds `token_hash` (SHA-256) and `token_prefix`, never the token. It shows the invoice and a PDF download, needs no login,
  returns only that invoice, and expires 365 days after the last send (a resend renews it). Rate limited.
- "Mark as sent" posts and numbers without email, for invoices sent another way. Every send, resend and view is an activity row.

#### 4.5.9 Recurring invoices

`ledger.recurring_invoices` (template): `customer_id`, `name`, `cadence` (`weekly` on a weekday, `monthly` on a day 1 to 28 or `last`, `quarterly` on a month
and day), `next_run_date`, `end_date`, `terms_id`, `memo`, `active`, and lines in `recurring_invoice_lines` (same columns as invoice lines). The cron tick makes
a **draft** on each due run date in the org time zone, for a person to check and send (the site says so), with `source = 'recurring'` and
`source_ref = rec:<templateId>:<runDate>` so a retry never makes two. A draft not sent shows in the close checklist.

#### 4.5.10 Where an invoice starts

`/invoices/new?from=` `manual` (default), `wms`, `pulse`, `program`, or a copy of an old invoice. `ledger.invoice_sources` records what each line came from:
`(source_type, source_ref)` with `source_type` in `wms_bill`, `wms_bill_line`, `pulse_job`, `pulse_client`, `program_output`, `program_fee`, `recurring`,
`import`. A partial unique index on `(org_id, source_type, source_ref)` where the invoice is not void stops the same WMS bill line or program fee from being
invoiced twice. Each source's rules are in 9.

### 4.6 Collections

#### 4.6.1 Aging

For an as of date `A` (default today in the org time zone), an invoice counts when it was sent on or before `A` and not voided on or before `A`. Its balance as
of `A` is the total minus applications, credits and write offs dated on or before `A`. `days_past_due = A - due_date` in whole days (date subtraction, no time
of day). Buckets:

| Bucket | Rule |
|-|-|
| Current | `days_past_due <= 0` (not due yet, or due today) |
| 1 to 30 | 1 to 30 |
| 31 to 60 | 31 to 60 |
| 61 to 90 | 61 to 90 |
| Over 90 | 91 or more |

Example: due 2026-10-15, as of 2026-11-27: 16 days left in October plus 27 is 43 days, bucket 31 to 60. Aging is by customer and in total, for any as of date,
and the bucket totals always equal the AR account balance as of that date (test, 14). Open credit notes and unapplied payments show as a separate "Credits"
column, never inside a bucket. Amounts in dispute stay in their bucket and also show in an "In dispute" column.

#### 4.6.2 Reminders

`ledger.reminder_rules` (per org, editable): offsets in days from the due date. Default: `-3` (a friendly heads up), `+7`, `+14`, `+30`, then every 30 days, at
most 6 reminders per invoice. The tick sends a reminder at 09:00 org time on a working day (`settings.working_days`) when all hold: the invoice is sent or part
paid, its undisputed balance is above 0, the customer has reminders on, the invoice has reminders on, no promise to pay is pending (4.6.3), and that offset was
not sent before (`ledger.reminder_sends` unique `(invoice_id, rule_offset)`). One email per customer per day: several due invoices go in one reminder listing
each, with the view links. Every reminder is an activity row and shows on the invoice timeline.

#### 4.6.3 Promise to pay

`ledger.promises`: `customer_id`, `invoice_ids uuid[]`, `promised_date`, `amount_cents` (optional), `note`, `status` (`pending`, `kept`, `missed`, `cancelled`).
While pending, reminders for those invoices pause. Kept when the promised amount (or the whole balance) is applied by
`promised_date + settings.promise_grace_days` (default 2). Else it turns missed: the owner of collections for that customer gets a notification, reminders
resume, and a task is made in Projects when licensed (9.5).

#### 4.6.4 Disputes on a line

`ledger.disputes`: `invoice_line_id`, `opened_on`, `amount_cents` (default the line total with its tax), `reason`, `status` (`open`, `resolved_credited`,
`resolved_dropped`). An open dispute does not change the balance. It lowers the **undisputed balance** (`balance - open disputed amounts`), which is what
reminders ask for, so the rest of the invoice stays due. Resolved credited makes and links a credit note for the agreed amount. Resolved dropped returns it to
due. The PDF and the view page mark the line "In dispute".

#### 4.6.5 Partial payments and allocation

`ledger.payments` (money received) and `ledger.payment_applications` (`payment_id` or `credit_note_id`, `invoice_id`, `amount_cents`, `applied_on`). Rules:

- A payment can be applied to any open invoices of that customer, in any split, as long as the applications sum to at most the payment. The suggested split is
  oldest due date first, then lowest number, skipping disputed amounts until the undisputed balances are covered.
- What is left is unapplied (Customer credits) and shows on the customer as a credit to apply later.
- Within an invoice, a payment pays the undisputed part first, for display only. The books track the invoice balance, not lines.
- Removing an application (a mistake) is allowed while the payment's month is open and posts a reversing entry.

### 4.7 Vendor bills and payments

#### 4.7.1 Lifecycle

| Status | Means | Next |
|-|-|-|
| `draft` | entered, not posted, editable; a photo or PDF of the bill attached | send for approval (stays draft with `approval_requested_at`), approve, delete |
| `approved` | posted; counts as money you owe | schedule, pay, void |
| `scheduled` | a pay date is set (`pay_on`); still owed | pay, unschedule |
| `paid` | `paid_cents = total_cents` | final (a removed payment returns it to approved or scheduled) |
| `void` | posted then reversed, with a reason | final |

A bill partly paid stays approved or scheduled and shows a "Part paid" tag (`paid_cents > 0`). A **vendor credit** is a bill with `kind = 'vendor_credit'`,
applied to bills like a credit note.

**Approval.** `bills.approver_id` is set from `vendor_profiles.default_approver_id` or picked. The approver sees the bill, its photo, its lines, the receipt
match and the agency check, and can Approve or Send back with a note. Approval posts the bill on its bill date. `settings.auto_approve_below_cents` (default
null, off) lets bills under an amount from a trusted vendor (`vendor_profiles.auto_approve = true`) approve on entry.

**Duplicates.** Unique live `(org_id, vendor_id, lower(vendor_ref))` when `vendor_ref` is set. Without it, a bill with the same vendor, amount and bill date as
a live bill asks "This looks like BILL-1043 from Nov 3. Add it anyway?"

**Paying.** `ledger.bill_payments` (`paid_on`, `account_id` bank or card, `method` `check`, `ach`, `wire`, `card`, `cash`, `reference`, `amount_cents`) with
`bill_payment_applications`. The **Pay bills** screen lists approved and scheduled bills by pay date, with a running total against the bank account's balance in
Ledger. Ledger records payments; it does not move money.

#### 4.7.2 Match a bill to what was received (when WMS has it)

A bill line can point at a WMS purchase order line (`bill_lines.wms_po_line_id`, `wms_po_code`). Ledger reads the tenant's `purchase_order_lines` and `receipts`
(read only, 9.3) and stores the check on the bill (`bills.checks.receipt`): `billed_qty` vs `received_qty` and the billed unit price vs the PO `unit_cost`. A
line is flagged when it bills more than was received, or the price is more than `settings.price_tolerance_bp` (default 200, 2%) above the PO. Flags show to the
approver; they warn, never block. No WMS: the match section is hidden.

#### 4.7.3 Temp agency hours check (when Crew exists)

A bill from a vendor whose `kinds` include `temp_agency` can carry `agency_week_start` and `billed_hours numeric(10,2)` (typed, or read from the bill's lines
with unit `hour`). Ledger reads Crew's approved hours for that agency and week through `@kitstak/crew-bridge`
(`getAgencyHours(db, { orgId, vendorId, weekStart })` from `@kitstak/crew-bridge`, docs/crew/SPEC.md section 8) and stores `bills.checks.agency`:
`{ billedHours, crewHours, diffHours, diffCents }` with `diffCents = divRound(diffHours x 100 x bill_rate_cents, 100)` when the bill has one rate. Example:
billed 412.00, Crew 396.00, at $19.75: 16.00 hours, `divRound(1600 x 1975, 100) = 31600` ($316.00) more than Crew recorded. Flagged when
`abs(diffHours) > settings.agency_hours_tolerance` (default 0.50). No Crew: the section reads "Connect Crew to check agency hours" and nothing else changes.

### 4.8 Expenses

`ledger.expenses`: `kind` (`card` or `reimbursement`), `spent_on`, `submitted_by` (the person), `paid_from_account_id` (card or bank for `card`; null for
`reimbursement`), `merchant`, `amount_cents`, `status` (`draft`, `submitted`, `approved`, `rejected`, `paid` for reimbursements), `approver_id`, and one or more
`expense_lines` (`account_id`, `amount_cents`, `customer_id`, `pulse_job_id`, `memo`) that sum to the amount. At least one receipt attachment is needed to
submit, unless the amount is under `settings.receipt_required_above_cents` (default 2500). Approval posts (4.4). A reimbursement is paid alone or several at
once in one bank payment. A line tagged to a job or a client counts as Pulse cost (9.4). Phones: `/expenses/new` opens the camera first, then amount, category
and job, in under 30 seconds.

### 4.9 Bank and reconciliation (proposed P4)

**Accounts.** `ledger.bank_accounts` links each real bank or card account to its chart account (`account_id`), with `kind` (`bank`, `card`), the last 4 digits,
and `feed` (`statement_import` now; a live feed provider later, `provider`, `provider_ref`). Statement import takes CSV (column match like every import: date,
description, amount or money in and money out, optional balance and check number) or OFX or QFX (parsed by `src/lib/ofx.ts`). Lines land in `ledger.bank_lines`
with a dedupe key: the OFX `FITID` when present, else a hash of `(bank account, date, amount, description, n)` where `n` counts identical lines in that file, so
the same file twice adds nothing.

**Matching.** Ledger suggests and a person confirms. It never confirms on its own. A match (`ledger.bank_matches`) ties a bank line to one or more Ledger
records whose amounts sum to the line exactly. Candidates, best first:

| Bank line | Candidates | Rules |
|-|-|-|
| Money in | a deposit already recorded; else one payment or a set of payments sitting in "Payments not deposited yet" | dates from 10 days before to 3 days after the line; a set has at most 6 payments from the 20 nearest; score: exact amount, then fewest days apart, then the description holds an invoice number or customer name |
| Money out | a recorded bill payment or reimbursement payment | equal amount; 3 days before to 10 days after; a check number match wins |
| Card charge | an approved card expense on that card account | equal amount; 3 days either side; merchant words match |
| Equal and opposite lines in two of your accounts | a transfer | 3 days either side |
| Anything | a bank rule (`ledger.bank_rules`: "description contains X" gives account, vendor, memo) | the rule only prefills "Create from this line" |

Confirming a set of payments makes the deposit document (4.4) in the same step; a gap the person types as a fee becomes the deposit's fee line. A line with
nothing behind it offers "Create from this line": a payment, a bill payment, an expense, a transfer or a journal entry, prefilled from the line. "Not ours" (a
bank error) needs a note. Unmatched lines dated in a month block its close (4.11).

**Reconcile.** `ledger.reconciliations`: per bank account and statement end date, the statement's ending balance. Ledger shows the cleared balance (opening plus
every matched line through the date), and the difference must be 0 to finish. Finished reconciliations are kept with the matched line ids and are reopened only
by an admin while the month is open.

### 4.10 Earned vs billed, and accruals for work not billed yet

Pulse's rule stays: profit uses earned revenue, and invoices never change profit (Pulse 4.8). Ledger is where billed and collected live.

- **Without Pulse**, the close offers a manual accrual entry with auto reverse.
- **With Pulse**, at close Ledger asks Pulse (`getEarnedBilled`, 9.4) for each job, and each client's rows with no job, the earned and billed amounts **through
  the last day of the month**, counting only billed rows on the same scope as earned (Pulse's "Warehouse billing, cost not tracked in Pulse" lines are left out
  on both sides). `gap = earned - billed`.
- **Only positive gaps are booked** (call): work done ahead of billing. A negative gap (billed ahead of the work) is listed in the close as "Billed ahead of the
  work" for a person to look at, never booked as deferred revenue.
- The accrual is one entry per month (`ledger.accruals` keeps the lines by client and job), Dr 1150, Cr 4950, and an automatic reversal dated the first day of
  the next month. Each month's accrual is the full gap at that month end, so reversals keep it from piling up.

Example: Apex Threads earned $12,500.00 and was billed $9,000.00 through October 31. The accrual books `350000` on Oct 31 and reverses on Nov 1.

### 4.11 Month-end close, period lock and reopen (proposed P1)

`ledger.periods`: one row per calendar month in the org time zone. Months close in order, and only the latest closed month can be reopened, as in Programs
(`docs/programs/SPEC.md` 2.2.13), so the closed months are always one unbroken run.

**Checklist** (`/close/[month]`). Each step is `done`, `blocked`, `warning` or `n/a`. Blocked steps must clear. Warnings need the closer to tick "I checked
this", which is stored with their name.

| Key | Step | Blocks |
|-|-|-|
| `bank_matched` | Every bank and card account is matched through the month end, nothing unmatched dated in the month, each reconciled to a statement dated on or after the month end | yes |
| `invoices_sent` | No draft invoices or credit notes dated in the month (send, redate or delete) | yes |
| `bills_entered` | No draft bills dated in the month | yes |
| `expenses_done` | No submitted expenses waiting for approval dated in the month | yes |
| `wms_billed` | (with WMS) approved WMS bills with a period end in the month that are on no invoice | warning |
| `pulse_checks` | (with Pulse) Pulse's own close checks for the month (`getCloseReadiness`, 9.4): entries needing a rate, days with units and no hours, services with no price, days not reviewed, programs not settled or still syncing. Programs not settled blocks, as it does in Pulse. The payroll check is shown. | as Pulse |
| `accrual` | The accrual for the month is reviewed (4.10) | yes, needs a tick |
| `payroll_booked` | A payroll journal is dated in the month | warning |
| `sync_clear` | (with QuickBooks) nothing pending or failed dated in the month, and the totals match (8.6) | yes |
| custom | `ledger.close_tasks` made from the org's template (`close_task_templates`): title, owner, due day of the next month. Each is ticked by its owner. | yes |

**Close** (`period:close`) runs in one transaction: lock the period row (`FOR UPDATE`), re check every blocking step, post the accrual and its reversal, store
the snapshot (trial balance, profit and loss, balance sheet, AR and AP aging as of the month end) and the checklist, set `status = 'closed'`, and, when the org
has Pulse, call `lockMonthForLedger(tx, who, month)` from `@kitstak/pulse-bridge` in the **same transaction** (9.4). Then it enqueues the accrual entries for
sync and writes `period.closed`. If any step fails nothing is closed.

**Lock.** A closed month refuses, in the domain layer first and then in the database (`BEFORE INSERT OR UPDATE OR DELETE` triggers, checking the `NEW` and `OLD`
dates): new journal entries, and any change to the money fields of a document dated in it (header amounts, dates, customer or vendor, and every line row).
Derived fields on a header stay writable, so a November payment can still mark an October invoice paid (`applied_cents`, `balance_cents`, `status`, reminder and
dispute fields). Imports, sync writes and recurring runs that would land in a closed month are refused and counted as "Came in after the month was closed",
never an error.

**Reopen** (`period:reopen`, owner): a reason is required, it is logged with the reason, it reopens the Pulse month when Ledger closed it
(`reopenMonthForLedger`), and it leaves the posted accrual in place (the next close posts a new one after reversing the old one). A closed month shows its saved
snapshot with a lock icon.

**Pulse side.** While an org has Ledger, Pulse's own Close button reads "Close the month in Ledger" and deep links there, and its Reopen reads "Reopen in
Ledger" for months Ledger closed. Without Ledger, Pulse closes on its own exactly as today.

### 4.12 Audit trail

`ledger.activity` is append only (`BEFORE UPDATE` raises; `DELETE` only for org cascade, purge and the 7 year retention), and is written in the same transaction
as every change: actor, actor kind (`user`, `system`, `integration`, `automation`, `customer` for public link views), verb, entity, before, after, meta. Verbs
include `invoice.created|edited|sent|resent|viewed|voided`, `credit_note.issued`, `payment.recorded|applied|unapplied|refunded`, `writeoff.posted|reversed`,
`dispute.opened|resolved`, `promise.made|kept|missed`, `reminder.sent`, `bill.created|approved|sent_back|scheduled|paid|voided`,
`expense.submitted|approved|rejected|paid`, `bank.imported|matched|unmatched`, `reconcile.finished|reopened`, `journal.posted|reversed`,
`period.closed|reopened`, `sync.pushed|failed|conflict|resolved`, `import.committed|undone`, `export.run`, `role.changed`, `settings.changed`, `data.purged`.
Every journal entry points at its document and its activity row, so each number on a report can be walked back to who did what and when.

### 4.13 Reports

`/reports/[slug]`, each with filters in the URL, print view and CSV: Profit and loss (month, quarter, year, compare), Balance sheet (as of a date; current year
earnings computed, prior years shown in Retained earnings), Trial balance, General ledger detail, AR aging summary and detail, AP aging summary and detail,
Customer statement (per customer, PDF), Sales tax collected (by rate and month), Vendor totals for 1099 (vendors with `vendor_profiles.tracks_1099`, payments by
calendar year), Cash in and out, Earned vs billed (with Pulse), Unmatched bank lines, Close pack (the month's snapshot), Audit log. Ledger produces the reports;
filing stays with the shop's accountant.

## 5. Data model (`ledger` schema)

House rules (as Pulse 5):

- uuid PK `gen_random_uuid()`; `org_id uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE` on every table and in every query; `created_at`,
  `updated_at timestamptz NOT NULL DEFAULT now()`; enums are `text` plus CHECK mirrored in Drizzle.
- Hand written SQL in `apps/ledger/drizzle/0000_ledger_init.sql` with statement breakpoints, mirrored in `src/server/db/schema/*.ts`. Never `drizzle-kit push`.
- **No cross org pointers.** Every table has `UNIQUE (org_id, id)`, and every FK between `ledger` tables is the composite
  `(org_id, x_id) REFERENCES ledger.parent(org_id, id)`. FKs to `core.customers` and `core.vendors` are plain (`ON DELETE RESTRICT`) and the domain checks the
  org on every write; a trigger on the money tables refuses a `customer_id` or `vendor_id` whose `org_id` differs.
- User columns (`*_by`, `owner_id`, `approver_id`, `submitted_by`) reference `core."user"(id) ON DELETE SET NULL`.
- **R13, the database guard** (Pulse CONTRACTS 12 rule 13, copied from day one): RLS on every table with one policy `ledger_org_isolation` on
  `org_id = current_setting('ledger.org_id')::uuid`; with `LEDGER_DB_GUARD=1` every statement runs as the plain role `ledger_app` with the workspace set.
  `asSystem(reason, fn)` is the only way around it, for the same list of reasons as Pulse plus the sync worker and the public invoice page lookup.
  `db-guard.test.ts` lists every allowed caller.
- **SD** = soft delete `deleted_at` (drafts only; posted documents are never deleted, they are voided). **V** = `version int NOT NULL DEFAULT 1`, bumped on
  every update; a stale version gets "Someone else changed this. Here is the new one."
- **SRC** columns on documents:
  `source text NOT NULL DEFAULT 'manual' CHECK (IN ('manual','csv','wms','pulse','program','recurring','crew','qbo','system','sample'))`, `source_ref text`,
  `import_batch_id uuid`, `is_sample boolean NOT NULL DEFAULT false`, `created_by`, `updated_by`, and a partial unique
  `(org_id, source, source_ref) WHERE source_ref IS NOT NULL AND deleted_at IS NULL`.
- **Money columns** are `bigint` with the 4.2 bounds; every document header stores its totals and a CHECK ties them: `total_cents = subtotal_cents + tax_cents`
  on invoices, and line sums are checked by the deferred trigger that also checks the journal.

### 5.1 Shared: `core.vendors` (owned by `@kitstak/db`, `packages/db/drizzle/0012_core_vendors.sql`)

The decided shape, so Ledger and Crew name the same row:

```
core.vendors(
  id uuid pk, org_id uuid not null, name text not null,
  kinds text[] not null default '{}'   CHECK each in ('supplier','carrier','temp_agency','landlord','utility','service','other'),
  email text, phone text, address jsonb, notes text,
  external_refs jsonb not null default '{}'   (for example {"qbo_vendor_id": "58"}),
  archived_at timestamptz, created_at, updated_at
)
unique (org_id, lower(name)) where archived_at is null
```

The migration also carries the core house columns of BLUEPRINT 2.2 (`created_by`, `updated_by`, `version`, `deleted_at`), a not blank CHECK on `name`, a GIN
index on `kinds`, the guarded FK to `core.organization` and RLS on with no policies. Mirrored in `packages/db/src/schema/core/vendors.ts`. Ledger keeps its own
per vendor money settings in `ledger.vendor_profiles`; Crew keeps agency settings in its own schema. Any app may add a vendor; nobody hard deletes one;
archiving keeps history. Ledger writes `external_refs.qbo_vendor_id` only through `@kitstak/db`'s vendor repo, which merges keys and never drops another app's
key.

### 5.2 Setup tables

**`ledger.settings`** (PK `org_id`, made on first read): `currency text DEFAULT 'USD'`, `timezone text NOT NULL`,
`working_days smallint[] DEFAULT '{1,2,3,4,5}'`, `fiscal_year_start_month smallint DEFAULT 1`, `company_name`, `company_address jsonb`, `logo_attachment_id`,
`remit_text text`, `default_terms_id`, `default_member_role text DEFAULT 'none' CHECK (IN ('none','submitter'))`, `separate_approval boolean DEFAULT true`,
`auto_approve_below_cents bigint`, `write_off_limit_cents bigint DEFAULT 50000`, `receipt_required_above_cents bigint DEFAULT 2500`,
`price_tolerance_bp int DEFAULT 200`, `agency_hours_tolerance numeric(6,2) DEFAULT 0.50`, `promise_grace_days smallint DEFAULT 2`,
`reminders_enabled boolean DEFAULT true`, `reminder_from_name text`, `wms_auto_draft boolean DEFAULT false`, `wms_show_detail_page boolean DEFAULT true`,
`opening_date date` (null until set, 7.2), `books_mode text DEFAULT 'sync' CHECK (IN ('sync','books_of_record'))` (D1; only `sync` is offered until books of
record ships), `onboarding jsonb DEFAULT '{}'`, `sample_loaded_at`.

**`ledger.member_roles`**: `user_id uuid NOT NULL`, `role text CHECK (IN ('owner','admin','bookkeeper','approver','viewer','submitter','none'))`,
`can_approve_bills boolean NOT NULL DEFAULT false` (the bookkeeper switch), `sees_balances boolean NOT NULL DEFAULT false`, `updated_by`. Unique
`(org_id, user_id)`.

**`ledger.accounts`** (SD by `archived_at`): `number text NOT NULL`, `name text NOT NULL`,
`type text CHECK (IN ('asset','liability','equity','revenue','expense'))`,
`subtype text CHECK (IN ('bank','card','undeposited','receivable','unbilled','other_current','fixed','payable','sales_tax','payroll','equity','revenue','cost_of_service','expense','other'))`,
`system_key text`, `parent_id`, `description`,
`pulse_cost_category text CHECK (IN ('freight','packaging','equipment','outside_service','rework','supplies','storage','rent','utilities','salaried_staff','insurance','other'))`
(null = never sent to Pulse), `external_refs jsonb DEFAULT '{}'` (`qbo_account_id`), `archived_at`, V. Unique live `(org_id, number)`; unique
`(org_id, system_key) WHERE system_key IS NOT NULL`. CHECK a system account is never archived (trigger).

**`ledger.items`** (what you invoice for): `code`, `name`, `description`, `unit_label`, `default_price numeric(14,4)`, `account_id NOT NULL` (revenue),
`tax_rate_id`, `active`, `external_refs` (`qbo_item_id`), V. Unique live `(org_id, lower(code))`.

**`ledger.source_mappings`**: how sibling rows become lines. `source text CHECK (IN ('wms_operation','pulse_service','program_fee_kind','pulse_job_type'))`,
`key text` (for example `Storage`, `per_order`), `item_id NOT NULL`. Unique `(org_id, source, key)`. Seeded for the six WMS operation types (Receiving, Storage,
Pick and Pack, Shipment, Work Order, VAS) and the Programs fee kinds.

**`ledger.tax_rates`**: `name`, `rate_millionths int NOT NULL CHECK (BETWEEN 0 AND 250000)`, `account_id NOT NULL`, `agency`, `active`, `archived_at`,
`external_refs`. A trigger refuses a change to `rate_millionths` once a line uses the rate.

**`ledger.terms`**: `name`, `kind CHECK (IN ('due_on_receipt','net_days','day_of_next_month'))`, `days smallint`, `day_of_month smallint`, `is_default`,
`active`, `external_refs` (`qbo_term_id`). At most one live default.

**`ledger.number_sequences`** (PK `org_id, doc_type`): `doc_type CHECK (IN ('invoice','credit_note','journal','bill','payment','expense'))`, `prefix text`,
`next_value bigint NOT NULL`, `pad smallint DEFAULT 0`.

**`ledger.customer_profiles`** (PK `org_id, customer_id`, `customer_id REFERENCES core.customers`): `billing_contact_name`,
`billing_emails text[] NOT NULL DEFAULT '{}'`, `billing_address jsonb`, `terms_id`, `default_tax_rate_id`, `tax_exempt boolean DEFAULT false`, `exemption_note`,
`reminders_enabled boolean DEFAULT true`, `collections_owner_id`, `crm_account_item_id uuid` (no FK; CRM may be absent), `external_refs` (`qbo_customer_id`),
`notes`, V. Ledger may create `core.customers` rows (code and name) for a standalone shop, through `@kitstak/db`'s customer repo, and never deletes one (call:
Pulse does not create customers; Ledger must, to work alone).

**`ledger.vendor_profiles`** (PK `org_id, vendor_id`, `vendor_id REFERENCES core.vendors`): `terms_id`, `default_account_id`, `default_approver_id`,
`auto_approve boolean DEFAULT false`, `tracks_1099 boolean DEFAULT false`, `w9_on_file boolean DEFAULT false` (Ledger stores no tax id; call),
`remit_address jsonb`, `notes`, V.

**`ledger.program_billing`**: `program_id uuid NOT NULL` (a `pm.projects` row of kind program; no FK), `customer_id`, `cadence CHECK (IN ('weekly','monthly'))`,
`weekday smallint`, `next_period_start date`, `active`. Unique `(org_id, program_id)`.

### 5.3 Money owed to you

**`ledger.invoices`** (SD drafts, SRC, V): `kind CHECK (IN ('invoice','credit_note'))`, `number text`, `status` (4.5.1, CHECK pairs kind and status),
`customer_id NOT NULL`, `issue_date date NOT NULL`, `due_date date`, `terms_id`, `po_number`, `memo` (on the PDF), `internal_note`, `currency`,
`subtotal_cents`, `tax_cents`, `total_cents`, `applied_cents DEFAULT 0`, `credited_cents DEFAULT 0`, `written_off_cents DEFAULT 0`, `balance_cents`,
`credit_for_invoice_id`, `recurring_invoice_id`, `reminders_enabled boolean DEFAULT true`, `sent_at`, `sent_by`, `send_count int DEFAULT 0`, `voided_at`,
`voided_by`, `void_reason`, `posting_seq int DEFAULT 0`, `last_entry_id`. CHECK `number IS NOT NULL OR status = 'draft'`; CHECK
`balance_cents = total_cents - applied_cents - credited_cents - written_off_cents`. Unique live `(org_id, kind, lower(number))`. Indexes `(org_id, status)`,
`(org_id, customer_id, status)`, `(org_id, due_date) WHERE status IN ('sent','partially_paid')`, `(org_id, issue_date)`.

**`ledger.invoice_lines`**: `invoice_id NOT NULL` (CASCADE for drafts only; posted lines are locked by trigger), `position`, `item_id`, `description`,
`quantity`, `unit_price`, `amount_cents`, `account_id NOT NULL`, `tax_rate_id`, `rate_millionths int`, `tax_cents DEFAULT 0`, `pulse_job_id uuid`,
`service_date`, `amount_from_source boolean DEFAULT false`. CHECK `tax_rate_id IS NULL = (rate_millionths IS NULL)`. Index `(org_id, invoice_id, position)`,
`(org_id, pulse_job_id)`.

**`ledger.invoice_sources`**: `invoice_id`, `invoice_line_id`, `source_type` (4.5.10), `source_ref text NOT NULL`, `meta jsonb` (WMS bill number, period,
program key). Partial unique `(org_id, source_type, source_ref) WHERE active` (`active` is cleared when the invoice is voided or the draft deleted).

**`ledger.recurring_invoices`** and **`ledger.recurring_invoice_lines`**: as 4.5.9. Index `(next_run_date) WHERE active`.

**`ledger.payments`** (SRC, V): `kind CHECK (IN ('received','refund'))`, `number`, `customer_id NOT NULL`, `received_on date NOT NULL`,
`method CHECK (IN ('check','ach','wire','card','cash','other'))`, `reference`, `amount_cents CHECK (> 0)`, `deposit_to_account_id NOT NULL` (undeposited or a
bank), `unapplied_cents`, `deposit_id`, `external_ref` (room for pay links, P3), `memo`, `posting_seq`, `last_entry_id`. Index
`(org_id, customer_id, received_on)`, `(org_id, deposit_id)`.

**`ledger.payment_applications`**: `payment_id` or `credit_note_id` (CHECK exactly one), `invoice_id NOT NULL`, `amount_cents CHECK (> 0)`,
`applied_on date NOT NULL`, `removed_at`, `removed_by`. Index `(org_id, invoice_id)`.

**`ledger.deposits`**: `bank_account_id`, `deposited_on`, `total_cents`, `fee_cents DEFAULT 0`, `fee_account_id`, `bank_line_id`, `memo`.

**`ledger.write_offs`**, **`ledger.disputes`**, **`ledger.promises`**: as 4.5.7, 4.6.4, 4.6.3.

**`ledger.reminder_rules`**: `offset_days int NOT NULL`, `repeat_every_days int` (null = once), `max_count smallint`, `subject`, `body` (plain text with
`{customer}`, `{invoices}`, `{link}` fields), `active`. **`ledger.reminder_sends`**: `invoice_id`, `rule_offset int`, `sent_on date`, `email_id`. Unique
`(invoice_id, rule_offset, sent_on)`.

**`ledger.public_links`**: `invoice_id`, `token_hash text UNIQUE`, `token_prefix`, `expires_at`, `last_viewed_at`, `revoked_at`.

**`ledger.emails`**: every invoice, reminder and statement email: `kind`, `to text[]`, `subject`, `entity_type`, `entity_id`, `dedupe_key UNIQUE`,
`provider_id`, `status CHECK (IN ('queued','sent','failed'))`, `error`, `sent_at`.

### 5.4 Money you owe

**`ledger.bills`** (SD drafts, SRC, V): `kind CHECK (IN ('bill','vendor_credit'))`, `number`, `vendor_id NOT NULL`, `vendor_ref`, `bill_date date NOT NULL`,
`due_date`, `terms_id`, `status` (4.7.1), `total_cents`, `paid_cents DEFAULT 0`, `credited_cents DEFAULT 0`, `balance_cents`, `approver_id`,
`approval_requested_at`, `approved_at`, `approved_by`, `sent_back_note`, `pay_on date`, `memo`, `agency_week_start date`, `billed_hours numeric(10,2)`,
`checks jsonb DEFAULT '{}'` (`receipt`, `agency`), `voided_at`, `void_reason`, `posting_seq`, `last_entry_id`. Unique live
`(org_id, vendor_id, lower(vendor_ref)) WHERE vendor_ref IS NOT NULL`. Indexes `(org_id, status)`, `(org_id, vendor_id)`,
`(org_id, due_date) WHERE status IN ('approved','scheduled')`, `(org_id, approver_id, status)`.

**`ledger.bill_lines`**: `bill_id`, `position`, `description`, `account_id NOT NULL`, `quantity`, `unit_price`, `unit_label`, `amount_cents`, `customer_id`,
`pulse_job_id`, `wms_po_code`, `wms_po_line_id`.

**`ledger.bill_payments`** and **`ledger.bill_payment_applications`**: as 4.7.1. Applications CHECK `amount_cents > 0`.

### 5.5 Expenses

**`ledger.expenses`** (SD drafts, SRC, V) and **`ledger.expense_lines`**: as 4.8. Index `(org_id, submitted_by, status)`, `(org_id, spent_on)`. CHECK the lines
sum to `amount_cents` (deferred trigger).

### 5.6 Bank

**`ledger.bank_accounts`**: as 4.9, `account_id NOT NULL` unique per org, `currency`, `opening_balance_cents`, `opening_date`. **`ledger.bank_imports`**:
`bank_account_id`, `file_name`, `file_hash`, `format CHECK (IN ('csv','ofx'))`, `line_count`, `new_count`, `duplicate_count`, `statement_end_date`,
`statement_end_balance_cents`, `created_by`. **`ledger.bank_lines`**: `bank_account_id`, `import_id`, `posted_on date NOT NULL`, `amount_cents NOT NULL` (money
in positive), `description`, `check_number`, `fitid`, `dedupe_key NOT NULL`, `status CHECK (IN ('unmatched','matched','not_ours'))`, `note`. Unique
`(org_id, bank_account_id, dedupe_key)`. Index `(org_id, bank_account_id, posted_on)`, `(org_id, status) WHERE status = 'unmatched'`. **`ledger.bank_matches`**:
`bank_line_id`, `entity_type CHECK (IN ('payment','deposit','bill_payment','expense','reimbursement_payment','refund','transfer','journal_entry'))`,
`entity_id`, `amount_cents`, `confirmed_by`, `confirmed_at`, `removed_at`. A deferred trigger checks live matches sum to the line amount.
**`ledger.bank_rules`**: `bank_account_id` (null = all), `contains text NOT NULL`, `account_id`, `vendor_id`, `memo`, `position`, `active`.
**`ledger.transfers`**: `from_account_id`, `to_account_id`, `transferred_on`, `amount_cents CHECK (> 0)`, `memo`, `last_entry_id`. **`ledger.reconciliations`**:
`bank_account_id`, `statement_end_date`, `statement_end_balance_cents`, `cleared_cents`, `status CHECK (IN ('in_progress','finished'))`, `finished_by`,
`finished_at`, `matched_line_ids uuid[]`. Unique `(org_id, bank_account_id, statement_end_date)`.

### 5.7 Books, close and system

**`ledger.journal_entries`** (append only): `number` (`JE-`), `entry_date date NOT NULL`, `period_month date NOT NULL` (first of month, set by trigger),
`source_type CHECK (IN ('invoice','credit_note','payment','refund','application','write_off','deposit','bill','vendor_credit','bill_payment','expense','reimbursement','reimbursement_payment','transfer','accrual','accrual_reversal','manual','opening','payroll'))`,
`source_id uuid`, `posting_seq int NOT NULL`, `reverses_entry_id`, `auto_reverse_on date`, `memo`, `posted_by`, `posted_at`, `is_sample`. Unique
`(org_id, source_type, source_id, posting_seq)`. Indexes `(org_id, entry_date)`, `(org_id, period_month)`. **`ledger.journal_lines`** (append only):
`entry_id NOT NULL`, `line_no`, `account_id NOT NULL`, `debit_cents bigint NOT NULL DEFAULT 0`, `credit_cents bigint NOT NULL DEFAULT 0`, CHECK
`(debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0)`, `customer_id`, `vendor_id`, `invoice_id`, `bill_id`, `pulse_job_id`,
`tax_rate_id`, `memo`, `entry_date` and `period_month` (copied for fast reports). Indexes `(org_id, account_id, entry_date)`,
`(org_id, customer_id) WHERE customer_id IS NOT NULL`, `(org_id, vendor_id) WHERE vendor_id IS NOT NULL`, `(org_id, entry_id)`.
**`ledger.account_month_totals`** (PK `org_id, account_id, period_month`): `debit_cents`, `credit_cents`, kept in the posting transaction; a test proves it
equals the sum of `journal_lines`. Reports read it; drill downs read lines.

**`ledger.periods`**: `period_month date NOT NULL`, `status CHECK (IN ('open','closed'))`, `closed_at`, `closed_by`, `reopened_at`, `reopened_by`,
`reopen_reason`, `checklist jsonb`, `snapshot jsonb`, `pulse_locked boolean DEFAULT false`. Unique `(org_id, period_month)`; CHECK
`reopened_at IS NULL OR reopen_reason IS NOT NULL`. **`ledger.close_task_templates`** (`title`, `owner_id`, `due_day smallint`, `position`, `active`) and
**`ledger.close_tasks`** (`period_month`, `template_id`, `title`, `owner_id`, `due_date`, `done_at`, `done_by`, `pm_task_id`). **`ledger.accruals`**:
`period_month`, `entry_id`, `reversal_entry_id`, `total_cents`, `lines jsonb` (`[{customerId, pulseJobId, earnedCents, billedCents, gapCents}]`),
`source CHECK (IN ('pulse','manual'))`.

**`ledger.attachments`**: copied from Projects (`apps/projects/src/server/domain/attachments.ts`): Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, else bytes
in `data bytea`; `entity_type CHECK (IN ('bill','expense','invoice','bank_import','settings'))`, `entity_id`, `name`, `content_type`, `size_bytes` (at most 10
MB; images and PDF only), `storage`, `storage_key`, `uploaded_by`. Downloads always go through `GET /api/v1/attachments/[id]` so access is checked on every
read; a submitter can read only their own expenses' receipts.

**`ledger.activity`** (4.12), **`ledger.notifications`** (`user_id`, `kind`, `params`, `url`, `read_at`), **`ledger.user_prefs`**, **`ledger.import_batches`**,
**`ledger.import_rows`**, **`ledger.import_presets`** (copied from Pulse 5.4 with Ledger's stream list), **`ledger.bridge_events`** (inbox for sibling pushes:
`kind CHECK (IN ('wms_bill_sent','wms_bill_changed','crew_hours_approved','pulse_month_changed'))`, same claim, lease, retry and park rules as Pulse 8).

**Sync tables** (8): **`ledger.sync_connections`** (PK `org_id, provider`): `provider CHECK (IN ('qbo','xero'))`, `realm_id`, `company_name`,
`status CHECK (IN ('connected','needs_reconnect','paused','disconnected'))`, `access_token_enc`, `refresh_token_enc`, `access_expires_at`, `refresh_expires_at`,
`start_date date` (send entries dated on or after), `tax_mode`, `mappings jsonb`, `connected_by`, `last_ok_at`, `last_error`. **`ledger.sync_objects`**:
`provider`, `local_type`, `local_id`, `remote_type`, `remote_id`, `remote_sync_token`, `local_version int`, `pushed_hash text`,
`status CHECK (IN ('synced','pending','failed','conflict','skipped'))`, `last_pushed_at`, `last_error`. Unique `(org_id, provider, local_type, local_id)`;
unique `(org_id, provider, remote_type, remote_id)`. **`ledger.sync_queue`** (outbox): `provider`, `local_type`, `local_id`,
`op CHECK (IN ('upsert','void','delete'))`, `doc_date`, `attempts int DEFAULT 0`, `next_try_at`, `claimed_until`, `parked_at`, `last_error`. Unique
`(org_id, provider, local_type, local_id) WHERE parked_at IS NULL` (bursts collapse). **`ledger.sync_runs`**: counts and errors per run.
**`ledger.remote_changes`**: documents made or changed in QuickBooks that Ledger saw (8.5): `remote_type`, `remote_id`, `seen_at`,
`kind CHECK (IN ('made_in_remote','changed_in_remote','deleted_in_remote'))`, `status CHECK (IN ('open','brought_in','ignored','resolved'))`, `payload jsonb`.

**Retention** (daily cleanup): import raw rows cleared after the 7 day undo window; read notifications 90 days; `sync_runs` 30 days; processed bridge events 7
days (failed 30); `emails` 2 years; `activity`, journal and documents 7 years, then dropped by month only under purge rules.

## 6. Product surface (every route is real, working and persisted)

Shell: copied from Pulse: one top bar, no sidebar. The bar holds the logo, the navigation, search, the org switcher, the primary button **New invoice**,
notifications, help, the app switcher, the theme toggle and the account menu. Navigation, seven links and one menu: Home · Invoices · Collections (badge:
overdue count) · Bills (badge: waiting for you) · Expenses · Bank (badge: unmatched lines) · Close · **More** (Customers, Vendors, Payments, Journal, Reports,
Import and export, Settings). Approvers see Bills and Expenses only and land on Bills. Submitters see Expenses only and land on `/expenses`. A filter bar (date
range, customer or vendor, status) lives in the URL query on every list.

| Route | What is on it |
|-|-|
| `/` **Money home** | The two line answer: "Customers owe you $84,210. $21,400 of it is past due. You owe $18,350 in bills, $6,200 due this week." Tiles: money owed to you, past due, bills due in 7 days, cash in the bank (Ledger's balance of each bank account, with the date it was last matched), work done not billed yet (with Pulse). AR aging bar by bucket. Cash in and out chart by week. **Needs you**: invoices to send, bills waiting for your approval, promises missed, disputes open, unmatched bank lines, sync problems, close tasks due. Setup checklist until done (10). No money right: the approval queue and their own expenses only. |
| `/invoices` | Tabs **Open** (sent and part paid, overdue first), **Drafts**, **Paid**, **Credit notes**, **All**. Columns: number, customer, issue date, due date, days past due, total, balance, status pill, source chip (WMS, Pulse, Program, Recurring). Search, saved filters, bulk send, bulk download PDFs, CSV export of the view. "From WMS: 6 approved bills not on an invoice" banner when WMS is connected. |
| `/invoices/new` | Customer picker (search `core.customers`; "Add a customer" inline), dates and terms, lines grid (item, description, quantity, price, amount, tax rate, account under "More"), memo, PO number, live totals. `?from=wms`: pick approved WMS bills (by client and period) not yet invoiced; one draft per bill, lines from its consolidated rows, read only amounts with "From WMS" marks. `?from=pulse`: the Ready to bill list for a customer, one line per job for its not billed yet amount (editable down, never up past it). `?from=program`: the program's period with per unit and fee lines (9.5). `?copy=<id>`. Save draft, Preview PDF, Send. |
| `/invoices/[ref]` | `ref` is the number or the id. Header: number, customer, status pill, total, balance, due, days past due. Actions by status: Send, Resend, Record payment, Credit a line, Write off, Open a dispute, Add a promise to pay, Void, Download PDF, Copy link. Lines with dispute marks. Payments and credits applied. Timeline (sent, viewed, reminders, payments, edits with before and after). Sources (links back to the WMS bill, the Pulse job, the program). Sync status chip when QuickBooks is connected. Drafts edit in place. |
| `/invoices/recurring`, `/invoices/recurring/[id]` | Templates list with next run date; template editor; past drafts it made. |
| `/collections` | AR aging table by customer: Current, 1 to 30, 31 to 60, 61 to 90, Over 90, In dispute, Credits, Total, oldest invoice, last reminder, promise. As of date picker. Click a cell to see its invoices. **Follow up queue**: past due customers worst first, with "Send a reminder now", "Add a promise", "Make a task" (Projects), "Call notes". |
| `/customers`, `/customers/[id]` | List with balance, past due, terms. Customer page: contact and billing emails, terms, tax exempt, reminders on or off, collections owner; open invoices; payments; credits; statement PDF and "Email statement"; links to the CRM account, WMS client and Pulse client. |
| `/payments`, `/payments/new`, `/payments/[id]` | Payments received and refunds; tab **Deposits**. Record payment: customer, date, method, reference, amount, deposit to, then an apply grid of open invoices with the suggested split (4.6.5); unapplied amount shown. |
| `/bills` | Tabs **Waiting for approval** (mine first), **To pay** (approved and scheduled, by due date), **Drafts**, **Paid**, **All**. Columns: number, vendor, vendor ref, bill date, due, total, balance, status, flags (receipt match, agency hours). |
| `/bills/new`, `/bills/[ref]` | Drop a photo or PDF of the bill on the left, fill vendor, vendor ref, dates, terms and lines on the right (account, job or client tag, PO line for a receipt match). Agency bills show week and billed hours with the Crew check. Approve, Send back, Schedule, Record payment, Void. Timeline. |
| `/bills/pay` | Pay run: approved bills by pay date, pick a bank account, running total against Ledger's bank balance, record payments in one step (one bill payment per vendor per day). |
| `/vendors`, `/vendors/[id]` | `core.vendors` list with kinds, balance, 1099 flag. Vendor page: contact, kinds, terms, default account and approver, auto approve, 1099 and W 9 switches, open bills, payments, totals by year, and for temp agencies the hours check history. |
| `/expenses`, `/expenses/new`, `/expenses/[id]` | Mine, Waiting for approval, All (by right). Camera first on phones. Approve, Reject with a note, Pay reimbursements (pick several, one bank payment). |
| `/bank` | Each bank and card account: Ledger balance, last statement balance and date, unmatched count. Import a statement. |
| `/bank/[accountId]` | Lines with suggested matches side by side; Confirm, Pick another, Create from this line, Not ours. Filters: unmatched, matched, date. Rules editor. |
| `/bank/[accountId]/reconcile` | Statement end date and balance; cleared balance; difference; finish when 0. Past reconciliations. |
| `/journal`, `/journal/new`, `/journal/[number]` | Every entry with its lines, source link and who posted it. New manual entry (`journal:post`): balanced lines grid, auto reverse date, memo. Reverse an entry. Debit and credit words appear only here, in the chart and in reports. |
| `/reports`, `/reports/[slug]` | The list in 4.13. |
| `/close`, `/close/[month]` | Months with status, snapshot figures and lock icons. Month page: the checklist (4.11) with each step's link to the fix, the accrual review, the Pulse step, the QuickBooks step, custom tasks with owners and due dates, Close, Reopen with reason. |
| `/settings` | General (company, address, logo, time zone, working days, remit text), People and roles (role, approve bills switch, sees balances, "Who handles money here?"), Chart of accounts (`/settings/accounts`), Items (`/settings/items`), Tax rates (`/settings/tax`), Terms, Numbering (`/settings/numbering`), Reminders (`/settings/reminders`: offsets, wording, preview), Approvals (separate approval, auto approve, write off limit, tolerances), Close checklist template, Accounting tool (`/settings/accounting`: QuickBooks connect, mapping, start date, sync status, problems, send again, disconnect), Connected apps (`/settings/apps`: WMS, Pulse, Projects, CRM, Crew, Portal: status, what flows, last sync, mappings for WMS operation types), Sample data, Audit log (`/settings/audit`), How Ledger does the math. |
| `/import`, `/import/new`, `/import/[batchId]`, `/export` | Pulse's import center and export page with Ledger's streams (7). |
| `/welcome` | First run: claim (3.2), "Who handles money here?", time zone, then "How do you want to start?": load sample data, bring in open invoices and bills from your current tool (7.2), connect QuickBooks, or send a first invoice. Then the setup checklist (10). |
| `/i/[token]` | Public invoice page for the customer (4.5.8): no login, no shell, the invoice, its PDF, payment instructions. Later: Pay now (P3). |
| `/search`, Cmd+K | Go to any page; find invoices by number, customers, vendors, bills; actions (New invoice, Record payment, New bill, New expense, Import a statement, Close month, open sibling apps). Shortcuts: `g h`, `g i`, `g c`, `g b`, `n` new invoice, `/` search, `?` shortcut sheet. |
| `/login`, `/forgot-password`, `/no-workspace`, locked | House auth pages with a Ledger preview panel. Locked: the preview sentence (3.1) before launch; after launch, a link to `portal/billing?module=ledger`. |

Cross cutting: empty states that teach; the Ledger loader on long actions (send, import check, statement import, close, sync); error states with retry;
optimistic saves with undo where nothing posts (drafts), and a confirm step on everything that posts ("Send INV-1042 for $15,985.66 to
ap@harborroast.example?"); responsive from 360 px; keyboard reachable with visible focus; status never color only; light and dark through tokens;
`tabular-nums`; `prefers-reduced-motion` respected; user text escaped in pages, PDFs and emails.

`src/proxy.ts` public list: auth pages, `/api/health`, `/i/*`, `/api/v1/public/*`, `/api/v1/cron/*`, `/api/v1/webhooks/qbo`.

## 7. CSV in and out

Engine: Pulse 7 copied (`src/lib/csv.ts`, browser parse in a worker, chunks of 500 to `POST /api/v1/import/[batchId]/rows`, server revalidation from raw
strings, header aliases, presets, dates, money with `$`, commas and `(45.00)` negatives, check step with new, changed, unchanged, looks the same, skipped and
error, all or nothing or skip bad rows, error report CSV, undo for 7 days, formula guard, CRLF with BOM, file names `ledger-<stream>-<org>-<from>-to-<to>.csv`).
Two Ledger rules on top:

- **Posted things are never changed by an import.** A row that matches a posted document reads "unchanged" or "already posted, change it in Ledger", never
  "changed". Imports make drafts (`invoices`, `bills`) or post only the migration streams in 7.2.
- **Header aliases include QuickBooks' own export columns** (A/R Aging Detail, Unpaid Bills, Trial Balance, Customer and Vendor contact lists), so a shop can
  export from QuickBooks and import without retyping headers.

### 7.1 Streams (`*` = needed)

| Stream (file) | Columns | Row match |
|-|-|-|
| **Customers** `customers.csv` | `customer_code*`, `name*`, `billing_contact`, `billing_emails` (comma list in quotes), `phone`, `billing_address_1`, `city`, `state`, `postal_code`, `country`, `terms`, `tax_exempt`, `tax_rate`, `reminders`, `notes` | `customer_code`, else name |
| **Vendors** `vendors.csv` | `name*`, `kinds` (comma list), `email`, `phone`, address columns, `terms`, `default_account`, `tracks_1099`, `w9_on_file`, `notes` | name |
| **Items** `items.csv` | `item_code*`, `name*`, `description`, `unit_label`, `default_price`, `account_number*`, `tax_rate` | `item_code` |
| **Chart of accounts** `accounts.csv` | `account_number*`, `name*`, `type*`, `subtype`, `parent_number`, `description`, `pulse_cost_category` | `account_number` |
| **Tax rates** `tax_rates.csv` | `name*`, `rate_pct*` (to 4 decimals, 8.25), `account_number`, `agency` | name |
| **Open invoices** `open_invoices.csv` | `invoice_number*`, `customer_code*`, `issue_date*`, `due_date*`, `total*`, `balance*`, `po_number`, `memo` | `invoice_number` |
| **Open bills** `open_bills.csv` | `vendor*`, `vendor_ref`, `bill_date*`, `due_date*`, `total*`, `balance*`, `memo` | `(vendor, vendor_ref)`, else look alike on `(vendor, bill_date, total)` |
| **Opening balances** `opening_balances.csv` | `account_number*`, `debit`, `credit` (one of them), `as_of*` (one date for the file) | `account_number` |
| **Draft invoices** `invoices.csv` | `invoice_ref*` (groups lines), `customer_code*`, `issue_date*`, `terms`, `po_number`, `item_code`, `description`, `quantity*`, `unit_price*`, `tax_rate`, `job_number` | `invoice_ref` plus line number |
| **Draft bills** `bills.csv` | `bill_ref*`, `vendor*`, `vendor_ref`, `bill_date*`, `due_date`, `account_number*`, `description`, `amount*`, `customer_code`, `job_number` | `bill_ref` plus line number |
| **Payments received** `payments.csv` | `payment_ref`, `customer_code*`, `received_on*`, `method`, `reference`, `amount*`, `apply_to_invoice`, `apply_amount` | `payment_ref`, else look alike on `(customer, received_on, amount, reference)` |
| **Expenses** `expenses.csv` | `expense_ref`, `spent_on*`, `kind*`, `paid_from_account`, `merchant`, `account_number*`, `amount*`, `customer_code`, `job_number`, `memo` | `expense_ref`, else look alike |
| **Bank lines** (CSV or OFX) | `date*`, `description*`, `amount*` or `money_in` and `money_out`, `balance`, `check_number`, `fitid` | dedupe key (4.9) |
| **Payroll journal** `payroll_journal.csv` | `pay_date*`, `account_number*`, `debit`, `credit`, `memo`, `pay_run_ref*` | `pay_run_ref` (one balanced entry per run) |

Exports: every stream above in the same columns (setup streams round trip: export then import reads all unchanged), plus invoices with lines, credit notes,
payments with applications, bills with lines, bill payments, expenses with lines, journal entries with lines, bank lines with match status, every report, the
audit log, and "Download everything" (one zip, streamed). Money columns drop for readers without the right (3.3). Every export writes `export.run`. HTTP:
`GET /api/v1/export/<stream>.csv?from&to&...` and `GET /api/v1/reports/<slug>.csv`.

### 7.2 Migration from QuickBooks or a spreadsheet (the opening)

Order, guided on `/welcome` and `/import`: 1 pick the **opening date** (the day before the first day Ledger runs; its month and every month before it are closed
as "Before Ledger", and cannot be reopened); 2 chart of accounts (or keep the default); 3 customers and vendors; 4 opening balances (a trial balance as of the
opening date, every account except Money owed to you and Bills to pay); 5 open invoices; 6 open bills. Checks before commit: the trial balance balances; open
invoice balances sum to the old books' AR (typed from the old trial balance) and open bills to its AP, to the cent, or the screen says by how much and does not
commit. Open invoices keep their own number, issue and due dates for aging, and post on the opening date against Opening balances (4.4). With QuickBooks
connected, these opening entries are marked as already in QuickBooks and never sent (8.3).

## 8. Accounting sync: QuickBooks Online first

### 8.1 Provider interface (`src/server/sync/provider.ts`)

```ts
interface AccountingProvider {
  readonly id: 'qbo' | 'xero';
  authorizeUrl(state: string): string;
  exchangeCode(code: string, realmId: string): Promise<Tokens>;
  refresh(conn: Connection): Promise<Tokens>;
  listAccounts(conn): Promise<RemoteAccount[]>;
  listCustomers(conn, query): Promise<RemoteParty[]>;  listVendors(conn, query): Promise<RemoteParty[]>;
  push(conn, doc: SyncDoc, remote: RemoteRef | null, requestId: string): Promise<RemoteRef>;   // create or update
  voidDoc(conn, type, remote: RemoteRef, requestId): Promise<RemoteRef>;
  fetchChanges(conn, since: string, types): Promise<RemoteChange[]>;                         // change data capture
  trialBalance(conn, from: string, to: string): Promise<RemoteTrialBalance>;
}
```

`SyncDoc` is a provider neutral DTO built from Ledger rows by `src/server/sync/docs.ts` (one builder per local type). `qbo.ts` maps it to QuickBooks objects;
`xero.ts` comes later and implements the same interface. Nothing outside `src/server/sync/providers/*` knows a provider's field names.

### 8.2 Connect and map

- OAuth 2.0 from `/settings/accounting` (`sync:manage`). Tokens are encrypted with AES-256-GCM under `LEDGER_INTEGRATION_KEY` and never leave the server. Access
  tokens refresh before expiry; a failed refresh sets `needs_reconnect`, pauses the queue, and shows a banner to people with `sync:manage`.
- **Mapping wizard** (runs once, can be edited): accounts (each Ledger account matched to a QuickBooks account by number, then name; or "Create it in
  QuickBooks"); terms; tax approach (8.4); customers and vendors (matched by name, then email; unmatched ones are created on first push); start date (default
  the first open month; nothing dated before it is sent, because it is already in QuickBooks).
- QuickBooks needs a display name unique across customers, vendors and employees. When a vendor's name equals a customer's, the vendor is sent as "Name
  (vendor)" and the mapping screen says so.

### 8.3 Mapping (Ledger to QuickBooks Online)

| Ledger | QuickBooks Online object | Notes |
|-|-|-|
| `core.customers` + `customer_profiles` | Customer | `DisplayName`, billing email, terms, tax exempt. Remote id in `customer_profiles.external_refs.qbo_customer_id`. |
| `core.vendors` + `vendor_profiles` | Vendor | `Vendor1099` from `tracks_1099`. Remote id in `core.vendors.external_refs.qbo_vendor_id`. |
| `ledger.accounts` | Account (mapped, or created with the matching `AccountType` and `AccountSubType`) | |
| `ledger.items` | Item, type Service, `IncomeAccountRef` = the item's account | |
| `ledger.terms` | Term | |
| Invoice | Invoice | `DocNumber` = Ledger number, `TxnDate`, `DueDate`, `SalesTermRef`, one `SalesItemLineDetail` per line. A line whose quantity times price is not its amount (WMS lines) goes as quantity 1 at the amount, with "412 x $18.5000" in the description. Tax lines per 8.4. |
| Credit note | CreditMemo | applications sent as a zero amount Payment linking the CreditMemo and the Invoice |
| Payment received | Payment | `LinkedTxn` per application, `DepositToAccountRef` = Undeposited Funds or the bank; unapplied part stays as the customer's credit |
| Refund | RefundReceipt | |
| Deposit | Deposit | `LinkedTxn` to the payments, plus the fee line |
| Write off | CreditMemo on an item "Bad debt" mapped to the bad debt account, applied with a zero amount Payment | |
| Bill, vendor credit | Bill, VendorCredit | `DocNumber` = `vendor_ref`, `AccountBasedExpenseLineDetail` per line; job or client tags go as the line's `CustomerRef` (billable off) |
| Bill payment | BillPayment | `PayType` Check or CreditCard |
| Card or bank expense | Purchase | `PaymentType` CreditCard or Cash |
| Reimbursement, its payment | JournalEntry | |
| Transfer | Transfer | |
| Accrual, reversal, manual, payroll | JournalEntry | |
| Opening entries, imported open invoices and bills | not sent | they already exist in QuickBooks (7.2); their remote ids can be matched by number in the wizard so later payments link to them |
| Bank matches, reconciliations | not sent | the QuickBooks API cannot mark items cleared; stated in the honest gaps |

Each pushed document carries the same amount per account as its Ledger journal entry. A test builds every document type, maps it, and checks that the QuickBooks
lines sum per account to the journal lines.

### 8.4 Sales tax in QuickBooks

QuickBooks US companies use automated sales tax, which would recompute Ledger's tax. So Ledger sends every line as non taxable and sends tax as its own line per
rate on an item "Sales tax: <rate name>" whose account is that rate's liability account (call). If the QuickBooks sandbox refuses a liability account on a
service item, the fallback, chosen in Phase 8, is: tax lines on an income account "Sales tax clearing", plus one JournalEntry per invoice moving it to the
liability. Both keep QuickBooks totals equal to Ledger's.

### 8.5 Idempotency, order, conflicts, failures and re sync

- **Outbox.** Posting a document (or voiding it) upserts a `sync_queue` row in the same transaction. The worker runs on each cron tick and in `after()` right
  after a post, claims rows with `FOR UPDATE SKIP LOCKED` and a 5 minute lease, in dependency order: accounts, items, terms, customers and vendors, then
  documents by date, then payments, deposits and applications.
- **Idempotency.** Each push sends `requestid = sha256(org, local_type, local_id, local_version)`; QuickBooks answers a repeated request id with the first
  result, so a retry after a timeout never makes two. `sync_objects` stores the remote id and `SyncToken`; a document with a remote id is always an update,
  never a create. `pushed_hash` is the hash of the fields Ledger owns, so an unchanged document is not sent again.
- **Rate limits.** The QuickBooks provider keeps under the published per company limits (requests a minute and requests at once), stated as constants in
  `qbo.ts`, and backs off on 429.
- **Conflicts.** Ledger owns what it makes. A webhook (`/api/v1/webhooks/qbo`, signature checked with `QBO_WEBHOOK_VERIFIER`) or the change data capture poll
  (every 30 minutes) records QuickBooks changes in `remote_changes`. A Ledger made document changed in QuickBooks becomes a `conflict`: it is not overwritten,
  and `/settings/accounting` shows both versions with **Send Ledger's version** or **Keep QuickBooks and stop syncing this one** (the second is logged and
  listed in the close). A stale `SyncToken` error refetches, and only becomes a conflict when the fields Ledger owns differ.
- **Made in QuickBooks.** Invoices, bills, payments and expenses made in QuickBooks after the start date are listed as "Made in QuickBooks, not in Ledger" with
  **Bring into Ledger** (makes the Ledger document, posts it, links the remote id, sends nothing) or **Ignore**. This keeps the bank matching whole while a team
  gets used to entering things in Ledger.
- **Failures.** Retries at 1, 5, 15 and 60 minutes, then every 6 hours; the 8th failure parks the row with its error in plain words ("QuickBooks says the
  October books are closed there. Ask your accountant, or send it with a November date."). Parked and conflict rows block the `sync_clear` close step for their
  month and show on Home under Needs you.
- **Re sync.** "Send again" per document, per month, or everything from the start date: re pushes using stored remote ids, creating only what is missing.
  **Disconnect** keeps the mappings; reconnecting to the same company resumes. Connecting a different company is refused unless the owner types the company name
  to "Start fresh with this company", which clears remote ids for that provider.

### 8.6 Parity check

At close (and on demand) Ledger asks QuickBooks for its trial balance for the month (`trialBalance`) and compares each mapped account's movement with
`account_month_totals`. Equal to the cent passes `sync_clear`; a difference lists the accounts and amounts and links each to the documents in that account for
the month.

### 8.7 Books of record later

`settings.books_mode = 'books_of_record'` (not offered until built) stops the sync, keeps the remote ids, and turns on what option B needs: statements as the
official reports, accountant access, and year end. Because every posting is already double entry with an audit trail, the switch adds features and changes no
table.

## 9. Integrations and `@kitstak/ledger-bridge`

Ground rules, as Pulse 8: readers check entitlement (or, before launch, the preview gate for Ledger and the sibling's entitlement for the sibling), table
existence (`to_regclass`, cached) and for WMS the tenant schema (`findWmsTenantSchema`), and return `{ available: false, reason }` instead of throwing. Ledger
never writes into `crm.*`, `wms.*`, `pm.*` or `pulse.*`, with the two decided exceptions: Pulse month lock and reopen through `@kitstak/pulse-bridge` (4.11),
and Projects tasks through `@kitstak/pm-bridge`. Sibling apps read Ledger only through `@kitstak/ledger-bridge` on their own servers. Links store paths, never
hosts.

### 9.1 `@kitstak/ledger-bridge` (new package)

Raw SQL over the host's executor, peer dep `drizzle-orm`, plain JSON DTOs, `./types` for client components. Reads never throw and return empty when `ledger` is
absent. Every read takes `{ orgId, userId }` and resolves access with `resolveLedgerAccess`: AR amounts need `money:read` or `sees_balances`, AP amounts need
`ap:read`, else they are `null` with `moneyHidden: true`.

```ts
LEDGER_STATUS_LABELS
ledgerAvailability(db)                                            // to_regclass('ledger.invoices'), cached 60 s
resolveLedgerAccess(db, { orgId, userId })                        // { role, rights, seesBalances }
getCustomerBalance(db, who, { coreCustomerId? , crmAccountItemId? })
                                                                  // { balanceCents, pastDueCents, inDisputeCents, openCount,
                                                                  //   oldestOpen: { number, dueDate, daysPastDue } | null, promise }
getCustomerBalances(db, who, { coreCustomerIds })                 // batched, for list columns
listOpenInvoices(db, who, { coreCustomerId, limit })              // number, dates, total, balance, status
getInvoiceForSource(db, who, { type: 'wms_bill' | 'pulse_job' | 'program', id })   // invoice number, status, path, or null
getMoneyTiles(db, who)                                            // owed to you, past due, bills due in 7 days, bills past due
getAttentionCount(db, who)                                        // approvals waiting, promises missed, sync problems: switcher badge
getSetupSignals(db, orgId)                                        // onboarding (10)
feedForPulse(db, { orgId, since })                                // system read for Pulse's sync (9.4)
emitLedgerEvent(db, { orgId }, { kind, targetId, payload })       // writes ledger.bridge_events: the only sibling write into ledger
ledgerUrls(base).invoice(ref) .newInvoiceFrom({ source, id }) .customer(coreCustomerId) .bill(ref) .close(month) .collections()
```

`emitLedgerEvent` is called inside sibling write transactions, so it can never hurt them: a no op when `to_regclass('ledger.bridge_events')` is null (cached),
its own savepoint, errors swallowed and logged, upsert on the pending key so bursts collapse.

### 9.2 Shared rules for every source

A sibling row becomes an invoice line, never a payment. The sibling stays the source of truth for its amount. `invoice_sources` stops double invoicing (4.5.10).
When the sibling row changes after a draft was made, the draft is rebuilt; after the invoice is sent, Ledger flags it ("WMS changed bill B-2041 after INV-1042
was sent. Credit or invoice the difference.") and changes nothing on its own.

### 9.3 WMS

**Ledger reads** (tenant schema, text ids, float dollars converted in SQL with `round(x::numeric * 100)::bigint`): `billing_reports` with
`bill_status = 'Approved'` and `calc_status = 'Successful'`, their `billing_report_lines` (consolidated rows, `is_detail = false`, become invoice lines:
`fee_name` as the description, `adjusted_price` as the amount, `operation_type` through `source_mappings` to an item and account; detail rows feed the optional
detail page), the client (`client_id` = `core.customers.id`), `period_start`, `period_end` and `bill_number`. Also `purchase_orders`, `purchase_order_lines` and
`receipts` for the bill match (4.7.2).

**Draft from a bill**: one draft invoice per approved WMS bill, issue date = the bill's period end (call), `source_ref = wms:bill:<id>`, each line
`wms:line:<lineId>`. `settings.wms_auto_draft` (default off) makes drafts on the cron tick for every newly approved bill.

**WMS side (proposed P2)**: the bill detail and the billing reports list gain **Send to Ledger** next to "Export to integration", for approved bills, permission
`settings.billing_report.approve`, visible only when Ledger is available. It calls `emitLedgerEvent('wms_bill_sent')` inside the WMS transaction; Ledger drafts
the invoice on its next request or tick. The bill detail shows "On invoice INV-1042 · Sent" from `getInvoiceForSource`. WMS keeps its own export, and Ledger
never edits a WMS amount: lines from WMS are read only in Ledger except description, account and tax. A canceled WMS bill (`wms_bill_changed`) removes its
draft, or flags a sent invoice for a credit. No WMS migration: the state lives in Ledger. Files: `apps/wms/src/server/ledger/{bridge,routes}.ts`,
`src/app/api/billing-reports/[id]/ledger/route.ts`, `src/components/ledger/send-to-ledger-button.tsx`.

### 9.4 Pulse

**Ledger reads** (through new `@kitstak/pulse-bridge` functions): `getReadyToBill(db, who, { coreCustomerId?, asOf })` (jobs and client level rows with earned,
billed and not billed yet), `getEarnedBilled(db, who, { through })` for the accrual (4.10), and `getCloseReadiness(db, who, { month })` (the counts of Pulse's
`getCloseChecklist` and the programs check). Ledger writes only `lockMonthForLedger(tx, who, { month })` and `reopenMonthForLedger(tx, who, { month, reason })`,
which run inside Ledger's transaction, set `pulse.periods` to closed (or open) with `closed_via = 'ledger'`, `snapshot_pending = true`, and write Pulse's
activity row. The lock takes effect at once through Pulse's existing trigger; Pulse fills its own snapshot on its next request or tick, from data that can no
longer change.

**Pulse reads Ledger** (Pulse sync source `ledger`, through `feedForPulse`, idempotent upserts, closed months skipped and counted). After each post Ledger calls
Pulse's `emitBridgeEvent('ledger_doc_changed')`, so the change shows in Pulse on its next page load:

| Ledger row | Becomes in Pulse | Rule |
|-|-|-|
| Sent invoice line with a `pulse_job_id`, or a customer that is a Pulse client | `pulse.revenue_entries`, `kind = 'invoice'` (billed memo, never profit), `source = 'ledger'`, `source_ref = ledger:line:<lineId>`, date = issue date, amount = line amount without tax | void removes it in open months; lines that came from a WMS bill carry its operation type as `service_label`, so Pulse's warehouse billing rule (Pulse 4.8) still applies |
| Credit note line | the same, negative | |
| Approved bill line or expense line tagged to a job or a client, on an account with a `pulse_cost_category` | `pulse.cost_entries`, scope job or client, that category | labor accounts have no category and are never sent: Pulse costs labor from hours, so wages or agency bills would count twice |
| Approved bill or expense line with no tag, on an account with a category in the company list (rent, utilities, equipment, salaried staff, insurance, other) | `pulse.cost_entries`, scope company | Pulse lists a Things to fix item when a hand typed company cost has the same month and category ("Rent for November is typed in Pulse and also came from Ledger") |

**Billed from one place.** Once Ledger sends its first invoice for an org, Pulse sets `settings.billed_source = 'ledger'`: WMS bill rows stop coming in as
billed memo, and WMS billed rows in open months are soft deleted, so a WMS bill and its Ledger invoice are never both counted. Closed months keep what they had.
A Pulse customer with no Pulse client gets one made from `core.customers`, as the WMS sync does.

**Pulse UI**: Ready to bill gains **Create invoice** (opens `ledger/invoices/new?from=pulse&customer=<coreCustomerId>`) beside its CSV; the job and client Money
in tabs show invoice numbers as links; the close screen changes per 4.11. A job whose program bills through a `bills_to` edge is refused from the Pulse source:
"This job bills through program GLOVE. Invoice it from the program."

### 9.5 Projects and Programs

- **Programs**: `ledger.program_billing` sets a cadence per program (weekly or monthly). For each period Ledger reads, through `@kitstak/pm-bridge`, the
  program's per unit revenue (`pm.build_output`) and posted fees (`pm.program_ledger`) for days in the period (closed or settled days only for a month's minimum
  top up, which posts after the month ends, Programs A5), and drafts one invoice: one line per variant (units x the snapshot price, amount as stamped) and one
  per fee row, each with its stable ref (`pmb:<buildId>:<date>`, the ledger `ref`) in `invoice_sources`. Lines carry the program's `bills_to` Pulse job, so
  Pulse billed rises for that job.
- **Tasks**: collections follow ups (promise missed, "Make a task") and close tasks become Projects tasks through `createTaskFromExternal` with link type
  `ledger_invoice` or `ledger_close_task`, an owner and a due date, never an amount. Needs the new link target types in Projects (migration in 9.8).
- **Projects shows**: nothing with money. A task linked to Ledger shows a chip that opens the invoice or the close.

### 9.6 CRM

- **Ledger reads**: account name, billing contact email and payment terms. Terms come from a won deal's or the account's `payment_terms` column when the board
  has one and its text parses ("Net 30", "Due on receipt"); else nothing. The customer link is `crm.customer_links`; a CRM account with no `core.customers` row
  can be turned into one from the Ledger customer picker (it makes the `core.customers` row and the link, the same way WMS does).
- **CRM shows** (CRM server routes over the bridge): an item panel **Money** tab on account items (balance, past due, oldest open invoice and days past due,
  open invoices list, promise, "Open in Ledger"), a header line ("Owes $12,400 · 34 days past due"), and a balance column option on account boards. People
  without the right see "34 days past due · 3 open invoices" with no amount. A CRM automation trigger "An account is past due by N days" reads the bridge on
  CRM's own cron, so a collections board or automation can start from it. Files: `apps/crm/src/server/services/ledger-bridge.ts`,
  `src/app/api/v1/crm/items/[itemId]/ledger/route.ts`, `src/features/item-panel/ledger/*`.

### 9.7 Crew (when Crew exists), Portal and the shell

- **Crew**: Ledger reads approved hours per agency and week (4.7.3). Crew's `crew_hours_approved` event refreshes the check on open agency bills for that week.
  Agencies are `core.vendors` rows with kind `temp_agency`, so Crew and Ledger name the same company. Ledger books the payroll journal that comes back from the
  payroll provider (7.1); Crew exports hours, Ledger never runs payroll.
- **Portal**: launcher tile "KitStak Ledger", tagline "Bill it. Pay it. Close it.", icon `AppIcon app="ledger"`, stats from `getMoneyTiles`; home tiles **Money
  owed to you** and **Bills due**, each hidden without its right; setup steps (10); command palette entries; and after launch the billing copy. Before launch
  everything here is behind `previewAccess('ledger', ...)`.
- **App switcher** (`packages/ui/src/app-switcher`): `AppSwitcherAppId` gains `ledger`, `urls.ledger`, `entitled.ledger`, `badges.ledger`, row
  `{ id: 'ledger', name: 'KitStak Ledger', descriptor: 'Invoices, bills and month close' }`. `AppIcon` already has `ledger`.

### 9.8 Sibling changes (each in its own app's migration stream)

| App | Change |
|-|-|
| `@kitstak/db` | `0012_core_vendors.sql` (5.1). At launch only: a migration widening `entitlements_module_check` to add `ledger`. |
| Pulse | `apps/pulse/drizzle/00NN_ledger_feed.sql`: `'ledger'` added to the `source` CHECK of the stream tables and to `sync_state.source`; `bridge_events.kind` gains `ledger_doc_changed`; `settings.billed_source text DEFAULT 'wms' CHECK (IN ('wms','ledger'))`; `periods.closed_via text DEFAULT 'pulse' CHECK (IN ('pulse','ledger'))` and `periods.snapshot_pending boolean DEFAULT false`. Bridge functions in 9.4. |
| Projects | `apps/projects/drizzle/00NN_ledger_links.sql`: `ledger_invoice` and `ledger_close_task` added to the target type CHECKs of `pm.integration_links` and `pm.integration_events`, plus `INTEGRATION_TARGET_TYPES`, link paths and icons. |
| WMS | code only (9.3), no migration. |
| CRM | code only (9.6). |
| `@kitstak/mail` | optional `attachments` on `MailMessage` (4.5.8). |
| Every sibling | `NEXT_PUBLIC_LEDGER_URL`, port 3700 in `TRUSTED_ORIGINS`, `KITSTAK_PREVIEW_ORGS` until launch; `deploy/push-env.mjs` gains `URL_LEDGER` and `PROJECT_LEDGER`; root `package.json` `dev:ledger`; `.claude/launch.json`; `docs/DEPLOYMENT.md` gains the Ledger RLS role check and the migrate order. |

### 9.9 Ledger HTTP API (`/api/v1`) and deep links

Same origin only, no CORS. Writes check session, gate, right, `assertSafeOrigin` and `Content-Type: application/json`. Money hidden by right on every route.
Endpoints: `GET /api/health`; `GET /api/v1/me`; `GET /api/v1/summary` (home); `GET /api/v1/invoices`, `/invoices/[ref]`, `/invoices/[ref]/pdf`;
`GET /api/v1/aging?asOf`; `GET /api/v1/bills`, `/bills/[ref]`; `GET /api/v1/bank/[accountId]/lines`; `POST /api/v1/bank/[accountId]/import` (chunked rows, like
imports); `POST /api/v1/import/[batchId]/rows`; `GET /api/v1/attachments/[id]`; `GET /api/v1/export/<stream>.csv`, `/api/v1/reports/<slug>.csv`;
`GET /api/v1/public/invoices/[token]` and `/pdf` (public, rate limited); `GET /api/v1/oauth/qbo/callback`; `POST /api/v1/webhooks/qbo`; `GET /api/v1/cron/tick`,
`/cron/cleanup`. Everything else is server actions. Deep links in: `/invoices/<number or id>`, `/invoices/new?from=wms&bill=<id>`,
`?from=pulse&customer=<coreCustomerId>`, `?from=program&program=<id>&period=<YYYY-MM-DD>`, `/customers/by-link?coreCustomerId=` or `?crmAccountItemId=`,
`/bills/<ref>`, `/close/<YYYY-MM>`, any page `?setup=<step key>`. Unknown ids land on a helpful not found page.

## 10. Onboarding contract (`docs/integration/ONBOARDING.md`)

Ledger steps follow the contract exactly (done beats skipped beats locked beats ready; celebration only when all are done; `?setup=<key>` callout on arrival).
They appear in the Portal guide only for orgs that pass the gate (before launch) or are entitled (after), after the CRM, WMS, Projects and Pulse steps. Skips
are stored under scope `portal`. The counts come from `getSetupSignals` in `@kitstak/ledger-bridge`, guarded by `to_regclass('ledger.invoices')`; a failed read
gives `null` and the step renders as to do. At launch the rows below are added to the ONBOARDING.md tables.

| key | title | requires | done when | deep link |
|-|-|-|-|-|
| `ledger_customer` | Add a customer to invoice | none | a `ledger.customer_profiles` row exists, or any `core.customers` row has a billing email in Ledger | Ledger `/customers` |
| `ledger_first_invoice` | Send your first invoice | `ledger_customer` | a live invoice with `status <> 'draft'` and `is_sample = false` | Ledger `/invoices/new` |
| `ledger_first_bill` | Enter a bill | none | a live bill with `is_sample = false` | Ledger `/bills/new` |
| `ledger_bank` | Bring in a bank statement | none | a `ledger.bank_imports` row exists | Ledger `/bank` |
| `ledger_books` | Connect QuickBooks Online | none | a `ledger.sync_connections` row with status `connected` | Ledger `/settings/accounting` |

Ledger's own `/welcome` checklist shows the same five steps with the same rules, plus "Bring in open invoices and bills" when the org picked that start.

## 11. Seed data plan (`pnpm -F kitstak-ledger db:seed <org-slug>`, idempotent)

Wipe the org's `ledger` rows under `ledger.allow_purge`, then rebuild through the domain layer (every document posts through `posting.ts`), so the seed proves
the posting rules. Dates are relative to the seed day (day 0); numbers come from a seeded random generator. Order: 1 setup (chart, items, tax rates, terms,
mappings, roles), 2 vendors and customers, 3 opening date 120 days ago with opening balances, 4 invoices, payments and credits, 5 bills and payments, 6
expenses, 7 a bank statement, 8 close every full month older than last month, leave last month open and ready to close, 9 print row counts and the checks (trial
balance balances, aging equals AR, AP aging equals AP, `account_month_totals` equals the lines).

**WMS fixtures.** The WMS demo data has no approved bills today, so the WMS fixtures (`apps/wms` `db:fixtures`, owned by the WMS seed, not Ledger) gain a
billing contract per active client and one approved bill per client for last month, with Receiving, Storage, Pick and Pack, Shipment and Work Order lines
(call). Ledger never writes WMS, in the seed or anywhere.

| | `kitstak` (WMS, Pulse, Projects) | `northwind-robotics` (CRM, Projects, Pulse) | `ledger-only` (nothing else) |
|-|-|-|-|
| Gate | in `KITSTAK_PREVIEW_ORGS` for e2e | not in the list (proves the locked screen under enforcement) | in the list |
| Customers | the 8 `core.customers` (Apex Threads, NovaForge Electronics, Copperline Coffee, Bluebird & Main, Voltbyte Labs, Summit Trail Gear, Harbor Roast Collective, Pixel & Pine inactive) with billing emails and terms | 6 CRM accounts with won deals, turned into customers through the picker | 4 typed customers |
| Invoices | last month: one per active client from its approved WMS bill (7 invoices), plus 4 from Pulse Ready to bill and 2 from a program (GLOVE, monthly); 3 earlier months of the same shape; 2 recurring templates (monthly storage minimum, a flat account fee) | 30 typed and Pulse sourced invoices over 4 months | 12 typed invoices, 1 recurring |
| Collections story | INV-1042 Harbor Roast: storage line in dispute, the rest part paid; Bluebird & Main paid half of one; Summit Trail 43 days past due with a missed promise; Pixel & Pine over 90 days with one write off proposal above the limit (waits for an admin); Apex Threads paid early; a credit note for Copperline applied to its next invoice; an unapplied payment from Voltbyte | same shapes with northwind names | one in each aging bucket |
| Vendors | Ridgeway Packaging (supplier), Northstar Staffing (temp agency), Bluewater Freight (carrier), Maple Industrial Properties (landlord), City Power and Light (utility), Clearline Waste (service) | 5 of the same kinds | 3 |
| Bills | 4 months: weekly Northstar bills (one billed 412 hours against Crew's 396 when Crew exists; else the check reads "Connect Crew"), monthly rent and power, freight per week, packaging with one bill matched to a WMS purchase order and over by 40 units; 3 waiting for approval, 2 scheduled, 1 vendor credit | similar | 10 |
| Expenses | 25 card expenses (8 tagged to Pulse jobs), 4 reimbursements (1 waiting), receipts as small generated images | 15 | 6 |
| Bank | Checking and the company card: a last month statement as CSV (about 60 lines) and OFX (card): deposits that match payment sets, one deposit with a card fee, bill payments by check, card charges for the expenses, one rent payment, a transfer to pay the card, 3 lines with nothing behind them (a bank fee with a rule, a refund to check, a charge with no receipt) | CSV only | CSV only |
| Close | months older than last month closed (with Pulse locked through Ledger); last month open with the accrual from Pulse ready and the 3 unmatched lines blocking | same | months closed without Pulse; manual accrual once |
| Roles | admin@kitstak.io owner, finance bookkeeper, ops.manager approver, cs.team viewer, j.okafor submitter, everyone else none (proves floor roles see nothing) | maya owner, daniel admin, aisha bookkeeper, ethan approver | one owner, one bookkeeper |
| QuickBooks | not connected (Phase 8 tests use the sandbox) | | |

"Load sample data" in the app uses a smaller set (3 customers, 6 invoices, 4 bills, 1 statement) flagged `is_sample`, and "Clear sample data" removes exactly
those rows and their journal entries under purge rules.

## 12. Brand pack

- **Icon**: `AppIcon app="ledger"` in `packages/ui/src/app-icon/app-icon.tsx`: a T, the red bar `[46, 50, 108, 26]` over the pink stem `[87, 87, 26, 63]` on the
  200 x 200 artboard, `offsetY: 0`. Source file `apps/web/public/brand/apps/kitstak-icon-ledger.svg`. Copy it to `apps/ledger/public/brand/`, make
  `src/app/icon.svg`, `icon.png`, `apple-icon.png`, PNG exports at 512 and 1024, the top bar mark, the Portal tile and `MARKS.ledger`, and the CRM, WMS and
  Pulse inline `LedgerMark`.
- **Loader**: `apps/web/public/brand/loaders/kitstak-loader-ledger.svg` (the bar opens, then the stem drops; stops for reduced motion), copied to
  `apps/ledger/public/brand/` and used in every `loading.tsx`, full page loads and long actions through `src/components/brand-loader.tsx`
  (`<img src="/brand/kitstak-loader-ledger.svg" width="64" height="64" alt="Loading">`). The KitStak company loader stays for sign in and cross app handoff.
- Colors Red `#C8102E`, Pink `#D65A6E`, Navy `#0A1628`, Cream `#F5F1E8`. Wordmark `KITSTAK LEDGER` in Bebas Neue from `@kitstak/ui`. UI text on token fonts.
  Status uses the success, warning and danger tokens with an icon and a word; overdue is never red alone. Brand red is for the mark and primary actions.
- Invoice PDF: the shop's logo and name lead; a small "Sent with KitStak Ledger" line at the foot (call, can be turned off in Settings).

## 13. Build phases

Each phase ends with typecheck, lint and tests green, the seed running clean, and its e2e flows passing at 1440 and 390 wide, light and dark. A phase does not
start until the one before is done.

| Phase | Builds | Definition of done |
|-|-|-|
| **0. Scaffold** | `apps/ledger` copied from Pulse's shell (auth, session, org switcher, theme, app switcher, command palette, error pages, health, CSP, proxy), the preview gate (3.1) and locked screen, roles and rights (3.2, 3.3) with the claim step, `0000_ledger_init.sql` with every table in 5, all triggers (balanced, append only, closed month, org guard) and RLS, `core.vendors` in place, the default chart of accounts, terms, numbering and settings made on first read, nav with every route rendering a real empty state, `posting.ts` with its unit tests, `@kitstak/ledger-bridge` skeleton (availability, preview, access), app switcher row, brand pack, seed step 1. | Sign in at :3700 as each seed role; a non preview org sees the locked screen with enforcement on; every route loads with no console error; the migration chain on an empty database passes; the balanced and append only triggers are proven by DB tests; a submitter and a none role see what 3.2 says. |
| **1. Customers and vendors** | Customers on `core.customers` with `customer_profiles`, vendors on `core.vendors` with `vendor_profiles`, items, tax rates, terms, source mappings, Settings pages for each, CSV for customers, vendors, items, accounts and tax rates. | Round trip for the five setup streams; a vendor added in Ledger is visible to Crew's reader (or a test reader); archive keeps history; unique names enforced. |
| **2. Invoices and posting** | Drafts, lines, tax, send (number, post, PDF, email with attachment and view link), mark as sent, edit while open and unpaid, void, credit notes, recurring templates and their drafts, `/i/[token]`, invoice list and detail, Journal screen, trial balance report, `@kitstak/mail` attachments. | The INV-1042 worked example is a unit test and a DB test; every posting rule for invoices and credit notes balances; numbers have no gaps across a failed send; a sent invoice in a closed month refuses edit and void; a recurring run twice makes one draft. |
| **3. Collections** | Payments with the apply grid, unapplied credits, refunds, deposits, write offs with the limit, disputes, promises, reminders on the cron tick, aging as of any date, customer statements, the Collections page. | Aging equals AR for every as of date in a property test; a reminder is never sent twice for the same offset; a promise pauses and resumes reminders; disputes lower the undisputed balance only. |
| **4. Bills and payments** | Bills with photos, approval queue, separate approval rule, auto approve, duplicates check, vendor credits, schedule, pay run, bill payments, AP aging, WMS purchase order match (when WMS). | Approve vs pay rule proven with two approvers and with one; AP aging equals AP; an approver never receives an invoice field; the receipt match flags the seed's over billed line. |
| **5. Expenses** | Card expenses and reimbursements, camera first form, receipt rule, split lines, approval, reimbursement payouts, attachments storage. | A submitter sees only their own expenses and receipts (API and DOM scan); reimbursement payouts post and clear Owed to people. |
| **6. Bank import and matching** | Bank accounts, CSV and OFX import with dedupe, suggestions per 4.9, confirm, create from line, rules, not ours, deposits from payment sets, reconcile to a statement. | The same file twice adds nothing; the seed statement matches every line but the 3 planned ones; a reconciliation finishes only at a 0 difference; no match is ever confirmed without a person. |
| **7. Close** | Periods, checklist with every step, close tasks and template, manual accrual, close snapshot, lock triggers on documents, reopen with reason, closed month banners, close pack report, profit and loss and balance sheet. | Every document type refuses money changes in a closed month (domain and trigger, OLD and NEW dates) while a later payment still marks an older invoice paid; months close in order and only the latest reopens; the snapshot matches the live reports for a closed month. |
| **8. QuickBooks Online sync** | Provider interface, QBO provider, OAuth, mapping wizard, outbox worker, idempotency, webhook and change data capture, conflicts, made in QuickBooks, failures and parking, re sync, disconnect, parity check, `sync_clear` step, opening entries marked as already there. | Against the QuickBooks sandbox: every document type created, updated and voided once, a forced timeout retried without a duplicate, a change made in QuickBooks becomes a conflict, a document made in QuickBooks can be brought in, the parity check passes for a seeded month; tax approach chosen and proven (8.4). |
| **9. Integrations** | WMS reads, Send to Ledger and bill detail state; Pulse bridge functions, Pulse migration, Pulse feed, `billed_source` switch, Ready to bill button, accrual from Pulse, Pulse checks in the close and the same transaction lock; Programs cadence invoicing; Projects tasks and the Projects migration; CRM Money tab, header line and trigger; Portal tile, home tiles and setup steps; Crew agency check behind availability. | Kitstak seed: a WMS bill sent from WMS becomes a draft with exact amounts; Pulse billed equals Ledger invoices per job with no WMS double count; closing a month in Ledger locks Pulse in the same transaction (a failure in either rolls back both); fail soft for every reader on `ledger-only` and on a database without `crm`, `wms`, `pm`, `pulse`. |
| **10. Polish and proof** | Reports list complete, migration flow (7.2) end to end from QuickBooks export files, import center for every stream, sample data, audit log screen, performance targets, axe scan, copy rules, screenshots for `apps/web/src/components/ledger/ledger-shots.ts`. | All of section 14 green; the site's promises (`ledger-content.ts`, `content/docs/ledger/*`) each map to a working screen in a checklist kept in `apps/ledger/AGENTS.md`. |
| **11. Pay links (after the first release, P3)** | Stripe Connect for the shop's own account, Pay now on `/i/[token]` and in emails, card and ACH payments recorded on webhook, fees on the deposit. | Separate spec section before work starts; KitStak's own Stripe keys are never used. |
| **12. Launch switch** | Move Ledger from `PLANNED_PRODUCTS` into `PRODUCT_IDS` and `CATALOG.products`; add `ledger` to `MODULES` and `ENTITLEMENT_MODULES`; migration widening `core.entitlements.module`, re asserted by a Ledger migration because Ledger migrates last; `pnpm -F @kitstak/billing stripe:setup check`; grant each preview org; switch `orgLedgerAccess` from `previewAccess` to `getModuleAccess` with the plan gate, siblings to `entitled.ledger`, and drop `ledger` from `PREVIEW_APPS`; remove `KITSTAK_PREVIEW_ORGS` from Ledger; seats enforced; ONBOARDING.md rows; fill the screenshot slots; set `LEDGER_IS_LIVE = true` and update `apps/web/src/lib/go-live.test.ts`; rewrite the site docs against the real screens. | The migration chain on an empty database ends with the full module list; a preview org keeps access across the switch; an org without the grant sees the Portal billing link; go live test green. |

## 14. Quality bar and test plan

Typecheck and lint clean, the no dash rule over `src/features`, `src/components`, `src/app`, `src/lib`, seed data, PDF and email text. Every button does
something. No placeholder pages, no TODOs.

**Unit tests (vitest, pure functions in `src/lib`)**: every worked example in 4 with its exact numbers.
- `money`: line amount, tax per line (halves, the 866 example), sums, parse of `$1,234.50` and `(45.00)`, bounds.
- `calc/terms`: each terms kind, day of next month clamped in February, typed due dates.
- `calc/aging`: buckets at their edges (0, 1, 30, 31, 60, 61, 90, 91), as of dates before payments, voids and write offs, the 43 day example.
- `calc/allocation`: the suggested split, disputes skipped, unapplied remainder.
- `calc/reminders`: offsets, working days, one email per customer per day, promises pausing, max count.
- `calc/accrual`: positive gaps only, the Apex example, reversal date.
- `calc/agency`: the 412 vs 396 example, tolerance edge.
- `posting`: one test per row of the 4.4 table, each asserting balanced lines and the right accounts.
- `match`: every candidate rule in 4.9, set matching bounds, tie breaks.
- `ofx`, `csv`: formats, dedupe keys, the same file twice, formula guard. `permissions`: the rights table. `access`: the resolver (org roles, explicit rows, WMS
  and Pulse roles giving none, the claim step). `copy-rules`: no dashes; "billing" never in Ledger UI copy except the sentence that says Ledger is not KitStak's
  billing.

**Money property tests (fast-check style, random sequences over a seeded org)**: after any sequence of draft, send, edit, void, credit, pay, apply, unapply,
refund, write off, approve, pay bill, expense, deposit, transfer, accrual, close and reopen:
1. every posted entry balances, and the sum of all debits equals the sum of all credits;
2. AR equals the sum of open invoice balances minus open credits and unapplied payments; AP likewise;
3. each document's stored totals equal the sum of its stamped lines, and each journal entry's lines equal the document's amounts per account;
4. `account_month_totals` equals the sum of `journal_lines`;
5. no closed month's trial balance changes;
6. no sequence ever leaves a number gap in sent invoices.

**Database tests (local Postgres, throwaway orgs)**: triggers (balanced at commit, append only, closed month on journals and documents with OLD and NEW dates,
derived fields still writable, org guard on customer and vendor ids); org isolation through every domain function and the composite FKs; the RLS guard as
`ledger_app`; money hiding as submitter, approver and a `sees_balances` none role through every route and bridge function; imports (chunked upload, server
revalidation, posted rows never changed, migration totals check); concurrency (two sends of one draft make one number; two payments applied to one invoice never
overpay; outbox lease); the Pulse lock in one transaction (a forced failure on either side rolls back both); fail soft on `ledger-only` and on a second database
`kitstak_ledger_only` with only `@kitstak/db` and Ledger migrations; WMS reads on a throwaway tenant schema made with
`CREATE TABLE ... (LIKE wms.<table> INCLUDING ALL)`, as Pulse does; migration chain on an empty database.

**Sync tests**: the provider mapping per document type against recorded QuickBooks sandbox responses (fixtures), idempotent retries, `SyncToken` conflicts,
webhook signature check, parking, re sync creating only what is missing, per account parity; a live sandbox suite runs in CI only when `QBO_*` secrets are set.

**Playwright (`e2e/`, the three seed orgs, light and dark, 1440 and 390 wide, `ENTITLEMENTS_DEV_ALLOW_ALL=0`)**
1. Sign in; Home shows owed, past due and bills due; Needs you lists the seed's items.
2. Make an invoice by hand with a taxed line, preview, send; the PDF totals match; the view link opens with no login.
3. From WMS: send a bill to Ledger from the WMS bill page; the draft has the exact WMS amounts; send it; WMS shows "On invoice".
4. From Pulse: Create invoice from Ready to bill; Pulse's billed for the job rises; no double count with the WMS bill.
5. Record a payment across two invoices, leave some unapplied, apply it later; deposit it; match the deposit to a bank line.
6. Open a dispute on a line; reminders ask only for the rest; resolve it with a credit note.
7. Enter a bill with a photo as a bookkeeper; approve it as the approver; the bookkeeper cannot approve their own; pay it in a pay run.
8. Submit an expense on a phone viewport with a receipt; approve it; it shows as cost on the Pulse job.
9. Import the seed's CSV and OFX statements; import again and nothing is added; match all but 3; reconcile to 0.
10. Close last month: blocked by the unmatched lines; fix them; close; Pulse's month is locked; editing an invoice in it is refused; reopen with a reason as
    owner.
11. Migration: opening date, trial balance, open invoices and bills from QuickBooks export files; the AR and AP checks pass.
12. A submitter sees only Expenses and no amount anywhere else (scan the DOM for the currency symbol); a WMS floor user has no Ledger access; a CRM salesperson
    without `sees_balances` sees days past due and no amount on the account tab.
13. `northwind-robotics` with enforcement on sees the locked preview screen in Ledger and no Ledger UI in Portal, CRM or the switcher.
14. `ledger-only`: every page loads, no sibling UI shows, no console errors, the claim step and "Who handles money here?" work.
15. Axe scan has no serious issues on Home, Invoices, invoice detail, Collections, Bills, Bank matching, Close.

**Performance** (seed plus a load fixture of 20,000 invoices, 60,000 payments, 10,000 bills, 3 years): Home and Invoices under 400 ms server time; aging as of
any date under 500 ms (reads `journal_lines` by the customer index with the month totals); invoice send round trip under 800 ms before the email; a 5,000 line
statement imports and suggests in under 10 seconds; close of a month under 10 seconds; the sync worker keeps up with 1,000 documents an hour inside QuickBooks'
limits.

**Honest gaps**, stated so nobody oversells: Ledger is not the books of record in the first release (QuickBooks stays the official books); no live bank feed
until a provider is chosen; no pay links until Phase 11; no tax engine, only rates the shop sets; no payroll, no tax filing, no inventory valuation; bank
matches and reconciliations are not sent to QuickBooks, so items there are not marked cleared; one currency per org; calendar months only.

