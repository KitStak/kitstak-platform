# Signup and billing: team contracts

Read `DECISIONS.md` first, then `SPEC.md` for what to build. This file says who owns which files and gives the
exact names, types, routes and table shapes that every lane shares. When SPEC and CONTRACTS disagree on a name
or a type, CONTRACTS wins. When they disagree on what a person sees, SPEC wins.

Copy rule for this file and for all UI copy: plain words, short sentences, no em dash, no double dash. Table
separators in these docs use `|:-|` for that reason. SQL here has no comments for the same reason; add your
comments in the real migration with the block comment form.

Contents: 1 rules, 2 file ownership, 3 package layout, 4 catalog and quote, 5 Stripe mapping, 6 handoff codec,
7 plan state and notices, 8 entitlements changes, 9 database, 10 gateway, 11 server API, 12 webhooks and sync,
13 emails, 14 jobs, 15 auth changes, 16 portal contract, 17 shared UI, 18 product apps, 19 marketing site,
20 lifecycle deliverables, 21 test ids, 22 done checks per lane, 23 list of signatures, 24 changes during build.

## 1. Rules of the road

1. **Build order.** Foundation lands first: package skeleton, catalog, quote, handoff, plan state, migration,
   entitlements changes, auth passthrough, portal glue and the wiring lines in other apps. The other five lanes
   then build at the same time against the signatures in this file.
2. **Cross lane imports are by contract.** If you import a symbol another lane has not written yet, your
   typecheck fails until it lands. Do not stub it, and do not create the file for them. Say so in your report.
3. **One writer per file.** The table in section 2 is exclusive. If you need a change in a file you do not own,
   ask its owner in your report with the exact change. Do not edit, reformat or revert it.
4. **Only foundation changes `package.json` dependency lists and `pnpm-lock.yaml`.** Every dependency any lane
   needs is listed in section 3.3 and is installed by foundation. If you need another one, report it.
5. **No price or amount comes from the browser.** The browser sends a `PlanSelection` (products, seats,
   warehouses, interval). The server recomputes every amount from the catalog and the gateway.
6. **Money is integer cents** in code, in the database and on the wire. Format only at the edge with
   `formatMoney`.
7. **Every mutation is a server action** in the portal (Next checks the origin). The only POST route handlers
   are the two webhooks (signature) and the jobs tick (bearer secret).
8. **Never `drizzle-kit push`.** Never edit an applied migration. Never run `git commit`, `git push`,
   `git checkout`, `git stash` or `git reset` unless your task says you own commits.
9. **Read the Next docs first.** Each app's `AGENTS.md` says this Next version has breaking changes. Read the
   guide in `node_modules/next/dist/docs` for anything you touch (route handlers, server actions, `proxy.ts`,
   `after`, cookies, search params as promises).
10. **Words.** In WMS the word "billing" already means 3PL client billing. In WMS UI call this area "Plan" and
    never add a WMS route named `/billing`.

## 2. File ownership

Paths are from the repo root. A lane may create new files only inside its own paths.

| Lane | Owns (exclusive) |
|:-|:-|
| **foundation** | `packages/billing/**` except the four lifecycle folders below. `packages/db/src/schema/core/billing.ts` and new `packages/db/src/schema/core/billing-*.ts`, the export lines in `packages/db/src/schema/index.ts`, `packages/db/drizzle/0007_core_billing.sql`, `packages/db/drizzle/meta/_journal.json`, `packages/db/drizzle/README.md`. `packages/entitlements/**`. `packages/auth/src/options.ts` and `packages/auth/src/create-auth.ts` (passthrough options in section 15 only). `apps/portal/src/app/api/billing/webhooks/**`. `apps/portal/src/server/billing/**` (glue in section 16.2). `apps/portal/src/server/env.ts`, `apps/portal/.env.example`, `apps/portal/package.json`, `apps/portal/next.config.ts`, `apps/portal/vitest.config.mts`. Wiring only, one time: the `@kitstak/billing` dependency line in `apps/{crm,wms,projects,pulse,web}/package.json`, the `transpilePackages` entry in each of those apps' `next.config.ts`, and `pnpm-lock.yaml`. `docs/integration/BLUEPRINT.md` (a pointer note in section 3 that says docs/billing replaces it). Section 24 of this file. |
| **signup** | `apps/portal/src/app/(auth)/**` (signup, plan step, verify email, forgot and reset password, invite accept, login changes, auth layout and hero). `apps/portal/src/features/signup/**` (new). `apps/portal/src/app/(app)/welcome/**`, `apps/portal/src/features/welcome/**`, `apps/portal/src/features/setup/**`, `apps/portal/src/lib/setup-model.ts` and its test, `apps/portal/src/server/onboarding.ts`, `apps/portal/src/server/onboarding-actions.ts`. `apps/portal/src/server/auth.ts`, new `apps/portal/src/server/signup.ts` and `apps/portal/src/server/signup-actions.ts`. `apps/portal/src/lib/auth-client.ts`, `slug.ts`, `routes.ts` and tests, `password-rules.test.ts`. `apps/portal/src/features/launcher/create-org-form.tsx`. `docs/integration/ONBOARDING.md`. |
| **billing-ui** | `apps/portal/src/app/(app)/billing/**` except `activity/**`. `apps/portal/src/app/test-gateway/**` (test checkout and test card update pages). `apps/portal/src/features/billing/**`, `apps/portal/src/features/test-gateway/**`. `apps/portal/src/server/billing-actions.ts` (new), `apps/portal/src/server/entitlements.ts`, `apps/portal/src/server/orgs.ts`, `apps/portal/src/server/product-stats.ts`. `apps/portal/src/components/ui/**` (all primitives and the barrel). `apps/portal/src/app/(app)/layout.tsx`, `page.tsx`, `loading.tsx`, `apps/portal/src/app/(app)/settings/**`. `apps/portal/src/features/shell/**`, `apps/portal/src/features/launcher/**` except `create-org-form.tsx`. `apps/portal/src/styles/globals.css`. |
| **apps** | `apps/crm/**`, `apps/wms/**`, `apps/projects/**`, `apps/pulse/**` (after the foundation wiring lines exist; from then on these files are yours, including their `package.json` scripts but not dependency lists). `packages/ui/**` (new `plan-banner`, `plan-lock`, the `app-switcher` plan state, exports in `package.json` and `src/index.ts`). |
| **web** | `apps/web/**` (after the foundation wiring lines exist). |
| **lifecycle** | `packages/billing/src/emails/**`, `packages/billing/src/jobs/**`, `packages/billing/scripts/**`, `packages/billing/tests/**`. `apps/portal/src/app/api/billing/jobs/**`. `apps/portal/src/app/(app)/billing/activity/**`, `apps/portal/src/features/billing-activity/**`. `apps/portal/src/app/dev/**` (email outbox viewer). `apps/portal/e2e/**`, `apps/portal/playwright.config.ts`, `apps/portal/vercel.json`, `apps/portal/src/lib/copy-rules.test.ts`. `docs/billing/GO-LIVE.md`, `docs/billing/TESTING.md`, `docs/billing/DEV.md`, `docs/DEPLOYMENT.md`. `deploy/**`. |

Nobody edits: `packages/config`, `packages/pm-bridge`, `packages/pulse-bridge`, `apps/*/drizzle/**` that is
already applied, `docs/billing/DECISIONS.md`, `docs/billing/research/**`, `docs/billing/SPEC.md` (architect).

Shared touch points and who serves whom:

| Need | Owner provides | Consumer |
|:-|:-|:-|
| Plan picker on `/signup/plan` | billing-ui: `PlanPicker` (16.5) | signup page renders it |
| Verify email banner and plan banner in the portal shell | billing-ui: `ShellNotices` in the `(app)` layout | signup supplies `/verify-email` |
| Sending a code or invite mail right now | lifecycle: `sendEmailNow` (13) | signup `auth.ts`, foundation auth hooks use `enqueueEmail` |
| Banner and lock screen in product apps | apps lane: `@kitstak/ui/plan-banner`, `@kitstak/ui/plan-lock` | apps lane, billing-ui (portal shell) |
| Activity link on billing home | lifecycle: `/billing/activity` | billing-ui links to it |
| Test ids for e2e | every UI lane uses section 21 | lifecycle e2e |

## 3. The package `@kitstak/billing`

### 3.1 Layout

```
packages/billing/
  package.json            name @kitstak/billing, private, source shipped like @kitstak/entitlements
  tsconfig.json           extends the same base as packages/entitlements
  vitest.config.ts        node env, src/**/*.test.ts and tests/**/*.test.ts
  src/
    catalog.ts            PURE. prices, products, constants, formatMoney, PlanSelection
    quote.ts              PURE. quote()
    handoff.ts            PURE. marketing site to signup codec
    links.ts              PURE. billingLink()
    plan-state.ts         PURE. PlanState types, derivePlanState, planNoticeFor, planLockFor
    errors.ts             PURE. BillingErrorCode, BillingResult, BILLING_ERROR_COPY
    email-types.ts        PURE. EmailTemplateId and payload map (the email contract)
    index.ts              re-exports the PURE modules only
    server/
      index.ts            barrel for everything below
      db.ts               BillingDb, BillingReadDb, rows(), runtime types
      config.ts           resolveBillingConfig, billingMode
      runtime.ts          createBillingRuntime
      state.ts            getPlanState, getAppPlanView, caches
      access.ts           getBillingAccess, managers
      trial.ts            canStartTrial, startTrial, changeTrialProducts
      cart.ts             saveCart, getCart
      checkout.ts         createCheckout, syncCheckoutSession
      changes.ts          previewPlanChange, applyPlanChange
      cancel.ts           scheduleCancel, undoCancel, pausePlan, undoPause, resumePlan
      payment.ts          createPaymentUpdateSession, retryPayment
      invoices.ts         listInvoices, getInvoice, getInvoicePdf
      profile.ts          getBillingProfile, updateBillingProfile
      usage.ts            countBillableSeats, countWarehouses, checkSeatAvailable, checkWarehouseAvailable
      audit.ts            recordAudit, listAuditLog
      outbox.ts           enqueueEmail, billingRecipients
      rate-limit.ts       enforceRateLimit
      sync.ts             applySubscriptionSnapshot, applyInvoiceSnapshot, refreshFromGateway
      webhook.ts          processWebhook
      auth-hooks.ts       billingOrganizationOptions
      intents.ts          signup intents: upsertSignupIntent, getOpenSignupIntent, completeSignupIntent
    gateway/
      types.ts            BillingGateway and the normalized Gateway* types
      stripe.ts           createStripeGateway (the only file that imports `stripe`)
      test.ts             createTestGateway, TEST_CARDS, test tools
      test-pdf.ts         renderInvoicePdf (tiny built in PDF writer, no dependency)
    emails/               LIFECYCLE: index.ts, send.ts, deliver.ts, render.ts, layout.ts, templates/*.ts
    jobs/                 LIFECYCLE: index.ts, tick.ts, reminders.ts, reconcile.ts
  scripts/                LIFECYCLE: stripe-setup.ts, backfill-entitlements.ts
  tests/                  LIFECYCLE: cross cutting tests (price parity, copy rules)
```

### 3.2 `package.json` exports (foundation writes all of them up front)

| Import | File | Safe in the browser |
|:-|:-|:-|
| `@kitstak/billing` | `src/index.ts` | yes |
| `@kitstak/billing/catalog` | `src/catalog.ts` | yes |
| `@kitstak/billing/quote` | `src/quote.ts` | yes |
| `@kitstak/billing/handoff` | `src/handoff.ts` | yes |
| `@kitstak/billing/links` | `src/links.ts` | yes |
| `@kitstak/billing/plan-state` | `src/plan-state.ts` | yes |
| `@kitstak/billing/errors` | `src/errors.ts` | yes |
| `@kitstak/billing/email-types` | `src/email-types.ts` | yes |
| `@kitstak/billing/server` | `src/server/index.ts` | no |
| `@kitstak/billing/gateway` | `src/gateway/types.ts` | types only |
| `@kitstak/billing/gateway/stripe` | `src/gateway/stripe.ts` | no |
| `@kitstak/billing/gateway/test` | `src/gateway/test.ts` | no |
| `@kitstak/billing/emails` | `src/emails/index.ts` | no |
| `@kitstak/billing/jobs` | `src/jobs/index.ts` | no |

The pure modules import nothing but each other. `apps/web` may import only the rows marked yes. Product apps
import `@kitstak/billing/plan-state`, `@kitstak/billing/links` and `@kitstak/billing/server` (database reads
only; that barrel must never import `gateway/stripe.ts`, so `stripe` is not bundled into product apps).

Scripts in `package.json`: `typecheck`, `test`, `stripe:setup` (`tsx scripts/stripe-setup.ts`), `backfill`
(`tsx scripts/backfill-entitlements.ts`).

### 3.3 Dependencies (foundation installs, nobody else adds any)

| Where | Dependency | Why |
|:-|:-|:-|
| `packages/billing` | `stripe` pinned exact (`23.2.0`, the latest on npm on 2026-11-23), `@kitstak/db`, `@kitstak/entitlements`, peers `drizzle-orm`, dev `vitest`, `tsx`, `pg`, `typescript` | gateway and tests |
| `apps/portal` | `@kitstak/billing`, `stripe` (same pin, so `serverExternalPackages: ['pg', 'stripe']` resolves), `radix-ui` `1.8.1` (same as packages/ui; dialog, tabs, tooltip, select, switch, radio, toast), dev `@playwright/test` (same version the Pulse app uses) | billing UI and e2e |
| `apps/crm`, `apps/wms`, `apps/projects`, `apps/pulse`, `apps/web` | `@kitstak/billing` workspace line and `transpilePackages` entry | plan state, catalog |

No mail library is added. Resend is called with `fetch`. No PDF library is added.

Portal `package.json` scripts added by foundation: `"e2e": "playwright test"`.

## 4. Catalog and quote (pure)

### 4.1 Prices: the one place to change them

`packages/billing/src/catalog.ts` is the only file in the repo that holds a price. `apps/web/src/lib/pricing.ts`
becomes a re-export of it (web lane). Unit amounts in cents:

| Product | Charged per | `monthly` | `monthlyBundle` | `yearly` | `yearlyBundle` |
|:-|:-|:-|:-|:-|:-|
| `crm` KitStak CRM | user | 2900 | 2320 | 29580 | 23664 |
| `projects` KitStak Projects | user (same count as CRM) | 1200 | 960 | 12240 | 9792 |
| `wms` KitStak WMS | warehouse | 34900 | 27920 | 355980 | 284784 |
| `pulse` KitStak Pulse | organization, up to 5 seats | 2900 | 2320 | 29580 | 23664 |

How the four columns relate (a catalog test asserts each line, so a bad edit fails the build):

- `yearly = monthly x 12 x 85 / 100` exactly (15% off for paying yearly).
- `monthlyBundle = monthly x 80 / 100` and `yearlyBundle = yearly x 80 / 100` exactly (20% off with 2 or more
  products).
- `monthly % 5 === 0` and `yearly % 60 === 0`, so every derived amount, and the per month view of a yearly
  price, is a whole number of cents. No screen ever rounds.

The stored columns are what Stripe charges. The quote is `sum(unit amount x quantity)`. There is no percent
math at charge time, so the quote and the invoice cannot differ by a cent.

Price status comment that must sit above `CATALOG` (honest, per DECISIONS.md section 1):

```ts
/**
 * Prices. Pulse ($29 per organization, up to 5 seats) was confirmed by the owner first. On 2026-11-23 the owner
 * chose the per product model for self serve signup (docs/billing/DECISIONS.md section 1), so CRM, WMS and
 * Projects are live prices too. Customers never see the word "preliminary". Change a price here and nowhere
 * else, then run `pnpm -F @kitstak/billing stripe:setup check` to see what Stripe needs.
 */
export const PRICING_IS_PLACEHOLDER = false;
```

### 4.2 Exports of `catalog.ts`

```ts
export const PRODUCT_IDS = ['crm', 'wms', 'projects', 'pulse'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];
/** Always in PRODUCT_IDS order, no repeats. */
export type Stack = readonly ProductId[];
export type BillingInterval = 'monthly' | 'yearly';
export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly'];
export type QuantitySource = 'seats' | 'warehouses' | 'flat';
export type UnitNoun = 'user' | 'warehouse' | 'organization';

export interface ProductPricing {
  readonly id: ProductId;
  readonly name: string;        // 'KitStak CRM'
  readonly shortName: string;   // 'CRM'
  readonly tagline: string;     // one plain line, shown on tiles and pickers
  readonly unit: UnitNoun;
  readonly unitPlural: string;  // 'users' | 'warehouses' | 'organizations'
  readonly quantityFrom: QuantitySource;
  readonly max: number;         // crm 500, projects 500, wms 50, pulse 1
  readonly includedSeats: number | null; // pulse 5, others null
  readonly cents: { readonly monthly: number; readonly monthlyBundle: number;
                    readonly yearly: number; readonly yearlyBundle: number };
}

export const CATALOG: {
  readonly version: '2026-11';
  readonly currency: 'usd';
  readonly bundlePercentOff: 20;
  readonly yearlyPercentOff: 15;
  readonly bundleMinProducts: 2;
  readonly trialDays: 14;
  readonly graceDays: 7;              // must equal GRACE_DAYS in @kitstak/entitlements (test asserts)
  readonly trialReminderDays: readonly [7, 3, 1, 0];
  readonly pauseMonths: readonly [1, 2, 3];
  readonly freeRoles: readonly ['guest']; // members with only these roles do not use a seat
  readonly trialsPerUser: 1;
  readonly products: Readonly<Record<ProductId, ProductPricing>>;
};

export interface PlanSelection {
  readonly products: Stack;
  readonly seats: number;       // 1..500, people who sign in; used by crm and projects
  readonly warehouses: number;  // 1..50, used by wms
  readonly interval: BillingInterval;
}
export const DEFAULT_SELECTION: PlanSelection; // { products: [], seats: 1, warehouses: 1, interval: 'monthly' }

export function isProductId(value: string): value is ProductId;
export function toStack(products: readonly string[]): Stack;
export function parseStack(value: string | null | undefined): Stack; // 'crm,wms'; legacy 'both' = crm,wms
export function stackParam(stack: Stack): string;
export function toggleProduct(stack: Stack, product: ProductId): Stack;
export function isBundle(stack: Stack): boolean; // length >= bundleMinProducts
/** Clamps and cleans untrusted input. Never throws. Unknown products are dropped. */
export function normalizeSelection(input: unknown): PlanSelection;
export function quantityFor(product: ProductId, selection: PlanSelection): number; // seats | warehouses | 1
export function unitCents(product: ProductId, interval: BillingInterval, bundle: boolean): number;
/** Seats the plan allows. Per user product in the stack: seats. Pulse without one: 5. WMS only: null. */
export function seatLimitFor(selection: PlanSelection): number | null;

export type PriceKey =
  | `kitstak_${ProductId}_${BillingInterval}`
  | `kitstak_${ProductId}_${BillingInterval}_bundle`;
export function priceKey(product: ProductId, interval: BillingInterval, bundle: boolean): PriceKey;
export function parsePriceKey(key: string): { product: ProductId; interval: BillingInterval; bundle: boolean } | null;
export function allPriceKeys(): readonly PriceKey[]; // 16 keys

/** '$1,479.00'. With trimZeroCents: '$29' but still '$23.20'. Never rounds. Negative: '-$98.80'. */
export function formatMoney(cents: number, options?: { trimZeroCents?: boolean }): string;
export function percentLabel(percent: number): string; // 20 -> '20%'
/** 'Dec 7, 2026' in the given IANA zone (default 'UTC'). One date format for every billing screen. */
export function formatDay(date: Date, timeZone?: string): string;
export function daysLeft(until: Date, now: Date): number; // whole days, rounded up, never below 0
```

### 4.3 Exports of `quote.ts`

```ts
export interface QuoteLine {
  readonly product: ProductId;
  readonly name: string;
  readonly quantity: number;
  readonly unitLabel: string;            // 'user' | 'users' | 'warehouse' | ... matched to quantity
  readonly listUnitMonthlyCents: number; // the public monthly list price for one unit
  readonly unitCents: number;            // what the gateway charges per unit per period
  readonly amountCents: number;          // unitCents x quantity
  readonly priceKey: PriceKey;
  /** 'CRM: 5 users x $29 = $145 per month'. Pulse: 'Pulse: $29 per month for your whole team, up to 5 seats'. */
  readonly math: string;
}
export interface Quote {
  readonly selection: PlanSelection;     // normalized
  readonly interval: BillingInterval;
  readonly periodMonths: 1 | 12;
  readonly isBundle: boolean;
  readonly lines: readonly QuoteLine[];
  readonly listPeriodCents: number;      // sum(list monthly x quantity) x periodMonths
  readonly yearlySavingsCents: number;   // 0 on monthly
  readonly bundleSavingsCents: number;   // 0 without a bundle
  readonly totalCents: number;           // per period, before tax = sum(lines.amountCents)
  readonly monthlyEquivalentCents: number; // totalCents / periodMonths, exact
  readonly seatLimit: number | null;
  /** Set when seats are above what Pulse covers: 'The Pulse price covers up to 5 seats.' else null. */
  readonly pulseSeatNote: string | null;
}
/** Pure. Identity: listPeriodCents - yearlySavingsCents - bundleSavingsCents === totalCents. */
export function quote(selection: PlanSelection): Quote;
/** The summary lines under the math, in order: list, yearly discount, bundle discount, total. */
export function quoteSummaryLines(q: Quote): readonly { label: string; amountCents: number; kind: 'list' | 'discount' | 'total' }[];
```

Reference carts. Foundation unit tests and the lifecycle parity test both assert these numbers:

| # | Cart | Interval | `totalCents` | Shown as |
|:-|:-|:-|:-|:-|
| 1 | Pulse | monthly | 2900 | $29.00 per month |
| 2 | CRM 5 seats | monthly | 14500 | $145.00 per month |
| 3 | CRM 5 seats, WMS 1 warehouse | monthly | 39520 | $395.20 per month (list $494.00, bundle saves $98.80) |
| 4 | CRM 5 seats, WMS 1 warehouse | yearly | 403104 | $4,031.04 per year, $335.92 per month (yearly saves $889.20, bundle saves $1,007.76) |
| 5 | Pulse, CRM 1 seat | yearly | 47328 | $473.28 per year, $39.44 per month |
| 6 | CRM and Projects 10 seats, WMS 2, Pulse | monthly | 90960 | $909.60 per month (list $1,137.00) |
| 7 | same as 6 | yearly | 927792 | $9,277.92 per year, $773.16 per month |
| 8 | Projects 3 seats | yearly | 36720 | $367.20 per year, $30.60 per month |
| 9 | WMS 3 warehouses | monthly | 104700 | $1,047.00 per month |

### 4.4 `errors.ts`

```ts
export type BillingErrorCode =
  | 'not_signed_in' | 'no_org' | 'forbidden' | 'email_unverified' | 'billing_unavailable'
  | 'invalid_selection' | 'below_usage' | 'trial_used' | 'already_subscribed' | 'no_subscription'
  | 'card_declined' | 'payment_failed' | 'price_changed' | 'rate_limited' | 'seat_limit'
  | 'warehouse_limit' | 'yearly_no_pause' | 'gateway_error' | 'not_found';
export interface BillingError { readonly code: BillingErrorCode; readonly message: string }
export type BillingResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: BillingError };
/** Plain UI sentence per code. SPEC section 12.6 lists the exact copy. */
export const BILLING_ERROR_COPY: Readonly<Record<BillingErrorCode, string>>;
export function billingError(code: BillingErrorCode, message?: string): { ok: false; error: BillingError };
```

### 4.5 `links.ts`

```ts
export type BillingLinkIntent =
  | { to: 'home' } | { to: 'plan' } | { to: 'add'; product: ProductId } | { to: 'checkout' }
  | { to: 'fix_payment' } | { to: 'seats'; seats?: number } | { to: 'warehouses'; warehouses?: number }
  | { to: 'invoices' } | { to: 'cancel' } | { to: 'activity' };
/** Absolute URL on the portal. `from` is the calling app, kept so the portal can offer a way back. */
export function billingLink(portalUrl: string, intent: BillingLinkIntent, from?: ProductId): string;
```

| Intent | Path |
|:-|:-|
| home | `/billing` |
| plan | `/billing/plan` |
| add | `/billing/plan?add=<product>` |
| checkout | `/billing/checkout` |
| fix_payment | `/billing?fix=payment` |
| seats | `/billing/plan?seats=<n>` (no number: opens with the seat stepper focused, `?focus=seats`) |
| warehouses | `/billing/plan?warehouses=<n>` or `?focus=warehouses` |
| invoices | `/billing/invoices` |
| cancel | `/billing/cancel` |
| activity | `/billing/activity` |

`from` adds `&from=<product>`. Old links keep working: `/billing?module=<m>` and `/billing/upgrade?module=<m>`
redirect to `/billing/plan?add=<m>` (billing-ui).

## 5. Stripe mapping (live account)

The orchestrating session creates these in live mode through the Stripe connector. The setup script
(lifecycle) must find them by these ids and keys and change nothing when they already match.

### 5.1 Products

Created with a fixed `id`, so they can never be confused with the old tier products (Starter, Professional,
Enterprise), which stay untouched. Code never matches a product by name.

| Product `id` | `name` | `unit_label` | `tax_code` | `metadata` |
|:-|:-|:-|:-|:-|
| `kitstak_crm` | KitStak CRM | user | `txcd_10103001` | `kitstak_module=crm`, `kitstak_catalog=2026-11` |
| `kitstak_wms` | KitStak WMS | warehouse | `txcd_10103001` | `kitstak_module=wms`, `kitstak_catalog=2026-11` |
| `kitstak_projects` | KitStak Projects | user | `txcd_10103001` | `kitstak_module=projects`, `kitstak_catalog=2026-11` |
| `kitstak_pulse` | KitStak Pulse | (none) | `txcd_10103001` | `kitstak_module=pulse`, `kitstak_catalog=2026-11` |

`txcd_10103001` is "Software as a Service (SaaS), Business Use" in the Stripe tax code list (checked in the
Stripe docs on 2026-11-23). `description` is the catalog `tagline`.

### 5.2 Prices

All prices: `currency=usd`, `billing_scheme=per_unit`, `recurring.usage_type=licensed`,
`tax_behavior=exclusive`, `metadata.kitstak_module`, `metadata.kitstak_interval`, `metadata.kitstak_bundle`
(`true` or `false`), `metadata.kitstak_catalog=2026-11`. `recurring.interval` is `month` or `year` with
`interval_count=1`. Code finds prices by `lookup_key` only.

| `lookup_key` | Product | Interval | `unit_amount` |
|:-|:-|:-|:-|
| `kitstak_crm_monthly` | `kitstak_crm` | month | 2900 |
| `kitstak_crm_monthly_bundle` | `kitstak_crm` | month | 2320 |
| `kitstak_crm_yearly` | `kitstak_crm` | year | 29580 |
| `kitstak_crm_yearly_bundle` | `kitstak_crm` | year | 23664 |
| `kitstak_projects_monthly` | `kitstak_projects` | month | 1200 |
| `kitstak_projects_monthly_bundle` | `kitstak_projects` | month | 960 |
| `kitstak_projects_yearly` | `kitstak_projects` | year | 12240 |
| `kitstak_projects_yearly_bundle` | `kitstak_projects` | year | 9792 |
| `kitstak_wms_monthly` | `kitstak_wms` | month | 34900 |
| `kitstak_wms_monthly_bundle` | `kitstak_wms` | month | 27920 |
| `kitstak_wms_yearly` | `kitstak_wms` | year | 355980 |
| `kitstak_wms_yearly_bundle` | `kitstak_wms` | year | 284784 |
| `kitstak_pulse_monthly` | `kitstak_pulse` | month | 2900 |
| `kitstak_pulse_monthly_bundle` | `kitstak_pulse` | month | 2320 |
| `kitstak_pulse_yearly` | `kitstak_pulse` | year | 29580 |
| `kitstak_pulse_yearly_bundle` | `kitstak_pulse` | year | 23664 |

`nickname` is the product short name plus the words that apply, for example "CRM yearly bundle".

### 5.3 How the two discounts are modeled

- **Yearly, 15% off:** baked into the yearly prices. No coupon.
- **Bundle, 20% off with 2 or more products:** baked into the `_bundle` prices. No coupon. When a plan moves
  between 1 product and 2 or more, every item on the subscription swaps between its list price and its bundle
  price in the same update call. Stripe prorates the swap.

Why prices and not a coupon. A Checkout Session takes at most one coupon or promotion code (Stripe docs, "Add
discounts", checked 2026-11-23). A bundle coupon would use that slot, so a promo code could not be entered at
Checkout. With bundle prices the slot stays free (`allow_promotion_codes: true`), the invoice total is plain
`unit_amount x quantity`, and there is no coupon to keep in sync on every update.

Because the discounts are inside the unit price, Stripe pages show the discounted unit price. KitStak screens
show the list price, each discount as its own dollar line, and the same total. Checkout carries one plain line
of custom text so the two views connect (section 10.3).

### 5.4 Subscription shape

- One Stripe customer per organization: `metadata.kitstak_org_id=<org uuid>`, `name` = billing company name or
  org name, `email` = billing email. Stored in `core.stripe_customers`.
- One subscription per organization, one item per product in the plan. `metadata.kitstak_org_id=<org uuid>`.
  Quantity: CRM and Projects items = seats (always the same number), WMS item = warehouses, Pulse item = 1.
- An event whose customer is not in `core.stripe_customers` and whose object has no `kitstak_org_id` metadata
  is recorded as `ignored`. This keeps the old test subscription (metadata `org_id`, `plan_key`) and the old
  tier products out of the new flow.

### 5.5 Billing Portal configuration (card updates only)

Created by the setup script. Its id goes in `STRIPE_PORTAL_CONFIGURATION_ID`. Features: payment method update
on, invoice history on, customer update on (name, email, address, tax id). Subscription cancel, update and
pause are off, because KitStak runs those in its own screens with one proration rule. Default return URL:
`https://kitstak.app/billing`.

### 5.6 Webhook endpoint

URL `https://kitstak.app/api/billing/webhooks/stripe`. Events: `checkout.session.completed`,
`checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
`invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
`invoice.voided`, `invoice.marked_uncollectible`, `customer.updated`, `payment_method.attached`.
It is created at go live, not before (DECISIONS.md section 4). The old Supabase endpoint stays on until then.

### 5.7 Tax

`automatic_tax.enabled` follows `STRIPE_AUTOMATIC_TAX=1` (off by default, because Stripe Tax needs
registrations set in the account). `tax_id_collection.enabled=true` and
`customer_update={ name: 'auto', address: 'auto' }` on every Checkout Session. Tax is always its own line.

## 6. Handoff codec `handoff.ts` (pure, used by web and portal)

```ts
export type BusinessType = '3pl' | 'brand' | 'distributor' | 'other';
export type TeamSize = 'solo' | 'small' | 'medium' | 'large';
export type StartMode = 'fresh' | 'sample' | 'import';
export type HandoffSource = 'wizard' | 'pricing' | 'product' | 'app' | 'direct';

export interface SignupHandoff {
  /** null when the link carried no valid product. */
  readonly selection: PlanSelection | null;
  readonly profile: { readonly businessType?: BusinessType; readonly teamSize?: TeamSize;
                      readonly startMode?: StartMode; readonly guided?: boolean };
  readonly source: HandoffSource;
}
export interface HandoffIdentity { readonly name?: string; readonly email?: string; readonly company?: string }

export function encodeHandoff(handoff: SignupHandoff): URLSearchParams;
export function parseHandoff(
  params: URLSearchParams | Readonly<Record<string, string | string[] | undefined>>,
): SignupHandoff;
/** Goes after '#'. Never sent to a server, never in logs. Values are trimmed to 120 characters. */
export function encodeHandoffIdentity(identity: HandoffIdentity): string;
export function parseHandoffIdentity(hash: string): HandoffIdentity;
/** `${portalOrigin}/signup?<query>#<identity>` */
export function signupUrl(portalOrigin: string, handoff: SignupHandoff, identity?: HandoffIdentity): string;
```

Query names: `products` (comma list), `seats`, `warehouses`, `billing` (`monthly` or `yearly`; `annual` is read
as `yearly`), `businessType`, `teamSize`, `startMode`, `guided` (`1`), `src`. Legacy `focus` (`crm`, `wms`,
`both`) is read only when `products` is missing. `parseHandoff(encodeHandoff(x))` equals `x` for every valid
`x` (unit test). The link is validated, not signed: it holds no price and no identity, so there is nothing to
forge, and the marketing site is static and has no secret to sign with.

## 7. Plan state and notices `plan-state.ts` (pure)

```ts
export type ModuleAccess = 'full' | 'read_only' | 'locked';
export type BillingMode = 'live' | 'stripe_test' | 'test_gateway' | 'unavailable';
export type PlanPhase =
  | 'none'             // never had a trial or a plan
  | 'trial'            // free trial running, no card
  | 'trial_ended'      // free trial over, nothing paid
  | 'active'           // paid plan in good standing (also: card saved, first charge still ahead)
  | 'past_due'         // a payment failed, inside the grace days, full access
  | 'unpaid'           // grace over, view only, the plan is still open and can be paid
  | 'cancel_scheduled' // ends at period end, can be undone
  | 'pause_scheduled'  // pause starts at period end, can be undone
  | 'paused'           // inside a pause, view only
  | 'ended';           // canceled and past its last day

export interface ModulePlan {
  readonly product: ProductId;
  readonly access: ModuleAccess;
  readonly inPlan: boolean;                         // in the trial or the paid plan
  readonly source: 'trial' | 'paid' | 'manual' | null; // manual = granted by KitStak, not billed
  readonly quantity: number | null;
}
export interface PlanUsage {
  readonly seatsUsed: number;            // active members who are not guest only
  readonly seatsPaid: number | null;     // null in trial, WMS only plans and no plan
  readonly seatLimit: number | null;     // seatLimitFor(), null = no limit
  readonly pendingInvites: number;       // open invites that would use a seat
  readonly warehousesUsed: number | null; // null when the org has no warehouse schema yet
  readonly warehousesPaid: number | null;
}
export interface PaymentMethodSummary { readonly brand: string; readonly last4: string;
                                        readonly expMonth: number; readonly expYear: number }
export interface PlanState {
  readonly orgId: string;
  readonly phase: PlanPhase;
  readonly mode: BillingMode;
  readonly selection: PlanSelection;     // the paid plan, else the saved cart, else the trial products
  readonly quote: Quote;                 // quote(selection)
  readonly modules: Readonly<Record<ProductId, ModulePlan>>;
  readonly usage: PlanUsage;
  readonly trial: { readonly startedAt: Date; readonly endsAt: Date; readonly daysLeft: number } | null;
  readonly trialEligible: boolean;       // this org may still start a free trial
  readonly hasSubscription: boolean;
  readonly paymentMethod: PaymentMethodSummary | null;
  readonly nextCharge: { readonly amountCents: number; readonly at: Date } | null;
  readonly currentPeriodEnd: Date | null;
  readonly pastDue: { readonly since: Date; readonly amountDueCents: number; readonly nextRetryAt: Date | null;
                      readonly accessChangesAt: Date } | null;
  readonly cancelAt: Date | null;
  readonly pause: { readonly startsAt: Date; readonly resumesAt: Date } | null;
  readonly endedAt: Date | null;
}

export interface PlanViewer {
  readonly canManage: boolean;       // owner or billing manager
  readonly canView: boolean;         // owner, admin or billing manager
  readonly ownerName: string | null; // who a member should ask
}
export type PlanNoticeKind =
  | 'trial' | 'trial_ending' | 'trial_with_card' | 'trial_ended' | 'payment_failed' | 'unpaid'
  | 'cancel_scheduled' | 'pause_scheduled' | 'paused' | 'ended';
export interface PlanNotice {
  readonly kind: PlanNoticeKind;
  readonly tone: 'info' | 'warning' | 'danger';
  readonly text: string;                                   // one to three short sentences, SPEC 9.2
  readonly action: { readonly label: string; readonly href: string } | null;
  readonly testId: string;                                 // `plan-notice-${kind}`
}
export interface PlanLock {
  readonly kind: 'not_in_plan' | 'trial_available';
  readonly title: string;
  readonly body: string;
  readonly priceLine: string | null;  // 'CRM is $23.20 per user each month with your bundle discount.'
  readonly primary: { readonly label: string; readonly href: string } | null;
  readonly secondary: { readonly label: string; readonly href: string };
  readonly testId: 'plan-lock';
}
export interface NoticeContext {
  readonly module: ProductId | null;  // null in the portal
  readonly viewer: PlanViewer;
  readonly portalUrl: string;
  readonly now: Date;
  readonly timeZone?: string;
}
/** null means show nothing. Pure and deterministic: same input, same words, in every app. */
export function planNoticeFor(state: PlanState, context: NoticeContext): PlanNotice | null;
/** Only for a module whose access is 'locked'. */
export function planLockFor(state: PlanState, context: NoticeContext & { module: ProductId }): PlanLock;
/** Badge text for tiles and the app switcher. */
export type PlanBadge = 'trial' | 'active' | 'past_due' | 'view_only' | 'not_in_plan' | 'included';
export function planBadgeFor(state: PlanState, product: ProductId): PlanBadge;
```

`derivePlanState(input: PlanStateInput): PlanState` is also exported and pure. `PlanStateInput` is the raw rows
(account, subscription, entitlement rows, usage counts, mode, now). `getPlanState` in section 11 loads the rows
and calls it. All phase and access rules live in this one function and in `moduleAccess` (section 8), with
table driven unit tests.

Who sees a notice (inside `planNoticeFor`): viewers with `canView` see every kind. Other members see only
`trial_ended`, `unpaid`, `paused` and `ended`, with the member wording and no action.

Details that are easy to get wrong:

- `PlanState.trial` stays set for as long as the free trial end date is still ahead, also after a card is
  saved. So phase `active` with `trial` set means "card saved, first charge still ahead": the notice kind is
  `trial_with_card` and the badge is `trial`. After the end date `trial` is null unless the phase is
  `trial_ended`, where it keeps the dates with `daysLeft: 0`.
- `ModuleAccess` and `ProductId` are declared again here (the same strings as `ModuleAccess` and `Module` in
  `@kitstak/entitlements`) so the pure modules import no database code. `server/state.ts` holds a compile
  time check that each pair is mutually assignable, like the guard in `packages/entitlements/src/modules.ts`.
- A notice for a module (`context.module` set) is returned only when that module is in the trial or the plan.
  A module that is not gets a `PlanLock`, never a banner.

## 8. `@kitstak/entitlements` changes (foundation)

Additive. Every existing export keeps its name and meaning except the two fixes marked FIX.

```ts
// read.ts
export type ModuleAccess = 'full' | 'read_only' | 'locked';
export interface ModuleEntitlement {      // seats added
  readonly status: EntitlementStatus;
  readonly source: EntitlementSource;
  readonly periodEnd: Date | null;
  readonly seats: number | null;
}
/** The one access rule. Pure. */
export function moduleAccess(entitlement: ModuleEntitlement | null, now?: Date): ModuleAccess;
/** FIX: now `moduleAccess(...) === 'full'`, so a trial past its end is no longer entitled. */
export function isEntitled(entitlement: ModuleEntitlement | null, now?: Date): boolean;
/** Dev switch aware, like hasModule. Returns 'full' when ENTITLEMENTS_DEV_ALLOW_ALL is 1 or true. */
export function getModuleAccess(db: EntitlementsDb, orgId: string, module: Module): Promise<ModuleAccess>;
/** FIX: a cached answer that is not 'full' is read again from the database before it is returned. */
export function hasModule(db: EntitlementsDb, orgId: string, module: Module): Promise<boolean>;

// write.ts (new)
export interface EntitlementWrite {
  readonly orgId: string; readonly module: Module;
  readonly status: EntitlementStatus; readonly source: EntitlementSource;
  readonly periodEnd: Date | null; readonly seats: number | null;
  readonly stripeSubscriptionId: string | null; readonly stripePriceId: string | null;
}
/**
 * Upsert on (org_id, module) that writes every column. Returns false and writes nothing when the existing row
 * is a live manual grant (source 'manual' and status 'active') and the write is not itself 'manual'.
 * Clears this process's cache for the org.
 */
export function setEntitlement(db: EntitlementsDb, write: EntitlementWrite): Promise<boolean>;
```

`moduleAccess` rule table (this is the whole rule):

| Row | Result |
|:-|:-|
| no row | `locked` |
| `active` | `full` |
| `trialing`, no period end (old manual rows) | `full` |
| `trialing`, period end in the future | `full` |
| `trialing`, period end in the past | `read_only` |
| `past_due`, no period end | `locked` (unchanged, fail closed) |
| `past_due`, now within period end plus `GRACE_DAYS` | `full` |
| `past_due`, later | `read_only` |
| `canceled`, source `manual` | `locked` (a manual revoke stays a lock) |
| `canceled`, period end in the future | `full` (paid time is never taken away) |
| `canceled`, otherwise | `read_only` |

`grantModule` and `revokeModule` keep their behavior and signatures. The `grant` CLI keeps working. The cache
stays 60 seconds per process; the FIX on `hasModule` and `getModuleAccess` means good news (a payment, a new
trial) shows in every app on the next request, while bad news may take up to 60 seconds. `EntitlementsDb`
stays `Pick<PgDatabase, 'select' | 'insert'>`. Package description and index comment drop the words "Stripe
sync is deferred". No Stripe code is added here.

How billing writes rows (section 12 is the source of truth):

| Plan fact | Row written per product in the plan |
|:-|:-|
| Free trial, no card | `trialing`, source `trial`, period end = trial end, seats = cart seats |
| Subscription `active`, or `trialing` in the gateway (card saved) | `active`, source `stripe`, period end = current period end |
| Subscription `past_due` | `past_due`, source `stripe`, period end = the day the failed invoice was made, so the old grace math gives 7 days |
| Subscription `unpaid`, `canceled`, `incomplete_expired` | `canceled`, source `stripe`, period end = the last paid day |
| Pause set | `canceled`, source `stripe`, period end = the day the pause starts |
| Product removed from the plan | `canceled`, source `stripe`, period end = now |

Rows from the test gateway also use source `stripe` (it means "paid through the gateway") with ids that start
`sub_test_` and `price_test_`.

## 9. Database (foundation)

One migration: `packages/db/drizzle/0007_core_billing.sql`, journal entry idx 7, tag `0007_core_billing`.
Conventions from `packages/db/drizzle/README.md`: `CREATE TABLE IF NOT EXISTS`, the repo's statement breakpoint
marker line between statements, `ENABLE ROW LEVEL SECURITY` on every new table (no policies), FKs to
`core.organization` and `core."user"` in guarded `DO` blocks copied from `0002_core_onboarding.sql`
(`ON DELETE CASCADE` for org, `ON DELETE SET NULL` for user columns), enums as text plus CHECK. Mirror every
table in Drizzle under `packages/db/src/schema/core/` and export it from the schema barrel. Also fix the
Drizzle CHECK literal in `billing.ts` so it lists all four modules, and have the migration drop and add
`entitlements_module_check` with the four values again (safe to repeat).

Drizzle export names: `billingAccounts`, `billingSubscriptions`, `billingInvoices`, `billingEvents` (existing,
widened), `billingAuditLog`, `billingManagers`, `billingCancelFeedback`, `billingEmails`, `billingTestObjects`,
`signupIntents`. Row types `BillingAccount`, `BillingSubscription`, `BillingInvoice`, and so on.

```sql
CREATE TABLE IF NOT EXISTS "core"."billing_accounts" (
  "org_id"            uuid PRIMARY KEY,
  "gateway"           text,
  "cart"              jsonb NOT NULL DEFAULT '{}'::jsonb,
  "trial_started_at"  timestamptz,
  "trial_ends_at"     timestamptz,
  "trial_started_by"  uuid,
  "billing_email"     text,
  "company_name"      text,
  "address"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "tax_id_type"       text,
  "tax_id_value"      text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_accounts_gateway_check" CHECK ("gateway" IS NULL OR "gateway" IN ('stripe', 'test'))
);

CREATE INDEX IF NOT EXISTS "billing_accounts_trial_ends_idx"
  ON "core"."billing_accounts" ("trial_ends_at") WHERE "trial_ends_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "billing_accounts_trial_started_by_idx"
  ON "core"."billing_accounts" ("trial_started_by") WHERE "trial_started_by" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "core"."billing_subscriptions" (
  "org_id"                  uuid PRIMARY KEY,
  "gateway"                 text NOT NULL,
  "gateway_subscription_id" text NOT NULL,
  "gateway_customer_id"     text NOT NULL,
  "status"                  text NOT NULL,
  "interval"                text NOT NULL,
  "seats"                   integer NOT NULL DEFAULT 1,
  "warehouses"              integer NOT NULL DEFAULT 1,
  "items"                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recurring_cents"         integer NOT NULL DEFAULT 0,
  "currency"                text NOT NULL DEFAULT 'usd',
  "current_period_start"    timestamptz,
  "current_period_end"      timestamptz,
  "trial_end"               timestamptz,
  "cancel_at_period_end"    boolean NOT NULL DEFAULT false,
  "cancel_at"               timestamptz,
  "canceled_at"             timestamptz,
  "ended_at"                timestamptz,
  "pause_starts_at"         timestamptz,
  "pause_resumes_at"        timestamptz,
  "past_due_since"          timestamptz,
  "amount_due_cents"        integer,
  "next_payment_attempt"    timestamptz,
  "last_payment_error"      text,
  "pm_brand"                text,
  "pm_last4"                text,
  "pm_exp_month"            integer,
  "pm_exp_year"             integer,
  "latest_invoice_id"       text,
  "gateway_synced_at"       timestamptz NOT NULL DEFAULT now(),
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_subscriptions_gateway_subscription_id_unique" UNIQUE ("gateway_subscription_id"),
  CONSTRAINT "billing_subscriptions_gateway_check" CHECK ("gateway" IN ('stripe', 'test')),
  CONSTRAINT "billing_subscriptions_status_check"
    CHECK ("status" IN ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled')),
  CONSTRAINT "billing_subscriptions_interval_check" CHECK ("interval" IN ('monthly', 'yearly'))
);

CREATE TABLE IF NOT EXISTS "core"."billing_invoices" (
  "id"                   text PRIMARY KEY,
  "org_id"               uuid NOT NULL,
  "gateway"              text NOT NULL,
  "number"               text,
  "status"               text NOT NULL,
  "billing_reason"       text,
  "currency"             text NOT NULL DEFAULT 'usd',
  "subtotal_cents"       integer NOT NULL DEFAULT 0,
  "discount_cents"       integer NOT NULL DEFAULT 0,
  "tax_cents"            integer NOT NULL DEFAULT 0,
  "total_cents"          integer NOT NULL DEFAULT 0,
  "amount_paid_cents"    integer NOT NULL DEFAULT 0,
  "amount_due_cents"     integer NOT NULL DEFAULT 0,
  "lines"                jsonb NOT NULL DEFAULT '[]'::jsonb,
  "period_start"         timestamptz,
  "period_end"           timestamptz,
  "issued_at"            timestamptz NOT NULL,
  "paid_at"              timestamptz,
  "attempt_count"        integer NOT NULL DEFAULT 0,
  "next_payment_attempt" timestamptz,
  "pm_last4"             text,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_invoices_status_check"
    CHECK ("status" IN ('draft', 'open', 'paid', 'void', 'uncollectible'))
);

CREATE INDEX IF NOT EXISTS "billing_invoices_org_issued_idx"
  ON "core"."billing_invoices" ("org_id", "issued_at" DESC);

ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "org_id" uuid;
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "gateway" text NOT NULL DEFAULT 'stripe';
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'processed';
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "error" text;
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 1;
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "received_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "core"."billing_events" ADD CONSTRAINT "billing_events_status_check"
  CHECK ("status" IN ('processed', 'ignored', 'failed'));
CREATE INDEX IF NOT EXISTS "billing_events_org_idx" ON "core"."billing_events" ("org_id", "received_at" DESC);

CREATE TABLE IF NOT EXISTS "core"."billing_audit_log" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL,
  "actor_user_id"  uuid,
  "actor_label"    text NOT NULL,
  "action"         text NOT NULL,
  "summary"        text NOT NULL,
  "data"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "event_id"       text,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "billing_audit_log_org_created_idx"
  ON "core"."billing_audit_log" ("org_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "core"."billing_managers" (
  "org_id"     uuid NOT NULL,
  "user_id"    uuid NOT NULL,
  "added_by"   uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_managers_pkey" PRIMARY KEY ("org_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "core"."billing_cancel_feedback" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL,
  "user_id"    uuid,
  "reason"     text,
  "detail"     text,
  "outcome"    text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_cancel_feedback_reason_check" CHECK ("reason" IS NULL OR "reason" IN
    ('too_expensive', 'missing_feature', 'switching_tool', 'not_using', 'seasonal', 'other')),
  CONSTRAINT "billing_cancel_feedback_outcome_check" CHECK ("outcome" IN ('canceled', 'paused', 'kept'))
);

CREATE TABLE IF NOT EXISTS "core"."billing_emails" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              uuid,
  "to_email"            text NOT NULL,
  "template"            text NOT NULL,
  "payload"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key"          text NOT NULL,
  "status"              text NOT NULL DEFAULT 'queued',
  "provider"            text,
  "provider_message_id" text,
  "subject"             text,
  "html"                text,
  "body_text"           text,
  "error"               text,
  "attempts"            integer NOT NULL DEFAULT 0,
  "send_after"          timestamptz NOT NULL DEFAULT now(),
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "sent_at"             timestamptz,
  CONSTRAINT "billing_emails_dedupe_key_unique" UNIQUE ("dedupe_key"),
  CONSTRAINT "billing_emails_status_check" CHECK ("status" IN ('queued', 'sent', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS "billing_emails_queue_idx"
  ON "core"."billing_emails" ("send_after") WHERE "status" = 'queued';

CREATE TABLE IF NOT EXISTS "core"."billing_test_objects" (
  "id"         text PRIMARY KEY,
  "kind"       text NOT NULL,
  "org_id"     uuid,
  "data"       jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_test_objects_kind_check"
    CHECK ("kind" IN ('customer', 'checkout_session', 'portal_session', 'subscription', 'invoice', 'payment_method'))
);

CREATE TABLE IF NOT EXISTS "core"."signup_intents" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      uuid NOT NULL,
  "org_id"       uuid,
  "selection"    jsonb,
  "profile"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source"       text NOT NULL DEFAULT 'direct',
  "step"         text NOT NULL DEFAULT 'company',
  "verify_skipped_at" timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "signup_intents_step_check" CHECK ("step" IN ('company', 'plan', 'verify', 'welcome', 'done')),
  CONSTRAINT "signup_intents_source_check" CHECK ("source" IN ('wizard', 'pricing', 'product', 'app', 'direct', 'invite'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "signup_intents_open_user_unique"
  ON "core"."signup_intents" ("user_id") WHERE "completed_at" IS NULL;
```

Notes on shapes:

- `billing_accounts.cart` and `signup_intents.selection` hold a `PlanSelection`. Always read them through
  `normalizeSelection`.
- `billing_accounts.address` is `{ line1, line2, city, state, postalCode, country }`, all optional strings,
  `country` an ISO 2 letter code.
- `billing_subscriptions.items` is `{ product, priceKey, quantity, unitCents, gatewayItemId }[]`.
- `billing_invoices.lines` is `{ description, product, quantity, unitCents, amountCents, proration }[]`
  (`product` may be null for lines the catalog does not know).
- `billing_events.id` stays the gateway event id (`evt_...`, test gateway `evt_test_...`).
- `billing_emails.html` and `body_text` are stored only when the provider is the dev outbox. Templates
  `verify_email` and `reset_password` have their `payload` set to `{}` as soon as they are sent.
- `billing_subscriptions.status` holds the gateway status. "Paused" is not a status; it is `pause_starts_at`
  and `pause_resumes_at` being set.
- `core.stripe_customers` is reused as is for both gateways (test ids start `cus_test_`). When
  `billing_accounts.gateway` differs from the gateway in use, the stored customer is treated as missing and
  replaced.
- The `ADD CONSTRAINT` on `billing_events` must be guarded so a second run does not fail (wrap it in a `DO`
  block that checks `pg_constraint`, like the FK blocks).

## 10. Gateway (foundation)

### 10.1 Types `gateway/types.ts`

```ts
export type GatewayKind = 'stripe' | 'test';
export type GatewaySubscriptionStatus =
  | 'incomplete' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled';

export interface GatewayItem { readonly id: string; readonly priceKey: PriceKey; readonly priceId: string;
                               readonly product: ProductId; readonly quantity: number; readonly unitCents: number }
export interface GatewaySubscription {
  readonly id: string; readonly customerId: string; readonly orgId: string | null;
  readonly status: GatewaySubscriptionStatus;
  readonly interval: BillingInterval;
  readonly items: readonly GatewayItem[];
  readonly currentPeriodStart: Date; readonly currentPeriodEnd: Date;
  readonly trialEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean; readonly cancelAt: Date | null;
  readonly canceledAt: Date | null; readonly endedAt: Date | null;
  readonly pauseResumesAt: Date | null;       // set while collection is paused
  readonly paymentMethod: PaymentMethodSummary | null;
  readonly latestInvoiceId: string | null;
}
export interface GatewayInvoiceLine { readonly description: string; readonly product: ProductId | null;
  readonly quantity: number; readonly unitCents: number; readonly amountCents: number; readonly proration: boolean }
export interface GatewayInvoice {
  readonly id: string; readonly customerId: string; readonly subscriptionId: string | null;
  readonly number: string | null;
  readonly status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  readonly billingReason: string | null;
  readonly subtotalCents: number; readonly discountCents: number; readonly taxCents: number;
  readonly totalCents: number; readonly amountPaidCents: number; readonly amountDueCents: number;
  readonly lines: readonly GatewayInvoiceLine[];
  readonly periodStart: Date | null; readonly periodEnd: Date | null;
  readonly issuedAt: Date; readonly paidAt: Date | null;
  readonly attemptCount: number; readonly nextPaymentAttempt: Date | null;
  readonly lastErrorCode: string | null; readonly paymentMethodLast4: string | null;
}
export interface GatewayCheckoutSession {
  readonly id: string; readonly orgId: string | null;
  readonly status: 'open' | 'complete' | 'expired';
  readonly customerId: string | null; readonly subscriptionId: string | null; readonly url: string | null;
}
export interface GatewayEvent {
  readonly id: string; readonly type: string; readonly createdAt: Date;
  readonly orgId: string | null; readonly customerId: string | null;
  readonly subscriptionId: string | null; readonly invoiceId: string | null;
  readonly checkoutSessionId: string | null;
  readonly payload: Record<string, unknown>; // raw event, stored in core.billing_events.payload
}
export interface ChangePreview {
  readonly dueTodayCents: number;       // charged now, 0 when the change is a decrease
  readonly creditCents: number;         // credit that lands on the next bill, 0 on an increase
  readonly newRecurringCents: number;   // each period after the change, before tax
  readonly recurringDeltaCents: number; // signed
  readonly nextChargeAt: Date;
  readonly prorationDate: Date;         // pass back unchanged to applyPlanChange
  readonly lines: readonly GatewayInvoiceLine[];
  readonly taxCents: number;
}
export interface ProfileInput { readonly email: string; readonly name: string;
  readonly address: BillingAddress | null; readonly taxId: { type: string; value: string } | null }

export interface BillingGateway {
  readonly kind: GatewayKind;
  ensureCustomer(input: { orgId: string; existingCustomerId: string | null; profile: ProfileInput }): Promise<{ customerId: string }>;
  updateCustomer(customerId: string, profile: ProfileInput): Promise<void>;
  createCheckoutSession(input: {
    orgId: string; customerId: string; selection: PlanSelection;
    trialEnd: Date | null; successUrl: string; cancelUrl: string;
  }): Promise<{ id: string; url: string }>;
  getCheckoutSession(id: string): Promise<GatewayCheckoutSession | null>;
  createPaymentUpdateSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  getSubscription(id: string): Promise<GatewaySubscription | null>;
  findSubscriptionForCustomer(customerId: string): Promise<GatewaySubscription | null>;
  previewChange(input: { subscriptionId: string; selection: PlanSelection; prorationDate: Date }): Promise<ChangePreview>;
  applyChange(input: { subscriptionId: string; selection: PlanSelection; prorationDate: Date }): Promise<GatewaySubscription>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<GatewaySubscription>;
  pause(subscriptionId: string, resumesAt: Date): Promise<GatewaySubscription>;
  resume(subscriptionId: string): Promise<GatewaySubscription>;
  payLatestInvoice(subscriptionId: string): Promise<GatewayInvoice>;
  getInvoice(id: string): Promise<GatewayInvoice | null>;
  listInvoices(customerId: string, limit: number): Promise<readonly GatewayInvoice[]>;
  getInvoicePdf(id: string): Promise<{ kind: 'redirect'; url: string } | { kind: 'bytes'; bytes: Uint8Array; filename: string }>;
  /** Throws WebhookSignatureError on a bad or missing signature. Never returns an unverified event. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): GatewayEvent;
}
export class WebhookSignatureError extends Error {}
export class GatewayCardError extends Error { readonly declineCode: string | null }
```

### 10.2 Config and mode `server/config.ts`

```ts
export interface BillingConfig {
  readonly mode: BillingMode;
  readonly stripeSecretKey: string | null;
  readonly stripeWebhookSecret: string | null;
  readonly stripePortalConfigurationId: string | null;
  readonly automaticTax: boolean;
  readonly testWebhookSecret: string;   // derived, see below
}
export function resolveBillingConfig(env?: NodeJS.ProcessEnv): BillingConfig;
export function createGateway(config: BillingConfig, db: BillingDb, portalUrl: string): BillingGateway | null;
```

| `STRIPE_SECRET_KEY` | `NODE_ENV` | `mode` | Gateway | UI label |
|:-|:-|:-|:-|:-|
| starts `sk_live_` (and webhook secret set) | any | `live` | Stripe | none |
| starts `sk_test_` (and webhook secret set) | any | `stripe_test` | Stripe | "Test mode" |
| set, webhook secret missing | any | `unavailable` | none | "Billing is not available right now" |
| not set | not `production` | `test_gateway` | test | "Test mode" |
| not set | `production` | `unavailable` | none | "Billing is not available right now" |

There is no env switch that turns the test gateway on in production. `testWebhookSecret` is
`BILLING_TEST_WEBHOOK_SECRET` when set, else `HMAC-SHA256(BETTER_AUTH_SECRET, 'kitstak-billing-test-gateway')`
as hex. When `mode` is `unavailable`, reads still work (plan state, invoices already cached), every money
action returns `billing_unavailable`, and no entitlement changes.

### 10.3 Stripe adapter `gateway/stripe.ts`

`createStripeGateway(config: BillingConfig): BillingGateway`. Rules:

- The only file that imports `stripe`. Lazy client, SDK default API version (do not pass `apiVersion`),
  `maxNetworkRetries: 2`, `appInfo: { name: 'KitStak Portal' }`.
- Price ids come from `prices.list({ lookup_keys, active: true })`, cached in memory for 10 minutes. A missing
  lookup key is a `gateway_error` with a log line that names the key.
- Read the period from the first subscription item when the subscription has no top level period fields
  (newer Stripe API versions moved them). Read the invoice's subscription id the same defensive way. No other
  file may know Stripe object shapes.
- Checkout Session: `mode: 'subscription'`, `customer`, `client_reference_id: orgId`, one `line_items` entry
  per product with the `priceKey` price and the quantity, no `adjustable_quantity`,
  `subscription_data: { trial_end?, metadata: { kitstak_org_id } }`,
  `allow_promotion_codes: true`, `payment_method_collection: 'always'`, `billing_address_collection: 'auto'`,
  section 5.7 tax fields, `metadata: { kitstak_org_id }`, and
  `custom_text.submit.message`: "Cancel any time in Billing. Your data stays yours." When the plan is a bundle
  or yearly, the same message gets one more sentence in front: "These prices already include your bundle
  discount." or "These prices already include your yearly discount." or "These prices already include your
  yearly and bundle discounts."
- `trialEnd` is passed only when it is at least 48 hours ahead (a Stripe rule). The caller decides the value
  (section 11.5).
- `createPaymentUpdateSession`: Billing Portal session with `flow_data.type = 'payment_method_update'`,
  `configuration` when set, `flow_data.after_completion = { type: 'redirect', redirect: { return_url } }`.
- `applyChange`: one `subscriptions.update` with the full new item list (price swaps for bundle changes and
  interval changes, quantity changes, added items, removed items with `deleted: true`), `proration_date`,
  `proration_behavior: 'always_invoice'` when `previewChange` said `dueTodayCents > 0`, else
  `'create_prorations'`, and `payment_behavior: 'pending_if_incomplete'` so a declined card changes nothing.
  A decline throws `GatewayCardError`.
- `previewChange`: `invoices.createPreview` with the same items and the same `proration_date`.
- `pause`: `pause_collection: { behavior: 'void', resumes_at }`. `resume`: `pause_collection: ''`.
- `verifyWebhook`: `stripe.webhooks.constructEvent(rawBody, header, secret)`. The route must pass the raw text.

### 10.4 Test gateway `gateway/test.ts`

`createTestGateway(input: { db: BillingDb; portalUrl: string; webhookSecret: string; now?: () => Date }): BillingGateway`.

- State lives in `core.billing_test_objects` (one JSON document per customer, session, subscription, invoice,
  payment method). Ids: `cus_test_`, `cs_test_`, `bps_test_`, `sub_test_`, `in_test_`, `pm_test_`, `evt_test_`,
  each followed by a random hex string. Prices are `price_test_<lookup key>` with amounts from the catalog.
- Hosted pages are portal pages (billing-ui): checkout URL `${portalUrl}/test-gateway/checkout/<sessionId>`,
  card update URL `${portalUrl}/test-gateway/card/<sessionId>`.
- **Same path as Stripe.** Every state change builds an event, signs it with `webhookSecret`, and hands the raw
  body and signature to `processWebhook` (section 12), the same function the Stripe route calls. The header
  format is `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, verified with a constant time compare and
  a 5 minute tolerance. Nothing in the test gateway writes `core.entitlements`, `billing_subscriptions` or
  `billing_invoices` directly.
- Proration uses the same rule as Stripe: `round(unit x quantity change x seconds left / seconds in period)`.
- Invoices get numbers `TEST-0001`, `TEST-0002` per customer and a PDF from `renderInvoicePdf`.

```ts
export const TEST_CARDS: readonly {
  readonly number: string; readonly label: string;
  readonly outcome: 'success' | 'declined' | 'insufficient_funds' | 'requires_action' | 'fails_on_renewal';
}[];
// 4242 4242 4242 4242  Works
// 4000 0000 0000 0002  Declined
// 4000 0000 0000 9995  Not enough money
// 4000 0027 6000 3184  Needs bank approval (3D Secure step with Approve and Fail buttons)
// 4000 0000 0000 0341  Works now, fails at the next renewal

export function getTestCheckout(db: BillingDb, sessionId: string): Promise<TestCheckoutView | null>;
export function completeTestCheckout(rt: BillingRuntime, input: {
  sessionId: string; cardNumber: string; expMonth: number; expYear: number; cvc: string;
  name: string; postalCode: string; promoCode?: string; approve3ds?: boolean;
}): Promise<BillingResult<{ status: 'complete' | 'requires_action'; redirectUrl: string }>>;
export function cancelTestCheckout(rt: BillingRuntime, sessionId: string): Promise<{ redirectUrl: string }>;
export function getTestCardUpdate(db: BillingDb, sessionId: string): Promise<TestCardUpdateView | null>;
export function completeTestCardUpdate(rt: BillingRuntime, input: { sessionId: string; cardNumber: string;
  expMonth: number; expYear: number; cvc: string }): Promise<BillingResult<{ redirectUrl: string }>>;

/** Test tools. Each returns billing_unavailable unless rt.mode is 'test_gateway'. */
export function testShiftTime(rt: BillingRuntime, input: { orgId: string; days: number }): Promise<BillingResult<PlanState>>;
export function testRunDue(rt: BillingRuntime, input?: { orgId?: string }): Promise<{ renewed: number; failed: number }>;
export function testFailNextPayment(rt: BillingRuntime, input: { orgId: string }): Promise<BillingResult<null>>;
export function testSendEvent(rt: BillingRuntime, input: { type: string; orgId: string }): Promise<{ rawBody: string; signature: string }>;

export interface TestCheckoutView {
  readonly sessionId: string; readonly orgName: string; readonly status: 'open' | 'complete' | 'expired';
  readonly quote: Quote; readonly dueTodayCents: number; readonly firstChargeAt: Date; readonly trialEnd: Date | null;
  readonly cancelUrl: string;
}
export interface TestCardUpdateView { readonly sessionId: string; readonly orgName: string;
  readonly current: PaymentMethodSummary | null; readonly returnUrl: string }
```

`testShiftTime` moves the org's stored dates back by `days` (trial dates, entitlement period ends, the test
subscription periods and `past_due_since`), then calls `testRunDue` for that org. This is how tests reach "trial
ended" or "renewal day" without waiting. The one promo code the test gateway knows is `TEST10` (10% off the
first charge, shown as its own line on the test checkout page and on that invoice).

The signup intent is closed by the signup lane: `saveSetupProfile` calls `completeSignupIntent` when the
welcome wizard is saved.

## 11. Server API `@kitstak/billing/server` (foundation)

### 11.1 Runtime

```ts
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
type AnyPg = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;
export type BillingReadDb = Pick<AnyPg, 'select' | 'execute'>;
export type BillingDb = Pick<AnyPg, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction'>;

export interface BillingRuntime {
  readonly db: BillingDb;
  readonly config: BillingConfig;
  readonly mode: BillingMode;
  readonly gateway: BillingGateway | null;  // null when mode is 'unavailable'
  readonly portalUrl: string;               // no trailing slash
  readonly now: () => Date;
}
export function createBillingRuntime(input: { db: BillingDb; env?: NodeJS.ProcessEnv; portalUrl: string; now?: () => Date }): BillingRuntime;
/** Works for node-postgres ({ rows }) and postgres-js (array) results of db.execute. */
export function rows<T>(result: unknown): T[];
```

Every write function takes `actor: BillingActor = { userId: string | null; label: string }` (`label` is the
person's name, or "KitStak" for system writes) and records one audit row (11.9). Every function returns
`BillingResult<T>` unless noted. None of them checks the caller's role: the portal action does that first
with `getBillingAccess` (16.4). All of them check plan facts (trial used, below usage, and so on).

### 11.2 Reading state

```ts
export function getPlanState(rt: Pick<BillingRuntime, 'db' | 'mode' | 'now'>, orgId: string): Promise<PlanState>;

/** For product apps. Reads only. Cached 60 seconds per process, except that any answer with a notice of tone
 *  'warning' or 'danger', or access other than 'full', is read again before it is returned. */
export interface AppPlanView {
  readonly access: ModuleAccess;
  readonly notice: PlanNotice | null;
  readonly lock: PlanLock | null;       // set only when access is 'locked'
  readonly badges: Readonly<Record<ProductId, PlanBadge>>;
  readonly usage: PlanUsage;
}
export function getAppPlanView(db: BillingReadDb, input: {
  orgId: string; module: ProductId; userId: string; role: string; portalUrl: string;
  allowAll: boolean;      // the app's own entitlementsAllowAll() answer
  timeZone?: string; now?: Date;
}): Promise<AppPlanView>;
export function clearPlanCache(orgId?: string): void;
```

`getAppPlanView` with `allowAll: true` and no trial and no subscription returns `{ access: 'full', notice:
null, lock: null }` so local dev stays quiet. With `allowAll: true` and a real trial or plan, it returns the
real notice but `access: 'full'`.

### 11.3 Who may do what

```ts
export interface BillingAccess {
  readonly isOwner: boolean; readonly isAdmin: boolean; readonly isBillingManager: boolean;
  readonly canView: boolean;            // owner, admin or billing manager
  readonly canManage: boolean;          // owner or billing manager
  readonly canStartTrial: boolean;      // owner, admin or billing manager
  readonly canAssignManagers: boolean;  // owner
  readonly ownerName: string | null;
}
export function getBillingAccess(db: BillingReadDb, input: { orgId: string; userId: string; role: string }): Promise<BillingAccess>;
export interface BillingManagerRow { readonly userId: string; readonly name: string; readonly email: string;
  readonly kind: 'owner' | 'manager'; readonly addedAt: Date | null }
export function listBillingHolders(db: BillingReadDb, orgId: string): Promise<readonly BillingManagerRow[]>;
export function addBillingManager(rt: BillingRuntime, input: { orgId: string; userId: string; actor: BillingActor }): Promise<BillingResult<null>>;
export function removeBillingManager(rt: BillingRuntime, input: { orgId: string; userId: string; actor: BillingActor }): Promise<BillingResult<null>>;
```

`role` is the raw `core.member.role` string (a comma list; a `deactivated:` prefix means no access at all).
A billing manager must be an active member of the org; `addBillingManager` returns `not_found` otherwise.

### 11.4 Trial and cart

```ts
export function canStartTrial(db: BillingReadDb, input: { orgId: string; userId: string }):
  Promise<{ ok: true } | { ok: false; reason: 'org_had_trial' | 'user_had_trial' | 'has_plan' }>;
export function startTrial(rt: BillingRuntime, input: { orgId: string; selection: PlanSelection; actor: BillingActor }): Promise<BillingResult<PlanState>>;
/** During a trial: add or remove apps. Added apps share the same end date. */
export function changeTrialProducts(rt: BillingRuntime, input: { orgId: string; products: Stack; actor: BillingActor }): Promise<BillingResult<PlanState>>;
export function saveCart(rt: BillingRuntime, input: { orgId: string; selection: PlanSelection; actor: BillingActor }): Promise<BillingResult<PlanSelection>>;
```

`startTrial` in one transaction: upsert `billing_accounts` (`trial_started_at = now`, `trial_ends_at = now +
14 x 24 hours`, `trial_started_by`, `cart = selection`), `setEntitlement` per product (skips manual grants),
audit `trial.started`, `enqueueEmail` template `welcome` to the actor. It works in every mode, including
`unavailable` (a trial needs no gateway). It returns `trial_used` when `canStartTrial` says no, and
`invalid_selection` for an empty stack.

### 11.5 Checkout

```ts
export function createCheckout(rt: BillingRuntime, input: {
  orgId: string; orgName: string; selection: PlanSelection; actor: BillingActor; actorEmail: string;
}): Promise<BillingResult<{ url: string; sessionId: string; dueTodayCents: number; firstChargeAt: Date }>>;
/** Called by the success page and by the webhook. Safe to call many times. */
export function syncCheckoutSession(rt: BillingRuntime, input: { orgId: string; sessionId: string }): Promise<BillingResult<PlanState>>;
/** What the review step shows. No gateway call. */
export function checkoutPreview(rt: Pick<BillingRuntime, 'db' | 'mode' | 'now'>, input: { orgId: string; selection: PlanSelection }):
  Promise<BillingResult<{ quote: Quote; dueTodayCents: number; firstChargeAt: Date; trialEnd: Date | null; taxNote: boolean }>>;
```

Rules inside `createCheckout`:

1. `already_subscribed` when the org has a subscription that is not `canceled` (use `applyPlanChange`).
2. `below_usage` when `selection.seats < usage.seatsUsed` (and a per user product or Pulse is in the stack) or
   `selection.warehouses < usage.warehousesUsed`. The message names the number: "You have 6 people. Pick 6
   seats or more."
3. Save the cart. Ensure the customer (`core.stripe_customers`, `billing_accounts.gateway`).
4. Trial end passed to the gateway: when the free trial is still running, `max(trial_ends_at, now + 48 hours +
   5 minutes)`; when there is no trial time left, `null` (charged today). So a person never loses trial days
   by adding a card early, and "Due today" is $0.00 during the trial.
5. Success URL `${portalUrl}/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}`; cancel URL
   `${portalUrl}/billing/checkout/canceled`. Both are built here from `rt.portalUrl`, never from input.
6. Rate limit: 10 sessions per org per 10 minutes (`rate_limited`).
7. Audit `checkout.started`.

### 11.6 Changing a paid plan

```ts
export function previewPlanChange(rt: BillingRuntime, input: { orgId: string; selection: PlanSelection }): Promise<BillingResult<ChangePreview>>;
export function applyPlanChange(rt: BillingRuntime, input: {
  orgId: string; selection: PlanSelection; prorationDate: Date; expectedDueTodayCents: number; actor: BillingActor;
}): Promise<BillingResult<PlanState>>;
```

One rule for every change (seats, warehouses, adding or removing a product, monthly to yearly and back): it
starts right away, an increase is charged now for the time left, a decrease becomes credit on the next bill.
`applyPlanChange` returns `price_changed` when a fresh preview differs from `expectedDueTodayCents` by more
than 1 cent per line, `below_usage` like checkout, `card_declined` when the card fails (nothing changes), and
`invalid_selection` for an empty stack (use cancel). After the gateway call it applies the returned snapshot
through the same `applySubscriptionSnapshot` as the webhook, then audits `plan.changed` with before and after.

### 11.7 Cancel, pause, payment

```ts
export type CancelReason = 'too_expensive' | 'missing_feature' | 'switching_tool' | 'not_using' | 'seasonal' | 'other';
export function scheduleCancel(rt: BillingRuntime, input: { orgId: string; reason: CancelReason | null; detail: string | null; actor: BillingActor }): Promise<BillingResult<PlanState>>;
export function undoCancel(rt: BillingRuntime, input: { orgId: string; actor: BillingActor }): Promise<BillingResult<PlanState>>;
export function pausePlan(rt: BillingRuntime, input: { orgId: string; months: 1 | 2 | 3; reason: CancelReason | null; actor: BillingActor }): Promise<BillingResult<PlanState>>;
export function undoPause(rt: BillingRuntime, input: { orgId: string; actor: BillingActor }): Promise<BillingResult<PlanState>>; // before or during the pause
export function createPaymentUpdateSession(rt: BillingRuntime, input: { orgId: string; actor: BillingActor }): Promise<BillingResult<{ url: string }>>;
/** Pays the open invoice now with the card on file. Used after a card update and by the "Pay now" button. */
export function retryPayment(rt: BillingRuntime, input: { orgId: string; actor: BillingActor }): Promise<BillingResult<PlanState>>;
```

- `scheduleCancel` sets cancel at period end, stores one `billing_cancel_feedback` row (outcome `canceled`),
  audits `cancel.scheduled`, queues `cancel_scheduled`. `undoCancel` clears it and audits `cancel.undone`.
- `pausePlan` is for monthly plans only (`yearly_no_pause` otherwise). The pause starts at the current period
  end and resumes `months` calendar months after that, minus one hour (so the gateway resumes just before the
  renewal invoice). Stores `pause_starts_at`, `pause_resumes_at`, a feedback row (outcome `paused`), audit
  `pause.scheduled`, email `paused`.
- The return URL for the card update is `${portalUrl}/billing?updated=card`. The billing home page calls
  `retryPayment` when it loads with `updated=card` and the phase is `past_due` or `unpaid`.

### 11.8 Invoices and profile

```ts
export interface InvoiceRow { readonly id: string; readonly number: string | null; readonly status: GatewayInvoice['status'];
  readonly issuedAt: Date; readonly totalCents: number; readonly amountDueCents: number; readonly taxCents: number;
  readonly periodStart: Date | null; readonly periodEnd: Date | null; readonly lines: readonly GatewayInvoiceLine[] }
export function listInvoices(db: BillingReadDb, input: { orgId: string; limit?: number; before?: Date }): Promise<readonly InvoiceRow[]>;
export function getInvoice(db: BillingReadDb, input: { orgId: string; invoiceId: string }): Promise<InvoiceRow | null>;
export function getInvoicePdf(rt: BillingRuntime, input: { orgId: string; invoiceId: string }):
  Promise<BillingResult<{ kind: 'redirect'; url: string } | { kind: 'bytes'; bytes: Uint8Array; filename: string }>>;

export interface BillingAddress { readonly line1?: string; readonly line2?: string; readonly city?: string;
  readonly state?: string; readonly postalCode?: string; readonly country?: string }
export interface BillingProfile { readonly billingEmail: string | null; readonly companyName: string | null;
  readonly address: BillingAddress; readonly taxIdType: string | null; readonly taxIdValue: string | null }
export function getBillingProfile(db: BillingReadDb, orgId: string): Promise<BillingProfile>;
export function updateBillingProfile(rt: BillingRuntime, input: { orgId: string; profile: BillingProfile; actor: BillingActor }): Promise<BillingResult<BillingProfile>>;
```

`getInvoicePdf` checks that the invoice belongs to the org (`not_found` otherwise) before it asks the
gateway. `updateBillingProfile` validates (email shape, country code, lengths), saves, pushes to the gateway
customer when one exists, and audits `profile.updated`.

### 11.9 Usage, audit, outbox, rate limit, intents

```ts
export function countBillableSeats(db: BillingReadDb, orgId: string): Promise<{ used: number; pendingInvites: number }>;
/** Active rows in the org's WMS schema (core.wms_tenants). null when the org has no active WMS schema. */
export function countWarehouses(db: BillingReadDb, orgId: string): Promise<number | null>;
export function checkSeatAvailable(db: BillingReadDb, input: { orgId: string; adding: number; role: string; ignoreInvitationId?: string }):
  Promise<{ ok: true } | { ok: false; code: 'seat_limit'; message: string; limit: number; used: number; pulseOnly: boolean }>;
export function checkWarehouseAvailable(db: BillingReadDb, input: { orgId: string; adding: number }):
  Promise<{ ok: true } | { ok: false; code: 'warehouse_limit'; message: string; paid: number; used: number }>;

export type AuditAction =
  | 'trial.started' | 'trial.products_changed' | 'cart.saved' | 'checkout.started' | 'plan.started'
  | 'plan.changed' | 'payment.succeeded' | 'payment.failed' | 'payment.retried' | 'card.updated'
  | 'cancel.scheduled' | 'cancel.undone' | 'pause.scheduled' | 'pause.undone' | 'plan.paused'
  | 'plan.resumed' | 'plan.ended' | 'profile.updated' | 'manager.added' | 'manager.removed'
  | 'email.sent' | 'signup.guided_requested' | 'test.tool';
export interface AuditEntry { readonly orgId: string; readonly actor: BillingActor; readonly action: AuditAction;
  readonly summary: string; readonly data?: Record<string, unknown>; readonly eventId?: string }
export function recordAudit(db: Pick<BillingDb, 'insert'>, entry: AuditEntry): Promise<void>;
export interface AuditRow { readonly id: string; readonly at: Date; readonly actorLabel: string;
  readonly action: AuditAction; readonly summary: string; readonly data: Record<string, unknown> }
export function listAuditLog(db: BillingReadDb, input: { orgId: string; limit?: number; before?: Date }): Promise<readonly AuditRow[]>;

export function enqueueEmail<T extends EmailTemplateId>(db: Pick<BillingDb, 'insert'>, input: {
  orgId: string | null; to: string; template: T; payload: EmailPayloads[T]; dedupeKey: string; sendAfter?: Date;
}): Promise<void>; // ON CONFLICT (dedupe_key) DO NOTHING
/** Billing email if set, plus every owner and billing manager. Lower case, no repeats. */
export function billingRecipients(db: BillingReadDb, orgId: string): Promise<readonly string[]>;

/** Counter rows in core.rate_limit under keys that start 'billing:'. */
export function enforceRateLimit(db: BillingDb, input: { key: string; windowSeconds: number; max: number }): Promise<boolean>;

export interface SignupIntent { readonly id: string; readonly userId: string; readonly orgId: string | null;
  readonly selection: PlanSelection | null; readonly profile: SignupHandoff['profile'];
  readonly source: HandoffSource | 'invite'; readonly step: 'company' | 'plan' | 'verify' | 'welcome' | 'done';
  readonly verifySkippedAt: Date | null }
export function upsertSignupIntent(db: BillingDb, input: { userId: string; orgId?: string | null;
  handoff?: SignupHandoff; step?: SignupIntent['step']; verifySkipped?: boolean }): Promise<SignupIntent>;
export function getOpenSignupIntent(db: BillingReadDb, userId: string): Promise<SignupIntent | null>;
export function completeSignupIntent(db: BillingDb, userId: string): Promise<void>;
```

A seat is used by each `core.member` row of the org whose role does not start with `deactivated:` and is not
made only of roles in `CATALOG.freeRoles`. Pending invites count when they are not expired, are `pending`, and
their role is not free. `checkSeatAvailable` says `ok` when the role is free, when the plan phase is `none`,
`trial` or `trial_ended`, when `seatLimit` is null, and when `used + pendingInvites + adding <= seatLimit`.
`summary` in the audit log is a full plain sentence a customer can read, for example "Maya Chen added 1 seat.
The plan is now 6 seats." It follows the copy rules.

## 12. Webhooks and sync (foundation)

### 12.1 Routes

| Route file | Method | Does |
|:-|:-|:-|
| `apps/portal/src/app/api/billing/webhooks/stripe/route.ts` | POST | `processWebhook` with the Stripe gateway. 503 with a plain JSON message when mode is not `live` or `stripe_test`. |
| `apps/portal/src/app/api/billing/webhooks/test/route.ts` | POST | `processWebhook` with the test gateway. 404 when mode is not `test_gateway`. |

Both: `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`, read the body with
`await request.text()`, no session, no CORS headers, no body logging. Header names: `stripe-signature` and
`kitstak-test-signature`.

### 12.2 `processWebhook`

```ts
export type WebhookOutcome =
  | { readonly status: 400; readonly result: 'bad_signature' }
  | { readonly status: 200; readonly result: 'processed' | 'duplicate' | 'ignored'; readonly eventId: string }
  | { readonly status: 500; readonly result: 'failed'; readonly eventId: string };
export function processWebhook(rt: BillingRuntime, input: { rawBody: string; signature: string | null }): Promise<WebhookOutcome>;
```

Steps, in order:

1. `gateway.verifyWebhook`. A `WebhookSignatureError` gives 400 and writes nothing at all.
2. Look up `core.billing_events` by event id. A row with status `processed` or `ignored` gives 200
   `duplicate`. Nothing else is touched.
3. Find the org: event `orgId`, else `core.stripe_customers` by customer id. None: insert the row with status
   `ignored`, return 200.
4. In one transaction: insert the ledger row (or update a `failed` row, `attempts + 1`) with status
   `processed`, then run the handler. The handler never trusts the event body for state. It fetches the
   current object from the gateway and applies the snapshot, so late or repeated events cannot move state
   backward.
5. If the handler throws: roll back, then upsert the ledger row as `failed` with the error text, return 500 so
   the gateway retries.
6. After commit: `clearEntitlementsCache(orgId)` and `clearPlanCache(orgId)`.

| Event | Handler |
|:-|:-|
| `checkout.session.completed` | `syncCheckoutSession` (fetch session, fetch its subscription, apply) |
| `checkout.session.expired` | audit only when the org has no plan; nothing else |
| `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed` | fetch subscription, `applySubscriptionSnapshot` |
| `invoice.finalized`, `invoice.voided`, `invoice.marked_uncollectible` | fetch invoice, `applyInvoiceSnapshot` |
| `invoice.paid` | apply invoice, refresh subscription, audit `payment.succeeded`, queue `receipt` when `amountPaidCents > 0` |
| `invoice.payment_failed` | apply invoice, refresh subscription, audit `payment.failed`, queue `payment_failed` (dedupe key includes the attempt count) |
| `invoice.payment_action_required` | apply invoice, queue `payment_action_required` |
| `customer.updated`, `payment_method.attached` | refresh subscription (card summary), audit `card.updated` when the last 4 changed |
| anything else | status `ignored` |

```ts
export function applySubscriptionSnapshot(db: BillingDb, input: { orgId: string; gateway: GatewayKind;
  subscription: GatewaySubscription; latestInvoice: GatewayInvoice | null; eventId?: string; now: Date }): Promise<void>;
export function applyInvoiceSnapshot(db: BillingDb, input: { orgId: string; gateway: GatewayKind; invoice: GatewayInvoice }): Promise<void>;
/** Fetches the org's subscription and latest invoice from the gateway and applies both. */
export function refreshFromGateway(rt: BillingRuntime, orgId: string): Promise<BillingResult<PlanState>>;
```

`applySubscriptionSnapshot` upserts `billing_subscriptions`, sets `past_due_since` (the latest invoice's
`issuedAt`, kept once set, cleared when status leaves `past_due`), writes entitlement rows by the table in
section 8 (through `setEntitlement`, so manual grants are never touched), cancels entitlement rows of products
that left the plan, and writes the first `plan.started`, `plan.paused`, `plan.resumed` or `plan.ended` audit
row and email when the phase moved. A subscription with status `incomplete` writes the subscription row and no
entitlement, so a declined first payment never grants access.

## 13. Emails (lifecycle builds, foundation defines the types)

### 13.1 `email-types.ts` (foundation, pure)

```ts
export type EmailTemplateId =
  | 'verify_email' | 'reset_password' | 'invitation' | 'welcome' | 'trial_ending' | 'trial_ended'
  | 'plan_started' | 'receipt' | 'payment_failed' | 'payment_action_required' | 'grace_ending'
  | 'cancel_scheduled' | 'paused' | 'plan_ended';

interface Base { readonly orgName: string; readonly portalUrl: string }
export interface EmailPayloads {
  verify_email: { readonly code: string; readonly minutes: number };
  reset_password: { readonly code: string; readonly minutes: number };
  invitation: Base & { readonly inviterName: string; readonly acceptUrl: string; readonly expiresAt: string };
  welcome: Base & { readonly firstName: string; readonly products: Stack; readonly trialEndsAt: string };
  trial_ending: Base & { readonly daysLeft: 7 | 3 | 1; readonly trialEndsAt: string; readonly totalCents: number;
                         readonly interval: BillingInterval; readonly products: Stack };
  trial_ended: Base & { readonly trialEndedAt: string; readonly products: Stack };
  plan_started: Base & { readonly products: Stack; readonly totalCents: number; readonly interval: BillingInterval;
                         readonly firstChargeAt: string; readonly dueTodayCents: number };
  receipt: Base & { readonly invoiceId: string; readonly invoiceNumber: string | null; readonly amountPaidCents: number;
                    readonly taxCents: number; readonly paidAt: string; readonly last4: string | null;
                    readonly lines: readonly { description: string; amountCents: number }[]; readonly nextChargeAt: string | null };
  payment_failed: Base & { readonly amountDueCents: number; readonly last4: string | null; readonly nextRetryAt: string | null;
                           readonly accessChangesAt: string; readonly attempt: number };
  payment_action_required: Base & { readonly amountDueCents: number; readonly last4: string | null };
  grace_ending: Base & { readonly amountDueCents: number; readonly accessChangesAt: string };
  cancel_scheduled: Base & { readonly endsAt: string };
  paused: Base & { readonly startsAt: string; readonly resumesAt: string };
  plan_ended: Base & { readonly endedAt: string };
}
```

All dates in payloads are ISO strings. Templates format them with `formatDay`.

### 13.2 `@kitstak/billing/emails` (lifecycle)

```ts
export interface RenderedEmail { readonly subject: string; readonly html: string; readonly text: string }
export function renderEmail<T extends EmailTemplateId>(template: T, payload: EmailPayloads[T]): RenderedEmail;

export type EmailProvider = 'resend' | 'outbox' | 'none';
export function resolveEmailProvider(env?: NodeJS.ProcessEnv): EmailProvider;
/** Renders and sends at once, and records the row in core.billing_emails. For codes and other mail a person is waiting for. */
export function sendEmailNow<T extends EmailTemplateId>(db: BillingDb, input: {
  orgId: string | null; to: string; template: T; payload: EmailPayloads[T]; dedupeKey: string;
}): Promise<{ ok: boolean; provider: EmailProvider; error?: string }>;
/** Sends queued rows whose send_after has passed. Locks rows with FOR UPDATE SKIP LOCKED. Up to 3 attempts. */
export function deliverQueuedEmails(db: BillingDb, options?: { limit?: number; now?: Date }): Promise<{ sent: number; failed: number; skipped: number }>;
export interface OutboxRow { readonly id: string; readonly to: string; readonly template: EmailTemplateId; readonly subject: string | null;
  readonly status: string; readonly createdAt: Date; readonly sentAt: Date | null; readonly html: string | null; readonly text: string | null }
export function listOutbox(db: BillingReadDb, options?: { limit?: number; to?: string }): Promise<readonly OutboxRow[]>;
```

| `EMAIL_PROVIDER` | `RESEND_API_KEY` | `NODE_ENV` | Provider |
|:-|:-|:-|:-|
| `resend` or unset | set | any | `resend` (POST `https://api.resend.com/emails` with `fetch`, `Idempotency-Key` = dedupe key) |
| `outbox` or unset | not set | not `production` | `outbox` (row stored with html and text, shown at `/dev/outbox`) |
| any | not set | `production` | `none`: rows stay `queued`, one error log per run, GO-LIVE covers it |

`EMAIL_FROM` is required for `resend` (for example `KitStak <billing@your-domain>`; the real address is set
at go live, never in the repo). `EMAIL_REPLY_TO` is optional. Templates are plain TypeScript functions that
return table based HTML with inline styles and a text version. No React Email, no new dependency.

## 14. Jobs `@kitstak/billing/jobs` (lifecycle)

```ts
export interface TickReport { readonly emails: { sent: number; failed: number; skipped: number };
  readonly reminders: number; readonly reconciled: number; readonly testRenewals: number; readonly tookMs: number }
export function runBillingTick(rt: BillingRuntime, options?: { only?: readonly ('emails' | 'reminders' | 'reconcile' | 'test')[] }): Promise<TickReport>;
export function queueTrialReminders(rt: BillingRuntime): Promise<number>;
export function queueGraceReminders(rt: BillingRuntime): Promise<number>;
export function reconcileSubscriptions(rt: BillingRuntime, options?: { limit?: number }): Promise<number>;
```

Route `apps/portal/src/app/api/billing/jobs/tick/route.ts`, GET and POST. Auth: header
`Authorization: Bearer ${CRON_SECRET}`. Outside production, when `CRON_SECRET` is not set, requests are
allowed. In production with no `CRON_SECRET` the route answers 503. `apps/portal/vercel.json` gets a cron for
`/api/billing/jobs/tick` every minute (the WMS project already runs a one minute cron).

Each tick, in order: `deliverQueuedEmails` (limit 50); `queueTrialReminders` (orgs in phase `trial` whose days
left is 7, 3 or 1 queue `trial_ending`; orgs whose trial ended in the last 24 hours with no plan queue
`trial_ended`; dedupe key `trial:<orgId>:<days>` makes each go out once); `queueGraceReminders` (phase
`past_due` with 1 day of grace left queues `grace_ending`, key `grace:<orgId>:<past_due_since>`);
`reconcileSubscriptions` (at most 20 rows where status is `past_due`, `incomplete`, or a pause or cancel date
has passed and `gateway_synced_at` is older than 1 hour: `refreshFromGateway`); in `test_gateway` mode,
`testRunDue`. Reminder emails go to `billingRecipients`. Every email sent writes audit `email.sent`.

## 15. Auth changes

### 15.1 `packages/auth` (foundation, passthrough only)

```ts
// options.ts
export type OrganizationPluginExtras = Pick<Parameters<typeof organization>[0] & object,
  'sendInvitationEmail' | 'organizationHooks'>;
export const organizationPlugin: (extras?: OrganizationPluginExtras) => ReturnType<typeof organization>;

// create-auth.ts, added to CreateAuthOptions
readonly organization?: OrganizationPluginExtras;                 // merged into the organization plugin
readonly socialProviders?: BetterAuthOptions['socialProviders'];  // passed through when set
```

`createAuth` builds `organizationPlugin(options.organization)` in place of the static one from
`sharedAuthOptions.plugins`. `sharedAuthOptions` itself is unchanged (the schema generator uses it). Add rate
limit rules: `/email-otp/send-verification-otp` 5 per 10 minutes, `/email-otp/verify-email` 10 per 10 minutes,
`/email-otp/request-password-reset` and `/forget-password/email-otp` 5 per 10 minutes, `/email-otp/reset-password`
10 per 10 minutes, `/organization/invite-member` 30 per 10 minutes. When `socialProviders` is set, also set
`account.accountLinking = { enabled: true, trustedProviders: ['google', 'microsoft'] }`. Nothing else changes.

### 15.2 `billingOrganizationOptions` (foundation, in `@kitstak/billing/server`)

```ts
export function billingOrganizationOptions(input: {
  db: BillingDb; portalUrl: string; allowAll: () => boolean;
}): OrganizationPluginExtras;
```

Every app that mounts Better Auth passes this as `createAuth({ organization: ... })`: portal (signup lane),
CRM, WMS, Projects, Pulse (apps lane). It returns:

- `sendInvitationEmail`: `enqueueEmail` template `invitation`, accept link
  `${portalUrl}/invite/<invitationId>`, dedupe key `invite:<invitationId>`.
- `organizationHooks.beforeCreateInvitation`, `beforeAddMember`, `beforeAcceptInvitation`,
  `beforeUpdateMemberRole`: call `checkSeatAvailable`. On a miss throw Better Auth `APIError('FORBIDDEN',
  { code: 'SEAT_LIMIT_REACHED', message })`. Skipped when `allowAll()` is true and the org has no paid plan.
- `organizationHooks.beforeDeleteOrganization`: throws `APIError('FORBIDDEN', { code: 'PLAN_ACTIVE',
  message: 'Cancel your plan before you delete this organization.' })` when the org has a subscription that is
  not `canceled`.

### 15.3 Portal `auth.ts` (signup lane)

Adds to the existing `createAuth` call: `organization: billingOrganizationOptions({ db, portalUrl, allowAll:
isDevAllowAll })`; `extraPlugins: [emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5,
sendVerificationOnSignUp: true, overrideDefaultEmailVerification: true, disableSignUp: true,
sendVerificationOTP })]` from `better-auth/plugins`, where `sendVerificationOTP({ email, otp, type })` calls
`sendEmailNow` with `verify_email` for type `email-verification` and `reset_password` for type
`forget-password`, and does not await it; `socialProviders` built from env only for the providers whose id and
secret are both set. The existing metadata hooks stay.

## 16. Portal contract

### 16.1 Env (foundation adds all of these to `env.ts` and `.env.example`, all optional)

| Variable | Used by | Meaning |
|:-|:-|:-|
| `STRIPE_SECRET_KEY` | billing | Stripe key. Absent outside production: test gateway. Absent in production: billing is off. |
| `STRIPE_WEBHOOK_SECRET` | billing | `whsec_...` for the portal endpoint. Required with the key. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | billing | `bpc_...` from the setup script. Optional. |
| `STRIPE_AUTOMATIC_TAX` | billing | `1` turns Stripe Tax on. Default off. |
| `BILLING_TEST_WEBHOOK_SECRET` | billing | Optional fixed secret for the test gateway. |
| `CRON_SECRET` | jobs | Bearer secret for the tick route. Required in production. |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | emails | Section 13.2. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | signup | Google sign in. Button shows only when both are set. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | signup | Microsoft sign in. Tenant defaults to `common`. |
| `NEXT_PUBLIC_SITE_URL` | all | Marketing site origin. Default `https://kitstak.com`. Used for "Talk to us" (`/contact`) and pricing links. |
| `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL` | signup | Default `${NEXT_PUBLIC_CRM_URL}/terms` and `/privacy` (the pages that exist today). |

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not used (hosted Checkout by redirect). `next.config.ts`:
`transpilePackages` gains `@kitstak/billing`; `serverExternalPackages` becomes `['pg', 'stripe']`. The
`Permissions-Policy` header keeps `payment=()` because no payment UI is embedded in the portal.

### 16.2 Glue `apps/portal/src/server/billing/` (foundation)

```ts
// runtime.ts
export function billingRuntime(): BillingRuntime;       // cached per process, built from env and db
export function portalUrl(): string;                    // NEXT_PUBLIC_APP_URL ?? BETTER_AUTH_URL, no trailing slash

// context.ts
export interface BillingContext {
  readonly rt: BillingRuntime;
  readonly session: Session;
  readonly org: OrgSummary;                // the session's active org, never an id from the client
  readonly access: BillingAccess;
  readonly actor: BillingActor;
  readonly emailVerified: boolean;
  readonly timeZone: string;               // user.timezone or 'UTC'
}
/** null when signed out or when the user has no org. React cache()d per request. */
export function getBillingContext(): Promise<BillingContext | null>;
/** For pages: redirects to /login?next= or to /welcome when there is no org. */
export function requireBillingContext(returnTo: string): Promise<BillingContext>;
```

### 16.3 Routes

| Path | File (under `apps/portal/src/app`) | Lane | Notes |
|:-|:-|:-|:-|
| `/signup` | `(auth)/signup/page.tsx` | signup | reads the handoff; signed in visitors go to `getSignupResume` |
| `/signup/company` | `(auth)/signup/company/page.tsx` | signup | only when signed in with no org |
| `/signup/plan` | `(auth)/signup/plan/page.tsx` | signup | renders `PlanPicker mode="trial"` |
| `/verify-email` | `(auth)/verify-email/page.tsx` | signup | 6 digit code, `?next=` |
| `/forgot-password`, `/reset-password` | `(auth)/forgot-password/page.tsx`, `(auth)/reset-password/page.tsx` | signup | code by email |
| `/invite/[invitationId]` | `(auth)/invite/[invitationId]/page.tsx` | signup | accept an invitation |
| `/login`, `/change-password` | existing | signup | add social buttons, forgot link, legal links |
| `/welcome` | `(app)/welcome/page.tsx` | signup | existing wizard, now pre answered |
| `/billing` | `(app)/billing/page.tsx` | billing-ui | billing home |
| `/billing/plan` | `(app)/billing/plan/page.tsx` | billing-ui | picker: trial start, trial change, plan change |
| `/billing/checkout` | `(app)/billing/checkout/page.tsx` | billing-ui | review step |
| `/billing/checkout/success` | `(app)/billing/checkout/success/page.tsx` | billing-ui | `?session_id=` |
| `/billing/checkout/canceled` | `(app)/billing/checkout/canceled/page.tsx` | billing-ui | |
| `/billing/invoices` | `(app)/billing/invoices/page.tsx` | billing-ui | |
| `/billing/invoices/[invoiceId]` | `(app)/billing/invoices/[invoiceId]/page.tsx` | billing-ui | on screen invoice |
| `/billing/invoices/[invoiceId]/pdf` | `(app)/billing/invoices/[invoiceId]/pdf/route.ts` | billing-ui | GET, session and `canView`, `getInvoicePdf` |
| `/billing/details` | `(app)/billing/details/page.tsx` | billing-ui | contact, address, tax id |
| `/billing/team` | `(app)/billing/team/page.tsx` | billing-ui | billing holders |
| `/billing/cancel` | `(app)/billing/cancel/page.tsx` | billing-ui | cancel and pause flow |
| `/billing/upgrade` | `(app)/billing/upgrade/page.tsx` | billing-ui | redirect to `/billing/plan?add=` |
| `/billing/activity` | `(app)/billing/activity/page.tsx` | lifecycle | audit log |
| `/test-gateway/checkout/[sessionId]` | `test-gateway/checkout/[sessionId]/page.tsx` | billing-ui | 404 unless mode is `test_gateway` |
| `/test-gateway/card/[sessionId]` | `test-gateway/card/[sessionId]/page.tsx` | billing-ui | 404 unless mode is `test_gateway` |
| `/dev/outbox` | `dev/outbox/page.tsx` | lifecycle | 404 in production |
| `/api/billing/webhooks/stripe`, `/api/billing/webhooks/test` | section 12.1 | foundation | |
| `/api/billing/jobs/tick` | section 14 | lifecycle | |

### 16.4 Server actions

All in `'use server'` files. Each one: `getBillingContext()` (else `not_signed_in` or `no_org`), check the
permission in the table, parse input with zod, `normalizeSelection` for selections, call the package function,
`revalidatePath('/billing', 'layout')` and `revalidatePath('/')` on success, return `BillingResult<T>`. They
never take an org id, a price or an amount from the client.

`apps/portal/src/server/billing-actions.ts` (billing-ui):

| Action | Input | Needs | Returns `data` | Calls |
|:-|:-|:-|:-|:-|
| `startTrialAction` | `{ selection }` | `canStartTrial` | `{ redirectTo: string }` | `startTrial`. With an open signup intent: `upsertSignupIntent` to step `verify` (email not verified) or `welcome`, and `redirectTo` is `/verify-email?next=/welcome` or `/welcome`. With no open intent: `redirectTo` is `/billing`. |
| `changeTrialProductsAction` | `{ products }` | `canStartTrial` | `PlanState` | `changeTrialProducts` |
| `saveCartAction` | `{ selection }` | `canManage` | `PlanSelection` | `saveCart` |
| `startCheckoutAction` | `{ selection }` | `canManage`, verified email | `{ url: string }` | `createCheckout` |
| `previewPlanChangeAction` | `{ selection }` | `canManage` | `ChangePreview` | `previewPlanChange` |
| `confirmPlanChangeAction` | `{ selection, prorationDate, expectedDueTodayCents }` | `canManage`, verified email | `PlanState` | `applyPlanChange` |
| `openCardUpdateAction` | none | `canManage` | `{ url: string }` | `createPaymentUpdateSession` |
| `retryPaymentAction` | none | `canManage` | `PlanState` | `retryPayment` |
| `cancelPlanAction` | `{ reason, detail }` | `canManage` | `PlanState` | `scheduleCancel` |
| `keepPlanAction` | none | `canManage` | `PlanState` | `undoCancel` |
| `pausePlanAction` | `{ months, reason }` | `canManage` | `PlanState` | `pausePlan` |
| `undoPauseAction` | none | `canManage` | `PlanState` | `undoPause` |
| `updateBillingDetailsAction` | `BillingProfile` | `canManage` | `BillingProfile` | `updateBillingProfile` |
| `addBillingManagerAction`, `removeBillingManagerAction` | `{ userId }` | `canAssignManagers` | `null` | package functions |
| `testCompleteCheckoutAction`, `testCancelCheckoutAction`, `testCompleteCardUpdateAction` | section 10.4 inputs | signed in, mode `test_gateway` | redirect URL | test gateway |
| `testShiftTimeAction`, `testFailNextPaymentAction`, `testRunDueAction` | `{ days }` or none | `canManage`, mode `test_gateway` | `PlanState` or counts | test tools |

An unverified email returns `email_unverified`; the UI then links to `/verify-email?next=<current path>`.

The invite form in `(app)/settings/organization` (billing-ui) follows this order: an unverified inviter is
sent to `/verify-email` first; then it calls the Better Auth invite endpoint; on the error code
`SEAT_LIMIT_REACHED` a billing manager sees the price from `previewPlanChangeAction` (current selection plus 1
seat) with "Add seat and send invite", which runs `confirmPlanChangeAction` and then sends the invite again;
anyone else sees the server message. The old `ModuleAccess` type in `apps/portal/src/server/entitlements.ts`
is replaced by `PlanBadge` and `PlanState`; `getOrgModuleStates` may stay as a thin wrapper for the shell.

The two test gateway pages sit outside the `(app)` group. Each must check the session itself and answer 404
unless the signed in person is a member of the organization the test session belongs to.

`apps/portal/src/server/signup-actions.ts` (signup):

| Action | Input | Returns | Does |
|:-|:-|:-|:-|
| `createWorkspaceAction` | `{ company: string, handoff: Record<string, string> }` | `{ ok, error?, next? }` | session required. `auth.api.createOrganization` with slug retry, sets it active, `upsertSignupIntent` (step `plan`, parsed handoff), audit `signup.guided_requested` when asked. Returns `next: '/signup/plan'`. |
| `resendVerificationAction` | none | `{ ok, error? }` | `auth.api.sendVerificationOTP` for the session email. |
| `verifyEmailAction` | `{ code: string }` | `{ ok, error? }` | `auth.api.verifyEmailOTP`. |
| `skipVerifyAction` | none | `{ ok, next }` | `upsertSignupIntent({ verifySkipped: true, step: 'welcome' })`. |
| `requestPasswordResetAction` | `{ email }` | `{ ok }` (always, never says if the email exists) | `auth.api.forgetPasswordEmailOTP`. |
| `resetPasswordAction` | `{ email, code, password }` | `{ ok, error? }` | `auth.api.resetPasswordEmailOTP`. |
| `acceptInviteAction` | `{ invitationId }` | `{ ok, error?, next }` | `auth.api.acceptInvitation`, sets the org active. |

Check each `auth.api` name against better-auth 1.7.21 in `node_modules` before use; the endpoint paths are
`/email-otp/send-verification-otp`, `/email-otp/verify-email`, `/email-otp/request-password-reset` (also
`/forget-password/email-otp`), `/email-otp/reset-password`.

`apps/portal/src/server/signup.ts` (signup):

```ts
export type SignupStep = '/signup' | '/signup/company' | '/signup/plan' | '/verify-email' | '/welcome' | '/';
/** Where this person should be right now. Used by every signup page to resume or skip ahead. */
export function getSignupResume(session: Session | null): Promise<{ step: SignupStep; intent: SignupIntent | null }>;
```

### 16.5 Shared portal components

`PlanPicker` (billing-ui, `apps/portal/src/features/billing/plan-picker/plan-picker.tsx`, client component):

```ts
export interface PlanPickerProps {
  /** trial: start a free trial. trial_change: add or remove apps in a trial. change: change a paid plan.
   *  checkout: pick the plan to pay for (after a trial, or with a card during it). */
  readonly mode: 'trial' | 'trial_change' | 'change' | 'checkout';
  readonly initialSelection: PlanSelection;
  readonly planState: PlanState | null;       // null only in mode 'trial' for a brand new org
  readonly focus?: 'seats' | 'warehouses' | 'interval' | ProductId;
  /** Where the person goes after the primary action succeeds. Default: mode specific. */
  readonly doneHref?: string;
  /** signup: wider, no page chrome, heading "Pick your apps". billing: inside the billing shell. */
  readonly layout: 'signup' | 'billing';
  readonly timeZone: string;
}
export function PlanPicker(props: PlanPickerProps): React.JSX.Element;
```

It calls the actions itself (`startTrialAction`, `changeTrialProductsAction`, `previewPlanChangeAction` and
`confirmPlanChangeAction`, or routes to `/billing/checkout`). The signup page only renders it.

`ShellNotices` (billing-ui, `apps/portal/src/features/shell/shell-notices.tsx`, server component, rendered by
the `(app)` layout under the top bar): shows, in this order, the "Test mode" strip when `mode` is `stripe_test`
or `test_gateway`, the plan notice from `planNoticeFor` (module `null`) through `PlanBanner`, and the verify
email notice when `session.user.emailVerified` is false ("Check your email for a 6 digit code to verify your
address." with the action "Enter code" to `/verify-email`).

## 17. Shared UI in `packages/ui` (apps lane)

New exports in `packages/ui/package.json`: `./plan-banner` and `./plan-lock`. Both style with their own CSS
file and `tokens.css` custom properties only (the pattern of `app-switcher.css`), because the apps do not share
Tailwind class names. `packages/ui` must not import `@kitstak/billing`; the props below repeat the shapes from
section 7 and stay structurally equal (each app passes a `PlanNotice` straight in, so drift is a type error).

```ts
// @kitstak/ui/plan-banner  ('use client' only for the dismiss button)
export interface PlanBannerNotice {
  readonly kind: string; readonly tone: 'info' | 'warning' | 'danger'; readonly text: string;
  readonly action: { readonly label: string; readonly href: string } | null; readonly testId: string;
}
export interface PlanBannerProps {
  readonly notice: PlanBannerNotice | null;   // null renders nothing
  /** info banners can be hidden for the day (localStorage key per kind). Warning and danger cannot. */
  readonly dismissible?: boolean;
  readonly className?: string;
}
export function PlanBanner(props: PlanBannerProps): React.JSX.Element | null;

// @kitstak/ui/plan-lock
export interface PlanLockView {
  readonly title: string; readonly body: string; readonly priceLine: string | null;
  readonly primary: { readonly label: string; readonly href: string } | null;
  readonly secondary: { readonly label: string; readonly href: string };
  readonly testId: string;
}
export interface PlanLockScreenProps { readonly app: 'crm' | 'wms' | 'projects' | 'pulse'; readonly lock: PlanLockView;
  readonly className?: string }
export function PlanLockScreen(props: PlanLockScreenProps): React.JSX.Element;

// @kitstak/ui/app-switcher, added props (all optional, old callers keep working)
export type AppSwitcherPlanBadge = 'trial' | 'active' | 'past_due' | 'view_only' | 'not_in_plan' | 'included';
readonly planBadges?: Partial<Record<AppSwitcherAppId, AppSwitcherPlanBadge>>;
/** Link for a row that is not in the plan. Default `${urls.portal}/billing/plan?add=<app>`. */
readonly addHref?: (app: AppSwitcherAppId) => string;
```

Banner layout: one row, full width, 44 px minimum height, icon by tone, text, action as a real link styled as
a small button, `role="status"` for info and `role="alert"` for warning and danger, wraps to two rows under
480 px. Badge words on screen: "Trial", "Active", "Payment due", "View only", "Not in your plan", "Included".

## 18. Product apps (apps lane)

Each app adds one server helper and uses it at its existing choke points. The helper file sits next to the
app's existing entitlement file.

```ts
// apps/<app>/src/server/plan.ts
export function getPlanView(input: { orgId: string; userId: string; role: string; timeZone?: string }): Promise<AppPlanView>;
// = getAppPlanView(db, { ...input, module: '<app>', portalUrl, allowAll: entitlementsAllowAll() })
```

| App | Gate today | Change |
|:-|:-|:-|
| CRM | `orgHasCrmModule`, `getPageOrgMembership` redirect to `/[orgSlug]/locked`, `withApi` 402 | Pages: `locked` goes to the lock page (now `PlanLockScreen` with `planLockFor`); `read_only` renders the app with the banner. API: `locked` 402 `entitlement.missing` as today; `read_only` lets GET and HEAD through and answers every other method 402 `{ ok: false, error: { code: 'plan.read_only', module: 'crm', message } }`. Banner in the app shell top. |
| WMS | `requireWmsEntitlement` in `defineRoute`, `loadShellProps` redirect to `/locked` | Same split. Error code `PLAN_READ_ONLY` in the WMS envelope for non GET requests. Exempt paths stay exempt. `provisionWarehouse` and the create warehouse service call `checkWarehouseAvailable` first and answer `PLAN_WAREHOUSE_LIMIT` with the message. |
| Projects | `orgHasProjectsModule` in `shell-frame.tsx`, `server/http/api.ts`, `server/actions/_action.ts` | Same split in `api.ts`. In `_action.ts` every action is refused in `read_only` with code `plan.read_only` unless the action is marked as a read. `LockedScreen` becomes a thin wrapper over `PlanLockScreen`. |
| Pulse | `orgHasPulseModule` in `shell-frame.tsx`, `server/http/api.ts`, `actions/_action.ts`, three routes | Same as Projects. `NoAccessScreen` (a role state) is unchanged. Cron routes keep working in `read_only` for reads and skip writes. |

Rules for all four:

1. The message for `plan.read_only` is "Your plan is view only right now. Pick a plan in the Portal to make
   changes." Client code that shows API errors must show this message, not a raw code.
2. If a path cannot be made view only safely, treat `read_only` as `locked` for that path. Never treat it as
   `full`.
3. Lock and banner links come from `billingLink(portalUrl, intent, '<app>')`. No hand built URLs.
4. Each app's `auth.ts` passes `organization: billingOrganizationOptions({ db, portalUrl, allowAll:
   entitlementsAllowAll })`.
5. Admin deep links: CRM admin (the page gated by `org:billing`), WMS settings (label "Plan"), Projects
   settings and Pulse settings each get a "Plan and payment" row that shows the badge and next charge line for
   viewers with `canView`, and links to `billingLink(portalUrl, { to: 'home' }, '<app>')`.
6. App switcher: pass `planBadges` from `AppPlanView.badges`.
7. CRM `/signup`: when `NEXT_PUBLIC_PORTAL_URL` is set and `entitlementsAllowAll()` is false, redirect to
   `signupUrl(portal, { selection: { products: ['crm'], ... }, profile: {}, source: 'app' })`. Otherwise the
   page stays as it is. The CRM invite accept page stays.
8. Seat errors from invites (`SEAT_LIMIT_REACHED`) show the server message and a link to
   `billingLink(portalUrl, { to: 'seats' }, '<app>')`.

## 19. Marketing site (web lane)

- `apps/web/src/lib/pricing.ts` re-exports from `@kitstak/billing/catalog` and `@kitstak/billing/quote`. No
  price number remains in `apps/web`. `Billing = 'monthly' | 'annual'` becomes `BillingInterval`; `annual` is
  only read from old saved answers and old links. `formatUsd` call sites move to `formatMoney` (with
  `trimZeroCents` where a whole dollar list price is shown). `preliminaryPriceNote` is removed with its call
  sites. `PRODUCT_IDS`, `Stack` and the stack helpers in `site-links.ts` re-export the catalog ones.
- `PULSE_IS_LIVE` becomes `true` (the app is launched and Pulse is sold through signup).
- `LINKS.portal` reads `process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://kitstak.app'` (the other four the same
  way with their own variable), so a local site hands off to a local portal.
- `handoffUrl(answers, account)` in `lib/stak.ts` returns `signupUrl(LINKS.portal, handoff, identity)` with
  `source: 'wizard'`, the full selection (products, seats, warehouses, billing period), the profile answers,
  `guided`, and name, email and company in the fragment.
- New route `/pricing` (`apps/web/src/app/pricing/page.tsx`), added to `ROUTES`, the header, the footer and
  the sitemap. `ROUTES.pricing` points at it. SPEC section 4 lists its parts.
- `package.json` dev and start scripts move to port 3600 (Projects owns 3400).
- Tests: `pricing.test.ts` asserts the reference carts in section 4.3 through the re-export; `stak.test.ts`
  asserts the handoff round trip with `parseHandoff`.

## 20. Lifecycle deliverables

| Deliverable | Path | Contract |
|:-|:-|:-|
| Stripe setup script | `packages/billing/scripts/stripe-setup.ts` | `pnpm -F @kitstak/billing stripe:setup check` (default, read only) prints one line per product, price and portal configuration: `ok`, `missing`, or `differs` with both values, and exits 1 if anything is not `ok`. `... stripe:setup apply` creates what is missing (products by fixed id, prices by lookup key, portal configuration) and prints the configuration id. A price whose amount differs is never edited: `apply` creates a new price with `transfer_lookup_key: true` and deactivates the old one, only when run with the extra word `reprice`. It never touches a product or price that does not start with `kitstak_`, and never creates or disables a webhook endpoint. Needs `STRIPE_SECRET_KEY` in the environment. Running `apply` twice changes nothing the second time. |
| Backfill | `packages/billing/scripts/backfill-entitlements.ts` | `check` lists every org with no entitlement rows. `apply manual` gives each of them manual grants for all four modules (today's behavior under the allow all switch). `apply trial` starts a 14 day trial for all four. Idempotent. Used before `ENTITLEMENTS_DEV_ALLOW_ALL` is removed in production. |
| Portal e2e | `apps/portal/playwright.config.ts`, `apps/portal/e2e/*.spec.ts` | Copy the Pulse config (tests hit a running dev server, `E2E_BASE_URL`, default `http://localhost:3300`). Specs in SPEC section 14.3. They need the portal and product apps started with `ENTITLEMENTS_DEV_ALLOW_ALL=0`. |
| Parity test | `packages/billing/tests/price-parity.test.ts` | For the 9 reference carts: `quote().totalCents` equals the sum of Stripe mapping amounts (section 5.2 table, read from the catalog by price key) times quantity, and equals the first test gateway invoice total. |
| Copy rules | `packages/billing/tests/copy-rules.test.ts`, `apps/portal/src/lib/copy-rules.test.ts` | The Pulse test adapted: no em dash, no en dash, no double dash, no "coming soon", no "lorem" in string literals and JSX text of the billing package, the portal `src`, and `packages/ui/src/plan-*`. Also every sentence in `BILLING_ERROR_COPY`, notice text and email text is 20 words or fewer. |
| Docs | `docs/billing/GO-LIVE.md`, `docs/billing/TESTING.md`, updates to `DEV.md` and `docs/DEPLOYMENT.md` | SPEC section 15. |
| Deploy env | `deploy/push-env.mjs`, `deploy/dev/env-init.sh` | Add the portal variables from 16.1 (read from `deploy/secrets.env`, never printed). Remove the unused publishable key placeholder. Keep `ENTITLEMENTS_DEV_ALLOW_ALL=1` in production until the GO-LIVE step that removes it. |
| Dev scripts | `deploy/dev/billing-tick.sh`, `deploy/dev/billing-reset.sh` | Tick: calls the local tick route once or in a loop every 15 seconds with the word `watch`. Reset: deletes one org's billing rows by slug in the local database only (refuses a non local database URL). |

## 21. Test ids (every UI lane uses these exact values)

| `data-testid` | Where |
|:-|:-|
| `signup-form`, `signup-name`, `signup-email`, `signup-password`, `signup-company`, `signup-submit` | `/signup` |
| `signup-plan-summary` | the small "Your free trial" card on `/signup` when a handoff is present |
| `company-form`, `company-name`, `company-submit` | `/signup/company` |
| `plan-picker`, `plan-product-<id>` (the toggle), `plan-seats`, `plan-seats-inc`, `plan-seats-dec`, `plan-warehouses`, `plan-warehouses-inc`, `plan-warehouses-dec`, `plan-interval-monthly`, `plan-interval-yearly` | picker |
| `quote-line-<id>`, `quote-list`, `quote-yearly-discount`, `quote-bundle-discount`, `quote-total`, `quote-monthly-equivalent` | picker, review, test checkout. Each holds the formatted money text. |
| `plan-submit` | picker primary button |
| `verify-code`, `verify-submit`, `verify-resend`, `verify-skip` | `/verify-email` |
| `invite-accept`, `invite-org-name` | `/invite/[id]` |
| `billing-home`, `billing-plan-card`, `billing-cost`, `billing-next-charge`, `billing-payment-method`, `billing-invoices-preview`, `billing-usage-seats`, `billing-usage-warehouses`, `billing-phase` (text is the phase id in a `data-phase` attribute) | `/billing` |
| `billing-add-card`, `billing-change-plan`, `billing-update-card`, `billing-pay-now`, `billing-cancel`, `billing-keep-plan`, `billing-undo-pause` | billing home actions |
| `review-due-today`, `review-first-charge-amount`, `review-first-charge-date`, `review-pay`, `review-trust` | `/billing/checkout` |
| `checkout-success`, `checkout-success-open-apps`, `checkout-canceled`, `checkout-resume` | return pages |
| `change-preview`, `change-due-today`, `change-credit`, `change-new-total`, `change-confirm` | plan change confirm |
| `invoice-row-<invoiceId>`, `invoice-pdf-<invoiceId>` | invoice lists |
| `cancel-reason-<reason>`, `cancel-detail`, `cancel-offer-pause`, `cancel-pause-<months>`, `cancel-confirm`, `cancel-back` | cancel flow |
| `details-form`, `details-save`, `team-add`, `team-row-<userId>` | details and team |
| `test-mode-label` | every billing screen and banner strip in test modes |
| `test-checkout`, `test-card-number`, `test-card-chip-<outcome>`, `test-pay`, `test-back`, `test-3ds-approve`, `test-3ds-fail`, `test-error` | test gateway pages |
| `test-tools`, `test-tool-shift-<days>`, `test-tool-fail-next`, `test-tool-run-due` | test tools panel on billing home |
| `plan-notice-<kind>`, `plan-notice-action` | `PlanBanner` in every app |
| `plan-lock`, `plan-lock-primary`, `plan-lock-secondary` | `PlanLockScreen` in every app |
| `tile-<id>`, `tile-badge-<id>`, `tile-action-<id>` | launcher tiles |
| `activity-row`, `outbox-row`, `outbox-open-<id>` | activity page, dev outbox |

## 22. Done checks per lane

Run from the repo root and paste the real output in your report.

| Lane | Commands that must pass |
|:-|:-|
| foundation | `pnpm install`; `pnpm -F @kitstak/billing typecheck`; `pnpm -F @kitstak/billing test`; `pnpm -F @kitstak/entitlements test`; `pnpm -F @kitstak/auth typecheck`; `deploy/dev/db-setup.sh` with the migrate word from DEV.md, then again (second run applies nothing); `pnpm -F kitstak-portal typecheck`; a signed test event posted twice to `/api/billing/webhooks/test` gives 200 then 200 `duplicate` with one ledger row; a bad signature gives 400 and no row. |
| signup | `pnpm -F kitstak-portal typecheck`, `lint`, `test`; a fresh signup with a handoff link reaches the launcher; `psql` shows trial rows with a period end 14 days out. |
| billing-ui | `pnpm -F kitstak-portal typecheck`, `lint`, `test`; `node deploy/dev/shot.mjs /billing` in both themes and both sizes for the phases `trial`, `active`, `past_due`, `cancel_scheduled`. |
| apps | `typecheck`, `lint` and `test` in `kitstak-crm`, `kitstak-wms`, `kitstak-projects`, `kitstak-pulse`; `pnpm -F @kitstak/ui test`; each app started with `ENTITLEMENTS_DEV_ALLOW_ALL=0` shows the trial banner, the view only state and the lock screen. |
| web | `pnpm -F kitstak-web typecheck`, `test`, `build`; a wizard run on a local site lands on the local portal `/signup` with the cart intact. |
| lifecycle | `pnpm -F @kitstak/billing test`; `pnpm -F kitstak-portal e2e`; `stripe:setup check` against the test gateway mapping (dry mode with no key prints the 4 products and 16 prices it would look for and exits 0). |

## 23. List of signatures (index)

Pure: `PRODUCT_IDS`, `CATALOG`, `PRICING_IS_PLACEHOLDER`, `DEFAULT_SELECTION`, `isProductId`, `toStack`,
`parseStack`, `stackParam`, `toggleProduct`, `isBundle`, `normalizeSelection`, `quantityFor`, `unitCents`,
`seatLimitFor`, `priceKey`, `parsePriceKey`, `allPriceKeys`, `formatMoney`, `percentLabel`, `formatDay`,
`daysLeft`, `quote`, `quoteSummaryLines`, `encodeHandoff`, `parseHandoff`, `encodeHandoffIdentity`,
`parseHandoffIdentity`, `signupUrl`, `billingLink`, `derivePlanState`, `planNoticeFor`, `planLockFor`,
`planBadgeFor`, `BILLING_ERROR_COPY`, `billingError`.

Entitlements: `moduleAccess`, `isEntitled` (fixed), `getModuleAccess`, `hasModule` (fixed), `setEntitlement`,
plus every existing export.

Server: `resolveBillingConfig`, `createGateway`, `createBillingRuntime`, `rows`, `getPlanState`,
`getAppPlanView`, `clearPlanCache`, `getBillingAccess`, `listBillingHolders`, `addBillingManager`,
`removeBillingManager`, `canStartTrial`, `startTrial`, `changeTrialProducts`, `saveCart`, `createCheckout`,
`syncCheckoutSession`, `checkoutPreview`, `previewPlanChange`, `applyPlanChange`, `scheduleCancel`,
`undoCancel`, `pausePlan`, `undoPause`, `createPaymentUpdateSession`, `retryPayment`, `listInvoices`,
`getInvoice`, `getInvoicePdf`, `getBillingProfile`, `updateBillingProfile`, `countBillableSeats`,
`countWarehouses`, `checkSeatAvailable`, `checkWarehouseAvailable`, `recordAudit`, `listAuditLog`,
`enqueueEmail`, `billingRecipients`, `enforceRateLimit`, `upsertSignupIntent`, `getOpenSignupIntent`,
`completeSignupIntent`, `processWebhook`, `applySubscriptionSnapshot`, `applyInvoiceSnapshot`,
`refreshFromGateway`, `billingOrganizationOptions`.

Gateway: `BillingGateway`, `createStripeGateway`, `createTestGateway`, `TEST_CARDS`, `getTestCheckout`,
`completeTestCheckout`, `cancelTestCheckout`, `getTestCardUpdate`, `completeTestCardUpdate`, `testShiftTime`,
`testRunDue`, `testFailNextPayment`, `testSendEvent`, `renderInvoicePdf`, `WebhookSignatureError`,
`GatewayCardError`.

Emails and jobs: `renderEmail`, `resolveEmailProvider`, `sendEmailNow`, `deliverQueuedEmails`, `listOutbox`,
`runBillingTick`, `queueTrialReminders`, `queueGraceReminders`, `reconcileSubscriptions`.

Auth: `organizationPlugin(extras)`, `CreateAuthOptions.organization`, `CreateAuthOptions.socialProviders`.

Portal: `billingRuntime`, `portalUrl`, `getBillingContext`, `requireBillingContext`, `getSignupResume`, the
actions in 16.4, `PlanPicker`, `ShellNotices`.

UI: `PlanBanner`, `PlanLockScreen`, `AppSwitcher` props `planBadges` and `addHref`.

Apps: `getPlanView` per app.

## 24. Changes during build

Foundation appends here when a signature has to change: date, what changed, who is affected.

### 2026-11-23, foundation build

Everything in section 23 exists with the names and types given above. The changes below are additions or
small corrections found while building. Nothing was removed.

**Things every lane should know first**

| What | Detail | Who it touches |
|:-|:-|:-|
| The Stripe adapter is passed in | `createBillingRuntime({ db, env?, portalUrl, now?, stripe? })` and `createGateway(config, db, portalUrl, options?)` take an optional `stripe: (config) => BillingGateway`. The portal glue passes `createStripeGateway`. This is how the server barrel keeps its promise in 3.2 to never import `stripe`. In a Stripe mode with no factory, `createBillingRuntime` throws a clear error. In `test_gateway` and `unavailable` mode nothing needs to be passed. | lifecycle (scripts and jobs that build their own runtime), nobody else |
| Use `billingRuntime()` in the portal | Every portal lane gets the runtime from `@/server/billing/runtime` or from `getBillingContext()`. Do not call `createBillingRuntime` in the portal. The portal `db` handle is assignable to `BillingDb` and `BillingReadDb` with no cast. | signup, billing-ui, lifecycle |
| Portal `auth.ts` wiring | `organization: billingOrganizationOptions({ db, portalUrl: portalUrl(), allowAll: isDevAllowAll })`. Import `portalUrl` from `@/server/billing/runtime`. | signup |
| New error code `invalid_input` | `BillingErrorCode` gains `invalid_input` ("Check what you entered and try again."). Functions use it with an exact sentence for a wrong form value that is not a plan selection: billing details, a bad promo code on the test checkout, a pause or trial change in the wrong state. Show `error.message` as is. | billing-ui, lifecycle copy test |
| New notice kind `app_removed` | `PlanNoticeKind` gains `app_removed` (tone `warning`, test id `plan-notice-app_removed`). It is returned for an app that left the trial or the plan and is view only now: "CRM is view only because it is not in your plan. Add it to make changes." with the action "Add CRM". Members see "This app is view only right now. Ask Maya Chen to add it." Without it a removed app would be view only with no word of why. `PlanBanner` already takes `kind: string`. | apps, billing-ui |
| Lock screen copy is `body` plus `priceLine` | Render both, body first. Together they read as the sentences in SPEC 9.3 ("Add CRM for $23.20 per user each month." then "That price includes your bundle discount."). In a trial the price line says what the app costs after the trial. `priceLine` is null when there is nothing to add. | apps |
| Banner dates are short | Notices use "Dec 7" (SPEC 9.2). Billing screens use `formatDay` ("Dec 7, 2026"). The short form is exported as `formatDayShort`. | apps, billing-ui |
| Test pages can check membership | `TestCheckoutView` and `TestCardUpdateView` carry `orgId`, so the two test gateway pages can do the membership check in 16.4. `TestCheckoutView` also has `needsBankApproval` (true while a card waits for the pretend bank step). `getTestCheckout(db, sessionId, now?)` takes an optional clock. | billing-ui |
| Bank step on the test checkout | First call `completeTestCheckout` with the card. For the "Needs bank approval" card it answers `requires_action` and keeps the card on the session. Then call it again with `approve3ds: true` or `false`; the card fields are ignored on that second call. | billing-ui |

**Package and tooling**

| What | Detail |
|:-|:-|
| `vitest.config.mts` | Not `.ts`. The package is CommonJS like `packages/entitlements`, and Vite warns about an ESM config in a `.ts` file. It sets `fileParallelism: false`, because database tests share one local Postgres. |
| Two more dependencies in `packages/billing` | `@kitstak/auth` (the `OrganizationPluginExtras` type) and `better-auth` (`APIError` for the hooks). Every product app already has both. |
| `src/testing/db.ts` | Helpers for database tests: `openTestDb`, `createTestOrg`, `addPerson`, `removeTestOrg`, `testRuntime`. Lifecycle tests in `tests/` may import them. App code never does. |
| `src/dates.ts`, `src/server/mode.ts`, `src/server/roles.ts` | Small shared helpers: `addMonths`, `addInterval`; `billingMode(env)` (also exported from the server barrel); role string helpers. |
| Portal vitest | `server-only` is aliased to an empty stub, `e2e/**` is excluded, and `*.test.tsx` is included. |
| Portal env | `env.ts` also exports `legalUrls()` (Terms and Privacy with the CRM defaults). Blank values in an env file count as not set. |

**Database (migration 0007, applied locally)**

| What | Detail |
|:-|:-|
| New table `core.billing_trial_uses` | `(user_id, org_id, started_at)`, primary key on the pair, Drizzle `billingTrialUses`. It has no foreign key to the organization on purpose. Without it, "one free trial per person" could be reset by deleting an organization, because `billing_accounts` goes with the organization. `canStartTrial` reads it. |
| `billing_events` | Also gets `billing_events_gateway_check` and a guarded foreign key on `org_id` with `ON DELETE SET NULL`. |
| Two more indexes | `billing_cancel_feedback_org_idx (org_id, created_at DESC)` and `billing_test_objects_org_kind_idx (org_id, kind)`. |
| Drizzle file | The new tables are in `packages/db/src/schema/core/billing-tables.ts`. `billing.ts` keeps the three old tables. |

**Behavior worth knowing**

| What | Detail |
|:-|:-|
| `applySubscriptionSnapshot` | Input gains optional `portalUrl` (emails are queued only when it is set; audit rows are always written) and optional `actor`. A snapshot of an older, ended subscription never replaces a live one for the same organization. |
| `BillingGateway.resume(id, options?)` | `options.billNow` starts a new period and bills today. `undoPause` passes it when the pause has already begun, so "Start again now" charges that day. Before the pause begins nothing is charged. |
| Audit actions | `AuditAction` gains `checkout.expired`. |
| `InvoiceRow` | Gains `subtotalCents`, `discountCents`, `amountPaidCents`, `paidAt`, `billingReason`, `paymentMethodLast4` for the on screen invoice. |
| `listInvoices` | Leaves out the $0.00 invoice a gateway makes when a card is saved during the trial, so the empty state in SPEC 6.6 stays true. |
| `createCheckout` | `already_subscribed` is for a subscription the gateway still runs (`trialing`, `active`, `past_due`, `unpaid`). A first payment that never finished (`incomplete`) does not block a new checkout. |
| `canStartTrial` | Any subscription row for the organization, also an ended one, answers `has_plan`. |
| `changeTrialProducts` | An app removed from a trial becomes view only (a `canceled` row from source `trial`), so what was made in it can still be read. It can be added back at any time. |
| `checkSeatAvailable` | Also takes `ignoreInviteEmail`. The hooks use it so that inviting the same address again, or adding a person who has an open invite, is not counted twice. |
| Stripe keys | Restricted keys (`rk_live_`, `rk_test_`) count like `sk_` keys. Any other value is `unavailable`. |
| One card per plan on Stripe | Checkout saves the card on the subscription. The Billing Portal's update flow saves the new card as the customer's default, and Stripe charges the subscription's own card first (Stripe docs, "Subscription invoices" and "Deep links in the customer portal", checked 2026-11-23). So the adapter makes the customer's default card the subscription's card whenever it reads a subscription and they differ, and `payLatestInvoice` pays with that card. Without this a renewal would still charge the old card. |
| Test gateway cards | "Works now, fails at the next renewal" pays its first real charge (at checkout, or at trial end) and fails every charge after that. Retries run 3, 8 and 15 days after the invoice; after the fourth failed try the plan is closed. "Pay now" does not use up a retry. |
| `testShiftTime` | Also moves the audit log, email and feedback dates of the organization, so the activity page stays in step with the shifted plan. `testRunDue` with no `orgId` runs every test subscription in the database. |
| `ModuleEntitlement.seats` | CRM and Projects rows hold the seat count. Pulse rows hold the plan's seat limit (5, or the seat count when a per user app is in the plan). WMS rows hold null. |

**More exports (additions, all optional to use)**

Pure: `formatDayShort`, `productListLabel`, `priceTermsLabel`, `priceKeyCents`, `MAX_SEATS`, `MAX_WAREHOUSES`,
`PLAN_BADGE_LABELS`, `isLiveSubscriptionStatus`, `billingOk`, `EMAIL_TEMPLATE_IDS`, `BUSINESS_TYPES`,
`TEAM_SIZES`, `START_MODES`, `HANDOFF_SOURCES`, and the input types of `derivePlanState` (`PlanStateInput`,
`PlanAccountInput`, `PlanSubscriptionInput`, `PlanEntitlementInput`; each entitlement row carries the answer of
`moduleAccess`, so the rule stays in one place).

Server: `billingMode`, `getCart`, `validateBillingProfile`, `enqueueForBillingRecipients` (one email per billing
recipient, the address is added to the dedupe key), `clearBillingCaches`, `resumePlan` (the same as `undoPause`),
`SYSTEM_ACTOR`, `StripeGatewayFactory`.

Gateway: `signTestPayload(rawBody, secret, at)`, `TEST_PROMO_CODE`, `TestCardOutcome`.

Entitlements: `getEntitlementsFresh(db, orgId)`, the `./write` export path, and `ModuleAccess`.

### 2026-11-23, integration (gate round 0)

The six lanes were joined and run together for the first time. What changed while joining them, and what the
lanes reported as different from the sections above. All of it is in the code as described here.

**Changed by the integrator**

| What | Detail | Who it touches |
|:-|:-|:-|
| The Portal shows the shared banner | `ShellNotices` now renders `PlanBanner` from `@kitstak/ui/plan-banner` for the plan notice, the same component as the four product apps. The Portal's own copy of it is gone. `features/shell/portal-notice-bar.tsx` (`PortalNoticeBar`) only draws the two Portal only rows: the "Test mode" strip and the verify email notice. | billing-ui, apps |
| `PlanBanner` can line up with a page column | `plan-banner.css` reads two optional custom properties set on the banner: `--ks-planbanner-max-width` and `--ks-planbanner-pad-x`. The Portal sets them to its 1120 px column. Apps that set neither look as before. | apps |
| Verify email notice link | Its test id is `verify-email-action`. `plan-notice-action` now means the plan banner's link only. | lifecycle e2e |
| Portal app switcher | The `(app)` layout passes `planBadges`, so the Portal's switcher shows the same plan words per app as CRM, WMS, Projects and Pulse. | billing-ui |
| Back from the card page | When `/billing?updated=card` pays the open invoice, the page redirects to `/billing?notice=card_paid`. The plan banner in the shell is then read after the payment, and a reload does not try the payment again. A payment that still fails stays on the page with the plain message. | billing-ui, lifecycle e2e |
| WMS seat sentence | WMS says "All 5 seats are in use. Add a seat to your plan, then add this person." The shared sentence ends in "Add a seat in Billing, then invite again.", and in WMS "Billing" means 3PL client billing (rule 10 in section 1). | apps |
| Starting a portal in production mode for `billing-off.spec.ts` | The port goes on the `next start` line (`pnpm exec next start -p 3310` in `apps/portal`), because the package's `start` script is fixed to 3300. The dev portal on 3300 must be up too. The exact lines are at the top of the spec. | lifecycle |

**Reported by the lanes and accepted as built**

| Lane | What | Detail |
|:-|:-|:-|
| signup | Email codes | `overrideDefaultEmailVerification` is off, so the email code plugin sends the signup code itself. Sign in by code is closed (`/sign-in/email-otp` answers 404). Codes are limited to 5 per 10 minutes and 20 per day per address. A reset by code clears the sign in lockout for that address. |
| signup | Password rules on reset by code | Checked in the Portal's own auth hook (`PASSWORD_POLICY`, 400), because the shared password plugin does not cover `/email-otp/reset-password`. |
| signup | New actions | `resumeAfterSignInAction`, `skipWelcome`. `skipVerifyAction` takes an optional `next`. |
| signup | Resume rules | `getSignupResume` sends a person to `/welcome` only while a signup intent is open. A signed in team that already has a trial or a plan and opens `/signup` with a cart goes to `/billing/plan?add=<first new app>`. |
| signup | Time zone | The browser's time zone is saved on the user at signup, so trial dates show the right day. |
| billing-ui | `PlanPickerProps.canPay` | Optional, default true. False hides "Add a card" for admins. |
| billing-ui | Flash messages | Billing home reads `?notice=<key>` after an action, and `&from=<app>` adds a "Back to CRM" link. |
| billing-ui | Error classes | `GatewayCardError` and `WebhookSignatureError` match by name (`Symbol.hasInstance`), so a dev hot reload cannot turn a declined card into a server error. |
| apps | WMS `getPlanView` | Takes the platform database handle first: `getPlanView(platformDb, input)`. |
| apps | Reads that use POST | A POST that changes no business data keeps working in view only: `planRead: true` on CRM routes, `read: true` on Projects and Pulse actions, a short path list in WMS. |
| apps | Error codes | "Not in plan" keeps its old codes (`entitlement.missing`, `NOT_ENTITLED`, `ENTITLEMENT_MISSING`) with a plain message. The WMS error envelope has `planUrl` for `PLAN_WAREHOUSE_LIMIT` and `PLAN_SEAT_LIMIT`. CRM seat errors from its own API are 403 `FORBIDDEN` with `details.code: 'SEAT_LIMIT_REACHED'`. |
| apps | Background writers | CRM and Projects public forms, the Projects automation sweep and the WMS scheduler stop for organizations without full access. Pulse cron and kiosk links treat view only as locked. |
| apps | More shared UI | `@kitstak/ui/plan-summary`, `@kitstak/ui/plan-summary-model` and `@kitstak/ui/plan-badges`. |
| web | Local links | Under `next dev` with no `NEXT_PUBLIC_PORTAL_URL`, the site links to the local dev ports. Builds keep the production default. |
| web | Default period | The wizard and the calculator open on monthly. |
| lifecycle | Jobs and emails | `TickReport` has `errors: string[]`. `runBillingTick` and `deliverQueuedEmails` take `env`. `sendEmailNow` takes a third options argument. `reconcileSubscriptions` also picks up a passed period end or trial end. |
| lifecycle | More routes | `/billing/activity/export` (CSV) and `/dev/outbox/templates`. |
| lifecycle | Scripts | `stripe:setup apply` also fixes names, nicknames and metadata in place and never changes an amount. `billing-reset.sh` takes the word `yes`. |

**Known and left as designed**

| What | Detail |
|:-|:-|
| Seat floor | Fixed in review round 1 (see below): open invites now count toward the lowest seat number. |
| Seat checks under the allow all switch | `requireSeat` does not read `allowAll`, so seat limits of a paid plan apply in the Portal even with `ENTITLEMENTS_DEV_ALLOW_ALL=1`. |
| Invite emails | Queued with `enqueueEmail`, so in production they leave with the next job run, up to a minute later. |

### 2026-11-23, review round 1 (backend fixes)

Fifteen blockers from the visual, operational, security and critic reviews. Everything here is additive
unless the row says "changed". Migration `0008_core_billing_credit.sql` carries the new columns and the trigger.

**Money**

| What | Detail | Who it touches |
|:-|:-|:-|
| Proration date, changed | The server picks it (`packages/billing/src/proration.ts`, pure). Always a whole number of days before the period end. A charge counts the day that has started (days left rounded up). A credit counts full days only (rounded down). So the amount matches "for the 30 days left", does not move within a day, and adding seats and taking them off again always costs one day. A date from the browser is never used. | billing-ui, gateways |
| `applyPlanChange`, changed | Input is now `{ orgId, selection, basis, expectedDueTodayCents, actor }`. `prorationDate` is ignored. `basis` is the fingerprint the preview carried (`planBasis`: subscription id, items, period, credit, status). A basis that no longer matches answers `price_changed`, even when the dollars match. The amount must equal a fresh preview to the cent. | `confirmPlanChangeAction` takes `basis` instead of `prorationDate`. |
| `PlanChangePreview` | What `previewPlanChange` returns (exported from the server barrel as `ChangePreview` too): the gateway preview plus `basis`, `daysLeft` and `creditBalanceCents`. `ChangePreview` itself gained `proratedCents` and `creditAppliedCents`. | billing-ui |
| Credit and the next bill | `GatewaySubscription` has `creditBalanceCents` and `upcoming` (`GatewayUpcoming`: `amountDueCents`, `discountCents`, `discountLabel`, `creditAppliedCents`). Stripe reads them from the customer balance and `invoices.createPreview`; the test gateway from the same `billMath` its invoices use. Stored in `core.billing_subscriptions` as `credit_cents`, `next_charge_cents`, `next_discount_cents`, `next_discount_label`, `next_credit_cents`. | every screen that shows a next charge |
| `PlanState` | `creditCents`, and `nextCharge` is now `{ amountCents, at, planCents, discountCents, discountLabel, creditAppliedCents }`. `amountCents` is what the card will really be charged. `usage.seatFloor` is people plus open invites. Pure helpers `nextChargeLine(state)` and `creditLine(state)` give the sentences. | portal, product apps (`seatFloor: 0` in their default usage) |
| Invoices | `GatewayInvoice`, `core.billing_invoices` and `InvoiceRow` have `creditAppliedCents` and `refundedCents`. A first invoice that is $0.00 because credit paid it stays in the invoice list. | billing-ui |
| Test gateway credit | Kept on the customer document (as Stripe keeps a customer balance), so it survives a plan that ends and comes off the first bill of a new plan. Older subscription documents with credit are read once and moved. | none |
| Promo code | `applyTestPromo(rt, { sessionId, promoCode })` saves the code on the test checkout session. `getTestCheckout` returns `promo`, `creditAppliedCents` and `firstChargeCents`. The `plan_started` email takes an optional `firstChargeCents`. | test checkout page |
| Activity | New actions `payment.credit_used`, `checkout.duplicate_refunded`, `account.email_changed`. `plan.changed` summaries end with what the change did to money. | activity page |

**One plan per organization**

| What | Detail |
|:-|:-|
| New gateway methods | `expireOpenCheckoutSessions(customerId)` and `cancelAndRefund(subscriptionId)`. `GATEWAY_CONTRACT_VERSION` (now 2) must be raised when `BillingGateway` changes; the portal rebuilds its cached runtime when it moved. |
| `createCheckout` | Asks the gateway for a live subscription of the customer first (a plan paid a moment ago in another tab is taken in and the answer is `already_subscribed`), then closes every other open pay page. |
| `rejectSecondSubscription` | In `sync.ts`, called by `applyCheckoutSession` and `fetchAndApplySubscription` under `lockOrgBilling` (one writer per organization per transaction). A second live subscription for an organization whose own plan is live is canceled and refunded, with an activity line and a log line. If the plan we know is gone at the gateway, that is recorded first and the new one is let in. `applySubscriptionSnapshot` never lets another subscription of the same gateway overwrite a live row. |
| Test gateway | `completeTestCheckout` runs under the same lock and in one transaction. A second page answers `already_subscribed`; a declined first payment leaves nothing behind. |

**People**

| What | Detail |
|:-|:-|
| Invite needs a verified email | In `beforeCreateInvitation`, so it holds at every door. Code `EMAIL_NOT_VERIFIED`. Decision for older accounts: accounts made before `INVITE_NEEDS_VERIFIED_EMAIL_SINCE` (2026-11-23) were never asked to verify and may keep inviting. Move the date to the launch day if the launch is later. |
| Invite cap | `INVITES_PER_DAY`: 50 a day for an organization with no paid plan, 500 with one. Code `INVITE_LIMIT_REACHED`. On top of the per address limit of the auth layer. |
| Invite proof | `billingOrganizationOptions` takes `inviteSecret` (every app passes `BETTER_AUTH_SECRET`). The emailed link is `/invite/<id>?t=<proof>` (`signInviteProof`). The portal proxy moves the proof into the httpOnly cookie `kitstak.invite_proof` and redirects to the clean address. Accepting with a valid proof marks the email verified and sends no code. The invitation id alone proves nothing, because the people who sent the invite can see it. |
| Join from an invite | `joinInviteAction` (portal) checks the seat, then makes the account, then accepts, and removes the account again if the accept is refused. `getInviteView` returns `seatAvailable`; the page shows "has no free seat right now" instead of the form. |
| Seat floor, changed | `belowUsageMessage` counts people plus open invites, at checkout and on plan changes. |
| Change an unverified email | `changeUnverifiedEmailAction` (portal): only while the email is unverified, only for password accounts, 3 tries an hour. Sends a new code and keeps the account, the organization and the trial. |
| Billing manager cleanup | The trigger `core.billing_manager_cleanup` on `core.member` removes the `core.billing_managers` row when a member is deleted or deactivated, at every door, and writes a `manager.removed` activity line. |
| Microsoft sign in, changed | `TRUSTED_LINK_PROVIDERS` in `@kitstak/auth` is `['google']`. A Microsoft sign in joins an existing account only when the token carries `xms_edov` (`microsoftEmailVerified` in the portal). |
