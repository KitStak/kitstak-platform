# Pulse Programs: a program tracker in Pulse

Status: draft for review. Builds on `docs/programs/SPEC.md` (Programs v2). Where the two disagree, this file wins for Pulse.

## 0. Why

A program is recurring work under one price card. Pulse today only knows jobs, and a job is judged against a quote or a budget. So every program in production was linked to a Pulse job made by hand with a typed quote, and Pulse judges the program against that quote:

| Program | Pulse job | What Pulse says today | What is true |
|---|---|---|---|
| GLOVE | J-26131 | "Past its planned units: 21,837 of 2,000. Update the plan or finish the job." | 2,000 kits and $89,260.20 are a typed quote. The program has its own schedule and card. |
| BULLET | J-26132 | "Has a price but no cost plan." and "96,874 of 8,600 planned units." | The job shows $3.00 a unit. The card averages $4.1957. |
| All 8 | J-26131 to J-26138 | Margin and labor judged against a quote | The program knows this month's planned builds and card revenue. |

Revenue itself is right: every build line comes from Projects with its card price (SPEC 6.1). What is wrong is the plan Pulse compares against, the price it shows, and the alerts it raises.

Decision: Pulse gets a **Programs** section, the same way Projects has Programs next to Projects. A program is tracked as a program, by month and by variant, with its plan read from Projects. The Pulse job stays underneath as the place labor, timesheets and materials are kept, but people stop working with it as a job.

## 1. Decisions

1. **One program, one program job.** This already holds (`job_links_program_key` and `job_links_one_program_per_job`). The program job holds the program's typed hours, prep labor, materials and fees. Builds billed to a different job (`posting = 'build_job'`) stay on that job and still count in the program's numbers, because every Pulse row from a program carries `pm_program_id`.
2. **The program's numbers are summed by `pm_program_id`, not by job.** Revenue and units from `pmb:` rows and `pmf:` rows with that program id, plus all cost on the program job, plus cost on `pmb:` rows billed to other jobs.
3. **The plan comes from Projects, never from a Pulse quote.** Planned units, card revenue, forecast, monthly target and monthly minimum are read through `@kitstak/db/programs` and computed with `@kitstak/programs-engine`, so they equal what Projects shows.
4. **Pulse owns cost and margin only.** It never stores a program plan, a price or a forecast of its own.
5. **Quotes and budgets on a program job are ignored, not deleted.** They stay in `pulse.job_plans` so nothing is lost, and the job page says they are not used.
6. **No money moves.** Sync, posting, stamping and month close stay as they are. This is a read model plus small write paths (track a program, convert a job).
7. **Program jobs leave the Jobs list by default.** The Jobs list gets a "Programs" chip filter that shows them. Opening a program job goes to its program page, with a link "Open the job" for people who need the raw rows.

## 2. Data

### 2.1 No new money tables

Everything the tracker shows already exists:

| Need | Source |
|---|---|
| Units, revenue per build line, variant | `pulse.production_entries` with `source_ref LIKE 'pmb:%'`, `pm_program_id`, `pm_variant_id` |
| Fees, minimum top up, adjustments | `pulse.revenue_entries` with `source_ref LIKE 'pmf:%'` and `pm_program_id` |
| Labor, crew, hours | `pulse.production_entries` on the program job (typed, CSV, `pmt:` prep rows) and on `pmb:` rows anywhere |
| Material, other cost, shared cost | the program job's existing cost rows and stamps |
| Program facts, calendar, settings, target, minimum | `pm.projects`, `pm.program_settings`, `pm.org_calendar` through `loadProgramFacts` |
| Card versions, planned builds | `loadPublishedVersions`, `loadProgramMonthInputs` |
| Ledger and output (for parity) | `readProgramMonth` |

### 2.2 One migration: `apps/pulse/drizzle/0016_program_tracker.sql`

Small and additive:

- `pulse.jobs.program_job boolean NOT NULL DEFAULT false`: true for a job that a `pm_program` link points at. Kept by the sync (set on mirror, cleared when the mirror goes). It drives list filters and redirects without a join. Backfill: `UPDATE pulse.jobs SET program_job = true WHERE id IN (SELECT job_id FROM pulse.job_links WHERE target_type = 'pm_program')`.
- `pulse.program_prefs` (one row per org and program): `org_id`, `pm_program_id uuid`, `target_margin_bp integer NULL`, `labor_split text NOT NULL DEFAULT 'by_units' CHECK (labor_split IN ('by_units','by_standard','as_logged'))`, `standard_minutes jsonb NOT NULL DEFAULT '{}'` (minutes per kit by variant id), `version integer NOT NULL DEFAULT 1`, timestamps, `UNIQUE (org_id, pm_program_id)`, RLS enabled with the `pulse_app` policy like other Pulse tables. Pulse only settings: Projects never reads them.

Preview builds skip it (the `db:migrate` guard). Production applies it on deploy.

## 3. Math (pure, `apps/pulse/src/lib/profit/program.ts`, with tests)

All money in bigint cents. Quantities as 3 place decimals. No floats. No `Date.now()`.

### 3.1 Month figures

```ts
programMonthFigures(input: {
  month: IsoMonth;
  lines: ProgramLine[];        // pmb rows: date, variantId, units, scrap, revenueCents, laborCents, hours, materialCents
  fees: FeeLine[];             // pmf rows: date, kind, amountCents
  jobCosts: JobCostLine[];     // program job rows with no variant: date, hours, laborCents, materialCents, otherCents, sharedCents
  split: 'by_units' | 'by_standard' | 'as_logged';
  standardMinutes: Record<VariantId, string>;
}): ProgramMonth
```

Returns revenue (work plus fees), labor, material, other, shared, profit, margin in basis points, units, hours, units per hour, revenue per unit, cost per unit and profit per unit. Also a `byVariant` array and a `notTiedToVariant` row.

### 3.2 Labor split

Typed hours on the program job have no variant, so today Pulse shows all of it on one row. The tracker splits job cost that has no variant across variants **per day**:

- `by_units` (default): by each variant's good units that day.
- `by_standard`: by units times the variant's standard minutes that day. Falls back to `by_units` for a variant with no standard.
- `as_logged`: no split. A "Not tied to a variant" row holds it.

A day with job cost and no units keeps that cost in "Not tied to a variant" in every mode. Splits use the engine's `allocate` (largest remainder), so the rows always add up to the total to the cent.

### 3.3 Plan for the month (read from Projects)

```ts
programMonthPlan(input: { facts; versions; monthInputs; asOf }): {
  plannedUnits: string;          // built so far plus open builds dated today to month end
  plannedByVariant: { variantId; units: string }[];
  forecastCents: Cents;          // forecastMonth(...).forecastCents
  forecastMethod: ForecastMethod;
  targetCents: Cents | null;     // program_settings.monthly_target_cents
  minimumCents: Cents | null;    // monthly minimum line in force
  projectedGapCents: Cents;      // forecastMonth(...).projectedGapCents
}
```

Computed with `forecastMonth` and the same inputs Projects uses, so "Forecast $32,508.18" matches Projects to the cent.

### 3.4 Cost forecast and margin forecast

Pulse adds what Projects cannot know: cost to the end of the month.

- Cost per unit = cost so far in the month divided by units so far. With fewer than 3 work days in the month, use the last 20 work days.
- Forecast cost = cost so far + cost per unit times (planned units minus units so far).
- Forecast margin = (forecast revenue minus forecast cost) over forecast revenue.

When there is no cost yet, forecast margin is null and the screen says "Not enough days yet."

### 3.5 Target margin

The first of these that is set: `program_prefs.target_margin_bp`, the program job's `target_margin_bp`, the client's, the org default. This is the same order the job uses today.

## 4. Server (`apps/pulse/src/server/domain/programs.ts`)

Reads use `requirePulse`. Money is hidden through `moneyOut` exactly as on jobs: people without money rights see units, hours, units per hour and plan units, never cents or margins.

| Function | Returns |
|---|---|
| `listTrackedPrograms(ctx, { month })` | One row per program with a `pm_program` link in this org: key, name, customer, status, unit label, program job number, this month's units, revenue, cost, profit, margin, target margin, forecast revenue, forecast margin, planned units, units per hour, health, last activity. Plus "Not tracked yet": programs in Projects with no Pulse link. |
| `getProgramMonth(ctx, key, month)` | Header, month figures (3.1), plan (3.3), cost forecast (3.4), parity status (SPEC 6.1), alerts. |
| `getProgramVariants(ctx, key, month)` | `byVariant` with planned units per variant and the `notTiedToVariant` row. |
| `getProgramMonths(ctx, key, { from, to })` | One row per month: units, revenue, cost, profit, margin, target, minimum met or missed, closed or open. |
| `getProgramDays(ctx, key, month)` | One row per work day: planned units, units, scrap, hours, units per hour, revenue, cost, profit. |
| `getProgramPrefs` / `saveProgramPrefs` | Target margin, labor split, standard minutes. `saveProgramPrefs` needs `rate:manage` and checks `version`. |
| `trackProgram(ctx, programId)` | Makes the program job when the program has none: `kind='ongoing'`, `pricing_model='per_unit'`, unit label from the program, client matched by core customer or CRM account (else asks), no quote, no budget, no typed price, `program_job = true`. Writes the `bills_to` edge through `@kitstak/db/record-links` and the mirror in one transaction, runs `canLinkJob` first, and queues a program sync. Needs `job:manage`. |
| `convertToProgramJob(ctx, jobId)` | For a job already linked (all 8 in production): sets `program_job = true` and writes one activity line "J-26131 is now tracked as the GLOVE program." Plans and typed price are left in place but unused. Idempotent. The sync also does this on its own for every linked job, so no one has to click anything. |

Recalc: `job-stats.ts` keeps computing job stats. For a `program_job` it changes only what 5.2 lists.

## 5. Changes to what exists

### 5.1 Sync (`sync-programs.ts`)

Step 1 (mirror edges) also sets `pulse.jobs.program_job` true for jobs with a `pm_program` mirror and false when the mirror goes. Nothing else changes.

### 5.2 Job stats and risk (`job-stats.ts`, `lib/profit/risk.ts`)

For a job with `program_job = true`:

- `plan` passed to `projectJob` and `assessRisk` is the program's month plan as plan totals (units = planned units, revenue = forecast), with no labor or cost plan. It is never the quote or budget.
- `plannedUnits` = the program's planned units for the current month, not `jobs.planned_units`.
- Rules W7 ("price but no cost plan"), D4 ("no plan"), W8 ("past planned units") and the "Add a quote or a budget" next step never fire. The program rules in 6 take their place.
- `noPrice` is already false for program fed jobs. Keep it.

### 5.3 Job page (`features/jobs`)

When `program_job` is true:

- Opening `/jobs/J-26131` goes to `/programs/GLOVE`. `/jobs/J-26131?view=job` shows the job page with a banner: "This job holds the labor and costs of the GLOVE program. See the program for its plan and profit." and the button "Open program".
- The Quote and Budget tab and the "Plan vs actual" tab are replaced by one line: "Plans come from the GLOVE program in Projects." When typed plans exist, add: "The quote typed on this job is kept but not used."
- Job prices: replace the typed price with "Varies by variant" (or the single card price when every variant pays the same), and "Prices come from GLOVE price card v2 in Projects." with "Open price card" (as in SPEC 6.1).
- The job overview does not show "There is no quote or budget".

### 5.4 Jobs list, search, home, profit

- Jobs list hides `program_job` jobs by default. A new chip "Programs" shows them. The existing "Fed by a program" filter stays for jobs that only take billed builds.
- Search: a program key or name returns the program first ("GLOVE · Ultra Glove Program · Program"), then its job.
- Home: a "Programs this month" card (top 5 by revenue: name, revenue, margin against target, a dot for health) when the org tracks any program.
- Profit page: group by "Program" stays. Each program row links to its program page.
- Month close: "Programs settled" and "Programs synced" stay. Each program row in the checklist links to its program page.

## 6. Program alerts (`lib/profit/program-risk.ts`)

Shown on the program page, in the program list health dot, and in Alerts. Each has one action.

| Rule | Fires when | Sentence | Action |
|---|---|---|---|
| P1 | Forecast margin below the target by more than the at risk gap | "GLOVE is heading for a 18% margin this month. The target is 30%." | See by variant |
| P2 | Forecast margin below the floor | "GLOVE is heading below the 10% floor this month." | See by variant |
| P3 | Cost per unit this month is more than 10% above the last 3 closed months | "Each kit costs $2.41 this month, up from $2.09." | See days |
| P4 | A variant's margin is below the floor with at least 100 units this month | "XL Yellow loses $0.31 a kit." | Open variant |
| P5 | Projected gap to the monthly minimum is above zero | "May miss the $2,900 minimum by $1,240.00." | Open program in Projects |
| P6 | Work days in the month with units and no hours | "3 days have kits but no hours." | Add hours |
| P7 | Units per hour this week is 15% under the month | "The crew is 18% slower this week." | See days |

Thresholds use the org's existing risk settings (`atRiskGapBp`, `marginFloorBp`). P1 and P2 need at least 3 work days with units in the month. P5 reads the forecast from 3.3. P6 replaces the job's missing hours check for program jobs.

## 7. Screens

Plain 8th grade copy. No em dashes or double dashes anywhere.

### 7.1 Navigation

A new "Programs" item between Jobs and Profit, icon `Repeat2` (same as Projects). Shortcut `G R`. Hidden when Projects is not entitled or the program tables are missing (`programsReady`). Command palette: "Go to Programs" and each tracked program by key.

### 7.2 Programs list (`/programs`)

- Month picker (this month by default) and a search box.
- Table: Program (name and key), Customer, Kits this month (unit label), Planned, Revenue, Cost, Profit, Margin (colored against target), Forecast margin, Units per hour, Health dot, Job number (muted).
- Footer totals: money summed, units summed per unit label.
- "Not tracked yet" section under the table: programs in Projects with no Pulse job, each with a "Track in Pulse" button (calls `trackProgram`). Copy: "These programs run in Projects. Track them here to see labor, cost and margin."
- Empty state: "No programs yet. Programs are set up in Projects." with "Open Projects".
- Without money rights: Revenue, Cost, Profit and Margin columns are hidden.

### 7.3 Program page (`/programs/[key]`)

Header: name, key, customer, status chip ("Running", "Paused", "Ended" from SPEC labels), month picker, "Open in Projects", "Open the job" (muted link to `/jobs/J-26131?view=job`).

Tabs:

1. **Overview**
   - KPI strip: Revenue, Cost, Profit, Margin (against target), Kits built (against planned), Units per hour.
   - Forecast row: "Forecast revenue $32,508.18 (from Projects)", "Forecast cost $22,104.00", "Forecast margin 32%".
   - Chart: cumulative revenue and cost by day, with the forecast and target lines.
   - Alerts strip (section 6, up to 3).
   - "Matches Projects to the cent" or "Pulse is catching up" (SPEC 6.1 parity rules, same audience).
2. **By variant**: variant, planned, built, scrap, revenue, labor, material, profit, margin, profit per kit, share of revenue. Footer rows "Program fees" and "Not tied to a variant", then Total equal to the Overview. A small control "Labor split: By kits / By standard time / As logged" (saves to prefs for people with `rate:manage`, else changes the view only). Phone layout: one card per variant with kits, profit per kit and margin.
3. **By month**: last 12 months. Units, revenue, cost, profit, margin, target margin, minimum met or missed, closed or open. Clicking a month opens that month on the Overview.
4. **Days**: the month by work day. Planned, built, scrap, hours, units per hour, revenue, cost, profit. Days with kits and no hours are flagged with an "Add hours" link to the daily log, prefilled for the program job.
5. **Labor**: hours and cost by labor class and by person for the month, and prep labor from Projects (`pmt:` rows) on its own row "Prep work in Projects".
6. **Settings** (`rate:manage`): target margin (placeholder shows the value it inherits and where from), labor split, standard minutes per variant.

### 7.4 States

Loading skeletons per section. Errors use the existing Pulse error block. When the program is deleted in Projects: "This program was deleted in Projects. Its past months stay here." and the page is read only. When Projects is not entitled: the nav item and pages are hidden and program jobs show as normal jobs.

## 8. Existing production data

The 8 programs in production (GLOVE, BULLET, EXPLOR, BIGFAC, FOAM, DUDE, MAHCO, MAHECO, jobs J-26131 to J-26138) are converted by the migration backfill and the first sync. After deploy:

- `/programs` lists all 8 with their month numbers.
- J-26131 no longer shows "Past its planned units". Its plan is GLOVE's planned builds and forecast.
- J-26132 no longer shows "Has a price but no cost plan". Its price shows "Varies by variant".
- Typed quotes stay in `pulse.job_plans` and are listed as "kept but not used".
- Revenue, units and every posted row are unchanged. A check query before and after deploy compares `sum(base_revenue_cents)` and `sum(amount_cents)` per job, and they must match.

## 9. Tests and acceptance

- Unit tests for `programMonthFigures` (splits add up to the cent in all 3 modes, a day with cost and no units, a variant with no standard), `programMonthPlan` (matches Projects' forecast for the seed GLOVE November), the cost forecast, and each program alert rule (fires and does not fire).
- DB tests: `trackProgram` (makes the job and edge once, refuses a second, refuses a non per unit job), `convertToProgramJob` (idempotent), sync sets and clears `program_job`, money hidden for a viewer on every read.
- Risk tests: a `program_job` never gets W7, W8, D4 or "Add a quote or a budget", even with a typed quote present.
- Seed acceptance (Northwind, 2026-11-25): `/programs` shows GLOVE with the SPEC 7.4 numbers ($29,970.40 revenue month to date, 560 of 800 kits today, forecast equal to Projects), DUDE and MAHCO rows, and ECOMM and TEES under "Not tracked yet".
- Parity: for every seeded program, Overview revenue equals Projects' month revenue to the cent.
- Screens at 1440 light, 1440 dark and 375, checked by a critic against a strong recurring revenue dashboard, as in the Programs build.

## 10. Work breakdown

Disjoint file ownership, each layer ends with typecheck, tests and a commit.

| Layer | Owns | Done when |
|---|---|---|
| T1 Data | `apps/pulse/drizzle/0016_program_tracker.sql`, journal, schema files, `sync-programs.ts` step 1 | Migration applies twice cleanly; backfill sets the 8 production jobs; sync keeps the flag |
| T2 Math | `lib/profit/program.ts`, `lib/profit/program-risk.ts` and tests | All unit tests in 9 pass |
| T3 Server | `server/domain/programs.ts`, `server/actions/programs.ts`, API routes, `job-stats.ts` and `risk.ts` changes in 5.2 | DB and risk tests pass; reads hide money |
| T4 Screens | `app/(app)/programs/**`, `features/programs/**`, nav, palette, home card | Seed acceptance and screenshots pass the critic |
| T5 Job page and lists | `features/jobs/**` changes in 5.3 and 5.4, search | J-26131 redirects; no quote prompts on program jobs |
| T6 Check | Before and after money check script, docs | Money unchanged, parity holds for all seeded programs |

## 11. Open questions

1. Should the program job stay visible in the Jobs list, or only behind the "Programs" chip? This spec hides it by default.
2. Is the default labor split "by kits" right, or do you track standard minutes per SKU today?
3. Should the target margin live per program (this spec) or per customer?
4. Do you want a printable monthly program report (revenue, cost, margin by variant) for the customer review, or is the screen enough for now?
