# 00 — KitStaks Current State (as of commit 543301e, 2026-11-05)

Read-only audit of `src/`. Bottom line: **KitStaks is a read-only viewer.** Every
grid and detail page shows real SQLite data, but there is **no create, update, or
delete path anywhere** (API, repository, or UI). The only writes in the codebase are
the login audit-log insert and the seed script. Every primary CTA, bulk action, and
row/kebab menu item is either a button with no handler or a `DropdownItem onClick={close}`
that just closes the menu.

Stack: Next 16.4.5 App Router (`cacheComponents: true`), React 19.3, Drizzle 0.45 +
better-sqlite3 (`.data/kitstak.db`, WAL, FK on), Tailwind 4, TanStack Table 8, zod 4,
jose (JWT), bcryptjs, recharts, lucide. No migrations folder (`drizzle-kit push` only).
**No tests at all** (no unit, integration, or e2e files; playwright is installed but unused).

---

## 1. Routes & tabs

Legend: REAL = DB-backed via API/repo · DERIVED = computed client-side from real rows ·
SYNTH = deterministic fake data generated in the UI · STATIC = hardcoded constants ·
DEAD = renders but does nothing.

### Shell (`components/layout/app-shell.tsx`, `(app)/layout.tsx`)
- Top nav: Dashboard link + 4 mega-menus (Fulfillment, Inventory, Reports, Settings) from `nav-config.ts`. Mega-menus open and close and links navigate. **Works.**
- Global search pill ("Search orders, SKUs… /"): **DEAD** (a `<button>` with no handler, no `/` hotkey, no command palette).
- Icon buttons Activity history / Print queue / Help center / Notifications (red dot always on): **DEAD**.
- User menu: Profile **DEAD**, Settings → /settings works, Sign out works (POST /api/auth/logout).
- `WarehouseBar` (MLT1 – Main Fulfillment) is a hardcoded default with no warehouse switching.
- No breadcrumb-driven navigation beyond the links. No mobile nav.

### `/login`
REAL. Split-panel form → POST /api/auth/login, show/hide password, error states. There is no forgot-password, SSO, or MFA.

### `/` → redirect to dashboard (page.tsx).

### `/dashboard` (server component, `getDashboardData()`)
- Cards: Progress Today, Unfulfilled donut, Status Breakdown, 4 Rank cards (Channels/Clients/Carriers/Country), Jobs card. Data is REAL aggregates.
- Shift clock is **STATIC** (`NOW_LABEL = "12:45"`, 08:00–17:00 demo shift). "Last 30 days" is a hardcoded label and is not applied as a filter.
- FILTER BY bar (Warehouse / Client): **STATIC lists, local state only. Does not filter anything.**
- Jobs card dimension and filter chips: client-side only. Cards are not drill-down links into filtered grids.

### `/orders` (Shipment Orders) — `orders-page.tsx`
- Tabs: Backlog / Shipped & Cancelled / Returns. REAL (`/api/orders?tab=`). Returns = Delivered orders whose note starts with `RMA-%` (there is no return-order entity).
- Toolbar: search (debounced), Filter popover (status/channel/client), column chooser, refresh, density, pagination, page-size, CSV export (current page only). Works.
- Row click → `/orders/[id]`. Works.
- **DEAD:** Create Shipment Order, Import (menu items "Import orders from CSV" and "Download import template" are close-only), bulk Print Labels, Warehouse Ops menu (Create picking job / Create packing job / Allocate inventory / Put on hold, all close-only), Cancel Orders.
- Tab state is **local useState, not read from URL**, so the nav links `/orders?tab=shipped` and `/orders?tab=returns` land on Backlog.

### `/orders/[id]` (Order detail "6-step wizard")
- Stepper: Order Details / Customer / Products / Shipping / Other Info / Confirm, with derived complete or attention states. Back and Next Step move between steps.
- **Every field is a read-only `ReadField`** styled like an input. There are no inputs, no validation, and nothing is saved. Several date/ref fields are hardwired `value=""`.
- **DEAD:** "Save Shipment Order" (footer + right rail). Other-actions menu items (Print Packing Slip / Add Tag / Duplicate Order / Cancel Order) are close-only. Copy-tracking works. Timeline is SYNTH (`buildTimeline` from timestamps).
- There is no status transition (pick/pack/ship), no line editing, no address editing, and no carrier rate shopping.

### `/receiving` (Purchase Orders)
- Tabs: Purchase Orders (REAL), Vendors (DERIVED: aggregated client-side from PO rows), Receiving History (DERIVED: completed POs). Tab state is local, so `/receiving?tab=history|vendors` deep links are ignored.
- Search, filter (status/client), grid features work. Rows link to the detail page.
- **DEAD:** Create Purchase Order, Import, bulk actions (Receive?, Cancel Order, Delete).

### `/receiving/[id]` (PO detail)
- Header, KPI band, and lines table are REAL. `withVariedLineStatuses` **rewrites line received quantities for display** (presentation shim). Accepts the display-code slug and permanently redirects it.
- Receipts / Activity / Notes tabs are **SYNTH** (fake receivers "M. Alvarez/D. Chen/R. Okafor", fabricated vendor contacts and domain).
- **DEAD:** Receive Items (primary), per-line Receive, Add note, Other Actions (Print PO / Export PDF / Cancel PO, all close-only). There is no receiving wizard (scan, qty, lot, putaway location).

### `/inventory`
- Tabs: Total Inventory / Inventory by Location / Available to Promise. REAL (`/api/inventory?view=`), with search, client filter, zone filter (by-location), and a category filter that is **applied client-side to the current page only**.
- Tab state is local, so `/inventory?tab=by-location|atp` deep links are ignored.
- **DEAD:** Create Adjustment, Import, bulk Adjust Inventory / Transfer / Print Labels. There is no inventory movement or transaction ledger, no adjustment, transfer, cycle count, or lot/expiry management.

### `/jobs` (Job Management)
- Tabs: Wave Rules (**STATIC**: `WAVE_RULES` constant, and the enable toggles are local state only), Job Management (REAL `/api/jobs`), Allocation Exceptions (REAL: pending jobs, read-only), Shortage Report (REAL: orders with status=Shortage).
- Default tab = management. Tab state is local, so `/jobs?tab=exceptions` (labelled "Packing Station" in nav) is ignored.
- **DEAD:** Create Job, Import, Create Wave Rule, bulk Update Priority / Assign Users / Cancel. There is no job detail route, no pick/pack execution screen, and no packing station.

### `/products`
- Tabs: Products (REAL `/api/products`), Product Listings (**SYNTH**: `synthesizeListings()` fabricates channel listings from product rows, with no DB table). Tab state is local.
- Row click → `/products/[id]`. Search and filters (client/category/status) work.
- **DEAD:** Create New Product, Bulk Import/Update menu (4 close-only items), bulk Delete / Label, row kebab (Edit product / Duplicate / Deactivate, close-only).

### `/products/[id]`
- Identity, attributes, handling chips, and per-location inventory are REAL. Reserve/overflow slot split is **SYNTH** (`RESERVE_SLOT_DEFS`, hashed).
- **DEAD:** Edit Product, Print Labels, Upload image, Other Actions (Duplicate / Export CSV / Show Change Log / Deactivate, close-only). There are no kit/BOM components, no UoM conversions, and no product images.

### `/locations`
- Zone summary strip (REAL `view=zones`, clicking filters the grid), grid REAL with search, zone/type filter, and a custom `locations-data-grid.tsx` fork of DataGrid.
- **DEAD:** Create Location, Import, bulk Assign Capacity / Print Labels / Deactivate, row kebab (View / Edit / Print label / Deactivate, close-only). There is no location detail route.

### `/clients`
- REAL grid (`/api/clients`) with Active/total counts and search/status filter.
- **DEAD:** Create Client, Import, bulk Tag / Assign Plan / Deactivate, row kebab (View / Edit / Deactivate, close-only). There is no client detail page, no billing configuration, and no contacts.

### `/reports` (Report hub)
- **STATIC catalog** (`AVAILABLE_REPORTS`, `UPCOMING_REPORTS` "Coming soon" section), **STATIC "Recent runs"** (`RECENT_RUNS`). Hub pagination buttons are hardcoded `disabled`.
- **DEAD:** Scheduled Exports, Create Custom Report, several icon buttons.
- Only 2 report pages link to real data:
  - `/reports/inventory-snapshot`: REAL rows. CSV export of the current page works. Schedule, Print Labels, and Tag are DEAD.
  - `/reports/transaction-history`: REAL shipment and receipt rows from orders/POs, plus **SYNTH** warehouse/metro attribution and a date-range popover. Schedule, Export Selected, and Print are DEAD. Nav "Shipment Plan" points here (mislabel).

### `/settings` (server page + client tabs, **reads `?tab=` correctly**: the only page that does)
- Users & Roles: REAL `/api/users` (admin/manager only; other roles see an error state). Invite User, Import Users, Reset Password, and Deactivate are DEAD. Some "last sign-in" values are SYNTH.
- Warehouses: REAL cards (bin/zone/capacity aggregates). Create Warehouse is DEAD, and the kebab items (Edit / Manage Locations / Set as Default / Deactivate) have **no handlers**.
- Carriers: **STATIC** `CARRIERS` constant (FedEx/UPS/USPS/DHL, fake account masks and "synced 4 min ago"). Toggles are local only. Test Connection and Connect Carrier are DEAD.
- Audit Log: REAL `/api/audit` (admin/manager). Export Log is DEAD. The only audited action is `auth.login`.
- The settings page itself is **not role-gated**: a viewer can open it, and the server component reads user and audit counts directly from the DB.

---

## 2. API routes

All routes use the envelope `{success, data, error, meta}`, zod-parse queries via `listQuerySchema`
(page ≥ 1, pageSize ≤ 200, search ≤ 200 chars), and verify the JWT (`requireSession` /
`requireRole`). **GET only. Zero POST/PUT/PATCH/DELETE domain endpoints.**

| Route | Methods | Auth | Params | Mutations |
|---|---|---|---|---|
| /api/auth/login | POST | public, rate-limited 5/min/IP | email, password | sets cookie, inserts audit row |
| /api/auth/logout | POST | public | — | clears cookie |
| /api/dashboard | GET | session | — | none |
| /api/orders | GET | session | status, channel, clientId, tab(backlog/shipped/returns) | none |
| /api/orders/[id] | GET | session | — | none |
| /api/purchase-orders | GET | session | status, clientId | none |
| /api/purchase-orders/[id] | GET | session | — | none |
| /api/inventory | GET | session | view(total/by-location/atp), clientId, zone | none |
| /api/products | GET | session | clientId, category, status | none |
| /api/products/[id] | GET | session | — | none |
| /api/locations | GET | session | zone, type, view(list/zones) | none |
| /api/clients | GET | session | status | none |
| /api/jobs | GET | session | status, jobType | none |
| /api/reports/inventory-snapshot | GET | session | clientId | none |
| /api/reports/transaction-history | GET | session | type(Shipment/Receipt) | none |
| /api/users | GET | admin, manager | role | none |
| /api/audit | GET | admin, manager | entity | none |

The repositories (`server/repositories/*.ts`) export only `list*` / `get*` functions. There is no `create*`, `update*`, or `delete*` anywhere.
Sorting is client-side on the current page only (TanStack `getSortedRowModel`), with no server `sort` param.

---

## 3. DB schema (`server/db/schema.ts`, 12 tables; seeded row counts)

| Table | Key columns | Rows |
|---|---|---|
| users | id, email (unique), name, password_hash, role enum(admin/manager/operator/viewer), is_active, created_at | 10 |
| warehouses | id, code, name, address_line, city, state, is_default | 2 (wh-mlt1, wh-ks2) |
| clients | id, code, name, contact_name/email, phone, billing_plan enum(per-order/per-unit/monthly), status | 8 |
| products | id, client_id→clients, sku (unique per client), barcode, name, category, uom, weight_oz, L/W/H in, price, is_kit, is_fragile, is_hazmat, status, reorder_point | 70 |
| locations | id, warehouse_id, code (unique per wh), zone, aisle, bay, level, type enum(Picking/Reserve/Receiving/Shipping/Returns/Damaged), capacity_units, is_active | 249 |
| inventory | id, warehouse_id, product_id, location_id, lot_number, on_hand, allocated, damaged, received_at | 1089 |
| shipment_orders | id, code (unique), warehouse_id, client_id, channel enum(6), store_name, store_order_number, customer_*, ship_* address, status enum(11: Open…On Hold), order_type D2C/B2B, priority None/High/Urgent, carrier, shipping_service, tracking_number, totals, job_id (no FK), order/expected/shipped/delivered dates, note | 420 |
| order_lines | order_id, product_id, quantity, picked_quantity, packed_quantity, unit_price | 678 |
| purchase_orders | code (unique), warehouse_id, client_id, vendor_name (free text, **no vendors table**), reference_number, status enum(Pending/Started/Receiving/Completed/Cancelled), po_type, total/received qty, purchase_price, expected_date, received_at | 30 |
| purchase_order_lines | purchase_order_id, product_id, ordered_quantity, received_quantity, unit_cost | 99 |
| jobs | code, warehouse_id, client_id, job_type enum(5), status enum(4), priority, assigned_to_user_id, order/unit/completed counts, wave_number, rule_name | 28 |
| audit_log | user_id, action, entity, entity_id, detail (JSON text), at | 16 |

**Missing entities** that Logiwa-level features need: vendors, carriers/carrier accounts/shipping services,
wave rules, job↔order and job↔task lines, inventory transactions/movements ledger, adjustments
and reason codes, transfers, cycle counts, receipts (receipt header and lines distinct from PO), putaway tasks,
license plates/LPN/totes, packages/shipments (cartons, labels), return orders/RMA lines, kits/BOM,
channel listings/integrations, store connections, tags, notes/attachments, billing rates/invoices,
user-warehouse assignments, permissions matrix, saved views/filters, report schedules, notifications.
There is no `updated_at` or optimistic-concurrency column on any table, and no soft-delete beyond `is_active`/`status`.

---

## 4. Shared UI primitives

Present:
- `ui/button.tsx`: CVA variants (primary/secondary/ghost/…), sizes sm/md/lg/icon, focus ring.
- `ui/input.tsx`: `Input`, `Checkbox` (styled native).
- `ui/dropdown.tsx`: `Dropdown` (render-prop trigger, outside-click + Esc close, align start/end), `DropdownItem` (destructive variant), `DropdownSeparator`. **There is no keyboard arrow navigation, no ARIA menu roles, no portal (it can clip inside overflow containers), and no submenus.**
- `ui/status-pill.tsx`: `StatusPill` (semantic colour map for order/PO/job statuses), `PriorityFlag`, `ChannelBadge`. Feature-specific `order-status-pill`, `order-priority-pill`.
- `ui/card.tsx`: `Card`, `Skeleton`, info tooltip-ish helpers.
- `grid/data-grid.tsx`: TanStack grid with checkbox selection, client-side sort, column visibility chooser, density toggle, refresh, loading skeleton, error + retry, empty state, server pagination with page-size, sticky-right column (`meta.sticky`), CSV export of current-page rows, row click. **It lacks** server-side sort, column resize/reorder/pin-left, saved views, inline editing, row expansion, virtualization, export-all, and column filters. Forks with drift: `locations/locations-data-grid.tsx`, `receiving/po-grid.tsx`.
- `grid/grid-toolbar.tsx`: `GridSearch`, `FilterButton` (popover with single-select per key + chips).
- `layout/page-header.tsx`: Breadcrumbs, title, actions slot, tab strip with counts. Plus per-page `*-tabs.tsx` duplicates.
- `orders/detail/wizard-stepper.tsx`: horizontal 6-step stepper (complete/attention states, role=tablist), `section-card.tsx` (sticky footer), `ReadField`. **It is display-only and is not a reusable form wizard.**
- The jobs tab and carriers tab each have a local Toggle switch.

Gaps (none exist):
- **No Modal/Dialog, no Drawer/Sheet/side panel, no ConfirmDialog.**
- **No Toast/notification system.**
- **No form system** (no react-hook-form, no zod-bound forms, no Select/Combobox/Autocomplete, DatePicker, Textarea primitive, Radio, NumberInput, or file upload). The only real form is login.
- No Tooltip primitive, Popover primitive (separate from dropdown), Tabs primitive (each page re-implements), Command palette, Barcode scan input, Print/label (ZPL/PDF) pipeline, empty-state component, or error boundary pages (`error.tsx` / `not-found.tsx` are absent; only 2 `loading.tsx` files exist).
- No URL-state hook for tabs, filters, or pagination (only settings uses `useSearchParams`).
- No data-fetching library (raw `fetch` + AbortController per page, duplicated), so there is no cache or mutation invalidation.

---

## 5. Auth / RBAC / security posture

Good:
- JWT HS256 (jose) in httpOnly, SameSite=Lax cookie (Secure in prod), 12h TTL. `SESSION_SECRET` is required in prod (≥ 32 chars); dev uses a derived fallback with a warning.
- Middleware does a presence check and redirects to `/login?next=`. The `(app)` layout verifies the JWT server-side. Every API route verifies it again.
- bcrypt passwords, timing-pad hash for unknown emails, generic error message, in-memory rate limit of 5/min/IP on login, login audit row.
- zod validation on all query params. Drizzle parameterized queries (LIKE patterns escaped via `likePattern`).
- Security headers: CSP (no `unsafe-eval` in prod, but `script-src 'unsafe-inline'`, no nonce), nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy. **HSTS is missing.**
- Seed has a production guard (`ALLOW_PROD_SEED`) and takes its password from `SEED_PASSWORD` (falls back to a hardcoded demo password).

Gaps:
- RBAC is coarse: `requireRole` is used only on /api/users and /api/audit. Pages are not role-gated (viewer can open /settings), the UI does not hide actions by role, and there is no permission matrix.
- The JWT carries the role, and there is no server-side session store, so there is **no revocation**. A deactivated user or a role change only takes effect when the token expires (up to 12h). Logout only clears the cookie.
- **No CSRF protection** (it is currently moot because there are no mutations, but it will be required). SameSite=Lax is the only defence.
- Rate limiting is in-memory, single-process, and login-only. `x-forwarded-for` is trusted blindly.
- No tenant or client scoping: every user sees all clients and warehouses. There is no warehouse-assignment enforcement.
- No MFA, password reset, password policy, account lockout, SSO, or API keys/tokens for integrations.
- Audit log records only logins. No mutation auditing exists because there are no mutations.
- `serverError` logs with `console.error`. There is no structured logging, monitoring, or health endpoint.

---

## 6. Nav-config map (`components/layout/nav-config.ts`)

| Menu | Section | Label | href | Actual behaviour |
|---|---|---|---|---|
| (top) | — | Dashboard | /dashboard | OK |
| Fulfillment | Orders | Shipment Orders | /orders | OK (Backlog) |
| | | Shipped Orders | /orders?tab=shipped | **Broken: lands on Backlog** (tab not URL-driven) |
| | | Return Orders | /orders?tab=returns | **Broken: lands on Backlog** |
| | Operations | Job Management | /jobs | OK |
| | | Packing Station | /jobs?tab=exceptions | **Mislabel and broken**: there is no packing station, and the link lands on Job Management |
| | | Shipment Plan | /reports/transaction-history | **Mislabel**: it is a transaction report, not a shipment plan |
| | PO & Receiving | Purchase Orders | /receiving | OK |
| | | Receiving History | /receiving?tab=history | **Broken: lands on POs tab** |
| | | Vendors | /receiving?tab=vendors | **Broken: lands on POs tab** |
| Inventory | Inventory | Total Inventory | /inventory | OK |
| | | Inventory by Location | /inventory?tab=by-location | **Broken: lands on Total** |
| | | Available to Promise | /inventory?tab=atp | **Broken: lands on Total** |
| | Catalog | Products | /products | OK |
| | | Product Listings | /products?tab=listings | **Broken: lands on Products** (and listings are synthesized) |
| | Facility | Locations | /locations | OK |
| | | Clients | /clients | OK |
| Reports | Reports | Report Hub | /reports | OK (static catalog) |
| | | Inventory Snapshot | /reports/inventory-snapshot | OK |
| | | Transaction History | /reports/transaction-history | OK |
| Settings | Administration | Users & Roles | /settings | OK |
| | | Warehouses | /settings?tab=warehouses | OK (URL-driven) |
| | | Carriers | /settings?tab=carriers | OK (static content) |
| | | Audit Log | /settings?tab=audit | OK |

The active-menu highlight uses `pathname.startsWith(href without query)`.
The nav has no entries for: returns/RMA, waves, pick/pack execution, putaway, replenishment, cycle counts,
adjustments, transfers, LPN/totes, shipments/packages, carriers' rate shopping, integrations/channels,
billing, labels/printers, or an end-user profile.

---

## Priority gaps (input for the build fan-out)
1. Foundation primitives: Modal/Drawer/ConfirmDialog, Toast, form system (Select/Combobox/DatePicker/NumberInput/Textarea, zod-bound), reusable Wizard, URL-state hook, mutation fetch helper with CSRF, plus `error.tsx` and `not-found.tsx`.
2. Mutation APIs and repositories with audit logging, `updated_at`, and RBAC enforcement for every entity (orders, POs, products, locations, clients, users, warehouses, jobs).
3. Real workflows: Create/Edit Shipment Order wizard, PO create and Receive wizard (with putaway), inventory adjust/transfer/cycle count with a movements ledger, wave rules and job creation from orders, pick/pack/ship execution (packing station), cancel/hold status transitions, and returns/RMA.
4. New tables: vendors, carriers/services, wave_rules, inventory_transactions, receipts, packages/shipments, return_orders, tags/notes, job_orders.
5. Fix nav deep links (tabs from `?tab=`) and the mislabelled nav items. Replace the STATIC and SYNTH surfaces (dashboard filters/clock, wave rules, carriers, reports hub catalog and runs, product listings, PO receipts/activity/notes, product reserve slots).
6. Security: session revocation/versioning, CSRF, page-level RBAC, client/warehouse scoping, HSTS, a durable rate limiter, and mutation audit coverage.
7. Tests: none exist. Unit, integration, and e2e (Playwright) all need to be added.
