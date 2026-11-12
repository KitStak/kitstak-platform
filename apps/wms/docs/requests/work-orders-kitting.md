# M08 work-orders-kitting — shared-change requests

## REQ-1 — Work order state machine: In Process → Open (Cancel Picking)
- **File:** `src/server/domain/state-machines.ts` (`workOrder` machine)
- **Change:** `"In Process": ["Completed", "Cancelled", "Open"]`. Optionally guard it with a `GuardContext` flag (`processedQty === 0`), which M08 already checks before it calls the transition.
- **Reason:** Warehouse Ops → **Cancel Picking** on a with-picking work order releases the component allocations, cancels the picking/kitting tasks and the job, and has to put the work order back to **Open** so it can be allocated again. Today only `Shortage → Open` is an edge, so Cancel Picking on an In Process work order is refused with a clear message. M08 checks the edge through `work-orders-adapters.ts` (`transitionWorkOrder`, `canReopenInProcess`), so it starts working once the edge lands, with no M08 change.
- **status:** applied (F-patch 2026-11-06): `"In Process": ["Completed", "Cancelled", "Open"]` with a guard that refuses In Process -> Open only when `GuardContext.processedQty > 0` (no ctx = allowed, so `canReopenInProcess()` is now true).

## REQ-2 — Domain writer for work-order allocation exceptions
- **File:** `src/server/domain/allocation.ts`
- **Change:** export
  ```ts
  export function recordWorkOrderException(tx: Tx, ctx: DomainCtx, input: {
    workOrder: { id: string; warehouseId: string; clientId: string };
    productId: string; inventoryQty: number; requiredQty: number; waveNo: string; explanation: string;
  }): void
  ```
  It should insert into `allocation_exceptions` with `orderId = workOrder.id`, `waveNo = "Manual Allocation - Work Order"`, `algorithmName = "Work order components"`, `shortageProductId`, `inventoryUomQty`, `orderLineQty = requiredQty`, `explanation`, `runBy = ctx.source`, and the warehouse and client.
- **Reason:** C1 makes `allocation_exceptions` foundation-only. M08 needs the acceptance row "Manual Allocation - Work Order" whenever Picking/Job Operations finds short components. `work-orders-adapters.ts` calls the shared function as soon as it exists, and until then writes the same row shape itself.
- **status:** applied (F-patch 2026-11-06): `recordWorkOrderException(tx, ctx, input)` exported from `src/server/domain/allocation.ts` (`waveNo` optional, defaults to "Manual Allocation - Work Order"; also exports `MANUAL_ALLOCATION_WORK_ORDER`, `WORK_ORDER_ALGORITHM_NAME`).

## REQ-3 — `/api/ops/jobs` + `create-job-modal` support for `operation=work-order`
- **Files:**
  - `src/server/repositories/platform-ops.ts` (`workOrderJobsSchema`, `eligibilitySchema`, `runJobsCommand`, `checkEligibility`)
  - `src/components/shared/create-job-modal.tsx`
- **Change:**
  1. The modal posts `{ operation, ids }` to `/api/ops/jobs/eligibility`. The schema expects `orderIds` and `operation ∈ {order, shipment-plan}`, so any `operation="work-order"` call fails validation. Accept `operation: "work-order"` and map `ids`→`orderIds`. For work orders, delegate to `runPicking(db, ctx, { ids, dryRun: true })` from `@/server/repositories/work-orders-ops`. It returns `succeeded`, `failed` and `outcomes[]`, which give per-WO shortage detail.
  2. Extend `workOrderJobsSchema` with `jobTypeId: idSchema.nullish(), assigneeUserId: idSchema.nullish(), priority: z.enum(PRIORITIES).optional()`. Call `allocateWorkOrderWith(tx, ctx, id, { jobTypeId, assigneeUserId, priority })`, which is already exported by `work-orders-commands.ts`.
- **Reason:** BUILD_PLAN M08 2 says that Picking/Job Operations opens `create-job-modal` with `operation=work-order`. Until the shared modal and backend accept work orders, M08 ships its own Picking/Job Operations dialog (`src/components/work-orders/picking-dialog.tsx`) on `POST /api/work-orders/picking` (dry-run preview → job type / assignee / priority → create). That dialog calls the same `allocateWorkOrderWith` command.
- **status:** applied (F-patch 2026-11-06): `/api/ops/jobs/eligibility` accepts `{ operation: "work-order", ids | orderIds }` (no job type needed) and returns the `runPicking` dry run as `{ total, eligible, ineligible[{ id, code, message, reason }], jobCount, jobTypes }` (shortage detail in the reason); every eligibility result now carries `reason`. `/api/ops/jobs` maps the modal's `{ operation: "work-order", mode: "create", ids, jobTypeId, assigneeUserId, priority? }` onto mode `work-order`, which calls `allocateWorkOrderWith(tx, ctx, id, { jobTypeId, assigneeUserId, priority })`. No modal change was needed.

## REQ-4 — Seed: Logiwa acceptance kit `MLT-KIT-2PK`
- **File:** `src/server/db/seed/**` (catalog + inventory fixtures)
- **Change:** add a Kit to Stock product `MLT-KIT-2PK` ("MLTest 2 Pack Kit", client of the MLT1 warehouse) with one component, BOM qty 2. Give that component at least 22 free units in an MLT1 pick location, so Kit Inventory shows Net Kitting Capacity 11 like the Logiwa capture.
- **Reason:** M08 acceptance names `MLT-WO-E2E (MLT-KIT-2PK × 5)`. The seed has no such SKU, so M08 runs the same flows on the seeded kit-to-stock kits (VLT-KIT-DESK, CPL-KIT-SAMPLER, HRB-KIT-GIFT) instead.
- **status:** applied (F-patch 2026-11-06): same fixtures script as inventory REQ-1 (`npm run db:fixtures`): Kit to Stock `MLT-KIT-2PK` ("MLTest 2 Pack Kit", client APX) with component `MLT-KIT-COMP` × 2, and 22 free units of the component in MLT1-C-01 (Picking), so Net Kitting Capacity = 11 once kit stats recalc.

## REQ-5 — Page tab group for Work Orders
- **File:** `src/config/page-tabs.ts`
- **Change:** add `workOrders: [tab({ label: "Work Orders", href: "/work-orders", permission: P.workOrders })]`.
- **Reason:** Logiwa shows the single WORK ORDERS tab under the header. Until the group exists, M08 passes an inline `PageTabItem[]` to `PageHeader`.
- **status:** applied (F-patch 2026-11-06): group key `"work-orders"` (kebab-case like the other groups) with the Work Orders tab; use `<PageHeader tabs="work-orders">`.
- **Foundation pass 1 (2026-11-09):** verified all REQs above are DONE (pass 1); no further shared change pending.
- **Foundation pass 2 (2026-11-09):** re-verified against the code; all REQs above DONE (pass 2), no further shared change pending.

## Round 2 requests

### R2-1 — Work order "Open" pill colour (teal)
- **File:** `src/components/ui/status-pill.tsx` (domain `workOrder`)
- **Change:** render work order **Open** as teal: text `rgb(22,194,170)` on `rgb(208,243,238)`. Keep **Completed** green: `rgb(0,135,77)` on `rgb(211,240,227)`.
- **Reason:** the live Logiwa capture (references/logiwa-live/inbound-inventory.md §9) shows Open as teal, not green.
- **Status:** DONE (foundation round 2, 2026-11-10): `WORK_ORDER.open` is now `teal` in `src/lib/status-colors.ts`.

### R2-2 — Correct file for R2-1 + a teal KPI chip tone
- **Files:** `src/lib/status-colors.ts` (the `WORK_ORDER` map, `open: "green"` → a teal token), `src/components/ui/kpi-chip.tsx` (`KpiTone`).
- **Change:** (1) R2-1's colour lives in `src/lib/status-colors.ts`, not `status-pill.tsx`: map work order `open` to a teal tone (`rgb(22,194,170)` on `rgb(208,243,238)`, with a dark-mode pair). (2) Add a `teal` (or `info`) tone to `KpiTone` so the Work Orders status pills can show Open as teal; M08 will switch `STATUS_TONE.Open` from `success` once it exists.
- **Reason:** today Open and Completed render the same green in both the grid pill and the status KPI chips, so an operator can't tell them apart at a glance. Logiwa uses teal for Open (`table-status-1`).
- **Status:** DONE (foundation round 2, 2026-11-10): status map part done (teal). KpiTone teal not added; M08 keeps `success` for the chip.

### R2-3 — Grid footer "Total" while loading
- **File:** `src/components/grid/grid-footer.tsx` (and `data-grid.tsx`, which passes `loading`)
- **Change:** while `loading` is true and no page has arrived, render `Total: —` (or a small skeleton) instead of `Total: 0`.
- **Reason:** critic R1 found the Work Orders and Kit Inventory grids show "Total: 0" for several seconds while the status pills already show "All 8". The page contradicts itself.
- **Status:** DONE (foundation round 2, 2026-11-10): `GridFooter` takes `loading`; DataGrid passes it while no rows have arrived, Total shows an em dash.

### R2-4 — Fail faster on list queries so the grid error + Retry state appears
- **File:** `src/lib/query-client.ts` (`shouldRetry`)
- **Change:** cap retries for `INTERNAL`/5xx at 1, with a short delay. The current backoff keeps the grid on skeletons for a long time before `DataGridBody` shows its error + Retry.
- **Reason:** critic R1 saw `/api/kits` return 500 once. The Kit Inventory grid then stayed on skeletons with no error or Retry. The grid's error state exists, but the retries never let it show.
- **Status:** DONE (foundation round 2, 2026-11-10): `shouldRetry` retries 5xx once (network twice) with `retryDelay` 500 ms to 2 s.

### R2-5 — Kit Inventory / Kit Component Availability breadcrumb
- **File:** the breadcrumb / nav map (`src/components/layout/page-header.tsx` crumb derivation or the nav config)
- **Change:** set the crumb for `/inventory/kits` and `/inventory/kit-components` to `Home > Inventory > …`, to match the Inventory tabs those pages render (`tabs="inventory"`).
- **Reason:** critic R1 saw the breadcrumb say Reports while the page sits under the Inventory tabs.

### R2-6 — Dev server latency (informational)
- During round 2 the shared dev server answered `/api/me` in 2–6 s and module APIs in 4–13 s, with one transient 500 during HMR. The M08 queries are single-table and indexed. The latency comes from shared compile load, not module code. The critic's 5–12 s skeleton timings should be re-measured on a quiet server.

### R2-7 — (Round 3 re-file) R2-1/R2-2 still open: work order Open pill is green
- **File:** `src/lib/status-colors.ts` line ~94 (`const WORK_ORDER`).
- **Change:** `open: "green"` → `open: "teal"` (the `teal` tone already exists in the same file: `#D0F3EE` / `#0F8C7A`). One-word change; Completed stays green. The critic flagged this again in round 2.
- **Status:** DONE (foundation round 2, 2026-11-10): see R2-1.

### R2-8 — `GET /api/audit?entityId=` ignores entityId
- **File:** `src/app/api/audit/route.ts` (admin-settings owned).
- **Change:** honour `entityId` (and `entityType`) query params as filters on the audit query. Today it returns unrelated security rows. The work order Change log uses the change-log API and is correct; this only affects API consumers.
- **Status:** DONE (foundation round 2, 2026-11-10): `/api/audit` honours `entityId` and `entity`/`entityType` as exact filters.

### R2-9 — Grid footer "Total: 0" while loading (R2-3 still open)
- The Work Orders list still shows `Total: 0` under the skeleton rows. Please show `Total: —` (or a skeleton) while `isPending` in the shared DataGrid footer.
- **Status:** DONE (foundation round 2, 2026-11-10): see R2-3.

### R2-10 — Grid filter chip is crushed (foundation `GridToolbar`)
- **File:** `src/components/grid/grid-toolbar.tsx` (active filter chips).
- **Change:** render each chip on one line, e.g. `Work Order Status: Cancelled ×`: `min-width: max-content` (or `shrink-0 whitespace-nowrap`), cap the value at about 220 px with an ellipsis and a tooltip that shows the full text, and let the chip row scroll horizontally or wrap below the toolbar instead of squeezing.
- **Reason:** critic round 1 (I-pill-cancelled.png, L02-pill-shortage.png). After a status pill or the Work Order Status filter is applied, the chip is squeezed to about 50 px. "WORK ORDER STATUS" wraps onto 3–4 lines and spills out of the toolbar, and the value isn't visible. Re-checked 2026-11-09 (`r2-02-open-pill.png`): still crushed. This affects every grid with a long field label.
- **Status:** DONE (foundation round 2, 2026-11-10): chips are `shrink-0`, labels nowrap, value capped at 220 px with title tooltip, chip row scrolls horizontally.

### R2-11 — Work order field labels in the shared change log (optional, M08 is unblocked)
- **File:** `src/server/domain/change-log.ts` (`ENTITY_FIELD_LABELS`).
- **Change:** add `work_order` labels, or reuse M08's exported `WO_FIELD_LABELS` from `src/server/repositories/work-orders.ts`, so that any future shared `recordUpdate` call for work orders also logs "Actual start date" rather than "Actual Start At".
- **Context:** M08 now writes its work-order update rows through its own `recordWorkOrderChanges`. That function applies human labels and formats dates in the warehouse timezone, so new rows already read correctly. Rows written before 2026-11-09 23:00 keep the raw ISO text.

### R2-12 — Format ISO date values in the Change log drawer (shared)
- **File:** `src/components/shared/change-log-drawer.tsx` (`changeLogMessage`).
- **Change:** when `fromValue`/`toValue` match an ISO date-time, render them with `useFormat().dateTime(...)` in the viewer's preferences.
- **Reason:** old rows across modules, including M08 rows written before this round, still show `2026-11-10T03:09:52.527Z` next to localized timestamps.

### R2-13 — Operator role should not create/edit/delete work orders (foundation `permission-catalog.ts`)
Round-3 critic: operator gets 201 on `POST /api/work-orders`. In Logiwa, creating a WO is a planner/manager action, and floor operators execute kitting. Please add `inventory.work_orders.create`, `inventory.work_orders.edit`, `inventory.work_orders.delete` to the operator denial for work orders (for example a per-key deny next to `OPERATOR_DENIED_ACTIONS`, since `create`/`edit` are allowed for other inventory permissions). Operators keep `view`, `create_kit`, `disassemble_kit`, `picking_job_operations`, `cancel_picking`, `tag`. M08 already hides the controls through `useCan`, so no M08 change is needed.
- **Status:** DONE (foundation round 2, 2026-11-10): `OPERATOR_DENIED_PERMISSIONS` drops `inventory.work_orders.{create,edit,delete}`; existing DB roles re-synced with `scripts/sync-system-roles.ts`. M08's local gate can be removed.

### R2-14 — `/api/audit?entityId=` ignores the filter (admin-settings)
Round-3 critic: the entityId filter returns unrelated rows. Please honour `entityId` (and `entity`) as exact-match filters on `audit_log`. The WO timeline uses `change_log`, so M08 is not blocked.
- **Status:** DONE (foundation round 2, 2026-11-10): see R2-8.

### R2-15 — Focus ring colour on form controls (foundation `control-styles.ts`)
`controlVariants` uses `focus-within:border-primary ring-primary/25`, and the brand primary is red (#c8102e), so any autofocused field looks like a validation error (round-3 critic, Create Kit step 1). M08 overrides the colour locally on the scan field. A neutral or info focus colour for all controls would fix every module.
- **Status:** DONE (foundation round 2, 2026-11-10): `controlVariants` focus uses the `info` token instead of brand red.

### R2-16 — Dev server under shared load returns Next HTML 500s
The round-3 critic saw HTML 500 pages (not the JSON envelope) on `/api/work-orders*` while other modules were mid-edit. A trivial status-counts query took 1.5 to 14 s in round 4. These are compile or module-graph failures outside `defineRoute`, so the route cannot catch them. M08 now protects the client side: a "still loading / Retry" callout on the grid after 10 s, and an idempotency key on Create Kit. `apiFetch` already maps non-JSON bodies to an error.

### R2-17 — `/api/attachments` returns 500 for every entity (platform-files / dev server)
Round-5 critic: the WO Documents tab fails with 500. It isn't WO-specific: `GET /api/attachments?entityType=order&entityId=x` also returns 500. The dev log shows the route bundle failing with "Module [project]/src/server/repositories/inventory-commands.ts … was instantiated because it was required from module src/server/imports/handlers/inventory.ts, but the module factory is not available" (a stale Turbopack module graph that a shared import chain pulls into the attachments route). Owners: please check why `/api/attachments` (via `@/server/files` / `platform-files`) imports the imports-handler registry, and break that chain or restart the dev server. Also, `DocumentsViewer` (shared) should hide or disable Upload while the list request is in an error state.

### R2-18 — Change log drawer Operation Date in the warehouse time zone (shared `ChangeLogDrawer`)
The M08 change-log messages and the WO detail page now render "11/10/2026 12:44 AM EST" in the warehouse time zone (`formatInZone`, `src/lib/grid-defs/work-orders/wo-time.ts`). The shared drawer's Operation Date column still uses the browser zone with no suffix, so one event can show two different times. Please format the column in the record's warehouse time zone with a TZ suffix (the WO detail API now returns `warehouseTimeZone`), or accept a `timeZone` prop.

### R2-19 — Tab triggers show the focus ring after a mouse click (shared `ui/tabs.tsx`)
Radix focuses the trigger on mouse down, and Chrome matches `:focus-visible`, so a red `ring-primary/30` box stays on the clicked tab. M08 suppresses it locally (a `data-pointer` wrapper on the detail tabs). A shared fix would cover every detail page.
- **Status:** DONE (foundation round 2, 2026-11-10): `ui/tabs.tsx` marks pointer focus (`data-pointer`) and hides the ring for it; keyboard focus keeps an inset info ring.

### R2-13 (update)
Still open in the catalog. Until it lands, M08 enforces it locally: `planningDeniedForRoles` (`wo-planning.ts`) returns 403 on POST/PATCH/DELETE `/api/work-orders` and `/api/work-orders/cancel` for users whose only roles are the system `operator`/`viewer`, and the UI hides Create/Edit/Delete/Cancel. Once the catalog drops those keys from the operator role, the local gate can be removed.

## Round 2 requests (round 6 additions)

- **R2-16 (re-raised, foundation/devops):** dev-server saturation. In round 6, `/api/me` took 8–17 s, the `/work-orders` document took 44 s, and API routes returned empty-body 500s while other modules recompiled. M08 list queries answer in 0.13–0.7 s when the server is idle. Please judge latency on a `next build && next start` instance, or isolate the critic's server.
- **R2-17 (still open, platform files):** the `/api/files` POST returned empty 500s during the round-6 run, so Documents upload could not be verified end to end. Please add a unit or API test for `POST /api/files` (PDF) followed by `POST /api/attachments` with `entityType=work_order`.
- **R2-20 (clients module):** the Turbopack parse error at `src/components/clients/client-detail-page.tsx:298` shows in the console on every page, `/work-orders` included.

## Round 2 requests (critic R2 7.4 follow-ups, 2026-11-10)

### R2-21 — Print preview blocked by `frame-ancestors 'none'` (foundation CSP / platform files)
The Print picking list, Batch picking list and Print kit/product barcode dialogs (shared `PrintOptionsModal`) render an empty Preview. The console shows "Framing 'http://localhost:3000/' violates … frame-ancestors 'none'". The first attempt also got a 500 from `GET /api/files/<id>`. Download works. Please (1) send `Content-Security-Policy: frame-ancestors 'self'` (and `X-Frame-Options: SAMEORIGIN`) on `GET /api/files/**` and the print render route, keeping `'none'` everywhere else; (2) find the `/api/files/<id>` 500 (probably the same stale module graph as R2-17); (3) give the template list in `PrintOptionsModal` a labelled loading state ("Loading templates…") instead of a bare spinner.
- **Status:** DONE (foundation round 2, 2026-11-10): part (1): `next.config.ts` sends `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` on `/api/files/**` and `/api/printouts/preview`. Parts (2)/(3) open.

### R2-22 — Grid list races when status pills change quickly (foundation `components/grid/use-grid.ts`)
On `/work-orders`, switching pills quickly (Shortage → Cancelled) sometimes leaves the grid on the previous result: the URL and `aria-pressed` say Cancelled and the network response holds Cancelled rows, but the grid still shows the Shortage row with "Total: 1". `useGridCore` uses `placeholderData: (prev) => prev`, so the old page stays up while the new key loads, and nothing marks it stale. Please: (a) show the loading overlay or row skeleton while `isPlaceholderData` is true (so stale rows are never presented as the active filter's result); (b) make sure the request query string and the query key come from the same snapshot of `grid.queryString`. `useGridUrlState` can briefly hand back a string that differs from the URL after `router.replace`, which leaves an older key's result showing. M08 adds a module-side guard (below), but every list page has the same exposure.

### R2-23 — `DataGrid` row highlight + footer wrap at 768 px (foundation `components/grid`)
(1) Add `highlightRowId?: string` (a short-lived tint plus `scrollIntoView`) so a page can point at a row it just created or updated. M08 shows a "Work order KS-… created · Open" callout instead, for now. (2) At 768 px the footer wraps "Export As Excel" onto a second row under the pagination. Please keep the footer on one row: shrink the export button to an icon with a tooltip below `lg`, or move it into the toolbar overflow.

### R2-24 — `ActivityTimeline` time zone (shared `components/shared/activity-timeline.tsx`)
The WO grid, detail Details card, Transactions, Receipts, Exceptions, Create Kit summary and the Excel export now all use the warehouse time zone with a suffix ("11/09/2026 11:43 PM CST", `formatInZone` in `src/lib/grid-defs/work-orders/wo-time.ts`). The shared Activity timeline still prints `fmt.dateTime(item.at)` in the browser zone with no suffix. Please accept an optional `timeZone` prop and render with a zone suffix. M08 will pass `data.warehouseTimeZone`.

## Round 2 requests (round 7 parity loop, 2026-11-10)

### R2-25 — `DataGrid` renders the skeleton and header with the default column order before saved prefs load (foundation `components/grid/data-grid.tsx`, `use-grid-prefs.ts`)
On `/work-orders` the loading skeleton shows WORK ORDER CODE, JOB CODE, WAREHOUSE… (the column-def default), then the grid jumps to the user's saved order (WORK ORDER CODE, WAREHOUSE, CLIENT…) when `/api/grid-prefs/work-orders` answers. Please expose `loaded` from `useRemotePrefs`/`useGridPrefs`, and while it is false render a header-less row skeleton (or hold the header) so the columns never reorder in view. Related: footer "Total: —" flicker during refetch (R2-9) is still visible when a status pill reloads; keep the last known total while `isPlaceholderData`.

### R2-26 — Accept `pageSize` (and `limit`) as aliases of `ps` in the grid grammar (foundation `src/server/query/grid-query.ts`)
`GET /api/kits/components?pageSize=2` returns every row because the grammar only reads `ps`, so it looks as if paging is ignored. M08 routes call the shared `grid()` parser, so the alias belongs there and fixes every grid API at once: map `pageSize`/`limit` to `ps` when `ps` is absent (same max as `ps`).

### R2-27 — Seeded kitting history should come from the live commands (F2 seed, `src/server/db/seed/kitting.ts`)
The seed writes Completed work orders with `ledger.add(type "Kitting")` and no Kitting receipt, and forces the Shortage target without writing "Manual Allocation - Work Order" exceptions (WO000092 is also not short with the current stock: 773/440/637 free for 400 kits). Please (1) post the kit output with `ledger.recordReceipt({ type: "Kitting", workOrderId, … })`, as `createKit` does; (2) for the Shortage spec, size the quantity above free stock and call `allocateWorkOrderWith` so the status and exceptions come from the real command; (3) create Picking tasks for the Completed with-picking work orders (or build them through `allocateWorkOrderWith` + `createKit({ completePendingPicks: true })`). M08 ships `repairWorkOrderHistory` (in `work-orders-commands.ts`) as a stop-gap. It ran once on the dev DB and added Kitting receipts #70167–#70169 to WO000088/90/91. It writes exceptions only for components that are short now, so WO000092 still has none; its detail page now says that stock covers every component and offers Retry allocation. A `db:fixtures` hook could call the repair after the seed.

### R2-28 — Dev server hang (orchestrator)
While this round was running, `next dev` (pid 47592, 5.7 GB working set, more than 9,000 s of CPU) accepted connections on :3000 but answered nothing within 30–60 s (`/login`, `/api/health`). Headless verification of this round's UI changes was blocked. It needs a restart by the orchestrator; M08 did not touch the process.

## Round 2 requests (round 8 / parity loop R5, 2026-11-10)

### R2-29 — Warehouse time zone in `ChangeLogDrawer`, `ActivityTimeline` and `DateTimePicker` (shared `components/shared/change-log-drawer.tsx`, `activity-timeline.tsx`, `components/ui/datetime-picker.tsx`)
Critic R4 found one create event shown as "04:44 AM EST" (Details) and "3:44:19 AM" without a zone (Change log drawer). The Create Kit date pickers show "2026/11/09 23:19" in browser-local time, YYYY/MM/DD. M08 now renders its own Activity tab (`WoActivity`, warehouse zone with suffix), but the drawer and picker are shared. Please add an optional `timeZone?: string` prop to `ChangeLogDrawer`, `ActivityTimeline` and `DateTimePicker`. They should format and parse in that zone with a zone suffix and the app's `MM/DD/YYYY hh:mm A` format. Better still, export a `FormatContext`/`TimeZoneProvider` so a page can set the zone once. M08 will pass `data.warehouseTimeZone` the same day.

### R2-30 — `ExportButton` gives no feedback until the POST returns (foundation `components/grid/export-button.tsx`)
On a busy server, `POST /api/exports` can take more than 2.5 s, and until it returns the user sees only a disabled button. Please show `toast.show({ variant: "info", title: "Export started", message: EXPORT_STARTED_MESSAGE, action: Open transactions })` the moment the button is clicked, open the tray in a "queued" state, then turn it into an error toast if the request fails.

### R2-31 — Grid footer "Selected: n" overlaps pagination at 768 px with a selection (foundation `components/grid/grid-footer.tsx`)
The R2-23 fix hides "Selected" below xl only while nothing is selected. With one row selected at 768 px, "Selected: 1" collides with the pager ("Selected:x1"). Please let the footer wrap to two rows below lg when a selection exists, or move the count into the bulk bar.

### R2-32 — Dev server: every dynamic route returns 500 "Jest worker encountered 2 child process exceptions" (orchestrator)
In this round, `/api/work-orders/WO000092`, `/api/orders/does-not-exist` and the `/work-orders/WO000092` page all returned the Next `_error` page with that message after 100 s. Static routes worked: `/api/me` (79 s), `/api/work-orders/status-counts`, and the new `/api/work-orders/code-available`. The failure is in the dev server, not in a module. The detail logic was verified read-only against the live DB with `tsx` (see progress notes). The server needs a restart by whoever owns it.

## Round 2 requests (round 9 / parity loop R6, 2026-11-10)

### R2-33 — `recordReceipt` should accept the ledger type (foundation `server/domain/ledger/receipts.ts`)
`recordReceipt` always posts `type: "Receiving"` for non-return receipts (line 129). Logiwa posts a kit build's output under **Kitting** and a breakdown's component returns under **Disassemble Kit**, so Transaction History filtered by Kitting missed every live kit output. M08 now retypes its own receipt rows in the same transaction (`retypeReceiptTxn` in `work-orders-commands.ts`; quantities, buckets and links are untouched) and `repairWorkOrderHistory` backfills older rows. Please add an optional `txnType?: TxnType` to `RecordReceiptInput`, or map `Kitting` → "Kitting" and `DisassembleKit` → "Disassemble Kit" there, so the retype can be removed. `cancelReceipt` already posts "Cancel Receiving" from the receipt, independent of the row type.

### R2-34 — api-client: confirm the session before the 401 → /login redirect (foundation `src/lib/api-client.ts`)
Under dev-server load, critic sessions were bounced to `/login?next=/work-orders` even though the session cookie was still valid: `/api/me` returned 200 straight afterwards. A single slow or garbled 401 should not log the user out. Before redirecting, re-check `GET /api/me` once (with a short timeout). Redirect only if that call also returns 401; otherwise surface the original error.

### R2-35 — Dev server still unhealthy (orchestrator; repeat of R2-28/R2-32)
Measured this round with the admin cookie: `/api/me` 137 s, `/api/work-orders?ps=3` 71 s, `/api/work-orders/status-counts` 76 s, `/api/kits?ps=2` 72 s. `/api/work-orders/WO000092` returned 500 after 147 s with "Jest worker encountered 2 child process exceptions, exceeding retry limit". `/work-orders` never got past the (app) layout skeleton in 300 s: no sidebar, no client page. That means the server render of the shell stalls, not the module's client code. The same queries run in-process in 21 ms (`computeKitStats`, 9 rows) against the same DB. The server needs a restart, and the module needs a re-walk afterwards.

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** R2-2 KpiTone `teal` and `info`, R2-12 / R2-24 / R2-29 (ChangeLogDrawer and ActivityTimeline take `timeZone` and render "MM/DD/YYYY hh:mm AM TZ"; ISO values in messages are localised), R2-22 (`gridProps.refreshing = isPlaceholderData`; DataGrid dims stale rows with a progress bar and `aria-busy`), R2-23 (`DataGrid highlightRowId`; footer Export is icon-only below lg), R2-26 (`pageSize` / `limit` aliases of `ps`), R2-30 (Export shows "Starting export…" at once and an error toast with the server message), R2-31 (footer wraps below lg; Selected always shown), R2-33 (`RecordReceiptInput.txnType`; Kitting → "Kitting", DisassembleKit → "Disassemble Kit" by default), R2-34 (a 401 re-checks `/api/me` once before redirecting to /login), R2-11 (`humanize` / field labels improved generically; work_order labels not added), R2-18 (drawer `timeZone` prop).
- **Not done:** R2-5 kits breadcrumb is now "Inventory" via the nav move (see inventory REQ-8), R2-17 / R2-21 parts 2-3 (attachments 500 = dev server), R2-25 hold columns until prefs load (prefs now time out after 3 s instead), R2-27 kitting seed through live commands, R2-6 / R2-16 / R2-28 / R2-32 / R2-35 (dev-server infra).
