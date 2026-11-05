# KitStak WMS

A multi-client warehouse management system for 3PL operations. KitStak covers the core warehouse lifecycle — receiving, inventory, order fulfillment, and reporting — behind a role-aware, client-scoped UI.

## Quickstart

```bash
npm install        # install dependencies
npm run db:push    # create the SQLite schema (./.data/kitstak.db)
npm run db:seed    # load demo data
npm run dev        # start the dev server at http://localhost:3000
```

**Demo credentials:** `admin@kitstak.io` / `KitStak!demo2026`

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack, Partial Prerendering) + React 19
- **Language:** TypeScript (strict)
- **Database:** SQLite via better-sqlite3 + Drizzle ORM
- **Auth:** JWT sessions (jose) with bcrypt password hashing, enforced in proxy middleware
- **UI:** Tailwind CSS 4, TanStack Table, Recharts, lucide-react
- **Validation:** Zod at every API boundary

## Modules

| Module | Description |
|--------|-------------|
| Dashboard | Operational KPIs, activity feed, and charts |
| Inventory | Stock by SKU and location, kit components, adjustments |
| Products | Product master with per-client catalogs and kit definitions |
| Orders | Outbound order management with status and shortage tracking |
| Jobs | Pick/pack job management, allocation exceptions, shortage report |
| Receiving | Purchase orders, vendor directory, inbound receipts |
| Clients | 3PL client (depositor) accounts and status |
| Locations | Warehouse locations by zone and type |
| Reports | Inventory snapshot and transaction history exports |
| Settings | Users, roles, and system configuration |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Push the Drizzle schema to SQLite |
| `npm run db:seed` | Seed the database with demo data |
