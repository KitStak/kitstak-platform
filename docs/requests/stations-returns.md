# Requests from M04 stations-returns

## REQ-1 — Dedicated "Receive" permission for the Return Station
- **File:** `src/server/auth/permission-catalog-data.ts` (line ~98, `viewOnly("return_station", "Return Station")`)
- **Change:** turn it into `page("return_station", "Return Station", ["View", "Receive Return"])` so the key `inventory.return_station.receive_return` exists; grant it to admin/manager/operator (not viewer).
- **Reason:** Return Station receiving posts inventory (ledger Return Receiving). The catalog only has `inventory.return_station.view`, which the viewer role holds, so a viewer could receive returns. Until this lands, `/api/returns/receive` and `/api/returns/manual` additionally require `fulfillment.task_details.execute_task` (see `RETURN_PERMISSIONS.receive` in `src/server/repositories/returns.ts`); swap the constant once the key exists.
- **Status:** applied (F-patch 2026-11-06): `page("return_station", "Return Station", ["View", "Receive Return"])` -> `inventory.return_station.receive_return` (admin, manager and operator by default; viewer not). Granted to the live system roles via `npm run db:fixtures` (`syncSystemRoleGrants`). Swap `RETURN_PERMISSIONS.receive`.

## REQ-2 — OrderPickerDrawer and `/api/pickers/orders` disagree on the response shape
- **Files:** `src/components/shared/order-picker-drawer.tsx` and `src/app/api/pickers/orders/route.ts` (`runNamedPicker(db, "orders", …)` in `src/server/repositories/platform-pickers.ts`).
- **Problem:** the drawer runs `useLocalGrid` against `/api/pickers/orders` and expects grid rows (`code`, `status`, `customerName`, …) plus the grid grammar (`p`, `ps`, `sort`, filters). The route only accepts the picker query (`q`, `mode`, `limit`, `ids`, …) and returns `{ id, label, sublabel, meta }`. Opening the drawer gets a 400, then a row without `status` reaches `StatusPill`, and `statusToneName` throws "Cannot read properties of undefined (reading 'trim')". The whole page falls into the error boundary (reproduced on `/orders/returns/new` → "Choose a shipped order").
- **Change:** either give the drawer its own grid endpoint (e.g. `GET /api/pickers/orders/grid`, which returns `OrderPick` rows and accepts the grid grammar plus `status`, `clientId`, `warehouseId`), or map the picker options into `OrderPick` rows inside the drawer. Make `StatusPill` / `statusToneName` tolerate an undefined status too.
- **Workaround in M04:** Create RMA and Return Manually → "Link a shipped order" now use a local `ShippedOrderPicker` (`src/components/returns/shipped-order-picker.tsx`) over the picker API. Once the drawer works, M04 can switch back or keep the local dialog.
- **Status:** applied (F-patch 2026-11-06): same fix as shipping REQ-3: `GET /api/pickers/orders/grid` + drawer switched to it; `StatusPill` / `statusToneName` tolerate undefined status.

## REQ-3 — Persist station choices in user preferences (remembered per user on any device)
- **File:** `src/lib/domain-types.ts` (`userPreferencesSchema`, line ~178).
- **Change:** add `stations: z.object({ packing: z.object({ warehouseId: z.string().nullable(), stationId: z.string().nullable() }).partial(), returns: z.object({ warehouseId: z.string().nullable(), stationId: z.string().nullable(), targetKind: z.enum(["location", "lp"]), targetId: z.string().nullable(), targetCode: z.string().nullable() }).partial() }).partial().optional()`. `PATCH /api/me` then merges it like the other preferences.
- **Reason:** M04 §1 says the Packing Station warehouse and station are "remembered per user". `userPreferencesSchema` strips unknown keys, so M04 can only use per-browser localStorage today (`src/components/packing/station-memory.ts`). A packer who switches devices starts empty.
- **Adapter:** `useStationMemory()` keeps its signature. When this lands it reads from `useMe().data.preferences.stations[kind]` and writes through `PATCH /api/me { preferences: { stations } }`, with localStorage as the offline fallback.
- **Status:** applied (F-patch 2026-11-06): `userPreferencesSchema.stations` added as requested; `PATCH /api/me` merges `stations` per kind (packing / returns) so saving one keeps the other.

## REQ-4 — Shared tokens fail WCAG AA contrast on M04 pages (axe "color-contrast", serious)
- **Files:** `src/app/globals.css` (`--color-faint` / `text-faint` = #98a2b3), `src/components/ui/select.tsx` (placeholder span), `src/components/ui/stat-tile.tsx` (uppercase label `text-faint`), `src/components/ui/wizard/*` (rail title and `RailRow` label `text-faint`), and the status color map behind `StatusPill` (Completed / success = #17874d on #d3f0e3, 3.76:1).
- **Change:** darken `--color-faint` to about #667085 (4.5:1 on white and #f6f7f9), or move those labels to `text-secondary`. Darken the success pill foreground to about #0e6b3b (≥4.5:1 on #d3f0e3).
- **Reason:** `tests/e2e/stations-returns` runs axe on /packing-station, /return-station, /orders/returns and /orders/returns/new. M04's own components no longer use `text-faint` for text (they use `text-secondary`). The remaining violations all come from these shared primitives, so the spec excludes them by selector until this lands.
- **Status:** applied (F-patch 2026-11-06): `--text-faint` darkened to #667085 (light theme; 4.6:1 on #f6f7f9), which fixes select placeholders, stat-tile labels and wizard rail labels; success / green pill fg darkened to #0E6B3B. Grid headers, tabs and breadcrumbs also moved to `text-secondary` (inventory REQ-3). Dark-theme `--text-faint` is unchanged.
- **Foundation pass 1 (2026-11-09):** verified all REQs above are DONE (pass 1); no further shared change pending.
- **Foundation pass 2 (2026-11-09):** re-verified against the code; all REQs above DONE (pass 2), no further shared change pending.

## Round 2 requests

### R2-1 — Playwright browser revision mismatch breaks `--project=e2e` locally
- **Owner:** foundation (`playwright.config.ts` / tooling).
- **Problem:** the installed `@playwright/test` launches `chromium_headless_shell-1187`, but only `chromium_headless_shell-1254` (and `chromium-1254`) are installed under `%LOCALAPPDATA%\ms-playwright`. Every e2e test fails at `browserType.launch` ("Executable doesn't exist").
- **Change:** either run `npx playwright install chromium` in the setup docs and CI, or pin `@playwright/test` to the version that matches revision 1254. A third option is to honour an env override in `playwright.config.ts` (for example `use.launchOptions.executablePath = process.env.PW_CHROMIUM_PATH`).
- **Workaround used by M04:** a throwaway config outside the repo (`%TEMP%\claude\kitstak-critic\stations-returns\pw.config.cjs`) with `launchOptions.executablePath` pointing to the 1254 headless shell. With it, `tests/e2e/stations-returns` ran 7/9 on the shared dev server. The 2 failures were the new pill-count test, blocked by R2-2, and a Change Status modal that timed out while the server was under load. The Change Status test passed on both earlier runs that day.

### R2-2 — Dev server keeps serving a stale server module after an edit (informational)
- **Observed 2026-11-09:** after `returnStatusCounts` in `src/server/repositories/returns-grid.ts` was changed to count RMA lines, `GET /api/returns/summary` briefly returned line counts and then went back to RMA counts. This held even after the file was touched and the route file was edited. At the same time another module's file had a parse error (`billing-edit-page.tsx:282`).
- **Ask:** whoever owns the shared dev server should restart `next dev` once the parse errors are cleared, so the live pills match the grid total again. The unit test `status pill counts agree with the grid total` covers the code.

## Round 2 requests
- **REQ-5 (nav config / F-shell):** move "Return Station" and "Return Orders" from the Inventory mega-menu to Fulfillment, matching Logiwa and the orders tab strip. On /return-station and /orders/returns*, the top nav highlights Inventory. M04 pages already pass explicit Fulfillment breadcrumbs.
- **REQ-6 (shared wizard, `use-wizard.ts` validityPercent):** the progress ring counts optional steps as complete before the user visits them. Create RMA shows 33% "In progress" at the start and 100% "Ready to save" on step 2. Proposed fix: count a step only when it is valid **and** has been visited, so the ring starts at 0%.
- **REQ-7 (DataGrid header):** truncate header labels with an ellipsis and a `title` tooltip when a user resizes a column narrower than its label. M04 sets minSize per label as a workaround.
- **REQ-8 (tooling):** `package-lock` pins Playwright 1.55, which needs chromium 1187, but only 1254 is installed. `npx playwright test` fails to launch for every module. Align the version, or run `npx playwright install`.
- **REQ-9 (receiving owner):** `src/components/receiving/receive-items-drawer.tsx:130` had an unterminated string. While it is broken, the whole dev compile fails and every API route returns 500, including /api/returns/shippable*.
- **REQ-5 (re-raised in round 3, still open):** the top-nav active item is still Inventory on /orders/returns, /orders/returns/new, /orders/returns/[id] and /return-station. The breadcrumb says Fulfillment, and /packing-station correctly highlights Fulfillment. Fix this in the shared nav config: map `/return-station` and `/orders/returns` to the Fulfillment group, or derive the active group from the longest matching href. M04 cannot change it.
- **REQ-6 (re-raised in round 3):** the Create RMA progress ring still comes from the shared `use-wizard` validity percent, which counts unvisited optional steps as complete (67% with 0 lines). M04 now blocks Next on step 1 with a reason ("Loading the order…") until the order lines load, and no longer shows the validation error during loading.
- **REQ-10 (DB indexes, schema owner):** `/api/returns` and `/api/returns/summary` now share one WHERE clause. With hundreds of thousands of rows they need these indexes: `return_order_lines(return_order_id)`, `return_orders(warehouse_id, client_id, status)` and `return_orders(created_at)`. The 34–89 s the critic measured was dev-server load; the same queries take milliseconds on the seed data in unit tests.

## Round 2 requests (parity loop pass 2, 2026-11-09)
- **REQ-11 (schema owner, indexes for scanner paths):** `findOrdersByCode` and `lookupRmas` now hit indexed columns first, using exact case variants. They fall back to `lower(col) = ?` scans only on a miss. To make misses and mixed-case codes O(log n) as well, add these expression indexes:
  - `shipment_orders(lower(code))`
  - `shipment_orders(lower(store_order_number))`
  - `shipment_orders(tracking_number)`
  - `return_orders(lower(rma_code))`
  - `return_orders(tracking_number)`
  - `locations(warehouse_id, lower(code))`
  - `license_plates(warehouse_id, lower(number))`

  Also add `return_orders(created_at)` (REQ-10) for the grid's default sort, which uses a temp B-tree today.
- **REQ-5 (decision needed, nav-config vs M04 breadcrumbs):** in Logiwa, Return Station and Return Orders sit under **Inventory › Inbound**, and `src/config/nav-config.ts:199-200` matches that. The M04 breadcrumbs currently say "Fulfillment" (a concurrent edit reverted them from Inventory). Either keep nav-config and make the M04 breadcrumbs "Inventory" (recommended: no shared change needed), or move both items to the Fulfillment group in nav-config. The two must agree.
- **REQ-12 (shared toast position):** bottom-right toasts cover sticky page footers. On the pack screen, a toast sits over the primary "Complete packing" button. M04 no longer toasts on the rate step for this reason. Suggest raising the toast viewport above sticky footers (e.g. `bottom: 80px` when `[data-sticky-footer]` is present), or moving toasts top-right.
- **R2-2 (re-raised):** the dev server again served stale route bundles. `POST /api/packing/orders/[id]` returned a pack context without the new `hospital` field while `GET` on the same module returned it. `/api/returns/lookup` reverted to an older query schema after briefly serving the new one. Please restart `next dev` once the sibling parse errors (`shipment-plans.ts:285`, `jobs/list-shell.tsx:65`) are fixed.
- **REQ-5 (round 4, still open, top priority):** `src/config/nav-config.ts`: move the "Return Station" and "Return Orders" items from the Inventory › Inbound column to Fulfillment › Outbound (or a "Returns" column in Fulfillment). Every M04 breadcrumb now says Fulfillment, but the nav highlight still says Inventory on /return-station and /orders/returns*.
- **REQ-11 (DataGrid, round 4):** `src/components/grid/data-grid.tsx`: hold the column layout (render the skeleton) until `useGridPrefs(...).isLoaded`. Today the code-default order paints first and then jumps to the saved order (critic: STATUS moved from after FROM COUNTRY to 3rd). M04 cannot see `isLoaded` from `useGrid`.
- **REQ-12 (shared wizard, round 4):** `WizardStep` needs a `busy?: (values) => boolean` (or a `canProceed` result of `{ busy: true, reason }`) so Next shows a spinner while a step is loading. Create RMA returns "Loading the order…" as the disabled reason and shows a spinner in the step body, but the button itself has no busy state.
- **REQ-13 (API catch-all, round 4):** unknown `/api/*` paths return the HTML 404 page. Add `src/app/api/[...slug]/route.ts`, returning `{ success: false, code: "NOT_FOUND" }` with status 404 for every method. M04 added `GET /api/returns/[id]/history` as a JSON route itself.
- **REQ-14 (schema, round 4):** add an index on `return_order_lines(order_line_id)`. `committedReturnQty` (used by create and validation) still scans per line. M04 rewrote the hot path (`shippableOrder`) to group by the order's RMAs instead.

## Round 2 requests
- (round 5, foundation/tooling) Playwright browsers are out of sync: `@playwright/test` wants chromium_headless_shell-1187, but only 1254 is installed. Please run `npx playwright install chromium` or pin a matching version so critic and builder runs work.
- (round 5, fulfillment-jobs) Keep the `waves-run.ts` exports stable. A missing export breaks compilation of every route that shares the module graph, including /orders/returns.
- (round 5, orders-outbound) Add the default "Actual Shipment Date: Last 7 days" chip on the Shipped and Cancelled order lists (Logiwa parity).
- (round 6, foundation/theme) OS dark mode is ignored: with `prefers-color-scheme: dark` and no explicit in-app choice, /orders/returns (and every page) renders light. Please make the theme provider default to "system" (follow `prefers-color-scheme`) when the user has not picked a theme, or document that dark mode is opt-in.
- (round 6, foundation/seed) Please add MLT1 acceptance fixtures that stay packable after a critic walk: at least one Ready to Pack order with picked stock in a tote LP, one on a putwall/mobile cart cell, and one in plain location stock. This lets the hospital (Report issue → Pack Short Open), tote and putwall flows be shown end to end. A re-seed that resets these orders each run would be best.
- (round 6, tooling) Playwright: launching with `executablePath` pointing at `ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-win64/chrome-headless-shell.exe` works. The default resolution (build 1187) still fails, so the browser pin is still mismatched.

## Round 2 requests (parity loop round 3, 2026-11-10)

### R3-1 — `return_orders.return_shipping_cost` column (owner: foundation schema `src/server/db/schema/returns.ts`) — superseded by R4-1
Create RMA now records a manual Return Shipping Cost (Logiwa Return section). `return_orders` has no cost column, so M04 writes it to the linked `shipment_orders.return_shipping_cost` (with a change-log row on the order), and the RMA detail reads it back from there. Two RMAs on the same order therefore share one cost. Please add `return_shipping_cost real` (nullable) to `return_orders` (+ migration). M04 will then switch `recordReturnShippingCost` in `src/server/repositories/returns.ts` to the RMA row. A JSON `return_tracking_numbers` column would also be welcome; until then several tracking numbers are stored comma-separated in `tracking_number`.

### R3-2 — `ENTITY_LABELS.return_order_line = "Return Order Line"` (owner: foundation `src/server/domain/change-log.ts`)
**Resolved 2026-11-10:** foundation added `return_order_line: "Return Order Line"`, so rows now read `SKU -> Return Order Line is created.`
- **Status:** DONE (foundation round 2, 2026-11-10): label added; parity-r3 test updated.

### R3-3 — Toast viewport offset for sticky footers (owner: shared UI `src/components/ui/toaster.tsx`)
REQ-12 follow-up. M04 lifts the toast viewport above the pack-screen / Return Station sticky footer with a scoped `<style>` (`src/components/packing/toast-offset.tsx`) that targets `[role=region][aria-label^="Notifications"] > ol`. That depends on Radix's markup. Please expose a CSS variable on the viewport (for example `bottom: calc(1rem + var(--toast-offset-bottom, 0px))`) so pages can set `--toast-offset-bottom` instead.

### R3-4 — `toDate()` should read "YYYY-MM-DD" as a local date (owner: foundation `src/lib/format.ts`)
`new Date("2026-11-20")` is UTC midnight, so `fmt.date("2026-11-20")` renders Nov 19 west of UTC. M04 now passes local `Date` objects (`src/components/returns/date-only.ts`) everywhere it shows `expected_return_date`. The shared `toDate` should treat a bare date string as a local calendar date, so other modules' date-only fields are correct as well.
- **Status:** DONE (foundation round 2, 2026-11-10): `toDate()` reads a bare `YYYY-MM-DD` as a local date.

### R3-5 — Tote / putwall pack fixtures (owner: seed `src/server/db/seed/**`)
The critic could not show Tote and Putwall/Mobile Cart pack modes end to end because no seeded order is picked into a tote LP or sorted into a mobile cart. Please seed one MLT1 order picked to a tote (e.g. `TOTE-0001`) and one sorted into a cart cell (e.g. `CART-01`), both Ready to Pack.
- **Status:** addressed in M04, round 4 (2026-11-10). `npx tsx tests/e2e/stations-returns/seed-station-fixtures.ts` seeds idempotent MLT1 fixtures through the domain: a tote LP at PACK-01, plain location stock at PACK-02, an MC-01 cell, an order at PACK-04, and HOSP-01 holding a pack-short order. Folding it into `db:fixtures` is still welcome (R4-4c).

### R3-6 — Duplicate `parseCountedText` export breaks every test that imports the domain graph (owner: counts)
At 00:38 on 2026-11-10, `npx vitest run tests/unit/stations-returns` failed in 7 files with `Duplicated export 'parseCountedText'`. The same build error also made the dev server answer every `/api/*` request with an HTML error page. Not an M04 file. **Resolved by 00:39**: the suite went back to green with no M04 change.

## Round 2 requests (blind-judge repair round 2, 2026-11-10)

### BJ2-1 — Create RMA from the Shipped orders grid toolbar (owner: orders-outbound, shipped-orders list page)
Logiwa starts Create RMA from the Shipped Orders grid: select rows, then **Create RMA** in the toolbar. Please add a toolbar action on the Shipped tab, gated by `fulfillment.shipment_orders.create_rma`. For one selected order it navigates to `/orders/returns/new?orderId=<id>`. With several selected, it is disabled, with the reason "Select one shipped order". M04's `/orders/returns/new` already preloads `orderId`.

### BJ2-2 — Returns-platform channel placeholder (owner: automation-integrations)
Please add a "Returns platform" integration type (for example Loop or ReturnGO) with a connect stub and an inbound webhook placeholder `POST /api/integrations/returns/webhook`. It maps an external return to `POST /api/returns` (RMA create, with `channel = <platform>`). Until this exists, M04 has no external returns hook.

### BJ2-3 — Return Orders grid at SKU-line grain (owner: M04, needs schema from foundation)
Several of Logiwa's 25 line-level columns have no column in our schema yet: from country, return address, carrier option, store order number and pack type. Please add these nullable columns to `return_orders` in `src/server/db/schema/returns.ts`: `from_country`, `return_address_json`, `carrier_option`, `store_order_number` and `pack_type`.

## Round 2 requests (parity loop round 4, 2026-11-10)

### R4-1 — Per-RMA return cost and tracking columns (owner: foundation schema `src/server/db/schema/returns.ts` + migration). Supersedes R3-1.
Add to `return_orders`:
- `returnShippingCost: real("return_shipping_cost")` (nullable)
- `returnTrackingNumbers: json<string[]>("return_tracking_numbers")` (nullable JSON array)

plus a generated migration in `drizzle/`. **M04 needs no code change afterwards.** `rmaExtraColumns()` in `src/server/repositories/returns.ts` detects both columns (it re-checks via `pragma_table_info` every 60 s) and then:
- writes cost and tracking per RMA, with a change-log row on the return order;
- reads them on the RMA detail.

Until the columns exist, the code falls back to `shipment_orders.return_shipping_cost` and the comma-joined `tracking_number`. Unit tested both ways in `round4-parity.test.ts`, where an ALTER TABLE simulates the migration. Exact tracking search, filters and the Return Station lookup already match each number in a multi-number value.

### R4-2 — Wizard Next button: expose the disabled reason on the button itself (owner: shared UI `src/components/ui/wizard/wizard.tsx`)
`Footer` wraps a blocked Next in `<DisabledReason>`. The reason is then only in the wrapper span's `aria-label` and in the tooltip. The `<button disabled>` itself has no `title` or `aria-describedby`, so headless and assistive-technology checks read it as "no reason" (critic R3, Create RMA step 1). Please add `title={nextBlocked ?? undefined}` and `aria-describedby` pointing at an `sr-only` span that holds the reason. In the meantime, M04 shows the reason as visible text under the Order step (`#rma-next-reason`).

### R4-3 — Grid prefs request needs a timeout (owner: shared grid `src/components/grid/use-grid-prefs.ts`)
`useRemotePrefs` waits on `GET /api/grid-prefs/<key>` with no timeout, and `isLoaded` stays false until it answers. On a slow or failing server, the Return Orders grid (and every grid) shows skeleton columns, "Total: —" and "…" pills (critic R3).
- Please abort after about 3 s and fall back to default columns (`setState({ key, raw: null })`), the same way the `.catch` already does.
- The list itself already times out at 30 s with an error state (`use-grid.ts` GRID_TIMEOUT_MS).

### R4-4 — Hospital designation in Location setup (owner: M10 facility-config, plus foundation for an optional column)
Report Issue now uses **only explicitly designated hospital locations** (`src/server/repositories/packing-hospitals.ts`):
- an active, non-virtual location in a Location Group named **"Hospital"** (lookup `location_group`); or
- a location whose code starts with **HOSP**.

There is no fallback to Returns-area / Return Station bins any more.

Requests:
- (a) M10: in the location wizard / detail, show a hint that the "Hospital" location group designates a Report Issue hospital, or offer a "Hospital location" toggle.
- (b) Optional, foundation: a first-class `locations.is_hospital` boolean. M04 would add it to `isHospitalLocation()` as a third designation.
- (c) Foundation seed (`acceptance-fixtures.ts` / `db:fixtures`): add `HOSP-01` (Storage, Shelves, Prevent Allocation) to MLT1, so a fresh `db:reset` has a hospital.
  - `tests/e2e/stations-returns/seed-station-fixtures.ts` creates it today if it is missing.

### R4-5 — Shared dev server wedged again (informational, environment)
At 02:41 on 2026-11-10, PID 47592 (`next dev`, 5.6 GB working set) still held :3000. Its listening sockets were in FIN_WAIT_1, and `/api/health` and `/login` timed out at 60–90 s. M04 was told not to restart it. A restart is needed before any critic walk.

## Round 2 requests (parity loop round 5, 2026-11-10)

### R5-1 — Return Station photos need an attachment permission the station operator has (owner: foundation `src/server/repositories/platform-entities.ts`)
The Return Station uploads per-line photos as `return_order` attachments (`POST /api/attachments`). The `return_order` entity def gates `edit` on `inventory.return_orders.change_status` only, so a station operator who has `inventory.return_station.receive_return` but not Change Status receives the units, but the photo upload is refused. The station then shows "Some photos weren't saved".
Please change the `return_order` def to `edit: ["inventory.return_orders.change_status", "inventory.return_station.receive_return"]`. `canAny` semantics already allow either key.

### R5-2 — Return state machine: allow Completed → Started for a short close only (owner: foundation `src/server/domain/state-machines.ts`)
M04 now reopens a short-closed RMA (Completed with units outstanding) through `reopenReturn()` in `returns-receive.ts`. That transition is outside the generic machine on purpose, because only a short close may reopen. A guarded transition would let the generic Change Status modal offer "Reopen" consistently:
- `Completed: ["Started"]`
- with a check that refuses when every line is fully received (`ctx.shortQty === 0`).

Until then, the generic modal keeps reporting "Completed returns can't be changed", and the dedicated Reopen action on the RMA does the work.

### R5-3 — Per-RMA return cost / tracking columns (R4-1, still open; owner: foundation migration)
`PRAGMA table_info(return_orders)` still shows no `return_shipping_cost` or `return_tracking_numbers` column. M04 detects both at runtime (`rmaExtraColumns()`) and needs no change once the migration lands.

### R5-4 — Shared dev server :3000 still wedged (informational)
At 03:20 on 2026-11-10, PID 47592 (`next dev`, about 9 GB working set) accepted connections but never answered: `/api/health` gave no response in 20 s. M04 verified this round on a production build instead (`next build` plus `next start -p 3124`, from a copy under `%TEMP%\claude\kitstak-critic\stations-returns\prodbuild`). That build answered every M04 route with its h1 in under 0.5 s and every API in under 15 ms.

## Round 2 requests (parity loop round 6, 2026-11-10)

### R6-1 — Refuse Ship when an order has no active outbound label (owner: shipping / orders-outbound, `src/server/domain/shipping` `shipOrders`)
`npm run db:verify` failed with `shipped_without_label=1` for SO010845:
- M04 packed it at 06:16 (Ready to Ship, tracking 1ZKS07390234326667).
- j.okafor voided the label at 07:01.
- The order was still shipped at 09:26 with no active label.

Please make `shipOrders` refuse an order that had a Shipping Label which is now Voided and has no Active label. The message could be "SO… has no active shipping label (voided at …). Create a new label or pack without label first". The `requireLabel: false` path should be refused too when the only labels were voided, because a voided label means the parcel was never handed to the carrier.

M04 side, done this round: the Create RMA order picker now flags such orders with "Outbound label voided: check the shipment" (`outboundLabelVoided` in `returns-search.ts`), so a return is not authorised blindly.

### R6-2 — StatusPill dark-mode tokens (owner: shared UI `src/components/ui/status-pill.tsx` + `src/lib/status-colors.ts`)
`StatusPill` paints its light pastel `bg` inline, so on dark surfaces every badge glares, and no class can override it without `!important`.
- Please add dark variants per tone, for example a translucent fill (`color-mix(in srgb, fg 22%, transparent)`) and a lifted fg, chosen under `:root[data-theme="dark"]`.
- Until that lands, M04 return surfaces pass `className={DARK_SAFE_PILL}` (`src/components/returns/returns-client.ts`), an `!important` tint plus a brightness lift. Remove it once the shared pill is theme-aware.

### R6-3 — Disabled DropdownMenuItem should look disabled (owner: shared UI `src/components/ui/dropdown-menu.tsx`)
A `disabledReason` item keeps its full-contrast icon, and a `destructive` one keeps the red icon and text. The reason is only in a tooltip.
- Suggestion: when `isDisabled`, add `opacity-60`, force the icon to `text-faint`, drop the destructive colours, and render `disabledReason` as the description line.
- M04 does this locally on the Return Orders Label menu (`MUTED_ITEM`, with the reason as the description). Every other module would benefit.

### R6-4 — One home for returns in the navigation (owner: shared `src/config/nav-config.ts`)
Today Return Orders sits under Fulfillment › Outbound and Return Station under Inventory › Inbound. M04 breadcrumbs now match the nav exactly:
- "Fulfillment › Outbound › Return Orders" (it is in the Order Backlog / Shipped & Canceled / Return Orders tab strip);
- "Inventory › Inbound › Return Station".

If the product owner prefers Logiwa's grouping, which files both under Inbound, move the Return Orders nav item next to Return Station and tell M04 to switch the breadcrumbs and tab strip in the same change.

### R6-5 — Ledger count-lock error should carry the location id (owner: foundation `src/server/domain/ledger/count-locks.ts`)
`assertNotCountLocked` throws `{ countPlanCode }` only. Adding `locationId` and `locationCode` to the details would let every caller map the refusal onto the right field without re-querying. M04 now pre-checks with `packing-locks.ts`, so this is a nice-to-have.

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** R2-1 / REQ-8 / round 5-6 tooling (`PW_CHROMIUM_PATH` in `playwright.config.ts`), REQ-5 / R6-4 (nav already consistent: Return Orders under Fulfillment, Return Station under Inventory › Inbound), REQ-6 (ring counts visited steps only), REQ-7 (header labels truncate with `title`), REQ-10 / REQ-11 (partial) / REQ-14 (indexes `return_orders(warehouse_id, client_id, status)`, `return_orders(created_at)`, `return_order_lines(order_line_id)`; expression `lower()` indexes not added), REQ-11 DataGrid prefs (3 s timeout), REQ-12 / R3-3 (toasts top centre; `StickyFooterToastOffset` now only sets `--toast-offset-bottom`), REQ-12 wizard `WizardStep.busy`, REQ-13 (`/api/[...slug]` JSON 404 for every method), R4-1 / R5-3 (`return_orders.return_shipping_cost` + `return_tracking_numbers`, migration 0003, applied to the dev DB; round4 test updated), R4-2 (blocked Next carries `title` and `aria-describedby` plus a visible reason), R4-3 (prefs timeout), R5-1 (`return_order` edit accepts `inventory.return_station.receive_return`), R5-2 (guarded `Completed → Started` when `ctx.shortQty > 0`), R6-1 (ship refuses an order whose labels were all voided, `requireLabel: false` included), R6-2 (StatusPill dark mode; `DARK_SAFE_PILL` can go), R6-3 (disabled DropdownMenuItem), R6-5 (count-lock error details carry `locationId` / `locationCode`).
- **Not done:** round 6 theme default "system", BJ2-1 (M01), BJ2-2 (M12), BJ2-3 extra return columns, R4-4 `locations.is_hospital` and HOSP-01 fixture, R3-5 fixtures fold-in, dev-server items.

## Round 2 requests (blind-judge repair round 1, 2026-11-10)

### BJR1-1 — Fold `pack_drafts` into a migration (owner: foundation, optional)
M04 now keeps in-progress pack state per order in `pack_drafts` (order_id PK, station_id, state JSON, updated_by, updated_at). `ensurePackDraftTable()` in `src/server/repositories/packing-drafts.ts` creates it with `CREATE TABLE IF NOT EXISTS` on first use. A Drizzle schema entry plus a migration would make it visible to `db:generate` and to drift checks. No M04 change is needed once it lands.

### BJR1-2 — Returns-platform connection UI (owner: automation-integrations, optional)
`POST /api/returns/import` (M04) is the inbound hook for Loop-style returns (`channelConnectionId` optional). A "Loop Returns" channel connection, with a webhook or poller that posts there, would make imports automatic. `channel-catalog.ts` already lists `loop-returns`.
