# Foundation fix4 — critic round 4

- [x] 1 grid prefs PUT 400 (server accepts flat + legacy envelope, client sends flat; contract test)
- [x] 2 grid prefs save toast copy + console detail
- [x] 3 notification deep links (/imports/products — /imports has no index page; /integrations/logs/history; /shipments/end-of-day) + test; live DB patched in place
- [x] 4 KitStak Sandbox (SANDBOX_CARRIER_NAME in brand.ts); live DB patched
- [x] 5 expand column 40/px-1
- [x] 6 actions column 44/center/no ellipsis
- [x] 7 priority column min 104 / nowrap
- [x] 8 order date minSize 172
- [x] 9 scrollbars (no arrow buttons)
- [x] 10 ConfirmDialog type-to-confirm focus
- [x] 11 Drawer initial focus
- [x] 12 /dev/ui delete toast copy
- [x] 13 Wizard focus on step change + revalidate after failed submit
- [x] 14 Wizard stepper spacing
- [x] 15 status label casing single source
- [x] 16 breadcrumbs from nav-config
- [x] 17 global search codes + 10s timeout/retry
- [x] 18 route progress bar
- [x] 19 search trigger tooltip on focus return
- [x] 20 printers header saved value
- [x] 21 contact support dialog
- [x] 22 transactions tray progress/clear/hint
- [x] 23 page header helper centered
- [x] 24 /orders shared toolbar/footer
- [x] 25 login marketing claims

## Notes
- Grid system columns: GridColumnMeta gained `cellPadding`, `clip`, `justify`. `DATE_TIME_COLUMN_WIDTH` (172) and `PRIORITY_COLUMN_WIDTH` (104) are exported from grid cells for module grids.
- `statusLabel()` (lib/status-colors) is the one casing rule; StatusPill/PriorityFlag render through it.
- `/api/orders` speaks the grid grammar when q/qm/f.*/sort/ps are present (`server/repositories/orders-grid.ts`, fields in `lib/grid-defs/orders/shipment-orders.ts`); legacy params still work. listQuerySchema pageSize max raised to 1000.
- /orders uses useGrid + GridToolbar + DataGrid footer (gridKey orders-backlog; the tab travels in the export query). The client-side fake priority/name shims and the dead bulk-action bar were removed; order ops show "Order operations are not configured yet" until M01/M03.
- Route progress: `startRouteProgress(href)` from layout/route-progress before any router.push that should show the bar.
- Tooltips: `suppressNextTooltipFocus(trigger)` in a dialog's onCloseAutoFocus.
- Transactions tray "Clear completed" is per viewer (localStorage `ks:transactions-cleared`); tasks stay in Export History.
- Not foundation-owned, left as is: src/components/inventory/inventory-page.tsx still sets `scrollbar-width: thin` locally (M06), which brings back arrow buttons on that page in Chrome.
- Live DB was patched in place (notification hrefs/bodies, carrier_connections.setup_name). The dev-ui-orders grid prefs for admin now hold density Large from verification.
