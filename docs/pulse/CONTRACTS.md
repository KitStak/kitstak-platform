# KitStak Pulse: team contracts

Foundation is in place: a runnable app (`apps/pulse`, port 3500), the `pulse` schema migrated (46 tables), the full
domain layer for jobs, production, time, materials, costs, revenue, extra services, plans, rates, periods, alerts and
profit, server actions, 70 `/api/v1` routes, React Query hooks, the pure money / profit / CSV libraries, the design
system, the shell, and a page for every route in the spec. Most pages are still **teaching frames**: they render the
right header, tabs and empty state but do not read data yet. Each team now makes its pages real.

Read `docs/pulse/SPEC.md` for what to build and `apps/pulse/AGENTS.md` for the house rules. This file says who owns
what and what already exists, so nobody builds a thing twice. When you need something outside your folders, add it in a
backwards compatible way and say so in your report.

## 1. Folder ownership

All paths are inside `apps/pulse` unless they start with `apps/` or `packages/`.

| Team | Owns | Routes |
| --- | --- | --- |
| **foundation** | `src/server/{auth,db,env,session,entitlements,errors,page}.ts`, `src/server/db/schema`, `src/server/http`, `src/server/domain/*` and `src/server/actions/*` that exist today, `src/app/api/v1/*` that exist today, `src/components/{ui,pulse,layout}`, `src/features/{shell,command,search,access}`, `src/lib/*`, `drizzle/*`, `scripts/*`, `e2e/smoke.spec.ts` | `/search`, `/login`, `/forgot-password`, `/no-workspace` |
| **jobs** | `src/features/jobs` (jobs list with the at risk and losing money board, new job, job detail frame and every tab: overview, plan vs actual with the quote vs actual view, work log, materials, money in, activity), `src/app/(app)/jobs/**` | `/jobs`, `/jobs/new`, `/jobs/[ref]`, `/jobs/[ref]/{plan,work,materials,money-in,activity}`, `/jobs/by-link` |
| **production** | `src/features/log` (daily entry grid, review the day, all entries, bulk grid), `src/features/kiosk`, `src/features/target-pace` (standards), `src/features/labor` (labor classes, labor rates, time not on a job, paid hours), `src/app/kiosk/**`, new domain files `src/server/domain/{punches,devices}.ts` | `/log`, `/log/review`, `/log/entries`, `/labor`, `/target-pace`, `/kiosk/t/[token]` |
| **profit** | `src/features/home`, `src/features/profit` (explorer by job, client, job type, extra service, site, month, week, day), `src/features/clients`, `src/features/services`, `src/features/reports`, `src/components/charts` (new: the one chart library every team uses), new domain files `src/server/domain/{explain,reports}.ts` | `/`, `/profit`, `/clients/[id]`, `/clients/by-link`, `/services`, `/services/[id]`, `/reports`, `/reports/[slug]` |
| **money-ops** | `src/features/calculator` (quote calculator and what if), `src/features/alerts`, `src/features/goals` (targets), `src/features/wall`, new `src/features/{materials,costs,revenue,periods}` (entry forms and tables that the job tabs and the client page mount by path), `src/app/wall/**`, new domain file `src/server/domain/quotes.ts` | `/calculator`, `/alerts`, `/alerts/rules`, `/goals`, `/settings/close` (page file imports from `src/features/periods`), `/wall`, `/wall/t/[token]` |
| **data** | `src/features/imports`, `src/features/export`, `src/features/settings` (all sections, roles, sites, catalogs, connected apps page shell, audit log), `src/features/welcome` (onboarding and sample data), new `src/features/views` (saved views bar any list can mount), new domain files `src/server/domain/{imports,exports,sample}.ts`, routes `src/app/api/v1/{import,export,templates}/**` | `/import`, `/import/new`, `/import/[batchId]`, `/export`, `/settings`, `/settings/audit`, `/welcome` |
| **integrations** | `apps/crm`, `apps/wms`, `apps/portal`, `apps/projects`, `apps/web`, `packages/*` (new `packages/pulse-bridge`), `apps/pulse/src/server/integrations`, new `src/features/integrations` (record chips, link dialogs, the body of `/settings/apps`), `docs/DEPLOYMENT.md`, `deploy/*`, new domain file `src/server/domain/sync.ts` | `/settings/apps` body, deep links from sibling apps |
| **seed** | `src/server/db/seed` (keep `context.ts` helpers and the `SEEDS` registry in `index.ts`; `minimal.ts` stays, because `reconcile.db.test.ts` runs it) | none |

Shared files anyone may extend **additively** (add, never rename or change a signature): `src/lib/types.ts`,
`src/lib/query-keys.ts`, `src/lib/hooks/use-data.ts`, `src/lib/constants.ts`, `src/lib/routes.ts`, `src/lib/nav.ts`,
`src/lib/reports.ts`, `src/lib/streams.ts`, `src/server/domain/index.ts` (one export line per new file),
`src/server/actions/*` (add actions or a new file), `src/app/api/v1/*` (add routes), `src/components/pulse/index.ts`.
If two teams need the same new helper, the first one adds it to a shared file and reports it.

Schema changes: a new migration `drizzle/0001_<name>.sql` (next free number) plus a journal entry in
`drizzle/meta/_journal.json` plus the Drizzle mirror in `src/server/db/schema`. `0000_pulse_init.sql` is applied and
immutable. Never `drizzle-kit push`. Most tables you need already exist (see section 3): check before adding one.

## 2. How a route is wired

```
src/app/(app)/<route>/page.tsx        thin: imports XPage from '@/features/<area>' (index.ts), exports metadata
src/features/<area>/<area>-page.tsx   server component: pulsePage() + domain reads, then <XView initial... />
src/features/<area>/<area>-view.tsx   'use client': hooks (initialData = server data), actions, UI
```

- `pulsePage(returnTo, navId?)` (`src/server/page.ts`) returns `{ ctx, context, access, blocked, can(action), integrations() }`.
  It redirects to `/login?next=` when signed out. When `blocked` is set, render `<PageBlocked>` from
  `@/features/access/page-blocked` and stop. `pageContext(returnTo)` is the smaller form: `{ ctx, context }`.
- The `(app)` layout already checks the `pulse` entitlement (locked screen), the Pulse role ("Ask an admin for access"
  screen for role `none`), and renders the shell. Supervisors are sent from `/` to `/log`.
- **Real 404s** go in `src/app/(app)/layout.tsx` before any Suspense boundary (unknown report slugs do this today).
  Unknown jobs, clients, services and import batches still render an in page "We could not find that" at status 200:
  the owning team moves each to a real `notFound()`.
- **Client components import client files by path** (`@/features/log/log-grid`), never a feature `index.ts`, because an
  index also exports server pages and would pull server code into the browser bundle.
- Add a route: create `src/app/(app)/<path>/page.tsx` and the feature files, add a builder to `src/lib/routes.ts`, and
  if it is top level add one entry to `src/lib/nav.ts` (the navigation, the mobile menu, the command palette, the `g`
  chords and the search page all read that one list).
- Use `routes.*` builders, never string literals. Tabs that are URLs use `<RouteTabs>` from `@/components/pulse`.
- Sibling links arrive at `/jobs/by-link?type=&id=` and `/clients/by-link?...`. Today they prefill `/jobs/new` or open
  the Clients tab. They must first look for an existing record (`findJobsByLink`, `findClientByRef`) and open it.

Routes and their feature folder:

| Route | Feature folder | Team | State today |
| --- | --- | --- | --- |
| `/` | `features/home` | profit | teaching frame, checklist |
| `/jobs?tab=open\|all\|completed\|planned` | `features/jobs` (`jobs-page.tsx`) | jobs | teaching frame |
| `/jobs/new` | `features/jobs` (`new-job-page.tsx`) | jobs | teaching frame, no form |
| `/jobs/[ref]`, `/plan`, `/work`, `/materials`, `/money-in`, `/activity` | `features/jobs` (`job-page.tsx`) | jobs | tab frame |
| `/jobs/by-link` | page file only | jobs | redirects to a prefilled new job |
| `/log?date=`, `/log/review`, `/log/entries` | `features/log` | production | teaching frame |
| `/labor?tab=classes\|rates\|time` | `features/labor` | production | teaching frame |
| `/target-pace` | `features/target-pace` | production | teaching frame |
| `/kiosk/t/[token]` (public, no shell) | `features/kiosk` | production | "link is not active" |
| `/profit?by=` | `features/profit` | profit | teaching frame |
| `/clients/[id]`, `/clients/by-link` | `features/clients` | profit | frame |
| `/services`, `/services/[id]` | `features/services` | profit | frame |
| `/reports`, `/reports/[slug]` (19 slugs in `src/lib/reports.ts`) | `features/reports` | profit | catalog, real 404 |
| `/calculator` | `features/calculator` | money-ops | teaching frame, no form |
| `/goals` | `features/goals` | money-ops | teaching frame |
| `/alerts`, `/alerts/rules` | `features/alerts` | money-ops | teaching frame |
| `/settings/close` | `features/settings` today, moves to `features/periods` | money-ops | frame |
| `/wall` (signed in, refreshes every 60 s), `/wall/t/[token]` (public) | `features/wall` | money-ops | frame |
| `/import`, `/import/new?stream=`, `/import/[batchId]` | `features/imports` | data | stream catalog, no upload |
| `/export` | `features/export` | data | stream catalog |
| `/settings?section=`, `/settings/audit` | `features/settings` | data | math text is real, no forms |
| `/settings/apps` | `features/settings` | integrations | live connection status |
| `/welcome` | `features/welcome` | data | teaching frame |
| `/search?q=` | `features/search` | foundation | works on the nav list; `searchAll` is ready for records |
| `/login`, `/forgot-password`, `/no-workspace` | `app/(auth)`, `app/no-workspace` | foundation | done |

## 3. Data model (`pulse` schema)

SQL: `drizzle/0000_pulse_init.sql`. Drizzle mirror: `src/server/db/schema/{setup,jobs,streams,control}.ts` (barrel
`@/server/db/schema`). Every table has `org_id` (FK to `core.organization`, cascade), RLS enabled, `UNIQUE (org_id, id)`
and composite `(org_id, x_id)` foreign keys, so a row can never point into another org.

| Group | Tables |
| --- | --- |
| Setup | `settings`, `member_roles`, `sites`, `clients`, `labor_classes`, `job_types`, `labor_rates`, `items`, `vas_services`, `standards`, `targets` |
| Jobs | `jobs`, `job_prices`, `job_plans`, `job_plan_lines`, `job_links`, `job_stats` |
| Dated streams | `production_entries`, `indirect_entries`, `paid_hours`, `time_punches`, `material_usage`, `cost_entries`, `revenue_entries`, `vas_entries` |
| Rollups | `fact_days`, `company_days`, view `v_facts` |
| Control | `periods`, `day_reviews`, `alert_rules`, `alerts`, `notifications`, `saved_views`, `activity`, `user_prefs` |
| System (tables exist, no domain yet) | `import_batches`, `import_rows`, `import_presets`, `quote_scenarios`, `report_schedules`, `report_runs`, `device_links`, `sync_state`, `sync_runs`, `dismissals`, `bridge_events` |

Conventions:

- uuid ids; soft delete with `deleted_at`; optimistic locking with `version` on stream and setup rows.
- Money is **integer cents** (`bigint`). Rates per hour are cents. Per unit prices and costs are currency units
  (`numeric(…,4)`), so a SQL product of quantity and unit price takes `* 100`. The worked example tests pin this.
- Hours are `numeric(…,2)`, quantities `numeric(…,3)`, pace `numeric(…,3)`, percents are basis points (int).
- Dates are `YYYY-MM-DD`; "today" is per site time zone (`todayInZone`). Months are their first day.
- Stream rows carry `source`, `source_ref`, `import_batch_id` and `is_sample`, so imports, sibling sync and sample data
  can be found and removed.
- Jobs have a per org number (`J-1001`); every `[ref]` route and API accepts the number or the uuid.

Database objects:

- `pulse.guard_closed_month()` on the eight dated streams: SQLSTATE `KP001`, message `month_closed:YYYY-MM`. The domain
  turns it into "October is closed. Ask the owner to reopen it." Bypassed only by `SET LOCAL pulse.allow_purge = 'on'`.
- `pulse.activity_immutable()`: the audit log cannot be edited (SQLSTATE `KP002`).
- `pulse.rate_for(org, class, site, date)` returns the dated rate in force: `(found, rate_cents, overtime_rate_cents,
  wage_cents, overhead_cents, mult, bill_rate_cents, rate_id, labor_class_id, source)`, `source` is `class`, `default`
  or `none`. Site rows beat all sites rows, the latest `effective_from` wins, then the org default rate.
- `pulse.v_facts`: the row level source of every profit number. Kinds: `revenue_base`, `revenue_vas`, `revenue_other`,
  `labor`, `material`, `other`, `shared`, `billed_memo` (never revenue). `fact_days` is the same thing summed per day,
  site, client, job, service and kind; every date range screen reads it with one grouped statement.
- `job_stats`: one cached row per job (totals, pace, projection, risk status and reasons, what is missing).

Differences from the spec, all deliberate: `jobs.activated_at`, `job_stats.setup_hours`, `job_stats.target_margin_bp`,
`alert_rules.created_by`, a unique index for one default site per org, `job_plans` totals `NOT NULL DEFAULT 0`, stream
to parent foreign keys are `NO ACTION` (an org cascade deletes parents and children in one statement), and
`fixed_true_up` revenue rows count as `revenue_base`.

## 4. The math contract (SQL and the pure library agree)

- Stamps (labor cost, overhead, gross pay, base revenue, standard material, shared cost) are written by SQL in
  `src/server/domain/recalc.ts` with Postgres `numeric` and `round()`, which rounds half away from zero.
- The same formulas live as pure functions in `src/lib/profit/*` with `divRound` (half away from zero) on `BigInt`.
- `src/server/domain/reconcile.db.test.ts` proves they agree: it seeds a throwaway org with the minimal seed, rebuilds
  every job's summary from raw hours, units, rates and prices with only the pure library, and asserts equality to the
  cent against the row stamps, `fact_days`, `job_stats`, `getJobProfit`, the profit page total and the company bridge.
- Derived numbers in DTOs come from the pure library: `toProfitRow` uses `profitSummary`, `getCompanyBridge` uses
  `companyBridge`, `sharedGap`, `payrollGap` and `utilizationBp`, `recomputeJobs` uses `paceDays`, `projectJob` and
  `assessRisk`. **Never write a margin, a per unit cost or a rounding rule in a component.** Call the library.
- Risk rules follow SPEC 4.14 exactly, with these confirmed readings: the headline is the most negative impact inside
  the group that set the status; W1 is not added when R1 or R2 fired; R5, R6, W5, W6 and W8 are skipped for completed
  jobs; the spec's own worked example also trips W4. Rule D1 also counts typed days with units and zero hours.
- Risk reasons store numbers only. Words are made at read time for the reader (`riskSentence(reason, { seesMoney,
  unitLabel })`); every rule has a no money variant. `toJobStatsDTO` already does this per reader.
- Profit rows: `uph` is units over all labor hours of the group. The job page pace (`job_stats.uph`) uses counted days.

## 5. Domain layer (`@/server/domain`, server only)

Every function takes `ctx: DomainContext` first (`{ orgId, orgSlug, userId, userName, orgRole, actorKind }`). Writes
check permission (`requirePulse(ctx, action)`), run in one transaction (`inTx`), write an activity row, and end in
`finishWrite`, which respreads shared cost and refreshes `company_days`, `fact_days` and `job_stats` for what moved.
Errors are `DomainError(code, plainMessage, fields?)` from `@/server/errors`. Functions whose first argument is a
lowercase `tx` or `executor` are for use inside a transaction.

- **`_shared`**: `toDomainContext`, `iso`, `isoRequired`, `cleanText`, `isUuid`, `monthName`, `monthStart`,
  `singular(unitLabel)`, `inTx(fn, existing?)`, `monthClosedError(month)`, `assertVersion(current, expected)` (CONFLICT
  "Someone else changed this row. Here is the new one."), `centsOut`, `moneyOut(show, v)`, `hideUnless(show, v)`,
  `todayInZone(tz, now?)`, `isValidTimezone`, `rows<T>(executor, sql)`, `uuidArray`, `uuidIn`, `dateArray`, `diff`,
  `jsonSafe`, `defined`.
- **`access`**: `resolveAccess(inputs)` (pure: explicit `member_roles` row, then WMS user by email, then org role),
  `pulseAccessFor(ctx)`, `freshPulseAccess(ctx)`, `requirePulse(ctx, action)`, `requireMoney(ctx)`, `accessDenied(role)`.
  `PulseAccess = { role, seesMoney, seesWages, source, seesMoneySwitch }`.
- **`roles`**: `listMemberRoles`, `setMemberRole(ctx, userId, { role?, seesMoney? })`, `clearMemberRole`, `myAccess`,
  `whoRunsPulse`, `claimPulseOwnership`, `setKioskPin(ctx, userId, pin|null)`, `verifyKioskPin(stored, pin)`,
  `resolveAllAccess`, `userIdsWithRoles`.
- **`settings`**: `loadSettings(orgId, executor?)` (lazy create plus default site "Main site", job type `GENERAL` and
  12 system alert rules), `getSettings`, `updateSettings(ctx, patch)` (a change that feeds the math runs `recalcOrg`
  inline), `setOnboarding(ctx, key, value)`, `defaultSiteId`, `generalJobTypeId`, `SYSTEM_ALERT_RULES`.
- **`catalog`**: sites (`listSites`, `resolveSite`, `createSite`, `updateSite`, `deleteSite`), clients (`listClients(ctx,
  { q?, includeInactive?, includeDeleted? })`, `getClient`, `findClientByRef(ctx, { pulseClientId?, coreCustomerId?,
  crmAccountItemId? })`, `createClient`, `ensureClientByName(tx, ctx, name)`, `updateClient(ctx, id, patch, version?)`,
  `deleteClient`, `restoreClient`), job types (`listJobTypes`, `createJobType`, `updateJobType`, `deleteJobType`), items
  (`listItems(ctx, { q?, clientId?, limit? })`, `createItem`, `updateItem`, `deleteItem`), extra services
  (`listVasServices`, `getVasService`, `createVasService`, `updateVasService`, `deleteVasService`). Each has an
  `insertX(tx, …)` twin and a `toXDTO`.
- **`labor`**: `listLaborClasses`, `createLaborClass` (the first class of an org becomes the default),
  `updateLaborClass`, `deleteLaborClass`, `listLaborRates(ctx, { laborClassId? })` (FORBIDDEN without `money:read`; wage
  fields null without wage rights), `createLaborRate`, `updateLaborRate(ctx, rateId, patch, version?)`,
  `deleteLaborRate`, `previewLaborRate(ctx, input)` (how many rows and dollars a rate change restamps),
  `rateForEntry(ctx, { laborClassId, siteId, workDate })`.
- **`jobs`**: read `listJobs(ctx, JobListFilters)`, `listJobsNeedingAttention(ctx, limit)`, `countJobsByRisk`,
  `getJob(ctx, ref)`, `listDeletedJobs`, `findJobsByLink(ctx, type, id)`; create `createJob(ctx, JobInput)`,
  `quickAddJob(ctx, { clientId?|clientName?, name, plannedUnits?, unitPrice?, siteId? })`; change `updateJob(ctx, jobId,
  patch, version?)`, `setJobStatus(ctx, jobId, status, { completedDate?, version? })`, `bulkUpdateJobs(ctx, ids, {
  status?, ownerId?, archived? })`, `duplicateJob`, `archiveJob`, `deleteJob`, `restoreJob`; prices `listJobPrices`,
  `setJobPrice(ctx, jobId, { effectiveFrom?, unitPrice?, billRateCents?, materialCostPerUnit?, note? })`,
  `deleteJobPrice`; links `addJobLink`, `removeJobLink`; DTOs `toJobDTO`, `toJobStatsDTO(stats, access, unitLabel)`.
- **`plans`**: `getJobPlans(ctx, jobId)`, `savePlan(ctx, jobId, 'quote'|'budget', PlanInput)`,
  `makeBudgetFromQuote(ctx, jobId)`, `deletePlan(ctx, jobId, kind)`.
- **`production`**: `saveProductionEntry(ctx, input)` (upsert by `id`, else by job, day, shift and class; returns `{
  entry, created }`), `saveProductionBulk(ctx, inputs[])` (all or nothing, cap 5,000), `deleteProductionEntries`,
  `restoreProductionEntries`, `listProduction(ctx, filters)`, `getLogGrid(ctx, { date?, siteId? })`,
  `getPreviousCrew(ctx, { date, siteId? })`, `assertCanLogDay`, `dayLockReason`.
- **`time`**: `listIndirect`, `saveIndirectEntry`, `deleteIndirectEntry`, `restoreIndirectEntry`, `listPaidHours`,
  `savePaidHours` (upsert per site, day, class), `deletePaidHours`, `restorePaidHours`.
- **`entries`**: `listMaterialUsage` / `saveMaterialUsage`, `listCosts(ctx, filters & { scope? })` / `saveCost` (job,
  else client, else company), `listRevenue(ctx, filters & { kind? })` / `saveRevenue`, `listVasEntries(ctx, filters & {
  vasServiceId?, noPrice? })` / `saveVasEntry`. Each has `deleteX` and `restoreX`.
- **`reviews`**: `markDayComplete(ctx, { siteId?, date })`, `reviewDay(ctx, { siteId, date, decision:
  'approve'|'send_back'|'reopen', note? })`, `listDayReviews`, `dayFlags(ctx, siteId, date)`.
- **`standards`**: `listStandards`, `saveStandard`, `deleteStandard`, `suggestStandard(ctx, { jobTypeId, clientId?,
  laborClassId? })`, `listTargets(ctx, { scope?, scopeId?, month? })`, `saveTarget` (upsert), `deleteTarget`.
- **`periods`**: `listPeriods`, `isMonthClosed(ctx, date)`, `getCloseChecklist(ctx, month)`, `closePeriod(ctx, month)`,
  `reopenPeriod(ctx, month, reason)` (owner only).
- **`alerts`**: rules `listAlertRules`, `createAlertRule`, `updateAlertRule`, `deleteAlertRule`; `evaluateAlerts(ctx)`
  returns `{ created, updated, resolved }`; `raiseAlert`, `clearAlert`; inbox `listAlerts(ctx, { status?, entityType?,
  entityId?, assignedTo?, limit? })`, `countOpenAlerts`, `updateAlert(ctx, alertId, change)`. Dismissed alerts stay
  quiet while their condition lasts. Words: `renderAlertWords(kind, params, seesMoney)`.
- **`notifications`**: `notify(executor, ctx, userIds, { kind, params?, url?, alertId?, jobId? })`,
  `listNotifications`, `countUnreadNotifications`, `markNotificationsRead(ctx, ids?)`, `archiveNotifications`.
- **`views`**: `listSavedViews(ctx, page?)`, `saveView`, `deleteView`, `getUserPrefs`, `updateUserPrefs(ctx, patch)`,
  `recordRecentJob(ctx, jobId)`.
- **`activity`**: `logActivity(executor, ctx, entry|entries)`, `listActivity(ctx, filters)` returns `{ items,
  nextCursor }`, `addNote(ctx, { jobId?, clientId?, body })`, `countActivity`, `ACTIVITY_SAFE_FIELDS`.
- **`profit`**: `getProfit(ctx, by, filters, { comparePrior?, trend? })` returns `ProfitResponse` (`rows`, `total`,
  `moneyHidden`), `getJobProfit(ctx, jobId)`, `getProfitTrend(ctx, filters, bucket?)`, `listFacts(ctx, filters & {
  kinds?, limit? })` (the drill down), `getCompanyBridge(ctx, { from, to, siteId? })`, `getSummary`, `getLaborSummary`,
  `getBadges(ctx)`, `priorRange`, `autoBucket`.
- **`recalc`**: `newTouched`, `touchDay`, `touchJob`, `assertOpen`, `closedMonths`, `restampProduction | restampIndirect
  | restampVas | restampUsage(executor, orgId, where)` (`where` is written against alias `src`; open months only),
  `restampFixedJob`, `refreshCompanyDays`, `refreshFacts`, `finishWrite(executor, ctx, touched)`, `recalcOrg`.
- **`job-stats`**: `recomputeJobs(executor, ctx, jobIds)`.
- **`cron`**: `systemContext(orgId)`, `orgsUsingPulse()`, `tickOrg(orgId)`, `runTick(budgetMs?)`, `runCleanup()`.
- **`search`**: `searchAll(ctx, query, limit)` returns `SearchHitDTO[]`. **`people`**: `listOrgPeople`, `getPeople`,
  `isOrgMember`, `filterOrgMembers`.

A stream write you add must: call `assertOpen` for its dates, `touchDay` and `touchJob` what it moved, log activity in
the same transaction, and end with `finishWrite`. Look at `saveCost` in `entries.ts` for the shortest full example.

## 6. Server actions (`@/server/actions/<file>`, `'use server'`)

All return `ActionResult<T> = { ok: true, data } | { ok: false, error: { code, message, fields? } }`, are zod validated
(shared pieces in `schemas.ts`: decimals accept a string or a number and come out as exact strings, cents are integers),
and go through `runAction` in `_action.ts`. Call them from clients with `useServerAction(action, { invalidate,
successMessage, onSuccess })` or `unwrap()` inside a React Query mutation (`src/lib/hooks/use-action.ts`). Update
actions take `{ <entity>Id, patch, version? }`; save actions for stream rows take the row with optional `id` and `version`.

| File | Actions |
| --- | --- |
| `settings` | `updateSettingsAction`, `setOnboardingAction`, `createSiteAction`, `updateSiteAction`, `deleteSiteAction`, `setMemberRoleAction`, `clearMemberRoleAction`, `claimPulseOwnershipAction`, `setKioskPinAction` |
| `catalog` | `create/update/delete` for `Client` (plus `restoreClientAction`), `JobType`, `Item`, `VasService` |
| `labor` | `create/update/delete` for `LaborClass` and `LaborRate`, `previewLaborRateAction` |
| `jobs` | `createJobAction`, `quickAddJobAction`, `updateJobAction`, `setJobStatusAction`, `bulkUpdateJobsAction`, `duplicateJobAction`, `archiveJobAction`, `deleteJobAction`, `restoreJobAction`, `setJobPriceAction`, `deleteJobPriceAction`, `addJobLinkAction`, `removeJobLinkAction`, `savePlanAction`, `makeBudgetFromQuoteAction`, `deletePlanAction`, `addNoteAction` |
| `log` | `saveProductionEntryAction` (no revalidate, for the grid), `saveProductionBulkAction`, `deleteProductionEntriesAction`, `restoreProductionEntriesAction`, `saveIndirectEntryAction`, `deleteIndirectEntryAction`, `restoreIndirectEntryAction`, `savePaidHoursAction`, `deletePaidHoursAction`, `restorePaidHoursAction`, `markDayCompleteAction`, `reviewDayAction` |
| `entries` | `saveMaterialUsageAction`, `saveCostAction`, `saveRevenueAction`, `saveVasEntryAction`, each with `delete…Action` and `restore…Action` taking `{ id }` |
| `planning` | `saveStandardAction`, `deleteStandardAction`, `saveTargetAction`, `deleteTargetAction`, `closePeriodAction({ month })`, `reopenPeriodAction({ month, reason })` |
| `alerts` | `createAlertRuleAction`, `updateAlertRuleAction`, `deleteAlertRuleAction`, `updateAlertAction({ alertId, change })`, `evaluateAlertsAction`, `markNotificationsReadAction({ ids? })`, `archiveNotificationsAction` |
| `views` | `saveViewAction`, `deleteViewAction`, `updateUserPrefsAction({ patch })`, `recordRecentJobAction` |

After a stream write, invalidate `qk.streams()`, `qk.jobsRoot()`, `qk.profitRoot()`, `qk.summaryRoot()` and `qk.badges()`.
The actions typecheck and the domain under them is tested, but no action has been called over the wire yet: the first
team to use one reports anything odd.

## 7. JSON API (`/api/v1`, envelope `{ data }` or `{ error: { code, message, fields? } }`)

Every route needs the shared session cookie and the `pulse` entitlement, and answers for the active org only. The API is
**same origin only**: no route sends CORS headers (SPEC 8.7). Sibling apps read and write Pulse through
`@kitstak/pulse-bridge` over the shared database. Writes pass a CSRF guard. `from` and `to` default to this month
through today. Ids are uuids; a bad filter gives 422 with the allowed values in plain words.

Build a route with `apiRoute(async ({ ctx, request, params }) => …)` from `src/server/http/api.ts`; read filters with
`str`, `dateParam`, `uuidParam`, `intParam`, `oneOf`, `listOf`, `flag` and `rangeParams` from `src/server/http/params.ts`;
send files with `csvResponse(fileName, body)`.

| Route | Params | Returns |
| --- | --- | --- |
| `GET me`, `people` | | who you are (`pulseRole`, `seesMoney`, `modules`), org people |
| `GET summary` | `from,to,site` | `SummaryDTO` |
| `GET badges` | | `BadgesDTO` (`jobsAtRisk`, `openAlerts`, `unreadNotifications`) |
| `GET settings`, `sites` | | `SettingsDTO`, `SiteDTO[]` |
| `GET clients`, `clients/[id]`, `clients/by-ref` | `q,active,deleted` / / `client,coreCustomerId,crmAccountItemId` | `ClientDTO[]` with job counts, `ClientDTO`, `ClientDTO \| null` |
| `GET job-types`, `labor-classes` | `archived` | `JobTypeDTO[]`, `LaborClassDTO[]` |
| `GET labor-rates`, `labor-rates/for-entry` | `laborClass` / `laborClass,site,date` | `LaborRateDTO[]` (403 without money), `RateForEntryDTO` |
| `GET labor/summary` | `from,to,site` | `LaborSummaryDTO` |
| `GET items` | `q,client,limit` | `ItemDTO[]` |
| `GET services`, `services/[id]` | `inactive` | `VasServiceDTO[]`, `VasServiceDTO` |
| `GET standards`, `standards/suggest`, `targets` | `jobType,service,client` / `jobType,client,laborClass` / `scope,scopeId,month` | `StandardDTO[]`, `PaceSuggestionDTO`, `TargetDTO[]` |
| `GET jobs` | `tab (open\|all\|completed\|planned),q,client,jobType,site,owner,status,risk,archived,deleted,limit` | `JobListItemDTO[]`, worst risk first |
| `GET jobs/attention`, `jobs/counts`, `jobs/deleted` | `limit` / `client,jobType,site` / | `JobListItemDTO[]`, `{ losing, at_risk, heads_up, on_track, no_data, none }`, `JobListItemDTO[]` |
| `GET jobs/by-link` | `type (crm_deal\|crm_account\|wms_work_order\|wms_shipment_order\|wms_client\|pm_project\|pm_task\|core_customer),id` | `JobListItemDTO[]` |
| `GET jobs/[ref]`, `/plans`, `/prices`, `/days` | id or number; `by=day\|week\|month` | `JobDetailDTO`, `JobPlansDTO`, `JobPriceDTO[]`, `ProfitResponse` for the job's whole life |
| `GET log`, `log/previous-crew` | `date,site` | `LogGridDTO`, `PreviousCrewDTO[]` |
| `PUT log/rows` | JSON production row | `{ entry, created }`; a 409 carries `error.fresh` (the newer row) |
| `GET production` | `job,client,site,laborClass,from,to,source,needsHours,deleted,limit,offset` | `ProductionEntryDTO[]` |
| `GET indirect`, `paid-hours` | `site,from,to,deleted,limit` | `IndirectEntryDTO[]`, `PaidHoursDTO[]` |
| `GET materials`, `costs`, `revenue`, `service-entries` | `job,client,site,from,to,deleted,limit` plus `scope` / `kind` / `service,noPrice` | matching DTO arrays |
| `GET profit` | `by (job\|client\|type\|service\|site\|month\|week\|day),from,to,site,client,jobType,job,service,status,compare,trend` | `ProfitResponse` |
| `GET profit/trend`, `profit/facts` | profit filters, `bucket` / `kinds,limit` | `TrendPointDTO[]`, `FactRowDTO[]` |
| `GET company-bridge` | `from,to,site` | `CompanyBridgeDTO` |
| `GET periods`, `periods/[month]/checklist` | month is `YYYY-MM` | `PeriodDTO[]`, `CloseChecklistDTO` |
| `GET day-reviews` | `site,from,to,status` | `DayReviewDTO[]` |
| `GET alerts`, `alerts/unread`, `alert-rules` | `status,entityType,entityId,assignedTo,limit` | `AlertDTO[]`, `{ count }`, `AlertRuleDTO[]` |
| `GET notifications`, `views`, `prefs` | `unread,limit` / `page` | `NotificationDTO[]`, `SavedViewDTO[]`, `UserPrefsDTO` |
| `GET activity` | `job,client,entityType,entityId,actor,verb,from,to,cursor,limit` | `{ items, nextCursor }` |
| `GET roles`, `roles/run-state` | | `MemberRoleDTO[]`, `RunPulseDTO` |
| `GET search` | `q,limit` | `SearchHitDTO[]` |
| `GET cron/tick`, `cron/cleanup` | `Authorization: Bearer $CRON_SECRET` | counts; 503 when the secret is unset (as on a dev machine) |

Deep links sibling apps may use: `/jobs/<number>`, `/jobs/by-link?type=&id=`, `/clients/by-link?coreCustomerId=` or
`crmAccountItemId=`, `/jobs/new?client=&name=&…` (`NewJobPrefill` in `src/lib/routes.ts`), `/log?date=&job=`.

## 8. Hooks (`src/lib/hooks/use-data.ts`, keys in `src/lib/query-keys.ts`)

Each hook takes its filters and an optional React Query options object, so a server page can pass `initialData`.

- **Who and where**: `useMe`, `usePeople`, `useBadges`, `useSettings`, `useSites`, `useMemberRoles`, `useRunState`.
- **Setup**: `useClients`, `useClient`, `useClientByRef`, `useJobTypes`, `useLaborClasses`, `useLaborRates`,
  `useRateForEntry`, `useItems`, `useVasServices`, `useVasService`, `useStandards`, `useStandardSuggestion`, `useTargets`.
- **Jobs**: `useJobs`, `useJobsNeedingAttention`, `useJobCounts`, `useJobsByLink`, `useDeletedJobs`, `useJob`,
  `useJobPlans`, `useJobPrices`, `useJobDays`.
- **Streams**: `useLogGrid`, `usePreviousCrew`, `useProduction`, `useIndirect`, `usePaidHours`, `useMaterialUsage`,
  `useCosts`, `useRevenue`, `useVasEntries`, `useDayReviews`.
- **Profit**: `useSummary`, `useProfit(by, params)`, `useProfitTrend`, `useProfitFacts`, `useCompanyBridge`,
  `useLaborSummary`.
- **Control**: `usePeriods`, `useCloseChecklist`, `useAlerts`, `useAlertsUnread`, `useAlertRules`, `useNotifications`,
  `useSavedViews`, `useUserPrefs`, `useActivity`, `useSearch`.
- Others in `src/lib/hooks`: `useServerAction` and `unwrap` (`use-action.ts`), `useDebouncedValue`, `useHotkey`
  (`use-hotkeys.ts`), `usePeople` map (`use-people.ts`).

DTOs are all in `src/lib/types.ts`. Cents are JS numbers (checked safe integers); quantities, hours, prices and paces
are decimal strings; a hidden money field is `null` and the DTO carries `moneyHidden: true`. Stored enums and their on
screen labels are in `src/lib/constants.ts` (`PROFIT_GROUPS`, `JOB_TABS`, `SUPERVISOR_EDIT_DAYS`, risk status labels).

## 9. Pure libraries (no server or React imports; safe in client components and tests)

Money in and out is `bigint` cents. Hours, quantities, prices and pace go in as `Decimal = number | string` (Postgres
numeric strings are exact) and come out as rounded numbers. `bigint` does not JSON serialize: convert with
`centsToNumber`. The build target is ES2017, so write `BigInt(10)`, not `10n`.

- **`@/lib/money`**: `divRound` (the one rounding rule), `toCents`, `centsToNumber`, `decimalToCents`,
  `centsToDecimal`, `addCents`, `subCents`, `sumCents`, `sumBy`, `mulHoursRate`, `mulQuantityPrice`, `mulQuantityCents`,
  `mulBp`, `mulRatio`, `ratioBp`, `marginBp`, `marginGap`, `changeBp`, `perUnitCents`, `perHourCents`, `allocate`
  (largest remainder, sums exactly), `splitEvenly`, exact fractions (`frac`, `fracAdd`, `fracMul`, `fracRound`, …).
- **`@/lib/format`**: `formatMoney`, `formatMoneyWhole`, `formatMoneyCompact`, `formatUnitPrice`,
  `formatMoneyPerHour` ("$21.76 an hour"), `formatMoneyPerUnit` ("$3.12 a kit"), `formatNumber`, `formatCompactNumber`,
  `formatPercentBp`, `formatPercentWhole`, `formatHours` (decimal, unit, short, clock), `formatUnits`, `pluralize`,
  `formatPace`, `formatHeadcount`, deltas (`formatMoneyDelta`, `formatPercentDelta`, `formatPointsDelta`,
  `formatHoursDelta`), `deltaTone(delta, goodWhen)`, `deltaDirection`, `formatMoneyPlain`, `formatDecimalPlain`.
  Every formatter takes `{ empty }` for the text shown when the value is null.
- **`@/lib/profit`** (the spec calls it `src/lib/calc`; this is the real path):
  - `calendar`: `addDays`, `daysBetween`, `isWorkDay`, `addWorkDays`, `workDaysBetween`, `startOfMonth`, `endOfMonth`,
    `startOfWeek`, `addMonths`, `poolPeriod`, `shortDate` ("Dec 9"), `weekdayName`.
  - `rates`: `loadedRate`, `defaultRate`, `pickRateRow`, `rateFor`, `rateBreakdown` (for "How we got this"),
    `suggestOverheadPerHour`, `overheadCovered`.
  - `labor`: `laborHoursFromCrew`, `laborCost` (the five stamps), `crewHoursCheck` (the "Is that right?" question).
  - `shared`: `allocateShared`, `spreadSharedCost`, `missingTime`, `averagePayRate`, `sharedGap`, `payrollGap`,
    `utilizationBp`, `sharedPercentNeeded`.
  - `materials`: `resolvePartsOwner`, `standardMaterial`, `actualMaterial`, `materialLeftFromUsage`, `scrapRateBp`.
  - `revenue`: `perUnitRevenue`, `hourlyRevenue`, `priceFor`, `fixedRevenueStamps`, `fixedTrueUp`, `serviceAmount`,
    `revenueTotals`.
  - `summary`: `sumFacts`, `profitSummary`, `addBuckets`, `marginGapLabel`, `companyBridge`.
  - `plan`: `planFigures`, `flexFactor`, `flexPlan`, `planTotalsFromLines`, `planSharedAuto`, `shouldCostPerUnit`,
    `planVsActual` (the 11 rows: Plan, Actual, Difference, Difference %, Projected, tone), `quoteLinesVsActual` (the
    quote vs actual view, per line), `quoteToBudget`.
  - `variance`: `varianceWaterfall({ plan, actual, mode })` (bars sum exactly to the total), `sumWaterfalls`,
    `biggestDrag`, `biggestLift`, `varianceReading` (one plain line per bar).
  - `pace`: `paceDays`, `paceOverall`, `lastEvidenceWindow`, `unitsPerHour`, `productivityBp`, `earnedHours`,
    `laborCostPerUnit`, `pickStandard`, `targetPace`, `targetMarginBp`.
  - `projection`: `jobMode`, `projectJob`, `projectionNote`. `Projection.atFinish` feeds the "Projected at finish"
    column and the at finish waterfall.
  - `risk`: `assessRisk`, `riskSentence`, `riskHeadline`, `riskSentences`, `NEXT_STEP_LABELS`, `DEFAULT_RISK_THRESHOLDS`.
  - `calculator`: `quoteCalculator(input)` (target price, breakeven, lowest price, at a typed price, `planTotals` ready
    to save as a quote), `quoteSensitivity`, `breakevenPrice`, `breakevenUnits`, `revenueForMargin`.
  - `clients`: `costToServe`, `rankByProfit` (whale curve), `rowsToReachProfitShare`.
  - `trends`: `previousPeriod`, `samePeriodLastYear`, `compareMoney`, `comparePeriods`, `moneySeries` (gap free, sums
    exactly), `runningTotal`, `movingAverage`, `trendLine`, `sparkline`, `bestAndWorst`, `streak`.
- **`@/lib/csv`** (all 17 streams of `src/lib/streams.ts` are defined):
  - `parse`: `parseCsv` (never throws; BOM, delimiter sniffing, row numbers match the spreadsheet), `CSV_LIMITS` (10 MB,
    50,000 rows, 200 columns).
  - `write`: `toCsv` (CRLF and BOM), `guardFormula`, `rawCell`, `exportFileName(stream, org, from?, to?)`.
  - `coerce`: `parseMoney` ("$1,234.50", "(45.00)", "1.234,50 €"), `parseHours` ("7:30", "7h 30m", "90 min"),
    `parseDate` (ISO, slashes by date order, month names, Excel serials), `parsePercent`, `parseNumber`, `parseBoolean`,
    `parseChoice`, each returning `{ ok, value } | { ok: false, message }`.
  - `headers`: `mapHeaders(headers, columns, { preset?, fuzzy? })` (exact, alias, then fuzzy; never guesses between two
    close columns), `mappingToPreset`, `headerSignature`.
  - `streams`: `STREAM_DEFS`, `streamDef(id)`, `streamColumns(id, { canSeeMoney?, canSeeWages?, layout? })`,
    `requiredColumns(id)`, typed records (`ProductionRecord`, `JobRecord`, …).
  - `read`: `readStreamCsv(stream, text, opts?)` (whole pipeline, client side preview), `readStreamRows(stream, {
    headers, rows, columns })` (server side, on stored raw rows with the chosen mapping), `errorReportCsv`,
    `formatIssue` ("Row 14, labor_hours: 9x is not a number.").
  - `template`: `templateCsv(stream, filter?)` (header plus two example rows), `howToFillCsv`, `streamToCsv(stream,
    records, opts?)` (export; round trips through the reader for every stream).
  - Not in the library (server work for the data team): lookups by code or name, "create missing", the new / changed /
    unchanged diff, the look alike check (`keyColumns` and `lookAlikeColumns` are on each stream def), same file hash,
    closed months, upload limits, commit and undo of a batch.
- Other pure files: `permissions.ts` (5 Pulse roles plus `none`, `PULSE_ACTION_MIN`, `canPulse`, `canSeeMoney`,
  `canSeeWages`, `canImportStream`), `streams.ts` (the stream catalog: label, what it is for, needed columns),
  `reports.ts` (19 reports: slug, title, what it answers), `nav.ts`, `routes.ts`, `dates.ts`, `search.ts`, `undash.ts`.

## 10. UI building blocks

- `@/components/ui` (the CRM and Projects design system, verbatim): Button, IconButton, Input, Textarea, SearchInput,
  Field, Select, Combobox, Checkbox, Switch, Tooltip, Popover, DropdownMenu (use `onSelect`, not `asChild`, for links),
  ContextMenu, Dialog (plus ConfirmDialog), Drawer, Tabs, ToggleGroup, Avatar, Badge, Chip, StatusPill, `toast`
  (`toast.undo(msg, { onUndo })`), EmptyState plus Illustration, Skeleton, ProgressBar, Kbd, ScrollArea, ColorPicker,
  DatePicker, **IsoDatePicker** (YYYY-MM-DD), **UserPicker**, Breadcrumbs, Card, Table, PageHeader, Spinner.
- `@/components/pulse`: `Teach` and `StepList` (the teaching empty state: what this is, why it matters, next step),
  `ButtonLink`, `RouteTabs` (tabs that are URLs), `BrandLoader`, `PersonAvatar` (by user id).
- `@/components/layout/page`: `Page` (header plus body; `width="default|narrow|full"`), `Panel`.
- `src/components/charts` does not exist yet. The **profit** team creates it first (bar, line, stacked bar, waterfall,
  sparkline, donut, progress ring; SVG, token colors, light and dark, keyboard reachable, a screen reader table for
  each). Every other team imports charts from there by path and asks profit for a missing one. Do not add a chart
  dependency: Projects' own SVG charts in `apps/projects/src/features/dashboards/charts.tsx` are the model.
- Shell API: `useShell()` gives `user`, `org`, `orgRole`, `orgs`, `pulseRole`, `seesMoney`, `seesWages`, `can(action)`,
  `modules`, `integrations`, `appUrls`, `badges`. `useShellStore.getState().openPalette(query?)` and
  `.openShortcuts()`. The shell is being reworked by its owner right now: do not edit `src/features/shell`, add nav
  entries only through `src/lib/nav.ts`.
- Badges: `loadShell()` fills `shellContext.badges` from `getBadges(ctx)` on every server render. A view that changes a
  job's risk or an alert calls `router.refresh()` or invalidates `qk.badges()`.
- Shortcuts in use: Ctrl or Cmd+K and `/` open the palette, `l` log work, `n` new job, `?` shortcuts, `g` then `h j l
  p a` (home, jobs, log, profit, alerts), Ctrl or Cmd+Z undo. `[` and `]` are reserved for the log page (previous and
  next day).
- Money hiding in UI: never branch on the role to hide a number. Render what the DTO gives; a `null` money field shows
  nothing or "Hidden", and `seesMoney` from `useShell()` only decides whether a money column or tab exists at all.
- Brand: `PulseMark` (`@/features/shell/logo`), loader `/brand/kitstak-loader-pulse.svg`. The official mark is the
  3 rect icon in `public/brand` (not the 6 rect sketch in SPEC section 10).

## 11. Dev, test and screenshots

```bash
cd apps/pulse
pnpm typecheck && pnpm lint && pnpm test          # 17 files, 355 tests; DB tests skip when Postgres is down
pnpm db:migrate                                    # applies drizzle/*.sql (table drizzle.__kitstak_pulse_migrations)
pnpm db:seed [--org=kitstak] [--email=] [--seed=minimal] [--keep]
NEXT_DIST_DIR=.next/<name> pnpm exec next dev -p 35xx        # personal servers 3501 to 3520, dist dir inside .next/
node scripts/shot.mjs --base http://localhost:35xx --out <dir> [--theme dark] [--width 390] [--full] / /jobs /profit
E2E_BASE_URL=http://localhost:35xx E2E_CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome pnpm exec playwright test
```

- `E2E_CHROMIUM` is needed on this machine: `@playwright/test` wants a newer browser build than the one installed.
  `shot.mjs` works without it. Never run `playwright install`.
- Do not run `pnpm build` while dev servers are up (it rewrites `next-env.d.ts`). If your dev server rewrites
  `next-env.d.ts` to point at your dist dir, restore the committed content before you finish.
- Logins: `admin@kitstak.io` / `KitStak-Demo-2026!` (org `kitstak`, seeded, an explicit Pulse owner after the seed) and
  `maya@northwind-robotics.example` / `Northwind-Demo-2026!` (org `northwind-robotics`, owner through the org role, **no
  Pulse rows yet**, so it shows every first run state).
- Seeds write through the domain layer (`tsx --conditions=react-server`), after wiping the org's rows under
  `pulse.allow_purge`. Helpers: `src/server/db/seed/context.ts` (`seedContext(orgSlug, email?)`, `orgMembers`,
  `ensurePulseOwner`, `wipeOrg`). Register a seed in `SEEDS` in `index.ts`.
- Unit tests: `src/**/*.test.ts` (Vitest, `server-only` stubbed). Database tests end in `.db.test.ts`, build a
  throwaway org with `createTestOrg()` from `src/test/db.ts` and remove it at the end, so they are safe next to a dev
  server. Pure math gets a pure test; anything with SQL math gets a `.db.test.ts` that compares against the pure library.
- `src/lib/copy-rules.test.ts` scans features, components, app and lib for em dashes, en dashes and double dashes. A
  failing copy test is a real failure.
- Every write screen gets one Playwright test that does the thing and reloads the page to prove it was saved.

## 12. Rules

1. **Client components import by path**, never through a feature `index.ts`.
2. **Shared files are extended additively.** Add exports, types, keys, hooks, routes and actions. Do not rename,
   remove or change a signature another team may already call. If a signature is wrong, add a new function and report it.
3. **Schema changes are new migration files only**: next number, journal entry, Drizzle mirror. Never edit an applied
   migration, never `drizzle-kit push`.
4. **All data goes through the domain layer.** No `pulse.*` SQL in components, pages or routes.
5. **All money math goes through `@/lib/money` and `@/lib/profit`.** No floats for money, no margins computed in JSX.
6. **Money hiding is done on the server.** A DTO builder takes the reader's access and returns `null` money. Never put
   a dollar amount inside a stored sentence.
7. **Closed months refuse writes** in the domain and in the database. Show the domain's message; do not hide the form.
8. **Copy**: plain words an 8th grader knows, short sentences, no em dashes, en dashes or double dashes. Use the on
   screen words from the table at the top of the spec ("Extra services", "Target pace", "Real cost of an hour", "Time
   not on a job").
9. **No placeholders, TODOs, lorem ipsum or dead buttons.** Every empty state teaches and has a next action that works.
10. **Standalone first.** Every screen works with only Pulse licensed. Sibling data is read fail soft through
    `src/server/integrations` (`integrationAvailability(ctx)` returns `{ crm, wms, projects }`; guard with
    `tableExists`, catch everything) and its UI is hidden when the app is absent. Every stream has CSV in and out.
11. **Do not commit, push, stash, reset or check out.** Other teams are in the same working tree. Touch only your
    folders plus additive edits to the shared files, and never revert a file you did not write.
12. **Verify before you report**: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/pulse` (and in any sibling app
    you touched), then look at your pages in light and dark at 1440 and 390 px with real seeded data.

## 13. Known gaps, by owner

- **jobs**: the jobs list, the at risk and losing money board, the new job form (`createJobAction`, `quickAddJobAction`),
  the job page and all six tabs (plan vs actual and quote vs actual from `planVsActual` and `quoteLinesVsActual`, the
  variance waterfall, price history, links), real 404 for an unknown job, `/jobs/by-link` opening an existing job first.
- **production**: the log grid on `PUT /api/v1/log/rows` (autosave measured at about 80 ms, 409 carries the fresh row),
  copy yesterday's crew, review the day, all entries with restore, labor classes and rates with the restamp preview,
  target pace with suggestions, time punches and `rollupPunches`, device links, kiosk endpoints and PIN flow.
- **profit**: home dashboard on `getSummary`, `listJobsNeedingAttention` and `getCompanyBridge`, the profit explorer
  with drill down to `listFacts`, client and extra service pages, `src/components/charts`, the 19 reports with
  `/api/v1/reports/<slug>.csv`, report schedules and runs, `GET /api/v1/explain` ("How we got this").
- **money-ops**: calculator form on `quoteCalculator` with saved scenarios (`quote_scenarios` has no domain yet) and
  "save as quote", materials, costs and revenue entry (domain and actions exist, no UI), alerts inbox and rule editor,
  month close checklist with close and reopen, goals on targets, the wall display and its public token link.
- **data**: the whole import flow (upload, map, preview, commit, undo, presets; tables exist, no domain),
  `/api/v1/export/<stream>.csv` and template downloads, settings forms (sites, roles, thresholds, shared cost rule, job
  types, items, extra services), saved views bar, audit log on `listActivity`, onboarding and sample data that can be
  removed (`is_sample`), dismissals.
- **integrations**:
  - **Portal does not typecheck today.** Widening `Module` to include `pulse` broke five `Record<Module, …>` maps:
    `apps/portal/src/app/(app)/billing/upgrade/page.tsx:21`, `src/app/(app)/page.tsx:26,41,53,220`,
    `src/features/launcher/app-mark.tsx:8`, `src/features/launcher/product-tile.tsx:43`. Fix these first.
    `apps/projects/src/server/entitlements.ts` is already fixed. WMS `tsc` needs a bigger heap and is unchecked.
  - `packages/pulse-bridge` does not exist; move `resolveAccess` there as `resolvePulseAccess`.
  - No sibling app passes `urls.pulse` to the app switcher, so Pulse shows in the switcher only inside Pulse. The
    switcher has no Pulse badge yet. The descriptor reads "Profit by job, client and service".
  - Sibling sync (`sync_state`, `sync_runs`), bridge events, WMS work orders and shipments into production, CRM deals
    into quotes and jobs, Projects links, the Portal tile and setup steps, `apps/web` product page, deploy docs
    (`NEXT_PUBLIC_PULSE_URL`, a fifth Vercel project, `CRON_SECRET` for the two crons in `apps/pulse/vercel.json`).
- **seed**: only org `kitstak` has Pulse rows (minimal seed: 3 labor classes, 3 clients, 5 jobs, 10 work days, 4 open
  alerts). `northwind-robotics` needs a rich seed tied to its CRM and Projects data.
- **foundation leftovers** (whoever touches it first): big restamps run inline, not in `after()` with
  `settings.recalc_started_at`; no test of the whole migration chain on an empty database; no plain role RLS test; no
  CSP header; `default_member_role` and the "Run Pulse for this workspace" claim are in the domain (`whoRunsPulse`,
  `claimPulseOwnership`) but have no screen.
