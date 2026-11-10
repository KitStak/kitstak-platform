# M14 admin-settings — progress

## Status (round 1, resumed 2026-11-06)
- [x] Shared: `src/lib/grid-defs/admin/common.ts`, `src/server/repositories/users-shared.ts`, `src/components/admin/admin-shared.tsx`, `src/components/admin/form-controls.tsx`
- [x] Users: repo, APIs, grid page, Add User 4-step wizard, Edit tabs, row actions, bulk import menu, import handlers, export provider (built in the first attempt; APIs answer 200)
- [x] Roles: repo, APIs, grid + restriction pills, drawer with permission matrix, Manage Restrictions, duplicate, delete guard, export provider
- [x] Account: My Profile, Change Password (`/api/account/password`: CSRF, 5/15 min rate limit, session rotation; wrong current password → 400, no CSRF → 403 verified), Preferences (dd/MM/yyyy + 24 h saved and grid dates re-rendered as `05/11/2026 09:59`; restored afterwards)
- [x] Audit log page + API + export provider
- [x] Company settings, Apps, Data Setup (18 lookups + code generation)
- [x] Printouts (this session): types page (`/settings/printouts`, category nav with correct counts 25/9/10/4/2, search, BETA badges), per-type list (`/settings/printouts/[type]`: grid, details drawer, Edit, Preview PDF, Duplicate, Change log, Delete with ConfirmDialog, default protected), 5-step wizard pages (`/[type]/new`, `/[type]/[id]`: Info · Select template (thumbnails) · Designer (reorder/toggle sections and columns, paper, font, size, logo position, accent, title, footer, live PDF preview against built-in sample or real orders) · Type options · Client access). Verified: duplicated Packing Slip, moved logo right, hid Price, saved → DB + change_log show both field diffs.
- [x] Screen configuration (this session): grid-defs `screen-configs.ts`, repo `screen-configs.ts`, APIs `/api/screen-configs` (+ `[id]`, duplicate, change-log, bulk-status, bulk-delete, options), splash page, Receiving list (`/settings/screen-configuration/receiving`), create/edit page with General / Conditions (When/If/And-Or/Use sentence builder) / Configuration (step Show + Required toggles) and a live mobile preview. Verified create → edit (409 on stale version) → duplicate → activate → delete via UI ConfirmDialog; test record removed.
- [x] `/settings` redirect
- [x] Unit tests `tests/unit/admin-settings/{printouts,screen-configs}.test.ts` (19 passing)

## Shared requests wired (F-patch round, 2026-11-06)
- REQ-1 applied: `screen-configs` is registered in `grid-keys.ts:108` with a `null` provider stub, so the generic provider is used. No local adapter existed, so no M14 code had to change. Verified live: `POST /api/exports {gridKey:"screen-configs", query:""}` → 202, the task completed and produced `Screen Configurations 2026-11-06 1500.xlsx` (0 rows on the empty list; rowCount 1 with a temporary KS-TEST config, which was then deleted, so the list is back to 0).
- REQ-2 applied: the six EXTRA_ROUTES entries are in `route-registry.ts:67-72`. `tests/unit/foundation-f4c/route-registry.test.ts` passes.
- Re-verify: `tests/unit/admin-settings/*` pass and tc-queue shows 0 errors across the M14 paths. `tests/unit/foundation-f6/exports.test.ts` has 3 failures, but they are not M14's: they assert stub providers are `null`/unconfigured, and another module (orders/shipments columns, products) has since filled in real providers. Foundation owns that test.

## Remaining / not verified this round
- Browser walk-through of Users, Roles, Company, Apps, Data Setup and Audit UIs (APIs OK) and the cross-module acceptance items (e2e.operator scoping + deactivate logout, Cancel Order permission 403, Cancel Reason in M01 modal, AI Jobs empty state, print from M01 rail with the custom Packing Slip).
- M05 note: `receivingRequirements` ignores configuration conditions; `configForPurchaseOrder(db, warehouseId, { clientId, poType, vendorId })` in `src/server/repositories/screen-configs.ts` returns the condition-matched config for M05 to adopt.

## Decisions
- Lookup CRUD for Data Setup lives under `/api/company/lookups/[type]`; auto code generation under `/api/company/code-generation`.
- Screen config step keys (`scanLp`, `lot`, `expiry`, `productionDate`, `photo`, `dimensions`, `printLabel`) match what M05 reads (`lot`, `expiry`, `productiondate`).
- Duplicated screen configs start inactive so a copy never changes live receiving.
- Printouts export uses the generic provider (list endpoint) — `providers/printouts.ts` stays `null`.
