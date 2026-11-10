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
