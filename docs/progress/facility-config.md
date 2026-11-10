# M10 facility-config — progress

## Done (round 1, run 1 — files present before this log existed)
- grid-defs: `src/lib/grid-defs/facility/{common,locations,location-generator,warehouses,mobile-carts,lp-types,lp-numbers,shipment-packages}.ts`
- Locations: repo (`locations.ts`, `locations-shared.ts`, `locations-generator.ts`), APIs (list/create, [id] get/patch/delete, contents, bulk-delete, bulk-lock, labels, zones, generator + preview), page, 3-step wizard + capacity modals, generator drawer, detail page, zone strip. Old fork `locations-data-grid.tsx` deleted.
- Shared client pieces: `src/components/facility/{facility-shared,form-controls,pickers}.tsx`.

## Run 2 (resume)
- [x] Warehouses repo/API/page/drawer (found present)
- [x] LP Types repo/API/page/wizard (found present)
- [x] LP Numbers repo/API/page/create+edit drawers/print barcode (found present; fixed Import button TS error)
- [x] Mobile Carts repo/API/page/wizard/duplicate/labels (run 3)
- [x] Shipment Packages repo/API/page/wizard (run 3)
- [x] Import handlers (7, `locations-import.ts` + `lp-numbers-import.ts`) + export providers (6, `<entity>-export.ts`, stubs re-export them) — run 4
- [x] Unit tests `tests/unit/facility-config/{mobile-carts,locations,lp-and-settings}.test.ts` (31 passing) — run 4
- [ ] Browser verification of every route

## Decisions
- Change log for entities the platform `/api/change-log` does not know yet (warehouse, lp_type, mobile_cart, shipment_package) is served by module endpoints `/api/<entity>/[id]/change-log` (REQ-1 asks foundation to register them).
- LP Types / Shipment Packages have no `change_log` permission key in the catalog; their change log is gated by `view`.
- Mobile cart cell labels use the `mobile-cart-label` print type (code = cell barcode).

## Run 4 (resume) — HTTP verification against live dev server (browser tab cap reached by other agents)
- All 6 pages return 200; all 6 list APIs succeed (335 locations, 2 warehouses, 4 carts, 6+ LP types, 120+ LPs, 11 packages).
- Export As Excel queued for all 6 grids via `/api/exports`; all completed with row counts equal to list totals (module providers, not generic).
- All 7 import keys: definition `configured: true`, templates download (xlsx).
- Acceptance (live DB): generator KST A–B × 01–03 × 1–2 created 12, second run 0 created / 12 collisions. LP type KS-E2E-TOTE (KSE-, 5) + 3 from sequence → KSE-00001..00003; Print labels → 3-page PDF; SSCC18 without client → VALIDATION fieldError on clientId. KS-E2E-LOC-01 created (Shelves/Picking, Only 1 SKU, cap 5/50), barcode = code, change_log Create row.
- Remaining: interactive browser click-through of wizards/menus/kebabs (needs a free browser tab), viewer-role 403 check, cross-module acceptance (M06 putaway block, M05 default receiving, M04 package consumption).
