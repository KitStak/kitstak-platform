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
- **Foundation pass 1 (2026-11-09):** verified all REQs above are DONE (pass 1); no further shared change pending.
- **Foundation pass 2 (2026-11-09):** re-verified against the code; all REQs above DONE (pass 2), no further shared change pending.

## Round 2 requests
### REQ-5 — Job detail: open count / replenishment jobs on the Tasks tab
- **File:** `src/components/jobs/job-detail-page.tsx` (fulfillment-jobs module)
- **Change:** when `job.operationType` is `Count` or `Replenishment` (no orders), make **Tasks** the default tab, or hide the Orders tab. Today the page opens on "Orders 0 — No orders in this job".
- **Reason:** the Count Plan, Location Details and SKU Details Job Code links (M07, Round 1) land on `/jobs/{id}`. Logiwa opens the job's task list (Count Task Details filtered to the job; outbound.md item 26). The user should see the count tasks at once.

### REQ-6 — Dark-mode tones for status pills
- **File:** `src/lib/status-colors.ts` and `src/components/ui/status-pill.tsx` (foundation)
- **Change:** in dark mode, give `TONES` dark-theme variants, or map them to CSS tokens. Today `grey` (`#E3E6E8` bg) renders as a bright light-grey block (critic: Pending pill on /counts).
- **Reason:** DESIGN_SPEC dark-mode parity. The count chips already take their dot colour from `statusTone`.

### REQ-7 — BulkAction `info` tooltip + configurable `inline` count in GridToolbar
- **File:** `src/components/grid/grid-types.ts`, `bulk-actions.tsx`, `grid-toolbar.tsx` (foundation)
- **Change:** add an optional `info?: string` to `BulkAction` that renders an (i) tooltip, and a `bulkInline?: number` prop on `GridToolbar` (default 2). Also make the disabled `destructive` style neutral, not a faded red.
- **Reason:** for now M07 renders its own bar (`src/components/counts/count-bulk-bar.tsx`) through `trailing`. Once this lands it can return to the shared bulk API.

### REQ-6 (re-raised, round 3) — Dark-mode status pill tokens still light
- **Owner:** foundation (`src/lib/status-colors.ts`, `src/components/ui/status-pill.tsx`).
- **Seen in:** the round 2 critic, at `/counts` 768 px in dark mode. Pending is pale grey, and the green, blue and red chips use light fills that glare.
- **Ask:** under `.dark` / `[data-theme=dark]`, give each tone a tinted background (the hue at about 15% alpha) with a light foreground (for example green `#4ADE80` on `rgba(34,197,94,.15)`). Every module's pills pick this up; M07 has no local override.

### REQ-8 — Index for `jobs.count_plan_id`
- **Owner:** foundation (`src/server/db/schema/work.ts` plus a migration).
- **Why:** the Count Plan grid's `jobCodes` / `jobRefs` subqueries filter `jobs` by `count_plan_id`, and that column has no index. On the current DB (90 lines, 23 entries) the grids run in 2–17 ms of SQL, so the critic's 13–98 s timings came from dev-server load, not from the queries. The index keeps the grid flat as jobs grow.
- **Ask:** `index("jobs_count_plan_idx").on(t.countPlanId)`. Optionally also `index("count_lines_plan_status_idx").on(t.planId, t.status)` in `schema/counts.ts`, which is a foundation-generated migration.

### REQ-9 — Grid footer: hide "Total: 0" while loading (round 4)
`src/components/grid/grid-footer.tsx` renders `Total: {total}` even while the first page is loading, so every grid reads "Total: 0" for as long as the request runs and looks empty. Ask: pass `loading` from `DataGrid` to `GridFooter`; while `loading && data.length === 0`, render `Total: …` (or a 40 px skeleton) instead of the number and disable the export button with reason "Loading…". Optional: in `useGrid`, set `placeholderData: keepPreviousData` so paging and filtering keep the last rows and total.
- **Status:** DONE (foundation round 2, 2026-11-10): GridFooter `loading` prop.

### REQ-10 — DataGrid: Excel export without sharing column prefs (round 4)
On `/counts/[id]` the Lines grid is client-side (no `gridKey`), so the footer shows "Export CSV", while the list grids show "Export As Excel". The critic flags this as inconsistent. Passing `gridKey="count-locations"` would turn on Excel export, but it would also share column prefs with Location Details. Ask either:
- (a) add an `exportGridKey` / `exportQuery` prop to `DataGrid`, used only by `ExportButton`, separate from `gridKey` (prefs); or
- (b) register grid key `count-plan-lines` in `src/server/exports/grid-keys.ts` → `/api/counts/[id]` lines, with M07 supplying the provider.

M07 would then pass `exportGridKey={plan.countType === "SKU" ? "count-skus" : "count-locations"}` and `exportQuery="f.planCode=eq:<code>"`.

### REQ-11 — Intermittent HTML 500 on the first `/api/counts` call (round 4, for foundation)
At the API level the round-3 500 came back as a Next HTML error page, not the JSON envelope. That means the failure happened before `defineRoute`'s handler and error mapper ran: route compile or module evaluation during HMR while other agents were editing shared files. Timed directly against `.data/kitstak.db`, the count SQL runs in under 20 ms. All 5 count endpoints return 200. The first call after an edit takes 27–33 s, which is route compile time; repeat calls take 0.4–5 s, and `/api/me` is just as slow (1.5–4.5 s) at the same moment. Ask: have `api-client` map a non-JSON 5xx to a typed `SERVER_ERROR` ApiError ("The server had a problem. Retry."), so grids show their Retry state and never parse HTML. This may already happen. Please confirm.

### REQ-9 — Job type "Blind Count" setting (round 2 parity loop)
- **Owner:** foundation (`src/lib/domain-types.ts` `jobTypeSettingsSchema.count`) and admin-settings (Job Types edit page, Count section).
- **Change:** add `blindCount: off` to `count: z.object({ … })`, and a "Blind Count" Yes/No toggle (info: "Counters don't see the system quantity; the count sheet and quick count hide it and the fill-from-system shortcuts") next to "Auto-Update No-Difference Lines".
- **Why:** the critic asked for blind counting. M07 already honours it end to end: `isBlindCountJob()` in `task-handlers/count.ts` reads `settings.count.blindCount`. When it is true, the sheet API (`countSheet`) and quick count lookup (`instantLocation`) withhold `systemQty`, and `CountEntryTable blind` hides System qty, Difference, "Use system qty" and "Fill blanks". The unit test `counts-round2.test.ts › blind count` covers it. Until the schema carries the key, a job type save strips it, so there is no UI to turn it on yet.

### REQ-10 — Count Task Details: SKU / Product Name / Barcode for count tasks
- **Owner:** fulfillment-jobs (M03), `/tasks/count` grid source.
- **Change:** location-type count tasks have `tasks.product_id = NULL`. Fill SKU, Product Name and Barcode from the counted buckets (`count_line_entries` by `tasks.count_line_id`) or, before counting, from the expected buckets (`inventory` at `tasks.source_location_id`, limited to `tasks.source_lp_id` when set). Show one SKU, or "first SKU +N" with the full list in a tooltip. Use the same shape as M07's `skuList` column in `counts-grids.ts` `LINE_COLUMNS`, which can be copied as is.
- **Why:** critic round 1 found SKU, Product Name and Barcode showing "—" on every count task. Logiwa shows "SKU3, qty 200, b-1-4".

### REQ-11 — Count jobs on the job page: Actual Start, Wave label
- **Owner:** foundation (`src/server/domain/progress.ts` `rollupJob`) and M03 (`src/components/jobs/job-detail-page.tsx`).
- **Change:**
  1. In `rollupJob`, when a job goes Pending → Completed in one step, also set `startedAt = job.startedAt ?? now`. Today only Pending → Started stamps it, so one-task jobs show Actual Finish with no Actual Start. M07 now stamps `jobs.started_at` when the first count task executes (`executeCount`), but other task types still have the gap.
  2. For `operationType = "Count"`, replace the WAVE field ("Manual allocation") with "Count plan" plus a link to `/counts/{countPlanCode}` (`jobs.count_plan_id`), and "Wave rule" when `wave_rule_id` is set.

### REQ-12 — Shared picker / change-log polish seen from counts
- **Owner:** foundation.
- `src/components/shared/record-picker-modal.tsx`: the body uses `h-[65vh]` inside a `size="full"` dialog (`h-[calc(100vh-48px)]`). That leaves about 140 px of blank space under the footer at 1440×900. Use `min-h-0 flex-1` instead. M07 now uses a local `count-picker-modal.tsx` with that fix, and other modules still show the gap.
- `src/components/shared/change-log-drawer.tsx` `changeLogMessage`: run status values through `statusLabel()`, so the drawer reads "Ready to Count", matching the pills, not "Ready To Count". Also render a status entry whose `fromValue` is "—" as "created (X)" rather than "— --> X". M07's timeline does this locally (`count-timeline.tsx` `countChangeMessage`).

## Round 2 requests
- (Round 5) REQ-11 is still open: `useGrid` / `DataGrid` (src/components/grid) should show a typed, recoverable "Could not load. Retry" state when the list endpoint returns a non-JSON 5xx (HTML error page in dev), not a blank grid. The count pages already pass `onRetry` through `useGrid`; they need the grid to handle the HTML-500 parse failure.

### REQ-13 (round 6) - Segregation of duties: default operator role must not approve its own count variance
- **Owner:** foundation, `src/server/auth/permission-catalog.ts` (operator default derivation around `OPERATOR_DENIED_ACTIONS` / `OPERATOR_FULL_GROUPS`).
- **Problem (critic r5, major):** the default operator (Warehouse Clerk) role gets the whole `inventory.count_plans.*` group. As a result POST /api/counts (201), POST /api/counts/cancel (200) and POST /api/counts/update-inventory (200) all succeed, so a clerk can count and then post their own variance.
- **Change:** for the operator default, deny the following actions so they become manager/admin-only:
  `inventory.count_plans.{create,edit,delete,import_file,cancel,update_inv,create_job}`,
  `inventory.count_location_details.{cancel,create_recount,update_inv,delete}`,
  `inventory.count_sku_details.{cancel,create_recount,update_inv,delete}`,
  `mobile.cycle_count.complete_count_and_update_inventory`, `mobile.instant_count.complete_count_and_update_inventory`.
  Keep `*.view`, `*.more_details`, `mobile.cycle_count.view` (count execution, which `COUNT_EXECUTE_PERMISSIONS` accepts) and `mobile.instant_count.create_new_instant_count`. With that set, an operator Instant Count leaves its variance on the plan until a manager runs Update Inv. The UI already handles this case through `canUpdate`.
- **Suggested shape:** add `OPERATOR_DENIED_PERMISSIONS: ReadonlySet<string>` (full keys) and check it before the group rule. Re-seed or migrate an existing operator role row only when it still matches the old default.
- **M07 side:** no change needed. All count routes already gate on these keys and the UI hides the matching controls. The new `/counts/scan` handheld page shows a "View only" callout when the user has no execute permission.
- **Status:** DONE (foundation round 2, 2026-11-10): operator default denies the listed count keys; DB roles re-synced.

### REQ-14 (round 6) - Date-time picker display format vs grid format
- **Owner:** foundation, `src/components/ui/datetime-picker.tsx` / `date-picker.tsx` `DateField includeTime`.
- **Problem (critic r5, minor):** the Scheduled Count Date field shows `2026/11/09 23:54` (YYYY/MM/DD, 24-hour). The grids, detail header and timeline use `fmt.gridDateTime` (`11/09/2026 11:54 PM`). BUILD_PLAN 0.1 fixes the picker format as `YYYY/MM/DD HH:mm`, so M07 cannot change it locally without breaking that convention.
- **Ask:** either have the picker display text follow the user's date/time preference (`useFormat()`), with the typed-input parser accepting both forms, or confirm the convention stands and close the critic item as by design.

### REQ-15 (round 6) - Faster first paint for grid routes (/counts, /counts/locations, /counts/skus, /tasks/count)
- **Owner:** foundation (`src/components/grid/use-grid.ts`, app shell).
- **Measured (round 6, warm dev server):** `/api/me` arrives about 760 ms after navigation starts and `/api/counts/summary` and `/api/counts` about 1.1 s after; network idle is about 1.6 s on /counts. The remaining time is client hydration, plus the grid query waiting on grid prefs and saved views.
- **Ask:** have `useGrid` start the list fetch with the URL query in parallel with `/api/grid-prefs` and `/api/saved-views`, and re-key only when a default view applies. Alternatively, stream the first page from a server component via `HydrationBoundary`. M07 has already done its part: it prefetches `/api/counts/next-code` and refetches the status totals together with the grid.

### REQ-16 (round 3) - Count line state machine: a cancelled recount should restore the original line
- **Owner:** foundation, `src/server/domain/state-machines.ts` (`countLine`).
- **Problem:** Create Recount moves the original line to the terminal status `Recount Created`. If the recount's job is cancelled, M03's `releaseCountLines` cancels the recount line. The plan is then left with only a superseded line, so the original count result can never be posted. M07 now closes such a plan as Cancelled (`impliedPlanStatus`), not Inventory Updated, but the count work is lost.
- **Ask:** allow `Recount Created → Count Completed` in `countLine`. M07 will then reopen the original line when its recount line is cancelled, in `cancelLineWork` and in a small hook that M03's `releaseCountLines` can call. Also allow `Ready To Count → Pending` (line and plan) if foundation prefers a job cancel to return lines to Pending. M07 already handles orphaned lines either way (Re-create job).

### REQ-13 (re-raised, round 3) - operator defaults
- M07 now enforces a **four-eyes rule** on variance posting by itself (`COUNT_SELF_APPROVE_PERMISSIONS` = Count Plans Delete, or the admin role). The default operator therefore can no longer approve a variance they counted.
- The default operator can still create and cancel plans. The critic flagged POST /api/counts 201 and /api/counts/cancel 200 as the operator. The `OPERATOR_DENIED_PERMISSIONS` change in `src/server/auth/permission-catalog.ts` described in REQ-13 above is still needed.

### REQ-10 / REQ-11 (re-raised, round 3) - count tasks and count jobs (M03)
- Critic r2 still sees "—" for SKU, Product Name and Client on `/tasks/count`. The count job page still shows "WAVE: Manual allocation" and opens on an empty Orders tab. Count plans and lines link there, so the gap shows up in counts. The asks are unchanged (see REQ-10 / REQ-11 above). M07's line grid shows the job of an orphaned line struck through with a Cancelled tag, so a cancelled job is never presented as live.

### REQ-17 (round 3) - dev server: stale Turbopack module served for a route
- Seen while testing: every `GET /api/counts/[id]/sheet` for a plan with live tasks returned 500 `isBlindCountJob is not a function`, although `task-handlers/count.ts` exports it and vitest against the same DB passed. Touching the file cleared it.
- This is a dev-infrastructure issue, not M07 code. It probably explains some of the critic's intermittent results (for example the summary chips that disagreed with the grid while both used the same predicate).
- Ask: when an HMR "module factory is not available" or stale-export error appears, restart `next dev` before a critic pass.

## Round 2 requests
- REQ-10, REQ-11, REQ-16: implemented by M07 under the blind-judge repair round, with the shared edits kept minimal: `tasks.ts` SKU fallback, `jobs.ts` + `job-detail-page.tsx` count plan link, `state-machines.ts` Recount Created → Count Completed. M03 and foundation owners: please review.
- REQ-17 (again): the dev server's dynamic `[id]` routes all return 500 "Jest worker encountered 2 child process exceptions". Please restart `next dev` before the next blind judgment.

## Round 2 requests
- REQ-17 (orchestrator): the shared `next dev` on :3000 is hung (about 6.4 GB, requests time out). Restart it so counts can run the headless re-verification and the blind walkthrough. M07 code was not touched by the restart.
- REQ-17 (blind round 3, 2026-11-10): the shared `next dev` on :3000 still does not answer (`/api/health` and `/login` time out at 120 s, Playwright `GET /api/counts` times out at 30 s). The run brief forbids killing it, so the counts builder did not restart it. Whoever owns the server: restart it, then run `kitstak-critic/counts/b3/tour.mjs`. That script times all five counts routes, checks sort and filter on every [S] column, and replaces the r8 captures.

## Round 2 requests
Counts round 4 (parity loop), 2026-11-10:
- **REQ-17 (dev server, blocker):** `next dev` on :3000 is still unresponsive. `/api/health` timed out at 30 s and again at 60 s during this round. The critic's round 3 log shows the Turbopack worker pool crashing ("Jest worker encountered 2 child process exceptions") plus `write EPIPE`, likely memory pressure from concurrent agents. Infra/orchestrator: restart it, cap the concurrent Playwright workers, then re-run `kitstak-critic/counts/r3crit/flow2.mjs` and `roles.mjs` and the new `kitstak-critic/counts/r4/` checks.
- **REQ-18 (foundation, `src/lib/format.ts` / `src/components/grid/cells.tsx` DateCell):** one date-time render can come out 12-hour ("11/10/2026 12:06 AM") and another 24-hour ("11/10/2026 00:06") for the same value. The format changes between SSR, hydration and the preference load. Please:
  - render a stable default until `/api/me` preferences arrive, the same on server and client;
  - apply the user/company `timeFormat` everywhere `fmt.gridDateTime` is used;
  - make the date-time picker display (the wizard shows "2026/11/10 01:19") follow the same `dateFormat` (see REQ-14).
  Counts uses only the shared `DateCell`/`fmt`, so the fix belongs in the shared formatter.
- **REQ-19 (foundation, `src/components/grid/data-grid-columns.tsx` `cellPlacement`):** commit 5ae40b0 added a left-edge scrim on `meta.sticky: "right"` cells. The refactor into `data-grid-body.tsx` / `cellPlacement` dropped it, so a frozen right column cuts the neighbouring cell with a hard edge. Counts now adds the scrim itself through `meta.cellPadding` (`STICKY_EDGE_SCRIM` in `counts-columns.tsx`). Please restore it in `cellPlacement` for every grid; counts will then drop its copy.
- **REQ-20 (foundation, `src/components/grid/grid-footer.tsx`):** while the first page loads, the footer reads "Total: —". Please show "Total: loading…" or a small skeleton. The counts pickers now show a "Loading locations…" status line and a footer note of their own.
- **REQ-21 (foundation, `scripts/verify-ledger.ts`):** please make `db:verify` call `findCountPlanStatusDrift` from `src/server/repositories/counts-integrity.ts`. It should report any count plan that reads Inventory Updated while no line reached Inventory Updated. Counts used this function to repair KS-R3-E2E-55265 (now Cancelled, with a change-log row) and has a unit test for it.

## Round 2 requests
(Round 5 parity loop, 2026-11-10)
- **REQ-22 (foundation, `src/components/layout/app-shell.tsx` TopBar):** at 360 to 400 px the header's right group (`ml-auto flex items-center gap-1.5`: search, context switcher, Transactions, Printers, Help, Notifications, user menu) is 230 px wide and does not shrink. The document scrolls sideways to 409 px on every page, and the avatar is clipped at 400 px. Measured on `/counts/scan` (the handheld screen). Please fold Transactions, Printers and Help into the user menu (or a "More" icon) below `sm`, and give the group `min-w-0`. The counts content itself no longer overflows: the entry table renders as cards below 600 px.
- **REQ-23 (foundation, `src/components/grid/grid-toolbar.tsx`):** the left filter group is `flex-nowrap` with `min-w-0`, so at 768 px its content (search, Filter, Views, Clear) overflows under the `trailing` slot, and "Clear" is covered. Counts works around this by giving its collapsed "Actions" menu its own row below `lg` (`count-bulk-bar.tsx`). Please let the group wrap (`flex-wrap`), or move Views and Clear into an overflow menu when space runs out. Counts will then drop the workaround.
- **REQ-24 (foundation, `src/components/grid/data-grid-body.tsx`):** the expanded-row `<td colSpan>` scrolls with the grid. Counts now pins its panel to the visible width (`StickyExpansion` in `count-detail-page.tsx`, which measures the scroll box). Please add this to the grid itself, with a sticky-left wrapper of width `var(--grid-visible-width)`, so every module's expansion behaves the same way.
- **REQ-25 (foundation, `src/server/db/seed/counts.ts` `countJob`):** for a "Count Started" spec, `completedTaskCount` is written as 0 while ceil(n/2) tasks are inserted as Completed. Job005257 read "0 / 5" with 3 tasks completed. Please set `completedTaskCount` to the number of tasks seeded Completed, or call `rollupJob` after the inserts. Counts repaired the dev DB (`repairCountJobCounterDrift`, with a change-log row on the job). The detail Jobs tab now computes its counters from the task rows, so it can't show stale values.
- **REQ-26 (foundation, `scripts/verify-ledger.ts` / `db:verify`, extends REQ-21):** please also call these two checks from `src/server/repositories/counts-integrity.ts` and fail on any result:
  - `findCountJobCounterDrift` (count jobs whose `task_count` / `completed_task_count` disagree with their tasks, using the `rollupJob` rule);
  - `findOpenCountOverlaps` (a location held by an open line of more than one open plan).
  Both are unit tested in `tests/unit/counts/counts-round5.test.ts`. Counts repaired the 4 legacy overlaps in the dev DB: 5 uncounted newer lines were cancelled through the normal line cancel, and the oldest plan keeps each location. Both checks now return 0.
- **REQ-27 (M03 / domain, `src/server/domain/task-handlers/count.ts`):** count entries that arrive from the mobile task execute path, not through `/api/counts/[id]/sheet` or Quick Count, do not write the new "count submitted" timeline event. Please call `recordEntryEvent(tx, ctx, plan, { id, label }, note)` from `src/server/repositories/counts-events.ts` at the end of the count task handler's execute, and counts will then drop its calls from `submitSheetLine` / `createInstantCount`. Until then, mobile counts still show in the timeline through the line status change.

## Round 2 requests
Round 6 (parity loop, 2026-11-10):
- **REQ-28 (foundation, `src/lib/status-colors.ts` `COUNT` map):** Count Completed, Inventory Updated and Recount Created are all `green`, so a superseded Recount Created line looks posted. Please set `"count completed": "teal"` and `"recount created": "purple"` (Inventory Updated stays green). Counts overrides both in `CountStatusPill` / `countToneOf` (`src/components/counts/count-status-pill.tsx`, `COUNT_TONE_OVERRIDES`) until then, and will drop the override once the map changes. Other modules that render count statuses (jobs, tasks, reports) would then match.
- **REQ-29 (foundation, `src/components/ui/tabs.tsx` `UnderlineTabs`):** the triggers carry `aria-controls` pointing at Radix content ids, but the component renders no `TabsContent`, so no `role=tabpanel` exists on any page using it. Please accept an optional `panelId` / render prop, or export the generated ids (e.g. `tabIdsFor(key)`), so callers can render a matching `role=tabpanel`. Counts works around this in `count-detail-page.tsx` (`useTabPanelIds` reads the active trigger's `id` / `aria-controls` from the DOM).
- **REQ-30 (M05 orders / domain, `src/server/domain/allocation.ts`):** a count that finds less than is allocated now shorts unpicked shipment-order allocations before posting (`counts-ops.ts` `shortAllocations`): `jobs.releaseForLine`, then `reallocateLine` from other locations, then an `allocation_exceptions` row ("Cycle Count", "Count shortage: …") when re-allocation falls short. The order's status and `order_line_shortages` are not touched, because `setOrderStatus` / `recordShortages` are private. Please export a helper, e.g. `markLineShortage(tx, ctx, { orderLineId, shortQty, reason: "Insufficient Inventory" })`, that writes the shortage row and moves Ready to Pick → Shortage. Counts will call it right after `recordException`.
- **REQ-21 / REQ-26 (re-raised, foundation, `scripts/verify-ledger.ts`):** this is now one call. `countIntegrityIssues(db)` in `src/server/repositories/counts-integrity.ts` returns `{ check, id, message }[]` (the `VerifyIssue` shape) for plan status drift, job counter drift and open-count overlaps. Please concatenate it into `verifyDatabase`'s issues. It is unit tested; the dev DB copy returns 0.
- **REQ-10 (re-raised, foundation, `DataGrid`):** the plan Lines grid still says "Export CSV" while the list grids say "Export As Excel". Counts needs `exportGridKey` / `exportQuery` props, kept separate from the prefs `gridKey`. See the round 4 text above.
- **REQ-31 (foundation, `src/components/ui/toaster.tsx`):** toasts render bottom-right over an open dialog's footer, which covered Quick count's Submit button. Please raise the toast stack above the dialog footer, or offset it while a modal is open. Counts now shows submit errors inline in the Quick count modal, but other modals still have the problem.
- **REQ-22 (re-raised):** `/counts/scan` is still wider than the 375 px viewport, because the top bar's icon group does not shrink.
- **REQ-17 (re-raised):** the shared dev server answered `/api/health` in 74 s and 107 s during this round. `/counts/[id]` did not reach `domcontentloaded` within 420 s, so the headless visual checks could not run. `GET /api/counts/KS-CRIT-R5L-537136` returned 500 after 200 s. Since 04:38, `.next/dev/logs/next-development.log` shows repeated `write EPIPE` uncaught exceptions and "Jest worker encountered 2 child process exceptions, exceeding retry limit", and nothing has been logged after 04:43. The server looks degraded and probably needs a restart by whoever owns it. Round 6 was verified with unit tests and with a replay on a copy of the dev DB instead.

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** REQ-6 (dark-mode pills: `pillStyle` carries `--pill-fg`; dark theme swaps to a translucent tint with a lifted foreground), REQ-7 (`BulkAction.info` tooltip / menu sub-line; `GridToolbar bulkInline`; neutral disabled destructive), REQ-8 (`jobs_count_plan_idx`, `count_lines_plan_status_idx`, migration 0003), REQ-9 (Blind Count) schema part: `jobTypeSettingsSchema.count.blindCount` (the admin-settings toggle is M14's), REQ-10 (DataGrid `exportGridKey` / `exportQuery`, plus `exportMode`), REQ-11 (rollupJob stamps `startedAt` on a direct Pending → Completed), REQ-12 (record picker body `min-h-0 flex-1`; drawer status values read like the pills), REQ-15 partly (grid prefs no longer hold the grid: 3 s timeout), REQ-19 (sticky-right scrim restored as a positioned `::before` gradient), REQ-21 / REQ-26 (`db:verify` runs `countIntegrityIssues`), REQ-22 (header right group `min-w-0`; Transactions/Printers fold away below sm), REQ-23 (toolbar filter group wraps), REQ-24 (expanded row panel pinned to `--grid-visible-width`), REQ-25 (seed `completedTaskCount` for Count Started; open-plan overlap removed from the seed; dev DB repaired), REQ-28 (Count Completed teal, Recount Created purple), REQ-31 (toasts top centre, clear of dialog footers).
- **Not done:** REQ-5 (M03), REQ-14 / REQ-18 picker display format (convention 0.1), REQ-16 Ready To Count → Pending, REQ-20 (footer shows "—"), REQ-27 (M03 task handler), REQ-29 UnderlineTabs panel ids, REQ-30 `markLineShortage` export, REQ-17 (dev server).

## Blind-judge repair round 1 (2026-11-10) - status
- **REQ-1 verified closed.** The ledger enforces count locks: `assertNotCountLocked` is called from `rules.ts` (`assertLocationAccepts` unless in place, and `assertSourceMovable`) and from `allocations.ts`. Live check against :3000: a plan with Lock Locations on A-01-03-1, then `POST /api/inventory/transfer-product` out of it returned `RULE_VIOLATION` "Location A-01-03-1 is locked by count plan KS-JR1-LOCK-98. Finish, update or cancel the count first." The test plan was deleted afterwards. Unit test: `counts-judge-r1.test.ts` "ledger count lock (REQ-1)".
- **Shared change made (minimal, backward compatible):** `src/server/auth/login.ts` + `rate-limit.ts` `refundRateLimit`. A successful sign-in now gives back its per-IP hit, so the login IP bucket (5/min, shared as "direct" without TRUST_PROXY) only throttles failed attempts. A scanner fleet behind one NAT can sign in at shift start. Failed attempts, the 10/15 min per-account limit and lockout are unchanged; the existing f3 test still passes.
- **Ask (foundation, optional):** document `TRUST_PROXY=1` in the deploy guide for sites behind a reverse proxy, so each handheld gets its own IP bucket.
