# M09 catalog — requests

## REQ-1
- **File:** `src/app/(app)/integrations/monitoring/listing-exceptions/page.tsx` (owned by M12, not a shared primitive; handoff note only).
- **Change:** build the "Product Listing Exceptions" grid on `GET /api/listings/exceptions?kind=unlinked|sku_difference|multi_listing`
  (M09, permission `settings.product_listing.view`). It returns `{ rows: ListingExceptionRow[], counts }`; rows link to
  `/products/listings?link=<linked|unlinked>` and `/products/[productId]`. Repository: `listListingExceptions` in `src/server/repositories/listings.ts`.
- **Reason:** acceptance "linking an unlinked listing … clears its Listing Exception in M12 monitoring". Exceptions are derived from
  `product_listings`, so the M12 page needs no table of its own and clears as soon as M09 links a listing.
- **Status:** not a shared change (F-patch 2026-11-06): handoff note for M12, which owns `src/app/(app)/integrations/monitoring/listing-exceptions/page.tsx`. Nothing to apply in shared files; the export key `monitoring-listing-exceptions` is registered (automation-integrations REQ-2).
- **Foundation pass 2 (2026-11-09):** re-verified against the code; all REQs above DONE (pass 2), no further shared change pending.

## Round 2 requests

### REQ-2 (optional, low priority)
- **File:** `src/server/db/schema/catalog.ts` (+ migration), table `product_listings`.
- **Change:** add nullable `dismissed_suggestion_sku text`.
- **Reason:** "Don't match these products" is stored today as the audited change-log field `dismissedSuggestion` and read back by a
  correlated subquery in `suggestionSql` (`src/server/repositories/listings.ts`). That works and is audited, but a column would make the
  Suggested check an indexable read. M09 would switch `dismissSuggestion` / `linkListing` to write the column and keep the change-log entry.

### REQ-3 (lint, foundation-owned primitive)
- **File:** `src/components/products/wizard/product-wizard.tsx` is M09's, but the render-callback contract it fills comes from the shared
  wizard (`src/components/ui/wizard`): `wrap(node, ctx)` is called during render, so M09 stores `ctx` in a ref there
  (`react-hooks/refs` error at line ~97). If the shared wizard exposed its form/goTo via context or a hook, M09 could drop the ref.

### REQ-4 (major) — CSP blocks every external product image
- **File:** CSP header source (`src/middleware.ts` / `next.config.*`, foundation-owned).
- **Change:** `img-src 'self' data: blob: https:` (or an allow-list incl. `cdn.shopify.com`, `m.media-amazon.com`, `*.ssl-images-amazon.com`).
- **Reason:** product `imageUrl` values from Shopify/Amazon never render in the grid, wizard preview or detail header (console CSP violation).

### REQ-5 (major) — grant catalog read to operator and viewer
- **File:** role seeds / `src/server/auth/permission-catalog.ts` defaults.
- **Change:** add `settings.products.view` (and `settings.product_listing.view` for viewer) to the operator and viewer system roles.
- **Reason:** warehouse operators need product and barcode lookup. M09 now shows a designed 403 state (`CatalogViewGate`) instead of an endless skeleton and hides Bulk import/update without `import_file`, but read access itself is a role-default decision.
- **Status:** DONE (foundation round 2, 2026-11-10): operator and viewer get `settings.products.view` and `settings.product_listing.view`.

### REQ-6 (minor) — Products under Inventory in nav + breadcrumbs
- **Files:** `src/config/nav-config.ts`, `src/config/route-registry.ts`, `src/config/page-tabs.ts`.
- **Change:** move `/products` and `/products/listings` from the Settings group to Inventory (Home > Inventory > Products), with matching nav highlight; give `/products/[id]` the full breadcrumb (Home > Inventory > Products > {SKU}) via `DetailHeader`.

### REQ-7 (minor) — shared wizard drawer footer
- **File:** `src/components/ui/wizard/wizard.tsx` (`Footer`, sticky variant).
- **Change:** footer must be a solid, full-bleed bar: e.g. `sticky bottom-0 -mx-6 -mb-6 px-6 py-3 bg-surface z-10` (match the Drawer body padding) so content cannot show beneath it.

### REQ-8 (minor) — field error / counter alignment
- **File:** `src/components/ui/text-field.tsx` + `src/components/ui/form.tsx` (FormField).
- **Change:** render the FieldError directly under the input, with the `0/100` counter right-aligned on the same line. M09 hides the SKU counter meanwhile.

### REQ-9 (minor) — Barcode text overlap
- **File:** `src/components/ui/barcode.tsx`.
- **Change:** pass `textyoffset: 2`, `paddingwidth/paddingheight` (quiet zone) to bwip-js so human-readable text sits below the bars. M09 now renders `showText={false}` with its own caption.

### REQ-10 (minor) — toasts cover the grid footer
- **File:** `src/components/ui/toast.tsx` (Toaster position/offset). Move to top-right or offset above the grid footer (~56px).

### REQ-11 (minor) — grid row highlight + stable rows under open menus
- **File:** `src/components/grid/data-grid.tsx`, `row-menu.tsx`.
- **Change:** (a) `rowClassName?: (row) => string` so a just-created row can be highlighted (M09 uses a "New" badge via context for now); (b) keep an open row menu mounted across background refetches (row key = `getRowId`, no remount while `isFetching`), since the critic saw "element detached" on kebab items.

### REQ-12 (minor) — ChangeLogDrawer slow/timeout state
- **File:** `src/components/shared/change-log-drawer.tsx`.
- **Change:** after ~8s pending show "Taking longer than usual · Retry", and an error state with Retry. (M09 did this for its Edit drawer and detail page with `useSlow`.)

### REQ-13 (blocker) — server-wide API latency
- **Where:** `src/server/api/define-route.ts` / middleware / session lookup.
- **Evidence (2026-11-09):** `/api/me` 7.9 s, `/api/products?pageSize=5` 18.7 s, while the same `listProducts` SQL runs in 7 ms against `.data/kitstak.db`. Profile the per-request auth/scope/permission resolution (and the dev-server load) in the shared route wrapper.

### REQ-14 (major) — grid footer shows "Total: 0" while loading
- **Files:** `src/components/grid/use-grid.ts`, `grid-footer.tsx`.
- **Change:** while `list.isPending`, expose `total: null` and render "Total: —" (or a skeleton), never 0. Optionally add a built-in slow/Retry state to DataGrid (M09 adds a page-level `SlowGridNotice` in the meantime).
- **Status:** DONE (foundation round 2, 2026-11-10): GridFooter `loading` prop.

### REQ-15 (minor) — segmented Yes/No toggle
- **File:** shared segmented control used by the product wizard (Active?/Digital?).
- **Change:** size to content (`inline-flex w-auto`), and use the neutral/primary-soft selected state for "No", never the danger/red fill. Red is reserved for errors.

### REQ-16 (major) — DB-level per-client barcode uniqueness
- **Files:** `src/server/db/schema/catalog.ts` (+ drizzle migration; foundation-owned).
- **Change:** add `client_id text NOT NULL` to `product_barcodes` (backfill from `products.client_id`) and replace the non-unique `product_barcodes_code_idx` with `UNIQUE (client_id, barcode)`. Every insert path then sets `client_id`: `products-commands.ts syncPackTypes` (M09), `src/server/domain/products.ts createProduct` (foundation), seeds (`seed/catalog.ts`, `seed/acceptance-fixtures.ts`).
- **Reason:** the app-level guard `assertBarcodesUnique` (create, PATCH, imports via the same command) can still race. The existing dev duplicate is cleaned up (see progress Round 2 parity loop), and the dev DB now has **0** same-client duplicate barcodes, so the unique index applies without conflicts.
- **Audit of the duplicate:** KS-CRIT-P1 was created 2026-11-10T02:59Z by admin@kitstak.io through the wizard (change_log "Create"), before the barcode guard landed in `products-commands.ts` (file mtime 21:22 local). It was not an import.

### REQ-17 (major) — CSP img-src alternative is in place (REQ-4 can stay as is)
- M09 now proxies remote product images through `GET /api/products/image?u=` (SSRF-hardened, cached), so REQ-4 is no longer required. Keep `img-src 'self' data: blob:`.

### REQ-18 (minor) — nav visibility for operator/viewer
- **File:** `src/config/nav-config.ts` line ~110.
- **Change:** `products: ["settings.products.view", "inventory.total_inventory.view"]` (any-of), `productListings` likewise, so floor roles see the Products menu entry. The M09 APIs and pages already accept either key (`src/lib/grid-defs/products/permissions.ts`); mutations stay on `settings.products.*`.
- **Status:** DONE (foundation round 2, 2026-11-10): solved by REQ-5: floor roles now hold `settings.products.view`, so the existing nav entry shows.

### REQ-19 (minor) — Print Options modal: template list while /api/printouts is pending
- **File:** `src/components/shared/print-options-modal.tsx`.
- **Change:** render `defaultTemplates(typeKeys)` immediately (they are static) and replace them when `/api/printouts` answers, instead of a full-body spinner. That gives the Logiwa "Template: Default / Product Label" picker plus Print Quantity at once, even with 80+ rows selected.

### REQ-20 (minor) — grid search fetch state (complements REQ-14)
- **Files:** `src/components/grid/data-grid.tsx`, `use-grid.ts`.
- **Change:** while `isFetching && !isPending`, dim the previous rows (`opacity-60`) and show a 2px indeterminate progress bar under the toolbar. Footer total: keep the previous total until the response arrives.

## Foreign edits (Round 2)
During this round, files in M09's own tree changed under me from another writer (another agent or session). I merged on top of their changes and did not revert them:
- `src/components/products/wizard/step-general.tsx` (ClientField Combobox, ImageField, imports)
- `src/components/products/wizard/fields.tsx` (`unclamped` NumF / inline trigger)
- `src/components/products/wizard/context.tsx` (`optionsError`)
- `src/components/products/catalog-shared.tsx` (`CATALOG_CRUMBS`)
- `src/components/products/products-page.tsx`, `listings-page.tsx`, `product-detail.tsx` (breadcrumbs)
- `src/components/products/wizard/step-packing.tsx`
- `src/app/api/products/route.ts`, `[id]/route.ts`, `options/route.ts`, `src/app/api/listings/route.ts`, `options/route.ts` (PRODUCT_/LISTING_READ_PERMISSIONS, form-view permission check)
- `src/lib/grid-defs/products/product-form.ts` (tax message, hazmat/customs defaults), `src/server/repositories/products-commands.ts` (partial PATCH merge, kit barcode guard)

### REQ-21 (minor) — quick-search mode + page size in the URL (round 4)
- **File:** `src/components/grid/use-grid.ts` (URL state).
- **Change:** besides `?q=`, write the search mode and page size (Logiwa: `?sku=&skuqt=eq&ps=`; e.g. `?q=&qm=exact|starts|contains&ps=50`) and restore both on load, so a shared link reopens the same search.

### REQ-22 (minor) — grid ARIA semantics (round 4)
- **File:** `src/components/grid/data-grid.tsx`.
- **Change:** expose `role="grid"` / `row` / `columnheader` / `gridcell` (or native table elements). Playwright `[role=row]` currently matches nothing on /products.

### REQ-23 (minor) — sticky-right column edge (round 4)
- **File:** `src/components/grid/data-grid.tsx` (sticky-right cell styles).
- **Change:** give sticky-right cells an opaque row background (including hover/selected and dark mode), plus a left shadow that starts at the cell boundary. Today a sliver of the scrolled column (a pill edge) shows at about x=1360 on every /products row, and reads as a white half-circle in dark mode.

### REQ-24 (minor) — neutral density toggle in the grid footer (round 4)
- **File:** `src/components/grid/grid-footer.tsx` (Large | Small).
- **Change:** use a compact neutral segmented control (selected = `bg-neutral-soft text-body`), not solid brand red, which competes with the primary CTA.

### REQ-25 (minor) — demo data hygiene (round 4)
- **File:** seed/cleanup script (foundation).
- **Change:** add a `db:clean-test-data` script that deletes products/listings whose SKU starts with `KS-CRIT-` / `KS-E2E-` (and their pack types, listings and change-log rows), to run before buyer demos.

### REQ-13 (blocker, still open in round 4) — latency
- Measured 2026-11-09 round 4 (headless Chrome, admin): /products 38 s to network idle, /products/listings 89 s, product detail 37 s, /products/new wizard 6 to 56 s. The catalog SQL takes milliseconds, so the shared dev-server, route-wrapper and /api/me path still dominates.

## Round 2 requests (added Round 5, 2026-11-10)
- [shared domain, src/server/domain/change-log.ts `recordUpdate`/`recordLine`] When `from` formats as an empty string, write `(empty)` instead, e.g. "Description is modified. (empty) --> value". Today the message is "Description is modified.  --> value", with a double space. Critic r4 minor.
- [Stations / packing, owner of packing-station box selection] Honour `product_pack_types.use_own_box`: when true, the packing station should skip carton selection or suggest "ship in own box" for that pack. The catalog stores the flag and its tooltip describes it. Critic r4 minor.
- [Layout/nav, REQ-6 repeat] /products* still highlights "Settings" in the top nav while the breadcrumb says Inventory. Map /products, /products/listings and /products/new to the Inventory group.
- [Grid, REQ-23 repeat] The last scrollable cell ("—") shows a sliver against the sticky kebab column on /products. Clip it or add an opaque scrim at the sticky edge.
- [Grid, useGrid URL state] Optional: always write `ps` when the user picks a page size, even when it is the default 100, so shared links are explicit (Logiwa ps=100).
- [Perf, REQ-13 repeat] Cold /products took 35 s and detail up to 46 s on the dev server. Shared fetch and compile path.

### Round 6 additions (2026-11-10)
- [nav, REQ-6 still open, owner of src/config/nav-config.ts] Products and Product Listings sit in the `settings` menu (nav-config.ts ~line 376, "Master Data" column), so `activeMenuKey` (src/config/nav-access.ts:59) highlights Settings. Fix: either move both items to the Inventory menu, or make `activeMenuKey` prefer `resolveNearestRoute(pathname).section` and set section "Inventory" for /products* in route-registry.ts. The breadcrumb already says Inventory.
- [ui/chip-input + ui/select, owner foundation] Focus ring uses `primary`, which is brand red and identical to the error state (pack-type Barcode chip input, Duplicate drawer Client select). Use a neutral or blue `--ring` focus token. Keep red for `aria-invalid` only.
- [ui/callout, owner foundation] The `info` variant uses `primary` (red) and reads as an error. Use a neutral or blue token. Catalog now renders its own neutral callout for Duplicate as a stopgap.
- [orchestrator] Add a cross-module build gate. Other modules' syntax errors (location-generator-drawer.tsx, purchase-orders-receive.ts:152) took /products down with HTTP 500.
- [dev perf] First-hit compile times (/products/new 67 s) come from Turbopack dev cold compiles of the shared bundle. Consider warming routes after server start.

### Round 3 additions (2026-11-10, critic r2 score 7.3)
- [imports framework / orders owner, blocker for the catalog Bulk import pages] `GET /api/imports/<key>` returns 500 for every key. The current cause, from the dev log after the 01:18 restart, is `createContext only works in Client Components`, raised at `src/lib/format.ts:284` and imported by `src/server/repositories/orders-change-log.ts:14` → `orders-commands.ts:20` → `orders-import.ts:16` → the imports registry. Server code must not import the client `format.ts`; split the pure formatters out. Before the restart the cause was a Turbopack "module factory is not available" error for `src/server/repositories/inventory-commands.ts`, required from `src/server/imports/handlers/inventory.ts`. Also give the shared import-page history grid an error state with Retry.
- [foundation, `src/server/query/grid-query.ts:232`] `serializeGridQuery` writes `qm` only when `q` is non-empty, so "pick Equal, then type" loses the mode on every grid. Catalog works around it locally (`useStickySearchMode`). Fix: `if (query.qm && query.qm !== "sw") params.set("qm", query.qm)`, then catalog can drop the wrapper.
- [foundation, `src/components/grid/data-grid-columns.tsx` sticky-right] A box-shadow scrim on a sticky `td` is painted under neighbouring cell content in Chrome. Use a positioned `::before` gradient (catalog does this via `GridFetchFrame`). Also expose `isPlaceholderData` from `useGrid` so pages can dim stale rows exactly.
- [foundation, `src/server/api/errors.ts`] Add `PRECONDITION_REQUIRED` (428) for a missing version / If-Match. Catalog returns 409 `VERSION_REQUIRED` (details.reason) until then.
- [grid toolbar] At 768px, an applied filter chip ("Product category: Kit") squeezes to an unreadable 40px pill. Let the chips wrap to their own row.
- [nav, REQ-18 repeat] Operator and viewer can read /products and listings, but the menus show no Products / Product Listings entry.
- [shared PrintOptionsModal, Logiwa parity] Add direct-print printer selection (header Printers popover with warehouse) to the print flow.
- [seed / custom fields] Seed one product custom field (Logiwa sandbox has a "Training" text field) so Other info is not empty in demos.

### Blind-judge repair round 2 additions (2026-11-10)
- [orchestrator / dev server] During this round, http://localhost:3000 stopped answering: /login took more than 30 s and pages took more than 240 s. `/api/imports/<key>` returned 500 with "Jest worker encountered 2 child process exceptions, exceeding retry limit" (Turbopack compile worker crash). The route code is fine (no client modules in its import graph, and the f6/f7 import suites pass). Restart the dev server, or limit concurrent agents' headless walks.
- [stations / packing UI, owner of src/components/packing/pack-model.ts] The server now rejects packages that break `use_own_box` (`PackLine.useOwnBox` in packContext). The station should auto-split own-box lines into one package per unit and show a "Ships in own box" chip, so packers never hit the validation error.
- [shared perf pattern, all grid owners] SQLite evaluates every correlated SELECT column before ORDER BY/LIMIT. Catalog went from 8-18 s to about 58 ms at 6.5k rows by paging ids first and then hydrating the page (see `listProducts` / `listListings`). Other big grids (inventory, orders) should be checked with a perf test like `tests/unit/catalog/perf-6k.test.ts`.
- [inventory, optional] Add a deep link (`/inventory/by-location?add=1&productId=`) that opens the Add Inventory drawer prefilled, so the product Transactions empty state can open it directly.

### Catalog round 4 (parity loop) additions (2026-11-10, critic r3 score 7)
- [foundation / scripts, REQ-25 ready to wire] `src/server/repositories/products-test-data.ts` exports `planTestDataPurge(tx, prefixes?)` (dry run) and `purgeTestCatalogData(tx, ctx, prefixes?)`. The purge deletes KS-CRIT-/KS-E2E- products that pass the normal delete guard, kits before their components. It deactivates guarded ones (stock, orders, history) through `setProductStatus`, so the ledger stays intact and the change log is written. It also deletes test-prefixed listings. Tests are in `tests/unit/catalog/round4-parity.test.ts`. Please add `"db:clean-test-data": "tsx scripts/clean-test-data.ts"`. The script should open the app DB, build a system `ScopedCtx` with `{ warehouseIds: "all", clientIds: "all" }`, run the purge in one transaction, print the plan, and accept `--dry-run`. It can also call the existing `scripts/purge-test-data.cjs` user/role purge. Run it before any buyer demo or blind comparison.
- [seed, demo catalog] Seed realistic products with `image_url` set, served same-origin from `/public/demo/products/*.webp`. The CSP allows only `'self'` images, and the catalog proxy handles remote URLs. Use 30 to 60 SKUs per demo client, with pack types, barcodes and some stock, so the first /products screen compares to Logiwa's catalog. Products without an image now show a neutral image placeholder instead of initials.
- [orchestrator, blocker repeat] The shared dev server took 28 s to answer `/api/health` this round, and earlier it went 45+ minutes without answering. Buyer or critic comparisons should run against `next build` + `next start` on a dedicated port, behind a cross-module tsc/build gate. One module's half-written file must not 500 every `[id]` route.
- [dev runtime, console] "Router action dispatched before initialization" comes from Next's `prefetch`/`dispatchAppRouterAction` when `getCurrentAppRouterState()` is null. No catalog code calls the router or `history.*` during mount. The only mount-time navigation, the legacy `?sku=`/`?skuqt=` alias rewrite, is now deferred one macrotask past the App Router's effects. The remaining occurrences line up with dev-server HMR full reloads and aborted chunk loads (the ERR_ABORTED cascade), and did not reproduce on a production build in earlier rounds. If a critic still sees it on `next start`, capture the stack and file it against the shared Link/prefetch callers in the layout.
- [shared PrintOptionsModal, repeat] Direct-print printer selection (the Logiwa header Printers popover, per warehouse) is still missing from the product label flow.

### Catalog round 5 (parity loop) additions (2026-11-10, critic r4 score 6.3)
- [orchestrator / dev server, blocker repeat] The shared dev server answered /api/health in 60 to 64 s this round. The critic's r4 500s ("Jest worker encountered 2 child process exceptions") are Turbopack worker crashes, and catalog code is not involved: the same tree on `next build` + `next start` serves /products in 0.3 to 1 s and the product APIs in under 60 ms. Please restart `next dev`, and run critic and buyer comparisons against a production build on a dedicated port. The catalog's isolated build recipe is in %TEMP%/claude/kitstak-critic/catalog/prodbuild5: copy src/drizzle/public/scripts and the configs, junction node_modules and .data, set `turbopack.root: "C:\\"` and `typescript.ignoreBuildErrors`, then run `next build` and `next start -p <port>`.
- [facility-config] r4 saw a compile error on /api/orders: "Export lpLabelTitle doesn't exist in target module" in `src/components/facility/lp-numbers/lp-numbers-page.tsx`. One module's broken import 500s unrelated routes on the dev server, so please fix it or confirm it is fixed.
- [foundation, perf REQ-13] On dev, `proxy.ts` showed 12 to 15 s per request and `/api/me` 1 to 3 s. Profile what proxy.ts imports at module scope (keep it to the session cookie check, with no DB or schema import), and cache `/api/me` per session for a few seconds.
- [foundation / package.json, REQ-25] Wire `"db:clean-test-data": "tsx scripts/catalog-test-data.ts --apply"` (the M09 script already exists; it is a dry run without --apply). Run it before any buyer demo. Without `--delete-only` it deactivates the remaining test SKUs that other suites' open orders reference.
- [stations / shipping, consumers of pack weight] Hierarchical packs now get a derived weight (child qty × contained weight) on save. Cartonization, rate shopping and case-pick labels can rely on `product_pack_types.weight` being > 0 whenever the primary pack has a weight.

### Catalog round 6 (parity loop) additions (2026-11-10, critic r5 score 8.8)
- [orchestrator / ops, REQ-13 repeat, blocker for demos] The shared dev server at :3000 took 53 s for `/api/health` again this round, and the critic's headless `/products` load timed out after 240 s. The same tree as a production build (`next build`, then `next start`) serves /products rows in about 550 ms. Restart the shared dev server before any walk, or run buyer demos and blind comparisons on a production build.
- [shared grid `src/components/grid/export-button.tsx` + `/api/exports`] Export As Excel always queues a background task ("Export started… appears in Transactions"), even for 3 rows. Logiwa downloads at once. Requested behaviour: when `total` is at or under a threshold (for example 5,000 rows), POST `/api/exports` with `{ ..., inline: true }`, run `runExport` synchronously, and answer the xlsx bytes with `content-disposition: attachment; filename="<exportFileName(...)>"`. The client then saves the blob and still refreshes the Transactions tray, so Export History keeps the record. Above the threshold, keep today's 202 plus toast. Products passes `total` already, so no catalog change is needed once the primitive supports it.
- [shared print `src/server/print/render.ts` `printFileName`] Printout file names are stamped in UTC (`now.toISOString()`), giving names like "Product Label 2026-11-10 1202.pdf". Exports use the viewer's zone ("Products 2026-11-10 0607.xlsx", see `exportFileName(title, at, timeZone)` in `src/server/exports/runner.ts`). Requested fix: give `printFileName` the same `timeZone` argument, defaulting to UTC. `/api/printouts` should accept a `timeZone` (validated with the exports `isValidTimeZone`) or fall back to the user's saved zone through `resolveExportTimeZone`, and `PrintOptionsModal` should send `Intl.DateTimeFormat().resolvedOptions().timeZone`. This applies to every module's labels, not only Product Label.
- [foundation seed `src/server/db/seed*`] The seed catalog has no product images. M09 now ships `demoImageUrl(sku, category)` in `src/lib/grid-defs/products/demo-images.ts`, which gives a same-origin `/api/products/demo-image/<kind>-<hex>.svg` illustration served by the catalog route. Please set `imageUrl: demoImageUrl(p.sku, p.category)` when the seed inserts products, so `db:reset` produces a catalog with images. Until then, `npx tsx scripts/catalog-demo-images.ts --apply` (M09, idempotent, with change log) back-fills an existing DB. It has been applied to the shared dev DB (81 products).
- [shared ui `src/components/ui/wizard/wizard-stepper.tsx`, `src/components/ui/tabs.tsx`] Below `lg`, M09 compacts the page stepper through a Wizard `className` that targets `nav[aria-label=Progress]` (`PAGE_WIZARD_CLASS` in product-wizard.tsx). It wraps the detail `UnderlineTabs` in a catalog `OverflowFade` (edge fades plus chevrons, keeps the active tab in view). Both should become primitive features so every module's 5-step wizards and long tab rows behave the same at tablet width: a `compact` breakpoint on `WizardStepper`, and overflow affordances on `UnderlineTabs` / `PageTabs`. When that lands, M09 will drop its local versions.

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** REQ-2 (`product_listings.dismissed_suggestion_sku`, migration 0003), REQ-6 (already: /products resolves to Inventory), REQ-7 (sticky wizard footer), REQ-9 (bwip-js `textyoffset` + quiet zone), REQ-10 (toasts top centre), REQ-11a (`highlightRowId`), REQ-12 (drawer "Taking longer than usual · Retry" after 8 s), REQ-14 (footer), REQ-15 (`YesNoToggle tone="neutral"`), REQ-19 (built-in templates render at once with "Loading templates…"), REQ-20 (stale rows dimmed + progress bar via `refreshing`), REQ-22 (row/cell roles), REQ-23 (sticky-right scrim), REQ-24 (neutral density toggle), round 3 `serializeGridQuery` keeps `qm` without text, round 6 chip-input/select focus (info), round 6 callout (already done).
- **Not done:** REQ-3 wizard ctx via context, REQ-8 field error/counter layout, REQ-11b row-menu remount, REQ-16 DB-level barcode uniqueness, REQ-21 qm/ps in URL (qm now kept), REQ-25 `db:clean-test-data` script wiring, round 3 PRECONDITION_REQUIRED, printer selection in PrintOptionsModal, demo images in the seed, exports inline download, print file names in the viewer's zone, compact stepper / tab overflow, perf/infra.
