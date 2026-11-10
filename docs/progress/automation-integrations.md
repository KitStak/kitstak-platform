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
