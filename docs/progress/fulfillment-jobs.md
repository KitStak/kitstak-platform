# M03 fulfillment-jobs — progress (round 1)

Read first when resuming.

## State at resume (2026-11-06 07:42)
A previous builder session (06:47–07:28) wrote server code + grid defs but no UI and no progress file:
- grid defs: src/lib/grid-defs/jobs/{shared,jobs,tasks,reports,conditions,schedule,forms}.ts
- repositories: jobs.ts, jobs-grid.ts, jobs-labels.ts, jobs-print.ts, tasks.ts, wave-rules.ts,
  wave-rules-options.ts, waves.ts, waves-run.ts, job-types.ts
- APIs: jobs (list, [id], [id]/orders/[orderId], actions, labels, print), tasks (list, actions),
  wave-rules (list, [id], [id]/change-log, options, run), waves, job-types (list, [id], change-log,
  algorithms), allocation-exceptions (list, retry), shortages (list, actions)
- pages are still foundation ModulePlaceholder stubs; src/components/jobs/* (old v0.2) deleted.

## Plan
1. Review/typecheck server code
2. UI: jobs grid + bulk modals, job detail, wave rules grid + wizard, wave log, alloc exceptions,
   shortage, task details x3, job types grid + wizards
3. Stubs: replenishment handler, wave-rules scheduler, jobs search provider, export providers
4. Unit tests (tests/unit/fulfillment-jobs)
5. Browser verification

## Done
- columns catalog src/lib/grid-defs/jobs/columns.ts; condition-codec.ts
- UI: components/jobs/{jobs-client,grid-columns,list-shell,job-modals,job-actions,jobs-list-page,job-detail-page,report-pages}
- UI: components/tasks/{task-actions,tasks-list-page}; components/wave-rules/{rule-editors,wave-rule-steps,wave-rule-wizard,wave-rule-detail,wave-rules-page}
- pages: /jobs, /jobs/[id], /jobs/wave-rules, /jobs/wave-log, /jobs/allocation-exceptions, /jobs/shortage, /tasks/* (+ /tasks redirect)
- job types: components/job-types/{job-types-page,job-type-wizard,job-type-steps,job-type-detail} + /settings/job-types
- tests: tests/unit/fulfillment-jobs/waves-and-jobs.test.ts (15 passing): KS-E2E Picking wave (10 orders, 2 types,
  met = allocated + shortage, Ready to Pick), eliminations, Failed wave, summaries, rule validation, cross-warehouse
  job types, delete-while-running guard, scheduler (Integration run, delete cut-offs), priority/cancel/assign guard,
  job type template preset + delete guard, task execute → Ready to Pack + Picking ledger, partial → missing log,
  task assign/unassign
- requests: docs/requests/fulfillment-jobs.md (REQ-2 allocation.recordException, REQ-3 orders.mergeOrders, REQ-4 scheduler HMR)
- live (2026-11-06 ~09:25 CST): all 11 routes SSR 200; every list API ok; created rule "KS-E2E Picking" (seq 106) and
  ran it via /api/wave-rules/run → wave 106-1 Completed (1 met · 0 allocated · 1 shortage; live MLT1 has few Open orders)

## Session 2026-11-06 ~10:15-11:10 CST (live verification, headless Playwright from scratchpad; browser pane tab cap was full)
Verified live against the dev server:
- all 10 routes render, no "Coming soon", no UUIDs in grid text; Export As Excel on all 7 grids → background_tasks completed
- jobs: Update priority modal (Save disabled until a card; High → red pill), Different-warehouses dialog (MLT1 + KS2),
  Assign via 3-char user search (change_log written), Unassign disabled when nothing assigned, Label ▾ / Print ▾ menus with
  guarded items; print API returns PDFs (pick-list, content, packing list) and 409 reasons for guarded docs; Cancel confirm lists jobs
- job detail: header, progress, Orders (order links, Remove), Tasks, Pick path, Timeline tabs deep-link via ?tab=
- wave rules: kebab Show details / Edit / Change log / Delete; AI job gate; Picking wizard General validation, warehouse-gated
  drag list, Selection filter (Order quantity 1–10) + order by, Schedule (day w/o time blocks Next, Set time specific/period,
  Remove, daily frequency), Assign Pool/Roles/Users; saved "KS-TEST Sched Wave" for now+2 min → countdown ticked and the
  scheduler ran it automatically: wave 107-1, Run By "Integration", Wave Log row + allocation exception rows
- job types: delete disabled with reason for in-use type; Picking wizard validation, Single Item Order template presets order scope
- task details: Execute modal validation + execute pick task 1397 → order KS-E2E-SO-2 Ready to Pack, ledger Picking row;
  Update modal; count rows link /counts/[id]; shortage links + Retry allocation / Create backorder confirm
Fixes this session:
- hydration mismatch on permission-gated buttons → src/components/jobs/use-permissions.ts (mount-safe has())
- wave-rule / job-type Change log 400 (shared /api/change-log rejects these types) → local RecordChangeLogDrawer over own endpoints
- filter popover Apply submitted the wizard and jumped a step → stopPropagation wrapper in ConditionsEditor (REQ-6 for shared fix)
- AI job showed steps while options loaded → skeleton until known, then gate
- Set time: typed-but-unblurred time left Set disabled → Set enabled, inline "Enter a time as HH:mm"
- Task ID rendered "1,397" → plain identifier cell
- requests filed: REQ-5 (assignee UUID in job timeline, shared domain), REQ-6, REQ-7

## Remaining / blockers
- REQ-5 pending: job Timeline shows the raw assignee id ("Assignee is modified. --> c6929c9b-…") until the shared jobs domain
  logs a display value. REQ-2/3/6 pending (local adapters in place). REQ-4 moot after the server restart (observed live).
- Not exercised live (unit-tested): partial execute → missing log, Cycle Count / Replenishment / Order Merge wave runs.

## Decisions
- Wave eliminations and order merge write via local adapters until REQ-2/REQ-3 land.
