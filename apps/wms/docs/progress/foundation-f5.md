# Foundation F5 — Domain engines (progress)

Plan: `docs/BUILD_PLAN.md` § F5 (lines 1771-1899) + invariants 0.4. Status: **complete**.

- [x] errors/types/bulk (`DomainError`, `NotImplementedError`, `DomainCtx`, `runBulk` per-id savepoints)
- [x] sequences (`next`, `peek`, bootstrap from existing codes, wave/IC/bill/LP helpers)
- [x] change-log (field-level diff with human labels, `recordLine`, `lastFromValue`)
- [x] state-machines (SO, PO, job, task, count plan/line, WO, return, shipment plan, EOD, billing report, wave) + `canTransition`, `path`
- [x] ledger (bucket, txn, rules, operations, allocations, receipts, serials, verify)
- [x] conditions + facts + atp
- [x] allocation
- [x] jobs + tasks + progress + task-handlers (picking/packing/sorting/loading; stubs count/replenishment/kitting)
- [x] carriers (adapter registry, sandbox, PDF/ZPL labels) + shipping
- [x] address-verification, notify, workflows (+ `src/server/workflows/actions` stub registry)
- [x] putaway (+ 38 actions) + dynamic replenishment targets
- [x] orders, products
- [x] repositories stubs: counts-commands, work-orders-commands
- [x] tests: `tests/unit/foundation/domain/**` (85 tests incl. F8.6 scenario); line coverage 98.4% on src/server/domain + workflows
- [x] verification: tsc clean on owned paths, eslint clean, vitest green for owned tests

## Handoff notes
- Import: `import { ledger, stateMachines, orders, allocation, jobs, tasks, shipping, ... } from "@/server/domain"`. Every engine is `(tx, ctx, input)`; `ctx = { userId, source, scope? }` — pass `{ ...ctx.actor, scope: ctx.auth.scope }` from defineRoute to get 404-on-cross-scope.
- **Ledger balance convention** (F8 `db:verify`): bucket on-hand = Σ uom_qty where `to_inventory_id` = bucket − Σ where `from_inventory_id` = bucket. Adjust/Count rows use `to` + signed qty; Allocation rows have from = to (net 0). `ledger.reconcileLedger(db)` implements every 0.4 #6 check — scripts/verify-ledger.ts can just call it and print issues.
- **Allocation model**: allocation does not move stock; `inventory.allocated` = Σ active `inventory_allocations` (Allocated/Picked/Sorted/Packed/Loaded). Allocations travel with stock on pick/pack/sort/load (split when partial). Shipped allocations get status `Shipped`.
- `order_lines.allocated_quantity` is cumulative (not reduced by pick/ship), only by release; so picked ≤ allocated ≤ quantity holds.
- Shipping label/rate/void/return functions are **async** and take the DB (not a tx); use `defineRoute({ transaction: false })`. Labels are stored through F6 `fileStore()` (purpose `print`); tests inject `createFileStore({ root })` via `{ files }`.
- Carrier adapters: `registerCarrierAdapter()` in `@/server/domain/carriers` (M12). Sandbox provider key `kitstaks-sandbox`, service codes `SBX_GROUND|SBX_2DAY|SBX_NEXT_DAY|SBX_PRIORITY|SBX_GROUND_ADVANTAGE|SBX_INTL` — F2 seed should create `carrier_services` rows with these codes.
- Workflow actions (M12): register executors in `src/server/workflows/actions/registry.ts`; until then runs record "Action 'X' is not configured yet."
- On Hold stores no column: release reads the status before hold from `change_log` (`lastFromValue`).
- Merge contract for M03: merged children are put On Hold with `mergedIntoOrderId`; master lines copied from a child carry `originalOrderCode`. `unmergeOrder` relies on this.
- Sequence keys: `so, po, job, rma, count, workOrder, shipmentPlan`, `receipt` (integer master id), `bill:<YYMMDD>`.
- Pre-existing failure not caused by F5: `tests/unit/foundation/instrumentation.test.tsx` "scheduler stub reports not configured" (F0 test vs F6 scheduler).
