# M02 shipping — progress

Round 1 builder. Owned paths per BUILD_PLAN M02.

## Decisions
- EOD manifests: foundation `shipOrders` only links labels to a manifest at ship time, and the
  `(warehouse, connection, ship_date)` unique index blocks a second manifest after close. The EOD
  grid therefore merges stored manifests with "pending" groups derived live from unlinked active
  shipping labels (grouped by warehouse, carrier connection and the warehouse-local label date).
  Total package is always the live count of non-voided shipping labels in the group, so creating
  or voiding a label moves the number on the next refresh. See REQ-1/REQ-2.
- Pending groups whose labels are all voided are hidden (nothing to hand to the carrier).
- Closing writes go through `src/server/repositories/end-of-day-adapter.ts` (interim, REQ-1).
- Shipment plan "Shipped" status is never set directly from the popover: it routes to Ship, which
  ships every Ready to Ship order through `shipping.shipOrders`, then walks the plan along the
  state-machine path to Shipped.
- Expected weight is lb (Σ qty × product weight oz / 16), expected volume ft³ (Σ qty × L×W×H / 1728).
- Permission-gated controls read `useHydratedPermissions()` (shipping-client): empty until hydration,
  which fixed a hydration mismatch on `/shipment-plans` (header "Create shipment plan" button).
- Add order(s) uses the local `plan-order-picker.tsx` on `/api/shipment-plans/eligible-orders`
  (server-filtered to warehouse/client/eligible statuses/not on another active plan) because the
  shared OrderPickerDrawer crashes (REQ-3).
- Export providers stay on the generic fallback (exports exactly what each list endpoint returns);
  verified all six grids export to xlsx in Export History.

## Done (verified live on localhost:3000, 2026-11-06)
- All 7 routes render with no console errors; 404 state for a missing plan.
- Label → Carrier Shipment Details + EOD +1; void → Voided + void date, EOD −1; void again / reprint
  voided → INVALID_STATE (orders SO010847/SO010848, KS-TEST customers).
- EOD close of the 2026-11-05 pending group → Closed, close date, Printed Yes, PDF with Code 128
  barcodes; reprint and custom report PDFs; close again → per-id failure. Confirm dialog with mini-table in UI.
- Shipment plan KS-E2E-SP-1 with 2 orders: popover offers only legal next statuses, illegal → INVALID_STATE,
  stale version → 409 CONFLICT, Picking/Job operations created the job, Ship → both orders Shipped, plan
  Shipped with actual shipment date, Plan Orders tab reflects it, change_log rows written, Manifest/BOL PDF.
- Shipment History rows for SO010847 match the ledger (qty 1, tracking linked).
- Wizard: auto code, inline errors + focus on first error, Next/Back across 3 steps, order picker add,
  unsaved-changes guard on Cancel (fixed) and close.
- Viewer: reads 200, every M02 mutation 403.
- Unit tests: tests/unit/shipping (21 passing).

## Remaining / waiting on foundation
- REQ-1, REQ-2 (second manifest same day after close), REQ-3 (shared picker), REQ-4 (Esc in combobox), REQ-5 (seed LPs).
- Built-in browser tab cap was reached by other agents; UI checks ran in headless Playwright with the
  project's e2e storage states instead. Side-by-side visual critic vs Logiwa not done this round.
