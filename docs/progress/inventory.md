# M06 inventory — progress

## Done
- Grid defs: `src/lib/grid-defs/inventory/{total-inventory,by-location,atp,fields,permissions}.ts`
- Repos: `inventory-{grid,total,by-location,atp,lookups,commands,export,open-orders}.ts`;
  `inventory.ts` restored as a LEGACY shim for `reports.ts` / `scripts/verify-data.ts` (deleting it broke them).
- APIs: `/api/inventory` (total), `/by-location`, `/atp`, `/add`, `/buckets/[id]`, `/buckets/[id]/quantity`,
  `/transfer-product`, `/transfer-location`, `/transfer-lp`, `/change-attributes`, `/summary`, `/reasons`,
  `/product-options/[id]`, `/open-orders` (302 to Orders filtered `f.code=in:` — exact open orders).
- Import handler `src/server/imports/handlers/inventory.ts`; export providers for the 3 grids (export verified: 269 rows, completed).
- UI: Total Inventory, Inventory by Location (drawers: quantity, transfer product, transfer LP/location,
  change attributes, add inventory, bucket drawer), ATP.
- Session 2 fixes: mutation form typing (tsc clean on own paths), Products link uses `f.clientId`,
  Open SO links via `/api/inventory/open-orders`, duplicated warehouse label ("KS2 - KS2 - Overflow"),
  qty column widths so header tips no longer overlap, duplicate icon in the ATP callout.
- Unit tests `tests/unit/inventory/*` (22 passing): adjust/add/remove/reason rule/409, allocated-row guard,
  transfer product/location/LP, only-1-SKU rule message, damage → undamaged/ATP, lot bulk + per-row failures,
  add inventory tracked attrs, grid grammar, scope, import handler.
- Live API verification (shared DB, all reverted): adjust 20→18 with reason (total & ATP −2, txn shows reason+user),
  stale version → 409, transfer 5 out and back, damage 3 → undamaged & ATP −3 then cleared, non-Stock row → 409 INVALID_STATE,
  filters (status/damage/date/rng), bad sort → 400, export queued → completed.
- e2e spec `tests/e2e/inventory/inventory.spec.ts`.

## Session 3 (resume)
- tsc clean on own paths; unit tests 29/29 passing.
- e2e 16/16 passing after raising the spec's actionTimeout to 45s (the shared dev server compiles routes on first hit;
  10s API timeouts were flaking under multi-agent load, not a product bug).
- Open SO deep link verified end-to-end: `/api/orders` works again; `/api/inventory/open-orders?productId=<CPL-BAG-DEC-12>`
  302s to `/orders?f.code=in:SO010655` and the Orders API returns exactly that order.
- db:verify: the only failure (serial_stock on VLT-EBD-PRO) comes from an M04 Return Receiving txn (RMA000323), not M06.
- Dead-click audit on /inventory, /inventory/by-location, /inventory/atp: hit page.goto 30s timeouts on the overloaded
  shared server; retried from a warm start.

## Blocked / pending elsewhere
- docs/requests/inventory.md REQ-1 (seed acceptance fixtures MLT-WIDGET-01 / MLT1-A-01 only-1-SKU / "Import" reason),
  REQ-2 (Orders line-wise SKU filter). `/api/orders` currently 500s (M01 in progress), so the Open SO redirect target
  can't be verified end-to-end yet.
- Built-in browser pane: tab cap reached (other agents), so UI verification runs through headless Playwright.

## Decisions
- Quantities in drawers are in the row's pack type; ledger works in UOM.
- Allocated (non-Stock) rows show a lock icon with a tooltip instead of the ⋯ menu.

## Session 4 (resume, 2026-11-06)
- tc-queue: 0 errors in all M06 paths. Unit tests 29/29. e2e `tests/e2e/inventory/inventory.spec.ts` 16/16 (2.3 min).
- Dead-click audit (`AUDIT_ROUTES=/inventory`, run from PowerShell; Git Bash mangles the leading `/`): every M06 control
  works except three reported hits, all checked by hand:
  - "Move <col> column" grips: drag-only handles in shared `src/components/grid/data-grid-header.tsx` (not M06; they flag on
    every grid, kits/ATP included).
  - by-location "Total Pack Qty" sort and "About Total Pack Qty": a headless re-check shows the click POSTs
    `/api/inventory/by-location` with the new sort and the hover tooltip renders the formula text. The 600 ms audit window
    is too short for the shared, loaded dev server.
- Built-in browser pane is still at its tab cap (other agents' tabs), so UI checks stay on headless Playwright.

## Still pending outside M06
- REQ-1 (seed MLT-WIDGET-01/02, MLT1-A-01 only-1-SKU, "Import"/"Damaged" reasons), REQ-2 (Orders line-wise SKU filter),
  REQ-3 (shared shell/grid contrast). The acceptance flows were verified on live equivalent data and in unit tests.
