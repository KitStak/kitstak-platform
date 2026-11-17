# KitStak Pulse: product + build spec

The fifth KitStak app: a profit management system for kitting, 3PL and contract packaging shops.
It answers one question for every job, client and service: "Are we making money, and if not, why?"
It must beat Easy Metrics Profit Management on function and be simple enough for an 8th grader.
It runs standalone (only Pulse licensed, CSV in and out for every data stream) or bundled and
deeply linked with Portal, CRM, WMS and Projects.

Sibling doc: `docs/pulse/CONTRACTS.md` (folder ownership, function names, DTOs). Research notes that
back this spec: competitor rubric, WMS map, CRM + Portal map, Projects template map (team scratchpad).

Copy rule for every user-facing string: plain 8th grade words, short sentences, and never an em dash
or a double dash. Use commas, periods or colons. Ranges read "to". Enforced by ESLint and `copy-rules.test.ts`.

## 1. Topology

| | Dev | Prod |
|---|---|---|
| App | `apps/pulse` (npm `kitstak-pulse`), `http://localhost:3500` (personal dev servers 3501 to 3520) | `pulse.kitstak.app` (new Vercel project `pulse`, Root Directory `apps/pulse`) |
| DB | shared Postgres, new schema **`pulse`** | same Supabase DB |
| Auth | Better Auth via `@kitstak/auth` (copy `apps/projects/src/server/auth.ts`; cookie `kitstak.session_token`) | `AUTH_COOKIE_DOMAIN=.kitstak.app` |
| Entitlement module | **`pulse`** (add to `core.entitlements` CHECK, `@kitstak/db` `ENTITLEMENT_MODULES`, `@kitstak/entitlements` `MODULES`) | grant: `pnpm --filter @kitstak/entitlements grant grant <org-slug> pulse` |
| URL env var | `NEXT_PUBLIC_PULSE_URL` (default `http://localhost:3500`), read by all five apps | `https://pulse.kitstak.app` |
| Migrations | `apps/pulse/drizzle`, runner `scripts/db-migrate.ts`, table `drizzle.__kitstak_pulse_migrations`, advisory lock key `7_202_611_505` | run `@kitstak/db` migrate first, then `pnpm --filter kitstak-pulse db:migrate` |
| Shared migration | `packages/db/drizzle/0006_core_pulse_module.sql` widens `entitlements_module_check` to `('crm','wms','projects','pulse')`; `0000_pulse_init.sql` repeats it inside a `to_regclass('core.entitlements')` guard | |
| Bridge package | `packages/pulse-bridge` (`@kitstak/pulse-bridge`), raw SQL over the host app's Drizzle executor, same shape as `@kitstak/pm-bridge` | |
| Cron | `vercel.json`: `/api/v1/cron/sync` every 15 minutes, `/api/v1/cron/nightly` at 07:10 UTC, both behind `Authorization: Bearer $CRON_SECRET` | |

Local dev DB (migrated and seeded): `postgres://postgres@localhost:5432/kitstak`. Shared `BETTER_AUTH_SECRET` is in
`/var/lib/kspg/secret`. Copy `apps/projects/.env.local` to `apps/pulse/.env.local` and set `BETTER_AUTH_URL` and
`NEXT_PUBLIC_APP_URL` to `http://localhost:3500`. Logins: `admin@kitstak.io` / `KitStak-Demo-2026!` (org `kitstak`,
has a warehouse, no CRM boards) and `maya@northwind-robotics.example` / `Northwind-Demo-2026!` (org
`northwind-robotics`, rich CRM and Projects, no warehouse).

Env (`src/server/env.ts`, lazy): `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_PORTAL_URL`, `NEXT_PUBLIC_CRM_URL`, `NEXT_PUBLIC_WMS_URL`, `NEXT_PUBLIC_PROJECTS_URL`, `TRUSTED_ORIGINS`,
`AUTH_COOKIE_DOMAIN`, `ENTITLEMENTS_DEV_ALLOW_ALL`, `CRON_SECRET`. `appUrls()` returns `{portal, crm, wms, projects, pulse}`.
`trustedOrigins()` adds the four sibling URLs and dev ports 3500 to 3520.

## 2. Stack (match apps/projects exactly)

Next.js 16.4.5 App Router (read `node_modules/next/dist/docs/` first: `src/proxy.ts` not middleware, `params` are Promises),
React 19.3, Tailwind 4 via `@tailwindcss/turbopack`, `@kitstak/ui` tokens + theme + logo + app switcher + handoff, Drizzle + pg via
`@kitstak/db/client-pg`, zod 4, lucide-react, radix, cmdk, sonner, zustand, `@tanstack/react-query`, `@tanstack/react-virtual`,
date-fns, vitest, Playwright. Charts are the house hand-rolled SVG kit copied from `apps/projects/src/features/dashboards/charts.tsx`
into `src/features/charts/` and extended (ranking bars, waterfall, bullet bar, sparkline, stacked cost bar, gauge). No chart library.
CSV parsing and writing is our own small tested module (`src/lib/csv.ts`), no dependency. Shell, sidebar, top bar, org switcher,
user menu, theme toggle and command palette are copied from Projects so Pulse looks and behaves like its siblings.

Layering is the house pattern: pages are thin, `src/features/<area>` holds server page + client view, all data access goes through
`src/server/domain/*` (first argument `ctx: DomainContext`), mutations are server actions returning `ActionResult<T>`, client reads
are `/api/v1/*` with the `{ data } | { error }` envelope, every write runs in one transaction with an activity row.

## 3. Roles and permissions

Pulse has five roles. A person's Pulse role comes from `pulse.member_roles` when a row exists, else from their org role
(`core.member.role`):

| Org role | Default Pulse role |
|---|---|
| owner | owner |
| admin | admin |
| member | `settings.default_member_role` (default `manager`) |
| viewer, guest | none: a friendly "Ask an admin for access" screen. This is on purpose: WMS client portal users are org viewers and must never see margins. |

Bootstrap rule: if an org has no org owner or admin and no explicit Pulse admin, members act as `admin` and Settings shows a banner
"Nobody runs Pulse yet. Pick an admin." The seed sets explicit roles for both demo orgs.

| Role | Who it is | Sees money | Can do |
|---|---|---|---|
| **owner** | business owner | yes | everything, including delete all data and reopen closed months |
| **admin** | finance or ops lead | yes | labor rates, settings, roles, close a month, sample data, integrations, plus all manager rights |
| **manager** | account or production manager | yes | jobs, quotes and budgets, costs, revenue, VAS, standards, targets, alerts, imports, exports, edit any production entry |
| **supervisor** | floor lead who logs production | no (per person switch `sees_money` can turn it on) | log and edit production, indirect time and material usage for the last 7 days, import the production stream, see units, hours and productivity |
| **viewer** | read only | per person switch `sees_money`, default off | read every screen, export what they can see |

Action table (`src/lib/permissions.ts`, min role): `pulse:read` viewer · `production:log` supervisor · `production:edit_any` manager ·
`material:log` supervisor · `job:manage` manager · `plan:manage` manager · `cost:manage` manager · `revenue:manage` manager ·
`vas:manage` manager · `standard:manage` manager · `target:manage` manager · `alert:manage` manager · `import:run` manager
(supervisor for streams production, indirect time, materials) · `export:run` viewer · `display:manage` manager · `rate:manage` admin ·
`period:close` admin · `roles:manage` admin · `settings:manage` admin · `sample:manage` admin · `period:reopen` owner or admin ·
`data:purge` owner. `money:read` is not a rank: it is true for owner, admin, manager and for anyone with `sees_money`.

Money hiding is done on the server, never only in the UI. Every DTO builder takes `canSeeMoney`. When false, every money and margin
field is `null`, the DTO carries `moneyHidden: true`, wage and rate endpoints return 403, exports drop money columns, and the UI shows
units, hours and productivity instead. `@kitstak/pulse-bridge` applies the same rule for sibling apps (it takes `userId`).
A unit test walks every DTO type and fails if a `*Cents`, `*Bp` margin or rate field is not null for a no money viewer.

## 4. The cost model

### 4.1 Plain words (this text is also the in-app "How Pulse does the math" page)

- A **job** is one piece of work for one client, like "Build 5,000 holiday gift kits".
- **Money in** is what the client pays: the price per unit times units finished, plus any extra services, plus other fees.
- **Money out** has four buckets: **Labor** (hours times what an hour really costs you), **Materials** (what went into the kits),
  **Other costs** (freight, packaging, outside help), and **Shared time** (meetings, cleanup and waiting, spread across the jobs that ran that day).
- **Profit** is money in minus money out. **Margin** is profit as a share of money in.
- A **loaded labor rate** is the real cost of one hour: the wage, plus payroll taxes and benefits, plus overhead per hour.
- The **quote** is what you promised the client. The **budget** is your own plan. **Actual** is what really happened.
- Pulse watches every open job and says if it is healthy, needs a look, is at risk, or is losing money, and tells you why.

### 4.2 Units and precision

- Totals are `bigint` cents (`*_cents`). Rates per hour are integer cents. Percents are integer basis points (`*_bp`, 2500 = 25%).
- Per unit prices and costs are `numeric(14,4)` in currency units, so $0.0350 per label works. Quantities are `numeric(14,3)`. Hours are `numeric(9,2)`.
- Every product of a quantity and a price is computed once with integer math in `src/lib/money.ts` (scale both to integers, multiply,
  round half away from zero to a cent) and **stamped on the row**. Rollups are plain sums of stamped cents, so every total equals the
  sum of its drill down rows to the cent. JS floats are never used for money. Display uses a fixed `en-US` locale.
- Dates are `date` columns surfaced as `YYYY-MM-DD` strings. "Today" is today in the site time zone.

### 4.3 Loaded labor rate

A labor class (for example Packer, Lead, Forklift, Temp packer) has dated rate rows. For one row:

```
burden_bp      = payroll_tax_bp + benefits_bp + other_burden_bp
loaded_rate    = round(wage_cents * (10000 + burden_bp) / 10000) + overhead_per_hour_cents
overtime_rate  = round(wage_cents * overtime_multiplier * (10000 + burden_bp) / 10000) + overhead_per_hour_cents
```

Temp agency classes (`kind = 'temp_agency'`) put the agency bill rate in `wage_cents` and normally 0 burden. `loaded_rate_cents` and
`overtime_rate_cents` are stored on the row. **Rate that applies to an entry**: the row for the entry's labor class with the latest
`effective_from <= work_date`, preferring a row for the entry's site over an all sites row. No row: the org default rate
(`settings.default_loaded_rate_cents`). No default either: cost is 0 and the entry is flagged `needs_rate` (shows in the Fix list).

### 4.4 Labor cost

Direct labor comes from production entries, VAS entries and imported Projects time. `hours` means total labor hours (people times hours each).

```
labor_cost_cents = round(regular_hours * loaded_rate) + round(overtime_hours * overtime_rate)
regular_hours    = hours - overtime_hours
```

The rate and cost are stamped on the entry (`rate_cents`, `labor_cost_cents`). Adding or changing a rate row restamps every entry of
that class on or after its `effective_from`, except entries in a closed month (a rate may not start inside a closed month).
Entry check shown inline: if `abs(hours - headcount * default_shift_hours) / (headcount * default_shift_hours) > 0.5` Pulse asks
"12 people for 8 hours is 96 hours. You typed 9.6. Is that right?" It is a warning, not a block.

### 4.5 Shared time, paid hours and missing time

- **Indirect entries** are hours not tied to a job (meeting, training, cleanup, waiting, maintenance, break, other), costed with the same rate rule.
- **Shared cost rule** (`settings.shared_cost_rule`):
  - `by_labor_hours` (default): each day and site, that day's indirect cost is spread over the direct entries of that day in
    proportion to their hours, using the largest remainder method so the parts add up to the exact cent. Stamped as `shared_cents`
    on each direct entry. A day with indirect cost and no direct hours stays unallocated and shows as "Shared time not on any job".
  - `percent_of_labor`: `shared_cents = round(labor_cost_cents * shared_pct_bp / 10000)` on each direct entry.
  - `none`: `shared_cents = 0`, indirect cost shows only on the company view.
- **Paid hours** (from a time clock CSV or typed per day, site and labor class) are optional.
  `missing_hours = paid_hours - direct_hours - indirect_hours` per day. Missing time is shown with its cost on Labor and Home, is part of
  the company level profit view as "Paid time not on any job", and is never pushed onto jobs.
- **Utilization** = direct hours / paid hours (or / (direct + indirect) when paid hours are not entered).

### 4.6 Material cost

Each job has `material_method`:
- `standard`: `material_cents = round((units_good + units_scrap) * material_cost_per_unit)` stamped on each production entry
  (`std_material_cents`), with the scrap share kept as `std_scrap_cents`. Use 0 when the client supplies everything.
- `actual`: the sum of material usage rows. `cost_cents = round((quantity_used + quantity_scrapped) * unit_cost)`, with
  `scrap_cents = round(quantity_scrapped * unit_cost)` shown apart. Rows are typed, imported, or pulled from WMS component
  consumption. Rows marked `supplied_by = 'client'` cost 0 and are kept for usage tracking.

WMS pulled rows snapshot the unit cost at first sync (last received PO line cost, else product purchase price) so history does not
move when a product is edited. "Refresh cost" is an explicit action on open months.

### 4.7 Other costs

`pulse.cost_entries`: dated amounts in a category (freight, packaging, equipment, outside service, rework, supplies, storage, other),
tied to a job, or to a client with no job (counts in client profit and cost to serve, not in any job).

### 4.8 Revenue

Per job `pricing_model`:
- `per_unit`: `base_revenue_cents = round(units_good * unit_price)` stamped on each production entry.
- `fixed`: earned by progress. `recognized(d) = round(fixed_price_cents * min(1, cumulative_units_good(d) / planned_units))`; the entry's
  `base_revenue_cents` is `recognized(d) - recognized(previous entry)`. When the job is marked completed, any rest is booked as a
  system revenue entry `kind = 'fixed_true_up'` on the completed date. With `planned_units = 0` all of it is earned on completion.
- `hourly`: `base_revenue_cents = round(hours * bill_rate)` stamped on each entry (bill rate from the job, else the labor class rate row).

Added on top:
- **VAS revenue**: each VAS entry `amount_cents = round(quantity * unit_price)` (or a typed flat amount).
- **Other revenue**: `pulse.revenue_entries` with kind `fee`, `adjustment` or `credit` (credits are negative).
- **Billed revenue**: revenue entries with `kind = 'invoice'` (typed, imported, or pulled from WMS bills). A job with
  `revenue_source = 'billed'` uses invoices in place of base revenue (base stamps are kept for comparison and shown as "Earned, not billed yet").
  Default is `earned`. Client level invoices (no job) count in client profit only.

```
revenue = base_revenue + vas_revenue + other_revenue          (earned)
revenue = invoice_revenue + vas_revenue_not_invoiced + other_revenue   (billed)
```

### 4.9 Cost, profit, margin

```
cost     = labor + material + other + shared
profit   = revenue - cost
margin   = profit / revenue            (shown as "No revenue yet" when revenue = 0)
labor_pct_of_revenue = labor / revenue
cost_per_unit   = cost / units_good
profit_per_unit = profit / units_good
cost_to_serve (client, range) = all cost of the client's jobs + client level costs, also shown per unit and per job
```

One SQL view, **`pulse.v_facts`**, is the single source for every report. It is a `UNION ALL` of stamped rows:
`(org_id, site_id, client_id, job_id, job_type_id, vas_service_id, work_date, kind, amount_cents, units_good, units_scrap, hours, source_table, source_id)`
with `kind` in `revenue_base | revenue_vas | revenue_other | revenue_invoice | labor | material | other | shared`. Profit by job, job type,
client, VAS, site, day, week or month is a `GROUP BY` over this view. Rows with no `vas_service_id` roll up under "Core job work" in
the VAS view so the VAS total equals the company total.

### 4.10 Quote, budget and the two comparison views

Each job can hold two plans (`pulse.job_plans`): the **quote** (what was sold, from the calculator, a CRM deal, a WMS contract rate or typed)
and the **budget** (the internal plan, starts as a copy of the quote, can be revised, each revision is logged). A plan has totals
(units, revenue, labor hours, labor cost, material cost, other cost) and optional lines. With lines, totals are the sum of lines.

Both views use the same table and rows: **Units, Labor hours, Units per labor hour, Labor cost, Material cost, Other cost,
Shared cost, Total cost, Revenue, Profit, Margin**, with columns **Plan, Actual, Difference, Difference %, Projected at finish**, and a
good or bad tone per row. For an open job the Plan column can be switched between "Whole job" and "For the work done so far"
(flexed: plan x units_good / plan units), default "For the work done so far" so a half done job is judged fairly.

```
variance_cents = actual - plan          variance_pct = variance / |plan|
cost rows are bad when actual > plan; revenue, profit, units, units per hour are bad when actual < plan
```

Quote vs actual adds a per line table when the quote has lines (line, quoted quantity, quoted amount, actual amount matched by category,
labor class, VAS service or item) and a "Quote to budget" strip that shows any gap between what was sold and what was planned.

### 4.11 Variance waterfall (why profit differs from plan)

For a job with plan B and actual A. `U` units good, `R` revenue, `H` labor hours, `L` labor cost, `M` material, `O` other + shared.
`f = U_a / U_b` (flex factor), `rate_b = L_b / H_b`.

```
volume           = (U_a - U_b) * (R_b - L_b - M_b - O_b) / U_b
price            = R_a - R_b * f
labor_rate       = -(L_a - H_a * rate_b)
labor_efficiency = -(H_a - H_b * f) * rate_b
material         = -(M_a - M_b * f)
other            = (profit_a - profit_b) - (volume + price + labor_rate + labor_efficiency + material)
```

Each term is rounded to a cent; `other` is the balancing term, so the bars always add up to actual profit minus plan profit exactly.
Edge rules: `U_b = 0` gives `f = 1` and `volume = 0`; `H_b = 0` or `H_a = 0` gives `labor_rate = 0` and all labor difference in efficiency.
Each bar has a one line plain reading, for example "Labor efficiency: the crew needed 46 more hours than planned for this many units. That cost $1,104."
For open jobs a switch shows "So far" or "At finish" (uses the projected numbers below as A). The same math runs on a client, job type or month by summing plans and actuals.

### 4.12 Productivity

```
units_per_labor_hour (UPH) = units_good / direct_hours
standard UPH for an entry  = job.standard_uph
                             else the best matching row in pulse.standards effective on the date
                               (job type + client + item, then job type + client, then job type; VAS rows match on service)
                             else budget units / budget labor hours
productivity_pct = UPH / standard UPH        earned_hours = units_good / standard UPH
labor_cost_per_unit = labor / units_good     target cost per unit = from pulse.targets, flagged when actual is above it
```

### 4.13 Projected finish (estimate at completion)

For an active job with `planned_units > 0`:

```
units_left      = max(0, planned_units - units_good)
pace_uph        = UPH over the last 5 work days that have hours
                  else UPH to date, else budget UPH, else standard UPH, else unknown
hours_left      = units_left / pace_uph
labor_left      = hours_left * (L_a / H_a, else budget rate, else org default loaded rate)
shared_left     = hours_left * (shared_a / H_a)
material_left   = units_left * (M_a / (units_good + units_scrap), else budget material per unit, else job material_cost_per_unit)
other_left      = max(0, O_budget - O_actual)
cost_at_finish  = cost_so_far + labor_left + shared_left + material_left + other_left
revenue_at_finish = per_unit: revenue_so_far + units_left * unit_price
                    fixed:    fixed_price + VAS and other revenue so far
                    hourly:   revenue_so_far + hours_left * bill_rate
projected_profit = revenue_at_finish - cost_at_finish      projected_margin = projected_profit / revenue_at_finish
units_per_day    = average units_good per work day over the last 5 work days with production
projected_finish_date = today + ceil(units_left / units_per_day) work days (settings.working_days)
```

When pace is unknown the projection equals the budget and is labeled "Based on the plan. Log a day of work to see the real pace."
The job page says in words what was assumed: "We assume the rest of the job runs like your last 5 work days: 41 units per labor hour."

### 4.14 Risk status (exact rules)

Target margin for a job: `job.target_margin_bp`, else job type, else client, else `settings.default_target_margin_bp` (3000).
Thresholds live in `pulse.settings` and are editable. Rules run in this order; the first status with a matching rule wins.
Completed jobs use actual numbers in place of projected. Planned, on hold and cancelled jobs have no status.

| Status | Rule (any one) | Reason text (generated, with real numbers) |
|---|---|---|
| **Losing money** (`losing`) | L1 `projected_profit < 0` | "At this pace the job ends about $1,840 in the red. It costs $3.12 a unit to make and sells for $2.75." |
| | L2 job completed and `profit < 0` | "This job lost $620. Labor ran 31% over the budget." |
| **At risk** (`at_risk`) | R1 `projected_margin < target - at_risk_gap_bp` (default 10 points) | "Margin is heading for 14%. Your target is 30%." |
| | R2 `projected_margin < margin_floor_bp` (default 10%) | "Margin is heading for 6%, under your 10% floor." |
| | R3 projected labor hours > plan hours x (1 + `labor_risk_over_bp`, default 15%) | "Labor is 22% over budget with 40% of the units left." |
| | R4 productivity over the last 5 work days < `productivity_risk_bp` (default 80%) of standard | "The crew is making 31 units per labor hour. The standard is 42." |
| | R5 `projected_finish_date > due_date` | "At this pace the job finishes Dec 9. It is due Dec 2." |
| | R6 linked WMS work order is in Shortage | "The warehouse is short on parts for this job." |
| **Watch** (`watch`) | W1 `projected_margin < target` | "Margin is heading for 26%, a little under your 30% target." |
| | W2 projected labor hours over plan by `labor_watch_over_bp` (5%) to the risk line | "Labor is 8% over budget so far." |
| | W3 productivity between the risk line and `productivity_watch_bp` (95%) | "The crew is a bit under the standard: 39 of 42 units per labor hour." |
| | W4 material cost per unit > plan by `material_watch_over_bp` (5%) | "Materials cost $1.42 a unit. The plan was $1.30." |
| | W5 no production entry for `no_entry_days` (3) work days | "Nothing has been logged for 4 work days." |
| | W6 due in 3 work days or less and under 90% done | "Due Friday and 72% done." |
| | W7 missing data: no price, no plan, or hours with no rate | "This job has no price yet, so Pulse cannot work out profit." |
| **Healthy** (`healthy`) | none of the above | "On track. Margin is heading for 34% against a 30% target." |

Every matching rule yields a reason with an `impact_cents` (its effect on projected profit, 0 for date and data rules). The reason with
the largest impact is the headline; up to three show on the job. Each rule also carries a **next step** ("Check the crew size",
"Review the price with the client", "Log the missing days", "Add a labor rate"). Status, reasons, projection and all job totals are
cached in `pulse.job_stats`, rebuilt in the same transaction as any write that touches the job (`recomputeJob`), and by the nightly cron
(date based rules). `src/lib/calc/*` holds every formula in this section as pure functions with unit tests.

### 4.15 Explain this number

Every money figure, margin and status in the UI has a "How we got this" popover fed by `explain(metric, scope)`: the formula in words, the
same formula with the real figures, and a link to the rows behind it. Example: "Labor cost $4,212.00 = 162.0 hours x $26.00 an hour.
$26.00 = $19.50 wage + 21% taxes and benefits + $2.40 overhead. See 14 entries."

### 4.16 Month close

`pulse.periods` holds one row per calendar month. Closing a month (admin) checks the Fix list, stores a snapshot of totals, and locks
every entry dated in that month: edits, deletes, imports, sync writes and rate changes that would touch it are refused with
"October is closed. Ask an admin to reopen it." Reopen needs a reason and is logged. Reports mark closed months with a lock.

## 5. Data model (`pulse` schema)

House rules: uuid PK `gen_random_uuid()`; `org_id uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE` on every table and
in every query; `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`; soft delete `deleted_at timestamptz` where marked (SD);
enums are `text` + CHECK mirrored in Drizzle; hand-written SQL in `apps/pulse/drizzle/0000_pulse_init.sql` with
`--> statement-breakpoint`, mirrored for types in `src/server/db/schema/*.ts`; RLS enabled on every table with no policies; never
`drizzle-kit push`. `pulse.activity` is append only (trigger enforced). User ids reference `core."user"(id)`.

**Stream columns** (on every table marked STREAM): `source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv','wms','crm','projects','system','sample'))`,
`source_ref text` (stable key in the source system), `import_batch_id uuid REFERENCES pulse.import_batches`, `is_sample boolean NOT NULL DEFAULT false`,
`created_by uuid`, `updated_by uuid`, and a partial unique index `(org_id, source, source_ref) WHERE source_ref IS NOT NULL AND deleted_at IS NULL`
so every sync and re-import is an upsert, never a duplicate.

### 5.1 Setup tables

**`pulse.settings`** (PK `org_id`): `currency text DEFAULT 'USD'`, `timezone text DEFAULT 'America/Chicago'`, `week_start smallint DEFAULT 1 CHECK (0..6)`,
`fiscal_year_start_month smallint DEFAULT 1`, `working_days smallint[] DEFAULT '{1,2,3,4,5}'`, `default_shift_hours numeric(4,2) DEFAULT 8`,
`default_payroll_tax_bp int DEFAULT 900`, `default_benefits_bp int DEFAULT 1200`, `default_other_burden_bp int DEFAULT 0`,
`default_overhead_per_hour_cents int DEFAULT 0`, `default_overtime_multiplier numeric(3,2) DEFAULT 1.50`, `default_loaded_rate_cents int`,
`default_target_margin_bp int DEFAULT 3000`, `margin_floor_bp int DEFAULT 1000`, `at_risk_gap_bp int DEFAULT 1000`,
`labor_watch_over_bp int DEFAULT 500`, `labor_risk_over_bp int DEFAULT 1500`, `productivity_watch_bp int DEFAULT 9500`,
`productivity_risk_bp int DEFAULT 8000`, `material_watch_over_bp int DEFAULT 500`, `no_entry_days smallint DEFAULT 3`,
`shared_cost_rule text DEFAULT 'by_labor_hours' CHECK (IN ('none','by_labor_hours','percent_of_labor'))`, `shared_pct_bp int DEFAULT 0`,
`default_member_role text DEFAULT 'manager' CHECK (IN ('manager','supervisor','viewer','none'))`,
`job_number_prefix text DEFAULT 'J-'`, `job_seq int DEFAULT 1000`, `date_order text DEFAULT 'MDY' CHECK (IN ('MDY','DMY'))`,
`we_sell_kits boolean DEFAULT false`, `wms_auto_create_jobs boolean DEFAULT true`, `wms_sync_materials boolean DEFAULT true`,
`wms_sync_vas boolean DEFAULT true`, `wms_sync_billing boolean DEFAULT true`, `crm_suggest_jobs boolean DEFAULT true`,
`projects_time_import boolean DEFAULT true`, `onboarding jsonb DEFAULT '{}'`, `sample_loaded_at timestamptz`. Created lazily on first read.

**`pulse.member_roles`**: `user_id uuid NOT NULL`, `role text CHECK (IN ('owner','admin','manager','supervisor','viewer','none'))`,
`sees_money boolean NOT NULL DEFAULT false`, `site_ids uuid[]` (null = all sites), `updated_by`. Unique `(org_id, user_id)`.

**`pulse.sites`** (SD): `code text`, `name text`, `timezone text`, `is_default boolean`, `wms_warehouse_id text`, `archived_at`. Unique `(org_id, lower(code))` live.
One default site is created with the org ("Main site"), so single site shops never see the word site.

**`pulse.clients`** (SD, STREAM): `code text NOT NULL`, `name text NOT NULL`, `status text DEFAULT 'active' CHECK (IN ('active','inactive'))`,
`contact_name`, `contact_email`, `phone`, `target_margin_bp int`, `payment_terms_days int`, `notes text`, `color text`,
`core_customer_id uuid REFERENCES core.customers(id) ON DELETE SET NULL`, `crm_account_item_id uuid` (no FK, CRM may be absent).
Unique live: `(org_id, lower(code))`, `(org_id, core_customer_id)`, `(org_id, crm_account_item_id)`. Index `(org_id, lower(name))`.
The client key for the whole suite is `core.customers.id` when it exists (it equals `wms.clients.id`); CRM only orgs link by account item.

**`pulse.job_types`** (SD): `code`, `name`, `unit_label text DEFAULT 'units'`, `default_pricing_model`, `default_labor_class_id`,
`default_standard_uph numeric(12,3)`, `target_margin_bp int`, `color text`, `icon text`, `position int`, `archived_at`. Unique `(org_id, lower(code))` live.

**`pulse.labor_classes`** (SD): `code`, `name`, `kind text DEFAULT 'employee' CHECK (IN ('employee','temp_agency'))`, `is_default boolean`,
`color`, `archived_at`. Unique `(org_id, lower(code))` live.

**`pulse.labor_rates`** (SD, STREAM): `labor_class_id uuid NOT NULL`, `site_id uuid` (null = all sites), `effective_from date NOT NULL`,
`wage_cents int NOT NULL CHECK (>= 0)`, `payroll_tax_bp int`, `benefits_bp int`, `other_burden_bp int`, `overhead_per_hour_cents int`,
`overtime_multiplier numeric(3,2)`, `loaded_rate_cents int NOT NULL`, `overtime_rate_cents int NOT NULL`, `bill_rate_cents int`, `note text`.
Unique live `(org_id, labor_class_id, coalesce(site_id, zero uuid), effective_from)`. Index `(org_id, labor_class_id, effective_from DESC)`.

**`pulse.items`** (SD, STREAM): material catalog. `sku`, `name`, `uom text DEFAULT 'each'`, `unit_cost numeric(14,4)`, `cost_updated_at`,
`client_id uuid`, `core_item_id uuid`, `wms_product_id text`. Unique `(org_id, lower(sku))` live.

**`pulse.vas_services`** (SD, STREAM): `code`, `name`, `unit_label text DEFAULT 'units'`, `billing text CHECK (IN ('per_unit','per_hour','flat'))`,
`default_price numeric(14,4)`, `default_cost_per_unit numeric(14,4)`, `standard_uph numeric(12,3)`, `default_labor_class_id`,
`wms_vas_type_id text`, `color`, `active boolean DEFAULT true`. Unique `(org_id, lower(code))` live.

**`pulse.standards`** (SD, STREAM): `job_type_id uuid`, `client_id uuid`, `item_id uuid`, `vas_service_id uuid`, `labor_class_id uuid`,
`units_per_labor_hour numeric(12,3) NOT NULL CHECK (> 0)`, `effective_from date NOT NULL`, `basis text CHECK (IN ('typed','history','time_study'))`,
`note`. CHECK at least one of job type or VAS service is set. Index `(org_id, job_type_id, client_id, effective_from DESC)`.

**`pulse.targets`** (STREAM): `scope text CHECK (IN ('org','site','client','job_type','vas_service'))`, `scope_id uuid`, `metric text CHECK (IN
('margin_pct','profit','revenue','units_per_labor_hour','labor_pct_of_revenue','cost_per_unit','utilization_pct'))`, `period_month date` (first of month, null = every month),
`value numeric(16,4) NOT NULL`. Unique `(org_id, scope, coalesce(scope_id, zero uuid), metric, coalesce(period_month, '0001-01-01'))`.

### 5.2 Jobs and plans

**`pulse.jobs`** (SD, STREAM): `number text NOT NULL` (auto `J-1001`, or the user's or WMS code such as `WO000088`), `name text NOT NULL`,
`client_id uuid NOT NULL`, `job_type_id uuid NOT NULL`, `site_id uuid NOT NULL`, `status text DEFAULT 'planned' CHECK (IN
('planned','active','on_hold','completed','cancelled'))`, `pricing_model text DEFAULT 'per_unit' CHECK (IN ('per_unit','fixed','hourly'))`,
`revenue_source text DEFAULT 'earned' CHECK (IN ('earned','billed'))`, `unit_label text DEFAULT 'units'`, `planned_units numeric(14,3) DEFAULT 0`,
`unit_price numeric(14,4)`, `fixed_price_cents bigint`, `bill_rate_cents int`, `material_method text DEFAULT 'standard' CHECK (IN ('standard','actual'))`,
`material_cost_per_unit numeric(14,4) DEFAULT 0`, `default_labor_class_id uuid`, `default_headcount int`, `standard_uph numeric(12,3)`,
`target_margin_bp int`, `start_date date`, `due_date date`, `completed_date date`, `po_number text`, `owner_id uuid`, `description text`,
`kit_sku text`, `kit_name text`, `wms_shortage boolean DEFAULT false`, `time_import boolean DEFAULT true`, `pinned_note text`, `archived_at`.
Unique live `(org_id, lower(number))`. Indexes `(org_id, status)`, `(org_id, client_id)`, `(org_id, job_type_id)`, `(org_id, due_date)`,
trigram or `lower(name)` index for search. A job URL accepts the uuid or the number.

**`pulse.job_plans`**: `job_id uuid NOT NULL`, `plan text NOT NULL CHECK (IN ('quote','budget'))`, `units numeric(14,3)`, `revenue_cents bigint`,
`labor_hours numeric(10,2)`, `labor_cents bigint`, `material_cents bigint`, `other_cents bigint`, `shared_cents bigint DEFAULT 0`, `version int DEFAULT 1`,
`origin text CHECK (IN ('typed','csv','calculator','crm_deal','wms_contract','copied_from_quote','sample'))`, `origin_ref text`, `note`, `locked_at`, `updated_by`.
Unique `(job_id, plan)`. Every change writes the old and new totals to `pulse.activity` (`plan.revised`), which is the revision history.

**`pulse.job_plan_lines`**: `plan_id uuid NOT NULL ON DELETE CASCADE`, `job_id`, `position int`, `category text CHECK (IN ('revenue','labor','material','other'))`,
`description text`, `quantity numeric(14,3)`, `unit text CHECK (IN ('unit','hour','each','flat'))`, `unit_amount numeric(14,4)`, `amount_cents bigint NOT NULL`,
`labor_class_id`, `vas_service_id`, `item_id`. Plan totals: units = sum of quantity on revenue lines with unit `unit`; labor hours = sum of quantity on labor lines.

**`pulse.job_links`**: `job_id uuid NOT NULL ON DELETE CASCADE`, `target_type text CHECK (IN ('crm_deal','crm_account','wms_work_order','wms_shipment_order',
'wms_client','pm_project','pm_task'))`, `target_id text NOT NULL`, `cached_title`, `cached_status`, `cached_url text` (a path, the host is added at read time),
`cached_at`, `meta jsonb`, `created_by`. Unique `(job_id, target_type, target_id)`; partial unique `(org_id, target_id) WHERE target_type = 'wms_work_order'`
(one job per work order). Index `(org_id, target_type, target_id)`.

**`pulse.job_stats`** (PK `job_id`): cached rollup, rebuilt by `recomputeJob`. `units_good`, `units_scrap`, `units_rework`, `hours`, `overtime_hours`,
`revenue_cents`, `base_revenue_cents`, `vas_revenue_cents`, `other_revenue_cents`, `invoice_revenue_cents`, `labor_cents`, `material_cents`, `scrap_cents`,
`other_cents`, `shared_cents`, `cost_cents`, `profit_cents`, `margin_bp`, `uph numeric(12,3)`, `standard_uph`, `productivity_bp`, `pct_complete_bp`,
`cost_at_finish_cents`, `revenue_at_finish_cents`, `projected_profit_cents`, `projected_margin_bp`, `projected_finish_date`, `pace_uph`, `pace_basis text`,
`risk_status text CHECK (IN ('healthy','watch','at_risk','losing'))`, `risk_reasons jsonb` (`[{rule, text, nextStep, impactCents}]`), `needs jsonb`
(Fix list flags), `first_entry_date`, `last_entry_date`, `entry_count int`, `computed_at`. Index `(org_id, risk_status)`. A test proves it equals the sum over `v_facts`.

### 5.3 Data streams (all SD + STREAM, all carry `site_id`, all reject writes into a closed month)

**`pulse.production_entries`**: the daily entry. `job_id uuid NOT NULL`, `work_date date NOT NULL`, `shift text DEFAULT 'day'`, `crew text DEFAULT ''`,
`labor_class_id uuid`, `vas_service_id uuid`, `units_good numeric(14,3) DEFAULT 0 CHECK (>= 0)`, `units_scrap numeric(14,3) DEFAULT 0`,
`units_rework numeric(14,3) DEFAULT 0`, `headcount numeric(6,2)`, `hours numeric(9,2)`, `overtime_hours numeric(9,2) DEFAULT 0 CHECK (overtime_hours <= hours)`,
`hours_confirmed boolean DEFAULT true` (false for WMS pulled rows that still need crew hours), `note text`,
stamps: `rate_cents int`, `overtime_rate_cents int`, `labor_cost_cents bigint DEFAULT 0`, `shared_cents bigint DEFAULT 0`, `base_revenue_cents bigint DEFAULT 0`,
`std_material_cents bigint DEFAULT 0`, `std_scrap_cents bigint DEFAULT 0`, `needs_rate boolean DEFAULT false`, `entered_by uuid`.
Unique live `(org_id, job_id, work_date, shift, crew)`: one row per job, day, shift and crew; a mixed crew is two rows with different crew or labor class labels.
Indexes `(org_id, work_date)`, `(org_id, job_id, work_date)`.

**`pulse.indirect_entries`**: `work_date`, `labor_class_id`, `reason text CHECK (IN ('meeting','training','cleanup','waiting','maintenance','break','other'))`,
`headcount`, `hours numeric(9,2) NOT NULL`, `overtime_hours`, `note`, stamps `rate_cents`, `cost_cents bigint`, `needs_rate`. Index `(org_id, site_id, work_date)`.

**`pulse.paid_hours`**: `work_date`, `labor_class_id` (null = all), `paid_hours numeric(9,2) NOT NULL`, `paid_cents bigint` (optional real gross pay).
Unique live `(org_id, site_id, work_date, coalesce(labor_class_id, zero uuid))`.

**`pulse.material_usage`**: `job_id uuid NOT NULL`, `usage_date date NOT NULL`, `item_id uuid`, `item_sku text`, `item_name text`, `quantity_used numeric(14,3) NOT NULL`,
`quantity_scrapped numeric(14,3) DEFAULT 0`, `quantity_planned numeric(14,3)`, `unit_cost numeric(14,4) NOT NULL DEFAULT 0`, `uom text`, `lot text`,
`supplied_by text DEFAULT 'us' CHECK (IN ('us','client'))`, `note`, stamps `cost_cents bigint`, `scrap_cents bigint`. Index `(org_id, job_id, usage_date)`.

**`pulse.cost_entries`**: `job_id uuid`, `client_id uuid`, CHECK one of them is set, `cost_date date NOT NULL`, `category text CHECK (IN ('freight','packaging',
'equipment','outside_service','rework','supplies','storage','other'))`, `amount_cents bigint NOT NULL`, `vendor text`, `reference text`, `note`. Index `(org_id, job_id, cost_date)`, `(org_id, client_id, cost_date)`.

**`pulse.revenue_entries`**: `job_id uuid`, `client_id uuid NOT NULL`, `revenue_date date NOT NULL`, `kind text CHECK (IN ('invoice','fee','adjustment','credit','fixed_true_up'))`,
`description text`, `quantity numeric(14,3)`, `unit_price numeric(14,4)`, `amount_cents bigint NOT NULL`, `invoice_number text`, `vas_service_id uuid`,
`service_label text` (for WMS bill operation types such as Storage), `approved boolean DEFAULT true`, `note`. Index `(org_id, job_id, revenue_date)`, `(org_id, client_id, revenue_date)`.

**`pulse.vas_entries`**: `vas_service_id uuid NOT NULL`, `client_id uuid NOT NULL`, `job_id uuid`, `work_date date NOT NULL`, `quantity numeric(14,3) NOT NULL`,
`unit_price numeric(14,4)`, `amount_cents bigint` (null = "No price set yet", listed in the Fix list), `labor_class_id`, `headcount`, `hours numeric(9,2) DEFAULT 0`,
`material_cents bigint DEFAULT 0`, `note`, stamps `rate_cents`, `labor_cost_cents bigint DEFAULT 0`, `shared_cents bigint DEFAULT 0`. Index `(org_id, vas_service_id, work_date)`, `(org_id, client_id, work_date)`.

**`pulse.v_facts`** (view): the union described in 4.9 over production entries (base revenue, labor, standard material, shared), indirect is not included
(it is already inside `shared_cents`; unallocated indirect and missing time are read from their own tables for the company view), material usage (when the job
method is `actual`), cost entries, revenue entries, VAS entries (revenue, labor, material, shared). The method switch lives in the view so a job never double counts materials.

### 5.4 Control, workflow and system tables

**`pulse.periods`**: `period_month date NOT NULL` (first of month), `status text DEFAULT 'open' CHECK (IN ('open','closed'))`, `closed_at`, `closed_by`,
`reopened_at`, `reopened_by`, `reopen_reason text`, `snapshot jsonb` (totals by client, job type and VAS at close), `checklist jsonb`. Unique `(org_id, period_month)`.
A `BEFORE INSERT OR UPDATE OR DELETE` trigger on every stream table raises when the row date falls in a closed month (defense in depth behind the domain check).

**`pulse.alert_rules`** (SD): `name`, `kind text CHECK (IN ('job_losing','job_at_risk','margin_below','labor_over_budget','material_over_budget','productivity_below',
'no_entry_days','due_soon_behind','missing_rate','missing_price','client_margin_below','vas_margin_below','missing_time_above','wms_shortage','deal_won_no_job',
'month_ready_to_close','import_failed','sync_failed'))`, `threshold numeric(16,4)`, `scope jsonb` (client, job type, site filters), `severity text CHECK (IN ('info','warning','critical'))`,
`notify_roles text[]`, `notify_user_ids uuid[]`, `enabled boolean DEFAULT true`, `is_system boolean`. Ten system rules are created with the org and can be tuned or turned off.

**`pulse.alerts`**: `rule_id`, `kind`, `severity`, `entity_type text CHECK (IN ('job','client','vas_service','site','period','import','sync','deal'))`, `entity_id text`,
`title text`, `body text`, `next_step text`, `impact_cents bigint`, `url text`, `status text DEFAULT 'open' CHECK (IN ('open','snoozed','resolved','dismissed'))`,
`snoozed_until date`, `assigned_to uuid`, `resolved_at`, `resolved_by`, `resolution text CHECK (IN ('cleared','manual'))`, `dedupe_key text NOT NULL`, `first_seen_at`, `last_seen_at`,
`pm_task_id uuid`. Unique `(org_id, dedupe_key) WHERE status IN ('open','snoozed')`: a condition makes one alert, updates it while it lasts, and resolves it by itself when it clears.

**`pulse.notifications`**: `user_id uuid NOT NULL`, `kind`, `title`, `body`, `url`, `alert_id`, `job_id`, `read_at`, `archived_at`. Index `(org_id, user_id, read_at)`. Never notify the actor.

**`pulse.import_batches`**: `stream text NOT NULL`, `file_name`, `file_size int`, `delimiter text`, `header jsonb`, `mapping jsonb`, `options jsonb` (`{mode: 'all_or_nothing' | 'skip_bad_rows', dateOrder}`),
`status text CHECK (IN ('uploaded','mapped','checked','committed','failed','undone'))`, `total_rows`, `create_count`, `update_count`, `unchanged_count`, `skip_count`, `error_count`, `warning_count`,
`committed_at`, `undone_at`, `undo_until`, `created_by`. Index `(org_id, created_at DESC)`.
**`pulse.import_rows`**: `batch_id uuid NOT NULL ON DELETE CASCADE`, `row_number int`, `raw jsonb`, `parsed jsonb`, `action text CHECK (IN ('create','update','unchanged','skip','error'))`,
`messages jsonb` (`[{level, column, text}]`), `entity_id uuid`, `before jsonb` (for undo). Index `(batch_id, row_number)`, `(batch_id, action)`.
**`pulse.import_presets`**: `stream`, `name`, `header_signature text` (sorted lowercased header hash), `mapping jsonb`, `options jsonb`, `last_used_at`. Unique `(org_id, stream, name)`.

**`pulse.saved_views`** (SD): `user_id`, `page text CHECK (IN ('jobs','profit','log','clients','vas','labor','reports','alerts'))`, `name`, `config jsonb` (filters, sort, group, columns, date range),
`shared boolean`, `is_default boolean`, `position int`.

**`pulse.activity`** (append only): `actor_id uuid`, `actor_kind text` (`user|system|integration|automation`), `verb text` (dotted: `job.created`, `production.logged`, `rate.changed`,
`plan.revised`, `period.closed`, `import.committed`, `role.changed`, `note.added`), `entity_type text`, `entity_id uuid`, `job_id uuid`, `client_id uuid`, `field text`,
`before jsonb`, `after jsonb`, `meta jsonb`, `body text` (for notes), `created_at`. Indexes `(org_id, created_at DESC)`, `(org_id, job_id, created_at DESC)`, `(org_id, entity_type, entity_id)`.
This is both the audit log and the job activity feed. Money values inside `before` and `after` are hidden for readers without `money:read`.

**`pulse.user_prefs`** (PK `org_id, user_id`): `prefs jsonb` (default site, default date range, log grid columns, pinned jobs, recents, hidden tips, notification switches per alert kind, digest cadence).

**`pulse.quote_scenarios`** (SD): `name`, `client_id`, `job_type_id`, `job_id` (what-if on a real job), `inputs jsonb`, `result jsonb`, `status text CHECK (IN ('draft','sent','won','lost'))`,
`crm_deal_item_id uuid`, `created_by`.

**`pulse.report_schedules`** (SD): `name`, `report text`, `config jsonb`, `cadence text CHECK (IN ('daily','weekly','monthly'))`, `weekday smallint`, `day_of_month smallint`, `hour smallint`,
`recipients text[]`, `format text CHECK (IN ('csv','html','both'))`, `include_money boolean`, `enabled boolean`, `last_run_at`, `next_run_at`, `created_by`.
**`pulse.report_runs`**: `schedule_id`, `report`, `period_label`, `csv text`, `html text`, `subject text`, `row_count`, `status text CHECK (IN ('ready','sent','failed'))`, `error`, `created_at`.

**`pulse.display_tokens`** (SD): wall display links. `name`, `token_hash text NOT NULL UNIQUE`, `site_id`, `config jsonb` (panels, rotate seconds), `expires_at`, `last_seen_at`, `created_by`.
Token pages never return money.

**`pulse.sync_state`** (PK `org_id, source`): `source text CHECK (IN ('wms','crm','projects'))`, `cursor jsonb`, `last_run_at`, `last_ok_at`, `last_status text`, `last_error text`, `counts jsonb`.
**`pulse.sync_runs`**: `source`, `started_at`, `finished_at`, `status`, `created int`, `updated int`, `skipped int`, `error text`, `trigger text CHECK (IN ('cron','manual','page','event'))`.
**`pulse.dismissals`**: `kind text`, `target_id text`, `user_id uuid` (null = for the whole org), unique `(org_id, kind, target_id, coalesce(user_id, zero uuid))`. Used for suggested jobs and tips.
**`pulse.bridge_events`**: inbox for sibling app pushes. `kind text CHECK (IN ('wms_work_order_changed','crm_deal_stage_changed','pm_time_logged'))`, `target_id text`, `payload jsonb`, `processed_at`. Index `(org_id, processed_at)`.

## 6. Product surface (every route is real, working and persisted)

Shell: house sidebar and top bar. Top bar primary button **Log production**. Sidebar: Home · Jobs (badge: at risk + losing count) · Log production ·
Profit · Clients · Services · Labor · Standards · Calculator · Scorecards · Alerts (badge: open) · Reports · Import and export · Settings.
Supervisors without money see: Home, Jobs, Log production, Labor (time tab only), Standards, Alerts, Import and export.
A global filter bar (date range presets: this week, last week, this month, last month, last 90 days, this year, custom; site; client; job type; status)
lives in the URL query string on every list, chart and report, so any view can be bookmarked, shared and exported as seen.

| Route | What is on it |
|---|---|
| `/` **Home** | Greeting and the one line answer: "You made $48,210 this month at a 31% margin. 3 jobs need you." KPI tiles (revenue, cost, profit, margin, units per labor hour, labor as % of revenue) each with change vs the prior period and a sparkline; profit trend chart (day, week, month); **Jobs that need you** (worst first, reason, projected profit, one click to the job); today's entry progress ("7 of 9 active jobs logged today"); best and worst clients and job types; cost split bar; missing time tile; Fix list; open alerts; setup checklist until done. No money role: units, hours, productivity vs standard and entry progress instead. |
| `/jobs` **Jobs** | Tabs **Open** (default, the at risk list: sorted worst first by status then projected profit; columns job, client, type, status pill with reason, % done bar, units, labor hours vs plan, margin so far, projected margin, projected profit, due, last entry), **All**, **Completed**, **Planned**. Chips to filter by status ("Losing money 3", "At risk 5", "Watch 6", "Healthy 22"). Search, column picker, sort, group by client or type, saved views, bulk actions (set status, set owner, export), CSV export of the current view. Row hover shows the top three reasons and next step. |
| `/jobs/new` | Three step wizard: 1 Basics (client, job type, name, units, dates), 2 Price and plan (pricing model, price, quick plan: labor hours or units per labor hour, crew class, material cost per unit, other costs; live margin preview against target), 3 Links (CRM deal, WMS work order, Projects project, all optional and hidden when the app is absent). Prefills from `?crmDeal=`, `?wmsWorkOrder=`, `?project=`, `?scenario=`, `?client=`, `?name=`, `?value=`. Also "Copy an old job". |
| `/jobs/[ref]` **Overview** | Header: number, name, client, type, status menu, risk pill, owner, due, linked record chips (CRM deal, WMS work order, Projects project, each opens the sibling in a new tab). Verdict card: status, the reasons in words, next steps, projected profit and margin, projected finish date, the assumption sentence. Tiles: revenue, cost, profit, margin, units done of planned, units per labor hour vs standard. Cost split bar, cumulative revenue vs cost chart with the plan line, variance waterfall, last 7 entries, quick actions (Log today, Add cost, Add revenue, Add service, What if). |
| `/jobs/[ref]/budget` **Budget vs actual** | The table in 4.10 against the budget, "Whole job" or "For the work done so far" switch, projected at finish column, waterfall, budget editor (totals or lines), "Copy the quote into the budget", revision history. |
| `/jobs/[ref]/quote` **Quote vs actual** | Same table against the quote, per line quote table, quote to budget gap strip, source of the quote (calculator scenario, CRM deal value with a "Deal value changed in CRM" notice, WMS contract rate, typed). |
| `/jobs/[ref]/production` | Daily entries table with inline edit, add, delete with undo; daily chart of units and units per labor hour vs the standard line; totals; rows from WMS that still need crew hours are marked "Add hours"; CSV export. |
| `/jobs/[ref]/materials` | Method switch (standard per unit or actual usage). Standard: cost per unit, units, scrap. Actual: usage rows (item, used, scrapped, unit cost, cost, supplied by), planned vs used per item, scrap cost, WMS sync state and "Refresh from WMS". |
| `/jobs/[ref]/labor` | Hours and cost by day and labor class, rate applied on each entry with its source, overtime, shared cost share, labor cost per unit trend, Projects time imported for the linked project. |
| `/jobs/[ref]/revenue` **Revenue and VAS** | Pricing model editor, earned revenue by day, billed invoices, earned vs billed, service (VAS) entries with their own revenue, cost and margin, other fees and credits. |
| `/jobs/[ref]/activity` | Audit feed (who changed what, before and after) and notes with a composer. |
| `/log` **Daily production entry** | The day grid: one row per active job for the chosen date and site (date picker, previous and next day keys). Columns: job, units good, scrap, rework, headcount, hours, overtime, labor class, note, plus a live "today" readout (units per labor hour vs standard, colored). Keyboard only entry (Tab, Enter moves down, arrows), type to find a job, "Copy yesterday's crew", "Add a crew line", paste from a spreadsheet, autosave per row with a saved tick and undo, inline checks (see 4.4), WMS prefilled units and hour hints, an "Other time" strip for indirect time and paid hours for the day, day totals, "Mark day complete". Saving a row is typing plus Enter. |
| `/log/kiosk` | Tablet mode, full screen, large touch targets: pick a job card, number pad for units, steppers for people and hours, Save. One job at a time, big confirmation, next job. Works in portrait, stays signed in, no money anywhere. |
| `/log/entries` | Every entry across days with filters, bulk edit, bulk delete with undo, export. |
| `/profit` **Profit explorer** | `?by=job|type|client|vas|site|month|week|day`. Ranking bar chart (profit or margin, best and worst switch) above a table: revenue, labor, material, other, shared, cost, profit, margin, units, units per labor hour, labor as % of revenue, change vs prior period, trend sparkline. Click a row to drill: client to its jobs to its daily entries. A breadcrumb shows the path and totals always match the level above. Compare to prior period or plan. Company view row shows unallocated shared time and missing time. Export. |
| `/clients`, `/clients/[id]` | Client list with profit, margin, cost to serve, open jobs, at risk count. Client page: tiles, trend, plan vs actual profit for the period, labor as % of revenue, cost to serve per unit and per job, jobs table, services table, client level revenue and costs, contact, links to the CRM account and WMS client, target margin, activity. |
| `/vas`, `/vas/[id]` **Services** | Service catalog (price, unit, standard) and profit by service: revenue per unit, cost per unit, margin, volume, trend, clients using it. Service page: entries, add entry, unpriced entries to fix, WMS operations pulled. |
| `/labor` | Tabs **Rates** (labor classes and the rate builder: wage, payroll tax %, benefits %, other %, overhead per hour, overtime multiplier, live "one hour really costs $26.00" readout, effective date timeline, history), **Time** (direct vs indirect vs missing hours by day, utilization, indirect by reason, paid hours entry), **Cost** (labor cost by class, job type and client, overtime share). Rates tab needs `rate:manage` and is hidden without `money:read`. |
| `/standards` | Units per labor hour standards by job type, client, item and service with effective dates; "Suggest from history" (median of the last 20 work days, shows the spread, one click to accept); productivity vs standard table and chart by job, crew and day. |
| `/calculator` | Quote calculator and what if. Inputs: client, job type, units, material cost per unit or "client supplies it", units per labor hour (prefilled from the standard and from similar past jobs), crew mix by labor class, setup hours, added services, other costs, target margin. Outputs live: cost per unit split, price per unit for the target margin (`price = cost / (1 - target)`), margin at a typed price, break even price, a sensitivity grid (pace plus or minus 20% by price), and a "What happened last time" panel (actual pace and margin of similar jobs). Save a scenario, "Create a job from this" (becomes the quote), or open any real job in what if mode to test a new price, pace, crew or rate against its projected profit. |
| `/scorecards` | Targets vs actual for the org, each site, client, job type and service: margin, profit, revenue, units per labor hour, labor as % of revenue, cost per unit, utilization. Green, amber, red, trend, and a target editor. |
| `/alerts`, `/alerts/rules` | Inbox of alerts (open, snoozed, resolved), each with what happened, the money impact, the next step, a link to the job, snooze, assign, dismiss, "Create a task in Projects" when Projects is licensed. Rules tab: plain sentence rules ("Tell me when a job's margin is heading under 15%") with thresholds, scope, who gets told, on or off. |
| `/reports`, `/reports/[slug]` | Report library, each with filters, a chart, a table, print view, CSV export and "Send on a schedule": Job profit, Profit by client, Profit by job type, Profit by service, Profit by site, Monthly profit and loss, Budget vs actual, Quote vs actual, Open jobs at risk, Variance summary, Productivity vs standard, Labor summary, Missing time, Material and scrap, Cost to serve, Daily production log, Month close pack, Audit log. Scheduled tab: schedules and past runs, each run stored with its CSV and an email ready HTML body (download, copy, open in mail app). |
| `/import`, `/import/new`, `/import/[batchId]` | Import center: one card per stream with its template download, last import and row counts. Flow: 1 Upload (drag a file or paste rows), 2 Match columns (auto matched by header aliases, remembered presets, sample values shown), 3 Check (counts for new, changed, unchanged, skipped, errors; a preview table with every problem in plain words on the exact cell; choose "all or nothing" or "skip bad rows"), 4 Done (result, error report CSV, link to the new rows, Undo for 7 days). History of batches. |
| `/export` | One click export per stream in the same columns as its template (so it can be imported back), date range and filters, "Download everything" (one zip of all streams and the key reports). |
| `/wall` | Wall display for the floor TV: full screen, no chrome, large type, auto rotating panels: today's units vs goal per job, units per labor hour vs standard per job (bullet bars), the day's totals, jobs due this week, a "Nice work" panel for jobs beating the standard. Options in the URL (`site`, `rotate` seconds, `panels`). Refreshes every 60 seconds. Never shows money unless a signed in money role turns it on. `/wall/t/[token]` is the same display behind a display link for a TV with no login, never with money. |
| `/settings` | Sections: General (currency, time zone, week start, working days, shift length, job numbers), Sites, Job types, People and roles (Pulse role, sees money switch), Cost rules (shared time rule, default burden, target margin, risk thresholds with a live "this would flag N jobs" preview), Month close (`/settings/close`: checklist, close, reopen with reason), Connected apps (`/settings/apps`: status of CRM, WMS, Projects, what is synced, last sync, Sync now, switches), Display links, Sample data (load, clear), Audit log (`/settings/audit`, filter by person, record and date, export), How Pulse does the math. |
| `/welcome` | First run: "How do you want to start?" Load sample data, import spreadsheets, connect KitStak apps (shown when licensed), or type the first job. Then the 5 step checklist: set a labor rate, add a client, add a job, log a day, see your profit. Each step links to the real screen with a coach mark. |
| `/search`, Cmd+K | Command palette: go to any page, find jobs, clients, services; actions (Log production, New job, New client, Add cost, Import, Export, Close month, Open wall display, switch org, theme, open sibling apps). Shortcuts: `g h` Home, `g j` Jobs, `g l` Log, `g p` Profit, `g c` Clients, `g a` Alerts, `n` new job, `l` log production, `/` search, `?` shortcut sheet, `[` and `]` previous and next day on the log. |
| `/login`, `/forgot-password`, `/no-workspace` | House auth pages with a Pulse preview panel. Locked screen when the org has no `pulse` entitlement, with a link to `portal/billing?module=pulse`. |

Cross cutting, on every screen: empty states that teach (what this is, one sentence why, the primary action, a link to sample data); loading states with the
Pulse loader and skeletons; error states with retry; optimistic saves with undo toasts; "How we got this" on every number; responsive from 360 px
(tables become cards, the log grid becomes a stacked form); keyboard reachable with visible focus; ARIA labels and screen reader tables behind every chart;
status is never color only (icon and word too); light and dark through tokens; all numbers `tabular-nums`; `prefers-reduced-motion` respected.

## 7. CSV in and out (every stream, nothing else installed)

Engine rules (`src/lib/csv.ts` + `src/server/domain/imports.ts`, same code for every stream):
- Reads UTF-8 (BOM ok), comma, semicolon or tab (auto detected), quoted fields, blank lines skipped. Limits: 10 MB and 50,000 rows a file, checked in chunks of 500.
- Headers match by exact name or alias, ignoring case, spaces, underscores and punctuation (`Units Good`, `units_good`, `Good units`, `qty finished` all map to `units_good`). Unmatched columns are shown and can be mapped by hand or ignored. Mappings are saved as presets keyed by the header set, so next month's file maps itself.
- Dates: `YYYY-MM-DD`, `M/D/YYYY`, `D/M/YYYY` (per `settings.date_order` or the import option), `Nov 3 2026`, Excel serial numbers. Money: `1234.5`, `$1,234.50`, `(45.00)` and `-45` for negatives. Percents: `28`, `28%` (both mean 28 percent). Yes and no: `yes|no|true|false|1|0`.
- Lookups by code first, then exact name without case: client, job, job type, labor class, site, service, item. Option per import: "Create missing clients, job types, labor classes and items" (on by default, each created row is listed in the check step).
- Every row gets an action in the check step: new, changed (with a field by field diff), unchanged, skipped or error. Errors are plain: "Row 14, hours: 9x is not a number." "Row 22, job_number: there is no job J-2040. Add it first or turn on Create missing." "Row 31: October is closed."
- Commit runs in one transaction, then `recomputeJob` for each touched job. Error report is a CSV of the bad rows with an added `problem` column, ready to fix and upload again. Undo restores `before` snapshots and removes created rows for 7 days, unless a later edit touched them.
- **Round trip rule**: exporting a stream and importing the file back changes nothing and creates nothing (every row reads "unchanged"). Exports carry the row key (`entry_id`) and the same headers as the template. Tested for every stream.
- Exports guard against spreadsheet formula injection (text cells starting with `=`, `+`, `-`, `@` get a leading apostrophe), use CRLF line ends and a BOM so Excel opens them cleanly, and file names read `pulse-<stream>-<org>-<from>-to-<to>.csv`.
- Templates download from the import center with the header row, two example rows and a second "how to fill this in" file listing each column, whether it is needed, and allowed values.

Columns (`*` = needed). Money columns are dropped from exports for readers without `money:read`.

| Stream (file) | Columns | Row match (update, not duplicate) |
|---|---|---|
| **Clients** `clients.csv` | `client_code*`, `name*`, `status`, `contact_name`, `contact_email`, `phone`, `target_margin_pct`, `payment_terms_days`, `notes` | `client_code`, else name |
| **Job types** `job_types.csv` | `job_type_code*`, `name*`, `unit_label`, `default_pricing_model`, `default_labor_class`, `default_units_per_labor_hour`, `target_margin_pct` | `job_type_code` |
| **Jobs** `jobs.csv` | `job_number*`, `name*`, `client_code*`, `job_type_code*`, `site_code`, `status`, `pricing_model`, `unit_label`, `planned_units`, `unit_price`, `fixed_price`, `bill_rate_per_hour`, `revenue_source`, `material_method`, `material_cost_per_unit`, `labor_class`, `default_headcount`, `units_per_labor_hour_standard`, `target_margin_pct`, `start_date`, `due_date`, `completed_date`, `po_number`, `owner_email`, `kit_sku`, `notes`, `wms_work_order`, `crm_deal_id`, `project_key` | `job_number` |
| **Quotes and budgets** `job_plans.csv` | `job_number*`, `plan*` (`quote` or `budget`), `category*` (`revenue`, `labor`, `material`, `other`), `description`, `quantity`, `unit` (`unit`, `hour`, `each`, `flat`), `unit_amount`, `amount`, `labor_class`, `service_code`, `item_sku` | all lines of each `(job_number, plan)` in the file replace that plan's lines |
| **Production** `production.csv` | `entry_id`, `work_date*`, `job_number*`, `shift`, `crew`, `labor_class`, `units_good*`, `units_scrap`, `units_rework`, `headcount`, `hours`, `overtime_hours`, `service_code`, `note` | `entry_id`, else `(job_number, work_date, shift, crew)` |
| **Labor rates** `labor_rates.csv` | `labor_class_code*`, `labor_class_name`, `kind` (`employee`, `temp_agency`), `site_code`, `effective_from*`, `wage_per_hour*`, `payroll_tax_pct`, `benefits_pct`, `other_burden_pct`, `overhead_per_hour`, `overtime_multiplier`, `bill_rate_per_hour`, `note` | `(labor_class_code, site_code, effective_from)` |
| **Other time** `indirect_time.csv` | `entry_id`, `work_date*`, `site_code`, `labor_class`, `reason*`, `headcount`, `hours*`, `overtime_hours`, `note` | `entry_id`, else `(work_date, site, labor_class, reason)` |
| **Paid hours** `paid_hours.csv` | `work_date*`, `site_code`, `labor_class`, `paid_hours*`, `paid_amount` | `(work_date, site_code, labor_class)` |
| **Materials** `materials.csv` | `entry_id`, `usage_date*`, `job_number*`, `item_sku*`, `item_name`, `quantity_used*`, `quantity_scrapped`, `quantity_planned`, `unit_cost*`, `uom`, `lot`, `supplied_by` (`us`, `client`), `note` | `entry_id`, else `(job_number, usage_date, item_sku, lot)` |
| **Items** `items.csv` | `item_sku*`, `name*`, `uom`, `unit_cost`, `client_code` | `item_sku` |
| **Costs** `costs.csv` | `entry_id`, `cost_date*`, `job_number` or `client_code` (one is needed), `category*`, `amount*`, `vendor`, `reference`, `note` | `entry_id`, else `(job or client, cost_date, category, reference)` when `reference` is set |
| **Revenue** `revenue.csv` | `entry_id`, `revenue_date*`, `job_number` or `client_code` (one is needed), `kind*` (`invoice`, `fee`, `adjustment`, `credit`), `description`, `quantity`, `unit_price`, `amount*`, `invoice_number`, `service_code`, `note` | `entry_id`, else `(job or client, invoice_number, description)` when `invoice_number` is set |
| **Services** `services.csv` | `service_code*`, `name*`, `unit_label`, `billing` (`per_unit`, `per_hour`, `flat`), `default_price`, `default_cost_per_unit`, `units_per_labor_hour_standard`, `labor_class`, `active` | `service_code` |
| **Service entries (VAS)** `vas.csv` | `entry_id`, `work_date*`, `client_code*`, `job_number`, `service_code*`, `quantity*`, `unit_price`, `amount`, `labor_class`, `headcount`, `hours`, `material_cost`, `note` | `entry_id`, else `(client, job, work_date, service_code)` |
| **Standards** `standards.csv` | `job_type_code`, `service_code`, `client_code`, `item_sku`, `labor_class`, `units_per_labor_hour*`, `effective_from*`, `note` | the scope columns + `effective_from` |
| **Targets** `targets.csv` | `scope*` (`org`, `site`, `client`, `job_type`, `service`), `scope_code`, `metric*`, `month` (`YYYY-MM` or blank for every month), `value*` | `(scope, scope_code, metric, month)` |

**Export list**: all 16 streams above (round trip safe); every report in `/reports`; the current view of Jobs, Profit explorer, Clients, Services, Labor, Scorecards,
Alerts and Log entries with its filters applied; a job's Budget vs actual and Quote vs actual tables; the audit log; an import's error report; "Download everything" zip.
HTTP: `GET /api/v1/export/<stream>.csv?from&to&client&jobType&site&status` and `GET /api/v1/reports/<slug>.csv?...` (text/csv, `Content-Disposition: attachment`, permission and money checked).

## 8. Integrations (deep, two way, fail soft)

Ground rules:
- Pulse reads sibling data from the shared database through `src/server/integrations/{detect,crm,wms,projects,customers}.ts`. Each reader checks three things in order and returns
  `{ available: false, reason: 'not_licensed' | 'not_installed' | 'no_warehouse' }` instead of throwing: the org has the sibling's entitlement (allow all in dev), the table exists
  (`to_regclass`, cached 5 minutes), and for WMS the org has its own tenant schema (`findWmsTenantSchema`, cached 60 seconds, always `wmsTable(schema, name)`, never another org's schema).
  Any error in a reader is caught, logged once and treated as "not available". The UI then hides the feature. Nothing in Pulse ever needs a sibling to work.
- Pulse never writes into `crm.*` or `wms.*`. It writes to Projects only through `@kitstak/pm-bridge`. Sibling apps read Pulse only through **`@kitstak/pulse-bridge`**, so margin math lives in one place.
- Pulled data is copied into `pulse.*` rows with `source` and `source_ref`, costs are snapshotted, and each row keeps a deep link back to its source record. Sync is an idempotent upsert:
  on demand ("Sync now"), when a page loads and the last sync is older than 10 minutes (in the background, never blocking), on a bridge event, and every 15 minutes by cron.
  User edits win: a field a person changed on a synced row is listed in `meta.locked_fields` and is not overwritten. Closed months are never touched.
- Links between apps store a path, never a host. The host comes from `appUrls()` at read time and carries the theme with `withThemeParam`.

### 8.1 `@kitstak/pulse-bridge` (new package, used by Portal, CRM, WMS, Projects)

Raw SQL over the host's Drizzle executor (`BridgeExecutor`), peer dep `drizzle-orm` only, plain JSON DTOs, `./types` export for client components. Reads never throw and return
empty when `pulse` is absent. Every function takes `{ orgId, userId }` and returns money as `null` with `moneyHidden: true` when that user has no `money:read` in Pulse, and
`{ available: false, reason: 'no_access' }` when the user has no Pulse role. Entitlement gating stays with the caller.

```ts
pulseAvailability(db)                                         // to_regclass('pulse.jobs'), cached 60 s
pulseAccess(db, { orgId, userId })                            // { role, seesMoney }
getOrgSummary(db, who, { from, to })                          // open jobs, at risk, losing, revenue, cost, profit, margin
getJobsForRecord(db, who, { type, id })                       // type: crm_deal | crm_account | wms_work_order | wms_shipment_order | wms_client | core_customer | pm_project
getJobSummaries(db, who, { type, ids })                       // batched, for list columns
getClientProfit(db, who, { coreCustomerId? , crmAccountItemId? }, { from, to })
listJobsNeedingAttention(db, who, { limit })                  // losing and at risk, worst first
listUnloggedJobsToday(db, who)                                // for "log today's work" nudges
emitBridgeEvent(db, { orgId }, { kind, targetId, payload })   // writes pulse.bridge_events, the only sibling write
pulseUrls(base).job(id) / .newJobFromDeal(dealId, ...) / .newJobFromWorkOrder(id) / .log(jobId) / .client(id) / .jobsAtRisk()
```

### 8.2 CRM

**Pulse reads** (`crm.boards`, `crm.columns`, `crm.items`, `crm.item_links`, `crm.customer_links`, `crm.activity_log`):
- Deals: boards with `kind::text = 'deals'`, top level live items. Won is decided by the house rule (stage label `isDone` or name matches won), read from the board's `stage` column labels, never a hard coded label id. Value is `values.deal_value.amount` in whole currency units, so cents = amount x 100. Close date from the newest stage change in `crm.activity_log`, else `values.close_date.date`. Account from `values.account.itemIds[0]`.
- Accounts: name, owner, health, and `crm.customer_links` to find the `core.customers` id.

**What Pulse does with it**:
- **Job from a won deal**: `/jobs/new?crmDeal=<itemId>` prefills name, client (finds or creates the `pulse.clients` row by `crm_account_item_id`, and sets `core_customer_id` when a customer link exists), quote revenue = deal value, start date = close date, and stores a `crm_deal` link. The quote plan gets `origin = 'crm_deal'`.
- **Suggested jobs**: Home and Jobs show "Won deals with no job yet" (won in the last 60 days, no `crm_deal` link, not dismissed) with "Create job" and "Not a job". Also raised as the `deal_won_no_job` alert and pushed at once by the CRM stage change event.
- **Quote value check**: when the deal value in CRM differs from the job's quote revenue, the Quote tab shows "The deal is now $52,000 in CRM. Your quote here is $48,000." with "Update the quote" and "Keep mine".
- **Client link**: client page shows the CRM account (owner, health) and a link to it; the client picker can search CRM accounts and creates the Pulse client on pick.
- Calculator scenarios can be tied to an open deal (`crm_deal_item_id`), so the estimate is waiting when the deal is won.

**What CRM shows about Pulse** (CRM cannot call Pulse from the browser because its CSP is `connect-src 'self'`, so all of it is CRM routes over the bridge):
- Item panel **Profit** tab on deals (`PANEL_TABS` gains `pulse`, deep link `?item=<id>&itemTab=pulse`): the jobs made from this deal, each with status pill, % done, quote vs actual revenue, cost, profit, margin, projected profit; "Create a job in Pulse" when there is none; "Open in Pulse".
- The same tab on account items: client profit for the last 90 days and 12 months, margin trend, open jobs with status, count at risk, "Open client in Pulse".
- Header line on a won deal: "Job J-1042 · At risk · 14% margin" (or "No job yet. Create one.").
- Shell: app switcher row, `OrgModuleFlags.pulse`, `NEXT_PUBLIC_PULSE_URL`, sibling theme handoff list.
- On a stage change to won, `item-events.ts` calls `emitBridgeEvent('crm_deal_stage_changed')` inside the write transaction, wrapped so it can never fail the CRM write.
- Files: `apps/crm/src/server/services/pulse-bridge.ts`, `src/app/api/v1/crm/items/[itemId]/pulse/route.ts`, `src/features/item-panel/pulse/{api.ts,pulse-tab.tsx,pulse-mark.tsx}`. Visible only when `entitled.pulse`, the item is top level, the board kind is deals or accounts, and the bridge says available.

### 8.3 WMS

**Pulse reads** (tenant schema, text ids, text UTC timestamps converted to the warehouse time zone, float dollars converted in SQL with `round(x::numeric * 100)::bigint`):

| WMS source | Becomes in Pulse | Notes |
|---|---|---|
| `clients` (= `core.customers`, same id) | `pulse.clients` with `core_customer_id` | upsert by id; inactive stays inactive |
| `work_orders` + kit `products` | `pulse.jobs` (`source = 'wms'`, number = work order code, `wms_work_order` link, kit SKU and name, `planned_units = requested_qty`) | status map: Open to planned, In Process to active, Completed to completed (with `actual_finish_at`), Cancelled to cancelled, Shortage to active with `wms_shortage = true` (rule R6). Auto created when `wms_auto_create_jobs`, else offered as "Work orders with no job". |
| `inventory_transactions` type Kitting, kit built rows | `pulse.production_entries` per work order per day: `units_good`, `source_ref = wms:built:<workOrderId>:<date>`, `hours_confirmed = false` | **finished kit quantities by day**. Disassembly rows subtract. The log grid shows them as "From the warehouse" and asks for people and hours. |
| `tasks` (Completed, timed, with `work_order_id`) | hint only: suggested headcount and hours on that row | WMS task time is scan time for one user, never shown as payroll hours and never costed until a person confirms |
| `work_order_components` x unit cost (last received `purchase_order_lines.unit_cost`, else `products.purchase_price`) | `pulse.material_usage` (`quantity_used = consumed_qty`, `quantity_planned = total_qty`, cost snapshot) and budget material lines; job `material_method = 'actual'` | **component consumption as material cost** |
| `kit_components` x cost | standard material cost per kit for the quote and the calculator | |
| `products` | `pulse.items` (sku, name, cost snapshot, `wms_product_id`) | |
| `lookup_values` (vas_type) + `vas_operations` + `billing_fees` (VAS) | `pulse.vas_services` and `pulse.vas_entries`; revenue = value (Total Price) or value x contract rate (Vas Quantity); no rate gives `amount_cents = null` and a "No price set yet" fix item | tied to a job when `reference_number` is a work order code |
| `billing_reports` + `billing_report_lines` | `pulse.revenue_entries` `kind = 'invoice'`: detail lines (`is_detail = true`) of type Work Order or VAS whose `reference_number` is a work order go to that job; everything else goes to the client per bill and operation type using summary lines (`is_detail = false`) minus what was already given to jobs | **billing data**. Draft bills come in with `approved = false`, shown as "Not approved yet" and re-pulled until approved. Canceled bills are removed. Never double counts summary and detail. |
| `billing_fees` operation type Work Order (Per Kit, Per Component, Per WorkOrder) | quote revenue for the job (`origin = 'wms_contract'`) and its unit price | job revenue order: billed lines, then contract rate, then the price typed in Pulse. Kit `products.price` is the client's retail price and is used only when `settings.we_sell_kits` is on. |
| `warehouses` | `pulse.sites` (`wms_warehouse_id`, time zone) | |

**What WMS shows about Pulse** (all through `@kitstak/pulse-bridge`, each renders nothing when Pulse is not licensed, not installed, or the user has no access):
- **Work order detail**: "Job profit" card in the right rail, above Project tasks: revenue, cost, margin, status pill ("Making money", "At risk", "Losing money"), budget vs actual bars for labor and materials, kits done of requested, "Log today's work" (opens Pulse `/log?job=<id>`) and "Open in Pulse". With no job yet: "Track profit for this work order" (opens `/jobs/new?wmsWorkOrder=<id>`).
- **Work orders list**: optional Margin column with a tone pill and a chip "Losing money: N", one batched call.
- **Client detail**: "Client profit" strip next to the Projects strip: last 30 days revenue, cost, margin, jobs at risk, link to the client in Pulse.
- **Bill detail**: "Margin on this bill" tile (billed total against Pulse cost for the same client and period).
- **VAS operations**: "No price set yet" hint and "Add cost in Pulse" row action. **Dashboard**: "Jobs losing money" tile. **Labor analytics**: "See labor cost in Pulse" link.
- **Events**: `change-log.ts` calls `emitBridgeEvent('wms_work_order_changed')` on work order status and quantity changes (inside a savepoint, never throws), so Pulse refreshes that job within a minute.
- Shell: app switcher row, `entitledApps.pulse`, `APP_URLS.pulse`, theme handoff list. Files: `apps/wms/src/server/pulse/{bridge,routes}.ts`, `src/app/api/work-orders/[id]/pulse/route.ts`, `src/app/api/work-orders/pulse-summary/route.ts`, `src/app/api/clients/[id]/pulse/route.ts`, `src/app/api/billing-reports/[id]/pulse/route.ts`, `src/components/pulse/{job-profit-card,client-profit-strip,margin-pill}.tsx`.

### 8.4 Projects

**Pulse reads** (`pm.projects`, `pm.tasks`, `pm.time_entries`, `pm.integration_links`, respecting project visibility: org visible projects plus the ones the user belongs to):
- **Link a job to a project** (`pm_project` link): picker on the job, in the wizard, and from `?project=<id>`. Suggested automatically when a project shares the job's CRM deal, WMS work order or customer.
- **Time entries as labor hours**: for a linked job with `time_import` on, finished `pm.time_entries` are summed per day into `pulse.production_entries` (`source = 'projects'`, `crew = 'Projects time'`, `source_ref = pm:<projectId>:<date>`, `units_good = 0`, headcount = distinct people, hours = minutes / 60, the job's labor class), then costed with the Pulse rate. Only one job per project may import time. The job Labor tab shows planned time (`sum(estimate_minutes)`) against logged time.
- Project status, health, due date and progress show on the job header chip.

**Pulse writes** (through `@kitstak/pm-bridge`, only when Projects is licensed): "Create a task" from an alert or a job (`createTaskFromExternal` with a `pulse_job` link), and "Start a project for this job" (deep link to the Projects app `/projects/new?customer=<coreCustomerId>&name=<text>`).
This needs the new link target type `pulse_job` in Projects: migration `apps/projects/drizzle/0006_pulse_links.sql` (both target type CHECKs), `INTEGRATION_TARGET_TYPES`, `link-path.ts`, a `pulse.ts` resolver in `src/server/integrations`, the icon maps, and `BRIDGE_TARGET_TYPES`.

**What Projects shows about Pulse**:
- **Project overview**: "Job profit" strip under the Customer 360 strip: each linked job with status pill, % done, revenue, cost, margin, projected profit; totals; "Open in Pulse"; "Track profit for this project" when nothing is linked. Built like Customer 360 (reader `server/integrations/pulse-profit.ts`, route `projects/[key]/pulse-profit`, component `features/integrations/pulse-profit-strip.tsx`, soft 900 ms server preload).
- **Projects directory**: margin chip on project cards and rows. **Task drawer**: `pulse_job` link chips with live status. **Home**: "Jobs losing money" card. **Settings, integrations**: a Pulse row with status.
- On time logged for a linked project, Projects calls `emitBridgeEvent('pm_time_logged')`.
- Shell: app switcher row, `appUrls().pulse`, `modules.pulse`, trusted origins.

### 8.5 Portal

- **Launcher tile** "KitStak Pulse", tagline "Know which jobs make money", icon `AppIcon app="pulse"`, three stats: Open jobs, At risk, Losing money (`pulseStats(orgId)` behind `to_regclass('pulse.jobs')`, try and catch returns null). Empty state copy: "No jobs yet. Add your first job to see profit." with a link to `/welcome`.
- **Quick links**: Log production, New job, Jobs at risk. **Home panel** "Jobs that need you" (top 5, hidden without access) and "Profit by client" (hidden without `money:read`).
- **Setup guide** steps (derived, plain words): `pulse_labor_rate` "Set your labor cost per hour" (done when `pulse.labor_rates` has a row or a default rate is set), `pulse_first_job` "Add your first job" (a live job exists), `pulse_first_entry` "Log a day of production" (a production entry exists), `pulse_connect` "Link a job to a deal or work order" (only when CRM or WMS is entitled; a `pulse.job_links` row exists). `stepHref` points at Pulse with `?setup=<key>`.
- **Command palette**: "Open Pulse", "Log production", "Jobs at risk" (locked goes to `/billing?module=pulse`).
- **Billing**: `MODULE_NAMES.pulse`, upgrade page copy with five features (profit per job, daily production entry, budget and quote vs actual, at risk list, CSV in and out).
- Shell: `appUrls.pulse`, `entitled.pulse`, footer text, `MARKS.pulse`, `EMPTY_STATS_COPY.pulse`, `SetupScope`, `ONBOARDING.md`.

### 8.6 Shared packages, switcher, entitlements, deploy

- `packages/ui/src/app-switcher`: `AppSwitcherAppId` gains `pulse`, `urls.pulse?`, `entitled.pulse?`, row `{ id: 'pulse', name: 'KitStak Pulse', descriptor: 'Profit by job, client and day' }`. Every app passes its Pulse URL and entitlement.
- `packages/ui/src/app-icon`: `AppIconId` gains `pulse`, `ICONS.pulse` (section 10), test row `['pulse', 6]`.
- `packages/entitlements`: `Module`, `MODULES`, `read.ts` draft record. `packages/db`: `ENTITLEMENT_MODULES`, CHECK literal, migration `0006_core_pulse_module.sql` + journal + README.
- Pulse itself: `(app)` layout gates on `orgHasPulseModule` (locked screen), API returns 402 `NOT_ENTITLED`, dev allows all unless `ENTITLEMENTS_DEV_ALLOW_ALL=0`.
- Every sibling `.env.example` gets `NEXT_PUBLIC_PULSE_URL` and port 3500 in `TRUSTED_ORIGINS`. `deploy/push-env.mjs` gets `URL_PULSE`, `PROJECT_PULSE` and a Pulse plan; `docs/DEPLOYMENT.md`, root `package.json` (`dev:pulse`), `.claude/launch.json`, root README and `apps/web` product lists gain Pulse.

### 8.7 Cross app API that Pulse exposes (`/api/v1`, CORS with credentials for trusted sibling origins only, CSRF origin check on writes, entitlement and role checked, money hidden by role)

| Endpoint | Returns |
|---|---|
| `GET /api/v1/me` | user, org, Pulse role, `seesMoney`, modules, integration availability |
| `GET /api/v1/summary?from&to` | open jobs, at risk, losing, revenue, cost, profit, margin, entry progress today |
| `GET /api/v1/jobs/lookup?type=<target type>&id=<id>` or `&ids=a,b,c` | `{ jobs: JobSummary[] }` or `{ byId: { [id]: JobSummary[] } }` with url, status, reasons, totals, projection |
| `GET /api/v1/clients/lookup?coreCustomerId=` or `?crmAccountItemId=` `&from&to` | client profit summary, jobs needing attention, url |
| `GET /api/v1/jobs/attention?limit=` | losing and at risk jobs, worst first |
| `POST /api/v1/jobs` | body `{ name, client: { id? , coreCustomerId?, crmAccountItemId?, name? }, jobTypeCode?, plannedUnits?, unitPrice?, quoteRevenueCents?, dueDate?, link?: { targetType, targetId } }` returns `{ job, url }`; idempotent on the link |
| `POST /api/v1/production` | body `{ job, workDate, unitsGood, unitsScrap?, headcount?, hours?, overtimeHours?, laborClass?, shift?, crew?, note? }` returns the entry and fresh job totals; upsert on the row key |
| `GET /api/v1/alerts/unread` | `{ count }` |
| `GET /api/v1/export/<stream>.csv`, `GET /api/v1/reports/<slug>.csv` | CSV files |
| `GET /api/v1/explain?metric&job|client&from&to` | the "How we got this" steps |
| `GET /api/v1/cron/sync`, `GET /api/v1/cron/nightly` | cron only (`CRON_SECRET`): sibling sync and bridge events; date rules, alerts, report schedules |

**Deep links into Pulse**: `/jobs/<number or id>` and its tabs · `/jobs/new?crmDeal=<itemId>` · `/jobs/new?wmsWorkOrder=<id>` · `/jobs/new?project=<id>` · `/jobs/new?client=<coreCustomerId>&name=<text>&value=<amount>` ·
`/jobs/by-link?type=<target type>&id=<id>` (redirects to the job, or to the prefilled new job page) · `/jobs?tab=open&risk=losing,at_risk` · `/log?job=<id>&date=<YYYY-MM-DD>` · `/clients/by-link?coreCustomerId=<id>` ·
`/profit?by=client&client=<id>&from&to` · `/vas?wmsVasId=<id>` · any page `?setup=<step key>`. Unknown ids land on a helpful not found page, never a blank screen.
**Deep links out of Pulse**: CRM `/{orgSlug}/boards/{boardId}?item={itemId}&itemTab=pulse`; WMS `/work-orders/<id>`, `/clients/<id>`, `/billing/reports/<id>`, `/billing/vas`, `/products/<id>`; Projects `/p/<KEY>`, `/p/<KEY>/<number>`; Portal `/billing?module=pulse`.

## 9. Seed data plan (`pnpm --filter kitstak-pulse db:seed`, `--org=<slug>`, idempotent: wipe the org's pulse rows, rebuild through the domain layer)

All dates are relative to the day the seed runs (today = day 0), so the demo is always fresh: 90 days of daily production on work days from day -90 to day 0,
the two oldest full months closed, last month open and "ready to close". Numbers come from a seeded random generator so runs are repeatable. Sibling links are looked
up by name or code at run time and skipped quietly if missing. Both orgs get: 1 site (kitstak also maps its WMS warehouse), 5 labor classes with two dated rate rows each
(a raise 45 days ago, so rate variance is real), 6 job types, 8 services, standards for every job type, targets for the org and top clients, the 10 system alert rules,
3 saved views, 2 calculator scenarios, 1 report schedule, a display link, explicit Pulse roles, indirect time and paid hours for every work day (about 9% indirect, 4% missing).

| | `kitstak` (has WMS and Projects, no CRM) | `northwind-robotics` (has CRM and Projects, no WMS) |
|---|---|---|
| Story | a 3PL kitting floor | a kitting and integration cell that builds install, spare part and service kits for robot customers; proves Pulse with no warehouse |
| Clients (10) | the 8 `core.customers` (Apex Threads, NovaForge Electronics, Copperline Coffee, Bluebird & Main, Voltbyte Labs, Summit Trail Gear, Harbor Roast Collective, Pixel & Pine inactive) linked by id, plus 2 Pulse only clients (Lumen Skincare, Orchard Pet Supply) | 10 CRM account items that own won deals (for example Highline Freight, Driftwood Freight, Cobalt Foods, Frontier Aerospace, Orion Fulfillment, Beacon Labs, Bluestone Foods), linked by `crm_account_item_id` |
| Job types (6) | Kit assembly, Subscription box, Retail display build, Gift set, Rework and relabel, Returns refurbish | Install kit build, Spare parts kit, Field service kit, Retrofit kit, Demo unit prep, Rework |
| Services (8) | Labeling, Shrink wrap, Insert cards, Poly bagging, Quality check, Pallet build, plus the WMS VAS types Special Project and Programming | Labeling, Foam cutting, Serial capture, Firmware load, Quality check, Crating, Calibration, Expedite |
| Jobs (40) | 8 from WMS work orders WO000088 to WO000095 (quotes, hours and rates added on top of the real kit quantities and component costs) + 32 Pulse jobs `J-1001` up | 40 Pulse jobs, 14 created from real won deals (quote = deal value share), `J-1001` up |
| Status mix | 22 active, 13 completed, 3 planned, 1 on hold, 1 cancelled (WO000089) | same mix |
| Risk mix (active) | 12 healthy, 4 watch, 3 at risk, 3 losing money. Completed: 11 made money, 2 lost money | same mix |
| Links | `wms_work_order` x 8, `wms_client` on clients, `pm_project` on jobs for projects APX, NOVA, CPL, PEAK, OPS (time import on for 2) | `crm_deal` x 14, `crm_account` on clients, `pm_project` for CBP, FRA, ORN (which already point at CRM deals), 4 won deals left without a job to show "Suggested jobs" |
| Role demo | admin@kitstak.io admin, ops.manager manager, j.okafor, t.nguyen and d.castillo supervisor (no money), finance viewer with money, cs.team viewer without money, client portal users none | maya owner, daniel admin, ethan and sofia manager, hannah and liam supervisor, aisha viewer with money, lucas none |

Named story jobs that tests and reviewers can rely on (kitstak; northwind mirrors each with its own names):
- `WO000088` Voltbyte desk kit, 12 kits: completed, healthy. `WO000092` Harbor Roast gift kit, 400 kits: active, **at risk** by R6 (warehouse shortage). `WO000094` Apex tee 3 pack: active, **watch** (labor 9% over). `WO000095` NovaForge road kit: planned.
- `J-1012` Harbor Roast holiday gift set, 12,000 units at $2.75: **losing money** (pace 31 units per labor hour against a standard of 46, projected about $1,800 in the red).
- `J-1019` Summit Trail starter kit relabel, fixed price $9,400: **losing money** (hours 60% over).
- `J-1023` Bluebird & Main November subscription box: **at risk** (margin heading for 14% against 30%, material cost up).
- `J-1027` Apex Threads retail display build: **at risk** (projected finish 5 work days after the due date).
- `J-1031` NovaForge accessory bundle: **watch** (nothing logged for 4 work days). `J-1034` Copperline cold brew sampler: completed and **lost money** (rate raise mid job).
- `J-1005` Lumen Skincare launch kit: healthy star job, 41% margin, beats the standard (appears on the wall display "Nice work" panel).

About 1,300 production entries per org, 500 material usage rows, 120 cost entries, 150 revenue entries (including invoices), 260 service entries, plus plans (quote and budget) on every job,
with 6 jobs where the budget differs from the quote. `db:seed` prints row counts and the reconciliation check (sum over `v_facts` equals `job_stats` equals the Home total).
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

  Use it as the favicon (`src/app/icon.svg`, `icon.png`, `apple-icon.png`), the sidebar and top bar mark, `ICONS.pulse` in `@kitstak/ui` (`offsetY: 0`, 6 shapes), the Portal tile and `MARKS.pulse`,
  the CRM, WMS and Projects inline `PulseMark`, and `apps/web/public/brand/apps/kitstak-icon-pulse.svg`. Copy it into `apps/portal/public/brand/` too.
- **`kitstak-loader-pulse.svg`**: animated loader using the classes already in the brand loader stylesheet (`/* 7 Pulse: cost eats into revenue, live */`): per row a full width pink bar with class `ghost`
  (opacity .35) and a red bar on top with class `meter` (scaleX from the left, staggered delays per row). Stops for `prefers-reduced-motion`. Use it in every `loading.tsx`, full page loads and long actions
  (import check, sync, month close) via `<img src="/brand/kitstak-loader-pulse.svg" width="64" height="64" alt="Loading">`. The KitStak company loader stays for sign in and cross app handoff.
- Colors: Red `#C8102E`, Pink `#D65A6E`, Navy `#0A1628`, Cream `#F5F1E8`. Wordmark `KITSTAK PULSE` in Bebas Neue from `@kitstak/ui` (letter spacing 0.0485em, no kerning). UI text stays on token fonts.
- Data colors: charts use the `--chart-*` tokens; status uses `--success` (healthy), `--warning` (watch), an orange step (at risk) and `--danger` (losing money), always with an icon and the word.
  Brand red is for the mark and primary actions, never the only signal for "bad".

## 11. Quality bar and test plan

Typecheck and lint clean (the no dash rule covers `src/features`, `src/components`, `src/app`, `src/lib`, seed data). Every button does something. No placeholder pages, no lorem ipsum, no TODOs.

**Unit tests (vitest, pure functions in `src/lib`)**
- `money`: decimal safe multiply and rounding, formatting, parse of `$1,234.50`, `(45.00)`.
- `calc/rates`: loaded and overtime rate, effective date and site lookup, default fallback, `needs_rate`.
- `calc/labor`, `calc/shared`: stamping, largest remainder allocation sums exactly, percent rule, days with no direct hours.
- `calc/revenue`: per unit, fixed price progress with true up (sum equals the fixed price to the cent), hourly, billed mode.
- `calc/material`: standard vs actual, scrap, client supplied.
- `calc/variance`: the six bars always sum to actual minus plan profit, each edge rule, flex on and off.
- `calc/forecast`: pace choice order, projection, finish date over working days.
- `calc/risk`: one test per rule L1 to W7, ordering, headline by impact, reason text with real numbers, no dashes.
- `calc/explain`: text for each metric. `csv`: delimiters, quotes, BOM, dates, money, header aliases, formula guard. `permissions`: action table and money rule. `copy-rules`: no em dash, en dash or double dash in UI strings.

**Database tests (against local Postgres, a throwaway org)**
- Reconciliation: for every job, client, job type, service and month, the sum over `v_facts` equals `job_stats` equals the API totals, to the cent.
- Round trip for all 16 streams: export, import, every row "unchanged", row counts identical.
- Import: mapping presets, each validation message, all or nothing vs skip bad rows, undo.
- Month close: every stream refuses writes in a closed month (domain and trigger), reopen works and is logged. Rate change restamps open months only.
- Org isolation: a second org can never read or write the first org's rows through any domain function.
- Money hiding: every API route called as a supervisor returns no money. Fail soft: every integration reader returns `available: false` with sibling tables absent (run against a schema without `crm`, `wms`, `pm`) and for an org with no warehouse.
- Sync is idempotent: running WMS, CRM and Projects sync twice creates nothing new.

**Playwright (`e2e/`, both demo orgs, light and dark, 1440 and 390 wide)**
1. Sign in, Home shows profit and "Jobs that need you"; open the worst job; reasons and projection are visible.
2. Log a day on the grid with the keyboard only; the job's numbers change on the next page load; undo works.
3. Kiosk entry on a tablet viewport. 4. Create a job from the wizard and from a calculator scenario.
5. Budget vs actual and Quote vs actual tabs render the table and the waterfall for a story job.
6. Import production from the template: mapping, a fixed error, commit, undo. Export and re-import shows all unchanged.
7. Profit explorer drill: client to job to entries, totals match. 8. Add a labor rate with a new effective date; costs move only after that date.
9. Close a month, try to edit inside it, reopen. 10. Supervisor login sees no money anywhere (scan the DOM for the currency symbol).
11. Northwind: create a job from a won deal; the link opens CRM. Kitstak: a WMS work order job shows pulled kits and material cost; the link opens WMS.
12. Standalone: with `crm`, `wms`, `projects` entitlements revoked for a test org, every Pulse page loads, no sibling UI shows, no console errors.
13. Sibling apps: Portal tile and stats, CRM Profit tab, WMS Job profit card, Projects strip, app switcher in all five apps.
14. Wall display rotates and shows no money. 15. Axe scan has no serious issues on Home, Jobs, Log, Job detail, Import.

**Performance**: Home and Jobs under 400 ms server time on the seed (reads `job_stats`, not raw rows); log grid save round trip under 150 ms; lists virtualized past 200 rows; an import of 20,000 rows checks in under 10 seconds.
**Time to first profit number**: a new org with sample data sees a job profit in under 1 minute; typing or importing real data, in under 10 minutes (the standalone promise).

## 12. How Pulse beats Easy Metrics Profit Management

Scored on the research rubric (0 to 10 per category; Easy Metrics baseline is an estimate from public material, not hands on). Pass bar: 80 or more in total, no category under 7,
ahead in at least 8 of 10. A reviewer only gives credit for what was clicked through with real data.

| # | Category | Easy Metrics (est.) | Pulse target | Why Pulse wins, and where to see it |
|---|---|---|---|---|
| 1 | Profit visibility | 7 | 9 | Profit by job, job type, client, service (VAS), site and time, all from one fact view, with drill down from client to job to daily entry and totals that match to the cent. Easy Metrics stops at customer, process and site: it has no job or VAS view. See `/profit`, `/clients/[id]`, `/vas`. |
| 2 | Job costing, budget vs actual | 3 | 9 | The job is the main object. Quote and budget per job, line by line quote vs actual, flexed plan for half done jobs, a variance waterfall that always adds up, projected profit and finish date. Easy Metrics has planned vs actual at customer level only. See the job Budget and Quote tabs. |
| 3 | Daily production entry | 3 | 9 | A whole day in one keyboard grid, copy yesterday's crew, inline sanity checks, tablet kiosk, autosave with undo, warehouse kits prefilled. Easy Metrics is feed driven and not built for a supervisor typing at the end of a shift. See `/log`, `/log/kiosk`. |
| 4 | Cost model depth | 7 | 8 | Loaded rates by labor class with effective dates, overtime and temp agency rates, indirect time and missing time, a visible shared cost rule, standards, target cost per unit, and material and scrap cost, which Easy Metrics does not have. Easy Metrics keeps an edge in engineered labor standards per warehouse process; Pulse answers with history based standards in one click. See `/labor`, `/standards`. |
| 5 | Risk and alerts | 4 | 9 | Every open job is healthy, watch, at risk or losing money, with the reason in a sentence, the dollar impact and a next step, before the job ends. Rules a manager can tune, an inbox, tasks in Projects. Easy Metrics shows what happened; it does not predict a job's finish. See `/jobs`, `/alerts`. |
| 6 | Data in and out | 4 | 9 | A template, column matching, preview, cell level errors, undo and a round trip safe export for all 16 streams, self serve. Easy Metrics needs about two weeks of vendor mapping. See `/import`, `/export`. |
| 7 | Integration depth | 6 | 9 | Live two way links with CRM (job from a won deal, quote value, Profit tab on the deal and account), WMS (work orders, finished kits, component cost, VAS, bills; Job profit card on the work order), Projects (linked project, time as labor, tasks from alerts) and Portal, each with a one click link to the source record. And it works with none of them. Easy Metrics has no CRM, quote or project link and cannot run alone. |
| 8 | Ease of use | 5 | 9 | 8th grade words, "How we got this" on every number, a 5 step start, sample data, empty states that teach, first profit number in minutes. No "activity based costing", "TCTS" or "burden" without a plain line beside it. Easy Metrics needs training and weeks of setup. |
| 9 | Visual and interaction quality | 6 | 9 | The KitStak look across five apps, purpose built charts, light and dark, phone to wall TV, keyboard first, loaders and error states everywhere. |
| 10 | Enterprise readiness | 7 | 8 | Five roles with server side money hiding, org isolation, append only audit log, month close and lock, multi site, saved views, scheduled reports, display links, reconciliation tests. Easy Metrics has more years in market; Pulse answers with provable numbers. |
| | **Total** | **52** | **88** | |

Capability checklist from the research, all in scope and each with a test: the 25 "must match" items (profit by job, client, type and VAS; daily entry; loaded rates; cost per unit and units per labor hour;
budget vs actual; planned vs actual by client; labor as % of revenue; material cost; indirect time; missing time; overhead rule; cost to serve; target cost per unit; dashboard with trend; URL filters;
multi site; CSV export everywhere; productivity vs standard; drill down; rankings; variance breakdown; roles; audit log; what if price) and the 15 "beat them" items (standalone in minutes; CSV for every stream;
quote vs actual per job; open jobs risk list; projected final margin; plain language; fast daily entry; material in the margin; deep suite links; VAS profit view; labor rate builder; alerts that say what to do;
same day truth with no nightly batch; sample data and guided setup; totals that match their rows to the cent).

Honest gaps, stated so nobody oversells: Pulse does not capture time by scan or time clock on its own (it takes typed hours, CSV, WMS hints and Projects time), has no engineered standards library,
and has no pay for performance module. None of these are needed to answer "which jobs make money".
