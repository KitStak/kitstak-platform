# M02 shipping — progress

Round 1 builder. Owned paths per BUILD_PLAN M02.

## Decisions
- EOD manifests: foundation `shipOrders` only links labels to a manifest at ship time, and the
  `(warehouse, connection, ship_date)` unique index blocks a second manifest after close. The EOD
  grid therefore merges stored manifests with "pending" groups derived live from unlinked active
  shipping labels (grouped by warehouse, carrier connection and the warehouse-local label date).
  Total package is always the live count of non-voided shipping labels in the group, so creating
  or voiding a label moves the number on the next refresh. See REQ-1/REQ-2.
- Pending groups whose labels are all voided are hidden (nothing to hand to the carrier).
- Closing writes go through `src/server/repositories/end-of-day-adapter.ts` (interim, REQ-1).
- Shipment plan "Shipped" status is never set directly from the popover: it routes to Ship, which
  ships every Ready to Ship order through `shipping.shipOrders`, then walks the plan along the
  state-machine path to Shipped.
- Expected weight is lb (Σ qty × product weight oz / 16), expected volume ft³ (Σ qty × L×W×H / 1728).
- Permission-gated controls read `useHydratedPermissions()` (shipping-client): empty until hydration,
  which fixed a hydration mismatch on `/shipment-plans` (header "Create shipment plan" button).
- Add order(s) uses the local `plan-order-picker.tsx` on `/api/shipment-plans/eligible-orders`
  (server-filtered to warehouse/client/eligible statuses/not on another active plan) because the
  shared OrderPickerDrawer crashes (REQ-3).
- Export providers stay on the generic fallback (exports exactly what each list endpoint returns);
  verified all six grids export to xlsx in Export History.

## Done (verified live on localhost:3000, 2026-11-06)
- All 7 routes render with no console errors; 404 state for a missing plan.
- Label → Carrier Shipment Details + EOD +1; void → Voided + void date, EOD −1; void again / reprint
  voided → INVALID_STATE (orders SO010847/SO010848, KS-TEST customers).
- EOD close of the 2026-11-05 pending group → Closed, close date, Printed Yes, PDF with Code 128
  barcodes; reprint and custom report PDFs; close again → per-id failure. Confirm dialog with mini-table in UI.
- Shipment plan KS-E2E-SP-1 with 2 orders: popover offers only legal next statuses, illegal → INVALID_STATE,
  stale version → 409 CONFLICT, Picking/Job operations created the job, Ship → both orders Shipped, plan
  Shipped with actual shipment date, Plan Orders tab reflects it, change_log rows written, Manifest/BOL PDF.
- Shipment History rows for SO010847 match the ledger (qty 1, tracking linked).
- Wizard: auto code, inline errors + focus on first error, Next/Back across 3 steps, order picker add,
  unsaved-changes guard on Cancel (fixed) and close.
- Viewer: reads 200, every M02 mutation 403.
- Unit tests: tests/unit/shipping (21 passing).

## Remaining / waiting on foundation
- REQ-1, REQ-2 (second manifest same day after close), REQ-3 (shared picker), REQ-4 (Esc in combobox), REQ-5 (seed LPs).
- Built-in browser tab cap was reached by other agents; UI checks ran in headless Playwright with the
  project's e2e storage states instead. Side-by-side visual critic vs Logiwa not done this round.

## Round 1 (parity loop) - 2026-11-09
- Re-read references/logiwa-live/outbound.md sections 8-11 and masterdata-reports.md (Shipment History).
  Shipment Plan (3 sub-tabs, toolbar Delete/Ship/Print/Picking-Job ops, truck columns, Large/Small),
  Carrier Shipment Details, End Of The Day (Custom / EOD / Reprint, REPORT PRINTED?) and Shipment
  History (37 columns, filters, Export) already match the live capture.
- Smoke (headless Playwright, admin + viewer) of /shipments, /shipments/end-of-day, /shipments/history,
  /shipment-plans, /shipment-plans/orders, /shipment-plans/lps: all 200, no console errors for admin.
- Fixed: viewer on Shipment plan orders / LPs tabs got a red "Something went wrong / no permission"
  grid error plus console 403s. `plan-subgrids.tsx` now checks `view_plan_orders` / `view_plan_lps`
  after permission hydration, never fires the request without it, and shows a "You don't have access
  to this view" empty state. Verified: no 403s, no console errors.
- tsc clean for owned paths; tests/unit/shipping 21/21 passing.
- Filed REQ-6 (viewer grant for `view_*` actions), REQ-7 (GridToolbar inline bulk count, so EOD
  Reprint is a third direct button like Logiwa), REQ-8 (date vs datetime format consistency).
- Remaining: REQ-1..REQ-8; side-by-side visual critic vs Logiwa still not run (Browser pane reserved).

## Round 1 (parity loop) — 2026-11-09
Source: references/logiwa-live/outbound.md §8–§11 + Delta 13/14, and the live Ship behaviour (#5, #6).
- **Ship result window (Logiwa parity):** Ship (grid bulk, status popover → Shipped, plan detail) now always ends in a
  result dialog instead of a toast: title "All orders shipped" / "Some orders couldn’t be shipped" / "No orders could be
  shipped", **Success N / Error N** badges and a Plan | SO code | Result | Description table (SO code links to the order).
  src/components/shipment-plans/ship-result{,-dialog}.ts(x); old shipToast removed.
- **Error text** for a non-ready order now reads like Logiwa: "The shipment order status is not valid (Open); only Ready to
  Ship orders can be shipped" (shipment-plans.ts shipPlan).
- **Selection clears after every bulk action** (Logiwa #5): plan Print Manifest/BOL and Carrier Shipment Details Reprint
  now clear the selection too (Ship/Delete/Void/EOD prints already did).
- Unit: 	ests/unit/shipping/ship-result.test.ts (row flattening, PARTIAL de-dup, titles); shipping-flow.test.ts:60
  updated for REQ-1 (isPending: false — labels join a real Open manifest at label time). 23/23 passing. 	sc clean.
- Verified headless on localhost:3000: created plan SP000043 with Open order SO010700 → Ship → Yes → result dialog
  "No orders could be shipped", Success 0 / Error 1, row reason as above; Close works; plan deleted afterwards (cleanup).
  No console errors on the plan detail page.
- Already at parity (re-checked against the live capture): three sub-tabs PLAN / ORDERS / LPS; toolbar Delete, Ship,
  Print ▾, Picking/Job Operations; truck columns; EOD three print actions + REPORT PRINTED?; Carrier Shipment Details
  "Label create date: Last 30 days" default chip; Shipment History order-code links; Large/Small density in footer.
- Blocked during this pass: other modules' in-progress edits (receiving wizard) intermittently broke the dev build, so
  the full-route visual sweep could not complete cleanly; retry next round.
- **EOD → Carrier Shipment Details drill-down fixed (was a dead link):** "Total package" / "Show packages" filtered on the
  UTC label date, so an evening (US time) manifest of 2 packages opened an empty grid. New filter field **Manifest ship
  date** (manifestShipDate = the manifest's warehouse-local ship_date, UTC label date when not on a manifest; date-only)
  and the drill-down now uses it. Verified live: KSB-MLT1 / MLT1 / 2026-11-09 manifest (2) → /shipments shows exactly 2
  (SO010848). Unit test "EOD Total package drill-down matches the manifest's warehouse-local ship date". 24/24 passing.
- Filed R2-1 (UTC date filters), R2-2 (disabled destructive bulk button styling), R2-3 (chip label wrap) in docs/requests/shipping.md.

## Round 2 (parity loop) — 2026-11-09
Critic round-1 verdict 7; fixes:
- **Latency:** profiled. EOD grouping, pending labels, shipments list (incl. the new location sub-select) and history
  run in 0–24 ms directly on the DB (shipments_eod_idx, tasks_order_idx already exist). Warm API calls are ~300 ms, the
  same as /api/me; the 8–40 s numbers are dev-server compile/load (see request R2-7). No index change needed.
- **Shipment history:** SHIPMENT TYPE is now the second column (pill), plus an ADJUSTMENT REASON column. Remove
  Inventory rows show the adjustment reference `ADJ-<ledger seq>` in the order code column instead of "—". New
  filter/sort/search fields `reference` and `adjustmentReason` (grid-defs/shipping/shipment-history.ts,
  repositories/shipping-history.ts joins lookup_values). The checkbox column is back, so export-selected works; the
  remaining header/cell offset is in the shared DataGrid (R2-4).
- **Destructive bulk buttons:** Void labels / plan Delete are red only once something is selected (neutral otherwise),
  and every mutation control (Void, Reprint, Delete, Ship, Print ▾, Picking/job operations, EOD close/reprint/custom)
  is hidden for roles without the permission (viewer sees a read-only toolbar).
- **EOD TOTAL PACKAGE:** neutral tabular numerals with a dotted underline (still drills into the packages).
- **Dates:** one module format — `shipDateTime` (MM/DD/YYYY h:mm A, no seconds) and `shipDay` (MM/DD/YYYY) in
  column-kit.tsx; used by EOD ship date, void dialog, package drawer, plan detail and plan dialogs (closes REQ-8 locally).
- **Print custom report:** a standalone toolbar button that always works, opening a parameter dialog — ship date
  range (required), carrier, warehouse, client; selected manifests pre-fill the range and carrier.
  `/api/end-of-day/print-custom` accepts `{ ids }` or `{ from, to, carrierCodes?, warehouseCodes?, clientName? }`
  (zod union); `printCustomReportByParams` + pure `selectCustomReportRows`. Empty result → INVALID_STATE "No active
  packages match these report parameters."
- **EOD toolbar = Logiwa's three direct buttons:** Print end of the day report, Reprint, Print custom report (closes
  REQ-7 without the GridToolbar change).
- **Carrier marks:** `CarrierMark` (UPS / USPS / FedEx / DHL / Amazon / OnTrac colour badge + name) in the EOD carrier
  column. These are generic monogram badges, not the trademarked logos.
- **INVENTORY LOCATION / INVENTORY PARENT LPN** on Carrier Shipment Details: fall back to the order's packing task
  (then picking task) location and LP when the label has no packed-from location. Now PACK-01..04 on every seeded row;
  the same expression is used for sort and filter.
- **RBAC:** operator can create plans because of the role seed, not M02 code. Filed as R2-6.
- Unit: tests/unit/shipping/eod-custom-report.test.ts (range, reversed range, carrier/warehouse filter, dialog seeding).
  28/28 passing; tsc clean for owned paths.
- Still open: REQ-2 (second manifest the same day after close), R2-1 (UTC date chips), R2-4 (shared grid header padding).

## Round 3 (parity loop), 2026-11-09
Fixed against the round-2 critic verdict (7.3):
- **Plan readiness gating.** `planShipBlockReason(status, orderCount, loadedCount, shippedCount)` blocks Ship when no
  unshipped order is Ready to Ship. The plan list and detail disable Ship and show the reason as a tooltip.
  `POST /api/shipment-plans/[id]/ship` now returns 409 INVALID_STATE instead of 200 with every order in `failed[]`.
  The eligible-order picker has a Readiness column and warns when selected orders are not picked or packed. The
  wizard Orders step shows how many orders are not ready.
- **Expected load default.** `withOrderTotals` fills expected weight and volume from the orders when a plan is saved
  with 0/0, on both create and edit. Verified: SP000044 (SO010794) saved as 0.54 lb / 0.07 ft3. The detail tile also
  shows "orders total N lb" (`orderWeightLb`). Plans created before this fix keep 0 until they are edited.
- **Plan detail.** Added the breadcrumb Home > Fulfillment > Shipment Plans > code. Orders, License plates and History
  are now tabs; History shows the activity timeline and links to the full change log. Delete is a labelled red button,
  separated from Ship by the Change log divider.
- **End of the Day.** Rows are one manifest per warehouse, carrier setup and ship day. After a close, the next labels
  open sequence + 1 (`ensureOpenManifest` uses the schema's `sequence` column, which closes REQ-2). A new "Manifest #"
  column shows the sequence. Open manifests from past ship days are flagged "Not closed" (`isOverdue`).
- **Duplicate active labels** are flagged "Duplicate" on Carrier shipment details (`duplicateActiveLabels`). Blocking
  them belongs to the label creators (R3-2).
- **History API.** `orderCode` is never null. Remove Inventory rows return their `ADJ-<seq>` reference.
- **Options API.** Without a warehouseId, `/api/shipment-plans/options` returns every active carrier in scope.
  eligible-orders still requires a warehouse, because a plan belongs to one warehouse.
- Unit tests: readiness gating cases in tests/unit/shipping/grid-defs.test.ts. The EOD fixture includes sequence and
  isOverdue. vitest tests/unit/shipping: 29/29 passed. tsc is clean on the module's paths.

Still open, filed in docs/requests/shipping.md:
- Operator RBAC (R3-1, foundation seed).
- Relabel block (R3-2).
- Grid header alignment (R3-3).
- Latency: the dev server took 16 to 87 s on cold API hits during this run because it was compiling for several
  agents at once. Warm SQL is under 25 ms. See R2-7.

## Round 4 (parity loop), 2026-11-09
Fixed against the round-3 critic verdict (7.4):
- **Expected load tile.** The plan list/detail API now returns `orderWeightLb`, `orderVolumeFt3` (both summed from order
  lines × product weight/dims, not the order header) and `missingDimsProducts`. The pure `expectedLoad()` in
  plan-form-model.ts picks one source: the line totals when nothing is stored or the stored value agrees, or the stored
  value labelled "entered on plan (order lines: X lb, Y ft³)" when they differ. Missing product weight or dims show a
  warning tone ("N products missing weight or dimensions") instead of a silent 0.00. SP000041 now reads 4.00 lb, entered
  on plan (order lines: 3.00 lb, 0.17 ft³). Tests: tests/unit/shipping/expected-load.test.ts.
- **Order picker empty state.** When there are no rows, the empty state renders outside the horizontally scrolling grid,
  so it is never clipped. It also says "No orders match these filters" when a search or filter is active.
- **Viewer access (REQ-6).** `/api/shipment-plans/orders` and `/lps` accept either the tab permission or
  `fulfillment.shipment_plan.view` (any-of). The sub-grid page uses the same rule. Viewer now gets 200 on both.
- **Disabled Delete** on plan detail is neutral grey (`text-faint`) and keeps the tooltip "Only Open shipment plans can
  be deleted".
- **Naming.** The list title, detail breadcrumb, back link and not-found link all say "Shipment Plan", matching the nav
  and tab label.
- **Latency.** Warm timings on 2026-11-09: every list endpoint returned in 30–250 ms for admin, operator and viewer.
  The 2.5–4 s the critic saw came from the first hit, when the dev server was compiling for several agents. Repository
  SQL was not the cause. The "Total: 0 while loading" footer is in the shared GridFooter (R4-1).
- **Order link.** GET /orders/SO010854 returns 200 now (fixed by orders-outbound). The shipping links are unchanged.
- **Operator void/EOD close.** The routes check permission keys only (`fulfillment.shipment_orders.void_label` and
  `fulfillment.end_of_day.print_end_of_the_day_report`), not roles. Granting them to operator is a seed change (R4-2).
- Checks: vitest tests/unit/shipping 33/33 passed. tsc is clean on the module's paths. The headless visual check was
  blocked by another module's build error (packing/pack-screen.tsx imports a missing `PackPreview`). The 768px and
  dark-mode re-check is still pending.

## Round 5 (parity loop), 2026-11-09

- **Compile safety.** tsc is clean on every shipping/shipment-plans path before and after each save. The round-4
  stray-comment blocker is gone.
- **Grid latency.** Profiled against the real DB. The data is tiny (5 plan-order links, 458 shipments, 126 LPs), the
  queries are single SELECT + COUNT statements with no per-row queries, and the join columns are indexed. Measured on
  the shared dev server: `/api/me` alone took 0.9-2.3 s, and a 404 route took 1.6-3.3 s. `/api/shipments` took 1.2-2.7 s
  warm. The 10-30 s outliers match on-demand compiles caused by concurrent agents' HMR. Grid time is dominated by
  dev-server contention, not module SQL, and should be re-measured on `next build && next start`. The "Total: 0 while
  loading" footer is shared (R4-1, still open).
- **Expected load tile.** The tile now names only the dimension that differs ("volume entered on plan"). The order-line
  comparison moved to its own wrapping line, so nothing clips. It warns "Order lines have no weight or volume: products
  missing dimensions" whenever the orders have units but zero line weight or volume. Unit-tested.
- **Plan details: carrier, customer and address inherit from orders** (`deriveFromOrders`). A single shared value shows
  with "(from orders)". Different values show "Mixed (n)" with the list in a tooltip. Unit-tested.
- **Status pencil.** It is hidden for final statuses (Shipped, Cancelled). For editable rows it shows only on hover or
  keyboard focus, and always on touch devices.
- **Operator permissions (R4-2).** Verified against the API with a CSRF token. Operator now holds void_label,
  reprint_label, print_end_of_the_day_report and print_custom_report, and the routes accept operator calls (200, with
  per-id NOT_FOUND for a bogus id). Viewer gets 403 and the UI hides those controls (already permission-gated). The UI
  and API now agree.
- **Filed as shared requests (R5-1..3):** local formatting of change-log dates (Timeline ISO value), the Wizard step
  error pill and scroll-to-first-error, and filter-chip wrapping at 768px.
- Checks: vitest tests/unit/shipping 45/45 passed. tsc is clean on the module's paths. Headless screenshot of the plan
  detail page: no console errors.

## Round 6 (parity loop), 2026-11-09

- **Plan status vs order status:** the plan detail page shows a "Partially shipped · N of M" badge next to the status
  pill whenever some of its orders have shipped (the rule: a partial ship holds the plan at Loading Started; a full
  ship moves it to Shipped). The Shipped tile subtitle now matches its number ("1 order shipped, 1 remaining" / "Not
  shipped yet" / "All shipped on …"). The Loaded tile says "N of M ready or shipped" and has an info tip. When Ship is
  blocked, a reason line under the lifecycle stepper explains why, on top of the existing hover/focus tooltip.
  Orders shipped from outside the plan still don't move the stored plan status; that needs foundation change R6-1.
- **Expected load tile:** a module-owned tile replaces the truncating StatTile. The warning and detail wrap.
- **Timeline:** `PlanTimeline` shows ISO values in change-log messages in local date-time format
  (`localizeIsoInText`).
- **Create wizard:** Status is locked to Open (`PLAN_CREATE_STATUSES = ["Open"]`). Actual shipment, Loading started,
  Loading completed and Truck departed are not entered at create; on edit they are read-only. The server forces them
  to null on create and keeps the stored values on edit. Only lifecycle transitions and Ship stamp them.
- **Carrier / customer "(from orders)":** shown only when every order agrees. When some orders have no value, the label reads
  "(partial: N of M orders)". Different values still show as Mixed.
- **Carrier Shipment Details:** the first view now reads Order code, Package ("1 of 2", M marks the master), Tracking
  number, Label status, Carrier, Shipment method, Rate, Master tracking, then Order status, Products and Inventory
  location. When a label has no item breakdown, Products falls back to the order lines, shown as "Order: SKU × qty".
  Inventory location falls back to a sibling label's packed-from location.
- **EOD:** the Status column is wider and the "Not closed" note doesn't shrink. The Carrier column shows the carrier
  setup name (Logiwa "UPS - UPS-TEST" parity). The Total package tooltip explains that voided labels are counted separately.
- **Latency:** not re-measured on a production build this round. During the round the dev server returned 500 for every
  route because of another module's in-progress import error (`waves-run.ts` -> `plannedWindow`). See Checks.
- Filed R6-1..R6-4 in docs/requests/shipping.md.
- Checks: vitest tests/unit/shipping 55/55 passed (new `plan-progress.test.ts`). tsc reports no errors on the module's paths.

## Round 2 (parity loop), 2026-11-09, pass 6 (critic verdict 6.5)
Fixes for the round-1 critic list, each checked headless on localhost:3000 (scripts and screenshots are in
%TEMP%/claude/kitstak-critic/shipping/r6*.mjs / r6*.png):
- **Void shows every package that will be cancelled.** New read-only endpoint `POST /api/shipments/void/preview`
  (`previewVoid`) returns the selection plus the Active master-tracking siblings, with `labelCount` and `shipmentCount`.
  New `VoidLabelsDialog` (720 px, so all six columns fit with no clipping): siblings are tinted and tagged "also voided",
  a warning band says "1 more package is on the same multi-package shipment", and the confirm reads "Yes, void 2". If the
  preview fails, the dialog offers Try again. `voidShipments` returns `labelsVoided` / `shipmentsVoided`, and the toast
  reads "2 labels voided (1 shipment)" (`voidSummary`). Verified on SO010855.
- **Search, filters and scroll are kept after a void.** The page now only refetches and clears the selection. Verified
  that `q=SO010855` and the chip survive.
- **One list request on mount.** /shipments waits for saved views, applies the "Last 30 days" chip through the same URL
  state, and only then enables the list query. Verified: a single `/api/shipments?f.labelCreatedAt=date:last30d`.
- **Neutral disabled destructive buttons.** Void labels and plan Delete are red only when the selection is eligible.
  Shipped or voided selections get the grey outline style with the tooltip "This label is already voided" (verified).
  The drawer's Void label button follows the same rule.
- **EOD.** The Ship from column shows the warehouse name once. A new "Voided packages" column (visible) drills into
  /shipments filtered to Voided labels for that manifest. A new row action "Show voided packages" and a "Voided
  packages" number filter (for example "> 0") are added. Total package keeps its neutral style, and the toolbar keeps
  three direct buttons (Print end of the day report, Reprint, Print custom report).
- **Expected load follows the orders on the server.** Adding or removing orders outside the wizard (`addPlanOrders` /
  `removePlanOrders`) recomputes expected weight and volume while they are still automatic: 0/0, or equal to the
  previous orders' totals (`isAutoExpectedLoad`). A value typed by hand is kept. Each recompute writes a change-log
  entry. Wizard create verified: SP000045 was saved with 0.54 lb / 0.07 ft³.
- **A partial ship explains the status move.** `PlanShipOutcome` now carries `previousStatus` and `statusNote`
  (`planStatusNote`). The ship result window lists "Plan moved from Open to Loading Started because 1 of 2 orders
  shipped. It becomes Shipped when the rest ship." The transition was already logged in change_log through
  recordUpdate.
- **Plan drawer footer.** The drawer body has no bottom padding under the sticky wizard footer, so nothing scrolls
  below the bar (verified at 900 px).
- **Add order(s) picker.** Added the WAREHOUSE, AGE (days, sortable and filterable) and TAGS (pills from entity_tags)
  columns. Verified headers: ORDER CODE | STATUS | READINESS | WAREHOUSE | CLIENT | CUSTOMER | STORE | ORDER TYPE |
  SKU | QTY | CREATED DATE | AGE | TAGS.
- **Sync to store.** Carrier shipment details has a new filter field and column, derived from a successful "Send
  Shipment Info" channel run item for the order's store order number at or after label creation. Delivery and
  shipment mail flags have no data source yet (request R6-2).
- **Walked end to end in the UI:**
  - Create wizard: General (warehouse validation), Others, Orders, Add order(s), Save. Toast "Shipment plan SP000045
    created with 1 order."
  - Plan detail: status popover (In Progress / Loading Started / Cancelled with helper text), Change log drawer, Edit
    drawer (three free tabs) and Delete confirm. The API delete then succeeded. The UI confirm was still pending at the
    5 s mark because the dev server was slow.
  - Viewer: the Shipment plan orders and LPs tabs both render, including LP ACTUAL WEIGHT / LP ACTUAL VOLUME.
- **Tests:**
  - tests/unit/shipping/void-and-load.test.ts covers voidSummary and isAutoExpectedLoad.
  - ship-result.test.ts covers status notes.
  - shipping-flow.test.ts covers the multi-package preview and void counts.
  - vitest tests/unit/shipping 55/55 passed. tsc is clean on the module's paths.
- Already done in earlier passes: history first-column reference / type pill, viewer REQ-6, and EOD dates.

## Blind-judge repair round 1, 2026-11-10
- **Plan Actual shipment shows a dash until the first ship.** The list and detail SQL now return `actual_shipment_at`
  only when the plan is Shipped or at least one of its orders has shipped. Verified via API that KS-CRIT-R6-77448
  (Loading Started, 0 shipped, a stale stored 2026-01-01 value) now returns `actualShipmentAt: null`, so the UI shows "—".
  Create and update already ignore client-supplied execution timestamps.
- **Carrier option columns now have a data source.** All the columns already existed (insurance type and value,
  confirmation type, zone, other cost, Saturday delivery, scheduled and actual pickup, delivery date, inventory parent
  LPN, external reference, rate shopping name, dimensions and units). Before this change, label creation never wrote
  most of them, so they always showed "—".
  - `POST /api/ops/shipping/labels` (`createLabelSchema`) and `createLabel` now accept insuranceType, insuranceValue,
    confirmationType, allowSaturdayDelivery, otherCost, externalReference and scheduledPickupAt. They are saved on
    every package row; otherCost goes on the master package only.
  - externalReference defaults to the order's store order number.
  - rateShoppingPresetId and isRateShopped are now saved on the shipment rows too.
  - Existing seeded rows are not backfilled.
- **Create return label** is now a row action and a bulk action (one package) on /shipments. It reuses the package's
  carrier connection, service and dimensions through `/api/ops/shipping/return-label`, and requires
  `fulfillment.shipment_orders.create_return_label`. It is disabled with a reason for unshipped packages, for return
  labels, and for labels with no service. The list rows now include carrierConnectionId and carrierServiceId. Verified
  in the row menu (r1 b2.png).
- **Not done this round:**
  - Shipment history columns up to about 30.
  - EOD per-carrier-setup grouping re-check.
  - Retailer/UCC and pick/pack short labels.
  - Plan toolbar Print.
  - A real UPS/USPS sandbox. It needs carrier developer credentials from the owner, and the adapters stay simulated.
- Checks:
  - vitest tests/unit/shipping: 63/63 passed.
  - tsc shows no errors on the shipping, labels and platform-ops paths.
  - Headless checks were slow because the dev server was under load from concurrent agents.

## Round 3 (parity loop), 2026-11-10 (critic verdict 6.4)

- **Loading gate search (blocker).** The shared LocationPicker sent `areaType=Loading,Shipment`, the picker API
  rejected it with a 400, and the raw zod text showed in the dropdown. The create and edit drawers now use a
  module-owned `GatePicker` (`plan-form-controls.tsx`). It makes one picker request per gate area type, merges the
  results with natural sort, and words every error as "Couldn't load locations. Try again." Unit-tested
  (`mergeGateResults`). Shared fix filed as R7-1.
- **Add order(s) 500 (blocker).** The 500 did not reproduce on the restarted dev server. Admin and manager get 200
  (60–75 ms warm) with and without `planId`, `sort` and `ps=1000`. Operator and viewer get 403 by design.
  `listEligibleOrders` called directly returned 45 rows. The dev log (`.next/dev/logs`) was empty, so the old requestIds
  can't be traced. The likely cause is a stale hot-reload module in which the grid-def advertised a field (AGE or TAGS,
  added in pass 6) with no SQL behind it. `exprFor` throws a plain Error in that case, and the route returns 500. The new
  `tests/unit/shipping/grid-specs.test.ts` asserts that every field, search field and sort field of the Plans, Plan
  orders, Plan LPs, eligible-orders and History grids has SQL, and runs every sort against a migrated DB, so this drift
  now fails CI instead of production.
- **EOD: one carrier per manifest.** Rows are keyed by (warehouse, carrier setup, carrier code, ship date).
  - USPS labels on an open UPS manifest count on their own USPS (pending) row.
  - On a closed manifest they show as a separate closed `split~` row. That row can be reprinted and drilled into, but
    not closed again.
  - Closing a manifest first moves the other carriers' labels off it (`detachOtherCarriers`). A carrier without its
    own open manifest gets one with the next sequence (`ensureOpenManifest` in the adapter, carrier-aware).
  - Every printed report (EOD, reprint, custom) filters packages to the row's carrier code.
  - Total and Voided drill-downs add a `carrier` filter.
  - Two flow tests cover this: a mixed open manifest closes per carrier, and a closed legacy manifest splits. Foundation
    fix filed as R7-2.
- **EOD PDFs.**
  - Close date and a new "Printed" line are formatted in the warehouse time zone and name the zone, for example
    `11/09/2026 9:56 PM CST`.
  - Ship date is zero-padded MM/DD/YYYY.
  - Every barcode has its human-readable tracking number under it.
  - Unit-tested (`formatWarehouseDateTime`, `formatShipDay`).
- **EOD grid at 1440.** Status now comes right after Carrier, and column widths are trimmed, so Open/Closed is visible
  without scrolling. Voided packages is 150 px with a 140 px minimum, so it is no longer cut under the frozen actions
  column.
- **Plan detail.**
  - The LOADED subtitle uses the same rule as the percentage. It read `o.status`, which doesn't exist; it now reads
    `orderStatus` and shows "1 of 1 ready or shipped".
  - Expected load: one source. `sumOrderLines` serves the create/edit estimate, the automatic expected load and the
    detail card, so the numbers can't contradict each other. The warning shows only when the computed value is 0 or
    products lack dimensions. A flow test asserts that the detail and the estimate agree.
  - "1 unit / N units" grammar, also in the add/remove toast.
  - On Shipped and Cancelled plans, and for users without `edit`, Add order(s) and the row remove column are hidden.
    That covers viewer: no 403 drawer.
  - Breadcrumb and back-link spacing tightened (gap-1).
  - License plates tab: orders with no LP row are listed as "shipped loose" or "not on an LP yet". Plan LPs now also
    reads parent LPs from Packing/Shipment ledger rows, Packing `to_lp_id` and the label's `parent_lp_id`. SO010839
    really shipped loose: no LP appears anywhere in its ledger.
- **Lifecycle times.** Logiwa lets the General step's times be entered, and the Edit drawer now does the same:
  - Loading started opens once the plan reaches Loading Started.
  - Loading completed and Truck departed open at Loading Completed.
  - Actual shipment is still set only by Ship.
  - The server (`mergeLifecycleTimes`) rejects clearing a stamped time, future times and out-of-order stages, and keeps
    times for stages not yet reached. Every correction goes through `recordUpdate`, so it is change-logged.
  - Unit-tested.
- **Change log drawer.** The module-owned `PlanChangeLogDrawer` (plans grid ⋯ and plan detail) localizes ISO values in
  messages and shows the operation date as `MM/DD/YYYY h:mm A` with no seconds, the same as the grid and timeline.
  The shared drawer request R6-2 is still open.
- **Package details drawer.**
  - When packing recorded no items, the drawer shows the order's open lines (SKU, product, lot, qty) with a note saying
    so.
  - New Shipment section: client, warehouse, inventory location, parent LP, package type, zone, insurance,
    confirmation, Saturday delivery, store sync, expected delivery and external reference.
  - New Carrier activity list from `carrier_call_logs`: label created, voided, rate request, plus errors.
- **Late-shipped labels.** Shipping a plan whose order has an active label on a Closed manifest still ships, but the
  result window now says which manifest, for which carrier and day, closed when, and to reprint it or void and relabel.
  Logic in `closedManifestWarnings`, with a flow test. Shipment Orders → Ship is foundation (R7-3).
- **Grids.**
  - Shipping column widths never go below their uppercase header (`headerMinWidth`), so "IS ALLOW SATURDAY DELIVERY"
    no longer runs into "SYNC TO STORE".
  - Plan code truncates with a title and has a 120 px minimum.
  - Warehouse cells and every default text cell carry a title tooltip.
  - For users without `change_status`, the status pencil is hidden, not just disabled.
  - Plan Orders and Plan LPs have a selection column and an "Export selected" bulk action (CSV, BOM, column order).
- **Errors.** An unknown order id on create or edit reads "Order <id> was not found or is not in this warehouse."
- **Not changed (shared or foundation, filed):**
  - Picker date format: BUILD_PLAN 0.1 mandates `YYYY/MM/DD HH:mm` (R7-4).
  - 768 px bulk-button overflow (R7-5). Filter-chip nowrap is in the foundation working tree.
  - Header ellipsis and chooser gutter (R6-1).
  - Delivery/Shipment mail-sent filters (R6-2, waits on columns).
- Checks:
  - vitest tests/unit/shipping: 71/71 passed (new: grid-specs, round3, and 4 flow tests).
  - tsc: no errors on the module's paths.

## Blind-judge repair round 2 - 2026-11-10
- ACTUAL SHIPMENT 12/31/2025 on an unshipped plan: a stray `actual_shipment_at = 2026-01-01T00:00:00Z`
  (written by an earlier critic API call; UTC midnight renders as 12/31/2025 locally). List SQL and
  `loadPlanRow` now return actual shipment only when the plan status is Shipped (dash otherwise);
  the Edit path already ignores client-supplied actual dates (`mergeLifecycleTimes`).
- Loading guard: `changePlanStatus` / `updatePlan` reject Loading Started / Loading Completed while any
  order isn't Ready to Ship (message names the waiting orders). `PlanRow.statusBlocks` feeds the status
  popover, which shows those options disabled with the reason; the detail header shows a red
  "N of M orders not Ready to Ship" chip for plans already in a loading stage with that mismatch.
- Inline edit (Logiwa parity): truck plate, loading gate (GatePicker), loading start/complete and truck
  depart cells have a hover pencil on `/shipment-plans` → `PATCH /api/shipment-plans/[id]/quick`
  (`quickUpdatePlan`, version-checked, same lifecycle rules; times open once the stage is reached).
- Carrier: a plan without its own carrier shows the distinct carriers of its orders (`planCarrierFromOrders`).
- Label tooling on `/shipments`: row and bulk actions for Create / Reprint retailer (UCC) label and
  Pick / pack short label (same print types as the order Label/Print menus, PrintOptionsModal);
  Create return label was already there. Orders already expose all three.
- Loading: profiled the six list queries against the live DB (shipments 12 ms, EOD 6, history 8, plans 1,
  plan orders 1, plan LPs 4). The skeleton-only pages were the shared dev server: during this round
  `/api/health` took ~60 s and a static 404 ~25 s with many agents recompiling. To stream content
  earlier every M02 list route's Suspense fallback is now `ShipListFallback` (real header, title,
  helper and tabs in the static shell; only toolbar/rows skeleton).
- Already present (re-checked, no change needed): shipment column depth (insurance type/value,
  confirmation, zone, other cost, currency, pickup dates, void date/time, parent LPN, external ref,
  rate shopping name, label type), history fields (lot, expiry, LPN, parent LP, kit SKU, master order,
  back order, receiving/production date, Remove Inventory type), EOD Report printed? / Prefix / Ship from
  with carrier marks.
- tests/unit/shipping 75/75 (new round4.test.ts + loading-block / quick-edit / stray-date cases); tsc clean for owned paths.
- Headless Playwright UI check NOT completed: /shipment-plans and /shipments timed out at 240 s on the shared dev server (server-wide saturation, not M02 queries). Re-run C:/Users/Mike/AppData/Local/Temp/claude/kitstak-critic/shipping/ui.mjs when the server is idle.

## Blind-judge repair round 3 - 2026-11-10
- **Export History queue.** New `ExportHistoryButton` (module file `src/components/shipping/export-history-button.tsx`) sits in the
  toolbar `trailing` slot of `/shipments`, `/shipments/end-of-day` and `/shipments/history`. It lists the viewer's export tasks for
  that grid key (from `/api/background-tasks?kind=export`), shows status, progress, row count and download link, and polls
  while a task is running. **Clear completed** hides finished tasks for that viewer only (localStorage). The tasks stay in
  Reports → Excel Export History, which the popover links to. Unit-tested in `export-history.test.ts`.
- **Plan carrier.** Plan Orders and Plan LPs `carrierName` is now `COALESCE(plan carrier prefix, order carrier)`. The plans
  list carrier filter also matches the orders' carriers, so filtering and display agree. The list and detail page already
  derived the carrier from the orders.
- **Filters (re-audited).** Shipments already has Sync to store, Return label, Voided, Currency, Other cost and Inventory
  parent LPN (31 fields). History has 21 fields, including Parent LP type, Original order code, PO number and Store order
  number. The judge's "missing" filters were most likely the filter chooser not loading on the saturated server.
- **Still missing:** Delivery mail sent and Shipment mail sent. The app has no customer-email subsystem, so there is no
  sent-mail record to filter on. Filed as R8-1.
- **Already present (re-checked):**
  - Plan custom fields in the Others step (`CustomFieldsSection`, including add/edit field for users with
    custom_field_management).
  - Customer → Customer address dependent combo in the Others step.
  - EOD Status pill (Open/Closed).
  - Print EOD report: confirm, then `closeManifests`, which sets close_date and is_printed and attaches the PDF.
  - The `/shipments` label actions and their permission-gated disabled reasons.
- **New e2e** `tests/e2e/shipping/shipping.spec.ts`:
  - unshipped plans have a null or dash Actual Shipment (API and grid);
  - Loading Started/Completed is refused with a "Ready to Ship" message and the status stays unchanged;
  - EOD close goes from Open to Closed, with closeDate set and isPrinted true;
  - viewer and operator get 403 on EOD close and plan status change; viewer gets 403 on return label;
  - the viewer's /shipments row menu has the label actions disabled.
- **Performance and evidence:** the shared dev server was saturated again this round. `/login` gave no response in
  100 s and `/api/health` took more than 2 minutes, so the 2–3 s target can't be measured. Round 2 profiled the module's
  SQL at 1–12 ms per list. The e2e and headless captures (`ui.mjs`) need re-running when the server is idle. The log goes to
  `C:/Users/Mike/AppData/Local/Temp/claude/kitstak-critic/shipping/e2e-r3.log`.
- Checks: vitest tests/unit/shipping 77/77; tsc has no errors on the module's paths.

## Round 4 (parity loop) - 2026-11-10
Fixes for the critic's round 3 verdict (6.1):
- **Picking/Job Operations from a plan (blocker).** New `POST /api/shipment-plans/job-orders` (`planJobOrders`, scoped,
  permission `fulfillment.shipment_plan.picking_operations`) expands the selected plans into their unshipped,
  non-cancelled order ids. The toolbar and detail buttons open the shared create-job modal on those orders, so
  eligibility and job creation run on real orders. A plan with nothing left to pick gets a "Nothing to pick" toast.
  The modal uses `operation: "order"` when the user also has the order job permission, so it counts orders.
  The raw-code column in the shared modal and the server-side plan expansion are filed as R9-1 and R9-2.
- **Ship guard (blocker).** `shipPlan` now calls `shipOrders` with `requireLabel: true`. Before that, every Ready to
  Ship order without an active shipping label fails with its own reason, for example "SO010845 has no active shipping
  label: all 3 labels were voided. Create a new label first." That order stays Ready to Ship.
  - `PlanRow.unlabeledReadyCount`/`Codes` (SQL) feed three places: `shipBlockedReason`, which disables Ship when no
    ready order is labelled; the red "N orders have no label" chip on the detail header; and the Ship confirm text.
  - db:verify `shipped_without_label` can no longer be produced by Ship. The one historical row is filed as R9-3.
- **No fabricated lifecycle times.** Ship stamps only `actualShipmentAt`. Loading started and completed and truck
  departed stay blank unless they were reached or entered.
  - The detail stepper ticks only the stages the change log shows (`reachedPlanStages`). Stages the plan jumped over
    read "Skipped" with a dashed marker.
- **Timeline and change log.**
  - `PLAN_INVALIDATE` now includes `["change-log","shipment_plan"]`, so the Timeline refreshes after Ship, status
    changes and edits.
  - The Timeline and the Change log drawer both use `fmt.gridDateTime`, the user preference without seconds.
  - Messages are humanised (`humanizePlanChange`): "Added order SO010845", "Status changed from Open to Shipped",
    "Loading started set to 11/10/2026 3:26 AM".
- **Plan grid customer and address.** These use the detail page's `deriveFromOrders` rule, moved to
  `grid-defs/shipping/shipment-plans.ts` and shared. The list SQL filter and sort fall back to the single customer and
  address the orders share. Grid, filters, export and detail now agree.
- **Loading gate picker.** `minChars={0}`: the warehouse's Loading and Shipment locations list as soon as the dropdown
  opens.
- **EOD.**
  - Carrier cell: the mark and code never truncate. USPS now shows a "USPS" monogram. Only the setup name ellipsizes,
    and the column is 240 px.
  - Close date shows in the warehouse time zone with its label (`formatInZone`, e.g. "11/10/2026 4:29 AM EST"), the
    same clock as the PDF.
  - Close and reprint show a success toast with an **Open report** action.
- **Wizard.** Adding orders to an unsaved draft shows the info toast "Added to draft … will join the plan when you
  save". Saving a plan with 0 orders asks for confirmation first ("Save without orders" / "Add orders first").
- **Order picker readiness** is graded: Not picked, Picking, Picked, Packing, Loading, Ready to ship.
- **Plan details card.** Values wrap, with right padding and a title, so the carrier no longer touches the border.
- **Not changed (shared or foundation):**
  - Picker date format and 768 px toolbar overflow (R7-4, R7-5).
  - Mail-sent filters (R8-1).
  - Live carrier integrations are still simulated sandbox adapters (foundation `domain/shipping`).
- Checks:
  - vitest tests/unit/shipping: 94/94. New: `round5.test.ts`, plus 3 flow tests for the label guard, Ship times
    and job-orders/consignee. Existing flow tests now label orders before Ship.
  - tsc: no errors on the module's paths.
- Live check: the headless run (`C:/Users/Mike/AppData/Local/Temp/claude/kitstak-critic/shipping/parity-rnd4.mjs`, which
  points at the installed chromium_headless_shell-1254) did not finish because the shared dev server was saturated. Each
  API call took about 187 s, and `page.goto` on the plan detail page passed 300 s.
  - `/api/shipment-plans/job-orders` resolves: an API call without the CSRF header returned the expected CSRF 403.
  - Re-run the script when the server is idle. It covers the jobs modal, the C3 detail timeline and stepper, the gate
    dropdown on open, the EOD carrier and close-date columns, and the plans list customer column.

## Round 5 (parity loop) - 2026-11-10
Fixes for the critic's round 4 verdict (6):
- **Partial ship no longer invents a lifecycle stage (major).** `shipPlan` moves the plan only when every order has
  shipped (to Shipped, stamping only `actualShipmentAt`). A partial ship leaves the status and every loading time
  untouched, and writes no status / loading change-log rows. The result window states it explicitly:
  "Plan status stays Open: 1 of 3 orders shipped. It becomes Shipped when the rest ship." (`planStatusNote`).
- **Readable change-log rows (minor).** The repository writes its own field rows (`recordUpdate` in
  `shipment-plans.ts`, built on the shared `diffRows`) with stored sentences from `planChangeMessage`:
  "Added orders SO000001, SO000002, SO000003.", "Removed order SO2.", "Status changed from Open to Shipped.",
  "Loading started set to 11/10/2026 6:36 AM EST.", "Note cleared (was Dock 4).". ISO times are formatted in the
  warehouse's zone with its label (`planChangeValue` / `formatZoneDateTime`), and from/to hold the same display
  values, so the global Change Log report and exports read correctly. `reachedPlanStages` reads both the legacy and the
  new status sentence; the plan drawer and Timeline show stored sentences as is (legacy rows are still humanised).
  The shared drawer's rebuild of messages is filed as R10-4.
- **Domain-level validation (minor).** `createPlan` / `updatePlan` run every input through `parsePlanInput` (same zod
  schema as the routes). Missing or null totals default to 0, a blank / whitespace code means "assign the next code",
  and any bad field is a VALIDATION with `fieldErrors`, never a SQLite constraint error.
- **First paint on /shipments (minor).** The "Label create date: Last 30 days" chip is applied in a layout effect before
  the first client paint (the list still waits for it, so there is no unfiltered fetch), and the streaming fallback
  paints the same chip plus "Show 100 items" and "Total: —". A user's default saved view still wins (grid core).
- **Casing and CTA (minor).** "Shipment plans" for the page header, metadata, fallback, breadcrumb and back links
  (sentence case, like the other module pages). "Create shipment plan" is now the primary button. Nav and tab labels are
  shared config (R10-3).
- **Route weight.** `printPlanBol` loads `@/server/print` on demand, so the status, ship and list routes no longer
  compile the PDF stack. This lightens the dev-server worker that returned "Jest worker encountered 2 child process
  exceptions".
- **Live check:** headless `kitstak-critic/shipping/r5b/hyd.mjs` on the saturated dev server. First paint took about 435 s and /api/health took 63–70 s. The h1 reads "Shipment plans". The /shipments hydration warning is the shared grid "Select all" checkbox (Radix bubble-input style, also on /shipment-plans), filed as R10-5.
- **Not changed (shared):** footer "Total: —" on error (R10-1) and the page-size select being blank before hydration
  (R10-2). Mail-sent filters (R8-1) and live carrier integrations stay as before.
- Checks:
  - vitest tests/unit/shipping: 100/100. New: `round6.test.ts` (sentences, zone formatting, stage parsing), plus flow
    tests for partial ship (no status or loading change, explicit note), readable stored messages and domain validation.
  - tsc: no errors on the module's paths.

## Round 6 (parity loop) - 2026-11-10
Fixes for the critic's round 5 verdict (6.5):
- **Primary actions in the first paint (major).** `useHydratedPermissions` (`components/shipping/shipping-client.ts`) now
  reads the app shell's server-resolved permission set (`useShell().permissions`, from `loadShellProps` in the (app)
  layout) for the server render and the hydration pass, and switches to `/api/me` once it has loaded. Both passes see
  the same set, so there is no hydration mismatch. "Create shipment plan", Delete, Ship, Print and Picking/job operations
  on `/shipment-plans`, and Void, Reprint and Actions on `/shipments` and the EOD toolbar, are in the server HTML.
  Live check: `GET /shipment-plans` HTML contains "Create shipment plan".
- **One name (minor, R10-3).** The page is "Shipment Plan" everywhere: H1, metadata, streaming fallback, detail
  breadcrumb and back link. The sub-pages are "Shipment Plan Orders" and "Shipment Plan LPs". This matches the shared
  nav, tab, route registry and export labels and Logiwa. The breadcrumb, tab and H1 now agree.
- **Create rejects non-Open status (minor).** `createPlanSchema` only accepts `PLAN_CREATE_STATUSES` (Open) and
  defaults to Open when status is omitted. The route answers 400 VALIDATION with
  `fieldErrors.status = ["A new plan starts as Open. Change the status after it is created."]`. The domain
  `createPlan` parses through the same schema, so the check also holds for non-route callers. Live check:
  `POST {status:"Shipped"}` returns 400 with the field error.
- **Printed = Yes always opens a report (minor).** New `POST /api/end-of-day/report {id}` (permission
  `fulfillment.end_of_day.view`) calls `openManifestReport`. It returns the stored file when it still exists. A closed
  manifest with no report file, or whose file has expired or been removed, has its End of the Day Report rebuilt from
  its packages, stored, owned by and linked to the manifest (`report_file_id`). An open manifest is INVALID_STATE, and
  an out-of-scope id is not found. The row action is enabled for every closed manifest (`openReportBlockReason`). It
  opens the PDF in a new tab and shows a "Report regenerated" info toast when the report was rebuilt. Live check: a
  seeded closed manifest returned `{ regenerated: true }`, and 55 of 62 rows had no file before the fix.
- **Live walk** (`kitstak-critic/shipping/r6/ui.mjs` and `api.mjs`; the dev server answered in under 2 s this time):
  - Pages load in about 2 s each: plans list, wizard General step, row kebab (Show details / Edit / Change log /
    Delete), plan detail, the EOD kebab and Open printed report (the pop-up goes to `/api/files/...`), `/shipments` at
    768 px, and plans in dark mode.
  - There were no console errors or warnings on any page in the walk.
  - `/api/grid-prefs/shipment-plans` and `/api/grid-prefs/shipments` both returned 200. The round 5 500s were the
    saturated dev server, not the route.
- **Not changed (shared, re-filed):**
  - Footer "Total: 0" under an error (R10-1, still `loading && data.length === 0` in `data-grid.tsx:289`).
  - Grid 30 s timeout with no backoff (R11-1).
  - Page-size label before hydration (R10-2).
  - 768 px toolbar overflow (R7-5, still seen: the Views button and the chip's × are clipped at 768 px).
  - Picker date format (R7-4).
  - Mail-sent filters (R8-1, no schema columns or outbox exist).
  - Live carrier adapters.
- Checks:
  - vitest tests/unit/shipping: 107/107. New `round7.test.ts` covers the create status schema and domain error, the
    report guard, stored versus regenerated report, an expired file, and the open and out-of-scope refusals.
  - `npx tsc --noEmit`: 0 errors in the whole project.

## Blind-judge repair round 1 (pass 2), 2026-11-10
Each item was checked headless on localhost:3000 (scripts and screenshots in
%TEMP%/claude/kitstak-critic/shipping/bj1/) and through the API.
- **Carrier connectivity.** `liveCreds` (integrations/carriers/common.ts) now sends a **Test** connection that has
  stored credentials to the carrier's own test API (UPS CIE, FedEx sandbox, EasyPost/Shippo test keys, Stamps testing).
  Before, every Test connection was simulated. `KITSTAK_CARRIER_SIMULATE=1` forces the simulation. Connections without
  credentials behave as before. No connection in this database has carrier credentials, so a real UPS/USPS/FedEx
  round trip is **not proven yet**: it needs the owner's carrier developer keys (owner action, see R12-1).
  - Package drawer "Carrier activity": every call shows step, Success/Error, HTTP code, ms and source. An expandable
    "Carrier response" shows the logged response and request JSON. A line shows whether the connection is live, the
    carrier test API, or simulated, and why.
  - The order's failed label requests since its previous label are included, so a rejected first attempt is visible on
    the label that followed.
  - Carrier Shipment Details has a **Carrier errors** chip with a live count. It toggles the new `hasCarrierError`
    filter. There is also a "Carrier errors" column (Error pill + last message) and a `lastCarrierError` filter.
  - Verified: 5 labels in the last 30 days (6 in all) carry errors such as "Package weight must be greater than 0."
- **Create label.**
  - A "Create label" toolbar button on /shipments (next to Void / Refresh tracking / Reprint) and a "Create label for
    order(s)" button on the plan detail Orders tab open `CreateLabelDialog`.
  - The dialog lists eligible orders from the new `GET /api/shipments/label-candidates?q=&planId=`, with the carrier
    service or "Rate shop". Each blocked order shows its reason.
  - Labels are bought through `/api/orders/bulk/labels` (create). The result table shows the tracking number or the
    carrier's error, with an "Open label" link.
  - Verified end to end: SO010882 got label 1Z4820707025051704 in 0.8 s, reprinted (200, ZPL), voided (200), and a
    reprint after the void was refused (409). The activity log shows LabelGeneration and VoidLabel.
- **Stepper.** `lifecycleSteps()` (plan-form-model): a stage with a stamped time is done and shows its time. SP000044
  now reads Open ✓, In Progress Skipped (no stamp, no transition), Loading Started 10/31 1:55 PM ✓, Loading Completed
  10/31 3:55 PM ✓, Shipped 11/02 3:15 PM ✓.
- **Expected load.** One authoritative figure: the order lines, labelled "order lines · used on the Manifest/BOL". The
  Manifest/BOL now prints each order's line weight (header weight only as a fallback), so the tile and the BOL agree.
  A different entered value shows under it as "Entered on plan: 46.00 lb, 0.00 ft³ (not printed on the BOL)". The
  entered value becomes the headline only when the lines have no weight, and it is labelled that way.
  - Plan LP weight: when the LP was never weighed, it uses the LP's contents (on hand, or units shipped/packed from it,
    or the package items) × product weight. PC-00009 on SP000045 now shows 6.00 lb instead of 0 lb. With no data it
    shows "No weight" instead of "0 lb".
- **Plan list status.** The status pill is itself the popover trigger (chevron), on the list and the detail page, and
  it offers only legal next states. At Loading Completed it also offers **Truck departed**, which stamps the departure
  time through the version-checked quick-edit route.
  - Verified from the list on KS-CRIT-R5-A: Open → In Progress → (Loading Started) → Loading Completed → Truck departed,
    with all three timestamps set.
- **Pickup and tracking.**
  - `POST /api/end-of-day/schedule-pickup` and the EOD row/bulk action "Schedule pickup" (ready time and latest time)
    book the pickup. They stamp `scheduled_pickup_at` on the manifest's active packages, log a Pickup call with a
    confirmation number, and write the manifest change log. The EOD grid has a Scheduled pickup column and filter.
    Past times return 400. Verified: PU5FE271506C, 2 packages.
  - `POST /api/shipments/tracking` and "Refresh tracking" (row, bulk and drawer) fill Actual pickup and Delivery date
    and record a Tracking call. Simulated connections derive these from manifest close, a scheduled pickup that has
    passed, and the expected delivery. Live or test-API connections log a 501 "not available yet" instead of inventing
    data. A Tracking status column and filter were added. Verified: SO010842 → Delivered.
- **Mail sent.** Shipment mail sent and Delivery mail sent columns (Yes · date / No), boolean filters, sort fields and
  drawer rows are added, reading `shipment_mail_sent_at` / `delivery_mail_sent_at`. Nothing sends customer emails
  yet, so every row reads No (R12-2).
- **Close-of-day automation.**
  - The "Auto-close" EOD toolbar dialog sets one rule per carrier setup: a cutoff in HH:mm, warehouse local time, with
    an on/off switch, last run and remove. Rules live in the module-owned `eod_auto_close_rules` table, created on
    demand like the scheduler store.
  - The new scheduler task `eod-auto-close` (every 60 s) closes that setup's Open manifests dated today or earlier
    once per local day, through the normal close and print path. Verified: the KS2 rule closed the 11/03 manifest
    ("Closed 1 of 1"). The rule was then switched off.
  - A warning banner on EOD lists past-day Open manifests (`GET /api/end-of-day/overdue`), with "Show them" (new
    `isOverdue` filter) and "Close and print" (same confirm dialog).
- **RBAC.** Viewer gets 403 on tracking, pickup and auto-close writes, and the Create label, Refresh tracking and
  status controls are hidden for viewer. Viewer can read the banner and the rules. No console errors or 4xx on
  /shipments, /shipments/end-of-day or /shipment-plans.
- **Shared edits, minimal and backward compatible:**
  - `CARRIER_CALL_STEPS` gets Tracking and Pickup.
  - The domain `CallLogInput.step` union is widened to match.
  - carrier-errors page `STEP_LABEL` is widened to `Record<string, string>`.
  - carriers.ts casts `step as CallStep`.
  - The scheduler registry gets one line.
  - `liveCreds` changes as described above.
- Checks:
  - vitest: tests/unit/shipping 124/124, including the new blind-judge-r1.test.ts and the rewritten
    expected-load.test.ts. foundation-f6 scheduler and automation-integrations pass.
  - tsc: no errors on the module's paths.
  - eslint: 0 errors. There are set-state-in-effect warnings, the same pattern as existing dialogs.
