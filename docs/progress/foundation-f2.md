# Foundation F2: seed data and ledger verification (progress)

Plan: `docs/BUILD_PLAN.md`, sections F2 (lines 1282-1372) and 0.4.6. **Status: complete.**

## Approach
- `npm run db:seed` runs `src/server/db/seed.ts`, which is a thin CLI. It calls `runSeed(db, { files, password?, seed? })` in `src/server/db/seed/index.ts`.
- `seed/runtime.ts` installs a virtual clock and seeded `crypto.randomUUID()`. The domain engines stamp rows with `new Date()`, so rows come out backdated, and ids, codes and timestamps are deterministic.
  - Each read of the clock advances it by 1 ms.
  - The runtime is uninstalled in `finally`.
- History is a time-ordered event queue (`seed/queue.ts`) that replays domain operations from 2026-10-06 up to the anchor, 2026-11-05 16:00 UTC. Events after the anchor are dropped, which leaves work in progress "now".
- `scripts/verify-ledger.ts` uses `verifyDatabase(db)` from `seed/verify.ts`. That function runs `ledger.reconcileLedger` plus these extra checks:
  - legacy bucket keys
  - transaction client
  - allocations pointing at missing buckets
  - shipped ≤ packed ≤ picked
  - PO line received = receipts
  - return line received = receipts
  - serial count on Stock buckets
  - shipped orders without an active label
- `db:reset` takes about 30 s, including the dev server's lock contention.

## Checklist
- [x] runtime (clock, uuid) + in-place wipe (`seed/reset.ts`, keeps `__drizzle_migrations`)
- [x] access: 4 system roles from `DEFAULT_ROLES`/`DEFAULT_ROLE_PERMISSIONS`, a custom Client role (restrictions), 10 users (2 client users, 1 API user), user_warehouses/user_clients, audit trail
- [x] lookups: all 18 types; code sequences SO/PO/Job/Wave/RMA/CNT/WO/SP/BILL/LP(/receipt)
- [x] org: 2 warehouses, 8 clients, 22 vendors, 161 customers (shipping + billing addresses), 4 retailers
- [x] catalog: 76 products, Primary + Case pack types with GS1 barcodes, 6 kits, 4 packaging materials, 3 serial-tracked and 8 lot/expiry SKUs
- [x] facility: 335 locations in 2 warehouses (default RECV/SHIP/RTN, PACK, KIT, LOAD, DMG), 40 pick-face capacities, replenishment levels, 3 LP types per warehouse, 120 LPs, 4 carts with 24 cells each, shipment packages (one inventory-tracked)
- [x] automation: algorithms (REPLENISHMENT_ALGORITHM, SAME_SKU_EMPTY_LOCATION_ALGORITHM, Default, B2B Default), 3 workflows, 2 rate presets, 8 job types per warehouse (parsed settings), 5 wave rules (2 scheduled)
- [x] integrations: KitStaks Sandbox in each warehouse (6 SBX services) plus UPS-TEST in the Test environment; 3 channel connections with 4 methods each; listings, including 3 unlinked and 2 with SKU differences
- [x] replay: opening balance (Classic Migration); 33 POs with receipts, putaway, a cancelled receipt and damaged units; ~420 orders (createOrder), 77 waves, ~135 jobs, picking, packing, loading, labels (rate shopping, multi-package, 3 voids, 6 carrier errors), shipping, end-of-day manifests (closed, plus the last days open), delivered
- [x] returns (12), counts (7, including a recount and an instant count), work orders (8), adjustments, replenishment, pick shorts with missing_log and resolution jobs, allocation exceptions and shortages (engine)
- [x] shipment plans (4), channel runs and items (~460), missing orders (9), workflow-blocked orders (2)
- [x] billing: 2 contracts, 4 fees each with tiers, 2 calculated October bills, 12 VAS operations
- [x] platform: 25 printouts, 16 apps (2 active), company settings, custom fields, 15 tags (applied), 3 shared views, 10 admin notifications, 7 nightly snapshots
- [x] scripts/verify-ledger.ts
- [x] unit tests: `tests/unit/foundation-f2/**` (runtime, queue, plans and catalog data, plus a full runSeed integration test on an in-memory DB)
- [x] verify: `npm run db:reset` and `npm run db:verify` OK; app pages and login return 200

## Handoff notes
- **Demo login**
  - `admin@kitstak.io` / `KitStak!demo2026`, overridable with `SEED_PASSWORD`.
  - The other users are `ops.manager@` (Supervisor), `j.okafor@` and `t.nguyen@` (MLT1 clerks), `d.castillo@` (KS2 clerk), `finance@` and `cs.team@` (viewers), `dana@apexthreads.com` and `marcus@novaforge.io` (Client role) and `integrations@` (API user).
  - Seed hashes use 10 bcrypt rounds; they are rehashed on login.
- **Removed users:** the old operators `s.bennett@`, `m.okada@` and `l.fitzgerald@` are gone. `USER_SEEDS` was removed from `seed-data.ts`; the specs now live in `seed/access.ts` (`USER_SPECS`). `tests/e2e/fixtures/roles.ts` only references it in a comment, which its owner can update.
- **Order codes:** orders start at SO010421, POs at PO002210 and jobs at Job005120. Ids are deterministic UUIDs.
- **Channel connections** use provider `shopify` / `shipstation` with `credentialsEnc = null`. M12 should route connections without credentials to the kitstaks-sandbox channel adapter.
- **Workflow actions are still stubs**, so `workflow_runs` record "not configured". The seed sets the two PO-box orders to `workflowBlocked = Fully` directly, with a change_log entry.
- **Domain gaps found (F5 owners):**
  - Serial rows don't follow ledger moves or kitting consumption. The seed avoids moving serial stock, and `serial_stock` verify only checks `Stock` buckets.
  - Async shipping commands open DEFERRED transactions. The seed retries them on SQLITE_BUSY (`retryBusy`) and uses IMMEDIATE transactions for its own work.
- **Label files** accumulate under `.data/files` across resets, because the files table is wiped but the bytes are not.
