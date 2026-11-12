# M03 fulfillment-jobs — shared-change requests

## REQ-1 — Permission catalog: confirm job-type and wave keys
- **File:** `src/server/auth/permission-catalog-data.ts`
- **Change:** none expected; verify the generated keys `settings.job_types.{view,create,edit,delete,change_log}`, `automation.wave_rules.run`, `fulfillment.task_details.{execute_task,update_task,cancel_task}` and the `fulfillment.job_management.*` print/assign keys used in `src/app/api/{jobs,tasks,job-types,wave-rules}/**` match the catalog spelling (`page("job_types", …, ["View","Create","Edit","Delete","Change Log"])` → `change_log`).
- **Reason:** M03 routes gate on these exact strings; a spelling drift would 403 every non-admin role.
- **status:** DONE (pass 1): resolved (verified against the catalog 2026-11-06; no change needed)

## REQ-2 — `allocation.recordException()` domain helper
- **File:** `src/server/domain/allocation.ts`
- **Change:** export
  ```ts
  export function recordException(tx: Tx, input: { orderId: string; warehouseId: string; clientId: string | null; waveId: string | null; waveNo: string; waveRuleName: string | null; explanation: string; runBy: string; algorithmName?: string | null; algorithmRuleName?: string | null }): void
  ```
  inserting into `allocation_exceptions` (same shape `allocateOrders` writes today).
- **Reason:** wave execution writes "Eliminated by Job Type '…' Condition(s)" rows for orders no job type accepts. `src/server/repositories/waves-run.ts` `recordElimination()` inserts the row directly as a local adapter until this lands; it will switch to the helper.
- **status:** applied (F-patch 2026-11-06): `allocation.recordException(tx, input)` exported from `src/server/domain/allocation.ts` with the requested input (throws VALIDATION when `clientId` is null, since the column is NOT NULL).

## REQ-3 — `orders.mergeOrders()` domain command
- **File:** `src/server/domain/orders.ts`
- **Change:** export `mergeOrders(tx, ctx, { masterOrderId, childOrderIds })` implementing the contract documented on `unmergeOrder`: children → On Hold with `mergedIntoOrderId = master`, child lines copied onto the master with `originalOrderCode`, master `isMerged = true`, totals recomputed, change_log rows on both.
- **Reason:** Order Merge wave rules (BUILD_PLAN M03 §3). `runOrderMerge()` in `src/server/repositories/waves-run.ts` performs these writes as an adapter until the domain command exists; it will delegate once it lands so unmerge stays symmetric.
- **status:** applied (F-patch 2026-11-06): `mergeOrders(tx, ctx, { masterOrderId, childOrderIds })` in `src/server/domain/orders/commands.ts` (exported via `@/server/domain/orders`). All orders must be Open, unmerged, outside a job, same warehouse + client; lines copied with `originalOrderCode`, children On Hold with `mergedIntoOrderId`, master `isMerged` + `totalQuantity`, change_log on both. Returns `{ merged }`. Round-trip with `unmergeOrder` unit-tested.

## REQ-4 — Scheduler runner: pick up task-list changes after HMR
- **File:** `src/server/scheduler/index.ts` (`sharedRunner`) / `src/server/scheduler/runner.ts`
- **Change:** have the runner read `SCHEDULER_TASKS` from the registry on every tick (or recreate the `globalThis.__kitstakScheduler` runner when the registry's task identity changes) instead of capturing the task list once at creation.
- **Reason:** the shared dev server's runner was created before `tasks/wave-rules.ts` replaced its stub, so `/api/health` reports `wave-rules configured:false` and scheduled wave rules never fire until a full server restart. M03 acceptance "scheduler runs the rule automatically with Run By Integration" can't be observed live without it (logic is unit-tested in `tests/unit/fulfillment-jobs`).
- **status:** applied (F-patch 2026-11-06): `src/server/scheduler/index.ts` records the task list the shared runner was built with on `globalThis.__kitstakSchedulerTasks`; when the registry array identity changes (dev HMR), the runner is stopped and recreated with the new tasks (restarted if it was running). Checked on module evaluation, start, tick and heartbeat, so the live dev server picks it up without a restart.

## REQ-5 — Job/task assignee change-log rows show a raw user id
- **File:** `src/server/domain/jobs.ts` (assign/unassign, ~line 315-317) and the task assign path in `src/server/domain/tasks*.ts`
- **Change:** log the assignee as a display value: `before: { assignee: <old user name or null> }, after: { assignee: <new user name> }` (field label "Assignee"), or have `recordUpdate` accept a `display` map so `assignedToUserId` renders the user's name. Alternatively, resolve `*UserId` fields to user names in `GET /api/change-log`.
- **Reason:** the job detail Timeline (shared `ActivityTimeline`) currently shows `Assignee is modified. --> c6929c9b-8aff-…` — a raw UUID in the UI (A0 "no raw UUIDs").
- **status:** applied (F-patch 2026-11-06): `jobs.assign` / `unassign` log `assignee` (label "Assignee") as the user's name (`userDisplayName`, exported) instead of `assignedToUserId`. No task-assign path writes user ids to change_log. Rows written before this change still hold ids.

## REQ-6 — `FilterPopover` editor form: stop submit propagation
- **File:** `src/components/grid/filter-builder/filter-popover.tsx` (`EditorPanel` `<form onSubmit>`)
- **Change:** add `e.stopPropagation()` next to `e.preventDefault()`.
- **Reason:** the popover is portalled out of the DOM but not out of the React tree, so pressing Apply inside a wizard (wave-rule Selection, job-type Conditions) also submitted the wizard form and jumped to the next step. M03 wraps its `ConditionsEditor` with a local `onSubmit` stopPropagation as an adapter; other modules embedding `FilterPopover` in forms hit the same bug.
- **status:** applied (F-patch 2026-11-06): `e.stopPropagation()` added in `EditorPanel` `onSubmit`. M03's local adapter can be removed.

## REQ-7 — `/api/change-log` entity types: add `wave_rule`, `job_type`
- **File:** `src/app/api/change-log/route.ts` (entityType enum)
- **Change:** allow `wave_rule` and `job_type` (permission `automation.wave_rules.change_log` / `settings.job_types.change_log`).
- **Reason:** the shared `ChangeLogDrawer` 400'd for wave rules/job types. M03 now uses a local `RecordChangeLogDrawer` over its own `/api/{wave-rules,job-types}/[id]/change-log` endpoints, so this is optional (only needed if the shared drawer/timeline should work for these records elsewhere).
- **status:** applied (F-patch 2026-11-06): `wave_rule` (automation.wave_rules.view/edit/change_log) and `job_type` (settings.job_types.view/edit/change_log) registered in `src/server/repositories/platform-entities.ts`, so `/api/change-log` and the shared drawer accept them.
- **Foundation pass 1 (2026-11-09):** verified all REQs above are DONE (pass 1); no further shared change pending.
- **Foundation pass 2 (2026-11-09):** re-verified against the code; all REQs above DONE (pass 2), no further shared change pending.

## Round 2 requests

- **R2-1 (shell / nav-config, foundation):** the top-nav highlight follows `nav-config.ts` menu placement, so `/jobs/wave-rules` lights "Automation" and `/jobs/wave-log` lights "Reports" while `/jobs` lights "Fulfillment". Please resolve the active top-nav item for any route in the `jobs` page-tab group (`src/config/page-tabs.ts`) to "Fulfillment" (for example an `activeSection` override on the tab group, or match on the longest `/jobs` prefix first). Breadcrumbs are already pinned to `Home > Fulfillment > Jobs > <page>` inside M03's `ListShell`.
- **R2-2 (grid, foundation):** `filter-chips.tsx` `ChipBody` stacks label/value on two lines inside `h-9`, and when the toolbar is crowded the chip shrinks to ~80px, so the value truncates to "Pen...". Please render a single-line `Label: value` chip with `min-w-[160px]` (tooltip already set via `title`).
- **R2-3 (grid, foundation):** the column-settings icon in `data-grid-header.tsx` overlays the last visible header cell; reserve its width (right padding on the header row) so the last header is not covered.

### Round 2 (parity loop, critic 6.4) — new requests, 2026-11-09
- **R2-4 (domain, foundation) `domain/jobs.cancelJob`:** it refuses any job with a completed task and only sweeps tasks that carry an order (Count / Replenishment tasks stayed Pending under a Cancelled job). M03 now routes every cancel through `repositories/jobs-commands.ts` (`cancelJobCascade`), and the wave-rules scheduler's Delete-if-not-started does too. Please either delegate `cancelJob` to the same semantics, or document it as "orders-only", so other callers (work orders, orders bulk) don't reintroduce orphaned tasks.
- **R2-5 (domain, foundation) `domain/jobs.updatePriority` / `assign`:** neither bumps `jobs.version`. M03 bumps it in `jobs-commands.ts`; the domain functions should bump it too, so non-M03 callers stay consistent.
- **R2-6 (domain, foundation) `domain/tasks.cancel`:** cancelling a pick task does not reduce or cancel the matching Packing / Sorting / Loading tasks. M03's `cancelTasksCascade` does this; `/api/ops/tasks/cancel` (`platform-ops.cancelTasks`) still uses the bare domain call. Please point it at `jobs-commands.cancelTasks`.
- **R2-7 (domain, foundation) `facts.bucketFacts`:** add `sku`, `itemWeight`, `itemVolume`, `locationRack`, `locationPosition`, `product.{textBox,dropDown,toggle,date}{1..3}` and `location.custom{1..3}`. The job-type "Order by picking method" list now offers these (Logiwa parity), but until the facts exist they sort as no-ops.
- **R2-8 (lib, foundation) `jobTypeSettingsSchema.picking`:** add `retailerFlowType`, `uccLabelScanningType` and `defaultRetailerLabelPrintOption` (enabled when template = "Retailer Compliance"). Once they exist, M03 will render them in the job-type Settings step.
- **R2-9 (ui, foundation) `ui/tabs.tsx` UnderlineTabs:** the critic saw a boxy red outline after a mouse click on the job-detail tabs. The trigger already uses `focus-visible:ring`; the global `:where(:focus-visible)` outline in `globals.css` seems to win on Radix's programmatic focus. Please set `outline-none` on the triggers and the list, so only the ring shows (I could not verify live: the dev server was unresponsive).
- **R2-2 (repeat):** the filter chip still squeezes to "JOB STATUS × Pen…" at 1440 with the full toolbar, and to "JOB STATU P" at 768. Please give the chip `shrink-0 min-w-[160px]` with a single-line `Label: value`; the shared toolbar already wraps `trailing` to a second row.
- **Foreign edits (for the integrate phase):** while this round ran, another agent edited M03-owned files: `components/jobs/{list-shell,job-actions,job-detail-page,report-pages,use-permissions}.tsx`, `components/wave-rules/{wave-rules-page,wave-rule-steps}.tsx`, `lib/grid-defs/jobs/{columns,reports}.ts`, `server/repositories/{waves,waves-run}.ts` and `app/api/wave-rules/run/route.ts` (keepSelection refresh, `assertRuleRunnable`, pick-path pluralization, breadcrumbs). I merged my changes on top of theirs and reverted nothing.
- **R2-10 (foundation) `/api/ops/tasks/cancel` + `platform-ops.cancelTasks`:** these still call `domain/tasks.cancel` without the downstream cascade, so cancelling a pick task leaves its pack, sort and loading tasks Pending. Please delegate to `repositories/jobs-commands.cancelTasks` (M03), which reduces or cancels the dependent tasks, flags partial orders pick short and sends fully cancelled orders back to Open. Better still, move that cascade into `domain/tasks.cancel`.
- **R2-11 (foundation) `domain/jobs.cancelJob`, `assign`, `updatePriority`:** none of these bump `jobs.version`. M03 now wraps them in `jobs-commands.ts`: it bumps the version, checks an optional `versions` map and fails a stale write with CONFLICT. Any other caller of the raw domain functions (for example work orders' `cancelPicking`) still skips the version bump, so please add the bump in the domain. `cancelJob` also only cancels tasks of orders it detaches: a Count, Replenishment or Work Order job keeps its tasks Pending. M03's cascade covers this from the API and the scheduler.
- **R2-12 (foundation seed) wave rules:** `seed/config.ts` inserts scheduled rules ('B2B Wholesale Wave', 'D2C Daily Waves') with `next_run_at` NULL. M03 now self-heals this through `wave-rules.ensureNextRuns`, called on every scheduler tick and grid list. Please still compute `nextRunAt` at seed time, and seed one Replenishment and one Order Merge rule for MLT1, plus `order_merge_rule` lookup values, so those waves can be shown live.
- **R2-13 (shared) `/api/change-log` + `ActivityTimeline`:** the job Timeline shows the actor as the raw `source` email ("admin@kitstak.io"). Please return the user's display name (join `users` on `change_log.user_id`) and keep the email as a tooltip. M03's own change-log drawers (wave rules, job types) and the allocation-exception and wave-log "Run by" now show names.
- **R2-14 (counts, M07):** cancelling a Count job (from Job Management or the wave-rule delete schedule) cancels its tasks, but the count plan lines stay open and locations locked by "Lock Locations" stay locked. Please expose a `counts-commands.onCountJobCancelled(tx, ctx, jobId)` hook that M03 can call to release the locks and reset the lines.

### Round 4 additions (2026-11-09)
- **R4-1 (grid footer, foundation `src/components/grid/grid-footer.tsx` + `data-grid.tsx`):** while the first list fetch is pending, the footer reads "Total: 0 / Selected: 0" and Export looks enabled. Please pass `loading` to `GridFooter`, render "Total: —" (or a small spinner) and disable `ExportButton` until the first page lands. The body's inline error and Retry already exist; please confirm an HTML (non-JSON) 500 from the list call reaches `list.error`, and does not leave the skeleton up forever.
- **R4-2 (grid header, `src/components/grid/data-grid-header.tsx`):** `InfoTip` follows the sort button with no gap, so it touches the label ("LAST EXECUTED BY ⓘ" runs into the next header), while on STATUS the hidden sort arrow leaves a wide gap before the icon. Please add `ml-1` to the InfoTip and reserve the sort-arrow slot only when sorted or hovered, so the spacing is the same on every column.
- **R4-3 (domain `src/server/domain/jobs.ts` `createJobsFromOrders`, line ~207):** `plannedStartAt` is `now + 1h`, so a job that a picker starts at once shows Planned start after Actual start (Job005269). Please make it `now` (planned end = start + tasks × minutesPerTask), or take it from the wave rule's schedule.
- **R2-1 / R2-2 still open:** the top-nav highlight for `/jobs/wave-rules` (lights Automation) and `/jobs/wave-log` (lights Reports) should follow the `jobs` tab group (Fulfillment). The filter chip should render on a single line.

### R5-1 (foundation, `src/server/db/index.ts`)
Add `sqlite.pragma("busy_timeout = 5000")` (and consider `synchronous = NORMAL`) next to `journal_mode = WAL`. Under concurrent writers, `GET /api/shortages` returned 500 after 47 s (critic R4). This looks like lock contention, not a slow query: all M03 grid queries run in milliseconds on their own.
- **Status:** DONE (foundation round 2, 2026-11-10): `busy_timeout = 5000` and `synchronous = NORMAL` set in `src/server/db/index.ts`.

### R5-2 (foundation, `src/components/grid/grid-footer.tsx`)
R4-1, restated. Accept a `loading` prop and render "Total: —" while it is set; DataGrid should pass `loading`. M03 currently works around this with scoped CSS in ListShell, which can be removed once the prop exists.
- **Status:** DONE (foundation round 2, 2026-11-10): GridFooter `loading` prop; ListShell CSS workaround can go.

### R5-3 (foundation, top-nav config)
R2-1 is still open. Every route in the `jobs` tab group (`/jobs`, `/jobs/wave-rules`, `/jobs/wave-log`, `/jobs/allocation-exceptions`, `/jobs/shortage`) should highlight **Fulfillment** in the top nav, matching the breadcrumb. Today `/jobs/wave-rules` highlights Automation, and the other three highlight Reports.

### Round 6 additions (2026-11-09)
- **R6-1 (foundation `src/server/domain/progress.ts` `rollupJob`):** when a job moves straight to Completed, set `patch.startedAt = job.startedAt ?? <first task started_at/finished_at> ?? nowIso()`. Today an instant count completes with `startedAt` null (Job005275). M03 hides this on the read side for now.
- **R6-2 (R2-1 still open, `src/config/nav-config.ts` / shell):** the top-nav highlight still follows menu placement (Wave Rules lights Automation, Allocation Exceptions lights Reports). Please resolve any route in the `jobs` page-tab group to "Fulfillment".
- **R6-3 (perf, `src/server/api/define-route` / dev server):** M03 list SQL runs in 1 ms or less against the live DB, but route latency swings 0.9–17 s between consecutive identical calls. Please profile the shared route pipeline (auth/session lookup, permission load, grid parse) under concurrent dev load, or consider a production build for critic timing.
- **R6-4 (optional, `src/server/domain/jobs.ts`):** M03 now derives a cancelled job's order history from its tasks. A `released_at` column on `job_orders` (keeping the row instead of deleting it) would make this explicit.


### Round 3 additions (2026-11-10)
- **R3-1 (foundation `src/server/auth/permission-catalog.ts` and a data migration, critic major):** the operator (Warehouse Clerk) role holds supervisor actions: `fulfillment.job_management.cancel`, `fulfillment.job_management.update_priority`, `fulfillment.job_management.override_job_cancel_warning`, `fulfillment.task_details.cancel_task` and `fulfillment.shipment_orders.picking_job_operations` (used by shortage Retry allocation). Please:
  1. Add an `OPERATOR_DENIED_KEYS` set (exact keys, not the action names, because a bare "cancel" would also hit other pages) and exclude it in `isOperatorPermission`.
  2. Remove these keys from the seeded system role `operator` in existing DBs (a `role_permissions` delete for the operator role).

  The M03 API and UI already gate on these keys, so no M03 change is needed.
- **R3-2 (R2-1, third request):** every route in the `jobs` tab group should highlight Fulfillment. `activeMenuKey` in `src/config/nav-access.ts` resolves `/jobs/wave-rules` to Automation and `/jobs/{wave-log,allocation-exceptions,shortage}` to Reports.
- **R3-3 (grid, `grid-prefs.ts` / `data-grid.tsx`):** support a default left pin per column, for example `meta.defaultPinned` seeding `defaultGridPrefs().pinned`, so Job code stays next to the checkbox at tablet width. M03 now puts Job code first as a workaround.
- **R3-4 (schema, optional):** AI facts are derived. The AI type is in `jobs.job_type` (prefix `AI-`), the original type comes from `job_type_id`, and the sequence is in `tasks.sequence`. If explicit columns are wanted (`jobs.is_ai`, `jobs.ai_description`, `tasks.ai_sequence`), M03 will switch over.
- **R3-5 (another module):** `src/components/orders/detail/order-detail-tabs.tsx:105` has a JSX parse error ("Expected '</', got ':'"). The Next dev overlay it raises blocked M03's UI verification.

## Round 2 requests

### Round 4 additions (2026-11-10, critic 7.8)
- **R4-1 (foundation, critic major; repeats R3-1 and adds Assign/Unassign).** Files: `src/server/auth/permission-catalog.ts`, plus a data migration for the system `operator` role.
  - Exclude these exact keys from `operator`:
    - `fulfillment.job_management.update_priority`
    - `fulfillment.job_management.cancel`
    - `fulfillment.job_management.assign`
    - `fulfillment.job_management.unassign`
    - `fulfillment.job_management.override_job_cancel_warning`
    - `fulfillment.task_details.cancel_task`
  - Delete the same keys from `role_permissions` for the existing `operator` role.
  - Live check: the Warehouse Clerk role (`80e004bf-…`) still holds all six keys, so `POST /api/jobs/actions {action:"priority"}` as j.okafor returns 200.
  - System roles are view-only through `PATCH /api/roles/[id]`, so M03 cannot do this itself.
  - The M03 UI already shows these actions disabled with "Supervisor permission required…" for floor users. The server gates on exactly these keys, so it returns 403 as soon as they are removed.
- **R4-2 (foundation, fourth request for R2-1). File: `src/config/nav-access.ts`.**
  - `activeMenuKey` resolves the top-nav item through `resolveNearestRoute(pathname).section`. Every route in the `jobs` page-tab group should resolve to "Fulfillment". Today Wave Rules highlights Automation and the three reports highlight Reports.
  - Minimal patch: before the registry lookup, add `if (pathname === "/jobs" || pathname.startsWith("/jobs/") || pathname.startsWith("/tasks")) return menus.find((m) => m.label === "Fulfillment")?.key ?? null;`.
  - Alternative: give the route-registry entries for `/jobs/wave-rules`, `/jobs/wave-log`, `/jobs/allocation-exceptions` and `/jobs/shortage` the section "Fulfillment".
- **R4-3 (foundation, R2-8 again). File: `src/lib/domain-types.ts`, `jobTypeSettingsSchema.picking`.**
  - Add:
    - `retailerFlowType: z.enum(["Standard", "Pick & Pack by Retailer", "Retailer Label at Packing"]).default("Standard")`
    - `uccLabelScanningType: z.enum(["None", "Scan at Packing", "Scan at Loading"]).default("None")`
    - `defaultRetailerLabelPrintOption: z.enum(["None", "Print at Packing", "Print at Shipping"]).default("None")`
  - The object strips unknown keys, so M03 cannot store these settings yet. Once they exist, M03 renders them in the Settings step when the template is "Retailer Compliance".
- **R4-4 (grid). File: `src/components/grid/data-grid-header.tsx`.**
  - Every DataGrid page logs a React hydration mismatch at the `_select` header cell inside `SortableContext`: the dnd-kit `aria-describedby` and the Radix Checkbox `id` differ between server and client. Seen on `/jobs/wave-rules` in the console check.
  - Fix: render the sortable header client-only, or pass a stable `id` to `DndContext` (`<DndContext id={"grid-" + gridKey}>`).

### Round 5 additions (2026-11-10, critic 7.3)
- **R5-1 (foundation `src/server/domain/progress.ts` `rollupJob` and `src/server/domain/tasks.ts` `reopenIfEmpty`): zombie jobs.**
  - `reopenIfEmpty` clears `shipment_orders.job_id` but leaves the `job_orders` row in place.
  - `rollupJob` never closes a live job that has no Pending or Started task left.
  - Please:
    1. Delete the `job_orders` row in `reopenIfEmpty`.
    2. In `rollupJob`, when the job has tasks and none are open, move it to Cancelled (0 completed) or Completed (some completed) and write the status change-log row.
  - M03 covers this today in `src/server/repositories/jobs-settle.ts` (`settleJob` / `settleDeadJobs`, called from M03 commands, the jobs read routes and the scheduler). Once the domain does it natively, the sweep becomes a no-op.
- **R5-2 (foundation `scripts/verify-ledger.ts` / `src/server/db/seed/verify.ts`): wire `jobsInvariants(db)` from `src/server/repositories/jobs-invariants.ts` into `db:verify`.**
  - It returns three counts: `wave_jobs_created_mismatch`, `dead_live_jobs` and `stale_job_orders`. Each must be 0.
  - All three are 0 on the dev DB after the round-5 data fix.
- **R5-3 (foundation `src/server/auth/permission-catalog.ts` and `scripts/sync-system-roles.ts`): R4-1, still open.** Add these six keys to `OPERATOR_DENIED_PERMISSIONS`:
  - `fulfillment.job_management.update_priority`
  - `fulfillment.job_management.cancel`
  - `fulfillment.job_management.assign`
  - `fulfillment.job_management.unassign`
  - `fulfillment.job_management.override_job_cancel_warning`
  - `fulfillment.task_details.cancel_task`

  Then re-sync the `operator` system role. M03 now enforces the rule itself (`src/lib/grid-defs/jobs/supervisor-policy.ts`), so the M03 routes return 403. The catalog still lists these keys under Warehouse Clerk in Settings > Roles, though.
- **R5-4 (platform API owner, `src/server/repositories/platform-ops.ts` `TASK_PERMISSIONS.cancel` and `platform-entities.ts` job `edit: job_management.assign`).** Public API task cancel and job edit check only `can()`. Please gate them with `canJobAction` from `src/server/repositories/jobs-policy.ts`, or apply R5-3, so floor API users get 403 there too.
- **R5-5 (foundation `src/lib/domain-types.ts`, R4-3 again).** M03 now stores the retailer settings under `settings.retailer` through `jobTypeSettingsInputSchema` in `src/lib/grid-defs/jobs/forms.ts`. If the domain needs them (UCC label generation at packing), move `retailerSettingsSchema` into `jobTypeSettingsSchema` with the same key, and M03 will switch its import.
- **R5-6 (shipping owner):** `db:verify` reports `shipped_without_label=1` for SO010845, shipped at 09:26Z through a job. This is not caused by M03; please investigate.

### Round 6 parity-loop additions (2026-11-10)

- **R6b-1 (foundation `src/server/api/define-route.ts` `actor`, `src/server/db/schema/platform.ts` `change_log.source`): use one actor convention across the app.**
  - Today user actions store `source` = the email, settles store "System", and the wave log stores display names. Excel exports and other change-log readers that don't join `users` show raw emails.
  - Proposal: keep `user_id` as the identity and write the display name to `source` (`auth.user.name || auth.user.email`). Update the schema comment.
  - M03 already does this for its own entities (job, wave_rule, job_type, wave) with `withM03Actor` (`src/server/repositories/jobs-actor.ts`). 399 dev-DB rows were backfilled.
  - Order and line rows that M03 actions write through the domain keep the email until this lands. After that, `withM03Actor` becomes a no-op.
- **R6b-2 (orders-outbound, order grid and detail status cell): show a "Pick short" badge next to the order status when `shipment_orders.pick_short_status = 'Open'`.**
  - Case: a partial execute without a resolution job moves the order to Ready to Pack with a reduced packing task.
  - The domain sets the flag (`markOrderShort`), but the order screens don't show it, so a short shipment goes unnoticed. The M03 job grid and job detail already show it.
  - M03 now defaults "Create resolution job" ON in Task Details → Execute when free stock exists elsewhere. The server uses the same default when `createResolutionJob` is omitted.
- **R6b-3 (catalog, `/api/products/demo-image/*.svg`): thumbnails return 404 on the production build.** This breaks the Product image column on `/tasks/order-operations` and `/tasks/replenishment` and logs console errors.
  - Please make sure the route is built.
  - Please return the placeholder SVG (200) for a missing image instead of a 404.
- **R6b-4 (foundation `src/components/layout/shell-skeleton.tsx` `ShellSkeleton` / `PageSkeleton`, used by `src/app/(app)/layout.tsx`): make the slow and failed notices work without JavaScript.**
  - Re-checked on :3000 under load: the 6-minute skeleton the critic saw on `/jobs` is the app-shell `ShellSkeleton` (dark header bar plus a generic grid). The (app) layout suspends before any M03 page fallback renders, and its client `SlowLoadNotice` never hydrates.
  - Drop-in fix: render `StaticSlowNotice` from `src/components/jobs/jobs-page-skeleton.tsx` (or a copy of it) in `ShellSkeleton`. It is a server component with CSS-timed notices and a plain reload link.
  - `SlowLoadNotice` is a client timer. When the dev server is overloaded, the client chunks never hydrate and the skeleton shimmers forever with no message.
  - M03 pages now use `src/components/jobs/jobs-page-skeleton.tsx`. It shows a slow notice at 6 s and an error at 30 s using CSS animation delays, and Retry is a plain `<a href="">`. The shared skeleton could do the same.

## Foundation round 2 pass (2026-11-10, shared-code owner)
- **DONE:** R2-1 / R5-3 / R6-2 / R3-2 / R4-2 (already: /jobs and /tasks hub → Fulfillment), R2-2 (single-line chips), R2-3 (chooser gutter), R2-5 / R2-11 (`domain/jobs.assign` / `updatePriority` bump `jobs.version`; the M03 wrapper no longer bumps twice), R2-9 (tabs already fixed), R2-13 (`/api/change-log` returns `userName`; drawer and timeline show it with the email as tooltip), R3-1 / R4-1 / R5-3 (operator denied job_management update_priority / cancel / assign / unassign / override_job_cancel_warning and task_details.cancel_task; roles re-synced), R3-3 (`meta.defaultPinned`), R4-1 / R5-2 (footer), R4-2 (tip spacing), R4-4 (header checkbox mounts after hydration; DndContext id is already stable), R5-2 (`db:verify` runs `jobsInvariants`), R6-1 (rollupJob `startedAt` on direct completion), R6b-4 (JS-free slow notice in the shell skeletons).
- **Not done:** R2-4 / R2-6 / R2-10 (`domain/jobs.cancelJob` / `tasks.cancel` cascade), R2-7 bucket facts, R2-8 / R4-3 / R5-5 retailer settings (M03 stores them itself), R2-12 wave-rule seed, R2-14 (M07), R4-3 `plannedStartAt`, R5-1 zombie jobs in the domain (M03 sweep stays), R5-4 platform API gates, R6-3 route profiling, R6-4 `released_at`, R6b-1 actor display-name convention.
