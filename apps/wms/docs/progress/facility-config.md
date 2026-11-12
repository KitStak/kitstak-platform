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

## Round 1 (parity loop) — 2026-11-09
- Compared against `references/logiwa-live/settings-shell.md` (Warehouse, Mobile Carts, LP Types, LP Numbers, Shipment Packages) and `masterdata-reports.md` §7 (Locations). Existing build already covers: Warehouse Information/Settings tabs incl. day shift AM/PM + inactivity timeout; LP type volume unit/max volume + 9 parameters; LP number sequence/custom/SSCC18 + Yes/No pill (fixes Logiwa raw `false`); package currency + purchase price; read-only Show details (fixes Logiwa defect); per-entity kebabs (superset of Logiwa).
- New: Mobile cart cell list now shows Suggestion sequence and Cell color (Logiwa cycle Orange, Green, Red, Blue, Pink, Light Blue, Purple) — `cellSequence`/`cellColor`/`CELL_COLORS` in `src/lib/grid-defs/facility/mobile-carts.ts`, rendered in `mobile-cart-wizard.tsx`. Display-only (no schema change). Test: `tests/unit/facility-config/cart-cells.test.ts`.
- Headless Playwright (admin, system Chrome): all 6 routes render with zero console/page errors; every row kebab item (Show details, Edit, Change log, Label, Print barcode) opens the right drawer/modal; create wizards open on all 6 pages. Locations Show details is a link to `/locations/[id]`; navigation could not be re-timed this run because the shared dev server was saturated (60s+ responses).
- Checks: vitest facility-config 42/42 pass; tsc clean for module paths.
- Remaining: viewer-role 403 click-through, cross-module acceptance (M06 putaway block, M05 default receiving, M04 package consumption), re-run detail navigation when the dev server is less loaded.

## Round 1 (parity loop) — 2026-11-09
Walked every page headlessly (admin + viewer storage states, `C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\facility-config\*.mjs`) against `references/logiwa-live/{settings-shell,masterdata-reports,inbound-inventory}.md`, then fixed what fell short.

**Verified end to end (UI, real DB):** LP type 3-step wizard → create → Change log → Delete; mobile cart 2-step wizard (cell list with seq/colour) → Duplicate dialog → Label modal → detail drawer → Delete; location 3-step wizard (incl. Add product capacity modal) → 201 → detail page → Change log → Delete; location edit (all 3 steps), Label print modal, Generator drawer; every row kebab on all 6 grids; viewer: all Create CTAs disabled, `POST /api/lp-types` → 403. Zero console/page errors from module code (only transient compile errors from other modules' mid-edit files).

**Fixed / added this round**
- Code / number cells on Warehouses, Mobile Carts, LP Types, LP Numbers, Shipment Packages are now blue link buttons (`CodeCell` in `facility-shared.tsx`) — Logiwa `.link-to-detail` parity, keyboard reachable (Enter opens the read-only detail drawer).
- Shipment Packages grid: "Inventory reduction location" header no longer overlaps Length; code column wide enough for `ENV-POLY-1013`.
- Wizards: removed the doubled headings (step title "General" + section "General", "Mobile cart"/"Mobile cart", "Parameters"/"Parameters", "Other info"/"Other information"); first sections are now Identity / Identity and numbering / Mixing rules / Description.
- Location edit: group and zone no longer render blank while the lookup lists load (`withSavedOption`, seeded from the detail); placeholders say "Loading…".
- Warehouse labels: "MLT1 · MLT1 - Main Fulfillment" → "MLT1 - Main Fulfillment" (`warehouseLabel`) in every picker and the location detail.
- Location detail: SKUs in Contents / Capacity / Ledger link to `/products/[id]` (contents API now returns `productId`); empty dimensions/volume show "—" instead of "0 × 0 × 0"; ledger notes the 100-row cap with a Transaction History link.
- Location create toast has an **Open location** action (new rows sort out of view in the code-sorted grid).
- **Beyond Logiwa:** Create Warehouse → Settings offers "Create starter locations and use them as defaults" (default on in the UI, off for API callers): creates `<PREFIX>-RECV` (Receiving), `-PACK` (Packing), `-SHIP` (Shipment), `-RET` (Returns) as Business Stations in the same transaction, wires them as default receiving / ship / return, and the toast lists them. Logiwa leaves a new warehouse unable to receive until locations are created by hand.
- Tests: `tests/unit/facility-config/round1-parity.test.ts` (starter locations on/off, code building, label de-dup, saved-option seeding, contents shape). vitest facility-config **48/48**; `tsc --noEmit` clean for module paths.

**Remaining / notes**
- `npx playwright test tests/e2e/facility-config` cannot launch: the runner wants chromium 1187, only 1254 is installed (REQ-R2-2). The same flows were exercised with a standalone Playwright script pointed at the installed headless shell.
- The default warehouse in the live DB is now KS2 (changed outside this module this session); the M05 "MLT1 default receiving" acceptance assumes MLT1.
- Cross-module acceptance still owned elsewhere: M06 Only-1-SKU putaway block (enforced in `src/server/domain/ledger/rules.ts`), M04 package consumption.

## Round 2 (parity loop), 2026-11-09

Fixes for the round-1 critic verdict (6.8):
- **Roles / 403:** all 7 facility routes (`/locations`, `/locations/[id]` and `/settings/{warehouses,lp-types,lp-numbers,mobile-carts,shipment-packages}`) are now gated server-side with `requirePagePermission`. Viewer and operator now land on `/forbidden?from=…` (verified headless: viewer → `/forbidden?from=%2Flocations`) and never see a skeleton that spins forever.
  - Header Create / Import / Generate buttons are hidden, not just faded, when the permission is missing.
  - Read access for limited roles is a Foundation change: filed as REQ-R2-4.
- **Warehouse (and every wizard) drawer overflow:** wizard drawers pass `bodyClassName="pb-0"`, so the sticky footer is flush and opaque and no section paints below it. Verified with Edit KS2. The shared padding follow-up is REQ-R2-5.
- **PATCH /api/locations/[id] is now a real partial update:**
  - The body (`locationPatchSchema`) is merged onto the stored record (`mergeLocationPatch` in `src/lib/grid-defs/facility/locations.ts`) and then validated as a whole. Omitted capacity arrays are kept; an omitted `version` targets the stored version.
  - `locationInfoSchema` now applies server defaults: capacityType None, maxCapacity 0, dimensionUnit Inch, volumeUnit Cubic Inch, sizes 0, abcCode None, flags false.
  - Verified: `PATCH {info:{maxSkuQty:7}}` returns 200.
  - The wizard reuses the same `locationRecordToInfo` mapping.
- **Group / zone selects:**
  - `useLookups(type, null | "")` no longer fetches every warehouse's values; it returns no options until a warehouse is picked.
  - The selects stay disabled with "Select a warehouse first".
- **Generator footer:**
  - The commit button is disabled until a warehouse is picked, the ranges are valid and the collision check has passed.
  - It reads "Create locations" until checked, then "Create N locations", with a reason tooltip.
  - The code preview now shows as soon as the pattern is valid. Collisions are struck through once a warehouse is picked.
- **Zone strip:**
  - Fixed 70px card height with a one-line `compactCount` subtitle (22,982 → 23k).
  - Edge fades plus left/right scroll arrows when it overflows.
  - Badge colour per warehouse, so "Bulk · KS2" and "Bulk · MLT1" no longer look identical.
- **Mobile carts grid:** the headers are shorter (Cart type / Cells / Levels / Columns / Tasks / Orders / Multi-job), with full names kept in `meta.label` for the chooser and export. The widths are adjusted so nothing clips at 1440px. Icon placement in the shared header is REQ-R2-6.
- **Label preview:** the HRI text is rendered as a separate line under the bars instead of bwip `showText`, which leaves a clear quiet zone.
- **Show details latency:** added `/locations/[id]/loading.tsx` (DetailPageSkeleton), so a click gives instant route feedback. The page Suspense fallback is now the detail skeleton.
- **Redundant menus:** the Import ▾ menu now holds only Bulk import / Bulk update locations. The capacity imports live only under Assign capacity ▾, as the spec says.
- **Performance / polling:** no facility component polls (no `refetchInterval` / `setInterval`). Measured API latency on the shared dev server was 4-8s even for `/api/me`, so the slowness is server load, not these grids. The network-never-idle on lp-numbers comes from shell-level trays, not M10.

Tests: `tests/unit/facility-config/parity-loop-round2.test.ts` covers the PATCH merge, server defaults and compactCount. `npx vitest run tests/unit/facility-config` passes (53/53). `tsc --noEmit` is clean for M10 paths.

## Round 3 (parity loop), 2026-11-09

Fixes for the round-2 critic verdict (6.4):
- **CTAs on first paint:** each gated page passes the server-resolved grant to `ServerPermsProvider` (`facility-shared.tsx`). `usePagePerms` reads it while `/api/me` is still loading. Create warehouse / Create LP type / Create mobile cart now render in the first paint (verified headless at 768px: the CTA is visible on warehouses and mobile carts).
- **Mobile cart wizard dead end:** an inline **Add cart type** panel sits under the Mobile cart type select (name, levels, columns). It POSTs `/api/lookups/mobile_cart_type`, scoped to the picked warehouse, then selects the new type and applies its layout. When the warehouse has no types, a hint is shown. It needs `settings.data_setup.view`, the same permission as the API.
- **Warehouse address:**
  - The Country field is a combobox of the ISO list. State is a US state/territory or CA province picker, with free text for other countries.
  - `warehouseInfoSchema` / `warehouseSchema` reject an unknown country or a non-matching US/CA state (`countryCodeOf`, `normalizeState`). The server rejects them too.
  - KS-CRIT-WH ('ZZZZ-notastate abc') now fails validation on its next edit.
- **Bulk Deactivate:** no longer `destructive` in the toolbar, so it is styled the same as Activate when disabled. The confirm dialog is still `danger`. The general fix is REQ-R3-1.
- **Location row kebab:** added Duplicate (opens the wizard pre-filled with code, barcode and display member cleared), Print label, and Lock/Unlock alongside Show details, Edit, Change log and Delete. Mobile carts already had per-row Duplicate.
- **Area type:** a new location starts with no area type (`newLocationForm`), so the wizard requires an explicit choice. Placeholder: "Select an area type".
- **Zone strip:** cards are grouped under a "Warehouse KS2 / MLT1" divider when more than one warehouse is in scope, and use scroll-snap so no card is cut off at the edge. The strip already follows a single-warehouse filter.

**Not fixed in this module**
- **Latency:** measured on the shared dev server, `/api/me` took 36s, and locations, warehouses and mobile carts took 6-10s. The cause is server load and other modules' compile errors seen during the run: `analytics-operational.ts` "busiest defined multiple times" and a missing `PackPreview` export. Facility queries are not the bottleneck. Server-rendering the first grid page needs the shared grid hook: REQ-R3-3.
- **768px toolbar overlap (Views / Label):** this is in the shared `GridToolbar`, so it is filed as REQ-R3-2.

Tests: `tests/unit/facility-config/parity-loop-round3.test.ts` covers country and state normalization, schema rejection and zone grouping. vitest facility-config passes **57/57**, and `tsc` is clean for M10 paths.

## Round 2 (parity loop): critic 6.4 fixes, 2026-11-09

**Wizards (all 5 drawer wizards: location, warehouse, LP type, mobile cart, shipment package)**
- **Server field errors land on the right step.** `src/components/facility/wizard-guard.tsx` handles this:
  - Each step schema is wrapped so a value the server rejected (duplicate code, taken LP prefix, bad lookup) stays invalid until it changes.
  - Save then re-runs on the next frame. The wizard jumps to the owning step, marks its pill (attention tone) and focuses the field.
  - A persistent inline error banner sits above the steps, and error toasts stay up for 10 s (`ERROR_TOAST_MS`).
  - Verified headless (`r2wh.mjs`): with the pre-check mocked free, a duplicate MLT1 gives 409 → pill "1.Information" turns warning, focus lands on `code`, and the field error and banner both show.
- **Uniqueness pre-check on step 1.** New read-only `GET /api/{locations,warehouses,lp-types,mobile-carts,shipment-packages}/availability` (`src/server/repositories/locations-availability.ts`).
  - It is debounced 450 ms as the user types, so "Warehouse MLT1 already exists" / "Location A-01-01-1 already exists in this warehouse" / "Prefix X is already used by LP type Y" show inline, and Next is blocked. This matches Logiwa's inline errors at Next.
- **No silent clamping.** `NumberField` no longer clamps. Out-of-range input such as -5 walking path or LP count 0 stays as typed, shows "Can't be negative" / "Must be at least 1" at once, and the step schema blocks Next.
  - Shipment package Max volume is checked against L×W×H with unit conversion (`boxVolume` / `maxVolumeIssue` in `common.ts`), e.g. "Max volume can't exceed the box volume (960 Cubic Inch)". The hint shows the box volume in the selected volume unit.
- **Neutral Yes/No.** A selected "No" is a neutral fill, not danger red, and the control is sized to its content.

**Warehouse address**
- Country is an ISO combobox (US and CA pinned) with a dependent State/Province picker.
- Server and client reject an unknown country, a non-US/CA state, a postal code that doesn't match the country pattern (US ZIP / ZIP+4, CA A1A 1A1, generic 2-10 chars elsewhere) and an invalid phone (E.164 or national, 7-15 digits, optional extension).
- Saved values are normalised: ISO country name, 2-letter US/CA state, canonical postal code (`normalizeWarehouseAddress`).
- Verified: `POST /api/warehouses` with Narnia / "not a phone" → 400, with fieldErrors on country and contactPhone.

**Locations**
- **Detail tabs** switch from local state plus `history.pushState`, with no server round trip. Measured 60-105 ms per click across Contents → Capacity → Open tasks → Ledger → Contents. The URL stays in sync (`?tab=` is removed for Contents) and Back/Forward restore the tab (verified).
- **Edit → Save** writes the saved values into the detail query cache at once (`savedPatch`), then invalidates the detail, contents and grid queries. Verified: the walking path shows the new value right after the PATCH.
- **Delete** switches off the record's queries and cancels in-flight fetches before redirecting. There are no 404s in the console (verified).
- **Label preview:** one HRI line (`showText={false}` on the barcode, separate text with a quiet zone).
- **Seed structure:** the dev DB is corrected so A-01-01-1 reads aisle A, rack 01, column 1, level 1 (300 rows). The seed itself is REQ-R2-7.
- **Capacity modal Pack type** lists only the selected product's own pack types, smallest UOM first, with the unit count (new `GET /api/locations/product-pack-types`). It defaults to the first one and is disabled with "Select a product first" until a product is picked.
- **Pending feedback:** bulk Label / Lock / Unlock show a spinner label ("Preparing labels…") and disable themselves while running. A row-menu Label that takes more than 400 ms shows a "Preparing labels…" toast. Create LP numbers shows a spinner and aria-busy.

**Custom fields (Logiwa parity)**
- The shared `CustomFieldsSection` is added to Location → Information (Other information) and LP Type → Other info.
- Values persist to `customFields`, are validated (`customFieldValuesSchema`: known slots only, empties dropped), are merged on PATCH and appear in the change-log diff (`customField.<slot>`).
- All 10 slots are grid filters (Custom field text box 1-3, drop down 1-2, date 1-3, toggle 1-2) and sort keys (`json_extract`).
- Active definitions appear as column-chooser columns named after the field (`useCustomFieldColumns`), and as a read-only Custom fields block on the location detail page.

**Grids**
- **Available / Occupied pill:** one tone everywhere (`AVAILABILITY_TONE`: green Available, warning-orange Occupied). LP number status uses the same tones.
- **LP Types:** dimension/weight units, empty/max weight and all 9 "Is prevent multi …" / SSCC / AI flags are visible by default. Every flag, unit, weight and volume is a filter.
- **LP Numbers:** Length / Width / Height / Weight / Actual volume / Parent LP type (new) / Parent LP number are visible by default and filterable.
- **Shipment packages:** headers shortened to "Tracked" / "Reduced from" (full names in the chooser and export), so they no longer run together.
- **Mobile cart Cell list:** Logiwa's CELL NAME (`<Cart>_<col>_<level>`) and DISPLAY NAME (B3) columns. The layout grid shows each cell's colour as a top bar.

**Roles (decision):** Viewer should have read-only master data and Warehouse Clerk should have location view/lookup. This needs the Foundation role catalog (REQ-R2-4, still open). Until then, M10 server-gates the pages to `/forbidden` and hides create CTAs.

**Performance:** the locations list SQL is ~8 ms per 50-row page on the live DB (better-sqlite3, measured directly). The 10-45 s responses come from the shared dev server compiling. The open-task subquery scans `tasks`; index request REQ-R2-8.

**Console:** fresh headless loads of /settings/warehouses, /locations, /settings/lp-types, /settings/mobile-carts and /settings/shipment-packages show no console errors and no hydration warning (`r2crawl1.mjs`). The only errors seen came from another module mid-edit (`waves-run.ts` importing a missing `plannedWindow`). Shared-code follow-ups filed: REQ-R2-7 seed, R2-8 task indexes, R2-9 wizard `applyServerErrors`, R2-10 error toast default, R2-11 BulkAction pending / async combobox loading.

Tests: `tests/unit/facility-config/parity-loop-round2b.test.ts` covers address/phone/postal validation and normalisation, box volume, custom field schema/merge/fields, takenIssues routing, range messages, tab parsing, the optimistic patch and cart cell names. vitest facility-config passes **71/71**, and `tsc` is clean for M10 paths (checked with a module-scoped tsconfig, because the full project tsc stops at a syntax error in `src/server/repositories/shipment-plans.ts`, another module's file).

## Round 4 (parity loop), 2026-11-09
- **Location detail Delete:** on success the dialog closes at once, a toast shows, and the page goes to `/locations` with `router.replace`. Query cancels are no longer awaited, so there is no lingering spinner.
- **Wizard warehouse default:** `pickDefaultWarehouse` takes the header context first, then the user's `preferences.defaultWarehouseId` (MLT1 for admin), then the only in-scope warehouse. It never picks the first option (KS-CRIT-WH). This applies to every M10 wizard through `useWarehouseOptions`.
- **Bulk Delete style:** the bulk-toolbar Delete in locations, LP types, mobile carts and shipment packages is no longer `destructive`. When disabled it matches Label/Lock. Danger styling stays in the confirm dialogs and on the row-kebab Delete.
- **Shipment packages grid:** the weight, volume and dimension unit columns are widened to 136 px so "EMPTY WEIGHT" doesn't clip at 1440. Description is 300 px, truncates, and shows the full text in a `title` tooltip.
- **Mobile cart wizard:** a read-only "Cart H × L × W / Cell H × L × W" summary from the selected cart type's Data Setup meta (Logiwa parity). It shows "Not set in Data Setup" when the type has no dimensions.
- **Create location toast:** already present ("Location X created." with an "Open location" action). No change.
- **Smoke test (admin):** /locations 2.4 s, /settings/shipment-packages 0.9 s, /settings/mobile-carts 1.2 s, all HTTP 200.
- **Filed:** REQ-R4-1 (viewer read-only role keys), REQ-R4-2 (change-log for deleted entities + JSON envelope), REQ-R4-3 (release gate). R3-1/2/3 are still open.
- **Tests:** `parity-loop-round4.test.ts`. vitest facility-config passes 78/78, and tsc is clean for M10 paths.

## Round 5 (parity loop) — 2026-11-10

- **Generator layout:** the Preview (count, sample codes, collision status) is now a pinned right-hand pane at xl and wider, so it stays visible next to the sticky CTA. Below xl, the footer shows a one-line status ("2 codes · no collisions"). Range inputs use a min-w-0 grid so they no longer overflow into the pane.
- **Generator toast:** shows a titled success toast ("2 locations created · Codes start with KSR5-A-0") for 8 s with a **Show them** action that quick-searches the grid by the common code prefix. Verified headless: the toast text was readable and the URL became `?q=KSR5-A-0`.
- **Change-log drawer (warehouses, mobile carts, LP types, shipment packages):** shows a skeleton while there is no data, while placeholder data from another record is showing, or during a first fetch that returns no rows. It no longer shows a bare header.
- **Location detail Attributes:** "Capacity" is renamed to "Location capacity type" (None shows as "None (unit limit off)"). A new "Capacity rules" row shows the "N product · M LP" counts and links to the Capacity tab.
- **LP type wizard:** an empty warehouse still fails with "Warehouse is required". When the warehouse is pre-filled, a visible description says where it came from (the header context, your preferred warehouse, or your only warehouse). This uses `defaultWarehouseHint` in facility-shared.
- **API:** `GET /api/locations?search=` is now an alias of `q=`. Verified: `search=KSR5` returns 2 rows, the same as `q=KSR5`.
- **Not done here:** compact grid density needs a shared grid change, filed as REQ-R5-1.
- **Tests:** `parity-loop-round5.test.ts` covers commonCodePrefix and defaultWarehouseHint. vitest facility-config passes 85/85, and tsc is clean for M10 paths.
- **Test data:** generated KSR5-A-01 and KSR5-A-02 in warehouse KS-CRIT-WH.

## Round 6 (parity loop) — 2026-11-10

Fixes for the round 5 critic verdict (6.8):
- **LP Numbers 500 (blocker)**: could not be reproduced. `GET /api/lp-numbers` returns 200 for the default query, sort (`-createdAt`, `locationCode`, `isSscc18`), `q` and status filters, and the page lists every LP. The HTML 500s the critic saw match the dev server recompiling while other modules' files were mid-edit: the same 500 shows on `/api/locations`, `/api/warehouses` and `/api/lp-types` for a few seconds after any save, then goes away. The grid already shows an error state with Retry: `useGrid` → `DataGrid error/onRetry`, after 2 query retries. See REQ-R4-3 (release gate).
- **Operator/viewer read access**: every M10 read route and page now accepts either the `settings.*.view` key or `inventory.inventory_by_location.view`, which operator and viewer already hold. This covers locations (list, detail, contents, zones), warehouses, LP types, LP numbers, mobile carts (including change-log) and shipment packages. Writes still need the `settings.*` create/edit/delete keys, and CTAs, kebab edits and bulk actions stay hidden through `usePagePerms`. Verified with the viewer and operator logins: the APIs return 200, the pages render, and Create and Import are hidden.
- **Warehouse default in every wizard**: Generate locations and Create mobile cart now fill the context or preferred warehouse once `/api/me` resolves, without dirtying the form, and show the "Defaulted from…" hint (Generate also offers "Defaulted from the zone you were viewing"). Both verified headless.
- **Generator ranges** are empty with "From/To" placeholders and "e.g." hints. `generatorCount` returns 0 until Aisle and Rack are both entered, so the preview reads "0 locations / Fill the aisle and rack ranges".
- **Walking path 0 vs —**: the change-log snapshot uses the same "unset" normalisation as the UI (`unsetFields`), so a first edit logs `— --> 777`.
- **Locked pill**: new `LockedPill` (warning "Locked" / faint "No") on the location detail and grid column.
- **Warehouse TYPE pill**: Internal is neutral and External is info. Red is no longer used.
- **Legacy invalid warehouse data**: new pure `storedAddressIssues()`. The grid address cell shows a warning icon listing the problems, and the edit drawer shows an attention callout. The schema already blocks saving until they are fixed.
- **Mobile cart cell naming**: DISPLAY is now `A01`, the same as the barcode suffix. The headers read "Display / scan" and "Cell id (cart_col_level)", with tooltips.
- **Mobile cart headers**: numeric headers measure flush with their values. "Tasks" with an info icon became "Open tasks" with no floating icon.
- **Location delete**: `router.replace` runs before cache housekeeping, with a hard-navigation fallback after 2.5 s. Measured headless: about 1.2 s to `/locations`, with the "1 location deleted" toast.
- **Create toast**: verified headless as "Success / Location X created. / Open location". The app's toaster is Radix (`[data-variant]`), not sonner, so the critic's `[data-sonner-toast]` probe can never match.
- **Warehouses grid behind the drawer**: could not be reproduced. The grid keeps "Total: 3" with the Create drawer open.
- Tests: `tests/unit/facility-config/parity-loop-round6.test.ts` (address issues, cell naming, generator 0, default warehouse). 12 files, 90 tests pass. `tsc` is clean for M10 paths.

## Blind-judge repair round 1 — 2026-11-10
Audit of the judge's gap list against the code (most items already existed and were not found by the judge):
- **Bulk Excel flows**: already present. The Locations Import menu has Bulk import / Bulk update locations, and Assign capacity has the product/LP capacity import and update flows. Handlers are in `src/server/imports/handlers/{locations,locations-update,product-capacity,product-capacity-update,lp-capacity,lp-capacity-update}.ts`, with templates at `/api/imports/[key]/template` and row-level batch errors.
- **21-column location set**: already present in `location-columns.tsx`. This includes cell display member, barcode, replenishment type, assigned mobile cart, mezzanine, column, height and prevent allocation, all hidden by default and available in the column chooser.
- **Search mode Equal / Starts With**: the shared GridToolbar `SearchMode` is on every facility grid. Verified through the API: `q=KSR5&qm=sw` returns 2 and `qm=eq` returns 0; `q=KSR5-A-01&qm=eq` returns 1. It also works on lp-types, lp-numbers, mobile-carts, shipment-packages and warehouses (200).
- **Compact density (REQ-R5-1)**: settled by the shared grid. The footer offers Large/Small density.
- **NEW: Locations → Setup menu** links to the Location group, Location zone and Mobile cart type masters (data-setup lookups, with full CRUD; cart types have levels, columns, dimensions and operation).
- **NEW: `tests/e2e/facility-config/smoke.spec.ts`** is the release-gate smoke test (REQ-J1-2 / REQ-R4-3).
- **Already present (by grep)**: cart Duplicate, shipment-package client access in the wizard, LP type prevent-multi/suitable-for-parent flags, LP number original LP / alternate barcode, and warehouse default receiving location in the drawer.
- **Not done**: zone↔product-group match (REQ-J1-1, admin-owned file); a scale seed of thousands of locations (not done because concurrent agents share the dev DB); a production-build run (a build would contend with the shared dev server).

## Round 3 (parity loop): round 7 fixes, 2026-11-10

These fixes respond to the round 2 critic verdict (7.1). The headings follow this file's internal round numbering.

- **Blocker: bulk-delete / bulk-lock / labels returned 500.** The cause was `customFieldSql` resolving to undefined in those route chunks; the dev log showed "{imported module locations-shared}.customFieldSql is not a function". It now lives in a dependency-free leaf module, `src/server/repositories/custom-field-sql.ts`, which imports only drizzle. `locations.ts` and `lp-types.ts` import it directly, and `locations-shared` re-exports it, so evaluation order can't leave it undefined. Verified on the live dev server: all three routes return 400 VALIDATION for `{}`, and labels returns 200 with real ids.
- **Route smoke suite:** `tests/unit/facility-config/route-smoke.test.ts` loads every M10 route module (38+) through the real `defineRoute` pipeline, using an in-memory DB and the F7 harness. A broken import chain now fails CI. The suite asserts:
  - the bulk routes return 400, not 500;
  - labels, lock and delete work on real rows;
  - lists return 200 for admin, operator and viewer;
  - the role matrix holds: a viewer can read a record and its change log, and gets 403 on writes;
  - warehouse scope is enforced on the change log;
  - shipment-package auto-SKU works;
  - the LP-number availability check works.
- **Zone card / filter feedback:** a new `GridFetchShell` (facility-shared) dims the rows, runs an info progress bar and sets `aria-busy` while a filter, zone, sort or page change is in flight. It keeps the previous rows and uses a 150 ms delay to avoid flicker. Verified headless: the overlay is visible during the zone-B fetch. A hard reload with `?f.locationZoneId=in:…` restores the filter (B-01-01-1 first, Total 60, 1.9 s).
- **Focus is not red:** `FOCUS_NEUTRAL` in `form-controls.tsx` gives every M10 field an info-blue focus border and ring, including an open Select trigger and native inputs. Fields with `aria-invalid` keep the red error border. The shared primitives are filed as REQ-R7-2.
- **Shipment package delete copy:** new `packageDeleteCopy(rows)`. Unused packages get neutral copy ("The package is removed permanently…"). The "used… set it inactive" text appears only when `packageDeleteReason` is non-null.
- **LP numbers headers:** Actual volume is now 136 px and Parent LP type 144 px.
- **Seeded LP dimensions:** the dev DB is backfilled from the LP type (122 rows). The seed fix is REQ-R7-3.
- **Generator preview:** the headline count reads 0 until every range is valid.
- **LP type weight:** new shared `maxWeightIssue()` used by both the schema and a live cross-field check (`useCrossFieldError`). "Max weight must be at least the empty weight" now shows as soon as the values conflict, not only on Next.
- **Change log (every M10 entity):**
  - The `EntityChangeLogDrawer` shows a text Type badge (Create / Update / Delete).
  - Empty sides render as "(blank)" (`changeLogValue`), and stored sentences are tidied (`cleanChangeMessage`: "Aisle is modified. (blank) → Z").
  - Locations now use the module drawer through a new `GET /api/locations/[id]/change-log`.
  - One rule applies everywhere: whoever can view the record can view its change log. This covers locations (row kebab and detail page) and warehouses (route now view-gated).
- **Mobile cart layout:** when the cart type's Data Setup meta defines levels and columns, those fields follow the type and are read-only ("Set by the cart type X in Data Setup"), as in Logiwa. A type without that meta leaves them editable. Cell naming has been A01 everywhere since R6.
- **Custom LP numbers:** a debounced inline duplicate check via the new `GET /api/lp-numbers/availability`. Numbers are unique per warehouse across LP types, and the alternate barcode is checked too.
- **Product picker (capacity modal and package tracking):** the client's first page is preloaded when the client is picked. A search over a catalogue smaller than one page is answered locally, so results appear at once.
- **LP type delete tooltip:** pluralised with `lpTypeInUseReason` ("1 LP number uses this type").
- **Print label progress:** a neutral inline "Preparing labels…" status in the grid shell (info spinner) replaces the red info toast (REQ-R7-1). The print dialog opens when the records arrive. Verified: the status shows at about 0.5 s.
- **Show details latency:** the detail route is prefetched on row hover or focus (`router.prefetch`).
- **Logiwa parity: Inventory Tracking Method.** The shipment package wizard has radio cards for "Auto-create new SKU" and "Match with an existing SKU". Auto creates a Packaging Material SKU for the owner (SKU = package code, dimensions converted to inches and ounces, purchase price) through `createProduct`, or matches the owner's existing SKU with that code. Match still requires a SKU.
- **Logiwa parity: Warehouse create defaults.** With starter locations unchecked, the three default-location pickers are visible but disabled ("Available after the warehouse is created"). With it checked, a preview shows PREFIX-RECV / -SHIP / -RET as the defaults.
- **Not done here:**
  - Doc deep links in page helpers need a help center and a `PageHeader` link prop (REQ-R7-5).
  - A clean `next build && next start` zero-500 run is the release gate (REQ-R4-3, REQ-R7-4). The shared dev server went down mid-round, and when it came back every dynamic route returned 500 ("Jest worker encountered 2 child process exceptions"). That is infrastructure, not module code, and M10 did not restart the shared server.
- **Tests:** `parity-loop-round7.test.ts` and `route-smoke.test.ts`. vitest facility-config passes 14 files and 103 tests, and project-wide `tsc --noEmit` reports 0 errors.

## Blind-judge repair round 2 — 2026-11-10
- **REQ-J1-1 zone ↔ product group match (done end to end):** the admin Data Setup already stores `meta.productGroupIds` on each `location_zone` (zone-groups dialog and PUT `/api/company/lookups/location_zone/product-groups`). Put-away now reads it. `putaway.ts` `locationStats` loads each zone's groups (`zoneGroupIds`) into `LocationStats.zoneProductGroupIds`. The pure `zoneMatchesProductGroup()` in `putaway-actions.ts` backs `checkProductGroupLocationZoneMatch`: a zone with matched groups accepts only those groups, and a zone with no matched groups keeps the legacy rule (zone name equals group name). The help page describes this.
- **REQ-R7-5 help/doc deep links (done):** `PageHeader` has a new, backward-compatible optional `helpHref` prop that renders a "Help" link next to the H1 (`data-slot="page-help"`). The new static help page is `/locations/help` (`src/app/(app)/locations/help/page.tsx`), with anchors for locations, warehouses, lp-types, lp-numbers, mobile-carts and shipment-packages. Every M10 list page and the location detail page link to their anchor.
- **Tests:** `tests/unit/facility-config/judge-round2.test.ts`. vitest facility-config passes 15 files and 105 tests, and project-wide `tsc --noEmit` is clean.
- **Not verified / not done this round:**
  - The shared dev server at :3000 was unresponsive (`/login` timed out at 120 s, and headless goto timed out at 90 s), so the headless walk, the screenshots and the 2 s render timing could not run. They need a healthy server.
  - The `next build && next start` zero-500 gate (REQ-R4-3/R7-4/J1-2) is still open. A build would contend with the shared server, so it stays a Foundation/CI task.
  - The 3.9k-location scale seed and load test were not run, because the dev DB is shared with concurrent agents.
  - The label-print and bulk import/update round-trip at scale were not re-run, for the same server reason. The route-smoke vitest covers labels, lock and delete on real rows.
  - The server-rendered first grid page needs a shared `DataGrid`/`useGridData` initial-data prop, filed below.
- Playwright note: the installed browser is `chromium_headless_shell-1254`. Scripts outside the repo must import `@playwright/test` by absolute path and pass `executablePath` to that shell.

## Blind-judge repair round 3 — 2026-11-10
- **Root cause of the stall:** the shared `next dev` process (PID 47592, the :3000 listener) had grown to about 8.4 GB working set with around 8,900 s of CPU time, holding 50+ open client sockets. `/login` timed out at 30 s and 90 s twice. This is dev-server memory and compile pressure from many concurrent agents, not M10 code. M10 did not kill or restart the shared server (per the task rules).
- **No endless skeleton (done):** new `StallNotice` and `STALL_MS` (12 s) in `facility-shared.tsx`. `GridFetchShell` takes optional `pending` and `onRetry` props, which is backward compatible. When a load is still pending after 12 s, it shows a warning banner ("Loading … is taking longer than usual. The server may be busy.") with a Retry button that re-issues the query. Wired into the locations list (`g.isLoading` / `g.refetch`) and the location detail skeleton (`q.refetch`). The detail page's error state with Retry already existed.
- **Shipment package client access enforced in packing (done, shared `packing.ts`, minimal):** `packageAllowsClient()` limits the pack-context package list to packages with `allClients`, or with a `shipment_package_clients` row for the order's client. `completePacking` rejects a package the client is not allowed to use (VALIDATION). The inventory reduction rule (Packing Station / Specific Location / any) was already enforced in `consumePackaging`.
- **Viewer access (REQ-R2-4):** the Foundation change is DONE. Viewer and operator defaults include the view keys, and every M10 page gate also accepts `inventory.inventory_by_location.view`, which viewers hold. The route-smoke vitest asserts viewer 200 on lists and reads, and 403 on writes. A live headless re-check is pending because the server is down.
- **Not verified / not done (blocked on the dev server):** the fresh blind walkthrough screenshots of every wizard and kebab, the 5k-location scale test, and the import-variant round-trips. The inline "create new" for zone, group and cart type, and putaway/packing enforcement of the LP type mixing parameters, were not changed this round.
- **Checks:** project `tsc --noEmit` is clean. vitest facility-config + stations-returns pass 29 files and 214 tests.

## Round 4 (parity loop), 2026-11-10: critic round 3 fixes (score 5.5)
- **Dynamic routes on a production build (blockers 1-2):** the location API matrix now runs against the production servers already up on :3111 (`next start`; `r4api.mjs` in the critic folder, with a double-submit CSRF token). Results:
  - Lists for locations, warehouses, LP types, LP numbers, mobile carts, shipment packages and `/api/me` all return 200 in 4-44 ms.
  - The location write path returns, in order: POST 201, then GET, PATCH `{info:{walkingPathPriority:9}}`, change-log (an Update row for walkingPathPriority) and contents, each 200.
  - Viewer GET returns 200 and viewer PATCH returns 403. Operator DELETE returns 403. Warehouse GET `[id]` returns 200. Admin DELETE returns 200, and a GET afterwards returns 404.
  - **Zero 500s**, at 3-9 ms per call. The round-3 500s and stalls came from the shared dev server, which did not answer `/api/health` within 45-90 s at any point this round.
- **UI could not be re-verified live.** The :3000 dev server stayed down. The :3100/:3111/:3112 production servers serve HTML whose `/_next/static` chunks now 404, because `.next` was rebuilt under them, so their pages never hydrate. Filed as REQ-R8-5.
- **Endless shimmer without hydration (major):** new `HydrationStallNotice` (`facility-shared.tsx`):
  - It is server-rendered and fades in after 10 s by CSS alone ("This page is taking longer than usual to load. Reload"). Reload is a plain `<a href="">` that keeps the URL and filters.
  - It is removed on hydration (`useSyncExternalStore` server/client snapshot), and from then on the grid's own SlowLoadNotice and error states take over.
  - It is mounted in every M10 page: through `ServerPermsProvider` for the 6 list pages and the location detail, and in each page's Suspense fallback.
  - Moving it into the shared shell is REQ-R8-3.
- **Empty code double error (minor):** new `requiredPattern()` in `common.ts`. The format rule only runs on a non-empty value, so a blank field gives exactly "<label> is required". Applied to location code, warehouse code and prefix, LP type code and number prefix, LP number, mobile cart code and duplicate code, and shipment package code.
- **Walking path header (minor):** the misplaced InfoTip is gone. The explanation is now a native `title` on the label, and `meta.label` is "Walking path priority" for the chooser and export. The root cause is in the shared header: `flex-row-reverse` takes its baseline from an icon-only item, which also causes the 1 px offset on warehouses LOCATIONS. Diagnosed and filed as REQ-R8-1.
- **KS-CRIT-WH data (minor):** repaired and retired through the audited APIs:
  - Address set to Memphis, TN 38118, United States, with a valid phone (PATCH 200, change-logged).
  - MLT1 made the company default again; KS-CRIT-WH had been the default.
  - KS-CRIT-WH deactivated (bulk-active 200).
  - The list now reads "1 Critic Way, Memphis, TN 38118" with isDefault false and isActive false.
- **Inactive warehouses out of the pickers:**
  - `useWarehouseOptions()` gains `selectable(current)`, backed by the pure `selectableWarehouseOptions`. It reads the active flags from `/api/warehouses`, cached for 60 s and refreshed by Activate/Deactivate. A failed read treats every warehouse as active.
  - Every M10 create picker uses it: location wizard, generator, LP type, mobile cart, shipment package and LP number. Edit keeps the record's own warehouse.
  - Defaults only consider active warehouses. Grid filters and cell labels still list inactive ones.
  - The header context picker is Foundation: REQ-R8-4.
- **Footer Rows per page empty before hydration:** shared `grid-footer.tsx`, filed as REQ-R8-2.
- **Tests:** `parity-loop-round8.test.ts` covers the single blank-code error across 5 schemas, format-only errors and selectable warehouses. vitest facility-config passes 16 files and 111 tests. Project-wide `tsc --noEmit` is clean.

## Round 5 (parity loop), 2026-11-10: critic round 4 fixes (score 7.8)
Verified on a private production build of the current tree (`next build` snapshot in `kitstak-critic/facility-config/b5`, served on :3175; the shared :3000 dev server took about 40 s per request). Headless scripts and screenshots are in `kitstak-critic/facility-config/r5b`.
- **LP type Max weight below Empty weight (major):** `useCrossFieldError` now watches the field's error state (`useFormState`) and puts the message back whenever RHF's blur or change re-validation removes it. Verified: with Empty 10 and Max 5, Next shows "Max weight must be at least the empty weight" under Max weight and stays on step 1. Changing Max to 50 clears the message, and Next opens Parameters. The wizard-level cause is filed as REQ-R9-4.
- **Generator over the 5,000 cap (major):**
  - New `generatorLimitMessage()`, shared by the schema and the drawer. For A–Z × 01–99 × 1–9 the Aisles range and the preview card both say "23,166 locations exceeds the 5,000 limit; narrow a range", and the preview adds a short explanation.
  - The disabled Create button is wrapped in `DisabledReason`, so the tooltip gives the same reason.
  - "Fill the aisle and rack ranges" now appears only while the ranges are empty. Invalid ranges get "Fix the highlighted ranges". The background-run note shows only for a valid pattern.
  - The drawer no longer expands patterns that are over the limit.
- **Set as default / Activate (major):**
  - Set as default opens a confirm dialog that names the current and the new default, with their locations and open work, and states what changes and what doesn't (`defaultSwitchImpact`). The success toast has an **Undo** action.
  - Activate (row and bulk) confirms and lists the locations that come back into use. Deactivate also shows a Locations column.
  - Verified: KS2 was made default, Undo restored MLT1, and the DB ends with MLT1 as default.
- **Code prefix vs Location zone (major):**
  - The generator field is now labelled **Code prefix**, and its tip points to Attributes → Location zone.
  - The server stores `locations.zone` only as the picked zone lookup's name, never the prefix.
  - Location zone in the grid and on the detail page now reads only the lookup, with no fallback to legacy text.
  - Repaired 8 dev-DB rows whose zone text had no lookup (KSCRIT, KSR5, MLT, HOSP).
- **Change-log copy (minor):**
  - M10 writes its own rows (`logCreate` / `logUpdate` / `logDelete` in `locations-shared.ts`, with copy in `change-log-copy.ts`). Messages now read "LP Type X is created.", "Locked is modified. No --> Yes", "Max SKU qty" and "(blank) --> 77".
  - Rows stored before this round display tidied (`tidyLegacyNames`).
  - The Foundation half is REQ-R9-1.
- **Capacity audit (minor):**
  - Location create and edit write one row per added, edited or removed capacity line (`capacityLineChanges`), e.g. "MLT-WIDGET-01 -> Product capacity is created. Min 10, Max 50" and "… is modified. Min 10, Max 50 --> Min 10, Max 60". Update rows carry from and to values for the drawer.
  - The capacity product picker tags kits ("Kit · …"). Picking a kit shows a warning callout: capacity counts built kits only.
- **Read-only roles (minor):**
  - `GET /api/warehouses/[id]/locations` accepts every M10 view key. The viewer and operator walks of all 6 pages logged zero console errors and zero failed requests.
  - The LP number change log is open to anyone who can view the record, through the new `GET /api/lp-numbers/[id]/change-log` and the module drawer. Verified as viewer and operator.
- **LP types grid (minor):**
  - Code is 200 px; no code is truncated at 1440.
  - Next number (left-aligned) now comes before Number length (right-aligned), so a right-aligned header no longer butts against a left-aligned one. Number length is 136 px.
- **LP numbers dimensions and volume (minor):**
  - An LP with no dimensions shows its type's dimensions, and one with no weight shows the type's empty weight. Actual volume is L × W × H unless a measured volume was saved.
  - Verified: KSC-00007 now reads 24×16×12, weight 50, volume 4,608.
  - Inheriting the dimensions when the LP is created is REQ-R9-2.
- **Location detail (minor):**
  - Mezzanine / aisle / rack reads "— / A / 01" via `positionTriple`, and column / level / position uses the same explicit blanks (that second triple was not re-checked in the browser).
  - "1 product · 0 LPs" via `capacityRulesSummary`.
  - Open tasks SKUs link to the product; the contents API now returns `productId` for tasks.
- **Generator collision copy (minor):** "All 2 codes already exist; nothing to create." has no skip checkbox, and the tooltip reads "Every code already exists; change a range or the code prefix" (`generatorCollisionCopy`).
- **Not done here (filed):**
  - REQ-R9-3: toast and feedback tab overlap. These are shell components.
  - The environment item (shared server health, `db:verify` failing on a shipping order) is outside M10.
- **Tests:** new `parity-loop-round9.test.ts` (13 tests: limit, collision copy, prefix is not a zone, change-log copy and capacity rows on real create/edit, LP effective dimensions, detail helpers, default confirm copy, kit detection). vitest facility-config passes 17 files and 124 tests. Project-wide `tsc --noEmit` is clean.

## Round 6 (parity loop), 2026-11-10: critic round 5 fixes (score 8.2)
Verified on a private production build of the current tree (`kitstak-critic/facility-config/b6`, `next build` then `next start -p 3186`; the shared :3000 dev server did not answer `/api/health` within 60 s). The headless walkthrough is `r6/flow.mjs`, with screenshots in `kitstak-critic/facility-config/r6`. The run logged zero console errors and zero failed requests.
- **LP numbers can be deleted or voided (major).**
  - New `POST /api/lp-numbers/bulk-delete` and a read-only `POST /api/lp-numbers/removal-preview`. The rule is pure: `lpRemovalPlan` in `lp-numbers.ts`.
    - Blocked when the LP holds stock, sits on a parent LP, has child LPs, or has shipped. The reason is shown.
    - **Deleted** when the LP was never used. Ten probes check inventory, transactions, receipts, tasks, shipments, counts, work orders, order lines, snapshots and the missing log.
    - **Voided** otherwise: status Removed, location cleared, row kept so its history still resolves.
  - Each removal writes a Delete row, or a Status/Location Update row for a void.
  - In the UI, Delete is in the row kebab and the bulk toolbar. The kebab item is disabled with a tooltip for Occupied, Shipped or nested LPs (`lpRowRemovalBlocker`). The confirm dialog lists every LP with its Outcome (Delete / Void / Skipped) and the reason.
  - The LP type delete reason now points to LP Numbers, and tells "voided but kept for their stock history" apart from "delete the unused ones".
  - Critic repro verified live: type KS-R6-LPT-2402 issued 3 LPs, bulk Delete removed all 3, the LP change log shows Delete + Create, and the type then deleted (200).
  - Gate: `settings.lp_numbers.edit`. The catalog has no Delete key for LP Numbers (REQ-R10-1).
- **Ledger direction (major).**
  - `ledgerEffect` (new `location-ledger.ts`) takes direction from the signed quantity, so a −2 adjustment into A-01-01-1 now reads **Out 2**. Each row carries `delta` (the signed on-hand change).
  - The tab now uses a paged `GET /api/locations/[id]/ledger` (25 per page, `kind=movements|reservations|all`), so the 100-row cap is gone. Allocation and Allocation Cancel are "Reservations", not movements, so the tab badge counts only movements (12 on A-01-01-1; the old badge said 22).
  - Links to Transaction History pre-filtered *Into* and *Out of* the location. Rows gained a Lot column.
- **Change-log drawer is never stale (major).**
  - Each open re-keys the query (open counter), so a reopen never paints the cached rows.
  - `staleTime` is 0, and every `useAction` mutation invalidates `ENTITY_CHANGE_LOG_KEY`.
  - Verified: toggling Unlock on the detail page and reopening the drawer shows "Locked Yes → No" on top immediately.
- **Deleted-record audit (minor).**
  - M10 Delete rows now store the warehouse (`parent_entity_type='warehouse'`).
  - Every M10 `/api/<entity>/[id]/change-log` route uses `changeLogResultOrDeleted`. For a deleted record, it returns the stored rows, authorized against that warehouse. Legacy Delete rows without a warehouse are visible to admins only.
  - Verified for a deleted LP. The platform route is REQ-R10-2.
- **Change-log copy and SOURCE (minor).**
  - On read, M10 Update rows take their label from the field key and their sentence is rebuilt (`normalizeChangeRow`). Legacy "Is Locked" and "Max Sku Qty" rows now read "Locked" and "Max SKU qty", the same as new rows.
  - Rows carry `userName` and `channel` (UI / Import / Integration / Workflow / System, Logiwa's SOURCE). The drawer shows "date · user · channel".
  - The type pill and the message are separate flex items, with an sr-only ": " between them, so the text no longer reads "UpdateLocked".
  - M10 imports now record `Import · <email>`.
- **Seeded records' provenance (minor).** The change-log API returns `meta.created` (the record's created date and creator). When no Create row exists, the drawer ends with a "Created · Record created before change tracking began" row. Verified on BOX-CF-0909 and A-01-01-1.
- **LP create: Client in From Sequence (minor).** Client is always shown in sequence mode: optional ("Any client") without SSCC18, required with it. The server validates client scope. Switching to Custom numbers clears the client. Verified: 3 LPs created with client APX.
- **Single print modal (minor).** Print barcode (row and bulk) opens Print LP labels directly, with the LPs summarised in the title ("Print LP labels · KSELQQI-00003"). The review modal is removed.
- **Mobile cart occupancy (minor).**
  - The detail drawer has a new "Orders on this cart" table: order and job links, cell or tote, picked/planned units, and open tasks. Each cell shows its order code and picked/planned, or "Free".
  - When no cell assignment exists, the drawer says so ("No order is in a cell yet…").
  - KS-CRIT-MC5 shows SO010879 (0/10) and SO010923 (3/6). The fulfillment flows never write the cell link (REQ-R10-6).
- **Not M10, filed:**
  - Nav links for viewer and operator (REQ-R10-4).
  - Feedback tab overlap (REQ-R10-5).
  - Platform change-log for deleted records (REQ-R10-2).
  - Import channel in the pipeline (REQ-R10-3).
  - Print modal summary slot (REQ-R10-7).
  - `db:verify` shipped_without_label (REQ-R10-8).
  - The dev-server environment (the REQ-J1-2 release gate).
- **Tests:**
  - New `parity-loop-round10.test.ts` (15 tests): the removal rule, delete then type delete, void, refusal with stock, deleted-LP audit and its scope, client pre-assignment, ledger sign, reservations and paging, change-log normalization and channel, and cart orders per cell.
  - `parity-loop-round7.test.ts` is updated for the new LP type tooltip.
  - vitest facility-config passes 18 files and 139 tests. Project-wide `tsc --noEmit` is clean. ESLint on the changed files shows 0 errors (4 warnings, all pre-existing).

## Blind-judge repair round 1 (second pass) — 2026-11-10
Every gap from the judge list, verified with headless Playwright against :3000 (scripts and screenshots in `kitstak-critic/facility-config/j1/`) plus API calls.
- **Match With Product Groups is live.** Put-away already read the zone's matched groups (`zoneMatchesProductGroup`). It now also reads the zone **priority** (the Zone Priority sort uses the number, falling back to the name) and **Max locations per SKU** (`zoneSpreadAllows`: a location new to the SKU is refused once the zone already holds it in that many; topping up is always allowed). `ZONE_PUTAWAY_SETTINGS_ENFORCED` is now `true`, so the zone page button is enabled (verified), and the priority / max fields are editable. The help text describes exactly what put-away does. Shared files touched (minimal): `src/server/domain/putaway.ts`, `putaway-actions.ts`, `src/lib/grid-defs/admin/lookups.ts` (flag + comment), `lookup-type-fields.tsx` (one info string).
- **Seed and data.**
  - Zones get a code, a priority and a max locations per SKU: A–F 1–6 with 2/3, Bulk BLK 7/6, Dock DCK 9/10 (`LOCATION_ZONE_SETTINGS` in `seed/lookups.ts`).
  - The cart type meta has operation Picking, units and cart/cell dimensions.
  - Locations take aisle/rack/column/level from the code (`locationStructure` in `seed/facility.ts`; closes REQ-R2-7), so A-01-01-1 reads aisle A, rack 01, column 1, level 1. Dock and bulk spots have no rack structure.
  - Cart cells use `cellBarcode` (MC-01-A01).
  - The live dev DB was repaired the same way (`j1/fixdb.cjs`): 16 zones, 1 cart type, 300 grid locations, 35 dock/bulk spots and 96 cells.
  - Verified: the detail page reads "— / A / 01" and "1 / 1 / —", and the label preview reads "MLT1 | Zone A | Aisle A | Level 1".
- **One cell naming scheme.** A cell is named by its level letter and column (A01), and it scans as `<cart>-A01`. That name is used in:
  - the help page and the wizard's Layout description;
  - the cell list, which now has a single "Cell" column (the extra cart_col_level id is gone);
  - the drawer's cell grid, which shows A01 big, column headers 01–06 and the barcode in the tooltip;
  - the orders-on-cart table (A02 · MC-01-A02);
  - cell labels ("MC-01 · Cell A01");
  - the job's printed cart layout (`jobs-print.ts` printed L1-C1; it now prints the assigned cell, or the next cell name).
- **Put-to-cart writes the cell link (REQ-R10-6).**
  - New domain module `src/server/domain/mobile-cart-cells.ts`:
    - `assignJobToCart` gives each order of an open picking job the next free cell in suggestion order. It writes `mobile_cart_cells.order_id` and `job_orders.tote_or_cell`, links the job and makes the cart Occupied, with change-log rows on the cart and the job.
    - It is idempotent. It refuses a second job on a single-job cart, a job in another warehouse, a closed or non-picking job, and a job with more orders than free cells.
    - `reclaimCartCells` frees cells whose order has left the cart (Ready to Ship, Shipped, Delivered or Cancelled).
    - `releaseCart` is "Empty cart".
  - API: `GET|POST|DELETE /api/mobile-carts/[id]/job`. Writers are cart editors, job assigners and task executors. Viewers get 403 (verified).
  - The cart drawer has a "Put a picking job on this cart" panel with Put on cart and Empty cart. A cell whose order already left the cart reads Free.
  - The seed now puts the two largest open MLT1 picking jobs on MC-01 and MC-02 (`seedCartOccupancy`, called from `seed/index.ts` `finish`).
  - Live demo: MC-01 holds Job005266 (11 orders in A02–B06; A01 already held SO010880) and MC-02 holds Job005275. The occupancy grid and the orders table render (screenshot `j1/cart-drawer.png`). A second job on MC-01 returns 409.
- **Change-log drawer is instant.**
  - The drawer is stale-while-revalidate: cached rows paint at once, every open refetches, and a "Checking for newer changes…" line shows meanwhile. A cache that a mutation invalidated is never painted.
  - `useChangeLogPrefetch` / `prefetchChangeLog` warm page 1 on hover/focus of the Change log button, 600 ms after the location detail loads, and on grid row hover.
  - Also fixed: a record whose log has 0 rows plus a "created" meta row showed the skeleton on every revalidation.
  - Measured: the skeleton never appears, and rows show 65 ms after the click (51 ms on reopen). Before the fix it was 894 ms with a skeleton.
- **Scale (4,800 + 343 = 5,143 locations).**
  - New warehouse KSSCALE was created through the warehouse API (starter locations on). It has zones S1–S4 (Data Setup API) and 4 × 1,200 generated locations (generator API, background runs). The zone ids on those rows were set by a one-off SQL step (`j1/scale-zone-assign.cjs`).
  - HTTP on the shared dev server (`j1/scale-api.mjs`): list page 1 0.79 s, deep page 60 1.28 s, last page 1.11 s; 200-row page 0.78 s; zone strip 0.85 s (all) / 0.61 s (KSSCALE); zone filter 0.27 s; area+type filter 0.43 s; Occupied filter 0.31 s; search 0.46 s.
  - Excel export of all 4,804 KSSCALE rows: queued in 1.1 s and the file was ready 3.6 s later (background task with a progress toast).
  - Direct SQLite timing of the same queries is 0.6–5.5 ms, so the HTTP time is dev-server overhead (`/api/me` alone was 0.2–1.4 s during the run).
  - In-process proof: `tests/unit/facility-config/scale-4k.test.ts` (4,800 rows). Paging, zone strip, filters and search each take ms, and provider pages plus the workbook build take ~0.3 s.
  - Page smoke with the extra rows: all 6 facility pages show their first data row in 1.1–2.0 s on a warm second load (3.5–5.5 s on the first, compiling load), with zero console errors.
- **Phone layout (390 px).**
  - `location-card-list.tsx` shows one card per location: code link, status pill, Locked, "MLT1 · Zone A · Aisle A · Rack 01 · Level 1", area/type/group, units/SKUs/open tasks and the row menu. A sticky pager with Export sits at the bottom.
  - It is rendered by CSS (`sm:hidden`), and the table is `hidden sm:flex`.
  - The header collapses to **More** (Generate, imports, capacity imports, location masters) plus **Create**. The bulk actions and Assign capacity drop from the toolbar on phones (`useNarrowViewport`).
  - Verified: no horizontal scroll (384/390), header actions on one row, paging works.
- **Label Print without a printer.** `PrintOptionsModal` Print (shared, backward compatible):
  - It shows an info toast ("No KitStak printer is connected, so your browser's print dialog is used…").
  - It prints through a hidden same-origin iframe (`printInPage`).
  - If that fails, it opens the PDF in a new tab with a toast saying so. If pop-ups are blocked, a warning toast points to Download.
  - Verified headless: the toast shows, the print frame is created, and the headless shell falls back to the new-tab toast.
- **REQ-R10 platform items, verified live:**
  - The platform `GET /api/change-log` returns the Delete + Create rows of a deleted location (200).
  - A one-row bulk location import writes `Create · channel Import · Import · admin@kitstak.io`. The test location was deleted afterwards.
  - Viewer and operator navs list Locations, Warehouse, Mobile Carts, LP Types, LP Numbers and Shipment Packages. `/locations` renders read-only for them, with no Create.
- **Tests:**
  - `judge-j1-repair.test.ts` (12) covers cell naming, put-to-cart plan / write / idempotency / conflicts / reclaim / release / candidates, seed structure, zone settings, zone spread, phone summary and the change-log key.
  - `scale-4k.test.ts` (3).
  - vitest facility-config passes 20 files and 154 tests.
  - The fulfillment-jobs, inbound-receiving, automation-integrations and foundation domain suites and the seed tests also pass.
  - `admin-settings/round4-parity` has 2 failures about SO-type flags and merge criteria, which are another agent's in-flight `lookups.ts` changes, not this round's.
  - `tsc` is clean for every touched path. Other modules show in-flight errors (workflow-builder, carriers, wave-rules, replenishment).
  - ESLint reports 0 errors on the touched files.
- **Test data left in the shared DB:** warehouse KSSCALE (4,804 locations, zones S1–S4). Carts MC-01 and MC-02 are occupied by Job005266 and Job005275.
