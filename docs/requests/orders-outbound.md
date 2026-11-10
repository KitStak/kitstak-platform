# Requests from M01 orders-outbound

## REQ-1 — Extend `orderHeaderSchema` with the wizard's extra columns
- **File:** `src/server/domain/orders/schemas.ts` (and `create-update.ts` so `createOrder`/`updateOrder` persist them).
- **Change:** add these optional fields (all columns already exist on `shipment_orders`): `taxType`, `taxId`, `useShipAsBilling`, `billingAddress`, `scheduledPickupDate`, `scheduledShipmentDate`, `shippingChargesBillingType`, `taxDutiesBillingType`, `shippingAccountNumber`, `taxDutiesAccountNumber`, `shipmentPackageId`, `totalShippingCost`, `discount`, `trackingNumber`, `trackingNumbers`, `reasonForExport`, `returnAddressId`, `returnCarrierServiceId`, `returnShippingCost`, `returnTrackingNumbers`, `fraud`, `packingWarningTypeId`, `retailerId`, `bol`, `pro`, `retailerPo`, `dept`, `markFor`, `retailerCustomerAccount`, `customerId`, `priorityRank`. Change-log labels should resolve ids to names (retailer, lookup, package, carrier service, address).
- **Reason:** the create/edit wizard (spec 01 §2) edits all of them. Until this lands, `src/server/repositories/orders-commands.ts` (`orderExtrasSchema` + `applyExtras`) writes them in the same transaction and logs them.
- **Status:** applied (F-patch 2026-11-06): `orderHeaderSchema` carries every listed field (same validation as M01's `orderExtrasSchema`; `billingAddress` normalised to `AddressValue | null`), so `createOrder` / `updateOrder` persist them. Change-log values of id fields resolve to names (REQ-8). M01 can drop `applyExtras` (`createOrderBodySchema.extend(orderExtrasSchema.shape)` still parses).

## REQ-2 — `createOrder` should log one change-log entry per line
- **File:** `src/server/domain/orders/create-update.ts`.
- **Change:** after inserting lines, call `recordLine(... field: "quantity", from: 0, to: qty)` per line (Logiwa: "<SKU> → Shipment Order Line is created").
- **Reason:** acceptance "Change Log shows the Create entry plus one entry per line". Done locally in `orders-commands.createOrder` for UI/API creates; imports and channel creates still miss it.
- **Status:** applied (F-patch 2026-11-06): `createOrder` writes one `recordLine` per line ("<SKU> -> Quantity is modified. 0 --> n") for UI, import and channel creates. **M01: delete the local loop in `orders-commands.createOrder` (lines ~159-163), it now duplicates the entries.**

## REQ-3 — `ledger.unassignOrderSerials` / `ledger.assignOrderSerial`
- **File:** `src/server/domain/ledger/**`.
- **Change:** domain functions to attach/detach registered serial numbers to an order line (writes `serial_transactions`).
- **Reason:** Delete ▾ → Remove Serial Number and the SO serials import. Local adapters live in `orders-commands.removeSerials` and `orders-import.ts`.
- **Status:** applied (F-patch 2026-11-06): `ledger.assignOrderSerial(tx, ctx, { orderLineId, serial })` and `ledger.unassignOrderSerials(tx, ctx, { orderLineId })` in `src/server/domain/ledger/serials.ts` (scope-checked, line-level change_log). Assignment moves no stock, so no `serial_transactions` row is written (that table needs an inventory transaction id); picking/shipping keep writing them.

## REQ-4 — Wizard: optional rail header/footer slot
- **File:** `src/components/ui/wizard/wizard.tsx`.
- **Change:** accept `railExtra?: (values) => ReactNode` rendered below the rail card (outside the sticky Save card) so detail pages can stack Assigned Jobs / Printouts cards under the Summary.
- **Reason:** the order detail right rail (spec 01 §3). M01 composes `useWizard` + `WizardStepper` + `WizardRail` itself in the meantime (`src/components/orders/wizard/order-wizard-shell.tsx`).
- **Status:** applied (F-patch 2026-11-06): `Wizard` accepts `railExtra?: (values) => ReactNode`, rendered under the rail card (outside its Save card); without it the layout is unchanged.

## REQ-5 — Create Job from Open orders must allocate (and modal/API body mismatch)
- **Files:** `src/server/domain/jobs.ts` (`createJobsFromOrders` / `mergeIntoJob` eligibility), `src/components/shared/create-job-modal.tsx`, `src/server/repositories/platform-ops.ts`.
- **Change:**
  1. `createJobsFromOrders` / `mergeIntoJob` should allocate Open / Shortage orders (warehouse algorithm, full mode) inside the same transaction before adding them to the job — Logiwa's Picking/Job Operations does this, and acceptance says "Create New Job sets the order to Ready to Pick". Today it throws `INVALID_STATE` "only Ready to Pick orders can be added to a job".
  2. The shared `CreateJobModal` posts `{ operation, ids }` to `/api/ops/jobs/eligibility` and `{ operation, mode, ids, jobTypeId }` to `/api/ops/jobs`, but both schemas require `orderIds` (eligibility also requires `jobTypeId` or `jobId`). Every open of the modal currently fails with 400 `VALIDATION: orderIds — expected array`. Either the modal must send `orderIds` (+ the chosen job type before the eligibility check) or the schemas must accept `ids`.
- **Reason:** M01 checklist 3 "Picking/Job Operations" and the "Allocate and pick" acceptance item. Local adapter: `src/components/orders/bulk/order-job-modal.tsx` allocates first through `/api/ops/allocate`, then opens the shared modal (still blocked by item 2).
- **Status:** applied (F-patch 2026-11-06): (1) `jobs` eligibility allocates Open / Shortage orders (warehouse algorithm, full mode) before adding them to a new or existing job; a short order stays Shortage with its exception and is reported as failed. (2) `/api/ops/jobs` and `/api/ops/jobs/eligibility` accept `ids` (mapped to `orderIds` / `workOrderIds` / `countPlanIds`); eligibility with no job type / job returns the pre-check plus `jobTypes` (active Picking types of the orders' warehouses), and every ineligible row carries `reason`. The shared `CreateJobModal` works end-to-end again.

## REQ-6 — Drizzle renders bare column names in single-table selects (correlated subqueries bind to the wrong table)
- **Files:** any repository using `sql\`(SELECT … FROM other o WHERE o.x = ${table.id})\`` in a select without joins — e.g. `src/server/repositories/locations*.ts`, `products*.ts`, `purchase-orders*.ts` (worth a grep).
- **Change:** in a single-table `db.select().from(t)`, drizzle 0.45 renders `${t.id}` as `"id"`, so `WHERE l.order_id = "id"` binds to the subquery's own `id` (silently wrong) or fails with `ambiguous column name: id`. M01 fixed its own paths with a table-qualified map (`q` in `src/server/repositories/orders-grid.ts`). Suggest a shared `qualified(table)` helper in `src/server/query/` and an audit.
- **Reason:** this made `GET /api/orders` return 500 (the Backlog grid was empty) and made `hasActiveTask`, tags and allocated quantity read the wrong rows.
- **Status:** applied (F-patch 2026-11-06): shared helper `qualified(table)` in `src/server/query/qualified.ts` (renders `"table"."column"`). Audit of other modules is theirs; foundation's new SQL uses qualified refs.

## REQ-7 — Foundation unit tests import removed M01 files
- **Files:** `tests/unit/foundation-fix3/fix3-pure.test.ts` (imports `@/components/orders/detail/order-presenter`), `tests/unit/foundation-fix4/fix4-pure.test.ts` (imports `@/components/orders/orders-page`).
- **Change:** drop those cases; M01 deleted the SYNTH presenter and the old list page per checklist item 13 (cleanup). Equivalent coverage now lives in `tests/unit/orders-outbound/*`.
- **Status:** applied (verified by F-patch 2026-11-06): the stale cases were already removed in foundation-fix7; neither test imports the deleted M01 files.

## REQ-8 — Change log must never store raw lookup ids (cancel reason)
- **Files:** `src/server/domain/orders/commands.ts` (`cancelOrders` → `setStatus(..., { cancelReasonId })`) and/or `src/server/domain/change-log.ts` (value formatting for `*Id` fields).
- **Change:** log `cancelReasonId` with the lookup name ("Customer request"), not the id; ideally a shared id→name resolver in `change-log.ts` for `cancelReasonId`, `shipmentPackageId`, `warehouseId`, `clientId`, `masterOrderId`, `packingWarningTypeId`, `retailerId` (jobId already resolves to the job code).
- **Reason:** "No raw UUIDs anywhere in UI": the shared ChangeLogDrawer showed "Cancel Reason is modified. --> 3d543cd1-…". M01 local adapter `labelCancelReason` in `src/server/repositories/orders-bulk.ts` rewrites the row in the same transaction for UI/API cancels; historical rows written before the adapter (seed/earlier runs) still carry ids and need a one-off backfill by the DB owner.
- **Status:** applied (F-patch 2026-11-06): `recordUpdate` resolves id-valued fields to display values (`cancelReasonId`, `packingWarningTypeId`, `orderTypeId`, `shipmentPackageId`, `warehouseId`, `clientId`, `masterOrderId`, `mergedIntoOrderId`, `retailerId`, `carrierServiceId`, `customerId`, `vendorId`, `productId`, `locationId`, `*UserId`, …; unknown ids keep the id). One-off backfill run on the live DB: 144 historical change_log rows (cancelReasonId, assignedToUserId, shipmentPackageId, packingWarningTypeId, retailerId, masterOrderId) rewritten to names. `labelCancelReason` is now a no-op and can go.

## REQ-5 update
- The shared `CreateJobModal` still posts `ids` (server wants `orderIds`) and expects `jobTypes` in the eligibility response. M01 no longer uses it: `src/components/orders/bulk/order-job-modal.tsx` is a full local Picking/Job Operations modal (allocate → choose → merge/create, live `/api/ops/jobs/eligibility` dry run with `orderIds`) backed by the new `GET /api/orders/job-options`. Item 2 of REQ-5 is still pending for the other modules that use the shared modal.
- **Status:** applied (verified by F-patch 2026-11-06, M14 round 1): this note predates the REQ-5 patch. `src/server/repositories/platform-ops.ts` maps `ids` to `orderIds` / `workOrderIds` / `countPlanIds`, and eligibility returns `jobTypes` plus `reason` on every ineligible row, so the shared `CreateJobModal` works as it is. Keeping M01's local modal is fine.
