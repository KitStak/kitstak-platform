# M13 reports-analytics — progress

## Session 1 (2026-11-06)
- Started from placeholders: all report/analytics routes were `ModulePlaceholder`; dashboard + hub were static.
- Approach: one shared report shell (`src/components/reports/report-grid-page.tsx`) driven by pure grid defs in
  `src/lib/grid-defs/reports/*.ts`; server SQL per report in `src/server/repositories/reports-*.ts` compiled by
  `reports-grid.ts` (grid grammar → wrapped inner SELECT, same pattern as M06).

### Done (session 1)
- Report shell: `src/lib/grid-defs/reports/{types,orders,inventory,logs,receiving,catalog}.ts`, `src/components/reports/{report-grid-page,report-cells,report-pages,reports-hub}.tsx`.
- Server: `reports-{grid,api,export,orders,inventory,logs,receiving}.ts`; 14 list APIs under `/api/reports/**`; 12 export providers wired (`src/server/exports/providers/report-*.ts`).
- All 14 report routes live (no placeholders): Channel Sales (warehouse populated, order-count drilldown), Serial x3 tabs, Order Inventory,
  Dynamic Replenishment (formula + Show only active), Inventory Snapshot (default chip Within 1 day past), Change Log (human labels,
  ids resolved to names, deep links, warehouse + client scoped), Transaction History (50 cols, 18 types), Serial Txn History, Missing Log,
  Excel Export History (pills, Download link + row menu), PO Receiving (diff pills, Has Difference), User Performance (Period chip, W x U x day).
- Report Hub from nav-config Reports menu: permission filter, search, favorites (stored in grid prefs key `report-hub` `pinned`), real recent exports.
- Dashboard: `dashboard-live.ts` + `/api/dashboard?wh=&cl=`; counts use the Orders grid predicate (`viewCondition` + `compileOrderGrid`), so every
  drilldown opens exactly the counted orders (verified live: 21/21 metrics equal `/api/orders` totals). Shift clock (single warehouse) / "Select just one
  warehouse" message, donut with legend toggles, ranks top 5 + Others, Jobs Priority/Status/Type tabs, 60 s auto refresh + Updated stamp.
- Analytics: `analytics-{types,common,labor,operational}.ts`, `/api/analytics/{labor,operational}/[page]`, 9 pages with date range/presets/warehouse filter,
  KPI tiles, recharts cards, data table toggle (+ sr-only table), CSV/XLSX export per chart, drilldowns, activation card when the app is inactive, 403 state.
- Tests: `tests/unit/reports-analytics/*.test.ts` 25/25. tc-queue 0 errors on all M13 paths.
- Verified headless (built-in browser pane at tab cap): default chips, change-log export completed (5,460 rows xlsx downloads), deep links, hub favorites
  persist, dashboard filter + Ready to Ship drilldown, analytics table toggle + CSV + presets; no console errors.

### Pending outside M13 (request file write was blocked by the harness; listed in the agent result)
- REQ-1 register grid keys `report-serial-shipments` / `report-serial-receipts` (export on those 2 tabs until then fails).
- REQ-2 nav: hide analytics items when app inactive (`/api/me` activeApps + nav-access filter).
- REQ-3 M14 Apps page toggles for the gate e2e.

### Decisions
- Task time for labor analytics = start→finish when recorded, else gap since the associate's previous task that day (cap 30 min, floor 15 s): seed tasks have start == finish.
- Counts excluded from productivity units/hour (counted qty is not throughput).
- `src/server/repositories/{dashboard,reports}.ts` kept as legacy shims because `scripts/verify-data.ts` imports them.
