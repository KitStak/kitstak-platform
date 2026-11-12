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

## Round 1 (parity loop) — 2026-11-09
Benchmark: references/logiwa-live/masterdata-reports.md §5–6 (live MLT1 capture) + delta items 3, 6, 7.

Done (code):
- **Product Listings "KitStaks product" cell** (`listing-product-cell.tsx`): Logiwa's LOGIWA PRODUCT cell. Thumb, link-state pill
  (No match grey / Suggested amber / Linked green), SKU (+ name), in-cell icon actions with tooltips:
  No match → Create a product · Search a product; Suggested → Info · Don't match these products · Match these products;
  Linked → Info · Unlink. Info is a popover (thumb, SKU, name, client, seller SKU, status, linked at, description, Open product).
  Column moved next to Seller SKU (380px, always visible). Handlers come through a context, so columns stay static.
- **Link Product drawer** (`listing-link-drawer.tsx`, replaces the old modal): tabs Search & select | Create new | Suggested
  (Suggested / Create new disabled when not applicable). Search: client-scoped prefix search, ↑/↓ + Enter to select, Enter/double-click to link.
  Create new: Logiwa's quick form (client locked, SKU*, Name*, Description 0/500, image URL with preview, UOM pack type, weight + unit,
  sales/purchase price, tax %, barcode, product type/group, Active?/Never sync/Fragile/Oversized), prefilled from the listing,
  client + server validation with inline errors and focus on the first bad field, unsaved-changes guard.
  Logiwa's "Initial Quantity" is deliberately omitted (would book stock with no location/lot/receipt); stock enters via receiving/adjustment.
- **API**: `POST /api/listings/[id]/create-product` takes optional `{ product, version }` → `createQuickProductForListing` (full Wizard A
  validation via `createProductFromWizard`, link, Never Sync, all in one transaction, change-logged). New
  `POST /api/listings/[id]/dismiss-suggestion` → `dismissSuggestion` ("Don't match"): audited as change-log field `dismissedSuggestion`;
  `suggestionSql` skips the dismissed SKU; linking that product later withdraws the dismissal.
- Listing rows now carry linked/suggested product image, description and status (for the cell + Info popover).
- Double-submit guards: drawer ref guard + per-listing in-flight guard for in-cell Match / Don't match (a double Enter used to 409).
- **Product detail tabs** and the **Unlinked/Linked toggle** switch via `window.history.replaceState` (Next "Native History API"):
  tab switch went from a multi-second server round trip (clicks looked dead under load) to ~60–120 ms; URL stays shareable.
- Lint: removed render-time ref reads in listings/products pages (selection now derives from grid rows); escaped apostrophe in detail.
- Tests: `tests/unit/catalog/listing-link-drawer.test.ts` (8 tests: quick-product model, create+link+never-sync+audit, duplicate SKU,
  stale version / already linked, scope, dismissal + withdrawal). Catalog suite 48/48.

Verified live (headless Playwright, admin):
- Unlinked grid shows No match pills + Create/Search icons; Create new with blank SKU → "SKU is required"; duplicate MLT-WIDGET-01 →
  inline "SKU MLT-WIDGET-01 already exists for this client" (409, listing untouched); valid KS-E2E-LST-GC50 → created, linked, row moved to Linked,
  Info popover correct. Unlinked NOVA-HUB-7P → Suggested pill; Info popover; Don't match → No match; Search drawer keyboard link → Linked.
  (APX-GIFT-CARD-50 left unlinked again as seeded; product KS-E2E-LST-GC50 remains as a test record.)
- Detail tabs: all 8 switch in < 150 ms with `?tab=` synced; no console errors.
- Roles: manager sees the in-cell actions; operator/viewer see none (no listing permissions).

## Remaining / handoffs
- REQ-1 (docs/requests/catalog.md): M12 page should consume /api/listings/exceptions.

## Round 1 (parity loop) — 2026-11-09
- Product Listings now has Logiwa's **Suggested** link state (live capture §6). An unlinked listing whose seller SKU matches a product SKU of the same client (ignoring case) shows an amber "Suggested" pill with the product SKU and a one-click **Match these products** check button. This is permission-gated (`settings.product_listing.search_a_product`), audited through `linkListing`, and it invalidates the grid. Unlinked rows with no suggestion read "No match".
- Row kebab: a new "Match to {SKU}" action. The Link to product modal preselects the suggested product.
- Repository: `listListings` returns `suggestedProductId/Sku/Name` through `suggestionSql()` in `src/server/repositories/listings.ts`. A unit test was added to `tests/unit/catalog/listing-exceptions.test.ts`.
- Checks: tsc is clean for catalog paths; vitest tests/unit/catalog passes 40/40; the API was checked against localhost:3000.
- Not verified visually: headless Playwright could not launch. node_modules has playwright 1.55.0, which expects chromium build 1187, but only build 1254 is installed, and launching that executable fails with `spawn UNKNOWN`.
- Remaining gaps vs live capture: Reject ("Don't match these products") needs a persisted dismissal column, which is a schema change. The Link drawer also lacks "Create New" quick-form tabs (Initial Quantity, Never Sync). Edit Product as a drawer with a clickable stepper is not done; KitStaks uses a full detail page by design.

## Round 2 (parity loop) — 2026-11-09
Fixed:
- **Barcode uniqueness (server + UI).** `assertBarcodesUnique` in `products-commands.ts` rejects (409 DUPLICATE, fieldErrors.packTypes) a pack-type barcode already used by another product of the same client, on create and PATCH (self-edit allowed). The pack-type modal checks immediately (no debounce), shows "Barcode X already used by SKU (Pack)" in red and disables Add while checking/blocked; other-client reuse stays a warning. `check-barcodes` now returns `clientId`. Unit tests added. Note: the critic's existing duplicate KS-CRIT-P1 (850012300011) remains in the dev DB; editing it now returns 409 until the barcode is removed.
- **No-permission state.** `CatalogViewGate` (catalog-shared) renders a 403 status screen for /products and /products/listings when the user lacks view, so no request 403s under an endless skeleton. Bulk import/update is hidden without `import_file`. Verified viewer and operator see "You don't have access to Products". Granting read to operator/viewer is REQ-5.
- **Grid refresh after create/duplicate.** It resets to Created desc and page 1, invalidates and refetches, and marks the new row with a "New" badge (`NewProductContext`, columns stay stable). The duplicate "Created" info toast is removed (the wizard's success toast remains).
- **Link drawer search.** New `GET /api/products/link-search` (`searchLinkProducts`) does a contains-match on name, SKU and barcode, ranked exact > SKU prefix > name prefix > contains. Unit-tested.
- **Barcodes** on the pack-type cards and the detail tab render without built-in text, with one caption under the bars and a quiet zone.
- **Slow loads.** `useSlow` shows "taking longer than usual · Retry" after 8s on the Edit drawer and the product detail.
- **Legacy `category`** is dropped from the GET /api/products/[id] product payload (`productCategory` is the only category).
- The SKU counter is hidden so the SKU and Client errors align (proper fix is REQ-8).
- Tabs: the shared `UnderlineTabs` is already a Radix tablist (role=tab, arrow keys, focus-visible ring).
Requested (shared): REQ-4 CSP img-src, REQ-5 role read grants, REQ-6 nav/breadcrumb under Inventory, REQ-7 wizard footer, REQ-8 error/counter layout, REQ-9 Barcode text offset, REQ-10 toast position, REQ-11 grid row highlight and stable menus, REQ-12 ChangeLogDrawer timeout.

## Round 3 (parity loop) — 2026-11-09

Fixed (critic round 2, score 6.4):
- **Category card click** (`product-new-page.tsx`): picking a card now sets local state, so the wizard renders on the click frame (measured 336 ms headless). The URL syncs via `history.replaceState` (`?category=product`), and "Change category" works the same way. No router round trip.
- **Duplicate barcodes in existing data**: `barcodeConflictSql` in `products.ts` adds `barcodeConflictCount` to every grid row. It counts other same-client products whose primary or pack-type barcode equals this product's barcode. The grid Barcode column shows an amber **Conflict** pill with a tooltip. The detail page (`getProductDetail.barcodeConflicts`) shows a Conflict pill in the subheader and an attention callout linking the other SKU(s). Verified on KS-CRIT-P1 / MLT-WIDGET-01.
- **link-search `clientId` optional**: with no client it searches every client in the caller's scope; a restricted scope is still enforced. The query is a single SQLite statement (ms).
- **Grid slow state**: `SlowGridNotice` (catalog-shared) shows "This is taking longer than usual · Retry" after 3 s pending on /products and /products/listings.
- **Category badge** is neutral for Product (was primary red/pink).
- **Image column**: image-less products show two-letter initials instead of an identical grey icon.
- Profiling: `listProducts` (86 products, 50 rows, correlated stock subqueries) runs in **7 ms** directly on `.data/kitstak.db`. The 7-18 s API times also hit `/api/me` (7.9 s), so the latency comes from the loaded shared dev server or middleware, not catalog SQL. Filed as REQ-13.
- Tests: `tests/unit/catalog/barcode-conflicts.test.ts` (conflict count/detail, link-search with no client and with restricted scope, initials). 57/57 catalog unit tests pass; tsc clean for catalog paths.

Still open (shared code, filed in requests): Total shows 0 while loading (REQ-14), Products under the Inventory nav (REQ-6), error/counter alignment (REQ-8), compact neutral segmented toggles (REQ-15). Not done this round: listing reject ("Don't match these products"), Link drawer Create New / Suggested tabs, `?sku=&skuqt=` URL quick-search state, and the hierarchical pack-type verification.

## Round 2 (parity loop) — 2026-11-09 (critic score 7.2)
- **Product images render.** New `GET /api/products/image?u=` (`src/app/api/products/image/route.ts` + `src/server/repositories/products-image.ts`) serves remote product images same-origin, so the CSP stays strict. It is SSRF-hardened: http/https only, default ports, no credentials, and localhost/.local/.internal are rejected. The guarded DNS lookup runs at connect time and blocks private, loopback, link-local, CGNAT, multicast and IPv4-mapped addresses. Each redirect is re-validated (at most 3). There is an 8 s timeout and a 5 MB cap, and only raster types are served (no SVG). Responses carry nosniff and a sandbox CSP. Images are cached in an LRU (300 entries / 40 MB) with in-flight de-duplication. `productImageSrc()` in catalog-shared routes the grid thumb, detail header, listing cells, kit component thumbs and wizard preview through the proxy. The wizard preview shows loading, loaded and "didn't return an image" states.
- **Operator/viewer catalog read.** `src/lib/grid-defs/products/permissions.ts` defines the read keys: GET products, detail, options and listings accept `settings.*.view` OR `inventory.total_inventory.view`, which the default operator and viewer roles hold. `?view=form` still needs edit or create, and every mutation keeps its own key. `CatalogViewGate` takes any-of. Nav visibility is REQ-18.
- **Client select states.** Loading shows a spinner and "Loading clients…". On error it shows "Could not load clients" with Retry, and never "No options" while pending. **check-sku** has a 6 s watchdog, then a warning icon and "Couldn't check availability, re-checked on save".
- **Barcode data integrity.** The KS-CRIT-P1 duplicate barcode 850012300011 is removed. KS-CRIT-P1 keeps KSCRIT0000001, and the cleanup is audited in change_log (source `system:data-cleanup`). The dev DB now has 0 same-client duplicates. The audit found it was created by the wizard before the guard existed. A DB unique constraint is requested as REQ-16 (schema is foundation-owned). The guard also covers kit/packaging product-level barcodes.
- **Tax/price validation.** Values are no longer silently clamped. The error reads "Tax rate must be 0–100%" / "Must be 0 or more" inline.
- **Packing step.** Flags render as left-aligned bordered label·toggle rows in the 2-column grid. A selected "No" is neutral grey, also on Active?/Digital? (local override; shared change is REQ-15).
- **Grid Yes/No columns.** "No" renders as a muted dash and "Yes" as a pill.
- **Detail.** Breadcrumb Home › Inventory › Products › SKU. The `?tab=` URL is now driven by local state and mirrored to the URL for every tab, and it resyncs on back/forward.
- **API contract.** Missing `hazmat`/`customs` objects default server-side. PATCH accepts partial bodies, merged over the stored product, and nested customs/hazmat/customFields merge too.
- Tests: `tests/unit/catalog/product-image-proxy.test.ts` (URL/SSRF rejection matrix, blocked IP ranges, cache de-dup, no caching of failures, productImageSrc, role read access). Catalog suite 106/106; tsc clean for catalog paths.
- Shared, filed: REQ-7 wizard footer, REQ-14/REQ-20 grid search fetch state, REQ-16 unique index, REQ-18 nav, REQ-19 print-template list, REQ-6 nav highlight.

## Round 4 (parity loop) — 2026-11-09 (critic score 7.1)
Fixed:
- **No silent price coercion.** `NumF` (wizard/fields.tsx) no longer passes min/max to the shared NumberInput, which clamped -5 to 0. The value stays as typed. A range message ("Must be 0 or more" / "Must be N or less") appears inline as soon as the value commits (the control gets aria-invalid). It lives in local state, because RHF's blur re-validation, with no resolver, cleared a manually set error. The step schema blocks Next with the same message, and the server schema rejects the value too. Schema `num`/`int` max messages were added. Verified headless: -5 in Sales price gives an inline error and Next stays on General.
- **Client picker** (step-general.tsx `ClientField`): this is now the searchable `Combobox`. It opens on click and lists every client (11 options seen headless), filters as you type and works by keyboard. The trigger shows the selected client's name ("Apex Threads Co."). Loading shows "Loading clients…" and an error shows Retry (`optionsError` was added to the wizard context).
- **Save feedback and guard** (product-wizard.tsx): while the POST/PATCH is in flight, a `beforeunload` guard blocks close or reload. After 2 s, a persistent "Still saving…" toast tells the user to keep the page open. Both clear when the request resolves or fails. The Save button already shows a spinner and is disabled.
- **Breadcrumbs** via `CATALOG_CRUMBS` (catalog-shared). /products shows Home > Inventory > Products, Listings shows … > Product Listings, the detail page shows … > {SKU}, and /products/new, including the no-permission state, shows … > Create product. The bogus "Product Details" crumb is gone. The nav-group highlight is still REQ-6.
- Test: `product-form.test.ts` checks that negative prices and tax above 100 are rejected with inline messages. The catalog suite passes and tsc is clean for catalog paths.
- Headless check (system Chrome, admin): the wizard, /products, listings and detail had no console errors.

Not fixed (shared, filed under Round 2 requests): REQ-13 latency (pages still take 37 to 89 s on the loaded dev server; module SQL takes ms), REQ-14 Total: 0 while loading, REQ-21 quick-search mode and page size in the URL, REQ-22 grid ARIA roles, REQ-23 sticky-column sliver, REQ-24 neutral density toggle, REQ-25 test-data cleanup.
Not done: listing reject persistence (needs schema), Link drawer Create New / Suggested tabs, edit-from-grid drawer, hierarchical pack-type end-to-end walk.

## Round 5 (parity loop) — 2026-11-10

Fixed (critic r4):
- Pack-type modals (Primary / Hierarchical / Irregular, wizard + Edit drawer): numeric fields no longer pass `min` to the shared NumberInput, so -2 stays -2. Inline "Must be N or more" shows as soon as the value is committed (L/W/H/Volume/Weight ≥ 0, Child qty ≥ 2, Irregular UOM qty ≥ 1), and Add blocks with the same messages (`packRangeError` in pack-type-modal.tsx).
- Add/Save is enabled. It is disabled only while barcodes are being checked, and a tooltip says so. Clicking it with no pack type shows "Select a pack type" under the select. The red border only appears after a submit attempt and clears when a value is picked. Duplicate barcodes now block with a field error plus the existing banner.
- Yes/No toggles in the modal use the neutral-grey "No" (`NEUTRAL_NO`, now exported from wizard/fields.tsx) and are sized w-fit. The "own box" tooltip now describes what the flag means. Enforcement at packing has been filed with Stations.
- Edit drawer SKU: check-sku is skipped when the SKU and client are unchanged, so no spinner sticks. The effect no longer depends on the unstable `form` object.
- Step 1 Name and other TextF fields: the counter is drawn inside the input as trailing text, so the field error sits directly under the input (local workaround for REQ-8).
- Detail tab strip: the tab focus ring has padding and is rounded, and shows on keyboard focus only.
- Deactivate/Activate: the status pill updates optimistically once the server replies, and the dialog closes without waiting for the refetch (`void invalidate()`).
- PATCH /api/products/[id] fieldErrors are de-duplicated (salesPrice -5 now returns ["Must be 0 or more"] once). Checked via API.
- GET /api/products accepts Logiwa aliases `search=`, `sku=`, `skuqt=eq|sw`, plus `ps=` (src/lib/grid-defs/products/list-query.ts). /products?sku=..&skuqt=eq&ps=.. rewrites itself to the grid grammar (q/qm/ps). Non-default qm and ps were already written to the URL by the shared grid.
- Unit tests: tests/unit/catalog/list-query-aliases.test.ts. Catalog suite: 109 passing (8 files).

Still open (shared, filed): nav group highlight (REQ-6), sticky-edge sliver (REQ-23), change-log first-set message (new request), cold-load performance (REQ-13), and packing enforcement of use_own_box. Not done: Initial Quantity in the listing quick-create (needs a location and an inventory-ledger adjustment, so it is deferred). The listing reject was already persisted (dismissedSuggestion change-log field).

## Round 6 (parity loop) - 2026-11-10
- Filter popup: `purchasePrice` is now labeled "Purchase price", next to "Sales price", matching the grid columns.
- Edit drawer: the product detail page prefetches the `["product-form", id]` payload, and the drawer uses staleTime 60 s instead of 0/0. Edit opens from the cache with no skeleton. Saves still invalidate `product-form`.
- Wizard: custom field definitions are prefetched when the wizard mounts. "Other info" renders the fields, or the shared empty state, right away.
- Duplicate drawer: the info banner is now a neutral callout instead of the red primary style.
- Density: grid density is already stored per user via grid-prefs. The Listings/Products difference came from saved per-user prefs.
- Deferred: Initial Quantity in listing Create New (needs a location picker and an adjustment through the inventory ledger API, owned by inventory). Also deferred: the footer overlap in the Duplicate drawer (shared Drawer/wizard footer), the nav highlight, and the chip/select focus ring (filed in requests).

## Round 3 (parity loop) - 2026-11-10 (critic r2 score 7.3)
Fixed, each verified in headless Chrome against localhost:3000 (scripts and screenshots are in %TEMP%/claude/kitstak-critic/catalog/r3):
- **Equal search mode** (`src/components/products/grid-state.tsx` `useStickySearchMode`, used on /products and /products/listings). Picking Equal with an empty box now sticks: the trigger reads "Equal", `?qm=eq` is written raw to the URL, sessionStorage keeps it, and the next search sends `q`+`qm=eq`. Verified: MLT-WIDGET in Equal mode returns Total 0 (the API also returns 0), and the mode survives a reload. The shared serializer bug is filed as a request.
- **Wizard footer pinned** (`DRAWER_WIZARD_CLASS` / `DRAWER_WIZARD_BODY` in product-wizard.tsx, applied to the Create, Duplicate and Edit drawers). The footer fills the drawer and pins Cancel/Back/Next to the bottom with an opaque background and a top hairline. Content scrolls above it. Next sits at y=856 on General, Packing and Pack type, both on short and long steps.
- **3-column rows** (`ROW` in pack-type-modal.tsx). Primary, Hierarchical and Irregular modals and the Kit/Packaging Packing step use the same rows: [Dimension unit], then [L][W][H], then [Volume unit][Volume][Shipping box], then [Weight unit][Weight][Own box]. Hierarchical adds a second row [UOM qty][Use primary barcodes]. There are no orphan cells.
- **/products/new gated** with `CatalogViewGate("settings.products.create")`. An operator now gets the 403 screen "You don't have permission to create products" with "Back to products". It no longer renders the chooser while permissions load.
- **PATCH /api/products/[id] and POST /[id]/status require a version.** The version comes from body `version` or an `If-Match` header (`src/lib/grid-defs/products/concurrency.ts`). A missing version returns 409 `VERSION_REQUIRED` with fieldErrors.version; a stale one returns 409 CONFLICT. Verified via API. Bulk status keeps current-state semantics.
- **Fetch feedback** (`GridFetchFrame`). While a refetch runs, stale rows dim to 55% and a 2px indeterminate bar runs under the toolbar. On the first load the footer total reads "—" instead of 0. The Print Options templates, the Tag list and the product change log are prefetched (`usePrefetchPrintouts/Tags/ChangeLog`), so the label modal opens with the template card at once and the Tag popover shows "No tags yet + Create Tag" at once. Wizard options keep the previous answer (`placeholderData`), and "Loading clients…" never shows under a resolved client.
- **Barcode check feedback.** An inline "Checking barcode…" spinner shows under the chip input right away. The conflicting chip gets a red outline (`conflictChipCss`). A disabled Add has a tooltip with the reason (checking, or "Barcode X is already used by SKU (Pack)").
- **Blur validation.** The image URL check (`imageUrlError`, same message as Next) and Tax rate 0–100% (`NumF rangeText`) now run on blur.
- **Kit/product barcode is no longer silently set to the SKU** (`productColumns`). Blank stays blank. The field says so, labels still print the SKU, and the detail header shows "Barcode None".
- **Shipping box options** are labelled with the warehouse when a code repeats (`shipmentPackageOptions`, e.g. "BOX-L-1612 · MLT1").
- **Pack type cards.** An amber "Incomplete dimensions" badge shows when L, W or H is 0. Volume uses one format everywhere (`formatVolume`, 3 decimals).
- **Hazmat off** greys every control the same way (`DISABLED_GROUP`).
- **SKU cell** truncates with an ellipsis and the Kit/New badges stay inside the cell (checked at 768px).
- **Sticky actions scrim.** A gradient pseudo-element fades cells under the sticky kebab column. A box-shadow did not work because Chrome paints table-cell shadows under neighbouring content.
- **Detail tabs.** A pointer click shows only the underline; the ring shows on keyboard focus only.
- **Kit component** results and rows use the catalog `ProductThumb` (initials), like every other surface.
- A selected "No" on the pack-type "own box" toggle is neutral grey.
- Tests: `tests/unit/catalog/round3-parity.test.ts` (search mode, If-Match/version parsing, volume format, incomplete dims, warehouse-labelled boxes, image URL rule, kit with no barcode). Catalog suite: 118 passing (9 files). tsc is clean for catalog paths. A headless walk (create with an incomplete pack, then edit save) passed with no console errors.

Not fixed in catalog (other owners, filed under Round 2 requests): the bulk import history 500 (the orders module pulls the client-only `src/lib/format.ts` into the imports route; earlier it was a Turbopack stale-module error in inventory-commands), the shared serializer qm, the shared table-cell shadow, the 768px filter chip squeeze, the nav REQ-18, the 428 error code, the printer popover and the product custom-field seed. The Initial Quantity on listing Create New is still deferred (it needs an inventory-ledger adjustment).

## Blind-judge repair round 1 - 2026-11-10
- **Nav highlight (REQ-6) fixed.** `SECTION_OVERRIDES` in `src/config/route-registry.ts` sets /products and /products/listings (and so /products/new and /products/[id]) to the Inventory section. `activeMenuKey` resolves the section first, so the top nav now highlights Inventory, matching the breadcrumb. The menu item stays in Settings > Master Data, and the change is backward compatible. The `route-registry.test.ts` assertion is updated to `inventory`.
- **Production build smoke and load test.** `next build` passed (Next 16.4.5) and `next start -p 3100` was used, with 280 requests at concurrency 10 across /api/products, /api/listings, /api/me, /products, /products/listings and /products/new. **0 errors.** API p50 25-31 ms, p95 ≤157 ms; pages p50 ~160 ms, p95 ≤611 ms. Headless Chrome, time to grid rows: /products 440 ms cold / 224 ms warm, /products/listings 881 ms cold / 137 ms warm. No console errors. The skeletons and connection errors are a symptom of the dev server only, where `/api/me` alone takes 1-3 s. Scripts are in %TEMP%/claude/kitstak-critic/catalog/{load,ttr}.cjs. The dev DB holds 95 products, so 6k-SKU timing is extrapolated from indexed SQL (ms-level) and was not measured.
- **Already present, re-verified in code:** product filters, 38 fields: every flag, Kit, Shelf life, Track serial/lot/expiry/production date, On hand, and 10 custom-field slots (Date 1-3, Drop down 1-2, Text box 1-3, Toggle 1-2). Operators come from the shared filter builder. Listings has the Tag toolbar button (TagPopover create/search), a TAGS column, a tag filter, and Bulk import > Product listings (`/imports/listings`). Advanced step: channel allocation grid (static/reserve/% per channel and warehouse), replenishment, serial secondary + regex, expiry/production formats and scan method. Pack-type card shows weight.
- Unrelated failing tests seen in foundation (owned by others): nav-config BETA badge, orders grid grammar, orders updateOrder.

## Blind-judge repair round 2 - 2026-11-10
- **Grid first render at scale: measured, then fixed.** `tests/unit/catalog/perf-6k.test.ts` seeds 6,500 SKUs, 2,167 inventory buckets and 6,500 listings, then times the real repository calls (median of 5 warm runs). Before the fix: /products page 1 took **8,369 ms**, page 100 took 8,544 ms, and unlinked listings took **18,651 ms**. Round 1's extrapolation was wrong: SQLite evaluates every correlated result column (stock sums, barcode-conflict count, SKU suggestion) for every matching row before it sorts. Fix: `listProducts` and `listListings` now run in two phases. Phase 1 pages the ids using only the sort expressions; phase 2 builds the visible rows by id and keeps their order. Listing suggestion details now come from one lookup by id instead of five correlated scans. After the fix: products page 1 **58 ms**, search 63 ms, page 100 62 ms, unlinked listings **58 ms**, linked 3 ms. The test asserts each call stays under 250 ms. `round7-parity.test.ts` checks that sort order, totals and suggestion details are unchanged across pages.
- **Listings > Link drawer > Create new > Initial quantity.** This is an optional block with Quantity, Warehouse (`InventoryWarehouseSelect`) and Location (`DestinationSinglePicker`, which already marks count-locked or occupied only-1-SKU locations as disabled). `initialQuantityErrors` makes warehouse and location required once a quantity is entered. After create-and-link, the stock is posted through `POST /api/inventory/add`, the ledger adjustment with permission and reason checks, using the new product, the listing's client, pack type = UOM, and the note "Initial quantity from listing X". If the add fails, the product stays created and a clear error toast says the stock was not added, with an Open action.
- **Link / Unlink toasts with Undo.** Link (Search, Match and the in-cell actions) shows "Listing linked" with Undo, which re-links the previous product or unlinks. Unlink shows "Listing unlinked … from SKU" with Undo, which re-links. Both toasts stay up for 8 s, and Undo confirms with an "Undone" toast.
- **use_own_box enforced at packing** (`src/server/repositories/packing.ts`, a minimal additive shared change). `PackLine.useOwnBox` (optional) is read from `product_pack_types` for the line's pack type, and `validatePackages` rejects a package that holds more than one unit of an own-box pack or mixes it with anything else: "SKU (pack) ships in its own box: put each unit in a separate package…". The pack-type card on the detail page shows a "Ships in own box" badge. Tests are in `round7-parity.test.ts`, and the stations packing suite still passes.
- **Detail empty states.** The Replenishment empty state has a "Set replenishment levels" button that opens Edit. The Transactions empty state explains what will appear and has "Create receipt" and "Add inventory" (/inventory/by-location) buttons. `MiniTable` empty states now accept an action.
- **Pack-type weight and dimensions on the Overview General card**: "Weight (Unit)" and "Dimensions (Unit)" from the primary pack type. The pack-type cards already showed weight.
- **Focus ring.** Opening a Select used the brand red border and ring, the same as the error state. It now uses `info`, matching `controlVariants` (a one-line change in `src/components/ui/select.tsx`). `src/components/ui/input.tsx` focus moved from primary to info as well. Red is now only used for `aria-invalid`.
- **Bulk import history.** The server-import chain no longer pulls the client `src/lib/format.ts`; a static import-graph walk of `/api/imports/[key]` found no client modules. `importOverview` is covered by the passing foundation-f6 imports and f7 files suites. On the running dev server, `GET /api/imports/<key>` still returned HTTP 500 after 60-94 s with "Jest worker encountered 2 child process exceptions, exceeding retry limit". That is a crash in the Turbopack compile worker under the concurrent-agent load, not a route error. It is filed for the orchestrator below.
- **Initial quantity now includes an Adjustment reason** (`useInventoryReasons`; decrease-only reasons are hidden, and it is required when the warehouse's `mandatoryReason` is set). The first live run failed safely with "Product created, stock not added: An adjustment reason is required by this warehouse's settings". After the fix, Create new with Quantity 4, Warehouse KS-CRIT-WH, Location KSCR-PACK and a reason gave the toast "…created, linked to APX-GIFT-CARD-50, and 4 added to stock", and `/api/products` returned onHand 4.
- **Verified on a fresh production build** (`next build` passed, then `next start -p 3112`, because the shared dev server at :3000 stopped answering). Scripts and screenshots are in %TEMP%/claude/kitstak-critic/catalog/r7 (`walk2.cjs`, `e2e-link.cjs`, `unlink.cjs`):
  - The /products/[id] top nav highlights **Inventory**, not Settings (nav-detail.png).
  - Time to grid rows: /products 257 ms cold and 891 ms on a revisit; /products/listings 231 ms and 195 ms.
  - `GET /api/imports/{products,listings,pack-types,products-update}` returns **200** in 4-141 ms, and the /imports/products history loads.
  - In the Duplicate drawer, the footer is pinned and opaque, and the Client select focus ring is blue (dup.png).
  - Unlink → "Listing unlinked" toast → Undo → re-linked to the same product.
  - There were no console errors.
  - Test data: the KS-E2E-R7-* products are left in place (the cleanup prefix). The seed listings were restored to unlinked (3).
- Checks: tsc is clean for catalog and touched paths. The catalog suite plus stations packing pass (12 files, 140 tests), as do foundation f6/f7 imports (47).

## Blind-judge repair round 3 - 2026-11-10
The shared dev server at :3000 did not answer for this whole round: `/login` and `/api/health` both timed out at 110 s. The same code ran fine on a production build (`next build`, then `next start -p 3113`), so the "page never loads" finding is an outage of the shared dev server, not a /products bug. Scripts and screenshots are in %TEMP%/claude/kitstak-critic/catalog/r9 (`walk.cjs`, `deep.cjs`, `pt.cjs`, `bulk.cjs`).

Checked headless, admin role, on :3113:
- **/products first render has rows.** 100 rows appeared 668 ms after goto, with no skeleton (list.png). `/api/me` returned 200 in 17 ms. There were no console errors.
- **Wizard categories:**
  - Packaging Material has 3 steps (General, Packing, Other info), and the Packing step has no Liquid flag (wiz-packaging.png, pkg-packing.png).
  - Kit has Kit to Order and Kit to Stock with 5 steps (wiz-kit.png). Next on Components with no component shows "at least one component" (kit-nocomp.png).
  - Product has 5 steps, and its Packing step includes Liquid.
- **Volume is computed from L×W×H.** 10×5×2 gave 100.00000, and the primary pack modal gave 4×3×2 = 24.00000 (pt-primary-modal.png).
- **Pack types:** there are tabs for Unit of measure, Irregulars N and Hierarchicals N. The Hierarchical modal has Contains, Child qty, the derived UOM qty and "Use primary (UOM) barcode(s)" (pt-hier-modal.png). A pack type can carry several barcode chips; the test added two.
- **Advanced step** (adv.txt, adv-open.png):
  - Custom declarations: Declared value, HS tariff code, Origin country code and "Is not declared to customs?".
  - Hazmat: ID, type, the 6 lithium attributes, 22 container types (`HAZMAT_CONTAINER_TYPES`), and quantity type and unit.
  - Lot/batch: Receiving-only, Auto create lot/batch number, Regex and Scan method.
- **Bulk actions:**
  - Delete opens a confirm table with a reason per row ("Blocked · Has 4 units on hand") and offers Deactivate instead (bulk-delete.png).
  - Label opens Print Options with a template and Print Quantity (bulk-label.png).
  - The row kebab's Change log opens the audit drawer (row-changelog.png).
- **Bulk Import/Update menu** has Products, Pack types & barcodes, Warehouse replenishment levels, SKU based inventory allocation, Products (update) and Kit-components (import-menu.png).

Fixed: in the pack-type modal, choosing a Select option with Enter also ran save() with the draft from before the choice. That showed a false "Select a pack type" error under a filled field. The dialog's Enter-to-save handler now ignores Enter that comes from a combobox, listbox, option or popup trigger, and Enter the Select already handled (`defaultPrevented`). This fix passed tsc and unit tests but was **not** re-checked in a browser: the rebuild failed on another module's in-progress file (`carrier-errors-page.tsx`, missing `HELP_CENTER_URL`), and :3000 was down.

Checks: tsc reports no errors in catalog paths, and the catalog unit suite passes (11 files, 129 tests).

## Round 4 (parity loop) - 2026-11-10 (critic r3 score 7)
The shared dev server at :3000 answered `/api/health` in 28 s. A headless /products load there timed out after 10 minutes. All checks below therefore ran on a fresh production build of the current tree, in a private copy (`%TEMP%/claude/kitstak-critic/catalog/prodbuild`, `next build`, then `next start -p 3142`). Script and screenshots: `%TEMP%/claude/kitstak-critic/catalog/r10` (`walk.cjs`, `list.png`, `delete.png`, `detail.png`).
- **Console / router errors.** No catalog code calls the router or `history.*` during mount. The tab, link, category and search-mode syncs all run from user events. The one mount-time navigation, the legacy `?sku=&skuqt=` alias rewrite, now runs one macrotask after the first commit (after the App Router's own effects) and only once (`products-page.tsx`). Verified: `/products?sku=APX&skuqt=sw` became `/products?q=APX&qm=sw`, rows appeared at 837 ms, and there were **0 console or page errors** across list, bulk delete and detail. The "dispatched before initialization" error lines up with dev HMR full reloads and aborted chunk loads, so it is filed for the orchestrator.
- **Bulk delete mini-table.** It now has three columns: Product (SKU over name, single-line ellipsis with a tooltip), Status, and Delete. The result reads "Can be deleted" on one line, or "Blocked" with the reason underneath. Nothing wraps mid-token and there is no horizontal overflow at the dialog width (delete.png). The detail-page delete dialog uses the same cell.
- **Header barcode.** The header shows the product barcode, else the primary pack type's first barcode with its pack type in brackets, else a muted "No barcode" (`headerBarcode` in `src/lib/grid-defs/products/header-barcode.ts`, detail.png).
- **Sticky actions edge.** The 1px inset divider on the sticky kebab cells is removed, because the scrim is the boundary. The scrim pseudo-element overlaps 1px into the cell, so sub-pixel widths cannot leave a gap. Selected rows get a primary-soft scrim that matches their sticky cell, so no light sliver shows on selected rows (`GridFetchFrame`).
- **Accessible names are unique.** The toolbar Status trigger is "Status of selected products", and the import info tip is "How Excel imports work". Playwright strict lookups now return exactly one "Status" button and one "Bulk import" button.
- **Image column.** A product without an image shows a neutral image placeholder (labelled "<name>: no image") instead of initials such as "RE" or "KC".
- **Demo data hygiene (REQ-25), the catalog half.** `src/server/repositories/products-test-data.ts`: `planTestDataPurge` is the dry run and `purgeTestCatalogData` applies it. KS-CRIT-/KS-E2E- products that pass the delete guard are deleted (kits before their components). Products with stock, orders or history are deactivated through `setProductStatus`, which writes the change log and leaves the ledger untouched. Test-prefixed listings are deleted, and real SKUs are never touched. The npm script `db:clean-test-data` and a realistic seed with images are foundation work, filed in requests. I did not run the purge against the shared dev DB: other agents are mid-verification on it, and the deletes cannot be undone.
- **Initial Quantity on listing Create new.** Shipped in blind-judge repair round 2: Quantity, Warehouse, Location and Reason, posted as one ledger adjustment through `/api/inventory/add`. No change this round.
- Tests: `tests/unit/catalog/round4-parity.test.ts` covers the header barcode fallback order, the test-SKU prefixes, the purge plan, the purge itself (delete, deactivate, listing cleanup, real SKU untouched, idempotent) and a kit with its component. Catalog suite: 12 files, 135 passing. tsc is clean for catalog paths.
- Still open, other owners: direct-print printer selection (shared PrintOptionsModal), the seed catalog with images, the `db:clean-test-data` wiring, dev-server stability and the build gate, and a separate "Price (min/max)" filter label (minor; the Sales price and Purchase price filters cover it).

## Round 5 (parity loop) - 2026-11-10 (critic r4 score 6.3)
- **Route-level slow and stalled states (major).** `ListPageSkeleton` (/products, /products/listings, /products/new, and the permission gate) and `ProductDetailSkeleton` (/products/[id] loading.tsx) now carry `StagedNotices` (`src/components/products/page-skeletons.tsx`). After 8 s, a "This is taking longer than usual · Retry" card shows over the skeleton. After 45 s it is replaced by "Products isn't responding" with Reload page and Go to dashboard. The stages run on CSS animation delays, not timers, so they appear even when the client bundle never hydrates (the dev-server failure mode), and Retry/Reload are plain links to the current URL that work without JS. Render errors still go to the shared `(app)/error.tsx` (Retry plus a digest reference). Verified on a production build with every JS chunk stalled: no card at 3 s, slow card at 10 s, stalled card at 47 s (screenshots in %TEMP%/claude/kitstak-critic/catalog/r5/01-02).
- **Hierarchical pack weight (minor, beyond Logiwa).** New pure module `src/lib/grid-defs/products/pack-derivation.ts`: `derivedPackWeight` (child qty × contained pack weight, unit-converted, chains Pallet→Case→Unit), `minimumPackVolume`, `fillDerivedPackWeights`, `rederiveDependentWeights`, `packDataGaps`. Added `convertWeight`, `convertVolume` and `hasMissingWeight` to `catalog-options.ts`.
  - The pack modal pre-fills a hierarchical pack's weight (Case of 12 × 1.2 lb shows 14.40) with the info "Calculated: 12 × Unit weight. Type to override." Typing overrides it, and a reset icon restores the calculated value.
  - An amber notice says when a pack has no outer dimensions (with the contents' minimum volume, e.g. "at least 288.000 cubic inch") or no weight. It does not block saving.
  - Calculated weights follow the child when the Unit is edited. Typed weights are kept.
  - The server (`packsFor` in products-commands) fills a missing hierarchical weight on save, so API and bulk imports get it too.
  - The wizard pack cards and the detail Pack types tab show a "No weight" badge next to "Incomplete dimensions".
  - Verified end to end on the prod build: the POST stored Case weight 14.4 with UOM qty 12.
- **Grid right edge (REQ-23).** The sticky-actions scrim now covers the header row too, so the last scrolled header label fades under the column-settings icon instead of being cut to "H.". Checked at 2x zoom.
- **Nav highlight (REQ-6) re-verified.** `activeMenuKey` returns `inventory` for /products, /products/new, /products/listings and /products/[id]. The headless prod walk shows Inventory underlined on /products and /products/new. The critic's Settings captures came from before the round-1 repair.
- **Test data (REQ-25).** `purgeTestCatalogData` / `planTestDataPurge` accept `{ createdBefore, deleteOnly }`. New owner script `scripts/catalog-test-data.ts` (`npx tsx scripts/catalog-test-data.ts [--apply] [--delete-only] [--idle-minutes=N]`) dry-runs by default. It was applied with `--delete-only --idle-minutes=30`, which deleted 6 unreferenced test products and 2 test listings. The other 14 KS-CRIT/KS-E2E products are on other modules' open shipment orders, or have stock, so they were left Active rather than deactivated under suites that may still be running. Before a buyer demo, run it with `--apply` and no `--delete-only`; that deactivates them through the ledger-safe status path.
- **Server health blocker (r4).** It is not catalog code: /api/health took 60 to 64 s on the shared dev server this round. Every flow was re-verified on an isolated production build of the current tree (%TEMP%/claude/kitstak-critic/catalog/prodbuild5, `next start -p 3150`, same DB through a junction):
  - /products rows in 294 ms warm and 1.0 s cold; detail in 0.9 s; wizard POST 39 to 51 ms.
  - Edit PATCH 200, stale PATCH 409, status 200, stale status 409, bulk delete 200.
  - No console errors and no 5xx.
  - Walk script: r5/walk.cjs.
- Tests: `tests/unit/catalog/round5-parity.test.ts` covers conversions, derivation chains, fallback to primary, fill and rederive, minimum volume, gaps, the server save storing 14.4, and the purge createdBefore/deleteOnly options. Catalog suite: 147 passing (13 files). tsc is clean for catalog paths. eslint: 0 errors (pre-existing warnings only).

## Round 6 (parity loop) - 2026-11-10 (critic r5 score 8.8)
The shared dev server at :3000 still took 53 s for `/api/health`, so every check below ran on a private production build of the current tree: `%TEMP%/claude/kitstak-critic/catalog/pb12`, `next start -p 3162`, using the same DB through a junction. On that build /products showed rows in 548 ms. Scripts and screenshots are in `%TEMP%/claude/kitstak-critic/catalog/r12`: `walk.cjs` and `hdr.cjs`, screenshots 01-09.
- **Tablet stepper (768 px).** Below `lg`, `PAGE_WIZARD_CLASS` (product-wizard.tsx) shrinks the page-variant stepper so all 5 steps fit and can be clicked. The current step keeps "STEP N" and its label. The other steps collapse to their number, check or icon circle, and their accessible name stays "Step N: Label (status)". Measured at 768 px: the nav scroll width equals the client width (714 = 714), and the five buttons sit at x 24-738 (03-wizard-768.png). Kit and packaging wizards use the same class.
- **Detail tab strip (768 px).** New `OverflowFade` (`src/components/products/overflow-fade.tsx`) wraps the detail `UnderlineTabs`. Where content is hidden, each edge gets a background-coloured fade and a chevron that scrolls about 60 % of the strip. When the active tab changes, the strip scrolls it into view. Measured: scrollWidth 986 against clientWidth 762 gave an end fade at load. After the chevron, the start fade showed and Transactions was visible (05/06). The pure helper `overflowEdges` is unit-tested.
- **Product images in the demo catalog.**
  - `src/lib/grid-defs/products/demo-images.ts` defines 31 deterministic product illustrations: tee, jacket, cap, cable, charger, earbuds, coffee bag, mailer, box, kit and others. Each is tinted by colourway (BLK, WHT, NVY, OLV, GRY, KHK, roast) or by brand.
  - They are served same-origin by `GET /api/products/demo-image/<kind>-<hex>.svg` (signed-in only, 401 anonymous). The key is checked against a fixed kind table plus a 6-hex colour, so the markup is static, and an unknown key returns 404.
  - The image-URL rule (wizard and API) accepts these paths, so a seeded product still saves after an edit.
  - Owner script `scripts/catalog-demo-images.ts [--apply]` back-fills products that have no image. It skips test SKUs, bumps the version and writes the change log. It was applied to the shared DB (81 products). Grid, listings and detail header now show images (01-list.png, 07).
  - A seed hook is filed for foundation.
- **Stray header glyph.** The glyph was the next column's drag handle and resize separator showing through the 20 px header scrim, which is mostly transparent at its left edge. The header scrim is now 40 px and opaque from 55 %. A 3x zoom of the header's right edge shows only the settings icon (09-hdr-zoom.png).
- **Kit buildability summary.** The Components tab opens with a "Buildable kits" figure, the minimum across components. The figure names the limiting component, with its available quantity and quantity per kit, and gives the units needed for one more kit. The limiting row has a "Limiting" badge. When every component ties, the text says so. When the figure is 0, the panel turns danger-toned. Verified: "BUILDABLE KITS 413 · Limited by APX-TEE-BLK-M (413 available, 1 per kit)" (07-kit-components.png). The pure helper is `kit-buildability.ts`.
- **Packaging / kit Packing step.** The step now shows the same amber notices as the pack-type modal: "No outer dimensions: box matching and cartonization will treat this packaging as 0 × 0 × 0", and "No weight: carton weights will add 0 pounds". Kits get their own wording. The notices clear once dimensions and weight are entered, and they do not block saving (08-pkg-packing.png; the notice count dropped from 2 to 0 after fill).
- **Not fixable in catalog files (filed in requests, round 6):**
  - Inline download for small Excel exports (shared `ExportButton` and `/api/exports`).
  - Local-time printout file names (shared `printFileName`).
  - Dev-server latency.
  - Seed image hook.
  - Promoting the stepper and tab overflow behaviour into the shared primitives.
- Console: 0 errors and 0 5xx across the walk.
- Tests: `tests/unit/catalog/round6-parity.test.ts` covers buildability (min, quantity per kit, ties, zero, empty), `ownDimsGaps`, demo-image kind, colour, URL, parse and render safety, the image-URL rule, `applyDemoImages` (fill, skip, version, change log, idempotent, schema round-trip) and `overflowEdges`. Catalog suite: 14 files, 158 passing. tsc: 0 errors. eslint: 0 errors on touched files.

## Blind-judge repair round 1 - 2026-11-10
Fixed, each verified headless (Chrome, admin, HMR socket stubbed so other agents' edits do not reload the page mid-test) against localhost:3000. Scripts and screenshots: `%TEMP%/claude/kitstak-critic/catalog/rb1` (t3-t7).
- **Pack types & barcodes tab is editable in place** (`product-pack-types-editor.tsx`). Users with Products › Edit see a **Pack hierarchy** strip (Each base unit → Case = 12 × Each · 12 Each → Pallet = 40 × Case · 480 Each, plus irregulars), then Primary / Hierarchical (n) / Irregular (n) groups with the rendered barcodes. Add, edit and delete use the wizard's pack-type modal (barcode chips, duplicate-barcode guard, derived UOM qty and weight). Every change saves at once (`PATCH {packTypes, version}`) with a toast that names the change ("Case was added with 1 barcode", "Inner Pack and its barcodes were removed"), then the detail refetches. A server rejection (pack with stock, duplicate barcode, stale version) rolls the cards back and says why. The primary pack has no delete. Kits and packaging (and read-only users) get the hierarchy strip over the read-only cards. Verified on KS-E2E-PACK-37606: add Case (12, barcode), add Pallet (40 × Case → 480), add Irregular with a new master pack type, add a second Case barcode, delete the irregular; API shows `Primary:Each:1`, `Hierarchical:Case:12:Each:…-CS|…-CS2`, `Hierarchical:Pallet:480:Case`.
- **Pack-type master.** The pack type field in the modal is a searchable Combobox over the master (`lookup_values` type `pack_type`). Users with Data setup can type a new name to add it to the master (`POST /api/lookups/pack_type`, toast "Pack type added"); everyone gets a **Manage pack types** link to `/settings/data-setup/pack-types`. Verified: "Inner Pack" created inline and used as an irregular pack.
- **Availability numbers reconciled.** Header tiles are now **Unallocated** (on hand − allocated − damaged) and **ATP** (undamaged on hand − all open order demand), each with an info button that shows the formula with this product's numbers. The Inventory tab's column is "Unallocated" and the ATP section says why the two differ.
- **Products / listings load.** Page 1 of the grid, its saved views and the filter field lists now start loading during hydration, in parallel with the permission check (`usePrefetchGridFirstPage` in grid-state.tsx, same query keys as `useGrid` / `useSavedViews`; `useProductFilterFields` hoisted above the gate). Before, they started only after `/api/me` returned. The Create drawer's wizard options are warmed only after the grid has rows, so they never compete with it. Measured warm on the shared dev server: /products rows 1.3-1.6 s (was 2.1-2.3 s in the same session), /products/listings 0.9-1.2 s (was 2.9-4.8 s). Remaining variance is dev-server contention (one `/api/products` call measured 31 ms to 3.5 s back to back with no code change).
- **One stepper style.** `ProductWizard` passes `stepper="steps"` for every variant, so the Create / Duplicate / Edit drawers show the same numbered "STEP n" stepper as /products/new; `DRAWER_WIZARD_CLASS` tightens it for the drawer width.
- **No "Loading clients…" on the full-page wizard.** `/products/new` and `/products` prefetch the wizard options (`usePrefetchWizardOptions`, same key as the wizard) with the permission check.
- **Suggested listings demo.** `src/server/repositories/listings-demo.ts` + `scripts/catalog-demo-listings.ts [--apply] [--reset]` add five Bluebird & Main Shopify listings: four Suggested (one with a lower-case seller SKU) and one No match. Applied to the shared DB; also chained into `seedAcceptanceFixtures`, so `db:reset` / `db:fixtures` keep them. `--reset` returns them to unlinked and withdraws dismissals for a replay.
- **Listing image fallback.** The IMAGE column shows the channel image, else the linked product's, else the suggested product's image; the tooltip names the source.
- **Accessibility.** The Unlinked / Linked switch is a `radiogroup` of two `radio`s named exactly "Unlinked" and "Linked" (count is a description), with roving tabindex and arrow keys. In-cell icon buttons have distinct names ("Accept suggestion SKU", "Reject suggestion SKU", "Unlink SELLER-SKU"); tooltips keep Logiwa's wording. The detail header has one "More actions" button; stat-tile info buttons are now named "How Unallocated is calculated" / "How ATP is calculated" (new optional `infoLabel` on the shared StatTile, default unchanged).
- **Tag flow** (verified): select 2 listings → Tag → Create Tag → the popover now reopens with the new tag ticked (shared TagPopover fix, it used to close and drop the selection) → Apply → toast "Tags updated on 2 records" and the Tags cell updates in ~3 s; Filter › Tag › the tag → URL `f.tagId=in:<id>`, Total 2; API returns the same two rows.
- **Match / Don't match / Unlink round trip** (verified): Accept suggestion → toast "Listing linked … Undo", row leaves Unlinked in 0.9 s; Reject suggestion → toast, row turns No match; Linked tab → in-cell Unlink → confirm dialog with seller SKU / store / product → Yes → toast "Listing unlinked … Undo", row leaves Linked in 1.4 s → Undo → "Undone", row back, API linked again.
- Also fixed: read-only roles no longer request `/api/products/[id]?view=form` on the detail page (it 403'd for viewer; the edit-form prefetch is gated on Products › Edit). Viewer sees the hierarchy strip and read-only cards, no edit buttons, 0 console errors.
- Demo state after the run: the demo listings were reset (`--reset`: 4 Suggested + 1 No match), the two test tags and test product KS-E2E-PACK-37606 were deleted. "Inner Pack" stays in the pack type master as a custom pack type example.
- Also fixed: a whitespace text node inside the detail "More" `DropdownMenuTrigger asChild` made Radix Slot throw (page error); removed.
- Tests: new `tests/unit/catalog/blind-judge-r1.test.ts` (pack hierarchy ordering / orphans / view mapping, pack add + remove re-parenting with derived UOM qty, listing image fallback, demo fixture insert-once + change log + reset + missing store). Catalog suite 15 files, 166 passing. tsc clean for catalog paths; eslint 0 errors on touched files.
- Shared files touched (minimal, backward compatible): `ui/stat-tile.tsx` (optional `infoLabel`), `shared/tag-popover.tsx` (reopen after Create Tag), `db/seed/acceptance-fixtures.ts` (one call to `ensureDemoSuggestedListings`).
