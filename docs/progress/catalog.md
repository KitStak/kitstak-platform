# M09 catalog — progress

Started 2026-11-06 (round 1). Builder notes; read first when resuming.

## Verification tooling
- Scratch scripts live in the session scratchpad `m09/` (lib.mjs = API client, pw.mjs = headless Playwright with API-login cookies).
  The built-in browser pane is at its tab cap, so UI checks run headless.

## Done (code)
- grid-defs: catalog-options, product-form (zod per step), products-grid, listings-grid (+ derived Exception filter/column/export).
- Repositories: products, products-detail, products-commands, products-options, products-import, products-export, products-snapshot, listings
  (incl. `listListingExceptions`).
- APIs: /api/products (list/create), [id] (get/patch/delete), [id]/status, bulk/{delete,delete-check,status}, check-sku, check-barcodes, components, options;
  /api/listings (list), [id]/{link,unlink,never-sync,create-product}, bulk/never-sync, options, exceptions.
- UI: products page (Bulk Import/Update menu, delete guard + deactivate, label, row kebab incl. duplicate + change log), category chooser drawer (embeddable),
  wizards A/B/C, edit drawer (free mode, client locked), /products/new, product detail with 8 URL-synced tabs, listings page + link modal + Exception column.
- Import handlers (7), search provider, export providers.
- Unit tests: tests/unit/catalog/{product-form,products-commands,listing-exceptions}.test.ts (39 passing).

## Verified (running app, 2026-11-06)
- API acceptance: KS-E2E-PROD-1 (Unit 2 barcodes + Case child 12 → UOM 12, lot + expiry), first in grid, change log Create; duplicate SKU same client 409, other client ok;
  kit 0 components blocked; KS-E2E-KIT-1 with 2 components → components show "Used in kits"; stale PATCH → 409.
- UI: wizard A, kit wizard (inline "Add at least one component to the kit", kit advanced = 3 sections), packaging material (no Liquid flag, flag in grid).
- UI: Edit drawer (client locked, free step nav) saves; Change log drawer shows field-level "Name is modified"; bulk Label opens print options;
  bulk Delete on APX-TEE-BLK-L shows mini-table "Blocked · Has 556 units on hand" + "Deactivate 1"; detail Deactivate/Activate round trip; Duplicate prefilled.
- Listings: linking APX-TEE-GRN-L in UI → toast, row leaves Unlinked, appears in Linked with Exception "—", gone from /api/listings/exceptions;
  Create product from listing (APX-TEE-GRN-M) works; Exception filter listed.
- Imports: pack-types batch "Successful" 5/5 with history.
- Viewer roles get 403 on every products/listings API (viewer has no Settings permissions by design).

## Remaining / handoffs
- REQ-1 (docs/requests/catalog.md): M12 page should consume /api/listings/exceptions.
