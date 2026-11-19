# KitStak Pulse: team contracts

Pulse is built: a runnable app (`apps/pulse`, port 3500), the `pulse` schema (47 tables, two migrations), the domain
layer, server actions, the `/api/v1` routes, React Query hooks, the pure money / profit / CSV libraries, the design
system, the shell, and a real page for every route in the spec. Sections 1 to 13 are the foundation contract the teams
built on; sections 14 to 18 are what each team added; **section 19 is the state after release integration** (what was
joined up across teams, how to verify, and what is still open). Where an older section says something "does not exist
yet", section 19 and the team sections win.

Read `docs/pulse/SPEC.md` for what to build and `apps/pulse/AGENTS.md` for the house rules. This file says who owns
what and what already exists, so nobody builds a thing twice. When you need something outside your folders, add it in a
backwards compatible way and say so in your report.

## 1. Folder ownership

> **Owner instruction (overrides any task brief): `apps/web` (the marketing site) is OFF LIMITS to every Pulse team,
> integrator, QA agent and critic. A separate session on its own branch owns it. Do not edit, add or delete anything
> under `apps/web`, and skip any step in your brief that says to (for example "apps/web marketing site lists Pulse").
> Do not report its absence as a defect.**


All paths are inside `apps/pulse` unless they start with `apps/` or `packages/`.

| Team | Owns | Routes |
| --- | --- | --- |
| **foundation** | `src/server/{auth,db,env,session,entitlements,errors,page}.ts`, `src/server/db/schema`, `src/server/http`, `src/server/domain/*` and `src/server/actions/*` that exist today, `src/app/api/v1/*` that exist today, `src/components/{ui,pulse,layout}`, `src/features/{shell,command,search,access}`, `src/lib/*`, `drizzle/*`, `scripts/*`, `e2e/smoke.spec.ts` | `/search`, `/login`, `/forgot-password`, `/no-workspace` |
| **jobs** | `src/features/jobs` (jobs list with the at risk and losing money board, new job, job detail frame and every tab: overview, plan vs actual with the quote vs actual view, work log, materials, money in, activity), `src/app/(app)/jobs/**` | `/jobs`, `/jobs/new`, `/jobs/[ref]`, `/jobs/[ref]/{plan,work,materials,money-in,activity}`, `/jobs/by-link` |
| **production** | `src/features/log` (daily entry grid, review the day, all entries, bulk grid), `src/features/kiosk`, `src/features/target-pace` (standards), `src/features/labor` (labor classes, labor rates, time not on a job, paid hours), `src/app/kiosk/**`, new domain files `src/server/domain/{punches,devices}.ts` | `/log`, `/log/review`, `/log/entries`, `/labor`, `/target-pace`, `/kiosk/t/[token]` |
| **profit** | `src/features/home`, `src/features/profit` (explorer by job, client, job type, extra service, site, month, week, day), `src/features/clients`, `src/features/services`, `src/features/reports`, `src/components/charts` (new: the one chart library every team uses), new domain files `src/server/domain/{explain,reports}.ts` | `/`, `/profit`, `/clients/[id]`, `/clients/by-link`, `/services`, `/services/[id]`, `/reports`, `/reports/[slug]` |
| **money-ops** | `src/features/calculator` (quote calculator and what if), `src/features/alerts`, `src/features/goals` (targets), `src/features/wall`, new `src/features/{materials,costs,revenue,periods}` (entry forms and tables that the job tabs and the client page mount by path), `src/app/wall/**`, new domain file `src/server/domain/quotes.ts` | `/calculator`, `/alerts`, `/alerts/rules`, `/goals`, `/settings/close` (page file imports from `src/features/periods`), `/wall`, `/wall/t/[token]` |
| **data** | `src/features/imports`, `src/features/export`, `src/features/settings` (all sections, roles, sites, catalogs, connected apps page shell, audit log), `src/features/welcome` (onboarding and sample data), new `src/features/views` (saved views bar any list can mount), new domain files `src/server/domain/{imports,exports,sample}.ts`, routes `src/app/api/v1/{import,export,templates}/**` | `/import`, `/import/new`, `/import/[batchId]`, `/export`, `/settings`, `/settings/audit`, `/welcome` |
| **integrations** | `apps/crm`, `apps/wms`, `apps/portal`, `apps/projects`, `packages/*` (new `packages/pulse-bridge`), `apps/pulse/src/server/integrations`, new `src/features/integrations` (record chips, link dialogs, the body of `/settings/apps`), `docs/DEPLOYMENT.md`, `deploy/*`, new domain file `src/server/domain/sync.ts` | `/settings/apps` body, deep links from sibling apps |
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
- **Real 404s** go in `src/app/(app)/layout.tsx` before any Suspense boundary. Unknown reports, jobs, clients,
  services and import batches all answer a real 404 this way.
- **Client components import client files by path** (`@/features/log/log-grid`), never a feature `index.ts`, because an
  index also exports server pages and would pull server code into the browser bundle.
- Add a route: create `src/app/(app)/<path>/page.tsx` and the feature files, add a builder to `src/lib/routes.ts`, and
  if it is top level add one entry to `src/lib/nav.ts` (the navigation, the mobile menu, the command palette, the `g`
  chords and the search page all read that one list).
- Use `routes.*` builders, never string literals. Tabs that are URLs use `<RouteTabs>` from `@/components/pulse`.
- Sibling links arrive at `/jobs/by-link?type=&id=` and `/clients/by-link?...`. Today they prefill `/jobs/new` or open
  the Clients tab. They must first look for an existing record (`findJobsByLink`, `findClientByRef`) and open it.

Routes and their feature folder:

| Route | Feature folder | Team | State |
| --- | --- | --- | --- |
| `/` | `features/home` | profit | real |
| `/jobs?tab=open\|all\|completed\|planned` | `features/jobs` (`jobs-page.tsx`) | jobs | real |
| `/jobs/new` | `features/jobs` (`new-job-page.tsx`) | jobs | real (three step wizard) |
| `/jobs/[ref]`, `/plan`, `/work`, `/materials`, `/money-in`, `/activity` | `features/jobs` (`job-page.tsx`) | jobs | real; unknown or deleted job answers 404 |
| `/jobs/by-link` | page file only | jobs | opens the linked job, else a prefilled new job |
| `/jobs/deleted` | `features/jobs` (`deleted-jobs-page.tsx`) | jobs | real; the Deleted tab of Jobs: who deleted each job and when, with Restore. Needs `job:manage` |
| `/log?date=`, `/log/bulk`, `/log/review`, `/log/entries` | `features/log` | production | real |
| `/labor?tab=rates\|time\|cost` | `features/labor` | production | real |
| `/target-pace` | `features/target-pace` | production | real |
| `/kiosk/t/[token]` (public, no shell) | `features/kiosk` | production | real (PIN, offline queue) |
| `/profit?by=` | `features/profit` | profit | real |
| `/clients/[id]`, `/clients/by-link` | `features/clients` | profit | real, 404 for unknown |
| `/services`, `/services/[id]` | `features/services` | profit | real, 404 for unknown |
| `/reports`, `/reports/[slug]` (19 slugs in `src/lib/reports.ts`) | `features/reports` | profit | real, 404 for unknown |
| `/calculator` | `features/calculator` | money-ops | real |
| `/goals` | `features/goals` | money-ops | real |
| `/alerts?tab=&q=`, `/alerts/rules` | `features/alerts` | money-ops | real |
| `/settings/close` | `features/periods` | money-ops | real |
| `/wall` (signed in, refreshes every 60 s), `/wall/t/[token]` (public) | `features/wall` | money-ops | real |
| `/import`, `/import/new?stream=`, `/import/[batchId]` | `features/imports` | data | real, 404 for unknown |
| `/export` | `features/export` | data | real |
| `/settings?section=`, `/settings/audit` | `features/settings` | data | real |
| `/settings/apps` | `features/settings` + `features/integrations` | integrations | real (sync, links) |
| `/welcome` | `features/welcome` | data | real |
| `/search?q=` | `features/search` | foundation | pages, reports and data files; `searchAll` is ready for records |
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
| System (domains added by the teams: `imports`, `quotes`, `reports`, `devices`, `sync`) | `import_batches`, `import_rows`, `import_presets`, `quote_scenarios`, `report_schedules`, `report_runs`, `device_links`, `sync_state`, `sync_runs`, `dismissals`, `bridge_events` |

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
  turns it into "October 2026 is closed. Ask the owner to reopen it." Bypassed only by `SET LOCAL pulse.allow_purge = 'on'`.
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
  `spreadCompanyCosts` (company costs are monthly, so a part month counts its share by day, SPEC 4.9), `companyBridge`,
  `sharedGap`, `payrollGap` and `utilizationBp`, `recomputeJobs` uses `paceDays`, `projectJob` and
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
  crmAccountItemId? })`, `createClient(ctx, input, { guardLookAlike? })` (with the guard on, a name that looks like a
  client you have is refused unless `input.confirmNew`; `assertClientNameNotLookAlike` is the one server guard),
  `ensureClientByName(tx, ctx, name)`, `updateClient(ctx, id, patch, version?, { guardLookAlike? })` (a rename never takes
  the exact name of another client, and with the guard on a new name close to another client is refused unless
  `patch.confirmNew`),
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
  `getJob(ctx, ref)`, `listDeletedJobs`, `findJobsByLink(ctx, type, id)`; create `createJob(ctx, JobInput, { guardLookAlike? })`
  (the action turns the guard on: a typed `clientName` that looks like a client you have needs `createClient: true`),
  `quickAddJob(ctx, { clientId?|clientName?, createClient?, name, plannedUnits?, unitPrice?, siteId? })` (a `clientName`
  that looks like a client you have, see `src/lib/client-names.ts`, is refused with `VALIDATION` unless `createClient`
  is true; the exact name or code uses that client); change `updateJob(ctx, jobId,
  patch, version?)`, `setJobStatus(ctx, jobId, status, { completedDate?, version? })`, `bulkUpdateJobs(ctx, ids, {
  status?, ownerId?, archived? })`, `duplicateJob`, `archiveJob`, `deleteJob`, `restoreJob`; prices `listJobPrices`,
  `setJobPrice(ctx, jobId, { effectiveFrom?, unitPrice?, billRateCents?, materialCostPerUnit?, note? })`,
  `deleteJobPrice`; links `addJobLink`, `removeJobLink`; DTOs `toJobDTO`, `toJobStatsDTO(stats, access, unitLabel)`.
- **`plans`**: `getJobPlans(ctx, jobId)`, `savePlan(ctx, jobId, 'quote'|'budget', PlanInput)`,
  `makeBudgetFromQuote(ctx, jobId)`, `deletePlan(ctx, jobId, kind)`.
- **`production`**: `saveProductionEntry(ctx, input, { requireVersion? })` (upsert by `id`, else by job, day, shift and
  class; returns `{ entry, created }`), `saveProductionBulk(ctx, inputs[], { requireVersion? })` (all or nothing, cap
  5,000; two lines for one job, day, shift and labor class are refused on the line), `saveProductionDay(ctx, { jobId,
  workDate, mode: 'create'|'edit', fromDate?, read?, lines[] })` (a whole day of a job in one transaction; throws
  `DayConflict` "day_exists" or "stale" with the day as it is now). Every typed write refuses a work date after today
  at the site (`assertNotFutureDay`) and hours with 0 people. The actions and `PUT log/rows` pass `requireVersion`:
  a row that exists needs the version the editor read. `deleteProductionEntries`,
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
  kinds?, limit?, offset? })` (the drill down, one page) and `listFactsPage` (the same page as `{ rows, truncated,
  limit, offset, nextOffset }`), `getCompanyBridge(ctx, { from, to, siteId? })`, `getSummary`, `getLaborSummary`,
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
Every action in this table is called by a real screen and covered by the browser suite (section 19.3).

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
| `GET jobs/attention`, `jobs/counts`, `jobs/deleted` | `limit` / `client,jobType,site` / | `JobListItemDTO[]`, `{ losing, at_risk, heads_up, on_track, no_data, none }`, `DeletedJobDTO[]` (a job list item plus `deletedById`, from the activity log) |
| `GET jobs/by-link` | `type (crm_deal\|crm_account\|wms_work_order\|wms_shipment_order\|wms_client\|pm_project\|pm_task\|core_customer),id` | `JobListItemDTO[]` |
| `GET jobs/[ref]`, `/plans`, `/prices`, `/days` | id or number; `by=day\|week\|month` | `JobDetailDTO`, `JobPlansDTO`, `JobPriceDTO[]`, `ProfitResponse` for the job's whole life |
| `GET log`, `log/previous-crew` | `date,site` | `LogGridDTO`, `PreviousCrewDTO[]` |
| `PUT log/rows` | JSON production row | `{ entry, created }`; a 409 carries `error.fresh` (the newer row) |
| `PUT log/days` | `{ jobId, workDate, mode: create\|edit, fromDate?, read?: [{ id, version }], lines[] }` | `{ entries, created, updated, removed }`; a 409 carries `error.reason` (`day_exists` or `stale`), `error.workDate` and `error.fresh` (the day as it is now) |
| `GET production` | `job,client,site,laborClass,from,to,source,needsHours,deleted,limit,offset` | `ProductionEntryDTO[]` |
| `GET indirect`, `paid-hours` | `site,from,to,deleted,limit` | `IndirectEntryDTO[]`, `PaidHoursDTO[]` |
| `GET materials`, `costs`, `revenue`, `service-entries` | `job,client,site,from,to,deleted,limit` plus `scope` / `kind` / `service,noPrice` | matching DTO arrays |
| `GET profit` | `by (job\|client\|type\|service\|site\|month\|week\|day),from,to,site,client,jobType,job,service,status,compare,trend` | `ProfitResponse` |
| `GET profit/trend`, `profit/facts` | profit filters, `bucket` / `kinds,limit,offset` | `TrendPointDTO[]`, `FactRowDTO[]` plus `meta { truncated, limit, offset, nextOffset }` (like `production`) |
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
- **Profit**: `useSummary`, `useProfit(by, params)`, `useProfitTrend`, `useProfitFacts` (reads every page through
  `collectPages` in `src/lib/paging.ts` and returns `{ rows, truncated }`), `useCompanyBridge`,
  `useLaborSummary`.
- **Control**: `usePeriods`, `useCloseChecklist`, `useAlerts`, `useAlertsUnread`, `useAlertRules`, `useNotifications`,
  `useSavedViews`, `useUserPrefs`, `useActivity`, `useSearch`.
- Others in `src/lib/hooks`: `useServerAction` and `unwrap` (`use-action.ts`), `useDebouncedValue`, `useHotkey`
  (`use-hotkeys.ts`), `usePeopleMap` (`use-people.ts`).

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
  ContextMenu, Dialog (plus ConfirmDialog, WizardSteps), Drawer, SidePanel, Tabs, ToggleGroup, SplitButton, Avatar, AvatarGroup,
  Badge, CountBadge, Chip, StatusPill, `toast`
  (`toast.undo(msg, { onUndo })`), EmptyState plus Illustration, Skeleton, ProgressBar, Kbd, ScrollArea, ColorPicker,
  DatePicker, **IsoDatePicker** (YYYY-MM-DD), **UserPicker**, Breadcrumbs, Card, Table (plus TablePagination), PageHeader, Spinner.
- `@/components/pulse`: `Teach` and `StepList` (the teaching empty state: what this is, why it matters, next step),
  `ButtonLink`, `RouteTabs` (tabs that are URLs), `BrandLoader`; `PersonAvatar` (by user id) from `@/components/pulse/person`.
- `@/components/layout/page`: `Page` (header plus body; `width="default|narrow|full"`), `Panel`.
- `@/components/charts` is the one chart library (hand built SVG, no dependency): see section 14.
- `@/components/pulse/explain`: `ExplainNumber` (server figures, section 15) and `ExplainStatic` (figures the screen
  already holds). `@/components/pulse/export-link`: `ExportStreamLink`. See section 19.
- Shell API: `useShell()` gives `user`, `org`, `orgRole`, `orgs`, `pulseRole`, `seesMoney`, `seesWages`, `can(action)`,
  `modules`, `integrations`, `appUrls`, `badges`. `useShellStore.getState().openPalette(query?)` and
  `.openShortcuts()`. The shell is being reworked by its owner right now: do not edit `src/features/shell`, add nav
  entries only through `src/lib/nav.ts`.
- Badges: `loadShell()` fills `shellContext.badges` from `getBadges(ctx)` on every server render. A view that changes a
  job's risk or an alert calls `router.refresh()` or invalidates `qk.badges()`.
- Shortcuts in use: Ctrl or Cmd+K and `/` open the palette, `l` log work, `n` new job, `?` shortcuts, Ctrl or Cmd+Z
  undo, and `g` then a letter for every navigation entry (the `chord` in `src/lib/nav.ts`): `h` home, `j` jobs, `l`
  log, `p` profit, `b` labor, `a` alerts, `r` reports, `t` target pace, `c` calculator, `o` goals, `i` import and
  export, `s` settings. `[` and `]` are reserved for the log page (previous and next day).
- Money hiding in UI: never branch on the role to hide a number. Render what the DTO gives; a `null` money field shows
  nothing or "Hidden", and `seesMoney` from `useShell()` only decides whether a money column or tab exists at all.
- Brand: `PulseMark` (`@/features/shell/logo`), loader `/brand/kitstak-loader-pulse.svg`. The official mark is the
  3 rect icon in `public/brand` (not the 6 rect sketch in SPEC section 10).

## 11. Dev, test and screenshots

```bash
cd apps/pulse
pnpm typecheck && pnpm lint && pnpm test          # 44 files, 569 tests; DB tests skip when Postgres is down
pnpm db:migrate                                    # applies drizzle/*.sql (table drizzle.__kitstak_pulse_migrations)
pnpm db:seed [--org=<slug>] [--email=] [--seed=rich|minimal] [--keep]   # no flags: the rich demo for kitstak and northwind-robotics (about 50 s)
NEXT_DIST_DIR=.next/<name> pnpm exec next dev -p 35xx        # personal servers 3501 to 3520, dist dir inside .next/
node scripts/shot.mjs --base http://localhost:35xx --out <dir> [--theme dark] [--width 390] [--full] / /jobs /profit
E2E_BASE_URL=http://localhost:35xx E2E_CHROMIUM=/opt/pw-browsers/chromium_headless_shell pnpm exec playwright test --workers=1
```

- `E2E_CHROMIUM` is needed on this machine: `@playwright/test` wants a newer browser build than the one installed.
  `shot.mjs` works without it. Never run `playwright install`.
- Do not run `pnpm build` while dev servers are up (it rewrites `next-env.d.ts`). If your dev server rewrites
  `next-env.d.ts` to point at your dist dir, restore the committed content before you finish.
- Logins: `admin@kitstak.io` / `KitStak-Demo-2026!` (org `kitstak`, seeded, an explicit Pulse owner after the seed) and
  `maya@northwind-robotics.example` / `Northwind-Demo-2026!` (org `northwind-robotics`, seeded with the rich demo, an
  explicit Pulse owner after the seed; to see first run states, use a throwaway org).
- Logins with no money, for checking money hiding (org `kitstak`, password `KitStak!demo2026`, the same as the WMS
  access seed): `j.okafor@kitstak.io` (Pulse supervisor, sees money off) and `cs.team@kitstak.io` (Pulse viewer, sees
  money off). The rich kitstak seed adds them when no other seed made them (`login` on the plan's `roles`, through
  `ensureDemoLogin` in `seed/context.ts`) and never resets an existing password. Other staff seeded by WMS with the
  same password: `ops.manager@kitstak.io` (manager) and `finance@kitstak.io` (viewer with sees money on).
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
13. **The database keeps workspaces apart too.** Every `pulse` table has row level security on and one policy,
    `pulse_org_isolation`, for read, add, change and remove: a row is allowed only when its `org_id` equals the
    session setting `pulse.org_id` (migration `0007_rls_policies.sql`). What that means in plain words:
    - The app signs in as the role that owns the tables, and an owner skips RLS. So the app does not run its queries
      as the owner: **the database guard** makes it run them as the plain role `pulse_app`, with the workspace set.
      With `PULSE_DB_GUARD=1` every statement and every transaction on `db` opens with
      `SET LOCAL ROLE pulse_app; SELECT set_config('pulse.org_id', '<org uuid>', true)` (`src/server/db.ts`), so the
      policies apply to the app itself. A query that forgets its `org_id` filter, or is handed an id from another
      workspace, gets nothing back and can change nothing. With the flag off the app runs as the owner, as before.
      Workspace scoping in the domain layer (`org_id` in every query) is still the first guard.
    - Where the workspace comes from (`src/server/db/scope.ts`): every exported function in `src/server/domain`,
      `src/server/integrations` and `src/features/*/server` that is handed a `DomainContext` or an org id is declared
      with `scoped(...)`, and its statements are tied to that workspace. `apiRoute` and `runAction` wrap the whole
      handler in `withOrg`. A call for one workspace that turns to another half way is refused.
    - The escape hatch is `asSystem('<reason>', fn)`: it runs as the owner, across workspaces, and is only for work
      that is cross org by design: sign in (which workspaces a person has), module entitlements, the cron fan out and
      the daily cleanup, the device link lookup by its secret, the health check, invitations for a person with no
      workspace, the demo seed, and sibling data. Sibling schemas (`crm`, `pm`, the WMS tenant schemas, `core.customers`,
      `core.wms_tenants`) have no Pulse policy, so sibling reads go through `siblingDb` (it wraps `asSystem`) and keep
      their own org filter. Better auth uses the owner handle `systemDb` (`src/server/db/system.ts`). Nothing else may
      skip the guard: `src/server/db-guard.test.ts` lists every allowed caller and fails on a new one.
    - A statement that reaches `db` with no scope at all is refused (`DbGuardError`) and logged, so a forgotten scope
      is a loud error, never a quiet query as the owner. The whole test suite runs with the guard on.
    - What the guard does not do: it is not a wall against SQL injection. The session still belongs to the login
      role, so injected SQL could `RESET ROLE`. Every query is parameterised, which is the guard for that. The
      stronger form is a separate login role for the app that owns nothing (see "still open" in the round four notes).
    - Any other role sees no rows and can write none, unless it sets `pulse.org_id`
      (`select set_config('pulse.org_id', '<org uuid>', true)` inside a transaction). Then it sees and writes that one
      workspace only. A value that is not a uuid is an error.
    - Grants: migration `0009_db_guard_role.sql` makes `pulse_app` (no login, not a superuser, cannot skip RLS, owns
      nothing), lets the migration role become it, and grants it read and write on the `pulse` tables, plus read on
      `core.organization`, `core.member` and `core."user"` behind a policy for `pulse_app` only (rows of the workspace
      in `pulse.org_id`). Nothing else is granted to anyone. On Supabase, `anon` and `authenticated` hold no grant on
      `pulse` and still see nothing.
    - **Turning the guard on in production** (it is OFF there until someone does this):
      1. Run the migrations with the direct database URL: `pnpm --filter kitstak-pulse db:migrate`. `0009` makes the
         role and the grants. A step the migration role may not do is skipped with a NOTICE, and the run still passes.
      2. Open `GET /api/health`. It answers `"guard": { "on": false, "ready": true }` when the role is there and the
         app's login can use it. If `ready` is false, run this once as a database admin, with the app's login role in
         place of `postgres` when the app signs in as another role, then check again:
         `CREATE ROLE pulse_app NOLOGIN NOINHERIT NOBYPASSRLS;` (skip if it exists), `GRANT pulse_app TO postgres;`,
         then apply `drizzle/0009_db_guard_role.sql` again by hand (every step in it is safe to repeat).
      3. Set the environment variable `PULSE_DB_GUARD=1` on the Pulse project and redeploy.
      4. Check it is on: `GET /api/health` answers `"guard": { "on": true, "ready": true }`. Sign in, open Home, Jobs
         and a job, and log one work row. In the database, `select usename, application_name, query from
         pg_stat_activity where application_name = 'kitstak-pulse'` shows statements that start with
         `BEGIN; SET LOCAL ROLE "pulse_app"`.
      5. To turn it off: remove `PULSE_DB_GUARD` (or set it to `0`) and redeploy. The role and the grants can stay:
         they do nothing while the flag is off. To remove them as well: `DROP OWNED BY pulse_app; DROP ROLE pulse_app;`.
    - Cost: each statement outside a transaction takes two more round trips to the database (the opening line and
      the commit). A transaction takes one more. The numbers measured in dev are in the round four notes.
    - `pulse.v_facts` is `security_invoker`, so the view cannot be used to step around the policies.
    - A new table needs `ENABLE ROW LEVEL SECURITY` and its policy in the migration that makes it (copy the
      `CREATE POLICY` line from 0007). `src/server/domain/rls.db.test.ts` fails when a `pulse` table has RLS off, or
      on with no policy, or forced. The same test makes a plain role and proves the three points above.
14. **Every page sends a Content-Security-Policy.** `src/proxy.ts` makes a fresh nonce for each request and sets the
    header from `buildContentSecurityPolicy` (`src/server/http/csp.ts`, the same shape as CRM): `default-src 'self'`,
    scripts by nonce with `strict-dynamic`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`,
    `object-src 'none'`, images from this origin plus `data:`, `blob:` and https (avatars), fonts and fetches from this
    origin only. `unsafe-eval` and websockets are added for `next dev` only. Rules that follow from it:
    - An inline `<script>` must carry the nonce: read it in a server component with `(await headers()).get(NONCE_HEADER)`.
      The root layout does this for the theme script, and that read also keeps every route rendered per request,
      which a nonce needs. Do not add a page that is built ahead of time.
    - Do not load a script, font, style or frame from another origin, and do not fetch another origin from the browser.
      Links to Portal, CRM, WMS and Projects are plain page moves and need no entry.
    - API routes get no header from the proxy (it would replace a route's own). The report print page sets its own
      tighter policy in `htmlResponse` (`PRINT_PAGE_CONTENT_SECURITY_POLICY`).
    - `src/server/http/csp.test.ts` asserts the header on every main route.
15. **The line of an alert rule is money.** `AlertRuleDTO` builders take `canSeeMoney` (`toRuleDTO` in
    `domain/alerts.ts`): a reader without money gets `threshold: null`, `moneyHidden: true` and a name with no numbers,
    and the screen prints "more than a set amount" or "under a set line" (`ruleSentence(kind, threshold, { moneyHidden })`).
    A rule's stored name never holds its line (`storedRuleName`). A reader without money cannot set, change or try out
    a line (create, update and preview answer FORBIDDEN).

## 13. Known gaps, by owner (as written before the teams built; kept for history)

> Everything listed here was the to do list handed to the teams. It is done unless section 19 lists it as still open.

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
- **seed**: the rich demo is in `src/server/db/seed/rich` (`engine.ts` plus one plan file per org; a plan is plain
  data). Both demo orgs are seeded: `kitstak` (44 jobs, 8 on WMS work orders) and `northwind-robotics` (28 jobs on CRM
  deals and Projects, no WMS). Story jobs are listed at the end of the seed output with the status each must show.
  Not seeded, because no domain exists yet: time punches, device links, kiosk PINs, quote scenarios, report schedules,
  the WMS, CRM and Projects sync runs, `core.entitlements` rows and the `pulse-only` org.
- **foundation leftovers** (whoever touches it first): big restamps run inline, not in `after()` with
  `settings.recalc_started_at`; no test of the whole migration chain on an empty database; no plain role RLS test; no
  CSP header; `default_member_role` and the "Run Pulse for this workspace" claim are in the domain (`whoRunsPulse`,
  `claimPulseOwnership`) but have no screen.

## 14. Charts (`@/components/charts`, owner: profit)

The one chart library for Pulse. Hand built SVG and React, no chart dependency. Every export is a client component or a
pure helper; client files import by path (`@/components/charts/cartesian`), server pages may use the index. Ask profit
for a missing chart instead of drawing one in a feature folder.

**Rules every chart follows**
- Values are plain numbers used only for geometry. Money is whole cents, percents are basis points. Text always comes
  from a `format`: `'money' | 'percent' | 'number' | 'hours'` or `{ axis(v), value(v) }` built on `@/lib/format`.
  `chartNumber(dtoValue)` turns a DTO field into `number | null`. `null` is a gap ("No data"), never zero.
- Colors: series take `seriesColor(0..7)` in order (`--pulse-series-1..8` in `charts.css`, checked for color blind
  separation on both panels; a ninth series folds into "Other"). Pass `color` only to keep one entity the same color
  across charts. Up, down and neutral are `CHART_COLORS`. Text never wears a series color.
- Common props (`ChartBaseProps`): `title` (required, read by screen readers), `description`, `showTitle`, `height`,
  `loading` (skeleton), `refreshing` (dims, keeps its place), `error` + `onRetry`, `emptyTitle`, `emptyHint`,
  `emptyAction`, `hideLegend`, `tableToggle` ("Show table" button), `width` (fixed width for tests and print).
- Accessibility is built in: SVG `<title>` and `<desc>`, one tab stop per chart, arrow keys / Home / End / Escape move
  between points, the focused point is read through a live region, hover and focus show the same tooltip, and every
  chart renders a screen reader data table. Transitions stop under reduced motion.
- Charts fill their parent's width. Give the parent `min-w-0` inside grids and flex rows.

| Component (file) | Use it for | Main props |
|---|---|---|
| `LineChart`, `AreaChart` (`cartesian`) | trends, one or many series | `series: { id, label, values, color? }[]`, x axis as `labels` or `dates` + `bucket: 'day' \| 'week' \| 'month'` (evenly spaced bucket starts), `format`, `target: { value, label }`, `zeroBased` |
| `BarChart` (`cartesian`) | compare categories or periods | same series and x props, `mode: 'grouped' \| 'stacked'`, `orientation: 'vertical' \| 'horizontal'` (horizontal for rankings and long names), `showValues`, `signColors` (losses in the down color), `target` |
| `ComboChart` (`cartesian`) | bars and a line in another unit (revenue bars, margin line) | `bars`, `lines`, `barFormat`, `lineFormat`, `lineTarget`, `layout: 'split'` (default: two panels on one x axis) or `'overlay'` (right axis) |
| `WaterfallChart` (`cartesian`) | bridge from plan to actual | `start: { label, value }`, `steps: { id, label, value }[]`, `endLabel`, `format`, `upIsGood`. From `varianceWaterfall`: `start.value = startCents`, steps from `bars` (`amountCents`) |
| `ParetoChart` (`cartesian`) | biggest causes first with running share | `items: { id, label, value }[]`, `maxItems` (default 8, rest fold into "Other"), `valueLabel`, `format` |
| `DonutChart` (`radial`) | share of a whole, at a glance | `slices: { id, label, value, color? }[]`, `format`, `centerLabel`, `maxSlices` (default 6). Values at or under zero are left out and counted in a note |
| `HeatmapCalendar` (`heatmap`) | one cell per day | `days: { date, value }[]`, `format`, `valueLabel`, `weekStart`, `scale: 'auto' \| 'sequential' \| 'diverging'`, `lowLabel`, `highLabel`. Weeks become rows on narrow cards |
| `Gauge` (`radial`) | a number against its target (margin vs target) | `title`, `value`, `target`, `floor`, `min`, `max`, `format` (default percent), `footer` (put a `MarginPill` here), `loading` |
| `BulletChart` (`bullet`) | progress against a target in a row or table cell | `label`, `value`, `target`, `max`, `format`, `goodWhen: 'up' \| 'down'`, `targetLabel`, `size: 'sm' \| 'md'`, `loading` |
| `ProgressRing` (`radial`) | how far along | `value`, `max`, `label`, `size`, `tone`, `children` (center text), `hideValue` |
| `Sparkline` (`sparkline`) | tiny trend in a tile or table cell | `values`, `label`, `format`, `width`, `height`, `fluid`, `tone`, `area` |
| `KpiTile` (`stats`) | one headline number | `label`, `value` (formatted text or `null`), `delta` (DeltaBadge props), `deltaPending` (keeps room for the change while it loads), `sparkline`, `explain` (the "how we got this" trigger), `footer`, `emptyText`, `loading`, `error` |
| `DeltaBadge` (`stats`) | a change with arrow and tone | `delta` (raw number, sign only), `text` (from `formatMoneyDelta` and friends), `goodWhen`, `label`, `size` |
| `MarginPill` (`stats`) | margin or job health as icon plus words | `health: 'healthy' \| 'watch' \| 'at_risk' \| 'losing' \| 'none'` or `status: PulseStatus` (uses `PULSE_STATUS_LABELS`), `marginBp`, `label`, `size` |

Helpers: `marginHealth(marginBp, targetBp, thresholds?)` (health of a margin with no job status, same lines as rules R1
and R2 from `DEFAULT_RISK_THRESHOLDS`), `healthFromStatus`, `bulletReading`, `sparklineSummary`, `niceScale`,
`formatDateTick`, `formatDateLong`, `ChartLegend`, `ChartSkeleton`, `ChartMessage`.

Dev tools: `/dev/charts` is a gallery of every chart with sample data (404 in production, not in the nav).
`node scripts/charts-shots.mjs --out <dir>` shoots each gallery section in light and dark at 1440 and 390;
`node scripts/charts-check.mjs --out <dir>` drives hover, keyboard, table toggle, retry and layout checks in a browser.
Unit tests: `src/components/charts/{scale.test.ts,charts.test.tsx}`.

Known limits: time axes assume evenly spaced buckets; no brush or zoom; no stacked area; no scatter; ComboChart
`overlay` is a dual axis chart, so prefer `split`; the Waterfall always starts its value axis at zero.

## 15. Profit, reports and "How we got this" (owner: profit)

What the profit team added on top of sections 5 to 9. Everything here is additive.

**Domain (`@/server/domain`)**
- **`explain`**: `explain(ctx, metric, scope)` returns `ExplainDTO` (title, scope in words, the rule in plain words,
  lines with numbers and units, data quality lines, links to the rows). `metric` is one of `EXPLAIN_METRICS` in
  `@/lib/constants`; `scope` is `ProfitFilters`. Figures come from `getProfit` and `getCompanyBridge`, so an explanation
  cannot disagree with the screen. Money is `null` without `money:read`; the wage split shows only with `wage:read`.
- **`reports`**: `buildReport(ctx, slug, filters, { hideMoney? })` builds any of the 19 reports as one `ReportDTO`
  (columns, rows, total, summary, chart, aside, notes). `aside` is money in the total that is no row of the ranking: on `job-profit`,
  "Put on a client, not on a job", which is left out of the chart and sits in its own last row. `getProfitPivot(ctx, rowBy, colBy, filters)` (two way pivot, totals
  equal `getProfit`; an extra service cell with revenue and no cost has `marginBp: null` and `costMissing: true`, the same "No cost yet" rule as `getProfit` rows), `listProfitEntries(ctx, filters & { kinds?, limit? })` (drill down rows with job, client and
  service names; `noJob: true`, `job=none` on the API, gives only rows put on a client with no job). Schedules: `listReportSchedules`, `saveReportSchedule`, `setReportScheduleEnabled`,
  `deleteReportSchedule`, `restoreReportSchedule`, `runReportSchedule` (build now), `listReportRuns`,
  `getReportRunFile(ctx, runId, 'csv' | 'html')`, `runDueReportSchedules(ctx)` (the hourly cron).
- **`catalog`** gained `restoreVasService(ctx, id)` (undo of a delete).

**API**
| Route | Params | Returns |
| --- | --- | --- |
| `GET explain` | `metric` plus the profit filters | `ExplainDTO` |
| `GET profit/pivot` | `rows,cols` plus the profit filters | `ProfitPivotDTO` |
| `GET profit/entries` | profit filters, `kinds,limit` | `ProfitEntriesDTO` |
| `GET reports/<slug>`, `reports/<slug>.csv`, `reports/<slug>.html` | `from,to,site,client,jobType,status` (`print=1` on `.html`) | `ReportDTO`, a CSV file, a self contained page to print |
| `GET reports/schedules`, `reports/runs`, `reports/runs/<id>?format=csv\|html` | | `ReportScheduleDTO[]`, `ReportRunDTO[]`, the build's file |
| `GET cron/reports` | `Authorization: Bearer $CRON_SECRET` | builds due schedules (hourly in `vercel.json`) |

File routes use `fileRoute` from `src/features/reports/server/file-route.ts` (same checks as `apiRoute`, may answer
with a `Response`).

**Actions**: `reports.ts` (`saveReportScheduleAction`, `deleteReportScheduleAction`, `restoreReportScheduleAction`,
`setReportScheduleEnabledAction`, `runReportScheduleAction`), `catalog.ts` gained `restoreVasServiceAction`.

**Hooks**: `useExplain`, `useProfitPivot`, `useProfitEntries`, `useReport`, `useReportSchedules`, `useReportRuns`, and
`reportQuery(params)` for building the CSV and print links. Keys: `qk.explain`, `qk.profitPivot`, `qk.profitEntries`,
`qk.report`, `qk.reportSchedules`, `qk.reportRuns`.

**Pure helpers (`@/lib/reports`)**: `RANGE_PRESETS`, `resolveRange`, `COMPARE_MODES`, `compareRange`, `rangeLabel`,
`SCHEDULE_RANGES`, `resolveScheduleRange`, `nextScheduleRun`, `scheduleSentence`.

**UI any team can mount by path**
- `@/components/pulse/explain`: `<ExplainNumber metric="profit" scope={{ from, to, jobId }} />`, the "How we got this"
  popover for any number. It loads on open.
- `@/features/profit/period-picker` + `@/features/profit/period` (`parsePeriod`, `periodQuery`): the period picker and
  its URL form (`?range=`, `?from=&to=`, `?compare=prior|last_year`). `@/features/profit/filter-bar` (`FilterBar`,
  `parseFilters`), `@/features/profit/use-query-state` (`useQueryState`), `@/features/profit/csv-download`
  (`downloadCsv`), `@/features/profit/entries-drawer` (`EntriesDrawer`), `@/features/profit/profit-ui` (`LoadError`,
  `Section`, `TableSkeleton`, `moneyDelta`, `pointsDelta`, `numberDelta`, `runDelete`).
- `@/features/reports/report-table` and `report-chart`: render any `ReportDTO`. `report-format` has `reportToCsv`,
  `reportToHtml` and `reportCellText` (pure).
- Deep links into the explorer: `/profit?by=&range=&from=&to=&compare=&site=&client=&jobType=&job=&service=&status=&view=&sort=&cols=&entries=`.
  `entries=all|revenue|labor|material|other|shared` opens the rows behind the number.

Real 404s for `/clients/<id>` and `/services/<id>` come from `profitRecordMissing` in the `(app)` layout.
Supervisors still land on Log work; `/?floor=1` shows them the no money version of Home.

## 16. Money ops: calculator, entry ledgers, alerts, goals, month close, wall (owner: money-ops)

Everything here is additive on top of sections 5 to 9.

**Domain (`@/server/domain`)**
- **`quotes`**: `listQuoteScenarios`, `getQuoteScenario`, `saveQuoteScenario` (the answer is worked out again on the
  server with `runCalc`), `setQuoteScenarioStatus`, `deleteQuoteScenario`, `restoreQuoteScenario`, `getCalculatorSetup`,
  `listSimilarJobs`, `quoteFromJob(ctx, ref)` (a job's actuals as a filled calculator form), `createJobFromScenario`.
- **`alert-ops`**: `saveAlertRuleFull` (rule plus quiet hours in `scope.quiet`), `countAlertsByStatus`,
  `bulkUpdateAlerts`, `previewAlertRule` (what a rule would have said in the last 30 days).
- **`goals`**: `getGoalsBoard(ctx, { month? })`. **`period-ops`**: `getCloseBoard` (each month with job profit, `companyProfitCents` and
  `companyMarginBp`), `getCloseDetail(ctx, month)` (adds `bridge: CloseBridgeDTO`, the steps from job profit to company profit, and
  `saved` when the figures are the ones stored with the close), `listCloseEvents`. `closePeriod` stores `snapshot.company` beside
  `snapshot.bridge`. **`wall`**: `getWallBoard(ctx, options)`, `getWallForDevice(token)` (never money).
- **`ledger`**: `saveCostsBulk`, `saveMaterialUsageBulk`, `saveRevenueBulk`, `saveVasEntriesBulk` (all or nothing),
  `previewWmsUsage(ctx, jobRef)`, `pullWmsUsage(ctx, jobRef)` (adds only what is new, safe to run again).

**API**: `GET quotes`, `quotes/[id]`, `quotes/setup`, `quotes/similar`, `quotes/from-job?job=`, `alerts/counts`,
`alert-rules/preview?kind=&threshold=&client=&jobType=&site=&rule=`, `goals/board?month=YYYY-MM`, `periods/board`,
`periods/[month]/detail`, `periods/events`, `materials/wms-preview?job=`.

**Actions (`@/server/actions/money-ops`)**: `saveQuoteScenarioAction`, `setQuoteScenarioStatusAction`,
`deleteQuoteScenarioAction`, `restoreQuoteScenarioAction`, `createJobFromScenarioAction`, `saveAlertRuleFullAction`,
`bulkUpdateAlertsAction`, `saveCostsBulkAction`, `saveMaterialUsageBulkAction`, `saveRevenueBulkAction`,
`saveVasEntriesBulkAction`, `pullWmsUsageAction`.

**UI any team can mount by path (client components, need the app shell)**
- `@/features/costs/cost-ledger`: `<CostLedger scope="job|client|company|all" jobId? clientId? from? to? today />`.
- `@/features/materials/material-ledger`: `<MaterialLedger jobId? jobRef? clientId? from? to? today />` (with `jobId`
  and `jobRef` it offers "Pull from the warehouse" when the job has a WMS work order).
- `@/features/revenue/revenue-ledger`: `<RevenueLedger jobId? clientId? from? to? today />` (invoices, fees,
  adjustments, credits). `@/features/revenue/service-ledger`: `<ServiceLedger jobId? clientId? serviceId? from? to? today />`.
- All four are built on `@/features/costs/ledger-kit` (`Ledger`: cells edit in place, row checkboxes, lock marks for a
  closed month, cards on a phone; `BulkAddDialog`: add many rows, paste from a spreadsheet; `useLedgerRows`,
  `useLedgerActions`: optimistic rows with Undo). A new ledger names its columns and how a cell becomes a save.
- `@/features/calculator/how`: `<How title formula lines warnings? />`, the "How we got this" popover for a number that
  is worked out on the screen (use `ExplainNumber` when the number comes from the profit rollups).
- Month close (`/settings/close?month=YYYY-MM`) mounts all four ledgers for the picked month under "Entries dated in".
- Deep links: `/calculator?job=<number>` (what if from a job's actuals), `/calculator?scenario=<id>`,
  `/goals?month=YYYY-MM`, `/wall?site=&panels=jobs,pace,totals,due,nice&rotate=15&money=1`.

Pure helpers with tests: `features/calculator/calc-model`, `features/alerts/{quiet-hours,rule-kinds,alert-model}`,
`features/goals/goal-math`, `features/wall/wall-math`, `features/periods/close-model`.

## 17. Import, export, settings, onboarding and saved views (owner: data)

What the data team added on top of sections 5 to 10. Everything here is additive.

**Domain (`@/server/domain`)**
- **`exports`**: `loadStreamRows(executor, orgId, stream, scope)` reads the live rows of any of the 17 streams as CSV shaped
  records (codes instead of ids, one statement per stream). `exportStream(ctx, stream, filters)` and
  `exportEverything(ctx, filters)` build the files (money columns dropped without `money:read`, wage columns without
  `wage:read`, labor rates refused without money, cut at 200,000 rows) and write an `export.run` activity row.
  `countStreamRows(ctx)`. Filters: `from,to,clientId,jobTypeId,siteId,status,layout,hideMoney`.
- **`imports`**: one engine for every stream. `createImportBatch`, `appendImportRows(ctx, id, rows, { done })`,
  `checkImportBatch(ctx, id, { mapping, options, savePresetAs })` (the dry run), `editImportRows` (fix cells or leave rows
  out, then check again), `commitImportBatch` (plans again inside one transaction, writes, restamps, rebuilds rollups,
  snapshots every changed row), `undoImportBatch` (7 days; rows changed after the import are left alone and counted),
  `discardImportBatch`, `getImportBatch`, `listImportRows`, `listImportBatches`, `listImportStreams`,
  `importErrorReport`, `getImportProgress`, and presets (`listImportPresets`, `saveImportPreset`, `renameImportPreset`,
  `deleteImportPreset`). Existing rows are read through `loadStreamRows` and compared in CSV terms, so an export imported
  back reads "No change" for every row. Rules: a blank cell leaves what is there; rows match by `entry_id` (the row id, or
  the id the row had in the file it came from, kept in `source_ref` with `source = 'csv'`), then by the stream's key
  columns, then the look alike check; clients, job types, labor classes and items can be created on the fly (managers
  only); closed months and supervisor day locks are row errors; labor rates need `rate:manage`.
  Limits: 10 MB, 50,000 rows, 200 columns, 2,000 characters a cell, 5 unfinished batches per org, 60 uploads per person
  per hour (`PULSE_IMPORT_UPLOADS_PER_HOUR` overrides it for tests).
- **`sample`**: `loadSampleData`, `clearSampleData` (every sample row carries `is_sample`; real work is never touched),
  `getSampleState`, `purgeAllData(ctx, confirmSlug)` (owner only; keeps settings, sites, people, alert rules and the audit
  log) and `getOnboardingState` (the five getting started steps judged from real data, plus the first profit number).
- **`activity`** gained an optional `q` filter (free text; money readers also search before and after values).
  **`notifications.notify`** now skips people who turned that kind off (`user_prefs.prefs.notify[kind] === false`).

**API**
| Route | What |
| --- | --- |
| `GET import` | `{ batches, streams }` for the import center |
| `POST import` | open a batch: `{ stream, fileName, fileSize, fileHash, delimiter, headers }` returns `{ batch, presets, appliedPresetId }` |
| `GET, DELETE import/<batch>` | one batch, or discard an unsaved one |
| `GET, POST, PATCH import/<batch>/rows` | preview rows (`action,offset,limit`), append a chunk (`{ rows, done }`), fix or skip rows (`{ edits }`) |
| `POST import/<batch>/check`, `/commit`, `/undo`; `GET /progress`, `/errors.csv` | dry run, save, undo, progress, error report |
| `GET, POST import/presets`, `PATCH, DELETE import/presets/<id>` | saved column mappings |
| `GET import/sample`, `import/onboarding` | `SampleStateDTO`, `OnboardingStateDTO` |
| `GET templates/<stream>.csv`, `<stream>-how-to.csv`, `job_plans-lines.csv`, `all.zip` | templates with two example rows |
| `GET export`, `export/<stream>.csv`, `export/everything.zip`, `export/audit.csv` | row counts, one stream, a zip of all streams, the audit log |

**Actions**: `data.ts` (`loadSampleDataAction`, `clearSampleDataAction`, `purgeAllDataAction({ confirm })`).

**Schema**: `drizzle/0005_saved_view_pages.sql` widens `saved_views.page` with `audit` and `export`
(`SAVED_VIEW_PAGES` in `@/lib/constants`).

**UI any team can mount by path**
- `@/features/views/saved-views-bar`: `<SavedViewsBar page="jobs" ignore={['entries']} />`. A view is the query string of
  the page, so it works on any list whose filters, sort and columns live in the URL: save, rename, update, share (managers),
  open by default, delete with Undo. Helpers in `@/features/views/view-query`.
- `@/features/settings/settings-tabs` (`SettingsTabs`), `@/features/settings/sections/more` (`SampleDataCard`),
  `@/features/settings/audit-format` (plain words for audit rows: `verbLabel`, `thingLabel`, `auditChanges`, `auditSummary`),
  `@/features/imports/when` (`When`, a time in the reader's zone), `@/features/export/zip` (`zip(entries)`, no dependency).
- Deep links: `/import/new?stream=<id>`, `/import/<batch>`, `/export?from=&to=&client=&jobType=&site=&status=&money=0`,
  `/settings?section=general|sites|job-types|labor|cost-rules|people|catalogs|notifications|devices|sample-data|danger|math`,
  `/settings/audit?q=&actor=&type=&action=&from=&to=`.

Dev note: on the shared Turbopack dev server a new export added to an already loaded domain file is sometimes not seen
through the `@/server/domain` barrel until the file gets a real code edit. Importing by file path
(`@/server/domain/sample`) always works.

## 18. Integrations: sibling readers, sync, the bridge and Connected apps (owner: integrations)

Everything here is additive. Pulse still works with nothing else installed.

**`@kitstak/pulse-bridge`** (`packages/pulse-bridge`, see its README): how Portal, CRM, WMS and Projects read Pulse on
their own servers. `getOrgSummary`, `getJobsForRecord`, `getJobSummaries`, `getClientProfit`,
`listJobsNeedingAttention`, `getAttentionCount`, `getSetupSignals`, `resolvePulseAccess`, `emitBridgeEvent`,
`pulseUrls(base)`, `formatCents`, `formatMarginBp`, `PULSE_STATUS_LABELS`. It has its own copy of the access rule
(`resolveAccess`), and `src/server/integrations/bridge-parity.test.ts` walks every input through both resolvers, so
`src/server/domain/access.ts` was **not** moved. Change the rule in both places or that test fails.

**Readers (`@/server/integrations`, server only, fail soft: an empty list, never a throw)**
- `crm`: `crmReady`, `listWonDeals(ctx, { limit?, sinceDays? })`, `getDeals(ctx, ids)`, `searchDeals(ctx, q)`,
  `getAccounts(ctx, ids)`. Won is the board's own `isDone` stage label. `CrmDeal.valueCents` is whole cents.
- `wms`: `wmsReady` (the org's own tenant schema or null), `listWorkOrders(ctx, { ids?, query?, openOnly? })` (finished
  quantity plus planned and consumed component cost in cents), `workOrderBuildsByDay(ctx, ids, timezone)`,
  `listBilledRevenue(ctx)` (summary lines only, so a bill is never counted twice), `listVasRecords(ctx)` (each extra
  service record with its own price or the client's contract rate; null when there is no warehouse to read) and
  `listContractPrices(ctx, workOrderIds)` (what the contract's work order fees make each work order earn).
- `projects`: `projectsReady`, `getProjects`, `searchProjects` (only projects the reader may see in Projects),
  `projectTimeByDay(ctx, projectIds, timezone)`.
- `records`: `resolveRecords(ctx, targets)` (a linked record as it is right now: `live`, `gone` or `offline`) and
  `searchRecords(ctx, 'crm_deal' | 'wms_work_order' | 'pm_project', q)`.
- The jobs team's `features/jobs/server/job-sources.ts` can now call `listWonDeals` and `listWorkOrders` instead of its
  own two queries.

**Domain (`@/server/domain`, file `sync.ts`)**
- `runSync(ctx, 'crm' | 'wms' | 'projects' | 'all')` ("Sync now", needs `job:manage`), `syncIfStale(ctx, 'page' | 'cron')`
  (answers `bridge_events`, then pulls any connected app whose last sync is older than 10 minutes; call it from
  `after()`), `getConnectedApps(ctx)`, `listLinkedJobs(ctx)`, `setLinkImportsTime(ctx, linkId, on)`.
- What a sync writes: fresh `cached_title`, `cached_status`, `cached_url` and `meta` on `job_links` (a CRM deal link
  carries `meta.dealValueCents`, `meta.won`, `meta.closeDate`; a work order link `meta.requestedQty`, `meta.finishedQty`;
  a project link `meta.key`, `meta.percentDone`, `meta.dueDate`); `jobs.wms_shortage`; a job the warehouse finished is
  set to completed; kits built per day as production rows (`source_ref = wms:built:<workOrderId>:<date>`); parts used
  through money-ops' `pullWmsUsage`; warehouse bills as `invoice` revenue rows per client, bill and kind of work
  (`source = 'wms'`, `source_ref = wms:bill:<reportId>:<operation>`, billed memo, never profit); warehouse extra
  service records as extra service entries (`wms-services.ts`, `pullWmsServices`: `source = 'wms'`,
  `source_ref = wms:vas:<recordId>`, on the job linked to the record's work order, else on the client, with
  `meta.wms.path` back to the warehouse); job prices from the warehouse contract's work order fees
  (`applyWmsContractPrices`, remembered on the link as `meta.contractPrice`); project time as
  production rows with shift `projects` (`source = 'projects'`, `source_ref = pm:<projectId>:<date>`, units 0).
- Never double counts: a ref is looked up before anything is added; a day a person already typed is adopted (it gets
  the `source_ref` and `meta.adopted_from`, its `source` stays `manual`); `meta.locked_fields` are left alone; a
  project's time feeds one job only (the oldest link with `imports_time`); closed months are counted as
  `skipped_closed`. One run per org and app at a time (`sync_state.locked_until`, five minutes).
- `tickOrg` in `cron.ts` now calls `syncIfStale(ctx, 'cron')` first (the one edit outside our folders in the domain).

**API**: `GET integrations/status` (`ConnectedAppsDTO`, also starts a background refresh), `integrations/links`
(`LinkedJobDTO[]`), `integrations/records?targets=type:id,type:id` (`LiveRecordDTO[]`),
`integrations/search?type=&q=` (`RecordOptionDTO[]`, needs `job:manage`). Same origin only, like every Pulse route: the
brief asked for CORS for sibling origins, the spec (8.7) and `AGENTS.md` say none, and no sibling needs it because
they all read through the bridge. **Actions** (`@/server/actions/integrations`): `syncNowAction({ source })`,
`setLinkImportsTimeAction({ linkId, importsTime })`.

**UI any team can mount by path (client components)**
- `@/features/integrations/record-chip`: `<RecordChip type id title status url live? loading? size? />` plus
  `findLive(records, link)`; `@/features/integrations/api`: `useLiveRecords(refs)` (one batched read for all chips on
  a page), `useRecordSearch`, `useConnectedApps`, `useLinkedJobs`, `integrationKeys`.
- `@/features/integrations/link-record-dialog`: `<LinkRecordDialog open onOpenChange job? connected initialType?
  linkedKeys? onLinked? />` (search, keyboard list, link with Undo; leave `job` out to pick the job in the dialog).
  The job page's "Linked records" panel can swap its plain rows for `RecordChip` and add this dialog.
- `@/features/integrations/connected-apps-body`: the body of `/settings/apps` (server component).
- Types and words: `@/features/integrations/types` (`LiveRecordDTO`, `AppConnectionDTO`, `TARGET_WORDS`,
  `SIBLING_APP_NAMES`, `appOfTarget`).

**Sibling apps**
- Portal: tile (Open jobs, At risk, Margin this month, or Losing money for a person who may not see money), "Jobs that
  need you" panel, quick links, palette entries, billing and upgrade copy, four setup steps
  (`docs/integration/ONBOARDING.md`).
- CRM: item panel **Profit** tab on deals and accounts (`?item=<id>&itemTab=pulse`), a health line under a deal's name,
  route `GET /api/v1/crm/items/[itemId]/pulse`, stage change events.
- WMS: **Job profit** card on a work order (`GET /api/work-orders/[id]/pulse`), **Client profit** strip on a client
  (`GET /api/clients/[id]/pulse`), work order change events.
- Projects: **Job profit** strip on the project overview (`GET /api/v1/projects/[key]/pulse-profit`), time logged
  events. The `pulse_job` link target type was **not** added to Projects: Pulse keeps the link on its own side
  (`pulse.job_links` with `pm_project`), which needs no Projects migration.
- Every app's shell passes `urls.pulse` and `entitled.pulse` to the shared app switcher.

Not built (see the integration report): the work
orders list margin column, the bill detail margin tile, tasks from alerts through `@kitstak/pm-bridge`, and the app
switcher attention badge.

## 19. Release integration: what was joined up, how to verify, what is open

This section is the state of the app after the eight teams finished and the tree was integrated.

### 19.1 Seams that were closed

- **Job tabs mount the shared entry ledgers.** `features/jobs/job-materials.tsx` mounts `MaterialLedger` (with the
  warehouse pull when WMS is connected) and `CostLedger scope="job"`; `job-money-in.tsx` mounts `RevenueLedger` and
  `ServiceLedger`. The jobs team's temporary dialogs (`features/jobs/forms/entry-forms.tsx`) are gone. The quick
  actions on the job overview are links to those ledgers (`#other-costs`, `#invoices`, `#extra-services`).
  `forms/job-dialogs.tsx` (edit job, plan, price) and `forms/work-entry-form.tsx` stay: they are not duplicates.
- **A planned job starts with its first logged work.** `production.ts` `startPlannedJobs` (inside `finishProduction`)
  turns a `planned` job `active` when the first production entry is saved on it, sets `activated_at` and logs
  `job.status_changed`. Before this a new job (the wizard defaults to Planned) never showed on the day sheet, so "create
  a job, then log work" was a dead end. Imports write entries with their own bulk insert and do not start a job.
- **Entries of a deleted job leave the entry lists.** `listProduction` skips them unless `jobId` or `includeDeleted` is
  given. They were already out of every rollup; the All entries page linked to job pages that answer 404.
- **Saved views on every list.** Jobs and Profit keep their own bars (they store more than a query). Every other list
  mounts `SavedViewsBar` from `@/features/views/saved-views-bar`: All entries (`page="log"`), Alerts, Labor time and
  cost, every report, the audit log and Export. For that, list state moved into the address bar with
  `@/features/views/use-url-state` (`useUrlState()` for keys, `useUrlText(key)` for a search box; it writes with
  `history.replaceState`, so no server round trip): Alerts `?tab=&q=`, All entries
  `?from=&to=&site=&class=&source=&needsHours=1&removed=1&job=`, Labor and Target pace `?range=&from=&to=&site=`.
- **CSV on every list.** Already there: jobs, a job's work log, All entries, profit (five views), services, service
  entries, reports, audit log, Export. Added: Alerts (what is on screen, money left out for no money readers), Labor
  cost and Labor time (client side, `downloadCsv`), and `ExportStreamLink` (`@/components/pulse/export-link`, the
  template columns, imports back) on Target pace, Goals and Labor rates. The four entry ledgers export what is on
  screen (`exportName` on `Ledger` in `features/costs/ledger-kit.tsx`), on the job tabs and on month close.
- **"How we got this" on every KPI tile.** All 64 `KpiTile`s carry `explain`. Numbers with server figures use
  `ExplainNumber`; numbers the screen already holds use the new `ExplainStatic` (`@/components/pulse/explain`:
  `title`, `rule`, `rows`, `footnote`).
- **Command palette and keys.** `src/lib/nav.ts` gained a `chord` for every navigation entry and `SUB_PAGES` /
  `subPagesFor(role, seesMoney)`: every tab, second level screen and settings section, with the role and money rules.
  The palette lists them under "More pages" while typing, and "Log many days" and "Review the day" under "Do
  something". A page with its own row outranks the section it sits under. The shortcut sheet lists the new go to keys
  (a data only edit in `features/shell/shortcuts-dialog.tsx`).
- **Job pages name the job in the browser tab** (`jobPageTitle` in `src/lib/routes.ts`): "J-1026", "J-1026 · Work log".
- **People and roles for non admins.** The settings section no longer calls `GET /api/v1/roles` (403) for a reader
  without `roles:manage`; it says who to ask.
- **Seed.** The seeded Alerts view uses the query shape (`{ query: 'tab=mine' }`). The Northwind jobs view that named
  a filter the jobs list does not have is now "Finished jobs, newest first".

### 19.2 Migrations

- Journal: `0000_pulse_init`, `0005_saved_view_pages`, `0007_rls_policies` (idx 0, 5 and 7), then the round four
  files, among them `0009_db_guard_role` and `0011_wms_contract_prices_switch`. Numbers 0001 to 0004 and
  0006 were reserved per team and never used; the runner sorts by `idx`, so the gap is harmless. The next migration
  takes any free number above the last applied one.
- Verified on an empty database: `@kitstak/db` (7 migrations), CRM, WMS (12), Projects (6), then Pulse (2), in that
  order, all applied; the resulting `pulse` schema is byte identical to the dev database (`pg_dump -s -n pulse`).

### 19.3 How to verify (exact commands, run from the repo root unless noted)

```bash
pnpm --filter kitstak-pulse typecheck && pnpm --filter kitstak-pulse lint && pnpm --filter kitstak-pulse test
for p in kitstak-portal kitstak-crm kitstak-projects kitstak-web @kitstak/db @kitstak/entitlements @kitstak/pulse-bridge; do pnpm --filter $p typecheck; done
for p in kitstak-portal kitstak-crm kitstak-projects; do pnpm --filter $p lint; done
(cd apps/wms && NODE_OPTIONS=--max-old-space-size=3200 pnpm exec tsc --noEmit && NODE_OPTIONS=--max-old-space-size=3200 pnpm exec eslint)
for p in kitstak-portal @kitstak/ui @kitstak/entitlements @kitstak/pulse-bridge kitstak-projects kitstak-crm; do pnpm --filter $p test; done
pnpm --filter kitstak-pulse db:migrate && pnpm --filter kitstak-pulse db:seed
cd apps/pulse && E2E_CHROMIUM=/opt/pw-browsers/chromium_headless_shell pnpm exec playwright test --workers=1
```

`@kitstak/ui`, `@kitstak/db`, `@kitstak/entitlements`, `@kitstak/pulse-bridge` and `kitstak-web` have no lint script;
`@kitstak/ui` has no typecheck script (its sources are typechecked by every app that imports them).

No money readers have demo logins (section 11): `j.okafor@kitstak.io` (supervisor) and `cs.team@kitstak.io` (viewer), both
`KitStak!demo2026`, money off.

### 19.4 Still open

Product gaps the teams reported, none of them a broken screen:

- **Jobs**: no "won deals with no job yet" strip, no "deal value changed in CRM" notice, no revision history list on
  the plan tab, no per month plan for ongoing jobs, no usual crew editor, no "Refresh from WMS", no planned against used
  rollup per item, links cannot be added by hand on the job page (`LinkRecordDialog` lives on Connected apps only). The
  board is read only. Quick add is hidden under 768 px.
- **Production**: kiosk logs one row per job on the default labor class; the idle time of a tablet link has no field
  in the UI; the kiosk rate limit is per server process; punches have no edit in place.
- **Profit**: no "compare to plan" and no should cost column in the explorer; time groupings compare by position; the
  print page of a report has no chart; plan reports use each job's whole life; the audit log report stops at 2,000
  rows; scheduled builds need `CRON_SECRET` (only "Build now" was exercised).
- **Money ops**: the Done tab of Alerts loads the latest 200 and 200 with no paging; the rule preview replays 13 of 21
  kinds from daily numbers and falls back to raised alerts for the rest; the wall is reached from the palette and
  Goals, not the top navigation.
- **Data**: files are parsed on the main thread; save progress lives in server memory; 50,000 rows was not timed (5,000
  was); "Download everything" is built in memory; undo of a jobs import soft deletes jobs that got work afterwards.
- **Integrations**: change notes are answered
  on Connected apps and the cron tick only; several spec extras in the sibling apps are not built (work order list
  margin column, dashboard tiles, tasks from alerts, switcher badge). Small edges of the warehouse money pull: a
  contract rate sets the job price but does not rewrite the job's quote; a work order fee with conditions (some
  products only) is left to the warehouse bill; a flat fee for each work order is used only when it is the contract's
  only work order fee; a tiered service fee is read at its first tier.
- **Seed**: no time punches, device links, kiosk PINs, quote scenarios, report schedules or sync runs; fewer jobs and
  entries than the spec sketch; warehouse jobs sit on fixed work order dates.
- **Across teams**: Services, Target pace and Goals have no saved views (their page is not in `SAVED_VIEW_PAGES`, which is also a database
  CHECK); a view saved on one report shows on every report; Supervisors
  land on Log work and the floor version of Home (`/?floor=1`) has no link; the 404 for a missing job only fires on a
  full page load.
- **Foundation leftovers**: big restamps run inline. The Content-Security-Policy was checked in a browser against
  `next dev` (which adds `unsafe-eval` and websockets); the production policy is covered by unit tests and has not
  been walked against a production build yet.

### 19.5 Bundle QA fixes (integrations lens)

- **WMS work order changes now reach Pulse.** Work orders write their change log in
  `apps/wms/src/server/repositories/work-orders.ts` `recordWorkOrderChanges`, not through `recordUpdate`, so the
  Pulse note was never left. The note (`wms_work_order_changed`) is now left there on a status or finished quantity change.
- **A second warehouse pull on the same day adds its parts.** The material ref is now
  `woc:<componentId>:<date>:<warehouse count after the pull>` (`ledger.ts` `pullWmsUsage`). Before, the second pull of a
  day hit the unique ref of the first and was skipped, so parts stayed behind the units.
- **A deleted job frees its work order and its project time** (`jobs.ts` `insertLinks`), so the record can be tied to a
  live job. Covered by `seams.db.test.ts`.
- **A job made from a won deal ties its client to the deal's CRM account** when the names match and the client has no
  account yet (`jobs.ts` `createJob`, `adoptCrmAccount`), so the account's Profit tab in CRM finds the client.
- **`JobDetailDTO.inheritedPartsOwner`**: who buys the parts when the job does not say (client, then workspace default).
  The Materials tab shows that instead of always "We do".
- A late work order fills the new job form with a start date that is not after its due date.
- Sibling panels: the CRM health line shows the combined margin when it names several jobs; "0 of 0 units" reads
  "0 units"; the projection sentence says "By the plan" until units are logged; `emitBridgeEvent` logs one line when a
  note cannot be left.

### 19.6 Standalone QA fixes (a workspace that licenses only Pulse)

Covered by `src/server/domain/standalone.db.test.ts` unless noted.

- **Export, then import into another workspace, gives the same numbers to the cent.** Three things made it drift:
  a production file could overwrite hours that time punches own (now left alone with a row note, `imports.ts`); the
  punch rollup added a second "time not on a job" row next to the copy that came in with the export (now it takes that
  row over when day, class, reason and hours match, `punches.ts`); and odd cents of shared cost went to the smaller row
  id (now job number, shift and labor class decide before the id, `recalc.ts` `allocatePool`).
- **Workspace settings are not in any CSV**: the default labor class, the site time zone and the cost rules have to be
  set by hand in the second workspace. With those set, every `job_stats` column matched for 61 jobs.
- **A row left out of an import keeps its reason**, and "Download rows left out" lists every left out row after the save.
- **Import notes**: more than 24 hours each and dates like 3/4/2026 read with the usual order say so on the check
  step. A work day after today is a problem row in the work log file (never saved) and a note in the other floor files.
- **A labor class made on the fly** (a job type or job named it first) gets its name and kind from the labor rates file.
- **Getting started makes the Packer class with code `PACK`**, the code every template uses, and moves the cursor into
  the next step.
- **Goals export**: money goals are left out for a reader without money (and with "Leave money out").
- **Audit search** matches the words on screen ("Undid an import") and people's names, not only the stored codes.
- **Changing a site's time zone** recomputes its open jobs (`catalog.ts` `updateSite`).
- **People and roles** says how a person is added and links to the Portal. `/no-workspace` lists the invitations sent
  to the signed in email with a Join button, because a Pulse only workspace has no other place to accept one.
- **Two clients cannot share a name** when added by hand (`catalog.ts` `createClient`). Imports and sync are unchanged.
- Upload limit is 60 files a person an hour (17 kinds of data on day one). `UTC` is always in the time zone list.

### 19.7 Round two fixes (the blocking issues from the round one critics)

Each one was checked again against the running app on port 3500, not only by tests.

- **A deleted job no longer leaks cost.** `recalc.ts` counts a production or service line only while its job is live
  (`liveJob()`, the same rule `v_facts` uses): company days, the shared cost pool and the bridge all skip a deleted job's
  lines, and those lines hold 0 shared. Restore brings the shares back. Any `recalcOrg` run cleans old leaked rows.
- **No false green on a job with no plan.** `planHasCosts()` and `costKnown` (`lib/profit`): with no cost plan and no
  pace, projected margin, profit and cost at finish are null and the new rule D4 says "No plan yet, so Pulse cannot tell
  if this job will make money." (SPEC 4.13, 4.14).
- **Search finds records.** `searchAll` (`search.ts`) finds jobs, clients, job types and extra services (every typed
  word must match, ranked, org scoped, no money fields). The palette fetches `/api/v1/search` live and opens the top
  match on Enter; `/search` lists record panels first; `/clients` redirects to the client list.
- **One number per figure.** Pace names its window ("In the last 5 work days"), the Pace card and the Plan tab name
  their yardstick, unit cost "so far" and "by the finish" are labeled apart, and Alerts read the live risk reason, so the
  loss on Home, the job, the jobs list and Alerts match to the dollar (`jobHeadlineFigures()`, `impactAsOf`). The Plan
  view title follows its toggle. A headline margin has two names on every screen, "Job margin" and "Company margin"; the margin before time not on a job is a line inside "How we got this" (SPEC, on screen words).
- **Moments in time never differ between server and browser.** The server does not know the reader's time zone or clock, so
  "4 days ago" or "3:42 PM" worked out in render caused hydration errors (Alerts, Month close). Client components show a
  timestamp with `RelativeTime` or `LocalTime` from `@/components/pulse/local-time` (or `formatMoment(iso, style, useHydrated())`
  inside a sentence): UTC text on the server and during hydration, local time right after. Do not call `formatRelative` or an
  `Intl.DateTimeFormat` with no `timeZone` in the render of a server rendered component, and do not reach for `suppressHydrationWarning`.
- **Home arrives whole.** `HomePage` reads the period before and the jobs that need you on the server (`initialBefore`,
  `initialAttention`), so the "vs before" chips and the list are in the first HTML. `KpiTile deltaPending` keeps room for a chip that is still loading.
- **CRM deal search works.** It ordered by an outer alias, so Postgres refused it and the catch hid the error. Fixed,
  and every fail soft catch in the sibling readers now logs one line (`integrations/log.ts` `logSoftFail`).
- **No lost edits.** `PUT /api/v1/log/rows` locks the row, updates on the version it read, and answers 409 with the
  fresh row for a missing or old version. `GET /api/v1/production` returns `meta { truncated, limit, offset, nextOffset }`.
- **Warehouse parts are dated the day they were used** (Kitting ledger, site time zone), with a stable
  `woc:<componentId>:<date>` ref and BigInt cents (`wms-usage.ts`). Bridge notes are settled after the work, so retries
  and parking happen (`finishBridgeEvents`). Gone Projects time is removed. `explain` answers 404 for an unknown job.
- **No money roles see no payroll dollars.** Stored period checklists, settings (burden defaults need `wage:read`,
  target margin and floor need `money:read`, `wagesHidden`) and every page payload are gated; the DTO walk test covers
  38 more readers. An unknown labor class in an import is a problem row unless "Add new labor classes" is on.
- **Phone and tablet.** The alerts bell shows at every width and the phone drawer shows the open alerts count. Jobs
  use cards up to 1024 px (with Due), and the table folds Client and Trend away below 1280 px, so no money column
  leaves the screen. One page frame on every route; date pickers, axe and chart label fixes.

Checks at commit: typecheck and lint clean, 667 unit and database tests, 57 Playwright tests against port 3500.
Dev data note: job stats were recomputed once with `recalcOrg` (no restamp) so stored rows use the new rules.

### 19.8 Round three fixes (the blocking issues from the round two critics)

Each one was checked against the running app, not only by tests. Email reports stay deferred.

- **Month close shows the company number.** The month card shows Job cost, Job profit and Job margin, then the bridge
  steps (time not on a job that no job carried, paid time not on any job, overhead the hourly rate did not cover), then
  Company profit and Company margin. The month list shows company profit. The close snapshot stores
  `company { jobProfitCents, jobMarginBp, companyProfitCents, companyMarginBp }`. The words "All cost" are gone.
- **Two margin names.** "Job margin" and "Company margin" are the only headline names. The before shared figure lives in
  "How we got this" as "Before time not on a job", and as a table column it is "Contribution %".
- **Job delete asks first and can be undone later.** `DeleteJobDialog` says what leaves the reports (money left out for
  a reader without money). `deleteJobAction` does not revalidate the page that is gone, so the person lands on the jobs
  list with the Undo toast. `/jobs/deleted` (a tab on Jobs, `job:manage`) lists deleted jobs with who, when and Restore.
- **No silent look alike clients.** `src/lib/client-names.ts` is the one look alike rule for the screen and the server.
  `ClientCombo` (quick add, the Log work "Add a job" dialog and the new job wizard) offers "Did you mean" first and only
  makes a client from the "Create" row. `quickAddJob` refuses a look alike name unless `createClient` is true, and so
  do `createJobAction`, `createClientAction` (`confirmNew`) and `createJobFromScenarioAction`.
- **Plan vs actual on a tablet.** Below 1024 px the table is label and value cards, so "Projected at finish" is whole.
  `ScrollX` (`@/components/ui/scroll-x`, built into the `Table` primitive) gives every table that still scrolls a tab
  stop, a name and a fade cue. A tab bar or a row of buttons uses it with `tabStop={false}`: the fade, and its own items as tab stops.
- **"Put on a client, not on a job"** is out of the job ranking on the job profit report. It has its own row and a panel
  with one plain sentence and a link to the entries behind it (`profit/entries?job=none`).
- **Log work.** "Hours each" has no grey number. The warning names the missing box ("Add the hours each", "Add people").
  The labor hours check now matches the numbers on the row.
- **No hydration warnings from time.** `RelativeTime`, `LocalTime` and `useHydrated`
  (`@/components/pulse/local-time`) print UTC text on the server and local time after hydration. Home reads the prior
  period and "Jobs that need you" on the server, so the first screen does not jump.
- **Warehouse money flows in.** Each warehouse extra service record becomes one extra service entry (`source = 'wms'`,
  `source_ref = wms:vas:<record id>`), on the job linked to its work order or else on the client, dated the day the work
  was done. The price is the record's own total, or else the count times the client's contract rate, or else no price
  (Connected apps says how many and what to do). A second sync adds nothing, a changed record updates its entry, a
  removed record is taken out, and closed months are left alone. Jobs linked to a work order take their price from the
  contract's work order fees when Pulse first sees the contract and each time its rates change. Not built: the quote is
  not rewritten with origin `wms_contract`, and there is no settings switch.
- **Links to an app off the plan are plain words** (`JobDetailDTO.links[].url` and `VasEntryDTO.sourceUrl` are null).
- **`GET /api/v1/profit/facts`** sends `meta { truncated, limit, offset, nextOffset }` and takes `offset`.
- **CSP on every page.** `src/server/http/csp.ts` builds a nonce policy in `src/proxy.ts` (no eval in production). The
  report print page sets its own tighter policy.
- **RLS policies.** `0007_rls_policies.sql` adds `pulse_org_isolation` to all 46 tables, keyed on the session setting
  `pulse.org_id`, and makes `pulse.v_facts` a security invoker view. RLS is not forced on the owner and that file
  granted nothing, so the app was unchanged in that round (round four adds the database guard, section 12 rule 13). `rls.db.test.ts` proves a plain role sees nothing without the setting and only its
  own org with it, and fails if a pulse table ever has RLS on with no policy.
- **Alert rule lines are hidden from readers without money** (dollar and margin lines): `toRuleDTO(row, canSeeMoney)`
  sends `threshold: null`, `moneyHidden: true` and a name with no numbers, and writes with a line are refused.
- **The flaky kiosk test** built a "wrong secret" that was the real one about 1 run in 64. Fixed in the test.

Local data note: the WMS seed sets every demo login to `KitStak!demo2026`, so after a full local seed the Pulse admin
signs in with that password. Five wrong tries lock a login for 15 minutes (`core.password_policy_state`).

### 19.9 Round four fixes (the issues from the round three critics)

Every major issue from `docs/pulse/round-3-critics.json` except CI, and the minor ones. CI and email reports stay
deferred.

- **Company profit for any days.** Company costs are monthly, so a range that is not whole calendar months counts its
  share by day: the days in range over the days in the month, in BigInt cents, rounded so the parts of a month always
  add back to the whole month (`prorateDays`, `spreadCompanyCosts`). The rule lives in `getCompanyBridge`, so Home,
  Profit, the reports, the popover and `GET /api/v1/company-bridge` agree. The screen says "Company costs for 18 of 30
  days." for a part month and never says "after overhead" when none was counted. A whole month, and so month close,
  did not change by a cent. A range of several whole months now equals the sum of its months.
- **The database guard.** With `PULSE_DB_GUARD=1` every query runs as the plain role `pulse_app` with the workspace
  set, so the row level security policies apply to the running app. Work that must cross workspaces goes through
  `asSystem`, and `db-guard.test.ts` lists every caller. On in tests and local dev. Off in production until the flag
  is set there: the steps are in section 12, rule 13. It does not protect against SQL injection, and it was not tried
  through a transaction pooler.
- **A day is never overwritten by accident.** The Work log form saves a whole day through `PUT /api/v1/log/days`. A
  day that already has work is shown before anything is saved, with a button to open it. The server refuses a new day
  on a day with work, and refuses an edit unless it names every row with the version it read (409 with the day as it
  is now). Saving an edit and deleting a day both have Undo. Deleting a day asks first and lists what will go.
- **Saves cannot lose hours.** A save of a row that exists needs its version. Two lines for the same job, day, shift
  and labor class are refused on the line.
- **Work cannot be dated after today** (the site's own day) on the day form, the grid, the bulk page, the API and the
  work log import, where it is a problem row. Rows from the warehouse, Projects and the time clock are exempt.
- **Key numbers stay on screen.** Every `Table` wraps itself in `ScrollX` (tab stop, name, fade). Profit, reports and
  the Company costs ledger pin their money columns to the right edge. Work log entries, extra services, client jobs,
  schedules, labor cost and punches are cards at narrow widths. Target pace pins its row actions. Tab bars that scroll
  show the same fade.
- **One set of pickers.** No native select or date input is left on any screen (`native-controls.test.ts`). The alert
  rules quiet hours box is still a native time input.
- **One client box and one look alike guard.** Quick add, the Log work dialog, the new job wizard, the calculator,
  Settings and the welcome step refuse a client name close to one you have until the person confirms. Renaming a
  client is covered too. Imports, sync, seed and sample data are unchanged.
- **No cost yet.** An extra service with revenue and no cost has no margin (`costMissing`, `marginBp: null`) in the
  lists, the service page, the profit explorer, the pivot and their CSV files. An entry with no price has "Set the
  price" on the row, and a link to the warehouse contract when it came from the warehouse.
- **One count of unpriced entries** feeds Home "Things to fix" and the month close checklist.
- **Log work.** A job with units and no labor hours shows "no margin yet: add the hours" and is left out of "Margin
  today", which says so.
- **Month close** shows one status at a time and passes the accessibility check at 1440, 768 and 390.
- **Target margin** is a money column in the clients, job types and jobs exports and is not sent to a no money reader
  on Home.
- **Deleted jobs** can be listed or read only by a person who may manage jobs (403 on the list, 404 on the job).
- **Warehouse contract rates** have a switch on Connected apps (`wmsContractPrices`, on by default, migration 0011).
  A job with no price takes the rate from its first day. A job with a price gets the rate from today. A finished job
  with a price is left alone. Volume tiers and fees with conditions stay with the warehouse bill.
- **Layout shift.** Target pace, Labor time and Extra services arrive whole on first paint. Loads over the 0.1 line
  on the seven routes the critic named went from 15 of 42 to 0 of 42.
- **Alert rules for readers** who cannot change them: the page says so, shows each rule on or off, and shows the day
  count. Dollar and percent lines stay hidden from no money roles (confirmed by the owner).

Migrations in this round: `0009_db_guard_role.sql` and `0011_wms_contract_prices_switch.sql`. Numbers 0008 and 0010
were reserved and not used.
