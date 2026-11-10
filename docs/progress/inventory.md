# M06 inventory — progress

## Done
- Grid defs: `src/lib/grid-defs/inventory/{total-inventory,by-location,atp,fields,permissions}.ts`
- Repos: `inventory-{grid,total,by-location,atp,lookups,commands,export,open-orders}.ts`;
  `inventory.ts` restored as a LEGACY shim for `reports.ts` / `scripts/verify-data.ts` (deleting it broke them).
- APIs: `/api/inventory` (total), `/by-location`, `/atp`, `/add`, `/buckets/[id]`, `/buckets/[id]/quantity`,
  `/transfer-product`, `/transfer-location`, `/transfer-lp`, `/change-attributes`, `/summary`, `/reasons`,
  `/product-options/[id]`, `/open-orders` (302 to Orders filtered `f.code=in:` — exact open orders).
- Import handler `src/server/imports/handlers/inventory.ts`; export providers for the 3 grids (export verified: 269 rows, completed).
- UI: Total Inventory, Inventory by Location (drawers: quantity, transfer product, transfer LP/location,
  change attributes, add inventory, bucket drawer), ATP.
- Session 2 fixes: mutation form typing (tsc clean on own paths), Products link uses `f.clientId`,
  Open SO links via `/api/inventory/open-orders`, duplicated warehouse label ("KS2 - KS2 - Overflow"),
  qty column widths so header tips no longer overlap, duplicate icon in the ATP callout.
- Unit tests `tests/unit/inventory/*` (22 passing): adjust/add/remove/reason rule/409, allocated-row guard,
  transfer product/location/LP, only-1-SKU rule message, damage → undamaged/ATP, lot bulk + per-row failures,
  add inventory tracked attrs, grid grammar, scope, import handler.
- Live API verification (shared DB, all reverted): adjust 20→18 with reason (total & ATP −2, txn shows reason+user),
  stale version → 409, transfer 5 out and back, damage 3 → undamaged & ATP −3 then cleared, non-Stock row → 409 INVALID_STATE,
  filters (status/damage/date/rng), bad sort → 400, export queued → completed.
- e2e spec `tests/e2e/inventory/inventory.spec.ts`.

## Session 3 (resume)
- tsc clean on own paths; unit tests 29/29 passing.
- e2e 16/16 passing after raising the spec's actionTimeout to 45s (the shared dev server compiles routes on first hit;
  10s API timeouts were flaking under multi-agent load, not a product bug).
- Open SO deep link verified end-to-end: `/api/orders` works again; `/api/inventory/open-orders?productId=<CPL-BAG-DEC-12>`
  302s to `/orders?f.code=in:SO010655` and the Orders API returns exactly that order.
- db:verify: the only failure (serial_stock on VLT-EBD-PRO) comes from an M04 Return Receiving txn (RMA000323), not M06.
- Dead-click audit on /inventory, /inventory/by-location, /inventory/atp: hit page.goto 30s timeouts on the overloaded
  shared server; retried from a warm start.

## Blocked / pending elsewhere
- docs/requests/inventory.md REQ-1 (seed acceptance fixtures MLT-WIDGET-01 / MLT1-A-01 only-1-SKU / "Import" reason),
  REQ-2 (Orders line-wise SKU filter). `/api/orders` currently 500s (M01 in progress), so the Open SO redirect target
  can't be verified end-to-end yet.
- Built-in browser pane: tab cap reached (other agents), so UI verification runs through headless Playwright.

## Decisions
- Quantities in drawers are in the row's pack type; ledger works in UOM.
- Allocated (non-Stock) rows show a lock icon with a tooltip instead of the ⋯ menu.

## Session 4 (resume, 2026-11-06)
- tc-queue: 0 errors in all M06 paths. Unit tests 29/29. e2e `tests/e2e/inventory/inventory.spec.ts` 16/16 (2.3 min).
- Dead-click audit (`AUDIT_ROUTES=/inventory`, run from PowerShell; Git Bash mangles the leading `/`): every M06 control
  works except three reported hits, all checked by hand:
  - "Move <col> column" grips: drag-only handles in shared `src/components/grid/data-grid-header.tsx` (not M06; they flag on
    every grid, kits/ATP included).
  - by-location "Total Pack Qty" sort and "About Total Pack Qty": a headless re-check shows the click POSTs
    `/api/inventory/by-location` with the new sort and the hover tooltip renders the formula text. The 600 ms audit window
    is too short for the shared, loaded dev server.
- Built-in browser pane is still at its tab cap (other agents' tabs), so UI checks stay on headless Playwright.

## Still pending outside M06
- REQ-1 (seed MLT-WIDGET-01/02, MLT1-A-01 only-1-SKU, "Import"/"Damaged" reasons), REQ-2 (Orders line-wise SKU filter),
  REQ-3 (shared shell/grid contrast). The acceptance flows were verified on live equivalent data and in unit tests.

## Round 1 (parity loop), 2026-11-09
- Read references/logiwa-live/inbound-inventory.md §5 (Adjust / Transfer drawers).
- Adjust drawer: "New Quantity" now carries Logiwa's (i) tip ("Replaces current inventory with this new total. Setting the quantity to 0 will delete this inventory record.").
- Transfer Product: server-side over-quantity guard with Logiwa's copy "The entered transfer quantity exceeds the existing inventory amount." (INSUFFICIENT_STOCK + field error on qty; drawer stays open). Hint text changed to "N <pack> available" (no hard client max, as in Logiwa).
- Already at parity: merge-into-existing Stock row, row ••• Add/Adjust/Remove on Stock rows only, ledger posts delta as "Inventory Adjustment" / "Inventory Movement", grid auto-refreshes after a transfer (beats Logiwa).
- Unit tests 30/30 (new over-quantity test); tsc clean on M06 paths.
- Not done this round: headless Playwright re-run of the drawers, adjustment-reason seed values (still REQ-1).

## Round 1 (parity loop), 2026-11-09, pass 2
- Success toasts now carry Logiwa's titles: "Inventory updated successfully" (Add/Adjust/Remove), "Transfer completed successfully"
  (Transfer Product, Transfer LP, Transfer Location), "Inventory added successfully" (Add Inventory). The body still names
  SKU @ location and from → to (more detail than Logiwa).
- Transfer Product: removed the NumberInput `max` that silently clamped 99 to 20. Typing more than is free now shows the inline error
  "The entered transfer quantity exceeds the existing inventory amount (N available)." and blocks Transfer; the server guard stays.
  Same clamp removed from the Change Attributes quantity, which already has an inline "Only N free" error.
- Bucket card label was "Transfer from" in every drawer, including Adjust and Remove. It now reads "Location", and
  "Transfer from LP/Loc" only in Transfer Product, as in Logiwa.
- Headless check (Playwright, admin): /inventory, /inventory/atp, /inventory/by-location load. Row ⋯ → Adjust 20→19 with reason
  showed the success toast, restored to 20. Transfer over-quantity shows the inline error. Screenshots are in
  %TEMP%/claude/kitstak-critic/inventory. The only console errors were other modules' HMR parse errors (receiving po-form-model,
  products listings-page) and one intermittent hydration warning that did not reproduce on a clean pass.
- Unit tests 31/31 (new over-quantity copy test); tsc clean on M06 paths.
- Filed Round 2 REQ-4: move toasts to the top centre, because the bottom-right toast covers drawer Save/Cancel buttons.

## Round 2 (parity loop), 2026-11-09
Fixes for the round-1 critic verdict (7.4):
- **Count-plan locks on every write path (major #1).** `inventory-commands.ts` now calls `assertNotCountLocked` in `changeQuantity`
  (row Add / Adjust / Remove), `addInventory` (header Add Inventory) and `changeAttributes` (per row, reported as a bulk failure), so
  these return the same 422 RULE_VIOLATION as transfers. `bucketSql` exposes `countLockPlan` on every by-location row; the row ⋯ menu,
  bucket drawer buttons, bulk Transfer / Change Attributes and the quantity drawer (attention callout + disabled Save with tooltip) show
  "Location X is locked by count plan Y…" before submit. Unit tests: `count-plan location locks` in `inventory-commands.test.ts`.
- **Viewer row menu (major #2).** `rowActions` omits Add / Adjust / Remove / Transfer product for roles without the permission;
  a viewer sees only Show details (verified headless).
- **Quantity drawer validation (minor #5).** NumberInput no longer clamps to `min`, so a negative New Quantity shows "Can't be negative"
  and Save-with-nothing shows inline errors on both Adjustment Reason and quantity. Root cause: the autofocused quantity blurred on the
  Save mousedown, its onTouched error disabled the shared SubmitBar before the click landed, so only that one error showed. The drawer
  now has its own footer whose Save stays clickable (disabled only while saving or count-locked) and an `onInvalid` pass that flags every
  schema issue. Verified headless: ["Select an adjustment reason", "Enter a quantity"], then "Can't be negative" for -5.
- **Quantity drawer label (minor #4).** Re-checked: the card says "Location"; only Transfer Product says "Transfer from LP/Loc".
- **ATP banner (minor #6).** Rendered as a neutral info note (`info` tokens); the shared Callout "info" uses the red brand primary (REQ-7).
- **Transfer LP / Location (minor #10).** Warehouse prefills from header context, else the only warehouse in scope, else the user's
  `preferences.defaultWarehouseId`; the disabled Transfer button explains the next step ("Pick the source location, then Find",
  "Click Find to load…").
- Filed shared/other-module requests in docs/requests/inventory.md (Round 2): REQ-5 grid footer loading + export disabled while loading
  (major #3, shared DataGrid), REQ-6 ARIA grid semantics, REQ-7 Callout info colour, REQ-8 Kit tabs nav section (nav-config),
  REQ-9 Kit grids warehouse label / column order / grouping (M08).
- Cold-load timing: first data paint measured at 2.8 s with a quiet dev server and 9–37 s while other agents were recompiling; the
  by-location API itself is sub-second when warm. Not reproducible as an M06 query cost.

## Round 3 (parity loop) — 2026-11-09

Fixed (critic round 2, score 7.3):
- **Impossible dates rejected server-side.** `isValidIsoDate()` in `src/server/repositories/inventory-commands.ts` parses and round-trips the date (UTC), so `2026-13-45` and `2026-02-31` now fail. It is used by the Add Inventory `expiryDate`/`productionDate` schema and by `changeAttributesSchema`. Verified: POST `/api/inventory/change-attributes` with `2026-13-45` returns 400 VALIDATION "Enter a real date (YYYY-MM-DD)". Unit test added.
- **Data repair.** Bucket `02261307…` (MLT-WIDGET-02 @ MLT1-B-01, on hand 1) moved from `2026-02-31` to `2026-02-28` through the change-attributes API, which wrote a ledger row. Three empty buckets (on_hand 0) still hold bad strings (`2026-02-31`, `2026-13-45`, an ISO timestamp). They are harmless, and a verify check is requested (REQ-R2-1).
- **Count-locked rows are no longer dead menus.** By Location now uses its own ⋯ menu (`BucketRowMenu`). A banner at the top reads "Locked by count plan CNTxxxx". Disabled items are muted (text and icon at 60%) and show the reason as an inline subtitle. The Location cell shows a "Count" lock badge with a tooltip.
- **Bucket drawer header paints at once.** The title is now `<SKU> @ <Location>[ / LPN]`. The header card and Attributes tab render from the grid row straight away. Only the Allocations and Transactions tabs wait for the detail fetch, with their own skeleton or retry. Verified: the title and card render 150 ms after Show details.
- **Add Inventory prefills the warehouse** with `defaultWarehouse()` from the transfer drawers (header context, then single warehouse, then user default).
- **Transfer LP/Location**: initial focus now lands on the form (`data-autofocus`, no ring), so the prefilled Warehouse no longer opens with the red brand focus border.
- **ATP On Hand Qty = Total Quantity** (Logiwa parity, 10 = 10 for MLT-WIDGET-02). Damaged stays a separate column. Sellable still uses the undamaged, channel-synced figure. Tooltips are updated.

Open / filed (owned elsewhere): DataGrid ARIA grid roles, covered right-most header, horizontal-scroll cue; kits pages nav/breadcrumb, warehouse label and column order (M08); tab strip at 768px; counts `countedValueError` export; verify check for invalid dates. See docs/requests/inventory.md "Round 2 requests".

## Round 2 (parity loop) — critic verdict 6.4, 2026-11-09
Fixed in M06 paths:
- **Blocker: Remove all / Adjust to 0.** `POST /api/inventory/buckets/[id]/quantity` no longer re-reads the emptied row through `getBucketRow`
  (which 404'd and rolled the transaction back). It returns `{ …, deleted: true, bucket: null }` when the row reaches 0, using the new
  `findBucketRow` (null instead of throwing). The drawer toast says "The empty record was removed"; Adjust to 0 and Remove-every-unit show an
  attention callout before Save ("This deletes the inventory record").
- **Signed ledger for Remove.** `changeQuantity` mode=remove now posts through `ledger.adjustTo(onHand − qty)`, so a removal is an
  "Inventory Adjustment" of **−qty** (from null → bucket), the same convention as Adjust-down. Sums per type / reason now add up.
  Older removal rows (before this change) keep their +qty from→null shape; the ledger reconcile is unaffected either way.
- **Emptied buckets are deleted** (`pruneEmptyBuckets` in `inventory-commands.ts`) after Remove/Adjust to 0, Transfer Product, Transfer
  Location/LP (to LP) and Change Attributes splits. A bucket is kept when allocation rows, serial numbers or a live receipt's posted txn still
  point at it (FK / Cancel Receiving). Ledger rows keep their ids, so history and `reconcileLedger` are unchanged.
- **Dates.** Server validation (`isValidIsoDate`) from round 3 stays; Add Inventory and Change Attributes use the date picker only.
- **Quantity inputs never rewrite what was typed.** New `QtyInput` (`src/components/inventory/inventory-form-kit.tsx`) replaces the shared
  NumberInput in Add Inventory, row Add/Adjust/Remove, Transfer Product and Change Attributes. -2, 0, 1.5 and "abc" stay on screen with
  "Must be greater than 0" / "Use a whole number" / "Enter a number"; above 10,000,000 → "Enter at most 10,000,000"; above 100,000 a
  "Large quantity, double-check" hint.
- **Save disabled while any error shows** (`DrawerFooter`): Remove 50 of 5 free keeps Save disabled with the tooltip "Fix the highlighted
  fields first". Save's mouse-down keeps focus in the field, so the first click on an untouched Adjust drawer flags both
  "Adjustment Reason is required" and "New Quantity is required".
- **Locked / restricted destinations flagged before Submit.** New `GET /api/inventory/placement-check` (`placementCheck` in
  `inventory-lookups.ts`) checks count-plan locks and only-1-SKU location / LP-type rules against the SKUs about to land. Add Inventory,
  Transfer Product and Transfer LP / Location show the reason in red with a lock icon under the picker and keep Save/Transfer disabled.
  The Find summary card now carries `countLockPlan` / `lockMessage`: a locked source LP/location shows a red banner and the target picker
  does not appear.
- **Transfer LP / Location flow:** Find is disabled (with tooltip) until a warehouse and source are picked; the Move to LP/Location target only
  appears after the summary card; changing the source clears the target.
- **Lot values** restricted to letters, digits, space and `. _ - / #` (max 60), client and server (`src/lib/grid-defs/inventory/lot-rules.ts`).
- **Untracked attributes:** setting lot / expiry / production date on a product that doesn't track it is refused per row
  ("MLT-WIDGET-02 doesn't track expiry dates…"); clearing is allowed. The drawer shows an error callout listing those SKUs first and
  disables Save when none of the selection tracks the attribute.
- **Warehouse label** in the inventory drawers is now `MLT1 - Main Fulfillment` (module `InventoryWarehouseSelect`), matching the grids.
- **SKU cells** (Total, By Location, ATP): text truncates before the external-link icon, full SKU in the title. Client column widened to 190,
  Total's Warehouse column narrowed to 170.
- **Duplicate GETs:** removed the extra `g.refetch()` after drawer saves (the mutations already invalidate `["grid"]`). The remaining double
  GET on first load is React StrictMode in dev (react-query cancels the first request on the dev double-mount); prod issues one.
- Unit tests: 42/42 (`tests/unit/inventory`), new: remove-all → −1 + deleted + reconcile, adjust to 0, sign convention, prune guard with
  allocations, no ghost row after full transfer, lot charset, untracked expiry refused, placement check (lock + only-1-SKU), QtyInput parsing.
- tsc: 0 errors in M06 paths.
- Live API re-check blocked for part of the session: the dev server returned 500 on every route while
  `src/server/repositories/analytics-operational.ts` (another module) had a duplicate `const busiest` compile error.

Filed (shared / other modules): see docs/requests/inventory.md "Round 2 requests" REQ-R2-7..R2-11.

## Round 4 (parity loop) — 2026-11-09
- Total Inventory: new per-row "By Location" drilldown column. It opens /inventory/by-location filtered to the SKU, plus the warehouse when the row is warehouse-scoped. The helper is `byLocationFilters` in inventory-links.ts and has a unit test. The header "View by location" link is unchanged (plain Link).
- Kit Inventory: "Recalculate now" is hidden for roles without work-order create (the viewer role). The API gate is filed as a request.
- Demo data: replaced the markup-like lot `<img ...>` with `LOT-QA-01` in inventory (2 rows) and in inventory_transactions from_lot/to_lot (2 + 3 rows). The lot input already rejects markup (LOT_PATTERN, both client and server).
- Not verified in the browser: at the time of this round, the dev server returned 500 on every route because of a compile error in another module's file (analytics-operational.ts, `busiest` defined twice).
- Shared items still open (nav/breadcrumb, picker latency, DataGrid header overlap/scroll cue, tab focus ring, tab-strip scroll, toolbar wrap) are filed under Round 2 requests.
- tsc: clean for inventory and kits paths. vitest tests/unit/inventory: 44 passed.
- Live checks after the analytics compile error cleared (admin, API + headless Playwright, screenshots in
  %TEMP%/claude/kitstak-critic/inventory/r2-*.png): Remove 1 → 200 `{to: 4, deleted: false}` with ledger −1; Adjust to 0 → 200
  `{to: 0, deleted: true, bucket: null}` with ledger −5 and the row gone; `2026-02-31` → 400 "Enter a real date"; `<img src=x>` lot → 400;
  lot on untracked MLT-WIDGET-02 → per-row RULE_VIOLATION; Add qty 0 / 1.5 → 400 with field errors; placement-check MLT1-C-01 →
  blocking "locked by count plan CNT000146". Remove drawer: empty Save shows both required errors, 50/-2/1.5 stay as typed with their errors
  and Save disabled; Transfer Location: Find disabled until a source, locked source shows the red banner and no target; Transfer Product to
  MLT1-C-01 shows the lock under the picker with Transfer disabled. 0 console errors.
- Data note: the Adjust-to-0 live test merged into the existing MLT-WIDGET-02 @ MLT1-B-01 (no lot) bucket and removed its 4 units with it;
  they were re-added immediately (txn seq 3243, note "KS r2: restore…", new bucket id 4f925b32…, receiving date now 2026-11-09).

## Round 5 (parity loop) — 2026-11-09
- **Drawers close as soon as the save resolves.** The shared `useApiMutation` awaited the grid refetch before running onSuccess, which kept Adjust/Add open for up to 60s under load. All five inventory drawers (quantity, add, change attributes, transfer container, transfer product) now drop the `invalidate` option. They call `useInventoryRefresh()` instead, which invalidates `["grid"]` and `["inventory"]` in the background. Toast and close happen right after the 200. Shared fix filed as REQ-R2-12.
- **Ledger direction semantics:** `directionOf` (exported as `bucketTxnDirection`) now labels single-sided entries (adjustments, counts, receipts) by sign: + is `in`, − is `out`. Transfers are labeled by side, and same-bucket moves are `neutral`; the `adjust` label is no longer emitted. Verified live on bucket fddd8636: Movement +1 in, Movement 1 out, Adjustment +2 in. New unit test: tests/unit/inventory/inventory-txn-direction.test.ts.
- **By-location:** Location moved next to SKU in the default column order, so it is visible at 1440px. Default pinning needs a shared change (REQ-R2-13). The row kebab is now labeled "Row actions for {SKU} @ {Location}" (verified in headless Chromium). Header and row controls no longer flash disabled while /api/me loads (`useCanOptimistic`); the server still enforces permissions.
- **Total Inventory:** the API returns `locationCount` and `warehouseCount`. The By Location drilldown reads "N locations" ("No stock" when 0). The Warehouse cell for aggregate rows is a compact "All" ("All · N warehouses" when more than one), and the column is 130px instead of 170.
- **Note textarea** uses a blue focus ring (`NOTE_FOCUS`) and shows red only when invalid. Shared control fix filed as REQ-R2-14.
- **Data:** reverted the critic's leftover 1 × APX-PKG-POLY-1013 transfer D-02-01-1 → D-02-03-3 through the API (200, ledger Movement). The KS-CRIT-R3 PO numbers are filed as REQ-R2-17.
- **Kits / kit-components** are owned by M08. The nav/breadcrumb, header casing and Create-WO reason items are filed as REQ-R2-16. The button is correctly disabled for Kit to Order rows, and the rule is stated in `createWoReason`.
- **Not done (needs a larger surface):** Transaction History report, Inventory Snapshot / Serial Number reports, URL-encoded search chips, tablet overflow menu (REQ-R2-15).
- Checks: tsc shows 0 errors in inventory paths; vitest tests/unit/inventory has 46 passing; headless check had 0 console errors on /inventory and /inventory/by-location.

## Round 6 (parity loop) — 2026-11-09
- **Adjust drawer:** New Quantity is now pre-filled with the current quantity, as in Logiwa. The Save button shows the signed delta for every mode ("Save (−14)", "Save (+3)"). A decrease of more than 25% of the row, or more than 10 units, opens a confirm step first. For example: "Remove 2,089 Each? APX-PKG-POLY-1013 @ D-02-03-3 goes from 2,089 to 0 Each…", with the buttons "Go back" and "Yes, remove N". Helpers: `signedDelta`, `isLargeDecrease`, `saveLabel` in quantity-drawer.tsx. Verified in headless Chromium. Nothing was saved.
- **Count locks in context:** the bucket drawer shows a "Locked by count plan CNT…" banner that links to /counts/CNT…. Non-Stock rows get an info banner instead. `BucketCard`, which is used in every drawer header, shows a "Count CNT…" lock pill.
- **Split rows:** the Location cell on By Location has an inline sub-label that names what separates rows for the same SKU @ location: Lot, LP, a non-Stock status, or PO, falling back to "Rcvd YYYY-MM-DD". The column is 240px. The function is `bucketSubLabel` in by-location-types.ts. Example: the two APX-TEE-BLK-L @ C-01-01-3 rows now read "LP PLT0000003" and "PO KS-CRIT-R3-…".
- **Total Warehouse column:** shows a compact pill, "All" or "All (2)". The tooltip reads "All warehouses (N warehouses)". Nothing truncates at 1440.
- **H1 per view:** "Total Inventory" and "Inventory by Location", each with its own helper line. ATP already had its own title.
- **Image column** is hidden by default on Total and By Location (`meta.defaultVisible: false`). It can still be turned on in the column picker. Users who already saved column prefs keep their current choice.
- **Reports reachable from inventory:** a new header "Reports" menu on Total and By Location (`inventory-reports-menu.tsx`). It links to Transaction History, Inventory Snapshot, Serial Number Report, Serial Number Transaction History, Order Inventory, Dynamic Replenishment and Inventory Aging. All of these pages exist and are owned by the reports module. The bucket drawer's Transactions tab links to the full Transaction History.
- **Filed:** REQ-R2-18 (cross-module tsc gate; the 500s came from waves-run.ts), REQ-R2-19 (URL comparator + search chip in GridToolbar), REQ-R2-20 (Transaction History deep-link params), REQ-R2-21 (async export popup). The tab-strip overflow is still REQ-R2-15.
- Checks: tsc shows 0 errors in inventory paths. vitest tests/unit/inventory: 51 passed (new file: inventory-round6.test.ts). Headless run on /inventory and /inventory/by-location had 0 console errors. Screenshots: %TEMP%/claude/kitstak-critic/inventory/r6-*.png.

## Round 3 (parity loop, critic 7.8) — 2026-11-10
- **Calendar dates no longer shift a day.** New `src/components/inventory/inventory-dates.tsx`: `parseCalendarDate` reads "YYYY-MM-DD" as a local day (the shared `toDate` parses it as UTC midnight, so 2026-02-28 showed as 2/27 in US time zones). `CalendarDateCell` renders Expiry and Production in the grid as `02/28/2026`. The bucket card (drawer header, Transfer, Change Attributes) uses the same formatter, and the Change Attributes prefill already parsed locally. Export: the xlsx writer stores date-only values as UTC dates, which Excel shows as the correct day.
- **One timestamp, one date.** The Location sub-label now reads `Rcvd 11/09/2026` (local calendar day, grid pattern), which matches the Receiving Date column (`11/09/2026 10:46 PM`). The drawer's Received field uses the same padded grid form, with the full value in the tooltip. `bucketSubLabel(row, instantDate)` now takes the formatter.
- **Bulk actions on mixed selections.** `partitionSelection` and `skippedSummary` live in by-location-types.ts. With rows selected, Change Attributes ▾ and Transfer Product open whenever at least one row is eligible. The drawer starts with an attention callout such as "2 of 3 selected rows will be skipped (1 fully allocated, 1 count-locked)" and names each skipped row. Toasts report "· N skipped". The actions are disabled, with the first reason, only when no selected row is eligible.
- **Bulk Transfer Product.** One eligible row opens the partial-quantity form. Several eligible rows open a bulk form with one destination. Every free unit of each row moves, as one ledger move per row. The form shows a result per row (Moved, or the error), offers "Retry N failed", and refuses rows from more than one warehouse.
- **Transfer is disabled until valid.** `transferInputReason` keeps Transfer disabled ("Enter the quantity to transfer" / "Only N available" / "Pick where to move it") until both fields are valid.
- **The destination pre-check never spins.** `usePlacementCheck` now has its own query key, so `["inventory"]` refreshes no longer invalidate it. It times out after 6 s (`PLACEMENT_CHECK_TIMEOUT_MS`) and blocks only on the first load. On failure or timeout it shows "Couldn't check the destination in time. It is re-checked when you submit." with a Retry link. Submit stays available because the server re-validates. This covers Add Inventory, Transfer Product and Transfer LP/Location.
- **Untracked attributes are enforced on every M06 write path.**
  - Add Inventory refuses lot, expiry or production values on a product that doesn't track them, with per-field errors.
  - The Import Inventory handler refuses them per row and validates the lot charset. Its `importDate` reuses `isValidIsoDate`: impossible dates (2026-02-31, 2026-13-45) fail the row, and 2027/1/5 is normalised to 2027-01-05.
  - Change Attributes already refused them.
  - Receiving and count write paths belong to other modules (REQ-R2-22).
- **Hygiene check and repair** (`src/server/repositories/inventory-hygiene.ts`, `scripts/inventory-hygiene.ts [--apply]`). It reports `untracked-attribute`, `bad-date` and `empty-bucket`.
  - Repairs go through `ledger.changeAttributes` and post "Attributes Change" rows. Allocated units are left alone and reported.
  - Empty buckets are pruned with the `pruneEmptyBuckets` guard (no allocation, serial or live-receipt reference).
  - Run on the dev DB: 2 buckets repaired. MLT-WIDGET-02's lot LOT-QA-01 was cleared, and CPL-BAG-ESP-12's expiry timestamp became 2027-05-08. 293 empty unreferenced buckets were deleted, including the 2026-02-31 and 2026-13-45 ones. `db:verify` is OK afterwards.
  - One issue remains: bucket 976a3fdd still has 1 allocated unit carrying expiry 2026-02-28. It can be repaired once that order ships.
  - The remaining on_hand = 0 buckets are referenced by allocations, serials or live receipts (Cancel Receiving needs them).
- **Adjustment reason direction.** `src/lib/grid-defs/inventory/reason-direction.ts` reads `lookup_values.meta.direction` (increase / decrease / both). When that is unset, a name default applies: "…missing / lost / damaged / expired…" means decrease, and "found / surplus" means increase.
  - `/api/inventory/reasons` returns `direction`.
  - The Adjust / Add / Remove drawer offers only reasons that match the sign of the change and labels one-way reasons. If the change flips direction, it blocks Save with a message. Add Inventory hides decrease-only reasons.
  - The server (`assertReason(…, delta)`) refuses a mismatch, so "Inventory is missing" can no longer post 4 → 5.
  - A settings UI for the direction is REQ-R2-23.
- **ATP:** Current ATP, Planned ATP, Sellable, Pickable, Open SO and Open PO now come right after SKU and Product Name, so they are on screen at 1440px. The quantity breakdown follows. **Total Inventory:** Available UOM Qty and UOM Quantity now follow Product Name.
- **Bucket drawer:** the header card shows `MLT1 - Main Fulfillment`, the same label as the grid and the Attributes tab. Initial focus lands on the summary card, not the ×, so a mouse-opened drawer shows no red focus box. The tab strip has an aria-label, and keyboard focus on a tab shows a neutral ring instead of brand red.
- **Toasts:** Change Attributes titles are now "Attributes changed successfully" / "Attributes partly changed", in line with "Inventory updated successfully" / "Transfer completed successfully". Moving toasts to the top centre is still REQ-4 (shared toaster).
- **Checks.**
  - Unit tests: 62/62 pass in `tests/unit/inventory`. The new `inventory-parity-r3.test.ts` covers calendar formatting, invalid dates, partition and summary, transfer readiness, reason direction (client and server), Add refusing untracked attributes, and hygiene find and repair with ledger reconcile. The import test now covers untracked attributes and impossible dates.
  - `tsc`: 0 errors in M06 paths.
  - Headless Playwright on /inventory, /inventory/by-location and /inventory/atp: 0 console errors. On by-location, a select-all over a mixed selection opens both drawers with the skip callout. Screenshots: `%TEMP%/claude/kitstak-critic/inventory/r3-*.png`.
- Not fixed here (shared code or other modules): REQ-R2-22..R2-26 in docs/requests/inventory.md.

## Round 4 (parity loop, critic 7.5) — 2026-11-10
- **The bucket drawer no longer shows 0 for reservations.** New `txnQtyDisplay` (by-location-types.ts) formats each row:
  - Same-bucket rows read "3 reserved" (Allocation), "3 released" (Allocation Cancel) or "N changed" (status or attribute change), with link, unlink or refresh icons in neutral tone.
  - Stock in and out show signed values ("+4", "−5").
  - A row whose location doesn't change reads "at MLT1-B-01" instead of "MLT1-B-01 → MLT1-B-01".
- **Bucket drawer header and Attributes tab.**
  - The card's Warehouse field spans two columns, so "MLT1 - Main Fulfillment" is no longer cut off. Every `Fact` has a title tooltip.
  - The Attributes tab now lists every attribute shown By Location: inventory status, damage reason, damaged qty, lot, expiry, production, product type and group, replenishment type, original LP, parent LP type, original parent LP and allocated qty.
  - Untracked attributes read "Not tracked" ("Not tracked (stored …)" when a leftover value exists).
- **Transaction History link is scoped.** "Open Transaction History for <SKU>" opens `/reports/transaction-history?f.sku=eq:…&f.warehouseId=in:…&f.clientId=in:…`. The report has no bucket or location-OR filter, so this is the narrowest scope it supports.
- **Open SO Qty drilldown uses readable filters.** It now opens Orders filtered by SKU, warehouse and Status in (the statuses those open orders are actually in). This replaces `f.code=in:<order codes>`. The Orders `f.sku` filter is line-wise now that REQ-2 has landed, so multi-line orders are still found. The chips read "SKU = MLT-WIDGET-02 · Warehouse · Status in Open, Ready to Pick", the same filter as Logiwa.
- **Location sub-label names the splitting attribute.** `bucketSubLabel` lists Exp and Prod (local calendar day) right after Lot, then LP, status and PO. It falls back to "Rcvd" only when none of these are present, and it skips attributes the product doesn't track.
- **Untracked values are masked.** In the Expiry and Production columns, a value on a product that doesn't track that attribute renders "-", with a tooltip naming the stored value. Hygiene `--apply` pruned the last empty bucket. Bucket 976a3fdd (1 allocated unit) still waits on REQ-R2-32.
- **Destination pickers show restrictions in the option list.**
  - New `GET /api/inventory/destinations`, built on `destinationOptions` in inventory-lookups.ts, and a new `src/components/inventory/destination-picker.tsx`. These replace the shared Location/LP pickers in Add Inventory, Transfer Product (single and bulk) and Transfer LP/Location.
  - Each option is evaluated with `placementCheck` for the SKUs being placed. Count-locked and occupied only-1-SKU destinations are disabled, with the reason on the second line (for example "Storage · Zone C · Locked by count CNT…" or "…allows only 1 SKU (holds MLT-WIDGET-01)"). An empty 1-SKU destination is labelled "Only 1 SKU".
  - The list loads on open (0-character minimum).
  - Picking an option seeds the placement pre-flight cache, so the "Checking the destination…" spinner no longer appears after a pick.
  - A scan does an exact match. A blocked or unknown scan sets the field error and gives the reason.
- **Viewer and read-only roles.** By Location hides Transfer LP/Loc, Import, Add Inventory, Change Attributes and the Transfer Product bulk action when the role lacks those permissions; they are no longer shown disabled. The selection column appears only when a bulk action is permitted. Row and drawer actions still show "You don't have permission" tooltips, and the server still returns 403.
- **Checks.**
  - vitest `tests/unit/inventory`: 68/68 pass. New file `inventory-parity-r4.test.ts` covers txn quantity labels, sub-label attributes, and destination options (1-SKU badge and disabling, exact scan match, warehouse scope). The Open SO href test was updated.
  - `tsc`: 0 errors in M06 paths. The only error repo-wide is in facility/lp-type-wizard.tsx.
- **Filed:** REQ-R2-27..R2-32 in docs/requests/inventory.md (export error toast, filter operators, footer Selected, shared destination picker, fixture purge, allocated-unit relabel). Toasts, header gutter, focus ring, kit IA and the search comparator default remain shared or M08 items.

## Blind-judge repair round 1 — 2026-11-10
- **Image thumbnails** are now visible by default on Total Inventory and By Location (the column existed but was hidden).
- **Kit breadcrumbs:** `src/config/route-registry.ts` SECTION_OVERRIDES sends /inventory/kits, /inventory/kit-components and /inventory/atp to the Inventory section. The crumb now reads "Home › Inventory › …", the same as the tab strip. This was a minimal shared change. Net Kitting Capacity already has a header tooltip.
- **Shortage quick filter:** new `ShortageToggle` in inventory-shared.tsx. On ATP it filters `currentAtp ≤ -1`; on Total it filters `availableQty ≤ -1`. It writes an ordinary `rng` filter, so it shows as a chip and works with Clear and saved views. API check: 14 rows on each, all negative. Negative values were already red (`Qty` / emphasis cells).
- **Reports menu** already lists Serial Number Report and Inventory Snapshot. The ledger (/reports/transaction-history and its /serial tab) belongs to the reports module, and the bucket drawer already links to it.
- **Not done this round:** the 55-column ledger depth, import history and its drawer, Filter popover parity (shared), kit drill-downs with a prefilled Work Order, and footer/export skeletons.
- **Cold load:** first paint could not be measured fairly. The shared dev server was compiling for concurrent agents: loads took 25–47 s and one API call timed out. This needs re-measuring on a quiet or production build.
- **Checks:** tsc shows 0 errors in inventory paths and route-registry. Headless run: the ATP Shortage toggle sets `f.currentAtp=rng:..-1`. Screenshots: %TEMP%/claude/kitstak-critic/inventory/r7-*.png.

## Blind-judge repair round 2 — 2026-11-10
- **Bulk enablement:** By Location's Transfer Product bulk action now always runs `bulkReason`, so with an empty selection it reads "Select at least one row" (disabled) right after a clear. Before, a null reason left it enabled.
- **Already present (re-checked in code):**
  - All Warehouses aggregate on Total Inventory: rows read "All Warehouses" when no warehouse split is applied (inventory-total.ts).
  - Kit Inventory row actions: "Create work order" opens the WO dialog prefilled with warehouse, client, kit and required qty. "Component availability" opens Kit Component filtered to that kit. Kit Component links back to Kit Inventory.
  - Quantity drawer: over-quantity remove/adjust shows an inline field error before submit, and the server toast is still the backstop.
  - Image is the first By Location column and visible by default.
- **Cold load not measured.** The shared dev server took 31–39 s to serve even `/login` (curl), so this is server contention, not an inventory page. A production build was not run because it would compete with the running dev server and the agents editing concurrently.
- **Not built this round (large or shared; see Round 2 requests R2-33..R2-36):** the Import Inventory history grid and drawer, Filter popover parity, the 55-column ledger with a serial tab and a per-bucket filter, and footer/export skeletons.
- **Checks:** vitest `tests/unit/inventory`: 68/68 pass. `tsc`: 0 errors in inventory/kits paths. The headless Playwright run timed out at 120 s on the overloaded dev server, so nothing was verified visually.

## Blind-judge repair round 3 — 2026-11-10
- **Grid speed (profiled).** The repository SQL was timed directly against `.data/kitstak.db`, bypassing the dev server:
  - Total: 29 ms cold, 3 ms warm. ATP: 55 / 13 ms. Kit Inventory: 5 ms. Kit Components: 7 / 4 ms.
  - All four are already paginated on the server (`runGrid` LIMIT/OFFSET). No index was needed.
  - The multi-second loads the judge saw come from the shared dev server compiling for concurrent agents. This round it did not answer even `/login` within 90 s.
- **No endless skeleton.** `useApiQuery` takes a new optional `timeoutMs` (shared and backward compatible). `useGrid` sets it to 30 s.
  - A hung list request now fails with code `TIMEOUT`. That code is not retried, so the grid shows its existing error state with Retry.
- **Kit Inventory "Last updated never".** The seed now runs `recalcKitInventory` once at the end (`seed/index.ts`). `GET /api/kits/recalculate` computes the snapshot when none exists. The 15-minute scheduler task (`kit-inventory-recalc`) was already in place.
  - While the stamp loads the label reads "…", and "unavailable" if the request fails. It never reads "never".
  - The capacity columns and Create Work Order prefill were already wired (see round 2).
- **Kit Component Availability.** It lists all rows (27) with no filter applied. Included Kits values now link to Kit Inventory filtered to that kit. A Reorder Quantity above 0 links to Create Purchase Order with the component's warehouse filled in, and the row ⋯ menu gains "Create purchase order".
  - `po-create-page.tsx` reads `?warehouseId=&clientId=` (scope-checked). This is a small cross-module change.
  - The empty-state title now depends on whether filters are applied.
- **Reasons seeded (REQ-1).** `adjustment_reason` gains "Import", "Damaged" and "Found" next to "Inventory is missing" and "Inventory quantity discrepancy". `damage_reason` gains "Damaged". This only affects fresh installs; the acceptance fixtures already add these values idempotently.
- **Open PO drill.** New `GET /api/inventory/open-pos` redirects to Purchase Orders filtered by `f.code=in:<open POs>`, warehouse and `Status in Pending, Started, Receiving`. The ATP Open PO Qty cell is now a link (`OpenPoLink`). Total Inventory has no Open PO column.
- **By Location columns.** Walking Path Priority, Replenishment Location Type, Parent LP, Original LP Number (hidden by default), Mobile Cart and Damage Reason were already present in `by-location-columns.tsx`. Nothing changed.
- **Import Inventory.** The shared `/imports/inventory` page already has the template card, the history grid (Status, Master/Success/Error) and the details drawer with a "Show errors" switch.
- **New e2e spec, not yet run:** `tests/e2e/inventory/inventory-drawers.spec.ts`. It opens Add Inventory, Transfer LP and Transfer Location (Find, then the Contents summary), the four Change Attributes variants, and Import (template, history, details), and screenshots each into `test-results/inventory-drawers/`.
  - It could not run: the dev server did not respond. Run it on a warm server.
- **Not done:** bulk adjust and undo/reverse transaction (optional differentiators), and pre-filling PO lines with the SKU and reorder quantity (REQ-R2-37).
- **Checks.** vitest `tests/unit/inventory`: 71/71 pass, including the new `inventory-blind-r3.test.ts`. `tsc`: 0 errors in the touched paths.

## Round 5 (parity loop, critic 6.6) — 2026-11-10
- **Hygiene is clean (REQ-R2-32 handled in M06).** `repairInventoryHygiene` now relabels allocated units as well. It moves each active allocation together with its units (`ledger.move` with `allocationId`, type "Attributes Change"), then changes the free units. The order keeps its reservation on the corrected bucket, and every step posts a ledger row.
  - Run on the dev DB: bucket 976a3fdd (MLT-WIDGET-02, 1 allocated unit carrying expiry 2026-02-28) was repaired. `scripts/inventory-hygiene.ts` now reports **0 issues**.
  - `verify-ledger` shows no ledger or allocation issues. Its one remaining failure, `shipped_without_label`, belongs to the shipping module.
- **ATP / Total / By Location header tips.** New `rightMeta()` in inventory-shared.tsx sets `headerClassName: "flex-row"` on right-aligned quantity headers. The (i) icon now sits right after its label ("CURRENT ATP (i)") instead of on the left, where it looked attached to the previous column. This is done through the shared header's existing `headerClassName` hook, with no shared change.
- **ATP Warehouse column** shows the code (`MLT1`), 110px wide, with the full "MLT1 - Main Fulfillment" as a tooltip. At 1440px it is no longer cut off at the viewport. The header still sits under the shared column-chooser gear (REQ-R2-2b).
- **Removable search chip.** New `src/components/inventory/inventory-search-chip.tsx` is used on Total, By Location and ATP. When a quick search is active, the toolbar shows a chip in Logiwa's style, such as "SKU EQUALS / MLT-WIDGET-01 ×" or "SKU OR BARCODE STARTS WITH …". Its × clears the search.
  - The search and comparator were already in the URL (`?q=X&qm=eq`; Starts With is the default and is omitted), so shared links reproduce the view.
  - Defaulting to Equal is still a shared GridToolbar / grid-query setting (REQ-R2-26f).
- **Transaction History deep links from the bucket drawer** are now location-scoped. The Transactions tab offers "Into MLT1-A-01" (`f.targetLocation=eq:`), "Out of MLT1-A-01" (`f.sourceLocation=eq:`) and "All MLT-WIDGET-01". Each also carries the SKU, warehouse and client filters.
  - The report has no From-OR-To or bucket-id filter, so a location's ledger takes two links. REQ-R2-35 asks the reports module for `f.inventoryId`.
- **Error toasts name the failed action.** Every inventory mutation sets `errorTitle`: "Inventory was not updated", "Inventory was not added", "Transfer was not completed" or "Attributes were not changed".
  - An infrastructure 500 with an HTML body already becomes an `ApiError` in `api-client.ts` (`readBody` returns undefined, which gives the "unexpected error" message). It reaches the drawer as a toast, and the drawer stays open with the user's input.
- **Not fixable in M06 (filed again below):** the dev-server slowness. In this round `/api/health` took 65 s, and ATP first paint in headless Chromium took 288 s. The other open items are the cross-module tsc gate, footer "Selected" on read-only grids, the enum "in / not in" operator, the async-export toast and popup, kit-page IA and casing, and the fixture purge.
  - `npx tsc --noEmit` is **clean repo-wide** at the time of this round (0 errors).
- **Checks.**
  - vitest `tests/unit/inventory`: all pass, including the new `inventory-parity-r5.test.ts`. It covers the allocated-unit relabel with ledger reconcile, the search-chip label, the warehouse code, and the location-scoped history links.
  - `tsc`: 0 errors.
  - Headless (admin, 1440×900): `/inventory/atp?q=MLT-WIDGET` renders the chip and the header tips sit right after their labels (`%TEMP%/claude/kitstak-critic/inventory/r5-atp.png`). Grid rows were still loading after 288 s because of server contention.
  - Headless By Location drawer check: rows took 889 s to appear, and then the page reset through a navigation or HMR reload before the row click. The location-scoped history links are covered by unit tests but were not verified visually in this round.

## Round 6 (parity loop, critic 6.8) — 2026-11-10
- **Endless skeleton: diagnosis and guard.** The critic's "480 s skeleton with zero /api/ requests" is the server-rendered HTML of a page that never hydrated. The skeleton rows, "Total: —", the blank page-size select (Radix renders its value only after hydration) and the disabled Export are all SSR output. No request goes out, so the list's 30 s timeout cannot arm.
  - New `GridStallNotice` (inventory-shared.tsx) sits on Total, By Location, ATP, Kit Inventory and Kit Component.
  - Its markup is server-rendered and revealed by a CSS animation after 12 s: "Still loading inventory. This is taking longer than usual." with a plain `<a href="">` **Reload page** link. It needs no JavaScript.
  - Once hydrated, a timer turns it into a red alert after 30 s ("The server hasn't returned inventory in 30 seconds…") with **Retry**, which refetches and restarts the timer, plus Reload. This applies whatever stage hung.
  - The list's own `TIMEOUT` error state (useGrid) still applies once a request is in flight.
  - The phase logic is `gridStallPhase`.
- **Search chip** now uses the neutral info (blue) palette instead of brand red, so it no longer reads as a validation error (`inventory-search-chip.tsx`). The shared filter chips still use primary-soft (REQ-R6-5).
- **Transaction rows.** New `txnLocationText(from, to)` (by-location-types.ts). Single-sided rows (Count, Adjustment, Attributes Change, Receive, Ship) read "Count +1 at MLT1-B-01". The dangling "— → MLT1-B-01" is gone. Moves still read "A → B".
- **Change-log wording.** Change Attributes rows now read `MLT-WIDGET-01 (1 unit) -> Damage Reason is modified. (none) --> Damaged`. The unit is singular or plural as needed, there is no double space, and an empty side is "(none)".
  - New helpers: `attributeChangeLineLabel` and `changeLogValue` in inventory-commands.ts.
  - The `is modified … -->` wire format stays, because the shared change-log drawer and other modules parse it.
- **Default reasons on existing tenants.** `ensureDefaultInventoryReasons` (inventory-lookups.ts) is idempotent. It inserts each missing global reason: Found (`meta.direction = increase`), Import, Damaged (decrease), and damage reason Damaged. A value an admin deactivated stays deactivated. `scripts/inventory-hygiene.ts --apply` runs it.
  - On the dev DB it added **Found** and **Damaged** (Import was already there), so Add Inventory now offers an increase-only reason.
- **Fixture purge.** New `findFixtureStock` / `purgeFixtureStock` (inventory-hygiene.ts) and `--purge-fixtures [--idle-minutes=N]` on the hygiene script. They remove the free units in KS-CRIT-* / KS-E2E-* locations that have been idle for N minutes (default 60), through `ledger.adjustTo`. Each removal posts an "Inventory Adjustment" with reason "Inventory quantity discrepancy" and note "Test fixture purge". The emptied buckets are pruned.
  - Allocated units are kept and reported.
  - On the dev DB it removed **MLT-WIDGET-01 × 5 from KS-CRIT-R4W20005**. The hygiene check reports 0 issues afterwards.
  - Stock received from fixture POs into real locations, and fixture orders, belong to other modules (REQ-R6-6).
- **Kit pages, Title Case.** These pages were assigned to M06 this round. All Kit Inventory and Kit Component column headers now use Title Case: Product Name, Kit Type, Pack Type Name, Required Kitting Quantity, Included Kits, Reorder Quantity, and so on. So do the row actions and buttons: Create Work Order, Recalculate Now, Create Purchase Order, Component Availability, and the rest. The filter labels were already Title Case. Kit Inventory already has a checkbox column (DataGrid `selectable` default), and the header Create Work Order works from the selection.
- **Not fixable in M06 (filed as REQ-R6-1..9):**
  - dev-server compile-worker crashes and slowness (this round `/api/health` took 44 s and By Location took 63 s to commit);
  - footer "Selected" on read-only grids;
  - column-gear gutter;
  - Feedback tab overlap;
  - filter operators, default Equal search, async export toast, top-centre toasts;
  - Transaction History From-OR-To filter.
- **Checks.**
  - vitest `tests/unit/inventory`: 81/81 pass. The new `inventory-parity-r6.test.ts` covers the txn location text, the change-log wording (including the written row), default reasons (idempotent, respects deactivated values), the fixture purge (ledger reconcile, allocated units kept, idle guard) and stall phases.
  - `npx tsc --noEmit`: 0 errors in M06 and kit paths. The only repo error is in `scripts/catalog-test-data.ts`, which is not M06's.
  - eslint: no new findings in the touched files.
- **Headless check (admin, 1440×900, `/inventory/by-location?q=MLT-WIDGET-01`, screenshot `%TEMP%/claude/kitstak-critic/inventory/r6b-stall-ok.png`).**
  - The page committed at 62 s.
  - After 11 minutes it had **still not hydrated**: `data-phase` stayed at its SSR value and the page-size select was blank. This confirms the diagnosis in REQ-R6-1.
  - The CSS-only notice "Still loading inventory. This is taking longer than usual. [Reload page]" was visible from the first poll after reveal.
  - The blue search chip renders as designed.
  - The JS stall alert, the rows, drawers and menus could not be exercised, because the dev server never delivered the client bundle.

## Blind-judge loop 2, repair round 1 — 2026-11-10
The earlier attempt at this round was interrupted. It had already landed the kit entry points, the kit-type segment, the import drawer, the filter operators, the sticky actions and the trimmed columns. This pass re-checked that work, finished it and verified it on a live server.
- **Sticky row actions (By Location).** The ⋯ column is `meta.sticky: "right"`. At 1600 px it sits at x≈1463, inside the viewport with no scroll. It was also checked at 1440 px.
- **Default columns trimmed.** By Location shows 18 of 38 columns by default (Image, Client, SKU, Location, Product Name, Total/Allocated/Free Pack Qty, Pack Type, Lot, Expiry, Warehouse, Zone, LPN, Status, Damage Reason, Receiving Date, Actions). The rest are in the column chooser.
- **Truncated headers.** Headless check: `thead span.truncate` with scrollWidth > clientWidth. The labels that still truncated were By Location "Inventory Status", Total and ATP "Open SO Qty", and ATP "Warehouse". They now size with `headerWidth()`, and all three grids report **0 truncated headers**. The shared header already shows the full label as a `title` tooltip when a user resizes a column narrower.
- **Scale proof** (`tests/unit/inventory/inventory-scale.test.ts`): 3,000 SKUs, 8,500 locations and 12,000 stock rows in a migrated in-memory DB.
  - By Location first page / sort / filter / search / last page: 24–46 ms.
  - Total: 17 ms. ATP: 34 ms.
  - Full export passes: By Location 12,000 rows in 0.54 s, Total 0.09 s, ATP 0.32 s.
  - **Real bug found and fixed:** ATP took 420 ms per 100 rows and 13.4 s to export. The cause was the `pickable` subquery in `src/server/domain/atp.ts`, where SQLite picked `inventory_status_idx` and scanned every Stock row for each output row. `+i.status` disables that index for the term. It is a one-character shared change with the same results, and the foundation ATP tests pass.
- **Live timings** (dev DB, warm): by-location API 126–169 ms, total 449–549 ms, ATP ~470 ms. First rows paint in 0.66–1.2 s.
- **Async export.** Export As Excel returns 202 (0.4–0.7 s warm; 2.7 s on the first, compiling hit). The toast reads "Export started … Open tasks tray". The top-bar **Transactions** tray lists "Inventory by Location export · 306 rows · Completed 100%" with the .xlsx link 3.5 s after the click.
- **Kit Inventory.**
  - The helper text explains both kit types, and an All / Kit to Stock / Kit to Order segment writes `f.kitType=in:Kit to Stock` (a chip-backed URL filter).
  - Row ⋯ now has **Create Kit (Preview)**: a 3-step drawer (Quantity › Inventory preview with kit +N and each component −BOM×N, with shortages flagged › Create Work Order prefilled). It also has **Disassemble Kit**: the 2-step work-order Disassemble dialog prefilled with the warehouse, client and kit, and disabled with a reason when there is no kit stock.
  - Verified headless on CPL-KIT-SAMPLER: building 13 shows kit 9 → 22 and CPL-BAG-DEC-12 584 → 571.
- **Import end to end.** One real partially failed import ran through `POST /api/imports/inventory` (`ks-import-partial.csv`: 1 good row, plus 3 bad rows for an unknown SKU, an unknown location and Damaged without a reason).
  - History shows "Partially Successful 4 / 1 / 3".
  - The details drawer lists every row. **Show errors** narrows it to the 3 errors, and **Download Original File** returns the CSV (200 text/csv). There is also a Download Error File link.
  - Note: the good row added 1 × VLT-STAND-LPT to B-01-03-2 on the dev DB.
- **Typed filters and views.** API checks: `nin` (Exclude / not in), `ew`, `ct`, `empty`, `ex`, `rng` min/max, `date:last30d`, `date:ahead30d`, `date:before30d` and the weekday `date:mon` all return 200 with correct rows. The SKU chip reopens in the editor as "Exclude".
  - A saved view (KS-CRIT-exclude view) round-trips exactly through the URL. It was deleted afterwards.
- **Transfers e2e.** `inventory.spec.ts` "inventory transfers" covers Transfer Product (partial 5, merge into the existing target Stock row with the same row id and qty +5, success toast, ledger "Inventory Movement" from → to), Transfer Location, Transfer LP and Adjust to 0. Each transfer test now screenshots its toast (`E2E_SHOTS_DIR`, else the test output dir). Every mutation is reverted in `finally`.
- **Adjust to 0.** The (i) tip on New Quantity says "Setting the quantity to 0 will delete this inventory record." The e2e test hovers it, adjusts a fixture row to 0, confirms, sees "empty record was removed" and checks that the row is gone.
- **Demo data.**
  - Thumbnails on Total and By Location are real product images. The 3 products without an image show one neutral Package icon.
  - The seed opening-balance note no longer names the predecessor system ("Opening balance"), and no ledger note in the dev DB mentions it. The adjustment reason "Classic Migration" is renamed **"Opening Balance"** in the seed (`lookups.ts`, `opening.ts`) and in the dev DB (lookup row renamed, version bumped).
- **Checks.**
  - `npx tsc --noEmit`: 0 errors repo-wide. eslint is clean on the touched files.
  - vitest `tests/unit/inventory` + `tests/unit/work-orders-kitting`: 227/227.
  - Playwright `tests/e2e/inventory/inventory.spec.ts`: 19/19 (run with `PW_CHROMIUM_PATH` set to the installed headless shell 1254, because the pinned 1187 build is not installed).
  - `verify-ledger`: every invariant reconciles.
  - Screenshots are in `%TEMP%/claude/kitstak-critic/inventory/`: br1-*, br2-kits/createkit/disassemble, br3-import-*, br4-export-tray, transfer-*-toast, j6-*.
