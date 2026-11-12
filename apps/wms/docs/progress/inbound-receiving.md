# M05 inbound-receiving — progress

Round 1. Read first when resuming.

## Done (server, from earlier session)
- Repositories: purchase-orders (list/detail/code check/product info/requirements), -commands (create/update/cancel/delete/status), -receive (partial + full receive, putaway suggestion, LP create adapter), -print (PDF doc, labels, billing xlsx), -export, receipts (list/detail/cancel), vendors (CRUD/active/ensure).
- API routes under /api/purchase-orders, /api/receipts, /api/vendors. Import handler purchase-orders, search provider pos, export providers.
- Requests REQ-1..8 filed in docs/requests/inbound-receiving.md (adapters in place).

## UI (this session)
- fields.tsx (form wrappers), vendor drawer, vendors page, PO list wiring, wizard (create/edit), detail rail, receive drawer, receiving history + receipt drawer.

## Remaining / decisions
- po-serials import stays stub until REQ-7 (schema) lands; "Remove serial number" disabled with reason.
- PO "Started" after partial receive is persisted by settleStatus (REQ-1 formalises the edge).
- Cancelling the only receipt leaves the PO Started (there is no Started → Pending edge in the machine). This is intentional.

## Session 3 (2026-11-06): verification
- tsc is clean for the owned paths. The only error left is `scripts/verify-data.ts` (REQ-8), which is outside M05's ownership.
- Vitest: 3 files and 21 tests pass. New file: `tests/unit/inbound-receiving/po-import-bulk.test.ts`.
  - The import handler creates or reuses vendors and appends lines to a Pending PO.
  - Bulk Receive PO receives into the default receiving location and completes the PO.
- Acceptance run live against the dev DB through the API. Test records: KS-E2E-PO-1, KS-TEST-PO-BULK-1 and -2, and vendor "KS-TEST Bean Supply". Results:
  - **Create:** 2 lines and a new vendor give a Pending PO with Purchase Price 60 (Σ qty×price). code-check flags the duplicate inline, and a duplicate create returns 409.
  - **Validation:** a wrong pack type is rejected. A lot-tracked line without lot or expiry returns 400 with per-field errors.
  - **Partial receive:** 6 of 10 with lot L123 and expiry +180 d, into the suggested location D-02-05-1.
    - The PO becomes Started.
    - 1 receipt of type Purchase Order.
    - Inventory holds 6 units at D-02-05-1 with lot L123.
    - An inventory_transactions Receiving row is written.
    - change_log has the line and status rows.
  - **Cancel and full receive:** cancelling the receipt reverses the inventory. Over-receipt needs an explicit confirm. A full receive completes the PO and stamps completedAt. A cancel after that is blocked with "A received line of an order in completed status can't be cancelled."
  - **Bulk receive:** Receive PO on 2 Pending POs completes both, with receipts at MLT1-RECV.
  - **Vendors:** the scoped vendor list only shows the client's own vendors. Deactivating a vendor with open POs returns 409.
  - **Grids and downloads:** every PO, receiving history and vendor filter and sort returns 200. The PO PDF, billing-charges xlsx, labels and LP types endpoints all respond.
  - **Routes:** all 6 owned routes render 200 on the server with no error overlay and no "Coming soon".
- Not done: clicking through the UI in the browser. The shared Browser pane was at its tab cap for the whole session, so no tab could be opened. That is the next step.

## Session 4 (2026-11-06): browser walk
The shared Browser pane was at its tab cap again, so the UI was driven with headless Playwright against the shared dev server. Every route, wizard step, drawer, menu, kebab, bulk action, sort, filter and export was clicked through.

### Bugs found and fixed
1. **Wizard product search showed nothing (REQ-10).**
   - Step 2 search returned no results, even for an exact SKU. The shared `ProductSearchAdd` parses `{sku,name}`, but `/api/pickers/products` returns `{label,sublabel,meta}`.
   - Added the local adapter `wizard/po-product-search.tsx`, with a unit test.
   - REQ-10 is filed. M01's order wizard uses the same component and has the same problem.
2. **Vendor drawer could not save with the client locked.**
   - A disabled RHF field is left out of submit, so `clientId` was undefined. The result was a 400 with raw Zod copy: "expected string, received undefined".
   - This broke both "Add new vendor" in the wizard and every vendor edit.
   - Fix: the drawer restores `clientId` from the vendor or the default.
3. **Hydration mismatches** on `/receiving`, `/receiving/vendors`, `/organization/vendors` and `/receiving/new`.
   - Permission-gated header actions rendered on the first client pass but not on the server.
   - Added a hydration-safe `useCan` in `receiving-shared.tsx` (same approach as catalog's `useCatalogCan`) and switched every M05 component to it.
   - The vendors header now always passes a fragment.
   - Every route was rechecked twice: clean.
4. **Vendor step layout.**
   - The fixed-height wrapper let the grid overflow onto Back/Next once there were more than 8 vendors. It is now a flex column, so the grid scrolls.
   - The multi-select checkboxes, which included select-all, are replaced by a radio column, so exactly one vendor can be selected.
5. **Docs drawer:** closing it now refreshes the rail document count.

### Verified in the browser
- **Create:** the inline duplicate check, then "Add at least one product" on an empty Next. Two lines via the drawer give 60.00 USD. A new vendor via the drawer shows the required-field errors, then is auto-selected. Confirm shows the vendor and address cards. The success screen has 3 cards, and the list shows Pending at 60.00 USD.
- **Detail page:**
  - Other actions menu.
  - Edit with the client locked and Save, which bumps the version.
  - Status pencil (reason required), Pending → Started.
  - Change log entries.
  - The billing xlsx download.
  - Document upload and the docs drawer.
- **Receive:**
  - The putaway suggestion shows its reasons.
  - Tracking-guard message.
  - 6/10 with L123 and +180 d at D-02-05-2 makes the PO Started, with a −4 red pill.
- **History:**
  - The Master ID drawer shows the ledger transaction.
  - Kebab Cancel, with Logiwa's confirm copy, reverses the receipt.
  - A full receive completes the PO.
  - After that, Cancel is disabled with "A received line of an order in completed status can't be cancelled." The server returns 409 with the same message.
- **List:**
  - Bulk buttons are disabled with no selection.
  - Import menu (2 items).
  - Receive PO on 2 Pending POs makes both Completed, at MLT1-RECV.
  - Label menu and print modal, and the Tag popover.
  - Cancel order, and Delete via kebab. Delete is disabled on Completed POs.
- **Vendors:**
  - Both tab groups.
  - Filters (Client, Company name, Company nickname, Active).
  - The edit drawer: client locked, the billing toggle shows its section, and save is written to the change log.
  - Deactivate is blocked when the vendor has open POs. Deactivate and activate work otherwise.
- **Grids:** sort updates the URL and the request. Exports start (POST /api/exports). The import page renders.

### Tests
- **Vitest:** 4 files, 24 tests passing. Added `po-product-search.test.ts`.
- **Playwright:** `tests/e2e/inbound-receiving/po-acceptance.spec.ts` has 3 tests, all passing: create, partial receive with the guard, then cancel, full receive and cancel blocked. Run it against the existing server with:
  `E2E_BASE_URL=http://localhost:3000/ npx playwright test tests/e2e/inbound-receiving --project=e2e --no-deps`
  The trailing slash skips the webServer block.

### Known and out of scope
- The print modal's 404 on `/api/printouts` belongs to M14. The modal falls back by design.
- REQ-11: Wizard `canProceed`, so Next can be disabled with no lines. Today the step schema blocks Next with an inline error instead.
- REQ-6, REQ-7, REQ-8 and REQ-9 are still pending.
- **Test records:** KS-TEST-UI-*, KS-TEST-LIST-104903-A/B/C (D was deleted), KS-TEST-DETAIL-E, KS-TEST-E2E-*, and the vendors "KS-TEST Vendor ######".

## Round 1 (parity loop) — 2026-11-09
Checked against references/logiwa-live/inbound-inventory.md (§1–2 and the delta list).
- Wizard Products step: new lines are now **prepended**, as in Logiwa. The add toast now uses Logiwa's copy: "N product with SKU X added successfully." (`wizard/step-products.tsx`).
- Already at parity, verified in code: the bulk toolbar order (Tag, Label, Cancel Order, Receive PO, Delete), the Label menu (Product label opens the Print Options modal; Purchase order opens the PDF), Delete with a disabled reason for POs that have receipts, row kebab (Show details, Edit, Change log, Delete), and the 3-card success screen.
- Deliberate divergences:
  - KitStaks shows the status pencil while Pending, since Pending → Started is a legitimate edge. Logiwa hides it.
  - Delete is synchronous and gives explicit per-row reasons. Logiwa's delete is async and fails silently.
  - Bulk buttons re-disable when the selection clears. Logiwa has a bug here and leaves them enabled.
- Shared gaps filed as Round 2 requests: the Print Options "Use as Line Quantity" toggle, and Wizard Next disabled until valid.
- Checks: tsc shows no errors in receiving paths. `vitest tests/unit/inbound-receiving`: 4 files and 24 tests pass. A headless UI re-walk was not run in this round.

## Round 1 (parity loop), pass 2 (2026-11-09)
Checked against references/logiwa-live/inbound-inventory.md §1–4 and its delta list (items 2, 4, 6, 7, 9 and 11).
- **Next Step is disabled until the step is valid (Logiwa parity).**
  - The details, products and vendor steps each pass `canProceed: firstIssue(stepSchema)`. The first failing rule is shown as the DisabledReason tooltip, e.g. "Warehouse is required", "Add at least one product" or "Select a vendor".
  - Errors still appear on blur, since the wizard form uses `onTouched`.
  - A duplicate PO number keeps Next disabled.
  - Verified headless: Next is disabled on an empty step 1, and stays disabled after choosing warehouse and client. It enables once the PO number is entered. Step 2 needs 1 line and step 3 needs a vendor before Next enables.
- **Edit Step 2 Export.**
  - On the PO detail (edit), the Products step has an **Export** button next to Label, like Logiwa. It downloads `<PO>-lines.csv`: the selected lines, or all lines when none are selected.
  - The CSV is UTF-8 with a BOM and has 16 columns, including Open Qty. Line selection checkboxes were already there.
  - Verified headless: the download works and the content is correct. Export is hidden on create.
- **"Change Purchase Order Status" modal.**
  - The four statuses appear as radio pills. The current one is marked "Current", and the ones the state machine forbids are disabled, with a reason in the title. Arrow keys move between the enabled pills.
  - The reason field (required) and the change-log row are kept.
  - Verified headless: the pills on a Pending PO are Pending Current [disabled], Started, Completed and Cancelled. Changing to Started returns 200, and the toast reads "… is now Started".
- **Re-open stamps.** `statusChangeStamps()` clears Completed and Actual Receiving when a Completed PO moves back to Started. The edge itself is shared, so it is filed as REQ-R2-3.
- **Receiving History empty state** uses Logiwa's copy: "There is no receiving history." plus the link "You can create purchase orders here." The link is shown only to users with PO create permission.
- **Flaky test fixed** (foundation pass 2 note). `linesFor` now orders by `createdAt, rowid`, which is entry order, instead of `createdAt, sku`. `po-lifecycle.test.ts` passed 5 of 5 runs.
- **Deliberate divergences, kept:**
  - A cancelled receipt stays in Receiving History with a red "Cancelled" badge for the audit trail. Logiwa removes the row.
  - Receive PO from Other actions asks for a one-step confirm that names the target location.
  - The status pencil is shown while Pending.
- **Checks**
  - tsc: no errors in M05 paths.
  - `vitest tests/unit/inbound-receiving`: 5 files and 35 tests pass. The new file is `po-parity-r1.test.ts`, with 11 tests covering the gates, the pill reasons, the CSV and the stamps.
  - Headless crawl of `/receiving`, `/receiving/history`, `/receiving/vendors`, `/receiving/new`, `/organization/vendors` and a PO detail: no console errors and no 4xx/5xx responses.
- **Test record:** KS-TEST-R1-MWA39RUF (Started), and KS-TEST-R1-MWA36BJW (an abandoned draft, never created).

## Round 2 (parity loop), 2026-11-09, pass 3: critic round 1 fixes (score 6.5)
- **Build stability (blocker).** `csvCell` uses `/[",\n\r]/` and `linesCsv` is exported. tsc is clean on every M05 path. `po-parity-r2.test.ts` now covers CSV quoting with commas, quotes and newlines.
- **Viewer read-only (major).** `/receiving/[id]` checks `inventory.purchase_orders.edit`. Without it:
  - The H1 is "Purchase order".
  - A read-only `ReadOnlyPo` review replaces the wizard. It has the lines table, the Vendor and Order details cards with no Edit links, and a "View only" note.
  - The rail has no Save button, no step links and no progress ring.
  - Verified as the viewer: 0 Save buttons and 0 Edit buttons.
- **Receive items drawer (major).**
  - Quantity is checked live. Typing `-3`, `0`, `1.5` or clearing the field shows "Enter a quantity of at least 1" at once.
  - Receive is disabled while any included line is invalid, and its tooltip gives the reason (`receiveQtyIssue`).
  - The footer unit total ignores negative values.
  - Putaway suggestions are debounced (400 ms), only fetched for valid quantities, and keep the previous result while refetching. The hint no longer sticks on "Finding…".
  - Verified: a partial receive of 2 units posted, and PO002242 went Pending → Started with 2 received.
- **Putaway hint (major).** `putawayAlgorithmLabel()` turns `SAME_SKU_EMPTY_LOCATION_ALGORITHM` into "Same SKU, empty location". The line shows the first reason followed by "+N more" (`shortReason`); the full reasons and the rule name are in a `title` tooltip.
- **Step 2 Add product drawer (major).**
  - Quantity is prefilled from the search-row stepper (verified 10 → 10).
  - Apply is disabled until the line schema passes, with the first issue as the tooltip (verified: empty quantity disables Apply).
- **Page gutter (major).** `/receiving/new` and `/receiving/[id]` wrap the wizard and receipts in `px-6`. The stepper and card start at x=24, the same as the header, and Step 5 is no longer clipped.
- **Step 5 / success (minor).**
  - The success screen shows as soon as POST returns; cache invalidation runs in the background.
  - "Cancel order" is hidden on the success screen (`onCreated`).
  - While the vendor loads, the Vendor card shows the vendor name with a small skeleton.
  - `/receiving/new` shows a skeleton instead of a blank body while `/api/me` loads.
- **Step 1 (minor).** The PO number field no longer shows a counter (`TextF hideCount`; the limit of 50 is in the info tip and still enforced), so its error sits right under the input. Next is gated (`canProceed`).
- **List grid (minor).** Total quantity shows the bar inline to the left of the number, which is vertically centred. Truncated text cells have a `title` tooltip.
- **Receiving history (minor).** The H1 is "Receiving History". The row kebab exposes the menuitems "Show details" and "Cancel receiving" (verified via role=menuitem).
- **Detail rail (minor).**
  - Duplicate facts are merged. The price block keeps Total, SKU count and quantity; the Summary keeps code, type, vendor, client, date, status and received.
  - The status pencil is hidden on Pending.
  - The empty Documents state reads "No documents yet" in neutral text.
- **Not fixed here (shared code):**
  - Change log date formatting (REQ-R2-4).
  - A wizard `readOnly` prop (REQ-R2-5; worked around).
  - A picker popover that swallows the first outside click (REQ-R2-6).
- **Checks**
  - tsc: clean on M05 paths.
  - `vitest tests/unit/inbound-receiving`: 6 files and 41+ tests pass.
  - Headless Playwright: viewer detail, admin receive flow, wizard step 1 and 2 drawer, history kebab. No console errors.
  - The dev server was heavily loaded during the run (`/api/me` took 10 to 50 s).

## Round 2 (parity loop), 2026-11-09, pass 4: critic round 1 fixes (score 6.8)
- **PO Receiving Report (blocker).** The meaning of `purchase_order_lines.uom_quantity` is fixed as the **pack ratio**. Every M05, ATP, product-detail and import path already uses it that way. The report SQL belongs to M13, so the exact fix is filed as **REQ-R2-7**: `po_uom = ordered_quantity * uom_quantity`. The raw "Receiving" status in the report is filed as **REQ-R2-8**.
- **Confirm dialogs no longer hang.**
  - Bulk Cancel, Receive and Delete, the detail Other actions, and Cancel receiving now resolve as soon as the mutation answers. Grid and query invalidation run in the background, and an error toasts and closes cleanly.
  - Measured headless: bulk Receive PO response took 6.6 s and the dialog closed **0.18 s later**. Cancel receiving closed 0.1 s after its response.
- **Receive PO gated for tracked lines.**
  - The server computes `receiveAllBlockedReason` per PO in `purchase-orders.ts` `receiveAllBlockers`. It runs a cheap EXISTS pre-filter, then the exact screen-config-aware check.
  - It feeds the list bulk button, through `receiveAllReason`, which also covers "fully received", and the detail menu item. Example: "Lot, expiry and serial tracked lines must be received with Receive items (CPL-BAG-MED-12)."
  - `receiveAll` throws the same reason. Verified: the PO002237 menu item is `aria-disabled`.
- **Inline "X is required." on blur.** `wizard/use-blur-validation.ts` validates touched step-1 fields against `detailsStepSchema`. Messages follow Logiwa's "<Label> is required." pattern. The PO number counter "0 / 50" is back. Verified: clicking PO number and then away shows "PO number is required."
- **Narrow tables.**
  - Confirm mini-tables render code, SKU, location and date cells through `Nowrap` (no breaks inside a token), and the table scrolls horizontally.
  - The PO detail Receipts table is `whitespace-nowrap` inside `overflow-x-auto`.
  - Money cells on step 5 no longer wrap "USD".
- **Stepper at 768.** `COMPACT_STEPPER` (on the wizard and the detail wrapper) shows labels for the active step only, below `lg`. At 768 the five steps fit: scrollWidth 714 = clientWidth 714.
- **Status integrity.**
  - `purchase-orders-integrity.ts` adds `poStatusDrift` and `repairPoStatusDrift`. A fully received PO becomes Completed, using the last receipt time as the stamp, and a persisted "Receiving" becomes Started.
  - The live DB was repaired: PO002231, PO002232, PO002223 and PO002230 went to Completed, and PO002227 went to Started.
  - The seed fix and the db:verify invariant are filed as **REQ-R2-9**.
- **Actual Receiving Date.** It is stamped only on completion (`settleStatus`), and a manual Completed stamps it at that moment. Cancelling a receipt on an open PO clears a legacy stamp. Verified: KS-TEST-R2B-…-B has `receivedAt` null while Started and after the cancel.
- **Change log.**
  - New lines log "SKU -> Purchase Order Line is created." and removed lines log "… is deleted."
  - Header and line values go through `purchase-orders-log.ts`. Dates read `YYYY/MM/DD`, datetimes read `YYYY/MM/DD h:mm AM` in the warehouse timezone, and nulls read `(empty)`.
  - Unchanged line fields are no longer logged.
  - A receipt cancel writes "Receipt 70110 is cancelled. 6 Each of APX-TEE-WHT-M reversed from MLT1-RECV."
  - The import handler logs line creation the same way.
- **Summary card.** It now has separate Type and Vendor rows. Received shows a neutral "N open" chip until the PO is Completed or Cancelled, and only then a signed variance pill. Actual receiving is shown once stamped.
- **PO ring.** Confirm has `confirmStepSchema` (`reviewed`), so create runs 0% → 25% → 50% → 75% → 100% only on Step 5 (Logiwa parity). Verified 0% on an empty step 1. Showing the lifecycle label in the ring on edit needs a shared prop (**REQ-R2-10**).
- **List grid.** The partial progress bar is info blue, no longer brand red. The cell is vertically centred. Total quantity, Status, Reference number and Purchase price are wider. Every disabled bulk button also carries a `title` with its reason.
- **Receive items drawer.**
  - Enter in a field advances focus and never submits (`advanceOnEnter`, scanner-safe). Receive posts only from the footer.
  - Putaway reasons are human-readable via `humanReasons`, e.g. "Already holds this SKU · Not a damaged-stock location".
  - The default receiving location is prefilled at once, then replaced by the suggestion unless the user changed it, with "Checking putaway rules…" progress copy.
- **Receipts data.**
  - `receivedBy` and `cancelledBy` resolve to the user's display name, for grid, filter and sort.
  - Expiry and production dates are stored as `YYYY-MM-DD`: `toDay` in `po-schemas`, `dateOnly` in the receive path, and the date-only `DateF` emits the local calendar day.
- **Performance feedback.** The receipt drawer shows loading copy, and the drawer is usable before the suggestion returns. The slow suggest path is filed as **REQ-R2-12**.
- **Checks**
  - tsc is clean on M05 paths.
  - `vitest tests/unit/inbound-receiving`: 7 files, 56 tests pass. The new file is `po-parity-r2b.test.ts`.
  - Headless walk: step-1 blur, tracked Receive PO disabled, 768 detail, bulk receive timing, cancel receipt at 768, receipts table. No console errors and no 4xx/5xx. The one dev-overlay "Issue" was a transient SSR chunk-load failure in `src/components/products` (another module, HMR).
- **Test records:** KS-TEST-R2B-MWA6QS7G-A (Completed through bulk Receive PO) and KS-TEST-R2B-MWA6QS7G-B (Started; its only receipt, 70110, is cancelled).

## Round 3 (parity loop) — 2026-11-09

Fixes for the round 2 critic verdict:
- **Latency (blocker):** measured against the shared dev server. `/api/health` (no DB work) itself took 33 s on one call and 2.6 s on the next, with CPU at about 60%. `/api/me` took 1.7 to 7 s and `/api/purchase-orders` 11 to 33 s. The slowness is environment-wide (concurrent compiles by other modules), not the PO query: the same repository functions run under vitest in milliseconds (58 receiving tests in 3.4 s). Re-measure once the other modules' build errors are fixed.
- **Draft restore lost lines:** `StepDetails.changeClient` now tracks the client that owns the lines. A transient `null` from the client picker (it reloads its options after a restore) or re-selecting the same client no longer wipes the lines or the vendor. Only a real switch to a different client clears them.
- **Vendor step loading:** choosing a client in Step 1 now prefetches `/api/vendors?clientId=…&active=1`, which warms the route and DB before Step 3. The Next button's inline loading state belongs to the shared wizard (filed as a request).
- **Line editor Total price:** shows "—" when quantity or price is missing or invalid. It never shows a stale value. This uses `lineTotalOrNull` in `po-form-model.ts`, covered by unit tests in `tests/unit/inbound-receiving/po-parity-r3.test.ts`.
- **PO type tooltip:** the copy now explains what each PO type does. The tooltip's open/close behaviour is shared `InfoTip` (filed as a request).
- **Duplicate PO number:** the field now shows a red "Already exists" next to the inline error once the check returns, and Next stays disabled through `codeConflict`.
- **Warehouse and client defaults:** these now come from the working context (`/api/me` `context`) when it is in scope, else from the single in-scope option.
- **List layout shift:** while permissions load, the Import and Create purchase order header buttons and the bulk toolbar buttons (Tag, Label, Cancel order, Receive PO, Delete) render disabled, with the reason "Loading permissions", instead of being omitted.
- **History kebab:** the shared `RowMenu` already uses `aria-label="Row actions"`. The critic's selector failed because the rows never loaded.
- **Progress ring:** the shared `validityPercent` counts required steps whose schema passes, so prefilled defaults count. Making it count validated *and visited* steps is a shared-wizard change (filed as a request).
- **Known environment caveat.** At 22:33 the running dev server still wrote the old "Ordered Qty is modified.  --> 3" line entry when creating KS-TEST-R2B-MWA70J33-C. The compiled chunks in `.next/dev/server/chunks` already contain `recordLineCreate`, and the unit test asserts the new message. The server process seems to hold a stale module instance for the create path. A dev-server restart (not done here; it is shared) or the next production build picks it up. Re-check after a restart: create a PO and expect "SKU -> Purchase Order Line is created."

## Round 4 (parity loop) — 2026-11-09

Fixes for the round 3 critic verdict (score 7.4):
- **Create route gated on the server:** `/receiving/new` calls `requirePagePermission("inventory.purchase_orders.create")` inside Suspense. Viewers are redirected to `/forbidden?from=/receiving/new` (verified headless). The POST already enforced the permission.
- **Duplicate PO number:** a new `codeChecking` form flag is set on every keystroke and while `/code-check` is in flight. `detailsCanProceed` (po-form-model) keeps Next disabled with the reason "Checking that the PO number is unique…", without showing a red error. Headless check: typing PO002242 disables Next at once, and after the check the field shows "Already exists" plus the server message, with Next still disabled. A failed check unblocks; the POST still returns 409 DUPLICATE, which the wizard maps onto the field.
- **Actual Receiving Date audit trail:** `settleStatus` logged the ledger's transient in-transaction stamp as the "from" value, which produced "… --> (empty)" on the second partial receipt. The pre-receipt value is now always empty for a receivable PO, so partial receipts write no entry and completion writes exactly one "(empty) --> date" entry. Covered by `po-parity-r4.test.ts`. The source stamp in the ledger is filed as REQ-R2-14.
- **Deterministic putaway target:** each line's `SuggestionHint` reports its pending state through `SuggestPendingCtx`. Receive stays disabled ("Finding the putaway location…") until every included line has resolved its suggestion or errored, so the posted location no longer depends on click timing. Warm `/suggest` measured 400 to 600 ms on the loaded dev server.
- **Cancel receipt:** the Cancelled chip shows at once. `markReceiptCancelled` patches every cached grid page, and the background refetch confirms it.
- **Columns:** the PO number column is 210 px (min 150) with a full-code tooltip, Vendor is 210 px, and PO list date columns are 188 px. Receiving History PO number is 200 px with a tooltip.
- **Titles:** the H1 now matches the tab: "Purchase Orders" and "Vendors". Receiving History was already correct.
- **Copy:** "1 line exceeds / N lines exceed". On Step 3, the step description is the single helper line ("Select the vendor that ships this order.") and the inline text shows only "Selected: …".
- **768 px bulk toolbar:** labels show from `lg`. Below that, every icon button has a `title` tooltip (the action name, or the disabled reason). The footer wrap is shared (REQ-R2-15).
- **Master ID:** the number still opens the receipt drawer (receipt detail). A new external-link icon next to it opens Serial Number Receiving History filtered to `receiptId=eq:<masterId>` in a new tab (Logiwa parity).
- **Not done:** Vendors bulk toolbar and checkbox column (missing vs Logiwa; next round). List first-load latency is environment-bound (see REQ-R2-17).
- **Checks**
  - tsc is clean on M05 paths.
  - `vitest tests/unit/inbound-receiving`: 9 files, 60 tests pass.
  - Headless: viewer redirected to /forbidden, duplicate-code gate works, H1s are correct. No console errors.

## Round 5 (parity loop) — 2026-11-09

Fixes for critic round 4 (7.6):
- **Viewer on /receiving/vendors**: `GET /api/vendors` now also accepts `inventory.purchase_orders.view`, so roles that can see Purchase Orders get the vendor list read-only (verified: viewer 200, no console errors; viewer bulk delete still 403).
- **Vendors bulk toolbar**: row checkboxes (users with `settings.vendors.edit`), bulk Activate / Deactivate / Delete with eligibility reasons, confirm dialog listing the records, partial-result toast. New routes `POST /api/vendors/bulk/active { ids, active }` and `POST /api/vendors/bulk/delete { ids }` (runBulk, per-row failures). New `deleteVendor` repo fn: blocked when any PO ever referenced the vendor ("Deactivate it instead"), removes vendor addresses, writes change_log delete. Export As Excel already on the grid footer.
- **Cancelled PO detail**: no variance pill (`receivedSummaryTone` → "cancelled", neutral "cancelled" chip with tooltip); header "Receive items" hidden for Cancelled/Completed POs. Unit test updated.
- **Receiving History**: dedicated Status column (Received / Cancelled) after Master ID; truncated plain cells carry a `title` tooltip.
- **PO list at 768 px**: Status column moved directly after PO number so it stays visible.
- **Wizard Step 1**: inline description under Client ("Select a client to continue…") while empty.
- Already present from earlier rounds: Change Purchase Order Status modal (`po-status-modal.tsx`), 3-card success screen.

Not done here (filed in requests): Inbound top-nav grouping/breadcrumb (shared nav), shared Wizard inline Next reason, dev-server latency (even `/api/me` measured 3–5 s while other agents compile — not a module query cost), PO Receiving Report / Labor receiving drilldown links (reports module).

Checks: tsc clean for module paths; `vitest run tests/unit/inbound-receiving` 9 files / 60 tests pass; API exercised for bulk active/delete + viewer; headless screenshot of vendors bulk toolbar.

## Round 3 (parity loop) — 2026-11-09, critic round 2 verdict (score 7.3)
- **Expiry shown one day early (major):**
  - Every date-only value now renders through `calendarDay()` (po-schemas), which parses `YYYY-MM-DD` as the local day. That covers the PO detail Receipts table, the Receiving History expiry and production cells, the receipt drawer, and the Step 2 lines grid.
  - Legacy instants are normalised by `calendarDateDrift` / `repairCalendarDates` (purchase-orders-integrity), which convert to the day in the warehouse time zone. The live DB is repaired: receipt 70104 now reads `2027-05-08`.
  - The PO import now stores expiry as a day (`dayOf`).
  - Verified: receipt 70119 shows 5/28/2027 on the detail page and in history. The shared `toDate` fix is REQ-R2-21.
- **Horizontal page scroll at 1440 and 768 (major):**
  - Cause 1: Radix checkboxes inside a `<form>` render absolutely positioned bubble inputs, and their containing block sat outside the table scroller, so they widened the document to 1872 px. The scrollers in Step 2, Confirm and Receipts are now `relative max-w-full overflow-x-auto`.
  - Cause 2: below `lg`, the shared wizard grid used an implicit auto track. `WIZARD_GRID_FIT` pins it to `minmax(0,1fr)` (shared fix REQ-R2-18), and `ReadOnlyPo` got the same treatment.
  - Measured with headless Playwright: detail, `?step=products`, list, new, history and vendors all have scrollWidth equal to clientWidth at both 1440 and 768.
- **Stale rows after bulk Receive PO / Cancel order (major):**
  - `bulk/receive` and `bulk/cancel` now also return `rows`, the refreshed `PoRow`s.
  - The list patches every cached PO grid page at once with `patchPoRows`; deletes use `removePoRows`, which also adjusts the total. It also updates the selection-status map, clears the selection, and shows "You have successfully received orders."
  - Verified: KS-R5-BULK-… read Completed 1.3 s after the click (including the server round trip), and Cancel order was disabled.
- **SSR "No QueryClient set":** not reproducible this round. Pageerror listeners ran across about 12 detail-page loads: no SSR fallback and no dev-overlay issue. The provider is mounted at the root (`AppProviders`). The round 2 sighting matches the transient HMR duplicate-module case seen earlier.
- **False "Actual Receiving Date … → (empty)" entry:** fixed in round 4 (`settleStatus` logs the pre-receipt value as empty for receivable POs, covered by `po-parity-r4`). Change-log timestamps now carry the warehouse zone ("2026/11/10 12:48 AM EST"), which explains the apparent one-hour offset (warehouse is America/New_York, viewer is Central).
- **Past expiry accepted silently:** both the drawer and the server reject an expired lot (`isExpired` against the warehouse's today, `todayIn`) unless `allowExpired` is confirmed. The drawer shows inline "This lot is already expired.", an "Expired lot" callout with a confirm checkbox, and "Confirm the expired lot" in the footer. Verified headless: receipt 70131 was received after the confirm.
- **Putaway algorithm on the ledger:** a line flags `fromSuggestion` when its location is the suggestion; a manual pick clears it. The server re-runs `putaway.suggestLocations` before posting and, when the posted location is suggested, stamps `algorithm_name` and `algorithm_rule_name` on the Receiving transaction (TEMP adapter, REQ-R2-19). Verified: receipt 70131 has `SAME_SKU_EMPTY_LOCATION_ALGORITHM` / "Empty storage location". Receive stays disabled until the suggestion resolves (round 4).
- **Drawer summary overlapping the last card:** the summary moved out of the scroll area into the drawer footer (lines, units, and what still needs a confirm), so it can never cover a field.
- **Toast covering Step 3 Next:** the line-added toast is now a single replaceable toast (`id`) shown for 2.5 s and dismissed when Step 2 unmounts. Moving the toaster to the top centre is shared (REQ-R2-20).
- **Viewer on /receiving/vendors:**
  - Both vendor routes now go through `requirePagePermission(VENDOR_VIEW_PERMISSIONS)`, the same any-of set as `GET /api/vendors`, now shared as a constant.
  - Roles without access are redirected to /forbidden.
  - The seeded viewer has `inventory.purchase_orders.view`, so it gets the read-only list (200, no Add vendor) and never a grid error.
- **Status modal vs Other actions:**
  - `getPurchaseOrder` returns `statusReasons`, the state machine's reason per manual status. The modal shows those reasons inline and in tooltips, and the menu's Cancel order uses the same reason.
  - A Started PO with active receipts reads "Cancel the received lines before cancelling the purchase order." in both places. Without active receipts, Cancel is allowed in both. This is deliberate: cancelling must not orphan received stock.
- **List columns:** PO number is 210 px with a tooltip and dates are 16 px wider (no truncation at 1440). The right-edge fade is shared (REQ-R2-22).
- **PATCH validation copy:** every required header field has a type-level message ("Warehouse is required.", "PO number is required.", "PO date is required.", "Select a vendor", "Version is required…"), so no raw Zod text reaches the client.
- **Print options:** Label ▾ now offers "Product label" (use as line quantity, one per unit) and "Product label · one per line" (`perLine=1`). The modal title states "N purchase order(s) · M labels". The toggle and template cards in the shared modal are REQ-R2-23.
- **Step 4 skeletons:** the wizard warms the custom-field definitions (same cache key as `CustomFieldsSection`) on mount.
- **Not done here (shared, filed):** imports page header width and manual link (REQ-R2-24), grid page-size listbox (REQ-R2-25), serial pre-advice table (REQ-7).
- **Checks**
  - tsc is clean on M05 paths.
  - `vitest tests/unit/inbound-receiving`: 10 files, 71 tests pass. The new file is `po-parity-r5.test.ts`: calendar day, zone normalisation, import day, expired-lot gate, algorithm stamp, status reasons, per-line labels, human PATCH messages and the zone-labelled log.
  - Headless: no console errors, no page errors and no 4xx/5xx on the swept routes.
- **Test records:** KS-R5-BULK-MWA9Q29M (Completed through bulk Receive PO) and KS-R5-EXP-MWA9Q29M (Completed; expired lot R5-LOT received with confirm, receipt 70131).

## Round 6 (parity loop) — 2026-11-10

Fixes for the critic's round 5 verdict (score 7.5):
- **Actual Receiving Date audit (major):** I reproduced the round-5 trail on the dev server (operator receives 1, admin receives 1, then receive all). The cause was a stale in-memory server module, not the current code: the on-disk chunk was already correct, and after a forced recompile the same API sequence logs no entry for the partials and exactly one `(empty) --> <date>` at completion. Two new tests lock this in:
  - an integration test through the real routes (`tests/e2e/inbound-receiving/po-receive-audit.spec.ts`: CSRF, operator and admin sessions, `/api/change-log`), which passes;
  - a unit test of receive, receive, receive-all (`tests/unit/inbound-receiving/po-parity-r6.test.ts`).
- **Vendor card skeleton (major):** the `/api/vendors/[id]` handler is index-backed: `po_vendor_idx` for openPoCount and `addresses_owner_idx`, over 373 address rows. The 1–8 s timings were dev-server contention; every route on the box was slow, including `/api/purchase-orders/[id]` at 8 s cold. The UI no longer leaves a dead band:
  - The vendor card skeleton now has the same shape as the content (name plus two address-card blocks).
  - A vendor fetch error shows "Couldn't load the vendor's addresses" with a Retry button, instead of falling through to "No vendor selected".
  - The query now uses retry 1 and staleTime 60 s.
  - The Receipts panel skeleton is a titled card, and it has an error/Retry state.
- **Draft restore (major):** a reload during the PO-number check saved `codeChecking: true` into the draft, which blocked Next and Confirm forever. `StaleCodeCheckReset` clears the flag on steps 2–5, and step 1 re-runs the check on mount. A restored vendor (`vendorId`/`vendorLabel`) already comes back with the form values.
- **Draft restored tone (minor):** the banner is already `variant="info"`. The shared Callout maps info to the primary (red) tokens, so this is filed as REQ-R2-26.
- **Vendor grid footer (minor):** the step 3 grid now gets a controlled `selection`, so the footer shows "Selected: 1" for the chosen radio.
- **Cancelled PO menu (minor):**
  - Receive items and Receive PO descriptions now give the reason ("PO is cancelled" / "PO is fully received") instead of quoting open units.
  - A Cancelled PO renders read-only, with no Save and the message "A cancelled purchase order can't be edited".
  - A Completed PO keeps header edits; its lines stay locked, as before.
- **packType default (minor):** `poLineSchema.packType` now defaults to `""`, and the server resolves it to the product's base pack type (`product.uom`). An API client that omits it no longer gets a 400.
- **Suggest without lineId (minor):** `GET /api/purchase-orders/[id]/suggest` without `lineId` now returns `{ lines: [{ lineId, remaining, suggestion }] }` for every open line (`suggestForOpenLines`), and the query messages are human-readable.
- **Receiving History (minor):** the Receiving type column (Purchase Order / Inventory Add / Return / Work Order …) now sits right after Status as a badge, with a header tip explaining why non-PO receipts have no PO number.
- Filed: REQ-R2-26 (Callout info tone), REQ-R2-27 (wizard transient fields), REQ-R2-28 (stale dev module), REQ-R2-29 (Inbound nav group), REQ-R2-30 (PO receiving / labor reports).
- Checks: `tsc --noEmit` is clean for M05 paths; `vitest tests/unit/inbound-receiving` passes 11 files / 74 tests; the Playwright audit spec passes. The history page renders the new column with no console errors.

## Round 4 (parity loop) — 2026-11-10 (critic round 3 verdict, score 8)
- **Import PO Serial Numbers (major):** the `po-serials` import handler is now configured, so the "Not configured yet" banner is gone.
  - Each row pre-advises one serial on the first line of that SKU on the PO that still has room: one serial per ordered unit times the pack ratio. Serials are stored in `purchase_order_serials`.
  - The rules live in the new `src/server/repositories/purchase-orders-serials.ts`:
    - the PO is open and in scope;
    - the SKU is serial tracked and on the PO;
    - the serial is not already pre-advised on an open PO and not already in stock (case-insensitive).
  - Each add writes a line change-log entry.
  - PO rows carry `preAdvisedSerials`, and each line carries `preAdvisedSerials[{ serial, received }]`.
  - Bulk Delete › **Remove serial number** now works through `POST /api/purchase-orders/bulk/remove-serials` (`remove_serial_number` permission, runBulk).
    - It is enabled only when a selected PO has pre-advice.
    - It confirms with per-PO serial counts and logs one entry per serial.
    - Received serials stay on their receipts.
  - The PO detail page has a **Serial pre-advice** panel: expected and received chips per SKU, plus an import link.
  - The Receive items drawer prefills serial-tracked lines with their pre-advised serials that are not yet received, in import order.
  - Deleting a PO or a line removes its pre-advice first, because of the foreign key.
- **Putaway algorithm stamp (major):** the cause was that the drawer fetched its suggestion before the lot or expiry was typed. The server then re-ran the suggestion with the lot, the location no longer matched, and the stamp was silently dropped.
  - The drawer now sends `suggestBasis`: the quantity, lot, expiry and damage values its suggestion used.
  - `putawayAlgorithmFor` re-runs with the posted attributes first, then with the basis, then with the line minus lot and expiry (limit 10). Every run uses only server data.
  - When the lot, expiry or quantity changes and the location is still the auto-applied one, the drawer follows the newer top suggestion.
  - Picking a suggested location by hand still counts as directed putaway.
  - Stale placeholder suggestions are ignored.
  - Verified through the UI: KS-TEST-R7-UI-MWABP3OP received 4 units into D-03-01-1 after the quantity, lot and expiry were changed. The ledger row has `SAME_SKU_EMPTY_LOCATION_ALGORITHM` / "Empty storage location". The "suggestion predates the lot" case is also covered through the API (KS-TEST-E2E-R7-MWABI5RT).
- **Cancel order on a Started PO with receipts (major):** Cancel order now short-closes the PO instead of being blocked.
  - `cancelPurchaseOrderOutcome` closes the PO as Completed. The open balance stops being expected, and the received lines and their stock are untouched.
  - The change log records the reason ("Open balance cancelled: N units on M lines…") together with Completed and Actual Receiving Date.
  - A PO with no receipts still becomes Cancelled.
  - The detail menu, the list's bulk Cancel order and both routes return `shortClosed` and `cancelledUnits`. The confirm copy and the toasts explain the short-close.
  - The status modal's Cancelled reason (`SHORT_CLOSE_HINT`) now points to Completed or Other actions › Cancel order, never to reversing receipts.
- **Actual Receiving Date entry (minor):** the code path was already correct.
  - A new unit test covers receive, cancel the receipt, receive, then complete. It asserts exactly one `Actual Receiving Date is modified. (empty) --> …` entry.
  - The live API spec confirmed the same entry on KS-TEST-E2E-R7-MWABI5RT.
  - The critic's missing entry came from the stale dev module described in REQ-R2-28.
- **PO number check (minor):** Step 1 now calls `/code-check` once on mount so the route is already compiled, and the debounce is down to 300 ms. A visible "Checking…" label replaces the bare spinner. Measured headless: "Already exists" appears 866 ms after blur.
- **Receive gate (minor):** every required field now goes through one gate, `receiveBlockedReason`. It reports the first issue from the drawer schema, named by SKU.
  - It covers quantity, location, LP, lot, expiry, production date, serials, and the over-receipt and expired-lot confirms.
  - The reason is always visible in the drawer footer.
  - Verified: Receive stays disabled with "CPL-BAG-MED-12 is expiry tracked: enter an expiry date." until the date is entered.
- **Print options (minor):** a new module-owned modal, `po-label-print-modal.tsx`, replaces the shared one for PO product labels.
  - The subtitle reads "1 purchase order · 3 labels".
  - A **Use as line quantity** toggle is off by default, which prints one label per line times Print quantity.
  - When it is on, a quantity basis (Ordered or Received) sets the label count per line.
  - A per-line preview table shows the counts, with Preview, Download and Print through `/api/print`.
  - The lines come from `/api/purchase-orders/labels?lines=1`.
  - The two Label menu items are merged into one.
- **One date-time rule (minor):** `formatZoned` in `src/lib/grid-defs/receiving/zoned-time.ts` renders every instant in the warehouse zone with its label, for example `2026/11/10 1:37 AM EST`.
  - It is used by the PO grid date columns, Receiving History, the Receipts panel, the rail's Actual receiving, the receipt drawer and the change log (`logDateTime` now delegates to it).
  - Rows carry `warehouseTimeZone` or `timeZone`.
- **Rail on edit (minor):**
  - The rail title shows the lifecycle, for example "COMPLETED · 4/10 RECEIVED".
  - Save on an unchanged form is a no-op with an info toast.
  - The shared "Ready to save" text and the Save button state are filed as REQ-R2-31.
- **Smaller fixes:**
  - The `/organization/vendors` H1 is now "Vendors".
  - Disabled destructive items in the list Delete menu and the detail Other actions menu drop the red tone and show their reason inline.
  - Vendor addresses get **Address name** (max 50, the Logiwa field) plus a separate Contact name, stored in `addresses.first_name`.
  - The PO create success screen shows its three next-step cards in one row on desktop.
  - The Receipts panel links to the **PO receiving report** (`/reports/po-receiving?q=<code>&qm=eq`).
- **Not changed (explained or filed):**
  - Toasts are shared (REQ-R2-20, re-raised).
  - The "Selected" counter on grids without row selection is shared (REQ-R2-32).
  - Density: the PO list showed "Large" because the admin saved that preference; it is not a default.
  - History Export As Excel works: the "Export started" toast appeared about 1 s after the click.
  - No debug writes were added to M05 code this round.
  - The live `/api/imports/*` route is down because of another module's stale HMR module (REQ-R2-34).
- **Checks**
  - `tsc --noEmit` is clean for M05 paths.
  - `vitest run tests/unit/inbound-receiving` passes: 12 files, 88 tests. The new file is `po-parity-r7.test.ts`, with 14 tests.
  - Playwright `po-round7.spec.ts`: the putaway, short-close and Actual Receiving Date test passes against the dev server. The serial-import test is blocked by REQ-R2-34.
  - Headless screenshots in `%TEMP%\claude\kitstak-critic\inbound-receiving\r7_*.png` show no console errors from M05 pages.

## Blind-judge repair round 1 (2026-11-10)
- **PO list skeletons (~30 s):** profiled. The SQL for `/api/purchase-orders` (100 rows) runs in about 3 ms against `.data/kitstak.db`. Warm API calls take 2-3 s, and the cold first call took 9 s, all of it dev-server overhead. A headless run this round showed the server-rendered grid still unhydrated after 168 s (header buttons disabled), so the hang is chunk compile and hydration on the shared, overloaded dev server, not the query.
  - Added `useSlowLoad` / `slowLoadError` to `receiving-shared.tsx`. After 12 s of first-load pending, the PO list and Receiving History grids swap their skeletons for a retryable "taking longer than usual" error state. Real API errors still show as before.
- **Putaway worklist (new):** `/receiving/putaway` (a new "Putaway" tab under the receiving tabs) lists every Stock bucket in a receiving location: area type Receiving, legacy role Receiving, or the warehouse default receiving location. Rows show SKU, client, from location, quantity, lot and expiry, LP, PO, received time and dwell time, and are searchable.
  - **Put away** opens a scan step with the putaway algorithm's top 5 locations (from `GET /api/putaway/suggest`), a destination scan field (Enter submits), a quantity field and **Confirm putaway**.
  - `POST /api/putaway/confirm` resolves the scanned code or location barcode in the bucket's warehouse. It rejects unknown locations and the current location, then moves the stock through `transferProduct`, so the ledger records a Transfer with note "Putaway".
  - Files: `src/server/repositories/putaway-worklist.ts`, `src/app/api/putaway/{route,suggest/route,confirm/route}.ts`, `src/components/receiving/putaway-worklist-page.tsx`, `src/app/(app)/receiving/putaway/page.tsx`. `src/config/page-tabs.ts` gets one added tab (shared, additive).
- **Reports links:** a new **Putaway & reports** menu on the PO list and Receiving History headers links to the Putaway worklist, the PO receiving report (`/reports/po-receiving`, partial receipts) and Receiving performance (`/analytics/labor/receiving-performance`). Each item is permission-gated. The putaway page also links to both reports.
- **Already present (re-verified in code, no change):**
  - Master Id links to `/reports/serial-numbers/receiving-history?f.receiptId=…` (`receipt-columns.tsx`), and the receipt drawer links to Transaction history.
  - The PO detail rail has Billing charges and Printouts cards beside Other actions.
  - Grid page sizes are 100/300/500/700/1000 (`GRID_PAGE_SIZES`).
  - The Use as line quantity label toggle shipped in round 7.
  - REQ-6, REQ-7, REQ-8 and REQ-9 are all applied (see the requests file).
- **Checks**
  - `tsc --noEmit` is clean for M05. The only errors are in `tests/unit/shipping`, owned by another module.
  - ESLint is clean on the new files.
  - `vitest run tests/unit/inbound-receiving` passes: 13 files, 91 tests, including the new `putaway-worklist.test.ts` (list, suggest, partial move, unknown and same location rejected, slow-load helper).
  - API checked live: `/api/putaway` returned 6 tasks and 86 units, `/suggest` returned SAME_SKU_EMPTY_LOCATION_ALGORITHM suggestions, and an unauthenticated-CSRF confirm was rejected.
  - Headless: the putaway list rendered ("6 tasks · 86 units waiting") and the dialog opened. A UI confirm click was not completed because the dev server stopped responding (240 s timeouts); the unit test covers the confirm.
  - Screenshots are in `%TEMP%\claude\kitstak-critic\inbound-receiving\rj1_*.png`.

## Round 5 (parity loop) — critic round 4 fixes (2026-11-10)
- **Completed → Started re-open (major):** the new module-owned file `src/server/repositories/po-status-rules.ts` wraps the shared `stateMachines.purchaseOrder` and adds `PO_REOPEN_EDGES = { Completed: ["Started"] }`.
  - `applyStatus`, the detail's `allowedStatuses` and `statusReasons` use `canChangePoStatus`, `nextPoStatuses` and `assertPoStatusChange`.
  - On a Completed PO the status pencil now offers Started.
  - `statusChangeStamps` clears Completed and Actual Receiving. The change log records `Completed → Started`, the reason, and both cleared dates.
  - Receipts can be cancelled again after the re-open.
  - The modal hint for this move reads "Re-opens the order…", and the Completed hint says how to re-open.
  - The cancel-blocked reason on a Completed PO's receipt now ends with "Re-open the purchase order (change its status to Started) first."
  - The shared edge (REQ-R2-3) is still the clean home; the wrapper becomes a no-op once it lands.
- **Receive API contract (minor):** the new `receiveApiBodySchema` in `po-schemas.ts` is one object schema instead of `z.union`.
  - `{ all: true }` receives every open line.
  - Otherwise `lines` is required and errors stay specific, for example `fieldErrors["lines.0.quantity"] = "Quantity must be at least 1"` and `lines.0.locationId` = "Choose a receiving location" for an empty string.
  - A line with **no** `locationId` is received into the warehouse's default receiving location, using the same resolution as Receive PO (`receiveFromApi`). This matches Logiwa.
  - The drawer still uses the strict `receiveBodySchema`.
- **Detail route stability (major):**
  - `po-detail-page.tsx` no longer imports `po-list-page.tsx` or `receiving-history-page.tsx`, so it doesn't pull the whole DataGrid list chunk into the detail route.
  - The action gates moved to the pure `po-action-rules.ts`, which the list re-exports so imports stay stable.
  - Receipt cancel moved to `receipt-cancel.tsx`, which the history page re-exports.
  - The detail page has no worker-heavy dependency (no xlsx or pdf; print and export are server-side), and there is no `generateStaticParams`.
  - The "Jest worker … child process exceptions" error and the later hang came from the dev server process. At about 03:00 local time, pid 47592 still held a 5.8 GB working set and answered nothing. Filed as REQ-R2-36.
- **Vendor card on detail (minor):** `StepConfirm` takes `vendorFallback`, the vendor already returned with `GET /api/purchase-orders/[id]`.
  - The shipping and billing cards render at once from the PO payload.
  - The `/api/vendors/[id]` refresh retries twice. The "Couldn't load" state shows only when neither source has the vendor.
- **Rail save state (minor):** on edit, the rail summary shows a live status line, "All changes saved" (green check) or "Unsaved changes" (amber), through `Wizard.onDirtyChange`. Truly disabling the shared Save button is still REQ-R2-31 (re-raised with an exact prop proposal).
- **Header help icons (minor):** the PO list Total quantity and Vendors Open POs (i) icons now sit right after their own label. `headerClassName: "flex-row"` overrides the header's right-align reverse.
- **Success screen (minor):**
  - The H1 changes to "Purchase order created", with the helper "The order is Pending. Receive it from its detail page when the goods arrive."
  - The summary line reads "Status: Pending".
  - The card copy was rewritten: "Go to the purchase order list" / "See all purchase orders, filter them and receive them in bulk", "Create another purchase order" / "Start a new purchase order for the same or another client", and "View receiving history" / "See every receipt with its quantities, locations and who received it".
- **Draft restored callout:** the shared `Callout` `info` variant now uses the info tokens (REQ-R2-26 applied upstream), so the banner is blue.
- **Imports 500 / grid-prefs 500:** both M05 import definitions register and list an empty history under vitest. The live 500s come from the shared eager handler registry (REQ-R2-35) and from the overloaded dev server (REQ-R2-36), not from M05 code.
- **Lint:** fixed the `react/no-unescaped-entities` errors in `po-detail-page.tsx` and `step-confirm.tsx`.
- **Checks**
  - `tsc --noEmit` is clean for M05. The only remaining errors are in other modules: `tests/unit/automation-integrations` and `carrier-errors-page.tsx`.
  - `vitest run tests/unit/inbound-receiving` passes: 14 files, 96 tests.
    - The new file `po-parity-r8.test.ts` covers the re-open rules, re-open plus receipt cancel, the default receive location, field-specific errors, and both import definitions.
    - `po-lifecycle.test.ts` was updated for the new Completed → Started edge.
  - The new Playwright spec `tests/e2e/inbound-receiving/po-round8.spec.ts` covers the receive API without a location, specific errors, re-open plus receipt cancel, and the detail route render. It could not run this round because the :3000 dev server was unresponsive for the whole session (every curl timed out). Per the rules it was not restarted.

## Round 6 (parity loop): critic round 5 fixes (score 8.2), 2026-11-10
- **Putaway worklist on the shared DataGrid (major).** `/receiving/putaway` now uses `useGrid` + `GridToolbar` + `DataGrid` with grid key `putaway-worklist`, like every other M05 list.
  - Columns: SKU/name, Warehouse, Client, Location (with a Locked badge), Quantity, Barcode, Lot, Expiry, LP, PO (links straight to `/receiving/{poId}`), Receiving date (warehouse zone, e.g. "10:47 PM EST"), Waiting, and a Put away button pinned to the right edge.
  - The grid has sort on every data column, 15 filters (warehouse, client, SKU, product, barcode, location, quantity, pack type, lot, expiry, LP, PO, receiving date, waiting hours, is location locked), saved views, the column chooser, density, the pager (100–1000), row selection, a row menu (Put away, Open purchase order, View in Inventory by Location) and bulk **Put away**.
  - `GET /api/putaway` speaks the grid grammar (`q/qm`, `f.*`, `sort`, `page`, `ps`). The header count and `meta.units` cover every matching task, so nothing truncates at 300.
  - Grid definitions are in `src/lib/grid-defs/receiving/putaway.ts`. The repository `listPutawayTasks` compiles them with the module's `compileGrid`.
  - **Export:** the provider `putawayWorklistExport` (in `purchase-orders-export.ts`) and `src/server/exports/providers/putaway-worklist.ts` exist. Until foundation registers the grid key (REQ-R2-40), the footer shows the client-side "Export CSV" of the visible page instead of a dead Excel button. The page switches to Export As Excel by itself once `GRID_KEYS` includes the key.
- **Bulk putaway (new):** `POST /api/putaway/bulk` `{ items, locationCode? }` moves every selected task in full, either each to its own top suggestion or all to one scanned location. Each task runs in its own savepoint (`runBulk`), so failures are reported per task. Locked tasks are listed as skipped in the dialog and the toast.
- **Whole-LP putaway (Logiwa gap):** when a task is on an LP, the dialog offers "Move the whole LP … in one scan". `confirmPutaway({ wholeLp: true })` goes through `transferLp` (ledger note "Putaway").
- **Algorithm header:** now `putawayAlgorithmLabel(algorithm) · rule`, so it reads "Same SKU, empty location · Empty storage location". The top chip is marked Best.
- **Count-locked / locked source locations:** each row carries `blockedReason`, either the count-plan message from `countLockFor` ("Location MLT1-RECV is locked by count plan CNT…") or the manual lock. For these rows Put away is disabled with that reason, the dialog explains it, and the server refuses up front with the same message.
- **Dialog input hygiene:**
  - Any input change clears a stale server error.
  - The Quantity field keeps an empty value empty and shows "Enter a quantity" (`putawayQtyIssue`), instead of coercing it to 0.
  - Enter submits from either field.
- **Breadcrumb:** `resolveRoute` already prefers static patterns, so `/receiving/putaway` crumbs as Home › Inventory › Purchase Orders › Putaway. This was verified live and is pinned by a unit test.
- **PO list bulk Cancel order / Receive PO (partial):** both are enabled when at least one selected PO is eligible. They run on the eligible POs only. The confirm text and the result toast list each skipped PO with its reason, for example "1 of 2 selected orders is skipped. Only Pending or Started orders can be cancelled (PO002210 is Completed)." The helpers `partitionPos`, `partialActionReason` and `skippedSummary` are in `po-action-rules.ts`.
- **Receive items drawer footer:** the summary sits on one line, and the block reason gets its own line that wraps and never truncates (`data-testid="receive-blocked-reason"`).
- **Expiry / production date always match what is shown:** `DateF liveValidate` mirrors the typed text into the form value. Valid text is stored as YYYY-MM-DD while typing; unparseable text such as "2027/06/304" is stored as typed. The drawer schema then rejects it with "Enter a valid date as YYYY/MM/DD", so Receive stays disabled while the field is `aria-invalid`. Verified live: the field showed 2027/06/304 with `aria-invalid` true, Receive was disabled, and the footer gave the reason. The shared DatePicker fix is REQ-R2-43.
- **Receive API contract:**
  - `suggestBasis` keys are all optional, and `qty` defaults to the line quantity.
  - `fromSuggestion` is optional. When an API caller omits it, the server stamps the algorithm and rule whenever the algorithm still directs to the posted location. An explicit `false` is never stamped.
  - Messages are human-readable: "suggestBasis.qty must be a whole number of units", "Choose the purchase order line", and an LP-mode message. No "Invalid input: expected …" text remains.
- **Not M05-owned (requested):**
  - REQ-R2-41: change-log tiebreak by rowid ascending, so creation reads PO, then lines.
  - REQ-R2-42: receiving help steps use Pending → Started → Completed and Cancel order, plus a Putaway link.
  - REQ-R2-43: DatePicker draft.
  - REQ-R2-40: export registration.
  - At 390 px, every page scrolls horizontally because of the shared app header's user menu (it ends at 409 px). This is the same on Receiving History and is shell-owned.
- **Still missing vs Logiwa:** task-based putaway with user assignment, task status and labor capture (Job Management). This needs the M03 task engine.
- **Checks**
  - `tsc --noEmit` is clean for M05 paths.
  - ESLint shows 0 errors on M05 paths. The 2 warnings are pre-existing `set-state-in-effect` warnings in `po-list-page.tsx:134` and `step-details.tsx:65`.
  - `vitest run tests/unit/inbound-receiving` passes: 15 files, 111 tests. `putaway-worklist.test.ts` was rewritten to cover the grid grammar, totals, sort errors, count-lock flags, bulk with per-task failure, the qty/wholeLp schema, the UI helpers and the breadcrumb. The new `po-parity-r9.test.ts` covers partial bulk, the receive API contract, the inferred stamp and the date mirror.
  - **Live:** :3000 timed out again (REQ-R2-36), so the checks ran against an M05 production build of the current tree on :3176 (`%TEMP%\claude\kitstak-critic\inbound-receiving\prodbuild`, same DB).
    - The putaway grid loaded in 1.9 s with 6 tasks · 91 units. The breadcrumb read Putaway. The row button stays visible (pinned) and the filter panel lists all 15 fields.
    - Header sort wrote `?sort=qty`. Times show in EST.
    - Through the dialog: the Best chip was chosen, qty 1 was entered, and Confirm took SMT-BND-OS from 10 to 9 waiting.
    - The NOPE-XX error cleared on edit.
    - The bulk dialog opened for the selection.
    - The mixed Completed + Pending selection enabled Cancel order, and the confirm listed the skipped PO.
    - There were 0 console errors apart from the deliberate 400.
    - API: viewer confirm returned 403, an unknown sort returned 400, an empty bulk returned 400 "Select at least one task", and the receive API messages were the human ones above.
    - Screenshots: `%TEMP%\claude\kitstak-critic\inbound-receiving\r6_*.png`.

## Blind-judge repair round 1 (2026-11-10)
The judge preferred Logiwa or found KitStaks less complete. Each gap and what changed:
- **Duplicate React key on `/receiving/putaway` (fixed).** `PutawayDialog` and `BulkPutawayDialog` are siblings and both fell back to `"none"`. They now use separate namespaces, `single-<id>` / `single-none` and `bulk-<ids>` / `bulk-none`. Verified headless: no console errors on load.
- **Human receiving-type labels (fixed).** New file `src/lib/grid-defs/receiving/receiving-types.ts` with `receivingTypeLabel`. "DisassembleKit" now reads "Disassemble kit", and likewise "Add inventory", "Product receive", "Purchase order", "Kitting" and "Return".
  - It is used by the history column badge, the receipt drawer and the filter options (the new `ReceivingGridField.optionLabel`). The stored values are still what the filter sends and what the export contains.
  - The status pills were already human ("Received" / "Cancelled", PO statuses).
  - Verified: `f.type=in:DisassembleKit,Add Inventory` shows "Disassemble kit" and "Add inventory" badges, and the filter list shows human labels.
- **Duplicated "COLUMN OPTIONS" on `/reports/po-receiving`:** this is M13's file. Filed as REQ-R2-44 with the exact change: drop `chooserGutterColumn()`, because DataGrid now adds `_gutter` itself.
- **PO import page (new): `/receiving/import`** (`po-import-page.tsx`, route `receiving/import/page.tsx`).
  - Tabs for Purchase orders and Serial numbers (`?type=po-serials`).
  - The green template download.
  - An **Import manual** drawer listing the processing rules plus every template column with its type, length, allowed values, example and notes.
  - Drag-and-drop upload.
  - An import history grid with Status, Master row count, Success, Error, Uploaded by and Created date time. Its row menu has Details, Download original and Download error file. It offers page sizes, and it polls while an import is processing.
  - The list's Import ▾ menu, and the PO detail's serial pre-advice link, now open this page.
  - Verified: a 2-row CSV with one bad SKU gave "Partially Successful" with 2 rows, 1 success and 1 error. The error file downloads (200, xlsx). A file missing a column is refused inline with "Missing required column: Quantity".
- **Page sizes 300 / 500 / 700 / 1000:** already offered by the shared footer. Verified headless on the PO, Receiving History and Vendors grids: "Show 100 | 300 | 500 | 700 | 1000 items". 100 stays the default, as in Logiwa (references/logiwa-live/inbound-inventory.md §18).
- **RF / handheld receiving (new): `/receiving/rf`** (`rf-receive-page.tsx`, with pure rules in `src/lib/grid-defs/receiving/rf-receive.ts`).
  - The layout is one column with large targets, and every field accepts a scanner's Enter.
  - The flow:
    1. Scan the PO (code or reference), or tap an open PO.
    2. Scan the barcode or SKU. Rescanning the same product adds one unit.
    3. Enter the quantity (stepper or "All open"), plus lot, expiry, production date or serials when the product tracks them.
    4. The location is prefilled from the putaway suggestion. Scanning another location replaces it; scanning a suggested location still counts as directed putaway.
    5. LP: No LP, Scan LP (an existing LP) or New LP (with its type). The over-receipt confirm appears when needed.
    6. A sticky "Receive N" button. A session log lists every receipt.
  - It posts to the same receive API as the desktop drawer, so partial receiving makes the PO Started.
  - Verified at 390×844 (KS-TEST-RF-*, KS-TEST-WALK-*).
- **Receiving-scoped ledger (new): `/receiving/transactions`** (`receiving-ledger-page.tsx`, with links built by `receiving-ledger.ts`).
  - It shows the full Transaction History grid, with every ledger column, typed filters, saved views and Export As Excel. It opens filtered to Receiving, Cancel Receiving, Return Receiving, Kitting and Disassemble Kit, with presets for "Cancel receiving" and "Return receiving".
  - The receipt drawer links to the ledger for this SKU on this PO, all of this PO's transactions, its cancelled receipts, and the receiving user's transactions.
  - The PO detail Receipts panel links to Ledger transactions and Cancelled receipts. Receiving History has a header **Transactions** button and a row-menu "Ledger transactions".
  - The old drawer link used a `receiptId` filter that does not exist. It is replaced.
  - Every filter is a real grid filter chip (PO, SKU, user, type) that the user can change or clear.
- **Performance.**
  - The receipt drawer now renders at once from the grid row: the Receiving History row, or the PO detail's receipts cache, through `placeholderData`. Serials, siblings and the ledger row fill in after. Measured at 88 ms from click to facts.
  - The putaway worklist prefetches suggestions for its first 8 unblocked tasks, using the same query key as the dialog, so "Put away" opens with suggestions already in place.
  - New perf budget spec: `tests/e2e/inbound-receiving/perf-budget.spec.ts`. It does a warm load per route to the first data row, with a budget of 4 s on the dev server (`E2E_PERF_BUDGET_MS`), and requires the drawer and the putaway suggestions to appear in under 600 ms (`E2E_PERF_DRAWER_MS`).
  - Warm loads measured headless: `/receiving` 1.8 s, history 2.6 s, vendors 2.4–3.0 s, putaway 1.9–2.5 s, transactions 3.0 s, RF 3.0 s, import 1.8 s.
  - The remaining time goes to dev-mode hydration and the `/api/me` → grid chain. The APIs themselves return in about 30–90 ms.
- **Live mutation walk in the browser (new): `tests/e2e/inbound-receiving/mutation-walk.spec.ts`.**
  - Test 1: an RF partial receive of 2, then putaway of 1 of those units, then Cancel receipt from the Receiving History drawer. The ledger link then shows the Cancel Receiving row.
  - Test 2: Create vendor through the drawer, then bulk Delete of 2 Pending POs from the list.
  - Both pass. They create KS-TEST-WALK-* POs and "KS-TEST Walk Vendor …".
- **Shared-server note:** other modules' edits push HMR rebuilds and `reloadPage` messages, which reloaded every open page every 1–2 s, including `/dashboard`. This is not an M05 defect. The specs use `quietHmr()` (helpers.ts) to keep the page under test stable.
- **Shared edit (minimal):** `src/config/route-registry.ts` gets 3 M05 rows, for `/receiving/transactions`, `/receiving/import` and `/receiving/rf` (breadcrumbs and permissions).
- **Checks:**
  - `tsc --noEmit` is clean on M05 paths. The remaining errors belong to other modules (workflows, reports tests, shipping tests).
  - `vitest tests/unit/inbound-receiving`: 16 files and 119 tests pass. The new file is `blind-judge-r1.test.ts`. The route-registry and nav tests also pass.
  - eslint on M05 paths: 0 errors. 2 warnings predate this round (po-list-page, step-details).
  - Playwright: the mutation-walk (2 tests) and perf-budget (3 tests) specs pass. Run with `PW_CHROMIUM_PATH=<headless shell> E2E_BASE_URL=http://localhost:3000/ npx playwright test tests/e2e/inbound-receiving/<spec> --project=e2e --no-deps`.
- **Perf spec stability:** when it ran alone, 3 of 3 tests passed. In one run alongside the mutation walk, while other agents were loading the server, `/receiving/history` took 5.5 s and the drawer took 676 ms. That is server-load noise, so the budgets stay env-tunable.
