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
