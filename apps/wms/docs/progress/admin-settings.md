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

## Round 1 (parity loop) — 2026-11-09
- REQ-F1 done: app activate/deactivate (`apps-page.tsx` useAction) and the app settings drawer save now invalidate `["me"]` with `["apps"]`, so nav items gated on `activeApps` update without a reload.
- Checks: tsc clean on `src/components/admin/**`; `tests/unit/admin-settings` 19/19 pass.
- Still open: the browser walk-through of Users/Roles/Company/Apps/Data Setup/Audit and the cross-module acceptance items listed under Remaining.

## Round 2 (parity loop) — 2026-11-09

Fixes against the round-1 critic verdict (7.2):
- **Index redirects:** `/settings` and `/settings/data-setup` export `instant = false`. They are pure redirect segments, so the dev error "Could not validate `instant`" no longer fires.
- **Printouts:** added `ensureDefaultPrintouts()` in `src/server/repositories/printouts.ts`.
  - It is idempotent and runs on list/types reads.
  - Every one of the 25 print types now gets a locked system default ("<Type> (Default)", `isDefault`). The default can't be deleted, deactivated or client-restricted, but it can be duplicated and edited.
  - The page title now reads "<Type> templates".
- **Audit log:** repeated identical events are grouped. A group is the same action, user, IP, outcome and detail within one clock hour.
  - Each group shows as one row with a ×N badge.
  - A "Group repeats" switch in the toolbar is on by default; `GET /api/audit?group=0` returns raw rows.
  - The CSRF root cause is filed with M11.
- **Company Settings:** the breadcrumb is now `Home > Settings > Company Settings`. Activating the nav item is filed with Foundation.
- **Users & Roles header:**
  - Both tabs use the same helper text, so the header height and the tab-strip position stay fixed.
  - Removed the duplicate "Manage restrictions" header button; it stays in the bulk bar and the row kebab.
- **Add user wizard, User info step:** `userInfoSchemaFor(isEdit, policy)` validates password and confirm together with the other fields.
  - "Confirm the password" is now required.
  - A weak password gets an inline message, e.g. "Password needs at least 10 characters, a symbol", based on the company policy.
  - Step-pill styling is a shared wizard issue, filed.
- **Code generation:**
  - The mode card title shows the live code, e.g. "Auto generate codes as SO000123".
  - Start number is a plain-integer input with no thousands separator.
  - The Data Setup sidebar is wider (300px), so lookup names aren't truncated.
- **User detail:**
  - It is deep-linkable at `/settings/users?id=<id>`, kept in sync through `history.replaceState`, so it is instant.
  - It has tabs: Details, Access, Sessions (live list, with "Manage sessions" for revoking) and Change log (in-drawer).
  - The change log list was extracted as `ChangeLogList` in `admin-shared.tsx`.
- Fixed 4 `react/no-unescaped-entities` lint errors in admin components.
- Tests: `tests/unit/admin-settings/round2.test.ts` covers print defaults (idempotent, undeletable), audit grouping and user-info validation.

Not in M14 ownership (filed under Round 2 requests): billing CSRF header, job-types sort, nav-config Company placement, wizard active-step style, global search, notifications, top-bar icons, other modules' compile errors.

## Round 1 (parity loop) — 2026-11-09, Data Setup parity pass
Source: `references/logiwa-live/settings-shell.md` §Data Setup (create-drawer specs) and §Show Details defect.
- **Type-specific Data Setup fields.** All fields have schema defaults, so old payloads still validate. The meta keys other modules already read are unchanged.
  - **Shipment Order Type:** 17 behaviour Yes/No switches in 4 collapsible sections (Order creation & allocation / Picking / Packing / Shipping), each with an "on/total" counter. Stored as `meta.flags`; the grid shows a "Behaviours on" pill column.
  - **Order Merge Rule:**
    - Merging conditions are split into Default (Client, Customer name, Channel, Shipping address; pre-checked on new rules) and Additional (zip, store order #, carrier, shipping option, priority, planned delivery, expected ship, order date, retailer).
    - Data inheritance radio cards: Oldest / Newest / Clean state.
  - **Mobile Cart Type:**
    - Optional warehouse scope (empty means all warehouses).
    - Description, Operation type, Allow multiple jobs, Dimension and Volume units.
    - Cart H×L×W and cell H×L×W×Volume, with a rule that a cell can't exceed the cart.
  - **Location Zone:** required, unique Zone code; Zone priority; Max locations per SKU.
  - **Packing Warning Type:**
    - Description and Packing warning text (required, 0/1000).
    - Show warning when (3 triggers).
    - Skip confirmation from packer.
    - Media links, http(s) only.
  - **Custom Carrier:**
    - Carrier code is required, unique, and stored upper-case. Logo URL is validated.
    - Inline Shipping services and Carrier packages lists (code + name + Add; a duplicate code is rejected inline; per-row delete).
    - Advanced: Confirmation / Insurance / Billing type chips.
    - Grid columns: Carrier code, Logo, Service qty, Package qty.
  - **Return Reason:** Use as customer reason / Use as actual reason (at least one is required). Link with a damage reason reveals a required Linked damage reason picker; the server checks that the damage reason exists.
- **Show details is read-only, fixing a Logiwa defect.**
  - The row kebab now has Show details · Edit · Activate/Deactivate · Change log · Delete.
  - A row click opens a read-only drawer (disabled fieldset) with Close / Edit. Edit appears only when the user has the permission.
  - The name link still opens Edit.
- **Toasts** follow Logiwa's pattern: "<Type> has been created successfully." / "…updated successfully."
- **Change log** snapshots flatten every new field to readable labels, e.g. "Create back order: Yes" and "services: SD, ND"; raw keys are never logged. See `lookupMetaDisplay`.
- **Drawer polish:** a sticky SubmitBar used to sit 16px above the drawer bottom, with content showing underneath. The lookup, role and app-settings drawers now pass `bodyClassName="pb-0"`. A Drawer-level fix is filed as REQ-R2-7.
- **Verified live with headless Playwright against localhost:3000:**
  - Created an SO type with 2 flags on: 201. The grid showed both pills.
  - A duplicate name returned 409 with an inline "already exists" message.
  - The read-only details drawer opened, Edit switched to the edit form, and saving the description returned 200 (PATCH).
  - Created a custom carrier with 2 services: 201. A duplicate service code was rejected inline.
  - All KS-TEST records were then deleted through bulk-delete (200).
  - The Data Setup pages showed no console errors.
- **Settings and account route crawl (admin):** every route renders its H1. Transient 500s and parse errors came from other modules' files being edited mid-crawl (monitoring and receiving). The viewer role is redirected to `/forbidden` on settings pages.
- **Tests:** new `tests/unit/admin-settings/lookups.test.ts` (13 cases: legacy payload compatibility, issues per type, meta round-trip, carrier code uniqueness and change log, linked damage reason). `tests/unit/admin-settings` is 32/32 green. `tsc` is clean on M14 paths; the remaining errors are in jobs and products, which other agents own.
- **Requests:** REQ-R2-1…7 filed in `docs/requests/admin-settings.md`:
  - SO type flags consumers
  - merge inheritance and new conditions
  - return reason usage and linked damage
  - packing warning content
  - custom carrier services in the shipping dropdown
  - zone priority and cart dimensions
  - Help panel and Drawer padding

### Still open (M14)
- The Return Process page: Logiwa has RMA code prefix plus 8 Return Parameter switches plus the Return Reasons grid on one page. KitStaks still lists Return Process values as a lookup; Return Reason has its own lookup page.
- Damage Reasons are shown as a grid rather than Logiwa's 2-column card grid. The grid is kept on purpose because it supports filtering, bulk actions and usage counts.
- The cross-module acceptance items listed under Remaining above.

## Round 3 (parity loop) — 2026-11-09

Fixed:
- Notifications bell: fresh items read "just now" instead of "now ago" (`notification-item.tsx`).
- Add user wizard: removed duplicate step headings ("User information", "Roles", "Warehouses"); top-level list steps show only a description line, nested Clients list keeps its section title. Removed the stray em dash from the empty password meter. Confirm-password error now reads "Confirm password is required" (unit test updated).
- Welcome email: `POST /api/users` now writes a `user.invite_sent` ("Welcome email sent") audit row. The underlying `auth.password_reset.request` row is still written by the foundation reset helper (request filed).
- Page header (global shell): helper text is now left-aligned under the H1 at all widths, with CTAs top-right, instead of centred in a 3-column band.

Not verified in a browser this round: Playwright's bundled Chromium is missing, and the saved viewer state redirected (likely expired). The viewer /settings/users guard uses the same `requirePagePermission` as /settings/audit; needs a re-check after auth-setup.

Open (shared code, requested): DataGrid error panel / skeleton ending when list or prefs fetch fails; stale rows while refetching; wizard stepper active style; CSRF rejects in other modules; dark-mode skeleton contrast.

## Round 4 (parity loop), 2026-11-09
- `/settings` is now a **Settings hub** instead of a redirect to Users. It shows a card for every mega-menu section (Master Data, Configuration, Client Setup, Users) plus Account (Company Settings, Apps). Each card has a description, and the cards are filtered by the user's permissions. The hub is guarded by `requirePagePermission` with the union of the section permissions. Pure logic is in `src/components/admin/settings-hub-data.ts`; unit tests are in `tests/unit/admin-settings/settings-hub.test.ts`.
- Apps: a "Read-only access" callout appears for users without `settings.company_settings.update`; the activate and settings controls were already disabled with a reason. In this run the operator was redirected to /forbidden for /settings/apps.
- Users grid: role pills are coloured by role (`role-tone.ts`): Admin/Owner solid, Client warning, Viewer neutral, Manager info, Clerk/Operator success. The API user column shows a key icon only for API users; the "No" pills are gone.
- Yes/No toggles in admin forms (including Add user > Send welcome email / Active) are now a compact, fixed-width 50/50 control.
- Company Settings: the section nav is on the left and sticky, and the content fills up to 1280px. The disabled save button already shows the "No changes to save" tooltip through SubmitBar.
- Audit KPI tiles show a skeleton while loading, and 0 instead of an em dash when there is no data.
- Perf: `/api/users` took 11-37s during the run, but the same SQL runs in 1ms against the DB. The time is dev-server contention, not query cost. A "still loading / retry" grid state was requested from foundation.
- Not done here (requested): the job-types viewer gate (M03), the global build-error 500s from other modules' compile errors, and the header logo.
- Verified with headless Playwright at 1440: the hub renders, the drawer toggles are balanced, and the operator is redirected to /forbidden for /settings/apps. A complete end-to-end Add user create was not verified this round because the users list was slow under load.

## Round 5 (parity loop) — 2026-11-09

Fixes for the round 4 critic verdict (6.8):
- **Add user never sticks busy (blocker).** `user-wizard.tsx` aborts the create/save after `SAVE_TIMEOUT_MS` (20s). Any non-field failure (timeout, network, 5xx) shows an inline error Callout in the drawer with a **Retry** button. What the user entered is kept, and a toast fires as well. Field errors and 409 still map onto the form. The helpers are in `src/components/admin/users/save-error.ts` with unit tests in `tests/unit/admin-settings/round5.test.ts`. Verified headless: POST /api/users returned 201 in about 1.6s, the drawer closed, and `user.create` plus `user.invite_sent` audit rows were written.
- **Roles step: ticking a role assigns it.** `access-grid.tsx` no longer has a separate Assign step. The row checkbox means assigned; the header checkbox and the "Assign all / Clear all" buttons act on the visible rows. Because ticking now sets `roleIds`, the "Assign at least one role" error clears. The list caps its height only above 10 rows (420px, with a stable scrollbar gutter), so all 6 roles now show without hidden overflow. The footer shows Total / Showing / Assigned.
- **Job types gate.** `/settings/job-types` now uses `requirePagePermission("settings.job_types.view")`. Viewer and operator go to /forbidden; manager and admin still have access.
- **Email field.** Now `type=email`, `inputMode=email`, `autoComplete=off`. `TextInput` gained `type`, `autoComplete` and `inputMode` props.
- **Printouts spacing.** Added `pt-4` below the header. The CATEGORIES rail heading is now `h-9` so it lines up with the "All · 25" grid header row.
- **Settings hub breadcrumb.** Now reads Home > Settings, using explicit crumbs.
- **Role pill tone.** Custom roles are now `neutral` (were `primary`, which looked red). Unit test updated.
- **Test data.** Deactivated the critic users (KS-CRIT Tester, Operator Two, R2 84447) and deleted the "KS-CRIT Role A (copy)" and "(copy 2)" roles through the API, so both are audited. "KS-CRIT Role A" is still assigned to the inactive Operator Two, so the delete was refused correctly.
- **Settings error boundary.** Added `src/app/(app)/settings/error.tsx`, which shows ErrorView with Retry for the settings tree.

Still open, needs foundation (filed under Round 2 requests): the Settings mega-menu active state on /settings/company and /settings/apps (`src/config/nav-access.ts`); grid/API "Couldn't load, Retry" states when shared APIs return 500; performance against a production build.

## Round 6 (parity loop) - 2026-11-09
- Roles: the seeded Client role is now a system role (seed `access.ts` sets `isSystem: true`; live DB updated), so it shows the System pill and lock. Custom pills are neutral and outlined, never primary/red. The H1 now reads "Roles" to match the breadcrumb, and the helper text describes roles.
- Nav: `activeMenuKey` falls back to the Settings menu for any `/settings/*` route, including Company and Apps, which live in the account menu. Unit-tested in `tests/unit/admin-settings/round6.test.ts`.
- Audit: identical repeats (same action, user, IP, outcome and detail) now collapse per UTC day instead of per clock hour, with an xN badge. The Details cell opens the full detail drawer and has a tooltip.
- Demo data: the leftover "Round Five" test users are deactivated and renamed with a KS-Test prefix.
- Users drawer: the success path already closes and toasts as soon as the response arrives. The slow close is most likely dev compilation of the refetch. This could not be re-measured because the dev server was returning 500 on every route (waves-run.ts import error, another module).
- Not done: the perf audit on a production build was blocked by the same compile break. Disabled destructive style, the jobs octal escape and viewer settings access are filed in requests.


## Round 2 (parity loop), critic 7.3 fixes, 2026-11-10

Fixed (verified with headless Playwright against localhost:3000 and the API; KS-TEST records removed):
- **Apps, blocker.** The enabled "Activated" control is now a real button inside a plain `Tooltip` ("Click to deactivate"). `DisabledReason` is used only when the user lacks permission, and then wraps a non-interactive label. The Details dialog footer gained **Deactivate** (confirmed by the same dialog) and **Activate**. Verified by mouse: deactivated AI Jobs, then re-activated it from Details (PATCH 200, settings drawer opened). AI Jobs is active again. The breadcrumb now reads `Home > Settings > Apps`, and the Settings top-nav item is underlined.
- **Add user, email uniqueness.**
  - New `POST /api/users/email-available` `{email, exceptId?}` returns only `{available}`. It's a POST so addresses stay out of URLs and logs, and it needs the users create/edit permission.
  - Step 1 checks the email debounced (350 ms). While a check is in flight Next is disabled with "Checking that this email isn't already used…", and a taken address shows inline: "A user with this email already exists". `userInfoSchemaFor(isEdit, policy, takenEmails)` makes Next fail as well.
  - A late 409 on Create no longer fires a toast. The wizard jumps back to step 1, sets the inline error and focuses Email.
  - Verified: `ADMIN@kitstak.io` is flagged inline and Next stays on step 1; switching to a free address clears the error.
- **Return Process (Logiwa layout)** at `/settings/data-setup/return-process`, a static route that takes precedence over `[lookup]`:
  1. **RMA code generation preferences:** Prefix and Next number with a live preview of the next two codes. Saved through the `rma` code sequence.
  2. **Return parameters:** 8 switch rows with descriptions in two groups, an n/8 badge, a sticky Save / Discard bar and "Turn all parameters on". Stored in `company_settings.defaults.returnRules` with the company `version`; a stale save returns 409 and shows the Reload callout. Every change writes a change-log row ("Serial number match: On → Off").
  3. **Return reasons:** the return_reason grid is embedded with Add new, row kebab, bulk actions and an inline active switch, via `LookupPage variant="section"`.
  - `updateCompanyDefaults` now keeps the other keys in the defaults JSON, so saving Company Settings no longer wipes the return rules (unit-tested).
  - For M04: `getReturnRules(db)` in `src/server/repositories/company-return-rules.ts`, plus the pure `checkReturnLine(rules, shipped, line, {warehouseMismatch})` in `src/lib/grid-defs/admin/return-rules.ts`. It covers unspecified SKU, exceeding the shipped qty (including earlier returns), lot, expiry, production date, pack type, serial and alternate warehouse.
- **Printout designer, now a block designer.**
  - Layout model (backward compatible, new keys default):
    - document paper Letter / A4 / Legal
    - label stock 4×6, 4×4, 4×3, 4×2, 3×2, 2×1, with presets for 2×1 and 4×6 QR
    - `barcodeType`: Code 128, Code 39, GS1-128, EAN-13, UPC-A, QR, Data Matrix, PDF417
    - `labelLanguage` PDF or ZPL
    - up to 20 free `blocks`: static text, data field, barcode, image, divider, spacer
  - Data fields and barcodes bind to 13 record fields plus active **custom fields** (`custom:<slot>`, from `custom_field_defs`, via `GET /api/printouts/fields`). Field blocks take an optional caption.
  - Images are uploaded as PNG/JPEG data URLs (max about 150 KB, schema-validated). Nothing is fetched remotely, so there is no SSRF.
  - UI: an "Add block" palette, then one Layout list for sections and blocks: drag to reorder, arrows or Alt+↑/↓, show/hide switch, inline editor per block, delete.
  - New **WYSIWYG Canvas** preview at true paper proportions. Click a block on the canvas to select and edit it. The data comes from `POST /api/printouts/preview {format:"record"}`.
  - A **PDF** tab shows the embedded server PDF (rendered in about 390 ms), and **Open PDF** opens it in a new tab.
  - For ZPL labels, a **ZPL** tab shows the raw ZPL II (203 dpi, `^FH` escaped, native barcode commands per symbology) with Copy and Download .zpl.
  - Color inputs are 32×32 chips.
  - Root cause of the stuck "Rendering preview…": the app's CSP (`default-src 'self'`, no `frame-src blob:`) blocks blob: iframes, so the PDF never displayed. The designer now reads the page's CSP header first and never attempts a blocked frame (no console error). It falls back to Canvas plus Open PDF. The CSP change is requested from foundation.
  - Verified: a created label template with QR, ZPL and a caption field block returned 201; GET returned the block; the ZPL preview returned 200 (`^PW812 ^LL812`); `format: zpl` on a document type returned 400; the template was deleted.
- **Roles drawer:** once any required field errors, Name and Description are validated together, and errored fields re-validate on each keystroke. The fields are wrapped in a `gap-4` stack, so there is space between an error line and the next label. Verified: both messages appear, and typing a description clears its message.
- **Dates:** the profile, user detail drawer (last sign-in, password changed, locked until, sessions), audit drawer, apps details and change-log lists now use `fmt.gridDateTime` (Preferences format, no seconds).
- **Change-log copy:** M14 change-log lists render "Roles changed: Warehouse Clerk → KS-CRIT Role A" (`prettyLogMessage` in `src/lib/grid-defs/admin/common.ts`). The stored wire format is unchanged.
- **Screen Configuration splash:** 20px under the header; the card is sized to its content (max 1100px), not stretched to the viewport.
- **Data Setup sub-nav:** "Auto Code Generation" is in Title Case. Return Process no longer shows a misleading lookup count.
- **Damage Reasons and every lookup grid:** an inline Active switch in the Status column (Logiwa's per-card switch), permission-gated, with bulk-status semantics.
- **Printouts types header:** re-checked at 1440. The rail starts below the header band, and "All · 25" shares a baseline with the search input. No change needed.

Tests: new `tests/unit/admin-settings/round2-parity.test.ts` (21 cases) covers:
- return-rules model, enforcement and repository, including the defaults-JSON preservation
- block schema, image data-URL validation and normalize
- PDF rendering of every block kind and every label stock size
- ZPL symbology and escaping
- custom-field binding
- email uniqueness helpers and `isEmailTaken`
- change-log copy

`tests/unit/admin-settings` passes 73/73. `tsc --noEmit` is clean for the whole project at the time of the check. eslint reports 0 errors on M14 paths.

Not in M14 ownership (filed under "Round 2 parity loop additions" in the requests file):
- CSP `frame-src 'self' blob:`
- M05 adopting `configForPurchaseOrder`, plus an e2e test
- M04 enforcing return rules and RMA codes
- foundation:
  - wizard active-step style and the disabled-button treatment
  - notification severity, filters, pagination and dates
  - in-place 403 for every role
  - the demo login banner
  - login `roleNames[]`
  - the Printers / Help / Screen Recording / Feedback shell items

## Blind-judge repair round 1 (2026-11-10)
Done + verified:
- CSP: added `frame-src 'self' blob:` to the shared policy in next.config.ts (backward compatible). Verified via `curl -I /login` header; printout PDF blob preview no longer trips the CSP fallback detector in designer.tsx.
- Relative time: session "last active" no longer renders "now ago" (reads "just now"); notification-item already handled it.
- tsc: no errors in admin/layout/next.config paths.

Not done this pass (open, carried forward):
- Notifications severity/filters/pagination/mark-all/preferences; global record search + recents; help panel/release notes;
  permission-matrix RF/print depth audit; shared wizard stepper; cross-module e2e walk; fresh-auth guard re-verify + in-place 403;
  Users grid loading/retry/error + /api/users latency investigation; config-entity custom fields/change logs/import;
  receiving configForPurchaseOrder + returns rule enforcement (needs inbound-receiving / stations-returns owners).

## Blind-judge repair round 2 (2026-11-10)
- /api/users and /api/roles latency: the users list SQL (role/warehouse/session subqueries) runs in 5ms on 17 users directly against .data/kitstak.db. Over HTTP both routes took 26-38s, and `GET /login` took 24-35s too. The slowness is dev-server-wide (concurrent agents compiling) and not specific to these routes. No route change was needed.
- Grids: the shared DataGridBody skeleton now shows "This is taking longer than usual" plus Retry after 6s (backward compatible). The existing error state with Retry is unchanged.
- Apps: the hero no longer shows "0 of 0 apps" while loading or after an error. It shows loading, error or not-installed copy instead. The DB holds the 16 catalog rows.
- tsc: no errors in the changed files. tests/unit/admin-settings passes 73/73.
- Still open (not done this pass): notification severity, filters, pagination, mark-all-read and preferences; grouped global search with recents; help releases and feedback; shared wizard stepper; config-entity change logs, custom fields and imports; permission-matrix RF/print audit; in-place 403 for every role; fresh-login guard re-verify; Playwright re-verification (blocked by the 25s+ dev-server response times).

## Round 3 (parity loop), critic 7.4 fixes, 2026-11-10

**Majors**
- **Printout Canvas preview.**
  - The live route returns 200 for `format:"record"` with real order data. The designer now defaults to the most recent real order instead of the built-in sample, and shows "Loading recent orders…" and "Loading the sample record…" states.
  - The fallback callout no longer shows raw zod or server text. It gives friendly copy and a Retry.
  - New e2e test `tests/e2e/admin-settings/printout-preview.spec.ts` asserts a 200 response with real records, and a 400 for an unknown format.
- **Roles: actions imply View.**
  - `withImpliedViews`, `toggleWithViewRule` and `requiredViewOf` are in `lib/grid-defs/admin/roles.ts`.
  - In the matrix, ticking an action ticks the page's View. Unticking View clears that page's actions and shows an info toast.
  - The server normalizes create, update and duplicate (`repositories/roles.ts`), so a role can never hold actions without View. Unit-tested, including the repository.
- **Optimistic grids.**
  - `useAction` no longer awaits the list refetch: the dialog closes as soon as the mutation succeeds, and the refetch reconciles in the background.
  - New `useGridPatch(gridKey)` patches every cached page right away. It is used for Users activate/deactivate, Role delete, Printout delete, Lookup status and delete, and Screen-config delete.
- **Help panel** (`layout/help-panel.tsx`, replaces the 4-item dropdown):
  - Help Center hero with article search.
  - "For this page" articles chosen by route.
  - The 8 Logiwa collections (Process Manuals, Reports, Integrations, Workflow Rules, Client Management, Setup, Release Notes, Account Management) with step articles and in-app links.
  - Release notes, keyboard shortcuts and Contact support.
  - A Privacy Policy article.
  - **Feedback & Updates**: a right-edge side tab plus a panel view. It posts to the new `POST /api/account/feedback`, which is rate-limited, writes the audit row `feedback.submitted` and notifies admins. Query strings are stripped from the page path.
  - **Screen recording**: `getDisplayMedia` plus MediaRecorder, a 5-minute cap, preview, Download .webm and Send to support. Nothing is uploaded.
- **Global search.**
  - Enter while records are still loading is remembered and opens the best hit once results arrive.
  - The palette shows an explicit "Searching records…" state and a "No results for …" empty state, instead of an empty RECORDS header.
  - New providers for users (`/settings/users?id=`) and roles (`/settings/roles?id=`, which now opens the drawer).
  - `containsText` matches codes regardless of zero padding, so PO0002 and PO22 both find PO002210.

**Minors**
- **Notifications.**
  - Effective severity: a "success" whose copy reports shortages, skips or failures is shown as a warning.
  - Plural fixes ("1 job", "19 shortages").
  - Filters: status, type chips from `meta.types`, severity ("Needs attention"), and date (today, 7 or 30 days).
  - The pager is always visible, with rows per page and an "x–y of N" label.
  - Per-row Delete, and a "Clear read" action with a confirm dialog (`DELETE /api/notifications`, own rows only).
  - All timestamps use `fmt.gridDateTime`.
- **Printouts.**
  - Six retailer-compliant packing lists: Target, Macy's, QVC, Staples Dropship, Walmart and Amazon. Each has the retailer header block, the PO or order barcode, no prices or totals, and the retailer's return copy.
  - The Select template step now has 10 templates with thumbnails in two groups.
  - The type list page has a "‹ Go back to Printout Types" link.
- **Data Setup.**
  - Order Merge Rule is warehouse-scoped, with a required Warehouse field, and offers an "Order tag" condition.
  - Location Zone has **Match With Product Groups**: a dialog grouped by warehouse with a multi-select per zone. It saves only the changed zones, writes one change-log row per zone, and keeps the zone's other settings. The data is served by `GET`/`PUT /api/company/lookups/location_zone/product-groups`.
  - A Product groups column was added to the zone grid, and a drawer edit preserves `productGroupIds`.
- **Grid widths at 1440.** Columns were tightened on the Printouts list, the lookup grids (including Return reasons) and Audit. Truncated cells have a `title`, and the Audit Details cell wraps to two lines.
- **Disabled destructive actions.** `armDestructive` drops the red styling whenever a bulk or row action can't run (no selection, ineligible selection, no permission, system role). The disabled red buttons and red menu icons are gone in the Users, Roles, Printouts, Lookups and Screen Config grids.
- **Copy.**
  - The Screen Configuration hub card reads "Mobile receiving steps and the purchase orders they apply to."
  - The Add user toast reads "Welcome email sent … they sign in with the password you set."
  - The H1 and metadata now read "Job Types".
- **Printers popover.** An informational callout with "View the setup guide" opens a new Direct Print help article through the `kitstak:open-help` window event. Printers are prefetched 2.5 s after the shell loads.
- **Dark mode.** The theme init script keeps following the OS while the preference is "system", so route skeletons switch with it.
- **Change log drawers.** They show "Loading the history…" plus a skeleton, then a slow-state Retry after 8 s. Create events were already logged (`logCreate`).

**Tests:** `tests/unit/admin-settings/round3-parity.test.ts` has 20 cases. The `tests/unit/admin-settings` suite and foundation f6/fix1/fix3 all pass. `tsc --noEmit` is clean on every touched path; the remaining errors belong to other modules (shipment-plans, catalog).

**Requests filed** under "Round 2 requests (added parity loop round 3)":
- `runOrderMerge` handling of the order tag and warehouse scope
- producer-side notification severity
- put-away reading zone product groups
- the dropdown and button disabled treatment
- grid scroll shadow
- review of the shared files touched

**Not verified visually this round:** the shared dev server at localhost:3000 stopped answering (`/api/health` gave no response within 280 s, and the dev log shows only EPIPE / aborted errors after 07:05 UTC). The headless walk script, `C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\admin-settings\r3-walk.mjs`, covers the help panel, feedback, search Enter, roles matrix, users toolbar, notifications, printouts templates and designer preview, zone dialog and wrong password. It timed out on navigation and needs a rerun once the server is healthy. Earlier in the round the live API returned 200 for the `format:"record"` preview with real data. The Change Password inline error code path looks correct: `useApiMutation` applies `fieldErrors.currentPassword`. It is not yet re-measured in the browser.

## Blind-judge repair round 3 (2026-11-10)

**Shipped**
- **Skeletons can no longer spin forever.** The new `components/layout/slow-load-notice.tsx` is a client component, and it is mounted inside `PageSkeleton` and `DetailPageSkeleton`, so `ShellSkeleton` and every route fallback that uses them get it too.
  - After 6 s it shows "Still loading… Retry".
  - After 20 s it switches to `role=alert` with "This page didn't load…" and Retry, which reloads the page.
  - The change only adds the notice. Skeleton props and markup are unchanged.
- **Test-data purge.** The new `scripts/purge-test-data.cjs` is idempotent: it can be re-run after any critic or e2e pass.
  - It removes users matching `ks-crit*`, `ks-r<n>-*` and the `KS-CRIT*`/`KS-Test*` names, and roles named `KS-CRIT*`/`KS-Test*`.
  - Before deleting, it nulls the NO ACTION foreign keys: audit_log, background_tasks, entity_notes, import_batches and jobs.
  - Run against `.data/kitstak.db`, it purged 7 users and 2 roles. The seed (`scripts/seed-fixtures.ts`) never contained them; they came from critic runs.
- **Read-only Show details for Roles.**
  - `RoleDrawer` takes a new `view` prop. Show details, row click and the `?id=` deep link now open custom roles read-only, with Close and **Edit** buttons; Edit unlocks the form.
  - The System-role callout now appears only for system roles.
  - Users, Printouts and Lookups already had read-only detail drawers with Edit.

**Verification**
- `tsc --noEmit` reports no errors in the touched files.
- `vitest tests/unit/admin-settings` passes: 9 files, 93 tests.
- I could not run the Playwright walk this pass. The shared dev server on :3000 did not answer at all, even `/api/health` timed out after 120 s, apparently under load from the other agents. Per the rules I did not restart it.
- The walk script is ready to re-run: `C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\admin-settings\r3.mjs`. It covers h1 timing for /settings, /settings/roles and /settings/users, a pollution check, and the role view → Edit flow.

**Still open (not done this pass)**
- Real SSO (SAML/OIDC) and Custom Branding apps; Apps catalog tabs (popular, active, all) plus carrier, robotics and OMS entries.
- Free-form drag-and-drop printout designer.
- Import pages with history grids for Users, LP Numbers and the lookups.
- Custom fields framework for LP Types, Shipment Packages, Products and Locations. These pages are mostly other modules' files.
- Job-type parity: the full picking condition set, order-by with custom fields, grouping, count conditions, replenishment.
- Warehouse settings: day-shift hours, mobile inactivity timeout, mandatory-reason toggles, default receive and ship locations.
- The browser wizard walkthrough. It is still blocked on the unresponsive dev server.

## Round 4 (parity loop) — 2026-11-10

Fixes for the round-3 critic verdict (score 6.7).

**Shipped (M14-owned)**
- **Users bulk import is live.** The four import handlers were still 0.6 stubs, so every upload was refused as "not configured yet". `src/server/repositories/users-import.ts` now drives `imports/handlers/{users,user-roles,user-warehouses,user-clients}.ts`.
  - **Bulk Import Users** upserts by email: it creates a user with a role, a default warehouse and all-client access, or updates an existing user's name, type and status and adds the role and warehouse.
  - **Imported passwords:** imported users get a random password that is already expired. Nothing password-like ever travels in Excel; an admin uses Reset password to give access.
  - **Import User-Role / User-Warehouse / User-Client** assign or unassign one link. A user always keeps at least one role and one warehouse. An all-clients user can't lose a single client.
  - **Behaviour:** repeating a row is idempotent, with an "already assigned" message.
  - **Validation path:** every row goes through `createUser` / `updateUser`, so it gets the same checks as the wizard: scope, Admin-only grants, the last-admin guard, session revoke and change log.
- **One-pass user validation.** `POST /api/users` and `PATCH /api/users/:id` now parse through `parseUserSave`, which uses `userSaveSchemaWithPolicy`. The company password policy runs inside the same `superRefine` as roles, warehouses and clients, so a weak password with no roles or warehouses returns all three field errors in one response.
- **Users & Roles header.** Both tabs render `USERS_ROLES_TITLE` / `USERS_ROLES_HELPER`, so only the tab underline moves.
- **Permission-pending state.** Add user, Add role and Bulk import/update render a neutral pulse placeholder (`PermissionPending` in `admin-shared.tsx`) while `/api/me` is pending. A filled pink button no longer appears before permissions are known.
- **Bulk import menu labels** match the destination page titles exactly: Bulk import users · Import user-role · Assign/unassign user-warehouse · Assign/unassign user-client. Each item has a description.
- **No silent no-op settings.**
  - All 17 Shipment Order Type switches render read-only with a **Coming soon** badge (`SO_TYPE_FLAGS_ENFORCED`, empty until a consumer wires one). Values saved earlier are kept, and the drawer copy says so.
  - The Order tag merge condition is Coming soon: it can be unticked but not added. So are the "Newest" and "Clean state" inheritance options, since merges always keep the oldest order.
  - Location Zone priority and max-per-SKU sit in a disabled fieldset with a note, and **Match With Product Groups** is disabled with a reason tooltip (`ZONE_PUTAWAY_SETTINGS_ENFORCED`).
- **Company logo in the top bar.** The new `GET /api/company/branding` is open to any signed-in user. `app-shell.tsx` `Logo()` shows the uploaded logo on a white chip, falls back to the KitStak mark on 404 or a load error, and refreshes right after an upload or removal (`COMPANY_BRANDING_QUERY_KEY` is invalidated).
- **Data restrictions.** `src/server/repositories/roles-redaction.ts` provides `deepRedactFor` and `restrictedExportColumns`.
  - `deepRedactFor` walks nested data, matches keys case-insensitively, never mutates, and returns the same reference when there is nothing to redact. It covers the order, shipping, packing and billing column names.
  - The Manage Restrictions copy no longer claims "every grid, export and API". Wiring it in is a two-line foundation change at the response boundary and in the export runner (REQ-R4-1/2).
- **Screen Configuration runtime.** `receivingPlan` (pure, in `lib/grid-defs/admin/screen-configs.ts`) and `receivingPlanForPurchaseOrder` (in the repo) resolve the **single** matching config through `configForPurchaseOrder` and honour `show` / `required` for every step. M05 needs to swap `receivingRequirements` for this drop-in (REQ-R4-3 / RP-2).
- **Roles grid.** The Restrictions header tip was removed until the shared header places icons inline (REQ-R4-5).

**Environment items not in M14 code**
- **"Router action dispatched before initialization".** Next throws this from `sequential-router-queue` (`hmrRefresh` / `restore`) when an HMR event lands before the router hydrates. Here that comes from other agents' edits arriving while the overloaded dev server is still hydrating a page. M14 writes history only from click handlers.
- **`orders-change-log.ts`.** It compiles now: `tsc --noEmit` is clean for the whole repo.

**Tests:** `tests/unit/admin-settings/round4-parity.test.ts` has 19 cases: validation, redaction, receiving plan, gating, and import helpers plus DB imports. The full `tests/unit/admin-settings` suite passes (10 files, 111 tests), and `tsc --noEmit` is clean.

**Requests filed:** REQ-R4-1 to REQ-R4-7, under "Round 2 requests (added parity loop round 4)".

**Live verification (round 4)**
- `GET /api/company/branding` → `{displayName:"KitStaks", logoUrl:null}`, so the shell shows the KitStak mark.
- `POST /api/users` with a weak password, no roles and no warehouses returns **one** VALIDATION response with `roleIds`, `warehouseIds` and all 4 password-policy messages.
- Headless walk (`C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\admin-settings\r4.mjs`): `/settings/users` rendered the "Users & Roles" header with the neutral permission placeholders after 400 s. Every other route timed out at 400 s on the overloaded shared dev server (health check 57–73 s), so the menu, SO-type drawer and import pages still need a visual re-walk on a quiet server.

## Round 5 (parity loop) — 2026-11-10

Fixes for the round-4 critic verdict (score 6.6).

**Shipped**
- **`/api/me` is a refresh, not a gate (blocker).** Every M14 page uses `usePagePerms`. It now resolves through the pure `resolvePagePerms`:
  - **Source order:** the live `/api/me` set once it has loaded, otherwise the permission set the (app) layout resolved on the server for this request (`ShellProvider`).
  - **Effect:** Add user, Add role, Bulk import/update, row kebabs and bulk actions render enabled on first paint, SSR included, so there is no hydration mismatch.
  - **`PermissionPending`:** only shows when neither source exists.
  - **Own-row checks:** the "You" badge and the "can't deactivate yourself" check take the user id from the session (`useMeId`).
  - **App-wide:** the same fallback is filed for the foundation hook (REQ-R5-1).
- **Password meter never shows placeholder rules.** `DEFAULT_HINTS` is gone. `usePasswordPolicy()` returns the API value, then the server seed (`PasswordPolicySeed`), else `null`, and a `null` policy renders "Loading your company's password policy…".
  - **Server seeds:** the `/settings/users` and `/account/password` RSC guards seed the live company policy, so both screens show the same rule on first paint ("At least 12 characters" today).
  - **Wizard:** Next on User info waits while the policy is still unknown.
- **Password expiry is enforced.**
  - **Shell props:** `loadShellProps` adds `passwordChange`, computed by the pure `passwordChangeReason`:
    - "reset" when there is no `passwordChangedAt`;
    - "expired" when the password is past the company `maxAgeDays`;
    - API users are never gated.
  - **Gate:** the new `PasswordChangeGate` in the shell replaces every route except `/account/password` and redirects there.
  - **Banner:** Change Password names the real reason, admin reset or "older than N days".
  - **Unlock:** a successful change runs `router.refresh()`, which lifts the gate.
  - **Dev data:** seed users in `.data/kitstak.db` were refreshed (8 rows) to a recent `password_changed_at`, so demo logins are valid. The seed fix is REQ-R5-2.
- **Idle sign-out (new, Company Settings › Security).** "Sign out idle users" plus "Sign out after N minutes idle" (5–720), stored in `company_settings.defaults.sessionIdleMinutes`.
  - **Change log:** the "Idle sign out" field is logged, and an account-defaults save keeps the setting.
  - **Shell:** `IdleSignOut` tracks activity across tabs through localStorage, shows a 60 s countdown dialog (Stay signed in / Sign out now), then calls `/api/auth/logout` and sends every tab to `/login?reason=idle&next=…`.
  - **Server side:** server enforcement is REQ-R5-4.
- **TOTP MFA core.** `server/repositories/users-mfa.ts` implements RFC 4226/6238 (HMAC-SHA1, 6 digits, 30 s, ±1 step, constant-time compare, returns the counter for replay rejection) plus base32 and `otpauth://`. It is verified against the RFC vectors. Enrollment and the login step need schema and auth changes (REQ-R5-3).
- **Feedback & Updates tab no longer covers grids.** `<main>` reserves a `lg:pr-7` gutter, the tab's width, so the tab never overlaps the right-most kebab column.
- **Notification bell.**
  - **Clipping:** the popover is a flex column (header and footer `shrink-0`, list `min-h-0 flex-1` scroll), so the last item is no longer clipped by the footer.
  - **Severity:** `displaySeverity` shows a "success" that reports `0 allocated` as a warning. The producer fix is REQ-R5-8.
- **Roles grid:** the Users count column is left-aligned like every other header and cell, with an accessible link label.
- **`POST /api/printouts/[id]/render`** now requires a printouts permission (view, create or edit) or a document-print permission: SO print packing slip, picking list or batch picking list, or packing-station packing slip. Records were already scoped to the caller's warehouses and clients in `orderRecord`; out-of-scope ids fall back to the built-in sample.

**Not done (other modules' files or foundation, filed as REQ-R5-1…9)**
- **SO Type, merge and zone switches:** they stay "Coming soon" until their consumers read them (REQ-R5-7).
- **SAML/OIDC:** not built.
- **Notification preferences:** need storage (REQ-R5-9).
- **Grid footer defaults:** REQ-R5-6.
- **Dashboard hydration error:** traced to M13 `dashboard/widgets.tsx`. `ShiftClock` and `ShiftSummary` seed `useState(() => new Date())` and render the current time during SSR. The fix is filed as REQ-R5-10. No shell component renders time-relative text on the server; the bell list is client-fetched.

**Tests:** `tests/unit/admin-settings/round5-parity-loop.test.ts` has 19 cases: permission seed merge, policy resolve, password-change reasons and allowed routes, display severity, TOTP RFC vectors, idle phase, and company idle persistence. The whole suite passes (11 files, 130 tests). `tsc --noEmit` is clean for the whole repo.

**Live verification (round 5)** — headless walk scripts `r5.cjs` and `r5b.cjs` in `C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\admin-settings\`.
- **`/settings/users`:**
  - **CTAs:** Add user and Bulk import/update rendered **enabled while `/api/me` had never answered**. The `/api/me` response time was null for the whole 8-minute run (`r5-users.png`).
  - **Grid:** the Users grid API timed out on the overloaded shared server, and the page showed its error state with Retry.
  - **Add user meter:** it reads "At least 12 characters", the live company policy (`r5-wizard.png`).
  - **Feedback tab:** it now sits in the reserved gutter, right of the grid's right edge.
- **Not yet re-walked:** `/settings/company?section=security`, `/account/password`, `/settings/roles` and the bell popover each timed out at 400 s; the shared dev server was serving only the shell skeleton (`r5b-*-fail.png`). `r5b.cjs` re-walks them once the server is responsive.

## Round 6 (parity loop) — 2026-11-10

Fixes for the round-5 critic verdict (score 7.3).

**Shipped**
- **Edit user never opens stale values; stale saves get a 409 (major).**
  - **Cause:** the drawer seeded the form from a cached `["user", id]` copy. A background refetch then swapped in the *new* `version` under the *old* form values, so the stale save passed the version check and reverted the earlier edit.
  - **Drawer:** it now seeds only from data fetched after this open (`isFreshDetail`, latched per open, so a background refetch never unmounts the form mid-edit).
  - **Version pin:** `Body` pins the version it was seeded from (`seedVersion`).
  - **Save:** a save drops the cached user and invalidates the change logs.
  - **Server:** `PATCH /api/users/[id]` now **requires** `version` (400 "Reload the user before saving").
  - **API check:** no version gives 400, a fresh version gives 200, a stale version gives 409.
  - **UI check:** Edit → Save → reopen shows the saved last name, and a second save succeeds (`r6-users.cjs`).
- **Printouts: a new template shows on arrival (major).**
  - **Wizard:** create and edit invalidate `["grid","printouts"]` and `["printout-types"]` before navigating to `?saved=<id>`.
  - **List:** it shows a "<name> saved · Show details" banner.
  - **Header:** the duplicate "Go back to Printout Types" link is gone; the breadcrumb carries the back link.
  - **Verified:** Total went from 2 to 3 with the row present on arrival (`r6-printouts.cjs`, `r6-printout-created.png`).
  - **Grid:** Creation date widened (184 px).
- **`GET /api/printouts` (grid mode) returns 403** without `settings.printouts_labels.view`. Viewers got a 200 with an empty list before. The `?typeKeys=` print-modal branch stays open to print callers.
- **Audit truthfulness (major).**
  - **Rejected password change:** a wrong current password now writes `auth.password_change_rejected`, outcome **failure**, labelled "Password change rejected", with detail `reason: wrong current password`.
  - **Role delete (single and bulk):** the role name is snapshotted into `detail.name`.
  - **Target:** it falls back to `detail.name` for lookups and other entities, and printouts resolve to their template name.
  - **Details:** a lookup type key reads as its Data Setup noun ("Shipment Order Type"), and a printout type key reads as "Packing List".
  - **Labels:** labels added for lookup.*, printout.*, screen_config.*, sequence, return rules, feedback, mail.
  - **IP:** a legacy `"direct"` IP renders as "Not captured". Real client IP capture is foundation (REQ-R6-2).
- **Audit grid.**
  - **Width:** default columns now fit 1440 (table 1356 = container 1356).
  - **KPI tiles filter:** clicking a tile now filters the grid. The old handler called `upsertFilter` then `removeFilter` on the same stale query, so the second call dropped the first. It now makes one `setFilters(kpiFilters(...))` call. Verified: Permission denials gives `?f.category=in:Permission denied`.
- **Email delivery (new, Company Settings › Email delivery) + a real invite (major).**
  - **Transports:** "SMTP server" or "Server log only".
  - **SMTP:** server, STARTTLS/SSL/none, port, user name, password (AES-GCM vault, never returned, `••xy` hint), From address and From name. A "Send test email" button is included.
  - **Client:** a built-in SMTP client in `server/repositories/company-mail.ts`: EHLO, STARTTLS upgrade, AUTH PLAIN with LOGIN fallback, dot-stuffing, CR/LF-safe headers.
  - **E2E check:** verified against a local SMTP sink (`smtp-e2e.cjs`: AUTH, MAIL, RCPT, DATA all accepted). The setting was reverted to "Server log only" afterwards.
  - **Settings storage:** settings live in `company_settings.defaults.mail`, which `getCompany` no longer returns.
  - **Change log:** account-defaults changes only compare the four default keys.
  - **Add user invite:** "Send welcome email" now sends a dedicated **invite** (`users-invite.ts`): its own template, a 72 h single-use link, and the company transport.
  - **Response:** the API returns `welcomeTransport` and `welcomeError`.
  - **Toast (`welcomeToastText`):** it says what happened:
    - emailed;
    - written to the server log only, because delivery is not set up;
    - failed, with the reason.
  - **Audit:** `user.invite_sent` is attributed to the **admin**, with the delivery and the link expiry. No "Password reset requested" row is written for the new user.
- **Roles › Manage restrictions** states its real coverage (`RESTRICTION_COVERAGE`): enforced on shipment, rate shopping and carrier account screens and APIs; not yet on order, packing, returns, billing or exports. App-wide enforcement is REQ-R6-1.
- **Data Setup.**
  - **One place per data set:** Return Reason is gone from the sub-nav. `/settings/data-setup/return-reason` redirects to Return Process, which shows the reason count.
  - **Tablet:** below 1024 px the nav collapses into a "Data setup" select above the content (verified at 768).
  - **Return Process spacing:** the empty sticky save band between the cards is gone; the bar shows only while the form is dirty, and "Turn all on" moved into the parameters card header.
  - **Embedded Return reasons grid:** it drops Updated and Sort order, so nothing truncates. Updated is 180 px elsewhere.
- **Small fixes.**
  - **Notification chips:** human labels ("End of day", "Work orders", slug fallback "Cycle count").
  - **User menu role names:** they match the Roles grid ("Admin", "Warehouse Clerk").
  - **Company defaults example:** it uses today's date, set after mount.
  - **Hub card copy:** now "Company name, logo, units, currency, date format and security policy".
- **/forbidden:** re-measured as viewer (/settings/printouts → /forbidden). It reaches network idle in 1.8 s, with no polling beyond the shell's 60 s bell. The >30 s in round 5 was the overloaded shared server.

**Not done (filed in requests as REQ-R6-1…7)**
- **Foundation:** API/export redaction, real client IP, forgot-password through the company transport, the shared stepper in drawers, toast placement, grid row highlight.
- **Consumers not reading the switches yet:** the SO Type, merge-rule and zone switches. SAML/OIDC and TOTP enrollment are unchanged (REQ-R5-3).

**Tests:** `tests/unit/admin-settings/round6-parity-loop.test.ts` has 15 cases:
- `isFreshDetail` and `kpiFilters`;
- audit labels, category and type names;
- the welcome toast truth table, the invite template and the mail schema;
- SMTP framing (dot-stuffing, header injection);
- the Data Setup nav without duplicates;
- chip and role labels, and the restriction copy.

The suite passes (12 files, 145 tests). `tsc --noEmit` is clean for the whole repo. ESLint reports 0 errors (warnings only).

**Live verification:** scripts `r6-users.cjs`, `r6-printouts.cjs`, `r6-walk.cjs`, `r6-hyd.cjs`, `r6-forbid.cjs`, `invite.cjs`, `smtp-e2e.cjs` and `patchtest.cjs` in `C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\admin-settings\`.
- **Hydration:** no hydration errors on audit, return process, notifications, company (email and defaults), users or printouts.
- **Note:** one walk step briefly targeted the wrong row (the search had not applied). Seed user Dana Whitfield's last name was edited and then restored through the API; the change log shows both rows.

## Blind-judge repair round 1 — 2026-11-10

**Shipped**
- **Shipment Order Type behaviours (3 of 17 live).** Allocation reads **Create back order** (short qty moves to `<code>-BO1`, the order is released to picking) and **Allow partial allocation** (keeps what is available, stays Shortage); Ship Order reads **Allow shipment without label**. Reader: `server/domain/so-type-flags.ts`. Seeded types "BackOrder D2C" / "Partial Allocation D2C" now carry their flag (seed + local DB). The other 14 stay read-only "Coming soon" (honest) and are specified for their owners in REQ-B1-1..4.
- **Order Merge Rule:** Newest original order, Clean state (master's notes, gift note, packing instructions, reference code and packing warning cleared, change-logged) and the **Order tag** condition (tag set, order-insensitive) now drive Order Merge waves (`repositories/order-merge-policy.ts`, used by `waves-run.runOrderMerge`). No "Coming soon" left in the drawer.
- **Location Zone put-away:** `domain/putaway.ts` already reads zone priority, max locations per SKU and zone product groups, so the settings and "Match With Product Groups" are live (`ZONE_PUTAWAY_SETTINGS_ENFORCED = true`).
- **Custom Carrier:** create / edit is a stepped wizard (General → Services → Packages → Advanced; General must validate before moving on). Services and packages rename inline; Advanced holds confirmation, insurance and billing types with inline add, rename and remove. Not yet in the order's shipping option list: REQ-B1-5 (orders owner).
- **Printers popover:** step pills (1 Warehouse, 2 Printers), **scan-to-assign** (prefix `BC:` / `LS:`, else model detection, else first empty slot), save works without the agent. **Direct Print agent shipped**: `GET /api/printers/agent` downloads `kitstak-print-agent.mjs` (Node 18+, listens on 127.0.0.1:9101, origin-locked; raw TCP 9100 for network Zebras, OS spooler otherwise). Popover shows "agent vX connected · N printers" and a **Test label** button; "Check for agent" probes on demand (no refused-connection noise for workstations without it). Help article updated. CSP `connect-src` allows the agent.
- **SSO (Apps › Single sign-on):** real OpenID Connect sign-in (discovery, PKCE, state + nonce cookie, `client_secret_basic`, ID token verified against the IdP JWKS, email → existing active user, domain allow-list, audit `auth.sso_login` success/failure). Client secret stored AES-GCM, only `••••last4` returned. "Require SSO" blocks password sign-in for non-admins (admins keep break-glass). Gear drawer shows OIDC or SAML fields by protocol, the redirect / initiate URIs to paste into the IdP, and **Test saved settings** (discovery + JWKS, or SAML certificate validity). SAML: SP metadata at `/api/auth/sso/metadata`, certificate check; assertions are refused with a clear message (sign-in uses the IdP's OIDC app). The sign-in page's disabled "Log in with SSO" placeholder is now the live button. Gear is reachable before activation; activating an unconfigured SSO opens its settings.
- **Custom Branding:** accent color re-points `--primary` app-wide (light + dark) when "Use the accent color in the app" is on, printout preview headings use it, the logo can be hidden on printouts, a sign-in page message and an email footer (invites, password emails) are configurable.
- **Custom Fields manager** (`/settings/custom-fields?entity=…`): every entity's Other Info fields (Text / Dropdown / Date / Toggle) with slot capacity, rename, dropdown options, Active switch and "Add custom field". Linked from LP Types and Shipment Packages headers ("Custom fields") and the Settings hub.
- **Seed / demo data:** `scripts/purge-critic-data.mjs` (dry run by default, `--apply`) removed 12 KS-CRIT records (7 users, 3 packing templates, 1 screen config, 1 saved view). No KS-CRIT SO types / roles / lookups existed.
- **User detail drawer:** paints from the grid row immediately (`placeholderData`), no skeleton; lists fill in when `/api/users/:id` answers.

**Verified already in place (no code change):** import-history pattern for users, LP numbers and VAS (`/imports/<key>`: template, dropzone, history with row / success / error counts, error file); Warehouse settings (LP-dimension putaway, default receive / ship / return locations, mandatory adjustment and count reasons, mobile auto-logout minutes); Change log row action on Mobile Carts, Shipment Packages, LP Numbers, LP Types, Warehouses; Job Type wizard depth (see REQ-B1-6).

**Live verification** (`C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\admin-settings\`):
- `j-sso.cjs` — mock OIDC IdP (RS256/JWKS) on :9555: settings saved (secret never echoed), Test = 4/4 OK, anonymous `/login` → "Sign in with Okta" → IdP → `/dashboard` in 1.9 s as ops.manager; unknown email refused with message; audit rows written. SSO then deactivated and its test settings cleared.
- `j-walk2.cjs` — agent downloaded and run; popover "v1.0.0 connected · 2 printers"; scan-to-assign both slots; Test label → 184-byte ZPL received on a TCP sink; Save 200. 0 console errors.
- `j-walk1.cjs` — user drawer at 120 ms: 0 skeletons, email visible; custom carrier wizard blocks Next on empty General, saves services (inline rename), package, advanced lists (inline rename) → 201 with the expected meta.
- `j-walk3.cjs` / `j-walk4.cjs` — SO type drawer 14 "Coming soon" (3 live), merge drawer all inheritance options + Order tag enabled, zone "Match With Product Groups" enabled, Custom fields link → manager (10 entities), SSO gear drawer; branding on → `--primary` #0F766E and "Add user" teal. Nine touched pages hydrate clean (0 console errors); `j-brand-hyd.cjs` clean with branding on, login message shown.
- `j-import.cjs` — users template → upload 1 good + 1 bad row → history "Partially Successful 2 / 1 / 1", error file downloads (xlsx).

**Tests:** `tests/unit/admin-settings/blind-r1.test.ts` (14 cases: allocation with no flag / partial / back order incl. ledger reconcile, flag parsing, merge master selection, tag key, clean-state patch, scan-to-assign, drawer seed, SSO schema incl. saved-secret and https rules, domain allow-list, SP metadata, brand CSS sanitising, custom-field entities). Updated round4 / settings-hub expectations. `vitest` admin-settings + foundation/domain + fulfillment-jobs: 352 passed. `tsc --noEmit` clean except `tests/unit/orders-outbound/orders-blind-r1.test.ts` (another module, in progress). ESLint on touched files: 0 errors, 0 warnings.

**Shared files touched (minimal, backward compatible):** `domain/allocation.ts`, `domain/shipping/ship.ts`, `repositories/waves-run.ts`, `db/seed/lookups.ts`, `app/login/{page,login-form}.tsx`, `api/auth/login/route.ts` (SSO enforcement), `(app)/layout.tsx` + `server/shell/shell-props.ts` (brand CSS), `next.config.ts` (CSP connect-src), LP Types / Shipment Packages page headers (Custom fields link). Requests: REQ-B1-1..8.
