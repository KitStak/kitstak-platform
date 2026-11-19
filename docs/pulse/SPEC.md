# KitStak Pulse: product + build spec

The fifth KitStak app: a profit management system for kitting, 3PL and contract packaging shops.
It answers one question for every job, client and service: "Are we making money, and if not, why?"
It must beat Easy Metrics Profit Management on function and be simple enough for an 8th grader.
It runs standalone (only Pulse licensed, CSV in and out for every data stream) or bundled and
deeply linked with Portal, CRM, WMS and Projects.

Companion docs, written with the build and kept in step with this spec: `docs/pulse/CONTRACTS.md` (folder ownership,
function names, DTOs), `apps/pulse/AGENTS.md` (house rules for the app), `apps/pulse/drizzle/README.md` (migration list)
and `packages/pulse-bridge/README.md`.

Copy rule for every user-facing string: plain 8th grade words, short sentences, and never an em dash
or a double dash. Use commas, periods or colons. Ranges read "to". Enforced by ESLint and `copy-rules.test.ts`.

**Words we use on screen.** Table, column and code names keep their short technical form. People only ever see the right hand side.

| In code | On screen |
|---|---|
| VAS, `vas_*` | Extra services |
| standards, standard UPH | Target pace |
| UPH, units per labor hour | Units per person per hour ("UPH" only as a CSV header) |
| shared cost, indirect time | Time not on a job (meetings, cleanup, waiting) |
| loaded rate | Real cost of an hour |
| targets, scorecards | Goals |
| needs flags | Things to fix |
| flexed plan | Plan for the work done so far |
| variance waterfall | Why profit changed |
| margin | Exactly two names for a headline margin, on every screen: **Job margin** (profit on jobs / revenue) and **Company margin** (company profit / revenue). No other margin name is a visible label. |
| contribution margin, margin before shared costs | Only inside "How we got this", as the line "Before time not on a job". As a table column next to Contribution it reads "Contribution %". |
| job cost | Job cost (never "All cost": overhead and paid time on no job are not in it) |
| rows with a client and no job | Put on a client, not on a job |
| utilization | Share of paid time spent on jobs |
| earned, billed | Earned (work done), Billed (invoiced), Not billed yet |
| basis points, cents | never shown |
| risk status ids `on_track`, `heads_up`, `at_risk`, `losing`, `no_data` | On track, Heads up, At risk, Losing money, Not enough data |

The five status words are one shared constant, `PULSE_STATUS_LABELS` in `@kitstak/pulse-bridge`, used by all five apps, every export and every report.

## 1. Topology

| | Dev | Prod |
|---|---|---|
| App | `apps/pulse` (npm `kitstak-pulse`), `http://localhost:3500` (personal dev servers 3501 to 3520) | `pulse.kitstak.app` (new Vercel project `pulse`, Root Directory `apps/pulse`) |
| DB | shared Postgres, new schema **`pulse`** | same Supabase DB |
| Auth | Better Auth via `@kitstak/auth` (copy `apps/projects/src/server/auth.ts`; cookie `kitstak.session_token`) | `AUTH_COOKIE_DOMAIN=.kitstak.app` |
| Entitlement module | **`pulse`** (add to `core.entitlements` CHECK, `@kitstak/db` `ENTITLEMENT_MODULES`, `@kitstak/entitlements` `MODULES`) | grant: `pnpm --filter @kitstak/entitlements grant grant <org-slug> pulse` |
| URL env var | `NEXT_PUBLIC_PULSE_URL` (default `http://localhost:3500`), read by all five apps | `https://pulse.kitstak.app` |
| Migrations | `apps/pulse/drizzle`, runner `scripts/db-migrate.ts`, table `drizzle.__kitstak_pulse_migrations`, advisory lock key `7_202_611_505` | fresh database order: `@kitstak/db`, CRM, WMS, Projects, then `pnpm --filter kitstak-pulse db:migrate` last |
| Shared migrations | `packages/db/drizzle/0006_core_pulse_module.sql` widens `entitlements_module_check` to `('crm','wms','projects','pulse')`. `apps/projects/drizzle/0006_pulse_links.sql` adds `pulse_job` to both target type CHECKs (`pm.integration_links`, `pm.integration_events`). | |
| Entitlement guard | `apps/projects/drizzle/0000_pm_init.sql` drops and re-adds the CHECK with three values, so on a fresh database it narrows what `@kitstak/db` 0006 set. `apps/pulse/drizzle/0000_pulse_init.sql` therefore drops and re-adds the CHECK with all four values inside a `to_regclass('core.entitlements')` guard, and Pulse always migrates last. A CI test runs the whole chain on an empty database and asserts the four values. | |
| Bridge package | `packages/pulse-bridge` (`@kitstak/pulse-bridge`), raw SQL over the host app's Drizzle executor, same shape as `@kitstak/pm-bridge` | |
| Cron | `vercel.json`: `/api/v1/cron/tick` every 15 minutes (sibling sync, bridge events, day rollover per site, alerts, due report builds), `/api/v1/cron/cleanup` daily at 07:10 UTC (retention). Both need `Authorization: Bearer $CRON_SECRET` and return 503 when `CRON_SECRET` is not set. | |

Local dev DB (migrated and seeded): `postgres://postgres@localhost:5432/kitstak`. Shared `BETTER_AUTH_SECRET` is in
`/var/lib/kspg/secret`. Copy `apps/projects/.env.local` to `apps/pulse/.env.local` and set `BETTER_AUTH_URL` and
`NEXT_PUBLIC_APP_URL` to `http://localhost:3500`. Logins: `admin@kitstak.io` / `KitStak-Demo-2026!` (org `kitstak`,
two warehouses, no CRM boards) and `maya@northwind-robotics.example` / `Northwind-Demo-2026!` (org
`northwind-robotics`, rich CRM and Projects, no warehouse, no `core.customers` rows).

Env (`src/server/env.ts`, lazy): `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_PORTAL_URL`, `NEXT_PUBLIC_CRM_URL`, `NEXT_PUBLIC_WMS_URL`, `NEXT_PUBLIC_PROJECTS_URL`, `TRUSTED_ORIGINS`,
`AUTH_COOKIE_DOMAIN`, `ENTITLEMENTS_DEV_ALLOW_ALL`, `CRON_SECRET`, `PULSE_DB_GUARD` (1 turns the database guard on: the app runs its queries as the plain role `pulse_app` with the workspace set, CONTRACTS section 12 rule 13; off in production until it is set there, on in tests and in local dev). `appUrls()` returns `{portal, crm, wms, projects, pulse}`.
`trustedOrigins()` adds the four sibling URLs, and dev ports 3500 to 3520 only when `NODE_ENV !== 'production'`.

Ops surface, same as the siblings: `GET /api/health` (database ping, migration version), structured error logs with org id and
request id, `error.tsx`, `not-found.tsx`, `global-error.tsx`, security headers and CSP in `next.config.ts` matching the sibling
policy (including `connect-src 'self'`), and `robots` disallow all.

## 2. Stack (match apps/projects exactly)

Next.js 16.4.5 App Router (read `node_modules/next/dist/docs/` first: `src/proxy.ts` not middleware, `params` are Promises),
React 19.3, Tailwind 4 via `@tailwindcss/turbopack`, `@kitstak/ui` tokens + theme + logo + app switcher + handoff, Drizzle + pg via
`@kitstak/db/client-pg`, zod 4, lucide-react, radix, cmdk, sonner, zustand, `@tanstack/react-query`, `@tanstack/react-virtual`,
date-fns, vitest, Playwright. Charts are the house hand-rolled SVG kit copied from `apps/projects/src/features/dashboards/charts.tsx`
into `src/features/charts/` and extended (ranking bars, waterfall, bullet bar, sparkline, stacked cost bar, gauge). No chart library.
CSV parsing and writing is our own small tested module (`src/lib/csv.ts`), no dependency. Shell, top bar and its navigation, org switcher,
user menu, theme toggle and command palette are copied from Projects so Pulse looks and behaves like its siblings.

Layering is the house pattern: pages are thin, `src/features/<area>` holds server page + client view, all data access goes through
`src/server/domain/*` (first argument `ctx: DomainContext`), mutations are server actions returning `ActionResult<T>`, client reads
are same origin `/api/v1/*` with the `{ data } | { error }` envelope, every write runs in one transaction with an activity row.
Background work on Vercel is always `after()` from `next/server` on a route with an explicit `maxDuration`, never a detached promise.

Wire types: `pg` returns `bigint` and `numeric` as strings. Cents leave the server as JS numbers only after a
`Number.isSafeInteger` check (else the request fails loudly). Quantities, hours, prices and rates per unit leave as decimal strings.
All money math in `src/lib/money.ts` uses `BigInt`.

## 3. Roles and permissions

Pulse has five roles. Seeing money is opt in. One module, `packages/pulse-bridge/src/access.ts` (`resolvePulseAccess`), holds the
whole rule as one SQL statement plus one pure function, and both `apps/pulse` and the bridge import it, so they cannot drift.

A person's Pulse role is the first of these that applies:

1. Their row in `pulse.member_roles` (explicit, set by an admin or by the claim step below).
2. If the org has a WMS tenant and a `users` row for the person (matched by email, `is_api_user = false`):
   `user_type = 'Owner'` or role `admin` gives **admin**, `manager` gives **manager**, `operator` gives **supervisor** (no money),
   `viewer` with `user_type = 'Operation'` gives **viewer** (no money), `user_type = 'Client'` gives **none**. API users get none.
3. Their org role (`core.member.role`): `owner` gives **owner**, `admin` gives **admin**, `member` gives
   `settings.default_member_role` (default **`none`**), `viewer` and `guest` give **none**.

"None" shows a friendly "Ask an admin for access" screen. WMS client portal users and floor operators never see margins by default.

**Who runs Pulse.** Nobody is an admin by accident. If no person in the org resolves to `owner`, the first person who resolves
to `admin` and opens Pulse is offered "Run Pulse for this workspace". Saying yes writes an explicit `owner` row for them. If nobody
resolves to `admin` either (a Pulse only workspace made of plain members), any org `member` is offered the same step and the first
one to accept becomes the owner. The welcome flow then asks the owner one question, "Who can see money?", with a list of members
and a role picker for each. `data:purge` and `period:reopen` always mean this Pulse `owner` role, however it was reached.

| Role | Who it is | Sees money | Can do |
|---|---|---|---|
| **owner** | business owner | yes, including wages | everything, including delete all data and reopen closed months |
| **admin** | finance or ops lead | yes, including wages | labor rates, settings, roles, close a month, sample data, integrations, plus all manager rights |
| **manager** | account or production manager | yes (real cost of an hour only, never the wage) | jobs, plans, costs, revenue, services, target pace, goals, alerts, imports, exports, edit any entry, review days |
| **supervisor** | floor lead who logs production | no (per person switch `sees_money` can turn it on) | log and edit production, other time and material usage for days that are not marked complete, in the last 7 days; import those streams; see units, hours and pace |
| **viewer** | read only | per person switch `sees_money`, default off | read every screen, export what they can see |

Action table (`src/lib/permissions.ts`, min role): `pulse:read` viewer · `production:log` supervisor · `production:edit_any` manager ·
`material:log` supervisor · `day:review` manager · `job:manage` manager · `plan:manage` manager · `cost:manage` manager · `revenue:manage` manager ·
`vas:manage` manager · `standard:manage` manager · `target:manage` manager · `alert:manage` manager · `import:run` manager
(supervisor for streams production, other time, time punches, materials) · `export:run` viewer · `device:manage` manager · `rate:manage` admin ·
`period:close` admin · `roles:manage` admin · `settings:manage` admin · `sample:manage` admin · `period:reopen` owner ·
`data:purge` owner. Two more rights are not ranks. `money:read` is true for owner, admin, manager and for anyone with `sees_money`.
`wage:read` (wage, tax and benefit detail of a rate) is the same as `rate:manage`: other money readers see only the real cost of an hour.

**Money hiding is done on the server, never only in the UI.**
- Every DTO builder takes `canSeeMoney` and `canSeeWages`. When money is hidden, every money and margin field is `null`, the DTO carries
  `moneyHidden: true`, rate endpoints return 403, exports drop money columns, and the UI shows units, hours and pace instead.
- **No money is ever stored inside a sentence.** Risk reasons, alerts, notifications and verdict lines are stored as `{ rule, params }`
  (numbers and ids only) and turned into words at read time by `renderReason(rule, params, canSeeMoney)`. Every rule has two templates,
  one with money and one without ("The crew is under the target pace: 31 of 42 units per person per hour.").
- Notifications fan out per reader with that reader's variant. Tasks that Pulse creates in Projects never contain money, because
  Projects members are a different audience. Built reports (`report_runs`) with `include_money` can only be read with `money:read`.
- Activity `before` and `after` are redacted for readers without `money:read` by a field allow list per entity type, not by guessing from key names.
- `@kitstak/pulse-bridge` applies the same rules for sibling apps (it takes `userId`).
- Tests: one unit test walks every DTO type (app and bridge) for a no money viewer and fails if a `*Cents`, margin or rate field is not null,
  or if any string field matches a currency symbol followed by a digit, a number followed by `%` next to the word margin, or `cents`.
  A second test checks a manager never receives `wageCents` or burden fields.

**People who leave or belong to two workspaces.** Roles and prefs are per org (`(org_id, user_id)`), so a person in two orgs has two
independent roles, and the org switcher sends them to the locked screen when the other org has no Pulse grant. When a member leaves
an org, the cron tick removes their `member_roles` row, clears `owner_id` and `assigned_to` (user FKs are `ON DELETE SET NULL`), turns off
report schedules they own and tells the admins. History keeps their name through `core."user"`.

## 4. The cost model

### 4.1 Plain words (this text is also the in-app "How Pulse does the math" page)

- A **job** is one piece of work for one client, like "Build 5,000 holiday gift kits". One job has one kind of unit and one price.
  If you build three kit versions at three prices, make three jobs ("Copy this job" does it in one click).
- **Money in** is what the client pays: the price per unit times units finished, plus any extra services, plus other fees.
- **Money out** has four buckets: **Labor** (hours times what an hour really costs you), **Materials** (parts and supplies that you pay for),
  **Other costs** (freight, packaging, outside help), and **Time not on a job** (meetings, cleanup and waiting, spread across the jobs that ran that week).
- **Profit** is money in minus money out. **Margin** is profit as a share of money in.
- **Real cost of an hour**: the wage, plus payroll taxes and benefits, plus overhead per hour.
- The **quote** is what you told the client. The **budget** is what you think it will cost you. **Actual** is what happened.
- Pulse watches every open job and says if it is on track, needs a heads up, is at risk, or is losing money, and tells you why.
- **Job profit and company profit are two numbers.** Jobs carry the costs you put on them. The company also pays for rent, salaried staff
  and paid time nobody logged. Pulse shows the walk from one number to the other, line by line.
- **Put each cost in one place only.** A supervisor's pay goes either in overhead per hour, or in logged hours, or in company costs. Never two of them.

### 4.2 Units, precision and rounding

- Totals are `bigint` cents (`*_cents`). Rates per hour are integer cents. Percents are integer basis points (`*_bp`, 2500 = 25%).
- Per unit prices and costs are `numeric(14,4)` in currency units, so $0.0350 per label works. Quantities are `numeric(14,3)`.
  Hours are `numeric(10,2)` everywhere. Headcount is `numeric(6,2)` everywhere.
- **One rounding rule.** `divRound(n, d)` with `BigInt` `n` and `d > 0` rounds half away from zero:
  `sign(n) * ((2 * |n| + d) / (2 * d))` using integer division. Every `round(...)` in this spec means: scale the decimal inputs to
  integers (hours x 100, quantities x 1000, prices in currency units x 10000, multipliers x 100; rates per hour are already cents), multiply,
  then `divRound` once by the divisor that lands on whole cents: 100 for hours x rate, 100000 for quantity x price.
  Examples: 92.00 hours at 2176 cents is `divRound(9200 * 2176, 100) = 200192`. 3,000 units at $2.7500 is `divRound(3000000 * 27500, 100000) = 825000`.
- Every product of a quantity and a price is computed once and **stamped on the row**. Rollups are plain sums of stamped cents, so every total equals
  the sum of its drill down rows to the cent. JS floats are never used for money. Display uses a fixed `en-US` locale.
- CHECK bounds keep products inside `bigint`: quantities and hours `>= 0` and `< 100,000,000`, unit prices and costs `>= 0` and `< 1,000,000`,
  cents columns between plus and minus 10^13.
- **Ratios shown to people** (margin, UPH, productivity, cost per unit) are `null` when the divisor is 0 or less, never 0 and never infinity.
  `margin_bp = divRound(profit * 10000, revenue)` when `revenue > 0`, else `null` ("No revenue yet" at 0, "Revenue is below zero" under 0),
  and also `null` when the result is outside plus or minus 1,000,000 bp.
- **Estimates** (4.13) use exact fractions (`BigInt` numerator and denominator) and are rounded only at the named outputs: pace to 3 decimals,
  hours to 2 decimals, money to a cent.
- Dates are `date` columns surfaced as `YYYY-MM-DD` strings. "Today" is today in the **site** time zone (`sites.timezone`, which starts as
  the WMS warehouse time zone, else the browser time zone captured on the welcome screen). Timestamps from other apps are bucketed into a
  work date in the site time zone (tested with an entry at 23:30 local).
- One currency per org (`settings.currency`). A row from another app in a different currency is skipped and listed in Things to fix. Pulse never adds mixed currencies.

### 4.3 Real cost of an hour (loaded labor rate)

A labor class (for example Packer, Lead, Forklift, Temp packer) has dated rate rows. For one row, with `wage` in cents:

```
burden_bp      = payroll_tax_bp + benefits_bp + other_burden_bp
loaded_rate    = divRound(wage * (10000 + burden_bp), 10000) + overhead_per_hour_cents
overtime_rate  = divRound(wage * mult100 * (10000 + payroll_tax_bp), 1000000)        (mult100 = overtime_multiplier x 100)
               + divRound(wage * (benefits_bp + other_burden_bp), 10000)
               + overhead_per_hour_cents
pay_rate       = loaded_rate - overhead_per_hour_cents                                (used for paid time not on any job)
```

Payroll taxes and workers comp grow with overtime pay. Benefits and overhead do not: health insurance does not cost 1.5 times more in hour 41.
The rate builder labels the three percents "Payroll taxes and workers comp", "Benefits and paid time off" and "Other".

Worked example. Packer: wage $16.00, taxes 9%, benefits 12%, other 0%, overhead $2.40, overtime 1.50.
`loaded_rate = divRound(1600 * 12100, 10000) + 240 = 1936 + 240 = 2176` ($21.76).
`overtime_rate = divRound(1600 * 150 * 10900, 1000000) + divRound(1600 * 1200, 10000) + 240 = 2616 + 192 + 240 = 3048` ($30.48).
`pay_rate = 1936` ($19.36).

Temp agency classes (`kind = 'temp_agency'`) put the agency bill rate in `wage_cents` and normally 0 burden. `loaded_rate_cents`,
`overtime_rate_cents` are stored on the rate row.

**Rate that applies to an entry** (`rateFor(classId, siteId, workDate)`): candidates are the live rows of the entry's labor class with
`effective_from <= work_date` and `site_id` equal to the entry's site or null. If any candidate is for the entry's site, use the one with the
latest `effective_from` among those; else use the all sites row with the latest `effective_from`. No labor class on the entry: the org's default class.
No row at all: the org default rate, `settings.default_loaded_rate_cents`, with overtime
`divRound(default_loaded_rate_cents * default_mult100, 100)`, overhead part 0 and gross pay equal to cost. No default either: cost is 0
and the entry is flagged `needs_rate` (Things to fix, and rule D3). Adding the first rate row or the default rate clears the flag by restamp (4.17).

**Overhead helper** (Labor, Rates tab): "What does overhead cost you a month?" It sums the company costs (4.7) of the last 3 full months,
divides by the direct hours of those months, and suggests an overhead per hour. Each quarter the same check runs and tells admins
"Your overhead rate covers $16,200 a month. Your real overhead is $21,000." Any rate change shows its effect before it is saved:
"This changes 212 entries and lowers profit by $1,430 across 9 jobs."

### 4.4 Labor cost

Direct labor comes from production entries, service (VAS) entries, time punches and imported Projects time.
**`hours` always means total labor hours** (people times hours each). People type **People** and **Hours each**; Pulse shows
**Labor hours** as the answer, and it can be typed over for an uneven crew. No screen or file labels a total as plain "Hours".

```
regular_hours    = hours - overtime_hours
labor_cost_cents = round(regular_hours * rate) + round(overtime_hours * overtime_rate)
overhead_cents   = round(hours * overhead_per_hour_cents)                    (the part of labor cost that is overhead)
gross_pay_cents  = round(regular_hours * wage) + round(overtime_hours * wage * mult100 / 100)
```

Worked example. 12 packers, 8 hours each, 4 of the hours overtime: `hours = 96.00`, `regular = 92.00`.
`labor_cost = divRound(9200 * 2176, 100) + divRound(400 * 3048, 100) = 200192 + 12192 = 212384` ($2,123.84).
`overhead = divRound(9600 * 240, 100) = 23040`. `gross_pay = divRound(9200 * 1600, 100) + divRound(400 * 1600 * 150, 10000) = 147200 + 9600 = 156800`.

All five values (`rate_cents`, `overtime_rate_cents`, `labor_cost_cents`, `overhead_cents`, `gross_pay_cents`) are stamped on the entry.
Indirect and service entries have the same overtime field, the same check (`overtime_hours <= hours`) and the same stamps.

**Overtime is optional.** Payroll decides overtime per person per week, so a supervisor often cannot split it by job. Left blank, all hours
cost the regular rate, and the Payroll check (4.5) shows any gap in dollars. A time punch file from payroll carries overtime per person and fills it in.

**Setup hours.** An entry can mark part of its hours as `setup_hours` (line changeover, prep days with no finished units). Setup hours cost the
same, but do not count in pace (4.12), so a setup day does not make the job look slow.

Entry check shown inline: if `abs(hours - headcount * hours_each_default) > 0.5 * headcount * hours_each_default` (default shift length from
settings) Pulse asks "12 people for 8 hours is 96 labor hours. You typed 9.6. Is that right?" It is a warning, not a block.
The Log work grid works hours each back out when labor hours are typed, so its question uses the numbers in the row: "9.6 labor hours for
12 people is 0.8 hours each. A full shift of 8 hours each would be 96 labor hours. Is that right?" The hours each cell has no grey example
number. A job with units and no labor hours names the empty field: "Add the hours each", "Add people", or "Add people and the hours each".

### 4.5 Time not on a job, paid hours and the payroll check

- **Indirect entries** are hours not tied to a job (meeting, training, cleanup, waiting, maintenance, break, other), costed with the same rate rule.
- **Paid hours** (from a time clock file, time punches, or typed per day, site and labor class) are optional. Per site and day:
  `missing_hours = max(0, paid_hours - direct_hours - indirect_hours)`. When direct plus indirect is above paid, missing is 0 and the day
  is flagged "More hours logged than paid" in Things to fix.
  `missing_cents = divRound(paid_cents * missing_hours, paid_hours)` when every paid row of that day has `paid_cents`; else
  `round(missing_hours * avg_pay_rate)`, where `avg_pay_rate` is the paid hours weighted average of `pay_rate` for the classes of that day's
  paid rows (a row with no class uses the default class, else the org default rate).
- **Who takes a share.** Production entries and service entries with `hours > 0` (with or without a job, including Projects time rows).
  Nothing else. Weight = `hours x 100` as an integer.
- **The pool.** One pool per site and per period. The period is `settings.shared_spread`: `week` (default, weeks start on `week_start`),
  `day` or `month`. A week that crosses a month end is split into two pools at the month boundary, so every pool sits inside one calendar
  month and a closed month never changes.
- **Shared cost rule** (`settings.shared_cost_rule`), applied per pool:
  - `by_labor_hours` (default): pool cost = indirect cost of the pool. Spread over the takers by weight with the largest remainder method:
    `base_i = floor(pool * w_i / W)`; hand the left over cents, one each, to the rows with the largest remainder `(pool * w_i) mod W`,
    ties broken by earlier `work_date`, then smaller `id`. Stamped as `shared_cents`. A pool with cost and no takers stays unallocated.
  - `full`: the same spread, but pool cost = indirect cost + missing time cost of the pool, so jobs carry all paid time (full absorption).
  - `percent_of_labor`: `shared_cents = divRound(labor_cost_cents * shared_pct_bp, 10000)` on each taker. No pool.
  - `none`: `shared_cents = 0`.
- **Shared gap** (per site and day range, any rule): `shared_gap = indirect_cost (+ missing_cost under full) - sum(shared_cents)`.
  It is the unallocated pools under the hours rules, all indirect cost under `none`, and the over or under applied amount under
  `percent_of_labor` (shown as "Your 8% covered $3,100. Real time not on a job cost $3,640." so the percent can be tuned).
- **Share of paid time spent on jobs** = direct hours / paid hours (or / (direct + indirect) when paid hours are not entered).
- **Payroll check** (shown on Labor and in the month close list when `paid_cents` exists): over the days that have `paid_cents`,
  `payroll_gap = sum(paid_cents) - sum(gross_pay_cents of direct and indirect entries)`. "Payroll paid $41,200. The hours in Pulse add up to $39,350 of pay. The payroll gap is $1,850: pay that no logged hour explains."
  The payroll gap is its own name on screen. It is not the cost of "Paid time not on any job" (`missing_cents`, which prices each day's missing
  hours at that day's average pay and feeds company profit). The two can differ by a few dollars, and the info popover on the Labor tile says why.

Worked example (largest remainder). Pool $100.00 (10000 cents). Three takers with 96.00, 40.00 and 24.50 hours: weights 9600, 4000, 2450, `W = 16050`.
Bases `floor(96000000 / 16050) = 5981`, `floor(40000000 / 16050) = 2492`, `floor(24500000 / 16050) = 1526`, sum 9999, 1 cent left.
Remainders 4950, 3400, 7700: the third row gets the cent. Result 5981, 2492, 1527. Sum 10000.

The job page says where the number came from: "Time not on a job: $212. Your share of 31 hours of meetings and cleanup this week."
When a save on one job moves another job's shared cost by $1.00 or more, that other job gets an activity row (`shared.moved`, old and new amount).

Mechanics: allocation is one set based SQL statement per pool (window functions for the remainder ranking), run inside the write
transaction after `pg_advisory_xact_lock(hashtext(org_id || ':' || site_id || ':' || pool_start))`, so two people saving the same
week cannot allocate from a stale read. It is followed by one batched `recomputeJobs(ids[])` (4.18).

### 4.6 Material cost

**Who buys the parts** decides if a part costs you anything. In a 3PL the client owns the components and you only buy supplies
(boxes, tape, labels, film). The answer is resolved per usage row: the row's own `supplied_by`, else the item's `supplied_by`, else the job's
`parts_owner`, else the client's `parts_owner`, else `settings.default_parts_owner` (`us` for a standalone org, set to `client` when the first
WMS sync finds a warehouse). Parts the client owns cost 0 and still track quantity used and scrapped, so scrap of client parts is reported in units.

Each job has `material_method`:
- `standard`: `std_material_cents = round((units_good + units_scrap) * material_cost_per_unit)` stamped on each production entry, with
  `std_scrap_cents = round(units_scrap * material_cost_per_unit)` kept apart. `material_cost_per_unit` is the cost of what **you** buy per unit
  (0 when the client supplies everything). It is dated (4.17).
- `actual`: the sum of material usage rows. `cost_cents = round((quantity_used + quantity_scrapped) * unit_cost)` and
  `scrap_cents = round(quantity_scrapped * unit_cost)` when the row resolves to `us`; both 0 when it resolves to `client`.

Worked example (standard). 3,000 good, 60 scrap, $0.4500 a unit: `divRound(3060000 * 4500, 100000) = 137700` ($1,377.00), scrap `divRound(60000 * 4500, 100000) = 2700`.

WMS pulled rows snapshot the unit cost at first sync (8.3) so history does not move when a product is edited. "Refresh cost" is an explicit action on open months.

### 4.7 Other costs and company costs

`pulse.cost_entries`: dated amounts in a category, at one of three levels (`scope`):
- `job`: counts in that job.
- `client` (no job): counts in client profit and cost to serve, not in any job.
- `company` (no job, no client; site optional): rent, utilities, equipment, salaried staff, insurance, other. Counts only in the company profit
  bridge (4.9), as the real overhead that the hourly overhead rate is meant to cover.

Amounts can be negative (a vendor credit).

### 4.8 Revenue: earned is the only profit basis

Profit, margin, projection and risk always use **earned** revenue: what the work done is worth at the agreed price. Invoices never change profit.
They are a second number, **billed**, shown next to earned so nothing goes unbilled.

Per job `pricing_model`:
- `per_unit`: `base_revenue_cents = round(units_good * unit_price)` stamped on each production entry, with the price in force on the work date (4.17).
  Example: 3,000 units at $2.7500 is `divRound(3000000 * 27500, 100000) = 825000`.
- `fixed`: earned by progress. Order the job's live production entries by `(work_date, shift, labor class code, id)`. With `FP = fixed_price_cents`,
  `C_k` the running total of `units_good` through entry `k` and `P = planned_units`:
  `target_k = divRound(FP * min(C_k, P) * 1000, P * 1000)` when `P > 0`, else 0. `stamp_k = target_k - (sum of the stamps of all earlier entries)`.
  Stamps in closed months are frozen and simply count in "earlier stamps", so a later change can never rewrite them. A stamp can be negative
  (a catch up after planned units were raised); the explain popover says so. Any insert, edit, delete or change to `P` or `FP` restamps every
  open month entry of the job in the same transaction.
  **True up**: while the job is `completed`, one system revenue entry (`kind = 'fixed_true_up'`, dated the completed date) holds
  `FP - sum(stamps)`. It is deleted and rebuilt on every restamp, deleted when the job is reopened, and never written for a cancelled job
  (a cancelled fixed job earns what was stamped). If the completed date falls in a closed month the status change is refused: "Reopen October first."
  Property test: after any sequence of insert, edit, delete and plan change, `sum(stamps) + true_up = FP` to the cent for a completed job,
  and `sum(stamps) = target_last` for an open one whose last entry is in an open month.
  Example: `FP = 940000`, `P = 2000`, entries of 500, 700 and 900 units. Targets 235000, 564000, 940000 (capped at 2,000). Stamps 235000, 329000, 376000.
  If the job is completed after the second entry instead, the true up is `940000 - 564000 = 376000`.
- `hourly`: `base_revenue_cents = round(hours * bill_rate)` stamped on each entry (bill rate from the job's dated price row, else the labor class rate row).

Added on top:
- **Service revenue**: each service entry `amount_cents = round(quantity * unit_price)`, or a typed flat amount. `null` means "No price set yet" (Things to fix).
- **Other revenue**: `pulse.revenue_entries` with kind `fee`, `adjustment` or `credit` (credits are negative), on a job or on a client with no job.

```
revenue = base_revenue + service_revenue + other_revenue
billed  = sum of approved revenue entries with kind = 'invoice'          (memo, never in profit)
not_billed_yet = revenue - billed                                        (per job and per client)
```

**Billed** rows are typed, imported, or pulled from WMS bills (8.3). A bill that is not approved does not count. A bill takes the date of its
billing period end. The **Ready to bill** report lists work done and not invoiced by client and job, with CSV export, so a standalone shop can hand
it to accounting. The alert `unbilled_above` fires when a job's `not_billed_yet` stays above a set amount for a set number of days.

Client level revenue with no cost behind it would flatter a client. The client page says so: "Includes $4,200 of revenue with no cost tracked: Storage."
Warehouse bill lines for work Pulse does not cost (Receiving, Storage, Pick and Pack, Shipment) stay billed memo rows under "Warehouse billing, cost not
tracked in Pulse" and are outside profit, unless an admin turns an operation type on in `settings.wms_billing_ops_in_profit`; then each approved line of
that type is also booked as a client level `fee`.

### 4.9 Cost, profit, margin and the company profit bridge

```
cost     = labor + material + other + shared
profit   = revenue - cost                         margin = profit / revenue                 ("Job margin"; "Company margin" is the bridge's company profit / revenue)
profit_before_shared = revenue - labor - material - other
margin_before_shared = profit_before_shared / revenue                                       (a line inside "How we got this": "Before time not on a job")
labor_pct_of_revenue = labor / revenue
cost_per_unit   = cost / units_good               profit_per_unit = profit / units_good
should_cost_per_unit = plan cost for the work done so far / units_good                      (4.10; replaces a typed goal when a plan exists)
cost_to_serve (client, range) = all cost of the client's jobs + client level costs, also per unit and per job
```

Every screen uses two names for a headline margin and no others: **Job margin** and **Company margin**. The job page, the Profit explorer and
the calculator show the job margin; its "How we got this" also gives the margin before time not on a job. A job can sit under target and still
help pay the rent: the calculator uses the margin before time not on a job for the lowest price worth taking, and the job margin for the target price.
Home, Profit and Month close show the company margin beside the job margin.

**Facts.** One SQL view, **`pulse.v_facts`**, is the row level source for every profit number on jobs and clients. It is a `UNION ALL` of stamped rows:
`(org_id, site_id, client_id, job_id, job_type_id, vas_service_id, work_date, kind, amount_cents, units_good, units_scrap, hours, source_table, source_id)`
with `kind` in `revenue_base | revenue_vas | revenue_other | labor | material | other | shared | billed_memo`. `billed_memo` rows are never summed into
revenue; every profit query filters `kind <> 'billed_memo'` through the shared helper `PROFIT_KINDS`. Material rows come from production stamps for
`standard` jobs and from usage rows for `actual` jobs, switched inside the view, so a job never double counts. Rows with no `vas_service_id` roll up
under "Core job work" in the services view so its total equals the company total.

**`pulse.fact_days`** is the same data summed per `(org, work_date, site, client, job, job type, service, kind)`, kept current in the write transaction
for the touched `(job, date)` pairs. Every date range screen reads `fact_days`; drill downs read `v_facts`; a test proves `fact_days` equals the rollup of `v_facts`.

**Company profit bridge.** For an org or site and a date range, read from `pulse.company_days`:

```
work_profit       = sum of PROFIT_KINDS facts (jobs and client level rows)          "Profit on jobs"
shared_gap        = 4.5                                                             "Time not on a job that no job carried"
missing_cost      = sum(missing_cents), or 0 under the full rule (it is in the pool) "Paid time not on any job"
company_costs     = for each calendar month the range touches that has company costs above 0:
                    prorateDays(costs dated in that whole month, first day in range, last day in range, days in the month)
overhead_absorbed = sum(overhead_cents) on production, service and indirect entries, on the days in the range of those same months
overhead_gap      = company_costs - overhead_absorbed when at least one month counted, else 0      "Overhead your hourly rate did not cover"
company_profit    = work_profit - shared_gap - missing_cost - overhead_gap
```

With no company costs entered, Pulse trusts the hourly overhead rate and the last line is hidden. A negative `overhead_gap` reads
"Your hourly rate covered more overhead than you spent" and adds to profit.

**Company costs are monthly, so a part month counts its share by day.** Rent is dated on one day and pays for the whole month. The
bridge never charges a whole month against part of one, and never drops the step because the cost is dated on a day outside the range.
For each calendar month, the share for days `a` to `b` of a month with `N` days is
`prorateDays(C, a, b, N) = divRound(C * b, N) - divRound(C * (a - 1), N)` in `BigInt` cents with the rounding rule of 4.2. The two
running totals telescope, so the parts of a month always add back to the whole month to the cent, and a whole month is `C` itself: a
whole month, and so month close, is unchanged. Each month stands alone: a month with no company costs (or a net credit) counts nothing
and trusts the hourly overhead rate, so a range of whole months equals the sum of its months. The rule lives in one place,
`getCompanyBridge` (through the pure `spreadCompanyCosts`), so Home, Profit, the reports, "How we got this", month close and
`GET /api/v1/company-bridge` agree for any days. When the figure covers part of a month the screen says so in plain words beside the
number: "Company costs for 18 of 30 days." A range across months names each one: "Company costs for 12 of 31 days in October and
18 of 30 days in November." A month in the range with none typed in is named too. The words "after overhead" only show when company
costs were counted: with none, the tile reads "After paid time not on any job".

Worked example (part month). November company costs $70,500.00, range Nov 1 to Nov 18: `divRound(7050000 * 18, 30) = 4230000`
($42,300.00). The hourly rates covered $38,000.00 of overhead on those 18 days, so the overhead gap is $4,300.00. Nov 19 to Nov 30 gets
the other $28,200.00.

Worked example. Profit on jobs $48,210.00. Shared gap $1,150.00. Paid time not on any job $2,360.00. Company costs $21,000.00, overhead absorbed
$16,200.00, so overhead gap $4,800.00. `company_profit = 48210 - 1150 - 2360 - 4800 = $39,900.00`. Home says: "Your jobs made $48,210 this month.
After time not on a job and overhead, the company made $39,900." The bridge is on Home, Profit and the Monthly profit and loss report.
Home never shows job profit as if it were company profit.

### 4.10 Quote, budget and plan vs actual

Each job can hold two plans (`pulse.job_plans`): the **quote** (what was sold: from the calculator, a CRM deal, a WMS contract rate or typed) and
the **budget** (your own cost plan). Most shops have one plan, so the budget does not exist until someone presses "Make my own budget", which copies
the quote. Until then every "budget" in this spec reads the quote. A plan has totals (units, revenue, labor hours, labor cost, setup hours and setup
cost inside labor, material cost, other cost, shared cost) and optional lines. With lines, totals are the sum of lines.

**Plan shared cost.** Unless typed, it is filled when the plan is saved (`shared_auto = true`): under `percent_of_labor`,
`divRound(labor_cents * shared_pct_bp, 10000)`; under the hours rules, `divRound(labor_cents * S90, L90)` where `S90` and `L90` are the org's shared
and labor cents of the last 90 days (0 when `L90 = 0`); under `none`, 0. So the plan and the actual carry the same kind of cost.

**Plan for the work done so far (flexed plan).** `f` is the share of the job that is done:

```
f = units_good / plan_units                      when plan_units > 0
f = actual labor hours / plan labor hours        when plan_units = 0 and plan labor hours > 0      (hourly and no unit jobs)
f = 1 and the column is labeled "Whole job"      when neither exists
flex(x) = divRound(x * f_num, f_den)             for units, revenue, material and shared
flex(labor hours) = setup_hours + (labor_hours - setup_hours) * f           (the same for labor cost with setup_cents)
other cost does not flex: it is compared whole
```

`f` may go above 1 when more units are made than planned. A line can override the default with `flex = true | false`.

One tab, **Plan vs actual**, with a "Compare with: Quote | Budget" switch (the switch is hidden until a budget exists). Rows: **Units, Labor hours,
Units per person per hour, Labor cost, Material cost, Other cost, Time not on a job, Total cost, Revenue, Profit, Margin**. Columns: **Plan, Actual,
Difference, Difference %, Projected at finish**, with a good or bad tone per row. For an open job the Plan column can be switched between
"For the work done so far" (default, so a half done job is judged fairly) and "Whole job". Above the table, three cards explain the words:
"Quote: what you told the client. Budget: what you think it will cost you. Actual: what happened."

```
difference = actual - plan            difference_pct = difference / |plan|, null when plan = 0
cost rows are bad when actual > plan; revenue, profit, units, units per person per hour are bad when actual < plan
```

Quote vs actual adds a per line table when the quote has lines (line, quoted quantity, quoted amount, actual amount matched by category,
labor class, service or item) and, when a budget exists, a "Quote to budget" strip that shows the gap between what was sold and what was planned.

### 4.11 Why profit changed (variance waterfall)

For one job with whole job plan `B`, actual `A` and `P = flex(B)` from 4.10. `R` revenue, `H` labor hours, `L` labor cost, `M` material cost
(scrap included), `S` scrap cost inside `M`, `Sh` shared, `O` other. `rate_p = L_p / H_p` as an exact fraction.

```
volume           = profit(P) - profit(B)                    (only in "Whole job" and "At finish" modes)
price            = R_a - R_p
labor_rate       = -(L_a - H_a * rate_p)
labor_efficiency = -(H_a - H_p) * rate_p
scrap            = -S_a
material         = -((M_a - S_a) - M_p)
shared           = -(Sh_a - Sh_p)
other            = (profit(A) - start) - (price + labor_rate + labor_efficiency + scrap + material + shared)
                   where start = profit(P) in "So far" mode and profit(B) + volume otherwise
```

Each term is rounded to a cent with `divRound`; `other` is the balancing term, so the bars always add up exactly. Edge rules: `H_p = 0` or `H_a = 0`
gives `labor_rate = 0` and `labor_efficiency = -(L_a - L_p)`.

Modes: **So far** (open jobs, default): start at `profit(P)`, no volume bar, end at `profit(A)`. **At finish** (open jobs): `A` is the projection
from 4.13 and `P = flex(B)` with `f = projected units / plan units`. **Whole job** (completed jobs): start at `profit(B)`, volume bar, end at `profit(A)`.

Worked example, So far. Budget: 10,000 units, revenue $17,500.00, 250 hours, labor $5,500.00, material $4,500.00, shared $500.00, other $1,000.00,
profit $6,000.00. Actual so far: 4,000 units, revenue $7,000.00, 125 hours, labor $2,875.00, material $1,900.00 of which scrap $90.00, shared $260.00,
other $400.00, profit $1,565.00. `f = 0.4`. `P`: revenue $7,000.00, 100 hours, labor $2,200.00, material $1,800.00, shared $200.00, other $1,000.00
(not flexed), profit $1,800.00. `rate_p = $22.00`.

| Bar | Math | Amount |
|---|---|---|
| Price | 7000 - 7000 | $0.00 |
| Labor rate | -(2875 - 125 x 22) | -$125.00 |
| Labor efficiency | -(125 - 100) x 22 | -$550.00 |
| Scrap | -90 | -$90.00 |
| Material | -((1900 - 90) - 1800) | -$10.00 |
| Time not on a job | -(260 - 200) | -$60.00 |
| Other | (1565 - 1800) - (-835) | +$600.00 |
| **Total** | 1565 - 1800 | **-$235.00** |

Each bar has a one line plain reading, for example "Labor efficiency: the crew needed 25 more hours than planned for this many units. That cost $550."

**Groups.** For a client, job type, site or month the bars are computed per job and then summed. Units of different jobs are never added into one `f`.
For a month, a job's plan is its plan flexed to the units made in that month and its actual is that month's facts.

### 4.12 Pace and productivity

```
pace hours of a row     = hours - setup_hours, on production rows with hours_confirmed = true and source <> 'projects'
counted day (job, date) = a day whose pace hours sum is > 0 and that has no row with units and hours_confirmed = false
evidence day            = a counted day with units_good > 0
UPH (job, range)        = sum(units_good on counted days) / sum(pace hours on counted days)
productivity            = UPH / target pace           earned_hours = units_good / target pace
labor_cost_per_unit     = labor / units_good
```

Projects time and unconfirmed warehouse rows still cost money where they have hours. They only stay out of pace, so UPH is never infinite or crushed.

**Target pace for a job on a date**: `job.standard_uph`; else the best row in `pulse.standards` with `effective_from <= date`; else budget units /
(budget labor hours - setup hours); else none. "Best row": candidates match the job's type, and have a client equal to the job's client or no client,
and a labor class equal to the job's default class or no class. Order by: client match first, then labor class match first, then latest
`effective_from`, then latest `created_at`, then smaller `id`. Service rows match on the service the same way.

**Target margin for a job**: `job.target_margin_bp`, else the job type's, else the client's, else `settings.default_target_margin_bp` (3000).

### 4.13 Projected finish

A job is judged in one of three modes:
- **Projected**: status `active`, kind `one_time`, and `planned_units > 0` or plan labor hours > 0.
- **Actuals**: active jobs of kind `ongoing` (monthly programs, standing rework) and active jobs with no planned units and no plan hours.
  No projection. Every "projected" number below is replaced by the actual of the last 30 days.
- **Final**: completed jobs. Actual totals of the whole job.

Projected mode, unit based (`planned_units > 0`):

```
units_left   = max(0, planned_units - units_good)
pct_complete = units_good / planned_units                    (shown capped at 100%)
actual_pace  = UPH over the last 5 evidence days, else none
plan_pace    = target pace (4.12), else none
w            = min(1, max(pct_complete / 0.20, evidence_days / 3))          (evidence_days counted over the whole job)
pace_uph     = plan_pace * (1 - w) + actual_pace * w         both known
             = actual_pace                                    no plan pace
             = plan_pace                                      no evidence day yet
             = unknown                                        neither
confidence   = "Early guess" when w < 0.5, "Good read" when 0.5 <= w < 1, "Solid" when w = 1; "Based on the plan" with no evidence day
hours_left   = units_left / pace_uph                                         (2 decimals)
rate_left    = labor cost / hours over the last 5 evidence days; else L_a / H_a; else budget labor cost / budget hours;
               else today's regular rate of the job's labor class; else the org default rate
labor_left   = hours_left * rate_left
shared_left  = hours_left * (Sh_a / H_a), or flex of plan shared for the units left when H_a = 0
material_left (standard, or actual with no planned quantities) = units_left * (M_a / units_good),
               else units_left * budget material per unit, else units_left * job material_cost_per_unit
material_left (actual with planned quantities) = sum over our own usage rows of max(0, quantity_planned - quantity_used - quantity_scrapped) * unit_cost
other_left   = max(0, O_budget - O_actual)
service_left = units_left * (service revenue so far / units_good) as revenue, and the same for service cost     (0 when units_good = 0)
cost_at_finish    = cost_so_far + labor_left + shared_left + material_left + other_left + service cost left
revenue_at_finish = per_unit: revenue_so_far + units_left * current unit_price + service revenue left
                    fixed:    fixed_price + service and other revenue so far + service revenue left
                    hourly:   revenue_so_far + hours_left * bill_rate + service revenue left
projected_profit  = revenue_at_finish - cost_at_finish
projected_margin  = projected_profit / revenue_at_finish, null when revenue_at_finish <= 0
projected_labor_hours = H_a + hours_left
units_per_day     = pace_uph * (pace hours over the last 5 evidence days / that number of days); unknown when there is no evidence day
projected_finish_date = today + ceil(units_left / units_per_day) work days (settings.working_days); today when units_left = 0; unknown when units_per_day is unknown or 0
```

Hour based (`planned_units = 0`, plan labor hours > 0): `hours_left = max(0, plan hours - H_a)`, `pct_complete = H_a / plan hours`, `w` uses that
percent, labor, shared and other as above, material left 0, revenue as above, no finish date from pace.

**Unknown cost is never zero cost.** `cost_known` is false when the job has no cost plan (none, or only units and revenue) and pace is unknown,
or when hours are still to work and there is no cost of an hour (`rate_left` unknown). Then `projected_margin` is null, and the stored
`projected_profit` and `cost_at_finish` are null ("not known yet" on screen). Material left only uses plan material per unit when the plan has
costs. Rule D4 (4.14) says so in words.

When pace is unknown the projection equals the budget. A job past its planned units has `units_left = 0`, so the projection is what happened so far,
and rule W8 says so. The job page says in words what was assumed, with the confidence word: "Early guess. We assume the rest of the job runs at
35 units per person per hour, a blend of your plan (40) and your first day (25)."

Worked example (the job from 4.11, price $1.75 a unit, 5 evidence days). Last 5 evidence days: 1,600 units in 50.00 pace hours, labor $1,150.00.
`units_left = 6000`, `pct_complete = 40%`, `w = min(1, max(2, 1.67)) = 1` ("Solid"), `pace_uph = 32.000`, `hours_left = 187.50`, `rate_left = $23.00`.
`labor_left = $4,312.50`. `shared_left = 187.5 x 260 / 125 = $390.00`. `material_left = 6000 x 1900 / 4000 = $2,850.00`. `other_left = 1000 - 400 = $600.00`.
`cost_at_finish = 5435 + 4312.50 + 390 + 2850 + 600 = $13,587.50`. `revenue_at_finish = 7000 + 6000 x 1.75 = $17,500.00`.
`projected_profit = $3,912.50`, `projected_margin = 2236 bp` (22.36%), `projected_labor_hours = 312.50`.
`units_per_day = 32 x (50 / 5) = 320`, `ceil(6000 / 320) = 19` work days: from Tuesday 2026-11-17 with a Monday to Friday week that is 2026-12-14.

Blend example. Day one of a job: 600 units in 24.00 pace hours (25.000 UPH), plan pace 40, 6% complete, 1 evidence day.
`w = max(0.06 / 0.20, 1 / 3) = 0.3333`, `pace_uph = 40 x 0.6667 + 25 x 0.3333 = 35.000`, "Early guess".

### 4.14 Risk status (exact rules)

Thresholds live in `pulse.settings` and are editable. `pm` is `projected_margin` (in Actuals mode, the margin of the last 30 days; in Final mode, the
actual margin). `target` is the job's target margin. Planned, on hold and cancelled jobs have no status. Rules are grouped; the first group with a
matching rule sets the status. R1, R2 and W1 are skipped when `pm` is null (revenue at finish is 0 or less) and L1 decides.

| Status | Rule (any one) | Words (money variant shown; each rule also has a no money variant) |
|---|---|---|
| **Losing money** (`losing`) | L1 Projected mode, `projected_profit < 0`, and `evidence_days >= 2` or `pct_complete >= 20%` | "At this pace the job ends about $1,840 in the red. By the finish, each unit costs $3.12 to make and sells for $2.75." (cost and price per unit at finish; the job card's "Cost for one unit so far" is a different number and says so) |
| | L2 Final mode and `profit < 0` | "This job lost $620. Labor ran 31% over the budget." |
| | L3 Actuals mode, profit of the last 30 days `< 0`, with entries on 5 or more days | "This work lost $410 in the last 30 days." |
| **At risk** (`at_risk`) | R1 `pm < target - at_risk_gap_bp` (default 10 points) | "Margin is heading for 14%. Your target is 30%." |
| | R2 `pm < margin_floor_bp` (default 10%) | "Margin is heading for 6%, under your 10% floor." |
| | R3 plan hours > 0, `projected_labor_hours > plan hours x (1 + labor_risk_over_bp)` (15%), and `pm < target` or `pm` null | "Labor is heading 25% over the plan." |
| | R4 `evidence_days >= 2`, UPH of the last 5 evidence days `< productivity_risk_bp` (80%) of target pace, and `pm < target` or `pm` null | "In the last 5 work days the crew made 31 units per person per hour. The target pace is 42." (the window is named, so it is never mistaken for the whole job pace on the Pace card) |
| | R5 `projected_finish_date > due_date` | "At this pace the job finishes Dec 9. It is due Dec 2." |
| | R6 linked WMS work order is in Shortage | "The warehouse is short on parts for this job." |
| **Not enough data** (`no_data`) | D1 one or more days have units and no confirmed hours | "3 days have units and no hours. Profit is not complete yet." |
| | D2 no price (per unit with no unit price, fixed with no fixed price, hourly with no bill rate) | "This job has no price yet, so Pulse cannot work out profit." |
| | D3 hours with no rate (`needs_rate`), or Projected mode with hours still to work and no cost of an hour anywhere (4.13 `cost_known = false`) on a job that has a cost plan | "Some hours have no labor rate, so their cost is missing." |
| | D4 Projected mode, no cost plan (no quote and no budget, or a plan with only units and revenue, such as the quick add row saves from a price), and Pulse cannot price the work still to do (`cost_known = false`: no target pace and no evidence day, or hours left with no cost of an hour). Next step "Add a quote or a budget" | "No plan yet, so Pulse cannot tell if this job will make money." No money: "No plan yet, so Pulse cannot tell how this job will go." |
| **Heads up** (`heads_up`) | W1 `pm < target` | "Margin is heading for 26%, a little under your 30% target." |
| | W2 projected labor hours over plan by `labor_watch_over_bp` (5%) or more, when R3 did not fire | "Labor is heading 8% over the plan." |
| | W3 UPH of the last 5 evidence days under `productivity_watch_bp` (95%) of target pace, when R4 did not fire | "In the last 5 work days the crew was a bit under the target pace: 39 of 42 units per person per hour." |
| | W4 material cost per good unit > plan material per unit x (1 + `material_watch_over_bp`, 5%) | "Materials cost $1.42 a unit. The plan was $1.30." |
| | W5 no production entry on the last `no_entry_days` (3) work days that are fully past in the site time zone, counted from the later of the start date and the day the job became active | "Nothing has been logged for 4 work days." |
| | W6 due in 3 work days or less and under 90% done | "Due Friday and 72% done." |
| | W7 no cost plan (no quote and no budget, or a plan with only units and revenue), when D4 did not fire: Pulse can project from logged days but has nothing to compare with | "This job has no plan, so Pulse cannot compare it with anything." With a price only plan: "This job has a price but no cost plan, so Pulse cannot compare it with anything." |
| | W8 `units_good > planned_units > 0` | "This job is past its planned units. Update the plan or finish the job." |
| **On track** (`on_track`) | none of the above | "On track. Margin is heading for 34% against a 30% target." |

Losing money and At risk win over Not enough data, because missing hours can only make the real number worse. A job with a D rule never shows On track
or Heads up, and never appears in "best jobs" rankings or the wall "Nice work" panel. Every profit DTO for such a job carries `laborMissing: true` and
the UI marks the number "Not complete yet". D4 and W7 never fire together: D4 is for a job Pulse cannot price at all, W7 for one it can price from
what happened but cannot compare with a plan.

In Actuals mode R3, R5, W2 and W6 apply only when the job has a monthly plan (plan totals are read as "per month" for `ongoing` jobs and compared with
the last 30 days).

Every matching rule yields a reason `{ rule, params, impactCents, nextStep }`. Impact (how much it moves projected profit, 0 or less):
L1, L2, L3: the loss itself. R1, R2, W1: `projected_profit - divRound(threshold_bp * revenue_at_finish, 10000)`. R3, W2:
`-(labor cost at finish - plan labor cost)`. R4, W3: `-(pace hours of the window - units of the window / target pace) x rate_left`.
W4: `-(actual - plan material per unit) x planned_units`. All others 0. The reason with the most negative impact is the headline (ties: rule order
as listed); up to three show on the job. Each rule carries a **next step** key ("Check the crew size", "Review the price with the client",
"Log the missing days", "Add a labor rate", "Add the hours").

Worked example (the job from 4.13, target 30%): `pm = 2236`. R1: `2236 < 2000` no. R2 no. R3: `312.50 > 250 x 1.15 = 287.50` and `2236 < 3000`: **At risk**.
W1 also matches. Impacts: R3 `-(2875 + 4312.50 - 5500) = -$1,687.50`; W1 `3912.50 - 0.30 x 17500 = -$1,337.50`. Headline: "Labor is heading 25% over the plan."

### 4.15 Explain this number

Every money figure, margin and status in the UI has a "How we got this" popover fed by `explain(metric, scope)`: the formula in words, the
same formula with the real figures, a link to the rows behind it, and a **data quality line** whenever the number is partial ("2 days have no hours",
"Uses the default rate", "Early guess"). A number with no warning line is complete. Example for a manager: "Labor cost $4,212.00 = 162.0 labor hours x $26.00
an hour. See 14 entries." Only readers with `wage:read` get the next line: "$26.00 = $19.50 wage + 21% taxes and benefits + $2.40 overhead."

### 4.16 Month close

`pulse.periods` holds one row per calendar month. Closing a month (admin) checks Things to fix and the payroll check, stores a snapshot of totals, and
locks every stream row dated in that month: edits, deletes, imports, sync writes and restamps that would touch it are refused with
"October 2026 is closed. Ask the owner to reopen it." Reopen needs a reason and is logged. Reports mark closed months with a lock. Week based reports follow
`settings.week_start`. Sync and cron treat "closed month" as a counted skip listed under "Came in after the month was closed", never as an error.

The close screen and the month list show what the company kept, never job profit alone. The month card reads: Revenue, Job cost, Job profit
with the job margin, then the bridge steps of 4.9 (time not on a job that no job carried, paid time not on any job, overhead the hourly rate did
not cover), then Company profit with the company margin. Each month in the list shows company profit and company margin. The snapshot stored
with the close holds the totals, the whole bridge and `company: { jobProfitCents, jobMarginBp, companyProfitCents, companyMarginBp }`, and a
closed month shows those saved figures. A reader without `money:read` gets the checklist and the lock counts with every figure null.

### 4.17 What gets restamped, and when

Stamps change only through the cases below. Each runs as set based SQL in the transaction of the change, touches **open months only**, and ends with
shared allocation for the touched pools and `recomputeJobs`. The domain layer filters closed months first, because the database trigger refuses any
write there, stamp only updates included.

| Change | Rows restamped | Closed month rule |
|---|---|---|
| Entry inserted, edited or deleted (units, hours, overtime, setup, class, site, date) | that entry; its shared pool (old and new pool on a move); for a fixed price job every open entry of the job and the true up | the entry itself must be in an open month |
| Rate row added, edited or deleted | all entries of that class (and site) dated from the row's `effective_from` to the day before the next row | an `effective_from` inside a closed month is refused; frozen stamps stay |
| `settings.default_loaded_rate_cents`, default overtime multiplier | open entries that use the default rate or have `needs_rate` | frozen |
| Job price row added or edited (`pulse.job_prices`: unit price, bill rate, material cost per unit, each with `effective_from`) | open production entries of the job dated on or after `effective_from`: base revenue and standard material | `effective_from` is moved up to the first open day, and the dialog says so |
| `planned_units` or `fixed_price_cents` of a fixed job | every open entry of the job and the true up | the catch up lands in the first open entry or the true up |
| `pricing_model` or `material_method` switched | every open entry of the job | closed months keep the old method's stamps; the job page notes the switch date |
| Parts owner changed on a client, job or item | open usage rows that inherit it | frozen |
| Shared cost rule, percent or spread period | every open pool of the org | frozen |
| Entry soft deleted and restored (undo) | same as insert | same |

A price change dialog always asks "From which day?" (default: today) and shows the preview from 4.3. Big restamps (a rate change over 50,000
entries, an import commit) run as one statement per table with a stated ceiling of 250,000 rows per transaction; above 5,000 rows the work runs in
`after()` on a route with `maxDuration = 300`, and affected screens show "Recalculating" from `settings.recalc_started_at` until it clears.

### 4.18 Rollups and speed

`recomputeJobs(ctx, jobIds[])` is one `INSERT ... SELECT ... GROUP BY job_id ... ON CONFLICT (job_id) DO UPDATE` for totals, then the projection and
rules in TypeScript for those jobs (pure functions in `src/lib/calc/*`), then one batched update. In the same transaction it refreshes
`fact_days` and `company_days` for the touched dates. The cron tick runs the date based rules (W5, W6, R5) once per site per local day.
Trend lines, prior period compare and sparklines come from one grouped query with `generate_series`, never one query per row.
Targets: 500 jobs, 3 years, 300,000 fact rows; Profit explorer under 500 ms; a log grid save under 150 ms.
`src/lib/calc/*` holds every formula in this section as pure functions, and every worked example above is a unit test with these exact numbers.

## 5. Data model (`pulse` schema)

House rules:
- uuid PK `gen_random_uuid()`; `org_id uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE` on every table and in every query;
  `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`; enums are `text` + CHECK mirrored in Drizzle.
- Hand-written SQL in `apps/pulse/drizzle/0000_pulse_init.sql` with `--> statement-breakpoint`, mirrored for types in `src/server/db/schema/*.ts`. Never `drizzle-kit push`.
- **No cross org pointers.** Every table has `UNIQUE (org_id, id)`, and every FK from one `pulse` table to another is the composite
  `(org_id, <x>_id) REFERENCES pulse.<parent>(org_id, id)`, so a row can never point at another org's parent. `ON DELETE`: RESTRICT from
  stream rows to jobs, clients, sites, labor classes, services and items (those parents are soft deleted, never hard deleted, outside purge);
  CASCADE from a job to its plans, prices, links and stats, from a plan to its lines, from a batch to its rows. Every user column
  (`*_by`, `owner_id`, `assigned_to`, `user_id`) references `core."user"(id) ON DELETE SET NULL` (`member_roles`, `user_prefs` and `notifications` cascade).
- RLS is enabled on every table with no policies. The database role each app uses in production must own the tables or have `BYPASSRLS`
  (local dev passes only because `postgres` is a superuser). `docs/DEPLOYMENT.md` gets this check, and a test connects as a plain role to prove
  both the app role and the sibling roles (for `bridge_events`) work.
- **SD** = soft delete (`deleted_at timestamptz`); "live" means `deleted_at IS NULL`. **V** = `version int NOT NULL DEFAULT 1`, bumped on every
  update; an autosave or edit sends the version it read and gets "Someone else changed this row. Here is the new one." on a mismatch.
- **STREAM** columns: `source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv','wms','crm','projects','punch','system','sample'))`,
  `source_ref text` (stable key in the source system), `import_batch_id uuid`, `is_sample boolean NOT NULL DEFAULT false`, `created_by`, `updated_by`,
  `meta jsonb` (`locked_fields` for user edits on synced rows), and a partial unique index `(org_id, source, source_ref) WHERE source_ref IS NOT NULL AND deleted_at IS NULL`,
  so every sync and re-import is an upsert, never a duplicate. Every STREAM table is also SD.

| Flags | Tables |
|---|---|
| SD + STREAM + V, dated, locked by month close | `production_entries`, `indirect_entries`, `paid_hours`, `time_punches`, `material_usage`, `cost_entries`, `revenue_entries`, `vas_entries` |
| SD + STREAM + V | `clients`, `jobs`, `labor_rates`, `items`, `vas_services`, `standards`, `targets` |
| SD | `sites`, `job_types`, `labor_classes`, `alert_rules`, `saved_views`, `quote_scenarios`, `report_schedules`, `device_links` |
| plain | everything else |

**Triggers** (exact behavior, each with a test):
- `pulse.activity` is append only: `BEFORE UPDATE` raises. `DELETE` is allowed (org cascade, seed wipe, purge and retention need it), as in `pm.activity`.
- Closed month lock: `BEFORE INSERT OR UPDATE OR DELETE` on the eight dated stream tables. It raises `month_closed` when `pulse.periods` has a closed row
  for the month of the `NEW` date or of the `OLD` date (both are checked on UPDATE). It lets the statement through when
  `current_setting('pulse.allow_purge', true) = 'on'` (set with `SET LOCAL` only by `data:purge`, "Clear sample data" and the seed wipe) or when the
  org row is already gone (`NOT EXISTS (SELECT 1 FROM core.organization WHERE id = OLD.org_id)`, the org cascade case). Org deletion is tested end to end.

### 5.1 Setup tables

**`pulse.settings`** (PK `org_id`, created lazily on first read): `currency text DEFAULT 'USD'`, `timezone text DEFAULT 'America/Chicago'` (only a
fallback for the first site), `week_start smallint DEFAULT 1 CHECK (0..6)`, `fiscal_year_start_month smallint DEFAULT 1`,
`working_days smallint[] DEFAULT '{1,2,3,4,5}'`, `default_shift_hours numeric(4,2) DEFAULT 8`, `default_payroll_tax_bp int DEFAULT 900`,
`default_benefits_bp int DEFAULT 1200`, `default_other_burden_bp int DEFAULT 0`, `default_overhead_per_hour_cents int DEFAULT 0`,
`default_overtime_multiplier numeric(3,2) DEFAULT 1.50`, `default_loaded_rate_cents int`, `default_target_margin_bp int DEFAULT 3000`,
`margin_floor_bp int DEFAULT 1000`, `at_risk_gap_bp int DEFAULT 1000`, `labor_watch_over_bp int DEFAULT 500`, `labor_risk_over_bp int DEFAULT 1500`,
`productivity_watch_bp int DEFAULT 9500`, `productivity_risk_bp int DEFAULT 8000`, `material_watch_over_bp int DEFAULT 500`,
`no_entry_days smallint DEFAULT 3`, `unbilled_alert_cents bigint DEFAULT 500000`, `unbilled_alert_days smallint DEFAULT 14`,
`shared_cost_rule text DEFAULT 'by_labor_hours' CHECK (IN ('none','by_labor_hours','full','percent_of_labor'))`, `shared_pct_bp int DEFAULT 0`,
`shared_spread text DEFAULT 'week' CHECK (IN ('day','week','month'))`, `default_parts_owner text DEFAULT 'us' CHECK (IN ('us','client'))`,
`default_member_role text DEFAULT 'none' CHECK (IN ('manager','supervisor','viewer','none'))`, `job_number_prefix text DEFAULT 'J-'`,
`job_seq int DEFAULT 1000`, `date_order text DEFAULT 'MDY' CHECK (IN ('MDY','DMY'))`, `wms_auto_create_jobs boolean DEFAULT true`,
`wms_sync_materials boolean DEFAULT true`, `wms_sync_vas boolean DEFAULT true`, `wms_sync_billing boolean DEFAULT true`,
`wms_billing_ops_in_profit text[] DEFAULT '{}'`, `crm_suggest_jobs boolean DEFAULT true`, `projects_time_import boolean DEFAULT true`,
`recalc_started_at timestamptz`, `onboarding jsonb DEFAULT '{}'`, `sample_loaded_at timestamptz`.

**`pulse.member_roles`**: `user_id uuid NOT NULL`, `role text CHECK (IN ('owner','admin','manager','supervisor','viewer','none'))`,
`sees_money boolean NOT NULL DEFAULT false`, `kiosk_pin_hash text`, `updated_by`. Unique `(org_id, user_id)`.

**`pulse.sites`** (SD): `code text`, `name text`, `timezone text NOT NULL`, `is_default boolean`, `wms_warehouse_id text`, `last_rollover_date date`,
`archived_at`. Unique live `(org_id, lower(code))`; unique `(org_id, wms_warehouse_id) WHERE wms_warehouse_id IS NOT NULL`. One default site
("Main site") is created with the org, so single site shops never see the word site. On the first WMS sync the default site adopts the default
warehouse (name, code, time zone) and every other warehouse becomes a new site.

**`pulse.clients`** (SD, STREAM, V): `code text NOT NULL`, `name text NOT NULL`, `status text DEFAULT 'active' CHECK (IN ('active','inactive'))`,
`contact_name`, `contact_email`, `phone`, `target_margin_bp int`, `payment_terms_days int`, `parts_owner text CHECK (IN ('us','client'))` (null = org default),
`notes text`, `color text`, `core_customer_id uuid REFERENCES core.customers(id) ON DELETE SET NULL`, `crm_account_item_id uuid` (no FK, CRM may be absent).
Unique live: `(org_id, lower(code))`, `(org_id, core_customer_id)`, `(org_id, crm_account_item_id)`. Index `(org_id, lower(name))`.
A client can be found three ways, and every deep link and bridge call accepts all three: `pulse.clients.id`, `core.customers.id` (equal to
`wms.clients.id`), or the CRM account item id. Pulse never creates `core.customers` rows.

**`pulse.job_types`** (SD): `code`, `name`, `unit_label text DEFAULT 'units'`, `default_pricing_model`, `default_labor_class_id`,
`default_standard_uph numeric(12,3)`, `target_margin_bp int`, `color text`, `icon text`, `position int`, `is_builtin boolean`, `archived_at`.
Unique live `(org_id, lower(code))`. A built in type "General" (`GENERAL`) is created with the org so a quick add never needs a type.

**`pulse.labor_classes`** (SD): `code`, `name`, `kind text DEFAULT 'employee' CHECK (IN ('employee','temp_agency'))`, `is_default boolean`,
`color`, `archived_at`. Unique live `(org_id, lower(code))`; at most one live default per org.

**`pulse.labor_rates`** (SD, STREAM, V): `labor_class_id uuid NOT NULL`, `site_id uuid` (null = all sites), `effective_from date NOT NULL`,
`wage_cents int NOT NULL CHECK (>= 0)`, `payroll_tax_bp int NOT NULL`, `benefits_bp int NOT NULL`, `other_burden_bp int NOT NULL`,
`overhead_per_hour_cents int NOT NULL`, `overtime_multiplier numeric(3,2) NOT NULL`, `loaded_rate_cents int NOT NULL`, `overtime_rate_cents int NOT NULL`,
`bill_rate_cents int`, `note text`. Unique live `(org_id, labor_class_id, coalesce(site_id, zero uuid), effective_from)`. Index `(org_id, labor_class_id, effective_from DESC)`.

**`pulse.items`** (SD, STREAM, V): material catalog. `sku`, `name`, `uom text DEFAULT 'each'`, `unit_cost numeric(14,4)`, `cost_updated_at`,
`supplied_by text CHECK (IN ('us','client'))` (null = inherit), `client_id uuid`, `core_item_id uuid`, `wms_product_id text`.
Unique live `(org_id, lower(sku))`; unique where not null `(org_id, wms_product_id)`, `(org_id, core_item_id)`.

**`pulse.vas_services`** (SD, STREAM, V): `code`, `name`, `unit_label text DEFAULT 'units'`, `billing text CHECK (IN ('per_unit','per_hour','flat'))`,
`default_price numeric(14,4)`, `default_cost_per_unit numeric(14,4)`, `standard_uph numeric(12,3)`, `default_labor_class_id`,
`wms_vas_type_id text`, `color`, `active boolean DEFAULT true`. Unique live `(org_id, lower(code))`; unique where not null `(org_id, wms_vas_type_id)`.

**`pulse.standards`** (SD, STREAM, V): target pace rows. `job_type_id uuid`, `client_id uuid`, `vas_service_id uuid`, `labor_class_id uuid`,
`units_per_labor_hour numeric(12,3) NOT NULL CHECK (> 0)`, `effective_from date NOT NULL`, `basis text CHECK (IN ('typed','history','time_study'))`,
`note`. CHECK exactly one of job type or service is set. Index `(org_id, job_type_id, client_id, effective_from DESC)`.

**`pulse.targets`** (SD, STREAM, V): goals. `scope text CHECK (IN ('org','site','client','job_type','vas_service'))`, `scope_id uuid`, `metric text CHECK (IN
('margin_pct','profit','revenue','units_per_labor_hour','labor_pct_of_revenue','cost_per_unit','utilization_pct'))`, `period_month date`
(first of month, null = every month), `value numeric(16,4) NOT NULL`. Unique live `(org_id, scope, coalesce(scope_id, zero uuid), metric, coalesce(period_month, '0001-01-01'))`.

### 5.2 Jobs and plans

**`pulse.jobs`** (SD, STREAM, V): `number text NOT NULL`, `name text NOT NULL`, `client_id uuid NOT NULL`, `job_type_id uuid NOT NULL`,
`site_id uuid NOT NULL`, `kind text DEFAULT 'one_time' CHECK (IN ('one_time','ongoing'))`, `status text DEFAULT 'planned' CHECK (IN
('planned','active','on_hold','completed','cancelled'))`, `pricing_model text DEFAULT 'per_unit' CHECK (IN ('per_unit','fixed','hourly'))`,
`unit_label text DEFAULT 'units'`, `planned_units numeric(14,3) DEFAULT 0`, `unit_price numeric(14,4)`, `fixed_price_cents bigint`, `bill_rate_cents int`,
`material_method text DEFAULT 'standard' CHECK (IN ('standard','actual'))`, `material_cost_per_unit numeric(14,4) DEFAULT 0`,
`parts_owner text CHECK (IN ('us','client'))` (null = inherit), `default_labor_class_id uuid`, `usual_crew jsonb` (`[{laborClassId, headcount}]`),
`standard_uph numeric(12,3)`, `target_margin_bp int`, `start_date date`, `due_date date`, `completed_date date`, `po_number text`, `owner_id uuid`,
`description text`, `kit_sku text`, `kit_name text`, `wms_shortage boolean DEFAULT false`, `pinned_note text`, `archived_at`.
`unit_price`, `bill_rate_cents` and `material_cost_per_unit` mirror the newest `job_prices` row.
Unique live `(org_id, lower(number))`. Indexes `(org_id, status)`, `(org_id, client_id)`, `(org_id, job_type_id)`, `(org_id, site_id)`, `(org_id, owner_id)`, `(org_id, due_date)`.
- **Numbers.** Auto numbers come from one `UPDATE pulse.settings SET job_seq = job_seq + 1 ... RETURNING job_seq` inside the insert transaction, repeated
  while `prefix || seq` is already taken by an imported or WMS coded job (`WO000088`).
- **URLs.** `/jobs/[ref]`: if `ref` matches the uuid pattern and a job with that id exists, use it; else look up `lower(number) = lower(ref)`.
- **Search.** No extension. Search is `number` prefix through the unique index plus a case blind contains match on `name` over the org's live jobs
  (bounded by `(org_id, status)`; 5,000 jobs scan in under 20 ms). `pg_trgm` is not used.

**`pulse.job_prices`**: dated prices, so a mid job change is never retroactive by accident. `job_id uuid NOT NULL`, `effective_from date NOT NULL`,
`unit_price numeric(14,4)`, `bill_rate_cents int`, `material_cost_per_unit numeric(14,4) NOT NULL DEFAULT 0`, `note`, `created_by`. Unique `(job_id, effective_from)`.
The first row of a job has `effective_from = '0001-01-01'`. The price for an entry is the row with the latest `effective_from <= work_date`.

**`pulse.job_plans`**: `job_id uuid NOT NULL`, `plan text NOT NULL CHECK (IN ('quote','budget'))`, `units numeric(14,3)`, `revenue_cents bigint`,
`labor_hours numeric(10,2)`, `labor_cents bigint`, `setup_hours numeric(10,2) DEFAULT 0`, `setup_cents bigint DEFAULT 0`, `material_cents bigint`,
`other_cents bigint`, `shared_cents bigint DEFAULT 0`, `shared_auto boolean DEFAULT true`, `version int DEFAULT 1`,
`origin text CHECK (IN ('typed','csv','calculator','crm_deal','wms_contract','copied_from_quote','sample'))`, `origin_ref text`, `note`, `locked_at`, `updated_by`.
Unique `(job_id, plan)`. Every change writes the old and new totals to `pulse.activity` (`plan.revised`), which is the revision history.
For `ongoing` jobs the totals mean "per month".

**`pulse.job_plan_lines`**: `plan_id uuid NOT NULL`, `job_id`, `position int`, `category text CHECK (IN ('revenue','labor','setup','material','other'))`,
`description text`, `quantity numeric(14,3)`, `unit text CHECK (IN ('unit','hour','each','flat'))`, `unit_amount numeric(14,4)`, `amount_cents bigint NOT NULL`,
`flex boolean` (null = default for the category), `labor_class_id`, `vas_service_id`, `item_id`. Plan totals: units = sum of quantity on revenue lines
with unit `unit`; labor hours = sum of quantity on labor and setup lines.

**`pulse.job_links`**: `job_id uuid NOT NULL`, `target_type text CHECK (IN ('crm_deal','crm_account','wms_work_order','wms_shipment_order',
'wms_client','pm_project','pm_task'))`, `target_id text NOT NULL`, `imports_time boolean NOT NULL DEFAULT false`, `cached_title`, `cached_status`,
`cached_url text` (a path that starts with one `/`, never `//` or a scheme; the host is added at read time), `cached_at`, `meta jsonb`, `created_by`.
Unique `(job_id, target_type, target_id)`; partial unique `(org_id, target_id) WHERE target_type = 'wms_work_order'` (one job per work order);
partial unique `(org_id, target_id) WHERE target_type = 'pm_project' AND imports_time` (one job imports a project's time). Index `(org_id, target_type, target_id)`.
A CRM deal may have several jobs; the wizard warns "This deal already has job J-1042."

**`pulse.job_stats`** (PK `job_id`): cached rollup, rebuilt by `recomputeJobs`. `units_good`, `units_scrap`, `units_rework`, `hours`, `overtime_hours`,
`pace_hours`, `evidence_days int`, `revenue_cents`, `base_revenue_cents`, `vas_revenue_cents`, `other_revenue_cents`, `billed_cents`, `labor_cents`,
`material_cents`, `scrap_cents`, `other_cents`, `shared_cents`, `cost_cents`, `profit_cents`, `margin_bp`, `margin_before_shared_bp`, `uph numeric(12,3)`,
`standard_uph`, `productivity_bp`, `pct_complete_bp`, `mode text CHECK (IN ('projected','actuals','final'))`, `cost_at_finish_cents`,
`revenue_at_finish_cents`, `projected_profit_cents`, `projected_margin_bp`, `projected_labor_hours`, `projected_finish_date`, `pace_uph`,
`pace_weight_bp int` (the `w` of 4.13), `confidence text CHECK (IN ('plan','early','good','solid'))`,
`risk_status text CHECK (IN ('on_track','heads_up','at_risk','losing','no_data'))`, `risk_reasons jsonb` (`[{rule, params, impactCents, nextStep}]`,
numbers and ids only, never rendered words), `needs jsonb` (Things to fix flags, including `laborMissing`), `first_entry_date`, `last_entry_date`,
`entry_count int`, `computed_at`. Index `(org_id, risk_status)`. A test proves it equals the sum over `v_facts`.

### 5.3 Data streams (dated, every row carries `site_id`, closed months refuse writes)

All quantity, hour and headcount columns have `CHECK (>= 0)`.

**`pulse.production_entries`**: the daily entry. `job_id uuid NOT NULL`, `work_date date NOT NULL`, `shift text NOT NULL DEFAULT 'day'`,
`labor_class_id uuid`, `units_good numeric(14,3) NOT NULL DEFAULT 0`, `units_scrap numeric(14,3) NOT NULL DEFAULT 0`,
`units_rework numeric(14,3) NOT NULL DEFAULT 0`, `headcount numeric(6,2)`, `hours numeric(10,2) NOT NULL DEFAULT 0`,
`overtime_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (overtime_hours <= hours)`, `setup_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (setup_hours <= hours)`,
`hours_confirmed boolean NOT NULL DEFAULT true` (false for warehouse rows that still need crew hours), `note text`,
stamps: `rate_cents int`, `overtime_rate_cents int`, `labor_cost_cents bigint DEFAULT 0`, `overhead_cents bigint DEFAULT 0`, `gross_pay_cents bigint DEFAULT 0`,
`shared_cents bigint DEFAULT 0`, `base_revenue_cents bigint DEFAULT 0`, `std_material_cents bigint DEFAULT 0`, `std_scrap_cents bigint DEFAULT 0`,
`needs_rate boolean DEFAULT false`, `entered_by uuid`.
Unique live `(org_id, job_id, work_date, shift, coalesce(labor_class_id, zero uuid))`: **one row per job, day, shift and labor class**. A mixed crew
(8 packers, 3 temps, 1 lead) is three rows that share the job, day and shift; units are typed once and stored on the first row. There is no free text crew.
Indexes `(org_id, work_date)`, `(org_id, job_id, work_date)`, `(org_id, site_id, work_date)`.
Extra services are never logged here: they have their own table, so there is one way to log a service.

**`pulse.indirect_entries`**: `work_date`, `labor_class_id`, `reason text CHECK (IN ('meeting','training','cleanup','waiting','maintenance','break','other'))`,
`headcount`, `hours numeric(10,2) NOT NULL`, `overtime_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (overtime_hours <= hours)`, `note`,
stamps `rate_cents`, `overtime_rate_cents`, `cost_cents bigint`, `overhead_cents bigint`, `gross_pay_cents bigint`, `needs_rate`. Index `(org_id, site_id, work_date)`.

**`pulse.paid_hours`**: `work_date`, `labor_class_id` (null = all), `paid_hours numeric(10,2) NOT NULL`, `paid_cents bigint` (optional real gross pay).
Unique live `(org_id, site_id, work_date, coalesce(labor_class_id, zero uuid))`.

**`pulse.time_punches`**: one row per person, day and job or reason, from a time clock or payroll export. `work_date`, `employee_code text NOT NULL`,
`employee_name text`, `job_id uuid`, `reason text` (same list as indirect; only when there is no job), `labor_class_id`, `hours numeric(10,2) NOT NULL`,
`overtime_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (overtime_hours <= hours)`, `pay_cents bigint`. Index `(org_id, site_id, work_date)`, `(org_id, job_id, work_date)`.
Punches are raw input. After any punch write, `rollupPunches(site, dates)` rebuilds three kinds of derived rows for the touched days (`source = 'punch'`):
- production: per `(job, date, shift 'day', labor class)`, `hours` and `overtime_hours` = the sums, `headcount` = distinct employees, `hours_confirmed = true`.
  It adopts an existing row with the same key (units stay, hours are replaced, `meta.punch_fields` lists what the punches own) or creates one with 0 units.
- indirect: per `(site, date, labor class, reason)`, `source_ref = punch:<site>:<date>:<class>:<reason>`.
- paid hours: per `(site, date, labor class)`, `paid_hours` = all punch hours of the day, `paid_cents` = the pay sum when every punch has pay.
A punch with no job and no reason lands only in paid hours, so it shows up as "Paid time not on any job". Employee names are visible to managers and up
and are used only for the roll up: Pulse has no per person scorecard.

**`pulse.material_usage`**: `job_id uuid NOT NULL`, `usage_date date NOT NULL`, `item_id uuid`, `item_sku text`, `item_name text`, `quantity_used numeric(14,3) NOT NULL`,
`quantity_scrapped numeric(14,3) NOT NULL DEFAULT 0`, `quantity_planned numeric(14,3)`, `unit_cost numeric(14,4) NOT NULL DEFAULT 0`, `uom text`, `lot text`,
`supplied_by text CHECK (IN ('us','client'))` (null = inherit, 4.6), `resolved_supplied_by text NOT NULL` (stamp), `note`, stamps `cost_cents bigint`, `scrap_cents bigint`.
Index `(org_id, job_id, usage_date)`, `(org_id, usage_date) WHERE deleted_at IS NULL`.

**`pulse.cost_entries`**: `scope text NOT NULL CHECK (IN ('job','client','company'))`, `job_id uuid`, `client_id uuid`, CHECK the ids match the scope
(job: both set; client: client only; company: neither), `cost_date date NOT NULL`, `category text CHECK (IN ('freight','packaging','equipment',
'outside_service','rework','supplies','storage','rent','utilities','salaried_staff','insurance','other'))`, `amount_cents bigint NOT NULL` (may be negative),
`vendor text`, `reference text`, `note`. `site_id` is nullable for company scope. Index `(org_id, job_id, cost_date)`, `(org_id, client_id, cost_date)`,
`(org_id, cost_date) WHERE deleted_at IS NULL`.

**`pulse.revenue_entries`**: `job_id uuid`, `client_id uuid NOT NULL`, `revenue_date date NOT NULL`, `kind text CHECK (IN ('invoice','fee','adjustment','credit','fixed_true_up'))`,
`description text`, `quantity numeric(14,3)`, `unit_price numeric(14,4)`, `amount_cents bigint NOT NULL`, `invoice_number text`, `vas_service_id uuid`,
`service_label text` (WMS bill operation type such as Storage), `approved boolean DEFAULT true`, `note`. `invoice` rows are billed memo only (4.8).
Index `(org_id, job_id, revenue_date)`, `(org_id, client_id, revenue_date)`, `(org_id, revenue_date) WHERE deleted_at IS NULL`.

**`pulse.vas_entries`**: `vas_service_id uuid NOT NULL`, `client_id uuid NOT NULL`, `job_id uuid`, `work_date date NOT NULL`, `quantity numeric(14,3) NOT NULL`,
`unit_price numeric(14,4)`, `amount_cents bigint` (null = "No price set yet"), `labor_class_id`, `headcount`, `hours numeric(10,2) NOT NULL DEFAULT 0`,
`overtime_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (overtime_hours <= hours)`, `material_cents bigint DEFAULT 0`, `note`, stamps `rate_cents`,
`overtime_rate_cents`, `labor_cost_cents bigint DEFAULT 0`, `overhead_cents bigint DEFAULT 0`, `gross_pay_cents bigint DEFAULT 0`, `shared_cents bigint DEFAULT 0`, `needs_rate`.
Index `(org_id, vas_service_id, work_date)`, `(org_id, client_id, work_date)`, `(org_id, work_date) WHERE deleted_at IS NULL`, `(org_id, job_id, work_date) WHERE deleted_at IS NULL`.

**Rollups**
- **`pulse.v_facts`** (view): the union described in 4.9 over production entries (base revenue, labor, standard material when the job method is `standard`, shared),
  material usage (when the job method is `actual`), cost entries of scope job and client, revenue entries (`invoice` rows as `billed_memo`, the rest as
  `revenue_other`), and service entries (revenue, labor, material, shared). Company scope costs, indirect entries, paid hours and punches are not facts.
- **`pulse.fact_days`**: `work_date`, `site_id`, `client_id`, `job_id`, `job_type_id`, `vas_service_id`, `kind`, `amount_cents bigint`, `units_good`, `units_scrap`,
  `hours`. Unique on `(org_id, work_date, site_id, client_id, coalesce(job_id, zero), coalesce(vas_service_id, zero), kind)`. Indexes `(org_id, work_date)`, `(org_id, job_id, work_date)`, `(org_id, client_id, work_date)`.
- **`pulse.company_days`** (PK `org_id, site_id, work_date`; company costs with no site use the default site): `direct_hours`, `indirect_hours`, `paid_hours`,
  `missing_hours`, `indirect_cents`, `shared_applied_cents`, `missing_cents`, `paid_cents`, `gross_pay_cents`, `company_cost_cents`, `overhead_absorbed_cents`,
  `over_logged boolean`. Feeds the bridge in 4.9, the Labor Time tab and the payroll check.

### 5.4 Control, workflow and system tables

**`pulse.periods`**: `period_month date NOT NULL` (first of month), `status text DEFAULT 'open' CHECK (IN ('open','closed'))`, `closed_at`, `closed_by`,
`reopened_at`, `reopened_by`, `reopen_reason text`, `snapshot jsonb` (totals by client, job type and service at close, plus the bridge), `checklist jsonb`.
Unique `(org_id, period_month)`; index `(org_id, period_month) WHERE status = 'closed'`.

**`pulse.day_reviews`** (PK `org_id, site_id, work_date`): `status text CHECK (IN ('complete','approved','sent_back'))`, `flags jsonb`, `marked_by`, `marked_at`,
`reviewed_by`, `reviewed_at`, `note text`. "Mark day complete" writes `complete`, locks that day for supervisors, and lists odd rows in `flags`: units with no
hours, pace under 50% or over 200% of target, more hours than paid. A manager approves or sends it back with a note (which unlocks it). Home entry progress counts approved days.

**`pulse.alert_rules`** (SD): `name`, `kind text CHECK (IN ('job_losing','job_at_risk','margin_below','labor_over_budget','material_over_budget','productivity_below',
'no_entry_days','due_soon_behind','missing_rate','missing_price','missing_hours','unbilled_above','client_margin_below','vas_margin_below','missing_time_above',
'overhead_rate_off','wms_shortage','deal_won_no_job','month_ready_to_close','import_failed','sync_failed'))`, `threshold numeric(16,4)`, `scope jsonb`
(client, job type, site filters), `severity text CHECK (IN ('info','warning','critical'))`, `notify_roles text[]`, `notify_user_ids uuid[]`,
`enabled boolean DEFAULT true`, `is_system boolean`. Twelve system rules are created with the org and can be tuned or turned off.

**`pulse.alerts`**: `rule_id`, `kind`, `severity`, `entity_type text CHECK (IN ('job','client','vas_service','site','period','import','sync','deal'))`, `entity_id text`,
`params jsonb` (numbers and ids; title, body and next step are rendered at read time per reader, 3), `impact_cents bigint`,
`url text` (path only, same rule as `cached_url`), `status text DEFAULT 'open' CHECK (IN ('open','snoozed','resolved','dismissed'))`, `snoozed_until date`,
`assigned_to uuid`, `resolved_at`, `resolved_by`, `resolution text CHECK (IN ('cleared','manual'))`, `dedupe_key text NOT NULL`, `first_seen_at`, `last_seen_at`,
`pm_task_id uuid`. Unique `(org_id, dedupe_key) WHERE status IN ('open','snoozed')`: a condition makes one alert, updates it while it lasts, and resolves
it by itself when it clears. Indexes `(org_id, status, severity)`, `(org_id, entity_type, entity_id)`.

**`pulse.notifications`**: `user_id uuid NOT NULL`, `kind`, `params jsonb`, `url` (path only), `alert_id`, `job_id`, `read_at`, `archived_at`.
Index `(org_id, user_id, read_at)`. Never notify the actor. Kinds include `daily_digest` (one per person per local day when something needs them)
and `report_ready`.

**`pulse.import_batches`**: `stream text NOT NULL`, `file_name`, `file_size int`, `file_hash text` (SHA-256 of the file, computed in the browser and
recomputed over the rows on the server), `delimiter text`, `header jsonb`, `mapping jsonb`, `options jsonb` (`{mode: 'all_or_nothing' | 'skip_bad_rows', dateOrder, createMissing, lookalikes: 'skip' | 'add'}`),
`status text CHECK (IN ('uploading','mapped','checked','committed','failed','undone'))`, `total_rows`, `create_count`, `update_count`, `unchanged_count`,
`skip_count`, `error_count`, `warning_count`, `committed_at`, `undone_at`, `undo_until`, `created_by`. Index `(org_id, created_at DESC)`, `(org_id, stream, file_hash)`.
**`pulse.import_rows`**: `batch_id uuid NOT NULL`, `row_number int`, `raw jsonb`, `parsed jsonb`, `action text CHECK (IN ('create','update','unchanged','skip','lookalike','error'))`,
`messages jsonb` (`[{level, column, text}]`), `entity_id uuid`, `before jsonb` (for undo). Index `(batch_id, row_number)`, `(batch_id, action)`.
**`pulse.import_presets`**: `stream`, `name`, `header_signature text` (sorted lowercased header hash), `mapping jsonb`, `options jsonb`, `last_used_at`. Unique `(org_id, stream, name)`.

**`pulse.saved_views`** (SD): `user_id`, `page text CHECK (IN ('jobs','profit','log','labor','reports','alerts'))`, `name`, `config jsonb` (filters, sort, group, columns, date range),
`shared boolean`, `is_default boolean`, `position int`.

**`pulse.activity`** (append only): `actor_id uuid`, `actor_kind text` (`user|system|integration|automation|device`), `verb text`, `entity_type text`, `entity_id uuid`,
`job_id uuid`, `client_id uuid`, `field text`, `before jsonb`, `after jsonb`, `meta jsonb`, `body text` (for notes), `created_at`.
Indexes `(org_id, created_at DESC)`, `(org_id, job_id, created_at DESC)`, `(org_id, entity_type, entity_id)`. This is both the audit log and the job activity feed.
Verbs (dotted): `job.created|updated|status_changed`, `price.changed`, `plan.revised`, `production.logged|edited|deleted`, `rate.changed`, `shared.moved`,
`day.completed|approved|sent_back`, `period.closed|reopened`, `import.committed|undone`, `export.run` (stream or report, with or without money, row count),
`role.changed`, `money_access.changed`, `device.created|revoked`, `sample.loaded|cleared`, `data.purged`, `settings.changed`, `sync.settings_changed`, `note.added`.

**`pulse.user_prefs`** (PK `org_id, user_id`): `prefs jsonb` (default site, default date range, log grid columns, pinned jobs, recents, hidden tips, notification switches per alert kind, digest on or off).

**`pulse.quote_scenarios`** (SD): `name`, `client_id`, `job_type_id`, `job_id` (what if on a real job), `inputs jsonb`, `result jsonb`, `status text CHECK (IN ('draft','sent','won','lost'))`,
`crm_deal_item_id uuid`, `created_by`. Index `(org_id, crm_deal_item_id)`.

**`pulse.report_schedules`** (SD): `name`, `report text`, `config jsonb`, `cadence text CHECK (IN ('daily','weekly','monthly'))`, `weekday smallint`, `day_of_month smallint`, `hour smallint`,
`recipient_user_ids uuid[]` (org members only; with `include_money`, only people with `money:read`, checked again at build time), `format text CHECK (IN ('csv','html','both'))`,
`include_money boolean`, `enabled boolean`, `last_run_at`, `next_run_at`, `created_by`. Index `(next_run_at) WHERE enabled`.
**`pulse.report_runs`**: `schedule_id`, `report`, `period_label`, `csv text`, `html text`, `row_count`, `include_money boolean`, `status text CHECK (IN ('ready','failed'))`, `error`, `created_at`.
Each of `csv` and `html` is capped at 2 MB (larger reports store the CSV only, cut at 50,000 rows with a note). Pulse sends no email: the suite has no mailer.
A run makes a `report_ready` notification with a download link for each recipient.

**`pulse.device_links`** (SD): links for shared screens with no personal login. `kind text CHECK (IN ('wall','kiosk'))`, `name`, `token_hash text NOT NULL UNIQUE`,
`token_prefix text NOT NULL` (first 8 characters, for lookup and for showing in the list), `site_id uuid NOT NULL`, `config jsonb` (wall: panels, rotate seconds, `hideClientNames`;
kiosk: idle lock seconds), `expires_at timestamptz NOT NULL` (default 90 days, can be renewed), `last_seen_at`, `revoked_at`, `created_by`. Device pages never return money.

**`pulse.sync_state`** (PK `org_id, source`): `source text CHECK (IN ('wms','crm','projects'))`, `cursor jsonb`, `locked_until timestamptz` (lease), `last_run_at`, `last_ok_at`,
`last_status text`, `last_error text`, `counts jsonb`.
**`pulse.sync_runs`**: `source`, `started_at`, `finished_at`, `status`, `created int`, `updated int`, `skipped int`, `skipped_closed int`, `error text`,
`trigger text CHECK (IN ('cron','manual','page','event'))`. Index `(org_id, source, started_at DESC)`.
**`pulse.dismissals`**: `kind text`, `target_id text`, `user_id uuid` (null = for the whole org), unique `(org_id, kind, target_id, coalesce(user_id, zero uuid))`. Used for suggested jobs and tips.
**`pulse.bridge_events`**: inbox for sibling app pushes. `kind text CHECK (IN ('wms_work_order_changed','crm_deal_stage_changed','pm_time_logged'))`, `target_id text`, `payload jsonb`,
`claimed_at`, `attempts int DEFAULT 0`, `last_error text`, `processed_at`. Unique `(org_id, kind, target_id) WHERE processed_at IS NULL` (a burst of changes is one event);
index `(org_id, created_at) WHERE processed_at IS NULL`.

**Retention** (daily cleanup cron): `import_rows.raw`, `parsed` and `before` are cleared when the 7 day undo window ends (counts and messages stay);
`report_runs` keep 90 days; read notifications keep 90 days; `sync_runs` keep 30 days; processed `bridge_events` keep 7 days (failed ones 30);
`activity` is kept for 7 years, then dropped by month.

## 6. Product surface (every route is real, working and persisted)

Shell: one top bar, no sidebar (the same pattern as the WMS), and the page uses the full width under it. The bar holds the logo,
the navigation, search, the org switcher, the primary button **Log work**, alerts, help, the app switcher, the theme toggle and the
account menu. The navigation has seven links and one menu, no more:
Home · Jobs (badge: at risk + losing count) · Log work · Profit · Labor · Alerts (badge: open) · Reports · **More** (Target pace, Calculator, Goals,
Import and export, Settings). If the bar is too narrow for all seven links, the last ones move into More. Below 1024px the links fold
into a menu button that opens a sheet from the left. Clients, job types, extra services, sites and months are tabs inside Profit, not
navigation items.
Supervisors land on Log work, not Home, and see: Log work, Jobs, Labor (Time tab only), Alerts, and More with Target pace and Import and export.
A global filter bar (date range presets: this week, last week, this month, last month, last 90 days, this year, custom; site; client; job type; status)
lives in the URL query string on every list, chart and report, so any view can be bookmarked, shared and exported as seen.

| Route | What is on it |
|---|---|
| `/` **Home** | Greeting and the two line answer: "Your jobs made $48,210 this month at a 31% margin. After time not on a job and overhead, the company made $39,900. 3 jobs need you." The second sentence opens the company profit bridge (4.9). KPI tiles (revenue, cost, profit on jobs, company profit, margin, units per person per hour, labor as % of revenue) each with change vs the prior period and a sparkline; profit trend chart (day, week, month); **Jobs that need you** (worst first, reason, projected profit, confidence word, one click to the job); today's entry progress ("7 of 9 active jobs logged today", counted only after the shift end, and "4 of 5 days reviewed this week"); best and worst clients and job types (jobs with missing labor are left out); cost split bar; paid time not on any job tile; Not billed yet tile; Things to fix; open alerts; setup checklist until done. No money role: units, hours, pace vs target and entry progress instead. |
| `/jobs` **Jobs** | Tabs **Open** (default, the at risk list: sorted worst first by status then projected profit; columns job, client, type, status pill with reason, % done bar, units, labor hours vs plan, margin so far, projected margin, projected profit, due, last entry), **All**, **Completed**, **Planned**. Chips to filter by status ("Losing money 3", "At risk 5", "Not enough data 2", "Heads up 6", "On track 22"). **Quick add** row at the top: client, job name, units, price per unit, Enter. It uses the General job type and today's date and makes the quote from the price. Search, column picker, sort, group by client or type, saved views, bulk actions (set status, set owner, export), CSV export of the current view. Row hover shows the top three reasons and next step. |
| `/jobs/new` | "More options" for a new job. Three steps: 1 Basics (client, job type, name, one time or ongoing, units, dates), 2 Price and plan (pricing model, price, who buys the parts, quick plan: labor hours or units per person per hour, usual crew by labor class, setup hours, material cost per unit, other costs; live margin preview against target, before and after shared costs), 3 Links (CRM deal, WMS work order, Projects project, all optional and hidden when the app is absent). Prefills from `?crmDeal=`, `?wmsWorkOrder=`, `?project=`, `?scenario=`, `?client=` (Pulse client id), `?coreCustomerId=`, `?crmAccountItemId=`, `?name=`, `?value=`. Also "Copy an old job". |
| `/jobs/[ref]` **Overview** | Header: number, name, client, type, status menu, risk pill, owner, due, linked record chips (CRM deal, WMS work order, Projects project, each opens the sibling in a new tab). Verdict card: status, the reasons in words, next steps, projected profit and margin with the confidence word, projected finish date, the assumption sentence. Tiles: revenue, cost, profit, margin after all costs, margin before shared costs, units done of planned, units per person per hour vs target pace, cost per unit vs should cost, earned vs billed. Cost split bar, cumulative revenue vs cost chart with the plan line, "Why profit changed", last 7 entries, quick actions (Log today, Add cost, Add revenue, Add a service, What if, Copy this job). |
| `/jobs/[ref]/plan` **Plan vs actual** | The table in 4.10. "Compare with: Quote or Budget" switch (hidden until a budget exists), "For the work done so far" or "Whole job" switch, projected at finish column, the three explainer cards, "Why profit changed" with its So far, At finish or Whole job modes, plan editor (totals or lines), "Make my own budget", revision history, per line quote table, quote to budget strip, source of the quote (calculator scenario, CRM deal value with a "Deal value changed in CRM" notice, WMS contract rate, typed). For ongoing jobs the plan is per month and the table compares the last 30 days. |
| `/jobs/[ref]/work` **Work log** | Daily entries with inline edit, add, delete with undo, crew lines by labor class, setup hours; daily chart of units and units per person per hour vs the target pace line; hours and cost by day and labor class with the rate applied and where it came from; overtime; time not on a job share with its sentence; labor cost per unit trend; Projects time imported for the linked project; rows from the warehouse that still need crew hours are marked "Add hours"; CSV export. |
| `/jobs/[ref]/materials` | "Who buys the parts" for this job. Method switch (standard per unit or actual usage). Standard: cost per unit with its dated history, units, scrap. Actual: usage rows (item, used, scrapped, unit cost, cost, who supplied it), planned vs used per item, scrap cost for our parts and scrap units for client parts, WMS sync state and "Refresh from WMS". |
| `/jobs/[ref]/money-in` **Money in** | Pricing model and dated price editor ("From which day?"), earned revenue by day, **Earned, Billed, Not billed yet**, invoices, extra service entries with their own revenue, cost and margin, other fees and credits. |
| `/jobs/[ref]/activity` | Audit feed (who changed what, before and after) and notes with a composer. |
| `/log` **Log work** | The day grid: one row per active job for the chosen date and site (date picker, previous and next day keys). Columns: job, units good, scrap, rework, **People**, **Hours each**, **Labor hours** (computed, can be typed over), overtime (optional), note, plus a live readout (units per person per hour vs target pace, colored) and the day's goal. A row opens into crew lines, one per labor class, prefilled from the job's usual crew in one tap; setup hours sit under "More". Keyboard only entry (Tab, Enter moves down, arrows), type to find a job, **quick add a job that is not there yet** without leaving the grid, "Copy yesterday's crew", paste from a spreadsheet, autosave per row with a saved tick and undo, a stale row notice when someone else changed it, inline checks (4.4), warehouse units prefilled with hour hints, an "Other time" strip for time not on a job and paid hours for the day, day totals, **Mark day complete** (5.4). |
| `/log/review` **Review the day** | Manager queue of days marked complete, each with its odd rows (units with no hours, pace under 50% or over 200% of target, more hours than paid), fix in place, Approve or Send back with a note. |
| `/log/entries` | Every entry across days with filters, bulk edit, bulk delete with undo, export. |
| `/kiosk/t/[token]` **Floor tablet** | Opened from a kiosk device link, never from a personal login, so a shared tablet holds no suite session. Pick your name, type your 4 digit PIN (5 wrong tries lock that name for 5 minutes), then: pick a job card, number pad for units, steppers for people and hours each, Save. One job at a time, big confirmation, next job. Locks after 2 minutes idle. Entries are saved under the person who unlocked. When wifi drops, entries wait on the tablet ("Saved on this tablet. Will send when online.") and send with a stable key, so nothing is logged twice. One site only, no money anywhere, portrait and landscape. |
| `/profit` **Profit** | Tabs `?by=` job, client, type, service, site, month, week or day. Ranking bar chart (profit or margin, best and worst switch) above a table: revenue, labor, material, other, time not on a job, cost, profit, job margin, contribution % (optional column), units, units per person per hour, labor as % of revenue, should cost vs actual cost per unit, change vs prior period, trend sparkline. Click a row to drill: client to its jobs to its daily entries. A breadcrumb shows the path and totals always match the level above. Compare to prior period or plan. The **Company** row opens the company profit bridge. The Sites tab is a site against site table: margin, pace against target pace, time not on a job, cost per unit by job type. Export. |
| `/clients/[id]` | Reached from the Clients tab of Profit. Tiles, trend, plan vs actual profit for the period, labor as % of revenue, cost to serve per unit and per job, Earned, Billed and Not billed yet, jobs table, services table, client level revenue and costs with the "revenue with no cost tracked" note, warehouse billing outside profit, who buys the parts, contact, links to the CRM account and WMS client, target margin, activity. |
| `/services`, `/services/[id]` **Extra services** | Service catalog (price, unit, target pace) and profit by service: revenue per unit, cost per unit, margin, volume, trend, clients using it. Service page: entries, add entry, entries with no price to fix, WMS operations pulled. |
| `/labor` | Tabs **Rates** (labor classes and the rate builder: wage, payroll taxes and workers comp %, benefits and paid time off %, other %, overhead per hour with the overhead helper, overtime multiplier, live "one hour really costs $21.76" readout, effective date timeline, history, change preview), **Time** (on jobs vs not on a job vs paid time not on any job by day, share of paid time spent on jobs, time not on a job by reason, paid hours entry, payroll check, "covered vs real" when the percent rule is on), **Cost** (labor cost by class, job type and client, overtime share). The Rates tab needs `rate:manage`. |
| `/target-pace` | Units per person per hour targets by job type, client and service with effective dates; "Suggest from history" (median of the last 20 evidence days, shows the spread, one click to accept); pace vs target table and chart by job, labor class and day. |
| `/calculator` | Quote calculator and what if. Inputs: client, job type, units, who buys the parts and material cost per unit, units per person per hour (prefilled from the target pace and from similar past jobs), crew mix by labor class, setup hours, added services, other costs, target margin. Outputs live: cost per unit split, price per unit for the target margin after all costs (`price = cost / (1 - target)`), lowest price worth taking (cost before shared costs), margin at a typed price, break even price, a sensitivity grid (pace plus or minus 20% by price), and a "What happened last time" panel (actual pace and margin of similar jobs). Save a scenario, "Create a job from this" (becomes the quote), or open any real job in what if mode to test a new price, pace, crew or rate against its projected profit. |
| `/goals` | Goals vs actual for the org, each site, client, job type and service: margin, profit, revenue, units per person per hour, labor as % of revenue, cost per unit (against should cost when a plan exists), share of paid time spent on jobs. Green, amber, red, trend, and a goal editor. |
| `/alerts`, `/alerts/rules` | Inbox of alerts (open, snoozed, resolved), each with what happened, the money impact, the next step, a link to the job, snooze, assign, dismiss, "Create a task in Projects" when Projects is licensed (the task text has no money). Rules tab: plain sentence rules ("Tell me when a job's margin is heading under 15%") with thresholds, scope, who gets told, on or off. Each person gets one daily digest notification when something needs them; the count also shows in the Portal home panel and as a badge on the Pulse row of the app switcher in every app. |
| `/reports`, `/reports/[slug]` | Report library, each with filters, a chart, a table, print view, CSV export and **Build on a schedule**: Job profit, Profit by client, Profit by job type, Profit by service, Profit by site, Monthly profit and loss (with the company profit bridge), Plan vs actual, Quote vs actual, Open jobs at risk, Why profit changed, Pace vs target, Labor summary, Paid time not on any job, Material and scrap, Cost to serve, **Ready to bill**, Daily production log, Month close pack, Audit log. Scheduled tab: schedules and past builds. A build tells its recipients in Pulse with a download link (CSV, and an HTML page to print or paste). Pulse does not send email. |
| `/import`, `/import/new`, `/import/[batchId]` | Import center: one card per stream with its template download, last import and row counts. Flow: 1 Upload (drag a file or paste rows), 2 Match columns (auto matched by header aliases, remembered presets, sample values shown), 3 Check (counts for new, changed, unchanged, look the same, skipped, errors; a preview table with every problem in plain words on the exact cell; choose "all or nothing" or "skip bad rows"), 4 Done (result, error report CSV, link to the new rows, Undo for 7 days). History of batches. |
| `/export` | One click export per stream in the same columns as its template (so it can be imported back), date range and filters, "Download everything" (one zip of all streams and the key reports, streamed, each file cut at 200,000 rows with a note). |
| `/wall` | Wall display for the floor TV: full screen, no chrome, large type, auto rotating panels: today's units vs goal per job, units per person per hour vs target pace per job (bullet bars), the day's totals, jobs due this week, a "Nice work" panel for jobs beating the target pace (never a job with missing hours). **Daily goal** for a job = usual crew headcount x shift hours x target pace when both exist, else units left / work days left to the due date (today included), else none. Options in the URL (`site`, `rotate` seconds, `panels`). Refreshes every 60 seconds. Never shows money unless a signed in money role turns it on. `/wall/t/[token]` is the same display behind a wall device link for a TV with no login: never money, client names can be hidden, `noindex`, `Referrer-Policy: no-referrer`, rate limited, entitlement checked, link expires. |
| `/settings` | Sections: General (currency, week start, working days, shift length, job numbers), Sites (name, time zone), Job types, People and roles (Pulse role, sees money switch, kiosk PIN reset, "Who can see money?"), Cost rules (who buys the parts, time not on a job rule and spread period, default burden, target margin, risk thresholds with a live "this would flag N jobs" preview), Month close (`/settings/close`: checklist, payroll check, close, reopen with reason), Connected apps (`/settings/apps`: status of CRM, WMS, Projects, what is synced, last sync, skipped rows, Sync now, switches, warehouse billing types to count in profit), Device links (wall and kiosk), Sample data (load, clear), Audit log (`/settings/audit`, filter by person, record and date, export), How Pulse does the math. |
| `/welcome` | First run. "Run Pulse for this workspace" when nobody runs it yet (3), then "Who can see money?", then "How do you want to start?": load sample data, import spreadsheets, connect KitStak apps (shown when licensed), or type the first job. Captures the browser time zone for the first site. Then the 5 step checklist: set a labor rate, add a client, add a job, log a day, see your profit. Each step links to the real screen with a coach mark. |
| `/search`, Cmd+K | Command palette: go to any page, find jobs, clients, services; actions (Log work, New job, New client, Add cost, Import, Export, Close month, Open wall display, switch org, theme, open sibling apps). Shortcuts: `g h` Home, `g j` Jobs, `g l` Log, `g p` Profit, `g a` Alerts, `n` new job, `l` log work, `/` search, `?` shortcut sheet, `[` and `]` previous and next day on the log. |
| `/login`, `/forgot-password`, `/no-workspace` | House auth pages with a Pulse preview panel. Locked screen when the org has no `pulse` entitlement, with a link to `portal/billing?module=pulse`. |

Cross cutting, on every screen: empty states that teach (what this is, one sentence why, the primary action, a link to sample data); loading states with the
Pulse loader and skeletons; error states with retry; optimistic saves with undo toasts; "How we got this" on every number; responsive from 360 px
(tables become cards, the log grid becomes a stacked form); keyboard reachable with visible focus; ARIA labels and screen reader tables behind every chart;
status is never color only (icon and word too); light and dark through tokens; all numbers `tabular-nums`; `prefers-reduced-motion` respected.
User text (job and client names, notes) is always escaped in pages, print views and built report HTML.

`src/proxy.ts` public list: auth pages, `/api/health`, `/wall/t/*`, `/kiosk/t/*`, `/api/v1/kiosk/*`, `/api/v1/cron/*`. Everything else needs a session.

## 7. CSV in and out (every stream, nothing else installed)

Engine rules (`src/lib/csv.ts` + `src/server/domain/imports.ts`, same code for every stream):
- Reads UTF-8 (BOM ok), comma, semicolon or tab (auto detected), quoted fields, blank lines skipped. Limits: 10 MB, 50,000 rows, 200 columns and 2,000 characters a cell;
  5 unfinished batches per org; 20 uploads per person per hour.
- **Upload path.** A Vercel function body tops out at 4.5 MB, so the file is parsed in the browser (a web worker, same `csv.ts`) and its raw rows are sent to
  `POST /api/v1/import/[batchId]/rows` in chunks of 500. The server stores them in `import_rows.raw` and trusts nothing else: mapping, parsing, lookups and every check
  run on the server from the raw strings.
- Headers match by exact name or alias, ignoring case, spaces, underscores and punctuation (`Units Good`, `units_good`, `Good units`, `qty finished` all map to `units_good`). Unmatched columns are shown and can be mapped by hand or ignored. Mappings are saved as presets keyed by the header set, so next month's file maps itself.
- Dates: `YYYY-MM-DD`, `M/D/YYYY`, `D/M/YYYY` (per `settings.date_order` or the import option), `Nov 3 2026`, Excel serial numbers. Money: `1234.5`, `$1,234.50`, `(45.00)` and `-45` for negatives. Percents: `28`, `28%` (both mean 28 percent). Yes and no: `yes|no|true|false|1|0`.
- Lookups by code first, then exact name without case: client, job, job type, labor class, site, service, item. Option per import: "Create missing clients, job types and items" (on by default, each created row is listed in the check step).
  An unknown labor class is a problem row by default, because a class made on the fly would cost hours at the default rate: "There is no labor class X. Add it in Labor
  first, or turn on Add new labor classes." The separate option "Add new labor classes" (off by default, needs `rate:manage`) allows it. The labor rates file still adds
  the classes it names, because each row carries the rate.
- Every row gets an action in the check step: new, changed (with a field by field diff), unchanged, **looks the same**, skipped or error. Errors are plain: "Row 14, labor_hours: 9x is not a number." "Row 22, job_number: there is no job J-2040. Add it first or turn on Create missing." "Row 31: October is closed."
- **No double money.** Streams whose rows may have no natural key (costs with no `reference`, revenue with no `invoice_number`, other time, materials with no `lot`, service entries) get a look alike check:
  a keyless file row that equals a live row on every key column listed in the table below plus the amount or quantity is marked "looks the same as a row already here" and is skipped unless the person picks "Add them anyway". And when the same file (same hash, same stream) was imported before, the check step says so first: "You imported this same file on Nov 3."
- Commit is batched set based SQL in one transaction (ceiling 50,000 rows, route `maxDuration = 300`), then the restamp and `recomputeJobs` for the touched jobs. Error report is a CSV of the bad rows with an added `problem` column, ready to fix and upload again. Undo restores `before` snapshots and removes created rows for 7 days, unless a later edit touched them.
- **Round trip rule**: exporting a stream and importing the file back changes nothing and creates nothing (every row reads "unchanged"). Exports carry the row key (`entry_id`) and the same headers as the template. Tested for every stream.
- **Formula guard.** On export, a **text** cell whose first character is `=`, `+`, `-`, `@`, tab or carriage return gets one leading apostrophe. Number, money and date cells are never touched, so `-45.00` stays a number. On import, exactly one leading apostrophe is removed when the next character is one of those triggers. A note like "- call client" or a phone "+1 555" therefore survives the round trip unchanged (tested).
- Exports use CRLF line ends and a BOM so Excel opens them cleanly, and file names read `pulse-<stream>-<org>-<from>-to-<to>.csv`.
- Templates download from the import center with the header row, two example rows and a second "how to fill this in" file listing each column, whether it is needed, and allowed values.

Columns (`*` = needed). Money columns are dropped from exports for readers without `money:read`; wage columns need `wage:read`.

| Stream (file) | Columns | Row match (update, not duplicate) |
|---|---|---|
| **Clients** `clients.csv` | `client_code*`, `name*`, `status`, `contact_name`, `contact_email`, `phone`, `target_margin_pct`, `payment_terms_days`, `parts_owner` (`us`, `client`), `notes` | `client_code`, else name |
| **Job types** `job_types.csv` | `job_type_code*`, `name*`, `unit_label`, `default_pricing_model`, `default_labor_class`, `default_units_per_labor_hour`, `target_margin_pct` | `job_type_code` |
| **Jobs** `jobs.csv` | `job_number*`, `name*`, `client_code*`, `job_type_code` (blank = General), `site_code`, `kind` (`one_time`, `ongoing`), `status`, `pricing_model`, `unit_label`, `planned_units`, `unit_price`, `fixed_price`, `bill_rate_per_hour`, `material_method`, `material_cost_per_unit`, `parts_owner`, `labor_class`, `units_per_labor_hour_standard`, `target_margin_pct`, `start_date`, `due_date`, `completed_date`, `po_number`, `owner_email`, `kit_sku`, `notes`, `wms_work_order`, `crm_deal_id`, `project_key`, and the optional quote columns `quote_units`, `quote_revenue`, `quote_labor_hours`, `quote_labor_cost`, `quote_material_cost`, `quote_other_cost` (one file makes jobs with their quotes) | `job_number` |
| **Quotes and budgets** `job_plans.csv` | Two layouts, told apart by the header. **One row per job**: `job_number*`, `plan*` (`quote` or `budget`), `units`, `revenue`, `labor_hours`, `labor_cost`, `setup_hours`, `setup_cost`, `material_cost`, `other_cost`. **One row per line**: `job_number*`, `plan*`, `category*` (`revenue`, `labor`, `setup`, `material`, `other`), `description`, `quantity`, `unit` (`unit`, `hour`, `each`, `flat`), `unit_amount`, `amount`, `labor_class`, `service_code`, `item_sku` | one row per job: `(job_number, plan)` sets the totals. Lines: all lines of each `(job_number, plan)` in the file replace that plan's lines |
| **Production** `production.csv` | `entry_id`, `work_date*`, `job_number*`, `shift`, `labor_class`, `units_good*`, `units_scrap`, `units_rework`, `people`, `hours_each`, `labor_hours` (total; alias `hours`; when blank it is `people x hours_each`), `overtime_hours`, `setup_hours`, `note` | `entry_id`, else `(job_number, work_date, shift, labor_class)` |
| **Labor rates** `labor_rates.csv` | `labor_class_code*`, `labor_class_name`, `kind` (`employee`, `temp_agency`), `site_code`, `effective_from*`, `wage_per_hour*`, `payroll_tax_pct`, `benefits_pct`, `other_burden_pct`, `overhead_per_hour`, `overtime_multiplier`, `bill_rate_per_hour`, `note` | `(labor_class_code, site_code, effective_from)` |
| **Other time** `indirect_time.csv` | `entry_id`, `work_date*`, `site_code`, `labor_class`, `reason*`, `people`, `labor_hours*`, `overtime_hours`, `note` | `entry_id`, else look alike on `(work_date, site, labor_class, reason, labor_hours)` |
| **Paid hours** `paid_hours.csv` | `work_date*`, `site_code`, `labor_class`, `paid_hours*`, `paid_amount` | `(work_date, site_code, labor_class)` |
| **Time punches** `time_punches.csv` | `entry_id`, `employee_id*`, `employee_name`, `work_date*`, `site_code`, `job_number` or `reason` (neither = paid time not on any job), `labor_class`, `hours*`, `overtime_hours`, `pay_amount` | `entry_id`, else `(employee_id, work_date, job_number or reason, labor_class)` |
| **Materials** `materials.csv` | `entry_id`, `usage_date*`, `job_number*`, `item_sku*`, `item_name`, `quantity_used*`, `quantity_scrapped`, `quantity_planned`, `unit_cost*`, `uom`, `lot`, `supplied_by` (`us`, `client`, blank = follow the job), `note` | `entry_id`, else `(job_number, usage_date, item_sku, lot)` when `lot` is set, else look alike on `(job_number, usage_date, item_sku, quantity_used, unit_cost)` |
| **Items** `items.csv` | `item_sku*`, `name*`, `uom`, `unit_cost`, `supplied_by`, `client_code` | `item_sku` |
| **Costs** `costs.csv` | `entry_id`, `cost_date*`, `job_number` or `client_code` (neither = a company cost), `site_code`, `category*`, `amount*`, `vendor`, `reference`, `note` | `entry_id`, else `(job or client or company, cost_date, category, reference)` when `reference` is set, else look alike on `(job or client or company, cost_date, category, amount)` |
| **Revenue** `revenue.csv` | `entry_id`, `revenue_date*`, `job_number` or `client_code` (one is needed), `kind*` (`invoice`, `fee`, `adjustment`, `credit`), `description`, `quantity`, `unit_price`, `amount*`, `invoice_number`, `service_code`, `note` | `entry_id`, else `(job or client, invoice_number, description)` when `invoice_number` is set, else look alike on `(job or client, revenue_date, kind, amount)` |
| **Services** `services.csv` | `service_code*`, `name*`, `unit_label`, `billing` (`per_unit`, `per_hour`, `flat`), `default_price`, `default_cost_per_unit`, `units_per_labor_hour_standard`, `labor_class`, `active` | `service_code` |
| **Service entries** `services_done.csv` | `entry_id`, `work_date*`, `client_code*`, `job_number`, `service_code*`, `quantity*`, `unit_price`, `amount`, `labor_class`, `people`, `labor_hours`, `overtime_hours`, `material_cost`, `note` | `entry_id`, else look alike on `(client, job, work_date, service_code, quantity)` |
| **Target pace** `target_pace.csv` | `job_type_code`, `service_code`, `client_code`, `labor_class`, `units_per_labor_hour*`, `effective_from*`, `note` | the scope columns + `effective_from` |
| **Goals** `goals.csv` | `scope*` (`org`, `site`, `client`, `job_type`, `service`), `scope_code`, `metric*`, `month` (`YYYY-MM` or blank for every month), `value*` | `(scope, scope_code, metric, month)` |

**Export list**: all 17 streams above (round trip safe); every report in `/reports`; the current view of Jobs, Profit, Labor, Goals, Alerts and Log entries with
its filters applied; a job's Plan vs actual table; the audit log; an import's error report; "Download everything" zip. Every export writes an `export.run` activity row.
HTTP: `GET /api/v1/export/<stream>.csv?from&to&client&jobType&site&status` and `GET /api/v1/reports/<slug>.csv?...` (text/csv, `Content-Disposition: attachment`, permission and money checked).

## 8. Integrations (deep, two way, fail soft)

Ground rules:
- Pulse reads sibling data from the shared database through `src/server/integrations/{detect,crm,wms,projects,customers}.ts`. Each reader checks three things in order and returns
  `{ available: false, reason: 'not_licensed' | 'not_installed' | 'no_warehouse' }` instead of throwing: the org has the sibling's entitlement (allow all in dev), the table exists
  (`to_regclass`, cached 5 minutes), and for WMS the org has its own tenant schema (`findWmsTenantSchema`, cached 60 seconds, always `wmsTable(schema, name)`, never another org's schema).
  Any error in a reader is caught, logged once and treated as "not available". The UI then hides the feature. Nothing in Pulse ever needs a sibling to work.
- Pulse never writes into `crm.*`, `wms.*` or `core.customers`. It writes to Projects only through `@kitstak/pm-bridge`. Sibling apps read Pulse only through **`@kitstak/pulse-bridge`**,
  on their own servers, so margin math lives in one place and no browser ever calls Pulse across origins.
- Pulled data is copied into `pulse.*` rows with `source` and `source_ref`, costs are snapshotted, and each row keeps a deep link back to its source record. Sync is an idempotent upsert.
  The first sync of an org pulls all history; later runs are incremental by the source's `updated_at`. User edits win: a field a person changed on a synced row is listed in
  `meta.locked_fields` and is not overwritten. Rows that would land in a closed month are counted as `skipped_closed` and listed, never an error. Rows in another currency are skipped and listed.
- **When sync runs**: "Sync now"; on a page load when the last sync is older than 10 minutes (through `after()`, never blocking the page); on a bridge event; and on the 15 minute cron tick.
  Only one run per org and source at a time: a run takes the lease `sync_state.locked_until = now() + 5 minutes` with a conditional update and gives up quietly if it cannot.
  The cron tick walks orgs oldest `last_run_at` first, with a 240 second budget per invocation (`maxDuration = 300`) and a try and catch per org, so one bad org never blocks the rest.
- **Bridge events are fast.** Every Pulse `(app)` request and every cron tick first claims the org's waiting `bridge_events` (`FOR UPDATE SKIP LOCKED`, sets `claimed_at` as a
  5 minute lease, bumps `attempts`; a claim never sets `processed_at`). After the work each claimed note is settled: done sets `processed_at`; failed stores `last_error` and
  keeps the lease, so the retry waits 5 minutes; busy (another sync holds the app) gives back the lease and the try. The 5th failed try parks the note (`processed_at` plus
  `last_error`, "Gave up after 5 tries."), so it no longer blocks a new note for the same record. So a change in a sibling shows in Pulse on the next Pulse page load, and within 15 minutes with nobody looking.
- Links between apps store a path, never a host. The host comes from `appUrls()` at read time and carries the theme with `withThemeParam`.

### 8.1 `@kitstak/pulse-bridge` (new package, used by Portal, CRM, WMS, Projects and by Pulse itself for access)

Raw SQL over the host's Drizzle executor (`BridgeExecutor`), peer dep `drizzle-orm` only, plain JSON DTOs, `./types` export for client components. Reads never throw and return
empty when `pulse` is absent. Every read takes `{ orgId, userId }`, resolves access with the shared `resolvePulseAccess` (3), returns money as `null` with `moneyHidden: true` when
that user has no `money:read`, and `{ available: false, reason: 'no_access' }` when the user has no Pulse role. Reason and alert words come from the shared
`renderReason(rule, params, canSeeMoney)`. Entitlement gating stays with the caller.

```ts
PULSE_STATUS_LABELS                                           // { on_track: 'On track', heads_up: 'Heads up', at_risk: 'At risk', losing: 'Losing money', no_data: 'Not enough data' }
pulseAvailability(db)                                         // to_regclass('pulse.jobs'), cached 60 s
resolvePulseAccess(db, { orgId, userId })                     // { role, seesMoney, seesWages }
getOrgSummary(db, who, { from, to })                          // open jobs, at risk, losing, revenue, cost, profit on jobs, company profit, margin
getAttentionCount(db, who)                                    // open alerts for this person, for the app switcher badge
getJobsForRecord(db, who, { type, id })                       // type: crm_deal | crm_account | wms_work_order | wms_shipment_order | wms_client | core_customer | pm_project
getJobSummaries(db, who, { type, ids })                       // batched, for list columns
getClientProfit(db, who, { pulseClientId?, coreCustomerId?, crmAccountItemId? }, { from, to })
listJobsNeedingAttention(db, who, { limit })                  // losing and at risk, worst first
listUnloggedJobsToday(db, who)                                // for "log today's work" nudges
emitBridgeEvent(db, { orgId }, { kind, targetId, payload })   // writes pulse.bridge_events, the only sibling write
pulseUrls(base).job(id) / .newJobFromDeal(dealId, ...) / .newJobFromWorkOrder(id) / .log(jobId) / .client(ref) / .jobsAtRisk()
```

`emitBridgeEvent` is called inside WMS, CRM and Projects write transactions, so it can never hurt them: it does nothing when `to_regclass('pulse.bridge_events')` is null (cached),
runs inside its own savepoint in all three apps, swallows and logs any error, and upserts on the pending event key so bursts collapse.

### 8.2 CRM

**Pulse reads** (`crm.boards`, `crm.columns`, `crm.items`, `crm.item_links`, `crm.customer_links`, `crm.activity_log`):
- Deals: boards with `kind::text = 'deals'`, top level live items. **Won** means the item's stage label has `isDone = true`, the same rule CRM's own dashboards use
  (`apps/crm/src/server/services/dashboards-insights-builders.ts`), read from the board's stage column labels, never a hard coded label id or a name match. A parity test seeds a
  board and checks Pulse and that CRM builder agree on which deals are won.
- Value is `values.deal_value.amount` in whole currency units, so cents = amount x 100, used only when `values.deal_value.currency` equals `settings.currency`.
- Close date: the `created_at` of the newest `crm.activity_log` row for the item with `action = 'item.value_changed'` and `column_key` = the stage column key whose `after` is a done
  label; else `values.close_date.date`. Account from `values.account.itemIds[0]`.
- Accounts: name, owner, health, and `crm.customer_links` to find the `core.customers` id when one exists.

**What Pulse does with it**:
- **Job from a won deal**: `/jobs/new?crmDeal=<itemId>` prefills name, client (finds or creates the `pulse.clients` row by `crm_account_item_id`, and sets `core_customer_id` when a customer link exists), quote revenue = deal value, start date = close date, and stores a `crm_deal` link. The quote plan gets `origin = 'crm_deal'`.
- **Suggested jobs**: Home and Jobs show "Won deals with no job yet" (won in the last 60 days, no `crm_deal` link, not dismissed) with "Create job" and "Not a job". Also raised as the `deal_won_no_job` alert and pushed by the CRM stage change event.
- **Quote value check**: when the deal value in CRM differs from the job's quote revenue, the Plan tab shows "The deal is now $52,000 in CRM. Your quote here is $48,000." with "Update the quote" and "Keep mine".
- **Client link**: client page shows the CRM account (owner, health) and a link to it; the client picker can search CRM accounts and creates the Pulse client on pick.
- Calculator scenarios can be tied to an open deal (`crm_deal_item_id`), so the estimate is waiting when the deal is won.

**What CRM shows about Pulse** (all CRM server routes over the bridge):
- Item panel **Profit** tab on deals (`PANEL_TABS` gains `pulse`, deep link `?item=<id>&itemTab=pulse`): the jobs made from this deal, each with status pill, % done, quote vs actual revenue, cost, profit, margin, projected profit; "Create a job in Pulse" when there is none; "Open in Pulse".
- The same tab on account items: client profit for the last 90 days and 12 months, margin trend, open jobs with status, count at risk, "Open client in Pulse".
- Header line on a won deal: "Job J-1042 · At risk · 14% margin" (or "No job yet. Create one.").
- Shell: app switcher row with the attention badge, `OrgModuleFlags.pulse`, `NEXT_PUBLIC_PULSE_URL`, sibling theme handoff list.
- On a stage change to a done label, `item-events.ts` calls `emitBridgeEvent('crm_deal_stage_changed')` inside the write transaction.
- Files: `apps/crm/src/server/services/pulse-bridge.ts`, `src/app/api/v1/crm/items/[itemId]/pulse/route.ts`, `src/features/item-panel/pulse/{api.ts,pulse-tab.tsx,pulse-mark.tsx}`. Visible only when `entitled.pulse`, the item is top level, the board kind is deals or accounts, and the bridge says available.

### 8.3 WMS

**Pulse reads** (tenant schema, text ids, text UTC timestamps converted to the warehouse time zone, float dollars converted in SQL with `round(x::numeric * 100)::bigint`).
An id is cast to uuid only when it matches the uuid pattern, so one odd id cannot break a sync.

| WMS source | Becomes in Pulse | Notes |
|---|---|---|
| `warehouses` | `pulse.sites` (`wms_warehouse_id`, time zone) | the default warehouse is adopted by "Main site", the others become new sites (5.1) |
| `clients` (= `core.customers`, same id) | `pulse.clients` with `core_customer_id` | upsert by id; inactive stays inactive. The first sync sets `settings.default_parts_owner = 'client'`, because a warehouse client owns its parts. |
| `work_orders` + kit `products` | `pulse.jobs` (`source = 'wms'`, number = work order code, `wms_work_order` link, kit SKU and name, `planned_units = requested_qty`) | status map: Open to planned, In Process to active, Completed to completed (with `actual_finish_at`), Cancelled to cancelled, Shortage to active with `wms_shortage = true` (rule R6). Auto created when `wms_auto_create_jobs`, else offered as "Work orders with no job". |
| `inventory_transactions`, kit built rows | `pulse.production_entries` per work order per day: `units_good`, `source_ref = wms:built:<workOrderId>:<date>`, `hours_confirmed = false` | **Exact predicate**: `type = 'Kitting' AND work_order_id IS NOT NULL AND product_id = work_orders.kit_product_id`. Rows with `to_status = 'Stock'` add `uom_qty`; rows with `from_status = 'Stock'` (disassembly) subtract. Component rows share the type and work order and are excluded by the product test. Day = `at` in the warehouse time zone. If the sum over days differs from `work_orders.processed_qty`, the job gets a Things to fix item. **Adoption**: if a person already typed a row for that job, day, `day` shift and default class, the sync adopts it (adds the `source_ref`; sets units only if the person left them at 0) instead of inserting a second row. The log grid shows these rows as "From the warehouse" and asks for people and hours (rule D1 until then). |
| `tasks` (Completed, timed, with `work_order_id`) | hint only: suggested people and hours on that row | WMS task time is scan time for one user, never shown as payroll hours and never costed until a person confirms |
| `work_order_components` | `pulse.material_usage` (`quantity_used = consumed_qty`, `quantity_planned = total_qty`, unit cost snapshot, `supplied_by` left blank so it follows the job and client) and job `material_method = 'actual'` | **Client owned parts cost 0** (4.6): for a warehouse client the rows track quantity and scrap only. They cost money only where the parts owner resolves to `us`. Unit cost snapshot: the `unit_cost` of the `purchase_order_lines` row behind the product's newest `receipts.received_at`; else `products.purchase_price`. **Dated the day the part was used**: each part takes the date of its `inventory_transactions` Kitting rows on that work order, in the site time zone (a part leaving a location counts as used, a part coming back is subtracted); anything the ledger does not explain goes on the build day (last kit build, else `actual_finish_at`, else `actual_start_at`). Stable ref `woc:<componentId>:<date>`, so a second pull changes nothing; rows from older pulls are moved to the right day, rows that came another way (`pick:` rows) are never added twice, closed months are left alone and counted. Cents come from BigInt math (`mulQuantityPrice`), never floats. |
| `kit_components` x cost | standard material cost per kit for the quote and the calculator, counted only for parts we own | |
| `products` | `pulse.items` (sku, name, cost snapshot, `wms_product_id`; `supplied_by = 'client'` when the product has a `client_id`) | |
| `lookup_values` (vas_type) + `vas_operations` + `billing_fees` (VAS) | `pulse.vas_services` and `pulse.vas_entries`; revenue = value (Total Price) or value x contract rate (Vas Quantity); no rate gives `amount_cents = null` and a "No price set yet" fix item | tied to a job when `reference_number` is a work order code |
| `billing_fees` with operation type `Work Order` (`fee_by` values `Per Kit`, `Per Component`, `Per WorkOrder`, as defined in `apps/wms/src/lib/grid-defs/organization/billing.ts`) | the job's price row and quote revenue (`origin = 'wms_contract'`): Per Kit sets `unit_price`; Per WorkOrder makes a `fixed` job; Per Component adds `rate x components per kit` to the unit price | job price order: contract rate, then the price typed in Pulse. The kit `products.price` is the client's retail price and is offered as the unit price only when the job's parts owner is `us` (you sell the kit). |
| `billing_reports` + `billing_report_lines` | `pulse.revenue_entries` with `kind = 'invoice'` (billed memo, never profit): detail lines (`is_detail = true`) of type Work Order or VAS whose `reference_number` is a work order go to that job; all other lines go to the client per bill and operation type in `service_label` | **billing data**. Date = the bill's period end. Approved bills count as billed; Draft bills come in with `approved = false`, shown as "Not approved yet", and are **deleted and replaced per bill** on every sync (`source_ref = wms:bill:<reportId>:<n>`), because a recalculated draft gets new line ids. Canceled bills are removed. Receiving, Storage, Pick and Pack and Shipment lines stay outside profit under "Warehouse billing, cost not tracked in Pulse" unless turned on in `wms_billing_ops_in_profit` (4.8). |

The warehouse data today has no Work Order or VAS fee or bill line, so these two mappings are proven by tests on a **throwaway tenant schema**: the test creates a schema
`wms_pulse_test_<random>` with the needed tables copied by `CREATE TABLE ... (LIKE wms.<table> INCLUDING ALL)`, registers it for a throwaway org in `core.wms_tenants`, inserts
fee and bill rows there, runs the sync and drops it. Pulse never writes to a real tenant schema, in tests or in production.

**What WMS shows about Pulse** (all through `@kitstak/pulse-bridge`, each renders nothing when Pulse is not licensed, not installed, or the user has no access):
- **Work order detail**: "Job profit" card in the right rail, above Project tasks: revenue, cost, margin, status pill with the shared words, plan vs actual bars for labor and materials, kits done of requested, "Log today's work" (opens Pulse `/log?job=<id>`) and "Open in Pulse". With no job yet: "Track profit for this work order" (opens `/jobs/new?wmsWorkOrder=<id>`).
- **Work orders list**: optional Margin column with a tone pill and a chip "Losing money: N", one batched call.
- **Client detail**: "Client profit" strip next to the Projects strip: last 30 days revenue, cost, margin, jobs at risk, link to the client in Pulse.
- **Bill detail**: "Margin on this bill" tile (billed work order and service lines against Pulse cost for the same jobs and period).
- **VAS operations**: "No price set yet" hint and "Add cost in Pulse" row action. **Dashboard**: "Jobs losing money" tile. **Labor analytics**: "See labor cost in Pulse" link.
- **Events**: `change-log.ts` calls `emitBridgeEvent('wms_work_order_changed')` on work order status and quantity changes.
- Shell: app switcher row with the attention badge, `entitledApps.pulse`, `APP_URLS.pulse`, theme handoff list. Files: `apps/wms/src/server/pulse/{bridge,routes}.ts`, `src/app/api/work-orders/[id]/pulse/route.ts`, `src/app/api/work-orders/pulse-summary/route.ts`, `src/app/api/clients/[id]/pulse/route.ts`, `src/app/api/billing-reports/[id]/pulse/route.ts`, `src/components/pulse/{job-profit-card,client-profit-strip,margin-pill}.tsx`.

### 8.4 Projects

**Pulse reads** (`pm.projects`, `pm.tasks`, `pm.time_entries`, `pm.integration_links`):
- **Link a job to a project** (`pm_project` link): picker on the job, in the wizard, and from `?project=<id>`. The picker lists only projects the person can see in Projects
  (org visible projects plus the ones they belong to). Suggested automatically when a project shares the job's CRM deal, WMS work order or customer.
- **Time entries as labor hours**: for a link with `imports_time` on, the sync (which runs as the system and reads all time of the linked project) sums finished entries
  (`ended_at IS NOT NULL`, `deleted_at IS NULL`) per day in the site time zone into `pulse.production_entries` (`source = 'projects'`, `source_ref = pm:<projectId>:<date>`,
  `units_good = 0`, headcount = distinct people, hours = minutes / 60 rounded to 2 decimals, the job's default labor class), then costs them with the Pulse rate. The Work log says so:
  "Everyone's project time is costed as Packer." These rows cost money and stay out of pace (4.12). Late edits to time in a closed Pulse month are skipped and listed.
  When a day's time is gone from Projects, the pulled row for that day is soft deleted, unless its month is closed (counted as skipped) or a person changed its
  hours. A Projects read that fails marks the sync run failed and keeps every row, so a bad read never removes time.
  The job Work log shows planned time (`sum(estimate_minutes)`) against logged time.
- Project status, health, due date and progress show on the job header chip.

**Pulse writes** (through `@kitstak/pm-bridge`, only when Projects is licensed): "Create a task" from an alert or a job (`createTaskFromExternal` with a `pulse_job` link, text with no money),
and "Start a project for this job" (deep link to the Projects app `/projects/new?name=<text>`, plus `&customer=<coreCustomerId>` when the client has one).
This needs the new link target type `pulse_job` in Projects: migration `apps/projects/drizzle/0006_pulse_links.sql` (the CHECKs on `pm.integration_links` and `pm.integration_events`), `INTEGRATION_TARGET_TYPES`, `link-path.ts`, a `pulse.ts` resolver in `src/server/integrations`, the icon maps, and `BRIDGE_TARGET_TYPES`.

**What Projects shows about Pulse**:
- **Project overview**: "Job profit" strip under the Customer 360 strip: each linked job with status pill, % done, revenue, cost, margin, projected profit; totals; "Open in Pulse"; "Track profit for this project" when nothing is linked. Built like Customer 360 (reader `server/integrations/pulse-profit.ts`, route `projects/[key]/pulse-profit`, component `features/integrations/pulse-profit-strip.tsx`, soft 900 ms server preload).
- **Projects directory**: margin chip on project cards and rows. **Task drawer**: `pulse_job` link chips with live status. **Home**: "Jobs losing money" card. **Settings, integrations**: a Pulse row with status.
- On time logged for a linked project, Projects calls `emitBridgeEvent('pm_time_logged')`.
- Shell: app switcher row with the attention badge, `appUrls().pulse`, `modules.pulse`, trusted origins.

### 8.5 Portal

- **Launcher tile** "KitStak Pulse", tagline "Know which jobs make money", icon `AppIcon app="pulse"`, three stats: Open jobs, At risk, Losing money (`pulseStats(orgId)` behind `to_regclass('pulse.jobs')`, try and catch returns null). Empty state copy: "No jobs yet. Add your first job to see profit." with a link to `/welcome`.
- **Quick links**: Log work, New job, Jobs at risk. **Home panel** "Jobs that need you" (top 5 and the daily digest count, hidden without access) and "Profit by client" (hidden without `money:read`).
- **Setup guide** steps (derived, plain words): `pulse_labor_rate` "Set your labor cost per hour" (done when `pulse.labor_rates` has a row or a default rate is set), `pulse_first_job` "Add your first job" (a live job exists), `pulse_first_entry` "Log a day of work" (a production entry exists), `pulse_connect` "Link a job to a deal or work order" (only when CRM or WMS is entitled; a `pulse.job_links` row exists). `stepHref` points at Pulse with `?setup=<key>`.
- **Command palette**: "Open Pulse", "Log work", "Jobs at risk" (locked goes to `/billing?module=pulse`).
- **Billing**: `MODULE_NAMES.pulse`, upgrade page copy with five features (profit per job, daily production entry, plan and quote vs actual, at risk list, CSV in and out).
- Shell: `appUrls.pulse`, `entitled.pulse`, footer text, `MARKS.pulse`, `EMPTY_STATS_COPY.pulse`, `SetupScope`, `ONBOARDING.md`.

### 8.6 Shared packages, switcher, entitlements, deploy

- `packages/ui/src/app-switcher`: `AppSwitcherAppId` gains `pulse`, `urls.pulse?`, `entitled.pulse?`, an optional `badges.pulse?: number`, row `{ id: 'pulse', name: 'KitStak Pulse', descriptor: 'Profit by job, client and day' }`. Every app passes its Pulse URL, entitlement and `getAttentionCount`.
- `packages/ui/src/app-icon`: `AppIconId` gains `pulse`, `ICONS.pulse` (section 10), test row `['pulse', 6]`.
- `packages/entitlements`: `Module`, `MODULES`, `read.ts` draft record. `packages/db`: `ENTITLEMENT_MODULES`, CHECK literal, migration `0006_core_pulse_module.sql` + journal + README.
- Pulse itself: `(app)` layout gates on `orgHasPulseModule` (locked screen), API returns 402 `NOT_ENTITLED`, dev allows all unless `ENTITLEMENTS_DEV_ALLOW_ALL=0`.
- Every sibling `.env.example` gets `NEXT_PUBLIC_PULSE_URL` and port 3500 in `TRUSTED_ORIGINS`. `deploy/push-env.mjs` gets `URL_PULSE`, `PROJECT_PULSE` and a Pulse plan; `docs/DEPLOYMENT.md` (with the RLS role check from section 5 and the migrate order from section 1), root `package.json` (`dev:pulse`), `.claude/launch.json`, root README and `apps/web` product lists gain Pulse.

### 8.7 Pulse HTTP API (`/api/v1`) and deep links

The API is **same origin only**. Sibling apps use the bridge on their own servers and their CSP is `connect-src 'self'`, so no browser needs to call Pulse across origins:
no route sends CORS headers. Every write checks the session, entitlement, role, the house `assertSafeOrigin`, and also requires `Content-Type: application/json`
(the house check lets a request with no `Origin` header through). Money is hidden by role on every route.

| Endpoint | Returns |
|---|---|
| `GET /api/health` | status, database ping, migration version (public) |
| `GET /api/v1/me` | user, org, Pulse role, `seesMoney`, `seesWages`, modules, integration availability |
| `GET /api/v1/summary?from&to` | open jobs, at risk, losing, revenue, cost, profit on jobs, company profit and its bridge, margin, entry progress today |
| `GET /api/v1/jobs`, `/jobs/[ref]`, `/jobs/attention?limit=` | lists and job detail DTOs with status, reasons (rendered for the reader), totals, projection |
| `GET /api/v1/profit?by&from&to&...`, `/api/v1/company-bridge?from&to&site` | Profit explorer rows; the bridge lines |
| `GET /api/v1/log?date&site`, `PUT /api/v1/log/rows` | the day grid; autosave of one row with its `version`. Changing a row that exists (by id, or by job, day, shift and labor class) without a version, or with an old one, is 409 with the fresh row, never an overwrite; the update is conditional on the version read under a row lock |
| `POST /api/v1/import/[batchId]/rows` | upload chunk of raw rows (section 7) |
| `GET /api/v1/alerts/unread` | `{ count }` |
| `GET /api/v1/export/<stream>.csv`, `GET /api/v1/reports/<slug>.csv` | CSV files |
| `GET /api/v1/explain?metric&job&client&from&to` | the "How we got this" steps and data quality lines |
| `POST /api/v1/kiosk/unlock`, `POST /api/v1/kiosk/production` | kiosk device link only: token + person + PIN gives a 12 hour kiosk session scoped to `production:log` on one site; production upsert keyed by the tablet's `clientRef` (stored as `source_ref = kiosk:<clientRef>`). Rate limited. Never returns money. |
| `GET /api/v1/cron/tick`, `GET /api/v1/cron/cleanup` | cron only (`CRON_SECRET`, 503 when unset) |

Everything else is server actions.

**Deep links into Pulse**: `/jobs/<number or id>` and its tabs · `/jobs/new?crmDeal=<itemId>` · `/jobs/new?wmsWorkOrder=<id>` · `/jobs/new?project=<id>` ·
`/jobs/new?client=<pulseClientId>` or `?coreCustomerId=<id>` or `?crmAccountItemId=<id>`, with `&name=<text>&value=<amount>` ·
`/jobs/by-link?type=<target type>&id=<id>` (redirects to the job, or to the prefilled new job page; the redirect target is always built from ids, never from a URL in the query) ·
`/jobs?tab=open&risk=losing,at_risk` · `/log?job=<id>&date=<YYYY-MM-DD>` · `/clients/by-link?coreCustomerId=<id>` or `?crmAccountItemId=<id>` ·
`/profit?by=client&client=<id>&from&to` · `/services?wmsVasId=<id>` · any page `?setup=<step key>`. Unknown ids land on a helpful not found page, never a blank screen.
**Deep links out of Pulse**: CRM `/{orgSlug}/boards/{boardId}?item={itemId}&itemTab=pulse`; WMS `/work-orders/<id>`, `/clients/<id>`, `/billing/reports/<id>`, `/billing/vas`, `/products/<id>`; Projects `/p/<KEY>`, `/p/<KEY>/<number>`; Portal `/billing?module=pulse`.

## 9. Seed data plan (`pnpm --filter kitstak-pulse db:seed`, `--org=<slug>`, idempotent: wipe the org's pulse rows under `pulse.allow_purge`, rebuild through the domain layer)

Pulse made dates are relative to the day the seed runs (today = day 0), so the demo is always fresh: 90 days of daily production on work days from day -90 to day 0.
Numbers come from a seeded random generator so runs are repeatable. Sibling links are looked up by name or code at run time and skipped quietly if missing.

**Order matters**: 1 setup rows, 2 run the WMS, CRM and Projects sync (all history), 3 add hours, prices and plans on top of the synced rows, 4 Pulse made jobs and streams,
5 day reviews, 6 close months, 7 print row counts and the reconciliation check. Closing comes last, so warehouse rows on their fixed dates (2026-10-14, 10-22, 10-27) are
complete before their month locks. The seed closes every full month older than last month and leaves last month open and "ready to close".
The seed also writes real `core.entitlements` rows: all modules for `kitstak` and `northwind-robotics`, only `pulse` for `pulse-only`.

All orgs get: 5 labor classes with two dated rate rows each (a raise 45 days ago, so rate variance is real), 6 job types plus General, 8 services, target pace for every
job type, goals for the org and top clients, the 12 system alert rules, 3 saved views, 2 calculator scenarios, 1 report schedule, one wall and one kiosk device link, explicit Pulse
roles and kiosk PINs, company costs for each month (rent, utilities, equipment, salaried staff), time not on a job and paid hours for every work day (about 9% not on a job,
4% paid time not on any job, pay amounts on the last 60 days so the payroll check has data), two weeks of time punches, and approved day reviews for all but the last two days.

| | `kitstak` (has WMS and Projects, no CRM) | `northwind-robotics` (has CRM and Projects, no WMS) | `pulse-only` (nothing else) |
|---|---|---|---|
| Story | a 3PL kitting floor where clients own the parts | a kitting and integration cell that buys its own parts and builds install, spare part and service kits; proves Pulse with no warehouse | a small co-packer on spreadsheets; proves standalone |
| Sites | 2, from the two warehouses: MLT1 (default, adopts "Main site") and KS2, both `America/New_York` | 1 | 1 |
| Who buys the parts | the client (org default set by the sync); Lumen Skincare and Orchard Pet Supply are set to `us` | us | us |
| Clients | the 8 `core.customers` (Apex Threads, NovaForge Electronics, Copperline Coffee, Bluebird & Main, Voltbyte Labs, Summit Trail Gear, Harbor Roast Collective, Pixel & Pine inactive) linked by id, plus 2 Pulse only clients (Lumen Skincare, Orchard Pet Supply) | 10 CRM account items that own won deals (for example Highline Freight, Driftwood Freight, Cobalt Foods, Frontier Aerospace, Orion Fulfillment, Beacon Labs, Bluestone Foods), linked by `crm_account_item_id`; no `core.customers` | 3 typed clients |
| Job types (6) | Kit assembly, Subscription box, Retail display build, Gift set, Rework and relabel, Returns refurbish | Install kit build, Spare parts kit, Field service kit, Retrofit kit, Demo unit prep, Rework | same as kitstak |
| Services (8) | Labeling, Shrink wrap, Insert cards, Poly bagging, Quality check, Pallet build, plus the WMS VAS types Special Project and Programming | Labeling, Foam cutting, Serial capture, Firmware load, Quality check, Crating, Calibration, Expedite | 4 |
| Jobs | 40: 8 from WMS work orders WO000088 to WO000095 (price, hours and plans added on top of the real kit quantities; component rows cost 0 because the client owns them) + 32 Pulse jobs `J-1001` up, 2 of them ongoing | 40 Pulse jobs, 14 created from real won deals (quote = deal value share), `J-1001` up, 2 of them ongoing | 8 jobs, loaded through the CSV importer from the template files |
| Status mix | 22 active, 13 completed, 3 planned, 1 on hold, 1 cancelled (WO000089) | same mix | 5 active, 2 completed, 1 planned |
| Risk mix (active) | 10 on track, 4 heads up, 2 not enough data, 3 at risk, 3 losing money. Completed: 11 made money, 2 lost money | same mix | 1 of each status |
| Links | `wms_work_order` x 8, `wms_client` on clients, `pm_project` on jobs for projects APX, NOVA, CPL, PEAK, OPS (`imports_time` on for 2) | `crm_deal` x 14, `crm_account` on clients, `pm_project` for CBP, FRA, ORN (which already point at CRM deals), 4 won deals left without a job to show "Suggested jobs" | none |
| Role demo (explicit rows) | admin@kitstak.io owner, ops.manager manager, j.okafor, t.nguyen and d.castillo supervisor (no money), finance viewer with money, cs.team viewer without money, client portal users and the API user none | maya owner, daniel admin, ethan and sofia manager, hannah and liam supervisor, aisha viewer with money, lucas none | one owner, one supervisor |

A role resolver test runs against the real `kitstak` membership with the explicit rows removed: six core members and no core owner must resolve to one admin (the WMS Owner),
one manager, three supervisors without money, viewers without money, and none for the two client users and the API user. Nobody resolves to owner until the claim step.

Named story jobs that tests and reviewers can rely on (kitstak; northwind mirrors each with its own names). The warehouse jobs use only rules that do not depend on today's date:
- `WO000088` Voltbyte desk kit, 12 kits, and `WO000090`, `WO000091`: completed, made money (hours added by the seed). `WO000092` Harbor Roast gift kit, 400 kits: active, **at risk** by R6
  (warehouse shortage). `WO000093`, `WO000094`: active with nothing logged, **heads up** by W5. `WO000095` NovaForge road kit: planned. `WO000089`: cancelled.
- `J-1012` Harbor Roast holiday gift set, 12,000 units at $2.75: **losing money** (pace 31 units per person per hour against a target pace of 46, projected about $1,800 in the red).
- `J-1019` Summit Trail starter kit relabel, fixed price $9,400: **losing money** (hours 60% over).
- `J-1023` Bluebird & Main November subscription box: **at risk** (margin heading for 14% against 30%, material cost up; this client's job is set to parts owner `us`).
- `J-1027` Apex Threads retail display build: **at risk** (projected finish 5 work days after the due date).
- `J-1031` NovaForge accessory bundle: **heads up** (nothing logged for 4 work days). `J-1034` Copperline cold brew sampler: completed and **lost money** (rate raise mid job).
- `J-1036` Voltbyte cable kit: **not enough data** (3 days have units and no hours). `J-1038` Summit Trail monthly returns program: ongoing, on track on its last 30 days.
- `J-1005` Lumen Skincare launch kit: on track star job, 41% margin, beats the target pace (appears on the wall display "Nice work" panel). `J-1040`: started yesterday, slow first day,
  shows "Early guess" and is **not** called losing (the blend and the two day rule at work).

About 1,300 production entries per demo org, 500 material usage rows, 120 cost entries, 150 revenue entries (including invoices, with some work not billed yet), 260 service entries,
plus a quote on every job and a separate budget on 6 jobs. `db:seed` prints row counts and the reconciliation checks: sum over `v_facts` equals `fact_days` equals `job_stats`
plus client level rows, and the company bridge adds up.
The in-app "Load sample data" uses a smaller version (3 clients, 8 jobs, 30 days) flagged `is_sample` so "Clear sample data" removes exactly those rows.

## 10. Brand pack

Assets in `apps/pulse/public/brand/` (copy `BRAND-README.txt`, sibling icons, `kitstak-loader-kitstak.svg`, `kitstak-wordtype.png` from Projects):
- **`kitstak-icon-pulse.svg`** (+ 512 and 1024 PNG): the Pulse mark. Three bars on the same 200 x 200 artboard, 26 high, at the family rows `y = 50, 87, 124`, each 128 wide starting at `x = 36`.
  Each bar is split in two: a red part (cost so far) and a pink part (the margin left). It reads as "how much of each job's money is left", in the same family as the CRM funnel and the Projects staggered bars.
  Rects only, two fills only, no overlap (so `AppIcon` keys stay unique):

  ```
  [36, 50, 92, 26, RED]   [128, 50, 36, 26, PINK]
  [36, 87, 60, 26, RED]   [96, 87, 68, 26, PINK]
  [36, 124, 108, 26, RED] [144, 124, 20, 26, PINK]
  ```

  Use it as the favicon (`src/app/icon.svg`, `icon.png`, `apple-icon.png`), the top bar mark, `ICONS.pulse` in `@kitstak/ui` (`offsetY: 0`, 6 shapes), the Portal tile and `MARKS.pulse`,
  the CRM, WMS and Projects inline `PulseMark`, and `apps/web/public/brand/apps/kitstak-icon-pulse.svg`. Copy it into `apps/portal/public/brand/` too.
- **`kitstak-loader-pulse.svg`**: animated loader using the classes already in the brand loader stylesheet (`/* 7 Pulse: cost eats into revenue, live */`): per row a full width pink bar with class `ghost`
  (opacity .35) and a red bar on top with class `meter` (scaleX from the left, staggered delays per row). Stops for `prefers-reduced-motion`. Use it in every `loading.tsx`, full page loads and long actions
  (import check, sync, month close) via `<img src="/brand/kitstak-loader-pulse.svg" width="64" height="64" alt="Loading">`. The KitStak company loader stays for sign in and cross app handoff.
- Colors: Red `#C8102E`, Pink `#D65A6E`, Navy `#0A1628`, Cream `#F5F1E8`. Wordmark `KITSTAK PULSE` in Bebas Neue from `@kitstak/ui` (letter spacing 0.0485em, no kerning). UI text stays on token fonts.
- Data colors: charts use the `--chart-*` tokens; status uses `--success` (on track), `--warning` (heads up), an orange step (at risk), `--danger` (losing money) and a neutral gray (not enough data), always with an icon and the word.
  Brand red is for the mark and primary actions, never the only signal for "bad".

## 11. Quality bar and test plan

Typecheck and lint clean (the no dash rule covers `src/features`, `src/components`, `src/app`, `src/lib`, seed data). Every button does something. No placeholder pages, no lorem ipsum, no TODOs.

**Unit tests (vitest, pure functions in `src/lib`)**. Every worked example in section 4 is a test with the same numbers.
- `money`: `divRound` (halves, negatives), `BigInt` multiply at the CHECK bounds, formatting, parse of `$1,234.50`, `(45.00)`, safe integer guard.
- `calc/rates`: loaded, overtime and pay rate (the Packer example), site over all sites, effective dates, default fallback and its overtime, `needs_rate`.
- `calc/labor`: cost, overhead and gross pay stamps (the 96 hour example), blank overtime, setup hours.
- `calc/shared`: largest remainder (the 5981, 2492, 1527 example), tie breaks, pools split at a month end, each rule, the shared gap under every rule, missing time cost with and without pay amounts, the clamp at 0.
- `calc/revenue`: per unit, fixed price (the 235000, 329000, 376000 example, the true up, a negative catch up stamp, frozen stamps, and the property test of 4.8 over random insert, edit, delete sequences), hourly, billed memo never in revenue.
- `calc/material`: standard vs actual, scrap, each level of the "who buys the parts" chain.
- `calc/plan`: flex by units, by hours and "whole job", setup not flexed, other not flexed, auto shared cost.
- `calc/variance`: the worked table of 4.11 bar by bar, bars always sum exactly, each mode, each edge rule, a group equals the sum of its jobs.
- `calc/forecast`: the worked example of 4.13 line by line, the blend example, confidence words, each fallback of pace and rate, hour based jobs, past planned units, unknown pace, finish date over working days.
- `calc/risk`: one test per rule L1 to W8, the two day gate on L1 and R4, R3 and R4 stepping down to heads up when margin is fine, `pm` null, group order, D rules blocking On track, headline by impact (the 4.14 example), Actuals mode.
- `calc/bridge`: the $39,900 example, no company costs, negative overhead gap, the `full` rule.
- `calc/explain` and `render-reason`: money and no money text for every rule and metric, data quality lines, no wage for a manager, no dashes.
- `csv`: delimiters, quotes, BOM, dates, money, header aliases, limits, formula guard both ways. `permissions`: action table, money and wage rules. `access`: the role resolver table (core roles, WMS roles, API user, claim step). `copy-rules`: no em dash, en dash or double dash in UI strings.

**Database tests (against local Postgres, throwaway orgs)**
- Reconciliation: for every job, client, job type, service, site and month, the sum over `v_facts` equals `fact_days` equals `job_stats` equals the API totals, to the cent; the company bridge equals `company_days`.
- Round trip for all 17 streams: export, import, every row "unchanged", row counts identical, including notes that start with `-` or `+`.
- Import: chunked upload, server re-validation of tampered rows, mapping presets, each validation message, all or nothing vs skip bad rows, look alike rows, same file twice, undo, retention of raw rows.
- Restamp table (4.17): one test per row, each proving closed month stamps do not move and totals still equal the sum of rows.
- Month close: every stream refuses writes in a closed month (domain and trigger, OLD and NEW dates), reopen works and is logged, org delete and purge still work.
- Concurrency: two saves on the same week allocate shared cost correctly (advisory lock); a stale `version` is refused; two sync runs do not overlap (lease).
- Org isolation: a second org can never read or write the first org's rows through any domain function, and a raw SQL insert pointing at another org's parent fails on the composite FK.
- Money hiding: every API route and every bridge function called as a supervisor returns no money in any field or string; a manager never gets a wage.
- Fail soft: every integration reader returns `available: false` for the `pulse-only` org, and on a second database `kitstak_pulse_only` (created in test setup with `createdb`, then only the `@kitstak/db` and Pulse migrations) where `crm`, `wms` and `pm` do not exist.
- Sync: idempotent (twice creates nothing new), kit built predicate against the real work orders (12, 24 and 20 kits on their three dates, component rows ignored), adoption of a typed row, client owned parts cost 0, Work Order fees and bills on the throwaway tenant schema, draft bill replace, closed month skip, currency skip, a 23:30 local timestamp lands on the right day.
- Bridge: `emitBridgeEvent` is a no-op without the schema and never fails the caller; events dedupe, claim, retry and park. Plain role test for RLS (section 5). Migration chain on an empty database ends with four entitlement values.
- Punch roll up: production, other time and paid hours rows are rebuilt exactly; units typed earlier survive.

**Playwright (`e2e/`, all three seed orgs, light and dark, 1440 and 390 wide; the Pulse server runs with `ENTITLEMENTS_DEV_ALLOW_ALL=0`)**
1. Sign in, Home shows job profit, company profit and "Jobs that need you"; open the worst job; reasons, confidence word and projection are visible.
2. Log a day on the grid with the keyboard only (people, hours each, labor hours computed); the job's numbers change on the next page load; undo works; quick add a job from the grid.
3. Kiosk from a device link on a tablet viewport: PIN, save, idle lock, offline queue sends once.
4. Quick add a job, create one from the wizard and one from a calculator scenario.
5. Plan vs actual renders the table and "Why profit changed" for a story job; the budget switch appears only after "Make my own budget".
6. Import production from the template: mapping, a fixed error, commit, undo. Export and re-import shows all unchanged. Upload the same file twice and see the warning.
7. Profit drill: client to job to entries, totals match; the company bridge opens and adds up. 8. Add a labor rate with a new effective date; the preview shows the impact; costs move only after that date.
9. Close a month, try to edit inside it, reopen. 10. Supervisor login sees no money anywhere (scan the DOM for the currency symbol) and lands on Log work. Manager sees no wage.
11. Northwind: create a job from a won deal; the link opens CRM. Kitstak: a WMS work order job shows pulled kits, "Add hours", and client owned parts at no cost; the link opens WMS.
12. Standalone: as `pulse-only` (only a `pulse` entitlement row), every Pulse page loads, no sibling UI shows, no console errors, first run claim and "Who can see money?" work.
13. Sibling apps: Portal tile and stats, CRM Profit tab, WMS Job profit card, Projects strip, app switcher with badge in all five apps, the same status words everywhere.
14. Wall display rotates, shows goals and no money; a wall link with hidden client names. 15. Mark a day complete as supervisor, it locks; manager approves.
16. Axe scan has no serious issues on Home, Jobs, Log, Job detail, Import.

**Performance** (seed, plus a load fixture of 500 jobs, 3 years, 300,000 fact rows): Home and Jobs under 400 ms server time (reads `job_stats` and `fact_days`); Profit explorer under 500 ms;
log grid save round trip under 150 ms including shared allocation; lists virtualized past 200 rows; an import of 20,000 rows checks in under 10 seconds; a rate change over 50,000 entries finishes inside one 300 second route.
**Time to first profit number**: a new org with sample data sees a job profit in under 1 minute; typing or importing real data, in under 10 minutes (the standalone promise).

## 12. How Pulse beats Easy Metrics Profit Management

Scored on the research rubric (0 to 10 per category; the Easy Metrics baseline is an estimate from public material, not hands on). Pass bar: 80 or more in total, no category under 7,
ahead in at least 8 of 10. The Pulse column is a **target**: a reviewer only gives credit for what was clicked through with real data, and the last column names the tests that must be
green before a row can be claimed.

| # | Category | Easy Metrics (est.) | Pulse target | Why Pulse wins, and where to see it | Proof |
|---|---|---|---|---|---|
| 1 | Profit visibility | 7 | 9 | Profit by job, job type, client, extra service, site and time, with drill down from client to job to daily entry and totals that match to the cent, margin before and after shared costs, and a company profit bridge that ties job profit to what the company really made. Easy Metrics stops at customer, process and site: it has no job or service view. See `/profit`, `/clients/[id]`, `/services`. | reconciliation DB test, `calc/bridge`, e2e 7 |
| 2 | Job costing, plan vs actual | 3 | 9 | The job is the main object. Quote and budget per job, line by line quote vs actual, a fair plan for half done jobs, "Why profit changed" that always adds up, projected profit and finish date with a confidence word. Easy Metrics has planned vs actual at customer level only. See the job Plan vs actual tab. | `calc/plan`, `calc/variance`, `calc/forecast`, e2e 5 |
| 3 | Daily production entry | 3 | 9 | A whole day in one keyboard grid with people and hours each, crew lines, copy yesterday's crew, inline sanity checks, a PIN tablet kiosk that works offline, day sign off, autosave with undo, warehouse kits prefilled. It also takes a time clock or payroll file by person and job. Easy Metrics is feed driven and not built for a supervisor typing at the end of a shift. See `/log`, the kiosk link. | e2e 2, 3, 15, punch roll up test |
| 4 | Cost model depth | 7 | 8 | Real cost of an hour by labor class with effective dates, overtime and temp agency rates, an overhead helper checked against real overhead, time not on a job with a visible rule (including full absorption), paid time not on any job, a payroll check against real pay, target pace, should cost per unit, client owned parts, and material and scrap cost, which Easy Metrics does not have. Easy Metrics keeps an edge in engineered labor standards per warehouse process; Pulse answers with history based target pace in one click. See `/labor`, `/target-pace`. | `calc/rates`, `calc/labor`, `calc/shared`, `calc/material`, restamp tests |
| 5 | Risk and alerts | 4 | 9 | Every open job is on track, heads up, at risk, losing money or not enough data, with the reason in a sentence, the dollar impact and a next step, before the job ends, and without crying wolf on day one. Rules a manager can tune, an inbox, a daily digest, tasks in Projects. Easy Metrics shows what happened; it does not predict a job's finish. See `/jobs`, `/alerts`. | `calc/risk`, e2e 1 |
| 6 | Data in and out | 4 | 9 | A template, column matching, preview, cell level errors, look alike and same file checks, undo and a round trip safe export for all 17 streams, self serve. Easy Metrics needs about two weeks of vendor mapping. See `/import`, `/export`. | round trip and import DB tests, e2e 6 |
| 7 | Integration depth | 6 | 9 | Live two way links with CRM (job from a won deal, quote value, Profit tab on the deal and account), WMS (work orders, finished kits, component use, services, bills as earned vs billed; Job profit card on the work order), Projects (linked project, time as labor, tasks from alerts) and Portal, each with a one click link to the source record. And it works with none of them. Easy Metrics has no CRM, quote or project link and cannot run alone. | sync and bridge DB tests, e2e 11, 12, 13 |
| 8 | Ease of use | 5 | 9 | 8th grade words (one word list for the whole suite), seven navigation links, a one line quick add, "How we got this" with a data quality line on every number, a 5 step start, sample data, empty states that teach, first profit number in minutes. Easy Metrics needs training and weeks of setup. | `copy-rules`, e2e 4, 12, time to first number |
| 9 | Visual and interaction quality | 6 | 9 | The KitStak look across five apps, purpose built charts, light and dark, phone to wall TV, keyboard first, loaders and error states everywhere. | e2e at both widths and themes, e2e 14, 16 |
| 10 | Enterprise readiness | 7 | 8 | Five roles with opt in money and server side hiding down to stored sentences, wages apart from margins, org isolation by composite keys, append only audit log including exports, month close and lock with a written restamp rule, multi site, saved views, scheduled report builds, device links with expiry, reconciliation tests. Easy Metrics has more years in market; Pulse answers with provable numbers. | money hiding, isolation, month close, concurrency and RLS tests, e2e 9, 10 |
| | **Total** | **52** | **88** | | |

Capability checklist from the research, all in scope and each with a test: the 25 "must match" items (profit by job, client, type and service; daily entry; loaded rates; cost per unit and units per labor hour;
plan vs actual; planned vs actual by client; labor as % of revenue; material cost; indirect time; missing time; overhead rule; cost to serve; target cost per unit; dashboard with trend; URL filters;
multi site; CSV export everywhere; productivity vs standard; drill down; rankings; variance breakdown; roles; audit log; what if price) and the 17 "beat them" items (standalone in minutes; CSV for every stream;
quote vs actual per job; open jobs risk list; projected final margin; plain language; fast daily entry; material in the margin; deep suite links; service profit view; labor rate builder; alerts that say what to do;
same day truth with no nightly batch; sample data and guided setup; totals that match their rows to the cent; company profit bridge; payroll check against real pay).

Honest gaps, stated so nobody oversells: Pulse does not capture time by scan on its own (it takes typed hours, time punch and payroll files, WMS hints and Projects time), has no per person
productivity scorecard, no engineered standards library, no pay for performance module, one price per job, calendar month close only (week reports follow your week start), and it does not send email.
None of these are needed to answer "which jobs make money".
