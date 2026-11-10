# Foundation F6 — Platform services (progress)

Owned paths: `src/server/{files,exports,imports,print,scheduler,search}/**`, `tests/unit/foundation-f6/**`.

## Checklist
- [x] files: `.data/files/<id>` storage (`KITSTAK_FILES_DIR` override), sha256, magic-byte mime sniffing, per-purpose policies (10 MB uploads; attachments image/PDF; imports xlsx/csv), 7-day expiry for export/print/error files, `deleteExpired`
- [x] exports: types, exceljs writer (styled frozen header, autofilter, auto widths, typed formats), 63 gridKeys in `grid-keys.ts`, per-grid stubs `providers/<gridKey>.ts` (null → generic), `providers.ts` registry, generic provider via injected `ListFetcher` (`createHttpListFetcher` forwards cookie in memory), `queueExport`/`runExport`/`listExportHistory`/`failStaleExports`
- [x] imports: parser (xlsx + RFC4180 CSV, delimiter auto-detect), registry (29 keys = every 0.6 handler), 29 handler stubs, column defs (`columns/`), template generator (Template + Notes sheets, dropdown validation), validation preview, `runImport` (chunked tx, savepoint per row, `import_rows`, error xlsx, batch status), history/details queries
- [x] print: 25-type catalog, bwip-js barcodes (`bwip-js/node`), PdfWriter (wrapping, paginated tables, footers), ZPL helpers (^FH-escaped), templates: packing list/slip, picking list (+consolidated, work-order variants), manifest/BOL, LP/location/product/mobile-cart labels (PDF+ZPL), shipping label output (passthrough PDF/ZPL/PNG + sandbox). `renderPrint`, `printToFile`. Other 12 types → INVALID_STATE "not configured yet".
- [x] scheduler: self-created `scheduler_lease` + `scheduler_task_runs` tables, runner (30 s, unref'd timer, in-process + DB-lease single flight), registry, `snapshot.ts` (00:02 warehouse-local, idempotent), `exports-cleanup.ts`, 4 stub tasks, `verifyCronAuthorization`, `startScheduler` (globalThis guard, disabled under VITEST / SCHEDULER_ENABLED=0), `runSchedulerTick`, `getSchedulerHeartbeat`
- [x] search: types, registry + `globalSearch` (parallel, timeout, failure isolation), Pages provider (structural nav walker), 7 provider stubs
- [x] unit tests (`tests/unit/foundation-f6`, 58 tests)
- [x] tsc + eslint clean on owned paths

## Handoff notes
- `tests/unit/foundation/instrumentation.test.tsx` (F0-owned) still asserts the old stub result
  `{ started:false, reason:"Scheduler not configured yet" }`. With the real scheduler it now returns
  `{ started:false, reason:"Scheduler disabled under test" }` under vitest. F0 owner must update that one assertion.
- Pages provider imports `@/components/layout/nav-config` (`NAV_MENUS`). When F4 lands `src/config/nav-config.ts`,
  switch the import in `src/server/search/pages.ts` (walker already handles `{label, href, permission, aliases}`).
- F7 routes: `POST /api/exports` → `queueExportSchema` + `queueExport`, then `after(() => runExport(db, id, { auth, listFetcher: createHttpListFetcher({ origin, cookie }), columns }))`.
  `POST /api/imports/[key]` → `getImportDefinition`, `previewImport` (dryRun) / `runImport` (`transaction:false`, async).
  `GET /api/imports/[key]/template` → `buildImportTemplate` + `templateFileName`. `POST /api/print` → `printRequestSchema` + `printToFile`.
  `POST /api/cron/tick` → `verifyCronAuthorization(header)` ("not_configured" → 503) then `runSchedulerTick()`. `GET /api/search` → `searchQuerySchema` + `globalSearch`.
- Scheduler starts only on server boot (instrumentation): restart the dev server to activate it. Smoke-tested a tick on a copy of the seeded DB: snapshot of MLT1, KS2 = 1089 rows.
- Recommend F1 adopt `scheduler_lease`/`scheduler_task_runs` into the Drizzle schema later (DDL in `src/server/scheduler/store.ts`).

## Attempt 2 (re-verification)
- Re-ran `vitest tests/unit/foundation-f6` (62 pass), `tsc --noEmit` (0 errors on owned paths), eslint (clean). No code changes needed.
- Still open, outside F6 ownership: F0 `tests/unit/foundation/instrumentation.test.tsx:35` must expect
  `{ started:false, reason:"Scheduler disabled under test" }`. `src/config/nav-config.ts` (F4) not present yet; Pages provider keeps the layout import.
