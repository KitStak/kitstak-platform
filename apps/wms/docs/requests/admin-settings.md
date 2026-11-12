# M14 admin-settings — shared change requests

## REQ-1 Register the Screen Configuration grid export
- **File:** `src/server/exports/grid-keys.ts` (M14 block, after the `printouts` row)
- **Change:** add
  `["screen-configs", "Screen Configurations", "/api/screen-configs", "settings.screen_configuration.view", "M14", "screen-configs"],`
  No provider entry is needed (the generic provider exports what `GET /api/screen-configs` returns).
- **Reason:** `/settings/screen-configuration/receiving` uses `useGrid({ gridKey: "screen-configs" })`, so the grid footer shows "Export As Excel" (`ExportButton`). Without the registry row `POST /api/exports` rejects the unknown grid key.
- **Status:** applied (F-patch 2026-11-06): `screen-configs` row registered in `grid-keys.ts` (M14 block, after `printouts`). The export registry test requires one provider file per key, so a `null` stub `providers/screen-configs.ts` is wired in `providers.ts`; the generic provider exports what `GET /api/screen-configs` returns.

## REQ-2 Route registry entries for the new M14 sub-routes
- **File:** `src/config/route-registry.ts` (`EXTRA_ROUTES`)
- **Change:** add
  - `{ pattern: "/settings/printouts/[type]", label: "Printout List", owner: "M14", parent: "/settings/printouts", permission: "settings.printouts_labels.view" }`
  - `{ pattern: "/settings/printouts/[type]/new", label: "Create Printout", owner: "M14", parent: "/settings/printouts/[type]", permission: "settings.printouts_labels.create" }`
  - `{ pattern: "/settings/printouts/[type]/[id]", label: "Edit Printout", owner: "M14", parent: "/settings/printouts/[type]", permission: "settings.printouts_labels.edit" }`
  - `{ pattern: "/settings/screen-configuration/receiving", label: "Receiving Screen Configuration List", owner: "M14", parent: "/settings/screen-configuration", permission: "settings.screen_configuration.view" }`
  - `{ pattern: "/settings/screen-configuration/receiving/new", label: "Create Receiving Configuration", owner: "M14", parent: "/settings/screen-configuration/receiving", permission: "settings.screen_configuration.create" }`
  - `{ pattern: "/settings/screen-configuration/receiving/[id]", label: "Edit Receiving Configuration", owner: "M14", parent: "/settings/screen-configuration/receiving", permission: "settings.screen_configuration.edit" }`
- **Reason:** global search / route-coverage test / auto breadcrumbs. The pages already pass explicit breadcrumbs, so nothing is blocked meanwhile.
- **Status:** applied (F-patch 2026-11-06): the six `/settings/printouts/[type]…` and `/settings/screen-configuration/receiving…` entries added to `EXTRA_ROUTES` as listed, with the given permissions.
- **Foundation pass 1 (2026-11-09):** verified all REQs above are DONE (pass 1); no further shared change pending.

## Round 2 requests (from foundation pass 1)
### REQ-F1 — Refresh `/api/me` after app activation changes
- **File:** `src/components/admin/apps/apps-page.tsx` (`useAction([["apps"]])`) and `app-settings-drawer.tsx`.
- **Change:** invalidate `["me"]` (`ME_QUERY_KEY` from `@/lib/permissions-client`) together with `["apps"]` after activate / deactivate.
- **Reason:** the top nav now hides items of inactive add-on apps (`NavItem.app`, reports-analytics REQ-2) using `GET /api/me` → `activeApps`; without the invalidation the Analytics menu only updates after `/api/me` goes stale or the page reloads.
- **Status:** DONE (pass 2): solved in foundation instead of M14: `createQueryClient()` (`src/lib/query-client.tsx`) cascades any invalidation of an `apps` / `clients` / `warehouses` query to `["me"]` (one refresh per tick), so the Apps page `useAction([["apps"]])` and the settings drawer already refresh the nav. No M14 edit needed. Test: `tests/unit/foundation-f4a/query-cascade.test.ts`.
- **Foundation pass 2 (2026-11-09):** all REQs DONE; nothing pending.

## Round 2 requests
Filed 2026-11-09 by the M14 round-1 parity loop. Data Setup now stores the Logiwa type-specific fields in `lookup_values.meta` (helpers: `lookupFormValues` / `lookupMeta` in `src/lib/grid-defs/admin/lookups.ts`). The keys other modules already read are unchanged: `levels`, `columns`, `operation`, `criteria`, `calculationType`, `countsAsDamaged`. The items below ask owners to consume the new keys.

### REQ-R2-1 — Honour Shipment Order Type behaviours (owners: orders-outbound, fulfillment-jobs, shipping)
- **Data:** `meta.flags` on `so_type` is a full boolean map. Keys are in `SO_TYPE_FLAGS`:
  - `allowMultiLocation`, `createBackOrder`, `allowPartialAllocation`, `validateAllocationCancel`, `autoCodeOnImport`
  - `allowLpSwap`, `allowLotSwap`, `allowExpirySwap`, `allowProductionDateSwap`
  - `partialPacking`, `overrideSerialScan`, `individualPackageProcessing`, `scanToCloseHigherPack`, `autoPrintUcc`
  - `allowShipWithoutLabel`, `allowPartialShipment`, `autoLoadingTask`
- **Change:** read the order's `orderTypeId` lookup in allocation, picking swaps, packing and Ship Order. For example, `src/server/domain/shipping/ship.ts` should skip the "Order can not be shipped without shipping label" error when `allowShipWithoutLabel` is on.
- **Why:** Logiwa's SO Type drawer has these as the type's behaviour switches. KitStaks now captures them, but nothing reads them yet.

### REQ-R2-2 — Order merge: data inheritance and new conditions (owner: fulfillment-jobs, `src/server/repositories/waves-run.ts` `runOrderMerge`)
- **New conditions:** `meta.criteria` can now also hold `channel`, `carrier`, `shippingService`, `priority`, `expectedDeliveryDate`, `expectedShipDate`, `orderDate` and `retailerId`. These are all `shipment_orders` property names, so the existing `c.order[k]` lookup already works.
- **Data inheritance:** `meta.inheritFrom` is `"oldest" | "newest" | "clean"`. Today the master is always the oldest order. Please pick the newest when the value is `"newest"`. For `"clean"`, create the master with empty optional metadata.

### REQ-R2-3 — Return reasons: usage and linked damage reason (owner: stations-returns)
- **Usage:** `meta.customerReason` / `meta.actualReason` (boolean; a missing key means true). In `return-receive-flow.tsx` and `rma-create-page.tsx`, offer only matching reasons: customer-reason pickers show `customerReason !== false` and actual-reason pickers show `actualReason !== false`.
- **Linked damage reason:** when `meta.linkedDamageReasonId` is set, receiving with that actual reason should default the damage reason to the linked one, so the stock goes to the damaged bucket.

### REQ-R2-4 — Packing warnings content (owner: stations-returns packing station)
- **Data:** `packing_warning_type` meta now has:
  - `warningText` (required)
  - `showWhen`: `order_displayed` | `close_pack` | `product_scanned`
  - `skipConfirmation` (boolean)
  - `mediaLinks` (array of http(s) URLs)
- **Change:** show the text and media at the trigger point. Require acknowledgement unless `skipConfirmation` is on.

### REQ-R2-5 — Custom carrier services and packages (owner: shipping / orders-outbound)
- **Data:** `custom_carrier` meta now has:
  - `services: {code,name}[]` and `packages: {code,name}[]`
  - `confirmationTypes`, `insuranceTypes`, `billingTypes` (string[])
  - `logoUrl`
  - The carrier code is `lookup_values.code`.
- **Change:** when the order carrier is a custom carrier, its services should feed the order's Shipping Service dropdown.

### REQ-R2-6 — Location zone priority / max locations per SKU; cart type dimensions (owner: facility-config / inventory putaway)
- **Location zone:** `location_zone` rows now have a zone `code` (`lookup_values.code`, required in the drawer) and meta `priority` and `maxLocationsPerSku`. Put-away suggestions (`putaway.suggestLocations`) could order zones by `priority` and cap the distinct locations per SKU.
- **Mobile cart type:** `mobile_cart_type` is now warehouse-scoped in Data Setup. The scope is optional; an empty value means all warehouses, and `mobile-carts.assertCartType` already accepts both. New meta keys:
  - `allowMultipleJobs`, `dimensionUnit`, `volumeUnit`
  - `cart: {height,length,width}` and `cell: {height,length,width,volume}`
  - The Mobile Cart wizard's read-only type summary can show these, as Logiwa does.

### REQ-R2-7 — Shell Help panel (owner: foundation, `src/components/layout/**`)
- **Change:** Logiwa's "?" now opens an in-app Help panel instead of a new tab (`references/logiwa-live/settings-shell.md` §Help Center panel). The panel has:
  - a hero link to the help center
  - "Main Articles (8)", each with a title and a one-line description: Process Manuals, Reports, Integrations, Workflow Rules, Client Management, Setup, Release Notes, Account Management
  - a Privacy Policy link
- **Also:** `Drawer` body padding (`py-4`) leaves a 16px strip under a `SubmitBar sticky` footer, so content scrolls visibly below the bar. M14 passes `bodyClassName="pb-0"` locally on the lookup, role and app-settings drawers. A Drawer-level fix would cover every module.

## Round 2 requests

1. **organization-billing (M11): CSRF header on `POST /api/billing/calculate`.** Normal admin and viewer browsing produces bursts of `security.csrf_rejected` rows (reason `missing_header`). The client that calls billing calculate must use `apiRequest` from `@/lib/api-client`, which sends the CSRF header, or add the header itself. M14 now groups repeated identical audit events (×N badge, "Group repeats" switch on by default), but the rejections should stop at the source.
2. **fulfillment-jobs (M03): deterministic Job Types order.** `src/server/repositories/job-types.ts` has `defaultSort: [{ field: "code", dir: "asc" }]` with an id tiebreaker, so MLT1 and KS2 rows interleave at random within a code. Add a secondary sort on the warehouse code (code, then warehouse). Also, the column-config icon is clipped beside the last header on `/settings/job-types`.
3. **Foundation (nav-config): Company Settings under Settings.** `src/config/nav-config.ts:428` lists "Company Settings" only in the user/account menu, so the Settings top-nav item isn't active on `/settings/company`. M14 now passes explicit `Home > Settings > Company Settings` breadcrumbs. Please also add `item({ label: "Company Settings", href: "/settings/company", permission: P.companySettings, owner: "M14" })` to the Settings mega-menu (for example a "Company" group with Company Settings, Apps and Data Setup) so the active underline matches.
4. **Foundation (wizard): one style for the active step.** `src/components/ui/wizard/wizard-state.ts` `stepStatus()` returns `attention` before `active`, so an active step that failed validation shows the orange attention pill, while other active steps are solid primary. Return `active` first for `index === state.current`, and show attention on the active step with a small dot or ring instead of a different fill.
   - **Status:** DONE (foundation round 2, 2026-11-10): the current step keeps the solid active fill with a warning ring when it failed validation (pills and stepper); the accessible name still says Needs attention.
5. **Foundation (global search, `src/components/layout/global-search.tsx` + `/api/search`):**
   - Page results should include every nav item with its aliases (Roles, Company Settings, Audit Log, Printouts, Data Setup lookups) and match partial or synonym terms ("users" should also match Roles and Audit Log through aliases).
   - Record lookup should return grouped results (orders, products, LPs, users) for prefixes like `SO-` within about 300 ms, and show "No records" instead of skeleton rows that never resolve.
   - Add a "Settings" group.
6. **Foundation (notifications page and bell):**
   - Seed about 10 sample notifications per admin (BUILD_PLAN line 1368 already calls for this; the DB currently has none).
   - Add type filters beyond All/Unread.
   - Link to per-type notification preferences (email and in-app).
   - Render "Mark all read" disabled with a tooltip when the unread count is 0.
7. **Foundation (top bar):** Logiwa has Screen Recording and Transactions popup icons; KitStaks has neither.
8. **Other modules (compile health):** HMR errors from `receiving po-form-model.ts` ("Unterminated regexp literal"), the missing `linesCsv` export in step-products, and products `listings-page.tsx` appeared in every settings page console during round 1. The owning modules need to keep their files compiling.
9. **Foundation (seed):** `src/server/db/seed/platform.ts` `seedPrintouts` exists, but the dev DB had 0 printout templates. M14 now self-heals on read with `ensureDefaultPrintouts()`. The seed should still be checked to make sure it runs.

## Round 2 requests (added round 3, 2026-11-09)

- Foundation (`src/server/auth/password-reset.ts`): add an optional `purpose: "reset" | "welcome"` to `ResetRequest`. When it is "welcome", skip the `auth.password_reset.request` audit row and use welcome email wording. `/api/users` POST already writes `user.invite_sent`.
- Foundation (`src/components/grid/*`): when the list query (or the grid-prefs or saved-views query) errors, end the skeleton and render the existing `error` + `onRetry` panel with the request id. A failing prefs or views fetch must not block rows. While refetching with `placeholderData`, keep the stale rows (no full skeleton, no "Total: 0").
- Foundation (`src/components/ui/wizard`): use one active-step style (the numbered stepper from DESIGN_SPEC) for every step. Step 4 currently renders as a solid red pill, while steps 1 and 2 are orange outlines.
- Foundation (`src/components/ui/skeleton`): raise the shimmer contrast on dark navy surfaces. KPI tiles should take a skeleton prop instead of showing "—" while loading.
- M11 and the owners of work-orders, counts, rate-shopping-presets, listings, shipment-plans and workflows: route every mutating fetch through `apiRequest` so the `x-csrf-token` header is sent (58 CSRF rejects in 24 h).

## Round 2 requests (added round 4, 2026-11-09)
- M03 fulfillment-jobs (`src/app/(app)/settings/job-types/page.tsx`, `src/components/job-types/job-types-page.tsx`): the route has no server guard, so the viewer can open it. Wrap it in `requirePagePermission("settings.job_types.view", "/settings/job-types")` like the other /settings/* routes. Gate "Create new job type" and the empty-state create card with `permissions.can(JOB_TYPE_PERMS.create)` (pessimistic), not `has` (optimistic while /api/me loads). Hide the edit and delete kebab items when the user lacks both.
- Foundation (`src/components/grid/*`): after about 5s pending, replace the skeleton rows with a "Still loading… / Retry" row and keep the footer total hidden ("Total: 0" currently reads as "no data"). Measured `/api/users`: 11-37s under dev-server contention, but the SQL runs in about 1ms on 13 users, so the latency comes from dev compile/CPU load and not from the queries.
- M11 organization-billing (`src/components/billing/billing-edit-page.tsx`) and M04 stations-returns (`src/components/returns/rma-create-page.tsx`): a compile error in either file 500s every route, Settings included ("_clientMiddlewareManifest.js" MIME error). On 2026-11-09 rma-create-page.tsx failed to parse at line 1. Foundation: confirm `src/app/(app)/error.tsx` covers runtime errors. Build errors cannot be caught by a boundary, so owners must keep their files compiling.
- Global shell: show the company logo from `/api/company` in the header brand slot (live logo preview requested by the critic).

### Round 5 additions (2026-11-09)
- **R5-1 `src/config/nav-access.ts` `activeMenuKey`**: /settings/company and /settings/apps (USER_MENU_ITEMS, not in any mega-menu column) resolve to no menu, so the Settings trigger has no underline. Fallback request: if no menu matched and `pathname` starts with `/settings` or `/account`, return the key of the menu labelled "Settings".
- **R5-2 `src/components/grid` DataGrid error state**: when the rows fetch fails (5xx, network), show an inline "Couldn't load, Retry" panel instead of an empty grid. Today a 500 from another module's compile error makes the Audit Log look empty. Same for the shell's /api/me and /api/notifications consumers in `src/components/layout`: render a retry state, not silent blanks.
- **R5-3 Performance**: run a `next build && next start` pass before the demo. First dev loads of /settings/* are 17–42s under contention.

### Round 6 additions (2026-11-09)
- **Grid / UI (src/components/grid/bulk-actions.tsx, owner: foundation)**: a disabled bulk action with `destructive: true` renders `variant="danger"` (filled salmon at 45% opacity), which reads as live. Request: `variant={action.destructive && !reason ? "danger" : "secondary"}` so disabled destructive actions (Users Deactivate, Roles Delete) use the neutral disabled style.
- **Jobs (src/components/jobs/list-shell.tsx, owner: fulfillment-jobs)**: CSS string contains a legacy octal escape (e.g. `"\2014"` in `content:`); use `"\2014"` or a String.raw template. It logs a compile error on global pages.
- **Wave / jobs (src/server/repositories/waves-run.ts:25, owner: fulfillment-jobs)**: imports `plannedWindow` from `./jobs-planning`, which does not export it (tsc TS2724). At 23:35 this broke every route, /api/users included (500), so round-6 live checks were blocked.
- **Role matrix (src/server/auth, DEFAULT_ROLE_PERMISSIONS, owner: foundation)**: viewer/operator hold no `settings.*.view` keys, so every /settings route correctly sends them to /forbidden. If read-only config access is intended (Logiwa parity), add `settings.warehouse.view`, `settings.printouts_labels.view`, `settings.lp_types.view` and the related keys to the viewer defaults. The pages already render read-only when edit permissions are missing.


### Round 2 parity loop additions (2026-11-10)

- **RP-1 Foundation (`next.config.ts` CSP): allow blob: frames.** `default-src 'self'` with no `frame-src` blocks every `<iframe src="blob:…">`, so embedded PDF previews never render. This affects the printout designer and any other module that previews a PDF in an iframe; the browser logs "Framing 'blob:…' violates … default-src 'self'".
  - Add `"frame-src 'self' blob:"`. Keep `frame-ancestors 'none'` and `X-Frame-Options: DENY`; they control who may frame *us*, not what we frame.
  - M14 detects the policy and falls back to its Canvas preview plus Open PDF in a new tab. Once the directive is present, the embedded PDF tab works automatically.
- **RP-2 M05 inbound-receiving (`src/server/repositories/purchase-orders.ts` `receivingRequirements`, `purchase-orders-receive.ts:138`): use screen-configuration conditions.**
  - Resolve the configuration with `configForPurchaseOrder(db, po.warehouseId, { clientId: po.clientId, poType: po.poType, vendorId: po.vendorId })` from `src/server/repositories/screen-configs.ts`. It returns the condition-matched active config, or the warehouse's unconditioned config, or null.
  - Use its `steps` (`scanLp`, `lot`, `expiry`, `productionDate`, `photo`, `dimensions`, `printLabel`, each `{show, required}`) instead of the warehouse-only lookup.
  - Add an e2e test: a config scoped to PO type "Drop Ship" makes Lot required only for that type.
- **RP-3 M04 stations-returns: enforce Return Process rules.**
  - Read `getReturnRules(db)` from `src/server/repositories/company-return-rules.ts`.
  - On return receiving and RMA line entry, call the pure `checkReturnLine(rules, shippedLines, line, { warehouseMismatch })` from `src/lib/grid-defs/admin/return-rules.ts` for each line. Map each `{rule, message}` onto `fieldErrors["lines.i.<field>"]`.
  - New RMA codes should come from `sequences.next(tx, "rma")`. Admins now set the prefix and next number on Settings › Data Setup › Return Process.
  - Return Reason meta (`customerReason`, `actualReason`, `linkedDamageReasonId`) is unchanged (REQ-R2-3).
- **RP-4 Foundation (`src/components/ui/wizard/wizard-state.ts`, `wizard-pills.tsx`, `wizard-stepper.tsx`): one active style.**
  - `stepStatus()` returns `attention` before `active`, so a failed active step turns orange while other active steps are red-filled. Return `active` for `index === state.current` first, and show attention on the active step as a small red dot or ring.
  - The active style everywhere should be brand-red fill with white text; complete is a green check; upcoming is neutral.
- **RP-5 Foundation (`src/components/ui/button.tsx`): a disabled treatment that reads as disabled.**
  - `disabled:opacity-45` on `primary` and `danger` gives a filled pink button that looks live.
  - Use `disabled:bg-neutral-soft disabled:text-faint disabled:border-border disabled:shadow-none disabled:opacity-100` for every variant (or at least primary and danger).
- **RP-6 Foundation (`src/app/(app)/notifications/**`, `src/components/layout/notification-*`):**
  - Map severity from the outcome, e.g. a wave with shortage > 0 is `warning`, not a green check.
  - Add type and severity filter chips, a "Clear read" action and pagination (cursor or page).
  - Render timestamps with `fmt.gridDateTime`; keep "x ago" only for the compact relative label.
- **RP-7 Foundation (`src/server/auth/permissions.ts` `requirePagePermission`): one Forbidden pattern.**
  - Seeded viewer and operator roles are redirected to `/forbidden?from=…`, but a custom-role user gets an in-place 403 at the same URL.
  - Prefer the in-place 403 for every role: call `forbidden()` from `next/navigation` with `app/forbidden.tsx`, or render the shared ForbiddenView. This keeps the URL and Back behaviour.
- **RP-8 Foundation (`src/app/login/**`): demo credentials banner.**
  - Render the "Demo workspace" banner with the admin email and password only when `process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO === "1"`.
  - Add a unit test that the banner is absent in production.
- **RP-9 Foundation (`src/app/api/auth/login/route.ts`): legacy `role` field.** A user whose only role is custom gets `"role":"operator"`. Return `roleNames: string[]` (and `roleKeys`), and drop or deprecate the single `role`.
- **RP-10 Foundation (shell, `src/components/layout/**`), Logiwa parity items still missing:**
  - **Printers popover:** a 2-step Direct Print setup. Step 1 picks the warehouse; step 2 assigns a barcode printer and a laser printer, by scan or search.
  - **Help panel:** see REQ-R2-7.
  - **Screen recording:** the support-capture icon.
  - **Feedback & Updates:** the persistent side tab.
- **RP-11 Foundation (`src/components/shared/change-log-drawer.tsx`): change-log copy.** M14 renders change-log rows as "Roles changed: A → B". The pure helper is `prettyLogMessage` in `src/lib/grid-defs/admin/common.ts`; please move it to `src/lib` and use it in the shared drawer so every module reads the same. The stored `… is modified. a --> b` format can stay for Logiwa parity.

## Round 2 requests (added parity loop round 3, 2026-11-10)

- **fulfillment-jobs (waves-run.ts `runOrderMerge`).** Order merge rules now offer an `orderTag` criterion, and a rule is warehouse-scoped (`lookup_values.warehouse_id`, required for new rules).
  - Today the key builder reads `c.order.orderTag`, which doesn't exist, so the criterion is ignored.
  - Please build that key part from the order's `entity_tags` (sorted tag names joined).
  - Please skip merge rules whose `warehouseId` is set and differs from the wave rule's warehouse.
- **fulfillment-jobs / waves (notification producers).** "Wave … completed" and the replenishment notices are written with `severity: "success"` even when they report shortages or skipped SKUs, and the copy has "1 jobs" / "19 shortage".
  - The notification center now derives a warning tone and fixes plurals at read time (`presentNotification`, `effectiveSeverity`, `fixPlurals` in `src/lib/grid-defs/admin/notifications.ts`).
  - Please also write `severity: "warning"` and use `count()` pluralization at the source.
- **facility-config / inventory (put-away).** Location Zone › "Match With Product Groups" stores `lookup_values.meta.productGroupIds` on each `location_zone`.
  - Put-away and picking rules can read it with `zonesForProductGroup(db, productGroupId)` from `src/server/repositories/company-zone-groups.ts`.
- **foundation (ui/dropdown-menu.tsx).** The icon of a disabled menu item keeps its color (red for destructive).
  - M14 grids now pass `destructive` only while an action can run (`armDestructive` in `admin-shared.tsx`).
  - Please make `DropdownMenuItem` render the icon with `text-faint` when it is disabled, so every module gets the same treatment.
- **foundation (ui/button.tsx).** `variant="danger"` with `disabled` still renders a saturated pink fill (opacity only). M14 works around this by not passing `destructive` while disabled.
  - Please add `disabled:bg-neutral-soft disabled:text-faint disabled:shadow-none disabled:opacity-100` (or an equivalent) to the danger variant.
- **foundation (grid).** Please add a horizontal scroll shadow on the right edge when a grid overflows, plus a `title` on truncated cells by default. M14 columns were tightened to fit at 1440.
- **foundation (shared files touched this round, review please).** Each was a minimal edit for an M14-assigned shell, search or notification defect:
  - `src/lib/theme-script.ts` follows OS theme changes while the preference is "system".
  - `src/server/search/match.ts` adds zero-insensitive code prefixes to `containsText`.
  - `src/server/search/registry.ts` registers the users and roles providers. The expected key lists in `tests/unit/foundation-f6/search.test.ts` were updated to match.
  - `src/server/repositories/platform-activity.ts` adds notification filters and delete.
  - `src/app/api/notifications/route.ts` adds DELETE.
  - `src/components/layout/{help-menu,help-panel,help-content,help-events,global-search,notification-item,notifications-page,printers-popover}.tsx`.

## Round 2 requests (added parity loop round 4, 2026-11-10)

- **REQ-R4-1 · foundation (`src/server/api/define-route.ts`): enforce role data restrictions on every API response.** Manage Restrictions (Carrier Cost, Carrier Account Data, Rate Shopping Data) is redacted only in `repositories/shipping.ts:201`. `orders.ts:332` (`shippingCost`), packing, returns and billing return the values unredacted.
  - M14 ships `deepRedactFor(subject, value)` in `src/server/repositories/roles-redaction.ts`. It handles nested lines, packages and shipments, matches keys case-insensitively, never mutates, and returns the same reference when nothing is restricted. It covers `totalShippingCost`, `returnShippingCost`, `shippingAccountNumber`, `taxDutiesAccountNumber`, `rateShoppingPresetId` and the foundation `RESTRICTED_FIELDS`. It is tested in `tests/unit/admin-settings/round4-parity.test.ts`.
  - **Change:** in `defineRoute`, just before `toResponse(value, requestId)`, use `const safe = auth && auth.restrictions.length ? deepRedactFor(auth, value) : value;`. `isRouteResult` envelopes need their `data` redacted, and `NextResponse` values pass through untouched.
  - **e2e to add:** a role with `carrier_cost` gets `totalShippingCost: null` from `GET /api/orders/:id`.
- **REQ-R4-2 · foundation (`src/server/exports/runner.ts`): restrictions in Excel exports.** Before writing the sheet:
  - filter the columns with `restrictedExportColumns(auth, columns)`, which drops each restricted column entirely;
  - pass the rows through `deepRedactFor(auth, rows)`.
  - Both are in `roles-redaction.ts`. Until REQ-R4-1 and REQ-R4-2 land, the Manage Restrictions dialog says only that restricted users "see an empty value"; it no longer claims every grid, export and API is covered.
- **REQ-R4-3 · inbound-receiving (M05, `purchase-orders.ts` `receivingRequirements` and `purchase-orders-receive.ts:138`): Screen Configuration conditions at runtime (RP-2).** `receivingRequirements` unions every active Receiving config in the warehouse and ignores the conditions (Client, PO type, Vendor). As a result, a config scoped to one client makes Lot optional for every client, and Photo, Dimensions, Scan LP and Print label never become required.
  - **Change:** replace it with `receivingPlanForPurchaseOrder(db, warehouseId, { clientId, poType, vendorId }, product.tracking)` from `src/server/repositories/screen-configs.ts`. It resolves the single matching config through `configForPurchaseOrder`, which prefers specific configs over catch-alls.
  - It returns `steps[{ key, show, required }]` and `tracking`, a drop-in for the current return value. The pure core is `receivingPlan` in `lib/grid-defs/admin/screen-configs.ts`, with unit tests.
  - **Mobile and web receive should:** show only steps with `show: true`, and block a line until each `required` step is done (photo, dimensions, scan LP, print label).
  - **e2e to add:** a config scoped to PO type "Drop Ship" makes Lot required only for Drop Ship POs.
- **REQ-R4-4 · foundation (`src/components/grid/data-grid.tsx` → `GridFooter`): "Total: —" while the grid is in error.** The footer shows `Total: 0` under the "Something went wrong" panel.
  - **Change:** `loading={(loading && data.length === 0) || Boolean(error)}`, or a dedicated `error` prop on `GridFooter` that renders "—".
- **REQ-R4-5 · foundation (`src/components/grid/data-grid-header.tsx:85`): header info icon placement.** `meta.headerTip` renders its `InfoTip` far from the label in wide columns.
  - **Change:** keep the icon inline right after the label text, for example inside the same `inline-flex` span, not after a `flex-1` spacer.
  - M14 removed the Restrictions column tip in the meantime.
- **REQ-R4-6 · foundation (`src/server/imports/columns/master-data.ts` `USER_COLUMNS`, `registry.ts`): Users import template.** M14 replaced the four stub handlers (`users`, `user-roles`, `user-warehouses`, `user-clients`) with working ones in `src/server/repositories/users-import.ts`.
  - **Template change:** the "User Type" options are `Web | Mobile | Web & Mobile`, but KitStaks user types are `Operation | Client`. Please change the options to `["Operation", "Client"]`. The handler also accepts Web, Mobile and Web & Mobile as Operation.
  - **Titles, if renamed to the Logiwa names:** the users page menu items currently read exactly as the registry titles ("Bulk import users", "Import user-role", "Assign/unassign user-warehouse", "Assign/unassign user-client"). If you rename `users` to "Import User-Role" and `user-roles` to "Update User-Role", ping M14 so the menu labels change in the same pass.
- **REQ-R4-7 · orders-outbound / fulfillment-jobs / shipping: SO-type behaviours (REQ-R2-1 restated).** All 17 Shipment Order Type switches now render read-only with a "Coming soon" badge, because no server code reads `meta.flags`.
  - **When a consumer wires a switch:** read the flag from the order type's `lookup_values.meta.flags[key]`, then add its key to `SO_TYPE_FLAGS_ENFORCED` in `src/lib/grid-defs/admin/lookups.ts`. The switch then becomes editable.
  - **Same pattern for merge rules:** the Order tag merge condition (`isMergeCriterionComingSoon`) and the "Newest" and "Clean state" data inheritance options are gated.
  - **Same pattern for location zones:** Location Zone priority, max locations per SKU and Match With Product Groups are gated by `ZONE_PUTAWAY_SETTINGS_ENFORCED`. Put-away sets that flag to `true` once it reads them.
- **Orchestrator / environment note: "Router action dispatched before initialization".** The throw site is Next's `sequential-router-queue.js`, from `hmrRefresh` / `restore` dispatching before the app router has hydrated.
  - This happens when HMR events from concurrent agents' edits arrive while a page is still hydrating on the overloaded dev server.
  - M14 code writes history only from click handlers (`users-page.tsx` `setDetailId`), and the shared `use-url-state` writes are debounced and run after user input. It should disappear on a quiet server or `next start`.

## Round 2 requests (added parity loop round 5, 2026-11-10)

- **REQ-R5-1 (foundation, `src/lib/permissions-client.tsx`)** — make `/api/me` a refresh, not a gate, app-wide. In `usePermissionSet()`, while `useMe()` is pending, fall back to `useShell().permissions` (the set the (app) layout already resolved on the server; identical on SSR and the client, so no hydration mismatch) and return `isLoading: false` when that seed exists. M14 now does this locally in `usePagePerms` (`resolvePagePerms` in `components/admin/admin-shared.tsx`); every other module's `useCan` / `<Can>` still waits on `/api/me`.
- **REQ-R5-2 (foundation, `src/server/db/seed/access.ts`)** — seed `passwordChangedAt` relative to the seed run (for example `utcAt(14, 15)`) instead of `createdAt`. With the seeded policy `maxAgeDays: 180`, every user created more than 180 days back is expired, and M14 now **enforces** expiry (shell gate → `/account/password`). The local `.data/kitstak.db` rows were refreshed to 14 days ago on 2026-11-10. A full re-seed without this change locks the demo admin into Change Password.
- **REQ-R5-3 (foundation: schema + `api/auth/login`)** — TOTP MFA. The verified core is in `src/server/repositories/users-mfa.ts` (RFC 6238 vectors in tests): `generateTotpSecret`, `verifyTotp` (±1 step, returns the counter for replay rejection), `otpauthUri`. Needed:
  - **Schema:** `users.mfa_secret` (encrypted text), `users.mfa_enabled_at`, `users.mfa_last_counter`.
  - **Login:** a second step when `mfa_enabled_at` is set (short-lived signed "mfa pending" cookie, then `POST /api/auth/mfa`).
  - **Recovery codes:** a `user_recovery_codes` table.
  - **Policy:** `requireMfa` in `passwordPolicySchema`.
  - **Then M14 ships:** enrollment (QR plus confirm code) on `/account/password` → "Two-step verification", "Require MFA" in Company Settings › Security, and "Reset MFA" in the user row menu.
- **REQ-R5-4 (foundation, `api/auth/login` + `defineRoute`)** — server-side idle enforcement and a login message. M14's `IdleSignOut` (shell) signs idle web users out client-side after `company_settings.defaults.sessionIdleMinutes` minutes, across tabs, after a 60 s warning. Needed:
  - **Server:** record `user_sessions.last_seen_at` on each authenticated request, throttled, and reject a session idle longer than `getSessionIdleMinutes(db)` (exported from `repositories/company.ts`).
  - **Login page:** show "You were signed out after N minutes of inactivity" for `?reason=idle`.
- **REQ-R5-5 (foundation, `defineRoute`)** — while `passwordChange` is pending (see `passwordChangeReason` in `server/shell/shell-props.ts`), APIs other than `/api/account/password`, `/api/account/password-policy`, `/api/me` and `/api/auth/*` should return `403 PASSWORD_CHANGE_REQUIRED`. Today the gate is shell-level only.
- **REQ-R5-6 (foundation, `components/grid/grid-footer.tsx` / `use-grid.ts`)** — until grid preferences load, the page-size select renders `""`. Default it to the grid's default page size ("Show 100 items"). In the error state, pass `loading`, or a new `unknown` flag, so the footer shows "Total: —" and not "Total: 0".
- **REQ-R5-7 (M03/M04/M06/M08 consumers)** — Shipment Order Type switches. `SO_TYPE_FLAGS_ENFORCED` in `lib/grid-defs/admin/lookups.ts` becomes non-empty as each consumer reads `lookupValues.attributes.<flag>` for the order's type. M14 flips a switch live the moment its key is added, with no other change. Needed:
  - **Allocation:** back-order creation, partial allocation, LP/lot/expiry swap.
  - **Packing:** partial packing, scan-to-close.
  - **Shipping:** auto UCC, ship without label, partial shipment.
  - **Merge:** Newest / Clean-state inheritance and the Order Tag condition in `runOrderMerge`.
  - **Put-away:** zone priority, max locations per SKU and Match With Product Groups.
- **REQ-R5-8 (producer, `server/repositories/waves-run.ts` `notifyWave`)** — send `severity: "warning"` when `allocatedOrders === 0`. The shell now displays such rows as warnings via `displaySeverity`, but the stored severity is still "success".
- **REQ-R5-9 (foundation: schema + `domain/notify.ts`)** — per-event notification preferences (in-app and email). Needed:
  - **Storage:** a `notification_preferences(user_id, kind, in_app, email)` table, or a `notifications` key in `userPreferencesSchema`.
  - **Filter:** `notify()` checks the preference before inserting.
  - **Then M14 ships:** `/account/notifications`, plus a "Notification settings" link in the bell footer. No dead link is shipped until then.
- **REQ-R5-10 (M13 reports-analytics, `src/components/dashboard/widgets.tsx`)** — this is the source of the `/dashboard` hydration error the critic hit on every shell screenshot. `ShiftClock` and `ShiftSummary` start with `React.useState(() => new Date())`, so the server renders `w.nowLabel` (for example "07:16 AM") and the elapsed `percent` at SSR time. The client hydrates a different minute, which gives "server rendered text didn't match the client". The fix:
  - Start with `useState<Date | null>(null)` and set it in the mount effect.
  - Until then, render the static start/end labels and a 0 % bar.
  - Or wrap the now label in `<time suppressHydrationWarning>`.
  
  The "Updated hh:mm" stamp in `dashboard-view.tsx` is already mount-gated and is not the cause.

## Round 2 requests (added parity loop round 6, 2026-11-10)

- **REQ-R6-1 (foundation, `src/server/api/define-route.ts` → `toResponse`, and `src/server/exports/**` runner)** — data restrictions still cover Shipping only. Wire `deepRedactFor(auth, payload)` (from `server/repositories/roles-redaction.ts`) into the JSON response path for every authenticated route, and `restrictedExportColumns(auth, columns)` into the Excel export runner. Until then, M14's Manage restrictions dialog says so explicitly (`RESTRICTION_COVERAGE` in `lib/grid-defs/admin/roles.ts`). Once this ships, delete that callout and its constant. This supersedes REQ-R4-1/2.
- **REQ-R6-2 (foundation, `src/server/auth/rate-limit.ts` `clientIp`)** — every audit and session row stores IP `"direct"`. Keep the rate-limit bucket as it is, but add `auditIp(request)` for audit and session rows:
  - when `TRUST_PROXY=1`, use the first `x-forwarded-for` hop;
  - otherwise use the address Next's own server forwards (`x-forwarded-for`, set by the Next router server in dev and `next start`), falling back to `127.0.0.1`;
  - never use `"direct"`.
  Pass it as `ip` to `writeAudit` and `issueSession`. The M14 audit grid now renders a legacy `"direct"` as "Not captured".
- **REQ-R6-3 (foundation, `src/server/auth/password-reset.ts`)** — route forgot-password emails through the company transport. Call `setMailAdapter({ send: (m) => sendCompanyMail(db, m).then(() => undefined) })` once at server start, using `server/repositories/company-mail.ts`. Add/user invites already use it (`users-invite.ts`): SMTP from Company Settings › Email delivery, a 72 h invite template, audit attributed to the admin. Today the forgot-password email still goes only to the dev log adapter.
- **REQ-R6-4 (foundation, `src/components/ui/wizard/wizard.tsx`)** — add a `stepper?: "pills" | "steps"` prop. The default stays tied to the variant; `"steps"` renders `WizardStepper` inside a drawer. Add user (drawer) can then use the same STEP 1..n stepper as Printouts and Screen Configuration (critic R5: two wizard patterns in one module).
- **REQ-R6-5 (foundation, `src/components/ui/toaster.tsx`)** — toasts sit bottom-right over grid footers (Export As Excel, pager) for several seconds. Stack them top-right below the header (Logiwa), or add a bottom offset of the grid footer height (about 56 px) on pages with a sticky footer.
- **REQ-R6-6 (foundation, `src/components/grid` DataGrid)** — add a `highlightRowId` prop: scroll the row into view and flash a 2 s background. Printouts now land on `?saved=<id>` with a "<name> saved · Show details" banner; it would also highlight the row.
- **REQ-R6-7 (M03/M04/M06/M08, unchanged from REQ-R5-7 / REQ-R2-2 / REQ-R2-6)** — the Shipment Order Type behaviour switches, merge-rule "Newest original order" / "Clean state" / "Order tag", and zone priority / max locations per SKU / product-group matching stay "Coming soon" in M14 until their consumers read them. M14 activates each one as soon as its key is added to `SO_TYPE_FLAGS_ENFORCED` / `ZONE_PUTAWAY_SETTINGS_ENFORCED`; no other M14 change is needed.

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** REQ-R2-7 drawer part (Drawer body drops its bottom padding when it holds a sticky footer: `has-[[data-sticky-footer]]:pb-0`; wizard footer and `SubmitBar sticky` carry `data-sticky-footer`, so local `bodyClassName="pb-0"` is no longer needed). #3 Company Settings + Apps now sit in a "Company" column of the Settings mega-menu. R5-1 (activeMenuKey: /settings/* and /account/* fall back to Settings). Round 6 grid item (BulkActions: a disabled destructive action renders `secondary`). Round 6 role matrix (viewer/operator read keys: warehouse, LP types/numbers, mobile carts, shipment packages, locations, products, customers, retailers). RP-4 (already done), RP-5 (filled `primary`/`danger` buttons use a neutral fill when disabled), RP-8 (already done), RP-9 (`POST /api/auth/login` returns `user.roleKeys` / `user.roleNames`; `role` kept as the legacy base role). Parity r3: DropdownMenuItem disabled icon `text-faint`, no destructive colours, `disabledReason` as sub-line; danger disabled style. R4-1/R4-2 → R6-1 (defineRoute redacts every authenticated JSON payload with `deepRedactFor`; the export runner drops `restrictedExportColumns` and redacts rows; `RESTRICTION_COVERAGE` copy and the roles dialog callout updated). R4-4 / R5-6 (footer "Total: —" while loading or in error; page-size Select renders its label in the server HTML). R4-5 (header (i) tip sits right after the label; right-aligned headers use `justify-end` in DOM order). R4-6 template options `["Operation", "Client"]` (registry titles unchanged). R5-2 (seed `passwordChangedAt` 14 days before the seed run). R6-2 (`auditIp(request)` for audit/session rows, never "direct"; rate-limit bucket unchanged). R6-3 (forgot-password emails use the company transport when no adapter is set). R6-4 (`Wizard stepper="steps"|"pills"`). R6-5 (toasts stack top centre below the header; `--toast-offset-top`). R6-6 (`DataGrid highlightRowId`: scroll into view + 2 s flash).
- **Not done (needs a product decision or a larger feature):** #5 global search grouping, #6 / RP-6 notification filters/preferences/severity, #7 / RP-10 screen recording, round 3 `purpose: "welcome"`, skeleton shimmer contrast, company logo in the header, RP-7 one Forbidden pattern, RP-11 moving `prettyLogMessage` (the shared drawer now localises ISO values, renders "—" for an empty side and pill-cased statuses instead), R5-1 `usePermissionSet` shell-seed fallback, R5-3 MFA, R5-4 server idle enforcement, R5-5 API-level PASSWORD_CHANGE_REQUIRED, R5-9 notification preferences, `settings.printouts_labels.view` for viewers.
- **Module-owned, not touched:** REQ-R2-1..6 / R4-7 / R5-7 / R6-7 (SO-type behaviour flags, merge inheritance, zone priority consumers), RP-2 / R4-3 (M05), RP-3 (M04), round 4 job-types guard (M03), R5-8 producer severity (M03), R5-10 dashboard hydration (M13).

## Round 2 requests (blind-judge repair round 1, 2026-11-10)

M14 wired three Shipment Order Type switches itself (minimal, backward-compatible edits, all switches default No so untyped orders behave as before): **Create back order** and **Allow partial allocation** in `src/server/domain/allocation.ts` (`allocateOne`), **Allow shipment without label** in `src/server/domain/shipping/ship.ts` (`shipOne`). Flags are read through `src/server/domain/so-type-flags.ts` (`orderTypeFlags(tx, order.orderTypeId)`; `meta.flags` is `{ key: true }`). Order Merge Rule inheritance (oldest / newest / clean) and the Order tag condition now drive `waves-run.runOrderMerge` via `repositories/order-merge-policy.ts`. Zone put-away settings were already read by `domain/putaway.ts`, so `ZONE_PUTAWAY_SETTINGS_ENFORCED` is now `true`. Remaining 14 SO-type switches stay read-only with "Coming soon" until their owner wires them; add the key to `SO_TYPE_FLAGS_ENFORCED` (`lib/grid-defs/admin/lookups.ts`) in the same change.

- **REQ-B1-1 · M06 fulfillment-jobs / M04 picking (`domain/task-handlers` pick execution):** `allowLpSwap`, `allowLotSwap`, `allowExpirySwap`, `allowProductionDateSwap` — when the order's type has the flag, a pick scan of another LP / lot / expiry / production date of the same product in the same location (or any location for LP swap) is accepted and re-points the allocation (release + allocate) instead of failing "wrong LP/lot". Without the flag keep today's strict match.
- **REQ-B1-2 · M04 allocation (`domain/allocation.ts` `planLine`):** `allowMultiLocation` — today a line may split across buckets for every order. Enforcing "No" would change all typed orders, so the proposal is: when a type has the flag **off and the data-setup admin opted in** (new type-level `strictSingleLocation` or flip the seed default to `allowMultiLocation: true` for D2C/B2B first), restrict a line to one location/LP. Needs a product decision before code.
- **REQ-B1-3 · M06 packing (`repositories/packing.ts` close package / close order):** `partialPacking` — allow Close Order with unpacked lines (remaining qty stays allocated, order → Packing Started/Ready to Ship per state machine) when the type has it; `overrideSerialScan` — skip the serial prompt; `scanToCloseHigherPack` — scanning a case barcode closes it as one package; `individualPackageProcessing` — label/ship each closed package; `autoPrintUcc` — on package close call the existing UCC label generator and send it to the user's barcode printer (Printers popover assignment; the Direct Print agent accepts ZPL at `http://127.0.0.1:9101/print`).
- **REQ-B1-4 · M08 shipping (`domain/shipping/ship.ts` + `state-machines.ts`):** `allowPartialShipment` — ship the packed packages of a `Packing Started` order (needs the transition `Packing Started → Partially Shipped` and `Partially Shipped → Shipped` on the next ship), and `autoLoadingTask` after unloading.
- **REQ-B1-5 · M03 orders (`repositories/orders-options.ts` + order wizard shipping step + `domain/orders/create-update.ts`):** custom carriers (Data Setup › Custom Carrier, `lookup_values.type = 'custom_carrier'`, `meta.services[] = { code, name }`) are not offered in the order's Carrier / Shipping service pickers. Append them to `carriers` as `{ connectionId: "custom:<lookupId>", label: name, carrierCode: code ?? name, services: meta.services.map((s) => ({ id: "custom:<lookupId>:<s.code>", name: s.name, transitDays: 0, isInternational: false })) }`, and on save map a `custom:` selection to `carrier` = carrier code and `shippingService` = service name with `carrierConnectionId` / `carrierServiceId` null (no label call). The custom carrier drawer is now a stepped wizard (General, Services, Packages, Advanced) with inline add / rename.
- **REQ-B1-6 · M03 job types (`lib/grid-defs/jobs/conditions.ts`):** custom-field conditions are labelled by slot ("SO custom field text box 1"). Label them with the defined name from `/api/custom-fields?entityType=shipment_order` (inactive slots hidden), e.g. "Gift message (custom)". Verified otherwise: Settings / Conditions / Grouping are disabled until General validates; 38 order condition fields plus 10 custom-field slots; Order By is a dnd-kit sortable list; Count has separate Location and SKU condition steps; Replenishment has destination / source location, LP and product conditions.
- **REQ-B1-7 · all modules (print flows, `components/shared` print modal):** when the user's Direct Print agent is connected (`GET http://127.0.0.1:9101/status`, remembered in `localStorage["ks-print-agent-seen"]`), send rendered labels/documents to `POST /print { printer, format: "zpl" | "pdf", data(base64) }` with the user's barcode / laser printer from `GET /api/printers` instead of opening the browser dialog. The agent is served by `GET /api/printers/agent`; CSP `connect-src` now allows `http://127.0.0.1:9101` (next.config.ts).
- **REQ-B1-8 · test harness (critic scripts):** test records keep the `KS-CRIT` prefix; run `node scripts/purge-critic-data.mjs --apply` after a critic round to remove KS-CRIT users, printout templates, screen configs, saved views, roles and lookups from the admin grids (operational records are left to their modules).
