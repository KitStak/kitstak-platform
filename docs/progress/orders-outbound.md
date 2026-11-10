# M01 orders-outbound — progress

Round 1 (2026-11-06). Builder notes; read first when resuming.

## Plan
1. Grid defs (58 columns, 67 filters) — src/lib/grid-defs/orders/
2. Server: orders.ts (list/detail), orders-grid.ts (SQL map), orders-commands.ts, orders-print.ts, orders-export.ts, API routes
3. Import handlers, search provider, export providers
4. UI: backlog + shipped grids with Label/Warehouse Ops/Print/Delete menus + modals
5. UI: create wizard (6 steps) + detail/edit (free mode) with right rail
6. Unit tests, browser verification

## Status (round 1, resumed 2026-11-06)
- Grid defs, backlog/shipped grids, bulk menus + modals, wizard (6 steps), detail/edit with rail, APIs, import handlers, search + export providers: implemented (earlier session).
- Picking/Job Operations: replaced the broken shared CreateJobModal usage with a local modal (`bulk/order-job-modal.tsx`) + `GET /api/orders/job-options` (picking job types w/ batch rules, pending jobs to merge). Verified via API: allocate → eligibility dry run → create job sets KS-E2E-SO-2 to Ready to Pick, ATP 101 → 100, detail jobs card shows Job005266 (code text, UUID only in href), Delete/Cancel disabled with reasons.
- Raw UUIDs: detail page visible text audited (none). Cancel reason change-log value now written as the lookup name (local adapter `labelCancelReason`, REQ-8). Historical rows still hold ids (needs backfill by DB owner).
- Tests: tests/unit/orders-outbound (3 files) all pass; owned-path typecheck clean.

## Remaining / not verified
- Browser click-through of the new job modal and other UI could not be done this session: the shared Browser pane was at its tab cap (tabs_create refused). Server flows verified with curl against the dev server.
- REQ-1..8 pending on shared owners.
