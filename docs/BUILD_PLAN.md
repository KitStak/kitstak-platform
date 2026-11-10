# KitStaks WMS — Build Plan to Logiwa iO Parity (and beyond)

Status: authoritative plan. Baseline: commit `543301e` (read-only viewer; see
`references/logiwa-spec/00-kitstaks-current.md`). Benchmarks: `references/logiwa-spec/01..08`.

**Goal.** Every page, tab, wizard, modal, dropdown, bulk action, row action, detail page and
navigation path works end-to-end against the real DB. That means no dead buttons, no SYNTH or
STATIC data paths, and no presentation shims. Every mutation is validated, authorized, scoped,
audited and reflected in the inventory ledger where it touches stock.

**Execution model.**
1. **FOUNDATION (F0–F8)** lands first, serially, on one branch. It owns every shared file.
2. **14 MODULE packages (M01–M14)** are then built in parallel with strictly disjoint file
   ownership. A module may *import* foundation code and may *link* (URL) or *fetch* (HTTP) to
   another module's routes. It may never edit a file it does not own.
3. Each module loops: build, self-test, then hand off to a harsh critic agent. The critic
   compares against Logiwa side by side per `docs/CRITIC_RUBRIC.md` and the acceptance list
   below. The loop continues until the verdict is "wowed" and every acceptance item passes.

> Next.js note (from `AGENTS.md`): this repo runs Next **16.4.5** with `cacheComponents: true`.
> Before writing route handlers, layouts, `params`, `searchParams`, caching or middleware code,
> read the relevant guide in `node_modules/next/dist/docs/` and heed its deprecations.
> Runtime data (cookies, headers, searchParams) must sit inside `<Suspense>`.

---

## 0. Global conventions (binding for foundation and every module)

### 0.1 Naming and layout
- Route groups: authenticated pages live under `src/app/(app)/`, and every API under `src/app/api/`.
- Each module owns these four kinds of path:
  - `src/app/(app)/<route>/**`
  - `src/components/<module-dir>/**`
  - `src/server/repositories/<module-prefix>*.ts`
  - `src/app/api/<module-api>/**`
- Each module also owns:
  - `src/lib/grid-defs/<module-dir>/**`: column and filter field definitions. These are pure TS, imported by both client and server.
  - `tests/unit/<module-id>/**` and `tests/e2e/<module-id>/**`.
  - Specific *stub files* created by foundation and handed over by name (see 0.6).
- IDs: `text` UUID (`crypto.randomUUID()`). Timestamps: ISO-8601 UTC `text`. Money: `real`, rounded to 2 dp at the service boundary. Quantities: `integer` in the **UOM (primary) unit**. Pack quantities are derived through `product_pack_types.uom_qty`.
- Display formats come from user preferences:
  - Date-time default `M/D/YYYY h:mm:ss A` (Logiwa parity).
  - Input pickers use `YYYY/MM/DD HH:mm`.
  - Money is `66.03 USD` in grids and `$66.03` in summary rails.

### 0.2 API contract
- Every handler is built with `defineRoute()` (foundation, `src/server/api/define-route.ts`). It does all of the following:
  1. Verifies the session against `user_sessions`, so revocation works.
  2. Enforces CSRF on non-GET requests.
  3. Checks `permission`.
  4. Parses `query`/`body` with zod.
  5. Applies warehouse/client scope.
  6. Runs the handler inside a SQLite transaction for mutations.
  7. Maps domain errors to the envelope `{ success, data, error, meta, fieldErrors? }`.
  8. Writes `change_log` / `audit_log`.
- List endpoints accept the **KitStaks grid query grammar** (parsed by `src/server/query/grid-query.ts`):
  - `q=<text>&qm=eq|sw`: quick search with Equal / Starts With (Logiwa parity).
  - `f.<field>=<op>:<value>`. The ops are `in`, `nin`, `eq`, `ct`, `sw`, `ew`, `ex`, `empty`, `rng` (`rng:10..50`), `bool`, and `date`. Date values are a preset (`today`, `last3d`, `last7d`, `last30d`, `last90d`, `last12m`, `aheadNd`, `beforeNd`, `withinPastNd`, `withinNextNd`, `sun`…`sat`) or `custom:<from>..<to>`.
  - `sort=<field>` or `sort=-<field>` (multi-sort comma separated), `page=<n>`, `ps=100|300|500|700|1000`.
  - The same grammar is used in page URLs, so filtered views are shareable deep links (dashboard drilldowns and hyperlink cells open pre-filtered lists).
- Mutations return the updated record. Optimistic concurrency: the client sends `version` and the server returns **409** with the `CONFLICT` code on a mismatch. The UI shows "This record changed since you opened it — Reload".
- Bulk endpoints take `{ ids: string[] }` (max 1000) and return a per-id result: `{ succeeded: id[], failed: {id, code, message}[] }`. The UI then shows the toast "3 of 4 orders shipped · 1 failed (View)".
- Error codes: `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INVALID_STATE` (status-machine guard), `INSUFFICIENT_STOCK`, `RULE_VIOLATION` (location/LP mixing rules), `DUPLICATE`, `RATE_LIMITED`.

### 0.3 UX contract (every page, every module)
- **Page structure.**
  - Page header: breadcrumb (derived from nav-config), H1, centered helper text, then primary and secondary CTAs top-right.
  - Route-based tab strip from `src/config/page-tabs.ts`. Each tab is a real route, so deep links work.
- **Grid toolbar:** search-mode (Equal / Starts With), search box, Filter ▾ (New/Saved), chips with +N overflow, Save view, Clear, bulk actions (disabled until selection, with a tooltip saying why), then Refresh.
- **Grid behavior:**
  - Server sort and pagination.
  - Column chooser that persists per user, plus resize and reorder.
  - Density Large/Small, page sizes 100/300/500/700/1000, `Total: N` / `Selected: N`.
  - **Export As Excel**, real `.xlsx` and async, landing in Export History.
- **Row kebab:** Show Details / Edit / Change Log / Delete (the set varies by entity). Primary-key cells are links.
- **Drawers and wizards:**
  - Create/edit happens in right drawers or full-page wizards using the shared `Wizard`.
  - Required fields are marked `*`.
  - **Inline error text** appears under each invalid field, and focus moves to the first error. This beats Logiwa, which only shows red borders.
  - An unsaved-changes guard runs on close or navigate.
  - Save stays disabled while the form is invalid or submitting.
- **Destructive actions:** red-header `ConfirmDialog` with a mini-table of affected records, `No` / `Yes`.
- **Feedback:** toasts bottom-right (`Success` / `Error` title plus message). Long jobs (imports, exports, bulk ops, waves) appear in the header **Transactions** tray.
- **Mandatory states:** loading skeleton, empty state (icon, copy and CTA cards), error state with Retry, a 403 page for unauthorized routes, and a 404 for missing records.
- **Accessibility:** keyboard navigable (Radix primitives), visible focus ring, AA contrast.
- **Responsiveness and stability:** works 1280–1920 wide, usable down to 768, no console errors or warnings.
- **No dead controls.** Every enabled control does something observable. A disabled control explains why in a tooltip ("Select at least one order", "Only Pending POs can be received").
- Every status renders with the shared `StatusPill` color maps (0.5).

### 0.4 Domain invariants (enforced in foundation `src/server/domain/**`; modules must go through these)
1. **Inventory only changes through `ledger.*`.** Every quantity or attribute change writes one or more `inventory_transactions` rows (18 types) and updates `inventory` buckets atomically. On-hand must never go below 0. `allocated` must never exceed on-hand minus damaged.
2. **Status changes only through `stateMachines.<entity>.transition()`.** Invalid transitions throw `INVALID_STATE` with a human message.
3. **Writes are logged.** Every create/update/delete on a business entity writes `change_log` rows at field level, as `old --> new` with human-readable labels (beats Logiwa's raw `Logiwa.NameKey.*`).
4. **Codes come from `sequences.next(key, warehouseId?)`.** Examples: `SO000123`, `PO000045`, `Job000201`, wave `<ruleSeq>-<runCount>`, RMA, count `CNT…`, instant count `IC<yyyyMMddHHmmssfff>`, LP `<prefix><zero-pad>`, bill `YYMMDD<seq>`.
5. **Scope:** every read/write is filtered to the user's `user_warehouses` / `user_clients` (or all-clients). Cross-scope access returns 404, not 403, so record existence does not leak.
6. **Verification:** `npm run db:verify` (foundation) asserts:
   - ledger sum = bucket on-hand for every bucket;
   - allocations = sum of active `inventory_allocations`;
   - order line picked ≤ allocated ≤ quantity;
   - PO received = sum of non-cancelled receipts.

   Every module's e2e suite ends by running it.

### 0.5 Status pill color maps (`src/lib/status-colors.ts`, foundation)
Use Logiwa's semantics, rendered in the KitStaks palette from DESIGN_SPEC:
- **Shipment order:**
  - Open: green #D3F0E3/#17874D.
  - Ready to Pick and the in-process statuses: blue #D5E5F2/#0D36A3.
  - Ready to Ship / Ready to Load: purple #DFCEF5/#621DB8.
  - Shipped / Partially Shipped (+ "P" mini-pill) / Delivered: green.
  - Shortage: #F7E9E4/#A13406.
  - On Hold: #D7D9DD/#394357.
  - Cancelled: #FBDBDE/#B20B1C.
- **PO:** Pending grey #E3E6E8/#50575C, Started/Receiving blue, Completed green, Cancelled red.
- **Job/task:** Pending grey, Started blue, Completed green, Cancelled red. Priority High is `rgba(229,97,86,.24)`/#E55B56 with an up arrow.
- **Count:** Pending grey; Ready To Count / Count Started blue; Count Completed / Inventory Updated / Recount Created green; Cancelled red.
- **Return:** Pending grey, Started amber `rgba(235,172,0,.16)`/#EBAC00, In Transit blue, Completed green, Cancelled red.
- **Shipment plan:** Open teal #D0F3EE/#16C2AA; In Progress / Loading Started blue; Loading Completed / Shipped green; Cancelled red.
- **EOD:** Open teal, Closed green. **Label type:** Shipping blue, Return purple. **Export:** started blue, completed #28B5733D/#28B573, error red.
- **Receiving difference pill:** negative `#ED634A3D/#ED634A`, positive green.
- **Work order:** Open green, In Process blue, Completed green-solid, Shortage burnt orange, Cancelled red.
- **Wave status:** Pending grey; Started / In Progress / Optimizing blue; Completed green; Failed red.
- **Integration status:** Successful green, No Data / Error red, Partially Successful amber. Yes/No pills are green/grey; Test env is purple; Active green; Passive/Inactive grey.

### 0.6 Stub-handoff pattern
Some files must exist for foundation to compile, for example registries that import per-module
handlers. Foundation creates them as **stubs** that throw `NotImplementedError` or return empty
results. The UI shows them as "Not configured", never as fake data. Ownership then transfers to
the named module, which must replace the stub. The stubs are:

| Stub file (created by foundation) | Owner |
|---|---|
| `src/server/imports/handlers/{shipment-orders,shipment-orders-update,so-serials}.ts` | M01 |
| `src/server/imports/handlers/{purchase-orders,po-serials}.ts` | M05 |
| `src/server/imports/handlers/inventory.ts` | M06 |
| `src/server/imports/handlers/{count-location,count-sku}.ts` | M07 |
| `src/server/imports/handlers/work-orders.ts` | M08 |
| `src/server/imports/handlers/{products,products-update,pack-types,replenishment-levels,sku-allocation,kit-components,listings}.ts` | M09 |
| `src/server/imports/handlers/{locations,locations-update,product-capacity,product-capacity-update,lp-capacity,lp-capacity-update,lp-numbers}.ts` | M10 |
| `src/server/imports/handlers/{clients,vas-operations}.ts` | M11 |
| `src/server/imports/handlers/{users,user-roles,user-warehouses,user-clients}.ts` | M14 |
| `src/server/domain/task-handlers/count.ts` | M07 |
| `src/server/domain/task-handlers/replenishment.ts` | M03 |
| `src/server/domain/task-handlers/kitting.ts` | M08 |
| `src/server/scheduler/tasks/wave-rules.ts` | M03 |
| `src/server/scheduler/tasks/channel-methods.ts` | M12 |
| `src/server/scheduler/tasks/billing-periods.ts` | M11 |
| `src/server/scheduler/tasks/kit-inventory-recalc.ts` | M08 |
| `src/server/search/providers/{orders,pos,products,locations,lps,jobs,clients}.ts` | M01, M05, M09, M10, M10, M03, M11 |
| `src/server/workflows/actions/*.ts` (action executors) | M12 |
| `src/server/exports/providers/<gridKey>.ts` (per grid; generic fallback until replaced) | owner of that grid |
| `src/components/products/product-create-drawer.tsx`: Product Category chooser plus the create wizard drawer. The stub links to `/products/new`. Consumed by M01 and M05. | M09 |
| `src/components/vendors/vendor-drawer.tsx`: create/edit vendor drawer, used by the PO wizard Vendor step | M05 |
| `src/server/repositories/counts-commands.ts`, exporting `createCountPlanFromWave(tx, ctx, input)`. Consumed by M03 for Cycle Count waves. | M07 |
| `src/server/repositories/work-orders-commands.ts`, exporting `allocateWorkOrder(tx, ctx, woId)`. Consumed by `/api/ops/jobs` when `operation=work-order`. | M08 |

**Cross-module rules.**
- A module may **read** any table in its own repositories, but must apply `scopedWhere`.
- A module may **write** only these:
  1. The tables its domain owns (see the table-ownership matrix in Part C).
  2. Anything reached through the foundation domain functions.
  3. Anything reached through a stub-handoff command or component that another module owns.
- A consumer must keep working while a stub is still a stub. The stub's UI shows "Not configured yet", and the flow degrades gracefully.

Foundation implements the stubs that are cross-cutting: picking, packing, sorting and loading
task handlers; the snapshot scheduler task; and the export runner.

---

# PART A — FOUNDATION PACKAGE (serial; lands before any module starts)

Foundation is split into phases F0–F8, each committed separately and each leaving `npm run build`,
`npm run lint`, `npm run typecheck`, `npm test` and `npm run db:reset && npm run db:verify` green.
**Schema changes are additive**: existing column names stay, enums only widen, so the current
repositories keep compiling until their owning modules rewrite them.

## F0 — Tooling, dependencies, test harness

Owned files: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`,
`next.config.ts`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`,
`tests/setup/**`, `tests/e2e/fixtures/**`, `tests/unit/foundation/**`, `scripts/**`,
`.env.example`, `src/instrumentation.ts`.

- **Dependencies** (exact versions are pinned at install):
  - UI primitives: `radix-ui` (Dialog, Popover, DropdownMenu, Tooltip, Tabs, Select, Checkbox, RadioGroup, Switch, ScrollArea), plus `cmdk` for the combobox and command palette.
  - Forms and data: `react-hook-form`, `@hookform/resolvers` (zod 4), `@tanstack/react-query`, `react-day-picker`.
  - Interaction: `@dnd-kit/core`, `@dnd-kit/sortable`, `@tanstack/react-virtual`, and `@xyflow/react` for the algorithm rule canvas.
  - Documents: `exceljs` (xlsx export and import), `pdf-lib`, and `bwip-js` (Code128, QR and SSCC barcodes).
  - Utility: `nanoid`.
- **Dev dependencies:** `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@playwright/test`, `@axe-core/playwright`.
- **Scripts:**
  - `typecheck` (`tsc --noEmit`), `test` (vitest), `test:e2e` (playwright).
  - `db:generate` (drizzle-kit generate) and `db:migrate` (`src/server/db/migrate.ts`).
  - `db:reset`: delete `.data/kitstak.db*`, then migrate, then seed.
  - `db:verify` (`scripts/verify-ledger.ts`).
  - `audit:dead-clicks` (`tests/e2e/fixtures/dead-click-audit.spec.ts`).
- **Migrations:** replace `drizzle-kit push` with generated migrations in `drizzle/`, committed to the repo.
- **`next.config.ts`:**
  - Add HSTS in production: `max-age=63072000; includeSubDomains; preload`.
  - Add `redirects()` for every legacy query-tab URL to its new path. The legacy URLs are `/orders?tab=shipped`, `/orders?tab=returns`, `/receiving?tab=history|vendors`, `/inventory?tab=by-location|atp`, `/products?tab=listings`, `/jobs?tab=exceptions` and `/settings?tab=warehouses|carriers|audit`.
- **E2E fixtures:**
  - `tests/e2e/fixtures/auth.ts` provides logged-in contexts for admin, manager, operator and viewer.
  - `tests/e2e/fixtures/dead-click-audit.spec.ts` crawls every nav route and clicks every enabled `button`, `[role=menuitem]` and `a`. Each click must produce a navigation, a network request, an opened dialog/drawer/popover, or a DOM mutation. The test fails and lists every offender.
  - `tests/e2e/fixtures/a11y.ts` is an axe scan helper.
- **`src/instrumentation.ts`** starts the in-process scheduler (F6), in the `nodejs` runtime only.

## F1 — Database schema (exact Drizzle definitions)

Owned files:
- `src/server/db/schema.ts` (re-exports all tables)
- `src/server/db/columns.ts`
- `src/server/db/schema/*.ts`: identity, org, catalog, facility, inventory, outbound, shipping, inbound, returns, work, counts, kitting, automation, integrations, billing, platform
- `src/lib/enums.ts`, `src/lib/domain-types.ts`
- `drizzle/**`
- `src/server/db/migrate.ts`

### F1.1 Column helpers — `src/server/db/columns.ts`
```ts
import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";
import type { CustomFieldValues } from "@/lib/enums";

export const nowIso = () => new Date().toISOString();
export const pk = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
export const bool = (n: string) => integer(n, { mode: "boolean" });
export const json = <T>(n: string) => text(n, { mode: "json" }).$type<T>();
/** created/updated stamps + optimistic-concurrency version. Replaces any existing createdAt. */
export const stamps = () => ({
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
  createdBy: text("created_by"),
  updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  updatedBy: text("updated_by"),
  version: integer("version").notNull().default(1),
});
export const customFields = () => ({
  customFields: json<CustomFieldValues>("custom_fields").notNull().default(sql`'{}'`),
});
```

### F1.2 Shared enums — `src/lib/enums.ts` (safe to import from client and server)
```ts
export const SO_STATUSES = ["Open","Ready to Pick","Picking Started","Ready to Pack","Packing Started",
  "Ready to Sort","Sorting Started","Ready to Load","Loading Started","Ready to Ship","Shipped",
  "Partially Shipped","Delivered","Cancelled","Shortage","On Hold"] as const;
export const PRIORITIES = ["None","Low","Medium","High","Urgent"] as const;
export const SHORT_STATUSES = ["None","Open","Resolved"] as const;
export const ADDRESS_TYPES = ["Residential","Commercial","Military"] as const;
export const TAX_TYPES = ["OTHER","VAT","TIN","IOSS","CNPJ/CPF","EORI","GST"] as const;
export const BILLING_PARTY_TYPES = ["Sender","Recipient","Third Party","Collect","Prepaid"] as const;
export const EXPORT_REASONS = ["Sale","Gift","Personal Effects","Documents","Sample","Return","Repair","InterCompany","Other"] as const;
export const INVENTORY_STATUSES = ["Stock","Allocated","Picked","Sorted","Packed","Loaded"] as const;
export const TXN_TYPES = ["Allocation","Allocation Cancel","Attributes Change","Cancel Receiving","Count",
  "Disassemble Kit","Inventory Adjustment","Inventory Movement","Kitting","Loading","Packing","Picking",
  "Receiving","Replenishment","Return Receiving","Shipment","Sorting","Unloading"] as const;
export const RECEIVING_TYPES = ["Add Inventory","DisassembleKit","Kitting","Product Receive","Purchase Order","Return"] as const;
export const PO_STATUSES = ["Pending","Started","Receiving","Completed","Cancelled"] as const;
export const PO_TYPES = ["Purchase Order","Purchase Order- Non Crossdock","Transfer Order","Return Order","Open Order"] as const;
export const OPERATION_TYPES = ["Picking","Count","Replenishment","Work Order"] as const;
export const JOB_STATUSES = ["Pending","Started","In Progress","Completed","Cancelled"] as const; // "In Progress" = legacy alias of Started
export const TASK_TYPES = ["Picking","Packing","Sorting","Loading","Count","Replenishment","Kitting"] as const;
export const TASK_STATUSES = ["Pending","Started","Completed","Cancelled"] as const;
export const WAVE_OP_TYPES = ["Picking","AI Job","Cycle Count","Replenishment","Order Merge"] as const;
export const WAVE_STATUSES = ["Pending","Preparing For Optimization","Optimizing","Optimization Completed","Started","In Progress","Completed","Failed"] as const;
export const COUNT_PLAN_STATUSES = ["Pending","Ready To Count","Count Started","Count Completed","Inventory Updated","Cancelled"] as const;
export const COUNT_LINE_STATUSES = [...COUNT_PLAN_STATUSES, "Recount Created"] as const;
export const WORK_ORDER_STATUSES = ["Open","In Process","Completed","Shortage","Cancelled"] as const;
export const RETURN_STATUSES = ["Pending","Started","In Transit","Completed","Cancelled"] as const;
export const SHIPMENT_PLAN_STATUSES = ["Open","In Progress","Loading Started","Loading Completed","Shipped","Cancelled"] as const;
export const LOCATION_TYPES = ["Racks","Shelves","Bins","Virtual","BusinessStation","Ramps"] as const;
export const AREA_TYPES = ["Picking","Storage","Receiving","Returns","Packing","Shipment","Kitting","Loading"] as const;
export const DIMENSION_UNITS = ["Inch","Foot","Centimeter","Meter"] as const;
export const WEIGHT_UNITS = ["Pound","Ounce","Kilogram","Gram"] as const;
export const VOLUME_UNITS = ["Cubic Inch","Cubic Meter","Cubic Foot","Liter","Gallon","Cubic Centimeter"] as const;
export const CURRENCIES = ["AUD","CAD","EUR","INR","IDR","MYR","MXN","MAD","NZD","NGN","PKR","PHP","GBP","SGD","THB","TRY","USD","XOF"] as const;
export const SCAN_METHODS = ["During Picking","During Packing"] as const;
export const DATE_FORMATS = ["yyyyMMdd","ddMMyyyy","MMddyyyy","yyyy-MM-dd","yyyy-dd-MM","yyyy/MM/dd","yyyy/dd/MM","yyyy.MM.dd","yyyy.dd.MM"] as const;
export const LOOKUP_TYPES = ["po_type","so_type","order_merge_rule","work_order_type","damage_reason","pack_type",
  "product_type","product_group","location_group","location_zone","vas_type","mobile_cart_type",
  "packing_warning_type","custom_carrier","return_process","adjustment_reason","so_cancel_reason","return_reason"] as const;
export const CUSTOM_FIELD_SLOTS = ["textBox1","textBox2","textBox3","dropDown1","dropDown2","date1","date2","date3","toggle1","toggle2"] as const;
export type CustomFieldSlot = (typeof CUSTOM_FIELD_SLOTS)[number];
export type CustomFieldValues = Partial<Record<CustomFieldSlot, string | boolean | null>>;
export const CUSTOM_FIELD_ENTITIES = ["shipment_order","purchase_order","product","location","work_order",
  "lp_type","shipment_package","retailer","shipment_plan","client"] as const;
// Also: BILLING_* enums, CHANNEL_PROVIDERS, CARRIER_PROVIDERS, IMPORT_STATUSES, BG_TASK_STATUSES (mirroring the tables below)
```
`src/lib/domain-types.ts` holds the JSON column types:
- `FilterCondition { field; op; value; label }`, using the same op set as the grid grammar.
- `RuleCondition { field; comparator; value }`.
- `JobTypeSettings`.
- `ClientSettings`, covering the roughly 28 switches in 05 §7.
- `ChannelSettings`.
- `CarrierSettings`.
- `AddressValue`.

### F1.3 Changes to existing tables (additive only)
```ts
// users — add
firstName: text("first_name"), lastName: text("last_name"),
userType: text("user_type", { enum: ["Operation","Client","Owner"] }).notNull().default("Operation"),
isApiUser: bool("is_api_user").notNull().default(false),
allClients: bool("all_clients").notNull().default(true),
sessionVersion: integer("session_version").notNull().default(1),
failedLoginCount: integer("failed_login_count").notNull().default(0),
lockedUntil: text("locked_until"), lastLoginAt: text("last_login_at"), passwordChangedAt: text("password_changed_at"),
preferences: json<{ dateFormat: string; timeFormat: "12h"|"24h"; numberFormat: "1,025.00"|"1.025,00"; density: "Large"|"Small"; defaultWarehouseId?: string }>("preferences"),
...stamps(), // replaces created_at

// warehouses — add
prefix: text("prefix").notNull().default(""), addressLine2: text("address_line2"), postalCode: text("postal_code"),
country: text("country").notNull().default("United States"), contactName: text("contact_name"),
contactPhone: text("contact_phone"), email: text("email"),
type: text("type", { enum: ["Internal","External"] }).notNull().default("Internal"),
timezone: text("timezone").notNull().default("America/Chicago"),
dayShiftStart: text("day_shift_start").notNull().default("08:00"), dayShiftEnd: text("day_shift_end").notNull().default("17:00"),
defaultDimensionUnit: text("default_dimension_unit").notNull().default("Inch"),
defaultWeightUnit: text("default_weight_unit").notNull().default("Pound"),
useLpDimsForPutaway: bool("use_lp_dims_for_putaway").notNull().default(false),
defaultReceivingLocationId: text("default_receiving_location_id"),
defaultShipLocationId: text("default_ship_location_id"),
defaultReturnLocationId: text("default_return_location_id"),
mandatoryAdjustmentReason: bool("mandatory_adjustment_reason").notNull().default(true),
mandatoryCountReason: bool("mandatory_count_reason").notNull().default(false),
mobileAutoLogoutMinutes: integer("mobile_auto_logout_minutes").default(30),
isActive: bool("is_active").notNull().default(true),
...stamps(),

// clients — add
officialName: text("official_name"), taxId: text("tax_id"), currency: text("currency").notNull().default("USD"),
settings: json<ClientSettings>("settings").notNull().default(sql`'{}'`),
...customFields(), ...stamps(),

// products — add (existing `price` == Sales Price, `uom` == primary pack type, `isHazmat` == hazmat switch)
productCategory: text("product_category", { enum: ["Product","Kit","Packaging Material"] }).notNull().default("Product"),
kitType: text("kit_type", { enum: ["Kit to Order","Kit to Stock"] }),
description: text("description"), imageUrl: text("image_url"),
productTypeId: text("product_type_id"), productGroupId: text("product_group_id"), // lookup_values (client-scoped)
currency: text("currency").notNull().default("USD"), purchasePrice: real("purchase_price").notNull().default(0),
taxRate: real("tax_rate").notNull().default(0), minSafetyStock: integer("min_safety_stock").notNull().default(0),
fnsku: text("fnsku"), isDigital: bool("is_digital").notNull().default(false),
isFoldable: bool("is_foldable").notNull().default(false), isOversized: bool("is_oversized").notNull().default(false),
isInsert: bool("is_insert").notNull().default(false), isStackable: bool("is_stackable").notNull().default(false),
isPoster: bool("is_poster").notNull().default(false), isLiquid: bool("is_liquid").notNull().default(false),
isNonReturnable: bool("is_non_returnable").notNull().default(false),
packingInstructions: text("packing_instructions"), returnInstructions: text("return_instructions"),
useShipPackageId: text("use_ship_package_id"),
customs: json<{ declaredValue?: number; hsCode?: string; originCountry?: string; notDeclared?: boolean; manufacturer?: string; manufacturerProductId?: string; description?: string }>("customs"),
hazmat: json<{ hazmatId?: string; type?: "FR"|"EQ"|"LR"|"LQ"|"BATTERY"|"ORMD"; attribute?: string; quantity?: number; quantityType?: "Gross"|"Net"; quantityUnit?: string; containerType?: string; properShippingName?: string; classDivision?: string }>("hazmat"),
trackExpiry: bool("track_expiry").notNull().default(false), expiryReceivingOnly: bool("expiry_receiving_only").notNull().default(false),
expiryFormat: text("expiry_format"), expiryScanMethod: text("expiry_scan_method"), shelfLifeDays: integer("shelf_life_days"),
trackLot: bool("track_lot").notNull().default(false), lotReceivingOnly: bool("lot_receiving_only").notNull().default(false),
autoCreateLot: bool("auto_create_lot").notNull().default(false), lotRegex: text("lot_regex"), lotScanMethod: text("lot_scan_method"),
trackProductionDate: bool("track_production_date").notNull().default(false),
productionReceivingOnly: bool("production_receiving_only").notNull().default(false),
productionFormat: text("production_format"), productionScanMethod: text("production_scan_method"),
replenishmentStrategy: text("replenishment_strategy", { enum: ["Global","Per Warehouse"] }).notNull().default("Global"),
replenishmentMin: integer("replenishment_min").notNull().default(0), replenishmentMax: integer("replenishment_max").notNull().default(0),
trackSerial: bool("track_serial").notNull().default(false), trackSecondarySerial: bool("track_secondary_serial").notNull().default(false),
serialMethod: text("serial_method", { enum: ["Both Receiving and Packing","Only Packing"] }),
skipSerialScan: bool("skip_serial_scan").notNull().default(false), serialRegex: text("serial_regex"),
...customFields(), ...stamps(),

// locations — add (existing `type` kept as legacy role; the new fields are authoritative)
barcode: text("barcode"), displayMember: text("display_member"),
locationGroupId: text("location_group_id"), locationZoneId: text("location_zone_id"), // lookup_values (warehouse-scoped)
locationType: text("location_type", { enum: LOCATION_TYPES }),
areaType: text("area_type", { enum: AREA_TYPES }),
replenishmentType: text("replenishment_type", { enum: ["Source","Target"] }),
walkingPathPriority: integer("walking_path_priority").notNull().default(0),
capacityType: text("capacity_type", { enum: ["None","Maximum Unit Quantity","Maximum Pack Quantity"] }).notNull().default("None"),
maxCapacityQty: integer("max_capacity_qty").notNull().default(0), maxSkuQty: integer("max_sku_qty"),
mezzanine: text("mezzanine"), rack: text("rack"), column: integer("column").notNull().default(0), position: text("position"),
dimensionUnit: text("dimension_unit").notNull().default("Inch"),
height: real("height").notNull().default(0), width: real("width").notNull().default(0), length: real("length").notNull().default(0),
volumeUnit: text("volume_unit").notNull().default("Cubic Inch"), volume: real("volume").notNull().default(0),
abcCode: text("abc_code", { enum: ["None","A","B","C"] }).notNull().default("None"),
singleClient: bool("single_client").notNull().default(false), isLocked: bool("is_locked").notNull().default(false),
dedicatedClientId: text("dedicated_client_id").references(() => clients.id),
printApplyOnPacking: bool("print_apply_on_packing").notNull().default(false), colorCode: text("color_code"),
preventAllocation: bool("prevent_allocation").notNull().default(false),
preventInventorySync: bool("prevent_inventory_sync").notNull().default(false),
onlyOneLot: bool("only_one_lot").notNull().default(false), onlyDamaged: bool("only_damaged").notNull().default(false),
onlyOneExpiry: bool("only_one_expiry").notNull().default(false), onlyOneSku: bool("only_one_sku").notNull().default(false),
onlyOneLp: bool("only_one_lp").notNull().default(false), onlyOneProductionDate: bool("only_one_production_date").notNull().default(false),
autoRemoveLpAfterReplenishment: bool("auto_remove_lp_after_replenishment").notNull().default(false),
autoRemoveLpAfterTransfer: bool("auto_remove_lp_after_transfer").notNull().default(false),
...customFields(), ...stamps(),

// inventory — add (one row == one bucket)
bucketKey: text("bucket_key").notNull(), // sha1(warehouse|product|location|lp|lot|expiry|prod|damage|packType|status)
clientId: text("client_id").notNull().references(() => clients.id),
lpId: text("lp_id").references(() => licensePlates.id),
status: text("status", { enum: INVENTORY_STATUSES }).notNull().default("Stock"),
packType: text("pack_type").notNull().default("Each"),
expiryDate: text("expiry_date"), productionDate: text("production_date"),
damageReason: text("damage_reason"), // non-null => qty counted in `damaged`
poNumber: text("po_number"), mobileCartId: text("mobile_cart_id"),
updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
version: integer("version").notNull().default(1),
// indexes: uniqueIndex("inventory_bucket_idx").on(t.bucketKey); index(warehouseId, clientId, productId); index(status)

// shipment_orders — add (status widened to SO_STATUSES; priority widened to PRIORITIES; orderType stays D2C|B2B)
orderTypeId: text("order_type_id"), // lookup so_type: "D2C Order","B2B Order","BackOrder D2C","Partial Allocation D2C"
priorityRank: integer("priority_rank").notNull().default(0),
customerId: text("customer_id").references(() => customers.id),
customerFirstName: text("customer_first_name"), customerLastName: text("customer_last_name"),
customerPhone: text("customer_phone"), companyName: text("company_name"),
shipAddress2: text("ship_address2"), addressType: text("address_type", { enum: ADDRESS_TYPES }),
skipAddressVerification: bool("skip_address_verification").notNull().default(false),
addressVerificationStatus: text("address_verification_status", { enum: ["Unverified","Verified","Partially Verified","Failed","Skipped"] }).notNull().default("Unverified"),
addressVerificationNotes: json<string[]>("address_verification_notes"),
taxType: text("tax_type", { enum: TAX_TYPES }), taxId: text("tax_id"),
useShipAsBilling: bool("use_ship_as_billing").notNull().default(true),
billingAddress: json<AddressValue>("billing_address"),
expectedDeliveryDate: text("expected_delivery_date"), carrierExpectedDeliveryDate: text("carrier_expected_delivery_date"),
scheduledPickupDate: text("scheduled_pickup_date"), scheduledShipmentDate: text("scheduled_shipment_date"),
actualPickupDate: text("actual_pickup_date"), cancelledAt: text("cancelled_at"), cancelReasonId: text("cancel_reason_id"),
carrierConnectionId: text("carrier_connection_id"), carrierServiceId: text("carrier_service_id"),
rateShoppingPresetId: text("rate_shopping_preset_id"),
shippingChargesBillingType: text("shipping_charges_billing_type", { enum: BILLING_PARTY_TYPES }),
taxDutiesBillingType: text("tax_duties_billing_type", { enum: BILLING_PARTY_TYPES }),
shippingAccountNumber: text("shipping_account_number"), taxDutiesAccountNumber: text("tax_duties_account_number"),
packingInstructions: text("packing_instructions"), shipmentPackageId: text("shipment_package_id"),
totalShippingCost: real("total_shipping_cost").notNull().default(0), rate: real("rate").notNull().default(0),
discount: real("discount").notNull().default(0), reasonForExport: text("reason_for_export", { enum: EXPORT_REASONS }),
returnAddressId: text("return_address_id"), returnCarrierServiceId: text("return_carrier_service_id"),
returnShippingCost: real("return_shipping_cost"), returnTrackingNumbers: json<string[]>("return_tracking_numbers"),
trackingNumbers: json<string[]>("tracking_numbers"),
extraNote1: text("extra_note1"), extraNote2: text("extra_note2"), extraNote3: text("extra_note3"),
extraNote4: text("extra_note4"), extraNote5: text("extra_note5"),
clientReferenceCode: text("client_reference_code"), fraud: text("fraud"), packingWarningTypeId: text("packing_warning_type_id"),
isGift: bool("is_gift").notNull().default(false), giftNote: text("gift_note"),
orderCodeGroupingRef: text("order_code_grouping_ref"),
retailerId: text("retailer_id"), bol: text("bol"), pro: text("pro"), retailerPo: text("retailer_po"),
dept: text("dept"), markFor: text("mark_for"), retailerCustomerAccount: text("retailer_customer_account"),
isUccLabelGenerated: bool("is_ucc_label_generated").notNull().default(false),
isBackOrder: bool("is_back_order").notNull().default(false), masterOrderId: text("master_order_id"),
mergedIntoOrderId: text("merged_into_order_id"), isMerged: bool("is_merged").notNull().default(false),
pickShortStatus: text("pick_short_status", { enum: SHORT_STATUSES }).notNull().default("None"),
packShortStatus: text("pack_short_status", { enum: SHORT_STATUSES }).notNull().default("None"),
pickListPrinted: bool("pick_list_printed").notNull().default(false),
isAutoShip: bool("is_auto_ship").notNull().default(false), isPrime: bool("is_prime").notNull().default(false),
channelConnectionId: text("channel_connection_id"), channelPaymentStatus: text("channel_payment_status"),
requestedShippingOption: text("requested_shipping_option"),
workflowBlocked: text("workflow_blocked", { enum: ["None","Fully","Partially"] }).notNull().default("None"),
deletedAt: text("deleted_at"),
...customFields(), ...stamps(),

// order_lines — add
packType: text("pack_type").notNull().default("Each"), uomRatio: integer("uom_ratio").notNull().default(1),
allocatedQuantity: integer("allocated_quantity").notNull().default(0),
cancelledQuantity: integer("cancelled_quantity").notNull().default(0),
sortedQuantity: integer("sorted_quantity").notNull().default(0),
shippedQuantity: integer("shipped_quantity").notNull().default(0),
loadedQuantity: integer("loaded_quantity").notNull().default(0),
lotNumber: text("lot_number"), expiryDate: text("expiry_date"), productionDate: text("production_date"),
damageReason: text("damage_reason"), pinnedLocationId: text("pinned_location_id"), pinnedLpId: text("pinned_lp_id"),
lineNote1: text("line_note1"), lineNote2: text("line_note2"), lineNote3: text("line_note3"),
kitProductId: text("kit_product_id"), originalOrderCode: text("original_order_code"),
storeUpdateNotes: text("store_update_notes"), isStoreUpdated: bool("is_store_updated").notNull().default(false),
...stamps(),

// purchase_orders — add (receivedAt == Actual Receiving Date; poType widened to PO_TYPES; vendorName kept as display)
vendorId: text("vendor_id").references(() => vendors.id),
poDate: text("po_date"), plannedReceivingDate: text("planned_receiving_date"),
plannedArrivalDate: text("planned_arrival_date"), actualArrivalDate: text("actual_arrival_date"),
note: text("note"), completedAt: text("completed_at"), cancelledAt: text("cancelled_at"),
...customFields(), ...stamps(),

// purchase_order_lines — add
packType: text("pack_type").notNull().default("Each"), uomQuantity: integer("uom_quantity").notNull().default(1),
receivingLocationId: text("receiving_location_id"), lotNumber: text("lot_number"),
expiryDate: text("expiry_date"), productionDate: text("production_date"),
lpTypeId: text("lp_type_id"), lpNumber: text("lp_number"), damagedQuantity: integer("damaged_quantity").notNull().default(0),
note: text("note"), ...stamps(),

// jobs — add (jobType becomes plain text = job type code snapshot; status widened to JOB_STATUSES; priority to PRIORITIES)
jobTypeId: text("job_type_id").references(() => jobTypes.id),
operationType: text("operation_type", { enum: OPERATION_TYPES }).notNull().default("Picking"),
waveId: text("wave_id"), waveRuleId: text("wave_rule_id"), countPlanId: text("count_plan_id"), workOrderId: text("work_order_id"),
plannedStartAt: text("planned_start_at"), plannedEndAt: text("planned_end_at"), startedAt: text("started_at"),
labelStatus: text("label_status", { enum: ["No Label","Partially Labeled","Labeled"] }).notNull().default("No Label"),
pickListStatus: text("pick_list_status", { enum: ["Not Printed","Printed"] }).notNull().default("Not Printed"),
mobileCartId: text("mobile_cart_id"), pickingZone: text("picking_zone"),
isResolutionJob: bool("is_resolution_job").notNull().default(false),
isPrecartonization: bool("is_precartonization").notNull().default(false),
taskCount: integer("task_count").notNull().default(0), completedTaskCount: integer("completed_task_count").notNull().default(0),
...stamps(),

// audit_log (security events) — add
ip: text("ip"), userAgent: text("user_agent"),
outcome: text("outcome", { enum: ["success","failure"] }).notNull().default("success"),
```

### F1.4 New tables
```ts
/* ---------- identity & access — schema/identity.ts ---------- */
export const roles = sqliteTable("roles", {
  id: pk(), key: text("key").notNull(), name: text("name").notNull(), description: text("description"),
  category: text("category", { enum: ["Operation","Client"] }).notNull().default("Operation"),
  isSystem: bool("is_system").notNull().default(false),
  restrictions: json<("carrier_cost"|"carrier_account_data"|"rate_shopping_data")[]>("restrictions").notNull().default(sql`'[]'`),
  ...stamps(),
}, (t) => [uniqueIndex("roles_key_idx").on(t.key)]);
export const rolePermissions = sqliteTable("role_permissions", {
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(), // key from PERMISSIONS catalog
}, (t) => [primaryKey({ columns: [t.roleId, t.permission] })]);
export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);
export const userWarehouses = sqliteTable("user_warehouses", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.userId, t.warehouseId] })]);
export const userClients = sqliteTable("user_clients", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.userId, t.clientId] })]);
export const userSessions = sqliteTable("user_sessions", {
  id: pk(), // == JWT jti
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionVersion: integer("session_version").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(nowIso), lastSeenAt: text("last_seen_at"),
  expiresAt: text("expires_at").notNull(), revokedAt: text("revoked_at"), ip: text("ip"), userAgent: text("user_agent"),
}, (t) => [index("user_sessions_user_idx").on(t.userId)]);
export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: pk(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(), expiresAt: text("expires_at").notNull(), usedAt: text("used_at"),
});
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull(), windowStart: text("window_start").notNull(),
});
export const userPrinters = sqliteTable("user_printers", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  barcodePrinter: text("barcode_printer"), laserPrinter: text("laser_printer"),
}, (t) => [primaryKey({ columns: [t.userId, t.warehouseId] })]);
export const userGridPrefs = sqliteTable("user_grid_prefs", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gridKey: text("grid_key").notNull(),
  prefs: json<{ visible: string[]; order: string[]; widths: Record<string, number>; density: "Large"|"Small"; pageSize: number }>("prefs").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.gridKey] })]);
export const savedViews = sqliteTable("saved_views", {
  id: pk(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gridKey: text("grid_key").notNull(), name: text("name").notNull(), query: text("query").notNull(), // grid-query string
  isShared: bool("is_shared").notNull().default(false), isDefault: bool("is_default").notNull().default(false),
  pinnedFields: json<string[]>("pinned_fields"), ...stamps(),
}, (t) => [index("saved_views_grid_idx").on(t.gridKey, t.userId)]);
export const companySettings = sqliteTable("company_settings", {
  id: text("id").primaryKey().default("company"), displayName: text("display_name").notNull(),
  fullName: text("full_name").notNull(), logoFileId: text("logo_file_id"),
  defaults: json<{ currency: string; dateFormat: string; weightUnit: string; dimensionUnit: string }>("defaults"),
  passwordPolicy: json<{ minLength: number; requireUpper: boolean; requireNumber: boolean; requireSymbol: boolean; maxAgeDays?: number; lockoutThreshold: number; lockoutMinutes: number }>("password_policy"),
  ...stamps(),
});
export const apps = sqliteTable("apps", {
  key: text("key").primaryKey(), name: text("name").notNull(), description: text("description").notNull(),
  category: text("category").notNull(), isActive: bool("is_active").notNull().default(false),
  settings: json<Record<string, unknown>>("settings"), activatedAt: text("activated_at"), activatedBy: text("activated_by"),
});
export const notifications = sqliteTable("notifications", {
  id: pk(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "wave.completed" | "import.failed" | "shortage.created" | ...
  title: text("title").notNull(), body: text("body"), href: text("href"),
  severity: text("severity", { enum: ["info","success","warning","error"] }).notNull().default("info"),
  readAt: text("read_at"), createdAt: text("created_at").notNull().$defaultFn(nowIso),
}, (t) => [index("notifications_user_idx").on(t.userId, t.readAt)]);

/* ---------- organization — schema/org.ts ---------- */
export const addresses = sqliteTable("addresses", {
  id: pk(), ownerType: text("owner_type", { enum: ["client","customer","vendor","retailer","warehouse"] }).notNull(),
  ownerId: text("owner_id").notNull(), name: text("name"),
  usageType: text("usage_type", { enum: ["Shipping","Billing","Return"] }).notNull().default("Shipping"),
  firstName: text("first_name"), lastName: text("last_name"), companyName: text("company_name"),
  line1: text("line1").notNull(), line2: text("line2"), city: text("city").notNull(), state: text("state"),
  postalCode: text("postal_code").notNull(), country: text("country").notNull(), phone: text("phone"), email: text("email"),
  addressType: text("address_type", { enum: ADDRESS_TYPES }),
  isDefault: bool("is_default").notNull().default(false), isActive: bool("is_active").notNull().default(true), ...stamps(),
}, (t) => [index("addresses_owner_idx").on(t.ownerType, t.ownerId)]);
export const customers = sqliteTable("customers", {
  id: pk(), clientId: text("client_id").notNull().references(() => clients.id),
  firstName: text("first_name").notNull(), lastName: text("last_name").notNull(),
  email: text("email").notNull(), phone: text("phone").notNull(), isActive: bool("is_active").notNull().default(true), ...stamps(),
}, (t) => [index("customers_client_idx").on(t.clientId)]);
export const vendors = sqliteTable("vendors", {
  id: pk(), clientId: text("client_id").notNull().references(() => clients.id),
  displayName: text("display_name").notNull(), vendorName: text("vendor_name").notNull(),
  useShipAsBilling: bool("use_ship_as_billing").notNull().default(true), isActive: bool("is_active").notNull().default(true), ...stamps(),
}, (t) => [uniqueIndex("vendors_client_name_idx").on(t.clientId, t.displayName)]);
export const retailers = sqliteTable("retailers", {
  id: pk(), name: text("name").notNull(), description: text("description"), businessName: text("business_name"),
  logoFileId: text("logo_file_id"), isActive: bool("is_active").notNull().default(true),
  createCaseLabels: bool("create_case_labels").notNull().default(false),
  caseLabelPrintQty: integer("case_label_print_qty").notNull().default(1), lpLabelPrintQty: integer("lp_label_print_qty").notNull().default(1),
  ...customFields(), ...stamps(),
}, (t) => [uniqueIndex("retailers_name_idx").on(t.name)]);

/* ---------- platform — schema/platform.ts ---------- */
export const lookupValues = sqliteTable("lookup_values", {
  id: pk(), type: text("type", { enum: LOOKUP_TYPES }).notNull(), name: text("name").notNull(), code: text("code"),
  clientId: text("client_id").references(() => clients.id), warehouseId: text("warehouse_id").references(() => warehouses.id),
  isActive: bool("is_active").notNull().default(true), sortOrder: integer("sort_order").notNull().default(0),
  meta: json<Record<string, unknown>>("meta"), // vas_type {calculationType}; mobile_cart_type {levels,columns}; merge rule {criteria}
  ...stamps(),
}, (t) => [index("lookup_type_idx").on(t.type), uniqueIndex("lookup_unique_idx").on(t.type, t.name, t.clientId, t.warehouseId)]);
export const codeSequences = sqliteTable("code_sequences", {
  key: text("key").notNull(), warehouseId: text("warehouse_id").notNull().default("*"),
  prefix: text("prefix").notNull(), nextValue: integer("next_value").notNull().default(1), padding: integer("padding").notNull().default(6),
  autoGenerate: bool("auto_generate").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.key, t.warehouseId] })]);
export const changeLog = sqliteTable("change_log", {
  id: pk(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), entityCode: text("entity_code"),
  parentEntityType: text("parent_entity_type"), parentEntityId: text("parent_entity_id"), // line-level entries
  type: text("type", { enum: ["Create","Update","Delete"] }).notNull(),
  field: text("field"), fieldLabel: text("field_label"), fromValue: text("from_value"), toValue: text("to_value"),
  message: text("message").notNull(), userId: text("user_id"), source: text("source").notNull(), // email | "Integration" | "Scheduler"
  at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [index("change_log_entity_idx").on(t.entityType, t.entityId), index("change_log_at_idx").on(t.at),
          index("change_log_parent_idx").on(t.parentEntityType, t.parentEntityId)]);
export const tags = sqliteTable("tags", {
  id: pk(), name: text("name").notNull(), color: text("color").notNull(),
  scope: text("scope", { enum: ["shipment_order","purchase_order","return_order","work_order","listing","any"] }).notNull().default("any"),
  ...stamps(),
}, (t) => [uniqueIndex("tags_name_scope_idx").on(t.name, t.scope)]);
export const entityTags = sqliteTable("entity_tags", {
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
}, (t) => [primaryKey({ columns: [t.tagId, t.entityType, t.entityId] }), index("entity_tags_entity_idx").on(t.entityType, t.entityId)]);
export const customFieldDefs = sqliteTable("custom_field_defs", {
  id: pk(), entityType: text("entity_type", { enum: CUSTOM_FIELD_ENTITIES }).notNull(),
  slot: text("slot", { enum: CUSTOM_FIELD_SLOTS }).notNull(), name: text("name").notNull(),
  options: json<string[]>("options"), isActive: bool("is_active").notNull().default(true), ...stamps(),
}, (t) => [uniqueIndex("cfd_slot_idx").on(t.entityType, t.slot)]);
export const files = sqliteTable("files", {
  id: pk(), name: text("name").notNull(), mime: text("mime").notNull(), size: integer("size").notNull(),
  sha256: text("sha256").notNull(), storagePath: text("storage_path").notNull(), // .data/files/<id>
  ownerEntityType: text("owner_entity_type"), ownerEntityId: text("owner_entity_id"),
  uploadedBy: text("uploaded_by"), createdAt: text("created_at").notNull().$defaultFn(nowIso), expiresAt: text("expires_at"),
});
export const attachments = sqliteTable("attachments", {
  id: pk(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  documentType: text("document_type", { enum: ["GiftNote","PackingInstruction","PackingDocument","Bill of Lading","External","Invoice","Shipment Label","Kitting Document","Other"] }).notNull(),
  fileId: text("file_id").notNull().references(() => files.id), uploadedBy: text("uploaded_by"),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
}, (t) => [index("attachments_entity_idx").on(t.entityType, t.entityId)]);
export const entityNotes = sqliteTable("entity_notes", {
  id: pk(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), body: text("body").notNull(),
  userId: text("user_id").references(() => users.id), createdAt: text("created_at").notNull().$defaultFn(nowIso),
}, (t) => [index("entity_notes_entity_idx").on(t.entityType, t.entityId)]);
export const backgroundTasks = sqliteTable("background_tasks", {
  id: pk(), kind: text("kind", { enum: ["export","import","bulk","wave","report","print"] }).notNull(),
  title: text("title").notNull(), gridKey: text("grid_key"), query: text("query"),
  status: text("status", { enum: ["queued","started","completed","error"] }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0), rowCount: integer("row_count"), errorMessage: text("error_message"),
  fileId: text("file_id").references(() => files.id), userId: text("user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().$defaultFn(nowIso), finishedAt: text("finished_at"),
}, (t) => [index("bg_tasks_user_idx").on(t.userId, t.createdAt)]);
export const importBatches = sqliteTable("import_batches", {
  id: pk(), importKey: text("import_key").notNull(),
  status: text("status", { enum: ["Processing","Successful","Partially Successful","Failed"] }).notNull(),
  masterRowCount: integer("master_row_count").notNull().default(0), successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0), fileId: text("file_id").notNull().references(() => files.id),
  errorFileId: text("error_file_id"), uploadedBy: text("uploaded_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().$defaultFn(nowIso), finishedAt: text("finished_at"),
}, (t) => [index("import_batches_key_idx").on(t.importKey, t.createdAt)]);
export const importRows = sqliteTable("import_rows", {
  id: pk(), batchId: text("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(), success: bool("success").notNull(),
  data: text("data").notNull(), message: text("message"), entityId: text("entity_id"),
}, (t) => [index("import_rows_batch_idx").on(t.batchId)]);
export const printoutTemplates = sqliteTable("printout_templates", {
  id: pk(), typeKey: text("type_key").notNull(), // see F6 print type catalog (25 types)
  name: text("name").notNull(), description: text("description").notNull(),
  recordsPerPage: text("records_per_page", { enum: ["Single Record","Multiple Records"] }).notNull(),
  printMode: text("print_mode", { enum: ["Direct Print","PDF Preview","Report Preview"] }).notNull(),
  printerType: text("printer_type", { enum: ["Label Printer","Laser Printer"] }).notNull(),
  baseTemplate: text("base_template").notNull(), // renderer key in src/server/print/templates
  layout: json<Record<string, unknown>>("layout"), options: json<Record<string, unknown>>("options"),
  allClients: bool("all_clients").notNull().default(true), isActive: bool("is_active").notNull().default(true),
  isDefault: bool("is_default").notNull().default(false), ...stamps(),
}, (t) => [index("printout_type_idx").on(t.typeKey)]);
export const printoutTemplateClients = sqliteTable("printout_template_clients", {
  templateId: text("template_id").notNull().references(() => printoutTemplates.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => clients.id), hasAccess: bool("has_access").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.templateId, t.clientId] })]);
export const screenConfigs = sqliteTable("screen_configs", {
  id: pk(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id), name: text("name").notNull(),
  operationType: text("operation_type", { enum: ["Receiving"] }).notNull().default("Receiving"), screenName: text("screen_name").notNull(),
  isActive: bool("is_active").notNull().default(true),
  conditions: json<{ when: "Operation Starting"; join: "And"|"Or"; clientIds?: string[]; poTypes?: string[]; vendorIds?: string[] }>("conditions"),
  config: json<{ steps: { key: string; enabled: boolean; required: boolean }[] }>("config"), ...stamps(),
});

/* ---------- catalog — schema/catalog.ts ---------- */
export const productPackTypes = sqliteTable("product_pack_types", {
  id: pk(), productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  packType: text("pack_type").notNull(), // lookup pack_type name
  kind: text("kind", { enum: ["Primary","Hierarchical","Irregular"] }).notNull(),
  parentPackTypeId: text("parent_pack_type_id"), childQty: integer("child_qty"), uomQty: integer("uom_qty").notNull().default(1),
  dimensionUnit: text("dimension_unit").notNull().default("Inch"),
  length: real("length").notNull().default(0), width: real("width").notNull().default(0), height: real("height").notNull().default(0),
  volumeUnit: text("volume_unit").notNull().default("Cubic Inch"), volume: real("volume").notNull().default(0),
  weightUnit: text("weight_unit").notNull().default("Pound"), weight: real("weight").notNull().default(0),
  useShipPackageId: text("use_ship_package_id"), useOwnBox: bool("use_own_box").notNull().default(false),
  usePrimaryBarcodes: bool("use_primary_barcodes").notNull().default(false), ...stamps(),
}, (t) => [uniqueIndex("ppt_product_pack_idx").on(t.productId, t.packType)]);
export const productBarcodes = sqliteTable("product_barcodes", {
  id: pk(), productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  packTypeId: text("pack_type_id").notNull().references(() => productPackTypes.id, { onDelete: "cascade" }),
  barcode: text("barcode").notNull(),
}, (t) => [index("product_barcodes_code_idx").on(t.barcode)]);
export const kitComponents = sqliteTable("kit_components", {
  id: pk(), kitProductId: text("kit_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  componentProductId: text("component_product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(), packType: text("pack_type").notNull().default("Each"),
}, (t) => [uniqueIndex("kit_component_idx").on(t.kitProductId, t.componentProductId)]);
export const productReplenishmentLevels = sqliteTable("product_replenishment_levels", {
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  minLevel: integer("min_level").notNull(), maxLevel: integer("max_level").notNull(),
}, (t) => [primaryKey({ columns: [t.productId, t.warehouseId] })]);
export const productChannelAllocations = sqliteTable("product_channel_allocations", {
  id: pk(), productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  channelConnectionId: text("channel_connection_id").notNull().references(() => channelConnections.id),
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  staticQty: integer("static_qty"), reserveQty: integer("reserve_qty"), allocationPct: real("allocation_pct"),
  syncedQty: integer("synced_qty").notNull().default(0),
});
export const productListings = sqliteTable("product_listings", {
  id: pk(), channelConnectionId: text("channel_connection_id").notNull().references(() => channelConnections.id),
  clientId: text("client_id").notNull().references(() => clients.id), productId: text("product_id").references(() => products.id),
  sellerSku: text("seller_sku").notNull(), channelProductId: text("channel_product_id").notNull(),
  name: text("name").notNull(), description: text("description"), storePrice: real("store_price"), imageUrl: text("image_url"),
  neverSync: bool("never_sync").notNull().default(false), linkedAt: text("linked_at"), lastSyncedQty: integer("last_synced_qty"),
  ...stamps(),
}, (t) => [uniqueIndex("listing_unique_idx").on(t.channelConnectionId, t.channelProductId), index("listing_product_idx").on(t.productId)]);
export const serialNumbers = sqliteTable("serial_numbers", {
  id: pk(), productId: text("product_id").notNull().references(() => products.id),
  warehouseId: text("warehouse_id").notNull(), clientId: text("client_id").notNull(),
  primarySerial: text("primary_serial").notNull(), secondarySerial: text("secondary_serial"),
  status: text("status", { enum: ["Received","Picked","Shipped","Receipt Cancelled","Shipment Order Cancelled","Updated"] }).notNull(),
  inventoryId: text("inventory_id"), receiptId: text("receipt_id"), orderLineId: text("order_line_id"), shipmentId: text("shipment_id"),
  entryAt: text("entry_at").notNull().$defaultFn(nowIso), ...stamps(),
}, (t) => [uniqueIndex("serial_unique_idx").on(t.productId, t.primarySerial)]);
export const serialTransactions = sqliteTable("serial_transactions", {
  id: pk(), serialId: text("serial_id").notNull().references(() => serialNumbers.id),
  inventoryTransactionId: text("inventory_transaction_id").notNull(), type: text("type", { enum: TXN_TYPES }).notNull(),
  status: text("status").notNull(), at: text("at").notNull().$defaultFn(nowIso),
});

/* ---------- facility — schema/facility.ts ---------- */
export const locationProductCapacity = sqliteTable("location_product_capacity", {
  id: pk(), locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => clients.id), productId: text("product_id").notNull().references(() => products.id),
  packType: text("pack_type").notNull(), minQty: integer("min_qty").notNull().default(0), maxQty: integer("max_qty").notNull().default(0),
}, (t) => [uniqueIndex("lpc_idx").on(t.locationId, t.productId, t.packType)]);
export const locationLpCapacity = sqliteTable("location_lp_capacity", {
  id: pk(), locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  lpTypeId: text("lp_type_id").notNull().references(() => lpTypes.id), minQty: integer("min_qty").notNull().default(0),
  maxQty: integer("max_qty").notNull().default(0), clientId: text("client_id"), productId: text("product_id"),
});
export const lpTypes = sqliteTable("lp_types", {
  id: pk(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id), code: text("code").notNull(),
  description: text("description"), numberPrefix: text("number_prefix").notNull(), numberLength: integer("number_length").notNull(),
  length: real("length").notNull().default(0), width: real("width").notNull().default(0), height: real("height").notNull().default(0),
  dimensionUnit: text("dimension_unit").notNull().default("Inch"), weightUnit: text("weight_unit").notNull().default("Ounce"),
  volumeUnit: text("volume_unit").notNull().default("Cubic Inch"), emptyWeight: real("empty_weight").notNull().default(0),
  maxWeight: real("max_weight").notNull().default(0), maxVolume: real("max_volume").notNull().default(0),
  onlyOneExpiry: bool("only_one_expiry").notNull().default(false), onlyOneProductionDate: bool("only_one_production_date").notNull().default(false),
  onlyOneLot: bool("only_one_lot").notNull().default(false), onlyOneSku: bool("only_one_sku").notNull().default(false),
  onlyOneClient: bool("only_one_client").notNull().default(false), onlyOneOrder: bool("only_one_order").notNull().default(false),
  onlyOneJob: bool("only_one_job").notNull().default(false), suitableForParentLp: bool("suitable_for_parent_lp").notNull().default(false),
  useForAiJob: bool("use_for_ai_job").notNull().default(false), nextSequence: integer("next_sequence").notNull().default(1),
  ...customFields(), ...stamps(),
}, (t) => [uniqueIndex("lp_types_code_idx").on(t.warehouseId, t.code)]);
export const licensePlates = sqliteTable("license_plates", {
  id: pk(), number: text("number").notNull(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  lpTypeId: text("lp_type_id").notNull().references(() => lpTypes.id), locationId: text("location_id").references(() => locations.id),
  parentLpId: text("parent_lp_id"), originalNumber: text("original_number"), alternateBarcode: text("alternate_barcode"),
  isSscc18: bool("is_sscc18").notNull().default(false), clientId: text("client_id").references(() => clients.id),
  length: real("length").notNull().default(0), width: real("width").notNull().default(0), height: real("height").notNull().default(0),
  weight: real("weight").notNull().default(0), actualVolume: real("actual_volume").notNull().default(0),
  status: text("status", { enum: ["Empty","Occupied","Shipped","Removed"] }).notNull().default("Empty"),
  labelPrintedAt: text("label_printed_at"), ...stamps(),
}, (t) => [uniqueIndex("lp_number_idx").on(t.warehouseId, t.number)]);
export const mobileCarts = sqliteTable("mobile_carts", {
  id: pk(), code: text("code").notNull(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  description: text("description"), cartTypeId: text("cart_type_id").notNull(), // lookup mobile_cart_type
  levels: integer("levels").notNull(), columns: integer("columns").notNull(),
  operationType: text("operation_type", { enum: ["Picking","Replenishment"] }).notNull().default("Picking"),
  allowMultipleJob: bool("allow_multiple_job").notNull().default(false), isDynamic: bool("is_dynamic").notNull().default(false),
  status: text("status", { enum: ["Available","Occupied"] }).notNull().default("Available"),
  currentJobId: text("current_job_id"), ...stamps(),
}, (t) => [uniqueIndex("mobile_cart_code_idx").on(t.warehouseId, t.code)]);
export const mobileCartCells = sqliteTable("mobile_cart_cells", {
  id: pk(), cartId: text("cart_id").notNull().references(() => mobileCarts.id, { onDelete: "cascade" }),
  level: integer("level").notNull(), column: integer("column").notNull(), barcode: text("barcode").notNull(),
  orderId: text("order_id"),
}, (t) => [uniqueIndex("cart_cell_idx").on(t.cartId, t.level, t.column)]);
export const shipmentPackages = sqliteTable("shipment_packages", {
  id: pk(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id), code: text("code").notNull(),
  description: text("description"), weightUnit: text("weight_unit").notNull().default("Pound"),
  emptyWeight: real("empty_weight").notNull().default(0), maxWeight: real("max_weight"),
  dimensionUnit: text("dimension_unit").notNull().default("Inch"), length: real("length").notNull(), width: real("width").notNull(),
  height: real("height").notNull(), volumeUnit: text("volume_unit").notNull().default("Cubic Inch"), maxVolume: real("max_volume"),
  currency: text("currency").notNull().default("USD"), purchasePrice: real("purchase_price").notNull().default(0),
  isActive: bool("is_active").notNull().default(true), allClients: bool("all_clients").notNull().default(true),
  trackInventory: bool("track_inventory").notNull().default(false), inventoryClientId: text("inventory_client_id"),
  inventoryProductId: text("inventory_product_id"),
  reductionRule: text("reduction_rule", { enum: ["Packing Station","Specific Location","Any Location"] }),
  reductionLocationId: text("reduction_location_id"), ...customFields(), ...stamps(),
}, (t) => [uniqueIndex("ship_pkg_code_idx").on(t.warehouseId, t.code)]);
export const shipmentPackageClients = sqliteTable("shipment_package_clients", {
  packageId: text("package_id").notNull().references(() => shipmentPackages.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => clients.id), hasAccess: bool("has_access").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.packageId, t.clientId] })]);

/* ---------- inventory ledger — schema/inventory.ts ---------- */
export const inventoryTransactions = sqliteTable("inventory_transactions", {
  id: pk(), seq: integer("seq").notNull(), // monotonic, stable ordering
  type: text("type", { enum: TXN_TYPES }).notNull(),
  warehouseId: text("warehouse_id").notNull(), clientId: text("client_id").notNull(), productId: text("product_id").notNull(),
  fromInventoryId: text("from_inventory_id"), toInventoryId: text("to_inventory_id"),
  fromLocationId: text("from_location_id"), toLocationId: text("to_location_id"),
  fromLpId: text("from_lp_id"), toLpId: text("to_lp_id"), fromParentLpId: text("from_parent_lp_id"), toParentLpId: text("to_parent_lp_id"),
  fromStatus: text("from_status"), toStatus: text("to_status"), fromPackType: text("from_pack_type"), toPackType: text("to_pack_type"),
  fromLot: text("from_lot"), toLot: text("to_lot"), fromExpiry: text("from_expiry"), toExpiry: text("to_expiry"),
  fromProductionDate: text("from_production_date"), toProductionDate: text("to_production_date"),
  fromDamageReason: text("from_damage_reason"), toDamageReason: text("to_damage_reason"),
  uomQty: integer("uom_qty").notNull(), packQty: integer("pack_qty").notNull(), // signed for adjust/count deltas
  adjustmentReasonId: text("adjustment_reason_id"),
  orderId: text("order_id"), orderLineId: text("order_line_id"), purchaseOrderId: text("purchase_order_id"),
  receiptId: text("receipt_id"), workOrderId: text("work_order_id"), countPlanId: text("count_plan_id"),
  returnOrderId: text("return_order_id"), jobId: text("job_id"), taskId: text("task_id"), shipmentId: text("shipment_id"),
  algorithmName: text("algorithm_name"), algorithmRuleName: text("algorithm_rule_name"),
  note: text("note"), userId: text("user_id"), source: text("source").notNull(), at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [index("itx_product_idx").on(t.productId, t.at), index("itx_type_idx").on(t.type, t.at),
          index("itx_order_idx").on(t.orderId), index("itx_wh_idx").on(t.warehouseId, t.at), uniqueIndex("itx_seq_idx").on(t.seq)]);
export const inventoryAllocations = sqliteTable("inventory_allocations", {
  id: pk(), inventoryId: text("inventory_id").notNull().references(() => inventory.id),
  orderId: text("order_id"), orderLineId: text("order_line_id"), workOrderId: text("work_order_id"),
  workOrderComponentId: text("work_order_component_id"), jobId: text("job_id"), taskId: text("task_id"),
  qty: integer("qty").notNull(),
  status: text("status", { enum: ["Allocated","Picked","Sorted","Packed","Loaded","Shipped","Cancelled"] }).notNull().default("Allocated"),
  algorithmId: text("algorithm_id"), ruleName: text("rule_name"), waveId: text("wave_id"), ...stamps(),
}, (t) => [index("alloc_order_idx").on(t.orderId), index("alloc_inv_idx").on(t.inventoryId), index("alloc_job_idx").on(t.jobId)]);
export const inventorySnapshots = sqliteTable("inventory_snapshots", {
  id: pk(), snapshotAt: text("snapshot_at").notNull(), warehouseId: text("warehouse_id").notNull(), clientId: text("client_id").notNull(),
  productId: text("product_id").notNull(), locationId: text("location_id").notNull(), lpId: text("lp_id"), parentLpId: text("parent_lp_id"),
  lotNumber: text("lot_number"), expiryDate: text("expiry_date"), productionDate: text("production_date"), damageReason: text("damage_reason"),
  status: text("status").notNull(), packType: text("pack_type").notNull(), uomQty: integer("uom_qty").notNull(), packQty: integer("pack_qty").notNull(),
}, (t) => [index("snap_at_idx").on(t.snapshotAt, t.warehouseId)]);
export const receipts = sqliteTable("receipts", { // Receiving History rows
  id: pk(), masterId: integer("master_id").notNull(),
  type: text("type", { enum: RECEIVING_TYPES }).notNull(), warehouseId: text("warehouse_id").notNull(), clientId: text("client_id").notNull(),
  purchaseOrderId: text("purchase_order_id"), purchaseOrderLineId: text("purchase_order_line_id"), workOrderId: text("work_order_id"),
  shipmentOrderId: text("shipment_order_id"), returnOrderId: text("return_order_id"), returnOrderLineId: text("return_order_line_id"),
  productId: text("product_id").notNull(), packType: text("pack_type").notNull(), quantity: integer("quantity").notNull(),
  uomQuantity: integer("uom_quantity").notNull(), lotNumber: text("lot_number"), expiryDate: text("expiry_date"),
  productionDate: text("production_date"), locationId: text("location_id").notNull(), lpId: text("lp_id"), parentLpId: text("parent_lp_id"),
  damageReason: text("damage_reason"), damageImageFileId: text("damage_image_file_id"),
  customerReturnReason: text("customer_return_reason"), actualReturnReason: text("actual_return_reason"),
  skuDetailsUpdated: bool("sku_details_updated").notNull().default(false), note: text("note"), lineNote: text("line_note"),
  inventoryTransactionId: text("inventory_transaction_id"), receivedBy: text("received_by").notNull(),
  receivedAt: text("received_at").notNull().$defaultFn(nowIso), cancelledAt: text("cancelled_at"), cancelledBy: text("cancelled_by"),
}, (t) => [index("receipts_po_idx").on(t.purchaseOrderId), index("receipts_at_idx").on(t.receivedAt), uniqueIndex("receipts_master_idx").on(t.masterId)]);
export const missingLog = sqliteTable("missing_log", {
  id: pk(), waveNo: text("wave_no"), jobId: text("job_id"), taskId: text("task_id"), orderId: text("order_id"),
  productId: text("product_id").notNull(), locationId: text("location_id").notNull(), lpId: text("lp_id"),
  packType: text("pack_type").notNull(), missingQty: integer("missing_qty").notNull(), inventoryQty: integer("inventory_qty").notNull(),
  isRetain: bool("is_retain").notNull().default(false), notes: text("notes"), warehouseId: text("warehouse_id").notNull(),
  clientId: text("client_id").notNull(), enteredBy: text("entered_by").notNull(), enteredAt: text("entered_at").notNull().$defaultFn(nowIso),
});
```

```ts
/* ---------- outbound & shipping — schema/outbound.ts, schema/shipping.ts ---------- */
export const orderLineShortages = sqliteTable("order_line_shortages", {
  id: pk(), orderId: text("order_id").notNull(), orderLineId: text("order_line_id").notNull(),
  reason: text("reason", { enum: ["Insufficient Inventory","No Eligible Stock Found","Reserved For Replenishment"] }).notNull(),
  missingTriggered: bool("missing_triggered").notNull().default(false), shortageQty: integer("shortage_qty").notNull(),
  freeQty: integer("free_qty").notNull(), damagedQty: integer("damaged_qty").notNull(), onHandQty: integer("on_hand_qty").notNull(),
  lastTrialAt: text("last_trial_at").notNull(), resolvedAt: text("resolved_at"),
}, (t) => [uniqueIndex("ols_line_idx").on(t.orderLineId)]);
export const shipments = sqliteTable("shipments", { // one row per package/label = Carrier Shipment Details
  id: pk(), orderId: text("order_id").notNull().references(() => shipmentOrders.id),
  warehouseId: text("warehouse_id").notNull(), clientId: text("client_id").notNull(),
  carrierConnectionId: text("carrier_connection_id"), carrierCode: text("carrier_code").notNull(), carrierServiceId: text("carrier_service_id"),
  serviceName: text("service_name").notNull(), rateShoppingPresetId: text("rate_shopping_preset_id"),
  isRateShopped: bool("is_rate_shopped").notNull().default(false),
  labelType: text("label_type", { enum: ["Shipping Label","Return Label"] }).notNull().default("Shipping Label"),
  labelStatus: text("label_status", { enum: ["Active","Voided"] }).notNull().default("Active"),
  labelFormat: text("label_format", { enum: ["PDF","ZPL","EPL"] }).notNull().default("PDF"), labelFileId: text("label_file_id"),
  masterTrackingNumber: text("master_tracking_number"), trackingNumber: text("tracking_number").notNull(),
  shipmentPackageId: text("shipment_package_id"), packageSeq: integer("package_seq").notNull().default(1),
  weight: real("weight").notNull(), weightUnit: text("weight_unit").notNull().default("Ounce"),
  length: real("length").notNull(), width: real("width").notNull(), height: real("height").notNull(),
  dimensionUnit: text("dimension_unit").notNull().default("Inch"),
  rate: real("rate").notNull().default(0), shippingCost: real("shipping_cost").notNull().default(0), otherCost: real("other_cost").notNull().default(0),
  currency: text("currency").notNull().default("USD"), zone: text("zone"),
  insuranceType: text("insurance_type"), insuranceValue: real("insurance_value"), confirmationType: text("confirmation_type"),
  allowSaturdayDelivery: bool("allow_saturday_delivery").notNull().default(false),
  carrierExpectedDeliveryAt: text("carrier_expected_delivery_at"), labelCreatedAt: text("label_created_at").notNull().$defaultFn(nowIso),
  actualShipmentAt: text("actual_shipment_at"), deliveredAt: text("delivered_at"), voidedAt: text("voided_at"),
  scheduledPickupAt: text("scheduled_pickup_at"), actualPickupAt: text("actual_pickup_at"),
  endOfDayManifestId: text("end_of_day_manifest_id"), packedFromLocationId: text("packed_from_location_id"),
  parentLpId: text("parent_lp_id"), externalReference: text("external_reference"), createdBy: text("created_by"),
}, (t) => [index("shipments_order_idx").on(t.orderId), index("shipments_label_at_idx").on(t.labelCreatedAt), index("shipments_tracking_idx").on(t.trackingNumber)]);
export const shipmentItems = sqliteTable("shipment_items", {
  id: pk(), shipmentId: text("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
  orderLineId: text("order_line_id").notNull(), productId: text("product_id").notNull(), packType: text("pack_type").notNull(),
  quantity: integer("quantity").notNull(), lotNumber: text("lot_number"), expiryDate: text("expiry_date"), serialNumberId: text("serial_number_id"),
});
export const endOfDayManifests = sqliteTable("end_of_day_manifests", {
  id: pk(), warehouseId: text("warehouse_id").notNull(), carrierConnectionId: text("carrier_connection_id").notNull(),
  carrierPrefix: text("carrier_prefix").notNull(), carrierCode: text("carrier_code").notNull(), shipDate: text("ship_date").notNull(), // YYYY-MM-DD
  closeDate: text("close_date"), isPrinted: bool("is_printed").notNull().default(false), totalPackages: integer("total_packages").notNull().default(0),
  status: text("status", { enum: ["Open","Closed"] }).notNull().default("Open"), reportFileId: text("report_file_id"), ...stamps(),
}, (t) => [uniqueIndex("eod_unique_idx").on(t.warehouseId, t.carrierConnectionId, t.shipDate)]);
export const shipmentPlans = sqliteTable("shipment_plans", {
  id: pk(), code: text("code").notNull(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  clientId: text("client_id"), carrierConnectionId: text("carrier_connection_id"), truckPlateNumber: text("truck_plate_number"),
  loadingGateLocationId: text("loading_gate_location_id"),
  status: text("status", { enum: SHIPMENT_PLAN_STATUSES }).notNull().default("Open"),
  plannedShipmentAt: text("planned_shipment_at"), actualShipmentAt: text("actual_shipment_at"),
  loadingStartedAt: text("loading_started_at"), loadingCompletedAt: text("loading_completed_at"), truckDepartedAt: text("truck_departed_at"),
  expectedTotalVolume: real("expected_total_volume").notNull().default(0), expectedTotalWeight: real("expected_total_weight").notNull().default(0),
  preventLpnEditDuringLoading: bool("prevent_lpn_edit_during_loading").notNull().default(false), note: text("note"),
  customerId: text("customer_id"), customerAddressId: text("customer_address_id"), retailerId: text("retailer_id"),
  ...customFields(), ...stamps(),
}, (t) => [uniqueIndex("shipment_plan_code_idx").on(t.code)]);
export const shipmentPlanOrders = sqliteTable("shipment_plan_orders", {
  planId: text("plan_id").notNull().references(() => shipmentPlans.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull().references(() => shipmentOrders.id),
  status: text("status", { enum: SHIPMENT_PLAN_STATUSES }).notNull().default("Open"), addedAt: text("added_at").notNull().$defaultFn(nowIso),
}, (t) => [primaryKey({ columns: [t.planId, t.orderId] })]);

/* ---------- returns — schema/returns.ts ---------- */
export const returnOrders = sqliteTable("return_orders", {
  id: pk(), rmaCode: text("rma_code").notNull(), shipmentOrderId: text("shipment_order_id").references(() => shipmentOrders.id),
  warehouseId: text("warehouse_id").notNull(), clientId: text("client_id").notNull(),
  source: text("source", { enum: ["RMA","Manual","Loop Returns"] }).notNull().default("RMA"),
  status: text("status", { enum: RETURN_STATUSES }).notNull().default("Pending"),
  returnAddressId: text("return_address_id"), fromCountry: text("from_country"), customerName: text("customer_name"),
  carrierCode: text("carrier_code"), carrierServiceName: text("carrier_service_name"), trackingNumber: text("tracking_number"),
  returnLabelShipmentId: text("return_label_shipment_id"), expectedReturnDate: text("expected_return_date"),
  actualReturnDate: text("actual_return_date"), note: text("note"), ...stamps(),
}, (t) => [uniqueIndex("rma_code_idx").on(t.rmaCode)]);
export const returnOrderLines = sqliteTable("return_order_lines", {
  id: pk(), returnOrderId: text("return_order_id").notNull().references(() => returnOrders.id, { onDelete: "cascade" }),
  orderLineId: text("order_line_id"), productId: text("product_id").notNull(), packType: text("pack_type").notNull(),
  requestedQty: integer("requested_qty").notNull(), returnedQty: integer("returned_qty").notNull().default(0),
  customerReturnReasonId: text("customer_return_reason_id"), actualReturnReasonId: text("actual_return_reason_id"),
  disposition: text("disposition", { enum: ["Restock","Damaged","Quarantine","Dispose"] }),
  lineStatus: text("line_status", { enum: RETURN_STATUSES }).notNull().default("Pending"), ...stamps(),
});

/* ---------- work — schema/work.ts ---------- */
export const jobTypes = sqliteTable("job_types", {
  id: pk(), code: text("code").notNull(), description: text("description").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  operationType: text("operation_type", { enum: OPERATION_TYPES }).notNull(),
  allocationAlgorithmId: text("allocation_algorithm_id"), template: text("template"),
  settings: json<JobTypeSettings>("settings").notNull(), // order scope, flags, batch {method,min,max}, mobile screens, count/replen/WO flags
  conditions: json<FilterCondition[]>("conditions").notNull().default(sql`'[]'`),
  locationConditions: json<FilterCondition[]>("location_conditions"), skuConditions: json<FilterCondition[]>("sku_conditions"),
  sourceLocationConditions: json<FilterCondition[]>("source_location_conditions"),
  destinationLocationConditions: json<FilterCondition[]>("destination_location_conditions"),
  lpConditions: json<FilterCondition[]>("lp_conditions"), productConditions: json<FilterCondition[]>("product_conditions"),
  orderBy: json<{ field: string; dir: "asc"|"desc" }[]>("order_by").notNull().default(sql`'[{"field":"walkingPathPriority","dir":"asc"}]'`),
  groupBy: json<string[]>("group_by"), isActive: bool("is_active").notNull().default(true), ...stamps(),
}, (t) => [uniqueIndex("job_types_code_idx").on(t.warehouseId, t.code)]);
export const jobOrders = sqliteTable("job_orders", {
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull().references(() => shipmentOrders.id), toteOrCell: text("tote_or_cell"),
}, (t) => [primaryKey({ columns: [t.jobId, t.orderId] }), index("job_orders_order_idx").on(t.orderId)]);
export const tasks = sqliteTable("tasks", {
  id: pk(), taskNo: integer("task_no").notNull(), jobId: text("job_id").notNull().references(() => jobs.id),
  warehouseId: text("warehouse_id").notNull(), clientId: text("client_id"),
  taskType: text("task_type", { enum: TASK_TYPES }).notNull(), status: text("status", { enum: TASK_STATUSES }).notNull().default("Pending"),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("None"), sequence: integer("sequence").notNull().default(0),
  orderId: text("order_id"), orderLineId: text("order_line_id"), allocationId: text("allocation_id"),
  workOrderId: text("work_order_id"), countPlanId: text("count_plan_id"), countLineId: text("count_line_id"),
  productId: text("product_id"), packType: text("pack_type"), toPackType: text("to_pack_type"),
  plannedQty: integer("planned_qty").notNull().default(0), actualQty: integer("actual_qty").notNull().default(0),
  sourceLocationId: text("source_location_id"), sourceLpId: text("source_lp_id"),
  targetLocationId: text("target_location_id"), targetLpId: text("target_lp_id"), targetCartId: text("target_cart_id"),
  lotNumber: text("lot_number"), expiryDate: text("expiry_date"), productionDate: text("production_date"), damageReason: text("damage_reason"),
  replenishmentPhase: text("replenishment_phase", { enum: ["Replenishment Pick Phase","Replenishment Put Phase","Direct Put"] }),
  lpSwap: bool("lp_swap").notNull().default(false), lpAutoRemoved: bool("lp_auto_removed").notNull().default(false),
  packTypeConversionApplied: bool("pack_type_conversion_applied").notNull().default(false),
  pickShortStatus: text("pick_short_status", { enum: SHORT_STATUSES }).notNull().default("None"),
  packShortStatus: text("pack_short_status", { enum: SHORT_STATUSES }).notNull().default("None"),
  assigneeUserId: text("assignee_user_id"), executedByUserId: text("executed_by_user_id"),
  plannedStartAt: text("planned_start_at"), plannedFinishAt: text("planned_finish_at"), startedAt: text("started_at"), finishedAt: text("finished_at"),
  ...stamps(),
}, (t) => [index("tasks_job_idx").on(t.jobId), index("tasks_order_idx").on(t.orderId), index("tasks_status_idx").on(t.taskType, t.status), uniqueIndex("tasks_no_idx").on(t.taskNo)]);
export const waveRules = sqliteTable("wave_rules", {
  id: pk(), ruleSeq: integer("rule_seq").notNull(), name: text("name").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  operationType: text("operation_type", { enum: WAVE_OP_TYPES }).notNull(),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("None"),
  deleteIfNotStarted: bool("delete_if_not_started").notNull().default(false),
  deleteMethod: text("delete_method", { enum: ["None","At Specific Time","After Hours"] }).notNull().default("None"), deleteTime: text("delete_time"),
  jobTypeIds: json<string[]>("job_type_ids").notNull().default(sql`'[]'`), // ordered precedence
  filters: json<FilterCondition[]>("filters").notNull().default(sql`'[]'`),
  orderBy: json<{ field: string; dir: "asc"|"desc" }[]>("order_by").notNull().default(sql`'[]'`),
  scheduleDays: json<("Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun")[]>("schedule_days").notNull().default(sql`'[]'`),
  scheduleTimes: json<string[]>("schedule_times").notNull().default(sql`'[]'`), // "HH:mm" in warehouse tz
  assignMode: text("assign_mode", { enum: ["Pool","Roles","Users"] }).notNull().default("Pool"),
  assigneeRoleIds: json<string[]>("assignee_role_ids"), assigneeUserIds: json<string[]>("assignee_user_ids"),
  countType: text("count_type", { enum: ["Location","SKU"] }), lockLocations: bool("lock_locations").notNull().default(false),
  softAllocation: bool("soft_allocation").notNull().default(false), mergeRuleIds: json<string[]>("merge_rule_ids"),
  isActive: bool("is_active").notNull().default(true), runCount: integer("run_count").notNull().default(0),
  lastRunAt: text("last_run_at"), lastRunBy: text("last_run_by"), lastWaveNo: text("last_wave_no"), nextRunAt: text("next_run_at"),
  ...stamps(),
});
export const waves = sqliteTable("waves", {
  id: pk(), waveNo: text("wave_no").notNull(), waveRuleId: text("wave_rule_id").references(() => waveRules.id),
  warehouseId: text("warehouse_id").notNull(), status: text("status", { enum: WAVE_STATUSES }).notNull().default("Pending"),
  ordersMet: integer("orders_met").notNull().default(0), shortageOrders: integer("shortage_orders").notNull().default(0),
  jobsCreated: integer("jobs_created").notNull().default(0), allocatedOrders: integer("allocated_orders").notNull().default(0),
  mergedOrders: integer("merged_orders").notNull().default(0), message: text("message"),
  runBy: text("run_by").notNull(), // user name | "Integration" (scheduler)
  runAt: text("run_at").notNull().$defaultFn(nowIso), finishedAt: text("finished_at"),
}, (t) => [uniqueIndex("waves_no_idx").on(t.waveNo)]);
export const allocationExceptions = sqliteTable("allocation_exceptions", {
  id: pk(), orderId: text("order_id").notNull(), waveId: text("wave_id"),
  waveNo: text("wave_no").notNull(), // wave no | "Manual Allocation" | "Manual Allocation - Work Order"
  waveRuleName: text("wave_rule_name"), algorithmName: text("algorithm_name"), algorithmRuleName: text("algorithm_rule_name"),
  shortageProductId: text("shortage_product_id"), inventoryUomQty: integer("inventory_uom_qty"), orderLineQty: integer("order_line_qty"),
  explanation: text("explanation").notNull(), isRolledBack: bool("is_rolled_back").notNull().default(false),
  runBy: text("run_by").notNull(), runAt: text("run_at").notNull().$defaultFn(nowIso),
  warehouseId: text("warehouse_id").notNull(), clientId: text("client_id").notNull(),
}, (t) => [index("alloc_exc_wave_idx").on(t.waveNo), index("alloc_exc_order_idx").on(t.orderId)]);

/* ---------- counts — schema/counts.ts ---------- */
export const countPlans = sqliteTable("count_plans", {
  id: pk(), code: text("code").notNull(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  description: text("description"), scheduledAt: text("scheduled_at").notNull(), lockLocations: bool("lock_locations").notNull().default(false),
  countType: text("count_type", { enum: ["Location","LP","SKU"] }).notNull(),
  operationType: text("operation_type", { enum: ["Cycle Count","Instant Count"] }).notNull().default("Cycle Count"),
  status: text("status", { enum: COUNT_PLAN_STATUSES }).notNull().default("Pending"), isAi: bool("is_ai").notNull().default(false),
  waveRuleId: text("wave_rule_id"), startedAt: text("started_at"), completedAt: text("completed_at"),
  inventoryUpdatedAt: text("inventory_updated_at"), inventoryUpdatedBy: text("inventory_updated_by"), ...stamps(),
}, (t) => [uniqueIndex("count_plan_code_idx").on(t.warehouseId, t.code)]);
export const countPlanLines = sqliteTable("count_plan_lines", {
  id: pk(), planId: text("plan_id").notNull().references(() => countPlans.id, { onDelete: "cascade" }),
  locationId: text("location_id"), productId: text("product_id"), lpId: text("lp_id"), jobId: text("job_id"),
  status: text("status", { enum: COUNT_LINE_STATUSES }).notNull().default("Pending"),
  initialStockQty: integer("initial_stock_qty").notNull().default(0), countedQty: integer("counted_qty"),
  approvedStockQty: integer("approved_stock_qty"), approvedCountQty: integer("approved_count_qty"),
  isRecountLine: bool("is_recount_line").notNull().default(false), recountOfLineId: text("recount_of_line_id"),
  recounted: bool("recounted").notNull().default(false), countUserId: text("count_user_id"), note: text("note"),
  startedAt: text("started_at"), completedAt: text("completed_at"), inventoryUpdatedAt: text("inventory_updated_at"),
  inventoryUpdatedBy: text("inventory_updated_by"), ...stamps(),
}, (t) => [index("count_lines_plan_idx").on(t.planId)]);
export const countLineEntries = sqliteTable("count_line_entries", { // one row per bucket counted in a line
  id: pk(), lineId: text("line_id").notNull().references(() => countPlanLines.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(), locationId: text("location_id").notNull(), lpId: text("lp_id"),
  lotNumber: text("lot_number"), expiryDate: text("expiry_date"), damageReason: text("damage_reason"), packType: text("pack_type").notNull(),
  systemQty: integer("system_qty").notNull(), countedQty: integer("counted_qty").notNull(), countedBy: text("counted_by"),
  countedAt: text("counted_at").notNull().$defaultFn(nowIso),
});

/* ---------- kitting — schema/kitting.ts ---------- */
export const workOrders = sqliteTable("work_orders", {
  id: pk(), code: text("code").notNull(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  type: text("type", { enum: ["Work Order with Picking","Work Order without Picking"] }).notNull(),
  operationType: text("operation_type", { enum: ["Kitting"] }).notNull().default("Kitting"),
  buildFor: text("build_for", { enum: ["Stock","SO"] }).notNull().default("Stock"), shipmentOrderId: text("shipment_order_id"),
  kitProductId: text("kit_product_id").notNull().references(() => products.id), requestedQty: integer("requested_qty").notNull(),
  processedQty: integer("processed_qty").notNull().default(0),
  status: text("status", { enum: WORK_ORDER_STATUSES }).notNull().default("Open"),
  extraNote: text("extra_note"), kittingInstructions: text("kitting_instructions"),
  plannedStartAt: text("planned_start_at"), plannedFinishAt: text("planned_finish_at"), actualStartAt: text("actual_start_at"),
  actualFinishAt: text("actual_finish_at"), cancelledAt: text("cancelled_at"), jobId: text("job_id"),
  outputLocationId: text("output_location_id"), outputLot: text("output_lot"), outputExpiry: text("output_expiry"),
  ...customFields(), ...stamps(),
}, (t) => [uniqueIndex("work_order_code_idx").on(t.code)]);
export const workOrderComponents = sqliteTable("work_order_components", {
  id: pk(), workOrderId: text("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  componentProductId: text("component_product_id").notNull(), componentQty: integer("component_qty").notNull(),
  totalQty: integer("total_qty").notNull(), packType: text("pack_type").notNull().default("Each"),
  locationId: text("location_id"), lpId: text("lp_id"), lotNumber: text("lot_number"), expiryDate: text("expiry_date"),
  productionDate: text("production_date"), allocatedQty: integer("allocated_qty").notNull().default(0),
  pickedQty: integer("picked_qty").notNull().default(0), consumedQty: integer("consumed_qty").notNull().default(0),
});
export const kitInventoryStats = sqliteTable("kit_inventory_stats", { // recalculated by scheduler
  kitProductId: text("kit_product_id").notNull(), warehouseId: text("warehouse_id").notNull(),
  pendingOrderQty: integer("pending_order_qty").notNull(), netKittingCapacity: integer("net_kitting_capacity").notNull(),
  totalInventoryCapacity: integer("total_inventory_capacity").notNull(), currentInventoryQty: integer("current_inventory_qty").notNull(),
  requiredKittingQty: integer("required_kitting_qty").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.kitProductId, t.warehouseId] })]);

/* ---------- automation — schema/automation.ts ---------- */
export const algorithms = sqliteTable("algorithms", {
  id: pk(), name: text("name").notNull(), warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  kind: text("kind", { enum: ["Putaway","Allocation"] }).notNull(),
  status: text("status", { enum: ["Active","Passive"] }).notNull().default("Active"),
  isDynamicReplenishment: bool("is_dynamic_replenishment").notNull().default(false),
  enforceSuggestedLocations: bool("enforce_suggested_locations").notNull().default(false), isSystem: bool("is_system").notNull().default(false),
  ...stamps(),
}, (t) => [uniqueIndex("algorithms_name_idx").on(t.warehouseId, t.kind, t.name)]);
export const algorithmRules = sqliteTable("algorithm_rules", {
  id: pk(), algorithmId: text("algorithm_id").notNull().references(() => algorithms.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(), name: text("name").notNull(), isActive: bool("is_active").notNull().default(true),
  conditions: json<RuleCondition[]>("conditions").notNull(),          // putaway conditions | allocation order conditions ([] = Apply To All)
  inventoryConditions: json<RuleCondition[]>("inventory_conditions"), // allocation only
  actions: json<{ action: string; value?: unknown }[]>("actions"),    // putaway only (38 action keys)
  orderBy: json<{ field: string; dir: "asc"|"desc" }[]>("order_by").notNull(),
});
export const workflows = sqliteTable("workflows", {
  id: pk(), name: text("name").notNull(), description: text("description"),
  trigger: text("trigger", { enum: ["Shipment Order Created","Shipment Order Imported","Shipment Order Updated","Purchase Order Created","Order Shipped"] }).notNull(),
  warehouseId: text("warehouse_id"), clientId: text("client_id"), match: text("match", { enum: ["All","Any"] }).notNull().default("All"),
  conditions: json<RuleCondition[]>("conditions").notNull().default(sql`'[]'`),
  actions: json<{ action: "Block Order"|"Partially Block Order"|"Set Carrier Service"|"Set Rate Shopping Preset"|"Set Priority"|"Add Tag"|"Set Warehouse"|"Set Shipment Package"|"Set Order Type"|"Add Note"|"Notify Users"; params: Record<string, unknown> }[]>("actions").notNull(),
  sequence: integer("sequence").notNull().default(0), isActive: bool("is_active").notNull().default(true),
  stopProcessing: bool("stop_processing").notNull().default(false),
  runCount: integer("run_count").notNull().default(0), lastRunAt: text("last_run_at"), ...stamps(),
});
export const workflowRuns = sqliteTable("workflow_runs", {
  id: pk(), workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), matched: bool("matched").notNull(),
  actionsApplied: json<string[]>("actions_applied"), blockType: text("block_type", { enum: ["Fully","Partially"] }),
  error: text("error"), at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [index("wf_runs_entity_idx").on(t.entityType, t.entityId)]);
export const rateShoppingPresets = sqliteTable("rate_shopping_presets", {
  id: pk(), name: text("name").notNull(), description: text("description").notNull(),
  warehouseId: text("warehouse_id").notNull(), clientId: text("client_id").notNull(),
  method: text("method", { enum: ["Cheapest","Fastest","Cheapest In Time"] }).notNull(), transitDays: integer("transit_days"),
  showErrors: bool("show_errors").notNull().default(false), useAllServices: bool("use_all_services").notNull().default(false),
  isActive: bool("is_active").notNull().default(true), ...stamps(),
});
export const rateShoppingPresetServices = sqliteTable("rate_shopping_preset_services", {
  presetId: text("preset_id").notNull().references(() => rateShoppingPresets.id, { onDelete: "cascade" }),
  carrierServiceId: text("carrier_service_id").notNull().references(() => carrierServices.id),
  isSelected: bool("is_selected").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.presetId, t.carrierServiceId] })]);

/* ---------- integrations — schema/integrations.ts ---------- */
export const channelConnections = sqliteTable("channel_connections", {
  id: pk(), provider: text("provider").notNull(), // shopify|shipstation|amazon|woocommerce|tiktok|magento|walmart|loop|quickbooks|cartrover|squarespace|amazonfba|ebay|bigcommerce|etsy|kitstaks-sandbox
  storeName: text("store_name").notNull(), clientId: text("client_id").notNull().references(() => clients.id),
  distribution: text("distribution", { enum: ["Public App","Custom App","API"] }).notNull().default("Custom App"),
  authMethod: text("auth_method", { enum: ["Access Token","Client ID & Secret","OAuth"] }).notNull().default("Access Token"),
  credentialsEnc: text("credentials_enc"), // AES-256-GCM with INTEGRATION_KEY; never serialized to the client
  apiVersion: text("api_version", { enum: ["Rest API","GraphQL"] }).notNull().default("GraphQL"),
  status: text("status", { enum: ["Pending","Completed","Error"] }).notNull().default("Pending"),
  isActive: bool("is_active").notNull().default(true),
  settings: json<ChannelSettings>("settings").notNull(), // payment statuses, tax id mapping, tag filter, products/orders/inventory/shipments config
  ...stamps(),
});
export const channelLocationMappings = sqliteTable("channel_location_mappings", {
  id: pk(), connectionId: text("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  channelLocationId: text("channel_location_id").notNull(), channelLocationName: text("channel_location_name").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
});
export const channelMethods = sqliteTable("channel_methods", {
  id: pk(), connectionId: text("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  method: text("method", { enum: ["Download Orders","Download Products","Sync Inventory","Send Shipment Info"] }).notNull(),
  status: text("status", { enum: ["Active","Passive"] }).notNull(), intervalMinutes: integer("interval_minutes").notNull(),
  jobStatus: text("job_status", { enum: ["Paused","Processing","Started","Waiting For Next"] }).notNull().default("Waiting For Next"),
  nextRunAt: text("next_run_at"), lastRunAt: text("last_run_at"), lastSuccessAt: text("last_success_at"),
}, (t) => [uniqueIndex("channel_method_idx").on(t.connectionId, t.method)]);
export const channelRuns = sqliteTable("channel_runs", {
  id: pk(), methodId: text("method_id").notNull().references(() => channelMethods.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull(), method: text("method").notNull(),
  status: text("status", { enum: ["Processing","Successful","Partially Successful","No Data","Failed","Unauthorized","Already Processing"] }).notNull(),
  successCount: integer("success_count").notNull().default(0), errorCount: integer("error_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0), startedAt: text("started_at").notNull(), endedAt: text("ended_at"),
}, (t) => [index("channel_runs_conn_idx").on(t.connectionId, t.startedAt)]);
export const channelRunItems = sqliteTable("channel_run_items", {
  id: pk(), runId: text("run_id").notNull().references(() => channelRuns.id, { onDelete: "cascade" }),
  success: bool("success").notNull(), properties: text("properties").notNull(), errorMessage: text("error_message"),
  storeOrderNumber: text("store_order_number"), sellerSku: text("seller_sku"), qty: integer("qty"), at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [index("channel_run_items_run_idx").on(t.runId)]);
export const channelMissingOrders = sqliteTable("channel_missing_orders", {
  id: pk(), connectionId: text("connection_id").notNull().references(() => channelConnections.id),
  orderCode: text("order_code").notNull(), channelOrderNumber: text("channel_order_number").notNull(), orderDate: text("order_date").notNull(),
  lastUpdated: text("last_updated").notNull(), lastErrorCode: text("last_error_code").notNull(), // 14-code catalog, src/lib/integration-errors.ts
  payload: text("payload").notNull(), status: text("status", { enum: ["Error","Retrying","Resolved"] }).notNull().default("Error"),
});
export const carrierConnections = sqliteTable("carrier_connections", {
  id: pk(), provider: text("provider").notNull(), // ups|fedex|usps-stamps|dhl|easypost|shippo|shipstation|custom|kitstaks-sandbox
  setupName: text("setup_name").notNull(), accountPrefix: text("account_prefix").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  environment: text("environment", { enum: ["Test","Production"] }).notNull().default("Test"),
  credentialsEnc: text("credentials_enc"), payorAccountNumber: text("payor_account_number"),
  isActive: bool("is_active").notNull().default(true), allClients: bool("all_clients").notNull().default(true),
  allServices: bool("all_services").notNull().default(true), allPackages: bool("all_packages").notNull().default(true),
  settings: json<CarrierSettings>("settings").notNull(), // shipFrom, useRetailerAddress, generalMarkup, labelFormat/size/messages, intl, returnLabel
  ...stamps(),
});
export const carrierConnectionClients = sqliteTable("carrier_connection_clients", {
  connectionId: text("connection_id").notNull().references(() => carrierConnections.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => clients.id),
  markupType: text("markup_type", { enum: ["Percentage","Fixed Price"] }), markupAmount: real("markup_amount"),
  hasAccess: bool("has_access").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.connectionId, t.clientId] })]);
export const carrierServices = sqliteTable("carrier_services", {
  id: pk(), connectionId: text("connection_id").notNull().references(() => carrierConnections.id, { onDelete: "cascade" }),
  carrierCode: text("carrier_code").notNull(), serviceCode: text("service_code").notNull(), name: text("name").notNull(),
  isActive: bool("is_active").notNull().default(true), transitDays: integer("transit_days").notNull(),
  isInternational: bool("is_international").notNull().default(false),
}, (t) => [uniqueIndex("carrier_service_idx").on(t.connectionId, t.serviceCode)]);
export const carrierPackages = sqliteTable("carrier_packages", {
  id: pk(), connectionId: text("connection_id").notNull().references(() => carrierConnections.id, { onDelete: "cascade" }),
  name: text("name").notNull(), code: text("code").notNull(), isActive: bool("is_active").notNull().default(true),
});
export const carrierThirdPartyAccounts = sqliteTable("carrier_third_party_accounts", {
  id: pk(), connectionId: text("connection_id").notNull().references(() => carrierConnections.id, { onDelete: "cascade" }),
  accountNumber: text("account_number").notNull(), billingCountry: text("billing_country").notNull(), billingZip: text("billing_zip").notNull(),
});
export const carrierCallLogs = sqliteTable("carrier_call_logs", {
  id: pk(), step: text("step", { enum: ["LabelGeneration","RateCall","VoidLabel"] }).notNull(),
  connectionId: text("connection_id").notNull(), orderId: text("order_id"), shipmentId: text("shipment_id"), trackingNumber: text("tracking_number"),
  destinationType: text("destination_type", { enum: ["Domestic","International"] }),
  status: text("status", { enum: ["Success","Error"] }).notNull(),
  httpCode: integer("http_code").notNull(), error: text("error"), responseMs: integer("response_ms").notNull(),
  serviceName: text("service_name"), warehouseId: text("warehouse_id").notNull(), clientId: text("client_id"), userId: text("user_id"),
  source: text("source"), // BatchPacking | PackingStation | OrderGrid | ShipmentPlan
  labelType: text("label_type"), rateShoppingName: text("rate_shopping_name"),
  requestJson: text("request_json").notNull(), responseJson: text("response_json").notNull(), at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [index("carrier_logs_step_idx").on(t.step, t.at)]);

/* ---------- billing — schema/billing.ts ---------- */
export const billingContracts = sqliteTable("billing_contracts", {
  id: pk(), name: text("name").notNull(), clientId: text("client_id").notNull().references(() => clients.id),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id), calcStartDate: text("calc_start_date").notNull(),
  frequency: text("frequency", { enum: ["Monthly","Weekly","Daily","BiMonthly","SemiMonthly","BiWeekly"] }).notNull(),
  approvalStatus: text("approval_status", { enum: ["Draft","Approved"] }).notNull().default("Draft"),
  lastCalculatedAt: text("last_calculated_at"), nextPeriodStart: text("next_period_start"), ...stamps(),
});
export const billingFees = sqliteTable("billing_fees", {
  id: pk(), contractId: text("contract_id").notNull().references(() => billingContracts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  operationType: text("operation_type", { enum: ["Shipment","Recurring","VAS","Pick & Pack","Receiving","Storage","Return","Work Order"] }).notNull(),
  calculationType: text("calculation_type", { enum: ["Daily Accumulation","At Peak Inventory","At Period End","Distinct Period Count","Average Calculation","Split Month Storage"] }),
  feeBy: text("fee_by").notNull(), chargeBy: text("charge_by").notNull(), vasTypeId: text("vas_type_id"),
  useMinPrice: bool("use_min_price").notNull().default(false), minPrice: real("min_price"),
  useMaxPrice: bool("use_max_price").notNull().default(false), maxPrice: real("max_price"),
  splitDay: integer("split_day"), standardRate: real("standard_rate"), alternateRate: real("alternate_rate"),
  conditions: json<RuleCondition[]>("conditions").notNull().default(sql`'[]'`), ...stamps(),
});
export const billingFeeTiers = sqliteTable("billing_fee_tiers", {
  id: pk(), feeId: text("fee_id").notNull().references(() => billingFees.id, { onDelete: "cascade" }),
  fromQty: real("from_qty"), toQty: real("to_qty"), rate: real("rate").notNull(), percentage: real("percentage"),
});
export const billingReports = sqliteTable("billing_reports", {
  id: pk(), contractId: text("contract_id").notNull().references(() => billingContracts.id), billNumber: text("bill_number").notNull(),
  calcStatus: text("calc_status", { enum: ["Successful","Failed"] }).notNull(), clientId: text("client_id").notNull(),
  warehouseId: text("warehouse_id").notNull(), calculatedAt: text("calculated_at").notNull(), createdBy: text("created_by"),
  periodStart: text("period_start").notNull(), periodEnd: text("period_end").notNull(),
  billStatus: text("bill_status", { enum: ["Draft","Approved","Canceled"] }).notNull().default("Draft"),
  totalPrice: real("total_price").notNull(), currency: text("currency").notNull().default("USD"),
  exportedToIntegration: bool("exported_to_integration").notNull().default(false), errorMessage: text("error_message"), ...stamps(),
}, (t) => [uniqueIndex("bill_number_idx").on(t.billNumber)]);
export const billingReportLines = sqliteTable("billing_report_lines", {
  id: pk(), reportId: text("report_id").notNull().references(() => billingReports.id, { onDelete: "cascade" }),
  feeId: text("fee_id"), feeName: text("fee_name").notNull(), operationType: text("operation_type").notNull(),
  feeBy: text("fee_by").notNull(), chargeBy: text("charge_by").notNull(), sku: text("sku"), fromQty: real("from_qty"), toQty: real("to_qty"),
  unitPrice: real("unit_price").notNull(), quantity: real("quantity").notNull(), totalPrice: real("total_price").notNull(),
  minMaxAdjustment: real("min_max_adjustment").notNull().default(0), adjustedPrice: real("adjusted_price").notNull(),
  activityDate: text("activity_date"), referenceNumber: text("reference_number"), lpNumber: text("lp_number"),
  integrationStatus: text("integration_status", { enum: ["Not Sent","Sent","Failed"] }).notNull().default("Not Sent"), note: text("note"),
  isDetail: bool("is_detail").notNull(), // false = consolidated row
});
export const vasOperations = sqliteTable("vas_operations", {
  id: pk(), clientId: text("client_id").notNull(), warehouseId: text("warehouse_id").notNull(),
  vasTypeId: text("vas_type_id").notNull(), operationAt: text("operation_at").notNull(),
  calculationType: text("calculation_type", { enum: ["Total Price","Vas Quantity"] }).notNull(), value: real("value").notNull(),
  note: text("note"), referenceOrderType: text("reference_order_type", { enum: ["Shipment Order","Purchase Order","Work Order"] }),
  referenceNumber: text("reference_number"), ...stamps(),
});
```

## F2 — Seed data (believable, ledger-consistent)

Owned files: `src/server/db/seed.ts`, `seed-data.ts`, `seed-builders.ts`, `seed-orders.ts`,
`src/server/db/seed/**` (new: one file per domain), `scripts/verify-ledger.ts`.

**Rules**
- The RNG is deterministic, so screenshots are stable. `db:reset` takes 60 s or less.
- History is generated by **replaying domain operations (F5)**, so the ledger reconciles. Every stage below is backdated across 30 days.
  1. Create POs, receive them (receipts plus ledger Receiving), then put away (Inventory Movement).
  2. Create orders, then run waves (allocation, jobs and tasks).
  3. Execute some of the tasks (Picking and Packing).
  4. Create labels and ship some of the orders (Shipment).
  5. Return a few (Return Receiving), count a few (Count), adjust a few (Inventory Adjustment), and build kits (Kitting).

**Additions** (on top of the existing 8 clients, 70 products, 249 locations, 420 orders and 30 POs)
- **Access**
  - The 4 system roles, each with its default permission set: Admin, Supervisor (≈ manager), Warehouse Clerk (≈ operator) and Viewer.
  - One custom "Client" role, with restrictions.
  - Users are linked to warehouses. Two client-type users are linked to clients.
  - All 10 users get first and last names, a mix of user types, and 1 API user.
- **Lookups:** all 18 Data Setup types use the Logiwa values:
  - SO types: D2C Order, B2B Order, BackOrder D2C, Partial Allocation D2C.
  - The 5 PO types, the 8 damage reasons, and the pack types Unit, Each, Case, Pallet.
  - Product types and groups per client.
  - Per warehouse: location zones (A–F, Bulk, Dock) and location groups.
  - The 6 VAS types, and a mobile cart type "24-bin 4×6".
  - Adjustment reasons: Inventory is missing, Inventory quantity discrepancy, Classic Migration, Cycle count correction.
  - Cancel reasons: Customer request, Fraud, Duplicate, Address undeliverable, Out of stock.
  - Return reasons and return processes.
- **Code sequences:** SO, PO, Job, Wave, RMA, CNT, WO, SP, BILL and LP.
- **Organization**
  - 2–4 vendors per client, with addresses. POs are re-pointed to `vendorId`.
  - About 150 customers with shipping and billing addresses. 60% of orders link to a customer.
  - 4 retailers (Target, Walmart, Macy's, Staples), with case-label settings.
  - Client settings use the defaults.
- **Catalog**
  - Every product gets a Primary pack type with barcodes. 40% also get a Case hierarchical pack type.
  - 6 kits (3 Kit to Stock, 3 Kit to Order), each with 2–4 components.
  - 4 packaging-material products.
  - Replenishment levels per warehouse for pick-face SKUs.
  - Product listings for 2 channel connections, including 3 unlinked listings and 2 SKU-difference exceptions.
  - 3 serial-tracked products with serial numbers, and 8 lot/expiry-tracked products.
- **Facility**
  - Every location gets an `areaType`, `locationType`, walking path, zone and group ids, and a barcode.
  - Default locations per warehouse: receive, ship, return and pack (MLT1-RECV, MLT1-SHIP, MLT1-RTN, PACK-01..04).
  - Product capacity on 40 pick faces.
  - 3 LP types per warehouse (Picking Tote PT-, Picking Cart PC-, Pallet PLT), and about 120 LPs (40 occupied).
  - 4 mobile carts with cells.
  - 8 shipment packages, including 2 envelopes and 1 inventory-tracked box.
- **Work**
  - Job types per warehouse: Single Unit Orders, Multi Item Orders, B2B Order Picking, Cycle Count, Instant Count, Dynamic Replenishment, Static Replenishment, Work Order Picking. Settings and conditions are realistic.
  - About 50 jobs with tasks. The existing 28 are re-linked via `job_orders` and `tasks`.
  - 5 wave rules (2 scheduled) and about 60 waves in the wave log.
  - Allocation exceptions, shortages and missing-log rows.
- **Algorithms** per warehouse, with the rules from spec 06:
  - Putaway: REPLENISHMENT_ALGORITHM (dynamic) and SAME_SKU_EMPTY_LOCATION_ALGORITHM.
  - Allocation: Default and B2B Default.
- **Workflows:** 3 workflows: block PO-box addresses, set priority High for Prime orders, and tag "VIP" for one client.
- **Rate shopping:** 2 rate-shopping presets.
- **Carriers**
  - 2 carrier connections: "KitStaks Sandbox" (UPS-like and USPS-like services with transit days) and "UPS-TEST" (Test environment).
  - Services and packages for each connection.
  - Shipments and labels for every Shipped order. 10% are multi-package, and 3 labels are voided.
  - EOD manifests for the last 14 days, a mix of Closed and Open.
  - Carrier call logs, including 6 errors.
- **Shipment plans and returns**
  - 4 shipment plans with orders.
  - 12 return orders across every status, with lines and receipts.
- **Counts and work orders**
  - 6 count plans across the lifecycle, including a recount line.
  - 8 work orders across the statuses.
- **Channels**
  - 3 connections (Shopify ×2 and ShipStation ×1), all backed by "kitstaks-sandbox", each with 4 methods.
  - About 400 channel runs, with items.
  - 9 missing orders covering the error catalog, and 2 workflow-blocked orders.
- **Billing**
  - 2 contracts with 4 fees and tiers.
  - 2 calculated billing reports with lines.
  - 12 VAS operations.
- **Platform**
  - Default printout templates for all 25 types.
  - 2 active apps (Labor Analytics, Operational Analytics). The rest are inactive.
  - Company settings.
  - Custom field definitions: SO `textBox1` "Gift Wrap Code" and product `textBox1` "Training".
  - 15 colored tags, applied to orders and POs.
  - 3 shared saved views.
  - 10 notifications per admin.
  - Nightly inventory snapshots for the last 7 days.

`scripts/verify-ledger.ts` implements invariant 0.4.6 and exits non-zero when anything does not reconcile.

## F3 — Server platform (auth, RBAC, scope, API, query, logging)

Owned files:
- `src/server/api-utils.ts` (kept as a re-export shim)
- `src/server/api/{define-route.ts,errors.ts,envelope.ts}`
- `src/server/auth/{session.ts,csrf.ts,permissions.ts,permission-catalog.ts,scope.ts,rate-limit.ts,password.ts,password-policy.ts}`
- `src/server/query/{grid-query.ts,filters.ts,sort.ts,paginate.ts,date-presets.ts}`
- `src/server/log.ts`, `src/middleware.ts`
- `src/app/api/health/route.ts`, `src/app/api/auth/**`, `src/app/api/me/route.ts`

**Sessions**
- The JWT carries `jti` and `sv` (the session version).
- `getSessionUser()` passes only when:
  - the `user_sessions` row is not revoked;
  - `users.isActive` is true;
  - `sv` equals `users.sessionVersion`.
- `sessionVersion` is bumped on deactivation, role change or password change, so a deactivated user loses access on the next request.
- `lastSeenAt` slides with each request, under a 12 h absolute TTL.
- Logout revokes the session row. Users can also "Sign out other sessions".

**CSRF**
- Double-submit token: the `ks_csrf` cookie (SameSite=Strict, not httpOnly) must equal the `x-csrf-token` header on every non-GET request.
- `apiFetch` adds the header.
- A mismatch returns 403 and writes an `audit_log` row.

**Rate limits** (durable, stored in SQLite)

| Scope | Limit |
|---|---|
| Login | 5/min per IP and 10/15 min per account, with lockout at the policy threshold |
| Mutations | 120/min per user |
| Exports and imports | 10/min per user |

`x-forwarded-for` is trusted only when `TRUST_PROXY=1`.

**Passwords**
- The password policy comes from company settings.
- Forgot/reset uses a hashed token flow (`password_reset_tokens`).
- In dev, the reset link is logged to the server console. There is a mail adapter interface for production.

**Permission catalog** (`permission-catalog.ts`)
- It covers the **complete tree from 08 §Roles**: the Fulfillment, Inventory, Automation, Integrations, Reports, Settings, Analytics and Mobile groups.
- Keys look like `fulfillment.shipment_orders.create`. Each key has a label and a group, and the catalog drives the role-matrix UI.
- Default sets:
  - admin: everything.
  - manager: Logiwa's Supervisor set.
  - operator: execution plus view, with no settings, billing or users.
  - viewer: every `*.view`.

**Permission helpers**
- Server: `can(user, key)`, `requirePermission(key)`, and `requirePagePermission(key)` for server components (renders the 403 page).
- Client: `useCan(key)` and `<Can perm>`, fed from `/api/me`.
- Role restrictions (carrier cost, carrier account data, rate-shopping data) are applied in serializers through `redactFor(user, row)`.

**Scope**
- `getScope(user)` returns `{ warehouseIds, clientIds | "all" }`.
- **Every repository must use `scopedWhere(table, scope)`.** Cross-scope reads return 404.
- The header context switcher sets the `ks_ctx_wh` and `ks_ctx_client` cookies. They narrow the default filters but never widen scope.

**`defineRoute`**
- Implements the contract in 0.2.
- Emits structured JSON logs (`{ts, level, route, userId, ms, status, err}`) through `log.ts`.
- Never leaks stack traces to the client.

**Grid queries**
- `grid-query.ts` parses and serializes the grammar from 0.2.
- `filters.ts` compiles `FilterFieldDef[]` plus the parsed filters into a Drizzle `SQL` where-clause.
  - Def shape: `{ key, label, type: "enum"|"text"|"number"|"date"|"boolean", column | sql, options?, nullable? }`.
  - Custom-field slots compile to `json_extract`.
- `sort.ts` whitelists the sort keys.
- `paginate.ts` returns `{rows,total}` with page size capped at 1000.

**Health and profile endpoints**
- `/api/health` reports the DB, migration version and scheduler heartbeat.
- `/api/me` returns the profile, permission keys, scope, restrictions and preferences.

## F4 — Client platform, shared UI primitives, shell, navigation

Owned files:
- `src/components/ui/**`, `src/components/grid/**`, `src/components/shared/**`, `src/components/layout/**`
- `src/config/**`
- `src/lib/**`, except `src/lib/grid-defs/<module>/**`
- `src/app/layout.tsx`, `src/app/globals.css`, `src/app/global-error.tsx`, `src/app/not-found.tsx`
- `src/app/(app)/layout.tsx`, `src/app/(app)/{error.tsx,not-found.tsx,loading.tsx,forbidden/page.tsx}`
- `src/app/(app)/imports/[key]/page.tsx`, `src/app/(app)/notifications/page.tsx`, `src/app/(app)/dev/ui/page.tsx`
- `src/app/login/**`, `src/app/(auth)/{forgot-password,reset-password}/**`
- `public/logos/**`

### F4.1 `src/lib`
- **`api-client.ts`:** `apiFetch<T>()`.
  - Adds the CSRF header and unwraps the envelope.
  - Throws `ApiError {code, message, fieldErrors, status}`.
  - On 401, redirects to `/login?next=`.
- **`query-client.tsx`:** TanStack Query provider, plus `useApiQuery` and `useApiMutation({ path, method, invalidate[] })`.
  - Mutations toast on both success and error.
  - Server `fieldErrors` map into react-hook-form fields.
- **`use-url-state.ts`:** typed search-param state.
  - `useUrlState` and `useGridUrlState(gridKey)`.
  - Writes via `router.replace`, debounced 250 ms.
- **`format.ts`:** dates, money, quantities, weight with units, and relative age ("16d"). All of it follows user preferences.
- **Reference data:**
  - `countries.ts`: 247 countries, plus 62 US states and territories and CA provinces.
  - `status-colors.ts`: the maps from 0.5.
  - `integration-errors.ts`: the 14 error codes, each with title, explanation, recommended action and guide link.
  - `channel-catalog.ts`: 15 channels and 13 carriers, with SVG logos and availability.
- **Other helpers:**
  - `permissions-client.ts`.
  - `keyboard.ts`: shortcut registry.
  - `scan.ts`: keyboard-wedge barcode detection (fast keystrokes that end in Enter).

### F4.2 `src/components/ui` (Radix-based; every control has designed hover, focus, active and disabled states)
- **Overlays**
  - `dialog.tsx`: modal in sizes sm, md, lg, xl and full.
  - `confirm-dialog.tsx`:
    - Variants: danger, attention and info. The red header band holds the question.
    - Body: an optional sub-line plus a **mini-table of the affected records**.
    - Buttons default to `No` / `Yes`.
    - Supports an async confirm with a spinner, and "type to confirm" for mass deletes.
  - `drawer.tsx`: right sheet at 35, 45 or 60% width, with a sticky footer.
    - **Unsaved-changes guard**: "You have unsaved changes!… No / Leave".
    - The guard also runs on Esc and on overlay click.
  - `toast.tsx` and `toaster.tsx`:
    - Bottom-right stack with variants success, error, warning and info.
    - Each toast has a title and message, plus an optional action (e.g. "View").
    - 5 s auto-dismiss, paused on hover.
- **Menus and hints**
  - `tooltip.tsx`, `popover.tsx`, `info-tip.tsx`.
  - `dropdown-menu.tsx`:
    - Renders in a portal, with keyboard arrow navigation.
    - Supports section headers, item descriptions (e.g. the Packing Station "Other Actions" menu) and submenus.
    - Disabled items show the reason as a tooltip.
  - `dropdown.tsx` stays as a compatibility wrapper.
- **Tabs and toggles**
  - `tabs.tsx`: `UnderlineTabs`, `PageTabs` (route-based), `SegmentedTabs`, `VerticalNav`.
  - `segmented-control.tsx`, `switch.tsx`, `checkbox.tsx` (tri-state).
  - `yes-no-toggle.tsx`: green Yes, red No, grey when disabled.
  - `radio-cards.tsx`: card chooser with title, description, icon, NEW/BETA badge and chevron.
- **Inputs**
  - `select.tsx`.
  - `combobox.tsx`: single or multi, async search with a `minChars` hint ("You have to enter at least 3 characters to search."), creatable, clearable, chips, virtualized.
  - `date-picker.tsx`, `datetime-picker.tsx` (`YYYY/MM/DD HH:mm`), `time-picker.tsx`, `date-range-picker.tsx`.
  - `number-input.tsx`: stepper with min/max and decimals, formatted on blur.
  - `text-field.tsx` and `textarea.tsx`, with a `0 / 500` counter.
  - `chip-input.tsx`: barcodes, tracking numbers, tags.
  - `color-swatch-picker.tsx`.
  - `file-dropzone.tsx`: type and size validation, with progress.
- **Display**
  - `badge.tsx`, `status-pill.tsx` (all the 0.5 maps), `progress-ring.tsx` (with truck icon), `progress-bar.tsx`.
  - `avatar.tsx`, `kbd.tsx`, `skeleton.tsx`, `stat-tile.tsx`, `kpi-chip.tsx`.
  - `empty-state.tsx`: icon, title, copy and CTA cards.
  - `callout.tsx`: Attention, Info and Error banners.
  - `barcode.tsx`: bwip-js.
- **`form/` system**
  - `form.tsx`: `useZodForm(schema, defaults)`.
  - `form-field.tsx`: label with `*` and info tip, the control, an **inline error message**, and a description.
  - `form-section.tsx`, `form-grid.tsx`, `submit-bar.tsx`.
  - On submit, focus jumps to the first error.
- **`wizard/`**
  - Components:
    - `wizard.tsx`.
    - `wizard-stepper.tsx`: horizontal page stepper; each step shows an icon, "Step N" and a label, with complete, active and attention states.
    - `wizard-pills.tsx`: drawer-style "1.General 2.Kit …".
    - `wizard-rail.tsx`: status card with a progress-ring %, a summary slot and the primary save.
    - `wizard-success.tsx`: "You have successfully created … / What can you do next?" with option cards.
  - Config: `steps[{ key, label, icon, schema, render, isOptional }]`.
  - Modes:
    - `linear` (create): a step is not clickable until it has been reached.
    - `free` (edit): every step is clickable.
  - Validation runs per step on Next.
  - The draft persists in `sessionStorage`, keyed by route.

### F4.3 `src/components/grid`
- **`data-grid.tsx`** (rewritten; the props stay backward-compatible):
  - Server multi-sort.
  - Columns: resize, drag-reorder, pin-left (sticky-right is kept).
  - Selection: tri-state header checkbox. Selection persists across pages, with a "Select all N matching" banner.
  - Density, page sizes 100–1000, `Total` and `Selected` counts, and the `|< < [n] / N > >|` pager.
  - Rows are virtualized above 200.
  - Header `?` tooltips, link cells, and loading, empty and error states.
  - Row kebab via `rowActions`. Optional expandable rows.
- **Toolbar pieces**
  - `grid-toolbar.tsx`.
  - `search-mode.tsx`: Equal / Starts With popover with an Apply button.
  - `filter-builder/`:
    - `filter-popover.tsx`: New and Saved tabs, field search, pin/bookmark favorites, and a + button.
    - `field-editors.tsx`:
      - enum checklist, with an "Empty" option;
      - text with 6 operators;
      - numeric Min–Max;
      - boolean;
      - date with 18 presets plus custom From/To plus an "X day" input.
    - `filter-chips.tsx`: two-line chips, with a +N overflow popover.
    - `date-presets.ts`.
  - `saved-views.tsx`: name, Create New, overwrite, share, set default.
  - `column-chooser.tsx`: gear icon, checkbox list, Apply and Reset. Persisted per user.
  - `bulk-actions.tsx` and `row-menu.tsx`.
  - `export-button.tsx`: async; shows the toast "Started preparing the Excel file… check the Transactions section".
- **Cells:** `cells.tsx` provides `LinkCell`, `ExternalFilterLink` (opens a pre-filtered list in a new tab), `DateCell`, `MoneyCell`, `QtyCell`, `YesNoPill`, `TagsCell`, `ChannelCell` (logo), `UserCell` and `CountdownCell`.
- **Hooks and types**
  - `use-grid.ts` ties together URL state, query, prefs and selection.
  - `grid-types.ts`: `GridColumnDef` with `filter?: FilterFieldDef`, `sortKey`, `defaultVisible` and `headerTip`.
- **Forks:** `locations/locations-data-grid.tsx` and `receiving/po-grid.tsx` are deleted by their owning modules once they adopt this grid.

### F4.4 `src/components/shared`
- **Record utilities**
  - `change-log-drawer.tsx`: TYPE icon, MESSAGE, OPERATION DATE, SOURCE. Shows human field labels, prefixes line entries with the SKU, and is paged.
  - `tag-popover.tsx`: search, paged checklist ("1-10 of 21 · Selected: N"), Apply, manage, and an empty state with Create Tag.
  - `create-tag-modal.tsx`: color swatch, name (0/30), Add.
  - `custom-fields-section.tsx` and `custom-fields-drawer.tsx`:
    - "Create Custom Field": type, name, Is Active, + Add More, Add To Form.
    - Enforces the slot limits: 3 text boxes, 2 dropdowns, 3 dates, 2 toggles.
  - `print-options-modal.tsx`:
    - Template cards are filtered by type and client access, with a Print Quantity input.
    - **Preview** shows an inline PDF; **Download** saves it.
    - **Print** sends straight to the assigned printer when the agent is present; otherwise it opens the PDF and calls `window.print`.
  - `document-upload-modal.tsx` and `documents-viewer.tsx`.
- **`import-page.tsx`:** the shared template for `/imports/[key]`.
  - Title, helper text and a back link.
  - Green "Download our excel template" card.
  - Dropzone and Refresh.
  - History grid: STATUS, MASTER ROW COUNT, SUCCESS, ERROR, UPLOADED BY, CREATED DATE TIME and ACTIONS. Actions are Details (drawer with Show Errors), Download Original and Download Error File.
- **Addresses:** `address-form.tsx` (US/CA postal validation, address type, tax type/ID) and `address-card.tsx`.
- **Pickers**
  - `product-search-add.tsx`:
    - Client-scoped, needs at least 3 characters.
    - Each row shows a thumbnail, SKU, name, a quantity stepper, a + button and **live ATP**.
  - `entity-pickers.tsx`:
    - Org and user: `WarehouseSelect`, `ClientSelect` (filtered by warehouse), `UserPicker`, `CustomerPicker`, `VendorPicker`, `JobPicker`.
    - Location and LP: `LocationPicker` (area-type filter, scan icon), `LpPicker`, `LocationOrLpPicker`.
    - Shipping and lookups: `CarrierServiceSelect` (cascading), `ShipmentPackageSelect`, `LookupSelect(type)`.
  - `order-picker-drawer.tsx`: "Add Order(s)" grid with filters and checkbox selection.
  - `record-picker-modal.tsx`: generic "Add Location" / "Add Product" modal with the full filter builder.
- **`create-job-modal.tsx`:**
  - Step A: "X of Y orders are eligible", with a per-order reason list.
  - Path 1, **Merge Into Existing Job**: grid of JOB CODE, TYPE, QTY, PROGRESS and ASSIGNEE, then Select Job.
  - Path 2, **Create New Job**: Job Type*, Batch Size* and Assign to, a preview card ("Below Jobs will be created"), the footer "N Person Assigned | Total Job", and Back / Create Job.
  - Backed by `/api/ops/jobs`. Used by Orders, Shipment Plans, Work Orders and Counts through the `operation` prop.
- **Layout pieces**
  - `record-summary-rail.tsx`:
    - Save and Other Actions.
    - Summary card: code, status pill, Last Update, Show Change Log, and totals.
    - Slots for Assigned Jobs, Billing Charges and Printouts.
  - `detail-header.tsx`, `kv-list.tsx`, `notes-panel.tsx`.
  - `activity-timeline.tsx`: built from `change_log` plus the ledger. Never synthesized.

### F4.5 Shell (`src/components/layout/**`)
- **`app-shell.tsx`:** indigo top bar with **7 mega-menus**: Fulfillment, Inventory, Automation, Integrations, Reports, Analytics, Settings.
  - Opening: hover with a 150 ms intent delay, or click or keyboard.
  - Each menu shows columns with an icon and heading, permission-filtered items, BETA badges, and an underline on the active trigger.
  - Below 1024 px it becomes a mobile drawer.
- **`global-search.tsx`:** opens on `/` or Ctrl+K.
  - **Pages** group, as in Logiwa, with the matched text in bold.
  - **Records** group, which beats Logiwa: orders (code, store order #, tracking), POs, SKUs and barcodes, LPs, locations, jobs, clients.
  - Results are scoped and permission-aware, recent searches are kept, and the whole list is keyboard-navigable.
- **Header utilities**
  - `transactions-tray.tsx`: background tasks with progress, status pills and download links. Polls every 5 s while a task is active.
  - `printers-popover.tsx`: pick the warehouse, then the barcode and laser printers. Saves to `user_printers`.
  - `notifications-bell.tsx`: unread badge, list, mark read and mark all read, deep links.
  - `help-menu.tsx`: shortcuts sheet, docs, What's new.
  - `user-menu.tsx`: My Profile, Change Password, Preferences, Company Settings, Apps, Sign out, Sign out all sessions.
  - `context-switcher.tsx`: warehouse and client context (beats Logiwa, which has none).
- **Page chrome**
  - `page-header.tsx`: breadcrumbs from nav-config, title, helper text, actions, and `<PageTabs group>`.
  - `breadcrumbs.tsx`.
- **Config**
  - `src/config/nav-config.ts`: the complete map in F4.7. Each item has `{ label, href, permission, icon?, badge?, aliases[] }`.
  - `src/config/page-tabs.ts`: the groups in F4.6.

### F4.6 Page tab groups (`src/config/page-tabs.ts`)

| Group | Tabs (label → route) |
|---|---|
| orders | Order Backlog `/orders` · Shipped & Canceled Orders `/orders/shipped` · Return Orders `/orders/returns` |
| shipments | Carrier Shipment Details `/shipments` · End Of The Day `/shipments/end-of-day` |
| shipment-plans | Shipment Plan `/shipment-plans` · Shipment Plan Orders `/shipment-plans/orders` · Shipment Plan LPs `/shipment-plans/lps` |
| jobs | Wave Rules `/jobs/wave-rules` · Job Management `/jobs` · Allocation Exceptions `/jobs/allocation-exceptions` · Wave Log Report `/jobs/wave-log` · Shortage Report `/jobs/shortage` |
| tasks | Order Operations `/tasks/order-operations` · Count `/tasks/count` · Replenishment `/tasks/replenishment` |
| receiving | Purchase Order `/receiving` · Vendors `/receiving/vendors` · Receiving History `/receiving/history` |
| inventory | Total Inventory `/inventory` · Inventory by Location `/inventory/by-location` · Available To Promise `/inventory/atp` · Kit Inventory `/inventory/kits` · Kit Component Inventory Availability `/inventory/kit-components` |
| counts | Count Plan `/counts` · Location Details `/counts/locations` · SKU Details `/counts/skus` |
| products | Products `/products` · Product Listings `/products/listings` |
| organization | Client `/clients` · Customer `/organization/customers` · Vendors `/organization/vendors` · Retailers (BETA) `/organization/retailers` |
| lp | LP Types `/settings/lp-types` · LP Numbers `/settings/lp-numbers` |
| billing | 3PL Billing `/billing` · Billing Report `/billing/reports` · VAS Operations `/billing/vas` |
| users | Users `/settings/users` · Roles `/settings/roles` |
| algorithms | Putaway Algorithm `/automation/algorithms/putaway` · Allocation Algorithm `/automation/algorithms/allocation` |
| integrations | Plugin Integrations `/integrations/channels` · Channel Logs `/integrations/logs/methods` |
| monitoring | Channel Health Overview `/integrations/monitoring` · Channel Setup Details `/integrations/monitoring/setup` · Items For Review `/integrations/monitoring/missing-orders` |
| carrier-errors | Label Generation `/integrations/carrier-errors/label-generation` · Rate Call `…/rate-call` · Void/Cancel Label `…/void-label` |
| serial | Tracking `/reports/serial-numbers` · Serial Number Shipment History `/reports/serial-numbers/shipment-history` · Serial Number Receiving History `/reports/serial-numbers/receiving-history` |
| transactions | Transaction History `/reports/transaction-history` · Serial Number Transaction History `/reports/transaction-history/serial` |
| account | My Profile `/account/profile` · Change Password `/account/password` · Preferences `/account/preferences` |

### F4.7 Complete nav map (`src/config/nav-config.ts`): Logiwa item → KitStaks route → owner

| Menu / column | Logiwa item | KitStaks route | Owner |
|---|---|---|---|
| (top) | Dashboard | `/dashboard` | M13 |
| Fulfillment / Outbound | Shipment Orders | `/orders` | M01 |
| | Shipped Orders | `/orders/shipped` | M01 |
| | Carrier Shipment Details | `/shipments` | M02 |
| | End Of The Day | `/shipments/end-of-day` | M02 |
| | Packing Station | `/packing-station` | M04 |
| Fulfillment / Task Management | Job Management | `/jobs` | M03 |
| | Order Operations Task Details | `/tasks/order-operations` | M03 |
| | Count Task Details | `/tasks/count` | M03 |
| | Replenishment Task Details | `/tasks/replenishment` | M03 |
| Fulfillment / Shipment | Shipment History | `/shipments/history` | M02 |
| | Shipment Plan | `/shipment-plans` | M02 |
| Inventory / Inbound | Purchase Orders | `/receiving` | M05 |
| | Receiving History | `/receiving/history` | M05 |
| | Return Station | `/return-station` | M04 |
| | Return Orders | `/orders/returns` | M04 |
| | Work Orders | `/work-orders` | M08 |
| Inventory / Inventory | Total Inventory | `/inventory` | M06 |
| | Inventory by Location | `/inventory/by-location` | M06 |
| | Available To Promise (ATP) | `/inventory/atp` | M06 |
| Inventory / Count Operations | Count Plan | `/counts` | M07 |
| | Count Location Details | `/counts/locations` | M07 |
| | Count SKU Details | `/counts/skus` | M07 |
| Automation / Workflows & Algorithms | Algorithms | `/automation/algorithms` (type picker) | M12 |
| | Workflows | `/automation/workflows` | M12 |
| | Rate Shopping | `/automation/rate-shopping` | M12 |
| | Wave Rules | `/jobs/wave-rules` | M03 |
| Integrations / Plugin Integrations | Channel Integrations | `/integrations/channels` | M12 |
| | Carrier Integrations | `/integrations/carriers` | M12 |
| Integrations / Channel Logs | Channel Methods | `/integrations/logs/methods` | M12 |
| | Channel History | `/integrations/logs/history` | M12 |
| | Orders and Shipments | `/integrations/logs/orders` | M12 |
| | Products and Inventory | `/integrations/logs/products` | M12 |
| Integrations / Channel Monitoring | Channel Health Overview | `/integrations/monitoring` | M12 |
| | Channel Setup Details | `/integrations/monitoring/setup` | M12 |
| | Missing Shipment Orders | `/integrations/monitoring/missing-orders` | M12 |
| | Recent Errors | `/integrations/monitoring/recent-errors` | M12 |
| | Workflow Blocked Shipment Orders | `/integrations/monitoring/workflow-blocked` | M12 |
| | Product Listing Exceptions | `/integrations/monitoring/listing-exceptions` | M12 |
| Integrations / Carrier Monitoring | Carrier Errors | `/integrations/carrier-errors/label-generation` | M12 |
| Reports / Orders | Channel Sales Report | `/reports/channel-sales` | M13 |
| | Shipment History | `/shipments/history` | M02 |
| | Shortage Report | `/jobs/shortage` | M03 |
| Reports / Inventory | Available To Promise (ATP) | `/inventory/atp` | M06 |
| | Kit Inventory Report | `/inventory/kits` | M08 |
| | Kit Component Inventory Availability Report | `/inventory/kit-components` | M08 |
| | Serial Number Report | `/reports/serial-numbers` | M13 |
| | Order Inventory | `/reports/order-inventory` | M13 |
| | Dynamic Replenishment Report | `/reports/replenishment` | M13 |
| | Inventory Snapshot Report | `/reports/inventory-snapshot` | M13 |
| Reports / Logs | Change Log | `/reports/change-log` | M13 |
| | Transaction History | `/reports/transaction-history` | M13 |
| | Integration Log | `/integrations/logs/history` | M12 |
| | Missing Log | `/reports/missing-log` | M13 |
| | Serial Number Transaction History | `/reports/transaction-history/serial` | M13 |
| | Allocation Exceptions | `/jobs/allocation-exceptions` | M03 |
| | Wave Log Report | `/jobs/wave-log` | M03 |
| | Excel Export History | `/reports/export-history` | M13 |
| Reports / Receiving | PO Receiving Report | `/reports/po-receiving` | M13 |
| | Receiving History | `/receiving/history` | M05 |
| Reports / Warehouse Efficiency | User Performance Report | `/reports/user-performance` | M13 |
| Reports (extra) | Report Hub | `/reports` | M13 |
| Analytics / Labor Analytics | Average Task · Associate Task · Performance Quadrant · Associate · Receiving Performance | `/analytics/labor/{average-task,associate-task,performance-quadrant,associate,receiving-performance}` | M13 |
| Analytics / Operational Analytics | Inbound & Inventory · Fulfillment · Management · Productivity Dashboard | `/analytics/operational/{inbound-inventory,fulfillment,management,productivity}` | M13 |
| Settings / Master Data | Products | `/products` | M09 |
| | Product Listings | `/products/listings` | M09 |
| | Locations | `/locations` | M10 |
| | Vendors | `/organization/vendors` (same component at `/receiving/vendors`) | M05 |
| | Customers | `/organization/customers` | M11 |
| | Retailers (BETA) | `/organization/retailers` | M11 |
| Settings / Configuration | Warehouse | `/settings/warehouses` | M10 |
| | Mobile Carts | `/settings/mobile-carts` | M10 |
| | LP Types | `/settings/lp-types` | M10 |
| | LP Numbers | `/settings/lp-numbers` | M10 |
| | Shipment Packages | `/settings/shipment-packages` | M10 |
| | Printouts & Labels | `/settings/printouts` | M14 |
| | Data Setup | `/settings/data-setup/code-generation` | M14 |
| | Job Types | `/settings/job-types` | M03 |
| | Screen Configuration | `/settings/screen-configuration` | M14 |
| Settings / Client Setup | Clients | `/clients` | M11 |
| | 3PL Billing | `/billing` | M11 |
| | Billing Report | `/billing/reports` | M11 |
| | VAS Operations | `/billing/vas` | M11 |
| Settings / Users | Users | `/settings/users` | M14 |
| | Roles | `/settings/roles` | M14 |
| Settings (extra) | Audit Log | `/settings/audit` | M14 |
| User menu | My Profile · Change Password · Preferences | `/account/{profile,password,preferences}` | M14 |
| | Company Settings | `/settings/company` | M14 |
| | Apps | `/settings/apps` | M14 |
| Header | Notifications | `/notifications` | Foundation |
| All import pages | `import/<entity>/<id>` | `/imports/<key>` | Foundation page + module handler |

Detail and create routes. Several of these go beyond Logiwa, which has no job, location or client detail pages:
- Orders: `/orders/new`, `/orders/[id]`, `/orders/returns/[id]`, `/orders/returns/new`
- Receiving: `/receiving/new`, `/receiving/[id]`
- Catalog and facility: `/products/[id]`, `/locations/[id]`, `/clients/[id]`
- Work: `/jobs/[id]`, `/work-orders/[id]`, `/counts/[id]`, `/shipment-plans/[id]`
- Billing: `/billing/[id]`, `/billing/reports/[id]`
- Automation: `/automation/algorithms/{putaway,allocation}/{new,[id]}`, `/automation/workflows/{new,[id]}`
- Integrations: `/integrations/channels/[provider]`, `/integrations/carriers/[provider]`

## F5 — Domain engines (`src/server/domain/**`)

**Conventions**
- Every function takes `(tx, ctx {userId, source}, input)`.
- Failures throw `DomainError(code, message, details)`.
- Unit-test line coverage must be at least 90%, under `tests/unit/foundation/domain/**`.

**`sequences.ts`**
- `next(tx, key, warehouseId?)`.
- `peek()`: used by the wizard's "auto generated" link.

**`change-log.ts`**
- `recordCreate`, `recordUpdate` and `recordDelete`.
- `recordUpdate` diffs the before and after rows and writes one row per changed field, with human-readable labels.
- `recordLine`: line-level entries such as "MLT-WIDGET-01 -> Received Qty is modified. 0 --> 24".

**`state-machines.ts`**
- Covers transition tables, with guard reasons, for: SO, PO, job, task, count plan and count line, work order, return, shipment plan, EOD, billing report, and wave.
- `canTransition()` is exported so the UI can enable or disable actions and show the reason as a tooltip.
- SO transitions:
  - Open → Ready to Pick, Shortage, On Hold, or Cancelled.
  - Ready to Pick → Picking Started → Ready to Pack → Packing Started → Ready to Ship → Shipped or Partially Shipped.
  - The Sorting and Loading branches apply when the job type enables them.
  - On Hold returns to the previous status.
  - Cancelled is terminal.

**`ledger.ts`**: the **only** writer of `inventory` and `inventory_transactions`.
- Operations:
  - `add`, `remove`, `adjustTo`: an absolute target qty plus a reason, recorded as a signed delta.
  - `move`, `moveLocation`, `moveLp`: the last includes child LPs.
  - `changeAttributes`: lot, expiry, production date or damage. A damage change moves qty between undamaged and damaged.
  - `setStatus`: Stock → Allocated → Picked → Sorted → Packed → Loaded.
  - `consume`.
- Enforces:
  - location rules: only-1 SKU/lot/expiry/LP/production date, only-damaged, locked, capacity;
  - LP-type mixing rules;
  - non-negative stock;
  - scope.
- Receipts: `recordReceipt` and `cancelReceipt`. Cancelling a receipt on a Completed PO is blocked with "A received line of an order in completed status can't be cancelled."
- Serials: `registerSerials`, `pickSerial`, `shipSerials`.

**`atp.ts`**
- Formulas from spec 04/07:
  - Current ATP = Undamaged − Open SO
  - Planned ATP = Current ATP + Open PO
  - On Hand = undamaged stock in sync-allowed locations
  - Sellable = On Hand − Open SO
  - Pickable = unallocated, undamaged stock in allocatable, unlocked locations
  - Unallocated SO = Open SO − Allocated SO
- Also provides SQL builders used by M06 and M13.

**`allocation.ts`**
- `allocateOrders(tx, ctx, { orderIds, warehouseId, algorithmId?, waveId?, waveNo, runBy, mode })`.
- Rules are evaluated in If / If-else order:
  1. The order conditions select the rule.
  2. The inventory conditions filter the buckets.
  3. The order-by ranks what is left. The default is FEFO.
- Writes `inventory_allocations`, the ledger `Allocation` entry, `order_lines.allocated_quantity` and the order status.
- Records misses in two places:
  - `order_line_shortages`, with reason Insufficient Inventory or No Eligible Stock Found.
  - `allocation_exceptions`, with the Logiwa explanation strings: "Shortage", "Eliminated by '<X>' Condition(s)", "Order bypassed: All items are currently out of stock".
- `deallocate`: posts an Allocation Cancel.
- `evaluateConditions`: shared with workflows, job types and wave filters.

**`jobs.ts`**
- `createJobsFromOrders(tx, ctx, { orderIds, jobTypeId, batchSize, assigneeUserId?, waveId?, priority? })` and `mergeIntoJob`.
- Eligibility checks: order status, warehouse, job-type conditions and order scope (single, multi, identical, all).
- Batching follows the job type's limitation method (number of orders or number of items, with min/max).
- Tasks:
  - One Picking task per allocation, sequenced by the job-type order-by and then walking path.
  - Packing tasks, unless the job type is Only Pick.
  - Sorting and Loading tasks when the job type enables them.
- Planned times: start = now + 1 h, end = now + 2 h, and each task's planned finish = start + 1 min per task (configurable).
- Also: `cancelJob` (releases allocations back to Open), `assign` and `unassign` (same-warehouse guard), `updatePriority`, `removeOrderFromJob`, and `jobProgress`.

**`tasks.ts`**
- `execute(tx, ctx, { taskIds, targetLocationId, targetLpId?, qty? })` dispatches to `task-handlers/<type>.ts`.
- Foundation implements the Picking, Packing, Sorting and Loading handlers. Each one:
  - moves stock through the ledger and updates line picked/packed quantities;
  - rolls up the order status and job progress;
  - handles **pick-short**: writes `missing_log`, sets the pick short status to Open, and creates a resolution job when configured.
- Also `update` (target location, To LP, move to another job) and `cancel`.

**`shipping.ts`**
- `rateShop`.
- `createLabel`: writes `shipments` and `shipment_items`, a carrier call log, and the PDF/ZPL label file. Multi-package labels share a master tracking number.
- `voidLabel` and `createReturnLabel`.
- `shipOrders`:
  - consumes the Packed/Loaded stock through ledger Shipment;
  - sets the order to Shipped or Partially Shipped;
  - upserts the EOD manifest and ships the serials.
- `closeEndOfDay`.

**Carriers** (`carriers/adapter.ts` and `carriers/sandbox.ts`)
- The interface is `CarrierAdapter { rate, createLabel, voidLabel, validateAddress }`.
- **KitStaks Sandbox** is deterministic and complete:
  - rates come from a zone × weight × service table;
  - tracking numbers have valid formats (`1Z…` for UPS-like, `9400…` for USPS-like);
  - labels are real 4×6 PDF/ZPL files with barcodes.
- Real adapters (UPS, FedEx, EasyPost, Shippo) are plugged in by M12.

**`address-verification.ts`**
- Normalizes the state (e.g. Arkansas → AR) and merges address line 2 into line 1, as in Logiwa.
- Flags PO boxes and military addresses.
- Returns notes plus a status. Pluggable to the carrier's `validateAddress`.

**`notify.ts`:** `notify(tx, userIds | roleKey, payload)`.

**`workflows.ts`**
- `runWorkflows(tx, ctx, trigger, entity)` evaluates the active workflows in sequence (honoring stop-processing).
- Dispatches to `src/server/workflows/actions/*.ts` (stubs owned by M12).
- Writes `workflow_runs`.
- Called by order create and import.

**`putaway.ts`**
- `suggestLocations(tx, { warehouseId, productId, qty, packType, lpId?, lot?, expiry?, isReceiving })` walks the active putaway algorithm's rule chain (If / If-else):
  1. Conditions select a rule.
  2. Actions filter or "suggest" locations: same SKU, empty location, area type, zone, ABC, capacity checks, and the rest of the 38 actions.
  3. Order-by keys rank the results.
- Returns `{ suggestions: [{ locationId, code, score, reasons[] }], trace[] }`. The trace explains which rule fired and why, which goes beyond Logiwa's Test Algorithm.
- `dynamicReplenishmentTargets(tx, warehouseId)`: To Replenish = Max + Open Order Qty − Target Available − Open Replenish Task Qty (spec 07).

**`orders.ts`**: shipment-order commands, shared by M01 (UI and API), imports, channel downloads (M12) and workflows.
- `createOrder`: validation, then code generation, then address verification, then workflow run, then change log.
- `updateOrder`: field locks by status; for example, lines become read-only once picking starts.
- `cancelOrders` (requires a reason; deallocates), `holdOrders`, `releaseOrders`, `changeWarehouse` (only for orders without jobs), `createBackorder` (splits the unallocatable lines into a child order with `masterOrderId`), `deleteOrders` (soft delete, Open orders without jobs only), and `unmergeOrder`.

**`products.ts`**: `createProduct` and `ensureProductForListing`, the minimal creation path used by imports and channel downloads ("Create Nonexistent Products"). M09 owns the full wizard and API on top of it.

## F6 — Platform services (`src/server/{files,exports,imports,print,scheduler,search}/**`)

**`files.ts`**
- Stores files at `.data/files/<id>`, with sha256 and mime sniffing.
- Upload limits: 10 MB maximum. Attachments must be images or PDF; imports must be xlsx or csv.
- Export files are cleaned up after 7 days.

**`exports/`**
- `POST /api/exports` creates a `background_tasks` row with `kind=export`.
- `runner.ts` loads the provider from `src/server/exports/providers.ts`, a gridKey → provider registry. Providers live in each module's own `src/server/repositories/<prefix>-export.ts`.
  - Foundation pre-registers every gridKey, pointing to a module file path. If that module file does not exist yet, it falls back to a generic provider that exports exactly what the list endpoint returns for the same query.
- Output is xlsx via exceljs: a styled, frozen header, auto widths and typed formats.

**`imports/`**
- `parser.ts` reads xlsx and csv.
- `registry.ts` maps each import key to `{ title, backHref, templateColumns, permission, handler }`. The handlers are stubs, owned per 0.6.
- `POST /api/imports/[key]`:
  1. zod-validates every row;
  2. applies the valid rows in chunked transactions;
  3. writes `import_rows`;
  4. builds an error file.
- `GET /api/imports/[key]/template` generates an xlsx template with an example row and a notes sheet.

**`print/`**
- `render.ts` turns `{ typeKey, records, options }` into PDF bytes (pdf-lib) or ZPL.
- `templates/` implements all 25 printout types with real data and barcodes:
  - **Order documents:** packing list/slip, picking list, consolidated picking list, purchase order list, manifest/BOL, job content, resolution job.
  - **Work orders:** work order picking list and work order consolidated picking list.
  - **Labels:**
    - location, LP, product and mobile cart labels;
    - job picking list, pick-short and pack-short labels;
    - retailer case and parent-LP labels;
    - shipping label (sandbox).
  - **Billing:** contract, billing report, SO billing charges, PO billing charges.
  - **Other:** custom EOD.
- `POST /api/print` returns a file id.

**`scheduler/`**
- `runner.ts` ticks every 30 s and takes a single-flight lease row.
- `/api/cron/tick` is protected by a `CRON_SECRET` bearer token.
- Implemented tasks: `snapshot.ts` (nightly at 00:02 warehouse time) and `exports-cleanup.ts`.
- Stub tasks (0.6): wave rules, channel methods, billing periods, kit recalculation.

**`search/`**
- `registry.ts`, with provider stubs (0.6).
- The Pages provider is implemented and generated from nav-config.

## F7 — Foundation-owned API routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/health` | GET | liveness and readiness |
| `/api/me` | GET, PATCH | profile, permissions, scope, preferences; PATCH sets preferences and context |
| `/api/auth/{login,logout,logout-all,csrf,forgot,reset}` | POST | auth flows |
| `/api/search` | GET | global record and page search |
| `/api/tags`, `/api/tags/[id]`, `/api/tags/apply` | GET, POST, PATCH, DELETE | tag CRUD; bulk apply/remove `{entityType, ids, tagIds, mode}` |
| `/api/change-log` | GET | `entityType` + `entityId`, paged |
| `/api/custom-fields`, `/api/custom-fields/[id]` | GET, POST, PATCH | custom field definitions per entity |
| `/api/lookups/[type]`, `/api/lookups/[type]/[id]` | GET, POST, PATCH, DELETE | Data Setup lookup tables |
| `/api/saved-views`, `/api/saved-views/[id]` | GET, POST, PATCH, DELETE | saved filter views |
| `/api/grid-prefs/[gridKey]` | GET, PUT | per-user column prefs |
| `/api/background-tasks`, `/api/background-tasks/[id]` | GET | Transactions tray and Export History |
| `/api/exports` | POST | queue an export |
| `/api/imports/[key]`, `/api/imports/[key]/template`, `/api/imports/batches/[id]` | GET, POST | upload, history, template, details |
| `/api/files`, `/api/files/[id]` | POST, GET | upload and download (scope checked through the owning entity) |
| `/api/attachments`, `/api/notes` | GET, POST, DELETE | entity documents and notes |
| `/api/print` | POST | render a printout to a file |
| `/api/printers` | GET, PUT | per-user printer assignment |
| `/api/notifications`, `/api/notifications/read` | GET, POST | notifications |
| `/api/pickers/{locations,lps,users,products,customers,vendors,orders,jobs,carrier-services,shipment-packages}` | GET | async picker search (scoped) |
| `/api/ops/jobs`, `/api/ops/jobs/eligibility` | POST | create or merge jobs from orders; eligibility check |
| `/api/ops/allocate` | POST | manual allocation |
| `/api/ops/tasks/{execute,update,cancel}` | POST | task operations |
| `/api/ops/shipping/{rates,labels,void,ship,return-label,close-eod}` | POST | shipping operations |
| `/api/cron/tick` | POST | external scheduler trigger |

## F8 — Foundation acceptance gate (all must pass before modules start)

1. A fresh clone passes `npm ci && npm run db:reset && npm run db:verify && npm run build && npm test`. Lint and typecheck are clean.
2. Every route in F4.7 resolves. A route its module has not built yet renders the shared "Module in progress" placeholder at the correct breadcrumb. This is the only permitted placeholder, and each module must remove its own. Legacy `?tab=` URLs redirect.
3. Access control holds:
   - A viewer sees no Settings menu.
   - As a viewer, `/settings/users` shows the 403 page and `POST /api/tags` returns 403.
   - A POST without the CSRF token returns 403.
   - Deactivating a user kills their open session on the next request.
4. `/dev/ui` shows every primitive, the wizard (both modes), and the grid with all toolbar features on seeded data. The critic signs it off.
5. The dead-click audit passes on the shell: menus, search, tray, printers, notifications, user menu and context switcher.
6. The domain scenario test keeps the ledger reconciled at every step: receive 10, put away, allocate 4, pick, pack, label, ship 4, return 1, adjust −1, count to 5.

---

# PART B — MODULE PACKAGES (build in parallel after F8)

**Rules that apply to every module**
- A module **must not edit** any of these:
  - `src/server/db/**`, `src/config/**` (nav-config, page-tabs), `src/lib/**` outside its own `src/lib/grid-defs/<dir>/**`;
  - `src/components/{ui,grid,shared,layout}/**`, `src/server/{api,auth,query,domain,print,imports,exports,scheduler,search,files}/**` outside its stub files;
  - `package.json`, `next.config.ts`, `src/middleware.ts`.
- **Requesting a shared change.** If a shared primitive or the schema is missing something, the module records it in a `docs/requests/<module-id>.md` request file, and foundation lands the change in a short serial "F-patch" window. The module never patches shared code itself.
- Every list page uses `DataGrid` plus a `src/lib/grid-defs/<dir>/<grid>.ts` definition (columns, filter fields, sort keys and export columns).
- Every mutation goes through `defineRoute`, with a permission key from the catalog. Every stock change goes through `ledger`, and every status change through `stateMachines`.
- Each module removes its own "Module in progress" placeholders. It also deletes every SYNTH and STATIC path listed for it in `00-kitstaks-current.md`.
- **Required tests per module:**
  - Unit tests for its repositories and validators.
  - At least one e2e happy path per wizard and per bulk action, plus guard-path e2e for every disabled or guarded action.
  - An a11y scan of every page.
  - The dead-click audit filtered to its routes.
  - `db:verify` after the suite.
- **Universal acceptance (A0), which the critic checks on every module:**
  1. No dead control. Every disabled control has a reason tooltip.
  2. Every grid has:
     - search with Equal/Starts With, filters with typed editors, chips, saved views, clear;
     - a column chooser that persists after reload;
     - Large/Small density, the 100/300/500/700/1000 page sizes, the pager and Total/Selected;
     - an async xlsx export that shows up in Export History;
     - URL state that round-trips: copying the URL into a new tab shows the identical view.
  3. Every create/edit form:
     - shows inline error text and focuses the first error;
     - guards unsaved changes;
     - writes a field-level Change Log;
     - raises a 409 conflict on a stale edit, with a Reload prompt.
  4. Loading, empty, error, 403 and 404 states all exist.
  5. Keyboard: Tab order, Enter submits, Esc closes. Focus rings are visible. axe reports no serious or critical issues.
  6. A viewer sees no mutation controls, and a direct API call as a viewer returns 403. A user scoped to MLT1 never sees KS2 data, in the UI or the API.
  7. Visuals: the critic rubric scores ≥ 9 on every dimension with the verdict "wowed", in a blind side-by-side against the matching Logiwa capture.

---

## M01 — `orders-outbound` · Shipment Orders (Backlog, Shipped & Canceled, Create/Edit wizard)

**Owned paths**
- Routes: `src/app/(app)/orders/**`, **excluding** `src/app/(app)/orders/returns/**`.
- UI and grid defs: `src/components/orders/**`, `src/lib/grid-defs/orders/**`.
- Server:
  - `src/server/repositories/orders*.ts` (incl. `orders-export.ts`);
  - `src/app/api/orders/**`;
  - stubs `src/server/imports/handlers/{shipment-orders,shipment-orders-update,so-serials}.ts`, `src/server/search/providers/orders.ts`, `src/server/exports/providers/{orders-backlog,orders-shipped}.ts`.
- Tests: `tests/{unit,e2e}/orders-outbound/**`.

**Spec refs:** 01-orders §0, §1, §2, §3, §4, §10. 08 §Roles → Shipment Orders permissions. 06 §Workflows: blocked-order indicator.

**Checklist**
1. **Backlog `/orders`** (tabs group `orders`)
   - **Columns:** all 58 Logiwa columns are available. The default visible set is: Order Code (link to `/orders/[id]`), Store Order #, Store (channel logo + name, "Created Manually"), Age, Client, Warehouse, Status pill (with a "P" partial pill), Pick/Pack Short, Tags, Total Qty, SKU (slash-joined), Job Code (link to `/jobs/[id]`), Customer "Name / State", Carrier, Service, Tracking, Sales Price "66.03 USD", Order Date, Expected Ship Date, Order Type, Priority.
   - **Filters:** all 67 Logiwa filter fields, including the 10 custom-field slots and the Tag filter.
   - **Header:**
     - Import ▾ → `/imports/shipment-orders`, `/imports/shipment-orders-update` and `/imports/so-serials`.
     - **Create Shipment Order** → `/orders/new`.
   - **Empty state:** the two CTA cards ("No products?…" → `/products`, and "Create shipment orders here" → `/orders/new`).
2. **Bulk Label ▾** (each action is disabled until rows are selected):
   - **Create Label:** shipping-ops labels for eligible orders, then opens the label PDF in a new tab. The result toast shows per-order outcomes.
   - **Reprint Label.** Guard modal: "The orders which you have selected has no label to reprint."
   - **Void Label.** Guard: "You can't void the labels for orders without a tracking number."
   - **Create Return Label.**
   - **Create Retailer Label** and **Reprint Retailer Label**: enabled only when the order has a retailer.
3. **Bulk Warehouse Ops ▾**
   - **Ship Order:** confirm dialog listing the orders, with "N orders will be shipped. Orders will move to Shipped…". Calls the shipping-ops `ship` endpoint.
   - **Create Backorder:** eligibility hero modal, then `orders.createBackorder`, then the create-job modal.
   - **Picking/Job Operations:** `create-job-modal`, with Merge Into Existing Job or Create New Job.
   - **Cancel Picking.** Guard: "only available for orders that have active picking/packing tasks". Cancels the tasks and deallocates.
   - **Change Warehouse:** modal with the warning text and a Warehouse field. Skips orders that already have jobs, and reports them.
   - **Cancel Order:** red modal. The cancel reason (lookup) is required; the modal shows a table of the orders, with Go Back / Cancel Order(s).
   - **Put on Hold / Release Hold** (KitStaks addition).
   - **Resolve Pick Short** and **Resolve Pack Short:** enabled only when the status is Open.
   - **Unmerge Order:** enabled only for merged orders.
4. **Bulk Print ▾**
   - **Picking List** and **Batch Picking List.** Guard: an active pick task is required.
   - **Packing Slip.**
   - **Manifest/BOL.**
   - **Pick/Pack Short Label,** with the Logiwa "Ineligible Order(s)" info modal.
   - All of these go through `print-options-modal`.
5. **Bulk Delete ▾**
   - **Delete Shipment Order:** Open orders with no job only; soft delete; confirm with a table.
   - **Remove Serial Number:** confirm dialog.
6. **Other row and bulk controls**
   - **Tag** popover (shared).
   - **Row ⋯ menu:** Show Details / Edit / Delete. A Delete that is not allowed shows the reason.
   - Refresh.
7. **Shipped & Canceled `/orders/shipped`**
   - Default filter chip: Actual Shipment Date, Last 7 days (removable).
   - Extra columns: Merged SO Code, Merged Order Status, Cancel Reason, Cancel Date.
   - **Header:** Bulk Update Return Info → drawer to set the return carrier, service and tracking for the selection (+ an import link).
   - **Label ▾:** Create Return Label / Void Return Label / Reprint Label.
   - **Create RMA:** navigates to `/orders/returns/new?orderIds=…` (M04).
   - **Print ▾:** Reprint Label / Packing Slip / Manifest-BOL.
8. **Create wizard `/orders/new`** (shared `Wizard` in linear mode, 6 steps)
   - **Layout:**
     - Right rail: progress ring (20% per step), and a Summary of Price, Discount and Total.
     - **Save Order** is enabled only when the order is valid.
     - Top-right **Cancel Order**, behind the unsaved-changes guard.
   - **Step 1, Order Details.** Every field from spec §2, with these specifics:
     - **Order Code** is auto-filled from `sequences.peek`, with an "auto generated" regenerate link. It is checked for uniqueness inline. Max 50, with a counter.
     - **Order Type** comes from the lookup, with an info tip.
     - **Carrier Expected Delivery** is disabled.
     - Note max is 500. Priority uses a stepper.
   - **Step 2, Customer & Address:**
     - Customer: "New" or an existing customer (3-character search). Choosing one prefills the fields and enables the address title select.
     - Contact: names, email, phone.
     - Shipping address:
       - Skip Address Verification (Yes/No toggle);
       - Address Type, with a tooltip;
       - address lines (256), postal code (10), city;
       - Country (247), then State (US: 62 options);
       - company, Tax Type (7), Tax ID.
     - Billing: either "Use Shipment Address As Billing Address" or a new billing address (full block).
     - After **Verify Address** (and on save), the step stepper shows the attention state when the address is unverified.
   - **Step 3, Products:**
     - `product-search-add`, scoped to the client, with live ATP; each add shows a toast.
     - **Create New Product** opens `product-create-drawer` (from M09).
     - KPI chips: # SKU, # Kits, Total Qty. Find by SKU. Export (edit mode).
     - The lines grid carries all of the spec §2 columns.
     - Line ⋯: Show / Edit / Delete.
     - **Edit Product drawer:**
       - Editable: UOM Pack Type, price, qty, Line Notes 1–3, custom fields.
       - Read-only: **Available Pack Qty** (live), and the Allocated/Cancelled/Sorted/Picked/Packed/Shipped quantities.
       - Inventory pinning: Expiry, Production date, Lot, Damage Reason, Location (3+ chars), LP (3+ chars).
   - **Step 4, Shipping:**
     - Carrier → Service (cascading, from the warehouse's carrier connections), or a Rate Shopping Preset.
     - **Get Rates** shows a rate table (service, transit, rate) to pick from. KitStaks addition.
     - Billing types for charges and for duties.
     - Account numbers, each with a "Use Custom Account" toggle.
     - Packing Instructions (1000), Shipment Package, Total Shipping Cost, Current Tracking Number, Reason For Export.
     - Tracking Numbers chip input.
     - Return section (BETA): address, carrier, option, cost, tracking.
   - **Step 5, Other Info:**
     - Extra Note 1–5, Client Reference, Fraud, Packing Warning Type.
     - Gift Yes/No, with a Gift Note.
     - Grouping Ref (read-only).
     - Retailer block: Retailer, BOL, PRO, PO, Dept, Mark For, Customer Account, each with a tooltip.
     - Custom fields section and drawer.
   - **Step 6, Confirm:**
     - Product list.
     - Customer card (shipping and billing).
     - Order Details card, with the warehouse illustration.
     - Shipment card.
   - **On save:**
     - `POST /api/orders` → `orders.createOrder`, which also runs the workflows.
     - Success screen with "Go Back To Shipment Order List", "Create Another Order" and "View Order" (KitStaks addition).
9. **Detail/Edit `/orders/[id]`** (same wizard, free mode)
   - **Field locks:**
     - Warehouse and client are always locked.
     - Line edits lock once picking has started, with a tooltip.
   - **Right rail:**
     - **Save Shipment Order.**
     - **Other Actions ▾:** Ship Order, Delete Order, Cancel Order, Hold/Release, Duplicate Order. Each is gated by `canTransition` and shows its reason when disabled.
     - **Summary:** code, warehouse, type, store order #, status pill, Last Update, **Show Change Log** (drawer), price/discount/total.
     - **Assigned Jobs:** a "+" opens `create-job-modal`; each job links to `/jobs/[id]` and has an "x" to unassign (confirm). Empty copy: "No Job Assigned / Press the + button…".
     - **Billing Charges:** Download (SO billing charges printout).
     - **Printouts:** Shipment Label (Available/Not Available + reprint), Packing Slip, Picking List (only when a job exists), Other Documents (upload/view).
     - **Packages & Tracking** (KitStaks addition): each label with tracking, status, void and reprint.
   - **Below the wizard:**
     - **Activity timeline:** real change log plus ledger events.
     - **Notes panel.**
     - **Workflow-blocked banner,** with the reason and a Release action (if permitted).
10. **APIs**
    - `GET,POST /api/orders` (tabs via `?view=backlog|shipped`).
    - `GET,PATCH,DELETE /api/orders/[id]`.
    - `POST /api/orders/[id]/lines`, `PATCH,DELETE /api/orders/[id]/lines/[lineId]`.
    - `POST /api/orders/[id]/verify-address`.
    - `GET /api/orders/code-check`.
    - `POST /api/orders/bulk/{cancel,hold,release,change-warehouse,delete,backorder,resolve-pick-short,resolve-pack-short,unmerge,cancel-picking,update-return-info,remove-serials}`.
    - Each of these maps to a permission key from the "Shipment Orders" permission group.
11. **Import handlers:** shipment orders (rows grouped by order code, with lines), bulk update (keyed by code, partial columns), and serial numbers.
12. **Search provider:** order code, store order #, tracking number, customer name.
13. **Cleanup:** remove `order-presenter` SYNTH timeline, the `ReadField` displays and the old local tab state.

**Acceptance (critic verifies in browser)**
- **Create (happy path)**
  - The wizard creates `KS-E2E-SO-1` (MLT1, 2 SKUs, a new customer, an unverified address).
  - The Step 2 attention icon shows until **Verify Address** normalizes the address ("Arkansas → AR", line 2 merged).
  - Save lands on the success screen. The order is in the Backlog as **Open**, and its total weight comes from the product master.
  - The Change Log shows the Create entry plus one entry per line, with human-readable labels.
- **Allocate and pick**
  - Picking/Job Operations → Create New Job (Batch 1) sets the order to **Ready to Pick**.
  - The Assigned Jobs card shows the job code. Delete and Cancel become disabled, with their reason tooltips.
  - ATP for those SKUs drops by the allocated quantity.
- **Cancel**
  - Cancel Order is blocked until a reason is chosen.
  - After cancelling, the order is **Cancelled**, sits in the Shipped & Canceled tab with the reason and date, its allocations are released, and ATP is restored.
- **Guards:** Reprint/Void Label on an order without a label shows Logiwa's exact guard copy. Change Warehouse on an order that has a job reports it as skipped.
- **Backorder:** creating a backorder for an order with a short line produces a child order with `masterOrderId`. The shortage line moves to the child.
- **URL state:** filter Status in Open + Client X + Order Date Last 7 days, copy the URL, open it in a new tab: the grid and chips are identical. Export xlsx row count = Total.
- **Imports:** a 50-order template with 2 bad rows reports Partially Successful 48/2. The Details drawer shows the row errors.
- **Concurrency:** editing the same order in two tabs gives the second save a 409 with a Reload prompt.
- **Global search:** typing a tracking number finds the order.

---

## M02 — `shipping` · Carrier Shipment Details, End Of The Day, Shipment History, Shipment Plans

**Owned paths**
- Routes: `src/app/(app)/shipments/**`, `src/app/(app)/shipment-plans/**`.
- UI and grid defs: `src/components/shipping/**`, `src/components/shipment-plans/**`, `src/lib/grid-defs/shipping/**`.
- Server: `src/server/repositories/{shipping,shipment-plans,end-of-day}*.ts`, and `src/app/api/{shipments,shipment-plans,end-of-day}/**`.
- Stubs: `src/server/exports/providers/{shipments,end-of-day,shipment-history,shipment-plans,shipment-plan-orders,shipment-plan-lps}.ts`.
- Tests: `tests/{unit,e2e}/shipping/**`.

**Spec refs:** 01-orders §6, §7, §8, §9. 08 §Roles → Carrier Shipment Details, End Of The Day, Shipment History, Shipment Plan.

**Checklist**
1. **Carrier Shipment Details `/shipments`** (tabs `shipments`)
   - One row per package or label, with all 41 columns.
   - Default chip: Label Create Date, Last 30 days.
   - Label-type pill and Label Status. Multi-package orders show the master tracking number plus a child tracking number per package.
   - Row ⋯: View Order, Download Label, Reprint, Void Label (confirm; guarded when already voided or shipped past the carrier window), and Track (opens the tracking URL pattern).
   - Bulk: Void Labels, Reprint Labels, Export. All 22 filter fields.
2. **End Of The Day `/shipments/end-of-day`**
   - One row per carrier account, ship date and warehouse.
   - Columns: PREFIX, CARRIER, SHIP FROM, SHIP DATE, CLOSE DATE, REPORT PRINTED?, TOTAL PACKAGE, STATUS (Open teal / Closed green).
   - Bulk:
     - **Print End of the Day Report:** confirm, then `shipping.closeEndOfDay`, which sets the close date, Printed=Yes and Closed, and opens the PDF.
     - **Print Custom Report:** the `custom_eod` template.
     - **Reprint.**
   - Manifests are maintained automatically as labels are created and voided.
3. **Shipment History `/shipments/history`**
   - Built from ledger `Shipment` and remove-inventory transactions, one row per SKU × lot × LPN.
   - All 32 columns and 19 filters.
   - Order code links to the order.
4. **Shipment Plans `/shipment-plans`** (tabs `shipment-plans`)
   - **Plan grid:** all 15 columns, with the status pill plus a **status icon popover** that changes the status (allowed transitions only).
   - **Row ⋯:** Edit / Change Log / Delete (Open plans only).
   - **Bulk:**
     - **Delete.**
     - **Ship:** ships every order in the plan through shipping ops, and reports partial results.
     - **Print ▾ Manifest/BOL.**
     - **Picking/Job Operations:** `create-job-modal` for the plan's eligible orders.
   - **Create Shipment Plan drawer:** 3 steps.
     - **1.General:** Code* (auto), Warehouse*, Client, Carrier, Truck Plate, Loading Gate (location picker, area Loading/Shipment), Status*, the 5 datetimes, Expected Volume/Weight (computed from the orders, editable), Prevent LPN Edit, Note.
     - **2.Others:** Customer (3 characters) → Customer Address (dependent), and custom fields.
     - **3.Orders:** grid, Remove/Add. **Add Order(s)** opens `order-picker-drawer`, pre-filtered to the warehouse and to eligible statuses.
   - **Edit:** same drawer with un-numbered tabs.
   - **Plan Orders tab** and **Plan LPs tab:** the spec columns and filters.
   - **Plan detail `/shipment-plans/[id]`** (KitStaks addition): header, an orders table with live statuses, loading progress, and a timeline.
5. **APIs**
   - `/api/shipments` (GET), `/api/shipments/[id]/{void,reprint}`.
   - `/api/end-of-day` (GET), `/api/end-of-day/close`, `/api/end-of-day/print-custom`.
   - `/api/shipment-plans` (CRUD), `/api/shipment-plans/[id]/{orders,status,ship}`, `/api/shipment-plans/orders`, `/api/shipment-plans/lps`.

**Acceptance**
- **Label to manifest:** create a label from M04/M01 for an order. It appears in Carrier Shipment Details within one refresh, and the EOD row for that carrier/day shows Total Package +1.
- **Void:** voiding the label sets Voided status and a void date/time, and the EOD count goes down.
- **Close EOD:** Print End of the Day Report changes the row to Closed, sets the close date, and opens a PDF that lists those packages with tracking barcodes. A label created afterwards opens a new Open manifest.
- **Shipment plan:** create KS-E2E-SP-1 with 2 orders.
  - The status popover only offers legal next statuses.
  - Ship moves both orders to Shipped. The plan becomes Shipped with Actual Shipment Date set, and the Plan Orders tab reflects it.
- **Shipment History** shows one row per shipped lot/LP, and the quantities equal the ledger.

---

## M03 — `fulfillment-jobs` · Jobs, Wave Rules, Wave Log, Allocation Exceptions, Shortage, Task Details, Job Types

**Owned paths**
- Routes: `src/app/(app)/jobs/**`, `src/app/(app)/tasks/**`, `src/app/(app)/settings/job-types/**`.
- UI: `src/components/{jobs,tasks,job-types,wave-rules}/**`, `src/lib/grid-defs/jobs/**`.
- Server:
  - `src/server/repositories/{jobs,tasks,wave-rules,waves,job-types,allocation-exceptions,shortages}*.ts`;
  - `src/app/api/{jobs,tasks,wave-rules,waves,job-types,allocation-exceptions,shortages}/**`.
- Stubs: `src/server/domain/task-handlers/replenishment.ts`, `src/server/scheduler/tasks/wave-rules.ts`, `src/server/search/providers/jobs.ts`, and the export providers for its grids.
- Tests: `tests/{unit,e2e}/fulfillment-jobs/**`.

**Spec refs:** 02-fulfillment-ops §0–§7 and Key business logic. 07 §Shortage, §Wave Log, §Allocation Exceptions. 08 §Job Types, §Roles → Job Management/Task Details/Wave Rules.

**Checklist**
1. **Job Management `/jobs`** (tabs `jobs`)
   - **Grid:** all 32 columns. Default chip: Job Status in Pending, Started. 31 filter fields.
   - **Job Code link** → `/jobs/[id]`. This beats Logiwa, which has no job page.
   - **Bulk actions:**
     - **Update Priority:** attention modal with None/Low/Medium/High cards. Save is disabled until a card is picked.
     - **Cancel:** confirm listing the jobs; releases allocations and sets the orders back to Open.
     - **User Actions ▾ Assign / Unassign:** user search (3 characters). Selections spanning warehouses get the "Different Warehouses Selected" dialog. Unassign is disabled when nothing is assigned.
     - **Label ▾:** Create / Reprint / Void label for the job's orders.
     - **Print ▾:** Job Pick List, Job Content, Pick Short Consolidation (guarded), Mobile Cart Layout (guarded), Packing List.
2. **Job detail `/jobs/[id]`**
   - Header: code, type, status, priority, assignee, wave and rule, planned/actual dates, and a progress bar.
   - **Tabs:**
     - **Orders:** links to the orders, plus "remove from job".
     - **Tasks:** the task grid, with Execute/Update/Cancel.
     - **Pick path:** sequence by walking path.
     - **Timeline.**
   - **Actions:** the same as bulk.
3. **Wave Rules `/jobs/wave-rules`**
   - **Grid:** columns as in the spec. NEXT RUN is a live countdown (HH:MM:SS or DDDD:HH:MM:SS).
   - **Run (bulk):** executes now, then toasts "Wave 20522-95 completed: 35 met · 15 allocated · 3 jobs · 20 shortage" with a View Log link, and sends a notification.
   - **Row ⋯:** Show Details / Edit / Change Log / Delete.
   - **Create wizard (drawer):** Step 0 chooses the operation type from 5 cards.
     - **AI Job:** shows an empty state with a link to Settings → Apps until the "AI Jobs" app is active.
     - **Picking / AI Job steps:**
       - **1.General:** name, warehouse, Priority & Delete Options accordion, job type list. The list stays empty until a warehouse is picked; after that it is a numbered, checkable, **drag-sortable** list. Validation shows red borders plus inline text.
       - **2.Selection:** Add Filter (36 order fields with typed editors) and Order By (ordered list, asc/desc).
       - **3.Schedule:** day chips; Set Time popover with Specific Time or Time Period ("Repeat every n From/To", which generates the times); NO/START TIME grid with Remove; a "N Daily Frequency" counter. Next is blocked when a day is selected but no time is set.
       - **4.Assign:** radio cards for Pool / Roles (roles grid with toggles) / Users (users grid with toggles).
     - **Cycle Count:** Count Type Location/SKU and Lock Locations. Running it calls `counts-commands.createCountPlanFromWave` (M07).
     - **Replenishment:** Soft Allocation. Running it creates replenishment jobs from `putaway.dynamicReplenishmentTargets`.
     - **Order Merge:** ordered merge rules (lookup `order_merge_rule`) and no Assign step. Running it merges eligible orders with the same client, customer and address (`isMerged`, `mergedIntoOrderId`) and records the merged count.
   - **Wave execution** (`src/server/repositories/waves-run.ts`):
     1. Creates the wave `<ruleSeq>-<runCount>` and moves its status Pending → Started → Completed or Failed.
     2. Selects orders by the filters and sorts them by the order-by.
     3. Matches job types in precedence order. Unmatched orders get "Eliminated by …" exceptions.
     4. Runs `allocation.allocateOrders`, then `jobs.createJobsFromOrders`, applying the priority and assignment.
     5. Writes the wave log counts. The invariant met = allocated + shortage must hold.
   - **Scheduler:** fires rules in the warehouse timezone (`runBy = "Integration"`) and applies Delete-if-not-started.
4. **Allocation Exceptions `/jobs/allocation-exceptions`:** all columns, header tooltips and filters. Order code links to the order. KitStaks addition: bulk **Retry Allocation**.
5. **Wave Log `/jobs/wave-log`:** all columns, a status pill, and the 8 statuses. Wave No links to the jobs filtered by wave.
6. **Shortage Report `/jobs/shortage`:**
   - 25 columns. The shortage reason is in red, with Logiwa's tooltip text.
   - Order and SKU are links.
   - KitStaks additions: bulk **Retry Allocation** and **Create Backorder**.
7. **Task Details `/tasks/*`** (tabs `tasks`; default chip Job Status in Pending, Started)
   - **Order Operations:**
     - 67 columns and 49 filters.
     - **Task Operations ▾ Execute:** modal with Target Location*, Target LPN, and Quantity (KitStaks: partial execute triggers pick-short handling).
     - **Update:** Target Location, To LPN, Job Code move.
     - **Cancel:** confirm.
     - **User Actions ▾** Assign/Unassign.
   - **Count:** 48 columns, read-only. Rows link to `/counts/[id]`.
   - **Replenishment:** 50 columns, plus **Cancel Task**.
8. **Job Types `/settings/job-types`**
   - **Grid:** CODE link, DESCRIPTION, WAREHOUSE, ALLOCATION ALGORITHM, OPERATION TYPE.
   - **Row ⋯:** Show Details / Edit / Change Log / Delete. Delete is guarded while wave rules or open jobs reference the type.
   - **Create:** Step 0 chooses from 4 operation-type cards.
     - **Picking** (5 steps):
       - **General:** allocation algorithm select, filtered by warehouse.
       - **Templates:** 9 radio cards with NEW/BETA badges; choosing one presets the Settings.
       - **Settings:** order-scope cards, the 10 Yes/No flags with tooltips and dependency disabling, Batch Size (Nof Order/Nof Item, min/max), and mobile screens (Use/Don't Use, mutually exclusive).
       - **Conditions:** filters plus Order by Picking Method (draggable rows with Asc/Desc). The default row is Walking Path.
       - **Grouping:** Location Zone, Product Group, Carrier, Area Type, Client, Order Tag.
       - The Templates step is absent in edit mode.
     - **Count** (4 steps): 5 flags with tooltips, Location conditions and SKU conditions, plus the exclusivity banner.
     - **Replenishment** (3 steps): FEFO/FIFO, the flags, Flow (Pick & Put / Direct Put), Type (Dynamic/Static), and the four condition sections.
     - **Work Order** (3 steps).
9. **Replenishment task handler:**
   - Pick phase: source → cart/LP. Put phase: → target pick face.
   - Supports LP swap and pack-type conversion. Writes ledger `Replenishment`.

**Acceptance**
- **Wave run**
  - Seed MLT1 with 10 Open orders (6 single-unit, 4 multi). Create the rule "KS-E2E Picking" with job types [Single Unit Orders, Multi Item Orders] and a filter of Order Quantity 1–10, then Run.
  - The Wave Log row shows met = allocated + shortage, and the jobs are created per type.
  - Allocation Exceptions lists any eliminated orders with Logiwa's explanation strings.
  - The orders are Ready to Pick, and ATP decreases.
- **Scheduler:** scheduling the rule for today at now + 2 min makes the countdown tick down, and it then runs automatically with Run By "Integration".
- **Bulk guards:** Update Priority → High shows a red High pill on every selected job. Assigning across MLT1 and KS2 shows the different-warehouses dialog.
- **Task execution**
  - Executing every pick task of an order from Task Details moves the order through Picking Started to Ready to Pack.
  - Ledger Picking rows appear in Transaction History.
  - A partial execute creates a missing-log row and sets Pick Short Status to Open.
- **Job types:** creating a Picking job type from the "Single Item Order" template pre-sets the order scope. Deleting a job type in use is blocked with a reason.
- **Navigation:** every tab in the jobs group deep-links correctly, including the nav links Wave Rules, Shortage, Wave Log and Allocation Exceptions.

---

## M04 — `stations-returns` · Packing Station, Return Station, Return Orders & RMA

**Owned paths**
- Routes: `src/app/(app)/packing-station/**`, `src/app/(app)/return-station/**`, `src/app/(app)/orders/returns/**`.
- UI: `src/components/{packing,returns}/**`, `src/lib/grid-defs/returns/**`.
- Server: `src/server/repositories/{packing,returns}*.ts`, `src/app/api/{packing,returns}/**`, and the export providers `return-orders`.
- Tests: `tests/{unit,e2e}/stations-returns/**`.

**Spec refs:** 02 §9 Packing Station, §10 Return Station. 01 §5 Return Orders. 08 §Roles → Packing Station, Return Station, Return Orders.

**Checklist**
1. **Packing Station dashboard `/packing-station`** (3-column layout)
   - **Left:** Warehouse*, and Packing Station* (locations in the Packing area of that warehouse). The choice is remembered per user.
   - **Center:** "Start Packing", with 4 buttons: Scan a Tote, Scan a Location, Scan a Putwall/Mobile Cart, List and Select Order.
   - **Right:** user card plus real KPIs: orders packed today, products packed today, and total orders to be packed.
2. **Pack screen `/packing-station/[stationId]/[mode]`**
   - **Left pane:**
     - Mode tabs: Tote / Location / Order / Putwall.
     - Scan input, using keyboard-wedge detection and auto-submit. The Order mode adds a clear button and **List & Select** (modal with filters → Start Packing).
     - Job card: job type, "# of Orders in Tote x/y".
     - Product scan input.
     - Order card: SKU qty x/y, total qty x/y.
   - **Right pane:**
     - Package Type* (auto-fills L/W/H).
     - Package contents grid. Scanning increments the quantity and shows the label column. A wrong item gives a red flash and an error toast plus a sound; over-pack is blocked.
     - Serial capture when tracked, and lot/expiry capture when the scan method is During Packing.
     - Weight in lb/oz, the add-package button (multi-box), and **Close Pack**.
     - Carrier*/Service* (cascading), **Get Rate** (shows the selected option and rate), and pre-generated label upload.
   - **Footer:**
     - **Other Actions ▴:**
       - **Report Issue:** moves the products to the hospital location and sets Pack Short Open.
       - **Print Actions:** lists the documents.
       - **Pack Without Label.**
     - **Complete Packing And Create Label:**
       1. Completes the packing tasks (ledger Packing).
       2. Creates the label(s).
       3. Prints the label and packing slip through the user's printer setup.
       4. Sets the order to Ready to Ship, or to Shipped when the client's auto-ship setting is on.
       5. Consumes packaging material when the package tracks inventory.
   - **Errors** match Logiwa. Example: scanning an order that has not been picked → "No allocated order found…".
   - **Fully keyboard-operable:** Enter submits a scan, F2 closes the pack, F9 completes.
3. **Return Station `/return-station`**
   - Receiving Warehouse.
   - Return Station: location picker (Returns area), with a scan icon.
   - Return Target: Location or LP.
   - **Return With RMA** and **Return Manually** stay disabled until a station is chosen. The tooltip says why.
   - KPI tiles.
4. **Return With RMA flow**
   - Scan or enter the RMA, order code, or tracking number to load the RMA lines.
   - For each item:
     - scan it and set the quantity;
     - set the condition/disposition: Restock (to the target location/LP), Damaged (with a damage reason), Quarantine, or Dispose;
     - set the actual return reason;
     - optionally upload a photo.
   - **Complete:**
     - writes receipts of type `Return` and ledger Return Receiving;
     - updates the line and RMA status (Started or Completed);
     - notifies the client users.
5. **Return Manually:** pick the client and an optional order, then add products and follow the same capture steps. Completing creates a Manual RMA.
6. **Return Orders `/orders/returns`** (tabs `orders`)
   - One row per RMA line. All 25 columns and 23 filters, with the 5 status pills.
   - **Change Status:** bulk modal offering only the allowed transitions.
   - Tag (scope `return_order`), Export.
   - The row links to `/orders/returns/[id]`.
7. **Create RMA `/orders/returns/new?orderIds=`** (designed by KitStaks; Logiwa's could not be captured)
   - Pick the shipped lines and quantities. Quantity is capped at shipped − already returned.
   - Customer return reason per line.
   - Return carrier/service, plus **Create Return Label** (shipping ops `return-label`), and the expected return date.
   - Save → RMA (Pending), with its label, then the success screen.
8. **RMA detail `/orders/returns/[id]`:** header, lines with requested/returned quantities, receipts, label/tracking, timeline, and actions (Change Status, Cancel, Reprint Return Label).

**Acceptance**
- **Pack an order (scanner only)**
  - With a Ready to Pack order whose pick is complete, choose station PACK-01 and Scan Location, then the order. Scanning the items: a wrong SKU is rejected with a beep and a red toast.
  - Choosing a package auto-fills its dims. Get Rate shows a sandbox rate.
  - Complete opens the label PDF. The order becomes Ready to Ship, and the shipment appears in `/shipments`.
  - All of it is done with the keyboard only.
- **Multi-box:** 2 packages produce a master tracking number plus 2 child tracking numbers.
- **Report Issue:** moves the stock to the hospital location and sets Pack Short Status to Open on the order.
- **Return with RMA**
  - Create an RMA for a shipped order (1 of 2 units), with a return label. The RMA appears in Return Orders as Pending.
  - At the Return Station, receive 1 unit as Restock into MLT1-RTN. The RMA becomes Completed, a Return receipt shows in Receiving History, and ledger Return Receiving shows in Transaction History.
  - Inventory by Location shows +1 at MLT1-RTN.
- **Change Status** offers only legal transitions. A Cancelled RMA cannot be received.

---

## M05 — `inbound-receiving` · Purchase Orders, Receiving, Receiving History, Vendors

**Owned paths**
- Routes: `src/app/(app)/receiving/**`, `src/app/(app)/organization/vendors/**`.
- UI: `src/components/{receiving,vendors}/**` (including the `vendor-drawer.tsx` stub), `src/lib/grid-defs/receiving/**`.
- Server: `src/server/repositories/{purchase-orders,receipts,vendors}*.ts`, `src/app/api/{purchase-orders,receipts,vendors}/**`.
- Stubs: `src/server/imports/handlers/{purchase-orders,po-serials}.ts`, `src/server/search/providers/pos.ts`, and the export providers.
- Tests: `tests/{unit,e2e}/inbound-receiving/**`.

**Spec refs:** 03-inbound (all). 05 §6 Vendors. 08 §Roles → Purchase Orders, Receiving History, Vendors. 08 §Screen Configuration: read `screen_configs` for receiving step requirements.

**Checklist**
1. **PO list `/receiving`** (tabs `receiving`)
   - **Grid:** 16 columns and 19 filters.
   - **Header:** Import ▾ (Purchase Orders `/imports/purchase-orders`, Serial Numbers `/imports/po-serials`) and **Create Purchase Order**.
   - **Bulk actions:**
     - **Tag:** with Create Tag modal.
     - **Label ▾:** Product Label (product labels for the PO lines, qty = ordered) and Purchase Order (the PO document).
     - **Cancel Order:** confirm with a table; Pending/Started only.
     - **Receive PO:** full receive into the warehouse's default receiving location.
       - KitStaks adds a one-step confirm naming the target location.
       - Toast: "You have successfully received orders."
     - **Delete ▾:**
       - Delete Purchase Order: allowed only when Pending with no receipts.
       - Remove Serial Number.
   - **Row ⋯:** Show Details / Edit / Delete.
2. **Create wizard `/receiving/new`** (linear mode, 5 steps)
   - **Right rail:** "PO Status" ring (%0–%100), a live Price Total, and **Confirm Purchase Order** (enabled at step 5).
   - **Step 1 — PO Details:** all spec fields.
     - PO number is checked for uniqueness **inline**, which beats Logiwa's check at Confirm. The Logiwa duplicate banner is still kept at Confirm.
   - **Step 2 — Products:**
     - Product search (3+ characters, client-scoped) with a qty stepper and a + button that opens the **Edit Product drawer**.
     - The drawer has Pack Type, Quantity*, Price Per Pack Type*, a read-only total, and the Receiving Details section.
     - In the Receiving Details section, Lot/Expiry/Production are enabled only for tracked products.
     - Create New Product opens M09's drawer.
     - The lines grid shows all 17 columns, with # SKU and Total Qty chips, Find by SKU, and Label.
     - Empty state; Next stays disabled while there are no lines.
   - **Step 3 — Vendor:**
     - Vendor grid scoped to the client, with search and filter.
     - **Add New Vendor:** `vendor-drawer` with the client prefilled.
     - Each row has an edit pencil. Exactly one vendor must be selected.
   - **Step 4 — Other Info:** custom fields.
   - **Step 5 — Confirm:** lines summary, the Vendor card (shipping and billing addresses) and the Order Details card.
   - **Success screen:** 3 cards (List / Create Another / Receiving History).
3. **PO detail `/receiving/[id]`**
   - Opens on the Confirm view; the steps are clickable; Client is locked.
   - **Right rail:**
     - **Save Purchase Order.**
     - **Other Actions ▾:** Receive PO / Delete Order / Cancel Order, each gated by the state machine.
     - **Summary card:** status pill, plus a **pencil** for a manual status change (allowed transitions only, with a reason), Show Change Log, and Total.
     - **Billing Charges:** Download, which prints the PO billing charges.
     - **Printouts:** documents (+ upload modal with Document Type, eye to view).
4. **Receive Items wizard** (drawer from the detail page; KitStaks addition, since Logiwa has no web partial receive)
   - **Per line:** qty to receive (defaults to the remaining qty), receiving location (default receiving location; with a **putaway suggestion** from `putaway.suggestLocations` that shows its reason), LP (scan an existing one or **create new** from an LP type, auto-numbered), lot, expiry and production date (required according to the product's tracking flags and the screen config), damage reason plus a photo, serials (count must equal qty), and a note.
   - **Over-receipt:** allowed only after an explicit confirm, and shown as a positive difference.
   - **Submit:**
     - Receipts are created through `ledger.recordReceipt`.
     - Line received quantities and the PO status are updated (Started or Completed; Completed stamps Actual Receiving and Completed).
     - The Change Log shows the line entries.
5. **Receiving History `/receiving/history`**
   - **Grid:** 34 columns and 25 filters.
   - **Master Id** opens a receipt detail drawer (KitStaks addition).
   - **Row ⋯ Cancel:**
     - Confirm: "Are you sure you want to cancel the receiving? / This action cannot be undone."
     - Reverses the receipt through the ledger.
     - Blocked with Logiwa's error toast when the PO is Completed.
6. **Vendors `/receiving/vendors` and `/organization/vendors`**
   - The same component in both places; each uses its own tab group.
   - **Grid:** Display Name (link opens the drawer), Vendor Name, Client, plus Active.
   - **Filters:** Client, Company Name, Company Nickname.
   - **Row ⋯:** Edit / Change Log / Deactivate. Deactivate is blocked while the vendor has open POs.
   - **Vendor drawer:**
     - Client* (locked on edit), Display name* (100), Vendor name* (255).
     - "Use shipment address as billing" toggle.
     - Shipment address; a Billing address appears when the toggle is off.
     - Inline errors: "Vendor display name is required."
7. **Import handler:** purchase orders with vendors. Creates vendors when they are missing.

**Acceptance**
- **Create:** the wizard creates KS-E2E-PO-1 (2 lines, new vendor via the drawer) and lands on the success screen. The PO is Pending in the list, with Purchase Price equal to Σ qty×price. A duplicate PO number is flagged inline on step 1.
- **Partial receive**
  - Receive 6 of 10 (line 1) into the suggested location, with lot L123 and expiry +180 d.
  - The PO becomes **Started**.
  - Receiving History gets 1 row of type Purchase Order.
  - Inventory by Location shows 6 units at that location with lot L123.
  - Transaction History shows a Receiving transaction.
  - The PO Receiving Report shows −4 as a red pill.
- **Cancel receipt:** cancelling that receipt reverses the inventory. After a full receive (Completed), Cancel shows "A received line of an order in completed status can't be cancelled."
- **Bulk Receive PO:** on 2 Pending POs, both become Completed. Receipts land at MLT1-RECV.
- **Tracking guard:** a lot-tracked product cannot be received without a lot. The inline error says so.
- **Vendor scoping:** the vendor list of client A never shows client B's vendors in the PO wizard.

---

## M06 — `inventory` · Total Inventory, Inventory by Location, ATP, inventory operations

**Owned paths**
- Routes: `src/app/(app)/inventory/**`, **excluding** `inventory/kits/**` and `inventory/kit-components/**`.
- UI: `src/components/inventory/**`, `src/lib/grid-defs/inventory/**`.
- Server: `src/server/repositories/inventory*.ts`, `src/app/api/inventory/**`.
- Stubs: `src/server/imports/handlers/inventory.ts`, plus the export providers.
- Tests: `tests/{unit,e2e}/inventory/**`.

**Spec refs:** 04-inventory §0–§3. 07 §ATP. 08 §Roles → Inventory by Location.

**Checklist**
1. **Total Inventory `/inventory`** (tabs `inventory`)
   - One row per SKU × warehouse. The "All Warehouses" aggregate shows when no warehouse filter or context is set.
   - 16 columns and 13 filters.
   - **SKU** hyperlink opens `/products?f.sku=eq:<sku>&f.client=in:<id>` in a new tab. **Open SO Qty** opens `/orders?f.sku=…&f.warehouse=…` in a new tab.
   - Read-only, with export.
2. **Inventory by Location `/inventory/by-location`**
   - One row per bucket. 39 columns and 25 filters.
   - The status values are Stock/Allocated/Picked/Sorted/Packed/Loaded, plus the damage reasons.
   - **Header:**
     - **Transfer LP/Loc ▾:**
       - **Transfer LP** drawer: warehouse, LP (server search) + Find, then a summary card, then Move to Location/LP.
       - **Transfer Location** drawer: Find, then a summary card (Pack Qty, SKU Multi, SKU Qty…), then Move to LP/Location.
     - **Import** → `/imports/inventory`.
     - **Add Inventory** drawer: cascading Warehouse → Location (3+) / LP → Client → Product → Pack Type, plus Adjustment Reason, Damage Reason, Quantity to Add, Note (0/400). Lot, expiry and production date appear when the product is tracked (KitStaks addition).
   - **Row ⋯ (Stock rows only):**
     - **Add** / **Adjust** (absolute New Quantity) / **Remove.**
     - Reason is mandatory per the warehouse setting.
     - Save is disabled until the form is valid.
   - **Bulk:**
     - **Transfer Product:** partial qty plus Move to.
     - **Change Attributes ▾** (Lot/Batch, Expiry, Production Date, Damage Reason): each opens a single-field drawer with the spec's Attention text. Changing the damage reason moves the qty between Undamaged and Damaged.
   - **Bucket drawer** (row click; KitStaks addition): attributes, allocations (with links to orders and jobs), and the last 50 ledger transactions.
3. **ATP `/inventory/atp`**
   - 18 columns, with Logiwa's formula header tooltips.
   - Defaults to the context warehouse rather than an empty grid (KitStaks addition).
   - Hyperlinks open SKU and Open SO in a new tab.
4. **Import Inventory handler:** location, LP, client, SKU, pack type, qty, lot, expiry, damage. Posts ledger `Inventory Adjustment` with reason "Import".
5. **All operations** go through `ledger.*`. Rule violations surface as inline errors that name the rule, e.g. "MLT1-A-01 allows only 1 SKU (holds MLT-WIDGET-02)".

**Acceptance**
- **Adjust:** Adjust MLT-WIDGET-01 @ MLT1-A-01 from 20 to 18 with reason "Inventory quantity discrepancy".
  - The row shows 18.
  - Transaction History shows Inventory Adjustment −2, with the reason and user.
  - Total Inventory and ATP drop by 2.
  - `db:verify` passes.
- **Transfer:** Transfer Product 5 to MLT1-B-01 shows Inventory Movement, and both buckets are correct. Transfer Location moves the whole location and lists each SKU moved.
- **Rule guard:** a transfer into an Only-1-SKU location that holds another SKU is blocked with the rule message.
- **Damage:** Change Damage Reason → Damaged on 3 units moves them out of Undamaged in Total Inventory and out of Current ATP.
- **Allocated rows:** these have no ⋯ menu, and the tooltip explains why.
- **Hyperlinks:** Open SO opens Orders pre-filtered to exactly those orders.

---

## M07 — `counts` · Count Plans, Location Details, SKU Details, count execution

**Owned paths**
- Routes: `src/app/(app)/counts/**`.
- UI: `src/components/counts/**`, `src/lib/grid-defs/counts/**`.
- Server:
  - `src/server/repositories/counts*.ts`, including the `counts-commands.ts` stub;
  - `src/app/api/counts/**`.
- Stubs: `src/server/domain/task-handlers/count.ts`, `src/server/imports/handlers/{count-location,count-sku}.ts`, and the export providers.
- Tests: `tests/{unit,e2e}/counts/**`.

**Spec refs:** 04 §6–§9. 02 §7b (count task columns, read in M03). 08 §Job Types → Count settings (Auto-Update No-Difference, Lock Location). 08 §Roles → Count Plans/Location/SKU Details.

**Checklist**
1. **Count Plan `/counts`** (tabs `counts`)
   - **Grid:** spec columns, with status pills for the 6 plan statuses.
   - **Header:**
     - **Import ▾:** Location Count Plan, SKU Count Plan.
     - **Create New Count.**
   - **Bulk:**
     - **Cancel:** confirm; unlocks the locations.
     - **Update Inv.:** confirm with a variance summary table; posts the approved variances.
     - **Create Job:** `create-job-modal` with operation=count (Job Type from the warehouse's Count job types, **Batch Size (Location)**, Assign to). The plan moves to Ready To Count.
   - **Row ⋯:** Show Details (read-only once started), Edit (Pending only), Delete.
2. **Create New Count wizard** (drawer)
   - **1.General:**
     - Name* (0/50, auto-suggested CNT code), Warehouse*, Description.
     - Scheduled Count Date* (now), Lock Locations Yes/No.
   - **2.Tasks:**
     - Location Count or SKU Count. Switching mode asks for confirmation when lines exist (KitStaks addition).
     - Remove / Add.
     - **Add Location** modal: full filter list; grid of Location, Loc Type and Loc Group.
     - **Add Product** modal: search plus filters.
     - Save is disabled while the plan is empty.
3. **Count detail `/counts/[id]`** (KitStaks addition)
   - Header, a lines grid (system qty, counted, variance %, status, recount flags), and jobs.
   - **Count Sheet:** web entry. Scan a location, then enter the counted qty per SKU/lot. This executes the count tasks through `tasks.execute`.
   - **Approve variances.**
   - Timeline.
4. **Location Details `/counts/locations`**
   - Columns per spec; % Difference is colored.
   - **More Details:** async detailed export.
   - **Bulk:** Cancel, Update Inv., **Create Recount**. A recount creates a new line (Recount Line = Yes) in a new job and marks the original line "Recount Created".
5. **SKU Details `/counts/skus`:** the same pattern, plus a row Delete for the SKU line.
6. **Count task handler**
   - Records `count_line_entries`.
   - When "Auto-Update No-Difference" is set on the job type, lines with no variance auto-complete.
   - With **Lock Locations**, the ledger rejects moves in or out of locked locations for the life of the count. The error names the count plan.
7. **Update Inv.**
   - Posts ledger `Count` transactions (signed delta per bucket, with the count plan code).
   - Requires a reason when the warehouse's Mandatory Reason for Cycle Count is on.
   - Sets the line and plan to Inventory Updated, with user and time.
8. **Quick Count / Instant Count** (header secondary button)
   - Scan a location, enter counts, then submit.
   - Creates an `IC<timestamp>` Instant plan, auto-updated per the job-type settings.
9. **`counts-commands.createCountPlanFromWave`:** used by Cycle Count wave rules (M03).

**Acceptance**
- **Full cycle:** create KS-E2E-COUNT-1 (SKU mode, 1 SKU across 2 locations, Lock Locations Yes). It is Pending.
  - Create Job moves it to Ready To Count.
  - While the count is open, a transfer out of a locked location is blocked with a message.
  - On the count sheet, enter 18 vs a system 20; % Difference shows −10.00.
  - Create Recount makes a new Ready To Count line with Recount Line = Yes; the original line shows Recount Created.
  - Count 18 again and Update Inv.: inventory becomes 18, Transaction History shows Count −2 with the plan code, and the plan is Inventory Updated.
- **Cancel:** cancelling a Pending plan unlocks its locations.
- **Instant count:** an IC plan with no variance auto-updates and leaves no open line.

---

## M08 — `work-orders-kitting` · Work Orders, Kit Inventory, Kit Component Availability

**Owned paths**
- Routes: `src/app/(app)/work-orders/**`, `src/app/(app)/inventory/kits/**`, `src/app/(app)/inventory/kit-components/**`
- Components: `src/components/{work-orders,kits}/**`, `src/lib/grid-defs/work-orders/**`
- Server: `src/server/repositories/{work-orders,kits}*.ts`, including the stub `work-orders-commands.ts`
- APIs: `src/app/api/{work-orders,kits}/**`
- Stubs: `src/server/domain/task-handlers/kitting.ts`, `src/server/scheduler/tasks/kit-inventory-recalc.ts`, `src/server/imports/handlers/work-orders.ts`, and the export providers
- Tests: `tests/{unit,e2e}/work-orders-kitting/**`

**Spec refs:** 02 §8 Work Orders; 04 §4–§5; 07 §Kit Inventory (+ Create Work Order wizard), §Kit Component Availability; 08 §Roles → Work Orders.

**Checklist**
1. **Work Orders list (`/work-orders`)**
   - Grid: 20 columns, 22 filters, 5 status pills.
   - Header: Import (`/imports/work-orders`) and **Create Work Order**.
   - Row ⋯: Show Details / Edit / Change Log / Delete (Open only).
2. **Bulk actions**
   - **Create Kit:**
     - Modal asks for the qty to build (≤ requested − processed) and the output location/LP, lot and expiry.
     - Components are consumed through ledger `Kitting` (from their allocated or chosen locations).
     - The kit output is received as a `Kitting` receipt.
     - Processed qty and status (In Process / Completed) update, and actual dates are stamped.
   - **Disassemble Kit:**
     - Modal asks for the kit qty and source location, and the component target location.
     - Posts ledger `Disassemble Kit` and creates `DisassembleKit` receipts for the components.
   - **Warehouse Ops ▾:**
     - Print Picking List and Batch Picking List (work-order templates).
     - **Picking/Job Operations** opens `create-job-modal` with `operation=work-order` and the job type Work Order Picking. It allocates the components through `work-orders-commands.allocateWorkOrder`, which reports **Shortage** when components are short.
     - **Cancel Picking.**
3. **Create/Edit wizard (drawer)**
   - Step 0: the Kitting card.
   - **1.General:** Warehouse*, Client* (filtered by warehouse), WO Code* (auto), Type*, Extra Note, and Build For **Stock / SO**. Choosing SO adds an order picker.
   - **2.Kit:**
     - Kit picker (kit-to-stock only) showing a card with SKU, name, pack type, and the lot/expiry/production tracking flags.
     - Kit qty field.
     - Components list: component qty × kit qty = total. A pencil on each component edits its source location/LP/lot/expiry/production date, which is required for "without picking".
   - **3.Advanced:** Kitting Instructions, the 4 dates, and document upload.
   - **4.Other Info:** custom fields.
   - The unsaved-changes guard uses Logiwa's exact copy.
4. **Work order detail (`/work-orders/[id]`)** (beyond Logiwa)
   - Header with progress.
   - Component availability table with live free qty.
   - Linked job, receipts and timeline.
5. **Kit Inventory (`/inventory/kits`, tabs `inventory`)**
   - Columns per spec, filled from `kit_inventory_stats` (scheduler every 15 min, plus a Recalculate Now button).
   - "Last Updated" timestamp.
   - **Create Work Order** is enabled by selection and opens the wizard prefilled.
   - Formulas:
     - Net Kitting Capacity = min over components of ⌊free component qty ÷ BOM qty⌋
     - Required Kitting Qty = max(0, pending order qty − current kit stock)
6. **Kit Component Inventory Availability (`/inventory/kit-components`)**
   - Columns per spec, with Included Kits as a tooltip list.
   - Reorder Qty = max(0, total order qty − total available).
7. **Kitting task handler:** for "with picking" orders, it completes picking to the kitting area before Create Kit.

**Acceptance**
- **Create and allocate**
  - Create MLT-WO-E2E (Kit to Stock MLT-KIT-2PK × 5, without picking, with component sources set). The WO is Open.
  - Picking/Job Ops on a "with picking" variant allocates the components. When short, the status becomes **Shortage** with an allocation exception of "Manual Allocation - Work Order".
- **Build:** Create Kit 5 makes the components drop by 10 (2 × 5) and the kit SKU rise by 5 at the output location. Transaction History shows Kitting rows, and Receiving History shows a Kitting receipt. The status is Completed.
- **Disassemble:** Disassemble 2 reverses the stock and creates a DisassembleKit receipt.
- **Kit Inventory:** Net Kitting Capacity matches the hand calculation from free stock. Create Work Order from a selected row opens the wizard prefilled.

---

## M09 — `catalog` · Products (3 wizards, pack types, advanced), Product detail, Product Listings

**Owned paths**
- Routes: `src/app/(app)/products/**`
- Components: `src/components/products/**`, including the stub `product-create-drawer.tsx`, and `src/lib/grid-defs/products/**`
- Server: `src/server/repositories/{products,listings}*.ts`
- APIs: `src/app/api/{products,listings}/**`
- Stubs:
  - `src/server/imports/handlers/{products,products-update,pack-types,replenishment-levels,sku-allocation,kit-components,listings}.ts`
  - `src/server/search/providers/products.ts`
  - the export providers
- Tests: `tests/{unit,e2e}/catalog/**`

**Spec refs:** 05 §0, §1, §2, §11; 07 (custom-field framework); 08 §Roles → Products / Product Listing.

**Checklist**
1. **Products list (`/products`, tabs `products`)**
   - Grid: 29 columns, 27 filters.
   - Header: **Bulk Import/Update ▾** (with info tip) and **Create New Product**. The menu has two sections:
     - Import: Products, Pack Types & Barcodes, Warehouse Replenishment Levels, SKU Based Inventory Allocation.
     - Update: Products, Kit-Components.
   - Bulk actions:
     - **Delete:** confirm with the Logiwa mini-table. Products that still have inventory or open orders are blocked, and the dialog offers Deactivate instead.
     - **Label:** print options for the product label.
   - Row ⋯: Show Details (→ `/products/[id]`), Edit (drawer), Change Log, Duplicate (beyond Logiwa), Delete.
2. **Product Category chooser:** 3 cards, implemented as `product-create-drawer.tsx`. It also accepts `defaultClientId` and an `onCreated` callback, so M01 and M05 can embed it.
3. **Wizard A, Product (5 steps)**
   - **General:**
     - Client*, SKU* (100; unique per client, checked inline), Name* (200), Description (500), Image URL with preview.
     - Product Type and Group (client-scoped lookups, with inline "+ Create").
     - Currency (18), Purchase/Sales price, Tax %, Min safety stock, FNSKU, Active, Digital.
   - **Packing:** instructions plus 8 flags.
   - **Pack Type:** segmented tabs (UoM / Irregulars (n) / Hierarchicals (n)).
     - The primary modal has every field. The barcode chip input warns when a barcode is already used.
     - The hierarchical modal derives UOM qty from Child Qty.
     - The irregular modal is also provided.
     - Edit and delete per pack type.
     - Volume auto-computes from L×W×H and can be overridden (beyond Logiwa).
   - **Advanced:** accordion with 8 sections, every enum from spec 05:
     - customs
     - expiry
     - hazmat (fields disabled until the switch is on)
     - channel allocation (modal + grid)
     - lot
     - production date
     - replenishment (Global or Per Warehouse, with a modal + grid)
     - serial
   - **Other Info:** custom fields, then Save. The toast reads "Product created successfully."
4. **Wizard B, Kit (5 steps)**
   - Kit Type: Kit to Order or Kit to Stock.
   - Components: client-scoped search (kit-to-stock), qty, remove. **At least 1 component is required**, which goes beyond Logiwa.
   - Packing dims live on the kit.
   - Advanced is limited to the 3 sections.
5. **Wizard C, Packaging Material (3 steps):** no Liquid flag, and the PACKAGING MATERIAL flag is shown in the grid.
6. **Edit:** the same wizard in free mode, with Client locked.
7. **Product detail (`/products/[id]`)** (replaces the SYNTH reserve slots)
   - Identity header and pack types/barcodes (rendered barcodes).
   - Inventory by location (real buckets) and ATP per warehouse (`atp.ts`).
   - Open orders and open POs (links), and listings.
   - Kit components, or "Used in kits".
   - Replenishment levels, transactions (ledger), and the change log.
   - Actions: Edit, Print Labels, Duplicate, Deactivate/Activate.
8. **Product Listings (`/products/listings`)**
   - **Unlinked / Linked** segmented toggle.
   - Columns per spec, 10 filters, Tag, and Import (`/imports/listings`).
   - Row actions:
     - **Link to product** (SKU search) and **Unlink**
     - **Never Sync** toggle
     - **Create product from listing** (beyond Logiwa)
   - Synthesized listings are removed; the data comes from `product_listings`.

**Acceptance**
- **Create a product:** KS-E2E-PROD-1 with Unit primary (10×8×6 in, 2 lb, 2 barcodes), Case hierarchical (child qty 12 → UOM 12), lot tracking and expiry tracking (yyyy-MM-dd, During Picking). It appears first in the grid. The detail page shows both pack types with their barcodes rendered. The change log shows Create.
- **Create a kit:** Kit to Stock with 2 components; Save is blocked with 0 components (inline message). The product detail of each component shows "Used in kits".
- **Validation:** a duplicate SKU for the same client is flagged inline. The same SKU under a different client is allowed.
- **Delete guard:** deleting a product with inventory is blocked with a reason and offers Deactivate.
- **Listings:** linking an unlinked listing moves it to the Linked tab and clears its Listing Exception in M12 monitoring.
- **Imports:** a Pack Types & Barcodes import adds a Case pack type to 5 products, with history.

---

## M10 — `facility-config` · Locations, Warehouses, Mobile Carts, LP Types, LP Numbers, Shipment Packages

**Owned paths**
- Routes: `src/app/(app)/locations/**` and `src/app/(app)/settings/{warehouses,mobile-carts,lp-types,lp-numbers,shipment-packages}/**`
- Components: `src/components/{locations,facility}/**`, `src/lib/grid-defs/facility/**`
- Server: `src/server/repositories/{locations,warehouses,mobile-carts,lp-types,lp-numbers,shipment-packages}*.ts`
- APIs: `src/app/api/{locations,warehouses,mobile-carts,lp-types,lp-numbers,shipment-packages}/**`
- Stubs:
  - `src/server/imports/handlers/{locations,locations-update,product-capacity,product-capacity-update,lp-capacity,lp-capacity-update,lp-numbers}.ts`
  - `src/server/search/providers/{locations,lps}.ts`
  - the export providers
- Tests: `tests/{unit,e2e}/facility-config/**`

**Spec refs:** 05 §3, §8, §9, §10; 04 §10, §11; 08 §Roles → Locations / Warehouse / Mobile Carts / LP Types / LP Numbers / Shipment Packages.

**Checklist**
1. **Locations (`/locations`)**
   - Grid: 21 columns. The default visible set is Code, Group, Zone, Type, Area, Walking Path and Inventory Status; the rest are in the chooser.
   - The zone summary strip is kept and drives filters.
   - Header: **Import ▾** (Bulk Import / Bulk Update) and **Create Location**.
   - Bulk actions:
     - **Label:** print location labels.
     - **Assign Capacity ▾:** 4 import links.
     - **Delete:** blocked when the location has inventory or open tasks.
     - **Lock / Unlock**
   - Row ⋯: Show Details → `/locations/[id]`, Edit, Change Log, Delete.
   - The fork `locations-data-grid.tsx` is deleted.
2. **Create/Edit Location wizard**
   - **1.Information:** every field and enum in spec §3, plus the Dimensions and Other Information sections and the 10 location-rule checkboxes.
   - **2.Product Capacity:** Add Capacity modal with Client*, Product*, Pack type*, Min/Max.
   - **3.LP Capacity:** modal with LP Type*, Min/Max, and "Assign Product for this LP".
   - Barcode defaults to the code.
3. **Bulk Location Generator** (beyond Logiwa): pattern builder.
   - Inputs: zone, aisle range (A–F), racks (01–10), levels (1–4) and positions (A–B).
   - Shows a preview count and the first 20 codes, warns on collisions, then creates the locations in a single transaction. Supports a **Background task** for more than 500 locations.
4. **Location detail (`/locations/[id]`):** attributes, current contents (buckets), capacity, open tasks, ledger history, and a label preview.
5. **Warehouses (`/settings/warehouses`)**
   - Grid: code, address, contact, type, default flag.
   - Create/Edit drawer:
     - **Information:** code, prefix, address, contact, day shift with AM/PM, timezone.
     - **Settings:** units; volumetric putaway; default receiving, ship and return locations (filtered by area type); mandatory reasons; mobile auto-logout minutes.
   - Row ⋯: Show Details, Edit, Change Log, Set as Default, Deactivate. Deactivate is blocked while there is open work.
6. **Mobile Carts (`/settings/mobile-carts`)**
   - Grid per spec. Status is derived from the job link.
   - Create: **1.Mobile Cart** (code, warehouse, description, cart type from lookup with levels × columns) and **2.Cell List** (cells auto-generated with barcodes, editable).
   - Label (cart and cell labels), Delete (only when Available), Duplicate.
7. **LP Types (`/settings/lp-types`, tabs `lp`)**
   - Grid: 21 columns.
   - 3-step wizard: General with units, Parameters (9 toggles), Other Info.
   - Show Details/Edit/Change Log/Delete (blocked while LPs exist), plus bulk Delete.
8. **LP Numbers (`/settings/lp-numbers`)**
   - Grid per spec; search defaults to Starts With.
   - Header: Import LP Number (`/imports/lp-numbers`) and **Create LP Number** (drawer):
     - Warehouse*, LP Type* shown as "CODE (WH)", Location (defaults to the receiving location).
     - **From Sequence:** count, SSCC18 (client required; GS1 check digit).
     - **Custom Numbers:** number and alternate barcode.
     - Toast on success.
   - Edit drawer with field locks per spec, and Change Log.
   - Bulk **Print Barcode:** the modal table, then **Print Labels** (LP label PDF).
9. **Shipment Packages (`/settings/shipment-packages`)**
   - Grid per spec.
   - 4-step wizard:
     - **General:** warehouse, code, dims, weights, currency, price, active.
     - **Client Access:** All Clients, or Select Manually with a grid and Enable/Disable bulk.
     - **Inv. Tracking:** owner client, packaging SKU, reduction rule, location.
     - **Other Info**
   - The toast reads "Shipment package created successfully", fixing Logiwa's copy bug.
   - Show Details/Edit/Delete.

**Acceptance**
- **Create a location:** KS-E2E-LOC-01 (Shelves / Picking, Only 1 SKU, product capacity min 5 / max 50). It appears with barcode = code. A putaway of a second SKU into it is blocked (verified through the M06 transfer).
- **Generator:** A–B × 01–03 × 1–2 creates 12 locations; a second run of the same pattern reports collisions and creates 0.
- **Warehouse defaults:** setting MLT1's default receiving location to a new Receiving-area location is reflected by the PO bulk Receive (M05).
- **LP numbers:** LP type KS-E2E-TOTE (prefix KSE-, length 5) plus 3 numbers from sequence gives KSE-00001..00003. Print Barcode produces a 3-label PDF. An SSCC18 run without a client shows an inline error.
- **Shipment package:** an inventory-tracked package consumes 1 packaging SKU per pack (verified through M04).

---

## M11 — `organization-billing` · Clients, Customers, Retailers, 3PL Billing, Billing Report, VAS

**Owned paths**
- Routes: `src/app/(app)/clients/**`, `src/app/(app)/organization/{customers,retailers}/**`, `src/app/(app)/billing/**`
- Components: `src/components/{clients,organization,billing}/**`, `src/lib/grid-defs/organization/**`
- Server: `src/server/repositories/{clients,customers,retailers,billing,vas}*.ts`, including `billing-engine.ts`
- APIs: `src/app/api/{clients,customers,retailers,billing,billing-reports,vas-operations}/**`
- Stubs: `src/server/scheduler/tasks/billing-periods.ts`, `src/server/imports/handlers/{clients,vas-operations}.ts`, `src/server/search/providers/clients.ts`, and the export providers
- Tests: `tests/{unit,e2e}/organization-billing/**`

**Spec refs:** 05 §4, §5, §7; 08 §3PL Billing, §Billing Report, §VAS Operations, §Clients; 08 §Roles → Client Setup.

**Checklist**
1. **Clients (`/clients`, tabs `organization`)**
   - Grid: Client, Official Name, Full Name, Tax ID, Status, # Products, # Open Orders.
   - Header: Bulk Import/Update and **Create Client**. Bulk: Delete/Deactivate, with a guard.
   - **Create Client wizard (4 steps)**
     - **Information:** display name and official name.
     - **Settings:** currency, plus the 4 groups of about 28 switches from spec 05 §7. Each switch has a description tooltip.
     - **Addresses:** a multi-address modal with usage type and default flag.
     - **Others:** tax ID, custom fields and notes.
2. **Client detail (`/clients/[id]`)** (beyond Logiwa)
   - KPIs: orders 30d, units shipped, inventory units, open POs.
   - Tabs: Overview, Settings (edit), Addresses, Users with access, Billing contracts, Activity.
   - The "Inactive" client status flows into the order wizard's client select, where the client is excluded.
3. **Customers (`/organization/customers`)**
   - Grid per spec, with 4 filters.
   - Create/Edit drawer with fields and an Addresses section. The Add Address modal has usage type (Shipping / Billing / Return) and Set Default.
   - Customers can be selected from the order wizard.
4. **Retailers (`/organization/retailers`, BETA badge)**
   - Grid per spec.
   - 3-step create:
     - **General:** with logo upload.
     - **Advanced:** case-label switch, print quantities, documents upload.
     - **Other Info**
   - Toast on create. Edit; Delete is blocked while orders reference the retailer.
5. **3PL Billing (`/billing`, tabs `billing`)**
   - Grid per spec.
   - Bulk:
     - **Actions ▾:** Approve, Cancel Approval, Delete (red)
     - **Duplicate**
     - **Calculate:** runs `billing-engine` now and creates a billing report.
   - Row ⋯: Show Details / Edit / Change Log / Delete.
6. **Create Billing Form (`/billing/new`):** name, client, warehouse, start date, frequency. The Summary card stays live.
7. **Edit Billing Form (`/billing/[id]`)**
   - Header card with a pencil, and Show Change Log.
   - Fee cards with search and filter.
   - **Create Fee inline form:**
     - Operation type cards (8)
     - Calculation type (Storage)
     - Fee By options that depend on the operation (exact matrix from 08)
     - Split Month settings, with tooltips
     - Min/Max price toggles
     - **Add Condition** modal with the full Charge-If list
     - **Add Charge:** Charge By, plus tiered rows "For Each Unit From–To", where several tiers are allowed
   - Summary grid and **Print** (contract printout).
8. **Billing engine (`billing-engine.ts`)**
   - For the contract period, aggregate activity from:
     - ledger, receipts, shipments, tasks (pick/pack)
     - returns, work orders, VAS
     - `inventory_snapshots` (storage methods: daily accumulation, peak, period end, distinct count, average, split month)
   - Apply conditions, tiers and min/max adjustments.
   - Write consolidated and detailed lines.
   - Bill number format: `YYMMDD` + sequence.
   - The calculation status records failures with an error message.
   - The scheduler auto-calculates at each period end.
9. **Billing Report (`/billing/reports`)**
   - Grid per spec. Bulk Cancel and Approve. Row View/Edit and Delete (Draft only).
   - **Details (`/billing/reports/[id]`)**
     - Header strip, with a pencil that opens **Edit Info** (bill number, status).
     - Consolidated and Detailed tabs (Detailed has search, filter and export).
     - Print.
10. **VAS Operations (`/billing/vas`)**
    - Grid per spec. Header: Import (`/imports/vas-operations`) and **Create A VAS Operation** (drawer).
    - The drawer's calculation type comes from the VAS type meta automatically, and the note has a 0/200 counter.

**Acceptance**
- **Create a client:** KS-E2E Client with 3 switches on and a default shipping address. It appears in the client select of the order and PO wizards. The detail page shows its KPIs at 0.
- **Calculate:** a contract with Receiving per unit $0.25, Pick & Pack per order $3, Storage per location at period end $25, and Recurring $50 is run with **Calculate** for the period that contains seeded activity. The resulting report's consolidated lines equal hand-computed totals from the seeded receipts, packs and snapshots, and Detailed lines reference PO and SO codes.
- **Approve:** Approve sets the bill to Approved and locks it from deletion.
- **Tiers:** a tiered fee (1–100 @ $3, 101+ @ $2.50) applies the correct split.
- **VAS:** a VAS operation of "Programming (hours)" × 2 appears in the next calculation under the VAS fee.

---

## M12 — `automation-integrations` · Algorithms, Workflows, Rate Shopping, Channel & Carrier Integrations, Logs, Monitoring, Carrier Errors

**Owned paths**
- Routes: `src/app/(app)/automation/**`, `src/app/(app)/integrations/**`
- Components: `src/components/{automation,integrations}/**`, `src/lib/grid-defs/integrations/**`
- Server:
  - `src/server/repositories/{algorithms,workflows,rate-shopping,channels,carriers,integration-logs,monitoring}*.ts`
  - `src/server/integrations/**`: channel adapters (`shopify.ts`, `shipstation.ts`, `sandbox.ts`) and carrier adapters (`ups.ts`, `fedex.ts`, `easypost.ts`, `shippo.ts`) that implement the foundation `CarrierAdapter`
  - `src/server/workflows/actions/*.ts` (stubs), `src/server/scheduler/tasks/channel-methods.ts`, and the export providers
- APIs: `src/app/api/{algorithms,workflows,rate-shopping-presets,channels,carriers,integration-logs,monitoring}/**`
- Tests: `tests/{unit,e2e}/automation-integrations/**`

**Spec refs:** 06 (all); 08 §Roles → Automation / Integrations; 02 (allocation algorithm reference in job types).

**Checklist**
1. **Algorithms**
   - `/automation/algorithms`: type picker with Putaway / Allocation, using the full-page illustration.
   - Lists (tabs `algorithms`):
     - Columns: Name link, Type, Warehouse, Active pill, Rule Qty.
     - Bulk Delete and **Test Algorithm** (putaway). Delete is blocked for system algorithms and those in use.
2. **Putaway editor (`/automation/algorithms/putaway/{new,[id]}`)**
   - **Left panel**
     - **Primary Information:** name, warehouse, Active/Passive, Dynamic Replenishment checkbox with the exclusivity info box and its rules (at least one active replenishment algorithm; exclusive), and Enforce Suggested.
     - **Rules:** If / If-else list with drag reorder, checkbox, trash, and Create New.
   - **Right canvas** (`@xyflow/react`)
     - Rule name node.
     - Condition nodes: edit, delete, and + siblings.
     - Action nodes joined by AND, and Order By nodes joined by THEN.
     - Zoom −100%+ and a minimap.
     - Cancel Rule / Test Rule / Save Rule.
   - **Add Condition modal:** Apply To All or Specify. Specify offers the full field list (spec 06 §3); the comparator set depends on the field type, and the value editor is a lookup multi-select, number, text or date preset.
   - **Add Action modal:** 38 actions; the parameterised ones show a value field.
   - **Add Order By modal:** 10 methods with Asc/Desc. The button label is "Add Order By", fixing Logiwa's copy bug.
   - **Test Algorithm modal:** Product Putaway and LP Putaway tabs. It calls `putaway.suggestLocations` and shows ranked suggestions with a rule trace (beyond Logiwa).
3. **Allocation editor**
   - Sections: Order Conditions (36 fields), Inventory Conditions (34), and Order By (11).
   - **Dry Run for order** (beyond Logiwa): pick an order and see the chosen buckets and the rule that matched, without committing.
4. **Workflows (`/automation/workflows`)** (Logiwa could not be accessed; KitStaks design)
   - **List:** name, trigger, scope, conditions count, actions, active, sequence (drag), runs and last run.
   - **Builder (`/automation/workflows/{new,[id]}`)**
     - Trigger and scope (warehouse/client).
     - Match All/Any with conditions (order fields, the same as allocation order conditions).
     - Ordered actions with params: Block / Partially Block, Set Carrier Service, Set Rate Shopping Preset, Set Priority, Add Tag, Set Warehouse, Set Shipment Package, Set Order Type, Add Note, Notify Users.
     - Stop processing flag.
     - **Test against order** (dry run).
     - Run history tab.
   - **Action executors:** `src/server/workflows/actions/*`.
5. **Rate Shopping (`/automation/rate-shopping`)**
   - Grid per spec, with Delete.
   - 3-step drawer:
     - **General:** Warehouse/Client locked on edit.
     - **Settings:** method cards; Cheapest In Time reveals Transit Time.
     - **Shipment Methods:** "use all", search, Bulk Activate/Deactivate, and per-service toggles drawn from the client-accessible carrier services.
   - Row Edit / Change Log / Delete.
6. **Integration Management (`/integrations/channels`, `/integrations/carriers`)**
   - Left category menu (All / Channels / Carriers).
   - Logo cards (15 channels, 13 carriers) showing CONNECTED, "Show N Integrated …", or **Connect Now!**
7. **Channel connections (`/integrations/channels/[provider]`)**
   - Connection list and **Connect Store** drawer:
     - **Public App:** OAuth redirect flow for Shopify when `SHOPIFY_CLIENT_ID` is configured; otherwise the option is disabled with a reason.
     - **Custom App:** store name 0/60; auth Access Token or Client ID & Secret; client; REST or GraphQL; Continue validates the credentials live.
     - **KitStaks Sandbox store:** always available.
   - Row ⋯: Show Details / Edit / Change Log / Delete.
   - **Edit Store Connection** has 4 tabs:
     - **General**
     - **Warehouse:** location mapping grid.
     - **Advanced:** payment statuses, tax ID mapping, tag filter include/exclude with condition and a tag grid.
     - **Configuration:** products, orders, inventory and shipments sections, with every toggle from the spec.
   - Saving the configuration creates or updates the 4 channel methods, Active or Passive.
   - Credentials are stored encrypted and are never echoed back; they display as `••••1234`.
8. **Channel methods runtime**
   - The scheduler runs the methods at their intervals.
   - **Download Orders:** adapter fetch, then tag/payment filters, then `orders.createOrder` (which runs workflows), then `channel_runs` and `channel_run_items`. Failures go to `channel_missing_orders` with the error-catalog codes.
   - **Download Products:** `products.ensureProductForListing` plus listings.
   - **Sync Inventory:** on-hand or available, respecting `neverSync`, channel allocations and the prevent-sync location rule.
   - **Send Shipment Info:** pushes tracking for shipped orders.
   - The sandbox adapter generates deterministic, realistic traffic so every screen has real data paths.
9. **Channel Logs** (tabs `integrations`; left sub-nav: Methods / History / Orders and Shipments / Products and Inventory)
   - **Methods:** NEXT RUN countdown and per-row **Run**.
   - **History:** Show Details modal with the correct title per method (fixes Logiwa's bug) and real dates (fixes the NaN bug).
   - Call-log grids, all exportable.
10. **Channel Monitoring (tabs `monitoring`)**
    - **Health Overview:** channel radio cards (avg success %, low-performing count), Filter by Client, grid with tooltips, setup-name link.
    - **Setup Details:** setup dropdown (empty state when none), plus the 6 cards: order volume chart, success donut, and 4 "Show All" tables.
    - **Items For Review** (left sub-nav)
      - **Missing Orders:** bulk **Retry Download**. Row Show Details opens a drawer with the error catalog entry (title, explanation, recommended action, guide link) and the payload JSON viewer with Download. Download Payload.
      - **Recent Errors:** grouped, **with drilldown to the affected orders** (beyond Logiwa).
      - **Workflow Blocked:** **Release / Unblock** action (beyond Logiwa).
      - **Product Listing Exceptions:** Multi Listing / SKU Difference, linking to M09 listings.
11. **Carrier integrations (`/integrations/carriers/[provider]`)**
    - Setup list and **Add New Connection** drawer: API key, secret, payor account, warehouse, Test/Production. Continue validates live.
    - **Edit** has 5 tabs:
      - **General**
      - **Clients:** all, or a picklist plus per-client markups.
      - **Services:** grid with bulk actions and toggles.
      - **Packages**
      - **Advanced:**
        - Ship-from address card and the retailer-address option
        - Third-party accounts grid
        - General and client markups
        - Label format (PDF / ZPL / EPL), size, messages with the token picker
        - International settings
        - Return label checkbox
    - The sandbox carrier is always present. Real adapters are wired to the same interface.
12. **Carrier Errors (tabs `carrier-errors`)**
    - 3 grids per spec, built from `carrier_call_logs`.
    - Row Show Details opens the Transaction Details drawer with REQUEST / RESPONSE tabs (pretty JSON, Download). Also Download Request and Download Response.

**Acceptance**
- **Putaway algorithm**
  - Create a putaway algorithm for MLT1 with rule 1 "Same SKU" (Condition Area Type in Picking; Action Suggest same SKU; Order By Walking Path Asc) and rule 2 "Empty location".
  - Test Algorithm for MLT-WIDGET-01 returns MLT1-A-01 first, with a trace naming rule 1.
  - The M05 receive wizard suggests the same location.
- **Dynamic replenishment:** toggling Dynamic Replenishment on a second algorithm sets the first one Passive, with the info box explaining why.
- **Workflow**
  - A workflow "Block PO Box" (trigger SO Created; Address line contains "PO Box"; Block Order) is applied when M01 creates such an order: the order is created with Workflow Blocked = Fully.
  - The order appears in Workflow Blocked; Release clears it.
- **Channel connection**
  - Connect a KitStaks Sandbox store for client MLTest, mapped to MLT1.
  - Download Orders Run creates N orders, with Store = the store name and channel logo shown in the backlog.
  - Channel History shows the run with Success/Error counts and Show Details rows.
  - A forced "SKU not found" order shows in Missing Orders with the catalog explanation, and Retry Download succeeds once the SKU is created.
- **Rate shopping:** a "Cheapest" preset on an order picks the lowest sandbox rate at label time. Carrier Shipment Details shows Rate Shopping = true and the preset name.
- **Carrier errors:** a carrier label error (e.g. a ship-from phone with fewer than 10 characters) is listed under Label Generation with HTTP 400 and the request/response JSON.

---

## M13 — `reports-analytics` · Dashboard, Report Hub, all Reports, Labor & Operational Analytics

**Owned paths**
- Routes: `src/app/(app)/dashboard/**`, `src/app/(app)/reports/**`, `src/app/(app)/analytics/**`
- Components: `src/components/{dashboard,reports,analytics}/**`, `src/lib/grid-defs/reports/**`
- Server: `src/server/repositories/{dashboard,reports,analytics}*.ts`
- APIs: `src/app/api/{dashboard,reports,analytics}/**`, plus the export providers for every report grid
- Tests: `tests/{unit,e2e}/reports-analytics/**`

**Spec refs:** 07 (all); 08 §Dashboard; 03 §PO Receiving Report.

**Checklist**
1. **Dashboard (`/dashboard`)**
   - **Filter bar:** Warehouse and Client multi-selects, with search and Add Filter. The selection lives in the URL and defaults to the header context. Every widget reacts to it.
   - **Progress for Today**
     - Day shift comes from the warehouse settings: date, now–end with "now" in green, elapsed bar, ☀ start and ☾ end.
     - When several warehouses are selected, it shows the Logiwa message "Select just one warehouse…".
     - Tasks % completed (done − total), Order Lines % packed, Orders to be shipped today % packed.
   - **Unfulfilled Orders:** donut with clickable legend toggles, center total, and Total / Open / In Progress rows (orders and pack qty).
   - **Order Breakdown by Status:** 4 columns per spec. **Every value is a drilldown** (beyond Logiwa).
   - **Rank cards** (Channels, Clients, Carriers, Country): top 5 + Others, each row drilling down to a pre-filtered `/orders` URL.
   - **Jobs card:** Priority / Status / Type tabs, with each row drilling down to `/jobs`.
   - Auto-refresh every 60 s, with a manual refresh and a "Updated hh:mm" stamp.
   - Info tooltips use the spec text.
   - **The static clock and filters are removed.**
2. **Report Hub (`/reports`)**
   - Catalog built from config: the 5 groups from the Reports mega-menu, with descriptions and the routes from F4.7.
   - Permission-filtered, with search and per-user ★ favorites (saved via user preferences).
   - "Recent exports" are real `background_tasks`.
   - **The static catalog, "Coming soon" section and fake recent runs are removed.**
3. **Reports** (shared ReportGrid conventions; header formula tooltips)
   - **Channel Sales (`/reports/channel-sales`):** aggregates shipped orders per listing (client × channel × store × SKU). The **Warehouse column is populated**, fixing Logiwa.
   - **Serial Number Report:** the 3 tabs (`serial`).
   - **Order Inventory:** one row per allocation record.
   - **Dynamic Replenishment:** formula column with tooltip, and "Show only active products". The description is real, not Logiwa's placeholder.
   - **Inventory Snapshot:** default chip "Within 1 Day(s) Past"; the snapshot date preset has an N-day input.
   - **Change Log:**
     - Columns: Type, Changed Module, Code (**deep link to the entity**), Changed Property (**human label**), From, To, Transaction Date, Source.
     - Filters: Event Type, Module, Code, Source, Date.
   - **Transaction History:** 50 columns from `inventory_transactions`, with all 18 types; plus the Serial tab (`transactions`). **The SYNTH warehouse/metro attribution is removed.**
   - **Missing Log**
   - **Excel Export History:**
     - Columns: Export Type, Action (Download), Export Date, Row Count, Error Message, Status pill.
     - Row ⋯: Download.
   - **PO Receiving Report:** difference pills (negative red, positive green), plus Has Difference.
   - **User Performance:**
     - Period default is Last 7 days.
     - Grain: warehouse × user × day.
     - Every metric column is computed from tasks, receipts, counts and returns, with tooltips.
4. **Analytics** (`/analytics/labor/*` and `/analytics/operational/*`)
   - Native dashboards, gated by the active apps "Labor Analytics" and "Operational Analytics" and by permission. Gated pages show an **in-app activation card** linking to Settings → Apps, instead of Logiwa's dead-end modal.
   - Every dashboard has date range and warehouse filters, CSV/XLSX export of each chart's data, and drilldowns to the underlying grid.
   - **Labor**
     - **Average Task Analysis:** avg duration by task type and day, with a trend line.
     - **Associate Task Analysis:** tasks per user by type.
     - **Performance Quadrant:** scatter of speed (tasks/hour) against volume, with median lines and quadrant labels.
     - **Associate Analysis:** scorecards with KPIs, sparkline and rank.
     - **Receiving Performance:** units and lines received per user per hour.
   - **Operational**
     - **Inbound & Inventory:** receipts trend, dock-to-stock time, inventory value, aging, top SKUs.
     - **Fulfillment:** orders created vs shipped, SLA on-time %, backlog by status, shortages.
     - **Management:** KPIs by client, revenue proxies, billing totals.
     - **Productivity:** units/hour by area and shift, heatmap by hour.
   - Charts are recharts styled with KitStaks tokens, with accessible tables behind every chart.

**Acceptance**
- **Dashboard filter:** selecting MLT1 + client MLTest updates every widget. Totals equal the counts from `/orders` with the same filters, and the drilldown from "Ready to Pick" opens exactly those orders.
- **Shift clock:** shows the real time and MLT1's shift end. With 2 warehouses selected it shows the "Select just one warehouse" message.
- **Ledger consistency:** every transaction created by the other modules' e2e suites appears in Transaction History, with correct from/to attributes.
- **Change Log:** shows "Status is modified. Open --> Ready to Pick" for the M01 test order, and the Code deep-links to it.
- **Export History:** each export from any grid appears with status completed and a working Download.
- **Gated analytics:** deactivating Labor Analytics in Apps hides the menu items and shows the activation card on direct URL. Reactivating restores them. The Performance Quadrant renders the seeded users with correct medians.

---

## M14 — `admin-settings` · Users, Roles, Account, Company, Apps, Data Setup, Printouts, Screen Configuration, Audit

**Owned paths**
- Routes: `src/app/(app)/settings/{page.tsx,users,roles,company,apps,data-setup,printouts,screen-configuration,audit}/**`, `src/app/(app)/account/**`
- Components: `src/components/{settings,admin}/**`, `src/lib/grid-defs/admin/**`
- Server: `src/server/repositories/{users,roles,audit,company,apps,printouts,screen-configs}*.ts`
- APIs: `src/app/api/{users,roles,audit,company,apps,printouts,screen-configs,account}/**`
- Stubs: `src/server/imports/handlers/{users,user-roles,user-warehouses,user-clients}.ts`, and the export providers
- Tests: `tests/{unit,e2e}/admin-settings/**`

**Spec refs:** 08 §Printouts, §Screen Configuration, §Apps, §Users & Roles, §My Profile, §Company Settings, §Data Setup.

**Checklist**
1. **`/settings` index:** redirects to `/settings/users`. The old tab components, the static `carriers-tab.tsx` and the SYNTH "last sign-in" values are removed.
2. **Users (`/settings/users`, tabs `users`)**
   - Grid per spec.
   - **Bulk Import/Update ▾** (with tooltip): Import User-Role, Update User-Role, and under Assign/Unassign: User-Warehouse, User-Client.
   - **Add User:** 4-step drawer.
     1. **User Info:** names, email (unique), user type, password and confirm (live policy meter), Send Welcome E-Mail, Active.
     2. **Roles:** Assign/Unassign grid.
     3. **Warehouse:** grid.
     4. **Client:** All, or Select Manually.
   - **Edit User:** tabs; the password is optional.
   - Row ⋯: Show Details, Edit, Change Log, **Deactivate/Activate** (bumps the session version), **Reset Password** (forces a change at next login), **Sessions** (list active sessions and revoke each).
3. **Roles (`/settings/roles`)**
   - Grid with restriction pills.
   - **Add Role / Edit Role drawer**
     - Fields: name, description, category.
     - **Permission matrix** from the catalog: collapsible groups with "(granted/total)" counters, a page-column header "toggle all", action checkboxes, search, and Expand all / Collapse all.
   - **Manage Restrictions** modal: 3 checkboxes with descriptions.
   - System roles are view-only (Duplicate is allowed). Delete is blocked while users are assigned.
4. **Account**
   - **My Profile (`/account/profile`):** display, first and last name, email, language.
   - **Change Password (`/account/password`):** old, new and re-enter, with the policy meter. Saving revokes the other sessions.
   - **Preferences (`/account/preferences`):** timezone (read-only, from the warehouse), date, time and number formats. They apply immediately across the app.
5. **Company Settings (`/settings/company`)**
   - Display and full name, and the logo (jpg/png < 2 MB). The logo shows in the shell and on printouts.
   - **Account defaults:** currency, units, date format.
   - **Security:** password policy and lockout.
6. **Apps (`/settings/apps`)**
   - Hero with search, and tabs POPULAR / ACTIVE / ALL.
   - App cards: icon, gear (settings panel), Details, Activate / ✓ Activated. Deactivation asks for confirmation.
   - Activation gates real features: AI Jobs (wave AI type), Labor Analytics, Operational Analytics, SSO (config panel only), Two Boxes, Scale (packing station weight capture via WebSerial when supported). Integration apps link to M12.
7. **Data Setup (`/settings/data-setup/*`)**
   - Right vertical nav listing all 18 lookups.
   - Each lookup page has an H1, a **Create New …** button, a grid (Name, Status, plus type-specific columns) and a drawer. Type-specific fields:
     - **VAS Type:** calculation type.
     - **Mobile Cart Type:** levels, columns, operation.
     - **Order Merge Rule:** criteria builder (same customer, same address, same client, same carrier).
     - **Location Group/Zone:** warehouse.
     - **Product Type/Group:** client.
     - **Damage Reason:** "counts as damaged" flag.
   - Delete is blocked while a lookup value is in use; it can be deactivated instead.
   - **Auto Code Generation Preferences:** a "Auto Generate As" / "Keep Adding Manually" choice per sequence key (SO, PO, WO, RMA, SP, CNT), with prefix and start number. A live preview of the next code is shown.
8. **Printouts & Labels (`/settings/printouts`)**
   - **Types page:** category vertical nav with **correct counts** (All / Lists / Labels / Billings / Others; fixes Logiwa) and type cards with a BETA badge.
   - **Printout list per type (`/settings/printouts/[type]`):** grid per spec; row Show Details / Edit / Duplicate / Change Log / Delete (the default template is protected).
   - **Create/Edit wizard (5 steps)**
     1. **Info:** name, description, type chip, records per page, print mode, printer type, status.
     2. **Select Template:** radio cards with thumbnails rendered by the foundation renderer.
     3. **Designer:** a real layout editor. Toggle and reorder sections (header, logo, addresses, lines table columns, barcode, footer), set fonts and paper size, and see a **live PDF preview** against a chosen sample record.
     4. **Type options:** e.g. a retailer/store-based packing list.
     5. **Client access:** all clients, or a grid with bulk activate/deactivate.
9. **Screen Configuration (`/settings/screen-configuration`)**
   - Type splash (Receiving) and list grid per spec.
   - Create page with tabs **General / Conditions / Configuration**:
     - **Conditions:** sentence builder: When Operation Starting · If the PO is · And/Or across Client / PoType / Vendor · Use config.
     - **Configuration:** receiving step toggles (scan LP, require lot, require expiry, capture photo, verify dimensions, print label on receive), shown on a mobile preview canvas.
   - M05's receive wizard reads `screen_configs`.
10. **Audit Log (`/settings/audit`)**
    - Security events: logins (success/failure), CSRF rejects, permission denials, role and user changes, session revocations.
    - Filters and **Export**.

**Acceptance**
- **New operator:** create user `e2e.operator` (Warehouse Clerk, MLT1 only, Select Manually → client MLTest).
  - Logged in as them: the nav hides Settings / Billing; `/orders` shows only MLT1/MLTest orders; `/api/orders?f.warehouse=in:wh-ks2` returns none.
  - Deactivating them in another tab logs them out on the next click.
- **Permissions:** removing "Shipment Orders: Cancel" from a custom role hides Cancel Order for its users, and the API returns 403.
- **Preferences:** switching the date format to dd/MM/yyyy and 24 h re-renders every grid date immediately.
- **Data Setup:** a new Cancel Reason "Customer changed mind" is selectable in M01's Cancel Order modal right away.
- **Printouts:** a duplicated Packing Slip template with the logo moved to the right and the "Price" column hidden prints that layout from the M01 order rail.
- **Apps:** deactivating "AI Jobs" makes the wave-rule AI Job card show the empty state that points to Apps.

---

# PART C — Cross-cutting matrices and the critic loop

## C1. Table write ownership

Writes only. Any module may read any table, as long as it stays scoped.

| Tables | Writer |
|---|---|
| inventory, inventory_transactions, inventory_allocations, receipts, serial_numbers, serial_transactions, missing_log, order_line_shortages, allocation_exceptions, shipments, shipment_items, end_of_day_manifests, carrier_call_logs, change_log, code_sequences, notifications, workflow_runs | Foundation domain only, called by modules |
| shipment_orders, order_lines | `domain/orders.ts` (M01 UI/API, M12 channels, imports, workflows); status via `stateMachines` |
| jobs, job_orders, tasks | `domain/jobs.ts` / `domain/tasks.ts`; M03 owns job metadata edits (priority, assignee) |
| job_types, wave_rules, waves | M03 |
| return_orders, return_order_lines | M04 |
| shipment_plans, shipment_plan_orders | M02 |
| purchase_orders, purchase_order_lines, vendors | M05 |
| count_plans, count_plan_lines, count_line_entries | M07 |
| work_orders, work_order_components, kit_inventory_stats | M08 |
| products, product_pack_types, product_barcodes, kit_components, product_replenishment_levels, product_channel_allocations, product_listings | M09 (plus `domain/products.ts` for minimal creates) |
| locations, location_product_capacity, location_lp_capacity, warehouses, lp_types, license_plates, mobile_carts, mobile_cart_cells, shipment_packages, shipment_package_clients | M10 |
| clients, customers, retailers, addresses (owner client/customer/retailer), billing_*, vas_operations | M11 |
| algorithms, algorithm_rules, workflows, rate_shopping_*, channel_*, carrier_* (except call logs) | M12 |
| inventory_snapshots, background_tasks, files, import_* | Foundation services |
| users, roles, role_permissions, user_roles, user_warehouses, user_clients, user_sessions, company_settings, apps, lookup_values, printout_templates, printout_template_clients, screen_configs, audit_log | M14 (sessions/audit via foundation auth) |
| tags, entity_tags, custom_field_defs, saved_views, user_grid_prefs, user_printers, attachments, entity_notes | Foundation APIs |
| addresses (owner vendor) | M05 |

## C2. Cross-module dependency map (navigation and contracts only)

| From | Uses | How |
|---|---|---|
| M01 | M09 `product-create-drawer` · M04 `/orders/returns/new` · M03 `/jobs/[id]` | import stub component · link · link |
| M05 | M09 `product-create-drawer` · M14 `screen_configs` (read) · `putaway.suggestLocations` | import · read · foundation |
| M03 | M07 `counts-commands.createCountPlanFromWave` · `putaway.dynamicReplenishmentTargets` | stub command · foundation |
| foundation `/api/ops/jobs` | M08 `work-orders-commands.allocateWorkOrder` | stub command |
| M04, M01, M02 | `/api/ops/shipping/*`, `/api/ops/tasks/*` | foundation APIs |
| M12 | `domain/orders.createOrder`, `domain/products.ensureProductForListing` | foundation |
| M13 | every table (read) | own repositories |
| all | `create-job-modal`, `change-log-drawer`, `tag-popover`, `print-options-modal`, `import-page` | foundation shared |

**Integration order for e2e.** Each module's e2e suite runs on its own using seed data. Cross-module acceptance items, such as "verified through M04", are re-run by the critic in a final **integration pass** once every module has landed.

## C3. Critic loop protocol (per module, repeated until "wowed")

1. The builder agent finishes its checklist. It must then pass lint, typecheck, unit tests, its own e2e, the dead-click audit for its routes, axe, and `db:verify`.
2. The critic agent, whose default verdict is FAIL, opens every route the module owns at 1440, 1280 and 768 widths. On each route it:
   - walks every tab, wizard step, modal, dropdown, bulk action and row action;
   - performs every acceptance item in the browser;
   - checks network and console output (no errors or warnings, no 500s);
   - re-checks A0;
   - compares screenshots side by side against `references/logiwa/` and the spec text, scoring each with `docs/CRITIC_RUBRIC.md`.
3. The critic returns JSON with:
   - `scores`;
   - `verdict`;
   - `fixes[]`, each giving the exact file, component, copy, px and colour;
   - `functional_failures[]`, each giving repro steps;
   - `logiwa_wins[]`, listing the features where Logiwa is still better or more complete.
4. The loop continues while `verdict != "wowed"`, while any functional failure remains, or while `logiwa_wins` is non-empty. Iteration count is never a reason to stop.
5. **Final integration pass:** after all 14 modules are wowed, a blind side-by-side of the end-to-end flows runs against Logiwa. The flows are:
   - order → wave → pick → pack → ship → EOD;
   - PO → receive → putaway;
   - RMA → return;
   - count → update;
   - work order → kit;
   - channel download → workflow block → release.

   The critic must pick KitStaks as the more complete product for each flow.

---

# PART D — Logiwa areas that were not accessible (KitStaks designs these; mark them "KitStaks-designed" in the critic notes)

- **Workflows builder.** It redirected to sign-in, so M12 designs it. The design draws on the Workflow-Blocked report and public docs.
- **Labor Analytics (5 pages) and Operational Analytics (4 dashboards).** These are paywalled iframes, so M13 builds native dashboards.
- **Printout Designer.** It opens in a separate window, so M14 builds a structured layout editor with live preview.
- **Screen Configuration, Configuration tab.** It is locked until saved, so M14 defines the receiving step toggles.
- **Shipped-order detail, Create RMA wizard, Return Change Status modal, Bulk Update Return Info.** MLT1 had no shipped data. M04 and M01 design these.
- **Return Station RMA and manual flows.** MLT1 had no return-station location, so M04 designs them.
- **Live pack flow.** No MLT1 order was ready to pack, so M04 designs it from the captured layout and the inferred flow.
- **Outputs that open in a new tab.** These are the Create Label output, Packing Slip, Manifest/BOL and Create Return Label. Foundation print templates define them.
- **Mobile Cart types master and cell list.** Data Setup → Mobile Cart Type has been added, and M10 designs the cell list.
- **Product Listings grid rows and row actions.** The grid never loaded, so M09 designs them.
- **Customer save behavior and the address-required rule.** M11 requires at least one Shipping address on save, with an inline message.
- **Client wizard steps 3–4 (Addresses, Others).** M11 designs these.
- **Partially captured job-type details.**
  - Delete Method options for wave rules: None / At Specific Time / After Hours, chosen by KitStaks.
  - Count "Order by Count Method" options: walking path, aisle, level, zone and SKU.
  - Replenishment and Work Order job-type Settings/Conditions: M03 designs from 02 §6.
- **Excel import template layouts.** The foundation template generator defines the columns per handler.
- **Import Serial Numbers page and Saved-filter tab contents.** The foundation designs them using the shared templates.
- **Company "Account defaults" and the App settings gear panels.** M14 designs these.
- **Status ids with inferred meanings.** These are SO ids 4, 9–15 and 11, PO ids 2 and 5, and the PO status pencil options. KitStaks uses explicit enums plus `canTransition`.
- **Shopify Public App OAuth.** It cannot complete without registered app credentials, so the option is gated by environment variables. The Custom App and Sandbox options are fully functional.
