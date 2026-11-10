# M02 shipping — shared-change requests

## REQ-1 — Maintain EOD manifests at label time
- **File:** `src/server/domain/shipping/labels.ts` (`insertShipments` / `voidLabel`), `src/server/domain/shipping/ship.ts`.
- **Change:** when a Shipping Label is created, attach it to the Open `end_of_day_manifests` row for
  `(warehouse_id, carrier_connection_id, warehouse-local label date)`, creating it if missing, and keep
  `total_packages` in sync on create and void. Export `shipping.ensureOpenManifest(tx, ctx, { warehouseId, carrierConnectionId, shipDate })`.
- **Reason:** spec M02 §2 says "Manifests are maintained automatically as labels are created and voided".
  Today only `shipOrders` links labels, so M02 derives "pending" manifests live and writes the link at close
  through `src/server/repositories/end-of-day-adapter.ts` (interim; it already prefers `shipping.ensureOpenManifest` when exported).
- **Status:** applied (F-patch 2026-11-06): `shipping.ensureOpenManifest(tx, ctx, { warehouseId, carrierConnectionId, shipDate, carrierCode? })` exported. Shipping labels join the Open manifest of their warehouse-local label date when created (`attachLabelsToManifest`, `totalPackages` +n) and leave it on void while it is Open (`detachVoidedFromManifest`, -n). `shipOrders` only links labels that have no manifest yet. The adapter in `end-of-day-adapter.ts` now delegates automatically.

## REQ-2 — Allow a second manifest for the same carrier/day after close
- **File:** `src/server/db/schema/shipping.ts` (`end_of_day_manifests`, index `eod_unique_idx`) + migration.
- **Change:** add `sequence integer not null default 1` and make the unique index
  `(warehouse_id, carrier_connection_id, ship_date, sequence)` (or make it a partial unique index `WHERE status = 'Open'`).
- **Reason:** acceptance "A label created afterwards opens a new Open manifest". The new label already shows as an
  Open (pending) row, but closing it hits the unique index; the adapter returns a clear INVALID_STATE message until this lands.
- **Status:** applied (F-patch 2026-11-06): `end_of_day_manifests.sequence integer not null default 1`, unique index `(warehouse_id, carrier_connection_id, ship_date, sequence)` (migration `0001`, applied live). After close, the next label opens `sequence + 1`; foundation test updated.

## REQ-3 — Shared OrderPickerDrawer crashes on render
- **File:** `src/components/shared/order-picker-drawer.tsx` and/or `src/server/repositories/platform-pickers.ts` (named picker `orders`).
- **Change:** the drawer reads `row.status`, `code`, `customerName`, `quantity`… but `/api/pickers/orders` returns
  `{ id, label, sublabel, meta: { status, … } }`, so `StatusPill` receives `undefined` and the page error boundary trips
  ("Cannot read properties of undefined (reading 'trim')"). Either return grid rows (`code`, `status`, `customerName`, `clientName`,
  `quantity`, `lineCount`, `orderDate`, `shipBy`, `storeOrderCode`) when the drawer calls it, or map `label/meta` in the drawer.
  Also `useLocalGrid({ gridKey: "picker:orders" })` triggers `GET /api/saved-views?gridKey=picker%3Aorders` → 400; the
  saved-views key validation should accept it or the local grid should skip saved views.
- **Reason:** shipment plans need Add order(s). M02 uses a local adapter (`src/components/shipment-plans/plan-order-picker.tsx`
  on `/api/shipment-plans/eligible-orders`) until this is fixed. M04 has its own shipped-order picker for the same reason.
- **Status:** applied (F-patch 2026-11-06): new grid endpoint `GET /api/pickers/orders/grid` (`src/server/repositories/platform-order-picker.ts`: grid grammar + `clientId`, `warehouseId`, `status`; scoped; returns `OrderPick` rows). `OrderPickerDrawer` uses it; `status` defaults to "" and `statusToneName` / `statusTone` / `isPartialStatus` tolerate a missing status; saved-views `gridKeySchema` accepts `:` so `picker:orders` no longer 400s.

## REQ-4 — Esc is swallowed by a closed combobox inside a drawer
- **File:** the shared combobox used by `CustomerPicker` / `WarehouseSelect` (`src/components/shared/**` / `src/components/ui/**`).
- **Change:** only stop propagation of `Escape` while the listbox is open; when it is closed let it reach the Radix dialog so the
  drawer's close / unsaved-changes guard runs.
- **Reason:** A0.5 "Esc closes". With focus in the Customer field of the Create shipment plan drawer, Esc does nothing.
- **Status:** needs-info (F-patch 2026-11-06): the shared `Combobox` never stops Escape propagation; it only closes its own list when open, and Radix closes one layer per Esc (an open list first, then the drawer). Clicking the field opens the list, so the first Esc closes the list and the second closes the drawer. If a single Esc on a closed list does nothing, add the exact repro (component, steps) and it will be fixed.

## REQ-5 — Seed license plates on shipment-plan orders
- **File:** `src/server/db/seed/**` (shipment plans SP000041–SP000044).
- **Change:** allocate / ship a few of the seeded plan orders from license plates (LPN + parent LP) so `/shipment-plans/lps` and the plan
  detail "License plates" card show believable data.
- **Reason:** the Plan LPs grid is correct but empty on the demo data ("No license plates on shipment plans yet").
- **Status:** deferred (F-patch 2026-11-06): believable plan LPs need the seed replay to put stock on LPs before picking (`seed/history.ts` + `outbound.ts`). Retrofitting LP moves onto the live DB means re-running pick/pack for shipped orders, which the ledger would not reconcile. It will land with the next seed regeneration. Meanwhile any plan order allocated from LP stock shows up in `/shipment-plans/lps`.
