# M08 work-orders-kitting — progress (round 1)

## Status
Code complete; server/API verified. Click-through browser verification still open (see Remaining).

## Done
- [x] Pure model + grid defs (`src/lib/grid-defs/work-orders/**`): 20 columns, 22+ filters, guards, formulas, zod contracts.
- [x] Repositories: work-orders (list/detail/create/update/delete/status counts), commands (allocate, create kit,
      disassemble, cancel picking, cancel), ops (picking dry-run/run, pick lists), kits (stats recalc, Kit Inventory,
      Kit Component Availability, kit detail, component/kit stock buckets), adapters for pending REQs.
- [x] Stubs replaced: kitting task handler, kit-inventory-recalc scheduler task (15 min), work-orders import handler,
      export providers (work-orders, kit-inventory, kit-components).
- [x] APIs under `/api/work-orders/**` and `/api/kits/**`.
- [x] UI: list page (pills, toolbar, Warehouse Ops menu, row kebab), wizard drawer (Kitting card + 4 steps, Logiwa
      unsaved copy), Create Kit / Disassemble / Picking dialogs, detail page, Kit Inventory (Recalculate now, Last
      updated, Create work order prefilled), Kit Component Availability (Included kits tooltip, Reorder qty).
- [x] Unit tests `tests/unit/work-orders-kitting/**` — 34 passing:
      model (formulas, guards, contracts, grid defs), lifecycle against in-memory DB (acceptance: create Open,
      Create Kit 5 → components −10/−5, kit +5, Kitting txns + Kitting receipt, Completed; Disassemble 2 → reversal +
      DisassembleKit receipts; with-picking short → Shortage + "Manual Allocation - Work Order" exceptions; allocate →
      job with picking + kitting tasks; kitting task handler builds; cancel releases; 409 on stale edit; scope 404;
      Net Kitting Capacity hand calc), API handlers through defineRoute (201/400/403/404/409, viewer + CSRF guards).
- [x] Live API checks (2026-11-06): all four routes + `/imports/work-orders` return 200; status counts, kit reports,
      recalc stamp OK; Picking/Job Ops on KS-TEST-WO-SHORT (dry-run + real) → Shortage with 3 exception rows.
- [x] Typecheck clean on owned paths; eslint 0 errors (5 `set-state-in-effect` warnings on "seen rows" caches).

- [x] Resume session (2026-11-06, later): 34/34 unit tests pass; tc-queue 0 errors on owned paths; all 4 routes 200
      with no placeholders; live API E2E on KS-TEST-WO-R1-24013 (HRB-KIT-GIFT x2, without picking, sources set):
      Open -> Create Kit 2 -> Completed, components 776/442/640 -> 774/440/638, kit on hand 7 -> 9, Kitting receipt +
      Kitting txns; Disassemble 1 -> 3 DisassembleKit receipts + Disassemble Kit txn, kit 9 -> 8, components +1;
      change_log rows written (e.g. disassembledQty). Status counts and Kit Inventory / Component Availability APIs OK.

## Round 1 (parity loop, pass 2) — 2026-11-09
Follows the pass-1 section at the end of this file (standalone Disassemble, Print ▾ split, tab group).
- [x] **Create Kit** now carries Logiwa's step-2/3 content in one dialog: Kitting task time range (Actual start/finish date-time; start
      locked once the WO has started, finish only enabled when this build completes the WO) and an **Inventory transaction summary**
      (SKU, Location, Per kit, Current qty, Qty change: kit +N green, components −N red, short components flagged) with Component SKU qty /
      Component total qty chips. `createKitSchema` takes `actualStartAt/actualFinishAt` (finish ≥ start), the command stamps them.
- [x] Wizard: warehouse and client are locked in Edit (Logiwa disables Client after create); Actual start/finish are disabled on create with
      an info tip (Logiwa parity, stops fake actuals before work starts).
- [x] Component LP on both Disassemble paths is validated server-side (must exist in the same warehouse).
- [x] Status column widened so the header no longer collides with Age.
- [x] Unit tests: 38/38 (`tests/unit/work-orders-kitting`) — new: standalone disassemble, createKit actual time range, schema
      finish-before-start, foreign/missing LP refused with no stock change. `tsc --noEmit` clean on owned paths.
- [x] Headless Playwright (admin): list, standalone Disassemble (validation on empty submit), Create Kit dialog on a real WO,
      partial build 1 of 2 → In Process with actual start stamped. Screenshots: `%TEMP%/claude/kitstak-critic/work-orders-kitting/r1-*.png`.
      Test records created: KS-R1-WO-888, KS-R1-WO-65279 (Open, without picking, MLT-KIT-2PK × 2, source MLT1-C-01) and
      KS-R1-WO-28778 (In Process, 1 of 2 built into KIT-01).
- [x] **Count-lock awareness (found live):** the final-build click-through hit a real 422 because the counts module locked
      MLT1-C-01 (count plan CNT000146). The error surfaced correctly in the dialog, but only after Submit. Now the work order
      detail returns `sourceLockedBy` per component (`countLockFor`), Create Kit shows a "Source location locked by a count"
      callout naming the plan, flags the row with a lock icon and disables Create kit with a reason. FEFO component picking
      (`candidateBuckets`, no chosen source) skips count-locked locations via `notCountLocked`.
- [ ] Complete the last build on KS-TEST record KS-R1-WO-28778 once CNT000146 is finished or cancelled (the lock is
      correct behaviour, not a bug).

## Remaining
- Re-run the full Create Kit → Completed click-through (`r1e.mjs`) once the shared dev server compiles again.
- Logiwa Open pill teal: foundation-owned, see Round 2 requests R2-1/R2-2.
- REQ-1..REQ-5 are all applied (foundation passes 1 and 2).

## Decisions
- Writes to jobs/tasks/allocation_exceptions for work orders happen inside the stub-handoff command
  `work-orders-commands.ts` (handed to M08 by 0.6) and the kitting task handler (also handed over).
- Shared copy "You have unsaved changes!…" in the Drawer differs from Logiwa; the wizard drawer
  runs its own guard with Logiwa's exact copy (No / Leave) instead of the Drawer `dirty` prop.
- The kit output is posted by `ledger.recordReceipt` (receipt type Kitting, ledger row Receiving); component
  consumption posts ledger `Kitting` rows.
- Recalculate Now requires only the Kit Inventory view permission: it refreshes a derived cache (CSRF still enforced).

## Round 1 (parity loop) — 2026-11-09
Against references/logiwa-live/inbound-inventory.md §9 (Work Orders):
- [x] **Disassemble Kit is always enabled** (Logiwa): with one disassemblable WO selected it opens the WO-scoped
      dialog; otherwise a standalone dialog (Warehouse*, Client*, Kit* search, kit stock, qty, component location/LP,
      Inventory Transaction Summary with kit −n red / components +n green). New command
      `disassembleStockKit` (BOM from `kit_components`, ledger `Disassemble Kit` + `DisassembleKit` receipts, scope
      checks, INSUFFICIENT_STOCK/NOT_FOUND/VALIDATION) on `POST /api/kits/disassemble`.
- [x] Toolbar split like Logiwa: separate **Print ▾** (Print Picking List / Batch Picking List); Warehouse Ops holds
      only Picking/Job Operations and Cancel Picking.
- [x] Header uses the shared `tabs="work-orders"` group (REQ-5); inline WO_TABS removed.
- [x] Operation type column widened (header overlapped Work order type).
- [x] Unit test for standalone disassemble; 35/35 pass. tsc clean on owned paths. Headless check: list + standalone
      dialog render, 0 console errors.
- Open: Logiwa Open pill is teal (status-pill colours are foundation-owned, filed as Round 2 request).

## Round 2 (parity loop) — 2026-11-09
Critic R1 verdict (6.3), defect by defect:
- [x] **Detail page "spins forever" (blocker):** re-checked on the current tree. `/work-orders/[id]` renders the header and all 7 tabs (headless: 7 `[role=tab]`). The R1 hang came from other modules' compile errors. Hardening: the detail query retries only once, and after 10 s of loading a "Still loading this work order" callout appears with **Retry** and a link back. Error, 404 and 403 states were already in place.
- [x] **Toolbar at narrow widths:** a **More** overflow menu (`md:hidden`) holds Create work order, Import, Create kit and Disassemble kit. The individual Create kit / Disassemble buttons show from `md` up. Headless at 390 px: More is visible and every action is reachable. At 768 px every button shows.
- [x] **Create kit CURRENT QTY:** the server now returns `sourceFreeQty` per component: free stock at the chosen location + LP + lot (`listComponents`). The Create Kit summary shows that figure under the column "Current qty at location". FEFO rows with no source chosen are labelled "all bins". Shortage and blocking use the bucket qty, so a bin holding 188 no longer reads as 782.
- [x] **Toasts:** create shows "Work order created successfully" (code · kit × qty) with an **Open** action. The toast fires right after the POST, before uploads, and cache invalidation no longer blocks closing the drawer. Create kit shows "Kit created successfully". (The critic's `[data-sonner-toast]` selector does not match: the app uses its own toaster.)
- [x] **Wizard step chips:** labels are now plain (`General`, `Kit`, …). WizardPills adds the only number.
- [x] **Build for Stock | SO:** content-sized, equal-width segments (`w-fit`, 72 px min per segment).
- [x] **Kit step loading:** shows the labelled status "Loading kit and components…" with a spinner. **Next** is disabled, with a tooltip and a spinner, until the kit loads. The source picker shows "Loading stock…".
- [x] **FEFO/FIFO source suggestion:** new `src/lib/grid-defs/work-orders/source-suggest.ts` (`fefoOrder`, `suggestSource`; unit tests in `tests/unit/work-orders-kitting/source-suggest.test.ts`). The source picker pre-selects the suggestion and tags it "FEFO pick". The Kit step has **Auto-assign all sources** for without-picking work orders.
- [x] **Kit quantity unit:** a `KitUnit` adornment, set apart from the number, reads "kit" or "kits" by quantity.
- [x] **Kit Summary after kitting (Logiwa parity):** after a successful build, Create Kit switches to a **Kit summary** card (qty, location, lot, built/requested, components used) with **Print kit barcode** (`product-label` print type) and **Open work order**.
- Grid "Total: 0" while loading, faster error/Retry, and the Kit report breadcrumb are shared: filed as R2-3, R2-4 and R2-5.
- Not done this round: the Logiwa 3-tab Create Kit with a required Source Location/LP scan, and the 2-tab Disassemble drawer with an Add Attribute action per component. KitStaks keeps the single-form dialogs and adds the summary step.
- Checks: `npx tsc --noEmit` clean on owned paths. `npx vitest run tests/unit/work-orders-kitting` 41/41 pass (4 files).

## Round 3 (parity loop) — 2026-11-09
Critic R2 verdict (7.1), defect by defect:
- [x] **Create Kit is a 3-step drawer (Logiwa):** `create-kit-dialog.tsx` is now a 60% Drawer with WizardPills: **1. Confirmation**: a required Source location / LP scan, checked against the components' chosen locations/LPs, or the kitting area with picking; when every source is FEFO, a blank field confirms. Component cards carry Component qty / Total qty / Available chips. **2. Information**: Kit quantity, Target location*, Target LP, an **Attribute selection** section (lot, expiry, production) and the **Kitting task time range**. **3. Summary**: Inventory Transaction Summary (SKU · LOCATION · CURRENT QTY · signed QTY CHANGE: kit +n green, components −n red), with Component SKU qty / Component total qty chips, a partial vs completing note and lock/short callouts, then **Save**. Kit summary + Print kit barcode follow, as before. Pure helpers are in `src/lib/grid-defs/work-orders/kit-steps.ts` (`sourceScanCodes`, `matchSourceScan`, `createKitDeltas`, `disassembleDeltas`, `signed`), and the table is shared in `kit-delta-table.tsx`.
- [x] **Disassemble Kit is a 2-step drawer:** **1. Select kit**: Warehouse/Client/Kit when standalone, Source location / LP (kit stock bucket), Kit quantity, Target location / Target LP. **2. Summary**: a card per component with Component SKU qty / Component total qty / Stock qty chips and a **••• → Add attribute** menu that opens Lot / Expiry / Production inputs. Tracked components are required client-side and server-side. Also on this step: **Print product barcode** (product-label print, copies = qty returned) and the signed transaction summary. The API accepts a new optional `componentAttributes[]` on both `/api/work-orders/disassemble` and `/api/kits/disassemble`, stamped on the DisassembleKit receipts. A tracked component with no attribute is refused with VALIDATION.
- [x] **Partial build keeps the WO Open (Logiwa KS-REF-WO-001):** `createKit` only moves a without-picking WO out of Open on the final build (Open → In Process → Completed). A partial build patches processedQty and actualStartAt and stays Open ("Processed 1 of 2"). Because Open now can carry built kits, both client guards (`deleteReason`, `cancelReason`) and the server (`deleteWorkOrder`, `cancelWorkOrder`) refuse delete and cancel when processedQty > 0. `updateWorkOrder` also locks warehouse/client/type/kit/qty once kits exist.
- [x] **Validation copy:** "Warehouse is required", "Client is required", "Work order code is required", "Work order type is required", "Shipment order is required". The API returns the same strings.
- [x] **Work order code column:** 200 px with a tooltip for the full code. Job code is 150 px.
- [x] **Toolbar Print:** aria-label "Print work order documents" (distinct from the global printer button).
- [x] **Cancel in the row kebab** was already disabled with "Kits were already built from this work order" when processedQty > 0 (`cancelReason`). The 200 + failed[] the critic saw came from calling the bulk API directly, which is correct per-row reporting.
- Shared/foreign: Open pill teal (R2-7, re-filed), `/api/audit` entityId filter (R2-8), grid "Total: 0" while loading (R2-9). List latency is dev-server contention: during this round another module's compile error (`analytics-operational.ts` duplicate `busiest`) 500'd the API for a while.
- Checks: `npx tsc --noEmit` clean on owned paths. `npx vitest run tests/unit/work-orders-kitting`: 48/48. New tests: `kit-steps.test.ts` and disassemble per-component attributes; the lifecycle test now asserts partial = Open and no delete/cancel. Headless (admin, 1440): the Create Kit drawer walks Confirmation (empty scan → error; MLT1-C-01 → confirmed) → Information → Summary (+1 / −2 signed, lock callout for CNT000146 disables Save). Standalone Disassemble: validation on Next. 0 console errors. Screenshots: `%TEMP%/claude/kitstak-critic/work-orders-kitting/r3-*.png`.

## Round 2 (parity loop) — 2026-11-09, critic verdict 7 → fixes
Defect by defect (critic round 1 list, score 7):
- [x] **Count-lock aware sources (major).** Stock buckets now carry `lockedBy` (the count plan code, from `countLockFor`, looked up once per distinct location). New batched `GET /api/kits/sources?productIds=a,b,c&warehouseId&clientId` (`listStockBucketsFor`). `/api/kits/stock` shares the same code. `suggestSource` never picks a locked bucket. **Auto-assign all sources** makes one request for all components, skips locked stock, and reports "n of m sources assigned / only count-locked stock for X". The **Source inventory** modal shows a red `Locked · CNT000146` pill, disables the radio and row, adds a footnote, and won't Apply a locked source. Saved locked sources show a lock warning on the wizard component card (edit). Server: `validateSources` rejects a new or changed count-locked source with `components.<i>.locationId` = "MLT1-C-01 is locked by count plan …". An unchanged source that a count locks later doesn't block editing notes; Create Kit still refuses to post from it.
- [x] **Create Kit 3-step drawer** (Confirmation scan → Information → Summary) was already in place from round 3. The source scan is now also **enforced server-side**: optional `sourceScan` on `POST /api/work-orders/create-kit` is checked against the components' chosen locations and LPs (or the kitting area with picking) and rejected with VALIDATION on a mismatch.
- [x] **Kit quantity never silently clamped.** Create Kit and Disassemble have no min/max on the input. Out-of-range values show a live inline error ("At most 2 (requested − processed)", "Enter how many kits to build (at least 1)"), and Next stays disabled with the reason. Verified headless: typing 5 keeps 5, shows the error, and Next is disabled.
- [x] **Kit row CURRENT QTY:** kit on hand at the target location (and LP), 0 when none, 0 on error. While loading, a labelled spinner replaces "…". Measured headless: it resolves to `1` at KIT-01 once `/api/kits/stock` answers (8–16 s on the contended dev server; the old "never resolves" was that latency).
- [x] **Change log / Activity:** work order updates now go through `recordWorkOrderChanges`: human labels (`WO_FIELD_LABELS`: "Actual start date", "Processed quantity", "Kit quantity", …), date values formatted in the warehouse timezone (`formatLogValue` → "11/12/2026 10:30 AM EST"), output location shown by code, and "—" for empty values. Used by update, `patchWorkOrder` (Create Kit stamps, status) and disassemble. Verified live with a PATCH on KS-R1-WO-65279.
- [x] **Wizard work order code:** the next-code suggestion is refetched on every open and replaces an older auto-filled code until the user types. The field shows "Loading next code…" with a spinner, and a Retry link if the request fails. Copy uses "Work order code is required" etc. (round 3).
- [x] **Auto-assign speed:** one batched request (previously one per component, sequential). A live status line reads "Finding FEFO/FIFO sources for N components…". Next and the pencils are disabled while it runs.
- [x] **Source modal Apply** is disabled while stock loads, on error, with no row selected, or on a locked row (reason shown in a tooltip).
- [x] **Teal Open pill.** New module-local `wo-status.tsx`: `WoStatusPill` (Open = Logiwa teal `#D0F3EE`/`#16C2AA`, others from the shared work order map) is used in the grid, detail header, wizard and confirm dialogs. `WoStatusFilterPill` gives the status pill row a clearly **filled** active state in the status colour. This supersedes R2-1/R2-2/R2-7 for M08 screens.
- [x] **Kit Inventory / Kit Component Availability row ⋯:** Open product, View components, Component availability (pre-filtered), Work orders for this kit (pre-filtered), Create work order (prefilled wizard; disabled with a reason for kit-to-order). Components report: Open product, Used in kits, Kit(s) in Kit Inventory, Inventory of this component. Header widths come from `headerWidth(label)`, so the info icons no longer collide and the last header isn't clipped (screenshots `w2-kits-b.png`, `w2-kitcomp-b.png`).
- [x] **Edit after Completed:** `editReason` blocks only Cancelled. Completed and In Process work orders open the wizard with core fields locked (the callout explains). The server allows notes, instructions, dates and custom fields, refuses warehouse/client/type/kit/qty changes, and (new) refuses component-source changes once the work order is past Open. The detail page has the **Home › Inventory › Work Order › code** breadcrumb.
- [x] **Permissions:** `POST /api/kits/recalculate` needs `inventory.work_orders.create` (the viewer now gets 403, verified live) and returns the fresh stamp when called again within 3 s (`throttled: true`, with an "Already up to date" toast). The list toolbar hides Print, Warehouse ops and More for roles that can never use them (viewer, verified headless).
- [x] **Disassemble summary:** the 2-step drawer from round 3 is unchanged (chips, Print product barcode, signed summary, Add attribute). Locked kit stock is now labelled in the source picker, isn't preselected, and blocks Save with the plan code.
- [x] **Edit Component direct attributes (Logiwa Edit Component):** the Source inventory modal has an **Attributes** section. With picking you can clear the location and type a Lot / batch number, Expiry date and Production date, which restrict FEFO allocation. When a stock row is chosen its attributes are shown read-only.
- Shared: R2-10 filter chip (foundation GridToolbar), R2-11 and R2-12 change log labels and ISO formatting in the shared drawer.
- Checks: `npx tsc --noEmit` is clean on owned paths. `npx vitest run tests/unit/work-orders-kitting`: 58/58 pass. New: `round2-parity.test.ts` (locked buckets and suggestion, create rejects a locked source, an unchanged locked source still lets notes save, sourceScan mismatch is refused and a case-insensitive match is accepted, warehouse-tz date formatting, human labels on Create Kit stamps, Completed allows notes but blocks qty and source changes). The API test adds a viewer 403 on recalc and the batched sources route. eslint: 0 errors.
- Headless (admin + viewer, 1440): `r2ui.mjs`, `w2-trace.mjs`, `w2-kits.mjs`, `w2-log.mjs` under `%TEMP%/claude/kitstak-critic/work-orders-kitting/`; screenshots `r2-*.png`, `w2-*.png`. 0 console errors from M08 pages.

## Round 4 (parity loop), 2026-11-09

- [x] **Create Kit idempotency (major):** `createKitSchema.idempotencyKey` is optional. The drawer sends one key per build attempt (`newIdempotencyKey`) and clears it after success. The server stores the key on the Kitting receipt's line note (`idem:<key>`) inside the same transaction. A retry with the same key replays the first result (`replayed: true`), so components are never consumed twice, even with a stale version. Verified live: two POSTs with one key on KS-CRIT-R3-55192o returned the same receiptId, processed 1 (not 2).
- [x] **Stalled grid (major):** `/work-orders` shows a "Still loading work orders" callout with Retry after 10 s (`useStalled`, same as the detail page). The status pills no longer hide behind loading: they render at once with a "…" count, stay clickable, and show "—" if counts fail. The toolbar was already outside the loading state. The server is slow under shared load (1.5 to 14 s for status-counts in this run, 2.3 s for the list). This is filed as R2-16.
- [x] **Create Kit step 1 red border (minor):** the autofocused scan field uses a neutral info focus ring until Next fails validation. The brand primary is red. A global fix is filed as R2-15.
- [x] **Disabled Cancel in the kebab (minor):** when not allowed, the row kebab shows "Cancel work order (unavailable)" and "Delete" without the destructive red, plus the reason tooltip. On the detail page, the reason shows inline as the item description.
- [x] **Legacy status data (minor):** `repairLegacyPartialStatuses` normalizes without-picking, In Process, partially built, job-less WOs back to Open and writes a change-log entry for each. It ran once on the dev DB and repaired KS-R1-WO-28778 and KS-CRIT-R2-62569 (now Open, 1/3).
- [x] **Print dropdown (missing vs Logiwa):** the Print and Warehouse ops triggers always open. Print picking list and Batch picking list are both listed, each with its own selection reason.
- Filed: R2-13 (operator must not create/edit/delete WOs, foundation permission catalog), R2-14 (`/api/audit` entityId filter, admin-settings).
- Checks: `npx tsc --noEmit` shows no errors on owned paths. `npx vitest run tests/unit/work-orders-kitting`: 58/58 pass (7 files). New file `round4-parity.test.ts` covers idempotent replay, key shape and legacy repair. Headless scripts `r4.mjs`, `d.mjs` and `t.mjs` are under `%TEMP%/claude/kitstak-critic/work-orders-kitting/`, with screenshots `r4-*.png`. 0 console errors on /work-orders.

## Round 5 (parity loop), 2026-11-10

Fixes for the round-4 critic list (score 7.6):
- [x] **Transactions tab signed like Logiwa (major):** `woTxnView` (`src/lib/grid-defs/work-orders/wo-transactions.ts`) signs each ledger row by direction. From-only rows are −n (red), To-only rows are +n (green), and moves stay unsigned. Rows are labelled by role: "Kitting (kit output)" replaces "Receiving", along with "Kitting (component consumed)", "Disassembly (kit consumed)" and "Disassembly (component returned)". The raw type stays available as `ledgerType`. Verified live on KS-CRIT-R5-70257 (3294–3297): kit +2 green, components −2 red.
- [x] **Operator permissions (major):** `planningDeniedForRoles` (`wo-planning.ts`) blocks create, edit, delete and cancel for users whose only roles are the system Operator or Viewer. The server check runs before body validation (`plannerBody`/`assertPlanner` in `work-orders-api.ts`), so operator POST /api/work-orders now returns 403 instead of 400. Verified live: operator gets 403, manager gets 400 on an empty body. The UI hides Create work order, Edit, Delete and Cancel for these users through `useWoPlanner`; headless operator check: 0 "Create work order" controls. Create kit, Disassemble, Picking and Tag remain available. The catalog fix is still R2-13.
- [ ] **Documents 500 (major):** not fixed here. The 500 comes from the shared `/api/attachments` route for every entity type: the dev server's module graph is stale (inventory-commands factory missing). Filed as R2-17 with the log evidence.
- [x] **Time zones:** `formatInZone` (`wo-time.ts`) is now the single formatter for change-log values (server `formatLogValue`), the detail sidebar dates, Transactions "At", and the Create Kit summary. The detail API returns `warehouseTimeZone`. The shared drawer's Operation Date column is filed as R2-18.
- [x] **Create Kit step 3:** added a Kit Summary card with print (kit barcode, available before Save) and edit (back to Information) icons, plus a Kitting Process Summary block (Source location, Target location, Actual start, Actual finish in the warehouse time zone). Quantities are snapshotted once when the step opens ("Quantities as of …"). If a later refetch differs, a "Stock changed since this summary opened" callout offers **Use latest**. Save stays disabled ("Loading current quantities…") until the snapshot, including the kit row, has loaded.
- [x] **Print dropdown:** `printReason` now disables Print picking list and Batch picking list with "Built without picking: no picking list" for without-picking work orders and with a Completed reason for completed ones (list toolbar and detail More menu).
- [x] **Operation Type chooser:** the wizard already opens on the Kitting card panel for new work orders (screenshot `r5-wizard.png`). The critic's run likely came from a prefilled entry, which skips it on purpose.
- [x] **Detail tabs:** the panel switches at once (local state plus `history.replaceState`, no router round-trip; measured 79 ms). The focus ring is suppressed after pointer use and returns on the next key press. A shared fix is filed as R2-19.
- [x] **Dark mode pills:** `WoStatusPill` and the active status filter pill use a 20% accent tint, a lighter foreground and a hairline ring under `data-theme=dark` (`WO_PILL_TONE`). Screenshot `r5-dark.png`.
- Latency: list and detail first paint are still bounded by the shared dev server (R2-16). The detail tab switch no longer waits on the server.
- Checks: `npx tsc --noEmit` shows no errors on owned paths. eslint: 0 errors. `npx vitest run tests/unit/work-orders-kitting`: 69/69 pass, including the new `round5-parity.test.ts` (signing and labels, planning gate, print guard, TZ formatting). Headless scripts `r5.mjs` and `r5b.mjs` are under `%TEMP%/claude/kitstak-critic/work-orders-kitting/`, with screenshots `r5-*.png`. 0 console errors.

## Round 6 (parity loop), 2026-11-10

Fixes for the round-5 critic list (score 7.7):
- [x] **Operator toolbar (major):** re-measured headless as operator (`r6.mjs`, screenshot `r6-operator.png`). The toolbar shows Tag, Disassemble kit, Create kit, Print and Warehouse ops, and the grid loads (Open 8 / In Process 2 / Completed 8 / Shortage 1 / Cancelled 3). Only the planning actions (create/edit/delete/cancel) stay hidden. The critic's empty toolbar came from `useCan` while `/api/me` was still pending on the saturated server: `/api/me` alone took 8–17 s in this run, and the document took 44 s.
- [~] **Load time (major):** when the server is idle, `GET /api/work-orders` answers in 0.13–0.7 s and status-counts in about 1.6 s. Under the shared dev load, every route (including `/api/me`) takes 2–17 s, and the server intermittently returns empty 500s while other agents' edits recompile. The module itself does no N+1 work in the list path. This stays filed as R2-16 (dev-server contention). The fix needs a production build or less shared load.
- [~] **Documents (major):** the flow is `POST /api/files` (multipart, image/PDF only), then `POST /api/attachments {entityType, entityId, documentType, fileId}`, then list, then `GET /api/files/:id?download=1`. The list returned 200. The upload could not be proven this run because `/api/files` returned empty-body 500s while the dev server was recompiling (script `r6doc.mjs`). This remains R2-17 (shared route).
- [x] **Print dropdown with blocked selection (minor):** the menu now starts with a visible note ("Unavailable: <reason>"), and both items stay listed and disabled with the reason.
- [x] **Detail header on Completed (minor):** a disabled Create kit renders as a muted secondary button (not primary pink), with the reason tooltip. Edit reads **Edit notes** for In Process and Completed work orders, and its tooltip states the limit (notes, instructions, dates, custom fields).
- [x] **Client column (minor):** Client is 230 px (min 180) with a full-name tooltip. Tags shrank to 120 px.
- [x] **Kitting task regression:** the Kitting task handler now passes `completePendingPicks: true`, as its contract says, so executing the kitting task completes the open picks first. This fixed the failing `kitting-lifecycle` test after the new `settlePicking` guard.
- [ ] **Console parse error from `client-detail-page.tsx`:** another module's file. Not touched.
- Note: another process edited M08 files (disassemble-dialog, source-suggest, wo-client) during this run. That caused a transient Turbopack "componentStockAt doesn't exist" error, which resolved once source-suggest.ts was saved.
- Checks: `npx tsc --noEmit` shows no errors on owned paths. `npx vitest run tests/unit/work-orders-kitting`: 69/69 pass.

## Round 3 (parity loop): critic R2 7.4 fixes, 2026-11-10
- [x] **With-picking Create Kit follows the Logiwa sequence (major).** The server refuses Create Kit while Picking tasks are open: `INVALID_STATE`, "Components not yet picked to kitting area (0/3 picked). Complete the picking tasks first (Task #1664, …)". Verified live on WO000095. An explicit `completePendingPicks: true` on `POST /api/work-orders/create-kit` completes them first, but only for a planner with `inventory.work_orders.picking_job_operations` (operator gets 403, verified live). It writes a "Pending picks completed on Create Kit (confirmed): Task #…" change-log row. Rows carry pick counts (`pickTaskCount`/`pickDoneCount`). `createKitReason` disables Create kit with "Components not yet picked to kitting area (n/m picked)" for anyone who can't force. In the drawer, step 1 shows an attention callout that lists each open task (SKU, qty, from → to, status), plus a **Complete pending picks and build** checkbox for supervisors. Next stays disabled until the picks are done or the box is ticked. Step 1 "Available" is now **In kitting area** (`inKittingAreaQty`: Picked allocations not consumed), not warehouse free stock. The summary column reads "Current qty in kitting area", or "Reserved (picked on save)" with a warning callout when forcing.
- [x] **Pick rows on the WO Transactions tab.** The detail query also includes ledger rows whose `task_id` belongs to the WO's tasks, so Picking moves (job/task refs, no work_order_id) appear as "Picking (to kitting area)". Allocation rows read "Allocation (reserved)".
- [x] **One time-zone policy.** The warehouse zone with a suffix is used everywhere M08 renders a time: grid date columns (rows carry `warehouseTimeZone`), detail Details card, Receipts, Exceptions, Transactions, Create Kit summary, and the Excel export (datetime columns go out as zoned text, labelled "(warehouse time)"). `formatInZone` now prints "11/09/2026 11:43 PM CST". The shared Activity timeline is filed as R2-24.
- [x] **Disassemble CURRENT QTY** = component on-hand at the chosen target location/LP (`componentStockAt`, from batched `/api/kits/sources`), 0 when none. An **After** column was added to both summaries. Verified: D-02-01-1 shows 1/1/2, not 773/439/637.
- [x] **Grid pill race.** `/work-orders` hides a result whose rows don't match the active status filter behind the loading state and refetches that key once (stale-result guard). Headless: 8 rapid pill clicks ending on Cancelled show only Cancelled rows. The root cause in shared `use-grid` is filed as R2-22.
- [ ] **Print preview (CSP `frame-ancestors 'none'`, `/api/files` 500):** foundation/platform, filed as R2-21.
- [x] **Wizard Kit quantity** has no min/max clamp. "At least 1" / "At most 100,000" / "Whole numbers only" show inline (`kitQtyError`), and Next is disabled with the reason. Verified: 0 and 99,999,999 stay as typed.
- [x] **Kit-step sources callout** turns green, "All N sources assigned (FEFO)", once every component has a source (verified after Auto-assign).
- [x] **Wizard step pills re-validate on change.** Errors are re-checked live, so "1. General" leaves amber as soon as the step is valid. Server errors persist until their field changes.
- [x] **No page skeleton after Save.** Create no longer navigates away. The list stays mounted, refetches, and shows a "Work order KS-… created" callout with **Open** (it dismisses itself after 12 s). Row highlight is filed as R2-23.
- [x] **Kit row CURRENT QTY:** shows a labelled "Loading…", and after 8 s a timeout falls back to "n/a" so the summary never spins forever.
- [x] **Disassemble defaults:** the source defaults to the WO output location (KIT-01, 9 free), verified headless (`defaultKitBucket`). Component lot, expiry and production date are prefilled from the kitting consumption (`consumedAttributes` on the detail API, largest lot first), stay editable, and are marked "Attributes prefilled from kitting". The source field shows a labelled "Loading kit stock…".
- [x] **Disassembly labels:** components returned read "Disassembly (component returned)", using the receipt type, not "Receiving".
- [x] **Tab focus ring:** the mouse-click suppression now also zeroes the Tailwind v4 ring (`ring-0!`). Measured: mouse 0 px, keyboard 2 px.
- [ ] **768 px footer wrap:** shared DataGrid footer, filed as R2-23.
- Not exercised: the operator handheld Kitting/Picking task screens (another module owns them). The kitting task handler passes `completePendingPicks: true` for scan flows, and those picks now show on the WO Transactions tab.
- Dev server: during this run the shared module graph was intermittently stale ("inventory-commands module factory is not available", a counts compile error). `POST/PATCH /api/work-orders` and `/cancel` returned 500 from it, and `/api/work-orders/:id` served an older bundle without `warehouseTimeZone`/`consumedAttributes`. Unit tests cover these paths; see R2-16/R2-17.
- Checks: `npx tsc --noEmit` clean. `npx vitest run tests/unit/work-orders-kitting`: 82/82 pass. New: `round6-parity.test.ts` (pick gate, forced picks + change log + transactions, row pick counts, labels, consumed attributes, disassemble defaults, TZ/export, kit qty). eslint: 0 errors on owned paths. Headless scripts `r6*.mjs`, screenshots `r6-*.png` in `%TEMP%/claude/kitstak-critic/work-orders-kitting/`.

## Blind-judge repair round 1, 2026-11-10

- [x] **Filter chip label overflow:** shared `filter-chips.tsx` label is now `block w-full truncate` (full text in the title tooltip) and the chip strip keeps a `min-w-[8.5rem]` so the chip is never squeezed to "WORK". Headless at 768 px (`r7.mjs`, `r7b-768.png`): chip reads "WORK ORDER STATUS / open" on one label line.
- [x] **768 px footer wrap (R2-23):** shared `grid-footer.tsx` no longer wraps at md+: tighter gaps, pagination `shrink-0`, and the "| Selected: n" part is hidden below xl while nothing is selected. Measured footer height 45 px (single row) at 768 px.
- [x] **Highlight the created row (R2-23):** shared `data-grid-body.tsx` rows carry `data-row-id` (additive). `/work-orders` tints the just-created row green while the "created" callout is showing.
- [x] Already present, re-checked: row ••• menu has Change log and Delete (Delete confirms through the records dialog with the WO list); Kit Inventory has "Create work order" (prefilled kit, client, warehouse, required kitting qty) per row and in the toolbar.
- [ ] Not done this round: document upload/download proof (R2-17), print preview CSP (R2-21), handheld Kitting/Picking task screens, production-build timing and `/api/me` speed (dev server took 125 s for the first list load in this run), Build For = SO, URL-synced search with saved filter types.
- Checks: `npx tsc --noEmit` no errors on touched files; `npx vitest run tests/unit/work-orders-kitting` 82/82 pass.

## Blind-judge repair round 2, 2026-11-10

- [x] **Job code clipped / no tooltip:** Job code now sits next to the frozen Work order code column, and both have full-text tooltips. A new additive shared `meta.pinLeft` (grid-types + data-grid `columnPinning`) freezes Work order code by default, on top of any user pins. Operation type, WO type and Client columns are narrower. Headless 1440 px (`br2.mjs`, `br2-list.png`): every column through Work order type fits, and there are 0 page errors. Users who already have a saved column order keep it, so they still need "Reset" to get the new default order.
- [x] **Stale toolbar after actions:** the Create Kit, Disassemble, Picking and wizard (create and edit) callbacks now run `finish()`, which clears the selection and invalidates the grid, counts, detail and kit-stock queries. Before, they only cleared the selection.
- [x] **Open pill teal:** already teal in `wo-status.tsx` (`woStatusTone`). Re-checked in the screenshot.
- [ ] Not done this round (scope): list first-paint streaming, the Create Kit -> Completed e2e on KS-R1-WO-28778 (blocked on releasing CNT000146), Build For SO, Edit Component modal parity, document upload (R2-17), custom-field filters, Disassemble print/add attribute, the import template/history, and printable picking lists (R2-21 CSP).

## Blind-judge repair round 3, 2026-11-10

- [x] **Kit quantity clamps while typing:** the wizard input now clamps to a whole number from 0 to 100,000 on every change (`wo-wizard-steps.tsx`), so typing 99,999,999 ends at 100,000. 0 still shows "At least 1" and holds Next. When the value is invalid, the component chips and total use 0, so a total like 399999996 never appears.
- [x] Re-checked in code: Build For Stock | SO segment with a Select Shipment Order picker in General (`buildFor`/`shipmentOrderId` go through `wo-form.ts`), and the row ••• menu has Show details / Edit / Change log / Cancel / Delete.
- [ ] Not done this round: list/detail load reliability under dev load (R2-16), LP and attribute inputs plus Add Attribute in Create Kit/Disassemble, product barcode print from the summaries and real picking-list PDFs (R2-21), document upload (R2-17), custom fields on Other Info, the Create Kit to Completed e2e (KS-R1-WO-28778 count lock), and headless verification of the clamp.
- Checks: `npx tsc --noEmit` shows no errors on work-order paths. `npx vitest run tests/unit/work-orders-kitting`: 82/82 pass.

## Round 4 (parity loop), round-3 critic fixes (score 6.8), 2026-11-10

- [x] **Kit step stuck on "Loading kit and components…" after a 500 (major):** the wizard now shows the failure after the first failed attempt (`error ?? failureReason`), not only after the retry finishes. The Kit step renders an error callout, "Couldn't load kit HRB-KIT-GIFT", with the server message, a **Retry** button (spinner while it refetches) and guidance. Next stays disabled with the reason "The kit couldn't be loaded. Retry to continue". The kit query also has `timeoutMs: 20_000`, so a hung server turns into the same error state instead of spinning forever. The next-code query has 15 s.
- [x] **Next gating (major, Logiwa parity):** the new pure `stepBlockReason(form, components, step, kitState)` in `wizard/wo-form.ts` keeps Next disabled until the step is valid, and the disabled button's tooltip gives the reason. On General: "Complete Warehouse, Client, Work order code, Work order type", or a single message such as "Work order type is required". On Kit: "Select a client in step 1 first", "Select a kit to continue", Loading…, couldn't be loaded, "Kit quantity: At least 1", "Choose a source for 2 components". On Advanced: date-order errors. Fields are validated on blur: a `[data-field]` reports its own error once focus leaves it. Focus that moves into a portaled popover does not count as a blur. Server errors persist as before.
- [x] **Code suggestion never overwrites (minor):** once the user types in or clears Work order code, a late suggestion no longer replaces it. The suggestion shows as an explicit "Next in sequence: **Use WO000096**" link whenever the field holds something else.
- [x] **Print reprint for Completed (minor):** `printReason` allows Completed with-picking work orders. The server never plans new picks for them. `buildPickLists` behaves in three ways. With open picks, it prints them as before. When every pick is done, it reprints the picked lines ("Work Order Picking (reprint, picked)"). For a Completed work order with no pick tasks on record (seeded WOs), it reprints from the Kitting consumption ledger ("(reprint, consumed)": the location, lot and quantity actually taken).
- [x] **Seed/live inconsistency (major):** new idempotent `repairWorkOrderHistory` in `work-orders-commands.ts`. It (a) writes "Manual Allocation - Work Order" exceptions for Shortage WOs that have none, using the same planner as allocation, but only for components that are short now; and (b) backfills the Kitting receipt for Completed WOs from their kit-output ledger row. That receipt is linked through `inventory_transaction_id` and keeps the ledger time, and stock is not touched. It ran once on the dev DB and created receipts #70167, #70168 and #70169 for WO000088/90/91 (12/24/20 at KIT-01). WO000092 got no exceptions: its components are no longer short (773/440/637 free for 400). Its detail page now says "Stock now covers every component", with a primary **Retry allocation**, and the Exceptions tab explains the empty table. When components are short, the callout names them. The seed fix is filed as R2-27.
- [x] **Age header (i) (minor):** `headerClassName: "flex-row"` on the Age column keeps the info icon right after the AGE label. Before, the shared right-align reversal placed it beyond the invisible sort affordance, next to Status. Width is 90 px.
- [ ] **Skeleton column order / "Total: —" flicker (minor):** shared `DataGrid` prefs loading, filed as R2-25.
- [ ] **`/api/kits/components?pageSize=2` (minor):** every grid API, this one included, pages with `ps` (`?ps=2` works). A `pageSize`/`limit` alias belongs in the shared grid grammar, filed as R2-26.
- [ ] **Dev server (blocker, infra):** the server on :3000 (pid 47592, 5.7 GB) accepted connections but answered nothing within 30–100 s for this whole round, so the headless re-check could not run. The script is ready at `%TEMP%/claude/kitstak-critic/work-orders-kitting/r7.mjs`; it forces `/api/kits/:id` to 500 through `page.route`. Filed as R2-28. The process was not touched.
- Checks: `npx tsc --noEmit` shows no errors on owned paths. eslint: 0 errors (warnings were already there). `npx vitest run tests/unit/work-orders-kitting`: 90/90 pass. New: `round7-parity.test.ts` covers General/Kit/sources gating reasons, both history repairs (with idempotency and an unchanged stock check), and both reprint paths.

## Round 5 (parity loop): critic R4 fixes (score 7.4), 2026-11-10

- [x] **Lock-aware availability (major ×2).** New `src/server/repositories/work-orders-availability.ts` (`componentAvailability`) holds the one definition of usable free stock, the same rule as FEFO `candidateBuckets`: Stock, undamaged, location not locked or prevent-allocation, and not count-locked. It reports `usableQty`, `lockedQty`, `blockedQty` and `lockedBy`. It feeds:
  - the detail `ComponentRow` (`freeQty` is now usable, plus `lockedQty`, `lockedBy`, and `availableQty` = the chosen source's free qty, which is 0 while a count locks it). `shortQty` uses `availableQty`.
  - the wizard kit card (`getKitDetail`: chips and `netKittingCapacity`).
  - Kit Inventory capacity (`stockByKey.usable`).

  Pure helpers live in `src/lib/grid-defs/work-orders/wo-coverage.ts`: `componentCoverage` (consumed / covered / locked / short), `buildableKits`, `coverageSummary`, `createKitStockReason`, `retryAllocationReason`, `terminalBuildCopy` and `sourceLabel`. Read-only `tsx` probe against the live dev DB:
  - **WO000092:** usable HSE-12 0 (773 locked), SNG-12 1 (439 locked), FLTR-100 0 (637 locked), buildable 0, plans CNT000147 and CNT000148. This matches the Picking/job operations report ("need 2, free 1 / 0 / 0").
  - **HRB-KIT-GIFT kit card:** "can build 0", chips "0 free · 773 locked".
- [x] **Detail KPIs, Components tab and retry callout:**
  - "Usable stock covers N of M kits · rest locked by CNT…".
  - Components sublabel "3 locked by CNT000147, CNT000148".
  - Column "Usable now", with "+773 locked" underneath.
  - Status "Locked by CNT… · short N" (warning) vs "Short N" (danger).
  - In Shortage, Retry allocation is shown disabled with a `DisabledReason` unless usable stock covers every short component. The locked case gets its own callout linking to /counts.
- [x] **Create kit gate (major).** `createKitStockReason` disables Create kit on the detail header and on the list toolbar. The list fetches the single selected without-picking WO's detail. The reason reads, for example: "Component stock is locked by count plan CNT000147, CNT000148 (HRB-BAG-HSE-12, …). Finish, update or cancel the count first" (verified against KS-CRIT-R3-55192o data). Inside the drawer, step 1 cards show "Locked · CNT000148" or "N locked · CNT…" chips and an attention callout. Next is held with the reason, and a scan of a locked source (e.g. D-02-01-2) is rejected on step 1 with the plan code.
- [x] **Time zone (major, partial).** The Activity tab is now M08's own `WoActivity`, built from the detail timeline. Every time is shown in the warehouse zone with a suffix, and a "Field-level change log" button opens the drawer. Kit Inventory "Last updated" uses `formatInZone` in the listed warehouse's zone (rows carry `warehouseTimeZone`). The shared `ChangeLogDrawer`, `ActivityTimeline` and `DateTimePicker` still format in browser-local time, so a `timeZone` prop is filed as R2-29.
- [x] **`?create=1` deep link (major).** The wizard is no longer seeded from the URL in initial state. Once permissions resolve, the param is stripped. The wizard opens only when `can.create`, otherwise an info toast explains why. No next-code request goes out for viewer or operator.
- [x] **Code uniqueness on blur (minor).** New `GET /api/work-orders/code-available?code&exceptId` (create/edit permission; `isWorkOrderCodeAvailable`). It runs on blur of Work order code, and Next from General awaits the check when the code changed. A duplicate shows inline on step 1: "KS-… is already used by another work order". Live: `code-available?code=KS-CRIT-R4-38352` returns `{available:false}`.
- [x] **Next clickable (minor).** Next on General, Kit and Advanced is no longer disabled by validation. Pressing it validates the step, shows every inline error and focuses the first. It is held only while the kit loads or failed to load, while sources are being assigned, or while the code check runs. Warehouse defaults to the header context, then the user's `preferences.defaultWarehouseId`, then the only warehouse.
- [x] **Kit quantity (minor).** New `KitQtyInput`, a text input that never rounds: 2.5 stays and shows "Whole kits only", -5 shows "At least 1". Only values above 100,000 are clamped. ArrowUp and ArrowDown step by 1.
- [x] **Terminal work orders (minor).** Cancelled and Completed show "Cancelled 11/10/2026 05:06 AM CST · 0 of 3 built" and hide the coverage and picking prompts. Components show Cancelled or Completed, and the Usable column shows "–". The source reads "FEFO at allocation" until something is allocated ("FEFO at build" without picking).
- [x] **Details panel padding / floating tab (minor):** the panel uses `pr-5`, and the page content has `lg:pr-10` so the fixed "Feedback & Updates" tab never covers values.
- [x] **Stable header (minor):** a custom header with actions `shrink-0` at top right. The meta line wraps under the title, so actions never drop to a second row.
- [x] **Toolbar layout shift (minor):** while permissions load, the list renders disabled placeholder buttons (Tag, Disassemble kit, Create kit, Print, Warehouse ops, Import, Create work order).
- [x] **Type column (minor):** shows "With picking" / "Without picking", with the full name in the tooltip, at 150 px.
- [x] **Barcodes on print (minor):** Create kit prints `kit.barcode` (e.g. 841000035162), and Disassemble prints each component's barcode, falling back to the SKU only when there is none.
- [x] **Copy (minor):** the breadcrumb reads "Work Orders" on the list and detail. The Kit Inventory helper now reads "Monitor kit-to-stock inventory, kitting capacity and how many kits to build."
- [x] **Kit Inventory columns (missing vs Logiwa):** Required kitting qty, Net kitting capacity, Current and Pending now sit right after the product name. The descriptive columns follow. Saved user orders are kept.
- [ ] **Export toast (minor):** the shared `ExportButton` only toasts after the 202, so this is filed as R2-30. **768 px footer with a selection:** shared, filed as R2-31.
- [ ] **Not verified in the browser this round:** the dev server returned 500 "Jest worker encountered 2 child process exceptions" for every dynamic route (`/api/work-orders/[id]`, `/api/orders/[id]`, `/work-orders/[id]`). `/work-orders` did not finish loading in 500 s. Filed as R2-32. Static routes answered (status-counts, code-available). The detail and kit logic was checked read-only against the live DB with `tsx` (`%TEMP%/claude/kitstak-critic/work-orders-kitting/p5/readonly-detail.ts`). The headless script `p5.mjs` (modes `api`, `detail`, `deeplink`, `wizard`) is ready for the critic.
- Still open from missing-vs-Logiwa: a mandatory source scan for FEFO components; explicit kit attributes in Disassemble step 1; the kit receipt ledger type (Receiving vs Kitting, a ledger rules change in foundation); a Kit Inventory KPI strip.
- Checks: `npx tsc --noEmit` is clean. `npx vitest run tests/unit/work-orders-kitting`: 100/100 pass. New `round8-parity.test.ts` covers coverage states, buildable, retry and Create Kit gates, terminal copy, source labels, "Whole kits only", DB-backed usable vs locked availability, kit card and Kit Inventory capacity under a count lock, detail lock, short and barcodes, and code availability. eslint: 0 errors.

## Round 6 (parity loop): critic R5 fixes (score 4.8), 2026-11-10

- [x] **One availability function (major).** `work-orders-availability.ts` is now the only definition of usable free stock:
  - `freeStockRows` makes one query and flags each bucket with the foundation `notCountLocked`.
  - `classifyFree` (pure) sorts each bucket: count lock first (locked), then a locked or prevent-allocation location (blocked), otherwise usable.
  - `aggregateAvailability` adds the buckets up and looks up plan codes only for locked bins.
  - `componentAvailability` (detail, wizard kit card, Create Kit guard) and the new `availabilityByKey` both go through it.

  `availabilityByKey` feeds Kit Inventory's `stockByKey.usable`, which replaces the second SQL definition in `kits.ts`.
- [x] **Stale Kit Inventory snapshot.** `listKitInventory` now recalculates when `kit_inventory_stats` is older than `KIT_STATS_MAX_AGE_MS` (2 min), not only when the table is empty. A count lock created after the 15-min scheduler run now shows within 2 minutes; the scheduler and Recalculate Now are unchanged. Read-only probe of the dev DB (`r9/check.ts`): `computeKitStats` takes 21 ms for 9 rows, and stored, live and kit-card capacity show 0 mismatches. The DB was reseeded at 12:17Z, and the earlier 498-vs-0 rows no longer occur.
- [x] **Kit output ledger type (major).** Live Create Kit now posts the kit row as **Kitting**, the same as the component consumption and as Logiwa. Disassemble (WO and standalone) posts the component returns as **Disassemble Kit**, matching the kit consumed. The rows are retyped in the same transaction (`retypeReceiptTxn`) until foundation `recordReceipt` takes a ledger type (R2-33).
  - `repairWorkOrderHistory` also backfills older "Receiving" rows that are linked to Kitting or DisassembleKit receipts (`retyped` count; idempotent; stock untouched).
  - Applied to the dev DB: Kitting receipts were created for WO000088/90/91, and 0 rows needed retyping after the reseed.
  - The seeded "Inventory Movement" rows ("Kits put away to pick face") are real putaway moves from KIT-01 and stay as they are.
- [x] **Shortage "stock now available" flag (minor).** Shortage list rows now carry `buildableQty` and `stockNowAvailable`, computed lock-aware through the same `listComponents` as the detail and the pure `shortageRecoverable`. The status cell shows a green "Stock in" chip next to the pill. Its tooltip reads "Stock now available: usable stock covers every component. Retry allocation from the work order. Can build N of M left." Probe: WO000092 can build 448 of 400 left, so the flag is set.
- [x] **List loading states (major + minor).**
  - Status pill counts show a pulsing count skeleton, not a literal "…".
  - Counts time out after 20 s and then show "—" with a reason tooltip and a **Retry counts** button.
  - While `/api/me` loads, Create work order is wrapped in `DisabledReason` "Checking permissions…".
  - After 15 s (`WO_STALL_MS`) a role=status callout appears: "Still loading work orders…" or "Still checking your permissions…", with Retry (refetches the grid and/or `/api/me`). The grid request itself already fails into the error state with Retry at 30 s (shared `GRID_TIMEOUT_MS`).
  - WO detail loads in the detail page (30 s), Create Kit, Disassemble, the Edit wizard and the toolbar Create Kit gate (20 s) now time out into their error callouts, which have a **Retry** button.
- [x] **Mandatory source scan (missing vs Logiwa).** Create Kit step 1 now always requires a Source location / LP.
  - All-FEFO without picking: the dialog loads the component bins (`/api/kits/sources`), and `fefoScanCodes` accepts any bin or LP with usable free stock (count-locked or empty bins are rejected). The hint lists them ("A-01-01, … or N more").
  - The server checks the same rule (`fefoSourceCodes` inside `assertSourceScan`), and `sourceScan` is always sent. The summary shows "A-01-01 (FEFO)".
  - Expected-code lists in errors are capped at 4.
- [x] **Test data hygiene (minor).** The dev DB was reseeded (12:17Z): only the seeded WO000088–095 exist and no KS-CRIT/KS-R1 work orders are left.
- [x] Re-checked: the 22 Logiwa list filters, including Custom Field Date 1-3, Drop Down 1-2, Text Box 1-3 and Toggle 1-2, are in `WORK_ORDER_GRID_FIELDS` / `useWoFilterFields`. Slot names come from `/api/custom-fields`.
- [ ] **Browser walk blocked (infra, R2-35).**
  - `/work-orders` stayed on the (app) layout skeleton for 300 s, with no sidebar and no client mount (`r9/list-300s.png`).
  - `/api/work-orders/WO000092` returned 500 "Jest worker…" after 147 s, and static APIs took 70–137 s.
  - The 401→logout bounce is in foundation `api-client`, filed as R2-34.
  - Headless script ready: `%TEMP%/claude/kitstak-critic/work-orders-kitting/r9/list.mjs` (screenshots at 20/45/90/180/300 s, plus a hover on the "Stock in" tooltip).
- [ ] Not done this round: kit Expiry/Production/Lot fields on Disassemble step 1 and the component ••• "Add Attribute"; document upload proof (R2-17); print preview CSP (R2-21); handheld Kitting/Picking task screens; URL-synced search with saved filter types.
- Checks: `npx tsc --noEmit` shows no errors on owned paths. eslint: 0 errors (8 old warnings). `npx vitest run tests/unit/work-orders-kitting`: 108/108 pass.
  - New `round9-parity.test.ts` covers: classify order; stats equal kit card and listed row under a count lock; stale-snapshot refresh; Kitting / Disassemble Kit ledger types; retype backfill (idempotent, stock unchanged); FEFO scan codes and server rejection; the shortage flag.
  - `kitting-lifecycle.test.ts` was updated for the Kitting kit row and the 3 Disassemble Kit rows.

## Blind-judge repair round 1, 2026-11-10

- [x] **Wizard Kit step stale error:** "The kit has no components…" is no longer raised against the previous kit while a newly selected kit loads (`validateForm(..., { componentsLoaded })`). Any such error is dropped from the view once the kit's components arrive (`shownErrors`, derived, so no effect is needed). The source dialog now reads "1 unit is needed" / "N units are needed". Server copy is pluralised too ("of 1 unit available", "1 component unit short"). Headless: `EARLY/LOADED kit err: false` on HRB-KIT-GIFT.
- [x] **Change log modal zone:** both `ChangeLogDrawer` usages (the list row menu and the detail "Field-level change log") pass the warehouse `timeZone`, falling back to `DEFAULT_WAREHOUSE_ZONE`. OPERATION DATE now reads "11/05/2026 08:21 AM EST", the same as the rest of the page.
- [x] **Create kit, one scan per source:** new pure `sourceScanGroups` / `groupOfScan` (kit-steps).
  - Without picking, each chosen source location is a group, and its LP confirms it too. With picking, the kitting area is the one group. FEFO components need no group, and an all-FEFO work order keeps the single-scan rule.
  - Each scan checks off its group and clears the field. The header shows "1 of 3 sources scanned" with a chip per location, each component card shows "Scanned D-02-01-2" or "Scan D-02-01-3", and Next moves on only when every group is scanned. Pressing Next with nothing scanned names the locations still to scan.
  - The Summary shows "Source locations (3, each scanned)", with one line per location and the SKUs it feeds, instead of a single source.
  - The server takes the scans comma-separated and checks each one (`sourceScan` max is now 600).
  - Headless on KS-J1-5651 (D-02-01-2 / D-02-01-3 / B-03-05-1): it took 3 scans, then went to Information.
- [x] **Picking job with only a Kitting task:**
  - Seed: In Process with-picking work orders now write one Picking task per allocation slice (bin → KIT-01). Each is linked through `allocation.taskId`, Kitting is sequenced last, and `rollupJob` runs. New `judge1-seed.test.ts` checks this on a full seed.
  - Dev DB: the new idempotent `repairMissingPickTasks` (also returned by `repairWorkOrderHistory().pickTasks`) gave WO000093 and WO000094 their 3 Pending Picking tasks each (Job005254 now "0 of 4 tasks done").
  - Server: `createKit` refuses a with-picking build when the job has no Picking tasks but open allocations exist ("…no picking tasks exist yet (0 picked)"). `completePendingPicks` can't override this.
  - Client: the drawer holds Next with the same reason, and `createKitReason` gates when `pickTaskCount === 0` and nothing is in the kitting area.
  - Detail tasks are ordered by job sequence.
  - With real picks pending, a supervisor's header Create kit is now secondary, with a "0/3 picked" badge and a tooltip. The drawer still requires "Complete pending picks and build".
- [x] **List Create kit reason:** the toolbar button is `aria-disabled` (not `disabled`), so it stays hoverable and focusable. Hover or focus shows the reason tooltip, and a click shows an info toast with the reason (e.g. WO000095: "Run Picking/Job Operations first to allocate the components"). An enabled candidate (KS-J1-16208) still opens the drawer.
- [x] **Kit quantity typed value:** checked headless. A scripted `fill("2")` in the wizard saved `requestedQty: 2` (KS-J1-16208), and `fill("1")` in the Create Kit Information step built 1 (processedQty 1). Related fix: `focusFirst` used to focus the label's (i) InfoTip button before the input (selector-list document order), which popped a tooltip over the drawer. It now focuses the input or textarea first.
- [x] **Create kit success:** the success toast was removed. The drawer's role=status success card ("1 HRB-KIT-GIFT kit built…") is the confirmation, and no toast covers it (0 toasts after save).
- [x] **Disassemble Summary row actions (edge):** `KitDeltaTable` takes optional per-row `actions`. Disassemble component rows get Print (prints that one component's barcode: "1 record selected") and Edit (opens that card's lot / expiry / production fields, scrolls to them and focuses them). Each card's ••• menu also gains "Print barcode".
- [ ] **Mobile partial-kit / multi-source scanning:** not done. Handheld kitting screens are not in M08's file set.
- Test data on the dev DB: KS-J1-5651 (without picking, 1 of 2 built, partial) and KS-J1-16208 (Open, 2 kits).
- Harness note: other agents' edits trigger dev full reloads about every second. The headless scripts (`%TEMP%/claude/kitstak-critic/work-orders-kitting/j1/*.mjs`) forward the HMR socket but drop the reload messages, so a drawer isn't wiped mid-walk. App timers are not touched.
- Checks: `npx tsc --noEmit` shows no errors on owned paths. eslint: 0 errors (11 old warnings). `npx vitest run tests/unit/work-orders-kitting`: 14 files, 120 tests pass. New `judge1-repair.test.ts` covers the load-aware kit error, scan groups, the no-pick-task gate (server and model), the pick-task repair (linked, sequenced, idempotent) and comma-separated multi-source scans. New `judge1-seed.test.ts` covers the seeded pick tasks.
