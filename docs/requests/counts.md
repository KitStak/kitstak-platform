# M07 counts — shared-change requests

## REQ-1 — Ledger: reject moves in/out of locations locked by an open count plan
- **File:** `src/server/domain/ledger/rules.ts` (and `src/server/domain/ledger/allocations.ts`, `src/server/domain/allocation.ts`)
- **Change:** add a helper and call it wherever `loc.isLocked` is checked today (`assertLocationAccepts` when `!opts.inPlace`, `assertSourceMovable`, `allocations.ts:50`), plus exclude such locations in the allocation candidate query (`allocation.ts:79`):
  ```ts
  /** Code of the open count plan that locks this location, or null. */
  export function countLockFor(tx: Tx, locationId: string): string | null {
    const row = tx.get<{ code: string }>(sql`
      SELECT p.code FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id
      WHERE l.location_id = ${locationId} AND p.lock_locations = 1
        AND p.status IN ('Pending','Ready To Count','Count Started','Count Completed')
        AND l.status NOT IN ('Cancelled','Inventory Updated','Recount Created')
      LIMIT 1`);
    return row?.code ?? null;
  }
  // in the checks:
  const lock = countLockFor(tx, loc.id);
  if (lock) throw ruleViolation(`Location ${loc.code} is locked by count plan ${lock}.`, { countPlanCode: lock });
  ```
  The `inPlace: true` path (count / adjustment of stock already in place, used by `ledger.adjustTo`) must keep skipping the check, so Update Inv. can still post the counted variances.
- **Reason:** BUILD_PLAN M07 checklist 6 / acceptance "a transfer out of a locked location is blocked with a message" — "the ledger rejects moves in or out of locked locations for the life of the count. The error names the count plan." M07 may not edit `src/server/domain/**` or write `locations.is_locked` (M10's table), so the lock is derived from `count_plans.lock_locations` + the plan/line status and has to be enforced by the ledger. M07 already shows the lock (plan + lines + "Locked" badges) and unlocks implicitly on Cancel / Update Inv.
- **Update (round 1 resume):** the lock query now lives in M07's own `src/server/repositories/counts-lock.ts` (`countLockFor(tx, locationId)` + `countLockMessage(locationCode, planCode)`, unit-tested in `tests/unit/counts/counts-lock.test.ts`). It also covers Pending SKU-mode plans, whose lines have no location until Create Job expands them (a location is locked when it holds stock of the SKU). Preferred change: move this function into `src/server/domain/ledger/rules.ts` (or import it there) and call it at the three `isLocked` checks listed above.
- **status:** applied (F-patch 2026-11-06): `src/server/domain/ledger/count-locks.ts` (`countLockFor`, `countLockMessage`, `assertNotCountLocked`, `notCountLocked`; same query as `counts-lock.ts`, incl. Pending SKU lines), exported from `@/server/domain/ledger`. Called in `assertLocationAccepts` (skipped when `inPlace`), `assertSourceMovable`, `ledger.allocate`, and the allocation candidate query. Error: RULE_VIOLATION "Location X is locked by count plan CNT…" with `details.countPlanCode`. M07 may re-export the domain helper from `counts-lock.ts`.

## REQ-2 — `/api/ops/jobs` mode "count": delegate to M07
- **File:** `src/server/repositories/platform-ops.ts` (`runJobsCommand`, `case "count"`), `countJobsSchema`
- **Change:** extend `countJobsSchema` with `jobTypeId: idSchema, batchSize: z.number().int().min(1).max(1000), assigneeUserId: idSchema.nullish()` and replace the `NotImplementedError` with
  `return createCountJobs(db, ctx, { planIds: input.countPlanIds, jobTypeId: input.jobTypeId, batchSize: input.batchSize, assigneeUserId: input.assigneeUserId ?? null });`
  imported from `@/server/repositories/counts-ops` (returns `{ succeeded, failed, jobIds }`).
- **Reason:** keeps the shared Create Job backend consistent. M07's own UI uses `POST /api/counts/create-job` (same command), so nothing is blocked meanwhile.
- **status:** applied (F-patch 2026-11-06): `countJobsSchema` now `{ countPlanIds, jobTypeId, batchSize (1-1000), assigneeUserId? }`; `case "count"` delegates to `createCountJobs(db, ctx, auth, { ids, jobTypeId, batchSize, assigneeUserId })` from `counts-jobs.ts` (actual export location). The body also accepts the shared modal shape `{ operation: "count", mode: "create", ids }`.

## REQ-3 — Domain helper for count jobs
- **File:** `src/server/domain/jobs.ts`
- **Change (optional):** export `insertJob` (or a `createCountJob(tx, ctx, { jobTypeId, countPlanId, assigneeUserId, tasks })`) so M07 does not insert `jobs` / `tasks` rows itself. Until then `src/server/repositories/counts-ops.ts#insertCountJob` inserts them exactly like the foundation seed (`seed/counts.ts#countJob`): `sequences.next("job")`, `recordCreate`, `rollupJob`, and every status change goes through `stateMachines` / `tasks.execute` / `tasks.cancel`.
- **Reason:** C1 table ownership (jobs/tasks belong to `domain/jobs.ts`).
- **status:** applied (F-patch 2026-11-06): `jobs.createCountJob(tx, ctx, { jobTypeId, countPlanId, waveRuleId?, assigneeUserId, tasks: [{ countLineId, productId, locationId, lpId, plannedQty }] })` in `src/server/domain/jobs.ts` (validates Count job type and assignee warehouse; sequence code, recordCreate, rollupJob). Returns the job row. `insertCountJob` can switch to it.

## REQ-4 — `useCan` causes hydration mismatches on Suspense-wrapped pages
- **File:** `src/lib/permissions-client.ts` (`useCan` / `usePermissionSet`)
- **Change:** return `allowed: false` (and `isLoading: true`) until hydration has finished, e.g.
  ```ts
  const subscribeNoop = () => () => undefined;
  const hydrated = React.useSyncExternalStore(subscribeNoop, () => true, () => false);
  return { allowed: hydrated && !isLoading && hasPermission(permissions, required, mode), isLoading: !hydrated || isLoading };
  ```
- **Reason:** pages render inside `<Suspense>` and can hydrate after `/api/me` has resolved in the React Query cache, so the first client render shows permission-gated header buttons the server did not render → "Hydration failed" page error (reproduced on `/counts`, `/counts/locations` and `/orders` with a headless browser). M07 works around it locally with `useCountCan` in `src/components/counts/counts-client.ts`; once this lands that wrapper can be dropped.
- **status:** applied (F-patch 2026-11-06): `usePermissionSet` (and so `useCan` / `<Can>`) reports `isLoading: true` and no permissions until hydration (`useHydrated()` via `useSyncExternalStore`, exported). `useCountCan` can be dropped.
