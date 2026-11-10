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

## Remaining
- Browser click-through of every route/menu/modal (browser tab cap reached for the whole round, including the resume session; `tabs_create`
  refused repeatedly while other agents hold all 9 tabs). Earlier session records KS-TEST-WO-E2E / KS-TEST-WO-PICK (Completed) show the flows were run.
- Shared requests REQ-1..REQ-5 still pending (see docs/requests/work-orders-kitting.md). Until REQ-1 lands,
  Cancel Picking on an In Process work order is refused with a clear message (Shortage → Open works).

## Decisions
- Writes to jobs/tasks/allocation_exceptions for work orders happen inside the stub-handoff command
  `work-orders-commands.ts` (handed to M08 by 0.6) and the kitting task handler (also handed over).
- Shared copy "You have unsaved changes!…" in the Drawer differs from Logiwa; the wizard drawer
  runs its own guard with Logiwa's exact copy (No / Leave) instead of the Drawer `dirty` prop.
- The kit output is posted by `ledger.recordReceipt` (receipt type Kitting, ledger row Receiving); component
  consumption posts ledger `Kitting` rows.
- Recalculate Now requires only the Kit Inventory view permission: it refreshes a derived cache (CSRF still enforced).
