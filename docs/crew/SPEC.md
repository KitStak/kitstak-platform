# KitStak Crew: product + build spec

Status: approved by the owner (2026-11-27). Every proposed default in 0.2 and every marked small choice is confirmed as written.

The people app for kitting, 3PL and contract packaging floors: people, shifts, the time clock, attendance, skills and labor planning.
Working tagline: *Staff it. Clock it. Plan it.* It runs standalone (only Crew licensed, CSV in and out) or bundled with Pulse, WMS,
Projects, CRM and, when it exists, Ledger.

Source of truth for scope: [`docs/crew/REFERENCE.md`](REFERENCE.md). This spec follows the layout of [`docs/pulse/SPEC.md`](../pulse/SPEC.md)
and reuses its conventions wherever Pulse already settled a question. Companion docs written with the build, the same way Pulse did:
`docs/crew/CONTRACTS.md` (folder ownership, function names, DTOs), `apps/crew/AGENTS.md`, `apps/crew/drizzle/README.md` and
`packages/crew-bridge/README.md`.

Copy rule for every user facing string: plain 8th grade words, short sentences, never an em dash, en dash or double dash. Enforced by
ESLint and `copy-rules.test.ts`, copied from Pulse.

**Words we use on screen.**

| In code | On screen |
|---|---|
| person, `crew.people` | Person (never "employee" for the whole list: temps are people too) |
| user, `core.user` | Sign in, or "has a login" |
| vendor with kind `temp_agency` | Agency |
| punch kinds `in`, `out`, `break_start`, `break_end`, `switch` | Clock in, Clock out, Start break, End break, Switch job or area |
| `time_days`, segments | Time card |
| exception | Needs a fix |
| `regular_minutes`, `ot_minutes`, `dt_minutes` | Regular, Overtime, Double time (hours on screen, never minutes) |
| week approval | Approve the week |
| `no_call_no_show` | No call no show |
| labor plan gap | People short, or People extra |
| target units per labor hour | Target pace (Pulse word) |
| indirect allowance | Time not on a job (Pulse words) |

## 0. Decisions

### 0.1 Decided by the owner

| Topic | Decision |
|---|---|
| Where people live | In the `crew` schema (`crew.people`), with an optional link to `core.user`. Most people never sign in. Kiosk access is a site device credential, not a person's session. This answers reference 9.1. |
| Vendors | A new shared `core.vendors` table, owned by `@kitstak/db` migrations, used by Crew (temp agencies), Ledger (suppliers, carriers, agencies) and later WMS. Shape in 5.2. Crew links agency people to a vendor whose `kinds` contains `temp_agency`. |
| Price | $4 per person each month. Every active person on the floor counts, temps included. Already held in `PLANNED_PRODUCTS.crew` in `packages/billing/src/catalog.ts`; this spec never repeats the cents. |
| Access before launch | A preview gate, not billing. Crew is NOT in `PRODUCT_IDS`, `MODULES` or the `core.entitlements.module` CHECK until launch (reference 11, blocker 1). See 3.4. |
| App shape | `apps/crew`, package `kitstak-crew`, dev port 3800, schema `crew`, bridge `@kitstak/crew-bridge`, origin `crew.kitstak.app` (`NEXT_PUBLIC_CREW_URL`). Same stack as Pulse and Projects. |
| Pay rates | Stay in Pulse (reference 5.3). Crew keeps a plain wage per person only when Pulse is absent, for its own estimates, and offers it to Pulse the day Pulse is added. |

### 0.2 Proposed defaults, confirmed by the owner (2026-11-27)

| # | Open question (reference 9) | Proposed default |
|---|---|---|
| 1 | Payroll export | A generic CSV export first (Phase 4), then QuickBooks Payroll (matches Ledger's QuickBooks Online first choice). Gusto, ADP and Paychex later. |
| 2 | Kiosk hardware | Any modern tablet in a browser, installed as a home screen web app. No supported device list. |
| 3 | Job time into Pulse | Clocking onto a job in Crew creates **suggested** Pulse labor hours that a supervisor accepts in Pulse. Crew never writes Pulse labor hours directly. |
| 4 | Attendance points | Raw late, early out, no call no show and called out records in the first release. A per org points policy comes later. |
| 5 | Spanish | Kiosk and phone clock in English and Spanish at launch. The rest of the app English first. |

Smaller choices made in this spec are marked **(choice)** where they appear. The owner confirmed all of them on 2026-11-27.

## 1. Topology

| | Dev | Prod |
|---|---|---|
| App | `apps/crew` (npm `kitstak-crew`), `http://localhost:3800` (personal dev servers 3801 to 3820) | `crew.kitstak.app` (new Vercel project `crew`, Root Directory `apps/crew`) |
| DB | shared Postgres, new schema **`crew`** | same Supabase DB |
| Auth | Better Auth via `@kitstak/auth` (copy `apps/pulse/src/server/auth.ts` and `session.ts`; cookie `kitstak.session_token`) | `AUTH_COOKIE_DOMAIN=.kitstak.app` |
| Access | Preview gate `KITSTAK_PREVIEW_ORGS` (3.4) until launch, then entitlement module **`crew`** | at launch: `pnpm --filter @kitstak/entitlements grant grant <org-slug> crew` |
| URL env var | `NEXT_PUBLIC_CREW_URL` (default `http://localhost:3800`), read by every app that links to Crew | `https://crew.kitstak.app` |
| Migrations | `apps/crew/drizzle`, runner `scripts/db-migrate.ts` (copy of Pulse), table `drizzle.__kitstak_crew_migrations`, advisory lock key `7_202_611_506` **(choice: next free key; Ledger takes 507)** | fresh database order: `@kitstak/db`, CRM, WMS, Projects, Pulse, then `pnpm --filter kitstak-crew db:migrate` last |
| Shared migration | `packages/db/drizzle/0012_core_vendors.sql` creates `core.vendors` (5.2). It belongs to `@kitstak/db` and runs before any app. | |
| Bridge package | `packages/crew-bridge` (`@kitstak/crew-bridge`), raw SQL over the host app's Drizzle executor, same shape as `@kitstak/pulse-bridge` | |
| Cron | `vercel.json`: `/api/v1/cron/tick` every 15 minutes (day rollover per site, attendance, missing clock out flags, certification warnings, plan snapshots, schedule notices, sibling sync), `/api/v1/cron/cleanup` daily at 07:20 UTC (photo and import retention). Both need `Authorization: Bearer $CRON_SECRET` and return 503 when it is not set. | |

Env (`src/server/env.ts`, lazy, zod): `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_PORTAL_URL`, `NEXT_PUBLIC_CRM_URL`, `NEXT_PUBLIC_WMS_URL`, `NEXT_PUBLIC_PROJECTS_URL`, `NEXT_PUBLIC_PULSE_URL`,
`NEXT_PUBLIC_LEDGER_URL` (optional until Ledger exists), `TRUSTED_ORIGINS`, `AUTH_COOKIE_DOMAIN`, `KITSTAK_PREVIEW_ORGS`, `CRON_SECRET`,
`CREW_DB_GUARD` (same meaning as `PULSE_DB_GUARD`: runs queries as the plain role `crew_app` with the workspace set), `HEALTH_TOKEN`,
`CREW_KIOSK_PRIVATE_KEY` (RSA key for queued kiosk PINs, 6.4), `BLOB_READ_WRITE_TOKEN` (optional, card copies and punch photos; without it
bytes go into `crew.attachments.data`, the Projects pattern), `RESEND_API_KEY` and `EMAIL_FROM` (optional, schedule notices through
`@kitstak/mail`). `appUrls()` returns `{portal, crm, wms, projects, pulse, ledger, crew}`. `trustedOrigins()` adds the sibling URLs and dev
ports 3800 to 3820 only when `NODE_ENV !== 'production'`.

Ops surface, same as Pulse: `GET /api/health`, structured error logs with org id and request id, `error.tsx`, `not-found.tsx`,
`global-error.tsx`, security headers and CSP in `next.config.ts` matching the sibling policy (`connect-src 'self'`, plus `camera=(self)` and
`geolocation=(self)` in `Permissions-Policy` for the kiosk photo and the phone fence), and `robots` disallow all.

## 2. Stack (match apps/pulse exactly)

Next.js 16.4.5 App Router (`src/proxy.ts`, `params` are Promises), React 19.3, Tailwind 4 via `@tailwindcss/turbopack`, `@kitstak/ui`
tokens, theme, logo, app switcher and handoff, Drizzle + pg via `@kitstak/db/client-pg`, zod 4, lucide-react, radix, cmdk, sonner,
zustand, `@tanstack/react-query`, `@tanstack/react-virtual`, date-fns, vitest, Playwright. Dependencies are the same list and versions as
`apps/pulse/package.json` minus `@kitstak/programs-engine`, plus `@kitstak/pulse-bridge`, `@kitstak/pm-bridge`, `@kitstak/mail` and
`@vercel/blob`. No chart library (copy the house SVG kit from Pulse `src/features/charts/`). CSV is the Pulse module `src/lib/csv.ts`,
copied with its tests.

Layering is the house pattern: thin pages, `src/features/<area>` for server page plus client view, all data access in
`src/server/domain/*` (first argument `ctx: DomainContext`), mutations as server actions returning `ActionResult<T>`, client reads from
same origin `/api/v1/*` with the `{ data } | { error }` envelope, every write in one transaction with an activity row. Background work is
`after()` on a route with an explicit `maxDuration`. The database guard (`src/server/db/scope.ts`: `scoped`, `withOrg`, `asSystem`) is
copied from Pulse on day one, not added later.

Time math lives in pure modules with no server imports: `src/lib/time/{zone,round,segments,overtime,breaks,attendance}.ts` and
`src/lib/plan.ts`. Timestamps are `timestamptz`; every local time is computed with the site time zone through one helper
(`zone.ts`, date-fns-tz style functions written in house over `Intl.DateTimeFormat`, tested across both DST changes). Money uses the Pulse
`src/lib/money.ts` (`BigInt`, `divRound`).

## 3. Roles and permissions

### 3.1 Roles

A person's Crew role is the first of these that applies:

1. Their row in `crew.member_roles` (set by an admin or by the claim step).
2. Their org role (`core.member.role`): `owner` gives **owner**, `admin` gives **admin**, `member` gives `settings.default_member_role`
   (default **none**), `viewer` and `guest` give **none**.

Being linked to a Crew person never grants a role by itself. A linked person with role none still gets the phone clock and `/me` for
themselves (3.3). Claim step, same as Pulse: if nobody resolves to owner, the first admin who opens Crew is offered "Run Crew for this
workspace"; if there is no admin, any member is offered it.

| Role | Who it is | Sees pay | Scope | Can do |
|---|---|---|---|---|
| **owner** | business owner | yes | all sites | everything, including delete all data |
| **admin** | ops or HR lead | yes | all sites | settings, labor rules, kiosks, roles, certification types, plus all payroll rights |
| **payroll** | payroll or finance | yes | all sites | all supervisor rights on every site, pay type and wages, reopen approved weeks, payroll exports, time off balances |
| **supervisor** | site or shift supervisor | no | the sites in `site_ids` (null = all) | people, schedule, publish, punch edits with a reason, approve the week, attendance, time off decisions, skills, labor plan, imports (no wage columns) |
| **lead** | crew lead on the floor | no | their crew (3.2) | read their crew's schedule, punches and time cards, the today board and the labor plan. No edits. |
| **viewer** | read only (a Projects or WMS manager) | no | all sites | published schedule, the today board, the skills matrix |

### 3.2 Sight matrix

| Data | owner, admin, payroll | supervisor (their sites) | lead (their crew) | viewer |
|---|---|---|---|---|
| Published schedule, open shifts | yes | yes | their crew, plus open shifts at their sites | yes |
| Draft schedule | yes | yes | no | no |
| Punches and time cards | yes | yes | read only | no |
| Attendance events | yes | yes | no | no |
| Time off requests | yes, with type and reason | yes, with type and reason | dates only ("Out") | dates only ("Out") |
| Emergency contact, home address, phone | yes | yes | no | no |
| Pay type, wage, payroll exports | yes | no | no | no |
| Certifications and skills | yes | yes | yes | yes |

**A lead's crew** **(choice)** is the people whose `lead_person_id` is the lead's own linked person, plus anyone assigned on that date to
a shift whose `lead_person_id` is the lead's person. A lead with no linked person has no crew.

### 3.3 Actions

`src/lib/permissions.ts` (min role, then the site or crew scope check): `crew:read` viewer · `schedule:read` viewer · `schedule:draft`
supervisor · `schedule:publish` supervisor · `request:decide` supervisor · `person:manage` supervisor · `person:private_read` supervisor ·
`punch:edit` supervisor · `hours:approve` supervisor · `attendance:read` supervisor · `attendance:edit` supervisor · `timeoff:decide`
supervisor · `skills:manage` supervisor · `plan:read` lead · `plan:manage` supervisor · `import:run` supervisor · `export:run` supervisor ·
`pay:read` payroll · `pay:manage` payroll · `week:reopen` payroll · `export:payroll` payroll · `timeoff:balance` payroll ·
`kiosk:manage` admin · `rules:manage` admin · `certtype:manage` admin · `roles:manage` admin · `settings:manage` admin · `sample:manage`
admin · `data:purge` owner.

Self rights, for any signed in user linked to a live person, with any role including none: `self:clock` (phone clock), `self:read` (own
schedule, time card, time off and certifications), `self:request` (time off, pickups, swaps, drops).

**Pay and private details are hidden on the server, never only in the UI.** Every DTO builder takes `canSeePay` and `canSeePrivate`.
When hidden, the fields are `null` and the DTO carries `payHidden: true` or `privateHidden: true`; exports drop the columns; pay endpoints
return 403. Attendance never appears in a lead's or viewer's DTO. A unit test walks every DTO type (app and bridge) as a lead and fails if
any pay, wage, private or attendance field is not null, or if any string matches a currency symbol followed by a digit. Notifications are
stored as `{ kind, params }` and rendered per reader, the Pulse `renderReason` pattern.

### 3.4 Preview gate (before launch) and the swap at launch

Before launch Crew has no entitlement row to read. One function decides access, shared with Ledger and living in
`@kitstak/entitlements` (`packages/entitlements/src/preview.ts`, being added in this branch) so every app agrees:

```ts
previewAccess('crew', orgSlug, env): 'full' | 'locked'
// 'full'   when ENTITLEMENTS_DEV_ALLOW_ALL is true (1, true, yes, on)
// 'full'   when NODE_ENV !== 'production', unless ENTITLEMENTS_DEV_ALLOW_ALL is false (everyone in local dev)
// 'full'   when the slug is in KITSTAK_PREVIEW_ORGS (comma separated, trimmed, lowercased, empties dropped)
// 'locked' otherwise. There is no view only state: a preview has no plan to lapse.
```

- `apps/crew/src/server/entitlements.ts` exports `orgCrewAccess(org)`, the only caller in the app. `src/server/plan-gate.ts` is the Pulse file with
  the word Pulse swapped (`assertPlanAllows(orgId, { write })`), so route handlers, actions, cron and device links already call the
  launch shaped gate. Before launch it only ever sees `full` or `locked`.
- Locked screen (`(app)` layout): "Crew is in preview. Ask KitStak to add your workspace." No billing link, because nothing can be bought.
  API returns 402 `NOT_ENTITLED`. Kiosk and agency links of a locked org answer "This link is not active."
- Sibling apps show Crew (app switcher row, Portal tile, deep links) only when the same function says `full` **(choice)**. So
  `KITSTAK_PREVIEW_ORGS` is set on the Crew, Portal, Pulse, WMS and Projects Vercel projects (`deploy/push-env.mjs` gets the key). Bridge
  data reads do not use the gate: they answer from data that exists.
- **At launch** (one PR, the "billing" blocker of reference 11): move `crew` into `PRODUCT_IDS` and `CATALOG.products`; add `crew` to
  `Module` and `MODULES` and to `ENTITLEMENT_MODULES`; a `@kitstak/db` migration widens `entitlements_module_check`; because Pulse's
  `0000_pulse_init.sql` re-adds the CHECK with four values on a fresh database, `apps/crew/drizzle/00NN_crew_entitlement.sql` re-adds it
  with every module inside a `to_regclass('core.entitlements')` guard and Crew keeps migrating last (CI chain test asserts the list).
  `orgCrewAccess` becomes `getModuleAccess(db, orgId, 'crew')` with Pulse's allow all rule; `crew` leaves `PREVIEW_APPS` (the env var
  goes away when Ledger also launches); siblings switch to their entitlement flags. Before the deploy, every slug in `KITSTAK_PREVIEW_ORGS` gets a manual grant so no
  preview org is locked out on launch day. Billing counts people with `countBillablePeople` (8.1).
- Tests: `packages/entitlements/src/preview.test.ts` (dev, the allow all switch both ways, listed, unlisted, spaces and case in the list,
  empty list, no slug), an app test that every gated route and action goes through `orgCrewAccess`, and a launch test that is skipped
  until `isModule('crew')` is true, then asserts Crew no longer calls `previewAccess` (grep test).

## 4. Domain rules

### 4.1 Units and precision

- Durations are integer **minutes** inside Crew. Seconds are kept on punches; worked time per day is summed in seconds, then
  `minutes = divRound(seconds, 60)` once per day and bucket.
- Hours shown or sent to another app are `numeric(10,2)`: `hours100 = divRound(minutes * 100, 60)`, converted once per person, day and
  bucket (regular, overtime, double time, each paid time off type). Week and pay period totals are sums of those day values, so every file
  adds up to its rows.
- Work dates are `date` columns surfaced as `YYYY-MM-DD`. "Today" is today in the **site** time zone (`crew.sites.timezone`).
- Money appears only in wages (`wage_cents int`) and labor plan estimates (`bigint` cents), with the Pulse `divRound` rule (half away from
  zero). Ratios with a zero divisor are `null`.

### 4.2 Punch model

A punch is one tap. Kinds: `in`, `out`, `break_start` (with `break_kind` `meal` or `rest`), `break_end`, `switch` (to another area or
Pulse job without leaving work). Every punch has a person, a site, `punched_at timestamptz`, an optional area and Pulse job, a source
(`kiosk`, `phone`, `web`, `import`, `edit`, `system`) and, from a device, a `client_ref` that makes retries safe.

**Allowed sequence** per person: `in`, then any number of (`switch` | `break_start` then `break_end`), then `out`. A tap that breaks the
sequence is refused at the kiosk with a plain reason ("You are already clocked in since 6:58 AM.") and never stored. Offline punches that
arrive out of sequence are stored and flagged `sequence` (a fix for a supervisor), because the tap really happened.

**Work date.** A shift belongs to one work date even when it crosses midnight. A clock in takes the work date of the person's scheduled
shift whose start is within 120 minutes of the punch, else the site local date of the punch. Every later punch until `out` takes the work
date of its clock in. `week_start` (the site week that holds the work date) is stored on the punch too, for the lock trigger.

**Segments.** `buildSegments(punches, rules)` (pure) turns one person's live punches for a work date into segments: work segments (with
area and job), paid break segments and unpaid break segments. A `rest` break is paid. A `meal` break is unpaid unless it is shorter than
`short_break_paid_under_minutes` (default 20), then it is paid. Segments are stored in `crew.time_segments` for job hours suggestions and
the time card view.

**Missing punches are never guessed (choice).** An open clock in at the end of the day is not closed by the system. The time card shows
"Needs a fix: no clock out" and counts no time after the last punch, so the person is not underpaid by a guess and not paid for hours
nobody saw. The supervisor adds the clock out with a reason. Same for a break with no end.

**Double taps.** The same kind for the same person within 60 seconds is answered "Already done" and not stored.

### 4.3 Rounding (per site, never in the shop's favor)

`site_rules.rounding_mode`: `exact` (default: to the minute, no rounding), `nearest` (to `round_increment_minutes`: 5, 6, 10 or 15) or
`worker_favor` (clock in rounds down, clock out rounds up, to the increment). There is no mode that rounds in the shop's favor. Rounding
touches only `in` and `out` punch times; breaks and switches are exact. A tie under `nearest` goes the worker's way (in down, out up).
The stored punch keeps its real time; the rounded time is computed when the time card is built and both are shown.

Worked examples (increment 15). `nearest`: in 6:53 becomes 7:00, in 6:52:30 is a tie and becomes 6:45, out 15:22 becomes 15:15, out
15:23 becomes 15:30. `worker_favor`: in 6:58 becomes 6:45, out 15:02 becomes 15:15. `exact`: 6:58:40 to 15:02:10 is 8 hours 3 minutes
30 seconds of span, 483.5 minutes, `divRound` gives 484.

Time always counts from the punch, never from the scheduled start **(choice)**: a person who clocks in early is paid from the clock in.
Late and early grace windows are attendance rules only (4.7) and never change pay.

### 4.4 Overtime as data per site

`crew.site_rules` holds the rule set, dated by `effective_from`; the row in force on a week's first day applies to the whole week.
Fields: `ot_weekly_minutes` (default 2400), `ot_daily_minutes` (null = no daily overtime), `dt_daily_minutes` (null = no daily double
time), `seventh_day_rule boolean`. Presets fill the fields and are plain data in `src/lib/time/presets.ts` **(choice: two presets plus
custom)**: **Federal** (weekly 40), **California** (daily 8, double time after 12, weekly 40, seventh day rule). Multipliers are not in
Crew: Pulse holds the overtime multiplier (Pulse 4.3), payroll applies pay.

Algorithm `splitWeek(days, rules)` (pure), per person and site week, days in date order:

```
for each day with d worked minutes:
  if seventh_day_rule and this is the 7th consecutive worked day of the week:
      ot = min(d, 480), dt = max(0, d - 480), reg_candidate = 0
  else:
      dt = dt_daily ? max(0, d - dt_daily) : 0
      ot = ot_daily ? max(0, min(d, dt_daily ?? d) - ot_daily) : 0
      reg_candidate = d - ot - dt
  weekly: regular minutes run in time order; the part of reg_candidate that takes the running regular total past
          ot_weekly becomes overtime on that day, the rest stays regular
```

Weekly overtime counts only regular minutes, so no minute is overtime twice. `overtime_exempt` people (salaried exempt) get all minutes
regular. Overtime is decided per person per week, which is what Pulse 4.4 says payroll does.

Worked examples (tests with the same numbers):
- Federal. Monday to Friday 8.5 hours each, 42.5 hours. Monday to Thursday 8.50 regular each; Friday 6.00 regular and 2.50 overtime.
  Week: 40.00 regular, 2.50 overtime.
- California. Monday 10, Tuesday 13, Wednesday to Friday 8 each, Saturday 6, 53 hours. Monday 8 regular, 2 overtime. Tuesday 8 regular,
  4 overtime, 1 double time. Wednesday to Friday 8 regular each (running regular reaches 40 on Friday). Saturday 6 overtime (weekly).
  Week: 40.00 regular, 12.00 overtime, 1.00 double time.

**Two edge choices for the owner.** A shift that crosses midnight counts all its minutes on its work date (4.2), including for daily
overtime **(choice: simple and common; strict California workday splitting is not in the first release)**. A person who works at two
sites in one week has one overtime week, using their home site's rules and week start, with minutes from every site counted **(choice)**.

### 4.5 Meal and rest break rules as data

`crew.break_rules` rows belong to a `site_rules` row: `kind` (`meal`, `rest`), `nth smallint` (first, second), `after_worked_minutes`,
`min_minutes`, `paid boolean`, `checked boolean`. California preset: meal 1 after 300 minutes, 30 minutes, unpaid, checked; meal 2 after
600 minutes, 30 minutes, unpaid, checked; rest 10 minutes paid per 240 minutes, not checked (rest breaks are not punched by most floors).
Federal preset: no rows.

Checks on each time card, per checked rule: **Meal missed** when worked minutes exceed `after_worked_minutes` and no unpaid meal of at
least `min_minutes` started at or before worked minute `after_worked_minutes`. **Meal short** when the meal taken is under `min_minutes`.
Crew flags these; it does not compute premium pay **(choice)**. There is no automatic meal deduction, because a deduction for a break that
was not taken is in the shop's favor.

### 4.6 Time cards, approval and the week lock

`rebuildTimeCards(person, week)` runs inside every punch, edit and rule write: it rebuilds `crew.time_segments` and `crew.time_days` for
the person's overtime week (4.4) from live punches, applying rounding, breaks, the overtime split and the checks.

**Needs a fix** (`time_days.exceptions text[]`). Blocking: `missing_out`, `missing_break_end`, `sequence`, `unverified` (an offline PIN
that failed, 6.4), `overlap` (two open clock ins). Warnings: `meal_missed`, `meal_short`, `outside_fence`, `clock_skew`, `long_day` (over
16 hours), `no_shift` (worked with no scheduled shift), `photo_missing`. A blocking exception stops approval; a warning is shown and can be
ticked "OK as is" by the approver (stored in `week_approvals.accepted`).

**Edits keep the original.** Punches are never changed. An edit writes a `crew.punch_edits` row (`kind` `add`, `change` or `void`,
`reason_code`, required `reason` text, who, when, before and after) and, for add and change, a new punch with `source = 'edit'`; the old
punch gets `superseded_at` and `superseded_by_edit_id`. A trigger refuses any other update to a punch and any update or delete of an
edit. The time card shows the original struck through with the edit beside it.

**Approve the week** per site and week (`crew.week_approvals`). Approving needs `hours:approve` for the site and no blocking exception on
any time card of that site and week. Approval stamps who and when and freezes the overtime split. **Lock:** a trigger on `crew.punches`
and `crew.punch_edits` raises `week_locked` when an approved row exists for the punch's `(site_id, week_start)`, checked for both OLD and
NEW on update, with the Pulse purge bypass (`crew.allow_purge` set by `SET LOCAL`, and the org cascade case). Reopen needs `week:reopen`
and a reason, is logged, and says "This week was sent to payroll on Nov 3. You will need a new export." when it was exported.

### 4.7 Attendance (raw records, no points in the first release)

Computed at each site's day rollover (cron, the first tick after 03:00 site time for the day before) and on any punch or schedule change
for a past day. Per published shift assignment:

| Kind | Rule |
|---|---|
| `late` | first clock in after shift start + `late_grace_minutes` (default 5). `minutes` = how late. |
| `early_out` | last clock out before shift end - `early_out_grace_minutes` (default 5). `minutes` = how early. |
| `no_call_no_show` | no clock in by shift end, no approved time off covering the shift, no `called_out` row. |
| `called_out` | typed by a supervisor (or by the person in `/me` before the shift starts). |

Approved time off covering the shift means no event. A supervisor can **excuse** an event with a reason (kept, marked excused) or void a
wrong one. Edits are logged. The today board (6.3) shows the same facts live. A per org points policy is later (0.2 item 4); no columns
are reserved for it.

### 4.8 Time off

Types per org (`crew.time_off_types`: name, `paid`, `uses_balance`). Requests cover whole days or a number of hours per day. Balances
are a ledger (`crew.time_off_ledger`: plus or minus minutes, reason `set`, `adjust`, `used`, `import`); the balance is the sum. Approving a
paid request writes `used` rows for each work day it covers. **No automatic accrual in the first release (choice)**: balances are set,
adjusted or imported by payroll. Approved time off shows on the schedule, blocks assignment with a warning, and is exported to payroll as
hours per type.

### 4.9 Labor plan

Reference 5.4, with units and rounding:

```
direct_hours  = planned_units / target_units_per_labor_hour          (exact fraction, per input row)
hours_needed  = round2( sum(direct_hours) + sum(setup_hours) + indirect_allowance )
indirect_allowance = typed hours for the day, else round2(sum(direct_hours) * indirect_bp / 10000)
shift_hours   = paid hours of the site's default shift template (span minus unpaid break), as hours100
people_needed = ceil(hours_needed100 / shift_hours100)                (integer ceiling)
gap           = people_needed - people_scheduled                      (positive = people short)
temp_cost     = divRound(gap * shift_hours100 * temp_rate_cents, 100)  (only when gap > 0)
```

`round2` rounds half away from zero to 2 decimals, done once at `hours_needed`. `people_scheduled` counts distinct people with a live
assignment on a published shift at the site that day, minus people with approved full day time off; drafts show as a second number
("plus 2 in the draft"). `target_units_per_labor_hour` comes from the input row, else the Pulse target pace for its job (8.2), else the
site's typed pace for the activity (`crew.plan_paces`). An input with no pace is listed "Add a target pace" and left out of the total, never
counted as 0 hours. `temp_rate_cents` is the Pulse real cost of an hour for the chosen temp labor class on that date (Pulse `rateFor`
through the bridge); without Pulse it is the class's typed wage in Crew, labeled "wage only, not the real cost". It shows only to readers
with `pay:read`.

Worked example (the site copy): 1,200 kits at 16 kits per labor hour is 75.00 direct hours, plus 4.00 setup, plus 6.00 time not on a job,
is 85.00 hours. 85.00 / 8.00 is 10.625, so 11 people. 8 scheduled: 3 people short. Temps at $19.50 an hour: `divRound(3 * 800 * 1950, 100)
= 46800`, $468.00 for the day.

`indirect_bp` default 0, with a "Use my last 90 days" button that reads Pulse's indirect hours over direct hours when Pulse exists, so
the plan and the cost model count the same way.

### 4.10 Certifications and skills

A certification type has a name, code, `valid_months` default and `warn_days` (default 30). A person certification has `earned_on`,
`expires_on` (the last valid day, null = never) and an optional card copy. Status, in site time: **Expired** when `expires_on < today`,
**Ending soon** when `expires_on <= today + warn_days`, else **Good**. The cron tells supervisors of the person's home site once when a card
enters Ending soon and once when it expires.

Skills are "trained on" items (`kind`: `kit`, `line`, `program`, `other`, optionally linked to a `core.items` row, a Crew area or a
Projects program) with a level: 0 In training, 1 Can do it, 2 Skilled, 3 Can train others.

**Requirements** (`crew.requirements`) attach to an area, a shift template or a shift: a certification type, or a skill with a minimum
level. When someone is assigned, Crew warns when a required card is missing, already expired, or ends before the shift date ("Forklift card
ends Dec 10, before this shift on Dec 12."), or a skill is missing or below level. Warnings, not blocks: assigning anyway needs a reason,
stored on the assignment and in activity **(choice)**. The same check runs for open shift pickups.

## 5. Data model (`crew` schema)

House rules, identical to Pulse section 5 and BLUEPRINT 2.2:
- uuid PK `gen_random_uuid()`; `org_id uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE` on every table and every query;
  `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`; enums are `text` + CHECK mirrored in Drizzle.
- Hand written SQL in `apps/crew/drizzle/NNNN_*.sql` with statement breakpoints, mirrored in `src/server/db/schema/*.ts`. Never
  `drizzle-kit push`.
- Every table has `UNIQUE (org_id, id)`; every FK between `crew` tables is composite `(org_id, x_id) REFERENCES crew.<parent>(org_id, id)`.
  RESTRICT from punches, shifts and events to people, sites and areas (those are archived, never hard deleted outside purge). User columns
  reference `core."user"(id) ON DELETE SET NULL`. Columns that point into sibling schemas (`pulse_*_id`, `wms_*`, `pm_*`, `crm_*`) have no
  FK, because the sibling may be absent.
- RLS on every table with the Pulse policy from day one: a row is visible only when `org_id = current_setting('crew.org_id')::uuid`.
  Role `crew_app` (no login, owns nothing) as in Pulse 0009. `rls.db.test.ts` fails when a crew table has RLS and no policy.
- **SD** = soft delete (`deleted_at`). **V** = `version int NOT NULL DEFAULT 1`, sent back on every edit; a mismatch is 409 with the
  fresh row. **SRC** = `source text NOT NULL DEFAULT 'manual'` with CHECK (`manual`, `csv`, `kiosk`, `phone`, `agency_link`, `pulse`,
  `projects`, `wms`, `crm`, `system`, `sample`), `source_ref text`, `import_batch_id uuid`, `is_sample boolean NOT NULL DEFAULT false`,
  `created_by`, `updated_by`, and a partial unique index `(org_id, source, source_ref) WHERE source_ref IS NOT NULL AND deleted_at IS NULL`.

### 5.1 Setup

**`crew.settings`** (PK `org_id`, made lazily): `default_member_role text DEFAULT 'none' CHECK (IN ('supervisor','lead','viewer','none'))`,
`week_start smallint DEFAULT 0 CHECK (0..6)` (default for new sites, Sunday), `default_timezone text DEFAULT 'America/Chicago'`,
`pin_length smallint DEFAULT 4 CHECK (IN (4,6))`, `phone_clock boolean DEFAULT true`, `fence_mode text DEFAULT 'flag' CHECK (IN
('off','flag','block'))`, `punch_photos boolean DEFAULT false`, `photo_retention_days smallint DEFAULT 90`, `schedule_email boolean
DEFAULT true`, `agency_links boolean DEFAULT true`, `number_prefix_temp text DEFAULT 'T-'`, `number_seq int DEFAULT 1000`,
`indirect_bp int DEFAULT 0`, `onboarding jsonb DEFAULT '{}'`, `sample_loaded_at timestamptz`.

**`crew.member_roles`**: `user_id uuid NOT NULL`, `role text CHECK (IN ('owner','admin','payroll','supervisor','lead','viewer','none'))`,
`site_ids uuid[]` (null = all sites; only read for supervisor and lead), `updated_by`. Unique `(org_id, user_id)`.

**`crew.sites`** (SD, V): `code`, `name`, `timezone text NOT NULL`, `is_default boolean`, `address jsonb`, `geo_lat numeric(9,6)`,
`geo_lng numeric(9,6)`, `fence_radius_m int DEFAULT 150 CHECK (25..5000)`, `week_start smallint NOT NULL`, `default_template_id uuid`,
`pulse_site_id uuid`, `wms_warehouse_id text`, `last_rollover_date date`, `archived_at`. Unique live `(org_id, lower(code))`; unique where
not null `(org_id, pulse_site_id)`, `(org_id, wms_warehouse_id)`. One default site "Main site" is made with the org. Same adoption rule as
Pulse: on the first WMS read the default site adopts the default warehouse and other warehouses become sites.

**`crew.site_rules`** (V): `site_id NOT NULL`, `effective_from date NOT NULL`, `preset text CHECK (IN ('federal','california','custom'))`,
`rounding_mode text DEFAULT 'exact' CHECK (IN ('exact','nearest','worker_favor'))`, `round_increment_minutes smallint CHECK (IN
(5,6,10,15))` (needed unless exact), `late_grace_minutes smallint DEFAULT 5`, `early_out_grace_minutes smallint DEFAULT 5`,
`short_break_paid_under_minutes smallint DEFAULT 20`, `ot_weekly_minutes int DEFAULT 2400`, `ot_daily_minutes int`, `dt_daily_minutes int`
(CHECK greater than `ot_daily_minutes`), `seventh_day_rule boolean DEFAULT false`, `note`. Unique `(org_id, site_id, effective_from)`. A
rule change dated inside an approved week is refused.

**`crew.break_rules`**: `site_rule_id NOT NULL` (CASCADE), `kind text CHECK (IN ('meal','rest'))`, `nth smallint DEFAULT 1`,
`after_worked_minutes int NOT NULL`, `min_minutes smallint NOT NULL`, `paid boolean NOT NULL`, `checked boolean NOT NULL DEFAULT true`.
Unique `(org_id, site_rule_id, kind, nth)`.

**`crew.areas`** (SD): `site_id NOT NULL`, `code`, `name`, `color`, `position int`, `archived_at`. Unique live `(org_id, site_id, lower(code))`.

**`crew.labor_classes`** (SD, SRC): `code`, `name`, `kind text DEFAULT 'employee' CHECK (IN ('employee','temp_agency'))`,
`is_default boolean`, `pulse_labor_class_id uuid`, `archived_at`. Unique live `(org_id, lower(code))`, `(org_id, pulse_labor_class_id)`.
When Pulse is present these rows are a mirror of `pulse.labor_classes` (`source = 'pulse'`, read only in Crew, "Edit in Pulse" link);
without Pulse Crew owns them (8.2).

### 5.2 People and vendors

**`core.vendors`** (owned by `@kitstak/db`, `packages/db/drizzle/0012_core_vendors.sql`): `id uuid pk`, `org_id uuid not null`,
`name text not null`, `kinds text[] not null default '{}'` with CHECK each in (`supplier`, `carrier`, `temp_agency`, `landlord`, `utility`,
`service`, `other`), `email text`, `phone text`, `address jsonb`, `notes text`, `external_refs jsonb not null default '{}'` (for example
`{"qbo_vendor_id": "..."}`), `archived_at timestamptz`, `created_at`, `updated_at`; unique `(org_id, lower(name)) WHERE archived_at IS NULL`.
The draft migration in this branch also carries the BLUEPRINT 2.2 columns `created_by`, `updated_by`, `version` and `deleted_at`, a
not blank name check, a GIN index on `kinds`, and leaves deleted rows out of the unique name rule. The Ledger spec uses the same shape. Crew writes vendors through one helper in `@kitstak/db` (`upsertVendorKind`): adding an agency whose
name matches a live vendor adds `temp_agency` to its kinds instead of making a second row. Crew edits name, email, phone and notes;
archiving from Crew is offered only when `kinds = '{temp_agency}'` **(choice)**.

**`crew.people`** (SD, SRC, V): `number text NOT NULL` (employee number; temps get `T-1001` up from `settings.number_seq` when none is
given), `first_name text NOT NULL`, `last_name text NOT NULL`, `preferred_name text`, `kind text DEFAULT 'employee' CHECK (IN
('employee','temp','seasonal'))`, `status text DEFAULT 'active' CHECK (IN ('active','on_leave','ended'))`, `home_site_id uuid NOT NULL`,
`usual_area_id uuid`, `labor_class_id uuid`, `lead_person_id uuid` (self FK), `agency_vendor_id uuid REFERENCES core.vendors(id) ON DELETE
RESTRICT` (CHECK set only when `kind = 'temp'`), `agency_ref text` (the agency's own id), `start_date date`, `end_date date` (CHECK
`end_date >= start_date`), `user_id uuid` (core.user), `wms_user_id text`, `email text`, `phone text`, `language text DEFAULT 'en' CHECK
(IN ('en','es'))`, `badge_hash text` (SHA-256 of the badge value), `pin_hash text` (scrypt, the Pulse `verifyKioskPin` helper), `pin_set_at`,
`pin_fails smallint DEFAULT 0`, `pin_locked_until timestamptz`, `notify_email boolean DEFAULT true`, `external_refs jsonb DEFAULT '{}'`
(`payroll_id`, `qbo_employee_id`), `notes text`.
Unique live: `(org_id, lower(number))`, `(org_id, user_id)`, `(org_id, badge_hash)`, `(org_id, wms_user_id)`. Indexes `(org_id, status)`,
`(org_id, home_site_id)`, `(org_id, agency_vendor_id)`, `(org_id, lead_person_id)`, `(org_id, lower(last_name), lower(first_name))`.
Setting `status = 'ended'` needs `end_date`; ended people leave pickers and the kiosk roster, and keep their history.

**`crew.person_private`** (PK `org_id, person_id`, CASCADE): `emergency_name`, `emergency_phone`, `emergency_relation`, `home_address jsonb`,
`private_notes`. Read only with `person:private_read`.

**`crew.person_pay`** (PK `org_id, person_id`, CASCADE): `pay_type text DEFAULT 'hourly' CHECK (IN ('hourly','salary'))`,
`overtime_exempt boolean DEFAULT false`, `updated_by`. **`crew.person_wages`** (V): `person_id NOT NULL`, `effective_from date NOT NULL`,
`wage_cents int NOT NULL CHECK (0..1000000)`, `note`, `sent_to_pulse_at timestamptz`. Unique `(org_id, person_id, effective_from)`. Read
with `pay:read`. The time engine reads `overtime_exempt` on the server whatever the viewer.

**`crew.agency_links`** (SD): `vendor_id uuid NOT NULL`, `site_id uuid NOT NULL`, `token_hash text NOT NULL UNIQUE`, `token_prefix text`,
`expires_at timestamptz NOT NULL` (default 14 days), `max_people int DEFAULT 50`, `revoked_at`, `created_by`.
**`crew.agency_submissions`**: `link_id NOT NULL`, `first_name`, `last_name`, `phone`, `email`, `agency_ref`, `start_date`, `language`,
`status text DEFAULT 'pending' CHECK (IN ('pending','accepted','rejected'))`, `person_id uuid`, `decided_by`, `decided_at`, `ip_hash`.
The form asks for nothing else: no tax ids, no birth dates.

### 5.3 Schedule

**`crew.shift_templates`** (SD): `site_id NOT NULL`, `area_id`, `code`, `name`, `start_time time NOT NULL`, `end_time time NOT NULL` (end
at or before start means the next day), `unpaid_break_minutes smallint DEFAULT 30`, `paid_break_minutes smallint DEFAULT 0`,
`weekdays smallint[] DEFAULT '{1,2,3,4,5}'`, `default_headcount smallint DEFAULT 1`, `color`, `archived_at`. Unique live
`(org_id, site_id, lower(code))`.

**`crew.schedule_weeks`** (V): `site_id NOT NULL`, `week_start date NOT NULL`, `status text DEFAULT 'draft' CHECK (IN ('draft','published'))`,
`published_at`, `published_by`, `publish_count int DEFAULT 0`, `changed_since_publish boolean DEFAULT false`. Unique `(org_id, site_id, week_start)`.

**`crew.shifts`** (SD, V): `site_id NOT NULL`, `area_id`, `template_id`, `work_date date NOT NULL`, `start_at timestamptz NOT NULL`,
`end_at timestamptz NOT NULL` (CHECK `end_at > start_at` and at most 24 hours), `unpaid_break_minutes smallint NOT NULL`,
`headcount smallint NOT NULL DEFAULT 1 CHECK (1..200)`, `lead_person_id uuid`, `status text DEFAULT 'active' CHECK (IN ('active','cancelled'))`,
`note`. Index `(org_id, site_id, work_date)`. A shift is published when its `schedule_weeks` row is.

**`crew.shift_assignments`** (SD): `shift_id NOT NULL`, `person_id NOT NULL`, `assigned_by`, `override_reason text`, `warnings jsonb`
(the warnings shown when assigned). Unique live `(org_id, shift_id, person_id)`. Index `(org_id, person_id)`. Open slots =
`headcount - live assignments`.

**`crew.shift_requests`**: `kind text CHECK (IN ('pickup','swap','drop'))`, `shift_id NOT NULL`, `from_person_id`, `to_person_id`,
`to_shift_id` (swap only), `status text DEFAULT 'pending' CHECK (IN ('pending','approved','declined','cancelled','expired'))`,
`requested_by` (user), `decided_by`, `decided_at`, `note`. A request expires when its shift starts.

### 5.4 Clock

**`crew.kiosk_devices`** (SD): `site_id NOT NULL`, `name`, `token_hash text NOT NULL UNIQUE`, `token_prefix text NOT NULL`,
`identify_mode text DEFAULT 'number_pin' CHECK (IN ('badge','number_pin','badge_pin'))`, `photo_on_punch boolean DEFAULT false`,
`default_language text DEFAULT 'en'`, `idle_seconds smallint DEFAULT 20`, `key_version smallint NOT NULL`, `last_seen_at`,
`clock_skew_seconds int`, `app_version text`, `revoked_at`, `created_by`. No expiry date **(choice: a door clock must not stop on a Monday
morning; instead Settings warns when a device has not been seen for 7 days)**.

**`crew.punches`** (append only, see 4.6): `person_id NOT NULL`, `site_id NOT NULL`, `kind text NOT NULL CHECK (IN
('in','out','break_start','break_end','switch'))`, `break_kind text CHECK (IN ('meal','rest'))` (needed for `break_start`),
`punched_at timestamptz NOT NULL`, `work_date date NOT NULL`, `week_start date NOT NULL`, `area_id`, `pulse_job_id uuid`,
`source text NOT NULL CHECK (IN ('kiosk','phone','web','import','edit','system','sample'))`, `device_id uuid`, `client_ref text`,
`device_time timestamptz`, `received_at timestamptz NOT NULL DEFAULT now()`, `queued boolean DEFAULT false`, `verified boolean NOT NULL
DEFAULT true`, `fence_distance_m int`, `inside_fence boolean`, `photo_id uuid`, `flags text[] DEFAULT '{}'`, `superseded_at`,
`superseded_by_edit_id uuid`, `created_by`. Unique `(org_id, device_id, client_ref) WHERE client_ref IS NOT NULL`. Indexes
`(org_id, person_id, punched_at)`, `(org_id, site_id, work_date)`, `(org_id, site_id, week_start)`. Live = `superseded_at IS NULL`.
Location is stored as distance and inside or outside only, never coordinates **(choice, privacy)**.

**`crew.punch_edits`** (append only): `person_id NOT NULL`, `site_id NOT NULL`, `work_date`, `week_start`, `kind text CHECK (IN
('add','change','void'))`, `old_punch_id`, `new_punch_id`, `reason_code text CHECK (IN ('forgot_in','forgot_out','missed_break',
'wrong_time','wrong_site','wrong_job','duplicate','other'))`, `reason text NOT NULL CHECK (length(btrim(reason)) >= 3)`, `edited_by NOT NULL`,
`edited_at`, `before jsonb`, `after jsonb`.

**`crew.time_segments`** (rebuilt): `person_id`, `site_id`, `work_date`, `start_at`, `end_at`, `minutes int`, `kind text CHECK (IN
('work','paid_break','unpaid_break'))`, `area_id`, `pulse_job_id`. Index `(org_id, site_id, work_date)`, `(org_id, pulse_job_id, work_date)`.

**`crew.time_days`** (rebuilt, PK `org_id, person_id, work_date`): `site_id`, `week_start`, `first_in`, `last_out`, `rounded_in`,
`rounded_out`, `worked_minutes`, `paid_break_minutes`, `unpaid_break_minutes`, `regular_minutes`, `ot_minutes`, `dt_minutes`,
`time_off_minutes jsonb` (per type), `exceptions text[]`, `shift_id`, `rules_id`, `built_at`. CHECK `regular + ot + dt = worked`.

**`crew.week_approvals`**: `site_id NOT NULL`, `week_start date NOT NULL`, `status text CHECK (IN ('approved','reopened'))`,
`approved_by`, `approved_at`, `accepted jsonb` (warnings ticked OK, per person and day), `reopened_by`, `reopened_at`, `reopen_reason`,
`approve_count int DEFAULT 1`, `hours_hash text` (hash of every time day, so exports can tell a changed week). Unique `(org_id, site_id, week_start)`.

**`crew.payroll_exports`**: `format text CHECK (IN ('generic_week','generic_day','qbo_payroll'))`, `site_ids uuid[]`, `week_start date`,
`week_end date`, `row_count int`, `hours_hash text`, `file_attachment_id uuid`, `created_by`. Index `(org_id, week_start)`.

### 5.5 Attendance and time off

**`crew.attendance_events`** (SD): `person_id NOT NULL`, `site_id NOT NULL`, `work_date date NOT NULL`, `shift_id`, `kind text CHECK (IN
('late','early_out','no_call_no_show','called_out'))`, `minutes int`, `source text CHECK (IN ('auto','manual'))`, `excused boolean DEFAULT
false`, `excuse_reason`, `note`, `decided_by`. Unique live `(org_id, person_id, shift_id, kind)`. Index `(org_id, site_id, work_date)`,
`(org_id, person_id, work_date)`.

**`crew.time_off_types`** (SD): `code`, `name`, `paid boolean`, `uses_balance boolean`, `color`. Unique live `(org_id, lower(code))`.
Seeded per org: Paid time off, Sick, Unpaid.
**`crew.time_off_requests`** (V): `person_id NOT NULL`, `type_id NOT NULL`, `start_date`, `end_date` (CHECK order), `minutes_per_day int`
(null = a full scheduled day, else 1 to 1440), `status text DEFAULT 'pending' CHECK (IN ('pending','approved','declined','cancelled'))`,
`requested_by`, `decided_by`, `decided_at`, `reason`, `decline_reason`. Index `(org_id, person_id, start_date)`, `(org_id, status)`.
**`crew.time_off_ledger`**: `person_id`, `type_id`, `entry_date date`, `minutes int NOT NULL` (plus or minus), `reason text CHECK (IN
('set','adjust','used','import'))`, `request_id`, `note`, `created_by`. Index `(org_id, person_id, type_id)`.

### 5.6 Skills

**`crew.certification_types`** (SD): `code`, `name`, `valid_months smallint`, `warn_days smallint DEFAULT 30`, `card_required boolean
DEFAULT false`. Unique live `(org_id, lower(code))`.
**`crew.person_certifications`** (SD, SRC, V): `person_id NOT NULL`, `type_id NOT NULL`, `earned_on date`, `expires_on date`,
`card_attachment_id uuid`, `verified_by`, `note`, `warned_soon_at`, `warned_expired_at`. Index `(org_id, expires_on)`. Unique live
`(org_id, person_id, type_id, earned_on)`.
**`crew.skills`** (SD): `kind text CHECK (IN ('kit','line','program','other'))`, `name`, `core_item_id uuid`, `area_id uuid`,
`pm_program_id uuid`. Unique live `(org_id, kind, lower(name))`.
**`crew.person_skills`**: `person_id`, `skill_id`, `level smallint CHECK (0..3)`, `set_by`, `set_at`. Unique `(org_id, person_id, skill_id)`.
**`crew.requirements`**: `target_type text CHECK (IN ('area','shift_template','shift'))`, `target_id uuid NOT NULL`, `cert_type_id`,
`skill_id`, `min_level smallint`, CHECK exactly one of cert type or skill. Unique `(org_id, target_type, target_id, coalesce(cert_type_id,
skill_id))`.

### 5.7 Labor plan

**`crew.plan_paces`** (SD): `site_id` (null = all), `activity text CHECK (IN ('kit_build','receiving','pick_pack','other'))`, `unit_label`,
`units_per_labor_hour numeric(12,3) NOT NULL CHECK (> 0)`, `effective_from date NOT NULL`. For warehouse work Pulse has no pace for
**(choice: typed in Crew)**.
**`crew.plan_inputs`** (SD, SRC): `site_id NOT NULL`, `work_date date NOT NULL`, `label text NOT NULL`, `activity`, `units numeric(14,3)
NOT NULL CHECK (>= 0)`, `units_per_labor_hour numeric(12,3)` (null = look up), `setup_hours numeric(10,2) DEFAULT 0`, `pulse_job_id`,
`pm_build_id`, `wms_ref text`, `locked_fields text[]`. Index `(org_id, site_id, work_date)`. Synced rows are upserts by `source_ref`
(`pm_build:<id>`, `wms_wo:<id>`, and so on).
**`crew.plan_days`** (PK `org_id, site_id, work_date`): `indirect_hours numeric(10,2)` (typed, null = use `indirect_bp`), `note`.
**`crew.plan_snapshots`**: `site_id`, `work_date`, `taken_at`, `hours_needed numeric(10,2)`, `people_needed int`, `people_scheduled int`,
`inputs jsonb`, `actual_worked_hours numeric(10,2)` (filled at rollover from time days). Taken at each site's day start, so plan against
actual can be shown later. Unique `(org_id, site_id, work_date)`.
**`crew.plan_signals`** (SD, SRC): CRM early warning. `crm_deal_item_id uuid`, `title`, `start_date date`, `people_per_day numeric(6,2)`
(typed by a supervisor, null until then), `site_id`, `note`. Unique live `(org_id, crm_deal_item_id)`.

### 5.8 Control and system

**`crew.attachments`**: `owner_type text CHECK (IN ('certification','punch_photo','payroll_export','import'))`, `owner_id uuid`, `name`,
`content_type`, `size_bytes int` (photos at most 150 KB, cards at most 5 MB), `storage text CHECK (IN ('blob','db'))`, `storage_key`,
`data bytea`, `expires_at`, `uploaded_by`. Reads go through `GET /api/v1/files/[id]` so access is checked every time.
**`crew.activity`** (append only, BEFORE UPDATE raises): `actor_id`, `actor_kind` (`user`, `device`, `system`, `integration`), `verb`,
`entity_type`, `entity_id`, `before jsonb`, `after jsonb` (pay and private fields redacted by an allow list per entity type for readers
without the right), `created_at`.
**`crew.notifications`**: `user_id NOT NULL`, `kind`, `params jsonb`, `url` (path only), `read_at`, `archived_at`.
**`crew.outbox_email`**: `person_id`, `kind`, `params jsonb`, `idempotency_key text UNIQUE`, `status`, `attempts`, `sent_at`, `error`.
**`crew.import_batches`**, **`crew.import_rows`**, **`crew.import_presets`**: the Pulse tables with Crew stream names.
**`crew.user_prefs`** (PK `org_id, user_id`): default site, schedule view, hidden tips.
**`crew.sync_state`** (PK `org_id, source`), **`crew.sync_runs`**: the Pulse lease pattern for `pulse`, `projects`, `wms`, `crm`.
**`crew.dismissals`**: tips and suggested items.

**Triggers** (each with a test): punches allow only the `superseded_at` and `superseded_by_edit_id` pair to change, once; `punch_edits`
and `activity` are append only; week lock (4.6); `time_days` CHECK on the minute buckets; rule changes inside approved weeks refused.

**Retention** (daily cleanup): punch photos after `photo_retention_days`; import raw rows after 7 days; agency submissions that were
rejected after 30 days; nothing else is deleted.

## 6. Product surface (every route is real, working and persisted)

Shell: copied from Pulse. One top bar, no sidebar: logo, navigation, search, org switcher, primary button **Today**, notifications,
help, app switcher, theme toggle, account menu. Navigation: Home · Schedule · Time (badge: needs a fix) · People · Attendance · Plan ·
**More** (Time off, Skills, Import and export, Settings). Below 1024 px the links fold into a sheet. Leads land on Today and see Today,
Schedule, Time, Plan. A global filter bar (site, week or date, area, person kind) lives in the URL on every list.

### 6.1 Routes

| Route | What is on it |
|---|---|
| `/` **Home** | Per site: on site now, scheduled and not here yet, out today; this week's worked hours against scheduled hours; "Needs a fix" count with the worst first; weeks waiting for approval; time off waiting; certifications ending in 30 days; the labor plan gap for the next 3 days ("Tuesday: 3 people short"); setup checklist until done. Leads see their crew only. |
| `/today` **Today** | The daily board per site, refreshed every 30 seconds: by area, who is clocked in (since when, on break, on which job), who is scheduled and not here yet (late after grace shows in amber with minutes), who is out (time off, called out), who is here with no shift. One tap opens the person's time card for today. Supervisors can mark "Called out" here. |
| `/people` **People** | List with search, filters (site, kind, status, agency, labor class, ending certifications), column picker, CSV export of the view, bulk actions (set site, set lead, set status, print PIN slips, send to agency link). "Add person", "Import people", "Agencies". |
| `/people/new` | One form: name, number (or "make one"), kind, site, usual area, labor class, lead, agency (for temps), start date, language, email, phone, badge, login link (search org members). Private and pay sections only for readers with the right. Saves and offers "Print PIN slip". |
| `/people/[id]` | Tabs **Overview** (status, site, class, lead, agency, login link, WMS user link, kiosk PIN reset, badge reset), **Schedule** (next 4 weeks), **Time** (time cards by week with punches and edits), **Attendance** (events, excuse), **Time off** (requests, balances, ledger), **Skills** (certifications with card copies, skills and levels), **Pay** (`pay:read`: pay type, exempt, dated wages, "sent to Pulse" state), **Activity**. |
| `/people/agencies`, `/people/agencies/[vendorId]` | Agencies (vendors with `temp_agency`): contact, active people, this week's approved hours, agency links (make, copy once, revoke), pending submissions to accept or reject in bulk. |
| `/join/a/[token]` **Agency link** | Public form for the agency, no login: one row per person (name, phone, email, agency id, start date, language), add rows, paste rows from a spreadsheet, submit. Rate limited, `noindex`, `Referrer-Policy: no-referrer`, expires. Shows only the site name and the agency name. |
| `/schedule` **Schedule** | Week grid for one site: rows are people grouped by area (or by shift), columns are days, cells hold shift chips. Draft or Published badge. Add shifts from templates by day, drag a person onto a shift, open slots shown as dashed chips, copy last week, clear the draft. Beside the grid: per day hours scheduled, people scheduled, the labor plan people needed and the gap. Warnings inline on chips (time off, over 40 hours, overlapping, not cleared, ended person). **Publish** (counts what changes, then publishes and notifies). After publish, edits mark the week "Changed since publish" with a **Send changes** button. |
| `/schedule/templates` | Shift templates per site: times, breaks, days, headcount, requirements. |
| `/schedule/requests` | Pickups, swaps and drops waiting, each with the warnings it would cause, Approve or Decline with a note. |
| `/kiosk/t/[token]` **Kiosk** | 6.2. Opened from a kiosk device link, never a personal login. |
| `/clock` **Phone clock** | 6.3. Signed in users linked to a person. |
| `/me` **My work** | For linked users (any role): my next shifts, open shifts I can pick up, ask to swap or drop, my time card this week and last, my time off (ask, cancel, balances), my certifications and when they end, "I will miss my shift" (writes `called_out` and tells the supervisor). English first. |
| `/time` **Time** | Timesheets for one site and week: one row per person with daily hours, regular, overtime, double time, time off and "Needs a fix" chips; totals; filters (only needs a fix, only temps, by agency). Approve the week (lists what blocks it). Approved weeks show a lock and Reopen (`week:reopen`). |
| `/time/[personId]?week=` | One person's week: day by day punches (real and rounded time), segments with area and job, breaks, the overtime split with "How we got this" (rules in force, which minutes went where), exceptions, and Fix: add punch, change time, move to job or area, void, each with a reason picker and a text box. The edit history sits under each day. |
| `/time/fixes` | Every open "Needs a fix" across sites and weeks, fix in place. |
| `/time/export` | Payroll export: choose approved weeks and sites, the layout (by week or by day, QuickBooks Payroll when built), preview the rows, download. Lists past exports with who and when, and warns "You exported this week on Nov 3" or "This week changed after it was exported". `export:payroll` only. |
| `/attendance` | Events by site and date range: late, early out, no call no show, called out, with excused state, filters and a per person count for the range. Excuse or void with a reason. CSV export. |
| `/time-off` | Requests waiting (approve or decline, with the shifts it would clear), a calendar of who is out by site, balances table (payroll can set, adjust or import). |
| `/skills` | Matrix: people down, certifications and skills across, each cell shows status or level. Tabs **Ending soon** (next 60 days, with "Tell me again in a week"), **Certification types** (`certtype:manage`), **Skills list**. Upload card copies from the cell. |
| `/plan` **Labor plan** | Next 14 days per site: each day's hours needed, people needed, scheduled, gap, and temp cost (pay readers only). A day opens the inputs (source, units, pace and where it came from, setup hours, direct hours), time not on a job, and plan against actual for past days. Add typed inputs. "Fill the gap" opens the schedule on that day with open shifts preset to the gap. The CRM signals strip shows won deals with a start date and the people per day typed for them. |
| `/plan/paces` | Typed paces for warehouse work by site and activity, with effective dates. |
| `/import`, `/import/[batchId]` | The Pulse import center with Crew streams (section 7). |
| `/export` | Every stream in its template columns, date range and site filters. |
| `/settings` | General (week start, PIN length, number prefix, default member role), Sites and areas (time zone, address, fence pin on a map picker with radius, WMS and Pulse links), **Labor rules** (`/settings/rules`: preset or custom, rounding, grace, overtime, breaks, effective date, a live "this week under these rules" preview for one person), Labor classes, People and roles (Crew role, site scope), **Kiosks** (`/settings/kiosks`: make a device link, identify mode, photo, language, idle time, last seen, clock skew, revoke), Phone clock (on or off, fence mode), Time off types, Notifications (schedule email on or off), Connected apps (`/settings/apps`), Sample data, Audit log. |
| `/welcome` | First run: claim step, "Who can see pay?" (pick payroll people), first site time zone from the browser, "How do you want to start?" (sample data, import people, type the first people), then the setup checklist (section 9). |
| `/search`, Cmd+K | Find people by name or number, go to any page, actions (Add person, Publish week, Approve week, Open today, Make kiosk link). |
| `/login`, `/forgot-password`, `/no-workspace` | House auth pages with a Crew preview panel. Locked screen per 3.4. |

`src/proxy.ts` public list: auth pages, `/api/health`, `/kiosk/t/*`, `/kiosk/manifest.webmanifest`, `/kiosk/sw.js`, `/api/v1/kiosk/*`,
`/join/a/*`, `/api/v1/agency/*`, `/api/v1/cron/*`. Everything else needs a session.

Cross cutting, as Pulse: empty states that teach, the Crew loader and skeletons, error states with retry, optimistic saves with undo,
responsive from 360 px (the schedule grid becomes a day list), keyboard reachable, status never color only, light and dark by tokens,
`tabular-nums`, reduced motion respected, user text always escaped.

### 6.2 The kiosk (offline tolerant)

The floor is not a desk: big targets (at least 64 px, text at least 24 px), high contrast, works with gloves, portrait and landscape,
English and Spanish with a language button on every screen.

Flow:
1. **Idle**: site name, a large clock, "Scan your badge or type your number" (per `identify_mode`), online state.
2. **Identify**: badge scan (a USB or Bluetooth scanner typing into a hidden field, or the camera reading a QR or barcode) and/or the
   employee number on a number pad, then the PIN when the mode needs it. 5 wrong PINs lock that person for 5 minutes (the Pulse rule).
3. **Person**: "Hi Maria". Current state ("Working since 6:58 AM on Kitting line 2", "On meal break since 11:30 AM"). Only the buttons
   that fit the sequence: Clock in (area preset from today's shift, else the usual area, change with one tap), Start meal break, Start rest
   break, End break, Switch job or area (area cards, and Pulse job cards when Pulse is present), Clock out. Photo first when
   `photo_on_punch`: a 3 second countdown on the front camera, small JPEG.
4. **Done**: a big check, "Clocked in at 6:58 AM", the next 3 shifts. Back to idle after 4 seconds or `idle_seconds`.

Offline:
- Installed as a home screen web app: `/kiosk/manifest.webmanifest` (`display: standalone`, scope `/kiosk/`) and a service worker
  (`/kiosk/sw.js`) that caches the kiosk shell, so a reload with no network still opens the kiosk.
- The roster (person id, number, first name and last initial, badge hash, language, current state, today's shift) is cached on the tablet
  and refreshed every 5 minutes online. No PIN hash ever leaves the server.
- With no network, the kiosk checks the number or badge against the cached roster, takes the PIN, and queues the punch in IndexedDB with
  a `client_ref` made once on the tablet, the device time, and the PIN encrypted with the server public key (RSA OAEP, WebCrypto; key
  version in `kiosk_devices.key_version`) **(choice)**. The screen says "Saved on this tablet. Will send when online." and shows the queue
  count. State shown for the person is the cached state plus the queue.
- On reconnect, the queue sends in order, oldest first, each with the same `client_ref`, so a retry never makes a second punch. The server
  decrypts and checks the PIN: a bad PIN stores the punch with `verified = false` and the blocking exception `unverified`.
- **Punch time**: online, the server time is the punch time and the device time is kept. Queued, the punch time is the device time
  corrected by the last measured clock skew. Each sync measures skew; over 120 seconds flags `clock_skew`. Punches queued over 72 hours
  are kept and flagged `long_offline`.

Endpoints (kiosk device token in the `Authorization: Kiosk <token>` header, rate limited per device, never any pay or private field):
`POST /api/v1/kiosk/state` (roster, areas, jobs, public key, server time), `POST /api/v1/kiosk/identify` (online check of badge or number
and PIN; gives a 2 minute person token), `POST /api/v1/kiosk/punch` (online or queued; idempotent on `client_ref`), `POST
/api/v1/kiosk/photo` (by `client_ref`). The kiosk route sets `noindex` and `Referrer-Policy: no-referrer`.

### 6.3 The phone clock

`/clock` for signed in users linked to a live person, English and Spanish (the person's `language`, with a toggle). The same buttons as
the kiosk. When the site has a fence and `fence_mode` is not `off`, the browser location is read once per punch: inside the radius
punches normally; outside, `flag` stores the punch with `outside_fence` ("You are 2.3 km from Main site. Your supervisor will see this."),
`block` refuses it. Location accuracy worse than the radius counts as outside. Only the distance is stored. No offline queue on the phone
**(choice)**: a phone with no signal says "No signal. Use the kiosk or try again."

## 7. CSV in and out

Engine rules are the Pulse section 7 rules, unchanged: browser parsing in a worker, chunked raw rows, server side mapping and checks,
header aliases, presets, plain error messages on the exact cell, "all or nothing" or "skip bad rows", an error report CSV, undo for 7 days,
the formula guard both ways, CRLF and BOM on export, round trip safe streams. File names read `crew-<stream>-<org>-<from>-to-<to>.csv`.

| Stream (file) | Columns (`*` = needed) | Row match |
|---|---|---|
| **People** `people.csv` | `employee_number` (blank = make one when "Make numbers for temps" is on), `first_name*`, `last_name*`, `preferred_name`, `kind` (`employee`, `temp`, `seasonal`), `status`, `site_code`, `area_code`, `labor_class`, `agency` (vendor name, made if missing and the option is on), `agency_person_id`, `start_date`, `end_date`, `email`, `phone`, `language` (`en`, `es`), `lead_employee_number`, `badge`, `emergency_name`, `emergency_phone`, `pay_type`, `overtime_exempt`, `wage_per_hour` | `employee_number`, else `(agency, agency_person_id)`, else exact name plus agency (flagged "looks the same") |
| **Certifications** `certifications.csv` | `employee_number*`, `certification_code*`, `earned_on`, `expires_on`, `note` | `(employee_number, certification_code, earned_on)` |
| **Skills** `skills.csv` | `employee_number*`, `skill_kind`, `skill_name*`, `level*` (0 to 3) | `(employee_number, skill_kind, skill_name)` |
| **Time off balances** `time_off_balances.csv` | `employee_number*`, `time_off_code*`, `balance_hours*`, `as_of*` | writes a `set` ledger row per person and type |
| **Plan inputs** `plan_inputs.csv` | `entry_id`, `work_date*`, `site_code`, `label*`, `activity`, `units*`, `units_per_labor_hour`, `setup_hours` | `entry_id`, else `(work_date, site_code, label)` |
| **Hours** `hours.csv` (export only) | 7.1 | |
| **Punches** `punches.csv` (export only) | `punch_id`, `employee_number`, `name`, `site_code`, `work_date`, `kind`, `break_kind`, `punched_at` (site local, ISO with offset), `rounded_at`, `area_code`, `pulse_job_number`, `source`, `verified`, `flags`, `edited` (yes or no) | |

Import rules special to Crew: `pay_type`, `overtime_exempt` and `wage_per_hour` need `pay:manage`, else those columns are refused with a
plain sentence; emergency columns need `person:private_read`. A new person never gets a PIN from a file: after commit the check step
offers **Print PIN slips** (a print view with name, number and a random starting PIN per person, shown once) **(choice)**. Peak season
target: 30 agency people from a file in under 2 minutes, from upload to printed slips.

### 7.1 Hours export (approved weeks only)

Generic layouts **(Phase 4)**:
- **By week** (one row per person, week and labor class): `employee_number`, `payroll_id`, `first_name`, `last_name`, `kind`, `agency`,
  `site_code`, `labor_class`, `pay_type`, `week_start`, `week_end`, `regular_hours`, `overtime_hours`, `double_time_hours`, one
  `<type>_hours` column per paid time off type, `total_hours`, `approved_by`, `approved_at`.
- **By day**: the same plus `work_date`, `first_in`, `last_out`, `unpaid_break_hours`.
No wage or pay columns: payroll holds the pay **(choice)**. Each export writes a `crew.payroll_exports` row with the hours hash.
**QuickBooks Payroll** layout comes next: before that phase starts, the exact QuickBooks import format is checked against QuickBooks'
own docs; if QuickBooks only takes time through its API, the export waits for Ledger's QuickBooks Online connection and reuses it.

## 8. Integrations (shared database, fail soft)

Ground rules are Pulse section 8: each reader checks entitlement (or, before launch, nothing for Crew itself), table presence with
`to_regclass` (cached 5 minutes) and the WMS tenant schema, catches every error, and answers `{ available: false, reason }`. Crew never
writes into another app's schema except `core.vendors` (owned by core) and through bridges. Siblings read Crew only through
`@kitstak/crew-bridge` on their own servers. Links store a path, never a host. Sync uses the Pulse lease (`sync_state.locked_until`) and
runs on "Sync now", on page load when older than 10 minutes, and on the cron tick.

### 8.1 `@kitstak/crew-bridge`

Raw SQL over the host's executor (`BridgeExecutor`), peer dep `drizzle-orm`, plain JSON DTOs, `./types` export. Reads never throw and
return empty when the `crew` schema is absent (`crewAvailability`, `to_regclass('crew.people')`, cached 60 seconds). Reads that return
people take `{ orgId, userId? }`; with a user they apply that user's Crew sight (3.2); system reads (another app's server work) return
names, numbers and hours only, never pay, private details or attendance.

```ts
crewAvailability(db)
resolveCrewAccess(db, { orgId, userId })                   // { role, siteIds, canSeePay, canSeePrivate }
getWhoIsOnSite(db, { orgId, siteId? | wmsWarehouseId? })   // person, number, area, since, on break, linked wms user id
getClearances(db, { orgId, personIds? | wmsUserIds?, certCodes?, onDate })   // per person: certs with status, skills with level
listApprovedHours(db, { orgId, from, to, updatedSince? })  // per person, work date, site, labor class: regular, ot, dt hours; week state
getSuggestedJobHours(db, { orgId, pulseSiteId, date })     // per Pulse job and labor class: labor hours, people (from live segments)
getAgencyHours(db, { orgId, vendorId?, weekStart })        // approved hours per agency and week, per person
getTimeOff(db, { orgId, userIds | personIds, from, to })   // approved time off days, no type or reason
getPeopleForWmsUsers(db, { orgId, wmsUserIds })            // for WMS Labor Analytics
countBillablePeople(db, { orgId, onDate })                 // people with status active on that date, temps included (launch)
getSetupSignals(db, { orgId })                             // onboarding (section 9)
crewUrls(base).person(id) / .today(siteId?) / .schedule(siteId, week) / .timeWeek(siteId, week) / .plan(siteId)
```

**Billing count (choice):** "active" for the $4 count means `status = 'active'` on the billing date; `on_leave` and `ended` people do not
count. The exact moment billing reads it is set by `docs/billing/` at launch.

### 8.2 Pulse

**Rates and classes stay in Pulse.** New `@kitstak/pulse-bridge` reads (a Pulse PR in Phase 8): `listLaborClasses(db, { orgId })`,
`getLoadedRate(db, who, { laborClassId, pulseSiteId, date })` (the Pulse `rateFor`, money only for a user with Pulse money access),
`getTargetPace(db, { orgId, pulseJobId, date })` and `listFloorJobs(db, { orgId, pulseSiteId })` (active job id, number and name for
the kiosk, no money, client name hidden per Pulse wall setting).

- **Classes**: when Pulse is present Crew mirrors `pulse.labor_classes` into `crew.labor_classes` (`source = 'pulse'`) and maps its own
  earlier rows by code. Crew rows are read only while Pulse is present.
- **Wages move to Pulse the day Pulse is added**: Pulse Labor shows "Bring labor classes and wages from Crew". It makes any missing class
  and one rate row per class dated today, with wage = the hours weighted average of the active people's Crew wages in that class over the
  last 8 weeks and the Pulse default burdens, shown as a preview first **(choice)**. Then `person_wages.sent_to_pulse_at` is stamped and
  Crew stops using its wages.
- **Approved hours to paid hours** (flow out 1): Pulse adds `crew` to the STREAM `source` CHECK (Pulse migration) and a reader
  `src/server/integrations/crew.ts` that upserts `pulse.time_punches` from `listApprovedHours`: `source = 'crew'`, `source_ref =
  crew:<person_id>:<work_date>:<labor_class_id>`, `employee_code` = Crew number, `employee_name`, `labor_class_id` (mapped), `hours` =
  regular + overtime + double time, `overtime_hours` = overtime + double time, `job_id` and `reason` empty, `pay_cents` empty. Pulse's
  `rollupPunches` then fills `pulse.paid_hours` per site, day and class, so the payroll check and "Paid time not on any job" work with no
  file. A week reopened in Crew drops out of the reader and Pulse soft deletes its rows; approved again, they come back. Rows in a closed
  Pulse month are counted as skipped, the Pulse rule. Pulse has one overtime field, so double time is sent inside overtime and the gap is
  listed in Pulse as a follow up **(choice)**.
- **Job switches to suggested labor hours** (flow out 2, decision 0.2 item 3): Pulse's Log work grid calls `getSuggestedJobHours` for the
  day and site and shows a chip on each matching row, "Crew: 46.50 labor hours, 6 people", with **Use these hours**, which fills People,
  Hours each and Labor hours for the supervisor to save. Nothing is written until they save. Suggestions come from live segments, so they
  work the same day.
- **Target pace in** (flow in): `getTargetPace` for plan inputs linked to a Pulse job; "Use my last 90 days" reads Pulse indirect share.
- Pulse sites map to Crew sites by `pulse_site_id`, set by matching `wms_warehouse_id`, then code, then by hand in Connected apps.

### 8.3 Projects

- **In: builds to plan inputs.** A new `@kitstak/pm-bridge` read `listPlannedBuilds(db, { orgId, from, to })` returns builds with
  `build_date`, `planned_qty - built_qty`, the program and its Pulse job (through `core.record_links` `bills_to`). Each becomes a plan input
  on its `build_date` at the site of its Pulse job (else the default site), `source_ref = pm_build:<task_id>`. A build in the past that is
  not finished is listed "Behind" and not moved.
- **Out: time off to workload.** Projects workload calls `getTimeOff` for its members (people linked to `core.user`) and shows "Out"
  days. Projects change, done in Phase 8 by the Projects owner.

### 8.4 WMS

- **People link**: a person is linked to a WMS user (`wms_user_id`) by matching email in the org's tenant `users` table, or by hand.
  Labor Analytics calls `getPeopleForWmsUsers` to show the Crew name and site on associate rows.
- **Out: who is on site and cleared.** WMS task assignment can call `getWhoIsOnSite` and `getClearances` to skip people who are not here
  or not certified (no forklift putaway for an expired card). The WMS side is a WMS change taken by the WMS owner; Crew ships the bridge
  reads and a test fixture.
- **In: warehouse work to plan inputs.** Work orders due (kit quantity, due date), inbound receipts expected (units, date) and orders due
  to ship (lines, date) are read from the tenant schema and become plan inputs with the activity's typed pace (`plan_paces`).

### 8.5 CRM

Won deals with a start date in the next 120 days become `crew.plan_signals` (title, start date, link back). A supervisor types the people
per day each one needs; the Plan page sums signals by month: "3 new programs start in January and need about 14 more people per day."
Deals are read from `crm.items` on won deal boards, guarded like Pulse's CRM reader.

### 8.6 Ledger (when Ledger exists)

`getAgencyHours` gives approved hours per agency vendor and week, per person, so Ledger can say "Agency billed 412 hours. Crew recorded
396." Both apps name the same `core.vendors` row. Nothing in Crew waits for Ledger.

### 8.7 Shared packages, switcher, deploy

- `packages/ui/src/app-switcher`: `AppSwitcherAppId` gains `crew`, row `{ id: 'crew', name: 'KitStak Crew', descriptor: 'People,
  shifts and the time clock' }`, shown per 3.4. `packages/ui/src/app-icon` already has `crew`; add it to app lists and the launcher.
- Portal: a Crew tile (people on site now, weeks to approve) through the bridge; at launch the billing picker reads the catalog.
- Every sibling `.env.example` gets `NEXT_PUBLIC_CREW_URL` and port 3800 in `TRUSTED_ORIGINS`. `deploy/push-env.mjs` gets `URL_CREW`,
  `PROJECT_CREW` and `KITSTAK_PREVIEW_ORGS`. Root `package.json` gets `dev:crew`; `.claude/launch.json` gets a `crew` entry; `docs/DEPLOYMENT.md`
  gets the Crew migrate order and the RLS role check.

### 8.8 Crew HTTP API (`/api/v1`, same origin only, `{ data } | { error }`)

| Endpoint | Returns |
|---|---|
| `GET /api/health` | status, database ping; migration version and guard state with `x-health-token` |
| `GET /api/v1/me` | user, org, Crew role, site scope, `canSeePay`, linked person, integration availability |
| `GET /api/v1/today?site` | the today board |
| `GET /api/v1/schedule?site&week`, `PUT /api/v1/schedule/shifts` | the week grid; shift and assignment autosave with `version` (409 on a stale one) |
| `GET /api/v1/time/week?site&week`, `GET /api/v1/time/person?person&week` | timesheets and one person's week |
| `POST /api/v1/clock/punch` | phone punch for the signed in linked person |
| `POST /api/v1/kiosk/state`, `/identify`, `/punch`, `/photo` | kiosk device only (6.2) |
| `POST /api/v1/agency/[token]` | agency link submit (public, rate limited, 50 rows a request) |
| `POST /api/v1/import/[batchId]/rows` | import chunk |
| `GET /api/v1/export/<stream>.csv`, `GET /api/v1/payroll/[exportId].csv` | CSV files, rights checked |
| `GET /api/v1/files/[id]` | card copy or photo, rights checked |
| `GET /api/v1/cron/tick`, `/cron/cleanup` | cron only |

Everything else is server actions. Every write checks session, access (3.4), role and scope, `assertSafeOrigin`, and JSON content type.

## 9. Onboarding contract (`docs/integration/ONBOARDING.md`)

Crew follows the cross app contract: same step semantics, progress, celebration and `?setup=<key>` arrival callout. New canonical steps,
added to the ONBOARDING tables in Phase 0 and shown only when the org has Crew access (3.4, later the entitlement), after the Pulse steps:

| key | title | requires | Deep link | Detection |
|---|---|---|---|---|
| `crew_people` | Add your people | none | Crew `/people/new` | a live `crew.people` row with `is_sample = false` |
| `crew_schedule` | Publish your first week | `crew_people` | Crew `/schedule` | a `crew.schedule_weeks` row with `status = 'published'` |
| `crew_kiosk` | Set up the time clock | `crew_people` | Crew `/settings/kiosks` | a live `crew.kiosk_devices` row, or a live punch with `source = 'phone'` |
| `crew_approve` | Approve a week of hours | `crew_kiosk` | Crew `/time` | a `crew.week_approvals` row with `status = 'approved'` |
| `crew_connect` | Send hours to Pulse | `crew_approve` | Pulse `/settings/apps` | a live `pulse.time_punches` row with `source = 'crew'`; offered only when Pulse is also in the plan |

Signals come from `getSetupSignals` in `@kitstak/crew-bridge` (guarded by `to_regclass('crew.people')`, `null` quietly when absent).
Skips are stored under scope `portal` (the `core.onboarding_progress.scope` CHECK stays `portal | crm | wms`). Crew's own `/welcome`
checklist shows the same five steps with the same titles.

## 10. Seed data plan (`pnpm --filter kitstak-crew db:seed`, `--org=<slug>`, idempotent)

Same rules as Pulse 9: wipe the org's `crew` rows under `crew.allow_purge`, rebuild through the domain layer, dates relative to the run
day (today = day 0), a seeded random generator, sibling links looked up at run time and skipped quietly. Order: setup rows, sibling reads
(sites from WMS, classes from Pulse, builds from Projects), people, schedule, punches through the domain (so time cards and attendance are
built by the real engine), edits, approvals, exports, then print row counts and the checks (every time day's buckets add up; every
approved week's hours equal the bridge's `listApprovedHours`).

| | `kitstak` (WMS, Projects, Pulse) | `northwind-robotics` (CRM, Projects, Pulse) | `crew-only` (new, nothing else) |
|---|---|---|---|
| Story | a 3PL kitting floor with a peak season temp crew | a kitting cell in California, to show daily overtime and meal checks | a small co-packer starting from a spreadsheet |
| Sites and rules | MLT1 (default) and KS2 from the warehouses, `America/New_York`, Federal preset | 1 site, `America/Los_Angeles`, California preset | 1 site, Federal preset |
| Areas | Kitting line 1, Kitting line 2, Receiving, Pick and pack, Shipping | Build cell, Test, Crating | Line 1, Packing |
| People | 48: 30 employees, 14 temps from the agency vendor "Brightway Staffing", 4 seasonal; 3 leads; supervisors j.okafor, t.nguyen and d.castillo linked to their users | 24: 20 employees, 4 temps from "Coastline Staffing" | 12, loaded through the people importer from the template |
| Shift templates | First 06:00 to 14:30, Second 14:30 to 23:00, Weekend 07:00 to 15:30, each 30 unpaid | Day 07:00 to 17:30 (10 hour days), 30 unpaid | First 07:00 to 15:30 |
| Weeks | last week approved and exported (generic by week); this week published with punches through today; next week a draft with 4 open slots | same | this week published, last week approved |
| Story punches | 3 lates, 1 early out, 1 no call no show, 2 missing clock outs (Needs a fix), 1 temp clocked in outside the fence by phone, 4 punch edits with reasons, 6 queued kiosk punches (`queued = true`) | a 13 hour day (double time), a Saturday after 40 hours (weekly overtime), 1 meal missed, 1 meal short | 1 late, 1 missing clock out |
| Time off | 3 approved (one covers a shift, so no event), 2 pending, balances for employees | 2 approved, 1 pending | 1 pending |
| Skills | Forklift (36 months), Reach truck (36), Hazmat (24); 2 cards ending within 30 days, 1 expired on a person scheduled on Receiving next week (the warning shows); skills on 3 kits and 2 lines | Torque tool, ESD; 1 ending | Forklift; none ending |
| Plan | inputs from Projects builds and WMS work orders, plus the story day: Tuesday next week 1,200 kits at 16, 4 setup, 6 not on a job, 8 scheduled, 3 people short | typed inputs; 2 CRM signals from won deals | typed inputs |
| Devices and roles | one kiosk per site (`number_pin`, photo on at MLT1), explicit roles: admin@kitstak.io owner, a payroll user, supervisors per site, 2 leads, a viewer | maya owner, a supervisor, a lead | one owner, one supervisor |

Seeded people get PIN `2468` in local dev only, printed by the seed with the kiosk links. The in app "Load sample data" uses a smaller set
(1 site, 10 people, 2 weeks) flagged `is_sample`, removed exactly by "Clear sample data".

## 11. Brand pack

- **Icon**: the brand pack's **People** mark (a pink head over red shoulders), named `crew` in code: `AppIcon app="crew"` in
  `packages/ui/src/app-icon/app-icon.tsx`. Source file `apps/web/public/brand/apps/kitstak-icon-crew.svg` (already on the y 50 to 150 box).
- **Loader**: `apps/web/public/brand/loaders/kitstak-loader-crew.svg` (the head pops in as the shoulders rise; stops for reduced motion).
  Used in every `loading.tsx`, full page loads and long actions (import check, approve the week, export) through
  `<img src="/brand/kitstak-loader-crew.svg" width="64" height="64" alt="Loading">`. The KitStak company loader stays for sign in and handoff.
- Phase 0 copies into `apps/crew/public/brand/` (icon, loader, `BRAND-README.txt`, sibling icons, wordtype), makes `src/app/icon.svg`,
  `icon.png`, `apple-icon.png`, PNG exports at 512 and 1024, a `brand-loader.tsx`, and the Portal launcher mark, as reference 10 lists.
- Colors: Red `#C8102E`, Pink `#D65A6E`, Navy `#0A1628`, Cream `#F5F1E8`. Wordmark `KITSTAK CREW` in Bebas Neue from `@kitstak/ui`.
  Status colors use tokens with an icon and a word: on site (success), late (warning), no call no show (danger), out (neutral).
- Site go live (reference 11, blocker 2): screenshots for every slot in `apps/web/src/components/crew/crew-shots.ts` are captured from
  the seeded `kitstak` org, light theme, 1440 wide at 2x, WebP under 200 KB.

## 12. Build phases

Each phase ends with typecheck, lint and tests green, the seed updated for what the phase adds, and a short entry in
`apps/crew/drizzle/README.md` and `docs/crew/CONTRACTS.md`. Nothing is deployed to anyone outside `KITSTAK_PREVIEW_ORGS`.

**Phase 0: scaffold.** App shell copied from Pulse (auth, session, env, proxy, top bar, navigation, org switcher, theme, command palette,
error pages, health, CSP), the preview gate and locked screen (3.4), the database guard, `packages/db/drizzle/0012_core_vendors.sql` with
its Drizzle schema and `upsertVendorKind`, `apps/crew/drizzle/0000_crew_init.sql` with 5.1, 5.2 and 5.8 (settings, roles, sites,
rules, areas, labor classes, people and their private and pay tables, agency tables, attachments, activity, notifications, imports, sync),
RLS policies and the `crew_app` role, the migrate runner, `@kitstak/crew-bridge` with `crewAvailability`,
`resolveCrewAccess` and `getSetupSignals`, `orgCrewAccess` over `previewAccess`, every route in 6.1 present with its teaching empty state and "Arrives in phase N" for preview
orgs, the brand pack, the welcome claim step, port 3800 wiring, Vercel project. Done when: a preview org signs in at `crew.kitstak.app`
and sees the shell; an unlisted org sees the locked screen; the migration chain on an empty database passes; RLS and guard tests pass.

**Phase 1: people and import.** Sites and areas settings, labor classes (standalone), roles and site scope, people list, form and
detail (Overview, Pay, Activity), private and pay hiding, agencies and agency links with submissions, the import center with the People
stream, PIN slips, badge and PIN reset, the people export. Done when: 30 agency people come in from a file and print PIN slips in under 2
minutes; a lead DTO walk shows no pay or private field; an agency link submission becomes people after acceptance.

**Phase 2: schedule.** Migration `0001_crew_schedule.sql` (5.3). Templates, the week grid, assignments with overlap and hours warnings,
open slots, copy last week, publish with in app notices and email through `@kitstak/mail` (no SMS in the first release **(choice)**),
"changed since publish", pickups, swaps and drops with approval, `/me` schedule. Done when: a supervisor builds and publishes a week from
templates in under 5 minutes for 40 people; a linked person picks up an open shift and a supervisor approves it; notices go once per publish.

**Phase 3: kiosk and clock.** Migration `0002_crew_clock.sql` (5.4 without approvals and exports). Kiosk devices and links, the kiosk
with identify modes, PIN lockout, photos, English and Spanish, the service worker and offline queue with encrypted PINs, the phone clock
and fence, the time engine (`zone`, `round`, `segments`, `overtime`, `breaks`) with presets and the rules settings, time cards, the today
board, Home tiles. Done when: every worked example in 4.3 to 4.5 is a passing test; a tablet with the network cut records 20 punches and
sends each exactly once when it reconnects; a reload while offline still opens the kiosk; the today board matches the punches.

**Phase 4: approve hours and export.** Migration `0003_crew_approvals.sql`. Timesheets, the person week with fixes and the edit audit,
`/time/fixes`, approve the week, the lock trigger, reopen, generic payroll exports (by week and by day) with the export log and hash
check, the punches export. Then the QuickBooks Payroll layout once its format is confirmed (7.1). Done when: an edit keeps the original and
shows who, when and why; an approved week refuses every write in the domain and in the database; reopen is logged; an exported file's
totals equal the timesheet to the cent of an hour.

**Phase 5: attendance and time off.** Migration `0004_crew_attendance.sql` (5.5). Day rollover per site, attendance events, excuse and
void, called out from Today and `/me`, time off types, requests, approvals, the balance ledger and its import, time off on the schedule
and in exports. Done when: the seeded lates, early out and no call no show are found by rollover and not by the seed; approved time off
removes the event; a balance import and a used request add up.

**Phase 6: skills.** Migration `0005_crew_skills.sql` (5.6). Certification types, person certifications with card copies, skills and
levels, requirements on areas, templates and shifts, assignment warnings with override reasons, the matrix, Ending soon and the cron
notices, the certifications and skills imports. Done when: assigning the seeded expired card holder to Receiving shows the warning and
needs a reason; each card is told once when ending soon and once when expired.

**Phase 7: labor plan.** Migration `0006_crew_plan.sql` (5.7). Plan inputs (typed and imported), typed paces, plan days, the formula in
`src/lib/plan.ts`, the Plan page, the gap beside the schedule, "Fill the gap", snapshots and plan against actual, temp cost from the
Crew wage when Pulse is absent. Done when: the 4.9 example is a test and shows on the seeded Tuesday; inputs with no pace are listed and
left out; temp cost shows only to pay readers.

**Phase 8: integrations.** The bridge reads in 8.1; the Pulse PR (bridge reads, `crew` source, the reader into `time_punches`, the Log
grid chip, "Bring classes and wages from Crew"); Projects (`listPlannedBuilds`, workload time off); WMS (people link, Labor Analytics
names, plan inputs from the tenant schema, the who is on site fixture); CRM signals; Ledger agency hours behind `crewAvailability` and
Ledger's own availability; app switcher, Portal tile, onboarding steps in the Portal guide; Connected apps settings. Done when: an
approved Crew week shows in Pulse as paid hours with no file, and a reopen takes it out; Pulse suggestions appear on the Log grid and
write nothing until saved; every reader returns `available: false` for `crew-only` and on a database with no sibling schemas.

**Launch (not a build phase).** Reference 11: the 3.4 swap PR, Stripe prices, manual grants for preview orgs, screenshots, `CREW_IS_LIVE
= true`, site docs rewritten against the real screens.

## 13. Quality bar and test plan

Typecheck and lint clean (the no dash rule covers `src/features`, `src/components`, `src/app`, `src/lib`, the Spanish strings and seed
data). Every button does something. No lorem ipsum, no TODOs. Every worked example in section 4 is a test with the same numbers.

**Unit tests (vitest, pure modules)**
- `time/zone`: work date at 23:30 and 00:30 local, both DST changes (a 7 hour and a 9 hour night shift), week start per site.
- `time/round`: each mode and increment, the 4.3 examples, ties toward the worker, no mode moves time against the worker (property test).
- `time/segments`: sequences, switches, paid and unpaid breaks, the 20 minute rule, missing out and missing break end never guessed,
  double taps, the 120 minute shift match for the work date.
- `time/overtime`: the Federal and California examples, seventh day, exempt people, two sites in one week, buckets always sum to worked.
- `time/breaks`: meal missed and short at the edges (minute 300 and 301), second meal, unchecked rest rules.
- `time/attendance`: late and early out at the grace edge, no call no show with and without time off or called out, excused.
- `plan`: the 4.9 example, ceiling at exact multiples, inputs with no pace, indirect by hours and by percent, temp cost cents.
- `certs`: Good, Ending soon, Expired at the day edges in site time; the "ends before this shift" warning.
- `preview-gate`, `permissions` (action table, scopes, self rights), `access` (role resolution and claim step), `csv` (the Pulse
  suite), `copy-rules` (English and Spanish), DTO walks for a lead and a viewer (no pay, private or attendance field or string).

**Database tests (local Postgres, throwaway orgs)**
- Punches: append only trigger, edits keep the original, superseded pair set once; `client_ref` makes 5 retries one punch.
- Week lock: every punch and edit write refused for an approved week (domain and trigger, OLD and NEW), reopen works and is logged,
  purge and org delete still work.
- Time cards rebuilt exactly after any edit sequence (property test against a fresh rebuild).
- Org isolation: composite FKs refuse a cross org parent; RLS with the `crew_app` role sees only the set org; a crew table with no
  policy fails the test.
- Import: people round trip (export then import is all "unchanged"), pay columns refused without `pay:manage`, agency made or matched
  through `upsertVendorKind`, undo.
- Bridge: every read returns empty without the schema; system reads never return pay or private fields; `listApprovedHours` equals the
  timesheets; `countBillablePeople` counts only active people.
- Pulse reader (Phase 8): approved week in, reopened week out, closed Pulse month skipped, idempotent twice.
- Fail soft: the `crew-only` org and a database with only `@kitstak/db` and Crew migrations.

**Playwright (`e2e/`, the three seed orgs, light and dark, 1440 and 390 wide, plus a 1024 x 768 tablet for the kiosk)**
1. Sign in as a preview org and see Home; an unlisted org in a production build sees the locked screen.
2. Import 30 agency people from the template, fix one error, commit, print PIN slips.
3. Build a week from templates, see a time off and a certification warning, publish, see the notice as a linked person.
4. Kiosk: identify by number and PIN, clock in, switch area, meal break, clock out, in English and in Spanish; idle lock; 5 wrong PINs lock.
5. Kiosk offline: cut the network, punch 5 times, reload the page, reconnect, each punch arrives once and the queue empties.
6. Phone clock inside and outside the fence (mocked location) in `flag` and `block` modes.
7. Fix a missing clock out with a reason, approve the week, try to edit it, reopen it with a reason.
8. Export the week by week and by day; totals match the timesheet.
9. Lead login sees their crew's schedule and punches and no pay, attendance or emergency contact anywhere (DOM scan for the currency
   symbol and the private field labels).
10. Time off request in `/me`, approval, the shift shows the person out, no attendance event.
11. Labor plan shows the seeded Tuesday as 3 people short; "Fill the gap" opens the schedule with 3 open slots.
12. With Pulse: the approved week appears as paid hours in Pulse; the Log grid chip fills hours only when saved.
13. Axe scan with no serious issues on Home, Today, Schedule, Time, the kiosk and the phone clock.

**Performance** (seed plus a load fixture of 400 people, 3 sites, 2 years of punches): Today under 300 ms server time; the schedule grid
for 150 people under 500 ms; the timesheet for 150 people under 500 ms; a punch round trip under 150 ms including the time card rebuild;
approving a 150 person week under 2 seconds; a 2,000 row people import checks in under 5 seconds; the kiosk answers a tap in under 100 ms
on screen whether online or offline.
**Time to first clock in**: a new org with sample data clocks a person in at the kiosk in under 5 minutes; with real people from a file,
in under 15 minutes.
