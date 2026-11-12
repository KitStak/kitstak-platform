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

## Round 1 (parity loop) — 2026-11-09
- Logiwa parity (references/logiwa-live/inbound-inventory.md §7): plan-level **Update Inv.** now posts Count Completed lines and **cancels every remaining open line** (their pending tasks too, and jobs settle). Before this, open lines stayed open.
- The variance summary now returns `linesToCancel` (plan code and open-line count). The Update Inv. dialog shows a matching attention callout: "Count Completed lines only" in green, "will be cancelled" in red, the list of affected plans, a Copy codes button, and a pointer to Location / SKU Details.
- New unit test: "plan Update Inv. posts Count Completed lines and cancels the uncounted rest". 32/32 counts tests pass; tsc is clean for counts paths.
- Smoke check (headless): /counts, /counts/locations and /counts/skus load with status 200 and no console errors.
- Still open: REQ-1 to REQ-4 (shared changes), unchanged.

## Round 1 (parity loop) — 2026-11-09
Source: `references/logiwa-live/inbound-inventory.md` §7–8 and the Count delta (item 15).
- **Update Inv. Attention path**: plan-level Update Inv. now posts the Count Completed lines and cancels every line that is not Count Completed. Their pending tasks are cancelled and empty jobs are settled. The variance dialog shows a "Some lines are not counted yet" callout with plan codes, line counts and a copy-codes button (`varianceSummary.linesToCancel`).
- **Create Recount** is blocked for Instant Count lines, in the client guard (`lineRecountReason(status, operationType)`) and on the server (`createRecounts`). This matches Logiwa's "Cycle Count plans only" rule.
- **Job Code links on Count Plan**: a new `jobRefs` column ("id|code;…", parsed by `parseJobRefs`). Each job code links to `/jobs/{id}`, with a "+N" tooltip when there are more than 2. Location and SKU Details already linked their jobs.
- **Location Details row ⋯ Delete** (Logiwa: Delete only) for lines of a Pending plan. It uses the existing line delete route (`count_location_details.delete`), and the last line is protected.
- **Cancel Count Plan(s) confirm**: the copy now ends with "This action cannot be undone." Buttons are Close / Cancel count plan(s).
- **Grid polish**: wider Status (160), Number of Location (160) and Counted Locations (152) columns. The headers no longer collide and the "Count Completed" pill is not clipped.
- **Tests**: 36 pass. New tests cover the instant-count recount rejection, location line delete, plan `jobRefs` and `parseJobRefs`. tsc is clean for the counts paths.
- **Verified with headless Playwright** (`kitstak-critic/counts/r1.mjs`, `r2.mjs`):
  - Job links open the job page.
  - The Location Details kebab shows Show count plan / Delete.
  - The Update Inv. dialog on CNT000144 shows the cancel callout (2 lines).
  - The cancel confirm copy is correct.
  - No console errors and no 4xx/5xx responses.

### Remaining
- Count jobs open on the job page's empty Orders tab. Filed as a Round 2 request to the jobs module.

## Round 2 (parity loop) — 2026-11-09
Fixes for the round 1 critic verdict (6.8):
- **Detail tabs work on click.** The tab is now local state, mirrored to `?tab=` with `window.history.replaceState`. A direct `?tab=sheet` link still works. Verified headless: Count sheet, Jobs, Timeline and Lines each show `aria-selected=true` and update the URL. New e2e test: `tests/e2e/counts/counts.spec.ts`.
- **Count SKU Details is the per-SKU result view.**
  - Rows come from `SKU_LINES_SOURCE` in `counts-grids.ts`: SKU-type lines, plus one row per SKU counted inside a location line (aggregated from `count_line_entries`).
  - Rows carry `lineId`, the real line. Bulk Cancel / Update Inv. / Recount and the detail export use it. Delete is disabled on per-SKU slices, with a reason.
  - The status chips use the same source. The empty state explains what appears there.
- **Location Details lists location lines only.** SKU-count lines have no location, so they now live on SKU Details only. Elsewhere, a SKU line with no location reads "All locations" instead of "Not resolved". Import already rejected unknown locations row by row. KS-CRIT-M07A was a SKU plan, not an unresolved import.
- **Count Sheet inline validation.**
  - `countedValueError` in count-math rejects negatives and fractions. The input shows a red border and a message, the difference is hidden, and Submit is disabled with the reason "Fix the invalid counted quantities".
  - Quick Count gets the same check through `draftsError`.
- **Detail KPIs.**
  - "Counted vs system" reads "— / {scope system qty}" before any count. After counting, it adds "N system units in scope".
  - Unit variance is plain signed text, so the grey oval is gone.
  - Strings are plural-aware: 1 location / 1 SKU / 1 bucket differs / 1 counted line.
- **Toolbar** (`count-bulk-bar.tsx`):
  - Count Plan shows Cancel | Update Inv. | Create Job. Location and SKU Details show Cancel | Update Inv. | Create Recount.
  - Each action is a first-class button with Logiwa's (i) help tooltip (Update Inv. "Triggers inventory update for count lines with the Count Completed status…"; Recount "Cycle Count plans only").
  - Disabled buttons use the neutral greyed style, never a faded red.
  - Below `lg` the actions collapse into one "Actions (n)" menu, so the toolbar stays on one row at tablet width.
- **Permissions.** Bulk actions render only when `useCountCan` grants the same key the route enforces. The operator 403 no longer reproduces: the operator role now holds `inventory.count_plans.cancel`, and `POST /api/counts/cancel` as operator returns 200 per-id results.
- **Create New Job.** Save is disabled with a reason until job types load and a type and batch size are chosen. A job-type load error is shown. Batch Size is a narrow, left-aligned input.
- **Create New Count.** The success toast names the plan and its line count and has an "Open plan" action.
- **Status vocabulary.** The chips render their own dot from `statusTone(status, "count")` and label from `statusLabel`, the same source as the pills and the detail badge, so "Ready to Count" is blue everywhere.
- **Grid headers.** Status is now the second Count Plan column and always visible. The count columns (184 / 176) and the qty columns with the (i) tip (164–176) are wider, so headers no longer overlap.
- **Job Code links** open in a new tab and show an open-in-new icon, on Location / SKU Details and on the Count Plan grid.
- **Dialogs.** Update Inv. buttons are Cancel | Proceed. The Recount dialog uses Cancel.
- **Tests:** 40 unit tests pass (new: `countedValueError`, SKU Details per-SKU rows for location plans, SKU-only lines off Location Details). tsc reports 0 errors.

### Still open / not done
- Count Type "LP" and the AI Count Plan workflow are not built. This needs schema enum and LP-picker work. Deferred.
- The Count Code link still opens the detail page, not the Logiwa Edit drawer. Edit stays disabled once a plan has started, which is intentional because lines are locked.
- The dark-mode Pending pill colour is in shared `status-colors.ts`. Filed as REQ-6.

## Round 3 (parity loop) — 2026-11-09
Fixes for the round 2 critic verdict (7.2):
- **Grid speed.** Profiled the grid SQL directly against `.data/kitstak.db` through `runGrid`:
  - Count Plan: 17 ms. Location Details: 2.4 ms. SKU Details: 2.8 ms, at 50 rows.
  - `count_plan_lines(plan_id)`, `(location_id)` and `count_line_entries(line_id)` are already indexed.
  - At the same moment `/api/me` took about 2 s and the count endpoints 1–4 s, rising to 22 s under other agents' load. So the slow timings are dev-server contention, not these queries.
  - Filed REQ-8 (index on `jobs.count_plan_id`, plus an optional composite `(plan_id, status)`) for foundation.
- **One rule for Location vs SKU Details** (Logiwa: location lines on Location Details, product lines on SKU Details).
  - Location Details now lists only lines with a location, no product, and a non-SKU plan. Per-location slices of SKU plans (KS-CRIT-M07A) are product lines, so they appear on SKU Details only. Verified via the API: Location Details returns only `countType = Location` and 0 KS-CRIT-M07A rows.
- **SKU Details lists un-counted in-scope SKUs.**
  - `SKU_LINES_SOURCE` gains a third branch. For an open location line with no entries yet, it emits one row per SKU on hand in that location, with expected qty = on hand, counted = null, and the line's status.
  - Result: CNT000146 now contributes 52 SKU rows in Ready To Count. The chips count Pending 8, Ready To Count 57, Count Started 3.
  - Unit test updated: a location plan lists its SKU before counting, with expected 20 and counted null.
- **Detail page Update Inv.** (header and Lines toolbar) drops to the neutral secondary style when disabled, keeping its reason tooltip (for example "Inventory has already been updated for this count"). There is no faded red anymore.
- **Detail Lines tab** is a single card:
  - The DataGrid owns the border.
  - The line actions and helper text sit in the grid's toolbar row, beside the column-settings icon.
  - Height fits the rows: max(260 px, 150 + 44 px per row), capped at 70vh.
- **Viewer clutter.** The selection column is hidden (`selectable={false}`) when the user holds no bulk-action permission. This applies on Count Plan, Location and SKU Details, and on the detail Lines grid. Row kebabs stay, because they hold Show details and Change log, which a viewer can use.
- **Mandatory reason on variance.**
  - `postCountLine` rejects a non-zero variance with no `reasonId`: "A count variance requires a reason. Choose an adjustment reason." This covers the plan Update Inv., line Update Inv. and Instant Count paths.
  - `varianceSummary.reasonRequired` is true whenever any variance exists, so the dialog marks the field required and validates it inline.
  - The warehouse `mandatoryCountReason` flag still forces a reason on zero-variance posts.
  - New unit test covers this, and the existing tests now pass a reason.
- **Job Code column** shows the first job link plus a `+N` chip. The chip is a keyboard button that opens a popover listing every job as a link, so codes are no longer clipped mid-token.
- **Widths.** Status columns are 184 px, so "Inventory Updated" no longer clips. Datetime columns are at least 176 px.
- **Page titles.** Each tab has its own title: Count Plan / Count Location Details / Count SKU Details. The subtitle always comes from `PageHeader` `helper`, so it sits in one position.
- **Tests:** 41 unit tests pass. tsc reports 0 errors in counts paths.

### Still open
- Dark-mode pill tones are shared; REQ-6 is re-raised with exact tokens.
- Count Type LP and the AI Count Plan workflow need schema and enum work and are deferred again.
- The Count Code link opens the full detail page, not Logiwa's Edit drawer. This is intentional: the page carries the sheet, jobs and timeline.

## Round 4 (parity loop) — 2026-11-09
Fixes for the round 3 critic verdict (6.5):
- **Root cause of the slow grids and the 500.**
  - Timed the actual SQL against `.data/kitstak.db`: the plan grid runs in 17 ms, the SKU source summary (full union) in 7 ms.
  - Over HTTP, the first call after a code change takes 27–33 s. That is Next route compile time, not the query. Warm calls take 0.4–5 s, and `/api/me` is just as slow at the same moment, so the remaining latency is dev-server contention from concurrent agents.
  - The HTML (non-JSON) 500 never reached `defineRoute`, so it was a compile or HMR failure, not the count query. Filed REQ-11 so the api-client maps a non-JSON 5xx to a typed error with Retry. The DataGrid already shows its Retry state for JSON errors.
- **Status chips loading.** The grey skeleton blocks are gone. The strip now reads "Loading status totals…" with a spinner (`role=status`). If the summary call fails, it shows "Status totals could not be loaded" with a Retry button instead of disappearing.
  - The footer still shows "Total: 0" while a grid loads, because that comes from the shared `GridFooter`. Filed as REQ-9.
- **Location Details chip totals** now use the same predicate as the grid: location lines only, no product line, not a SKU plan. Before this, the chips counted lines that the grid hides.
- **Detail Update Inv. is gated on open lines.**
  - New pure function `planOpenLinesReason(open, active)` in count-math. While any line is still Ready To Count or Count Started, the header Update Inv. is disabled (neutral style). Its tooltip reads: "2 of 5 lines are still being counted. Finish counting first, or select the completed lines on the Lines tab and update them there."
  - Line-level Update Inv. still posts only Count Completed lines.
  - Unit tests: `count-open-lines.test.ts`.
- **Detail KPIs.**
  - "Counted vs system" shows counted against system for counted lines only. Its sublabel shows the % difference and "N counted lines only", so there is no second system total in the card.
  - Before any count, the card shows "— " with "N system units to count".
- **Lines grid.**
  - Location plans drop the SKU column instead of showing a dash on every row. LP plans show an LP column instead.
  - Qty columns are widened to 180 / 196 / 196, Recount Line to 128, Inventory Updated Date Time / User to 220 / 184, so headers no longer clip at 1440 px.
- **Accurate subtitles.**
  - Count Plan: "Create, edit or cancel count plans by location or SKU, assign count jobs and post counted results to inventory."
  - Location Details and SKU Details now say "review … then update inventory, recount or cancel". They no longer promise create or delete.
- **Count Type LP (new).**
  - `countPlanInputSchema` accepts `countType: "LP"` with `lpIds`. The schema enum already had LP.
  - `buildLpLines` creates one line per LP, at the LP's current location with `lp_id` set. `initialStockQty` is the LP's on hand. Validation rejects LPs from another warehouse, out-of-scope clients, and unplaced LPs.
  - Plan edit diffs lines by location + product + LP.
  - The count task, sheet and Update Inv. already scope buckets by `line.lpId` (`expectedBuckets`), so only the LP's stock is counted and posted. Loose stock in the same location is untouched.
  - SKU Details (pre-count rows), the line `skuCount` and the plan `skuCount` respect `lp_id`.
  - New picker `GET /api/counts/pickers/lps?warehouseId=` (grid grammar: LP number, type, location, client, on hand, number of SKU).
  - The wizard Tasks step has a third card, "LP Count", with an Add License Plate picker. LP lines also show LP on the detail page and as an optional LP column on Location Details.
  - Verified end to end: PC-00009 in MLT1-C-01 created plan KS-R4-LP-35401 with 1 line, 12 units and 1 SKU. An empty `lpIds` returns 400. Edit reopens on the LP card.
  - Unit tests: `counts-lp.test.ts` (schema, line scope, unplaced rejection, picker).
- **Tests:** 48 unit tests pass. tsc reports 0 errors in counts paths. No console errors on /counts, the detail page or the LP detail page at 1440 px.

### Still open
- Lines-tab Export CSV vs list Export As Excel needs a shared DataGrid prop (REQ-10).
- The footer "Total: 0" while loading is shared (REQ-9). The dark-mode pill tokens are shared (REQ-6).
- The AI Count Plan workflow (suggested locations by velocity or accuracy) is not built.
- The Count Code link opens the full detail page, not Logiwa's Edit drawer. This is intentional: the page carries the sheet, jobs and timeline, and Edit opens the drawer in place from the row kebab or the header.

## Round 2 (parity loop) — 2026-11-09 (critic verdict 7.4)
Fixes for every round 1 defect, plus parity work:
- **Product picker speed.**
  - On hand now comes from one grouped `LEFT JOIN (SELECT product_id, SUM(on_hand) … GROUP BY product_id)` for the warehouse. Lookups are joins.
  - The location and LP pickers got the same change, so there is no per-row subquery left.
  - The SQL takes 1 ms for 100 rows (measured with better-sqlite3 on `.data/kitstak.db`). The remaining API latency is dev-server load: `/api/me` takes 1–5 s at the same moment.
- **SKUs on lines.**
  - New `skuList` line column: the line's SKU, else the counted SKUs, else the SKUs on hand in the location or LP.
  - The detail Lines grid shows a SKUs column for every plan type: the first SKU, then a "+N" chip with the full list in a tooltip (keyboard focusable).
  - Location Details also has the column, hidden by default.
  - The `/tasks/count` columns belong to M03 and are filed as REQ-10.
- **Create Job preview.**
  - `GET /api/counts/create-job?ids=` (`previewCountJobs`) returns the batch units per plan. SKU lines are expanded to stocked locations exactly as Save does.
  - The modal shows "N jobs · M locations" per plan. The footer total uses `jobsForUnits` (ceil(units / batch)).
  - A unit test asserts that the preview equals the jobs Save actually creates (SKU plan with 2 locations, batch 1 → 2 jobs).
- **Edit drawer, Tasks step.**
  - The loader maps Item Type / Item Group (new `productType` / `productGroup` line columns), Loc Type / Loc Group and LP Type, so edit shows the same values as create.
  - On hand is summed per SKU across per-location lines.
  - Verified headless: "PXP-MNT-CAR | Desk Accessories | Core Line".
- **Name prefill.** CNT code prefill works: CNT000147 is prefilled, verified headless.
- **Picker modal.** New local `count-picker-modal.tsx`. The grid uses the dialog's free height (`flex-1`), so the footer sits on the bottom edge. The footer says "N already in the plan". The shared fix is filed as REQ-12.
- **Lines grid.**
  - It fills the viewport down to the bottom edge (minimum 420 px) and re-measures on resize. Expanded rows no longer hide their neighbours.
  - Header widths with the (i) tip are now 208, 220 and 220 px, so the icons no longer collide.
- **Assign to.**
  - New `GET /api/counts/assignees` (`counts-assignees.ts`) and a `CountAssigneeSelect` used by Create Job and Create Recount.
  - It lists active staff assigned to the warehouse who hold a count-execution permission. Client-portal and API users are excluded.
  - The list is cached for 5 minutes, and the menu is height-capped so Save / Cancel stay visible.
- **Dialog verbs and status casing.**
  - Delete confirm: Keep plan / Delete plan. Cancel confirm: Keep plan(s) / Cancel count plan(s). Line cancel: Keep line(s) / Cancel line(s). Line delete: Keep line / Remove line.
  - Copy and reasons now say "Ready to Count" (`statusLabel`).
- **Timeline.**
  - New `count-timeline.tsx` with All / Plan / Lines / Inventory filter chips and counts.
  - Status entries read "Status changed from X to Y" in pill casing. A recount line's first entry reads "Recount line created (Ready to Count)".
- **Job start.** `executeCount` stamps `jobs.started_at` when the first count task runs, so Actual Start is set (unit tested). The rollup gap for other task types and the Wave label are filed as REQ-11.
- **Viewer copy.**
  - Count Plan, Location Details and SKU Details show neutral helper text for read-only roles.
  - The empty-state "Create New Count" is hidden without create rights.
  - Finished plans hide line selection and line actions.
- **Header layout.**
  - Finished plans (Inventory Updated or Cancelled) keep only Change log, and the meta line is capped at 640 px.
  - The action bar stays on the title row in every status. Verified on IC20261110044007541 and CNT000144.
- **Blind count and input clamp.**
  - `isBlindCountJob()` reads the job type's `count.blindCount`. The sheet and quick count APIs then withhold `systemQty` in the payload itself.
  - `CountEntryTable blind` hides System qty, Difference, Use system qty and Fill blanks.
  - The counted input blocks `- + e . ,` and clamps at 0 (typing "-3" gives "3").
  - The schema field and the settings toggle are filed as REQ-9.
- **Logiwa parity: Update Inv. on open plans.**
  - Enabled for Pending, Ready to Count and Count Started plans. It posts the counted lines and cancels the rest, and the confirm lists them.
  - With nothing counted, the confirm reads "Nothing has been counted yet … all lines will be cancelled and the plan is closed" with "Cancel lines and close plan". No reason is required in that case.
  - Unit tests cover the Pending and Ready to Count cases.
- **AI Count Plan.**
  - Tasks › Suggest opens `count-suggest-dialog.tsx` (`GET /api/counts/suggest`, `counts-suggest.ts`).
  - It ranks stocked storage and pick locations, or SKUs, by risk using `scoreCountRisk`: staleness 40, 30-day movements 30, 180-day count variances 20, ABC class 10. Each suggestion shows its reasons.
  - Lines already in an open count are excluded. The signals come from grouped CTEs, about 67 ms of SQL.
  - Saved plans have `isAi = true` (AI Count Plan = Yes). The detail meta shows "AI Count Plan".
- **Count accuracy.**
  - The Count Plan header has an Accuracy button that opens `count-accuracy-drawer.tsx` (`GET /api/counts/accuracy`, `counts-accuracy.ts`).
  - The drawer shows record accuracy, lines counted, unit accuracy, net variance and a weekly trend, with the largest variances by SKU, location and counter. Period choices are 30, 90, 180 and 365 days.
- **Recurring counts.**
  - The Count Plan header links to Wave Rules, where Cycle Count rules schedule plans.
  - The detail page shows "Scheduled by wave rule X" (`waveRuleName`).
- **Location picker filters.** Expanded to 38 fields:
  - dimensions, capacity type, max capacity, max SKU, mezzanine, colour code
  - dedicated client, single client, only one SKU / lot / LP, only damaged, prevent inventory sync
  - on hand, number of SKU, custom fields (any value)
  - The picker also has a Num. of SKU column.
- **Tests and checks:**
  - 61 unit tests pass in `tests/unit/counts`. New: `counts-round2.test.ts`; lifecycle and count-math tests were updated for the Update Inv. parity change.
  - tsc reports 0 errors in counts paths. ESLint errors in counts are fixed: the ref-in-render errors in the plan and line pages are gone.
  - Headless checks (`kitstak-critic/counts/r2v.mjs`, `r2j.mjs`, `r2k.mjs`, `r2m.mjs`) showed no console errors and no 4xx/5xx responses from counts.

### Notes
- The dev server's HMR is degraded ("module factory is not available" for other modules' routes). At one point `/api/counts/variance` kept serving a stale bundle. The dialog therefore also derives "nothing counted" on the client from rows plus no-difference lines, so it behaves correctly before and after the server picks up `countedLines`.
- Still open: the blind-count settings toggle (REQ-9), count task SKU columns (REQ-10), the job page Wave label and the rollup started_at (REQ-11), and shared picker / change-log polish (REQ-12). The mobile scanner cycle-count screen belongs to the mobile module and is not built here.

## Round 5 (parity loop) — 2026-11-09
- Isolation: count repositories and pages no longer import the `@/server/domain`, `@/components/shared` or `@/components/grid` barrels; they import the exact files (change-log, sequences, tasks, jobs, ledger, bulk; change-log-drawer, detail-header; data-grid, grid-toolbar, use-grid, grid-types). A broken file in another module can no longer take the count routes down through a barrel.
- Create New Count: the new plan is put at the top of page 1 of the Count Plan grid as soon as Save succeeds (setQueriesData), then the refetch confirms it.
- Warehouse default: working-context warehouse, else the only warehouse, else the in-scope warehouse holding the most stock (`defaultWarehouseId` on `GET /api/counts/next-code`).
- Add Location picker hides BusinessStation and Virtual locations by default (`types=storage|all` on `/api/counts/pickers/locations`), with an "Include station and virtual locations" toggle. Duplicate "Selected: N" removed from the modal footer (the grid footer keeps it).
- Detail header, timeline and the cancel/delete confirm lists use `fmt.gridDateTime` (MM/DD/YYYY h:mm AM), the same as the grids.
- Row click on /counts opens the plan in place (Edit Count drawer for Pending plans with edit rights, read-only drawer otherwise) and prefetches the detail route. Row kebab adds "Quick view". The Count Code link still opens the full detail page.
- Console: Playwright run on /counts (admin) showed no errors, warnings or 5xx after these changes.
- Checks: tsc clean on count paths; vitest tests/unit/counts 61/61.


## Round 6 (parity loop) - 2026-11-10
Critic r5 (score 8) items:
- **Header at tablet width (major):** below `xl` (1280px), the secondary /counts actions (Quick count, Accuracy, Import x2, Recurring counts, Handheld count) move into a **More** menu. The header then shows only More and Create New Count, so the title and helper keep their full width. Verified at 768px: the title fits on one line and the helper on 2 lines (`r6-768b.png`). /counts/locations and /counts/skus have only one header action and were not affected.
- **Operator segregation of duties (major):** this needs a foundation change, filed as REQ-13 in docs/requests/counts.md with the exact keys to deny. M07 routes and UI already gate on those keys.
- **Mobile / RF execution (major):** new handheld page at **`/counts/scan`** (`src/app/(app)/counts/scan/page.tsx`, `src/components/counts/count-scan-page.tsx`), laid out for 360-560px screens. Step 1: scan a count plan code, or tap one from the list of Ready to Count / Count Started plans (each shows warehouse, type and counted/total). Step 2: the Count Sheet (scan location, enter qty per SKU/lot/LP, add found stock, note, submit; the next line is then ready). It posts to the same `POST /api/counts/[id]/sheet` endpoint as the desktop sheet, so permissions, scope, audit, blind-count hiding and ledger rules match. An **Instant** button opens Instant Count. A "View only" callout appears when the user has no execute permission. Entry points on /counts: the Handheld button (xl) and the More menu item. Verified at 400px as admin (`r6-scan.png`, `r6-scan2.png`).
- **Warehouse not prefilled:** the default comes from `/api/counts/next-code`, which was only fetched after the drawer opened (about 1-2 s later on dev). The page now prefetches next-code on mount, so the drawer opens with both the code and the warehouse filled in. While the default is still resolving, Next is disabled (`aria-busy`) rather than showing "Warehouse is required". Verified: the drawer shows `CNT000147` / `MLT1 - Main Fulfillment`.
- **Picker date format:** this is a BUILD_PLAN 0.1 convention in a shared component, so it is filed as REQ-14.
- **KPI LINES vs Lines tab after a recount:** when lines were superseded or cancelled, the tile now reads "Active lines 1" with the sublabel "1 superseded by recount - 2 total" (plus "N cancelled" when there are cancelled lines). Verified on KS-CRIT-R5B-954227 (`r6-detail.png`).
- **UNIT VARIANCE on an uncounted plan:** until a line is counted, the tile shows "-" with the sublabel "Shown once a line is counted" in a neutral tone.
- **Status chips vs grid Total drift:** `CountStatusChips` now takes `gridFetching` and refetches `/api/counts/summary` whenever a grid fetch finishes (refresh, filter, page change, window refocus). The "All" chip and the grid Total therefore always reflect the same moment. Wired on /counts, /counts/locations and /counts/skus.
- **Initial load:** on warm dev, `/api/counts` arrives at about 1.1 s and network idle at about 1.6 s. The rest depends on how the shared `useGrid` orders its requests, filed as REQ-15.

Missing-vs-Logiwa items:
- **Update Inv. confirm:** new "N count plans: A, B, C" strip with a **Copy codes** (clipboard) button and the hint "Paste the codes into the search on Location Details or SKU Details", with links (`count-dialogs.tsx` `AffectedPlans`).
- **Edit Count on any status:** new `PATCH /api/counts/[id]/header` (`updateCountPlanHeader` in `counts-plans.ts`) changes only the name and description, at any status. It returns 409 on a version conflict and 409 DUPLICATE with a field error when the name is already used in the warehouse. It writes the change log and requires `inventory.count_plans.edit` (viewer gets 403). For a non-Pending plan opened by an editor, the drawer shows a "Name and description only" callout: only Name and Description are editable, the footer offers View lines and Save (Save stays disabled until something changes), and Tasks is read-only. On non-Pending plans the row kebab Edit is labelled "Edit name & description", and a row click opens Edit Count for editors. Verified through the API: 200 on an Inventory Updated plan, 409 when stale, 409 on a duplicate name, 403 for viewer. The test data was restored afterwards.
- **Still open, owned by others:** blind-count setting (REQ-9), task grid SKU columns (REQ-10), job page Wave label / started_at (REQ-11), role templates (REQ-13).

Checks: tsc is clean on count paths. vitest tests/unit/counts passes 65/65, including the new `counts-round6.test.ts` (header edit on a cancelled plan, full edit still refused, stale and duplicate rejected, a no-op keeps the version, name validation). The dev-server console showed parse errors only from other modules' in-progress files (purchase-orders-receive.ts, client-detail-page.tsx). The count pages logged no errors of their own.

## Round 3 (parity loop) - 2026-11-10
Critic r2 verdict (7.7). Every defect addressed:

**Major**
- **One open count per location / SKU / LP** (`src/server/repositories/counts-conflicts.ts`).
  - `openCountConflicts` / `assertNoOpenCountConflicts` run on create, edit (own lines excluded), import rows and the Cycle Count wave command (which skips taken ids instead of failing).
  - The error names each plan: `400 VALIDATION "This location is already in an open count plan: A-01-01-1 (CNT000146)…"`, with per-field messages.
  - Verified: POST /api/counts with A-01-01-1 (in CNT000146) now returns 400, where it returned 201 before.
- **Picker flags.** Location, Product and LP pickers return `openCountCode`. Those rows are greyed and not selectable, show an "In CNT000146" badge with a tooltip, and the footer reads "N on this page are in another open count". Edit passes `exceptPlanId` so a plan's own lines aren't flagged. If the server still refuses on save, the drawer flags the refused rows "In <plan>".
- **Lock Locations holds against other plans.** `postCountLine` calls `assertPostAllowed`: a plan can't post a variance into a location that another open Lock Locations plan holds. With legacy overlaps, the earliest locking plan wins.
  - Quick Count is refused on a locked location. `GET /api/counts/instant/location` returns `lockedBy`, and the modal shows a "Locked by count plan X" callout and disables Submit.
  - Unit tested: a second plan's Update Inv. fails with "A-01-01 is locked by count plan R3-L1" and stock is unchanged.
- **Job cancelled under a plan (orphaned lines).**
  - New `orphanedLineCount` (plan) and `orphaned` (line) columns: Ready to Count / Count Started lines with no live task.
  - `planCreateJobReason(status, orphaned)` allows Create Job on such plans, and `createJobsForPlan` re-issues tasks for exactly those lines (`reissueOrphanedLines`, change-logged). The preview counts them too.
  - Detail page: red callout "Count job Job005262 was cancelled · 50 lines have no count task" with **Re-create job** and **Cancel these lines**. The header shows Re-create job.
  - Lines grid: the job code is struck through with a "Cancelled" tag. Count sheet: lines show "Job cancelled" and the line view gets a callout with Re-create job.
  - Verified on CNT000146, which still shows the callout so it can be re-checked.
  - The M03 job cancel now also releases uncounted lines (`releaseCountLines`). `impliedPlanStatus` was fixed so a plan left with only superseded lines (a cancelled recount) closes as **Cancelled**, not Inventory Updated.
  - Test data note: KS-R3-E2E-55265 was rolled up by the old rule before this fix and still reads Inventory Updated, although it posted nothing.
- **Detail refresh after every mutation.** `done()` refetches the plan in parallel with the grid, timeline, sheet and preview invalidations (the query keys `timeline-ledger` and `count-actors` were added). An "Updating…" status shows while the refetch runs. Verified headless: after Create Recount, the recount line (Ready to Count) and Recount Created appear in about 1.4 s with no reload.
  - Root cause found while testing: Turbopack was serving a stale `task-handlers/count.ts` (`isBlindCountJob is not a function`), so every `/api/counts/[id]/sheet` with a live task returned 500. Touching the file fixed it.
- **Location chips = grid.** The grid and the chips share one predicate, `LOCATION_LINES_ONLY`. Verified: All 113 = Total 113, and every status chip equals its filtered total (the earlier gap was a stale summary bundle).

**Minor**
- **STATUS frozen at the right edge** of Location / SKU Details and the detail Lines grid (`sticky: "right"`, always visible). "Inventory Updated" is no longer clipped.
- **Dark mode pills.** New `count-status-pill.tsx` gives each tone a tinted fill at about 16% alpha with a light foreground under `[data-theme=dark]`. It is used for every count pill, including the detail header. REQ-6 stays open for other modules.
- **Count Sheet / Quick Count qty input.**
  - New `CountQtyInput` with no silent clamping or rounding. Typing `- + e . ,` is blocked, and pasting anything that is not a whole number is refused with a message ("-5" is not a whole number of 0 or more).
  - A negative or fractional value set by other means shows its message, hides the row difference and the Total counted and % (both "—"), and disables Submit with the reason "Fix the invalid counted quantities". Quick Count now has the same Submit guard.
- **Create Job modal.** The batch size is checked live: "At least 1" / "At most 1000" / "Whole numbers only", and Save names the reason. While the size is invalid, the preview reads "—" with "Enter a valid batch size to see the jobs".
  - Every count command now uses `runBulkCommand` with a 45 s timeout. On timeout it shows "No response from the server… Refresh to check whether it went through, then try again" instead of an endless spinner.
  - A started plan opens the modal as "Re-create count job".
- **Quick count.** The warehouse defaults like the wizard (context, else the only warehouse, else the busiest via next-code). The select is 300 px, so "MLT1 · MLT1 - Main Fulfillment" fits. The location field opens with a neutral blue focus, not the red brand ring.
- **Header Update Inv.** `planUpdateInvReason` now needs at least one Count Completed line in every status. Header, list toolbar and API share the rule; with nothing counted the reason reads "Nothing is counted yet. Count at least one line first, or use Cancel to close the plan". The two lifecycle tests were updated.
- **Names, not emails.**
  - Expanded-row "Counted by", the More Details export and the ledger timeline rows resolve the display name.
  - Change-log sources go through the new `GET /api/counts/[id]/actors`.
  - Timeline entries render a bold line label and a "·" separator, not "->". `?tab=timeline` syncs (verified).
- **Picker alignment.** Every picker column renders through one cell helper. Number columns are full-width right-aligned, and the last column is padded clear of the column-settings icon.
- **Segregation of duties (four-eyes).** A user can't post a variance they counted unless they hold `COUNT_SELF_APPROVE_PERMISSIONS` (Count Plans Delete: managers and admins by default) or are an admin. This applies to plan and line Update Inv. and to the variance summary, which lists the blocked plan.
  - An operator's Quick Count with a difference is recorded as Count Completed with `awaitingApproval`, and the toast says a supervisor must approve it.
  - Verified via API: the operator (j.okafor) Quick Count left stock at 27, the operator's Update Inv. got FORBIDDEN "four-eyes rule", the admin's Update Inv. posted, and stock went to 26.
  - Default-role denial of create, cancel and import for the operator is still REQ-13 (foundation).

**Checks:**
- vitest `tests/unit/counts`: 76 pass. The new `counts-round3.test.ts` has 11 tests (overlap create, SKU and edit; wave skip; lock posting; Quick Count lock; orphan re-issue; four-eyes; pure rules).
- tsc reports 0 errors in counts paths. eslint on counts paths: 0 errors; the warnings left were already there.
- Headless scripts: `kitstak-critic/counts/r3e2e.mjs`, `recount-net.mjs`, `r3tour.mjs`, `r3job.mjs`. No console errors and no 5xx responses after the stale-module fix.

**Still open (owned by others):** REQ-10 (count task SKU columns, M03), REQ-11 (count job page: Wave label and Orders tab, M03), REQ-13 (operator role defaults), REQ-16 (recount cancel restores the original line, state machine).

## Blind-judge repair round 1 - 2026-11-10
Every gap the judge listed, checked against the code:
- **LP count plan type:** already shipped. `COUNT_TYPES` = Location / LP / SKU, with an LP picker (`/api/counts/pickers/lps`) and the Count Plan Type filter on plans and Location Details.
- **AI / suggested plans:** already shipped. `count-suggest-dialog.tsx` + `/api/counts/suggest` produce ABC/velocity suggestions and save the plan with `isAi`. New this round: an **AI Plan** boolean filter on the Count Plans grid (`COUNT_PLAN_FIELDS.isAi`). Verified: `GET /api/counts?f.isAi=bool:true` returns 200; no AI plans exist in the dev data yet.
- **Update Inv. attention modal:** already shipped (`count-dialogs.tsx`). It lists the affected plan codes with Copy codes and says "inventory is updated for Count Completed lines only … will be cancelled".
- **REQ-13:** closed by foundation. Verified via `/api/me`: the operator now holds only `inventory.count_plans.view`.
- **REQ-10 (count task SKU columns):** `src/server/repositories/tasks.ts`. When a count task has no product, SKU / Product Name / Barcode / Client now fall back to the line's counted entries, then to the stock at the task's location and LP. Verified: `/api/tasks?kind=count` shows "MLT-WIDGET-01, MLT-WIDGET-02" on Job005307 where it showed null before. Tasks with no stock at their location still read "—" (Job005311).
- **REQ-11 (job page):** `jobs.ts` `getJobDetail` returns `countPlan`. `job-detail-page.tsx` shows a **Count plan** link in place of Wave / "Manual allocation", and hides the Orders tab for count and replenishment jobs that have no orders. Tasks was already the default tab.
- **REQ-16 (recount cancel):** the `countLine` machine now allows Recount Created → Count Completed. `restoreRecountOriginal` (task-handlers/count.ts) reopens the original line when its recount is cancelled by a line cancel (`cancelCountLines`) or by a job cancel (`releaseCountLines`). A plan cancel still closes everything. New `tests/unit/counts/counts-req16.test.ts`: the restored line can then be posted.
- **Handheld scan flow / full task grid:** already shipped (`/counts/scan`, `/tasks/count` 48-column grid).
- **Difference Min/Max, Recount Line, Recounted Location/SKU filters:** already present. Difference is a number filter with a Min/Max range editor.

Checks:
- tsc: 0 errors in the touched paths.
- vitest `tests/unit/counts`: 78/78 pass. `tests/unit/fulfillment-jobs`: 52/52 pass.
- Failures that don't come from these changes: nav-access, the orders grid grammar and orders updateOrder.

Blocked:
- The running dev server returns 500 "Jest worker encountered 2 child process exceptions" on every dynamic `[id]` route: `/api/counts/CNT000146`, `/api/jobs/<id>`, `/jobs/<id>`. List routes are fine. This is the dev-server environment, not M07 code.
- Because of that, the job-page UI check and the fresh blind judgment were not run. Both need `next dev` restarted first (see REQ-17).

## Blind-judge repair round 2 - 2026-11-10
- **Show Details + Inventory Updated lock.**
  - New `planLockedReason` (count-math): only Inventory Updated plans are locked. `updateCountPlanHeader` refuses them ("Locked: inventory was updated…"). Cancelled plans can still be renamed, as before.
  - Count Plans row menu: new **Show Details (read-only)** opens the drawer in view mode (title "Show Details"). On a locked plan, Edit is disabled with the reason, and Quick view opens read-only.
  - Detail header: a **Show Details** button on every plan, plus a **Locked** badge with a tooltip on Inventory Updated plans. The view drawer shows a "Locked · Inventory Updated" callout.
- **Create Job never dead-ends.** When a warehouse has no active Count job type, the modal shows an inline panel with a Settings → Job Types link. A user with `settings.job_types.create` also gets **Create default Cycle Count job type**: new `POST /api/counts/job-types`, `ensureDefaultCountJobType`. It is idempotent, uses the seed's settings, writes a change-log entry, and the new type is auto-selected.
- **Recount rule = Logiwa.**
  - `lineRecountReason` allows Cycle Count plans and Count Completed lines only.
  - The bulk-bar tooltip is now the exact `RECOUNT_RULE_HINT`.
  - Location / SKU Details and the detail Lines grid:
    - "Recounted Location/SKU" shows **Yes · <recount job link> <recount line status>** (new columns `recountJobId`, `recountJobCode` and `recountLineStatus`).
    - "Recount Line" shows **Yes · of <original job>** (`recountOfJobCode`).
- **Demo data.** The seed adds AI plans (`ai: true` on the Ready To Count spec, plus a new Pending "AI suggested" plan). In the live dev DB, `is_ai` is set on KS-CRIT-PERM-X (Pending) and CNT000147 (Ready To Count), so the AI Plan filter has rows. The dev DB already has Recount Created (5 lines), Count Started (2 plans), Count Completed (1 plan, 8 lines) and Instant plans.
- **Checks:** tsc shows 0 errors in counts paths. vitest `tests/unit/counts` passes 83/83, including the new `counts-blind2.test.ts` (recount link on both grids, default job type, lock) and the round6 lock test.
- **Blocked: REQ-17 (dev server).** `next dev` on :3000 (pid 47592, about 6.4 GB) does not answer: `/login` and `/api/me` time out after 60–120 s with about 25 concurrent agent scripts attached. I did not restart it, because the run brief says not to kill the shared server. Because of that, the headless re-verification and the blind walkthrough into `kitstak-blind/counts/A/` were not run. Next step: restart `next dev`, then run `kitstak-critic/counts/r3tour.mjs` and the walkthrough.

## Blind-judge repair round 3 - 2026-11-10
- **Add Location / Add Product pickers: select-all across pages.** `count-picker-modal.tsx` now turns on the grid's "Select all N matching" banner. On Add, it pages through the same filtered query, 1000 rows per request, up to `PICKER_ALL_MAX` = 20,000 rows. Rows already in the plan or blocked by another open count are skipped, the footer says so, and Add shows a spinner while it loads. The filter sets were already deep:
  - Locations: 40 fields, including aisle, area type, ABC, dedicated client, custom fields and the Only-One flags.
  - Products: client and the product flags.
- **% Difference beside the approved quantities.** On both detail grids (Location and SKU Details) and the plan Lines grid, the column order is now Approved Stock Qty, Approved Count Qty, % Difference, Counted Qty.
  - `DifferenceBadge` has threshold bands: 0 grey, within ±5% amber, below −5% red, above +5% green. Each badge carries `data-band`, and the header tip and badge title explain the bands.
  - New test `tests/unit/counts/counts-blind3.test.ts` covers the bands and the column adjacency on both grids.
- **Already shipped:**
  - More Details is an async export: `POST /api/exports` with `detail=1`, a toast with an "Open transactions" action, and a refresh of the Transactions tray.
  - The Create Job modal has Batch Size (Location) and Assign to, and previews the job count per plan. The N-jobs split is covered in `counts-lifecycle`.
  - The recount loop is covered in `counts-round3` and `counts-req16`: Recount Created on the original line, the recount line in a new job, and Update Inv. posting only Count Completed lines.
- **Checks:** vitest `tests/unit/counts`: 86/86 pass. tsc: 0 errors in counts paths. eslint on `src/components/counts`: 0 errors.
- **Blocked (REQ-17):** the shared dev server does not answer: `/api/health` times out at 120 s. I did not restart it, because the brief says not to kill it. Because of that, these were not run:
  - the live Playwright checks (route timings under 2 s, the r8 recaptures, the API sort/filter sweep, the live job-split and recount screenshots);
  - the visual check of the picker change.

  The ready script is `C:\Users\Mike\AppData\Local\Temp\claude\kitstak-critic\counts\b3\tour.mjs`.

## Round 4 (parity loop) - 2026-11-10
Fixes for the round 3 critic (7.9):
- **SKU Details shows Cancelled lines.** In `SKU_LINES_SOURCE`, a Cancelled location line that was never counted now expands to its on-hand SKUs, the same way Pending / Ready lines do. Previously only Inventory Updated and Recount Created lines without entries were skipped. API check: the `/api/counts/summary?kind=skus` chip now reads Cancelled 16 (was 0); Location Details shows Cancelled 13.
- **Data repair for KS-R3-E2E-55265.** New `src/server/repositories/counts-integrity.ts`:
  - `findCountPlanStatusDrift` lists plans that read Inventory Updated with no Inventory Updated line and no Count transaction.
  - `repairCountPlanStatusDrift` re-derives their status through `impliedPlanStatus` and writes a change-log row.
  - Run against the dev DB: exactly one plan, KS-R3-E2E-55265, went Inventory Updated → Cancelled. A re-check finds no drift. The API grid now returns status Cancelled. REQ-21 asks foundation to wire this check into `db:verify`.
- **Frozen Status column on Location / SKU Details.** The frozen column now has a fade on its left edge (`STICKY_EDGE_SCRIM` in `counts-columns.tsx`, applied through `meta.cellPadding` on th and td), so a scrolled cell slides under Status instead of being cut. On row hover the fade switches to the sunken colour. The shared grid lost its own scrim in a refactor; REQ-19 asks foundation to restore it.
- **Picker loading state.** While the first page loads, Add Location / Add Product / Add License Plate show a `role=status` "Loading locations…" line with a spinner, and the footer reads "Loading the first page…". The grid's own "Total: —" belongs to foundation (REQ-20).
- **Typed error and Retry instead of endless skeletons.** Every count read (sheet, timeline change log, ledger and actors, detail, chips, pickers, job preview, scan) now passes `timeoutMs: COUNT_QUERY_TIMEOUT_MS` (30 s). A hung server shows the error Callout with Retry. A non-JSON 500 already maps to an `INTERNAL` ApiError, which shows the same Callout.
- **Handheld / Count Sheet actions (Logiwa mobile parity):**
  - **Skip location** parks the line at the end of the walk (a "Skipped" tag in the list) and opens the next one. It is disabled with a reason when only one line is left. `orderBySkip` is unit tested.
  - **Reset count** clears the counts, found and damaged rows and the note for the open location. It is disabled until something has been entered.
  - **Mark damaged** (a per-row icon in the entry table, so it also works in Quick Count) adds a "Damaged" row under the SKU with a damage-reason picker. The reasons come from Data Setup (`damage_reason`), with "Damaged" as the fallback.
    - Server side: `entrySchema` and `CountEntryInput` accept `damageReason`, `packType`, `lpId` and `expiryDate`. `resolveEntry` matches and creates the damaged bucket, and `postEntry` creates it with the reason on Update Inv.
    - Unit test: 12 on hand counted as 10 good + 2 damaged posts sellable 10 and damaged "Crushed" 2.
    - A duplicate bucket (the same damaged bucket entered twice) is caught client-side before submit.

Checks:
- vitest `tests/unit/counts`: 92/92 pass. New `counts-round4.test.ts` (6 tests).
- tsc: 0 errors in counts paths (the remaining error is in carrier-errors, another module).
- eslint on the touched files: 0 errors.

Shared asks filed in `docs/requests/counts.md` (round 4):
- REQ-17: the dev server is still very slow. `/api/health` timed out at 30 s and 60 s, and once took 67 s. Count API calls take 35–43 s.
- REQ-18: the 12h/24h date-time drift is in the shared formatter.
- REQ-19: restore the grid's sticky scrim.
- REQ-20: the grid footer shows "Total: —" while loading.
- REQ-21: wire the drift check into `db:verify`.

Still open (owned by others): REQ-10 / REQ-11 follow-ups on the jobs module and REQ-14 (picker display format).
- UI check not run: `kitstak-critic/counts/r4/check.mjs` timed out after 420 s waiting for `/counts/skus` rows. The cause is the shared dev server (REQ-17). Once it is restarted, re-run that script with `all`. It covers the grids at 1440 px (scrim), then on `/counts/scan` the Mark damaged, Reset and Skip actions.

## Round 5 (parity loop) - 2026-11-10
Fixes for the round 4 critic (8.3):

**Major**
- **Handheld `/counts/scan` at phone width.**
  - `CountEntryTable` measures its own width with a ResizeObserver. Below 600 px it renders one card per bucket (`data-layout="cards"`):
    - SKU, product, lot and LP on top, with the actions as 44 px touch targets.
    - Then System, a full-width 44 px Counted input (16 px text, so iOS does not zoom) and the delta.
    - Totals sit in a footer strip, and the found-stock controls stack full width.
  - At 600 px and wider it stays a table (min-width now 600).
  - On narrow screens the Count Sheet reorders to scan field → active location → line list (the list is capped at 40vh), so the counter no longer scrolls past 48 lines to reach the inputs. The desktop two-column layout is unchanged (`lg:` order resets).
  - Measured on the current build at 360 px: the counts content itself no longer overflows.
  - The remaining sideways scroll (409 px) comes from the shared top bar's right icon group. Filed as REQ-22 (foundation).

**Minor**
- **Frozen Status really pins.**
  - Status is now the last data column on Location Details, SKU Details and the detail Lines grid (`statusCol`, appended after the tail columns).
  - A sticky-right cell followed by other columns covered them, which was the clipped "INITIAL STOC", and never pinned.
  - Unit test: Status is the last column and the only sticky one, on all three grids.
- **Found stock dedupe at Add time.** `findExistingRow` matches any non-damaged row with the same SKU and lot (lot is case-insensitive). Add found stock then:
  - adds no duplicate row;
  - scrolls to the existing row's counted-qty input, focuses it and selects it;
  - shows "SKU-1 is already listed here. Enter what you found on its row."
  New found rows also get focus.
- **Location codes truncate** with an ellipsis and the full code in `title` (Location column 168 px). Location Details and the plan Lines grid use the same cell.
- **Expanded row pinned to the viewport.**
  - `StickyExpansion` finds the grid's scroll box and sets the panel to `sticky left-4` with the visible width, which a ResizeObserver keeps current.
  - The per-bucket table now opens with a "Counted buckets · location · SKU" context line and scrolls on its own if it is wider. REQ-24 asks the shared grid to do this for every module.
- **Detail header stable in every status.** Show Details, Change log and Delete (destructive, with the disabled reason) moved into a **More** menu. The bar is now More / Locked / Edit / Cancel / Create Job / Update Inv. at most.
- **Variance colour by magnitude.**
  - `DifferenceBadge` / `DeltaBadge`: 0 is grey, within ±5% amber, beyond ±5% red in both directions.
  - Direction is shown with an up or down arrow plus the sign. Each badge has `data-band` and a title explaining the band, and dark-theme tones.
  - `DeltaBadge` takes `system` so the unit deltas (entry table, expanded row, Update Inv. preview) use the same band as their %. A +150% overage is now red, not green.
- **Accuracy drawer chart.**
  - Y axis at 0/25/50/75/100% with gridlines, and a dashed green 95% IRA target line with a legend.
  - Bars are neutral info-blue and turn red only for weeks below target. Value labels sit over each bar.
  - Each bar is keyboard-focusable and has a tooltip (week, %, exact/total buckets, below target). A summary line reads "N of M weeks below the 95% target".
- **Job counters.**
  - The detail Jobs tab computes Tasks from the task rows: completed / live, plus "· N cancelled".
  - New `findCountJobCounterDrift` / `repairCountJobCounterDrift` in `counts-integrity.ts`. Run on the dev DB, it repaired Job005257 from 0/5 to 3/5 and wrote a change-log row; a re-check finds 0.
  - The cancelled jobs with `task_count` 0 match the `rollupJob` rule (cancelled tasks are excluded), so they are not drift.
  - Seed fix: REQ-25. `db:verify` wiring: REQ-26.
- **One open count per location.**
  - New `findOpenCountOverlaps` uses the same open / released status sets as `counts-conflicts`. New `repairOpenCountOverlaps`: the oldest plan keeps the location; the newer plans' uncounted (Pending / Ready) lines are cancelled through `cancelCountLines`; counted overlaps are reported, not discarded.
  - Dev DB: the 4 overlaps were MLT1-C-01, B-01-05-2, MLT1-A-01 and B-02-01-2, involving KS-CRIT-R6-65263, KS-CRIT-M07-operator, KS-CRIT-PERM-operator, KS-CRIT-PERM-X and KS-R4-LP-35401. The repair cancelled 5 lines, and a re-check finds 0.
  - A DB copy taken before the repair is at `kitstak-critic/counts/r5/kitstak-before-r5.db`.
- **Timeline events.** New `counts-events.ts` writes `change_log` rows with `field = "count_event"`. The timeline and the change-log drawer show them as plain sentences:
  - Create Job / re-create, e.g. "Count job JobX created · 12 tasks across 12 locations · batch size 25 · assigned to …" (or "job pool"). Quick Count is covered too.
  - Count entry submission, per line: "Counted 10 vs system 12 (−2) · at A-01-01 · 1 bucket · 1 damaged · note: …". The user is the change-log source.
  - Create Recount: the original line gets "Recount created in job JobY…", and the plan gets "Recount job JobY created · … · recounts A-01-01".
  - Update Inv.: "Inventory updated for N counted lines · M ledger postings · reason Cycle count · note: … · K open lines cancelled". Line-level Update Inv. writes the same on the line.
  - Mobile task-execute counts: REQ-27 (M03 / domain).
- **Recounted Location/SKU cell** shows the recount line status as a `CountStatusPill` ("Ready to Count"), not raw casing.
- **Permissions.** Handheld (header link and More menu) now needs `mobile.cycle_count.view`. Recurring counts was already gated on `automation.wave_rules.view`, the same permission as the `/jobs/wave-rules` nav entry. The default viewer role holds that permission, so the link is live for viewers.
- **768 px toolbar.** The collapsed "Actions" menu takes its own right-aligned row below `lg`, so it no longer covers Views / Clear. The shared toolbar fix is REQ-23.
- **Logiwa parity: Update Inv. info box links.** Location Details / SKU Details now open in a new tab pre-filtered with `?f.planCode=in:<codes>` (commas escaped), in both the "not counted yet" callout and the affected-plans box. The "paste the codes" instruction is gone.

**Checks**
- vitest `tests/unit/counts`: 105/105 pass. New `counts-round5.test.ts` has 13 tests:
  - magnitude bands;
  - Status last on all grids;
  - found-stock match;
  - IRA target;
  - filtered Details href;
  - event text, plus an end-to-end test that Create Job, submit, recount and Update Inv. write their events;
  - job-counter drift and repair;
  - overlap find and repair.
- tsc: 0 errors in counts paths. eslint on the touched files: 0 errors; the 4 warnings in `count-plan-drawer.tsx` were already there.
- Visual checks: see the note below on the shared dev server.

## Round 6 (parity loop) - 2026-11-10
Fixes for the round 5 critic (7.8).

**Blocker: a count that finds less than is allocated could never be closed**
- **Unpicked allocations are shorted first (Option A).** Before a shortage posts, `postCountLine` plans each entry against its bucket. This uses `planLineEntries` and the pure rule `allocationShortfall` in `count-math.ts`. An allocation can be shorted when it belongs to a shipment order, has status Allocated, has no live pick task, and its order is not in a job. Those allocations are:
  1. released with `jobs.releaseForLine`, which also lowers the order line's allocated qty;
  2. re-allocated from other locations with `reallocateLine`, inside a savepoint;
  3. if stock is still short, recorded as an allocation exception on the order: wave "Cycle Count", "Count shortage: count plan X found less stock at LOC; N units unallocated".

  The ledger then posts the counted quantity, and the line timeline reads "Count shortage shorted allocations · SO… −1".
- **Committed stock (picked, in a pick job, work orders) can't post, so it is closed explicitly instead of hidden (Option B).**
  - `POST /api/counts/variance` now returns:
    - `allocationBlocked`: line, units, holders ("SO010927 (Picked, 2)") and message;
    - per row: `allocated`, `unallocates` and `blocked`;
    - `unitsUnallocated`.

    Blocked rows are left out of the units-removed KPI.
  - The Update Inv. dialog shows an attention box that lists the blocked lines and a required "Close these lines without posting" checkbox.
    - Proceed stays disabled, with a tooltip, until the box is ticked.
    - When every counted line is blocked, the button reads "Close without posting".
    - Rows carry "Can't post", "Shorts N alloc." or "N alloc." badges.
    - An info box explains which allocated units will be shorted.
  - Server: `updateInventoryForPlans` and `updateInventoryForLines` take `closeBlocked`.
    - Without it they refuse with the explicit message (INSUFFICIENT_STOCK) and never post silently.
    - With it they post the other lines and cancel the blocked ones. The facts, reason and note go on the timeline ("Closed without posting · …"), and the locations unlock.
- **Cancel works on counted plans and lines (Logiwa parity).**
  - `planCancelReason` no longer refuses Count Completed plans, and `lineCancelReason` now allows Count Completed lines.
  - Discarding a counted result requires a reason (`COUNT_DISCARD_REASON_MESSAGE`). The server enforces it, and so do all the confirms through `CancelReasonField`:
    - Count Plan list;
    - Location / SKU Details;
    - detail header;
    - detail Lines tab.
  - The reason goes on the plan timeline ("… 1 counted line discarded without posting · reason: …").
- **Allocation is visible before counting.**
  - Count sheet and Quick count rows show an "N alloc." badge, which turns amber when the counted qty falls below it.
  - The wizard location / SKU / LP pickers show an "N alloc." chip next to On hand, amber when all stock is allocated. The picker API now returns `allocated`.
- **Dev DB replay** (`kitstak-critic/counts/r6/repro.ts`, run on a backup copy of `.data/kitstak.db`):
  - KS-CRIT-R5L-537136: the variance lists the HOSP-01 line as blocked (SO010927, Picked 2).
  - A plain Update Inv. refuses with the explicit message.
  - `closeBlocked` closes the line, the plan rolls up, and every lock is released.
  - Ledger reconcile issues: 0. Count integrity issues: 0.
  - The live plan was left unchanged so the critic can reproduce the fix in the UI.

**Minor**
- **Quick count.**
  - Adjustment reason* becomes required as soon as a bucket differs while Update inventory now = Yes. An inline field error says how many buckets differ. Submit is disabled and its tooltip gives the reason.
  - Submit errors now show as an inline error callout inside the modal, not as a toast over the footer. The shared toaster fix is REQ-31.
  - A posting count with differences opens a **review step** before anything posts. The step shows:
    - units added / removed tiles and the net change;
    - the differing buckets with % badges;
    - an attention box when shrink is above 5% or a bucket is counted below its allocated qty;
    - "Back to counts" and "Post to inventory". The primary button reads "Review and submit" first.
- **Tabs.** `/counts/[id]` now renders a `role=tabpanel` whose `id` / `aria-labelledby` match the active trigger's `aria-controls` / `id` (`useTabPanelIds`). The shared fix is REQ-29.
- **% Difference sort.** The count grids sort with `NULLS LAST` in both directions (`counts-grid.ts` `orderOf`), so an ascending sort leads with the worst shortage.
- **Recounted column.** 300 px and unclipped. The job link and the status pill are `shrink-0`, so neither is truncated, and a tooltip repeats both.
- **Plan Lines grid.**
  - Status and the count numbers come first: Location, SKUs, Status, Counted, Approved Stock, % Difference, Approved Count, Initial Stock, then the job and time columns. Nothing is frozen, so no header is half covered in the default view.
  - The `-mx-6` bleed is removed, so the column-settings icon sits inside the card.
  - The "Export CSV" label comes from the shared grid's own button. REQ-10 is re-raised: it needs an export key separate from the prefs key.
- **Export toast.** The shared `ExportButton` already shows "Export started · Open transactions" on the 202 response. When the critic saw no toast, the dev server was slow (REQ-17).
- **Status tones.** Count Completed is teal, Inventory Updated green and Recount Created purple, in both pills and chips, with dark-theme variants (`COUNT_TONE_OVERRIDES`). The foundation map change is REQ-28.
- **Count Plan grid.** Count Code is frozen on the left (`pinLeft`), next to the selection column.
- **Plural labels.** "1 unit removed", "0 units added", "1 line with no difference" (`statLabel`, `unitsLabel`).
- **Handheld: Your jobs / Job pool.** `/counts/scan` now has three ARIA tabs: 44 px tall, arrow / Home / End keys, view kept in `?view=`.
  - **Your jobs:** open count jobs assigned to me, with the plan, tasks done, the next 3 locations and a progress bar. Tapping a job opens the count sheet.
  - **Job pool:** unassigned jobs, each with **Take job**.
  - **Plans:** the existing scan-or-pick list.
  - API:
    - `GET /api/counts/scan-jobs?view=mine|pool` and `POST /api/counts/scan-jobs/take`, in `counts-scan-jobs.ts`.
    - Access needs `mobile.cycle_count.view_your_jobs` / `view_job_pool` (now in `COUNT_PERMISSIONS`) or desktop count rights.
    - Take uses `jobs.assign` (tasks, change log, warehouse check) and adds a plan timeline event.
    - A job that someone else already took returns CONFLICT ("just taken by …").
- **db:verify.** New `countIntegrityIssues(db)` returns all three count checks in the `VerifyIssue` shape. Wiring it in is one line for foundation (REQ-21 / REQ-26, re-raised).
- **375 px handheld.** The counts content fits. Any remaining overflow comes from the shared top bar (REQ-22, re-raised).

**Checks**
- vitest `tests/unit/counts`: 115/115 pass. The new `counts-round6-alloc.test.ts` covers:
  - shortfall math and plurals;
  - an unpicked allocation shorted, with the exception, ledger and lock checks;
  - picked stock refused, then closed without posting;
  - line-level close;
  - cancelling counted plans and lines, which needs a reason;
  - Your jobs / Job pool / Take job, including the conflict case;
  - `countIntegrityIssues`.

  The count-math and round 5 tests are updated for the new cancel rule and the new plan grid order.
- `npx tsc --noEmit`: 0 errors. eslint on the counts paths: 0 errors, plus the existing warnings in `count-plan-drawer.tsx`.
- Headless visual checks were blocked by the shared dev server. `/api/health` took 74 to 107 s, and `/counts/[id]` did not load within 420 s (REQ-17). `kitstak-critic/counts/r6/check.mjs` is ready to run once the server responds. It covers:
  - the detail tabpanel;
  - the Update Inv. dialog (`POST=1` closes the stuck plan);
  - the cancel reason;
  - the pinned Count Code;
  - the % Difference sort;
  - the handheld tabs at 375 px.

## Blind-judge repair round 1 (judge pass) - 2026-11-10
Every judge gap, with the fix and how it was checked:
- **Inventory Update User was "—" on seeded plans (CNT000141, IC20261031191000000).** The old seed stored the actor's email in `inventory_updated_by`, and the grid resolves user ids. Fixes:
  - The seed now writes `ctx.userId` (plan and lines).
  - The grid name resolver also matches an email, so legacy rows render.
  - New `findInventoryUpdateUserGaps` / `repairInventoryUpdateUser` in `counts-integrity.ts`, also reported by `countIntegrityIssues` (`count_inventory_update_user`). Run on the dev DB (backup at `kitstak-critic/counts/jr1/before.db`): 2 plans and 6 lines repaired, 0 gaps left. API and UI now show "Renata Alvarez" for both plans.
  - Every live update path already writes `ctx.userId` (`task-handlers/count.ts` rollup, `counts-ops`, `counts-sheet`).
- **Line counts disagreed (CNT000146).** Decision: cancelled lines are never counted, so Number of SKU, Number of Location, the line count and the Create Job preview exclude them. Location Details keeps listing them with status Cancelled (Logiwa parity). To make the numbers reconcile:
  - The plan grid's Number of Location cell shows a "+3 cancelled" chip with a tooltip.
  - New hidden column "Cancelled Lines" (`cancelledLineCount`).
  - The Create Job preview returns `cancelled` and reads "2 locations · 3 cancelled lines skipped".
  - Verified: the API gives locationCount 2 and cancelledLineCount 3; Location Details lists 5 lines (2 Pending, 3 Cancelled); the UI chip reads "+3 cancelled".
- **Recount Created lines showed Approved Stock / Count Qty.** New `approvedQtySuperseded(status)` in count-math. Recount Created lines render "SUPERSEDED —" and Cancelled lines "NOT POSTED —". The tooltip explains this and names the superseded value. This applies on Location Details, SKU Details and the plan Lines grid. Verified headless on both detail grids (`g4-counts-locations.png`).
- **Picker filter breadth.** The judge's list was already covered: locations have ABC, aisle, rack, level, zone, group/type, has inventory, locked, prevent allocation and custom fields; products have client, kit, lot/serial/expiry/production tracking, product group and status. Filled the remaining gaps:
  - Locations: Client (has stock), Last Counted Date, In Another Open Count.
  - Products: Has Inventory (this warehouse), Category, Hazmat, Track Secondary Serial, Custom Fields, Last Counted Date, In Another Open Count.
  - Picker columns: ABC and Last Counted are visible by default. Aisle / Rack / Level / Locked / Prevent Alloc. (locations) and Kit / Status (products) can be turned on, and products also get a Tracking column (Lot · Serial · Expiry).
  - Verified: the Add Location filter menu lists all 43 fields (`g6-filter.png`).
- **Count Sheet skeleton on tab switch.** The detail page preloads the sheet with the same query key (`["count-sheet", id]`, staleTime 30 s). Measured: the sheet content shows 87 ms after the tab click, with no skeleton.
- **Handheld Job pool "empty".** Pool membership is correct: Job005253 (CNT000143) and Job005257 (CNT000144) are assigned to Jonah Okafor, and the pool lists only unassigned jobs. New `GET /api/counts/scan-jobs?view=others` (same access as the pool). When Your jobs / Job pool is empty, the page now lists "2 open count jobs are assigned to other counters", each with the job link, plan, progress and "Assigned to Jonah Okafor" (`g5-pool.png`, 400 px).
- **REQ-1 (ledger count lock).** Already landed in foundation (`domain/ledger/count-locks.ts`, called from `rules.ts` and `allocations.ts`). Verified live: a move out of a Lock Locations plan's location returned RULE_VIOLATION "Location A-01-03-1 is locked by count plan KS-JR1-LOCK-98…". The test plan was deleted.
- **Login 429 under concurrent sign-ins.** Every attempt, successful ones included, counted against the per-IP bucket (5/min). Without TRUST_PROXY all clients share one bucket, so a scanner fleet at shift start would hit 429. Successful sign-ins now refund their IP hit (`refundRateLimit`). Only failures are throttled; the per-account limit and lockout are unchanged. Unit test: 12 successful sign-ins from one IP pass, then 5 failures still block.
- **Smaller parity items:**
  - SKU Details row ⋯ Delete: it already matches Logiwa. It is offered for lines of Pending plans and disabled with a reason on per-SKU slices of location lines.
  - More Details: it now follows the background export to the end. While it runs, the button shows a spinner and "Preparing the detailed file…". When done, an inline "Download (N rows)" link and a toast with Download appear; failures show inline. The Transactions tray lists the same task. Verified: "Download (20 rows)" after about 5 s.
  - Show Details / Edit on Inventory Updated plans: the description is now editable (Logiwa parity, change-logged). The name stays locked because ledger postings reference it (`planNameLockedReason`). The row menu reads "Edit description", the drawer shows a "Description only" callout with Name disabled, and the server refuses a rename with the reason.

Checks:
- vitest `tests/unit/counts`: 15 files / 123 tests pass, including the new `counts-judge-r1.test.ts` (8 tests); the round6 header test is updated for the description rule. `foundation-f3/password-login` and `foundation/f-patch-requests` pass.
- tsc: 0 errors in counts and auth paths. eslint on the touched files: 0 errors; the warnings left were already there.
- Headless scripts are in `kitstak-critic/counts/jr1/` (g1, g4, g5, g6, g7). No console errors and no 5xx in those runs. One run hit a dev-server restart (connection refused) and passed when retried.
