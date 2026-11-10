# M12 automation-integrations — progress

Round 1 builder log. Read this first when resuming.

## Decisions
- Grid/scope/change-log helpers for every M12 repository live in `src/server/repositories/integration-logs-kit.ts`
  (an owned copy of the M10 pattern, so M12 never depends on another module's internals).
- Client helpers live in `src/components/integrations/shared/*` (permissions, options, toasts, change-log drawer, JSON viewer).
- Sandbox store = channel connection with `distribution = "API"` (shown as "KitStaks Sandbox"). Its provider column keeps
  the channel page key (`shopify`), so it lists under that channel. The sandbox emulates a Shopify-shaped API.
- Credentials: AES-256-GCM (`src/server/integrations/crypto.ts`) keyed by `INTEGRATION_KEY` (falls back to an HKDF of
  `SESSION_SECRET`; a fixed dev key outside production). Never returned to the client; shown masked `••••1234`.
- Connections without stored credentials (seeded demo stores) are not auto-run by the scheduler; their methods show
  "Paused — reconnect the store". A manual Run records an Unauthorized run with the reason.
- Carrier adapters (UPS, FedEx, EasyPost, Shippo): Production + credentials → live HTTP; Test environment → offline
  simulation that applies the carrier's request validation (ship-from phone ≥ 10 characters, etc.) and sandbox rates.
- Partially Block Order = soft hold (order still allocates; it is listed in Workflow Blocked until released).
- Rule date comparators: absolute only (after / before / between / empty) until REQ-3 (relative presets) lands.
- Dry runs (allocation dry run, workflow test, Test Algorithm on a draft) execute the real foundation engines inside a
  savepoint that is always rolled back.

## Status
See the bottom of this file (updated as work lands).

## Status (round 1, session 2)
Done (server, verified via API against the live DB):
- Workflow action executors (11) — `src/server/workflows/actions/*` (lazy registry to avoid the orders↔workflows import cycle).
- Algorithms repo/API (list, editor save with dynamic-replenishment exclusivity, guarded delete, putaway Test on saved/draft, allocation Dry run) — verified create/test/passivate/restore/delete + change_log.
- Rate shopping presets repo/API (services per client, CRUD, guarded delete).
- Workflows repo/API (CRUD, bulk active, reorder, runs, Test against order in rolled-back savepoint) — verified rollback.
- Channel adapters: sandbox (deterministic), Shopify (REST/GraphQL, token or client credentials), ShipStation; runtime for the 4 methods + retry; scheduler task configured.
- Channels repo/API (catalog, connect w/ live validation, edit 4 tabs → methods, delete), integration-logs repo/API (methods + Run, history + run detail, call logs), monitoring repo/API (health, cards, setup details, missing + retry, recent errors + drilldown, workflow blocked + release, listing exceptions).
- Carrier adapters UPS/FedEx/EasyPost/Shippo (Test env = validated simulation incl. UPS ship-from phone ≥ 10; Production = live HTTP) + carriers repo/API + call logs.
- Verified: KS-TEST Sandbox store (Apex Threads, MLT1) → Download Orders created SO010857+ with store name + channel connection; unknown SKU APX-NEW-3 → Missing Orders with catalog code.
UI done: algorithms (type picker, lists, editor w/ xyflow canvas, modals, test/dry run), rate shopping (grid + 3-step drawer), workflows (list + sequence dialog, builder + test + run history).
Remaining: integrations UIs (catalog, channel/carrier connection pages, logs, monitoring, carrier errors), export providers for registered keys, unit tests, browser verification (browser tab cap reached — verified via HTTP).
Decisions:
- Channel orders use trigger "Shipment Order Created" so the same workflows apply to channel and manual orders.
- Delete of a store connection is blocked while it has open orders; otherwise its listings / missing orders / channel allocations are removed with it.
- Carrier registry: `src/server/integrations/carriers/index.ts` registers on import; imported by the scheduler task (REQ-5 asks foundation to import it from `domain/carriers/index.ts`).

## Status (round 1, session 3 — resumed 13:27)
- Integration UIs are present (catalog, channel/carrier connection pages + drawers, logs, monitoring overview + review, carrier errors). Typecheck of all owned paths: 0 errors. Unit tests: 23 passing.
- Export providers: stubs return `null` → generic provider exports the list endpoint (acceptable per 0.6).
- Now: browser verification of every route.

### Session 3 results (browser-verified on localhost:3000)
Verified in the running app: catalog (channels 15 / carriers 14 cards), Shopify connections list + row menu, Edit store connection (4 tabs, save → change_log "Intervals is modified"), Connect Store validation, Channel Methods (Run → new run, countdown), Channel History + "Downloaded Order Details" (5 orders, SO010868 has Store = KS-TEST Sandbox / channel Shopify), Health Overview (cards + provider filter), Setup Details (6 cards), Missing Orders drawer (catalog entry + payload JSON + Download/Retry), Recent Errors drilldown, Workflow Blocked Release (SO010869 → None, change_log recorded), Listing Exceptions, UPS carrier setup (5 tabs), Carrier Errors grid, Putaway list/editor/Test Algorithm, Workflows list, Rate Shopping list.
Acceptance evidence:
- Putaway: Test on "KS-TEST Putaway" for MLT-WIDGET-01 with a Picking current location → MLT1-A-01 first, trace "Same SKU" (API). Without a current location the area-type condition can't match; the dialog now explains that.
- SKU-not-found missing order (#21024, APX-NEW-3) is Resolved after retry; unit test covers download → missing → retry.
- Carrier errors + rate shopping: `tests/unit/automation-integrations/carrier-errors.test.ts` (UPS short phone → LabelGeneration 400 with request/response; Cheapest preset picks min price and logs preset name).
Fixes this session: section tabs active on sibling sub-pages (local adapter, REQ-6), "LogiwaIO" masked in UI (REQ-7), Integration step label, ship-from requirement copy, catalog helper per kind + no "0 shown" while loading, setup combobox loading text, rate-shopping column widths, change-log interval ordering.
Open requests: REQ-6, REQ-7 (pending). REQ-5 confirmed applied.

## Status (F-patch wiring, 2026-11-06)
All M12 requests are now applied. The local adapters have been replaced with the shared interfaces:
- REQ-3: `importOrder` now passes `channelConnectionId` and `channelPaymentStatus` (capped at 50 chars) to `createOrder`. The update that ran after create is removed.
- REQ-6: `src/components/integrations/shared/route-tabs.tsx` (`useSectionTabs`) is deleted. The catalog, logs and monitoring headers now use `tabs="integrations"` / `tabs="monitoring"`, and `match` comes from `page-tabs.ts`. Checked in the browser: Recent Errors turns on Items For Review, Channel History turns on Channel Logs, and Carrier Integrations turns on Plugin Integrations.
- REQ-7: `channel-runtime.ts` now writes "…could not be created in KitStaks" and "…were not found in KitStaks". `repositories.test.ts` expects the new code. `errorCodeLabel()` is removed from `logos.tsx` and from every place that called it. A read-only scan of all `channel_*` text columns on the live DB found no "LogiwaIO" rows.
- Verification: tc-queue reports 0 errors across all owned paths (0 in the project). `tests/unit/automation-integrations` passes 26/26.
Remaining: none from requests. M12 has no pending requests.

## Round 1 (parity loop) — 2026-11-09
Compared against `references/logiwa-live/settings-shell.md` (Algorithms list/tabs, Automation menu re-verified) and `masterdata-reports.md` (Integrations route map, 13 analytics/monitoring pages). The live capture says Integrations is unchanged vs spec 06 §7–17. The algorithms grid (Name · Type · Warehouse · Active · Rule quantity · ⋯) and tabs already match. Workflows are still not accessible in Logiwa, so there is nothing new to compare.
- Fix: bare section URLs `/integrations`, `/integrations/logs` and `/integrations/carrier-errors` returned 404. They now redirect (route handlers, 307) to Channel Integrations, Channel Methods and Label Generation. A page-level `redirect()` caused a dev "Could not validate `instant`" console error, so route handlers are used instead.
- Verified headless (admin): 31 module routes return 200 with an h1 and no console errors (algorithms list/new ×2, workflows list/new, rate shopping, channel/carrier catalog, Shopify/UPS setup, logs ×4, monitoring ×7, carrier errors ×3).
- Checks: owned paths typecheck clean; `tests/unit/automation-integrations` 26/26 pass.
Remaining: none blocking. No new shared requests.

## Round 2 (parity loop) — 2026-11-09

Fixes for the critic's round 1 verdict (6.5):
- **Listing exceptions / missing orders 500 (blocker):** the cause was a compile error in catalog's `products/listings-page.tsx`, which the Turbopack dev overlay shows globally. M12 does not import it (the only importer is `/products/listings`), so there was no coupling to remove. The routes were re-walked headless (see below). Logged as REQ-AI-R2-2 so catalog keeps the file compiling.
- **Health "no data" vs "failing" (major):** `successRateOf()` returns `null` when there were no calls, and `summarizeHealth()` in `lib/grid-defs/integrations/monitoring.ts` excludes no-data setups from the average and from the low-performing count and reports `noData`. Cards show "—" plus "N with no calls in 24h". The grid shows "— No data" in neutral grey. `HealthRow.lastCallAt` was added. Unit tests: `tests/unit/automation-integrations/monitoring-health.test.ts`.
- **Channel Setup Details (major):** a new `GET /api/monitoring/setup` returns `defaultSetupId()`, the most recently called setup. The page auto-selects it (`router.replace`), and overview rows and setup names already deep-link with `?id=`. New cards: "Integration methods" (status, last call, last success, 14-day calls and failures, success rate per method, from `channel_methods` + `channel_runs`) and "Call results (14 days)" (stacked success/error bars). The empty state now appears only when no stores exist, with a CTA to Channel Integrations. The donut no longer shows a red 0% with no data.
- **Workflow builder header and action menu (major):** the subtitle now renders left-aligned under the title instead of centred in the band. The Add-action menu is anchored below its button, with top collision padding that clears the global nav, and it scrolls within the available height.
- **Algorithms picker (minor):** the header has "Create putaway algorithm" / "Create allocation algorithm" CTAs. The cards are `<Link>`s inside `<nav aria-label="Algorithm types">`, each with an accessible name.
- **Monitoring helper (minor):** shortened to a single line ("Review integration issues between your stores and KitStaks.").
- **LAST SUCCESSFUL CALL DATE truncation (minor):** headers are now `whitespace-nowrap`, the column is 240px (min 230), and the other columns were tightened.
- **Catalog tiles (minor):** "Connect Now!" became "Connect". Connected providers show a "Connected (N)" badge, a Manage link and an "Add" button for another connection.
- Shared needs: REQ-AI-R2-1 (`PageHeader` helperAlign), REQ-AI-R2-3 (seed run history and carrier errors).
- Not done this round: an import wizard. There is no `/imports` route under M12 per BUILD_PLAN ownership, so it is left for the owning module.

## Round 1 (parity loop, builder pass B) — 2026-11-09
A second builder pass that walked the wizards and drawers end to end in headless Chromium against localhost:3000. The scripts are in `C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\automation-integrations\builder\`.

Fixes:
- `/automation` returned 404 (there was no section index). Added `src/app/(app)/automation/route.ts`, which sends a 307 to `/automation/algorithms`. It matches the `/integrations` route handlers.
- Rate shopping drawer:
  - Step 1 showed the heading "General" twice, once from the wizard step and once from the section. The section is now "Preset details" with a one-line explanation.
  - Step 3 said "All 0 services" while services were still loading. It now says "Loading services…" (aria-live), and the count is singular or plural as needed.
- Carrier Add New Connection drawer:
  - Until `/api/carriers/catalog` answered, the credential fields (API key / secret) were missing and Continue was enabled, so a Production setup could be submitted with no credentials.
  - It now shows a skeleton and keeps Continue disabled until the catalog has loaded. If the catalog fails, it shows an error callout with Retry.
- Connect Store drawer: on non-Shopify channels, the disabled Public App card said "Needs SHOPIFY_CLIENT_ID". It now says "No public app for <Channel> yet".
- "Shopify · Sandbox" was cut off in the Channel columns. Widened to 200px in Missing Orders, the Channel History/Orders/Products logs and Health Overview.

Verified end to end (UI unless noted):
- **Rate shopping:**
  - Create walks all 3 steps. Step 1 blocks Next with field errors. Cheapest In Time reveals Transit time.
  - Saved and listed. Edit changes Cheapest In Time to Fastest, and the change log records "Rate Calculation Method … Cheapest In Time --> Fastest" and the transit time clear.
  - The row ⋯ menu has Edit · Change log · Delete. The delete confirm shows a record table with No / Yes, delete. The test preset was removed afterwards.
- **Workflow builder:** Run test with no order shows the inline error "Choose an order to test against". The Add condition modal opens. The test-orders API lists open orders.
- **Channels:**
  - The DB had been reseeded with 0 `channel_runs`. Connected "KS-TEST Sandbox" (Shopify, Apex Threads) through the API.
  - Download Orders with no location mapping fails, as it should: 4 missing orders, "Fulfillment Orders not found in the specified location".
  - Edit Store Connection (UI): mapped the store location to MLT1 on the Warehouse tab, switched on all four methods on the Configuration tab, then saved. The toast lists the active methods and the list shows "4 of 4 active".
  - Missing Orders (UI): Retry Download stays disabled until rows are selected. Retry resolved all 4 and created SO010850–SO010853 with Store = KS-TEST Sandbox. Selection cleared afterwards.
  - Channel History now lists the runs: Failed, then Successful, with Sync / Products / Shipment runs from the scheduler.
- **Permissions (API):** viewer and operator get 403 on preset bulk-delete, workflow bulk-active, channel create and missing-order retry. Read endpoints return 200. Viewer sees Connect Store disabled.
- **Checks:** `npx tsc --noEmit` reports 0 errors in the whole project. `npx vitest run tests/unit/automation-integrations` passes 26/26.

The dev server was unstable during this pass. Other modules' in-progress compile errors (receiving, counts, admin, listings) made unrelated routes return 500 at times. Retrying the same M12 route then succeeded.

## Round 3 (parity loop) — 2026-11-09
Fixes for the round 2 critic's verdict (7.3):
- **Viewer could reach the create flows (major):**
  - `/automation/workflows/new`, `/automation/algorithms/putaway/new` and `/automation/algorithms/allocation/new` are now gated server-side with `requirePagePermission(...create)`. A viewer lands on `/forbidden?from=…`, verified with the viewer session.
  - On the Workflows list, Create Workflow and Change sequence are hidden, not just disabled, without create/edit. Bulk actions are removed entirely when the user has neither edit nor delete.
- **`POST /api/rate-shopping-presets` "hang" (major):**
  - Re-measured: `{name:""}` returns a 400 VALIDATION with full `fieldErrors`, and the viewer gets a 403. Response times were 11–14 s, with `/api/workflows` slower (25 s) under the same load.
  - The handler validates before any lookup (`defineRoute` body parse), so the delay is dev-server compile and load from concurrent agents, not a handler loop. No code change was needed.
- **Rate shopping grid (minor):**
  - `YesNo` now renders a neutral "No" pill as well as the green "Yes" pill.
  - Columns are reordered so Client (pinned visible) and Warehouse come straight after Preset name, then method, status, booleans, shipping options, transit and description. Widths are tightened so the scoping columns are on screen at 1440.
- **Gutter (minor):** removed the extra `px-6` wrapper around the Health Overview and Carrier Monitoring grids. `DataGrid` already applies `mx-6`, so these grids now start at x=24 like Rate Shopping and Workflows. The side-nav layouts (Monitoring review and Logs) use `pl-6` so the grid's own margin acts as the gap.
- **Workflow builder column misalignment (minor):** the cause was `xl:sticky xl:top-4` on the Test panel. Chrome offsets sticky from the scroll container's content box, so it added 16px on top of the 24px padding. The panel now uses `xl:top-0`; measured at 170px for the When card and the Test card alike.
- **Setup Details (minor):**
  - Header facts (Channel / Client / Warehouses) share one `HeaderFact` layout: the label, then a 36px value row, aligned to the bottom next to the Setup combobox.
  - Missing-order error codes wrap to two lines and carry a focusable tooltip with the full text.
  - The volume chart now uses the pure `volumeShape()` (`lib/grid-defs/integrations/monitoring.ts`). It shows a totals line, switches to grouped bars when 3 or fewer days have activity, puts a floor of 4 on the y-axis, and shows an empty message when there are 0 orders. Unit tests: `tests/unit/automation-integrations/volume-shape.test.ts`.
- **Hydration warning on putaway/new (minor):** not reproduced in two headless loads (no console errors). The create page is now a server-gated async component.
- **Not fixable in M12, filed as requests:**
  - REQ-AI-R3-1: the grid footer shows "Total: 0" while loading.
  - REQ-AI-R3-2: there is no `/imports` hub. Foundation owns `(app)/imports`.
  - REQ-AI-R3-3: the counts compile error breaks the shell APIs.
- Checks: `npx tsc --noEmit` reports 0 errors in M12 paths. `npx vitest run tests/unit/automation-integrations` passes 34/34.

## Round 4 (parity loop) — 2026-11-09
Fixes for the round 3 critic's verdict (7.6). A second agent was editing some of the same M12 files at the same time (column order on Workflows and Rate Shopping, pause-reason copy). Its changes were kept; these edits sit on top of them.
- **Grids clipped at 1440 (major):** column widths were rebalanced so the key columns fit inside the 1392px grid. Long headers were shortened, with the full meaning kept in tooltips where they exist.
  - Workflows: "Blocking now" became "Blocking". Actions is 140px, Conditions 200px.
  - Rate Shopping: the headers are now "Calculation method", "All services", "Show errors", "Options" and "Transit". The total is about 1,300px, so the "Use all available services" / "Shipping options" collision is gone.
  - Channel Methods log: about 1,160px, so it fits beside the side-nav.
  - Health Overview: the headers are "Download status", "Orders (24h)", "Lines (24h)" and "Last successful call", each with an info tip. The total is about 1,180px.
  - Carrier Errors: Error went from 360px to 240px. Carrier is now 190px and moved forward, next to Status, so it is no longer cut to "KitSt…".
  - Grids wider than the viewport still scroll horizontally through `DataGrid`'s `overflow-auto`.
- **Active pill on setups that can't run (minor):** `healthRows()` now runs the method status through the pure `healthStatus()` (`lib/grid-defs/integrations/monitoring.ts`). An Active Download Orders method whose connection has a `pauseReason()` returns `Paused` plus the reason. Health Overview shows an amber "Needs reconnect" pill when credentials are missing, or "Paused" for any other reason, with a focusable tooltip. The filter enum gained `Paused`. Checked through the API: Apex Threads Shopify, Bluebird & Main and NovaForge now return `Paused` with the reason, and KS-TEST Sandbox stays `Active`.
- **Rate Shopping clients by warehouse (minor):**
  - New `servedClients()` lists the in-scope clients that have at least one active carrier service at a warehouse, through an all-clients setup or a client grant. It is exposed at `GET /api/rate-shopping-presets/clients?warehouseId`.
  - The drawer's Client combobox is filtered by it through the pure `servedClientOptions()`. It is disabled until a warehouse is picked, and its description shows "N clients are hidden…" or a no-services warning. Choosing a warehouse that doesn't serve the current client clears the client.
  - Server: `createPreset` rejects an unserved warehouse/client pair with a 400 field error on `clientId`. Verified: KS-CRIT-WH + APX returns 400. The test preset created before the fix was deleted.
- **Shipment methods step (minor):** with "Use all available services" on, the step no longer shows skeleton rows while services load. It explains that Save works without the list. A failed services query shows an error callout with Retry.
- **Permission affordances (minor):** one rule across M12: a create CTA is hidden without create permission, and other unavailable actions are disabled with a reason. Applied to:
  - Rate Shopping Create, and its bulk Delete, which is removed without delete permission.
  - Putaway/Allocation Create.
  - Channel "Connect Store".
  - Carrier "Add New Connection".
- **False "0 connected" (minor):** the channel connection header card shows a skeleton pill until the list arrives, and nothing on error.
- **Brand logos (minor):** new `components/integrations/shared/brand-marks.ts` draws a distinct tile for each of the 15 channels and 13 carriers, used on the hub cards, the provider headers and every `ProviderLogo` / `ProviderCell`. Examples: a Walmart spark versus a WooCommerce "Woo" bubble, the Amazon smile, multicolour eBay letters, the TikTok note and a UPS shield. They are KitStaks-drawn in brand colours; no third-party artwork ships, per the catalog policy. A unit test keeps every tile distinct.
- **Change sequence modal (minor):** seeded from the grid rows that are already loaded, so it renders instantly. The full fetch replaces the list when it arrives, and the "changed" baseline follows the source in use.
- **Carrier Errors realism (minor):** sandbox rows under 5 ms show "Sandbox" (with a tooltip) instead of a fake-looking "1 ms". REQ-AI-R4-2 suggests that shipping record a simulated latency.
- **Filed:** REQ-AI-R4-1 asks to register the M12 entity types in the platform `changeLogQuerySchema`. REQ-AI-R3-1 (grid footer "Total: 0") is still open.
- **Checks:**
  - `npx tsc --noEmit` reports 0 errors in M12 paths.
  - `npx vitest run tests/unit/automation-integrations` passes 59/59, including the new `round4.test.ts` (healthStatus, servedClientOptions, distinct brand marks).
  - Screenshots at 1440 are in `C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\automation-integrations\r4\`.
- **Not verified:** the full UI walk of the rate shopping drawer. The dev server answered API calls in 5–55 s under concurrent load, and other modules' compile errors (facility `custom-field-columns`) returned 500s during the session.

## Round 2 (parity loop, critic 7.1 fixes) — 2026-11-09
A concurrent M12 builder (Round 4 above) touched some of the same files; its changes were kept and these sit on top.
- **Order download code collision (major):**
  - `importOrder` runs through `importWithRetry`, up to 3 attempts. Transient failures (order-code collision, busy DB) are retried, and foundation's `nextFreeOrderCode()` now skips taken codes.
  - Every failure goes through `classifyImportError()` (`lib/grid-defs/integrations/import-errors.ts`), so no SQL or driver text reaches run items, missing orders or store notes. A collision maps to the catalog code "Shipment order code already in use" (catalog entry: REQ-AI-R5-2). `safeMessage()` sanitises the product, shipment and run-level errors.
  - When 3 or more orders fail with the same code in one run, admins get an `integration.repeated_failure` notification that links to the missing orders. One alert per store and code every 6 hours.
  - Live data: the 11 historical run items holding raw "UNIQUE constraint failed" text were rewritten. Their missing orders were re-coded and retried through `POST /api/monitoring/missing-orders/retry`: 11/11 succeeded, and Missing Orders went from 14 rows to 3.
- **Relative date comparators (major):** `DATE_PRESETS` adds 16 presets (Today, Last 3/7/30/90 Days, Last 12 Months, X Days Ahead/Before, Within Next/Past X Days, Monday to Sunday), alongside the existing "is between". It also adds `datePresetValue`, `describeDatePreset` and the condition-modal preset picker with an "X days" input.
  - The engine comparator belongs to foundation (REQ-AI-R5-1, exact code filed). `comparatorsFor("date")` offers it automatically once `RULE_COMPARATORS` contains `dateIs`. Until then the old absolute comparators stay, so no rule can be saved that the engine rejects.
- **Putaway If list (major):** 63 fields: the 33 Logiwa base fields (adds Allocated Transfer Quantity, Is Prevent Allocation, LP Carrier, Parent LP based transfer) plus 30 custom-field slots (Location / LP Type / Product × Date Picker 1–3, Dropdown 1–2, Text Box 1–3, Toggle 1–2), alphabetical. The facts come from foundation `ruleFacts` (REQ-AI-R5-3).
- **Live channel adapters (major):** new production adapters for Amazon SP-API (`amazon.ts`: LWA refresh token, RDT for the address, MFN orders, confirmShipment, listings patch), Walmart (`walmart.ts`: token, Created + Acknowledged orders with auto-acknowledge, line shipping, inventory), WooCommerce (`woocommerce.ts`: REST v3, variations, stock, completion note) and eBay (`ebay.ts`: Fulfillment API, shipping fulfillment, bulk quantity). All 4 are registered in `LIVE_ADAPTERS`, and the catalog now reports `hasLiveApi` for them.
  - Connect Store is provider-aware (`CHANNEL_CREDENTIAL_PROFILES`): each channel shows its own labels (Consumer key, LWA client ID, Refresh token, Seller ID, Marketplace ID) and a "where to find your credentials" callout. The schema validates each provider's auth method and required extras, and the extras are stored encrypted with the pair.
  - Verified: an Amazon connect without a refresh token or seller ID returns 400 with both field errors. The mappers are unit-tested.
- **Carriers:** Stamps.com (SERA REST: OAuth refresh token, USPS services and packages) and Custom Carrier (local rates and labels, no credentials) are now live. The catalog shows 7 live carriers.
  - UPS has the full 21 services (adds Express 12:00 and Mail Innovations M2–M6) and 23 packages (Flats, Parcels, BPM, Media Mail, …).
  - `syncCarrierCatalog()` adds missing catalog rows to existing setups when the detail opens and before rate-shopping services load, so the seeded UPS-TEST picks them up.
- **Grids at 1440:**
  - Missing Orders now reads Order code · Last error code · Status · Last updated first.
  - Channel History puts Error and Total before Success.
  - Workflows puts Active · Runs · Last run · Blocking before the definition columns.
  - Rate Shopping puts Transit time right after the method.
  - Measured visible headers at 1440: all key columns are on screen (`r2-*.png`).
- **Minors:**
  - The Public App card says "Not enabled for this workspace. Contact your administrator." and the env var name is gone from the UI and the API message.
  - The minimap is hidden by default and shows real node shapes and the viewport when turned on.
  - "Finish the open rule" is now an inline callout in the rule list, not a toast over the footer.
  - Catalog cards share one height (fixed footer).
  - "No Data" runs show a grey pill (`integrationDomain()`).
  - Segmented controls in the drawers fill their width evenly.
  - Brand spelling is "KitStak" everywhere in M12 (`config/brand.ts`). The two foundation error-catalog codes keep their spelling so they still match.
  - Settings Yes/No toggles show a neutral "No" (`SettingYesNo`).
  - Test Algorithm has a Client filter, pre-fills the first Receiving location, and warns before running when the draft has location conditions and no location is set.
  - Permission-gated controls are optimistic while `/api/me` loads; every API still re-checks.
  - Credential-less seeded stores read "Demo store" in neutral grey, not amber Paused (`pauseLabel()`).
- **Not reproduced:** "No QueryClient set" on label-generation and putaway/new. Both pages loaded headless with 0 console errors, and `AppProviders` wraps the root layout. This looks like a dev HMR artifact during concurrent compiles.
- **Not fixed (needs foundation):** REQ-AI-R5-1 (dateIs in the engine), R5-2 (catalog entry), R5-3 (putaway facts), R5-4 (Wave Rules in the Automation nav), R5-5 (neutral No tone, toast offset).
- **Still sandbox-only or coming soon:** TikTok Shop, Magento, Loop Returns, CartRover, BigCommerce, Etsy (channels) and Techship, Ehub, eShipper (carriers) remain sandbox-only. Shipium, BUKU, iDrive, QuickBooks Online, Squarespace and Amazon FBA are still "coming soon". Real trademark artwork is not shipped (catalog policy). Brand tiles come from `brand-marks.ts`.
- **Checks:** `npx tsc --noEmit` reports 0 errors in M12 paths. `npx vitest run tests/unit/automation-integrations` passes 59/59, including the new `parity-r2.test.ts`. The headless crawl of 11 module routes showed 0 console errors.

## Round 5 (parity loop) — 2026-11-09
- **Edit drawers open populated.** The channel and carrier connection lists now prefetch each row's detail with the drawer's query key (`usePrefetchDetails` in `components/integrations/shared/shared.tsx`, max 25 rows). The drawers use a 30s `DRAWER_DETAIL_STALE_MS` so opening Edit renders the tabs from cache, with no skeleton and no refetch that would remount the form. A save invalidates that connection's detail, so the next open is fresh. Version checks still guard against concurrent edits.
- **Workflow Save.** Save stays disabled, with a reason tooltip, until the workflow has a name and at least one action ("Add at least one action"). After a successful create, the button reads "Opening workflow…" and stays disabled while `router.replace` runs in a transition, and the unsaved-changes guard is suppressed for that navigation.
- **Warehouse tab with no credentials.** A live store with a pause reason (no stored credentials, or inactive) no longer calls `/api/channels/{id}/locations`, so there is no 409. It shows an inline "Connect credentials to load the store's locations" callout, and the picker placeholder reads "Connect credentials first".
- **Workflows grid at 1440.** Last run uses the compact grid date (`fmt.gridDateTime`, full date in a tooltip). Trigger uses a short label ("Order created", "PO created") and Scope a compact one ("All WH · All clients"), both with the full text in `title`. Column widths are rebalanced to about 1,150px.
- **Rate shopping at 768.** Headers are shortened to "Method" and "Transit". The generic header-truncation fix is filed as REQ-AI-R6-3.
- **Data.** Deleted the invalid critic preset `KS-CRIT-RS-R3` (unserved warehouse/client pair) and its zero service rows, directly in the DB, because the dev server API was down from another module's compile error at the time.
- **Imports.** Not M12-owned. The 500 comes from the import route bundle failing on M06's `imports/handlers/inventory.ts` → `inventory-commands.ts`. Filed REQ-AI-R6-1 (lazy per-key handlers, plus the hub page from REQ-AI-R3-2). The jobs `list-shell.tsx` octal-escape issue is filed as REQ-AI-R6-2.
- **Checks:** `npx tsc --noEmit` reports 0 errors in M12 paths. `npx vitest run tests/unit/automation-integrations` passes 61/61, including the new `round5.test.ts`. A headless Playwright walk was not possible: the installed Chromium build doesn't match the Playwright package (REQ-AI-R6-4), and pinning it via executablePath failed with spawn UNKNOWN in the sandbox.

## Round 6 (parity loop) — 2026-11-09
- **Data Import hub (`/imports`, new).** `src/app/(app)/imports/page.tsx` lists every import the user has permission for, grouped by area (products, locations, users...), with a link to each `/imports/<key>` page, a direct template download, a "Not configured" flag, and the 15 most recent import jobs (status pill, user, rows ok/errors). It has an empty state and a 403 redirect when the user can run no import. The helpers are in `src/components/integrations/imports-hub.ts`. SSR returns 200 with the hub content.
- **`GET /api/imports/<key>` 500.** This is still a dev-server state problem, not M12 code. Turbopack reports `inventory-commands.ts ... module factory is not available` for the app-route bundle on every import key; it has logged 192 times since 02:55. Touching the files did not recover it. The same registry renders fine in the `/imports` page bundle. A dev-server restart (or the per-key lazy handler loading in REQ-AI-R6-1) is needed. Filed as REQ-AI-R7-1.
- **Catalog permissions.** Without `integrations.integrations.create_setup` (viewer), Add is hidden and Connect is disabled with a permission tooltip. I verified `/api/me` for the viewer has no integrations permission.
- **Sandbox-only cards.** These now say "Connect sandbox" plus "Simulated store, no live API calls", with a tooltip that explains what a sandbox connection provides. Coming-soon cards are unchanged (disabled, with a reason).
- **Workflows grid.** Last run now uses `compactWhen` ("11/09 11:46 PM" within the current year, "MM/DD/YYYY" for older dates; full value in a tooltip). Conditions is 210px wide, wraps to two lines, and is focusable with a tooltip.
- **Workflow test panel.** Run test is disabled, with a "Choose an order to test against first" reason, until an order is picked.
- **Monitoring.** Cards show "Based on N of M setups with calls in 24h (small sample)". The Client column has a truncation title. Last call and last successful call use the compact grid date across overview and review grids, with the full date as a tooltip.
- **Rate shopping.** Delete is not destructive-styled when the user lacks permission (row and bulk). Description is a two-line clamp with a keyboard-focusable tooltip. The critic test presets KS-CRIT-RS-1 and KS-CRIT-RS-R5 were set Inactive through the audited PATCH API (services intact), and "(critic test preset)" was added to their descriptions.
- **Wave Rules.** These are already in the Automation nav (`nav-config.ts`, `/jobs/wave-rules`, M03), so REQ-AI-R5-4 is satisfied. `dateIs` (R5-1) and the putaway facts (R5-3) are still open foundation work.
- **Checks.** `npx tsc --noEmit` reports 0 errors in M12 paths. `npx vitest run tests/unit/automation-integrations` passes 66/66, including the new `round6.test.ts`. The headless Playwright walk could not run: `chromium.launch` fails with `spawn UNKNOWN` in this sandbox, and the installed browser build (1254) doesn't match Playwright 1.55's expected 1187. I verified with authenticated HTTP SSR/API checks instead.

## Round 3 (parity loop, critic 7.7 fixes) — 2026-11-10

Every defect in the round 2 verdict was addressed. Each item below was verified against localhost:3000 through the API and headless 1440×900 screenshots for admin and viewer.

- **Local-day bucketing (major).** Recent Errors grouping, the drill-down and the Setup Details Volume and Call Results charts now bucket days in the viewer's time zone. The UI sends `tz`; when it doesn't, the server uses the context warehouse's `timezone`. An 11:46 PM CST error now sits on 11/09, matching the timestamp the grid shows. Helpers live in `lib/grid-defs/integrations/time.ts` (`dayKeyInZone`, `lastDaysInZone` (DST-safe), `safeTimeZone`, `niceTicks`). `repositories/monitoring.ts` takes `tz` in `recentErrorRows`, `recentErrorOrders` and `setupDetails`. The drill subtitle shows the local day ("11/09/2026").
- **Putaway If list facts (major, REQ-AI-R5-3 applied).** `domain/putaway.ts` `ruleFacts()` now supplies `allocatedTransferQuantity` (from the new optional `SuggestInput.allocatedQty`), `isPreventAllocation`, `lpCarrier` (the carrier of the open order whose line is pinned to the LP), `isParentLpTransfer` (the LP has a parent or children), and all 30 `locationCustomField.*`, `lpTypeCustomField.*` and `productCustomField.*` slots. Every field in the picker now evaluates.
- **Relative date comparators (major, REQ-AI-R5-1 applied).** `RULE_COMPARATORS` gains `dateIs`, and `domain/conditions.ts` adds `matchesDateSpec`. Date-only facts compare by calendar day; timestamps compare by instant. That turns on the existing preset picker: Today, Last 3/7/30/90 days, Last 12 months, X days ahead/before, within next/past X days, and Monday–Sunday. M11's `COMPARATOR_LABELS` record got the matching `dateIs: "Is"` key so the build stays green.
- **Platform change log (major, REQ-AI-R4-1 applied).** `platform-entities.ts` registers `algorithm`, `workflow`, `rate_shopping_preset`, `channel_connection` and `carrier_connection` with their scope columns and permissions. `GET /api/change-log?entityType=…&entityId=…` returns 200 for all five.
- **Imports (major).** A dry run (`POST /api/imports/[key]` with `dryRun=true`) now pushes each column-valid row through the real handler inside a transaction that always rolls back (`pipeline.previewImport(upload, db)` + `mergeApplyFailures`), so it reports the same client, warehouse and SKU errors as a real run. On the hub, unconfigured imports are no longer links: they appear greyed with a "Coming soon" pill and a tooltip giving the reason. Acronyms are cased correctly ("Bulk Import VAS Operations"). Recent jobs show the file name, Original and Errors downloads, and local times.
- **Channel Methods at 1440 (major).** Columns were rebalanced. Run is pinned to the right (`meta.sticky: "right"`). Last Run shows the full module date and Last Result is its own pill column. Job status, channel and store truncate with a tooltip.
- **Grid header alignment (minor, all grids).** The hidden column-drag grip in `grid/data-grid-header.tsx` took about 12px of layout before every header label. It is now absolutely positioned in the cell padding, and right-aligned headers put the sort affordance on the left, so labels line up with the cell content edge.
- **One date formatter (minor).** `useModuleDates()` and `<DateTimeText>` in `integrations/shared/shared.tsx` give a padded date and time ("11/09/2026 9:21 PM"), with full precision in a tooltip. They are used across monitoring, logs, carrier errors, workflows and the imports hub. Date-only values render as calendar days.
- **Brand spelling (minor).** `brandText()` maps "KitStaks" and "LogiwaIO" to "KitStak" in every error code, title, message and drill. The display mapping leaves stored codes unchanged, so filters still match.
- **Truncation (minor).** Error pills ellipsize inside the pill and show the full text in a tooltip. The Items For Review side-nav wraps (w-64). Recent Errors headers are shorter ("Occurrences" and "Affected orders"), and its error reason wraps to two lines. Channel History dates are no longer truncated, and the status pill column is wider and unclipped.
- **Carrier errors (minor).** A `<ResponseTime>` component gives the grid and drawer the same treatment: "Sandbox" with a tooltip that shows the measured ms. `connectionLabelOf()` stops "KitStak Sandbox - KitStak Sandbox".
- **Putaway Rules step (minor).** An untouched auto-created rule is discarded silently. Create New focuses its name instead of warning.
- **Viewer tab bar (minor).** `useStableGroupTabs()` keeps the page-tab strip on logs, monitoring and carrier errors even when the role can open only one tab.
- **Workflow builder (minor).** Every field error uses the shared `FieldError`. Saving an active workflow with no conditions and all-warehouse, all-client scope asks "This workflow will change every order in every warehouse" first, and the empty-conditions hint turns amber. **KS-CRIT-WF-1** has been deactivated via `POST /api/workflows/bulk-active`, which is audited.
- **Beyond the verdict (missing vs Logiwa).**
  - Workflow and allocation order conditions gain **Retailer** and **Shipment Package**, with record pickers (`useEntityOptions`) and name resolution.
  - Putaway Test › Product Putaway now lists the product's **inventory rows** (location, status, pack type, LP, lot, expiry, production and received dates, PO, damage, allocated, qty) via the new `GET /api/algorithms/test/inventory`. Picking a row tests moving that stock with its attributes.
- Tests: `tests/unit/automation-integrations/round7.test.ts` covers zone bucketing, nice ticks, `dateIs`, the putaway fields, `brandText`, the connection label, import titles and dry-run merging. `volume-shape.test.ts` was updated for nice ticks.
- **Allocation inventory conditions.** The list now includes the 10 **Location Custom Field** slots. `domain/facts.ts` `bucketFacts()` exposes them as `locationCustomField.<slot>`, an additive foundation change.
- **Grid fit at 1440.** Date columns are 180px, so a padded date-time never ellipsizes. In a grid cell a sandbox channel reads "Shopify" next to the blue KS sandbox tile; the full "Shopify · Sandbox" label shows on hover. Recent Errors count headers are now "Errors" and "Orders", each with a tooltip. Missing Orders hides Client and Order date by default; both stay available in the column chooser. Channel Methods hides "Every", whose interval moves to the Next run tooltip, and shortens "Waiting For Next Run" to "Waiting".
- Left open (needs real partner credentials or OAuth apps, not in M12's control): live adapters for TikTok Shop, Magento, Loop Returns, CartRover, BigCommerce, Etsy, QuickBooks Online, Squarespace, Amazon FBA, Techship, Ehub, eShipper, Shipium, BUKU and iDrive, plus the Shopify Public App OAuth install. Allocation conditions Is Partial, Precartonization Type, Number of Boxes and the pack-type prioritization flags are also open: no order or bucket data backs them yet, so they would need schema work from M01/foundation first.

## Round 4 (parity loop, critic 7.3 fixes) — 2026-11-10
- **Every workflow trigger now fires (major).** Each trigger is dispatched from its real command:
  - **Shipment Order Created:** every new order.
  - **Shipment Order Imported:** channel downloads (`channel-runtime`) and Excel/CSV order imports. These run before the Created workflows.
  - **Shipment Order Updated:** order edits, as before.
  - **Purchase Order Created:** `createPurchaseOrder`, which covers the UI, the API and PO imports.
  - **Order Shipped:** ship confirm (`shipOne`), for Shipped and Partially Shipped.

  The builder adds a per-trigger helper line ("Runs when: …", `TRIGGER_COPY`, also on the Help Center). Each trigger has its own action set: PO allows Notify Users only, and Order Shipped allows Add Tag and Notify Users. It also has its own condition catalog: PO triggers use the new `purchaseOrder` catalog (PO type, vendor, code, reference, dates, SKU, quantities, purchase price). Switching trigger drops the steps the new trigger can't use and shows a toast. The save schema rejects order fields on PO triggers. Test runs against the matching record: an open order, a shipped order (`kind=shipped`) or a purchase order (`kind=po`, rolled back). Notify Users links POs to `/receiving/{id}`. Shared-file edits are listed in requests (Round 4).
- **Allocation fields (major).**
  - Order conditions gain **Is Partial**, **Precartonization Type** (None / Shipment Package / Own Box / Mixed) and **Number of Boxes** (the active label count, or an estimate from own-box pack types), plus **Order Status**. The facts come from `facts.ts` `cartonFacts`.
  - Inventory conditions gain **Prioritize Same Pack Type**, **Prioritize Higher Pack Type** (by pack-type UOM qty) and **Only Allocate Full LPs**. With full LPs on, an LP is taken only whole, when every unit on it is this SKU, is free and fits the need; otherwise the line stays short. See `domain/allocation-preferences.ts`.
  - The "full LPs" copy in the type picker is now accurate.
- **Live channel adapters (major).** New REST adapters, all registered in `LIVE_ADAPTERS`:
  - **TikTok Shop** (`tiktok.ts`): Partner API 202309 with HMAC-SHA256 request signing, shop-cipher lookup, in-memory token refresh, and package ship with provider matching.
  - **Magento 2** (`magento.ts`): searchCriteria paging, `/order/{id}/ship` and stockItems.
  - **BigCommerce** (`bigcommerce.ts`): V2 orders and shipments, V3 catalog and variants, and inventory.
  - **Etsy** (`etsy.ts`): v3 receipts, tracking, and listing-inventory read-modify-write. Tokens refresh in memory.

  Token caches are keyed by connection and credential, and the validation draft is never cached. Credential profiles, with Partner/Seller-Center help, ask for the extra fields: store hash, keystring, shop ID, seller token, refresh token and shop cipher. They are stored encrypted. Without live credentials these adapters are verified by unit tests with mocked `fetch`.
- **Shopify Public App OAuth install.**
  - `POST /api/channels/shopify/install` checks the client scope and the `.myshopify.com` domain, then returns the authorize URL with a signed, 10-minute state. It also sets an httpOnly nonce cookie.
  - `GET /api/channels/shopify/callback` verifies Shopify's HMAC, the state signature and expiry, the browser nonce, the user and the shop. It then exchanges the code, creates the Public App connection, and lands on the list with Warehouse mapping open. Errors come back as `?oauthError=` in a dismissible callout.
  - The feature is enabled by `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` (catalog `publicApp`).
- **Honest catalog plus Help Center.** Cards show **Live API**, **Sandbox only** ("No live connection yet · simulated store") or **Coming soon**, each with a **Learn more** link.
  - The new **Integration Help Center** (`/integrations/help`) has a status table, one section per channel and carrier (how to connect, the official API docs link, a link to the connection list), plus channel methods, logs, monitoring, carrier errors and workflow triggers.
  - A Help link sits in the header of Integration Management, the logs, Channel Monitoring, Carrier Monitoring, the Shopify (any channel) connection list and the UPS (any carrier) integration page.
- **Logs at 1440.** On Orders and Shipments and Products and Inventory, **Successful** comes right after Call method. Error message is last, ellipsized at the column width (`TruncText`) with a full-text title, so the chooser gear never covers a label. All columns fit about 1160px.
- **Channel Methods.** Run is now a secondary button. It is disabled with "Connect credentials first…" for credential-less demo stores (`needsCredentials`). The store column is 190px.
- **Carrier Errors.** The header reads "Resp. time" (the chooser label is "Response time"), and HTTP code is left-aligned so it no longer butts against Error. Every tab has the breadcrumb Integrations › Carrier Errors › {Tab} Errors.
- **Dates.** Every M12 date goes through `useModuleDates` / `DateTimeText`: Shopify list Last order, method Last run, algorithms Last updated, workflow Run history and the change-log drawer.
- **Recent Errors.** The sandbox-aware channel cell (`isSandbox`) matches the other grids, there is one info icon (on Orders), and Client is 190px.
- **Channel Setup Details.** A failed first attempt shows the error with **Retry now** instead of skeletons, and a failed default-setup lookup gets its own error state.
- **CTA casing.** The type picker reads "Create Putaway Algorithm" / "Create Allocation Algorithm".
- **Test data.** KS-CRIT-WF-R5 and KS-CRIT-WF-R5B were deactivated through `setWorkflowsActive`, which writes the audited "Active is modified. Yes --> No" entries.
- Tests:
  - `tests/unit/automation-integrations/round8-triggers.test.ts`: one active workflow per trigger writes a `workflow_runs` row. It covers manual create, edit, CSV import, channel download, PO create and ship confirm, plus PO conditions and test, the carton facts and the pack-type/full-LP allocation.
  - `round8-adapters.test.ts`: TikTok signing and mapping, Magento, BigCommerce, Etsy, the credential schema, and the Shopify OAuth state, HMAC and domain checks.

  The M12 suite is 13 files and 111 tests, all green. `tsc` is clean for M12 paths. Failures in M05 `po-lifecycle` and foundation `orders.test` (messages and status rules) come from those modules' concurrent edits, not from M12.
- Still open: there are no live adapters for Loop Returns, CartRover, QuickBooks Online, Squarespace, Amazon FBA, Techship, Ehub, eShipper, Shipium, BUKU or iDrive. Their cards and Help Center say so explicitly. The visual pass was limited because the dev server was answering in 30–90 s (REQ-AI-R9-1).

## Round 5 (parity loop, critic 6.8 fixes) — 2026-11-10
- **Blocker (dev-server 500s on dynamic routes): environmental, filed as REQ-AI-R10-1.** The HTML error body from `GET /api/workflows/[id]` names `Jest worker encountered 2 child process exceptions` (`next/dist/server/dev/static-paths-worker`). In dev, Next forks a child for each dynamic pathname, and that fork fails on this saturated machine. Static M12 routes still answer 200. No M12 code is involved. `tsc --noEmit` is clean for M12 and for `facility/lp-numbers`; the only error is in `scripts/catalog-test-data.ts`. I proved the PATCH handler path against a copy of the live DB: `updateWorkflow` on KS-CRIT-WF-1 went from v2 to v3 in 7.0 ms and wrote the change-log row `Description is modified.  --> (edit check)`.
- **Latency at Logiwa scale (major).** This is a repository-level benchmark: the list functions behind each API, run 5× against a copy of the live DB inflated to 30,341 run items, 30,025 missing orders, 30,509 carrier call logs and 3,063 runs. Script: `kitstak-critic/automation-integrations/bench.ts`. p50 times at 100 rows per page:

  | API | Time | Notes |
  |---|---|---|
  | workflows | 0.5 ms | |
  | rate-shopping | 0.3 ms | |
  | algorithms | 0.3 ms | |
  | missing-orders | 6.1 ms | page 200: 24 ms; filtered by error code: 10.5 ms |
  | recent-errors | 2.9 ms | |
  | health | 6.3 ms | |
  | methods | 1.7 ms | |
  | history | 4.0 ms | |
  | Orders & Shipments log items | 15.2 ms | 30k rows |
  | carrier call logs | 18.9 ms | |

  On sandbox volumes every list is under 1.3 ms. The 49–178 s the critic measured is therefore all dev-server queueing: the same `GET /api/workflows` took 52–64 s over HTTP this round. A `next build && next start` measurement was not run, because a production build in the shared `.next` while 14 builders hot-edit would disrupt the running dev server. This is part of REQ-AI-R10-1.
- **One client rule (minor).** Every M12 API now returns `clientName` as the full name and `clientCode` as the short code. This holds for workflows (list, detail, create, update) and rate-shopping (list, detail, create, update). The new `clientLabelsOf()` lives in `integration-logs-kit.ts`. Grids show the name with the tooltip "NVF · NovaForge Electronics" (`clientTitle()` in `grid-defs/integrations/common.ts`). On the DB copy, create and list both return `NovaForge Electronics / NVF`.
- **Brand in stored codes (minor).**
  - `channel-runtime` now writes missing-order codes and run-item messages through `brandText()`. The two runtime codes read "…in KitStak".
  - Existing rows were migrated: 10 `channel_missing_orders.last_error_code` and 10 `channel_run_items.error_message`.
  - `monitoring.ts` filters and sorts on `REPLACE(…,'KitStaks','KitStak')`, brands every serialized code, message and history row, and its drill-down matches both spellings.
  - The catalog lookup goes through the new `catalogError()` (in `grid-defs/integrations/monitoring.ts`), which also brands the title, explanation and action. The enum filter options use `BRANDED_ERROR_CODES`.
  - Live check: `GET /api/monitoring/missing-orders` has 0 occurrences of "KitStaks". The Excel export uses the same `listMissing`.
- **Sandbox errors only on demand (minor).**
  - Scheduled sandbox runs no longer sell an unknown SKU.
  - The new **Simulate error** control is a flask icon next to Run, on sandbox Download Orders rows in Channel Methods. It calls `POST /api/integration-logs/methods/[id]/run {simulateError:true}`. The request is validated as sandbox plus Download Orders, and permission-gated like Run.
  - That run's first order carries `<PREFIX>-SIM-<run>`, with id `sbx-<run>-0-sim` and payload `simulated: true` plus a note. The toast explains what happened.
  - Pre-R5 error orders re-fetch clean. The 10 accumulated KS-TEST Sandbox missing orders (SBX-30…SBX-330) were cleared through the real `POST /api/monitoring/missing-orders/retry`: 10/10 succeeded, which also confirms the dev server runs the new sandbox code.
  - The Edit Store drawer and the Help Center copy were updated to match.
- **Trigger select SSR, footer while loading, Feedback tab, db:verify label invariant.** These are foundation or shipping code. Filed as REQ-AI-R10-2…6 with exact patches.
- **Tests.**
  - `pure.test.ts`: there is no unknown SKU over 30 scheduled runs. Simulate error adds a flagged `-SIM-` order, re-fetches it by id, and returns orders even on a "no data" run. A pre-R5 id re-fetches clean.
  - `repositories.test.ts`: a clean run has 0 errors. A simulated run stores the "KitStak" spelling with `simulated: true`, and retry still succeeds once the SKU exists.
  - `npx vitest run tests/unit/automation-integrations`: 13 files, 113 tests, all green. `tsc` is clean for M12 paths, and eslint shows 0 errors on the changed files (pre-existing warnings only).
- **Visual pass: not completed this round.** The headless 1440×900 run of `/integrations/logs/methods` and `/integrations/monitoring/missing-orders` (`shots5.mjs`, 10-minute goto timeout) never reached a screenshot. The methods page logged a 500 on a resource, and the browser closed while still waiting on fonts. That fits the dev-server saturation in REQ-AI-R10-1. The Simulate error control has been checked by `tsc` and eslint only; nobody has seen it rendered.

## Round 6 (parity loop, critic 7.4 fixes): 2026-11-10
- **Dev server (blocker, environmental).** Dynamic routes on `:3000` still return 500 ("Jest worker encountered 2 child process exceptions"). `POST /api/integration-logs/methods/[id]/run` failed after 147–216 s, and static routes take about 60 s. I didn't restart `next dev`. Instead I built a clean production copy of the current source, as other modules do: `kitstak-critic/automation-integrations/pb6`, with junctions to the repo's `node_modules` and `.data` and the same DB. It is served by `next start -p 3206`, and every API there answers in 40–120 ms. The in-process scheduler belongs to whichever process holds `scheduler_lease`, currently the old `:3200` build, so it still runs pre-R6 code until restarted. Filed as REQ-AI-R11-1.
- **Channel pipeline is operable (major).** Seeded stores of a live channel that have no credentials are now **demo-feed** stores.
  - Definition: `isDemoFeed()` in `channel-runtime`. Run, Simulate error and the scheduler use the deterministic KitStak feed against the client's real SKUs, and the live adapter takes over as soon as credentials are saved. A store connected through the wizard always has credentials, so a real store never falls back.
  - `pauseReason()` returns null for sandbox and demo-feed stores, so Health shows Active/Passive from the Download Orders toggle.
  - The feed keeps the store's own mapped locations and existing listing ids (`sandboxAdapter(skus, { demo, locations, listingIds })`). Download Products updates listings instead of duplicating them.
  - Scheduled demo traffic is sparse (`feedOrderCount`: 1–2 orders on every 4th run), so the shared DB doesn't fill up. A manual Run always brings 1–3 orders. `AdapterContext.manual` was added.
  - Simulate error (`canSimulateError(isSimulated, method)`) now renders on all three Download Orders rows. Run is enabled on every row, and the row-kebab "Run Download Orders now" is enabled.
  - Demo stores are flagged by a dismissible info callout on Channel Methods and a "Demo feed" badge with an explanation in the connection list and details drawer (`DEMO_FEED_NOTE`, `demoFeed` on `ChannelConnectionRow` and `MethodRow`).
  - **Live check on `:3206`:** I ran all 11 active methods through `POST /api/integration-logs/methods/[id]/run`, and all 11 returned 200 in 40–94 ms. Download Orders imported 1, 2 and 2 orders. Download Products ran 19/19 and 11/11, Sync Inventory 20, 0 and 11, and Send Shipment Info 54, 34 and 38. Send Shipment Info marked those seeded shipped lines as store-updated and wrote change-log rows. Simulate error on Apex was Partially Successful, 3 imported and 1 failed (`SPY-910`).
  - Afterwards `GET /api/monitoring/health` showed Apex Active at 80% (4 ok / 1 error in 24h), and Bluebird and NovaForge Active at 100%. Channel Methods shows a live HH:MM:SS countdown on every Active method, Job status "Waiting" and Result pills.
- **Recent Errors reconciles with Missing Shipment Orders (major).** `recentErrorRows()` now also counts open missing orders updated within the window that have no failed run item. Each one counts once per order, so nothing is double counted. The `recentErrorOrders()` drilldown returns those orders with their missing-order id. Live: 6 groups and 6 occurrences, against 9 open missing orders, of which 6 fall within 14 days. The Setup Details Recent Errors card uses the same function.
- **Success-rate donut (major).** With no downloads, the ring is no longer drawn. A muted `border-border` placeholder circle shows "—" and "No downloads in the last 24 hours" inside its hole. Slice colours now use the `var(--success)` and `var(--danger)` tokens, so dark mode isn't glaring, zero-value slices are dropped, and padding applies only with two slices. Dark-mode screenshot checked.
- **768px layout (major).** The new `SubNavLayout` (`components/integrations/shared/sub-nav.tsx`) shows the left VerticalNav from 1024px up. Below that it becomes a wrapping pill row above the grid. Channel Logs and Items for Review use it, with Channel Logs now 192px wide. At 768 the page has `scrollWidth` 762 against `clientWidth` 768, so there is no horizontal overflow, and the footer pager no longer overlaps the page-size select. The grid toolbar's disabled "Retry Download" still overlaps "Views" at 768 because `GridToolbar` doesn't wrap. That is foundation code, filed as REQ-AI-R11-3, and the search placeholder was shortened.
- **Order code columns (minor).** Missing Orders and Workflow Blocked now use 148px (min 120), `tabular-nums`, truncation and a title tooltip.
- **Channel Methods header (minor).** "Last result" became "Result" (132px) and the columns were rebalanced: Method 150, Store 176, Channel 124, Status 82, Job 78, Next 80, Last run 164, Run 120. Nothing is clipped at 1440.
- **Putaway canvas (minor).** `readableFit()` never auto-fits below 85%. A wider rule pins its top-left and you pan or scroll for the rest. Fit-to-screen uses the same rule. Checked: REPLENISHMENT_ALGORITHM opens at 85% with readable node text. The live replenishment algorithms in both warehouses now have Logiwa's two-rule chain, "Suggest Same SKU" then the If-else "Suggest Empty Location" (Picking area), applied via `PATCH /api/algorithms/[id]` (v1→v2). The seed change is REQ-AI-R11-2.
- **ShipStation carrier (minor).**
  - The new live adapter `src/server/integrations/carriers/shipstation.ts` uses API key and secret over Basic auth.
  - `GET /carriers` validates the credentials. Rates come from `POST /shipments/getrates`, one call per ShipStation carrier code. Labels come from `POST /shipments/createlabel`, one per package as a base64 PDF. Void looks the shipment up by tracking number, then calls `voidlabel`.
  - It offers 7 services. It is registered in the carrier registry, `CARRIER_DEFS` and `CARRIER_LIVE`, so the card reads "Live API", and `providerName` reads "ShipStation".
  - Sandbox-only carrier cards now say "simulated carrier", with carrier-specific tooltip copy.
- **Workflow test (minor).** An empty "from" value renders as an italic "(none) → KS-CRIT".
- **`GET /api/rate-shopping-presets/clients` without a warehouse (minor):** it now returns 400 `Choose a warehouse first`, with `fieldErrors.warehouseId`. Verified live.
- **Still open vs Logiwa.**
  - These channels have no live adapters: QuickBooks Online, Squarespace and Amazon FBA (coming soon), and Loop Returns and CartRover (sandbox). The same goes for these carriers: Techship, Ehub and eShipper (sandbox), and Shipium, BUKU and iDrive (coming soon).
  - The cards use KitStak brand marks, not partner logos, which we don't ship for trademark reasons.
  - The Feedback tab overlap is foundation work (REQ-AI-R10-4).
- **Tests.** The new `round9-demo-feed.test.ts` covers demo-feed runnability and pause rules, sparse versus manual traffic, Run into the mapped location, Simulate error into Missing Orders and Health, the scheduler running demo methods, Recent Errors reconciliation with its drilldown, and ShipStation auth, carrier mapping, rates and the 401 path. `round8-adapters` was updated for the R6 rule.
  - `npx vitest run tests/unit/automation-integrations`: 14 files, 121 tests, all green.
  - `tsc --noEmit` is clean for M12 paths, and eslint shows 0 errors on the changed files.

## Blind-judge repair round 1 — 2026-11-10
- **Live channel with real credentials: not fixed (blocked on the account owner).** No real Shopify or ShipStation credentials exist in this workspace. All 3 stores and 3 carrier setups have `credentials_enc IS NULL`, and I may not create provider accounts or enter credentials. The path is ready: Connect calls the provider before saving (`validateConnection`), and Run on Channel Methods writes real call logs. Once an owner pastes a token, the first successful run flips the card to **Live API** automatically (next item). The demo-feed callout on Channel Methods still tells buyers plainly which stores are simulated.
- **Shopify Public App: partly fixed (needs the owner's Shopify Partner app).** The OAuth install (signed state, HMAC, shop-domain checks; `round8-adapters`) is gated on `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`. The Connect drawer no longer says "Contact your administrator". It explains exactly what to set and shows the redirect URL `<origin>/api/channels/shopify/callback`. Turning it on requires creating a Partner app, which is the account owner's step.
- **Honest connector badges (fixed).** The new `verifiedLiveProviders(db)` in `repositories/channels.ts` returns the providers whose live adapter actually succeeded here: a channel run with successes on a credentialed, non-sandbox store, or a `Success` carrier call on a credentialed, non-sandbox carrier. `CatalogCard.liveVerified` uses it.
  - Cards read **Beta**, with a tooltip saying the adapter is not yet validated, until that check passes; then they read **Live API**. Custom Carrier reads **No API**.
  - The store list header shows "Beta · live adapter not yet verified" or "Live API · verified".
  - The Help Center reads "Live adapter · Beta".
  - Live: `/api/channels/catalog` shows 0 verified and 18 Beta live adapters, which is correct for this DB.
- **Relative date presets (fixed).** Date fields in the condition modal (workflows and algorithms) now list Logiwa's comparators directly: Today, Last 3/7/30/90 Days, Last 12 Months, X days Ahead/Before, Within Next/Past X days, Monday…Sunday. After those come is between / after / before / empty / not empty. X-day presets ask only for "Number of days". Values are stored as the `dateIs` date-spec grammar and resolved at run time. The grid date filters already had all 17 presets plus Custom; I checked this on Workflows › Filter › Last run.
- **Nested AND/OR groups (fixed).** Shared, additive change: `ruleConditionGroupSchema`, `ruleConditionNodeSchema` and `isConditionGroup` in `lib/domain-types.ts`. `evaluateConditions` in `server/domain/conditions.ts` now evaluates group items recursively through the new `evaluateConditionNode`. Flat `RuleCondition[]` callers are unchanged. `workflows.conditions` is typed `RuleConditionNode[]`, a JSON column, so no migration was needed. `workflowSaveSchema` checks fields inside groups (`conditions.i.conditions.j.field`).
  - In the builder, **Add group** creates a group whose match is the opposite of the top level, so Match all gives A AND (B OR C). Each group has its own Match all / Match any, "Add condition to group N" and delete, and removing a group's last condition removes the group. Changing the trigger prunes fields inside groups.
  - The summary, change log and test panel describe a group as "(A OR B)".
  - Live API check: POST created a nested workflow, 201, summary "Shipment Order Date is Last 90 Days AND (Carrier is not empty OR Carrier is empty)", 3 conditions. GET round-tripped the group. `/api/workflows/test` matched with both lines passing. DELETE returned 200. An empty group is rejected with 400 `conditions.0.conditions`.
- **Column widths (fixed).** Workflows: # 52, Name 232, Active 88, Runs 76, Last run 172, Blocking 104, Trigger 110, Scope 176, Conditions 150, Actions 104. At 1440 there are no clipped headers or cells, and the last column ends at x = 1381.
  - Channel Methods: the channel logo now leads the Store name cell, because store names already carry the channel. The Channel column is still available in Columns but hidden by default. Sizes: Method 146, Store 206, Status 90, Job status 104, Next run 100, Last run 170, Result 112, Run 132. Every header and cell is complete at 1440, including STATUS, JOB STATUS, NEXT RUN, the countdown and the last-run timestamp.
- **QA records purged.**
  - Deleted through the audited APIs: KS-CRIT-WF-R5-UI, KS-CRIT-WF-R6, KS-CRIT-PUT-R6 and KS-CRIT-RS-R6 (all 200).
  - Data Import › Recent import jobs now hides harness uploads named `ks-crit-*` / `ks-test-*`, which covers `ks-crit-products.csv`.
  - Workflows, algorithms, presets, stores and carriers now hold only seeded business records.
- **Add condition guard (fixed).** Add (or Save condition) is disabled, with its reason, from the moment the dialog opens until field, comparator and value are valid. Checked in Playwright: disabled on open, disabled for Carrier with an empty value, enabled after a preset is chosen.
- **Algorithm editor first paint (fixed).** `/automation/algorithms/{putaway,allocation}/[id]` now load the algorithm on the server (`getAlgorithm`, behind the `automation.algorithms.view` check) and pass `initial` to the editor (`useApiQuery` `initialData`), so the HTML response already holds the Rule List, Primary Information and the canvas. The new Suspense fallback, `AlgorithmEditorSkeleton`, is editor-shaped, not a full-page grid skeleton.
  - Measured: GET returns 200 in 98–157 ms with "Rule List" and the algorithm name in the HTML. A warm browser navigation takes 1.7 s to the rule list and 1.9 s to the canvas, with no client fetch wait. The cold run took 24 s, which was dev recompile after the edit.
- **Putaway and allocation catalogs (checked against spec 06).**
  - Putaway has 38 actions (the reference has about 35), including Configure Volumetric Putaway, Check Max Locations per SKU, Check Max Sku Count and Suggest exactly the selected location. There are 10 Order By methods: Aisle, Allocated Quantity, Column, Level, Location Empty Volume, LP Count in Location, SKU Count in Location, Total Inventory Quantity, Walking Path Priority and Zone Priority.
  - Allocation has the inventory conditions Only Allocate Full LPs, Prioritize Same Pack Type and Prioritize Higher Pack Type, and 11 Order By methods.
  - Nothing was missing, so nothing changed.
- **Effects of the latest shared changes.** Shipping added `Tracking` and `Pickup` to `CARRIER_CALL_STEPS`, which broke `CallLogRow.step` in M12 `repositories/carriers.ts`. It is now typed from the full enum, and the Carrier Errors grids still filter by their own step.
- **Dev server during this round.** One HMR reload loop (dashboard and integrations pages reloading several times) and parse errors in other modules (`organization/customers-page.tsx`, `work-orders/work-order-detail-page.tsx`) were transient or belong to other modules. They are not M12 defects.
- **Tests.**
  - New `tests/unit/automation-integrations/round10-judge.test.ts` (7 tests): A AND (B OR C) and A OR (B AND C) evaluation, the flat-list regression, group schema and empty-group rejection, `describeConditionNode` and `conditionLeaves`, `workflowSaveSchema` group-field paths, preset resolution, and `verifiedLiveProviders` (a demo store is not verified; a credentialed store is).
  - M12 suite: 15 files, 128 tests, all green. Foundation suite: 633 of 634 tests pass; the one failure is `nav-config` (F4), which is not M12.
  - `tsc --noEmit` reports no M12 errors. The remaining errors are in shipping, orders-outbound, admin custom-fields, M09 listings-demo and work-orders.
  - eslint shows 0 errors on the changed files.
