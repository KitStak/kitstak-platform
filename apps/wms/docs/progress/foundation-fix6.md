# Foundation fix6: critic round 6 (complete)

Most items had already landed in fix5. In this round I re-verified each one in the browser and fixed the gaps listed below.

- [x] 1. ModulePlaceholder section now carries `data-placeholder-module="<owner>"`. The existing `data-placeholder`, `data-module` and `data-route` attributes stay. Copy is "Module in progress" with a "Ships in M13" chip. Verified on /analytics/labor/associate.
- [x] 2. DataGrid: `withDefaultSort()` (exported from data-grid.tsx) gives any column with only an `id` (no accessor) an accessor that reads `row[meta.sortKey ?? id]`. This makes every data column sortable unless it sets `enableSorting: false`. Every /dev/ui grid column has an accessorKey. In the header, sortable columns get `aria-sort` (none/ascending/descending) and an ArrowUpDown icon on hover/focus. Verified: clicking Sales price sets `?sort=salesPrice`, a second click sets `?sort=-salesPrice`, and rows re-sort. Unit test: tests/unit/foundation-fix6/default-sort.test.ts.
  - NOTE for module owners: server-sorted grids with id-only display columns (e.g. custom action columns) now show a sort affordance. Mark them `enableSorting: false` if the API does not accept that sort field.
- [x] 3. Grid Cancel bulk action opens ConfirmDialog (red header, Order/Status mini-table, No/Yes), then shows toast.success "Cancelled · 1 order cancelled (demo)". Verified.
- [x] 4. Overlays "Cancel 2 orders" Yes shows toast.success "Orders cancelled". Verified.
- [x] 5. Expanded row: OrderLinesTable at 12px with 32px rows (SKU/Description/Qty/Allocated/Picked). Outer td is px-4 py-2 and the cells are px-3 only. Verified.
- [x] 6. DatePicker: opens on field click and on Enter, and focus stays in the field. Today/Clear footer works. New in this round:
  - Closing the calendar (Escape, a pick, Today/Clear) returns focus to the text input (onCloseAutoFocus).
  - Typing after an Enter commit is visible: onChange sets editing.
  - Unparseable text stays in the field with aria-invalid instead of vanishing.
- [x] 7. "Search and select", "Unit of measure" and "e.g. UPS Ground" were already in place. This round's sentence-case pass on UI chrome:
  - grid: saved views "Create new", "Open transactions"
  - layout: help center, printers labels, help links
  - shared: create-job, create-tag, upload document, print options, address form, change-log drawer, record summary rail, order picker, entity pickers
  - /dev/ui showcases
  - product detail "Unit of measure"
  - Left as is on purpose: Logiwa-parity operator names ("Starts With", "Export As Excel"), status values, nav-config labels (src/config, not owned), and module column headers in clients/orders/inventory/products/dashboard. Module agents are actively editing those files.
- [x] 8. Global search Records: a small StatusPill comes before the customer/client subtitle. Verified with SO0108.
- [x] 9. Showcase nav active item: 2px #2e5ce6 rail and indigo text. Verified (`::before` is 2px wide in --primary).
- [x] 10. /dev/ui grid section hugs its content: 4-row result, no gap. With the full list the scroller is capped at the viewport.
- [x] 11. Route progress: the bar is in the loading phase at 50ms, at top 56px, 2px, in --primary. At 450ms `data-route-pending` is set and #main-content computes to opacity 0.6.
- [x] 12. Login demo callout shows only when NODE_ENV !== production and DEMO_MODE is set. .env.local has DEMO_MODE=1 and .env.example documents it. Verified the callout renders on /login in dev.
- [x] 13. Shell at 768px: no horizontal overflow; the hamburger drawer opens, Inventory expands, and Total Inventory navigates. At 1280px: no overflow, desktop nav, no hamburger. Viewport reset afterwards.

Verification: full `tsc --noEmit` clean, eslint clean on touched files, vitest foundation-fix5 + foundation-fix6 pass (22 tests).

Browser note: when the Browser pane is hidden, React streaming reveals and CSS transitions do not advance (no rAF). Taking a screenshot forces a frame.
