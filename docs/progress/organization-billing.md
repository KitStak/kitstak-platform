# M11 organization-billing — progress

## Found at start of run 2 (files from an unlogged run 1)
- grid-defs: `src/lib/grid-defs/organization/{common,clients,customers,retailers,billing,billing-reports,vas}.ts` (schemas, matrices, tiers, periods).
- repos: `billing.ts` (contracts + fees), `billing-engine.ts`, `billing-reports.ts` (bills, lines, calculate), `clients-shared.ts` (addresses, names, log helpers).

## Run 2 — done
- Repos: `clients.ts` (rewritten: grid, detail with KPIs/users/contracts, create/edit/settings, status, guarded delete), `customers.ts`, `retailers.ts`, `vas.ts`, `clients-import.ts`; `billing-reports.autoCalculateDue` (scheduler).
- Fixed in owned repos: correlated subqueries referenced unqualified outer columns (drizzle drops table names in single-table selects) so counts/names were wrong; now `table.column`. VAS type lookups with NULL warehouse were hidden by `scopedWhere`; custom scope now. Custom/to-date calculations no longer advance `nextPeriodStart`.
- APIs (all `defineRoute`, permission keys from catalog): clients (+settings, bulk-status, bulk-delete, change-log), customers (+bulk-active, bulk-delete, change-log), retailers (+bulk-delete, change-log), billing (+fees, approve, cancel-approval, bulk-delete, duplicate, calculate, change-log), billing-reports (+lines, approve, cancel, bulk-delete, change-log, Edit Info PATCH), vas-operations (+vas-types, bulk-delete, change-log).
- UI: all 10 routes (grids, wizards, drawers, detail pages, Calculate dialog, inline fee form with condition modal + tiers + live preview, printouts in a new window).
- Scheduler `billing-periods` configured (hourly; bills approved contracts once per closed period). Import handlers `clients` (upsert by code) and `vas-operations` configured.
- Tests: `tests/unit/organization-billing/{billing-rules,repositories}.test.ts` — 21 passing.
- Verified (API + headless Playwright, tab cap prevented the built-in browser): every route renders with no console errors; client wizard 4 steps with validation/back/address modal → detail page; billing create → fees (storage + condition + 2 tiers, recurring) → Calculate → bill → Edit info; customer drawer (all inline errors, shipping-address rule, create); retailer 3-step create; VAS drawer create; client settings save; bulk menus.
- Acceptance: KS-E2E Client (3 switches, default shipping) created, KPIs 0, listed in wizard picker, dropped when Inactive. KS-TEST Apex acceptance contract (Receiving 0.25/unit, Pick&Pack 3/SO, Storage 25/location at period end, Recurring 50) calculated for 2026-10-01..11-04 → 556.50 + 9 + 725 + 50 = 1,340.50, equal to hand-computed DB totals; detailed lines reference PO/SO codes; bill number 261106001; Approve blocks delete. Tier split 150 → 425 (unit test). VAS Programming (hours) × 2 billed under the VAS fee in the next calculation.

## Remaining / pending on foundation (docs/requests/organization-billing.md)
- REQ-1 `/api/me` contextOptions should drop Inactive clients (ClientSelect without warehouseId).
- REQ-2 `retailer` platform entity (attachments / file auth / custom fields); documents kept in `custom_fields._documents` meanwhile.
- REQ-3 export grid key `billing-report-lines` so the Detailed tab can Export As Excel.
- Export providers for M11 grids still use the generic fallback (works off the list endpoints).

## Decisions
- Clients grid `f.warehouseId=in:<id>` (used by shared `ClientSelect` in wizards) means "clients usable in that warehouse" = Active clients.
- Change logs served by module endpoints `/api/<entity>/[id]/change-log` (client, customer, retailer, billing_contract, billing_report, vas_operation).
- M11 forms use `mode: "onSubmit"` so the shared SubmitBar isn't disabled by a blur error before the first submit click.
- `/api/vas-operations/types` was renamed `/api/vas-operations/vas-types` (the dev server kept serving a stale compiled `types` route).
