# M03 fulfillment-jobs — shared-change requests

## REQ-1 — Permission catalog: confirm job-type and wave keys
- **File:** `src/server/auth/permission-catalog-data.ts`
- **Change:** none expected; verify the generated keys `settings.job_types.{view,create,edit,delete,change_log}`, `automation.wave_rules.run`, `fulfillment.task_details.{execute_task,update_task,cancel_task}` and the `fulfillment.job_management.*` print/assign keys used in `src/app/api/{jobs,tasks,job-types,wave-rules}/**` match the catalog spelling (`page("job_types", …, ["View","Create","Edit","Delete","Change Log"])` → `change_log`).
- **Reason:** M03 routes gate on these exact strings; a spelling drift would 403 every non-admin role.
- **status:** resolved (verified against the catalog 2026-11-06; no change needed)

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
