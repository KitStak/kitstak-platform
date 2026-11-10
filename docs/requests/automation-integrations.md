# M12 automation-integrations — shared-change requests

## REQ-1 — Address lines in order facts
- **File:** `src/server/domain/facts.ts` → `orderFacts()`
- **Change:** add `shipAddress: order.shipAddress, shipAddress2: order.shipAddress2` (and optionally `customerEmail`, `storeOrderNumber`) to the returned facts.
- **Reason:** the workflow condition "Address Line 1 contains PO Box" (acceptance "Block PO Box", and the seeded workflow *Block PO box addresses*) never matches because the fact is missing. M12's Test against order already adds these locally (`src/server/repositories/workflows.ts` adapter), but production `runWorkflows()` uses `orderFacts` only.
- **Status:** applied (F-patch 2026-11-06): `orderFacts()` now includes `shipAddress`, `shipAddress2` (also as `addressLine1` / `addressLine2`), `customerEmail` and `storeOrderNumber`, so production `runWorkflows` matches "Address Line 1 contains PO Box".

## REQ-2 — Export grid keys for M12 grids
- **File:** `src/server/exports/grid-keys.ts` (+ one stub per key under `src/server/exports/providers/` that re-exports `null` or the M12 provider)
- **Change:** register these grid keys (gridKey, title, listPath, permission, owner M12, prefix, fixedParams):
  - `algorithms-putaway` · Putaway Algorithms · `/api/algorithms` · `automation.algorithms.view` · `{ kind: "putaway" }`
  - `algorithms-allocation` · Allocation Algorithms · `/api/algorithms` · `automation.algorithms.view` · `{ kind: "allocation" }`
  - `workflows` · Workflows · `/api/workflows` · `automation.workflows.view`
  - `workflow-runs` · Workflow Runs — not exportable (skip)
  - `rate-shopping-presets` · Rate Shopping Presets · `/api/rate-shopping-presets` · `automation.rate_shopping.view`
  - `channel-methods` · Channel Methods · `/api/integration-logs/methods` · `integrations.integration_logs.view`
  - `integration-orders` · Orders and Shipments · `/api/integration-logs/items` · `integrations.integration_logs.view` · `{ kind: "orders" }`
  - `integration-products` · Products and Inventory · `/api/integration-logs/items` · `integrations.integration_logs.view` · `{ kind: "products" }`
  - `monitoring-health` · Channel Health Overview · `/api/monitoring/health` · `integrations.integration_monitoring.view`
  - `monitoring-recent-errors` · Recent Errors · `/api/monitoring/recent-errors` · `integrations.integration_monitoring.view`
  - `monitoring-workflow-blocked` · Workflow Blocked Shipment Orders · `/api/monitoring/workflow-blocked` · `integrations.integration_monitoring.view`
  - `monitoring-listing-exceptions` · Product Listing Exceptions · `/api/monitoring/listing-exceptions` · `integrations.integration_monitoring.view`
  - `carrier-errors-rate-call` · Carrier Errors · Rate Call · `/api/carriers/call-logs` · `integrations.carrier_monitoring.view` · `{ step: "RateCall" }`
  - `carrier-errors-void-label` · Carrier Errors · Void/Cancel Label · `/api/carriers/call-logs` · `integrations.carrier_monitoring.view` · `{ step: "VoidLabel" }`
- Also **update the three existing M12 keys' `listPath`** to the M12 endpoints:
  - `integration-logs` → `/api/integration-logs/history`
  - `integration-monitoring` → `/api/monitoring/missing-orders`
  - `carrier-errors` → `/api/carriers/call-logs` with `fixedParams { step: "LabelGeneration" }`
- **Reason:** A0 requires Export As Excel on every grid; the grids already use these keys, so exports start working as soon as the keys exist. M12 owns the APIs listed (`/api/{algorithms,workflows,rate-shopping-presets,channels,carriers,integration-logs,monitoring}/**`).
- **Status:** applied (F-patch 2026-11-06): all 13 keys registered in `grid-keys.ts` (with `fixedParams` as listed; `workflow-runs` skipped), each with a `providers/<key>.ts` stub wired in `providers.ts`; the three existing M12 keys now point at `/api/integration-logs/history`, `/api/monitoring/missing-orders` and `/api/carriers/call-logs` (`step=LabelGeneration`).

## REQ-3 — Channel connection on created orders
- **File:** `src/server/domain/orders/schemas.ts` (`orderHeaderSchema` / `createOrderSchema`)
- **Change:** accept optional `channelConnectionId: z.string().nullish()` and `channelPaymentStatus: z.string().max(50).nullish()` so `createOrder` stores them.
- **Reason:** Download Orders creates orders through `orders.createOrder`; the backlog channel logo/store and Channel Monitoring counts join on `shipment_orders.channel_connection_id`. Until this lands M12 sets the two columns right after `createOrder` inside the same transaction (`src/server/integrations/runtime/download-orders.ts`, documented adapter).
- **Status:** applied (F-patch 2026-11-06): `orderHeaderSchema` accepts `channelConnectionId` and `channelPaymentStatus` (max 50); `createOrder` stores them. The post-create adapter in `download-orders.ts` can go.

## REQ-4 — ORDER_CHANNELS values for non-Shopify stores
- **File:** `src/lib/enums.ts` → `ORDER_CHANNELS`
- **Change:** add `"ShipStation"`, `"eBay"`, `"Etsy"`, `"WooCommerce"`, `"BigCommerce"` (keep existing values).
- **Reason:** channel downloads from those stores currently map to `"Wholesale"` because the enum has no matching value, so the backlog shows the wrong channel badge.
- **Status:** applied (F-patch 2026-11-06): `ORDER_CHANNELS` now also has "ShipStation", "eBay", "Etsy", "WooCommerce", "BigCommerce" (existing values kept). This also fixed the 5 type errors in `channels.ts`.

## REQ-5 — Register the M12 carrier adapters with the foundation registry
- **File:** `src/server/domain/carriers/index.ts`
- **Change:** add `import "@/server/integrations/carriers";` (side-effect import; it calls `registerCarrierAdapter` for ups, fedex, easypost, shippo).
- **Reason:** label/rate/void calls resolve adapters through `getCarrierAdapter(provider)`; M12's adapters only register when their module is imported. Today only the scheduler task imports it, which may be a different bundle from the shipping routes, so UPS/FedEx setups can report "integration is not configured yet" at label time.
- **Status:** applied (verified 2026-11-06: `domain/carriers/index.ts` imports `@/server/integrations/carriers`).

## REQ-6 — `match` prefixes on config page tabs
- **File:** `src/config/page-tabs.ts` (`PageTab` + groups) and `src/components/layout/page-header.tsx` (`GroupTabs` map)
- **Change:** add optional `readonly match?: readonly string[]` to `PageTab`; pass `match: t.match` through in `GroupTabs`. Set:
  - `integrations` → Plugin Integrations `match: ["/integrations/carriers"]`; Channel Logs `match: ["/integrations/logs"]`
  - `monitoring` → Items For Review `match: ["/integrations/monitoring/recent-errors", "/integrations/monitoring/workflow-blocked", "/integrations/monitoring/listing-exceptions"]`
- **Reason:** on `/integrations/logs/history`, `/integrations/carriers` and the other Items For Review pages no tab is highlighted (Channel Logs's href is `/logs/methods`, which is not a prefix of its siblings). `PageTabItem.match` already exists in `ui/tabs.tsx`; only the config/GroupTabs plumbing is missing.
- **Interim:** M12 passes explicit tabs via `src/components/integrations/shared/route-tabs.tsx` (`useSectionTabs`), which can switch back to `tabs="<group>"` once this lands.
- **Status:** applied (F-patch 2026-11-06): `PageTab.match?: readonly string[]`; `GroupTabs` passes `match` through. Plugin Integrations matches `/integrations/carriers`, Channel Logs matches `/integrations/logs`, and Items For Review matches the recent-errors, workflow-blocked and listing-exceptions routes. `useSectionTabs` can switch back to `tabs="<group>"`.

## REQ-7 — Rebrand the two "LogiwaIO" error-catalog codes
- **File:** `src/lib/integration-errors.ts`
- **Change:** rename codes `"One or more SKUs could not be created in LogiwaIO"` → `"One or more SKUs could not be created in KitStaks"` and `"One or more SKUs in the order were not found in LogiwaIO"` → `"One or more SKUs in the order were not found in KitStaks"`. In `integrationError(code)` also accept the old spelling (`code.replace("LogiwaIO", "KitStaks")`) so rows stored before the rename still resolve. Optional one-off data fix: `UPDATE channel_missing_orders SET last_error_code = replace(last_error_code, 'LogiwaIO', 'KitStaks')` (same for `channel_run_items.error_code` if present).
- **Reason:** competitor brand name shows in Missing Orders / Recent Errors / Setup Details. M12 masks it in the UI with `errorCodeLabel()` (`src/components/integrations/shared/logos.tsx`); once this lands M12 switches `channel-runtime.ts` to the new codes.
- **Status:** applied (F-patch 2026-11-06): both catalog codes now read "…in KitStaks"; `integrationError()` maps the old "LogiwaIO" spelling, so old rows still resolve. Live data fixed: 3 `channel_missing_orders.last_error_code` rows and 1 `channel_run_items.error_message` row (`channel_run_items` has no `error_code` column). **M12:** `channel-runtime.ts` still throws the old codes, so switch it to the new ones and update `tests/unit/automation-integrations/repositories.test.ts:115`. Drop `errorCodeLabel()` once nothing writes the old spelling.
