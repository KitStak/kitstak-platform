# KitStak | Ledger: reference

Status: reference only (2026-11-27). This is not a spec and nothing here is approved to build. It records what Ledger is for, where its
edges are, and how it would fit the apps that already exist, so a later spec starts from settled ground. Read it with
[`docs/crew/REFERENCE.md`](../crew/REFERENCE.md), its sibling.

---

## 1. In one line

**Ledger is the money app.** Invoices and collections, vendor bills and payments, expenses, bank reconciliation and month-end close, for
kitting, 3PL and contract packaging shops.

Working tagline (draft): *Bill it. Pay it. Close it.*

## 2. Why it belongs in the suite

The suite already knows what a shop earned and what the work cost. It does not yet hold the money itself.

- **WMS** builds 3PL bill lines (receiving, storage, pick and pack, shipment, work orders) and exports approved invoice lines. Someone then
  retypes them into an accounting tool.
- **Pulse** knows earned revenue, cost and profit per job. It tracks **billed** only as a memo number and its **Ready to bill** report ends
  in a CSV "so a standalone shop can hand it to accounting" (`docs/pulse/SPEC.md` 4.8).
- **CRM** knows the account and the deal terms, but not whether the customer has paid.

Ledger closes that loop: the bill lines become a real invoice, the invoice gets paid, the payment lands in the bank, and the month closes
once, for every app.

## 3. Scope

| Area | What it covers |
|---|---|
| **Invoices** | Draft from WMS bill lines, Pulse work not billed yet, Programs price cards, or by hand. Line items, taxes, terms, credits, recurring invoices (monthly storage), PDF and email through `@kitstak/mail`. |
| **Collections** | Aging (current, 1 to 30, 31 to 60, 61 to 90, over 90), reminders on a schedule, a promise to pay with a date, disputes on a line, partial payments, write offs. Online card and ACH pay links. |
| **Vendor bills and payments** | Bills from suppliers (boxes, film, labels), temp agencies, freight carriers, rent and utilities. Approve, schedule and record payment. Match a bill to what was received when that applies. |
| **Expenses** | Card spend and reimbursements with receipt photos, a category and, when it applies, a job or client so it can count in Pulse. |
| **Reconciliation** | Bank and card feeds, match payments and deposits to invoices and bills, flag what does not match. |
| **Month-end close** | A close checklist, accruals for work done and not billed yet, lock the month, and one close shared with Pulse (see 5.3). |

### 3.1 Not in Ledger (first pass)

- **Running payroll.** Crew exports approved hours to the payroll provider. Ledger books the payroll journal that comes back.
- **Tax filing.** Ledger produces the reports (sales tax collected, 1099 vendor totals). Filing stays with the shop's accountant.
- **KitStak's own subscription billing.** That is `@kitstak/billing` and Stripe, which charges KitStak's customers. Ledger is the
  customer's own books. The two must never share tables or wording on screen.
- **Inventory valuation.** Client-owned stock in a 3PL is not the shop's asset. Supplies the shop buys are an expense or a small supplies
  account, not a perpetual inventory ledger.

## 4. The big choice: books of record, or a front end to an existing tool

This decides most of the build and is the first open question (section 9).

| Option | What it means | Cost |
|---|---|---|
| **A. Sync out** | Ledger owns invoicing, collections, bills and expenses, and pushes the entries to QuickBooks Online or Xero. Reconciliation and close checks run against the synced books. | Smaller build, no accounting trust bar to clear. Two tools for the shop. |
| **B. Books of record** | Ledger holds a real double entry general ledger, chart of accounts and financial statements. | Much larger: audit trail, period locks, opening balances, accountant access, bank feeds, migration from QuickBooks. |
| **C. A, then B** | Ship option A. Keep the data model double entry from day one, so B is a later switch and not a rewrite. | Recommended starting point. |

Under every option, money follows the suite rules: whole cents as `bigint`, unit prices to 4 decimals, dates of work as plain `YYYY-MM-DD`
(`docs/programs/SPEC.md` conventions, Pulse 4.2).

## 5. How Ledger fits the other apps

### 5.1 Flows in

| From | What comes across | Notes |
|---|---|---|
| **WMS** 3PL Billing | Approved bill lines per client and period | Becomes a draft invoice. The WMS approve step stays the source of truth for the line amounts. |
| **Pulse** | Work done and not billed yet per job and client | Ready to bill turns into "Create invoice" instead of a CSV. |
| **Projects** Programs | Price card lines and runs | Program runs can invoice on a cadence (weekly, monthly). |
| **CRM** | Account, billing contact, payment terms from the won deal | Uses `core.customers`, so no customer is typed twice. |
| **Crew** | Approved hours per agency and week | Lets Ledger check a temp agency bill against the hours Crew recorded (see the Crew reference). |

### 5.2 Flows out

| To | What goes across |
|---|---|
| **Pulse** | Invoice rows replace typed or imported `revenue_entries` of kind `invoice` (billed memo, still never in profit). Vendor bills and expenses tagged to a job or client become `cost_entries` at job, client or company scope (Pulse 4.7). |
| **CRM** | Balance, oldest open invoice and days past due on the account. A collections board or automation can start from it. |
| **Projects** | Collections follow ups and close checklist items as tasks with an owner and a due date. |
| **Portal** | A "Money owed to you" and "Bills due" tile on the launcher home. |

### 5.3 One month close, not two

Pulse already closes months (`docs/pulse/SPEC.md` 4.16): it checks Things to fix and the payroll check, snapshots totals and locks rows.
If Ledger adds its own close, a shop could close October in one app and not the other. The reference position:

- When an org has Ledger, the **Ledger close is the close**. It runs the Pulse checklist as one of its steps and locks Pulse's month in the
  same action.
- Without Ledger, Pulse closes on its own, exactly as today.
- Reopening follows the Pulse rule: a reason, and it is logged.

### 5.4 Pulse earned vs Ledger billed

Pulse's rule stays: profit uses **earned** revenue and invoices never change profit. Ledger is where billed and collected live. The two
numbers sit side by side, and the gap between them is the accrual Ledger books at month end.

## 6. Shape in the platform (if it is built)

Follows the existing pattern from `docs/integration/BLUEPRINT.md` and the Pulse spec. Nothing here is decided.

| Piece | Proposal |
|---|---|
| App | `apps/ledger`, package `kitstak-ledger`, own Vercel project, dev port 3700 |
| Schema | `ledger`. Vendors are a `core` candidate (Crew's temp agencies and WMS suppliers are the same companies) |
| Entitlement | New module key `ledger` in `packages/entitlements/src/modules.ts`, counts toward the bundle discount |
| Bridge | `@kitstak/ledger-bridge`: read balances and invoice status for CRM, Pulse and Portal, no HTTP between apps |
| Integrations | Stripe for card and ACH pay links (the shop's own Stripe account, not KitStak's), a bank feed provider, QuickBooks Online and Xero for option A |
| Roles | Money roles are sensitive. A floor lead in WMS must never see payables. Reuse the org roles and add `money:read` and `money:write` style permissions as Pulse does |

## 7. Works on its own

A shop with only Ledger still gets invoicing, collections, bills, expenses and reconciliation, with customers kept in `core`. Adding WMS
later fills invoices from bill lines. Adding Pulse later shows job profit beside what was billed and collected.

## 8. Hard parts to plan for

- **Trust.** Money mistakes cost the shop real cash and their accountant's patience. Every posted entry needs an audit trail and no
  silent edits after a month closes.
- **Bank feeds** are a vendor choice with real cost per connection, and reconnect flows break often.
- **Sales tax** on kitting and 3PL services varies by state. Many shops charge none, some must. Keep it a rate table, not tax logic.
- **Migration.** Most shops already run QuickBooks. Opening balances, open invoices and open bills have to come across cleanly or nobody
  switches.
- **Wording.** Billing (KitStak's subscription) and invoicing (the shop's customers) must never blur on screen.

## 9. Open questions

1. Books of record, sync out, or sync first then books (section 4)? Recommended: sync first, double entry model from day one.
2. Which accounting tool first for sync: QuickBooks Online, Xero, or both?
3. Do vendors move into `core` so Ledger, Crew (temp agencies) and WMS (suppliers, carriers) share them?
4. Does the Ledger close replace the Pulse close when both are present (section 5.3)?
5. Does WMS 3PL Billing keep its own invoice export once Ledger exists, or does export become "Send to Ledger"?
6. Card and ACH collection through the shop's own Stripe Connect account: in the first pass or later?

## 10. Brand and website

**Icon and loader (in the repo, 2026-11-27).** The brand pack's Ledger icon is a T: a red bar over a pink stem. Its loader opens the bar,
then drops the stem in.

- Shared icon: `AppIcon app="ledger"` in `packages/ui/src/app-icon/app-icon.tsx`. It is not in any app list, launcher or switcher yet.
- Files: `apps/web/public/brand/apps/kitstak-icon-ledger.svg` and `apps/web/public/brand/loaders/kitstak-loader-ledger.svg`.
- The icon runs taller than the five live icons (y 40 to 160). Widen `APP_ICON_ARTWORK_BOX` before it goes into a lockup.
- Still to do when the app is real: copies in `apps/ledger/public/brand/`, `src/app/icon.*`, a `brand-loader.tsx`, the Portal launcher
  mark, and PNG exports at 512 and 1024.

**To do on kitstak.com (not started):**

- **A placeholder.** A "Coming soon" Ledger card on the products page, with the icon, the one line pitch from section 1 and a "Tell me
  when it's ready" link to the contact form. Keep it out of pricing, the price calculator and sign up until it can be bought.
- **More documentation.** Site docs are Markdown in `apps/web/content/docs/<app>/` (how to write one: `apps/web/content/docs/README.md`),
  and the app list is `DOC_APP_IDS` in `apps/web/src/lib/docs/docs.ts`. Add a `ledger` folder when the app ships, with at least getting
  started, invoices, collections, bills and payments, reconciliation and month-end close. Until then, a short "What's coming" page in
  `getting-started` can cover Ledger and Crew together.
