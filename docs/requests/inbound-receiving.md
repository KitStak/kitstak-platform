# Shared-change requests — M05 inbound-receiving

## REQ-1 — PO state machine: allow `Receiving → Started`
- **File:** `src/server/domain/state-machines.ts` (purchaseOrder) and/or `src/server/domain/ledger/receipts.ts` (`applyPoReceipt`).
- **Change:** either add `Started` to `Receiving`'s edges, or have `applyPoReceipt` move a Pending PO to `Started` (not `Receiving`) on its first receipt.
- **Reason:** the spec (03-inbound, BUILD_PLAN M05 §4) says a partial receive leaves the PO **Started**. The ledger currently marks it `Receiving` inside the transaction, and there is no `Receiving → Started` edge. M05's `settleStatus` (`src/server/repositories/purchase-orders-receive.ts`) validates `preStatus → Started|Completed` through the machine and persists the result; once this lands it can transition normally.
- **Status:** applied (F-patch 2026-11-06): `purchaseOrder` machine now has `Receiving -> Started` (`Receiving: ["Started", "Completed", "Cancelled"]`); `settleStatus` can transition normally.

## REQ-2 — Domain function to create license plates
- **File:** `src/server/domain/` (new `licensePlates.create(tx, ctx, { warehouseId, lpTypeId, locationId?, clientId? })`).
- **Change:** create an LP with `sequences.nextLpNumber`, status Empty, and write a change_log Create row.
- **Reason:** the Receive Items drawer lets the user "create new LP from an LP type, auto-numbered". `license_plates` belongs to M10. M05 uses a TEMP adapter (`createLicensePlate` in `purchase-orders-receive.ts`) that does exactly this until the function exists.
- **Status:** applied (F-patch 2026-11-06): `licensePlates.create(tx, ctx, { warehouseId, lpTypeId, locationId?, clientId? })` in `src/server/domain/license-plates.ts` (exported as `licensePlates` from `@/server/domain`): validates the LP type / location warehouse, numbers with `sequences.nextLpNumber`, status Empty, change_log Create ("License Plate LP… is created.").

## REQ-3 — `RecordReceiptInput.damageImageFileId`
- **File:** `src/server/domain/ledger/receipts.ts`.
- **Change:** accept `damageImageFileId?: string | null` and store it on the receipt row.
- **Reason:** Receive Items captures a damage photo per line. M05 currently patches the receipt row right after `recordReceipt` (TEMP adapter, same file as above).
- **Status:** applied (F-patch 2026-11-06): `RecordReceiptInput.damageImageFileId?: string | null`, stored on the receipt row.

## REQ-4 — Print renderers for `purchase-order-list` and `po-billing-charges`
- **File:** `src/server/print/catalog.ts`, `src/server/print/render.ts` (+ template).
- **Change:** register renderers so the shared PrintOptionsModal can preview/print the PO document and PO billing charges.
- **Reason:** both catalog entries have `renderer: null`. M05 serves them itself meanwhile: `GET /api/purchase-orders/documents?ids=` (PDF via `PdfWriter`) and `GET /api/purchase-orders/[id]/billing-charges` (xlsx). Template code to lift: `src/server/repositories/purchase-orders-print.ts`.
- **Status:** applied (F-patch 2026-11-06): record-based templates in `src/server/print/templates/purchase-order.ts` (`purchaseOrderRecordSchema` / `poBillingChargesRecordSchema`, lifted from `purchase-orders-print.ts`), registered for `purchase-order-list` and `po-billing-charges` (PDF) in `render.ts` / `catalog.ts`. M05 builds the records (header, vendor, lines / charges) and calls `POST /api/print`; the dedicated M05 endpoints can stay as they are.

## REQ-5 — `src/components/products/product-create-drawer.tsx` stub is missing
- **File:** `src/components/products/product-create-drawer.tsx` (stub-handoff table, owner M09).
- **Change:** create the stub (Product Category chooser drawer) so M01/M05 can import it.
- **Reason:** "Create New Product opens M09's drawer". M05 renders a local adapter (`src/components/receiving/product-category-drawer.tsx`) with the same three category cards linking to `/products/new?category=…` in a new tab.
- **Status:** landed. M05 now imports `ProductCreateDrawer` from `src/components/products/product-create-drawer.tsx` in step 2, and the local adapter is gone.

## REQ-6 — Change-log labels for purchase orders, PO lines and vendors
- **File:** `src/server/domain/change-log.ts`.
- **Change:** `ENTITY_LABELS`: `purchase_order_line: "Purchase Order Line"`, `vendor: "Vendor"`. `ENTITY_FIELD_LABELS.purchase_order`: `poDate: "PO Date"`, `poType: "PO Type"`, `receivedAt: "Actual Receiving Date"`, `completedAt: "Completed Date"`, `cancelledAt: "Cancelled Date"`, `plannedReceivingDate: "Planned Receiving Date"`, `plannedArrivalDate: "Planned Arrival Date"`, `actualArrivalDate: "Actual Arrival Date"`, `purchasePrice: "Purchase Price"`, `totalQuantity: "Total Quantity"`, `statusChangeReason: "Status Change Reason"`. `ENTITY_FIELD_LABELS.purchase_order_line`: `unitCost: "Price Per Item"`, `receivingLocationId: "Receiving Location"`. Also a `recordLineCreate/recordLineDelete` helper (line-level Create/Delete rows with parent ids); M05 logs line creates/removals as `Ordered Qty '' --> n` meanwhile.
- **Reason:** humanize() produces "Received at" instead of Logiwa's "Actual Receiving Date".
- **Status:** applied (F-patch 2026-11-06): labels added in `src/server/domain/change-log.ts` (`purchase_order_line`, `vendor`, the 11 PO fields, `unitCost`, `receivingLocationId`) plus `recordLineCreate` / `recordLineDelete` (line-level Create/Delete rows with parent ids). `*Id` values are also resolved to names now (see orders-outbound REQ-8).

## REQ-7 — PO serial pre-advice table (Import Serial Numbers / Remove Serial Number)
- **File:** `src/server/db/schema/inbound.ts` + migration.
- **Change:** `purchase_order_serials (id, purchase_order_line_id → purchase_order_lines, serial text, created_at, created_by, unique(line, serial))`.
- **Reason:** Logiwa's "Import Serial Numbers" pre-advises serials per PO line and "Delete ▾ Remove Serial Number" clears them. There is no table to store pre-advised serials. Until it lands the `po-serials` handler stays a stub and the bulk item is disabled with a reason tooltip.
- **Status:** applied (F-patch 2026-11-06): `purchase_order_serials (id, purchase_order_line_id -> purchase_order_lines, serial, created_at, created_by, unique(line, serial))` in `src/server/db/schema/inbound.ts`, migration `drizzle/0001_tan_ultimatum.sql`, applied to the live DB. Export `purchaseOrderSerials`.

## REQ-8 — `scripts/verify-data.ts` uses removed legacy exports
- **File:** `scripts/verify-data.ts` (pre-foundation script).
- **Change:** delete it, or switch to `listPurchaseOrders(db, auth, query)` / `getPurchaseOrder(db, scope, id)`.
- **Reason:** M05 replaced the legacy `getPurchaseOrderDetail()` / one-argument `listPurchaseOrders()`; tsc reports the script.
- **Status:** applied (F-patch 2026-11-06): `scripts/verify-data.ts` deleted (unreferenced; `npm run db:verify` uses `scripts/verify-ledger.ts`). Full `tsc --noEmit` is clean.

## REQ-9 — GridToolbar: let the filter group wrap instead of sliding under `trailing`
- **File:** `src/components/grid/grid-toolbar.tsx` (line ~106).
- **Change:** the left group is `flex min-w-0 flex-1 flex-nowrap`. Below about 1100px, Filter and Views slide underneath the trailing bulk buttons (seen on `/receiving` at 800px: Tag sits over Filter, Label over Views). Give the left group `flex-wrap` (or a `basis-[28rem]` so the outer `flex-wrap` moves `trailing` to its own row).
- **Reason:** every grid with a `trailing` slot overlaps at tablet widths. M05 shows bulk buttons icon-only below `xl` meanwhile.
- **Status:** applied (F-patch 2026-11-06): left group of `GridToolbar` gets `basis-[28rem]`, so the outer `flex-wrap` moves `trailing` to its own row instead of overlapping Filter / Views.

## REQ-10 — `ProductSearchAdd` drops every result from `/api/pickers/products`
- **File:** `src/components/shared/contracts.ts` (`productPickSchema`), or `src/server/repositories/platform-pickers.ts` (`products` picker).
- **Change:** the route returns picker options `{ id, label: sku, sublabel: name, meta: { clientId, name, uom, imageUrl, isKit } }`. `productPickSchema` expects `{ id, sku, name, imageUrl, atp, uom, clientId }`, so `parseList` fails on the whole array and the UI says "No products match" even for an exact SKU. Two ways to fix it:
  - Add a `z.preprocess` in `productPickSchema` that maps `label → sku`, `meta.name ?? sublabel → name` and lifts `meta.*`.
  - Or add a `shape=pick` mode to the products picker that returns the `{ sku, name, atp, … }` shape, with ATP when `warehouseId` is given.
- **Reason:** found in the browser walk. Searching `CPL-BAG-MED-12` in `/receiving/new` step 2 shows no results even though the API returns the product. The same component is used by `src/components/orders/wizard/step-products.tsx` (M01), so the shipment order wizard is affected too.
- **Adapter:** M05 uses `src/components/receiving/wizard/po-product-search.tsx`, which maps the picker shape and has no ATP column (POs don't check ATP). Swap back to `ProductSearchAdd` once this lands.
- **Status:** applied (F-patch 2026-11-06): `productPickSchema` (`src/components/shared/contracts.ts`) now preprocesses the picker option shape (`label -> sku`, `meta.name ?? sublabel -> name`, `meta.*` lifted), so `ProductSearchAdd` lists `/api/pickers/products` results. ATP stays empty unless the picker sends `meta.atp`.

## REQ-11 — Wizard: let a step disable Next
- **File:** `src/components/ui/wizard/wizard-types.ts` and the Wizard footer.
- **Change:** add an optional `canProceed?: (values: T) => boolean | string` to `WizardStep`. When it returns false or a reason string, Next is disabled and shows a DisabledReason tooltip.
- **Reason:** the M05 spec says "Next stays disabled while there are no lines." Today Next is clickable, and the step schema then blocks it with the inline error "Add at least one product". That is functionally correct but doesn't match the spec. M05 will pass `canProceed: (v) => v.lines.length > 0 || "Add at least one product"` once it lands.
- **Status:** applied (F-patch 2026-11-06): `WizardStep.canProceed?: (values) => boolean | string`; Next is disabled with a DisabledReason tooltip (string, or "Complete this step to continue" for `false`), and Enter does not advance. Helper `proceedReason(step, values)` exported from `wizard-types.ts`.
