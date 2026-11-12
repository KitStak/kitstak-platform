# Foundation F4b — grid + shared components — COMPLETE

Owned: `src/components/grid/**`, `src/components/shared/**`, `tests/unit/foundation-f4b/**`.

## F4.3 src/components/grid
- [x] grid-types.ts: FilterFieldDef, GridColumnMeta (sticky/label/sortKey/headerTip/defaultVisible/alwaysVisible/filter/align/headerClassName), RowAction, BulkAction, GridPrefs, constants. Pure.
- [x] grid-prefs.ts (pure reconcile/defaults/move/pin) and use-grid-prefs.ts (GET/PUT /api/grid-prefs/[gridKey], debounced, provider-independent)
- [x] data-grid.tsx rewrite, split into data-grid-header, data-grid-body, data-grid-columns, grid-footer, selection-banner, legacy-csv. Covers:
  - server multi-sort (shift-click), resize, drag-reorder, pin-left, sticky-right
  - tri-state select, selection kept across pages, "Select all N matching"
  - Large/Small density, page sizes 100–1000, Total/Selected, `|< < [n] / N > >|` pager
  - virtualisation above 200 rows, header `?` tips, kebab via `rowActions`, expandable rows
  - loading, empty and error (Retry) states; Export As Excel
  - all legacy props still work
- [x] grid-toolbar.tsx: GridToolbar + DebouncedSearch. Legacy GridSearch/FilterButton re-exported from legacy-toolbar.tsx.
- [x] search-mode.tsx: Equal / Starts With, applied with Apply
- [x] filter-builder/
  - filter-popover: New/Saved tabs, field search, pinned favourites
  - field-editors: enum + Empty, 6 text ops, Min–Max, Yes/No, date with 18 presets + Custom + X day
  - filter-chips: two-line chips, +N overflow, click to edit
  - date-presets, filter-model
- [x] saved-views.tsx + use-saved-views.ts: Create New / Overwrite, share, set default, delete
- [x] column-chooser.tsx: checkbox list, dnd reorder, pin, Apply/Reset
- [x] bulk-actions.tsx (disabled reason tooltips), row-menu.tsx
- [x] export-button.tsx: POST /api/exports, Transactions toast, invalidates ["background-tasks"], dispatches `ks:transactions-refresh`
- [x] cells.tsx: LinkCell, ExternalFilterLink, DateCell, MoneyCell, QtyCell, YesNoPill, TagsCell, ChannelCell, UserCell, CountdownCell
- [x] use-grid.ts: useGrid (URL state) and useLocalGrid (in-memory, for modals); use-local-grid-state.ts
- [x] tests

## F4.4 src/components/shared
- [x] contracts.ts: zod response schemas for F7 routes (lenient; parseList never throws)
- [x] change-log-drawer
- [x] tag-popover + create-tag-modal
- [x] custom-fields-section + custom-fields-drawer + custom-fields-model (slot limits 3/2/3/2)
- [x] print-options-modal: Preview/Download/Print; print agent `window.kitstakPrintAgent` or window.print fallback
- [x] document-upload-modal + documents-viewer (+ upload-file.ts)
- [x] import-page + import-details-drawer
- [x] address-form (AddressFields inside a parent useZodForm) + address-card + address-model (US/CA postal)
- [x] product-search-add (≥3 chars, live ATP)
- [x] entity-pickers: Warehouse/Client/User/Customer/Vendor/Job, Location/LP (+scan)/LocationOrLp, CarrierService cascade, ShipmentPackage, LookupSelect
- [x] order-picker-drawer, record-picker-modal
- [x] create-job-modal + create-job-model
- [x] record-summary-rail, detail-header, kv-list, notes-panel, activity-timeline
- [x] tests

## Verification
- [x] `npx tsc --noEmit`: 0 errors in grid/shared/tests (remaining errors are in other stages' files, e.g. src/server/db/seed.ts)
- [x] `npx eslint src/components/grid src/components/shared tests/unit/foundation-f4b`: 0 issues
- [x] `npx vitest run tests/unit/foundation-f4b tests/unit/foundation-f4a`: 117/117 pass
- [x] Dev server: /orders, /inventory, /products and /clients render with the new DataGrid. No QueryClient, thead-nesting or hydration errors after the fixes.

## API contracts assumed (F7 must match or adapt)
- `GET /api/grid-prefs/:gridKey` → `{ prefs: GridPrefs | null }`; `PUT { prefs }`. GridPrefs also carries an optional `pinned: string[]`, so keep it rather than stripping it.
- `GET /api/saved-views?gridKey=` → `SavedView[]` (`isOwner?` for shared views)
  - `POST { gridKey, name, query, isShared, isDefault }`
  - `PATCH /:id` (partial)
  - `DELETE /:id`
- `POST /api/exports { gridKey, query, columns? }`; tray list key `["background-tasks"]`.
- `GET /api/change-log?entityType&entityId&page&ps` → entries with an optional `lineLabel` (SKU prefix); `meta.total`.
- Tags:
  - `GET /api/tags?scope=`
  - `POST /api/tags { name, color, scope }`
  - `POST /api/tags/apply { entityType, ids, tagIds, mode: "set"|"add" }`
- Custom fields: `GET /api/custom-fields?entityType=`; `POST { entityType, slot, name, isActive, options }`.
- Files and attachments:
  - `POST /api/files` (multipart `file`, `purpose`, `ownerEntityType`, `ownerEntityId`) → `{ id }`
  - `GET /api/files/:id[?download=1]`
  - `GET/POST /api/attachments`; `DELETE /api/attachments?id=`
- Notes: `GET/POST /api/notes`; `DELETE /api/notes?id=`. Each note has `userName`.
- Imports:
  - `GET /api/imports/:key?page&ps` (history)
  - `POST /api/imports/:key` (multipart `file`)
  - `GET /api/imports/:key/template`
  - `GET /api/imports/batches/:id` → `{ batch, rows }`
- `POST /api/print { typeKey, records, options:{copies} }` → `{ fileId }`. Templates come from `GET /api/printouts?typeKeys=&clientId=` (M14). Until that exists, catalog defaults are used.
- Pickers: `GET /api/pickers/<kind>?q&limit&...` → `[{ id, label, description?, ...extra }]`.
  - products return `{ id, sku, name, imageUrl, atp, uom }`
  - carrier-services return `carrier`, `carrierName`
  - jobs accept `mergeable`, `status`, `operation`
  - `exact=true` is used for scan resolution
  - orders accept the grid grammar plus `clientId`, `warehouseId`, `status`
- Jobs:
  - `POST /api/ops/jobs/eligibility { operation, ids }` → `{ total, eligible[], ineligible[{id, code, reason}], jobTypes[{id, code, name, defaultBatchSize}] }`
  - `POST /api/ops/jobs { operation, mode:"create", ids, jobTypeId, batchSize, assigneeUserId }` or `{ operation, mode:"merge", jobId, ids }` → BulkResult + `jobIds`
- `GET /api/lookups/:type` → `[{ id, name|value|label, isActive? }]`.

## Handoff notes
- DataGrid and useGridPrefs work WITHOUT `<QueryProvider>`, which legacy pages need until the layout stage mounts it. useGrid, useSavedViews and the shared components DO need the provider.
- Pages adopting the grid render `<GridToolbar {...g.toolbarProps}/>` + `<DataGrid {...g.gridProps} columns getRowId/>` inside `<Suspense>` (useSearchParams).
- Column ids: `id` → `accessorKey` (dots become `_`) → string header. Sort field = `meta.sortKey ?? id`.
- Not done (outside f4b scope, F4 layout/shell stage): the route `src/app/(app)/imports/[key]/page.tsx` that renders `<ImportPage>` from the server import registry, plus mounting QueryProvider/Toaster in the layouts.
