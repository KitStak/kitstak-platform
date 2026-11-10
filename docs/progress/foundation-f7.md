# Foundation F7 — Foundation-owned API routes (progress)

Plan: `docs/BUILD_PLAN.md` § F7 (lines 1947-1975). Status: **complete** (owned scope). One proxy change, in a file F7 does not own, is still needed (see Handoff).

Owned paths:
- `src/app/api/{search,tags,change-log,custom-fields,lookups,saved-views,grid-prefs,background-tasks,exports,imports,files,attachments,notes,print,printers,notifications,pickers,ops,cron}/**`
- `src/server/repositories/platform-*.ts` holds the F7 helpers. No module owns the "platform-" prefix.
- `tests/unit/foundation-f7/**`
- `/api/me`, `/api/health` and `/api/auth/*` were delivered by F3. F7 only adds integration tests for `/api/me`.

## Checklist
- [x] **Repositories:**
  - `platform-entities` is the entity registry. It maps entity type to table, scope columns and view/edit/tag/changeLog permissions; out-of-scope records return 404.
  - `platform-common` holds zod fragments, paging, version/CONFLICT, `domainCtx` and LIKE escaping.
  - The rest: `platform-tags`, `platform-change-log`, `platform-custom-fields`, `platform-lookups` (change_log writes), `platform-user-prefs` (saved views, grid prefs, printers), `platform-activity` (notifications, background tasks), `platform-files` (multipart upload, owner-checked download, attachments, notes), `platform-imports`, `platform-pickers` (10 pickers, scoped) and `platform-ops`.
- [x] **Routes (all on `defineRoute`, with permission, zod, scope, envelope and bulk `{succeeded, failed}`):**
  - Search, tags and change log: `search`, `tags` (+`[id]`, `apply`), `change-log`.
  - Configuration: `custom-fields` (+`[id]`), `lookups/[type]` (+`[id]`).
  - Per-user state: `saved-views` (+`[id]`), `grid-prefs/[gridKey]`, `background-tasks` (+`[id]`).
  - Exports and imports: `exports` (202 + `after()` runner), `imports/[key]` (+`template`, `batches/[id]`).
  - Files and records: `files` (+`[id]`), `attachments`, `notes`, `print`, `printers`, `notifications` (+`read`).
  - `pickers/{locations,lps,users,products,customers,vendors,orders,jobs,carrier-services,shipment-packages}`.
  - Jobs and allocation: `ops/jobs` (+`eligibility` as a savepoint dry run), `ops/allocate`.
  - `ops/tasks/{execute,update,cancel}`.
  - `ops/shipping/{rates,labels,void,ship,return-label,close-eod}`.
  - `cron/tick`.
- [x] **Integration tests:** 35 tests in `tests/unit/foundation-f7`. They call the handlers against an in-memory migrated DB and cover:
  - viewer 403 and CSRF 403 on every mutation;
  - scope 404s;
  - a full order lifecycle through `/api/ops`, ending with ledger reconciliation.
- [x] **Verification:**
  - `tsc` and eslint are clean on owned paths. Coverage of F7 code is 96% lines.
  - The full suite passes 390/391. The one failure is the pre-existing F0 instrumentation assertion.
  - Smoke-tested on the dev server: the GETs, tag create/delete, CSRF rejection, an export through to a downloadable xlsx, and print.

## Handoff
- **`src/proxy.ts` (F3):** add `/api/cron/` to `PUBLIC_PREFIXES`. Today the proxy returns 401 before the route's bearer check runs, so an external cron cannot reach `/api/cron/tick`. The route is protected by `CRON_SECRET` itself.
- **Permission mapping:**
  - Tag definitions need any entity "Tag" key or `settings.product_listing.manage_tags`.
  - Lookups writes use `settings.data_setup.view`, the catalog's only Data Setup key.
  - Custom fields use each entity's "Custom Field Management" key; client uses `settings.clients.edit`.
  - Close EOD uses `fulfillment.end_of_day.print_end_of_the_day_report`.
- **Client contracts:**
  - `/api/attachments` and `/api/notes` delete with `?id=`.
  - An attachment is two steps: `POST /api/files` (multipart), then `POST /api/attachments {fileId}`.
  - Pickers return `{id,label,sublabel,meta?}`. Use `ids=a,b` to resolve already-selected values.
  - `ops/jobs` is discriminated on `mode`: `create`, `merge`, `work-order` or `count`. `count` and `work-order` stay "not configured" until M07 and M08 deliver.
- **Modules:** a new entity that needs tags, notes, attachments or change log must be added to `platform-entities.ts` through an F-patch request.
