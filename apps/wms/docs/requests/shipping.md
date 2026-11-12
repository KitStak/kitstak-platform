# M02 shipping — shared-change requests

## REQ-1 — Maintain EOD manifests at label time
- **File:** `src/server/domain/shipping/labels.ts` (`insertShipments` / `voidLabel`), `src/server/domain/shipping/ship.ts`.
- **Change:** when a Shipping Label is created, attach it to the Open `end_of_day_manifests` row for
  `(warehouse_id, carrier_connection_id, warehouse-local label date)`, creating it if missing, and keep
  `total_packages` in sync on create and void. Export `shipping.ensureOpenManifest(tx, ctx, { warehouseId, carrierConnectionId, shipDate })`.
- **Reason:** spec M02 §2 says "Manifests are maintained automatically as labels are created and voided".
  Today only `shipOrders` links labels, so M02 derives "pending" manifests live and writes the link at close
  through `src/server/repositories/end-of-day-adapter.ts` (interim; it already prefers `shipping.ensureOpenManifest` when exported).
- **Status:** applied (F-patch 2026-11-06): `shipping.ensureOpenManifest(tx, ctx, { warehouseId, carrierConnectionId, shipDate, carrierCode? })` exported. Shipping labels join the Open manifest of their warehouse-local label date when created (`attachLabelsToManifest`, `totalPackages` +n) and leave it on void while it is Open (`detachVoidedFromManifest`, -n). `shipOrders` only links labels that have no manifest yet. The adapter in `end-of-day-adapter.ts` now delegates automatically.

## REQ-2 — Allow a second manifest for the same carrier/day after close
- **File:** `src/server/db/schema/shipping.ts` (`end_of_day_manifests`, index `eod_unique_idx`) + migration.
- **Change:** add `sequence integer not null default 1` and make the unique index
  `(warehouse_id, carrier_connection_id, ship_date, sequence)` (or make it a partial unique index `WHERE status = 'Open'`).
- **Reason:** acceptance "A label created afterwards opens a new Open manifest". The new label already shows as an
  Open (pending) row, but closing it hits the unique index; the adapter returns a clear INVALID_STATE message until this lands.
- **Status:** applied (F-patch 2026-11-06): `end_of_day_manifests.sequence integer not null default 1`, unique index `(warehouse_id, carrier_connection_id, ship_date, sequence)` (migration `0001`, applied live). After close, the next label opens `sequence + 1`; foundation test updated.

## REQ-3 — Shared OrderPickerDrawer crashes on render
- **File:** `src/components/shared/order-picker-drawer.tsx` and/or `src/server/repositories/platform-pickers.ts` (named picker `orders`).
- **Change:** the drawer reads `row.status`, `code`, `customerName`, `quantity`… but `/api/pickers/orders` returns
  `{ id, label, sublabel, meta: { status, … } }`, so `StatusPill` receives `undefined` and the page error boundary trips
  ("Cannot read properties of undefined (reading 'trim')"). Either return grid rows (`code`, `status`, `customerName`, `clientName`,
  `quantity`, `lineCount`, `orderDate`, `shipBy`, `storeOrderCode`) when the drawer calls it, or map `label/meta` in the drawer.
  Also `useLocalGrid({ gridKey: "picker:orders" })` triggers `GET /api/saved-views?gridKey=picker%3Aorders` → 400; the
  saved-views key validation should accept it or the local grid should skip saved views.
- **Reason:** shipment plans need Add order(s). M02 uses a local adapter (`src/components/shipment-plans/plan-order-picker.tsx`
  on `/api/shipment-plans/eligible-orders`) until this is fixed. M04 has its own shipped-order picker for the same reason.
- **Status:** applied (F-patch 2026-11-06): new grid endpoint `GET /api/pickers/orders/grid` (`src/server/repositories/platform-order-picker.ts`: grid grammar + `clientId`, `warehouseId`, `status`; scoped; returns `OrderPick` rows). `OrderPickerDrawer` uses it; `status` defaults to "" and `statusToneName` / `statusTone` / `isPartialStatus` tolerate a missing status; saved-views `gridKeySchema` accepts `:` so `picker:orders` no longer 400s.

## REQ-4 — Esc is swallowed by a closed combobox inside a drawer
- **File:** the shared combobox used by `CustomerPicker` / `WarehouseSelect` (`src/components/shared/**` / `src/components/ui/**`).
- **Change:** only stop propagation of `Escape` while the listbox is open; when it is closed let it reach the Radix dialog so the
  drawer's close / unsaved-changes guard runs.
- **Reason:** A0.5 "Esc closes". With focus in the Customer field of the Create shipment plan drawer, Esc does nothing.
- **Status:** DONE (pass 1): verified headless on /shipment-plans → Create shipment plan, no change needed: Tab-focus a closed Client combobox + one Esc closes the drawer; with the list open the first Esc closes the list and the second closes the drawer (standard listbox layering). Earlier note: needs-info (F-patch 2026-11-06): the shared `Combobox` never stops Escape propagation; it only closes its own list when open, and Radix closes one layer per Esc (an open list first, then the drawer). Clicking the field opens the list, so the first Esc closes the list and the second closes the drawer. If a single Esc on a closed list does nothing, add the exact repro (component, steps) and it will be fixed.

## REQ-5 — Seed license plates on shipment-plan orders
- **File:** `src/server/db/seed/**` (shipment plans SP000041–SP000044).
- **Change:** allocate / ship a few of the seeded plan orders from license plates (LPN + parent LP) so `/shipment-plans/lps` and the plan
  detail "License plates" card show believable data.
- **Reason:** the Plan LPs grid is correct but empty on the demo data ("No license plates on shipment plans yet").
- **Status:** DONE (pass 1): `npm run db:fixtures` (idempotent, ledger/domain only, db:verify green) now creates pallet LP > carton LP holding 12 × MLT-LP-01 at MLT1-C-01, order KS-FIXTURE-PLAN-LP (SO010846 on the dev DB) allocated from that LP, and In Progress plan SP000041 at LOAD-01; `/api/shipment-plans/lps` returns the row (LP PC-00009, parent PLT0000051). The dev DB had no shipment plans at all, so this is also the first plan there. Earlier note: deferred (F-patch 2026-11-06): believable plan LPs need the seed replay to put stock on LPs before picking (`seed/history.ts` + `outbound.ts`). Retrofitting LP moves onto the live DB means re-running pick/pack for shipped orders, which the ledger would not reconcile. It will land with the next seed regeneration. Meanwhile any plan order allocated from LP stock shows up in `/shipment-plans/lps`.
- **Foundation pass 1 (2026-11-09):** REQ-1/2/3 DONE (pass 1, verified). REQ-4 DONE (pass 1, verified, no change needed). REQ-5 DONE (pass 1) via `npm run db:fixtures` (see its status above).

## Foundation notes (pass 1) — for M02
- `shipping.detachVoidedFromManifest` now deletes an Open manifest once every label on it is voided (End Of The Day never lists empty manifests); `tests/unit/shipping/shipping-flow.test.ts` "drops a pending manifest once every label in it is voided" passes again.
- Still failing in M02's own test: `shipping-flow.test.ts:60` expects `isPending: true`, but since REQ-1 labels join a real Open manifest row, so the EOD row is `isPending: false`. Update the expectation (foundation did not edit M02's test).
- **Foundation pass 2 (2026-11-09):** REQ-5 DONE (pass 2): `npm run db:fixtures` seeds order `KS-FIXTURE-PLAN-LP` (6 × MLT-LP-01) allocated from LP stock on an In Progress shipment plan (`src/server/db/seed/acceptance-fixtures.ts`); present in the live DB. REQ-4 still needs-info (shared Combobox only intercepts Esc while its list is open; Radix closes one layer per Esc). Note for M03: `tests/unit/shipping/shipping-flow.test.ts:60` still expects `isPending: true` on the EOD row, which predates REQ-1 (a real Open manifest now exists at label time, so `isPending` is false); please update the test.
- **Foundation pass 2 (2026-11-09):** all REQs DONE (pass 2, re-verified). Still for M02: `shipping-flow.test.ts:60` `isPending` expectation (see above).

## Round 2 requests
- REQ-6 (foundation, src/server/auth/permission-catalog.ts): the viewer rule only grants `action === "view"`,
  so read permissions like `fulfillment.shipment_plan.view_plan_orders` / `view_plan_lps` are never granted
  to viewers. Grant every read action (`view` and `view_*`) to viewer for VIEWER_GROUPS, and reseed roles.
  The UI now shows a no-access state instead of erroring, but viewers should be able to read these tabs.
- REQ-7 (foundation, src/components/grid/grid-toolbar.tsx): forward an optional `bulkInline?: number` prop
  to `<BulkActions inline=...>`. End Of The Day needs 3 inline buttons (Print Custom Report, Print End Of
  The Day Report, Reprint) to match Logiwa; today Reprint collapses into "Actions".
- REQ-8 (foundation, src/lib/format): `formatDate` renders "11/5/2026" while `kind: "datetime"` cells render
  "11/05/2026 9:15 AM" in the same grid (EOD Ship date vs Close date). Use one convention; Logiwa uses
  M/D/YYYY h:mm:ss AM.

## Round 2 requests
### R2-1 — Date filters resolve in UTC, not the user's / warehouse's time zone
- **File:** src/server/query/grid-query.ts (+ src/lib/api-client.ts / useGrid), consumers call compileFilters(defs, filters, { tzOffsetMinutes }).
- **Change:** carry the browser's time-zone offset (e.g. 	z=<minutes> grid param or an x-tz-offset header) into GridQuery
  so esolveDateRange cuts "Today", "Last 30 days" and custom days at local midnight. Expose it on the parsed query
  (query.tzOffsetMinutes) and M02's shipping-grid.ts will pass it straight to compileFilters.
- **Reason:** a label created 9 pm Central on Nov 9 is 2026-11-10T02:44Z; "Label create date: Nov 9" misses it today.
  M02 worked around it for the EOD → Carrier Shipment Details drill-down with a warehouse-local manifestShipDate field,
  but every other date chip in the app has the same off-by-one-evening problem.

### R2-2 — Disabled destructive bulk button looks enabled
- **File:** src/components/grid/** (GridToolbar bulk buttons, ariant="danger" + disabled).
- **Change:** a disabled destructive bulk action should use the neutral disabled style (outline, muted text), not a
  60%-opacity solid red fill.
- **Reason:** on /shipments and /shipment-plans, "Void labels" / "Delete" read as clickable with nothing selected
  (Logiwa greys every bulk menu until a row is selected).

### R2-3 — Two-word filter chip labels wrap
- **File:** filter chip in src/components/grid/filter-builder/**.
- **Change:** whitespace-nowrap (truncate with title) on the chip's field label.
- **Reason:** "CARRIER ACCOUNT" wraps onto two lines and pushes the value under the chip border on /shipments.

## Round 2 requests

### R2-4 — Grid header text is ~12 px right of the cell text (every grid)
- **File:** src/components/grid/** (DataGrid header cell padding vs body cell padding).
- **Change:** use the same horizontal padding for `th` and `td` (the header seems to add the sort-icon gutter on the left).
- **Reason:** measured on /shipments/history (ORDER CODE header x≈89, cell x≈77) and /shipments/end-of-day (PREFIX 97 vs 86).
  Round-2 critic defect. M02 removed `selectable={false}` on history so the checkbox column is now present, but the
  remaining offset is in the shared grid.

### R2-5 — Destructive bulk buttons: neutral disabled style in BulkActions (supersedes R2-2)
- **File:** src/components/grid/bulk-actions.tsx line ~45.
- **Change:** `variant={action.destructive && !reason ? "danger" : "secondary"}`.
- **Reason:** M02 works around it by passing `destructive: selectedIds.length > 0`, but every other module has the same
  salmon block on an idle toolbar.

### R2-6 — Role matrix: shipment plan create for Warehouse Clerk (operator)
- **File:** role seed / permission matrix (M14 / foundation `seed-data.ts`).
- **Change:** confirm whether `fulfillment.shipment_plans.create|edit|delete` belong to Warehouse Clerk. BUILD_PLAN says
  operator = "execution plus view"; planning a truck is a supervisor task, so M02 suggests granting only `ship` and
  `view_*` to operator. M02 already hides every control whose permission is missing, so no UI change is needed.
- **Status:** DONE (foundation round 2, 2026-11-10): see R3-1.

### R2-7 — Dev-server latency is not query cost
- **Info, no change requested from M02's side.** Measured round 2: the same EOD / shipments / history SQL runs in
  0–24 ms directly against .data/kitstak.db (450 shipments, 34 manifests), and warm API calls return in ~300 ms (same as
  /api/me). The 8–40 s timings come from first-hit route compilation and the shared dev server being busy (/api/me
  also took 18 s in the same run). A production build (`next build && next start`) should be used for latency checks.

## Round 2 requests

### R3-1: Operator role still holds void, EOD close and plan create (critic major, repeats R2-6)
- **File:** src/server/auth/permission-catalog.ts, `OPERATOR_DENIED_ACTIONS` (about line 97). Reseed roles afterwards.
- **Change:** add these actions to the operator deny set: `void_label`, `print_end_of_the_day_report`, `create`
  (scoped to `fulfillment.shipment_plan.*` if a global `create` deny is too broad), `edit` for shipment_plan,
  and `ship_order` for shipment_plan. A per-key deny list is the cleanest way to do it, for example
  `OPERATOR_DENIED_KEYS = new Set(["fulfillment.shipment_orders.void_label", "fulfillment.end_of_day.print_end_of_the_day_report", "fulfillment.shipment_plan.create", "fulfillment.shipment_plan.edit", "fulfillment.shipment_plan.ship_order", "fulfillment.shipment_plan.change_status"])`.
- **Reason:** Logiwa gives Void Label and End Of The Day close to supervisors only. M02's routes and UI already
  check exactly these keys (`/api/shipments/void`, `/api/shipments/[id]/void`, `/api/end-of-day/close`,
  `/api/shipment-plans` POST, `/api/shipment-plans/[id]/ship`), so no module change is needed once the seed drops them.
- **Status:** DONE (foundation round 2, 2026-11-10): operator default now excludes void_label, EOD close, shipment_plan create/edit/ship_order/change_status; DB roles re-synced.

### R3-2: Block a second active label for the same package (relabel without void)
- **Files:** label creation in src/server/repositories/{orders-labels,jobs-labels,packing,packing-scan}.ts and the
  foundation shipping domain's createLabel.
- **Change:** before creating a Shipping Label, reject (or require `voidExisting: true`) when the order already has an
  Active Shipping Label for the same `package_seq`. The message should read "Void the existing label first".
- **Reason:** SO010849 had four active labels. M02 now flags these rows as "Duplicate" on /shipments
  (`duplicateActiveLabels`), but only the label creators can prevent them.

### R3-3: Grid header and cell padding (R2-4 still open)
- **File:** src/components/grid/** header cell. Use the same `px` for `th` and `td`, and align right-aligned
  headers right. The critic measured the offset again on /shipment-plans, /shipments/history and /shipments.

## Round 2 requests (round 4 additions, 2026-11-09)
- **R4-1 (shared grid, src/components/grid/grid-footer.tsx + data-grid.tsx):** add a `loading` prop to GridFooter and
  pass DataGrid's loading state through. While the first page is loading, show "Total: Loading…" instead of
  `fmt.number(0)`. Affects EOD, history, plans and every other grid.
   - **Status:** DONE (foundation round 2, 2026-11-10): GridFooter `loading` prop (see work-orders-kitting R2-3).
- **R4-2 (foundation role seed / permission matrix):** grant `fulfillment.shipment_orders.void_label` and
  `fulfillment.end_of_day.print_end_of_the_day_report` (EOD close) to the operator/lead role by default, or ship an
  editable "Shipping lead" role that has them. The shipping routes are already permission-keyed.
- **R4-3 (shared ActivityTimeline, src/components/shared/activity-timeline.tsx):** format timestamps with the
  org datetime format (no seconds, zero-padded day: `MM/DD/YYYY h:mm A`), the same format as `formatGridDateTime`. Today
  the timeline shows "11/9/2026 8:21:52 PM" next to grid values like "11/09/2026 8:21 PM" (REQ-8).
- **R4-4 (packing module):** pack-screen.tsx imports `PackPreview`, which pack-packages.tsx does not export. The build error
  replaces every page, including the shipping routes.

## Round 2 requests (round 5 additions, 2026-11-09)

- **R5-1 Change-log date values (shared `components/shared/activity-timeline.tsx` + `change-log-drawer.tsx`).**
  Values stored as ISO strings (for example `2026-11-10T04:50:27.680Z` for `loadingStartedAt`) render raw and in UTC.
  Please pass `fromValue`/`toValue` through `formatDateTime` when they match
  `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/`, so they read as local `MM/DD/YYYY hh:mm A`. The server can't
  do this because it doesn't know the viewer's time zone.
- **R5-2 Wizard error state (shared `components/ui/wizard/*`).** When a linear step fails validation on Next, set an
  `error` state on that step's pill (danger ring and icon, `aria-invalid`). Also scroll the first invalid control into
  view (`scrollIntoView({ block: "center" })`) inside the drawer's scroll body. The Shipment Plan drawer uses this.
- **R5-3 Active filter chips at tablet width (shared `GridToolbar`/filter chip).** At 768px a long chip
  ("LABEL CREATE DATE · Last 30 Days") is squeezed into a narrow vertical box. Chips should be `whitespace-nowrap
  shrink-0` and wrap as whole pills, or collapse into a "+N filters" count below `md`. The toolbar's bulk buttons
  should also collapse into a "More" menu instead of wrapping onto a second row.
- **R4-1 (still open) GridFooter.** The footer should show "Loading…" instead of "Total: 0" while the first page is in
  flight.

## Round 2 requests (round 6 additions, 2026-11-09)

- **R6-1 (foundation, `src/server/domain/shipping/ship.ts`):** after `shipOrders` succeeds, reconcile any active shipment
  plan that contains the shipped orders: mark `shipment_plan_orders.status = 'Shipped'` for those orders, move the plan
  Open/In Progress -> Loading Started when some (not all) of its orders are shipped, and walk it to Shipped (stamping
  loading/actual/departed times, change-log entry) when all are. Today only `shipPlan` does this, so an order shipped from
  Shipment Orders leaves its plan behind. The shipping module now shows a "Partially shipped · N of M" badge on the
  plan detail page, but the plan's stored status should follow too. The rule already lives in `shipPlan` in
  `src/server/repositories/shipment-plans.ts` and can be reused.
- **R6-2 (shared `src/components/shared/activity-timeline.tsx` / `change-log-drawer.tsx`):** still open from R5-1.
  Run ISO date-times in change-log messages through `fmt.dateTime`. The plan detail page now uses its own
  `PlanTimeline` with `localizeIsoInText` from `src/components/shipment-plans/plan-form-model.ts`, so you can lift that helper.
  The Change log drawer still shows raw ISO.
- **R6-3 (shared `GridToolbar` filter chips):** still open from R5-3. At 768px the chip label breaks one character per line
  ("LABEL CREAT DATE") and overlaps the remove icon. The chip needs `min-w-0 max-w-full`, the label needs `truncate whitespace-nowrap`
  with a `title`, and the chip row needs `flex-wrap`.
- **R6-4 (shared `StatTile`):** `sublabel` is wrapped in `truncate`, so long sublabels clip without a tooltip. Either allow
  `sublabelWrap` or add `title` when the sublabel is a string. (The shipping module now builds its own Expected load tile.)

## Round 2 requests (pass 6 additions, 2026-11-09)

- **R6-1 Column chooser gutter (shared `src/components/grid/data-grid.tsx` / `data-grid-header.tsx`).** In
  external-toolbar mode the chooser button is absolutely positioned at the header's right end (`absolute right-1 top-1`),
  so the last visible header ("SHIPPING OPTION OF TH…" on /shipment-plans/orders) runs under it. Reserve the space:
  add `pr-10` to the last header cell (and the matching body cell), or add a trailing 36 px spacer column whenever
  `hideToolbar` is set.
- **R6-2 Label mail / store-sync flags (foundation schema `schema/shipping.ts` + notification sender).** For Logiwa's
  "Delivery Mail Sent" / "Shipment Mail Sent" filters, add `shipment_mail_sent_at` and `delivery_mail_sent_at` to
  `shipments`, set by whatever sends the customer emails. M02 will add the filters and columns as soon as the columns
  exist. "Sync to store" is already derived from channel_run_items ("Send Shipment Info").
- **R6-3 BulkActions disabled style (shared `bulk-actions.tsx`, repeats R2-5).** M02 now passes
  `destructive: eligible`, but the shared component should use `variant={action.destructive && !reason ? "danger" :
  "secondary"}` so every module gets the neutral disabled style.

## Round 2 requests (round 3 parity loop additions, 2026-11-10)

- **R7-1 Location picker area-type list (shared `components/shared/entity-pickers.tsx` + `server/repositories/platform-pickers.ts`).**
  `LocationPicker areaTypes={["Loading","Shipment"]}` sends `areaType=Loading,Shipment`, and the picker schema
  (`z.enum(AREA_TYPES).optional()`) rejects it with a 400 whose raw zod text the Combobox then shows to the user. Please
  accept a comma list (`z.string().transform(split).pipe(z.array(z.enum(AREA_TYPES)))` and `inArray(t.areaType, list)`),
  and have `AsyncPicker`/`Combobox` show a generic "Couldn't load options" instead of the server message on 4xx/5xx.
  The Shipment Plan drawer now uses a module-owned `GatePicker` (one request per area type, merged), which can be
  swapped back to `LocationPicker` once this lands. Scan-to-pick on the gate field is lost until then.
- **R7-2 End-of-day manifests keyed by carrier (foundation `domain/shipping/ship.ts` `ensureOpenManifest` /
  `attachLabelsToManifest`, schema `eod_unique_idx`).** Open manifests are keyed by (warehouse, connection, day), so a
  USPS service on a UPS carrier setup lands on the UPS manifest. Please key the open manifest by
  (warehouse, connection, **carrier_code**, day). The unique index can stay as it is, because sequence is allocated per
  (warehouse, connection, day). M02 compensates today. `buildEodRows` shows one row per carrier: other carriers' labels
  on an open manifest count as pending under their own carrier, and on a closed manifest they show as a separate
  closed `split~` row. Closing a manifest moves the other carriers' labels off it first
  (`end-of-day-adapter.ts detachOtherCarriers`).
- **R7-3 Late-shipped labels (foundation `shipOrders`).** When an order ships and its active label sits on a Closed
  manifest, `shipOrders` should return a warning, or re-home the label to today's open manifest per org policy.
  M02 now warns in the Shipment Plan ship result (`closedManifestWarnings`). Shipment Orders → Ship does not warn yet.
- **R7-4 Picker date format (BUILD_PLAN 0.1 + shared `ui/date-picker.tsx`).** Pickers use `YYYY/MM/DD HH:mm` per
  convention 0.1. The critic asks for the org date format (MM/DD/YYYY) so pickers match every grid, drawer and detail page.
  This is a convention-level decision, so M02 has not overridden it locally.
- **R7-5 GridToolbar bulk overflow (shared `grid-toolbar.tsx`).** Please pass `inline` through to `BulkActions`, or
  collapse to one "Actions" menu below `lg`. At 768px the Carrier Shipment Details toolbar (Void / Reprint / Create
  return label) wraps onto a second row. Filter-chip nowrap is being fixed in the working tree (filter-chips.tsx).
- **R7-6 Export selected rows (shared `export-button.tsx`).** Logiwa exports the checked rows. M02's Plan Orders and
  Plan LPs grids now have a selection column and an "Export selected" bulk action (client-side CSV). A shared
  `ExportButton selectedIds` option would give every grid the same thing as Excel.

## Round 2 requests
- **R8-1 (foundation): customer shipment and delivery emails.** Logiwa's Carrier Shipment Details filters on
  "Shipment Mail Sent" and "Delivery Mail Sent". We need an outbound customer-notification record before these filters
  can be real. Either add `shipment_mail_sent_at` / `delivery_mail_sent_at` to `shipments`, or add a notification log
  keyed by order with kind `shipment` | `delivery`, written when the email goes out. M02 will then add two boolean filters
  and columns on `/shipments`.

## Round 2 requests (round 4 parity loop additions, 2026-11-10)
- **R9-1 Create-job modal ineligible rows (shared `components/shared/create-job-modal.tsx` line ~58).** The row shows
  `r.code ?? r.id`, but `code` is the BulkResult error code (`NOT_FOUND`, `INVALID_STATE`), so people see raw codes.
  Show the record code (add `recordCode` to the eligibility rows in `platform-ops.ts` `orderPreEligibility`, e.g. the
  order code) and only the human `reason`. Example wanted: "SO010850 · Order SO010850 is already in a job."
- **R9-2 `shipment-plan` job operation (foundation `server/repositories/platform-ops.ts`).** `orderPreEligibility` /
  `createJobsFromOrders` treat `ids` as shipment-order ids even when `operation: "shipment-plan"`, so a caller that sends
  plan ids gets "0 of 1 eligible / Shipment order not found". M02 now expands plans to order ids itself
  (`POST /api/shipment-plans/job-orders`) and sends order ids. Please either expand plan ids server-side for
  `operation: "shipment-plan"` or document that the operation expects order ids, and make `OPERATION_NOUNS["shipment-plan"]`
  read "order(s)" (the modal counts orders, not plans). Until then M02 opens the modal with `operation: "order"` when the
  user also holds `fulfillment.shipment_orders.picking_job_operations`, so the wording is right for most roles.
- **R9-3 Data repair (seed/ops owner).** Before the ship guard landed, plan KS-CRIT-C3-52202 shipped SO010845 with only
  voided UPS labels, so `npm run db:verify` reports `shipped_without_label=1`. M02 now refuses such ships (per-order
  reason, readiness chip, Ship disabled when no ready order has a label). The one existing row needs a data fix (create a
  label for SO010845, or reverse the ship); M02 does not rewrite ledger history.
- **R7-4 / R7-5 still open:** picker date format (`YYYY/MM/DD HH:mm` vs the grid's `MM/DD/YYYY`) and `GridToolbar`
  not passing `inline` to `BulkActions` (768 px wrap of Void / Reprint / Actions on `/shipments`, clipped chip ×).

## Round 2 requests (round 5 parity loop additions, 2026-11-10)
- **R10-1 Grid footer total on error (shared `components/grid/data-grid.tsx` ~line 289).** `GridFooter` gets
  `loading={loading && data.length === 0}` only, so a failed list shows "Total: 0 | Selected: 0" under the error state
  (critic r4 minor on `/shipment-plans`). Pass `loading={(loading || Boolean(error)) && data.length === 0}` (or a
  separate `unknownTotal` prop) so the footer reads "Total: —" while loading **or** in error. M02 pages can't override it.
- **R10-2 Page-size select blank before hydration (shared `components/ui/select.tsx` / `grid-footer.tsx`).** Radix
  `Select.Value` renders the selected item's text only after the client mounts, so the footer select is an empty box
  until hydration finishes (most visible on slow first loads). Render the selected option's label as the
  `SelectPrimitive.Value` child (`<SelectPrimitive.Value placeholder=…>{selected?.label}</SelectPrimitive.Value>`) so
  "Show 100 items" is in the server HTML. The M02 streaming fallback now paints "Show 100 items" itself.
- **R10-3 Nav and tab label casing (shared `config/nav-config.ts:185`, `config/page-tabs.ts:44`).** Still "Shipment
  Plan" (title case) while the page header is now "Shipment plans" (sentence case like "Carrier shipment details",
  "Shipment history", "End of the day"). Please rename both to "Shipment plans".
- **R10-4 Shared change-log drawer rebuilds messages (shared `components/shared/change-log-drawer.tsx:28-33`).**
  `changeLogMessage` replaces any Update message that lacks `-->` with "<Label> is modified. from --> to". M02 now
  stores readable sentences ("Added orders SO1, SO2.", "Status changed from Open to Shipped.", "Loading started set to
  11/10/2026 6:36 AM EST.") with display-formatted from/to. Prefer the stored `message` when it is present and only
  rebuild when it is empty, so every consumer shows the sentence.
- **R10-5 Hydration mismatch comes from the shared grid header checkbox (shared `components/ui/checkbox.tsx` /
  `components/grid/data-grid-header.tsx`).** The headless capture (`kitstak-critic/shipping/r5b/hyd.log`) shows the warning
  on `/shipment-plans` and `/shipments`. The diff is the Radix `CheckboxBubbleInput` inline style on the "Select all" header
  checkbox (`opacity: 0` vs `"0"`, `pointerEvents` vs `pointer-events`, `margin: 0` vs `margin-top: 0px`). Server and
  client serialise the hidden bubble input's style differently. No M02 markup is involved. Fix: render the header
  checkbox client-only (mount gate), or upgrade or patch `@radix-ui/react-checkbox` so the bubble input style matches.

## Round 2 requests (round 6 parity loop additions, 2026-11-10)
- **R11-1 Grid list timeout and retry (shared `components/grid/use-grid.ts:103`, `GRID_TIMEOUT_MS = 30_000`).** When a
  cold or slow API passes 30 s, the grid shows "The server took too long to respond", and Retry starts the same 30 s
  race again. Please do one of the following:
  - Let `UseGridOptions` take `timeoutMs`.
  - Back off on retry (for example 30 s, then 60 s, then 120 s) and keep showing the skeleton with "Still loading…"
    after 10 s rather than failing.
  Together with R10-1 (footer `loading={(loading || Boolean(error)) && data.length === 0}`), a slow API would no longer
  look like "Total: 0".
- **R11-2 Grid prefs must never surface a 500 (shared `app/api/grid-prefs/[gridKey]/route.ts` and `useGridPrefs`).**
  The route was 200 in round 6. The round 5 500s came from the saturated dev server. The client should still treat a
  failed prefs load as "no saved prefs" and not log a console error, because a prefs failure must not affect the grid.
- **R11-3 Stable review server (ops / foundation).** The critic's round 5 walk timed out on the shared `next dev`. The
  log showed "Jest worker encountered 2 child process exceptions" and EPIPE. Please give the critic a `next build &&
  next start -p 3100` target (a separate `distDir` so it doesn't collide with dev), so every module route can be
  checked under 2 s.
- **R7-5 re-confirmed at 768 px on `/shipments`:** the first toolbar row overflows, and the "Label create date" chip's ×
  and the Views button are clipped at the right edge (`kitstak-critic/shipping/r6/shipments-768.png`).

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** REQ-6 (viewer and operator read every `view` / `view_*` action), REQ-7 / R7-5 (`GridToolbar bulkInline` → `BulkActions inline`; 0 = all in Actions), R2-1 (viewer's UTC offset: `apiFetch` sends `x-tz-offset`, `defineRoute` scopes it, `compileFilters` uses it unless an explicit offset is passed), R2-2 / R2-5 / R6-3 (neutral disabled destructive bulk action), R2-3 / R5-3 / R6-3 (filter chips nowrap, shrink-0, row wraps; chips use the info palette), R2-4 / R3-3 (header grip is absolute; th/td share padding; right-aligned headers end-aligned), R3-2 partly (ship refuses an order whose labels were all voided), R4-3 / R5-1 / R6-2 (ActivityTimeline and ChangeLogDrawer localise ISO date-times in messages, accept `timeZone`, show the user's name), R6-1 (column chooser gutter: a sticky-right 40 px column when the grid has no kebab), R6-4 (StatTile sublabel `title`), R6-2 / R8-1 (`shipments.shipment_mail_sent_at` / `delivery_mail_sent_at`, migration 0003), R7-1 (location picker `areaType` accepts a comma list; Combobox shows a generic "Couldn't load options" on errors), R9-1 (create-job modal shows the record code, never the error code), R9-2 (`shipment-plan` operation nouns read "order(s)"), R10-1 (footer em dash on error), R10-2 (Select label SSR), R10-3 ("Shipment plans" in nav and tab), R10-4 (the stored message wins; rebuilt only when empty), R10-5 (header select-all checkbox mounts after hydration), R11-1 (`useGrid({ timeoutMs })`), R11-2 (prefs load: 3 s timeout, silent fallback to defaults).
- **Not done:** R3-2 prevention in the label creators (relabel without void), R7-2 / R7-3 manifest keyed by carrier code / late-label re-homing, R7-4 picker display format (convention 0.1 decision), R7-6 export selected rows, R9-3 / R10-8 data fix for SO010845, R11-3 prod server for critics, R6-1 (round 6) plan reconciliation from `shipOrders`.

## Round 2 requests (blind-judge repair round 1, 2026-11-10)
- **R12-1 Carrier test credentials (owner action) and adapter track/pickup (M12).** Live connectivity is wired: a Test
  carrier setup with credentials now calls the carrier's own test API. No setup in this database has credentials, so
  nothing can be proven end to end yet.
  - Please add UPS developer (CIE) client id/secret and a shipper number to "UPS-TEST" (Integrations → Carrier
    Integrations), or an EasyPost test API key. Then create, void and reprint once from /shipments → Create label.
  - `CarrierAdapter` has no `track()` / `schedulePickup()`. M02's Refresh tracking and Schedule pickup log a 501 for
    non-simulated connections until M12 adds them.
- **R12-2 Customer notification sender (foundation / M12).** `shipments.shipment_mail_sent_at` and
  `delivery_mail_sent_at` are now shown and filterable on Carrier Shipment Details. No mailer stamps them, so all rows
  read "No". Please stamp them when the "Order Shipped" / delivered notifications are sent.
