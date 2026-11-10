# M06 inventory — shared-change requests

## REQ-1 — Seed the M06 acceptance fixtures
- **File:** `src/server/db/seed/**` (foundation seed for MLT1).
- **Change:** add, in warehouse MLT1 for client ACME (or the seed's MLT1 demo client):
  - products `MLT-WIDGET-01` and `MLT-WIDGET-02` (Each, untracked);
  - locations `MLT1-A-01` (`only_one_sku = 1`, Storage, Stock) and `MLT1-B-01` (Storage);
  - stock via `ledger.add`: 20 × `MLT-WIDGET-01` @ `MLT1-A-01`, and 4 × `MLT-WIDGET-02` @ `MLT1-C-01` (a third,
    normal location) so a transfer of WIDGET-02 into `MLT1-A-01` hits the rule;
  - one open shipment order with a line for 2 × `MLT-WIDGET-01` (so Open SO Qty and the deep link have data);
  - lookup values `adjustment_reason` "Import" (used by the Import Inventory handler) and `damage_reason` "Damaged".
- **Reason:** BUILD_PLAN M06 acceptance ("Adjust MLT-WIDGET-01 @ MLT1-A-01 from 20 to 18…", "Transfer Product 5 to MLT1-B-01",
  "a transfer into an Only-1-SKU location… is blocked", "Change Damage Reason → Damaged"). The live DB has none of these
  (no `only_one_sku` location at all, no "Import" / "Damaged" reasons). The same flows are covered by
  `tests/unit/inventory/*.test.ts` on an in-memory DB; M06 cannot write products/locations (M09/M10) or the seed.
  Until it lands, the Import handler falls back to no reason id with the note "Import (row n)".
- **status:** applied (F-patch 2026-11-06): idempotent `src/server/db/seed/acceptance-fixtures.ts` + `npm run db:fixtures` (also chained in `db:reset`), run against the live DB. Client APX (the MLT1 demo client; there is no ACME). Created MLT-WIDGET-01/02, locations MLT1-A-01 (Only 1 SKU, Reserve/Storage), MLT1-B-01 (Reserve/Storage), MLT1-C-01 (Picking), stock 20 × WIDGET-01 @ A-01 and 4 × WIDGET-02 @ C-01 via `ledger.add`, open order SO010856 (2 × WIDGET-01, client ref KS-FIXTURE-M06), lookups adjustment_reason "Import" and damage_reason "Damaged".

## REQ-2 — Orders grid: line-wise SKU filter
- **File:** `src/server/repositories/orders-grid.ts` (`ORDER_SQL.sku`, M01).
- **Change:** compile `f.sku` as `EXISTS (SELECT 1 FROM order_lines l JOIN products p … WHERE l.order_id = so.id AND <op on p.sku>)`
  instead of comparing against the `' / '`-joined SKU list.
- **Reason:** `f.sku=eq:MLT-WIDGET-01` misses every multi-line order. M06 works around it: the Open SO Qty links go
  through `GET /api/inventory/open-orders`, which resolves the exact open orders and redirects to `/orders?f.code=in:…`.
  With this change the fallback (`f.sku=ct:` for more than 400 orders) becomes exact as well.
- **status:** applied (F-patch 2026-11-06): `f.sku` is compiled line-wise in `orders-grid.ts` (`EXISTS` over order_lines/products for eq/ct/sw/ew/in/…; `nin` = no line matches; `ex`/`empty` = has / has no lines). Sort and column display still use the joined SKU list.

## REQ-3 — Shared shell / grid contrast and accessible names (axe "serious")
- **Files:** `src/components/grid/data-grid.tsx` (header cells), `src/components/layout/page-header.tsx` (breadcrumb),
  the route tab strip, `src/components/layout/app-shell.tsx` (header search placeholder, context switcher,
  notifications and account buttons).
- **Change:**
  - grid header labels and page tabs/breadcrumbs use `#98a2b3` on `#fff`/`#f6f7f9` (2.4–2.57:1): darken to at least
    `#667085` (4.5:1+);
  - header search placeholder `#bfc2d0` on `#49517a` (4.32:1): lighten to `#d0d3de`;
  - `label-content-name-mismatch`: the context switcher ("All WH · All"), Notifications (badge "1") and Account
    buttons have an `aria-label` that does not contain their visible text; start each label with the visible text
    (e.g. "All WH · All — change working context").
- **Reason:** A0.5 requires axe with no serious issues on every M06 page; these are the only remaining violations on
  `/inventory`, `/inventory/by-location` and `/inventory/atp` and none is in M06's paths. The M06 e2e a11y test excludes
  `header`, `nav` and `thead` until this lands.
- **status:** applied (F-patch 2026-11-06): grid header labels, inactive page tabs (+ counts) and breadcrumbs now use `text-secondary` (#667085, hover `text-foreground`); header search trigger text white/65 -> white/80 and its kbd white/55 -> white/75; context switcher, account and HeaderIconButton (Notifications, Help, Printers) are named by content (visible text first or sr-only label + visible badge) instead of a mismatching `aria-label`. M06 e2e can stop excluding `header`, `nav`, `thead` (re-run axe to confirm).
- **Foundation pass 1 (2026-11-09):** verified all REQs above are DONE (pass 1); no further shared change pending.
- **Foundation pass 2 (2026-11-09):** re-verified against the code; all REQs above DONE (pass 2), no further shared change pending.

## Round 2 requests

### REQ-4: Toast position covers drawer footers
- **Files:** `src/components/ui/toast.tsx` (viewport placement), shared.
- **Change:** render the toast viewport at the **top-centre** with filled banners (Success green, Error red, Info blue), or at least
  offset it so it never overlaps an open right-side drawer's sticky SubmitBar.
- **Reason:**
  - Logiwa live capture (references/logiwa-live/inbound-inventory.md, Delta #12) puts toasts at the top centre.
  - In KitStaks the bottom-right toast sits over the Save/Cancel buttons of the Adjust and Transfer drawers for about 5 s after a
    save. It was seen in a headless screenshot of Transfer Product opened right after an adjust.

### REQ-5: DataGrid loading state in footer and export (critic R1 #3)
- **Files:** `src/components/grid/grid-footer.tsx`, `src/components/grid/export-button.tsx`, `src/components/grid/data-grid.tsx` (shared).
- **Change:** while `loading` (list `isPending`, no data yet) the footer should show "Loading…" (skeleton pill) in place of
  "Total: 0 / 1 page", and Export As Excel should be disabled with the tooltip "Wait for the rows to load".
- **Reason:** on a cold load every inventory grid reads "Total: 0" for several seconds, so the page looks empty and export looks
  available. M06 can't change the footer from its own paths.
- **Status:** DONE (foundation round 2, 2026-11-10): footer part done (GridFooter `loading`).

### REQ-6: ARIA grid semantics on the virtualized DataGrid (critic R1 #11)
- **Files:** `src/components/grid/data-grid.tsx`, `data-grid-body.tsx`, `data-grid-header.tsx` (shared).
- **Change:** `role="grid"` + `aria-rowcount={total + 1}` + `aria-colcount` on the table; `role="row"` + `aria-rowindex` (1-based,
  header = 1, absolute index including the page offset) on each rendered `<tr>`; `role="gridcell"` / `role="columnheader"` on cells.
- **Reason:** virtualization removes off-screen rows, so screen readers lose their position; `getByRole('row')` finds 0 rows today.

### REQ-7: Callout "info" variant uses the red brand primary (critic R1 #6)
- **Files:** `src/components/ui/callout.tsx` (shared).
- **Change:** `info: { box: "border-info/25 bg-info-soft", icon: "text-info" }` instead of `primary`. With the KitStak red rebrand
  `primary-soft` + `text-primary` reads as an error. M06's ATP banner now renders its own neutral note as a workaround; once this lands it
  can go back to `<Callout variant="info">`.
- **Status:** DONE (foundation round 2, 2026-11-10): Callout `info` uses the info tokens.

### REQ-8: Kit Inventory / Kit Component tabs keep the Inventory nav section (critic R1 #8)
- **Files:** `src/config/nav-config.ts` (foundation) — the "Kit Inventory Report" and "Kit Component Inventory Availability Report"
  items (lines ~301-302) live under Reports, so `/inventory/kits` and `/inventory/kit-components` resolve breadcrumb "Home / Reports" and
  highlight Reports in the top nav.
- **Change:** resolve the active section/breadcrumb for `/inventory/*` from the Inventory group first (e.g. add `/inventory/kits` and
  `/inventory/kit-components` as `aliases` of the Inventory item, or let the page-tabs group "inventory" win over a Reports match).
  Keep the Reports entries as shortcuts.

### REQ-9: Kit Inventory / Kit Component grids (M08-owned, critic R1 #7 and #9)
- **Files:** `src/components/kits/kit-inventory-page.tsx`, `src/components/kits/kit-components-page.tsx`, their grid-defs (M08).
- **Change:**
  - Warehouse column: use the same label as Total/ATP (`CODE - Name`, see `bucketSql` CASE in `inventory-by-location.ts`), not the bare code.
  - Default column order on Kit Inventory: SKU, Warehouse, Current Inventory, Pending Order Qty, Required Kitting, Net Kitting Capacity,
    Total Inventory Capacity first; move Barcode, Pack Type, Product Group behind the column chooser (hidden by default).
  - Kit Components: put Warehouse right after the component SKU (or group rows by warehouse) so repeated SKUs across warehouses don't look
    like duplicates.

### Round 3 additions (2026-11-09)
- **REQ-R2-1 (foundation, `src/server/db/seed/verify.ts`)**: add a `bad-date` check that flags `inventory.expiry_date` / `production_date` (and `inventory_transactions` from/to expiry) where `date(x) IS NULL OR date(x) <> x`. Current dev DB has 3 empty buckets with `2026-02-31`, `2026-13-45` and `2027-05-08T05:00:00.000Z`. The server now validates with `isValidIsoDate` (exported from `src/server/repositories/inventory-commands.ts`), so imports (`src/server/imports/validate.ts`) should reuse it as well.
- **REQ-R2-2 (shared DataGrid, still open as REQ-6)**: (a) give `<table>` role=grid and rows/cells role=row/gridcell/columnheader; (b) reserve right padding in the header row equal to the column-settings button width, so the last visible header ("TOTAL", "F…", "UNI…") is never covered; (c) show a right-edge shadow or fade when the grid scrolls horizontally.
- **REQ-R2-3 (M08 kits, `src/components/kits/kit-inventory-page.tsx`, `src/lib/grid-defs/work-orders/kits.ts`, `src/config/nav-config.ts`)**: /inventory/kits and /inventory/kit-components should highlight Inventory in the top nav, with breadcrumb Home › Inventory › Kit Inventory (and Kit Component Inventory Availability). The Warehouse column should use `CODE - Name` like the other three tabs (SQL: `CASE WHEN w.name LIKE w.code || '%' THEN w.name ELSE w.code || ' - ' || w.name END`). Move Pending Order Qty, Net Kitting Capacity and Required Kitting Qty ahead of Barcode, Pack Type and Product Type so they show at 1440px.
- **REQ-R2-4 (shared page tabs, `src/config/page-tabs.ts` renderer)**: at widths under 900px, make the tab strip horizontally scrollable with an edge fade, or collapse it to a select. Keep Export As Excel on the pager row.
- **REQ-R2-5 (counts)**: `src/components/counts/count-sheet.tsx` imports `countedValueError`, which does not exist in its target module. Dozens of console errors appear on every inventory page in dev.
- **REQ-R2-6 (reports M11)**: link Transaction History (ledger, ~55 columns, transaction-type and from/to filters), Inventory Snapshot, Serial Number and Order Inventory reports from an inventory "Reports" menu. Inventory will add the menu once the report routes are confirmed stable.

### Round 2 (parity loop, critic 6.4) additions — 2026-11-09
- **REQ-R2-7 (shared filter builder, `src/components/grid/filter-builder/**`)**: enum/reference editors (Warehouse, Client, Status…) need an
  `in | not in` operator toggle; text filters should offer equals / contains / starts with / ends with / exclude / is empty (Logiwa parity).
  M06 grid-defs already declare the fields; the editor UI is shared.
- **REQ-R2-8 (shared `src/components/ui/control-styles.ts`)**: focus ring uses `primary` (brand red), which reads as an error on selects
  and inputs. Use a neutral/blue focus token (e.g. `focus-visible:border-info ring-info/25`) so red means only `aria-invalid`.
- **REQ-R2-9 (shared `src/components/shared/entity-pickers.tsx` + `/api/pickers/locations|lps`)**: (a) WarehouseSelect label renders
  "MLT1 · MLT1 - Main Fulfillment"; use `code - name` unless the name already starts with the code. (b) Add `countLockPlan` and `onlyOneSku`
  to location / LP picker items and show a lock badge + reason in the option description, so restricted locations are flagged in the list
  itself. M06 already flags the picked destination via `/api/inventory/placement-check`.
- **REQ-R2-10 (M08 kits, `src/components/kits/kit-components-page.tsx`, `kit-inventory-page.tsx`)**: (a) "Included Kits" should be links to the
  kit product / Kit Inventory row; (b) Kit Inventory needs a per-row "Last Updated" column (the stat's `updatedAt`) instead of only the toolbar
  stamp; (c) header labels overlap at 1440px ("TOTAL ORDER QUANTITY ⓘ TOTAL IN…"): use `headerWidth(label, min, hasTip)` from
  `src/components/inventory/inventory-shared.tsx` for column sizes; (d) warehouse label + breadcrumb/nav still open from REQ-R2-3.
- **REQ-R2-11 (shared NumberInput, `src/components/ui/number-input.tsx`)**: `commit()` clamps to `min` and rounds to `decimals` on blur,
  silently changing what the user typed (-2 → 1, 1.5 → 2). M06 moved to its own `QtyInput`; other modules still have the behaviour.
  Suggest: never clamp on blur; let the form schema report the error.

### Round 4 additions (2026-11-09)
- nav-config.ts (shared): /inventory/kits and /inventory/kit-components are registered under the Reports section, so the top nav highlights Reports and the breadcrumb reads "Reports > Kit Inventory Report". Please also register them (or set them as primary) under Inventory with the labels "Kit Inventory" / "Kit Component Inventory", so the nav and breadcrumb match the Inventory tab strip.
- /api/kits/recalculate POST (M08 owner): it is gated on KIT_PERMISSIONS.inventory (read). Please require a write permission, so a viewer gets 403. The UI button is now hidden for viewers.
- /api/pickers/locations + platform-pickers (shared): the typeahead takes 2-4 s (cold) and up to 15 s in the browser. Target is under 500 ms: add indexes on locations(warehouse_id, code), apply LIMIT before the join, and avoid a count query. The picker should also keep its open state across re-renders.
- DataGrid (shared): the column-chooser icon overlaps the last visible header. Reserve its width as a right header gutter or a sticky cell, and add a right-edge fade or scroll shadow when the grid overflows horizontally.
- ui/tabs.tsx UnderlineTabs (line ~148): add `outline-none` so a mouse click shows no default focus outline; keep the focus-visible ring.
- Inventory tab strip / GridToolbar at 768 px (shared layout): make the tab strip horizontally scrollable with an edge fade, and collapse the bulk buttons into an overflow menu below lg.
- Fixture hygiene (e2e/critic owners): KS-CRIT-API-1 and KS-E2E-* products show up in ATP. Please have test suites create them under a dedicated test client, or clean them up afterwards.

### Round 5 additions (2026-11-09)
- **REQ-R2-12 (shared, `src/lib/query-client.ts` useApiMutation):** `onSuccess` awaits `invalidateQueries(...)` (which waits for the active grid refetch) before showing the toast and calling the caller's `onSuccess`. Under load this kept drawers open for up to 60s after a 200. Ask: fire invalidations without awaiting (or add `awaitInvalidate?: boolean`, default false) and toast first. Inventory works around it with `useInventoryRefresh` (no `invalidate` option).
- **REQ-R2-13 (shared, `src/components/grid/grid-prefs.ts` `defaultGridPrefs`):** support a column-level `meta.defaultPinned` so a page can freeze identifying columns by default (Inventory by Location wants checkbox + SKU + Location pinned left). Today `pinned` is always `[]` until the user pins in the column chooser. Inventory moved Location next to SKU in the default order meanwhile.
- **REQ-R2-14 (shared, `src/components/ui/control-styles.ts`):** focus uses `border-primary` / `ring-primary`, and the brand primary is red, so a focused control looks like the invalid state. Ask: a neutral/info focus token for controls, red only for `aria-invalid`. Inventory overrides its Note textareas with `NOTE_FOCUS` meanwhile.
- **REQ-R2-15 (shared, `GridToolbar`/`PageHeader`):** at 768px the bulk bar wraps and Export As Excel drops below the pager. Ask: collapse header actions and bulk actions into an overflow menu under `md`.
- **REQ-R2-16 (M08 work-orders-kitting, `src/components/kits/*`):** (a) Kit Inventory / Kit Component pages highlight the "Reports" top-nav item and use the breadcrumb "Reports > Kit Inventory Report" while living in the Inventory tab strip. Pick the Inventory IA (active nav = Inventory, breadcrumb Inventory > Kit Inventory). (b) Column headers are sentence case ("Pack type name", "Kit type", "Product name"). The other three Inventory tabs use Title Case. (c) "Create work order" is correctly disabled for Kit to Order rows (e.g. APX-KIT-TEE3), but the critic saw no reason. Make sure the `DisabledReason` tooltip appears on hover and focus, or show the reason inline next to the button.
- **REQ-R2-17 (data/seed owner):** grid rows still show leftover critic PO numbers `KS-CRIT-R3-…`. Clean them out of the demo DB/seed, or rename them.

### REQ-R2-18 (Round 6, 2026-11-09): cross-module type-check gate (owner: foundation / build)
The critic saw every route (including /api/inventory/*) return 500 for minutes because another module's file
(`src/server/repositories/waves-run.ts`: "Export plannedWindow doesn't exist in target module") broke the shared build.
Request: a pre-merge `npx tsc --noEmit` gate for all modules, plus a lint rule or CI step that blocks broken imports before they hit the
shared dev server. Inventory can't fix this from its own files.

### REQ-R2-19 (Round 6): URL-encoded search with comparator + removable chip (owner: shared grid, GridToolbar/useGrid)
Logiwa writes `?psku=X&pskuqt=eq` and shows a removable "Product SKU equals X" chip, and the search box turns solid blue while a search
is active. Our toolbar writes free text `?q=`. Request: GridToolbar should encode the comparator next to q (e.g. `?q=X&qop=eq`),
render the active search as a chip with an × button, and give the input an active state. Inventory will adopt it without changes.

### REQ-R2-20 (Round 6): Transaction History deep-link params (owner: reports)
Inventory now links to /reports/transaction-history from the header Reports menu and from the bucket drawer's Transactions tab. Please accept
`?sku=&location=&warehouseId=` (and `lot`/`lp`) query params as initial filters, so the drawer can open the report already scoped to one bucket.

### REQ-R2-21 (Round 6): async export history (owner: shared exports)
Logiwa runs Excel exports asynchronously and lists them in a top-bar Transactions popup. Our exports are synchronous. /reports/export-history
exists; a top-bar popup that shows status is a shared shell change.

### Round 3 (parity loop, critic 7.8) additions — 2026-11-10
- **REQ-R2-22 (ledger / receiving / counts owners: `src/server/domain/ledger/operations.ts` `add`, receiving commands, count Update Inventory):** never write lot, expiry or production values for a product whose `track_lot` / `track_expiry` / `track_production_date` flag is off. Preferred fix: in `ledger.add`, and in `move` when it changes attributes, either null out untracked attributes or throw `ruleViolation`. M06 Add Inventory, Import and Change Attributes already refuse these values. The dev DB had MLT-WIDGET-02 stock with lot LOT-QA-01 and expiry 2026-02-28, written by one of those paths.
- **REQ-R2-23 (admin-settings, Adjustment Reasons page):** add a "Direction" select (Increase / Decrease / Both, default Both). It writes `lookup_values.meta.direction` for `type = 'adjustment_reason'`. Inventory reads it through `reasonDirection()` in `src/lib/grid-defs/inventory/reason-direction.ts`, falls back to a name-based default when it is unset, and enforces it on client and server.
- **REQ-R2-24 (foundation, `src/server/db/seed/verify.ts` and `package.json`):** call `findInventoryHygieneIssues` from `src/server/repositories/inventory-hygiene.ts` inside `verifyDatabase`. Treat `untracked-attribute` and `bad-date` as failures, and `empty-bucket` as a warning. Add `"db:hygiene": "tsx scripts/inventory-hygiene.ts"` (pass `--apply` to repair). This supersedes REQ-R2-1.
- **REQ-R2-25 (foundation, `src/lib/format.ts` `toDate`):** parse a bare `YYYY-MM-DD` as a local calendar date (`new Date(y, m-1, d)`), not as UTC midnight. Today every `DateCell dateOnly` and `fmt.date()` in the app shows the previous day west of UTC. Inventory works around this with `src/components/inventory/inventory-dates.tsx`.
- **REQ-R2-26 (shared grid / UI):**
  - (a) `GridFooter`: hide "Selected: N" when DataGrid has `selectable={false}` (Total Inventory, ATP).
  - (b) Add a shadow at the horizontal-scroll edge, and right padding on the header so the column-chooser gear never covers the last header (still REQ-R2-2 b/c).
  - (c) `UnderlineTabs` triggers lack `outline-none` and use the brand-red ring. Use a neutral focus token (REQ-R2-14).
  - (d) `Drawer` focuses the × when the body has no form field. Focus the dialog content instead (`tabIndex=-1`), so drawers opened with the mouse show no focus box.
  - (e) Move the toaster to top centre (REQ-4).
  - (f) The search comparator defaults to Starts With, while Logiwa defaults to Equal. This is a shared GridToolbar setting.
- **REQ-R2-16 / R2-3 still open (M08, plus foundation `src/config/nav-config.ts`):** /inventory/kits and /inventory/kit-components are registered under the Reports nav group (nav-config.ts, about lines 301-302). As a result the top nav highlights Reports and the breadcrumb reads "Reports / Kit Inventory Report". Move both under Inventory › Inventory, labelled "Kit Inventory" and "Kit Component Inventory Availability". Changes in `src/components/kits/kit-inventory-page.tsx` and `kit-components-page.tsx`:
  - Warehouse column: replace `warehouseCode` (110px) with the `CODE - Name` label, about 190px wide.
  - SKU cells: use `SkuLink` from `src/components/inventory/inventory-shared.tsx` to get the external-link icon.
  - Client column: 190px.
  - Long headers: size with `headerWidth()`. "Total Order Quantity" currently collides with the next header.

### Round 4 (parity loop, critic 7.5) additions — 2026-11-10
- **REQ-R2-27 (shared exports, `src/components/grid/export-button.tsx` + `src/app/api/exports/route.ts`):** when `POST /api/exports` fails (the critic saw 500 with an empty body on every Export As Excel for ~20 min while `providers.ts` was mid-edit), the button does nothing. Show an error toast ("Couldn't start the export. Try again.") with the server message when there is one, and show the Logiwa toast "Started preparing the Excel file…" on 202. The providers now type-check (`report-serial-receipts` / `report-serial-shipments` resolve), so re-test Export on /inventory, /inventory/by-location and /inventory/atp after the next dev restart. The export history popup is still REQ-R2-21.
- **REQ-R2-28 (shared filter builder, still REQ-R2-7):** add an operator dropdown per editor: enum/reference `in | not in`; text `equals | contains | starts with | ends with | exclude | empty`; number Min–Max; date presets. The Client editor shows "No matching values" until its options load; show a spinner instead.
- **REQ-R2-29 (shared `GridFooter`, still REQ-R2-26a):** footer now shows "—" while loading (thanks). Still open: hide "Selected: N" when `selectable={false}` (Total Inventory, ATP; By Location for viewers now passes `selectable={false}` too).
- **REQ-R2-30 (shared entity pickers, `src/components/shared/entity-pickers.tsx`):** M06 now uses its own `DestinationPicker` (`src/components/inventory/destination-picker.tsx`, backed by `GET /api/inventory/destinations`) that badges and disables count-locked and occupied only-1-SKU destinations. Other modules (putaway, replenishment, work orders) would benefit from the same: consider promoting it to the shared pickers with a `restrictionsFor={{ productIds, exclude }}` prop.
- **REQ-R2-31 (data/test owners, still REQ-R2-17):** test fixtures dominate the demo views: ATP first page lists KS-CRIT-API-1, KS-CRIT-P1, KS-CRIT-API-BADHI…, KS-E2E-LST-GC50, KS-CRIT-R3-WIZ-27…; Kit Component shows "Included kits: KS-CRIT-R2B-KIT-3571" (absent from Kit Inventory); a By Location sub-label reads "PO KS-CRIT-R3-MWA7JKFH…". Ask: critic/e2e suites create their data under a dedicated test client (e.g. `KS-TEST`) and delete it afterwards, and a one-off `scripts/purge-test-fixtures.ts` removes existing `KS-CRIT-*` / `KS-E2E-*` products, POs and orders through the ledger. M06 has not deleted them because other modules' suites may still reference them.
- **REQ-R2-32 (ledger owner, `src/server/domain/ledger`):** an attribute repair for allocated units. Bucket 976a3fdd (MLT-WIDGET-02 @ MLT1-B-01) keeps expiry 2026-02-28 on 1 allocated unit of an expiry-untracked SKU. `ledger.changeAttributes` only moves free units, so the hygiene repair can't clear it until the order ships. Ask: `ledger.relabelBucket(bucketId, attrs)` that rewrites the attributes in place (allocations keep pointing at the same bucket) and posts an "Attributes Change" row. M06 now masks untracked values in the grid ("-" with a tooltip naming the stored value), the sub-label and the drawer ("Not tracked (stored …)").
- **Still open from earlier rounds:** REQ-4 / R2-26e (toasts top centre), REQ-R2-2b / R2-26b (header gutter for the column gear, (i) icon beside right-aligned labels), REQ-R2-14 / R2-26c (neutral focus ring; the kebab and the selected combobox still show brand red), REQ-R2-16 / R2-3 (kit pages under Reports in `nav-config.ts`, `CODE - Name` warehouse, Last Updated column, quantity columns first), REQ-R2-18 (cross-module tsc gate; today `lp-type-wizard.tsx` is the only tsc error), REQ-R2-19 / R2-26f (search comparator default Equal + removable chip).

- **REQ-R2-33 (shared, import framework):** Import Inventory history grid (Status, Master Row Count, Success, Error, Uploaded By, Created), an error-details drawer and a template download. It needs an import-jobs table and a shared import-history component.
- **REQ-R2-34 (shared grid FilterPopover):** New/Saved tabs, field search, typed editors (text operators, min/max, date presets, in/not in) and a save-filter chip action.
- **REQ-R2-35 (reports module, transaction history):** about 55 columns; every txn type including Disassemble Kit, Cancel Receiving and Replenishment; a serial-number tab; and a `f.inventoryId=eq:` per-bucket filter so the bucket drawer can deep-link precisely.
- **REQ-R2-36 (shared DataGrid/export):** skeleton loaders for the grid footer counts and the export button while a query is loading.
- **REQ-R2-37 (perf/infra):** measure /inventory and /inventory/by-location on a production build on a quiet machine. The dev server currently takes more than 30 s for every route under agent load.

- **REQ-R2-37 (inbound-receiving):** Create Purchase Order should accept `?sku=&qty=` (Kit Component Reorder Quantity drill already sends `warehouseId` and `sku`) and pre-add that product line with the reorder qty. `po-create-page.tsx` now reads `warehouseId`/`clientId` only.

### Round 5 (parity loop, critic 6.6) — 2026-11-10
- **REQ-R5-1 (infra, BLOCKER for every critic round):** in this round the dev server answered `/api/health` in 65 s, and ATP first paint took 288 s in headless Chromium. The critic could not click anything. Please restart the dev server, which sits at about 8 GB, before the next critic pass. Better still, serve critics a `next build && next start` instance on a second port (REQ-R2-37), so module edits stop invalidating the critic's pages. M06's own SQL is 3–55 ms (blind round 3 profile).
- **REQ-R5-2 (shared `src/components/grid/grid-footer.tsx` + `data-grid.tsx`, still REQ-R2-29):** pass `selectable` from DataGrid to GridFooter and hide the "Selected: N" segment when it is false. This is a two-line change. Total Inventory and ATP are read-only.
- **REQ-R5-3 (shared `src/components/grid/filter-builder/field-editors.tsx` EnumEditor, still REQ-R2-28):** add an operator select with "in" and "not in". The grid grammar already compiles `nin`.
- **REQ-R5-4 (shared `src/server/query/grid-query.ts` + `search-mode.tsx`, still REQ-R2-26f):** allow a per-grid default quick-search mode (`useGrid({ defaultSearchMode: "eq" })`), so ATP and Total can default to Equal as Logiwa does. Serialisation should then omit `qm` only when it matches that grid's default. M06 now shows its own removable search chip (`inventory-search-chip.tsx`). GridToolbar could adopt it for every grid.
- **REQ-R5-5 (reports, still REQ-R2-35):** add `f.inventoryId=eq:` to Transaction History, or a "Location (From or To)" field. The bucket drawer then needs one link instead of the Into / Out of pair.
- **REQ-R5-6 (data/test owners, still REQ-R2-31):** 19 fixture products remain: 17 under APX (KS-CRIT-* and KS-E2E-*) and 2 under BLB. Most have open SO lines and no stock, so they lead ATP's shortage-first default sort. Please run a fixture purge that cancels their orders through the orders module and archives the products. M06 has not touched other modules' orders.
- **REQ-R5-7 (M08 + `nav-config.ts`, still REQ-R2-16):** the Kit Inventory and Kit Component pages still register under Reports at nav-config.ts lines 301-302, and their headers are sentence case.

### Round 6 (parity loop, critic 6.8) — 2026-11-10
- **REQ-R6-1 (infra, BLOCKER, still REQ-R5-1 / R2-37):** the critic's "skeleton for 480 s with no API request" is the server-rendered HTML of a page whose client bundle never arrived. The skeleton rows, the "Total: —" footer, the blank page-size select (Radix shows its value only after hydration) and the disabled Export all match that. No client timeout can arm before hydration. The POST 500s ("Jest worker encountered 2 child process exceptions") are the dev compile worker crashing under load. This round `/api/health` took 44 s and By Location took 63 s to commit. Please give critics a separate production instance, `next build --dist-dir .next-critic && next start -p 3100`, or restart the dev server between rounds. M06 now shows a CSS-only "Still loading… Reload page" notice after 12 s that needs no JavaScript, plus a JS Retry alert after 30 s (`GridStallNotice`), so a buyer is never left on bare skeleton rows.
- **REQ-R6-2 (shared `grid-footer.tsx` + `data-grid.tsx`, still REQ-R5-2 / R2-29):** hide "Selected: N" when `selectable={false}`. This is the third request. It is a two-line change, but the file is shared, so M06 cannot make it.
- **REQ-R6-3 (shared `data-grid-header.tsx`, still REQ-R2-2b):** reserve a fixed right gutter (about 36 px) for the column-chooser gear, or move the gear into the toolbar as Logiwa does. It currently covers the last visible header ("ALLOCATED PACK QTY", "WAREHOUSE", "UOM PA…").
- **REQ-R6-4 (shell owner, global "Feedback & Updates" tab):** collapse the vertical side tab to an icon, or dock it bottom-left, so it never covers a grid's sticky kebab column at 1440×900.
- **REQ-R6-5 (shared filter chips, `filter-chips.tsx`):** M06's search chip now uses the info (blue) palette. The shared filter chips still use `primary-soft` (brand red), which reads as a validation error. Please move them to `border-info/30 bg-info-soft text-info` so both chip types match.
- **REQ-R6-6 (inbound-receiving / data owners, still REQ-R5-6):** real MLT1 buckets still carry PO numbers from critic POs (KS-CRIT-BULK-A, KS-CRIT-R2-425013, KS-CRIT-R3-MWA7JKFH, KS-CRIT-R3B-A2M2K, KS-CRIT-R5-MWAJ8H8Q), so the By Location sub-label reads "PO KS-CRIT-…". M06 has added `npx tsx scripts/inventory-hygiene.ts --apply --purge-fixtures [--idle-minutes=N]`. It removes idle free stock from KS-CRIT-*/KS-E2E-* *locations* through the ledger. This round it removed 5 units of MLT-WIDGET-01 from KS-CRIT-R4W20005. Stock received from fixture POs into real locations belongs to the receiving fixtures, so M06 has left it alone. KS-CRIT-R6-LOC1 (10 × CPL-MUG-12OZ) is still in use by this round's suites and is kept until it has been idle for 60 minutes.
- **REQ-R6-7 (shared toolbar / filter / export / toaster, unchanged):** typed text and enum operators (REQ-R2-28 / R5-3), a per-grid default search mode of Equal (R5-4), the async export toast and the Transactions popup (R2-21), and top-centre toasts (REQ-4).
- **REQ-R6-8 (reports, still REQ-R5-5):** a `f.inventoryId=eq:` or "Location (From or To)" filter on Transaction History.
- **REQ-R6-9 (M08, partly done by M06):** M06 has changed the Kit Inventory and Kit Component column headers and actions to Title Case, because the inventory builder was assigned these pages this round. The pages still register under Reports in `nav-config.ts` (REQ-R5-7).

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** REQ-4 / R2-26e (toasts top centre), REQ-6 / R2-2a (rows/cells carry `role="row"` / `role="cell"`, headers `role="columnheader"`, `aria-rowcount` / `aria-rowindex`), REQ-8 / R2-3 / R2-16 / R5-7 (Kit Inventory and Kit Component Inventory items in the Inventory menu; active nav = Inventory), REQ-R2-2b / R6-3 (column chooser gutter), R2-2c / R2-26b (right-edge fade), REQ-R2-8 / R2-14 / R2-26c (neutral info focus ring), REQ-R2-9a (no change needed), REQ-R2-12 (mutation invalidations no longer awaited; toast and onSuccess run at once), REQ-R2-13 (`meta.defaultPinned` seeds default pins), REQ-R2-15 (bulk row wraps), REQ-R2-18 (gate: `npm run typecheck` is clean), REQ-R2-24 (`db:verify` runs `findInventoryHygieneIssues`: untracked-attribute and bad-date fail, empty-bucket is a warning), REQ-R2-25 (already done), REQ-R2-26a / R2-29 / R5-2 / R6-2 (Selected hidden when `selectable={false}`), REQ-R2-26d (drawer without a field focuses the panel), REQ-R2-27 (export error toast), REQ-R6-5 (filter chips use the info palette), R2-36 (export disabled with "Wait for the rows to load").
- **Not done:** REQ-R2-1 (superseded by R2-24), R2-4 tab strip overflow, R2-7 / R2-28 / R5-3 / R2-34 typed filter operators, R2-11 NumberInput clamp, R2-19 / R5-4 / R2-26f search comparator default and chip, R2-21 async export popup (tray exists), R2-30 shared DestinationPicker, R2-31 / R5-6 fixture purge, R2-32 `relabelBucket`, R2-33 import history, R2-22 ledger untracked-attribute guard, infra items.
