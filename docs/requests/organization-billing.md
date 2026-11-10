# M11 organization-billing — shared-change requests

## REQ-1 — Inactive clients out of `/api/me` contextOptions
- **File:** `src/app/api/me/route.ts` (`contextOptions`)
- **Change:** add `.where(eq(clients.status, "Active"))` to the client list (or return `status` per client so `ClientSelect` in `src/components/shared/entity-pickers.tsx` can drop Inactive ones).
- **Reason:** BUILD_PLAN M11 §2 "Inactive client status flows into the order wizard's client select, where the client is excluded". Today `ClientSelect` only excludes inactive clients when it passes `warehouseId` (M11's `/api/clients?f.warehouseId=in:<id>` returns Active clients only); without a warehouse it lists every client from `/api/me`.
- **Status:** applied (F-patch 2026-11-06): `/api/me` `contextOptions.clients` only lists Active clients.

## REQ-2 — Register `retailer` (and billing entities) as platform entity types
- **File:** `src/server/repositories/platform-entities.ts`
- **Change:** add `def("retailer", { label: "Retailer", table: s.retailers, id: s.retailers.id, code: s.retailers.name, view: ["settings.retailers.view"], edit: ["settings.retailers.edit"] })`; optionally `billing_contract` (s.billingContracts, code name, warehouse/client columns, `settings.billing.*`), `billing_report` (s.billingReports, code billNumber), `vas_operation` (s.vasOperations).
- **Reason:** Retailer documents and logos should be `attachments` / owned `files` (so other users can download them, BUILD_PLAN M11 §4). Until this lands M11 keeps document file ids in `retailers.custom_fields._documents` and logos are readable only by the uploader. Custom fields section for `retailer` also needs the entity type.
- **Status:** applied (F-patch 2026-11-06): `retailer`, `billing_contract`, `billing_report` and `vas_operation` registered in `platform-entities.ts` (attachments, files, tags and change-log access go through their view / edit permissions). If custom-field definitions keep their own entity enum, that enum still needs `retailer` (file a request with the exact file).

## REQ-3 — Export grid key for bill detailed lines
- **File:** `src/server/exports/grid-keys.ts`
- **Change:** add `["billing-report-lines", "Billing Report Lines", "/api/billing-reports/{id}/lines", "settings.billing_report.view", "M11", "billing-lines"]` with support for a path parameter taken from the export query (`reportId`), or let the generic provider accept `listPath` templates.
- **Reason:** Billing report Details › Detailed tab must offer Export As Excel (BUILD_PLAN M11 §9). The grid uses gridKey `billing-report-lines`, which the export runner does not know yet.
- **Status:** applied (F-patch 2026-11-06): `billing-report-lines` registered with listPath `/api/billing-reports/{reportId}/lines`; the generic export provider fills `{name}` placeholders from the export query (`resolveListPath`, safe-segment validated) and removes the param. Export with `reportId=<id>` in the query.
- **Foundation pass 1 (2026-11-09):** verified all REQs above are DONE (pass 1); no further shared change pending.
- **Foundation pass 2 (2026-11-09):** re-verified against the code; all REQs above DONE (pass 2), no further shared change pending.

## Round 2 requests

### R2-1 — `billing_fees.charge_one_time` (Logiwa "Charge One Time", Recurring only)
- **File:** `src/server/db/schema/billing.ts` (`billingFees`) + migration.
- **Change:** add `chargeOneTime: bool("charge_one_time").notNull().default(false)`.
- **Reason:** Logiwa's Recurring fee has a "Charge One Time" switch (setup fees billed once, in the first calculated period). M11 will add the switch to the fee form, the fee card and the engine (skip once a Successful, non-canceled bill already charged the fee) once the column exists.

### R2-2 — LP SSCC-18 numbers should use the client's SSCC settings (owner M10)
- **File:** `src/server/repositories/lp-numbers*.ts` / `src/lib/grid-defs/facility/lp-numbers.ts` (`companyPrefixFor`, `buildSscc18`).
- **Change:** when `clients.settings.sscc.gs1CompanyPrefix` is set, build SSCC-18 from `settings.sscc.extensionDigit` + that prefix + the next serial (starting at `settings.sscc.serialNumber`, padded to 16 − prefix length) instead of the hashed 7-digit prefix. Read it with `readSscc(client.settings)` from `@/lib/grid-defs/organization/clients` (pure; also exports `ssccCheckDigit` and `previewSscc`).
- **Reason:** Logiwa Edit Client › Others "SSCC18 Barcode Creation"; M11 now stores these values (Round 1).

### R2-3 — `ClientSettingsInput` type should include `sscc` (foundation)
- **File:** `src/lib/domain-types.ts` (`clientSettingsSchema`).
- **Change:** add `sscc: z.object({ extensionDigit: z.string(), gs1CompanyPrefix: z.string(), serialNumber: z.string() }).partial().optional()`.
- **Reason:** M11 writes `settings.sscc` (cast in `repositories/clients.ts` `withSscc`); anything that parses settings with `clientSettingsSchema` currently strips it in memory.

### R2-4 — Edit drawers reset on background refetch (all modules, FYI)
- **Files:** every drawer keyed `${id}-${detail.dataUpdatedAt}` (warehouse, shipment package, mobile cart, LP type, location, wave rule, job type, carriers, channels, presets, algorithms, workflows, shipment plans).
- **Change:** freeze key + loaded record while the form is dirty, e.g. with `useFrozenWhileDirty` from `src/components/organization/use-stable-form-key.ts` (could move to `src/components/shared`).
- **Reason:** any invalidation of the detail query while the user edits (or while a slow save is pending) remounts the form, drops edits and can bump the version used for the conflict check. Reproduced on the client wizard (reset to step 1 mid-save).
### R2-5 — `order_lines.custom_fields` for SO DETAIL Charge If slots (owner F1 schema / M06)
- **File:** `src/server/db/schema/outbound.ts` (`orderLines`).
- **Change:** add `...customFields()` to `order_lines`, and register `so_detail` in `CUSTOM_FIELD_ENTITIES` (`src/lib/enums.ts`).
- **Reason:** Logiwa's Charge If list has 10 "SO DETAIL - Custom ..." slots. M11 already exposes LOCATION / LPTYPE / PRODUCT / SHIPMENT PLAN / SO slots. Once the column exists, M11 adds `soDetail` to `CUSTOM_ENTITIES` and `ol.custom_fields AS soDetailCustom` to `LINE_FACTS`.

### R2-6 — Grid footer: loading state instead of "Total: 0" (owner foundation grid)
- **File:** `src/components/grid/grid-footer.tsx`.
- **Change:** when `loading` is true and no rows have loaded yet, render a skeleton (or "Total: …") instead of `fmt.number(total)`.
- **Reason:** every grid briefly shows "Total: 0" on first load. M11 works around it on the bill Detailed tab by passing the known count.
- **Status:** DONE (foundation round 2, 2026-11-10): GridFooter `loading` prop.

### R2-7 — Push bill lines to accounting (owner M12 automation-integrations)
- **Change:** an accounting connector action (for example QuickBooks or Xero) that posts an Approved bill, then sets `billing_reports.exported_to_integration` and each line's `integration_status` to "Sent". Expose `POST /api/integrations/accounting/push-bill { reportId }`. M11 will add a "Send to accounting" item to the bill page menu once the endpoint exists.
- **Reason:** Logiwa shows "Exported to integration" and an Integration Status per line. M11 stores and displays the fields, but nothing sets them.

### R2-1 (update) — `billing_fees.charge_one_time`
- M11 now ships Charge One Time and stores it as a reserved condition `{ field: "__chargeOneTime" }` (`withOneTime` / `splitOneTime` in `src/lib/grid-defs/organization/billing.ts`). When the column lands, M11 will switch `feeColumns`, `feesOf`, `storedFeeSummary` and `loadEngineFees` over to it and migrate the existing markers.

### R3-1 (foundation: `src/server/query/grid-query.ts`) — accept `search` as an alias of `q`
List APIs only honour `?q=` (plus `qm=eq|sw`). `GET /api/clients?search=KS-CRIT` silently ignores the param. Please treat `search` as an alias of `q` in `parseGridQuery` (or reject unknown params with a 400) so callers can't get an unfiltered list by mistake. `?q=` works today and is now documented in docs/progress/organization-billing.md.
- **Status:** DONE (foundation round 2, 2026-11-10): `parseGridQuery` accepts `search` as an alias of `q` (an explicit `q` wins).

### R3-2 (foundation: `src/components/grid/data-grid*`) — horizontal scroll cue
At 768px, the grids overflow horizontally with no visual cue. Please add a right-edge scroll shadow to DataGrid when `scrollLeft + clientWidth < scrollWidth`, mirroring the sticky-column edge scrim. On /clients I already truncate Full name with an ellipsis and a title tooltip.

### R3-3 (foundation: `src/components/ui/date-picker*`) — locale-driven display
The DatePicker displays `YYYY/MM/DD` regardless of the user's date-format preference. Every billing grid and header now uses `useFormat().date` (user pattern, e.g. 10/1/2026), so the Calc. start date input on /billing/new is the only remaining mismatch. Please render the picker's display value with `formatDate(value, prefs)`.

### R3-4 (foundation: `src/components/ui/wizard/wizard.tsx`) — drawer footer vs body padding
The drawer-variant Wizard footer is `sticky bottom-0` inside a Drawer body that has `py-4`, so 16px of content scrolls visibly below the footer. My drawers now pass `bodyClassName="pb-0"`. A shared fix would help every drawer wizard (users, LP types, rate-shopping presets).

### R4-1 (foundation: `src/components/ui/callout.tsx`) — info variant uses primary (brand red)
`Callout variant="info"` styles with `border-primary/25 bg-primary-soft text-primary`. After the KitStak rebrand, primary is red, so every informational callout looks like an error. Please switch the info variant to the `--info` / `--info-soft` tokens. Billing currently overrides this locally with `className`.
- **Status:** DONE (foundation round 2, 2026-11-10): Callout `info` uses the info tokens.

### R4-2 (foundation: wizard drawer) — step title duplicates the first section title
The drawer Wizard renders the step label as a heading, and most steps then open with a FormSection that has its own title. Consider an option to hide the step heading when the body starts with a section, so each step shows one heading.

### R5-1 (platform-files, major): notes API must accept `client` entities
`GET /api/notes?entityType=client&entityId=<id>` returns HTTP 500 with an empty body, so the /clients/[id]?tab=activity Notes and Change History panels show skeletons forever. Please add `client` (and `vendor`, `retailer`, `customer`, `billing_contract`) to `entityRefSchema` and the `listNotes`/`createNote` scope resolution (a client note is scoped by `clientId = entityId`). The route should also return a typed 4xx for unknown entity types, not an empty 500.

### R5-2 (shell/foundation, minor): detail-page header and tab focus rings
/clients/[id] renders the PageHeader title "Client details", then a second "< Clients" back link, then the name. Please let PageHeader take the entity title, so there is one breadcrumb plus the title. UnderlineTabs should use `focus-visible:` rings instead of `focus:`, so a click doesn't leave a boxed outline.

### R5-3 (seed, major): demo data
The seed should include realistic billing contracts and bills for the seeded clients, using only 16-digit bill numbers. The 9-digit 261110001-261110003 rows come from an old seed. A purge script should remove KS-CRIT-* and KS-TEST-* contracts, bills and vendors before buyer demos. These rows were created by critic/test runs against the shared dev DB, and the builder did not delete them without approval.

### R2-8 (schema, M11 builder A) — `billing_fees.pricing_mode`
- **File:** `src/server/db/schema/billing.ts` (`billingFees`) + migration.
- **Change:** add `pricingMode: text("pricing_mode", { enum: ["perUnit", "fromQuantity", "tierBase", "graduated"] }).notNull().default("graduated")`.
- **Reason:** Logiwa's Charge radio (For Each Unit / From Quantity / Tier Base) now ships in M11 and is stored as a reserved condition `{ field: "__pricingMode" }` (`withOneTime` / `splitOneTime` in `src/lib/grid-defs/organization/billing.ts`). Once the column exists, M11 moves `feeColumns`, `feesOf` and `loadEngineFees` onto it and migrates the markers, together with R2-1.

### R2-9 (M14 admin-settings + seed) — one bill number format, configurable in Data Setup › Code generation
- **Files:** `src/lib/grid-defs/admin/lookups.ts` (`SEQUENCE_DEFS`), `src/server/repositories/company-sequences.ts`; foundation `src/server/domain/sequences.ts`; seed `src/server/db/seed/billing.ts`.
- **Change:**
  - Add a "Bill number" row with key `billNumber`, a prefix, and a padding of 3–12 (default 10). `nextValue` is not used, because the engine restarts the sequence every day. Preview: `<prefix>YYMMDD` followed by `padding` digits.
  - `billNumber()` in `sequences.ts` still pads to 3 (`bill: { padding: 3 }`), so seeded bills are 9 digits. Switch the seed to `wideBillNumber` from `billing-engine.ts`, or pad to 10.
- **Reason:** `wideBillNumber` already reads the global `billNumber` row's prefix and padding and falls back to 16 digits (`YYMMDD` + 10). Exposing the row gives one configurable format, as the critic asked.

### R2-10 (foundation grid) — search-pending cue
- **File:** `src/components/grid/grid-toolbar.tsx`.
- **Change:** while `refreshing` is true and the search text differs from the committed `q`, show a spinner inside the search field, and mark the grid body `aria-busy`.
- **Reason:** on a slow server, typing "Apex" in /clients left 9 rows on screen for about 4 s with no cue. The only cue was the refresh icon spinning at the far right.

### R2-11 (foundation lint, FYI) — `react-hooks/refs` in M11 helpers
`src/components/organization/use-stable-form-key.ts` (reads a ref during render, by design: it freezes the record while a form is dirty) and `AddressesField` (`ref={field.ref}` from `useController`) fail the new `react-hooks/refs` rule. Neither is a runtime bug. If the rule stays at error level, please add a shared primitive for "latest value while pristine", or relax the rule for `useController` refs.

### R2-12 (foundation platform) — `/api/notes` must not pull the whole import registry
- **Files:** `src/server/repositories/platform-files.ts` (static `import { getImportDefinition } from "@/server/imports/registry"`).
- **Problem:** on 2026-11-10 every `GET /api/notes?...` (client, product, any entity) returned an empty-body HTTP 500 for more than 20 minutes. The dev log showed Turbopack's "module factory is not available" for `inventory-commands.ts`, reached through `imports/handlers/inventory.ts`. The notes route has no use for import handlers, but the static import ties it to every handler module, so any half-saved handler takes Notes down on every detail page. It recovered later without an M11 change.
- **Change:** load the registry lazily inside the import-task helpers (`await import(...)`), or move the background-task / import helpers out of `platform-files.ts`, so the notes and attachments routes don't depend on the import graph.

### R2-13 (foundation shared) — NotesPanel retries a 5xx for ~20 s behind a skeleton
- **File:** `src/components/shared/notes-panel.tsx`.
- **Change:** pass `retry: 1` (or `retry: (n, e) => n < 1 && !is5xx(e)`) to the notes query so the existing "Notes could not be loaded. Retry" state appears within about 2 s instead of after the default retry backoff.

### R2-14 (foundation ui) — UnderlineTabs focus ring on mouse click, clipped by the list
- **File:** `src/components/ui/tabs.tsx` (`underlineTrigger`).
- **Problem:** after a mouse click, Radix moves focus to the trigger and Chromium reports `:focus-visible`, so the active tab draws `ring-2`. The list's `overflow-y-hidden` then clips the ring into a partial rectangle (critic R2, /clients/[id] and /billing/reports/[id]).
- **Change:** add `focus-visible:ring-inset` to the trigger, and suppress the ring after pointer interaction. M11 wraps its two strips in `src/components/organization/tab-focus-guard.tsx`, which can be deleted once the primitive handles this.
- **Status:** DONE (foundation round 2, 2026-11-10): pointer focus hides the ring; the ring is inset so the list no longer clips it.

### R2-15 (M04/vendors owner, FYI) — Organization tab H1s
M11 changed the H1 of /clients, /organization/customers and /organization/retailers from "Organization" to the entity name, so it matches the breadcrumb. `src/components/vendors/vendors-page.tsx` still renders "Organization" under the organization tab group. Please use "Vendors" there too so the four Organization tabs are consistent.

### R2-16 (foundation db) — migration for the one-bill-per-period guarantee
M11 now creates two SQLite triggers at runtime (`billing_reports_period_guard_ins` / `_upd`, see `ensureBillGuards` in `src/server/repositories/billing-engine.ts`). They refuse any insert or update that would leave two Successful, non-Canceled bills of one contract sharing a day (`RAISE(ABORT, 'KS_BILL_PERIOD_OVERLAP')`). Please move them into a committed Drizzle migration so fresh databases have them from the start. Use the same DDL: `CREATE TRIGGER IF NOT EXISTS … BEFORE INSERT ON billing_reports … WHEN NEW.bill_status <> 'Canceled' AND NEW.calc_status = 'Successful' AND EXISTS (overlapping live row)`, plus the `BEFORE UPDATE OF bill_status, calc_status, period_start, period_end, contract_id` twin. A plain unique index can't express "overlapping", which is why this is a trigger.

### R2-17 (foundation dev infra) — dev server served stale route modules
During round 3/4 the long-running `next dev` (Turbopack) kept executing old in-memory versions of `src/app/api/clients/route.ts` and `src/app/api/billing/calculate/route.ts`, even though the compiled chunks under `.next/dev/server/chunks` on disk were current. This caused the PII leak and the dryRun writes the critic saw. Re-saving the route fixed it. Please investigate. Two likely causes are a Windows file-watch miss and the persistent Turbopack cache. A periodic "dev server freshness" check would help, for example a build stamp header compared against file mtimes. M11 now defends in depth regardless: the clients route whitelists keys, and the calculate preview has its own read-only route.

### R2-18 (foundation grid) — disabled destructive toolbar button looks enabled
`src/components/grid/bulk-actions.tsx:45` renders `variant={action.destructive ? "danger" : "secondary"}` even when the action is disabled, which gives a filled pink button with no selection on /billing/vas and /organization/retailers. Please use `variant={action.destructive && !reason ? "danger" : "secondary"}` (or a `danger-outline` disabled style) so every disabled toolbar action shares one grey outlined look.

### R2-19 (foundation ui) — DatePicker / DateTimePicker display format
BUILD_PLAN 0.1 prescribes `YYYY/MM/DD HH:mm` for input pickers. The critic wants the picker display to follow the user's date pattern (R3-3), as grids, printouts and server messages now do (MM/DD/YYYY). This needs a primitive change (`src/components/ui/date-picker.tsx`, `datetime-picker.tsx`): a `displayFormat` defaulting to the user's pattern.

### R2-20 (foundation auth) — finance/viewer must read billing; operator must read customers and retailers
- **File:** `src/server/auth/permission-catalog.ts` (`DEFAULT_ROLE_PERMISSIONS`, `FLOOR_LOOKUP_PERMISSIONS`).
- **Problem (critic R4, verified live):** the `viewer` role (seed user finance@kitstak.io, the invoicing persona) gets 403 on `GET /api/billing`, `/api/billing-reports`, `/api/vas-operations`, `/api/customers` and `/api/retailers`, because `viewer` only receives `*.view` keys from `VIEWER_GROUPS` (no `settings`). `operator` also gets 403 on customers and retailers, which it needs for order work. Logiwa's role builder grants Client Setup › Billing read separately.
- **Change:** add a read-only list that both `viewer` and `manager` already-cover roles get, e.g. `const BILLING_READ_PERMISSIONS = ["settings.billing.view", "settings.billing_report.view", "settings.vas_operations.view", "settings.customers.view", "settings.retailers.view", "settings.clients.view"]` (filter through `KNOWN_KEYS`), merged into `viewer`. Add `settings.customers.view` and `settings.retailers.view` to `FLOOR_LOOKUP_PERMISSIONS` so `operator` gets them too. M11's routes already check exactly these keys and every write is gated separately (`*.create` / `*.edit` / `*.approve`), so no M11 code change is needed. Existing DBs need the role rows re-synced (seed `access.ts` or a migration that inserts the missing `role_permissions`).

### R2-21 (foundation grid) — one bulk-action pattern: let pages choose "all in Actions ▾"
- **Files:** `src/components/grid/grid-toolbar.tsx:120`, `src/components/grid/bulk-actions.tsx` (`inline = 2`).
- **Problem:** /clients shows Activate and Deactivate as greyed inline buttons next to an "Actions ▾" menu (critic R4: two bulk patterns side by side). GridToolbar does not pass `inline`, so pages cannot choose.
- **Change:** add `bulkInline?: number` to GridToolbar props and pass it as `inline`. M11 will then pass `bulkInline={0}` on /clients, /organization/customers and /organization/retailers so every bulk action lives in Actions ▾, as in Logiwa.

### R2-22 (foundation grid) — page-size select renders empty while the grid loads
- **File:** `src/components/grid/grid-footer.tsx:84-94`.
- **Problem:** on first paint of /clients the Rows-per-page Select shows an empty box (Total "—") until the query settles, because `pageSizeChoices(pageSize)` and the Select value only resolve once grid prefs load.
- **Change:** render the Select with a static fallback label (`Show ${pageSize} items`) during `loading`, or seed `pageSize` from the default prefs synchronously so the trigger always has a matching option.

### R2-23 (foundation dev infra) — dev server unusable for verification (Jest worker 500s, 37–900 s responses)
- **Problem (critic R4 + builder round 5):** every `/api/billing/[id]/**` and `/api/billing-reports/[id]` call returned HTTP 500 text/html "Jest worker encountered 2 child process exceptions, exceeding retry limit"; page navigations took 265–900 s; one node process at 9.7 GB RSS. On 2026-11-10 03:30 `/api/health` took 37 s twice. Builders are not allowed to restart :3000.
- **Change:** restart the shared `next dev` between rounds (or run critics against `next build && next start` on another port), and cap concurrent `next build` runs by other agents. A 404/500 on an API route must always be JSON (the define-route wrapper already does this; the HTML body comes from the dev worker crash, before the handler runs).


### R2-20 (still open, round 6, re-raised by critic R5 as major)
No change seen in `src/server/auth/permission-catalog.ts`. Exact minimal patch: append `"settings.customers.view", "settings.retailers.view"` to `FLOOR_LOOKUP_PERMISSIONS` (this gives operator and viewer floor lookups), and add `const FINANCE_READ = ["settings.billing.view", "settings.billing_report.view", "settings.vas_operations.view", "settings.clients.view"]` (filtered through `KNOWN_KEYS`) to the `viewer` set. Re-sync `role_permissions` for existing DBs.

### R2-23 (still open, round 6, blocker)
At about 05:05 on 2026-11-10, `GET /api/health` on :3000 timed out after 120 s, with 61 node.exe processes running. Restart the shared dev server between rounds, or serve critics from `next build && next start` on a separate port.

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** R2-1 (`charge_one_time`, migration 0002, already applied), R2-3 (`clientSettingsSchema.sscc`), R2-8 (`billing_fees.pricing_mode`, default "graduated", migration 0003), R2-16 (bill-period guard triggers committed in migration 0003), R2-18 (neutral disabled destructive), R2-20 (customers/retailers view for operator and viewer; viewer gets billing / billing report / VAS read; `settings.clients.view` deliberately left out per M11 round 7), R2-21 (`GridToolbar bulkInline`; 0 = all in Actions), R2-22 (page-size label), R3-2 (right-edge fade), R4-2 (`WizardStep.hideHeading`), R3-4 (sticky drawer footer), R5-2 (UnderlineTabs ring already fixed), R2-12 (notes route no longer imports the registry), R2-13 (NotesPanel `retry: 1`), R2-10 partial (stale rows dimmed while a search is in flight).
- **Not done:** R2-2 (M10), R2-4 `useFrozenWhileDirty` lift, R2-5 `order_lines.custom_fields`, R2-7 (M12), R2-9 bill number row, R2-11 lint rule, R3-3 / R2-19 picker display format, R5-1 notes for client entities, R5-3 billing seed/purge, R2-17 / R2-23 dev server.

## Round 2 requests — blind-judge repair round 1 (2026-11-10)

### R2-24 (admin-settings) — hide QA identities from Settings › Users by default
- **Problem (blind judge):** "KS-CRIT Invite …", "KS-CRIT M…", "KS-CRIT R6 …" accounts (created by critic suites, `ks-crit-*@example.com`) show in user lists during demos.
- **Done in M11:** `isTestIdentity(name, email)` in `src/server/repositories/clients.ts` (names `KS-CRIT|KS-E2E|KS-TEST|KS-QA …`, emails `ks-crit-…`, `ks-e2e-…`); the client "Users with access" tab drops them.
- **Ask:** the Users grid (`/settings/users`, M13) should hide the same identities unless a "Show test accounts" toggle is on (or add `users.is_test`, set by the e2e/critic helpers, and filter on it). Purging is safe too: none of them own data the demo depends on. Not done here because critic suites look these users up by name.

### R2-25 (inbound-receiving / M05) — FYI, vendors page edited by M11
- Per the judge list, `src/components/vendors/vendors-page.tsx` now uses the shared Status pill (Active / Inactive, header "Status") instead of a Yes/No badge, a one-line helper (keeps the Organization header the same height on all four tabs), a read-only **Show details** drawer (new file `src/components/vendors/vendor-details-drawer.tsx`: contact, addresses, client, open POs, 5 recent POs via `/api/purchase-orders?f.clientId=in:…&f.vendorName=eq:…`), name click / row click → Show details, and **Delete** in the row kebab (disabled with "This vendor has open purchase orders…" or a permission reason; runs the existing bulk delete with one id). No API or repository change.

### R2-26 (foundation, shared — done by M11, backward compatible)
- `src/config/nav-access.ts` `activeItemHref(menu, pathname)`: the longest matching item wins; `mega-menu.tsx` and `mobile-nav.tsx` use it, so `/billing/reports/[id]` highlights only "Billing Report", not also "3PL Billing". `isItemActive` is unchanged.
- `FilterFieldDef.preset?: boolean` (`src/components/grid/grid-types.ts`): `FilterPopover` pins preset fields until the viewer pins their own (`ks:filter-pins:<gridKey>` empty). Grids without presets behave as before.
- Seed: `src/server/db/seed/billing.ts` writes Logiwa Fee by / Charge by values and 16-digit bill numbers (`bill16:<day>` sequence, same as the engine); `src/server/db/seed/org.ts` adds a default Shipping address per client.

### R2-27 (foundation dev infra) — Turbopack restart / "HMR hash mismatch" reload loop
- With many agents editing, every page in a headless browser reloads every 2–3 s (`turbopack-message … "type":"restart"` and `reloadPage: HMR hash mismatch` on the HMR socket), so client fetches abort and pages never leave the skeleton. Verification scripts have to proxy the HMR socket and drop those two messages (`ctx.routeWebSocket(/hmr/, …)`). Real users of the shared dev server see the same loop.
