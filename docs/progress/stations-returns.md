# M04 stations-returns — progress

## Status (round 1, resumed 2026-11-06)
A prior builder pass (no progress file) produced the full code surface. This pass verified the server and API end to end against the live DB, fixed defects, added tests, and filed a request.

### Built (code present, typechecks clean)
- Routes: /packing-station, /packing-station/[stationId]/[mode], /return-station, /orders/returns, /orders/returns/new, /orders/returns/[id] (all render 200)
- Server: packing.ts, packing-scan.ts, returns.ts, returns-grid.ts, returns-receive.ts, returns-carriers.ts, returns-export.ts; export provider return-orders.ts
- APIs: /api/packing/*, /api/returns/*
- UI: components/packing/*, components/returns/*, grid-defs/returns/return-orders.ts
- Tests: tests/unit/stations-returns/{packing,returns,returns-flow,station-models}.test.ts — 36 passing

### Verified live via API (localhost:3000, admin)
- Packing: stations (PACK-01..04), KPIs, List & Select, location/order scans, Logiwa error "No allocated order found…".
- SO010843 packed at PACK-01 in 2 boxes: Get Rate sandbox quotes; status Ready to Ship; master + 2 package tracking numbers; label PDF served; packing slip; 2 ledger Packing rows; change_log rows.
- RMA000323 for SO010481, 1 of 24 units, with a return label: Pending; the over-quantity guard ("Max 24") works.
- Received at RET-01 as Restock into MLT1-RTN: RMA Completed, Return receipt, ledger Return Receiving, MLT1-RTN on hand +1.
- A Cancelled RMA (RMA000313) can't be received. Transitions offer only legal moves; illegal bulk changes come back as per-id INVALID_STATE.
- Grid filters/sort/summary pills work; the async xlsx export of return-orders completed (18 rows).

### Fixes this pass
- Validation errors with fieldErrors now use `validationError()`. DomainError put them in `details`, so the envelope dropped them and inline field errors could not show.
- Security: Return Station receive and manual return also require `fulfillment.task_details.execute_task`. The viewer role holds `inventory.return_station.view`, so viewers could post inventory. The UI disables both actions with a reason tooltip. REQ-1 is filed for a dedicated key.

### Pass 3 (2026-11-06): browser click-through with headless Playwright (the browser pane was at its tab cap)
- Packing, keyboard only, on KS-TEST orders SO010845 and SO010846:
  - dashboard selects (warehouse, PACK-01), the "2" shortcut, location scan, auto-focus to product scan;
  - wrong SKU gives a red toast; over-pack is blocked; package type auto-fills L/W/H;
  - F2 closes box 1 and opens box 2; Get Rate returns a sandbox quote;
  - F9 → Ready to Ship, master + 2 child tracking numbers, label PDFs, change_log rows;
  - List & Select modal (filter, empty state, Enter to start); Other actions menu (Report issue, Packing slip, Shipping label, Pack without label);
  - Report Issue validation, then submit → moved to RET-01, Pack Short Open.
- Returns:
  - Create RMA wizard on SO010835: step validation, picker, qty cap, Back/Next, return label → RMA000324 Pending with tracking.
  - Return Station: Return with RMA → Restock into MLT1-RTN. RMA000313 (Cancelled) is refused; the wrong item is rejected; F9 completes → Completed and MLT1-RTN +1.
  - Return Manually → RMA000325 (Manual, Damaged with a reason, linked to SO010835).
  - RMA detail: Change status → In Transit; Cancel through ConfirmDialog → Cancelled, actions disabled with reasons; change log.
  - Grid: status pills (URL state), sort, filter fields, Change status modal (legal moves only, disabled with no selection or terminal rows), Tag popover.
- No horizontal overflow at 768 / 1280 / 1440 on all M04 routes.

### Fixes in pass 3
- **Pack short:** orders with Pack Short Open are no longer packable. Scan gives a clear message, List & Select excludes them, Complete refuses them. After Report Issue the screen resets instead of reopening the order. Unit test added.
- **Create RMA / Return Manually crash:** the shared OrderPickerDrawer crashes against `/api/pickers/orders` (REQ-2). Replaced it with a local `ShippedOrderPicker` over a new `GET /api/returns/shippable/search`. Results are newest-shipped first and show "x of y returnable"; fully returned orders are disabled. The picker is keyboard driven. Unit test added.
- **Hydration mismatch** on /orders/returns: `useHydratedCan` / `useHydratedMe` in `returns-client.ts` are used by every M04 page.
- **Small text contrast:** M04 components use `text-secondary` instead of `text-faint`. Shared tokens are filed as REQ-4.
- **Select labels:** "MLT1 · MLT1 - Main Fulfillment" and "PACK-01 / PACK-01" no longer repeat; "tracked" no longer appears twice.
- **Lint:** no errors left in owned paths (picker without effects, grid selection cache, station page memoization, an escaped apostrophe).
- **e2e:** `tests/e2e/stations-returns/stations-returns.spec.ts` has 8 tests, all passing (`--project=e2e --no-deps`): axe and console checks on 4 routes, dashboard gating, the keyboard multi-box pack, Create RMA → Return Station receive, and the Change status / cancelled guard.

### Remaining / blocked on shared requests
- REQ-1 dedicated Receive permission (pending; a temporary gate is in place).
- REQ-2 shared OrderPickerDrawer vs picker API (pending; a local picker is in place).
- REQ-3 station choices in user preferences (pending; per-browser localStorage until then).
- REQ-4 shared contrast tokens (pending; the e2e axe check skips color-contrast until then).
- Viewer 403 not exercised live (the role mapping plus the gate cover it). No side-by-side critic run yet in this pass.

## Decisions
- Packing with Pack Short Open is blocked until the order's pack short is resolved (Resolve Pack Short in Orders).
- Lines are preselected in Create RMA only for single-line orders; multi-line orders need an explicit pick ("Select at least one item").
- Hospital location default: HOSP* code, else a Returns-area non-virtual location, else a Returns-area location.
- Multi-box master tracking = package 1's tracking number (foundation shipping.createLabel behaviour).

## Round 1 (parity loop) — 2026-11-09
Checked against `references/logiwa-live/outbound.md` §3 (Return Orders), §12 (Packing Station) and §13 (Return Station):
- Packing Station start options match Logiwa: Scan a Tote / Location / Putwall-Mobile Cart / List and Select (shortcuts 1-4), user card and today stats.
- Return Station matches Logiwa: warehouse + station selectors, Location | LP target toggle, Return With RMA / Return Manually, and three user stats.
- Return Orders grid covers all 25 Logiwa columns (one row per SKU line), Change Status, and Tag. It adds Line status, Source, Disposition and reason columns, hidden by default.
- Checks: vitest tests/unit/stations-returns 38/38 pass; tsc shows no errors in M04 paths. A headless Playwright smoke of /packing-station, /return-station, /orders/returns and /orders/returns/new gives 200 with no console errors.
- Note: the e2e/smoke runs need `executablePath` for chromium_headless_shell-1254 (the installed Playwright expects 1187). It is cosmetic for local runs.
- No new shared requests.

## Round 1 (parity loop), pass 2 — 2026-11-09 (builder)
How it was checked: headless Playwright critic walks with screenshots in `%TEMP%\claude\kitstak-critic\stations-returns\r1\`, the module e2e suite, unit tests and tsc. Another agent was editing M04 files at the same time; its changes were merged, not reverted.

**Defects fixed**
- **Create RMA "Create another" / "Next selected order":**
  - The wizard stayed in its completed state, so it reopened on the last step with stale values. It now remounts on step 1 (a run key) and loads the next order.
  - With `?orderIds=a,b,c`, "Next" looped back to the first order. It now walks the presets in order and says "order N of M".
- **Duplicate "RMA RMA000325" copy:**
  - The success screen now reads "You have successfully created Return Order RMA000325".
  - The detail title is "Return Order RMA…".
  - The source badge reads "Customer RMA" (or "Manual return") instead of a bare "RMA".
- **Status pills disagreed with the grid** ("All 15" against "Total: 20"). The pills count RMAs; the grid has one row per RMA line. `returnStatusCounts` now counts lines, so the pills agree with Total. Unit test added.
- **Grid headers clipped:** "FROM COUNTRY NAME" ran into STATUS, and "REQUESTED QU…" was cut off. Both columns are wider now.
- **Pack screen permissions:**
  - F9 completed packing even without the Create Label permission. It now refuses with the reason; the server already enforced this.
  - Users without Execute Task (viewer) now see Complete and Pack Without Label disabled, with "You need the Execute Task permission to pack orders".
- **Receive at station** from an RMA now passes `warehouseId`. The Return Station opens in that RMA's warehouse, once, and the user can still switch. Before, the lookup ran in whatever warehouse was remembered and failed with "No return found".
- **Station setup:**
  - A warehouse with exactly one packing station, or one Returns-area station, selects it automatically.
  - Both user cards show the role (e.g. "Admin · admin@…"), matching Logiwa's user card ("Supervisor").

**Checks**
- vitest `tests/unit/stations-returns`: 39/39 pass.
- `tsc --noEmit`: no errors in M04 paths.
- e2e `tests/e2e/stations-returns`: 8/8 earlier in the pass. On the final run, 7 of 9 passed, including a new pill-count test that failed; see requests R2-1 and R2-2.

**Open**
- The shared dev server is serving a stale `returnStatusCounts` (R2-2). The live pills will match the grid after the next `next dev` restart.
- Unchanged: REQ-2 (local picker in place) and REQ-3 (localStorage memory).

## Round 2 (parity loop), 2026-11-09
Fixes against the round-1 critic verdict (6.8):
- **Complete return is now under 1 s with blocking feedback.** The cause was the UI awaiting the photo uploads and an `invalidateQueries` refetch of every active grid before it showed success. Now:
  - `useInvalidateReturns` is fire-and-forget, and photos upload in the background.
  - A `CommitOverlay` (role=alertdialog, spinner, "Keep this page open") plus a `beforeunload` guard covers the commit window.
  - Measured live: overlay at 20 ms, success at 0.9 s (RMA000328).
- **Open returns KPI:** the server count was right (9 → 8 after completing RMA000328). The tile refetches once invalidation no longer blocks.
- **Packing KPI equals List & Select:** `packingKpis.ordersToPack` now reuses `readyToPackOrders(...)`, so it excludes open pack shorts and zero-unit orders. The tile refetches on mount and every 30 s. Unit test added.
- **Create RMA route gated server-side:** `requirePagePermission(create_rma)` redirects a viewer to `/forbidden?from=…` (verified live as finance@). POST /api/returns was already 403.
- **Shippable 500s:** the root cause was a sibling module's syntax error (`receiving/receive-items-drawer.tsx`, "Unterminated string constant"). It broke the whole dev compile, so every route returned an HTML 500. M04 now handles this on the client:
  - The picker and step 1 retry once, then show an error Callout with Retry.
  - The footer reads "Loading…" or "Not loaded" instead of "0 orders".
- Grid headers: every column's size/minSize fits its label (`headerFitWidth`), so "FROM COUNTRY NAME" and "REQUESTED QUANTITY" no longer collide. Unit test added.
- Status pills: the "All" pill is now "All lines" with a tooltip. Pills and Total both count RMA lines.
- Breadcrumbs: Fulfillment › Return Orders / Return Station / Create RMA are explicit on M04 pages. The top-nav highlight lives in shared nav config and is filed as REQ-5.
- RMA detail header: "Created … by Name (email)", which matches the timeline actor.
- Create RMA: the reason select shows "Loading reasons…" while loading (`useLookupState`). The wizard ring percent is in the shared wizard, filed as REQ-6.
- Return station:
  - The Note input has a fixed height (h-9).
  - Products without an image show a neutral package icon instead of initials.
  - The Location/LP toggle and the target are editable mid-flow at full contrast. Placement is read live at submit.
  - The stale lookup error clears on the first keystroke (`ScanField.onValueChange`).
  - Disabled big actions have a `title` and `aria-describedby` with a visible reason line.
- Pack screen:
  - Opening an order calls `POST /api/packing/orders/[id]` (`startPacking`). Pending Packing tasks become Started, and the order moves Ready to Pack → Packing Started through the normal task rollup. This is idempotent. View-only users fall back to GET. Unit test added.
  - The label reads "# of Orders in Tote/Location/Putwall x/y".
  - The active package uses neutral styling. The primary color is red in the rebrand, so a primary ring read as an error.
  - Get rate stays disabled with a reason until a package is closed.
- The List & Select date filter uses the shared DatePicker.
- Tests: `tests/unit/stations-returns` has 5 files and 42 tests, all passing. `tsc` is clean for M04 paths.
- e2e spec updated: the pill regex, plus a viewer-gate test. The Playwright runner could not launch: node_modules has 1.55 and needs chromium 1187, but only 1254 is installed. The live checks ran through throwaway scripts using the installed headless shell.

Still open vs Logiwa (not done this round):
- Create RMA return address and warehouse.
- Bulk Update Return Info.
- Label bulk actions on the grid.
- The print-actions document list.
- Persisted per-line photos, still unverified.

## Round 3 (parity loop), 2026-11-09
Fixes against the round-2 critic verdict (6.2):
- **Pills and Total now agree.** `GET /api/returns/summary` takes the grid query string and uses the grid's own FROM and WHERE, minus the status filter. "All lines" therefore equals the unfiltered Total, and each pill equals the Total after it is picked. Verified live: pills 24, footer Total 24. Unit test added.
- **Bulk Update Return Info** (Logiwa header action):
  - `POST /api/returns/bulk-info` takes `ids` or `lineIds` and updates expected return date, return carrier, shipping option, tracking, from country and note.
  - Each field in the modal has an "Update" tick, so only ticked fields change, and a ticked empty field is cleared.
  - Open RMAs only; completed and cancelled RMAs come back in the per-id `failed` list. Every update writes `change_log`.
  - Verified live: RMA000326 tracking set to 1ZR3TEST.
- **Label menu on the grid:** Create return label (exactly one open RMA with an order, through the existing ReturnLabelDialog), Reprint (opens each selected label file) and Void.
  - Void calls `DELETE /api/returns/[id]/label`, which voids through `shipping.voidLabel`, clears the RMA tracking and the label link, and writes `change_log`.
  - Every item has a disabled reason. The RMA detail Return label menu also has Void, with a confirmation.
  - The grid rows now carry `labelShipmentId`, `labelFileId`, `labelStatus`, `warehouseId` and `clientId`.
- **STATUS column** is sticky-right, so the pill is fully readable at 1440. The TAGS column was already there.
- **Create RMA step 1:**
  - Choosing an order now sets `orderId` and clears errors straight away.
  - While the lines load, a labelled spinner shows ("Loading the order and its returnable lines…") and no error appears.
  - Next is disabled with a reason ("Loading the order…", "Choose a shipped order", or the reason the order is ineligible), using the wizard's `canProceed`.
- **Create RMA step 2:** the quantity and the checkbox stay in sync (`lineEdit`). Checking a line fills its full returnable quantity, unchecking clears it, and typing a quantity above 0 selects the line (0 or empty deselects it). Lines that are not selected show an empty quantity instead of a pre-filled `1 / 2`, so the summary Lines/Units match what is on screen. Unit tests added.
- **RMA detail:**
  - While loading, the header, back link and the tabs (Lines & receipts, Return label, History) render straight away, with skeletons only in the body.
  - The tabs use role=tab (3 counted live).
  - The History tab has the timeline plus a "Field change log" button.
- **Return Station start cards:** a new pure `stationStartReason` names the missing input first ("Choose a receiving warehouse and return station", then "Choose a return station" or "Loading return stations…"). It shows "Checking your permissions…" while `/api/me` loads, and the Execute Task message only when the loaded permissions lack it. Admin now sees enabled cards. Unit tests added.
- **Default warehouse and station:** `defaultPick` uses the remembered choice, then the context warehouse, then the first option. This applies to both the Packing and Return Station dashboards, so the KPIs load on first visit (Return Station showed 0/0/0 live, not em-dashes).
- **Friendly validation:** `/api/returns/stations`, `/api/returns/kpis`, `/api/packing/kpis`, `/api/packing/hospitals` and `/api/packing/orders` (plus the scan schema) now return "Choose a warehouse" through the shared `warehouseIdParam`.
- Tests: `tests/unit/stations-returns` has 6 files and 51 tests, all passing (new: `round3.test.ts`, plus a bulk-info DB test in `returns.test.ts`). `tsc` is clean for M04 paths, and eslint shows 0 errors on M04 paths.

Still open:
- The top-nav highlight (REQ-5) and the wizard ring percent (REQ-6) are both shared code.
- List and summary performance depends on server load and indexes (REQ-10).
- The pack screen Print Actions document list.
- The Create RMA return address name and warehouse.
- Persisted per-line return photos are still unverified.

## Round 2 (parity loop) — pass 2, 2026-11-09 (builder, against the 7.2 critic verdict)
How it was checked: unit tests, `tsc`, direct API timing, and headless Playwright walks (scripts and screenshots in `%TEMP%\claude\kitstak-critic\stations-returns\r2\`). A second agent edited M04 files at the same time; its changes were kept, not reverted.

**Fixed**
- **Rate and Complete follow one rule.** The old rule disabled Get rate until a package was closed (F2) but let F9 buy an unrated label. Now:
  - Get rate needs items plus size and weight on every used package (`rateBlocker`); closing is not required.
  - Complete closes the open package(s) itself (`closeUsedBoxes`).
  - With a label, the first F9 fetches and shows the rate. The button becomes "Buy label ($21.87) and complete", and the second F9 buys (`completeStep`).
  - If no quote comes back, an inline message explains, and the second press can still buy.
  - The footer chip beside Complete shows the selected option and rate (aria-live), as Logiwa does.
  - Verified live: SO010847, UPS 2nd Day Air at $21.87, then packed to Ready to Ship with master tracking.
- **F9 with nothing loaded** shows the toast "Nothing to complete · Scan an order first" and refocuses the scan field.
- **Pack screen empty state** shows a disabled form preview: package type, L/W/H, weight, the contents grid header, carrier and service, Get rate, and upload.
- **Package contents grid** now has Image, Product (with name), Weight, Attributes (lot / expiry / serial chips via `lineAttributes`), Label and Qty columns.
- **No initials on line cards:** cards show the product image, or a neutral package icon when there is none (`ItemThumb`, shared with the Return Station).
- **Report Issue:**
  - The pack context carries `hospital {id, code, detail}`, so the default (e.g. "RET-01 (default)") shows immediately.
  - While the list loads there is a disabled "Loading more locations…" row, and a chosen id is never blank.
  - Field errors clear as the user types.
  - The operator chooses units per line (default: not yet packed), and they are sent as `lines` to `/api/packing/report-issue`. The server already honoured `lines`.
- **Return Station KPIs:** `/api/returns/receive` and `/api/returns/manual` return `kpis`, computed in the same transaction. The client writes them straight into the tile cache (`useApplyStationKpis`), then invalidates. This is unit tested: after a receive, tiles show 1/1/0, and a manual return takes them to 2/3.
- **Return Station wrong-warehouse dead end:** `/api/returns/lookup?anyWarehouse=1` returns the in-scope warehouses where the code matches. The station offers "Found in MLT1 · Switch to MLT1", which switches warehouse and station and reloads the RMA. Verified live once (RMA000331).
- **Permission before validation:** `/api/returns/receive`, `/api/returns/manual` and `/api/packing/complete` use the execute key as the route permission, and check station access in the handler. Verified live: viewer + `{}` gets 403 on all three; admin + `{}` gets 400 with field errors.
- **Change Status:**
  - The modal shows the selection's current statuses at once.
  - A spinner reads "Checking which statuses are allowed…".
  - The primary button reads "Checking…" and then "Choose a status", instead of a silent disabled state.
- **Grid:** Status moved next to RMA code (column 3) with no sticky-right clipping. Verified headers at 1440: Shipment order code, RMA code, Status, …
- **Create RMA wizard:**
  - The summary rail now sits outside the shared wizard, so the footer shows **Create RMA** on the last step (verified: Cancel, Back, Create RMA).
  - Progress comes from `rmaProgress`, one third per step, never 100% before step 3. The other agent refined it so it is based on passed steps.
  - Typing over the cap shows an inline "Max N returnable. Set to N."
  - "Choose a shipped order" stays disabled with a spinner until hydration.
- **List & Select footer** reads "Loading orders…", "Not loaded", or "N orders · updating…", never "0 orders" while loading.
- **Scan and lookup performance:**
  - Profiled in process against `.data/kitstak.db`: grid ps=200 0.45 ms, status counts 0.07 ms, shippable search 0.3–0.9 ms, RMA lookup 0.06 ms, KPIs 0.05 ms, ready-to-pack 0.35 ms, scan miss 0.06–0.14 ms, transitions (10) 0.97 ms.
  - The 9–74 s the critic saw is dev-server load: 400 validation errors alone took 4–14 s and API calls took 3–46 s during this pass.
  - Order scans (`findOrdersByCode`) and RMA lookups now try exact case variants against indexed columns first (`code`, `store_order_number`, `shipments.tracking_number`, `rma_code`), with a case-insensitive scan only on a miss.
  - `return_order_lines(return_order_id)` was already indexed (`return_lines_return_idx`).
- **Tests:** `tests/unit/stations-returns` has 8 files and 63 tests, all passing. New: `parity-r2.test.ts` and `lookup-elsewhere.test.ts`.

**Not done / open**
- **Breadcrumb vs top nav:** Logiwa and our nav-config put Return Station and Return Orders under **Inventory › Inbound** (see `references/logiwa-live/inbound-inventory.md` §0).
  - This pass set the M04 breadcrumbs to Inventory.
  - The concurrent agent then changed them back to "Fulfillment" (no href), so the mismatch remains until one of two things happens: the breadcrumbs say Inventory, or nav-config moves the items to Fulfillment (REQ-5).
  - Recommendation: Inventory, to match Logiwa.
- **Stale dev-server bundles (R2-2) again:**
  - `POST /api/packing/orders/[id]` kept serving a pack context without `hospital` while `GET` had it.
  - `/api/returns/lookup?anyWarehouse=1` worked, then went back to an older schema.
  - The client falls back gracefully: it shows "Default hospital location" until the list loads, and the plain "No return found" message. Needs a `next dev` restart.
- **`tsc`:** errors at `packing-dashboard.tsx:46` and `return-station-page.tsx:83` ("unknown" passed to station memory) come from the concurrent agent's in-progress edit, not from this pass.
- **Not verified with real data:** Tote and Putwall modes with a real tote or cart, and the LP return target end to end (unchanged from round 1).
- **Not built:** Logiwa's "Clear Completed" and "Excel Export History" utilities on the packing dashboard.

## Round 4 (parity loop) — 2026-11-09

Fixes for the round-3 critic verdict (7.6):
- **Breadcrumbs:** Return Orders, Create RMA, RMA detail and Return Station now always read `Home > Fulfillment > …` (they had been switched to Inventory). RMA detail has a full breadcrumb (`Fulfillment > Return Orders > RMA…`), shown in the loading state as well. The top-nav highlight is still Inventory; that comes from shared `nav-config.ts` (REQ-5, re-raised below).
- **Create RMA speed and recovery:** the chosen order is fetched once. It is cached for 60 s, with no refetch on mount or focus and no abort on remount; the browser network log confirms 1 request. Loads time out after 15 s and show the Retry callout. `GET /api/returns/shippable` computes the already-returned quantities in one grouped query over the order's RMAs (it was one scan per line, and `order_line_id` has no index). `GET /api/returns/shippable/search` now picks the 50 ids first and only then computes unit sums, instead of doing it for every shipped order before sorting.
- **Progress ring:** deterministic by completed step: 0% on Order, 33% on Items, 67% on Return shipping, and 100% only on the last step with a valid order and items. Unit tests in `round4.test.ts` and `parity-r2.test.ts`.
- **Return Station:** a wrong-SKU scan shows its error, beep and toast at once; an alternate barcode the server later resolves clears it. Completing a receive leaves an in-flight marker in sessionStorage. If the page reloads before the server answers, the station shows "Receiving RMA… was interrupted" with a link to check the RMA. A retry is safe: the server answers 409 "is completed and can't be received". `beforeunload` already warns while a receive is posting. Measured on the dev server: create RMA 36 ms, receive and complete 294 ms. The critic's 27.5 s was dev-server compile and load.
- **Return Orders grid:** the default order is RMA code, Status, SKU (+ name), shipment order, and so on, so multi-line RMAs read as lines. Pack type and Created by move forward (Logiwa default set). Company name is hidden by default. Text cells and SKU carry a `title` tooltip. The header checkbox was confirmed `indeterminate` with 1 row selected (Playwright `data-state`).
- **RMA detail:** the Summary adds Warehouse, Return address (custom address, falling back to the warehouse address), Return carrier, Shipping option and Return tracking. The History tab's change log is prefetched as soon as the RMA loads. New `GET /api/returns/[id]/history` returns a JSON change-log page and a JSON 404 for an unknown or out-of-scope RMA.
- **Packing station URLs:** an unknown mode redirects to its canonical mode (`list` → `order?list=1`, `cart`/`mobile-cart` → `putwall`, anything else → `tote`). A station code (`PACK-01`) resolves within the user's warehouses and the URL is replaced with the station id. Unit tested.
- **Station defaults:** `useStationMemory` now reads and writes `preferences.stations[kind]` on the server (REQ-3 landed), with localStorage as the fallback. The warehouse default is remembered → header context → the user's `defaultWarehouseId` → the first warehouse. While `/api/me` loads (3–5 s on the shared dev server), the pickers say "Loading…" and the start tiles say "Loading your station setup…" instead of "Choose a warehouse".
- Checks: `npx tsc --noEmit`: no errors in M04 paths. `npx vitest run tests/unit/stations-returns`: 9 files, 66 tests pass. Headless Playwright walk (admin and operator) of /orders/returns, /orders/returns/new, /orders/returns/[id], /return-station, /packing-station and its aliases logged no console errors.
- Not done: Logiwa "Create/Reprint Retailer Label", the Return (BETA) per-order return-info edit form with multiple tracking numbers, the default "Last 7 days" date chip, and walking LP-target and putwall cart data end to end.

## Round 5 (parity loop) — 2026-11-09

Fixed against the round 4 critic verdict:
- Pack workspace now shows a "Read-only view" callout when the user lacks Execute Task. It matches the Return Station messaging, and the write controls were already permission-gated (`pack-screen.tsx`).
- Breadcrumbs on Return Orders, Return Station, Create RMA and RMA detail now read Home > Inventory > ..., which matches the top-nav highlight (REQ-5 resolved on the module side).
- Units are labelled: the Return Station KPI is now "Open RMAs", and its info tooltip says it counts RMAs while the grid pills count lines. The grid's "All lines" pill has an sr-only "Counts are lines" note.
- RMA detail Summary: empty Return carrier and Return tracking fields show an inline "Create return label" action when a label can be created, and fall back to an em dash with no action otherwise.
- `/api/returns/shippable` query contract is documented in the route header. It takes `orderIds=a,b` (CSV) or repeated `orderId=`, and the 400 message names the expected parameter.

Not done or not verified:
- The blank 500 caused by `waves-run.ts` `plannedWindow` came from a Turbopack module-graph compile error in another module (fulfillment-jobs). An `error.tsx` boundary cannot catch a compile failure. `src/app/(app)/error.tsx` already covers runtime errors. The export is now resolved (no `plannedWindow` reference remains in the repositories).
- Headless Playwright could not launch this round. The installed `@playwright/test` expects chromium build 1187, only 1254 is installed, and launching 1254 directly fails with `spawn UNKNOWN`. The 58–92 s viewer navigation times were not re-measured. They are most likely cold dev compiles of the pack route.
- Missing-vs-Logiwa items still open: the Clear Completed / Excel Export History utilities, the default "Last 7 days" chip on Shipped/Cancelled (orders-outbound owns that list), and real-data end-to-end runs of the tote, putwall and LP-target flows.

## Round 6 (parity loop) — 2026-11-10
- **Pack weight (major):** the numbers already agreed (MLT-WIDGET-01 is 8 oz/unit × 2 = 16 oz = order totalWeightOz; the package type tare is 5.6 oz; 21.6 oz = 1.35 lb). The real problem was the labels. The contents column is now "Unit wt × qty" and shows `8 oz × 2 = 1 lb`. Each package shows an "Items X + box Y = Z" breakdown, the suggestion reads "Use 1 lb 5.6 oz", and the declared total shows lb/oz plus decimal lb. New pure helpers `weightBreakdown` / `formatLbOz` in pack-model.
- **Order-mode scan of a non-packable order:** `/api/packing/scan` now returns `blocked` with the order and an order-specific reason (`notPackableOrderMessage`, e.g. "SO010843 is Ready to Ship (already packed)…"). The screen shows it inline and in a toast, with an "Open SO010843" link. Location/tote/putwall modes keep the Logiwa wording.
- **Duplicate controls:** the greyed-out pack preview is now wrapped in `<div aria-hidden inert>`. `Card` did not forward `aria-hidden`, so the preview inputs were exposed before. Verified headless: one `#pack-source`, no duplicate ids.
- **RMA step 2:** Next is blocked while return reasons load. A customer return reason is required on every selected line whenever the client has reasons set up.
- **Shipped-order picker:** the active option skips fully returned (disabled) rows. Disabled rows never carry `aria-selected`, and arrow keys skip them (`nearestEnabled`). Verified headless: disabled rows show aria-selected=false, and Enter picked the first enabled order.
- Requests filed: OS dark-mode default (foundation), packable tote/putwall/location seed fixtures (seed), Playwright pin.
- Still open: Create/Reprint Retailer Label, the per-order Return (BETA) info edit section, Clear Completed / Excel Export History, and Return Process parameter enforcement demo.
- Tests: `tests/unit/stations-returns/round6.test.ts`. The suite passes 70/70 and tsc is clean on owned paths.

## Round 3 (parity loop) — 2026-11-10

Fixes for the round-2 critic verdict (7.6). Every item below was changed in M04 files only.

**Fixed**
- **Date-only fields no longer shift a day.**
  - New `src/components/returns/date-only.ts`: `localDateFromIso` and `isoFromLocalDate` read and write "YYYY-MM-DD" as a local calendar date, never through `toISOString()`.
  - It is used by the Create RMA DatePicker (value and onChange) and the summary rail (`fmt.date`). It is also used by the RMA detail "Expected return" and by the grid's date-only cell, which now receives a local `Date`.
  - The xlsx export was already correct: exceljs writes the UTC date.
  - The API validates `expectedReturnDate` as a real `YYYY-MM-DD` date (`dateOnlySchema`).
  - A unit test runs with `TZ=America/Chicago`.
  - Verified live in headless Chromium (timezone America/Chicago): typed 2026/11/20, the input kept 2026/11/20, the DB stored `2026-11-20`, and both the detail page and the grid show 11/20/2026 (RMA000336, RMA000337).
- **Create RMA Return section (Logiwa parity).**
  - Step 3 has a **Return address** selector: the warehouse's addresses, then the client's Return addresses, with a default. It comes from `shippableOrder().returnAddresses`.
  - When no label is bought, step 3 also takes manual **Return carrier** (warehouse connections plus UPS, FedEx, USPS, DHL, OnTrac, Amazon Shipping and Other), **Return shipping option** (the carrier's services, or free text), **Return shipping cost**, and **Return tracking number(s)**. Tracking numbers are added with an Add button or Enter, show as chips, are de-duplicated case-insensitively, and are capped at 10.
  - The server validates the address against the order's options. It persists `return_address_id`, the carrier, the service, and the tracking numbers (comma-separated in `tracking_number`, because there is no JSON column).
  - Cost is stored on the shipment order's Return section, because `return_orders` has no cost column (R3-1).
  - The detail Summary shows the address, carrier, option, each tracking number as a chip, and the cost. The grid shows the carrier, option and "1ZRET0001, 1ZRET0002".
  - Verified live: RMA000337.
- **Progress ring:**
  - The Order step counts as soon as an eligible order is chosen (33% on step 1).
  - Items count once reached with at least 1 unit (67%).
  - 100% and "Ready to create" appear only on step 3 with no unmet required field. Turning on "Create return label" with no carrier drops the ring to 67% with "Complete the return label fields" (verified live).
- **Enter on the Return shipping step no longer submits the wizard.** The first live run created an RMA when Enter was pressed in the date field. Inputs on that step now swallow the implicit submit, so Create RMA is always an explicit click.
- **No console errors on ordinary misses.**
  - `GET /api/packing/scan` now goes through `scanOutcome` and answers 200 `{ miss: { message, kind } }` for an unknown code, nothing allocated, or an open pack short. An out-of-scope warehouse is still 404.
  - The Return Station "found elsewhere" probe moved to the new `GET /api/returns/lookup/elsewhere?code=`, which returns 200 `[]` when nothing matches.
  - Verified with curl: both return 200. In the browser, the "No order found for SO000000" scan logged no 4xx and no console error.
  - The earlier 400/500 on `?anyWarehouse=1` came from the dev server serving a broken module graph (see R3-6). The old route now answers 200 `[]` too.
- **Pack contents grid:** new **Pack type** column, and a per-package footer "Total SKU: n · Total quantity: n" (`packageTotals`). The empty-state preview has the same columns and footer.
- **Pack screen header:**
  - Breadcrumb `Home > Fulfillment > Outbound > Packing Station > PACK-01`. The dashboard has `Home > Fulfillment > Outbound > Packing Station`.
  - The mode switcher is a real `tablist` with `tab` / `aria-selected` and roving tabindex, and the workspace is its `tabpanel`. Left and right arrows switch modes (verified: Tote → Location).
- **Empty left pane (Logiwa layout):** before any scan, the screen always shows the job card ("Scan or enter tote code to find job", "# of Orders in Tote: 0/0"), a disabled product scan with "Total qty 0/0", and the order card ("Select order to pack · SKU qty 0/0 · Total qty 0/0"). Verified live.
- **Auto-print on Complete:**
  - `src/components/packing/auto-print.ts` builds a plan: every package label goes to the user's barcode printer and the packing slip to the laser printer, taken from `/api/printers` for the station's warehouse.
  - It sends the plan through the KitStaks desktop print agent (`window.kitstakPrintAgent`) when installed. Otherwise it uses the browser print dialog from a hidden iframe, with no pop-ups.
  - The success card shows "Printed: Label → ZEBRA-01 · Packing slip → HP-LASER" (or what failed) and keeps the reprint buttons.
  - Unit tested; not exercised live this round.
- **Toasts clear the sticky footer:** while the pack screen or a Return Station flow is mounted, the toast viewport is lifted 88px (`toast-offset.tsx`). R3-3 asks for a proper shared variable.
- **Packing dashboard utilities:** a new "My packing today" card lists the orders the user packed today, with status, units, tracking and time (`GET /api/packing/history`). It has **Clear completed**, which sets a per-warehouse mark so only orders packed after it are listed (KPIs unchanged, "Show all of today" undoes it), and **Excel export history** (.xlsx via exceljs, loaded on demand). Verified live: `packing-history-mlt1-2026-11-10.xlsx` downloaded with the 2 orders.
- **Return Station defaults:**
  - Physical Returns-area stations are listed first, so the default is RET-01. Virtual MLT1-RTN is last and labelled "Virtual · not for physical returns".
  - Return targets are ordered by area (Returns, Storage, Picking, Receiving) and labelled "Returns area · Shelves". Packing, Shipment, Loading, Kitting and Virtual locations are excluded.
  - The Location/LP segmented control fills its row.
  - Verified live: station default RET-01, and the control fills its row.
- **Change log and receipts:**
  - Creating an RMA, or a manual return, writes `<SKU> -> Return Order Line is created.` per line (verified live on RMA000336).
  - Disposition and actual return reason are now line-level rows named by SKU (`<SKU> -> Disposition is modified. --> Damaged`) instead of an anonymous RMA-level row.
  - Receipts stay **one row per received line**. `receipts.master_id` is a unique, ledger-owned receipt number, the same model as PO receiving. This is documented at `postItem`, and the RMA detail groups the rows under its Receipts card.
- **RMA detail:** the receiving progress bar uses the success colour. Date-times use the same compact format as the grid (`11/10/2026 12:58 AM`), with the full value on hover. The Create RMA order card uses the same format.
- **Return Orders grid:**
  - Company name is in the default column set (verified live).
  - Change status on a partial-line selection shows "Status is set per RMA · Applies to RMA RMA000322 (2 lines), not only the selected line." `/api/returns/transitions` returns `lineCount` and `selectedLines` per RMA.
- **Tests:** `tests/unit/stations-returns` has 11 files and 89 tests, all passing. New: `parity-r3.test.ts` (19 tests, 7 against the DB). Updated: the progress-ring expectations in `parity-r2` and `round4`.
- **Checks:** `npx tsc --noEmit` reports no errors in M04 paths. Headless walks: `%TEMP%\claude\kitstak-critic\stations-returns\r3\walk.cjs` and `walk2.cjs`, with screenshots in the same folder. The full walk logged no 4xx and no console errors.

**Not done / not verified**
- The dev server on :3000 was down from about 01:02 to 01:20 (it was not restarted by M04). Once it came back, `walk2.cjs` re-ran with no failures and no 4xx or console errors:
  - pack tabs and empty cards
  - the SO000000 miss
  - Excel export, then Clear completed ("Cleared at 01:21"), then "Show all of today" (2 rows)
  - Return Station "No return found for RMA-NOPE-999 in this warehouse."
- Tote and Putwall pack modes end to end still have no fixture data (R3-5).
- Return shipping cost lives on the shipment order until `return_orders.return_shipping_cost` exists (R3-1).
- The shared `toDate()` still parses bare dates as UTC for other modules (R3-4).

## Blind-judge repair round 1 — 2026-11-10 (builder)

**Tooling:** headless Playwright works again. Launch `chromium_headless_shell-1254` through `executablePath` (the full chromium-1254 build is what fails with `spawn UNKNOWN`). In Git Bash, set `MSYS_NO_PATHCONV=1` or `/api/...` arguments get rewritten. The dev server was up, but heavily loaded by other agents: `/api/health` took 21 s, simple GETs 29–42 s and POSTs 50–100 s. Late in the pass, dynamic `/api/returns/[id]/*` routes returned the Next error page "Jest worker encountered 2 child process exceptions": the dev server's worker pool was crashing, not module code (the same code passes in-process tests). Scripts: `%TEMP%\claude\kitstak-critic\stations-returns\b1\{api.cjs,shots.cjs}`.

**Built / fixed**
- **Create / Reprint Retailer Label:**
  - **Pack screen:** Other actions › Print actions has Create retailer label and Reprint retailer label. Both carry disabled reasons: no retailer on the order, missing permission, or (for Reprint) the label not created yet.
  - **Route:** new `POST /api/packing/retailer-label`. It prints one "Retailer Label For Case" per case (packed boxes, or the label count) with retailer, PO, dept, mark-for, ship-to and "Case n of N", using the retailer's case-label print quantity. Create sets `is_ucc_label_generated` and writes a change_log row; Reprint requires that it was created first.
  - **Shared print change:** `retailer-case-label` / `retailer-parent-lp-label` had no renderer ("not configured"). They now render through the barcode-label template (`retailerLabelSchema`). Only `orderCode` is required, which also makes the orders module's shipped-order Label › Create/Reprint retailer label menu work.
  - **Live:** SO010422. Reprint before create → 409. Create → 201, 2 cases. Reprint → 201.
- **Per-RMA Return info edit:** RMA detail Summary › "Edit return info" opens a modal with Return carrier, shipping option and cost, plus several tracking numbers (Add row, max 10, unique). It reuses the Create RMA fields.
  - **Route:** new `PATCH /api/returns/[id]/info` with a version check and change_log rows. Cost goes on the order's Return section. The carrier is locked while a purchased label is active, and Completed or Cancelled RMAs are refused.
  - **Tests:** in-process (`blind-r1-flow.test.ts`). The live PATCH hit the dev-server worker crash above.
- **Return Process enforced at the Return Station:**
  - **Receive checks:** `receiveRma` and `receiveManual` (when linked to an order) now run the M14 parameters through `checkReturnLine`: unspecified SKU, exceeding the shipped quantity (counting earlier non-cancelled returns), lot/expiry match, and alternate warehouse. Violations come back as per-item field errors naming the rule, e.g. "(Return Process: Prevent exceeding shipped quantity)".
  - **Station side card:** "Return rules in force" lists each parameter as On/Off, says where each disposition puts stock (Restock or Damaged → the target or the station; Quarantine → the station; Dispose → the station, then written off), and links to Return Process settings.
  - **Route:** new `GET /api/returns/rules`. A damage reason was already required for Damaged.
- **Hospital locations page** (`/packing-station/hospitals`, linked from the Packing Station header):
  - **Contents:** every hospital location (HOSP* or a non-virtual Returns-area location) with units, SKUs and pack-short orders held; per-SKU on hand / held / free with a link to the held order; and Move back for free stock to a Storage or Picking location (a ledger Inventory Movement).
  - **Routes:** `GET /api/packing/hospitals/stock`, `GET /api/packing/hospitals/targets` and `POST /api/packing/hospitals/move-back`.
  - **Live:** RET-01 shows 7 units / 4 SKUs / SO010855 held. Move back over the free quantity → 400 "Max 1 free unit". A locked target → 422 from the ledger.
- **Default "Last 7 days" chip on Shipped/Cancelled:** already in `orders-list-page.tsx` (orders-outbound: `shippedAt` last7d preset). Create RMA is in the Shipped bulk menu (`order-bulk-menus.tsx`).
- **Return Orders filters / columns:** `RETURN_GRID_FIELDS` has the 23 Logiwa filters, including Expected/Actual Return Date, From Country Code, Line Status, Store Order Number and Tracking Number, plus Source and Disposition. All 25 columns are present (unchanged, verified in source).
- **Fixtures:** `tests/e2e/stations-returns/station-fixtures.cjs` creates three KS-TEST orders staged in a new LP tote, PACK-02 and a cell of putwall MC-01 (direct SQL for the cell; there is no API for it). It then packs each through the tote, location and putwall pack modes in headless Chromium and saves screenshots.

**Checks:** `tsc --noEmit` has no errors in M04 or print paths. `vitest tests/unit/stations-returns tests/unit/foundation-f6`: 19 files, 158 tests pass. New: `blind-r1.test.ts` and `blind-r1-flow.test.ts`.

**Not verified / open**
- **Cold navigation:** not re-measured meaningfully. With other agents on the shared server, `/packing-station/hospitals` took 138 s to its h1 and `/return-station` timed out at 240 s. Server-side, the M04 queries stay sub-millisecond (profiled in round 3). This needs an idle server or `next build && next start` to measure.
- **End-to-end fixture runs:** see the run log below. A first attempt timed out at `page.goto` (180 s) on the overloaded server.
- The LP-target return flow is still not walked in the browser with a real LP.
- **Run log (end of pass):** the fixture walk (`page.goto /packing-station`, 420 s timeout) and a viewer screenshot sweep (240 s per page) both timed out. The shared dev server was not serving page navigations within minutes, so there are no screenshots of the tote, putwall or location pack runs yet. Re-run `node tests/e2e/stations-returns/station-fixtures.cjs <outDir>` and `shots.cjs` once the server is idle.

## Blind-judge repair round 2 — 2026-11-10 (builder)

**Done**
- **REQ-1 closed:** `RETURN_PERMISSIONS.receive` and the Return Station client gate now use `inventory.return_station.receive_return`, not the `execute_task` stand-in.
- **REQ-2, REQ-3, REQ-4 verified closed:** REQ-2's order picker grid is in use. For REQ-3, `useStationMemory` reads and writes `preferences.stations` through `PATCH /api/me`, with localStorage only as a fallback. REQ-4's tokens are applied.
- **Packing and return KPIs already exist:** `/api/packing/kpis` and `/api/returns/kpis` return today's packed or returned products and orders for the user, plus the orders still open.
- **Cross-module requests filed:** BJ2-1 (Create RMA from the Shipped grid toolbar, orders-outbound), BJ2-2 (returns-platform hook, automation-integrations), BJ2-3 (schema columns for line-level grid parity).
- **Checks:** `vitest tests/unit/stations-returns` has 14 files and 109 tests, all passing. `tsc --noEmit` reports no errors in M04 paths.

**Not done / not verified**
- The dev server on :3000 did not respond: `/login` timed out at 20 s and `/api/health` at 90 s. So there is no render profiling, no headless screenshot pass and no live API check this round. That needs a responsive server; the instructions say not to restart it.
- Line-level Return Orders grid (25 columns, about 20 filters): blocked on the BJ2-3 columns.
- Pack-screen job card, lb/oz pair and pre-generated label upload: not built this round.
- KPIs per station: not added (they are per user and per warehouse today).

## Round 4 (parity loop) — 2026-11-10 (builder)

**Fixed (critic round 3, score 6.4)**
- **Hospital = an explicit designation, with no Returns-bin fallback (major).**
  - `isHospitalLocation()` / `hospitalLocations()` in `packing-hospitals.ts`: a hospital is an active, non-virtual location that is either in a Location Group named **"Hospital"** or coded **HOSP…**. When both kinds exist, group-designated locations sort first and win the default.
  - RET-01, RET-02 and KSCR-RET (Return Station restock bins) are no longer hospitals.
  - `defaultHospital()` and `hospitalOptions()` in `packing.ts` use the same set. Report Issue offers only hospitals, and `reportIssue()` rejects any other location: "RET-01 is not a hospital location…".
  - The stale "else the Damaged location" comment is gone.
  - With no hospital configured:
    - the pack screen menu says "No hospital location configured in this warehouse";
    - the Report Issue dialog shows an attention callout linking to Facility › Locations, and Report is disabled;
    - `/packing-station/hospitals` shows "No hospital location configured" with a Go to Locations link.
  - Hospital cards show their designation ("HOSP code" / "Hospital group").
- **Hospital read permissions (minor):** `GET /api/packing/hospitals` now needs `fulfillment.packing_station.view`, the same as `/stock` and `/targets`. Move back keeps `execute_task`, and Report Issue keeps `report_issue`.
- **Move back: audit and damaged guard (minor).** `moveBackFromHospital`:
  - writes two change_log rows, one on each location (`<SKU> -> On Hand is modified. 3 --> 1` on the hospital, `0 --> 2` on the target);
  - puts the from/to codes and an optional note on the ledger movement;
  - refuses targets outside the Storage / Picking areas;
  - blocks **Damaged** stock (damage reason set) from going to a Picking location. The dialog shows a Damaged callout and greys out Picking targets, with the reason "not for damaged stock". Damaged stock can still go to Storage for review.
  - The move-back dialog now has a Note field and a Retry callout when the location list fails.
- **Create RMA step 1 (minor):**
  - Visible reason under the step: "Choose a shipped order to continue. Next stays unavailable until then." While loading it reads "Next unlocks when the order has loaded."
  - The rail status follows the step body: "Loading the order…", "The order could not be loaded", "Order not found" or "This order can't be returned". The Order row says "Loading…" (`rmaProgress` `orderState`).
  - Shared wizard button title/aria: request R4-2.
- **Shipped-order picker (minor):**
  - The search aborts after 15 s and shows the error callout with Retry, no more endless skeleton rows.
  - After 4 s the skeleton says "Still loading. The server is slow…".
  - "Use order" sits in a DisabledReason ("Wait for the orders to load" / "Retry first" / "Choose an order from the list") and shows a spinner while the order loads.
- **Return Orders first paint (minor):** the grid-prefs fetch lives in shared `use-grid-prefs.ts`, so it is filed as R4-3: abort after about 3 s and use the default columns. The grid list already times out at 30 s with Retry.
- **Tracking numbers (part of R3-1):**
  - In Return Orders, quick search in Exact mode, the Tracking Number filter (eq / in / nin) and the Return Station lookup now match **each** number in a multi-number value ("1ZRET0001, 1ZRET0002"). `trackingTokenSql()` in `returns-grid.ts` does this.
  - Starts-with search also matches the second and later numbers.
- **Per-RMA cost and tracking (R3-1, now R4-1):** foundation owns the schema, so M04 code detects the columns `return_orders.return_shipping_cost` and `return_tracking_numbers`:
  - Once the columns exist (`rmaExtraColumns()`), cost and tracking are written per RMA, with a change log on the return order. This covers Create RMA, Edit return info, Bulk update return info, Attach label and Void label.
  - Until then the fallback is the shipment order's cost.
  - No M04 change is needed when the migration lands.
- **Fixtures (R3-5, major).** New `tests/e2e/stations-returns/seed-station-fixtures.ts` (`npx tsx …`) seeds through the domain without the dev server. It is idempotent: a tag is re-created only when no packable order of that tag is left. The ledger reconciles (`npm run db:verify`: OK). Seeded in MLT1:
  - **SO010923**: in tote LP **KSC-00007** at PACK-01;
  - **SO010924**: in location stock at PACK-02;
  - **SO010926**: in an **MC-01** cell (picked to PACK-03);
  - **SO010925**: at PACK-04 (order mode);
  - **HOSP-01** (Storage · Shelves · Prevent Allocation), holding **SO010927** with Pack Short **Open** after a real `reportIssue`.
  - Checked in-process against the live DB (`%TEMP%\claude\kitstak-critic\stations-returns\r4\probe.ts`):
    - `resolveScan` finds tote KSC-00007, location PACK-02, putwall MC-01 and order SO010925;
    - SO010927 is refused ("has an open pack short issue");
    - `hospitalOptions` returns only HOSP-01, and `listHospitals` shows 3 units held for SO010927:Open with 0 free.
  - `station-fixtures.cjs` (the headless pack walk) now calls the seed and packs those orders in tote, location and putwall modes.

**Tests:** `npx vitest run tests/unit/stations-returns` passes: 14 files, 109 tests.
- New file `round4-parity.test.ts` (9 tests): designation and defaults, no Returns-bin hospital, refusal of a Report Issue to a non-hospital, a held pack-short shown on the hospital page, move-back change log, the damaged-to-Picking guard, targets, per-RMA cost with and without the columns, and multi-tracking search, filters and lookup.
- Updated: `blind-r1`, `blind-r1-flow`, `packing` and `parity-r2` use a HOSP-01 hospital (new `hospital-fixture.ts`) instead of RET-01.
- `npx tsc --noEmit`: no errors in M04 paths. eslint is clean on the changed files.

**Not verified / open**
- **Live walk blocked:** the shared dev server (PID 47592, 5.6 GB) was wedged. Its :3000 listen sockets were in FIN_WAIT_1, and `/api/health` timed out at 30 s and at 60 s. The instructions say not to restart it (R4-5). No browser screenshots this round. Once the server is up, run `node tests/e2e/stations-returns/station-fixtures.cjs <outDir>` for the tote, location and putwall pack walk.
- **Shared-code requests:** R4-2 (wizard Next title/aria), R4-3 (grid-prefs timeout) and R4-4 (hospital toggle/hint in Locations, HOSP-01 in `db:fixtures`).
- **Not addressed this round:**
  - Shipped/Cancelled "Last 7 days" chip (orders-outbound).
  - Loop Returns channel RMAs (automation-integrations, BJ2-2).
  - Re-verifying the Line Status / Actual Return Quantity filters live. They are in source: `RETURN_GRID_FIELDS` has `lineStatus` (enum) and `returnedQty`, labelled "Actual Return Quantity".

## Round 5 (blind-judge repair 3) — 2026-11-10 (builder)

**Audit of judge gaps against source**
- Already in source: the job card (job type chip, "# of Orders in Tote x/y"), the paired lb + oz weight inputs, pre-generated label upload, and the Image / Attributes / Label columns in the contents grid (`pack-screen.tsx`, `pack-packages.tsx`). The judge most likely missed them because the routes never rendered.
- Added the explicit "No pre-generated label uploaded" state in the live and preview carrier cards (`data-testid="pack-no-pregen-label"`).

**Blocked: reliability / live walk**
- The shared dev server (PID 47592) is wedged again at about 11.7 GB WS. `/api/health` times out at 60 s. Unauthenticated page requests take 12-17 s just to send the 307. `station-fixtures.cjs` timed out at 420 s on `/packing-station`.
- Instructions forbid killing or restarting it. This is server-wide, not specific to M04 routes. It needs an orchestrator restart (R4-5 still open).
- Not captured: the tote / location / putwall pack walk, return flows and the LP-target return walk. Rerun with `node tests/e2e/stations-returns/station-fixtures.cjs <outDir>` after the restart.

**Not addressed (blocked on other owners)**
- Line-level 25-column Return Orders grid: blocked on the BJ2-3 schema columns (foundation).
- Create RMA in the Shipped toolbar: BJ2-1 (orders-outbound).
- Per-station KPIs and Packing Warning Type prompts: these need schema for a station id on pack events and for warning-type media, so they were not started this round.

**Checks:** `npx vitest run tests/unit/stations-returns`: 109 passed. `tsc`: no errors in packing paths.

## Round 5 (parity loop) — 2026-11-10 (builder)

**Fixed (critic round 4, score 6.3)**
- **Live, verifiable server (blocker).** The shared `next dev` on :3000 is still wedged (R5-4). M04 was verified on a production build (`next build` plus `next start -p 3124`, from a copy whose `.data` and `node_modules` are junctions to the repo, so it ran on the same live DB).
  - Every M04 route rendered its h1 in 0.35–0.49 s: `/packing-station`, `/packing-station/hospitals`, `/return-station`, `/orders/returns` and `/orders/returns/new`.
  - APIs answered in 4–11 ms: health, the returns grid, packing KPIs, return KPIs and hospitals.
  - Walk script: `%TEMP%\claude\kitstak-critic\stations-returns\r5\walk.cjs`. Result: **26/26 checks passed, with 0 console errors and 0 page errors**. Screenshots are in the same folder.
- **Return Process enforced against what actually shipped (major).**
  - New `returns-shipped.ts` `shippedAttributes()` reads lots, expiry dates, production dates, pack types and serials from the ledger: Shipment transactions (or Packing / Picking / Loading before shipping) and the serial ledger. `order_lines.lot_number` is no longer the source.
  - `returnRuleErrors()` now enforces all eight switches:
    - Lot, expiry and production date are **required** for a tracked SKU while the match rule is on and the order shipped that attribute.
    - Each value must be one that shipped. Dates are compared on the date part.
    - Scanned serials must have shipped on the order.
    - The pack type received (default: the RMA line's) must have shipped.
    - Each violation is keyed on its own field (`items.<i>.lotNumber`, `.serials`, `.packType`, and so on).
  - The receive schema takes `productionDate` and `packType`; the production date is posted to the ledger.
  - **Station UI:**
    - Each tracked SKU gets a tracking-capture row: lot (with the shipped lots as choices), expiry date, production date, and serial scan chips with an n / qty count.
    - A single shipped lot or date is prefilled.
    - The rows are marked required according to the live rules. Client validation mirrors the server.
    - Server field errors are mapped back onto the failing row (`mapServerItemErrors`).
  - The RMA detail lines carry `trackLot`, `trackExpiry`, `trackProductionDate`, `trackSerial` and `shipped`.
  - Proven live:
    - `LOT-NEVER-SHIPPED` is refused, and a blank lot gives "Enter the lot number … (Return Process: Lot / batch number match)" (expiry is enforced the same way).
    - The shipped lot, in lower case, is accepted (201).
    - Pack type and serial checks are proven in unit tests.
- **Guarded short close (major).**
  - Complete (button or F9) with units outstanding opens a ConfirmDialog: "Close RMA… as short? 2 units not received will be closed as short". It lists the short lines, takes an optional reason, and offers "Keep receiving" or "Close as short".
  - The server refuses a short Complete without `shortClose: true` (field `shortClose`). One stray F9 can no longer close an RMA.
  - Each short-closed line logs `Short Closed Qty 0 --> N`, and a "Short closed … (reason)" line is added to the RMA note.
  - **Reopen:**
    - `POST /api/returns/[id]/reopen` (Change Status permission, reason required).
    - Returns the RMA to Started and its open lines to Started (or Pending when nothing was received). The change log reverses the short-closed quantity.
    - Refuses an RMA that was fully received, and any RMA that is not Completed.
  - The RMA detail shows a "Closed short: N units not received" callout with a "Reopen to receive the rest" button, plus a header Reopen action.
  - Proven live: F9 opens the dialog → Keep receiving leaves the RMA open → confirmed with a reason → Completed, short 2 → reopen without a reason is blocked → with a reason, Started.
- **Packing Warnings on the pack screen (major).**
  - New `packing-warnings.ts`: `packContext().packingWarning` comes from the order's `packing_warning_type_id`. It carries text, trigger, skip-confirmation and http(s) media links (other links are dropped). Inactive types are hidden.
  - New `PackingWarningDialog` opens at the configured trigger: order displayed, first product scan (the scan is applied after acknowledgement), or Close pack (F2, and also on Complete, because Complete closes the box).
  - **When confirmation is required:**
    - Escape and outside clicks do not dismiss it.
    - "Acknowledge and continue" stays disabled until "I have read this warning" is ticked.
    - `POST /api/packing/warning-ack` writes "Packing warning "X" is acknowledged by the packer (trigger at station)" to the order's change log.
  - With skip-confirmation set, the dialog is informational with an OK button.
  - A persistent warning callout sits in the order card (shown or acknowledged state). Image and video media render inline, other links open in a new tab.
  - Proven live on SO010925 / PACK-04.
- **RMA photos and documents (major).** The RMA detail has a new "Photos & documents" tab (`rma-photos.tsx`):
  - a gallery grouped **per line** (station photos are now named `<SKU> · <file>`), with General for the rest;
  - lightbox view (image or PDF) and download;
  - upload with an optional "Attach to line";
  - delete with confirmation.
  - Upload and delete need Change Status (R5-1 covers station operators).
  - The station's "photos weren't saved" toast now points to this tab.
  - Proven live: an upload lands under "Line SMT-JKT-BLK-XL".
- **Damaged never into a Picking face (minor).** `damagedTargetError()` reuses `moveBackBlockReason`. Return With RMA and Return Manually both refuse Damaged into a Picking-area target (an LP target is judged by its location), with a field error on the item's disposition. Storage, Returns and the station are allowed, and Restock into Picking stays allowed. Proven live: 400 "Damaged units can't be received into Picking location A-01-01-1…".
- **Return Orders actions while permissions load (minor).** Header actions (Bulk update return info, Return station, Create RMA) and toolbar actions (Label, Change status, Tag) render straight away, disabled, with "Checking your permissions…". They become live once `/api/me` hydrates, so the layout no longer shifts.
- **Return Station header and loading (minor).**
  - "Return orders" is now a secondary PageHeader button.
  - The user card shows a skeleton until `/api/me` loads ("Loading stations…" while stations load), and the KPI tiles show skeletons instead of em dashes.
- **Per-RMA cost columns (minor):** still blocked on the foundation migration (R5-3). The M04 code is ready.

**Tests:** `npx vitest run tests/unit/stations-returns`: 15 files, 124 tests, all passing.
- New file `round5-parity.test.ts` (15 tests) covers:
  - the lot from the ledger versus the order line, required and unknown lot, expiry and production date, the rule switched off;
  - serial and pack type match;
  - short-close refusal, confirmation, change log, reopen and refusals, and `shortfallOf`;
  - the damaged-to-Picking guard (RMA and manual);
  - the packing warning (context, acknowledgement log, stale id, inactive type, defaults, client gate, media kinds);
  - the station capture model (prefill, client lot / serial checks, payload, shortfall, server-error mapping);
  - photo grouping.
- `tests/unit/admin-settings` also passes.
- `npx tsc --noEmit`: no errors in M04 paths. The only error is in `src/components/shipment-plans/plan-form-model.ts`, which another module owns.
- eslint: no errors in M04 files. The remaining warnings are older set-state-in-effect warnings.

**Live-data side effects:** the walk created RMA000337–RMA000344 in MLT1 (test returns) and set the Fragile packing warning on fixture order SO010925.

**Open**
- R5-1 (attachment permission for station operators), R5-2 (state-machine reopen), R5-3 (per-RMA cost columns), R5-4 (dev server).
- The Packing Warning Type seed rows have no meta, so they show the instruction fallback "This order is marked "X". Pack it accordingly." Admin Settings (M14) edits text, trigger and media.

## Round 6 (parity loop) — 2026-11-10 (builder)

**Fixed (critic round 5, score 7.6)**
- **Count-plan locks surface before packing (major).** The new `src/server/repositories/packing-locks.ts` has `locationLock`, `packSourceLocations`, `packLock` and `packLockMessage`. It checks the station first, then every location that holds the order's picked stock.
  - `packContext(db, scope, orderId, stationId)` returns `countLock` (plan code, plan id, location, and copy that tells a station lock from a stock lock).
  - `GET/POST /api/packing/orders/[id]?stationId=` returns the lock. POST does **not** start packing (Packing Started) when the order is locked.
  - `resolveScan` (with `stationId`) adds `countLock` to each order, and unlocked orders are opened first.
  - `readyToPackOrders` (List & Select) adds `countLock` to each row. The KPI path skips this with `{ locks: false }`.
  - `completePacking` refuses up front with INVALID_STATE and the same copy. The ledger stays the backstop.
  - **Pack screen:**
    - A red "Locked by count plan CNT…" callout on the order card, with "Open CNT…" (`/counts/[id]`) and "Choose another station".
    - Product scan disabled, Close pack disabled, and F9 blocked with the reason.
    - A lock pill on job-card order rows.
  - **List & Select:** a "Locked by CNT…" pill on the row and a footer count. Start, double-click and Enter are refused, and the disabled Start shows the reason, with a callout for the selected row.
  - **Packing dashboard:** a locked station shows "Locked by CNT…" and is disabled in the picker. A remembered locked station is skipped (with a note), and Start is blocked with the reason when every station is locked.
- **Return Station locks (major).**
  - `returnStations` and `returnTargets` add `countLockPlan` and `lockReason`, judging an LP by its location. Unlocked stations sort first.
  - The station picker and the target picker show "Locked by CNT…" and are disabled. `pickStation()` never defaults to a locked station while an unlocked one exists. Start shows the lock reason when only locked stations exist.
  - **Server:** `placementLockErrors()` refuses receive (RMA and manual) before any ledger write, using field errors `stationLocationId` and `targetLocationId`/`targetLpId`. It is precise: the station is checked only when an item is received at the station (Quarantine or Dispose) or the target defaults to the station. Restock into an unlocked storage target is allowed.
- **Hospital page warehouse default (major).**
  - New `GET /api/packing/hospitals/warehouses` returns, per in-scope warehouse, its hospitals and units.
  - `pickHospitalWarehouse()` uses the same order as the dashboards (URL `?warehouseId`, remembered packing, remembered returns, header context, user default). A warehouse with hospitals wins, and the one with the most units is the fallback.
  - The empty state no longer says "not configured" when another warehouse has hospitals. It reads "No hospital location in KS2 … exist in MLT1 (1, 3 units)" with "Show MLT1" buttons.
- **Stale completion error (minor).** `staleRate()` also clears the completion error. Every scan, package edit, carrier or service change, Close pack and capture edit therefore clears it.
- **Label menu disabled styling (minor).** A disabled item is muted (`opacity-60`, faint icon), shows its reason inline as the description, and is not red when disabled.
- **Edit return info (minor).**
  - The cost field no longer clamps at 0. -5 shows "Cost can't be negative" inline and the save is blocked (shared `returnCostError()`, also used in Create RMA).
  - The return shipping cost now writes a change-log row on the **RMA** as well when it is stored on the shipment order.
  - A tracking number typed but not added is added on blur, so a duplicate says "X is already added" instead of vanishing.
- **Receive audit (minor).** `rollup()` takes the RMA status from before the receive. One-go receives log `Pending --> Completed`, and Save progress logs `Pending --> Started` (the ledger's silent Started move is now in the trail).
- **Breadcrumbs (minor).** Return Orders, RMA detail and Create RMA read "Fulfillment › Outbound › …", matching the nav highlight and the tab strip. Return Station reads "Inventory › Inbound › Return Station", matching its nav entry. Hospitals reads "Fulfillment › Outbound › Packing Station › Hospital locations". Request R6-4 asks for one home in `nav-config`.
- **Move back reason (minor).** A disabled Move back shows a visible reason with a link, for example "Held for SO010927 (pack short). Resolve it first." The tooltip and aria-label carry the full text (`moveBackDisabledReason()`).
- **Dark mode (minor).** The Return Orders status pills use CSS-variable tones with a translucent tinted fill in dark mode, and the "All lines" pill no longer glares. Grid status badges use `DARK_SAFE_PILL` until the shared StatusPill is theme-aware (R6-2).
- **Receipts link (minor).** "Receipt 70173" links to `/receiving/history?f.masterId=eq:70173`.
- **Validation copy (minor).** `requiredId()` gives human messages on receive and manual receive: "Choose a return station", "Choose a client", "Choose a receiving warehouse", "Scan or choose an RMA", "Choose a product" and the disposition. Move back gets "Choose the hospital stock to move", "Enter a quantity" and "Choose a location".
- **Shipped without a label (minor, cross-module).** Request R6-1 asks shipping to refuse Ship. On the M04 side, the Create RMA picker flags orders whose outbound labels were all voided.

**Parity additions (missingVsLogiwa)**
- **Add package.** A new "Add package" button opens an empty box (`addBox`). It is disabled with a reason when the client disallows multiple packages, at 50 boxes, or when the order is locked.
- **Expected returns.** A new card on the Return Station (`expected-returns.tsx`, `GET /api/returns/open`) lists the warehouse's open RMAs: Started first, then In Transit, then Pending, by due date. Each row has a status pill, customer, order, client, received / requested, due date and a one-click **Receive** that opens Return with RMA prefilled. "View all" is filtered.
- **Row kebab.** The Return Orders row kebab adds **Receive at station** (disabled with a reason when the RMA is closed) and **Create / Reprint return label** (with reasons) next to Show details, Change status and Change log.

**Tests:** new `tests/unit/stations-returns/round6-parity.test.ts`, 14 tests. It covers:
- pack-context, scan and List & Select locks, and the KPI skip;
- station-lock copy and the station list;
- return station and target lock marking;
- receive refused at a locked station with no receipts written, Restock into an unlocked target allowed, and a locked target refused on its own field;
- the Pending --> Completed and Pending --> Started audit rows;
- the RMA cost change log and open RMAs;
- the human validation copy and `returnCostError`;
- `pickStation`, `pickHospitalWarehouse`, `hospitalWarehouses` and `moveBackDisabledReason`.

`npx vitest run tests/unit/stations-returns`: 16 files, 138 tests, all passing. `npx tsc --noEmit`: no errors in M04 paths. The only errors are in `tests/unit/inbound-receiving/putaway-worklist.test.ts`, which another module owns.

**Open:** R5-1, R5-2 and R5-3 (per-RMA cost columns, which still blocks multi-RMA cost), plus R6-1 to R6-5. BJ2-2 (returns-platform channel) is still with automation-integrations.

## Blind-judge repair round 1 (2026-11-10, builder)
Every gap from the blind side-by-side judge is closed. Verified with headless Playwright walks (scripts and screenshots in `%TEMP%\claude\kitstak-critic\stations-returns\bj1\`), direct API calls, unit tests and tsc.

**Fixed**
- **Hospital and scan-mode fixtures are in the standard dataset.** `src/server/repositories/packing-fixtures.ts` (`seedStationFixtures`) runs inside `db:fixtures` / `db:reset` (one hook line in `acceptance-fixtures.ts`). It is idempotent, each fixture runs in its own savepoint, and every stock move goes through the domain (`db:verify` OK). In MLT1 it creates:
  - HOSP-01 in a new **"Hospital" location group** (Storage, Shelves, Prevent Allocation);
  - a tote LP at PACK-01 (`SO010877` in `PC-00010`), PACK-02 location stock (`SO010878`, carrying the "Fragile - Bubble Wrap Required" packing warning), an MC-01 cell (`SO010880`) and a PACK-04 order;
  - a pack-short order held in HOSP-01 through Report Issue (`SO010881`).
  - Live: `/packing-station/hospitals` lists HOSP-01 (3 units, 1 pack-short order); Other actions › Report issue reads "Move the picked stock to hospital HOSP-01"; Scan a tote / location / putwall each load their order. `tests/e2e/stations-returns/seed-station-fixtures.ts` now just calls the same function.
- **Pack progress is saved on the server per order.** New `pack_drafts` table, created on first use (`packing-drafts.ts`). `PUT/DELETE /api/packing/orders/[id]/draft` (Execute Task). The draft holds the boxes, the active package, captures, the carrier choice and the last quote. The pack context returns `draft` when it still fits the order; Complete and Report Issue clear it.
  - The screen saves 400 ms after each change ("Progress saved…"), and on reopen shows "Resumed: N units already scanned · saved … by …" with **Start over**.
  - Live: SO010879 reopened after a reload at 3/3 with both packages and the quote; the over-pack save gives 400; viewer gets 403.
- **The quote survives Close pack (F2).** A quote is kept with a signature of the rated packages plus the service (`rateSignature`). Closing does not change the signature; changing size, weight, units or service makes the quote stale. If a stale quote existed, F2 re-rates automatically. Live: Get rate $43.74 → F2 → still "Buy label ($43.74) and complete".
- **Rate shopping on the pack screen.** The new `RateShopCard` sends "Compare rates" to every carrier account the client may use. It shows a sorted table with Cheapest and Fastest badges, one-click **Cheapest** / **Fastest** buttons and **Use** on any row, and lists accounts that returned no quote. Picking a row selects that account and service and keeps its quote. Live: cheapest USPS Ground Advantage $13.20, fastest UPS Next Day Air; picking fastest led to "Buy label ($80.14)", and F9 packed it.
- **One home for returns:** Return Station moved to **Fulfillment › Outbound** next to Return Orders and Packing Station. This is a shared `nav-config.ts` change; the nav-config test counts were updated (Outbound 7, Inbound 3). All M04 breadcrumbs now read Fulfillment › Outbound.
- **Viewer copy on Return Station:** "You need the Return Station › Receive Return permission to receive returns", matching the `inventory.return_station.receive_return` gate.
- **Packing dashboard KPIs:**
  - new **Pack-short orders held** (links to Hospital locations, with hospital units in the tooltip) and **Orders with packing warnings** tiles;
  - a per-station card ("Station PACK-01 today": orders, units, packers) from `/api/packing/kpis?stationId=`.
- **Create RMA on Shipped & Canceled (BJ2-1):** already a direct toolbar button (M01). Verified live: it is present and disabled with no selection.
- **Returns-platform hook (BJ2-2):** `POST /api/returns/import` (Create RMA permission) takes one or more Loop-style returns: `externalId`, order code / store # / client reference, SKU lines with a reason name, tracking and carrier.
  - It creates Pending RMAs with Source "Loop Returns" through `insertRma` (which now takes `opts.source`).
  - It is idempotent per platform + return id (`duplicate: true`), and each return succeeds or fails on its own.
  - Return Orders has an **Import from Loop** dialog that calls the same endpoint.
  - Live: RMA000324 was created from LR-568500; the repeat came back as a duplicate, a bad SKU reported "NOPE is not on SO010842", and viewer got 403.
- **Mobile header (390 px):** `PageHeader` now stacks the title above the actions on phones (shared fix already landed). Verified on /packing-station, /return-station and /orders/returns: helper text full width, no horizontal scroll.

**Checks**
- `vitest tests/unit/stations-returns`: 17 files, 148 tests, all passing. The new file is `blind-judge-r1.test.ts` (10 tests).
- `foundation-f3` and `foundation-f4c`: passing.
- `tsc --noEmit`: clean for every changed path.
- eslint: 0 errors on the changed files.
- `npm run db:fixtures` then `db:verify`: OK.

**Shared files touched (minimal):**
- `src/config/nav-config.ts`: Return Station item moved.
- `tests/unit/foundation-f4c/nav-config.test.ts`: column counts.
- `src/server/db/seed/acceptance-fixtures.ts`: calls `seedStationFixtures`.

**Note:** during the final walk, the dev server returned 500 on every route because of a syntax error in `src/components/work-orders/work-order-detail-page.tsx`, which M08 owns. That is not an M04 defect.
