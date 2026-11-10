# M07 counts — progress

## Status (round 1, resumed 2026-11-06, second pass)
- Backend, API, pages, wizard, dialogs and detail page are built; 31 unit tests pass (`tests/unit/counts/*`); typecheck of owned paths clean.
- Verified in the running app with headless Playwright (shared browser pane had no free tab) — scripts in the session scratchpad `m07/`.

## Verified end to end (UI + DB)
- Create New Count wizard: CNT auto-suggested name, required-field validation, warehouse combobox, Lock Locations, Add Location picker, mode-switch confirm ("Keep them" / "Switch and clear"), Save disabled while empty → plan Pending (KS-TEST-CNT-LOCK).
- Bulk Cancel with ConfirmDialog → Cancelled; the count lock query for its locations returns nothing afterwards (unlocks).
- KS-E2E-COUNT-1 (SKU mode, lock Yes): Create Job modal → Ready To Count (2 lines/2 jobs); count sheet scan + entry → B-02-02-1 no difference auto-updated (job type Auto-Update No-Difference), D-01-02-2 261 vs 290 → −10.00%; Create Recount from SKU Details → new Ready To Count line (Recount Line = Yes), original "Recount Created"; recount 261 → Update Inv. dialog (variance summary) → inventory 261, `inventory_transactions` Count −29 with count_plan_id + note "Count plan KS-E2E-COUNT-1", plan Inventory Updated with user/time; timeline shows change_log + ledger.
- Quick count (IC20261106173748066): no variance → Inventory Updated, no open line, task Completed.
- Row kebab: Show details / Edit (Pending; drawer loads lines) / Change log / Delete; Edit + Delete disabled with reasons on started plans.
- Location Details More Details → async detailed export completed (24 rows).

## Fixed this pass
- Hydration mismatch on /counts and /counts/locations (permission-gated header buttons): `useCountCan` in counts-client (REQ-4 asks for the shared fix).
- Lock icon showed on released lines (Inventory Updated / Recount Created): `lineHoldsLock` in count-math.
- Detail KPIs double-counted variance of Recount Created lines; locked-location callout count now counts only lines that still hold the lock.
- Cancel confirm copy "2 unlock" → "2 locations".
- Tests: count-math.test.ts (pure rules) + mandatory-reason tests in counts-lifecycle.test.ts.

## Remaining (blocked on shared changes)
- REQ-1: ledger enforcement of count locks ("transfer out of a locked location is blocked with a message naming the plan"). M07 ships `countLockFor` / `countLockMessage` in `src/server/repositories/counts-lock.ts`; the ledger (src/server/domain/**) must call it. Not landed yet, so that acceptance step cannot pass.
- REQ-2 (ops jobs delegation), REQ-3 (domain job helper), REQ-4 (useCan hydration) pending; M07 is unblocked locally for those.

## Decisions
- Location lock derived from count_plans.lock_locations + plan/line status (no write to locations.is_locked, M10's table).
