# KitStak WMS — Design & Architecture Spec

Benchmark: **Logiwa iO** (live sandbox captured in `references/`). Goal: win a blind
side-by-side against Logiwa iO screenshots on visual quality and usability.

KitStak is its own brand — we match Logiwa's *quality bar, density and IA patterns*,
not a pixel clone. Shell, grids, wizards and dashboard widgets follow the observed
patterns in `references/LOGIWA_REFERENCE.md`, executed with tighter polish.

## Modules & routes

| Route | Module |
|---|---|
| `/login` | Auth (split-panel login) |
| `/dashboard` | Operations dashboard (Progress Today, Unfulfilled donut, status breakdown, rank cards, jobs) |
| `/orders` | Shipment Orders grid (tabs: Backlog / Shipped & Canceled / Returns) |
| `/orders/[id]` | Order detail — 6-step wizard + right-rail summary |
| `/receiving` | Purchase Orders (tabs: POs / Vendors / Receiving History) |
| `/receiving/[id]` | PO detail with receive progress |
| `/inventory` | Tabs: Total Inventory / Inventory by Location / ATP |
| `/jobs` | Job Management (tabs: Wave Rules / Job Management / Allocation Exceptions / Shortage) |
| `/products` | Product master (tabs: Products / Product Listings) |
| `/products/[id]` | Product detail |
| `/locations` | Locations grid + zone structure |
| `/clients` | 3PL clients (depositors) |
| `/reports` | Report hub + Inventory Snapshot & Transaction History reports |
| `/settings` | Users & roles, warehouses, carriers, audit log |

## Stack

- Next.js 15 App Router, TypeScript strict, Tailwind CSS v4.
- TanStack Table v8 for grids; Recharts for charts; lucide-react icons.
- better-sqlite3 + Drizzle ORM, seeded SQLite DB (file: `.data/kitstak.db`).
- Zod validation on all API routes; repository layer in `src/server/repositories`.
- Auth: jose-signed HTTP-only session cookie, bcryptjs password hashing, RBAC
  (admin/manager/operator/viewer), Next middleware route guard.
- Security headers + CSP in `next.config.ts`; rate limit on `/api/auth/login`;
  audit log table for mutations.

## Design tokens (KitStak brand)

- **Nav bar**: deep indigo `#353E6B` → `#3E4784` (Logiwa-family navy but ours).
- **Primary**: `#2E5CE6` (buttons, links, active tabs). Hover `#2449B8`.
- **Canvas**: `#F6F7F9`; cards white, border `#E4E7EC`, radius 8px, shadow-xs.
- **Text**: slate-900 `#101828` headings, `#344054` body, `#667085` secondary,
  `#98A2B3` column headers (11px uppercase, 0.04em tracking).
- **Status pills** (soft bg / strong text):
  open `#FFF6E6/#B54708`, ready-to-pick & in-progress `#EFF4FF/#2E5CE6`,
  picking/packing-started `#E0F2FE/#026AA2`, shipped/completed `#ECFDF3/#027A48`,
  pending/draft `#F2F4F7/#475467`, shortage/cancelled `#FEF3F2/#B42318`,
  high-priority red w/ ↑.
- **Font**: Inter (variable), tabular-nums in grids. Grid body 13px; rows 40px.
- Focus rings `ring-2 ring-primary/40`; every interactive element has hover/focus states.

## Non-negotiable component contracts

1. `AppShell` — top navbar w/ mega-menu flyouts, search pill, icon cluster, user menu,
   breadcrumbs, warehouse/client filter context (MLT1 default).
2. `DataGrid` — generic TanStack wrapper: checkbox selection, sortable, column chooser
   (gear), sticky header, density toggle (Large/Small), pagination footer
   (`|< < 1/N > >|`, "Show 100 items", "Export As Excel" CSV, "Total: N"),
   row-hover, `•••` row menu, loading skeleton, empty state, error state.
3. `StatusPill`, `ChannelBadge` (Shopify/Amazon/TikTok/Manual/Wholesale), `PriorityFlag`.
4. `PageHeader` (breadcrumb, title, helper text, actions) + `UnderlineTabs`.
5. `FilterBar` — Filter ▾ popover with field pickers + applied-filter chips.
6. `WizardStepper` + right-rail `SummaryCard` for detail pages.
7. Dashboard widget kit: `ProgressCard`, `DonutStat`, `StatusBreakdown`, `RankCard`, `JobsCard`.

## Seed data (believability bar)

Warehouse **MLT1 – Main Fulfillment** (+ secondary "KS2 – Overflow"), 8 clients
(invented names, 3PL flavor), ~70 products w/ realistic SKUs across 3 catalogs,
~420 shipment orders spread over 30 days across channels (Shopify, Amazon, TikTok Shop,
Walmart, Wholesale, Manual) and statuses, ~30 POs, ~1,100 inventory rows over a
zone/aisle/bay/bin location tree (~240 bins), ~28 jobs (Single Unit, Multi Item, Cycle
Count, Replenishment), 10 users. Deterministic seeded RNG so screenshots are stable.

## Definition of done per page

Loading skeleton, empty state, error state, keyboard focus, dark-text contrast AA,
no layout shift, believable data, and critic score ≥ 9/10 against the rubric in
`docs/CRITIC_RUBRIC.md`.
