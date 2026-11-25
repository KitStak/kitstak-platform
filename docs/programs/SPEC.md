# KitStak Programs: product and build spec

Status: implementation ready. Owner: Projects app. Version 2.0 (2026-11-25). Version 2.0 folds in two harsh critic reviews (product and engine); Appendix A lists every finding and how it was resolved, and the few that were changed or declined, with the reason.

Programs are recurring kitting work for one customer under one price card. Example: the glove program runs every weekday and builds 100 of each glove kit (Small Brown, Small Yellow, Medium Brown and so on). Each day's set of builds is one run. Every kit is a different build with different parts, but all of them earn money against ONE price card and roll up into ONE program.

This spec is the single source of truth for Programs across Projects, Pulse, CRM, WMS, Portal and the shared packages. Read it with:

- `apps/projects/AGENTS.md` (Next 16 has breaking changes: read `node_modules/next/dist/docs` before touching routes, params, metadata, layouts, `proxy.ts` or server actions; page `params` and `searchParams` are Promises).
- `docs/projects/SPEC.md`, `docs/projects/CONTRACTS.md` (Projects rules and quality bar).
- `docs/pulse/SPEC.md` 4.2 (money), 4.8 (revenue), 4.16 (month close), and the "Tasks on a job" section; `docs/pulse/CONTRACTS.md`.
- `docs/integration/BLUEPRINT.md` 2.2 (core conventions) and 3.3 (gating).

Conventions used in this document:

- "UI copy" means every string a person can see. UI copy is plain 8th grade English, uses no em dash, no en dash and no double dash, uses "to" for ranges and a middle dot (`·`) as a separator. `apps/projects/src/lib/copy-rules.test.ts` enforces this for Projects, plus the program word list in 1.4.
- Money is whole cents (`bigint` in TS, `bigint` in SQL). Unit prices are dollars with 4 decimals (`numeric(14,4)`, TS string `"1.9500"`). Quantities have 3 decimals (`numeric(14,3)`). Hours have 2 decimals. These scales are the Pulse scales (`HOURS_SCALE 2`, `QUANTITY_SCALE 3`, `PRICE_SCALE 4`).
- Dates of work are plain `YYYY-MM-DD` (`date` in SQL, `IsoDate` string in TS). They never pass through a `Date` or a time zone after they are chosen.
- File paths are repo relative. "Container" means the `pm.projects` row a build task lives in (a program or a project).
- Example numbers in UI copy come from the seed (section 7) for a seed run on 2026-11-25. Section 7.4 lists them, and the L7 seed check prints them, so examples, tests and screenshots agree.

---

## 0. Decisions log (agreed with the user, binding)

| # | Decision |
|---|---|
| D1 | Programs live in the Projects app, beside projects (own sidebar section, own directory, own routes). Projects do not change for users who never make a program. |
| D2 | A program is a row in `pm.projects` with `kind = 'program'`. A build is a row in `pm.tasks` with `kind = 'build'`. Existing rows default to `project` and `task`. Board, list, table, calendar, timeline, comments, files, time tracking, watchers, dependencies, activity and numbering work on programs and builds for free. Build facts that tasks do not have live in new side tables. |
| D3 | Programs, projects, Pulse jobs and builds are independent records. Each works alone. Any of them can be tied to a customer, CRM deal or account, project, job, program, other builds and WMS records through a new shared link graph `core.record_links`. Legacy link tables (`pm.integration_links`, `pulse.job_links`, CRM bridges) stay. The Linked panel reads all of them. Nothing legacy is migrated or dropped. |
| D4 | A build belongs to at most one program and bills to at most one Pulse job. A build can live in a program, or in an ordinary project with no program at all. Revenue for a build day goes to exactly one place: the build's own job if it has one, else the program's job if the build is in a program that has one, else the program alone. A build with no job and no program is not billed anywhere, and the UI says so. |
| D5 | Unit price resolution, first match wins: build rate override, then the variant rate on the price card version in force that day, then the card default rate in force that day, then the Pulse job price in force that day (only when the build day goes to a job), else no price. Card versions are dated and never change days before their start date. |
| D6 | Price card lines: per unit built, per batch (each finished build; stored kind `per_order`), per hour, flat monthly fee, monthly minimum with a minimum top up. One time setup fees and adjustments are dated charges on the program, outside the versioned card. The unit label is set per program (kits, orders, units, packs, boxes or custom). |
| D7 | Variants are the program's kits (Small Brown). Each has an optional rate (held on the price card, so it is dated), an optional link to `core.items` and to a WMS kit product, and is made by hand, by pasting a list, or by the variant generator (attributes like Size x Color make a matrix). |
| D8 | Builds have planned quantity, built quantity logged per day (that date is the accrual date), a status flow, a variant, an optional rate override, and can be generated by repeating schedules (daily, weekdays, chosen weekdays, every few weeks). One schedule occurrence is a run. |
| D9 | Pulse: a program can link to one ongoing per unit Pulse job. Build output feeds Pulse production entries (one row per build per day, `units_good` counts, which is the one exception to the task units rule) and fee revenue. Pulse shows labor, cost and margin per program and per variant. Numbers in Projects and Pulse are identical because both read the same stored rows: per unit snapshots in `pm.build_output` and posted fees in `pm.program_ledger`, both computed by one shared pure engine package. |
| D10 | CRM: a won deal can start a program (deal facts prefill the wizard and the price card). Deal and account panels list linked programs with month to date revenue. |
| D11 | WMS is read only: kit capacity, component shortages for a variant's kit, and a "Programs using this kit" panel. A build never creates a WMS work order or stock movement. No WMS write path, route or migration changes. |
| D12 | Every surface degrades gracefully when an app is not installed or not entitled (existing patterns: `useShell().modules`, `integrationAvailability`, bridge reads that never throw), and when a database is older than this feature (column and table detection, 6.5). |
| D13 | Quality bar: compare side by side with Linear, Asana, Monday, ClickUp and Smartsheet. No placeholders, no TODOs, no dead buttons, no fake numbers. |

Decisions made in this spec (architect calls, documented so builders do not relitigate them):

| # | Call | Why |
|---|---|---|
| A1 | Programs may also hold ordinary tasks (`kind = 'task'`), for prep work ("Order more glove bags") and checklists. Only `kind = 'build'` rows carry quantity and money. Subtasks of a build are tasks. A build is never a subtask. | Real teams track prep work next to production. Keeps subtasks simple. |
| A2 | A build's own facts live in `pm.builds` (1 to 1 with the task row). Daily output lives in `pm.build_output` (one row per build per work date, holding the day's total). | Keeps `pm.tasks` narrow; one row per day matches the Pulse line (`pmb:<buildId>:<date>`), so rounding happens at the same grain in both apps. |
| A3 | Variant rates are lines on the price card version, not columns on the variant. Rate rules ("Size is XL: add $0.25") compile into those lines. Changing a variant rate on the Variants tab gathers into one pending draft per start date. | D5 says variant overrides are dated and never retroactive. One model, one resolver. |
| A4 | `core.record_links` is the authoritative edge for program to job and build to job. Pulse mirrors those edges into `pulse.job_links` (`pm_program`, `pm_build`) during sync so its own screens and filters keep working. One program per job, one job per program, one job per build (partial unique indexes). | Both apps can write `core`; the indexes enforce the money shape in one place. |
| A5 | The monthly minimum top up posts only after the month ends. It is written by the Projects sweep (which also runs from the 5 minute cron) and Pulse refuses to close a month until every program feeding it has settled that month. During the month both apps show the gap so far and the projected gap, never revenue. | A future dated adjustment would inflate month to date revenue; Pulse must never close before the top up exists. |
| A6 | Fixed lines (monthly fee, minimum) are split by days across versions inside a month. The line option "Charge part of it in a partial month" (stored `prorate`, on by default) only decides whether a month the program starts or ends in is charged in part or in full (3.5). | Parts of a month add back to the whole month to the cent; mixed options never charge more than one month. |
| A7 | The per batch line charges once per build, on the day it is first finished (first moved into a `done` category status) in the program time zone, and only when the build has output. Leaving done in an open month removes the charge; a charge in a locked month stays. Cancelled builds keep their per unit revenue and never get a batch charge. | "Batch" for a kitting floor is the build. ECOMM, which counts orders as units, uses the per unit line with unit label "orders". |
| A8 | A program has its own time zone (default the workspace calendar zone). Both apps count program days in that zone, including Pulse labor on program rows. Linking a job at a site in another zone is allowed and shows a note; changing the program zone is refused once a locked month holds time or output. | One day boundary for every app; site changes in Pulse never move program days. |
| A9 | A program closes months itself (Close {Month}: checklist, lock, statement snapshot). With Pulse, closed Pulse months also lock the days that go to a Pulse job. The lock is a set of closed months, checked month by month. | Gives Projects only orgs a real month close, and matches how Pulse checks each month on its own. |
| A10 | New ProjectActions `money:read` (needs an explicit program membership at or above the program's `money_min_role`, default editor; implicit org roles never pass), `pricing:propose` (editor) and `pricing:manage` (owner). Org owners and admins always pass. | Every org member is an implicit editor on org visible projects today; money must not follow that. |
| A11 | Wizard drafts are stored in `pm.wizard_drafts`, not as half made programs. | A draft may not have a valid key or customer yet. |
| A12 | The shared won rule is `isWonStage({ isDone, name })`: `isDone === true`, or when the board has no done flag for the label, the label name matches the whole word "won". It lives in the engine package and both CRM and Projects use it. | CRM and Projects disagree today (pulse-bridge `dealFacts` vs record-triggers `wonDeals`). |
| A13 | Posted fees live in a ledger, `pm.program_ledger`. The Projects domain recomputes the open months of the ledger in the same transaction as any input change (output, status, time, card, adjustments, dates, status of the program). Locked rows never change. Statements, rollups, pm-bridge and Pulse read the ledger; nothing recomputes past fees on read. | Fees depended on live inputs that are not lock checked; a ledger makes closed months final in both apps. |
| A14 | A run is computed, never stored: the builds of one container on one build date made by one schedule share the run id `run:<scheduleId>:<date>`; builds made by hand share `run:manual:<date>` and show as "Unscheduled". | The floor thinks in days. A stored run would duplicate dates and statuses. |
| A15 | Work days and holidays come from a workspace calendar (`pm.org_calendar`). A program uses it by default and can add days off, add work days, or set its own work days. | Thanksgiving is entered once, not once per program. |

---

## 1. Concepts

### 1.1 Glossary (also used as UI words)

| Term | Meaning | UI word |
|---|---|---|
| Program | Ongoing work for one customer under one price card. A `pm.projects` row with `kind = 'program'`. Has a key like `GLOVE`. | Program |
| Build | One batch of one variant for one day (or a few days). A `pm.tasks` row with `kind = 'build'`, numbered `GLOVE-212`. Usually in a program; can be in a project. | Build |
| Run | All builds of one program for one day made by one schedule, or the day's hand made builds. Computed (A14). | Run ("Weekday glove run", "Unscheduled") |
| Variant | One kit the program makes (Small Brown). | Variant (short: kit when the unit label is kits) |
| Attribute | An axis used to make variants (Size, Color). | Attribute |
| Rate rule | A rule on a card version that sets or adds to the rate of every variant with one attribute value. | Rate rule ("Size is XL: add $0.25") |
| Unit | What a build counts and what the per unit line charges for. Label per program. | kits / orders / units / custom |
| Planned qty | How many units a build should make. | Planned |
| Built qty | Units logged as made, per day. | Built |
| Output | The built qty logged for one build on one day. | Output |
| Unplanned build | A build made while logging output for work nobody planned. Planned equals built. | Unplanned |
| Price card | The program's rates. Has dated versions. | Price card |
| Version | A dated copy of the card. Draft, Scheduled (published, starts later), In force, or Ended. | Version (v1, v2) |
| Line | One charge on a version (Per kit, Monthly fee). | Line |
| One time charge | A dated charge outside the card: a setup fee or an adjustment (a charge or a credit). | Setup fee, Adjustment |
| Rate override | A price on one build that beats the card. | Build rate |
| Schedule | A repeating rule that makes builds ahead of time. | Schedule |
| Posting | Where a build day's revenue goes: the build's Pulse job, the program's Pulse job, the program, or nowhere. | Revenue goes to |
| Month to date (MTD) | From the first of the month through today, in the program time zone. | This month |
| Forecast | Month estimate, from planned builds or from recent days. | Forecast ("Based on planned builds", "Based on recent days") |
| Target | The program's monthly revenue goal. | Target ("105% of target") |
| Work charges | Per unit, per batch and per hour charges. These count toward the minimum. | Work charges |
| Minimum gap | How far work charges are under the monthly minimum. | Below minimum by |
| Minimum top up | The charge that brings a month up to its minimum. Posts after the month ends. | Minimum top up |
| Close a month | Final review of a month: checklist, lock and a saved total. | Close November |
| Lock | Days that cannot change: a closed program month, or a closed Pulse month for days that go to a Pulse job. | Locked |

### 1.2 Independence and linking model

```
core.customers ──┐            ┌── crm deal / crm account
                 │            │
               (links)     (links)
                 │            │
   pm project ───┴── PROGRAM ─┴── pulse job (at most 1, bills_to; a job has at most 1 program)
       │               │  │
       │               │  └── variants ── core.items / wms kit product (read only)
       │               │
       │             builds (tasks of the program) ── pulse job (at most 1 per build, bills_to)
       │               │
   builds (tasks of a  build_output (per day)  ─┐
   project, no program)                        ├─> engine ─> pm.build_output snapshots + pm.program_ledger fees
       │                                       │                 │
       └── pulse job (bills_to, optional) ─────┘                 └─> read by Projects, pm-bridge and Pulse sync
```

Rules:

1. Every record works alone. A program with no customer, no job and no CRM deal is valid. A Pulse job with no program is valid (today's behavior). A build is valid in a program or in a project. A build in a project has no variant and no price card; it is priced by its build rate, then its job price.
2. A link is an edge in `core.record_links` (from, to, relation). Relations: `related` (default, no meaning for money), `belongs_to` (program belongs to a customer or account), `bills_to` (program or build bills to a Pulse job), `uses_kit` (variant uses a core item or WMS product), `created_from` (program made from a CRM deal or a template or another program; build split from another build).
3. Money edges are only `bills_to`. The database allows one `bills_to` job per program, one per build, and one program per job (partial unique indexes, 2.1).
4. The Linked panel (program, build and project) shows the union of `core.record_links` (both directions), `pm.integration_links` (legacy project and task links) and `pulse.job_links` that point at the record, de duplicated by (type, id). Vocabulary mapping for the union: `pm.integration_links.crm_item` is shown as a CRM deal or account by the item's board; `wms_order` maps to `wms_shipment_order`.
5. Deleting a record never deletes the other side, with two money exceptions: a Pulse job cannot be deleted while a `bills_to` edge points at it (6.1), and a dead job behind an edge is treated as no job for posting (it resolves to the program and raises an alert). Other links to a deleted or missing record stay and show "This record is no longer available" with a Remove link action.

### 1.3 Money rules (normative)

M1. Grain. Per unit revenue is computed per output row (one build, one work date) with one rounding step to whole cents: `revenue_cents = divRound(qty_scaled_3 * price_scaled_4, 100000)` (the Pulse `mulQuantityPrice`). Sums are sums of row cents. Pulse stamps the same row from its own copy of the unit price with `round(units_good * unit_price * 100)`, which is the same number.

M2. One place. A build day row goes to exactly one place, decided by `postingTarget` (3.4). The program headline counts every build day of the program exactly once, whichever place it goes to. Fees always go to the program's job when it has one, else to the program. Related jobs (relation `related`) are added in the "All linked work" panel and labeled; `bills_to` jobs are never added again because their program revenue already is the program's.

M3. Price in force. For a work date, the card version in force is the published version with the latest `effective_from` on or before that date (`versionFor`). A version never changes a day before its `effective_from`. Published versions are immutable (4.4).

M4. Snapshots. Each output row stores a concrete `unit_price` (`0.0000` when there is no price), `price_source`, `card_version_id`, `revenue_cents` and `posting` when it is written, including the Pulse job price read at write time for source `job`. When a version, a variant rate, a build override, a job price or a posting changes, the domain updates only rows on or after the change's start date that are not locked, in the same transaction. Locked rows never change. Reads never write.

M5. Fees. Per batch, per hour, monthly fee, setup fees, adjustments and the minimum top up are computed by the engine and stored in `pm.program_ledger` with stable refs (3.6). The ledger is the only source for fees in every app.

M6. Minimum. `top_up = max(0, minimum_for_month - work_charges_for_minimum)`, where work charges are per unit + per batch + per hour revenue of the month across all builds of the program (wherever they go), plus adjustments marked "Counts toward minimum". Monthly fee and setup fees never count. Posts on the last active day of the month, only once the month is over (A5).

M7. Never float. No `Number` math on money anywhere. API responses carry cents as decimal strings (`"153000"`) and prices as strings (`"1.9500"`). Display uses `formatCents` from the engine (fixed `en-US`).

M8. Visibility. Money fields are removed on the server for people without `money:read` (A10), including inside activity rows (4.10). The UI then shows units only and a short line "Money is hidden for your role."

M9. Locks. A date is locked for a program when its month is closed in the program (`pm.program_closes`), or when the day goes to a Pulse job and its month is closed in Pulse. Every write that can change a stored money row on a locked date is refused (4.3.4). Unlocking is a reopen with a reason, by an owner.

### 1.4 Program copy words

UI copy in `features/programs/**`, `app/(app)/programs/**` and the program parts of `features/{views,task,my-work,quick-add,home,shell,command}` never uses these words; `copy-rules.test.ts` fails on them (case insensitive, whole word): "true up", "true-up", "prorate", "prorated", "posts to", "run rate", "pace", "reprice", "repriced", "price source", "usage". Use instead: "Minimum top up", "Charge part of it in a partial month", "Revenue goes to", "Based on recent days", "Based on planned builds", "% of target", "Update prices on open days", "Price from", "Work charges". Code identifiers (`prorate`, `runRateCents`, `usage`) are not UI copy and stay.

---

## 2. Schema

Three migrations. All are hand written SQL, split by `--> statement-breakpoint`, one transaction per file, content hashed, safe to run again (every `ADD CONSTRAINT` and `DROP CONSTRAINT` sits in a `DO` block that checks `pg_constraint`, as in Pulse 0014; every table and index uses `IF NOT EXISTS`). Never edit an applied file. Never run `drizzle-kit push`. Each migration gets a journal entry, a README table row and its Drizzle mirror.

Deploy order (`docs/DEPLOYMENT.md` is updated by L7): `@kitstak/db` 0007, then Projects 0006, then the CRM deploy, then WMS, then Pulse 0015. Projects 0006 moves ahead of the CRM deploy because the new pm-bridge reads `pm.projects.kind`. Every cross app read of a new column or table is also feature detected (6.5), so a partial database or a different order never breaks a sibling app.

| App | File | Journal entry |
|---|---|---|
| `packages/db` | `packages/db/drizzle/0007_core_record_links.sql` | `{ "idx": 7, "version": "7", "when": 1795046400000, "tag": "0007_core_record_links", "breakpoints": true }` |
| Projects | `apps/projects/drizzle/0006_programs.sql` | `{ "idx": 6, "version": "7", "when": 1795305600000, "tag": "0006_programs", "breakpoints": true }` |
| Pulse | `apps/pulse/drizzle/0015_program_builds.sql` | `{ "idx": 15, "version": "7", "when": 1795996800000, "tag": "0015_program_builds", "breakpoints": true }` |

Every pm and pulse migration that references `core.record_links` guards with `to_regclass('core.record_links') IS NOT NULL` (partial local databases).
### 2.1 `packages/db/drizzle/0007_core_record_links.sql`

```sql
CREATE TABLE IF NOT EXISTS "core"."record_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "from_type" text NOT NULL,
  "from_id" text NOT NULL,
  "to_type" text NOT NULL,
  "to_id" text NOT NULL,
  "relation" text NOT NULL DEFAULT 'related',
  "cached_title" text,
  "cached_status" text,
  "cached_url" text,
  "cached_at" timestamptz,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "record_links_from_type_check" CHECK ("from_type" IN ('core_customer','core_item','crm_deal','crm_account','pm_project','pm_program','pm_task','pm_build','pm_variant','pulse_job','wms_work_order','wms_shipment_order','wms_client','wms_product')),
  CONSTRAINT "record_links_to_type_check" CHECK ("to_type" IN ('core_customer','core_item','crm_deal','crm_account','pm_project','pm_program','pm_task','pm_build','pm_variant','pulse_job','wms_work_order','wms_shipment_order','wms_client','wms_product')),
  CONSTRAINT "record_links_relation_check" CHECK ("relation" IN ('related','belongs_to','bills_to','uses_kit','created_from')),
  CONSTRAINT "record_links_not_self_check" CHECK (("from_type","from_id") <> ("to_type","to_id")),
  CONSTRAINT "record_links_cached_url_check" CHECK ("cached_url" IS NULL OR ("cached_url" LIKE '/%' AND "cached_url" NOT LIKE '//%')),
  CONSTRAINT "record_links_bills_to_shape_check" CHECK ("relation" <> 'bills_to' OR ("from_type" IN ('pm_program','pm_build') AND "to_type" = 'pulse_job')),
  CONSTRAINT "record_links_uses_kit_shape_check" CHECK ("relation" <> 'uses_kit' OR ("from_type" = 'pm_variant' AND "to_type" IN ('core_item','wms_product')))
);
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_edge_key" ON "core"."record_links" ("org_id","from_type","from_id","to_type","to_id","relation");
CREATE INDEX IF NOT EXISTS "record_links_from_idx" ON "core"."record_links" ("org_id","from_type","from_id");
CREATE INDEX IF NOT EXISTS "record_links_to_idx" ON "core"."record_links" ("org_id","to_type","to_id");
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_one_job_per_program" ON "core"."record_links" ("org_id","from_id") WHERE "from_type" = 'pm_program' AND "relation" = 'bills_to';
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_one_job_per_build" ON "core"."record_links" ("org_id","from_id") WHERE "from_type" = 'pm_build' AND "relation" = 'bills_to';
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_one_program_per_job" ON "core"."record_links" ("org_id","to_id") WHERE "from_type" = 'pm_program' AND "relation" = 'bills_to';
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_one_kit_per_variant" ON "core"."record_links" ("org_id","from_id","to_type") WHERE "relation" = 'uses_kit';
ALTER TABLE "core"."record_links" ENABLE ROW LEVEL SECURITY;
```

Plus the guarded FK DO blocks in the 0005 style: `org_id` references `core.organization(id) ON DELETE CASCADE`; `created_by` references `core."user"(id) ON DELETE SET NULL`. No RLS policies here, no FORCE (core pattern); Pulse 0015 adds the one `pulse_app` policy (2.3), because Pulse writes edges inside its own `pulse_app` transactions. README row: "0007 core record links: one link graph for any record to any record (programs, builds, jobs, customers, kits)."

Rules for writers (enforced by the helper, not SQL):

- Store one edge per pair. Writers normalize direction: money and kit edges go from the pm record outward (`pm_program -> pulse_job`, `pm_build -> pulse_job`, `pm_variant -> core_item`). For `related` and `belongs_to` the pm record is always `from` when one side is pm. Otherwise the lower `(type,id)` pair is `from`.
- `cached_url` stores paths only (`storedLinkPath` rule).

Drizzle mirror: `packages/db/src/schema/core/record-links.ts` (`coreSchema.table('record_links', ...)`), exported from `packages/db/src/schema/index.ts`. Constant lists in `packages/db/src/record-links.ts`:

```ts
export const RECORD_TYPES = ['core_customer','core_item','crm_deal','crm_account','pm_project','pm_program','pm_task','pm_build','pm_variant','pulse_job','wms_work_order','wms_shipment_order','wms_client','wms_product'] as const;
export const RECORD_RELATIONS = ['related','belongs_to','bills_to','uses_kit','created_from'] as const;
```

Helper module `packages/db/src/record-links.ts`, exported as `@kitstak/db/record-links` (add to `packages/db/package.json` exports, precedent `./wms-tenants`). Raw `sql` over a structural executor `{ execute(SQL), transaction(fn) }`, driver portable (`rowsOf`, no array params, use `sql.join`):

```ts
export type RecordType = (typeof RECORD_TYPES)[number];
export type RecordRelation = (typeof RECORD_RELATIONS)[number];
export interface RecordRef { readonly type: RecordType; readonly id: string }
export interface RecordLinkRow { id: string; orgId: string; from: RecordRef; to: RecordRef; relation: RecordRelation; cachedTitle: string | null; cachedStatus: string | null; cachedUrl: string | null; cachedAt: string | null; meta: Record<string, unknown>; createdBy: string | null; createdAt: string }
export function recordLinksAvailable(db: Executor): Promise<boolean>; // to_regclass, cached 60s per executor in a WeakMap
export function listRecordLinks(db: Executor, orgId: string, ref: RecordRef, opts?: { relation?: RecordRelation; otherType?: RecordType }): Promise<RecordLinkRow[]>; // both directions, newest first; [] when unavailable
export function listRecordLinksMany(db: Executor, orgId: string, refs: readonly RecordRef[], opts?: { relation?: RecordRelation }): Promise<RecordLinkRow[]>;
export function linkRecords(db: Executor, input: { orgId: string; from: RecordRef; to: RecordRef; relation?: RecordRelation; cache?: { title?: string; status?: string; url?: string }; meta?: Record<string, unknown>; createdBy?: string | null }): Promise<RecordLinkRow>; // savepoint; ON CONFLICT (edge key) DO UPDATE cache; throws RecordLinkError('TAKEN') when a one job / one kit index refuses
export function unlinkRecords(db: Executor, orgId: string, linkId: string): Promise<boolean>;
export function refreshLinkCache(db: Executor, orgId: string, ref: RecordRef, cache: { title?: string; status?: string; url?: string }): Promise<number>; // updates cached_* on every edge touching ref
export class RecordLinkError extends Error { constructor(readonly code: 'TAKEN' | 'INVALID' | 'UNAVAILABLE', message: string) }
```

`TAKEN` messages (UI copy): "This program already bills to a Pulse job. Remove that link first.", "This build already bills to a Pulse job." and "This Pulse job already takes revenue from another program."

### 2.2 `apps/projects/drizzle/0006_programs.sql`

Header comment: "Programs: recurring kitting work under one price card. Adds kind to projects, tasks and templates, a surface to saved views, a workspace calendar, and the program side tables." Every new table has `org_id uuid NOT NULL` with FK `core.organization(id) ON DELETE CASCADE`, `ENABLE ROW LEVEL SECURITY` (no policies), quoted identifiers, enums as text with a named CHECK, partial indexes `WHERE deleted_at IS NULL` where soft delete exists, and `version integer NOT NULL DEFAULT 1` on every mutable new table (optimistic concurrency, 8.4).

#### 2.2.1 Kind columns and guards

```sql
ALTER TABLE "pm"."projects" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'project';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_kind_check') THEN
  ALTER TABLE "pm"."projects" ADD CONSTRAINT "projects_kind_check" CHECK ("kind" IN ('project','program')); END IF; END $$;
ALTER TABLE "pm"."tasks" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'task';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_kind_check') THEN
  ALTER TABLE "pm"."tasks" ADD CONSTRAINT "tasks_kind_check" CHECK ("kind" IN ('task','build')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_build_no_recurrence_check') THEN
  ALTER TABLE "pm"."tasks" ADD CONSTRAINT "tasks_build_no_recurrence_check" CHECK ("kind" <> 'build' OR "recurrence" IS NULL); END IF; END $$;
ALTER TABLE "pm"."templates" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'project';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'templates_kind_check') THEN
  ALTER TABLE "pm"."templates" ADD CONSTRAINT "templates_kind_check" CHECK ("kind" IN ('project','program')); END IF; END $$;
ALTER TABLE "pm"."saved_views" ADD COLUMN IF NOT EXISTS "surface" text NOT NULL DEFAULT 'work';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_views_surface_check') THEN
  ALTER TABLE "pm"."saved_views" ADD CONSTRAINT "saved_views_surface_check" CHECK ("surface" IN ('work','programs','floor')); END IF; END $$;
CREATE INDEX IF NOT EXISTS "projects_org_kind_idx" ON "pm"."projects" ("org_id","kind") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "tasks_org_kind_assignee_idx" ON "pm"."tasks" ("org_id","kind","assignee_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "tasks_project_kind_due_idx" ON "pm"."tasks" ("project_id","kind","due_date") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "time_entries_project_started_idx" ON "pm"."time_entries" ("project_id","started_at") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "templates_org_kind_idx" ON "pm"."templates" ("org_id","kind") WHERE "deleted_at" IS NULL;
```

Backfill: none needed; the defaults make every existing row `project`, `task`, project templates and `work` views. `ADD COLUMN ... DEFAULT` with a constant is metadata only in Postgres 11+.

Guard triggers (belt and braces for D4 and A1). Moving a build between containers is allowed only through the domain (`moveBuild`, 4.2), which sets a transaction local flag:

```sql
CREATE OR REPLACE FUNCTION "pm"."guard_task_kind"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'task_kind_is_fixed' USING ERRCODE = 'KP103';
  END IF;
  IF NEW.kind = 'build' AND NEW.parent_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'build_is_top_level' USING ERRCODE = 'KP101';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.kind = 'build' AND NEW.project_id IS DISTINCT FROM OLD.project_id
     AND coalesce(current_setting('pm.build_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'build_move_needs_domain' USING ERRCODE = 'KP104';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "tasks_guard_kind" ON "pm"."tasks";
CREATE TRIGGER "tasks_guard_kind" BEFORE INSERT OR UPDATE OF "project_id","kind","parent_task_id" ON "pm"."tasks" FOR EACH ROW EXECUTE FUNCTION "pm"."guard_task_kind"();

CREATE OR REPLACE FUNCTION "pm"."guard_project_kind"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'project_kind_is_fixed' USING ERRCODE = 'KP102';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "projects_guard_kind" ON "pm"."projects";
CREATE TRIGGER "projects_guard_kind" BEFORE UPDATE OF "kind" ON "pm"."projects" FOR EACH ROW EXECUTE FUNCTION "pm"."guard_project_kind"();
```

`builds_match_task` keeps `pm.builds` consistent with its task. It is a deferred constraint trigger on both tables, so `moveBuild` can update the task and the builds row in either order inside one transaction:

```sql
CREATE OR REPLACE FUNCTION "pm"."check_build_match"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tid uuid;
  t record; b record; pkind text; vprog uuid;
BEGIN
  IF TG_TABLE_NAME = 'builds' THEN tid := NEW.task_id; ELSE tid := NEW.id; END IF;
  SELECT id, kind, project_id INTO t FROM pm.tasks WHERE id = tid;
  SELECT * INTO b FROM pm.builds WHERE task_id = tid;
  IF t.kind = 'build' AND b.task_id IS NULL THEN RAISE EXCEPTION 'build_row_missing' USING ERRCODE = 'KP105'; END IF;
  IF b.task_id IS NULL THEN RETURN NULL; END IF;
  IF t.kind IS DISTINCT FROM 'build' THEN RAISE EXCEPTION 'build_task_kind' USING ERRCODE = 'KP105'; END IF;
  SELECT kind INTO pkind FROM pm.projects WHERE id = t.project_id;
  IF b.container_id <> t.project_id
     OR (pkind = 'program' AND b.program_id IS DISTINCT FROM t.project_id)
     OR (pkind = 'project' AND b.program_id IS NOT NULL) THEN
    RAISE EXCEPTION 'build_container_mismatch' USING ERRCODE = 'KP105';
  END IF;
  IF b.variant_id IS NOT NULL THEN
    SELECT program_id INTO vprog FROM pm.program_variants WHERE id = b.variant_id;
    IF vprog IS DISTINCT FROM b.program_id THEN RAISE EXCEPTION 'variant_of_other_program' USING ERRCODE = 'KP105'; END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "builds_match_task" ON "pm"."builds";
CREATE CONSTRAINT TRIGGER "builds_match_task" AFTER INSERT OR UPDATE ON "pm"."builds" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pm"."check_build_match"();
DROP TRIGGER IF EXISTS "tasks_match_build" ON "pm"."tasks";
CREATE CONSTRAINT TRIGGER "tasks_match_build" AFTER INSERT OR UPDATE OF "project_id","kind" ON "pm"."tasks" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind = 'build') EXECUTE FUNCTION "pm"."check_build_match"();
```

`finished_on` maintenance is a trigger, so every status path (task updates, bulk edits, board drags, `structure.ts` status category changes and status deletes) keeps it right:

```sql
CREATE OR REPLACE FUNCTION "pm"."sync_build_finish"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cat text; tz text; today date;
BEGIN
  SELECT s.category INTO cat FROM pm.statuses s WHERE s.id = NEW.status_id;
  SELECT coalesce(ps.timezone, oc.timezone, 'America/Chicago') INTO tz
    FROM pm.builds b LEFT JOIN pm.program_settings ps ON ps.program_id = b.program_id
    LEFT JOIN pm.org_calendar oc ON oc.org_id = b.org_id WHERE b.task_id = NEW.id;
  today := (now() AT TIME ZONE tz)::date;
  IF cat = 'done' THEN
    UPDATE pm.builds SET first_finished_on = coalesce(first_finished_on, today),
                         finished_on = coalesce(finished_on, first_finished_on, today), updated_at = now()
     WHERE task_id = NEW.id AND finished_on IS NULL;
  ELSE
    UPDATE pm.builds SET finished_on = NULL, updated_at = now() WHERE task_id = NEW.id AND finished_on IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "tasks_sync_build_finish" ON "pm"."tasks";
CREATE TRIGGER "tasks_sync_build_finish" AFTER UPDATE OF "status_id","completed_at" ON "pm"."tasks" FOR EACH ROW WHEN (NEW.kind = 'build') EXECUTE FUNCTION "pm"."sync_build_finish"();
```

The trigger only keeps `finished_on` in step with the status. Whether a batch charge exists is decided by the ledger (4.3): a ledger row on a locked date never changes, so clearing `finished_on` after the month closed changes nothing already charged, and the ref `pmf:<programId>:order:<buildId>` can exist only once, so a build is charged once ever. Every domain path that changes a build status calls `refreshLedgerFor(tx, programIds, dates)` in the same transaction (4.3.2); `structure.ts` does too (L2 owns it).

Domain error mapping: `KP101` VALIDATION "A build cannot be a subtask."; `KP102` VALIDATION "A project cannot become a program. Copy it into a new program instead."; `KP103` VALIDATION "A task cannot become a build. Make a new build instead."; `KP104` VALIDATION "Move builds with Move to program or Move to project."; `KP105` VALIDATION "This build does not match its program. Reload and try again."

#### 2.2.2 CHECK widenings (closed lists that change together with `src/lib/constants.ts`)

- `notifications_kind_check`: add `'program'` (NOTIFICATION_KINDS gains `program`).
- `activity_actor_kind_check`: unchanged.
- `integration_links_target_type_check` and `integration_events_target_type_check`: unchanged (new kinds use `core.record_links`).
- `saved_views_type_check`: unchanged (programs reuse view types; the Runs view is a list view with `config.layout = 'runs'`). Saved views on a program are scoped by `project_id` as today. Directory views use `project_id` null with `surface = 'programs'`; Floor today views use `surface = 'floor'`. Every views query filters by `surface` (`views.ts` L37 and L64 add `eq(savedViews.surface, surface)`, default `'work'`), so My Work never lists directory views.
- `favorites` and `recents` `entity_type`: unchanged; programs reuse `project`. `listFavorites` and `listRecents` return the project `kind`, and the sidebar Starred list shows programs with the program icon and route.

#### 2.2.3 `pm.org_calendar` (1 to 1 with an org)

| Column | Type | Rule |
|---|---|---|
| `org_id` | uuid PK | |
| `timezone` | text NOT NULL DEFAULT 'America/Chicago' | IANA name, validated with `Intl.supportedValuesOf('timeZone')`. Default for new programs. |
| `working_days` | smallint[] NOT NULL DEFAULT '{1,2,3,4,5}' | JS weekday numbers, 0 is Sunday. CHECK `working_days <@ '{0,1,2,3,4,5,6}' AND cardinality(working_days) BETWEEN 1 AND 7`. |
| `holidays` | jsonb NOT NULL DEFAULT '[]' | `[{ "date": "2026-11-26", "name": "Thanksgiving" }]`, dates unique, at most 100. |
| `daily_capacity_hours` | numeric(10,2) NULL | CHECK `> 0`. Floor hours per work day, used by Workload and Floor today. |
| `version`, `updated_at` | | |

A missing row means the defaults. Edited in workspace Settings, Work calendar (owners and admins).

#### 2.2.4 `pm.program_settings` (1 to 1 with a program)

| Column | Type | Rule |
|---|---|---|
| `program_id` | uuid PK, FK `pm.projects(id)` ON DELETE CASCADE | Must be a `kind='program'` row (domain check). |
| `org_id` | uuid NOT NULL | |
| `unit_singular` | text NOT NULL DEFAULT 'kit' | 1 to 24 chars. |
| `unit_plural` | text NOT NULL DEFAULT 'kits' | 1 to 24 chars. |
| `timezone` | text NOT NULL | Set at create from the workspace calendar; A8. |
| `working_days` | smallint[] NULL | Null uses the workspace work days. Same CHECK as `pm.org_calendar` when not null. |
| `use_org_holidays` | boolean NOT NULL DEFAULT true | "Use the workspace calendar". |
| `extra_days_off` | date[] NOT NULL DEFAULT '{}' | Program only days off. |
| `extra_work_days` | date[] NOT NULL DEFAULT '{}' | Program only work days (beats a holiday or a non work weekday). |
| `currency` | text NOT NULL DEFAULT 'USD' | CHECK `currency ~ '^[A-Z]{3}$'`. Display only; no FX. |
| `monthly_target_cents` | bigint NULL | CHECK `>= 0`. Revenue target for health. |
| `daily_target_units` | numeric(14,3) NULL | CHECK `>= 0`. Health fallback (3.8). |
| `build_title_pattern` | text NOT NULL DEFAULT '{variant} · {date}' | Tokens `{variant}`, `{sku}`, `{date}` (`Nov 25`), `{qty}`, `{unit}`. |
| `auto_start_on_output` | boolean NOT NULL DEFAULT true | Logging output on a todo build moves it to the first in progress status. |
| `auto_done_when_full` | boolean NOT NULL DEFAULT true | Default for the "Mark done when full" box. |
| `money_min_role` | text NOT NULL DEFAULT 'editor' | CHECK IN ('owner','editor','commenter','viewer'). Lowest explicit program role that sees money (A10). |
| `hourly_time_basis` | text NOT NULL DEFAULT 'billable' | CHECK IN ('billable','all'). Which time the per hour line charges. New time entries on a program whose card has a per hour line default to billable. |
| `remind_at` | time NULL DEFAULT '18:00' | "Remind if no output by". Null is Off. |
| `paused_ranges` | jsonb NOT NULL DEFAULT '[]' | `[{ "from": "2026-12-20", "to": "2027-01-03" }]` (`to` null while paused). Written by `setProgramStatus`. |
| `locked_through` | date NULL | Cache: last day of the latest closed program month (`pm.program_closes`). Written only by close and reopen. |
| `settled_through` | date NULL | Last month end whose month end charges (minimum top up) are in the ledger. Written by the sweep. Pulse reads it before closing a month (6.1). |
| `version` | integer NOT NULL DEFAULT 1 | |
| `created_at`, `updated_at` | timestamptz | |

The program's active range is `pm.projects.start_date` to `pm.projects.due_date` (the only copy; the domain shows `due_date` as "Ends").

#### 2.2.5 `pm.program_attributes` (variant generator axes)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `program_id` | uuid NOT NULL FK projects ON DELETE CASCADE | |
| `name` | text NOT NULL | 1 to 40 chars ("Size"). Unique per program (live, lower(name)). |
| `values` | jsonb NOT NULL DEFAULT '[]' | Array of `{ id: string, label: string, code: string, color: LabelColor or null }`, 1 to 30 entries, labels unique, codes `^[A-Z0-9]{1,6}$` unique. |
| `position` | text NOT NULL | Fractional rank. |
| `version`, `created_at`, `updated_at`, `deleted_at` | | |

Max 4 live attributes per program (domain check). Adding an attribute while variants exist requires a value for every existing variant (5.11). Removing one is allowed only when the remaining combinations stay unique.

#### 2.2.6 `pm.program_variants`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `program_id` | uuid NOT NULL FK projects ON DELETE CASCADE | |
| `key` | text NOT NULL | Stable short code, `^[A-Z0-9][A-Z0-9-]{0,15}$` ("S-BRN"). Unique per program among live rows. |
| `name` | text NOT NULL | 1 to 80 chars ("Small Brown"). Unique per program among live rows (lower). |
| `attributes` | jsonb NOT NULL DEFAULT '{}' | `{ [attributeId]: valueId }`. A combination is unique per program among live rows (domain check). |
| `sku` | text NULL | Kit SKU. Unique per program among live rows when not null. |
| `default_qty` | numeric(14,3) NULL | CHECK `> 0`. Planner default and the default for new schedule lines. |
| `pack_qty` | numeric(14,3) NULL | CHECK `> 0`. What one scan adds when "Count each scan" is on (default 1). |
| `std_minutes_per_unit` | numeric(10,3) NULL | CHECK `> 0`. Estimated hours for Workload and Floor today. |
| `material_cost_per_unit` | numeric(14,4) NULL | CHECK `>= 0 AND < 1000000`. Optional standard material cost, used by Pulse margin per variant. Money field. |
| `core_item_id` | uuid NULL | Cached copy of the `uses_kit` edge to `core.items`. |
| `wms_product_id` | text NULL | Cached copy of the `uses_kit` edge to the WMS kit product. |
| `color` | text NULL | Label palette name for chips and charts. |
| `position` | text NOT NULL | Fractional rank. |
| `status` | text NOT NULL DEFAULT 'active' | CHECK IN ('active','retired'). Retired variants keep history, leave pickers. |
| `version`, `created_by`, `created_at`, `updated_at`, `deleted_at` | | Delete is allowed only when no build uses the variant. |

Indexes: `program_variants_program_key_live` UNIQUE (program_id, key) WHERE deleted_at IS NULL; `program_variants_program_name_live` UNIQUE (program_id, lower(name)) WHERE deleted_at IS NULL; `program_variants_program_sku_live` UNIQUE (program_id, sku) WHERE deleted_at IS NULL AND sku IS NOT NULL; `program_variants_core_item_idx` (org_id, core_item_id) WHERE core_item_id IS NOT NULL AND deleted_at IS NULL; `program_variants_wms_product_idx` (org_id, wms_product_id) WHERE wms_product_id IS NOT NULL AND deleted_at IS NULL.

#### 2.2.7 `pm.price_card_versions`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `program_id` | uuid NOT NULL FK projects ON DELETE CASCADE | |
| `number` | integer NULL | Given at first publish (max live number + 1) and kept if the version is moved back to draft. Drafts show as "Draft · Jan 1". Unique (program_id, number) WHERE number IS NOT NULL AND deleted_at IS NULL. |
| `status` | text NOT NULL DEFAULT 'draft' | CHECK IN ('draft','published'). The UI states Scheduled, In force and Ended are derived from `effective_from` and today (4.4). |
| `effective_from` | date NOT NULL | The first day in force. |
| `label` | text NULL | Up to 60 chars ("2027 rates"). |
| `note` | text NULL | Up to 2,000 chars (why it changed). |
| `source` | text NOT NULL DEFAULT 'manual' | CHECK IN ('manual','crm_deal','copy','template','seed','variant_tab'). `variant_tab` marks the pending changes draft of 4.4.3. |
| `source_ref` | text NULL | e.g. the CRM deal id. |
| `review_status` | text NOT NULL DEFAULT 'none' | CHECK IN ('none','waiting','sent_back'). |
| `review_note` | text NULL | Up to 500 chars, the owner's note when sent back. |
| `review_requested_by`, `review_requested_at` | uuid NULL, timestamptz NULL | |
| `published_at` | timestamptz NULL | |
| `published_by` | uuid NULL | |
| `version`, `created_by`, `created_at`, `updated_at`, `deleted_at` | | Published versions can be deleted only while Scheduled. |

Indexes: UNIQUE (program_id, effective_from) WHERE status = 'published' AND deleted_at IS NULL (two published versions never start on the same day); UNIQUE (program_id, effective_from) WHERE status = 'draft' AND source = 'variant_tab' AND deleted_at IS NULL (one pending changes draft per start date); (program_id, status, effective_from) WHERE deleted_at IS NULL.

#### 2.2.8 `pm.price_card_rules` and `pm.price_card_lines`

`pm.price_card_rules` (rate rules, A3):

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `version_id` | uuid NOT NULL FK price_card_versions ON DELETE CASCADE | |
| `attribute_id` | uuid NOT NULL FK program_attributes ON DELETE RESTRICT | |
| `value_id` | text NOT NULL | A value id of that attribute (domain check). |
| `op` | text NOT NULL | CHECK IN ('add','set'). |
| `amount` | numeric(14,4) NOT NULL | CHECK `amount > -1000000 AND amount < 1000000`; `set` needs `amount >= 0` (CHECK). |
| `position` | integer NOT NULL DEFAULT 0 | |

UNIQUE (version_id, attribute_id, value_id). Rules are edited with their version and copied with it (new ids, same attribute and value).

`pm.price_card_lines`:

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `version_id` | uuid NOT NULL FK price_card_versions ON DELETE CASCADE | |
| `kind` | text NOT NULL | CHECK IN ('per_unit','per_order','per_hour','flat_monthly','monthly_minimum'). `per_order` is shown as "Per batch". |
| `variant_id` | uuid NULL FK program_variants ON DELETE RESTRICT | Allowed only for `per_unit` and `per_order` (CHECK). Null means the card default for that kind. |
| `rule_id` | uuid NULL FK price_card_rules ON DELETE CASCADE | Set on `per_unit` variant lines compiled from rules; such lines are rewritten whenever the rules or the default rate change. Lines without `rule_id` were typed by hand and beat rules. |
| `unit_price` | numeric(14,4) NULL | Required for `per_unit`, null otherwise (CHECK). `>= 0 AND < 1000000`. |
| `rate_cents` | integer NULL | Required for `per_hour` (CHECK). `>= 0 AND <= 10000000`. |
| `amount_cents` | bigint NULL | Required for `per_order`, `flat_monthly`, `monthly_minimum` (CHECK). `>= 0 AND <= 10000000000000`. |
| `prorate` | boolean NOT NULL DEFAULT true | `flat_monthly` and `monthly_minimum`: "Charge part of it in a partial month" (A6). |
| `charge_while_paused` | boolean NOT NULL DEFAULT true | `flat_monthly` and `monthly_minimum`: when off, paused days do not count (3.5). |
| `label` | text NULL | Custom name on statements ("Program management"). Up to 60 chars. |
| `position` | integer NOT NULL DEFAULT 0 | |
| `created_at`, `updated_at` | | Lines and rules change only while their version is a draft (domain check, 4.4). |

Uniqueness: UNIQUE (version_id, kind, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)).

#### 2.2.9 `pm.program_one_time_charges` (setup fees and adjustments)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | Its id is the charge's stable key (ref `pmf:<programId>:setup:<id>` or `pmf:<programId>:adj:<id>`). |
| `org_id` | uuid NOT NULL | |
| `program_id` | uuid NOT NULL FK projects ON DELETE CASCADE | |
| `kind` | text NOT NULL | CHECK IN ('setup','adjustment'). |
| `charge_on` | date NOT NULL | The day it posts. Must be open when created, edited or deleted. |
| `amount_cents` | bigint NOT NULL | Setup: CHECK `> 0`. Adjustment: CHECK `<> 0` (negative is a credit). Both `abs <= 10000000000000`. |
| `label` | text NOT NULL | 1 to 80 chars ("Setup fee", "Rush fee", "Credit for 200 bad kits"). |
| `reason` | text NULL | Required for adjustments (CHECK `kind <> 'adjustment' OR reason IS NOT NULL`), up to 500 chars. |
| `variant_id` | uuid NULL FK program_variants ON DELETE SET NULL | Optional, adjustments only. |
| `counts_toward_minimum` | boolean NOT NULL DEFAULT false | Adjustments only (CHECK). "Counts toward minimum". |
| `version`, `created_by`, `created_at`, `updated_at`, `deleted_at` | | |

Index (program_id, charge_on) WHERE deleted_at IS NULL.

#### 2.2.10 `pm.builds` (1 to 1 with a `kind='build'` task)

| Column | Type | Rule |
|---|---|---|
| `task_id` | uuid PK FK `pm.tasks(id)` ON DELETE CASCADE | |
| `org_id` | uuid NOT NULL | |
| `container_id` | uuid NOT NULL FK projects ON DELETE CASCADE | Equals the task's project. |
| `program_id` | uuid NULL FK projects ON DELETE CASCADE | Equals `container_id` when the container is a program, else null (`builds_match_task`). |
| `variant_id` | uuid NULL FK program_variants ON DELETE RESTRICT | Null is allowed ("No variant": it prices at the card default). Always null outside a program (CHECK `program_id IS NOT NULL OR variant_id IS NULL`). |
| `build_date` | date NOT NULL | The planned day. Mirrors `pm.tasks.due_date` and `start_date` (domain keeps all three equal unless a multi day build sets `start_date` earlier). |
| `planned_qty` | numeric(14,3) NOT NULL | CHECK `> 0 AND < 100000000`. |
| `planned_from` | text NOT NULL DEFAULT 'manual' | CHECK IN ('manual','schedule','variant_default','planner','unplanned','split','import','form'). Shown in the drawer ("Planned 120 · from Weekday glove run"). |
| `built_qty` | numeric(14,3) NOT NULL DEFAULT 0 | Cache: sum of live `pm.build_output.qty`. Updated as `built_qty + delta` under a row lock (8.4). |
| `scrap_qty` | numeric(14,3) NOT NULL DEFAULT 0 | Cache of output scrap. |
| `rate_override` | numeric(14,4) NULL | CHECK `>= 0 AND < 1000000`. |
| `rate_override_reason` | text NULL | Required when `rate_override` is set (CHECK), up to 200 chars. |
| `unplanned` | boolean NOT NULL DEFAULT false | Made from the log dialog's "Add a row". |
| `closed_short` | boolean NOT NULL DEFAULT false | Closed below plan on purpose. |
| `close_reason` | text NULL | Required when `closed_short` (CHECK), up to 200 chars. |
| `split_from_id` | uuid NULL FK `pm.builds(task_id)` ON DELETE SET NULL | Set on the build made by "Move the rest to {day}". |
| `first_finished_on` | date NULL | First day the build entered done (trigger, 2.2.1). |
| `finished_on` | date NULL | The batch charge date while done (trigger). |
| `schedule_id` | uuid NULL FK build_schedules ON DELETE SET NULL | |
| `schedule_date` | date NULL | The occurrence date that made it. Never changes, even when the build moves. |
| `occurrence_variant_id` | uuid NULL | The variant the occurrence was made for. Never changes, even when the build's variant changes. |
| `version` | integer NOT NULL DEFAULT 1 | |
| `created_at`, `updated_at` | | |

CHECK `schedule_id IS NULL OR (schedule_date IS NOT NULL AND occurrence_variant_id IS NOT NULL)`.

Indexes: `builds_container_date_idx` (container_id, build_date); `builds_program_variant_date_idx` (program_id, variant_id, build_date) WHERE program_id IS NOT NULL; `builds_open_idx` (org_id, build_date) WHERE finished_on IS NULL; `builds_schedule_occurrence_key` UNIQUE (schedule_id, schedule_date, occurrence_variant_id) WHERE schedule_id IS NOT NULL. A build the person deleted keeps its key, so it is never generated again. `regenerateFuture` (4.2) frees the key on purpose by setting `schedule_id`, `schedule_date` and `occurrence_variant_id` to null on the rows it removes, in the same transaction, before it generates again.

#### 2.2.11 `pm.build_output` (one row per build per work date)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `container_id` | uuid NOT NULL FK projects ON DELETE CASCADE | |
| `program_id` | uuid NULL FK projects ON DELETE CASCADE | Copy of the build's program. |
| `build_id` | uuid NOT NULL FK `pm.builds(task_id)` ON DELETE CASCADE | |
| `variant_id` | uuid NULL | Snapshot of the build's variant when written; updated with the build on open days. |
| `work_date` | date NOT NULL | The accrual date. Never in the future (domain: `work_date <= today` in program time zone). |
| `qty` | numeric(14,3) NOT NULL | CHECK `>= 0 AND < 100000000`. The day's total good units. |
| `scrap_qty` | numeric(14,3) NOT NULL DEFAULT 0 | CHECK `>= 0`. Not billed. Shown in Pulse as `units_scrap`. |
| `unit_price` | numeric(14,4) NOT NULL | Concrete snapshot of the resolved price; `0.0000` for source `none`; the job price read at write time for source `job`. |
| `price_source` | text NOT NULL | CHECK IN ('build','variant','card','job','none'). |
| `card_version_id` | uuid NULL | The version used. |
| `revenue_cents` | bigint NOT NULL DEFAULT 0 | `accrueDay(qty, unit_price)`. |
| `posting` | text NOT NULL | CHECK IN ('program','program_job','build_job','unbilled'). Snapshot of `postingTarget`. |
| `pulse_job_id` | uuid NULL | Set when posting is a job (CHECK `(posting IN ('program_job','build_job')) = (pulse_job_id IS NOT NULL)`). |
| `source` | text NOT NULL DEFAULT 'manual' | CHECK IN ('manual','scan','import','form'). |
| `note` | text NULL | Up to 500 chars. |
| `entered_by` | uuid NULL | Last person who changed it. |
| `version` | integer NOT NULL DEFAULT 1 | |
| `created_at`, `updated_at`, `deleted_at` | | |

Indexes: `build_output_build_day_key` UNIQUE (build_id, work_date) WHERE deleted_at IS NULL (the target of `INSERT ... ON CONFLICT (build_id, work_date) WHERE deleted_at IS NULL`); `build_output_program_day_idx` (org_id, program_id, work_date) INCLUDE (variant_id, qty, revenue_cents) WHERE deleted_at IS NULL; `build_output_container_day_idx` (org_id, container_id, work_date) WHERE deleted_at IS NULL; `build_output_job_day_idx` (org_id, pulse_job_id, work_date) WHERE pulse_job_id IS NOT NULL AND deleted_at IS NULL.

A row with `qty = 0` and `scrap_qty = 0` is soft deleted instead of kept (domain rule), so "no output" and "no row" mean the same.

#### 2.2.12 `pm.program_ledger` (posted fees, A13)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `program_id` | uuid NOT NULL FK projects ON DELETE CASCADE | |
| `ref` | text NOT NULL | Stable ref (3.6). |
| `kind` | text NOT NULL | CHECK IN ('per_order','per_hour','flat_monthly','setup','adjustment','minimum_top_up'). |
| `charge_date` | date NOT NULL | |
| `month` | date NOT NULL | First day of the charge's month. |
| `cents` | bigint NOT NULL | Signed (adjustment credits are negative). |
| `quantity` | numeric(14,3) NULL | Hours (2 decimals) for per hour; 1 for per batch. |
| `unit_price` | numeric(14,4) NULL | Rate for per hour and per batch. |
| `variant_id`, `build_id`, `version_id`, `line_id`, `one_time_id` | uuid NULL | Where it came from. |
| `label` | text NOT NULL | Statement text ("Batch fee · GLOVE-212"). |
| `counts_toward_minimum` | boolean NOT NULL DEFAULT false | |
| `posting` | text NOT NULL | CHECK IN ('program','program_job'). |
| `pulse_job_id` | uuid NULL | Set when `posting = 'program_job'`. |
| `computed_at` | timestamptz NOT NULL DEFAULT now() | |
| `created_at`, `updated_at`, `deleted_at` | | |

Indexes: `program_ledger_ref_key` UNIQUE (org_id, ref) WHERE deleted_at IS NULL; `program_ledger_program_month_idx` (org_id, program_id, month) WHERE deleted_at IS NULL. No `version` column: only the ledger writer (4.3.2) changes rows, under the program settings lock.

#### 2.2.13 `pm.program_closes` (month close, A9)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `program_id` | uuid NOT NULL FK projects ON DELETE CASCADE | |
| `month` | date NOT NULL | First day of the month. |
| `total_cents` | bigint NOT NULL | Statement total at close. |
| `units` | numeric(14,3) NOT NULL | |
| `checklist` | jsonb NOT NULL | The checklist results at close. |
| `closed_by` | uuid NOT NULL, `closed_at` timestamptz NOT NULL | |
| `reopened_by` | uuid NULL, `reopened_at` timestamptz NULL, `reopen_reason` text NULL | Reason required on reopen (CHECK `reopened_at IS NULL OR reopen_reason IS NOT NULL`). |

UNIQUE (program_id, month) WHERE reopened_at IS NULL. Months close in order (the month before must be closed or before the program start) and only the latest closed month can be reopened, so `locked_through` is always the end of one unbroken closed run.

#### 2.2.14 `pm.build_schedules` and `pm.build_schedule_lines`

`pm.build_schedules`:

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `program_id` | uuid NOT NULL FK projects ON DELETE CASCADE | |
| `name` | text NOT NULL | 1 to 60 chars ("Weekday glove run"). Also the run name. |
| `status` | text NOT NULL DEFAULT 'active' | CHECK IN ('active','paused','ended'). |
| `pattern` | text NOT NULL | CHECK IN ('daily','weekdays','custom_days','every_n_weeks'). `weekdays` follows the program's work days. |
| `days` | smallint[] NOT NULL DEFAULT '{}' | For `custom_days` and `every_n_weeks`. Values 0 to 6. |
| `interval_weeks` | smallint NOT NULL DEFAULT 1 | CHECK 1 to 12. For `every_n_weeks`. |
| `starts_on` | date NOT NULL | First occurrence on or after this date. |
| `ends_on` | date NULL | CHECK `ends_on >= starts_on`. |
| `lead_days` | smallint NOT NULL DEFAULT 7 | CHECK 0 to 60. Builds are made from today through today plus this many days. |
| `skip_holidays` | boolean NOT NULL DEFAULT true | Skips the program's days off. |
| `skip_dates` | date[] NOT NULL DEFAULT '{}' | One off skips. |
| `default_assignee_id` | uuid NULL | |
| `default_status_id` | uuid NULL | Must be a todo status of the program. |
| `generated_through` | date NULL | High water mark. |
| `last_run_at` | timestamptz NULL | |
| `version`, `created_by`, `created_at`, `updated_at`, `deleted_at` | | |

`pm.build_schedule_lines`:

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `schedule_id` | uuid NOT NULL FK build_schedules ON DELETE CASCADE | |
| `variant_id` | uuid NOT NULL FK program_variants ON DELETE CASCADE | |
| `qty` | numeric(14,3) NOT NULL | CHECK `> 0`. |
| `qty_by_weekday` | jsonb NULL | `{"1":"260","6":"120"}`: keys "0" to "6", values qty strings greater than 0. Beats `qty` on the days it lists ("Vary by day"). |
| `assignee_id` | uuid NULL | Beats the schedule default. |
| `position` | integer NOT NULL DEFAULT 0 | |

UNIQUE (schedule_id, variant_id).

Planned qty precedence (shown in the drawer as "Planned 120 · from {source}"): a generated build takes `qtyFor(line, date)` from its schedule line; the planner's "Use default qty" and a new schedule line take the variant's `default_qty`; a typed planner cell or a typed build beats both; an unplanned build takes its built qty.

#### 2.2.15 `pm.wizard_drafts`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `user_id` | uuid NOT NULL FK core.user ON DELETE CASCADE | Drafts are private to their author. |
| `kind` | text NOT NULL | CHECK IN ('program'). |
| `title` | text NOT NULL DEFAULT 'Untitled program' | |
| `step` | smallint NOT NULL DEFAULT 0 | |
| `payload` | jsonb NOT NULL | `ProgramWizardPayload` (4.5), validated by zod on read; an invalid payload is shown as "This draft could not be opened" with Delete. |
| `version`, `created_at`, `updated_at` | | |

Index (org_id, user_id, updated_at DESC). Drafts older than 60 days are deleted lazily by the directory loader.

#### 2.2.16 Drizzle mirror and README

- New file `apps/projects/src/server/db/schema/programs.ts` with `orgCalendar`, `programSettings`, `programAttributes`, `programVariants`, `priceCardVersions`, `priceCardRules`, `priceCardLines`, `programOneTimeCharges`, `builds`, `buildOutput`, `programLedger`, `programCloses`, `buildSchedules`, `buildScheduleLines`, `wizardDrafts`. Exported from `schema/index.ts`.
- `projects.ts`: add `kind: text('kind').$type<ProjectKind>().notNull().default('project')`. `tasks.ts`: add `kind: text('kind').$type<TaskKind>().notNull().default('task')`. `studio.ts` `templates`: add `kind: text('kind').$type<TemplateKind>().notNull().default('project')`. `planning.ts` `savedViews`: add `surface: text('surface').$type<ViewSurface>().notNull().default('work')`. `collaboration.ts` `timeEntries`: add the `time_entries_project_started_idx` index.
- `apps/projects/drizzle/README.md` row: "0006 programs: kind on projects, tasks and templates; saved view surface; workspace calendar; program settings, attributes, variants, price card versions, rules and lines, one time charges, builds, build output, ledger, month closes, build schedules, wizard drafts; notification kind program; time entries project index."

#### 2.2.17 New constants (`apps/projects/src/lib/constants.ts`, each mirrored by a CHECK)

```ts
export const PROJECT_KINDS = ['project', 'program'] as const;
export const TASK_KINDS = ['task', 'build'] as const;
export const TEMPLATE_KINDS = ['project', 'program'] as const;
export const VIEW_SURFACES = ['work', 'programs', 'floor'] as const;
export const PRICE_LINE_KINDS = ['per_unit', 'per_order', 'per_hour', 'flat_monthly', 'monthly_minimum'] as const;
export const LEDGER_KINDS = ['per_order', 'per_hour', 'flat_monthly', 'setup', 'adjustment', 'minimum_top_up'] as const;
export const ONE_TIME_KINDS = ['setup', 'adjustment'] as const;
export const PRICE_SOURCES = ['build', 'variant', 'card', 'job', 'none'] as const;
export const POSTINGS = ['program', 'program_job', 'build_job', 'unbilled'] as const;
export const PLANNED_FROM = ['manual', 'schedule', 'variant_default', 'planner', 'unplanned', 'split', 'import', 'form'] as const;
export const OUTPUT_SOURCES = ['manual', 'scan', 'import', 'form'] as const;
export const SCHEDULE_PATTERNS = ['daily', 'weekdays', 'custom_days', 'every_n_weeks'] as const;
export const SCHEDULE_STATUSES = ['active', 'paused', 'ended'] as const;
export const VARIANT_STATUSES = ['active', 'retired'] as const;
export const REVIEW_STATUSES = ['none', 'waiting', 'sent_back'] as const;
export const HOURLY_TIME_BASES = ['billable', 'all'] as const;
export const UNIT_PRESETS = [
  { singular: 'kit', plural: 'kits' }, { singular: 'order', plural: 'orders' }, { singular: 'unit', plural: 'units' },
  { singular: 'pack', plural: 'packs' }, { singular: 'box', plural: 'boxes' },
] as const;
// NOTIFICATION_KINDS gains 'program'.
```

Labels: `PROGRAM_STATUS_LABELS` maps the shared project statuses to program words: `planning` "Setting up", `active` "Running", `on_hold` "Paused", `completed` "Ended", `archived` "Archived". `PRICE_LINE_LABELS`: `per_unit` "Per {unit}", `per_order` "Per batch", `per_hour` "Per hour", `flat_monthly` "Monthly fee", `monthly_minimum` "Monthly minimum". `LEDGER_LABELS` adds `setup` "Setup fee", `adjustment` "Adjustment", `minimum_top_up` "Minimum top up". `POSTING_LABELS` (shown after "Revenue goes to"): `program` "This program", `program_job` "The program's Pulse job", `build_job` "This build's Pulse job", `unbilled` "Not billed". `PRICE_SOURCE_LABELS` (shown after "Price from"): `build` "Build rate", `variant` "Variant rate", `card` "Card rate", `job` "Job price", `none` "No price". `VERSION_STATE_LABELS`: `draft` "Draft", `scheduled` "Scheduled", `in_force` "In force", `ended` "Ended".

Default program statuses (`DEFAULT_PROGRAM_STATUSES`, inserted by `insertProject` when `kind='program'` instead of `DEFAULT_STATUSES`): Planned (todo, default, gray), Staged (todo, sky), Building (in_progress, blue), Quality check (in_progress, purple), Done (done, green), Cancelled (cancelled, gray). Builds in a project use the project's statuses.

### 2.3 `apps/pulse/drizzle/0015_program_builds.sql`

Every statement is safe to run again; constraint changes use the 0014 `DO` block style. Shown compact here; the file splits each statement with `--> statement-breakpoint`.

```sql
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "unit_price" numeric(14,4);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_entries_unit_price_check') THEN
  ALTER TABLE "pulse"."production_entries" ADD CONSTRAINT "production_entries_unit_price_check" CHECK ("unit_price" IS NULL OR ("unit_price" >= 0 AND "unit_price" < 1000000)); END IF; END $$;
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "material_cost_per_unit" numeric(14,4);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_entries_material_cost_check') THEN
  ALTER TABLE "pulse"."production_entries" ADD CONSTRAINT "production_entries_material_cost_check" CHECK ("material_cost_per_unit" IS NULL OR ("material_cost_per_unit" >= 0 AND "material_cost_per_unit" < 1000000)); END IF; END $$;
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "pm_program_id" uuid;
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "pm_variant_id" uuid;
CREATE INDEX IF NOT EXISTS "production_entries_variant_idx" ON "pulse"."production_entries" ("org_id","job_id","pm_variant_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "production_entries_program_day_idx" ON "pulse"."production_entries" ("org_id","pm_program_id","work_date") WHERE "pm_program_id" IS NOT NULL AND "deleted_at" IS NULL;
ALTER TABLE "pulse"."revenue_entries" ADD COLUMN IF NOT EXISTS "pm_program_id" uuid;
ALTER TABLE "pulse"."revenue_entries" ADD COLUMN IF NOT EXISTS "pm_variant_id" uuid;
CREATE INDEX IF NOT EXISTS "revenue_entries_program_idx" ON "pulse"."revenue_entries" ("org_id","pm_program_id","revenue_date") WHERE "pm_program_id" IS NOT NULL AND "deleted_at" IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_links_target_type_check') THEN
    ALTER TABLE "pulse"."job_links" DROP CONSTRAINT "job_links_target_type_check"; END IF;
  ALTER TABLE "pulse"."job_links" ADD CONSTRAINT "job_links_target_type_check" CHECK ("target_type" IN ('crm_deal','crm_account','wms_work_order','wms_shipment_order','wms_client','pm_project','pm_task','pm_program','pm_build'));
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "job_links_program_key" ON "pulse"."job_links" ("org_id","target_id") WHERE "target_type" = 'pm_program';
CREATE UNIQUE INDEX IF NOT EXISTS "job_links_one_program_per_job" ON "pulse"."job_links" ("org_id","job_id") WHERE "target_type" = 'pm_program';
CREATE UNIQUE INDEX IF NOT EXISTS "job_links_build_key" ON "pulse"."job_links" ("org_id","target_id") WHERE "target_type" = 'pm_build';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bridge_events_kind_check') THEN
    ALTER TABLE "pulse"."bridge_events" DROP CONSTRAINT "bridge_events_kind_check"; END IF;
  ALTER TABLE "pulse"."bridge_events" ADD CONSTRAINT "bridge_events_kind_check" CHECK ("kind" IN ('wms_work_order_changed','crm_deal_stage_changed','pm_time_logged','pm_program_changed'));
END $$;
DO $$
DECLARE org_setting text := 'nullif(current_setting(''pulse.org_id'', true), '''')::uuid';
BEGIN
  IF to_regclass('core.record_links') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    RAISE NOTICE 'pulse 0015: record_links grant skipped (table or role missing).'; RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON core.record_links TO pulse_app;
  DROP POLICY IF EXISTS "pulse_app_own_org_links" ON core.record_links;
  EXECUTE 'CREATE POLICY "pulse_app_own_org_links" ON core.record_links AS PERMISSIVE FOR ALL TO pulse_app USING ("org_id" = ' || org_setting || ') WITH CHECK ("org_id" = ' || org_setting || ')';
END $$;
```

`job_links_project_time_key` is unchanged: program labor is written by `syncPrograms` with its own refs (6.1), never by the project day import. No new pulse table, so no new pulse RLS policy. Change together (one PR, layer L1): `BRIDGE_EVENT_KINDS` (`packages/pulse-bridge/src/types.ts:200`), `PULSE_RECORD_TYPES` (types.ts:65, add `pm_program`, `pm_build`), `LINK_TARGET_TYPES` (`apps/pulse/src/lib/constants.ts:114`), the link message map (`_shared.ts:113`), and the Drizzle mirror in `apps/pulse/src/server/db/schema`. `EVENT_SOURCE` (`apps/pulse/src/server/domain/sync.ts:618`, `pm_program_changed: 'projects'`) changes in L5 with the sync step. README row: "0015 program builds: per row unit price and material snapshots, program and variant tags, program and build job links (one program per job), program change events, record links access for the app role."

Recalc change (`apps/pulse/src/server/domain/recalc.ts` restampProduction, around line 96; L5). Rows that come from builds use their own snapshot only; every other row keeps today's behavior:

```sql
WHEN 'per_unit' THEN round(src.units_good * (CASE WHEN src.source = 'projects' AND src.source_ref LIKE 'pmb:%' THEN src.unit_price ELSE COALESCE(src.unit_price, pr.unit_price, 0) END) * 100)::bigint
...
round((src.units_good + src.units_scrap) * COALESCE(src.material_cost_per_unit, pr.material_cost_per_unit, 0) * 100)::bigint AS std_mat,
round(src.units_scrap * COALESCE(src.material_cost_per_unit, pr.material_cost_per_unit, 0) * 100)::bigint AS std_scrap
```

Rows typed by people keep `unit_price` null, so their behavior does not change. A `pmb:` row always carries a concrete `unit_price` (M4), so a later job price change in Pulse never moves it; Projects updates those rows on open days instead (4.9 step 5).

---

## 3. Shared engine: `@kitstak/programs-engine`

Path `packages/programs-engine`. Pure TypeScript, zero runtime dependencies, no drizzle, no DB, no `Date.now()` inside math (callers pass `asOf`). Safe in the browser and on the server. Consumers: Projects (all program money and units), Pulse (sync writes and per variant reads), CRM (month to date in deal panels, through pm-bridge), WMS (planned demand per kit, through pm-bridge).

### 3.1 Package layout

```
packages/programs-engine/
  package.json        name @kitstak/programs-engine, private, version 0.1.0, type module
                      exports: "." ./src/index.ts, "./money" ./src/money.ts, "./calendar" ./src/calendar.ts,
                      "./price" ./src/price.ts, "./accrual" ./src/accrual.ts, "./month" ./src/month.ts,
                      "./forecast" ./src/forecast.ts, "./rollup" ./src/rollup.ts, "./variants" ./src/variants.ts,
                      "./schedule" ./src/schedule.ts, "./runs" ./src/runs.ts, "./import" ./src/import.ts,
                      "./projection" ./src/projection.ts, "./deal" ./src/deal.ts, "./format" ./src/format.ts,
                      "./barcode" ./src/barcode.ts, "./types" ./src/types.ts
                      scripts: typecheck (tsc --noEmit), test (vitest run), test:watch
                      devDependencies: @kitstak/config workspace:*, @types/node ^22.10.0, typescript ^5, vitest ^5.1.0
  tsconfig.json       { "extends": "@kitstak/config/tsconfig/base.json", "compilerOptions": { "types": ["node"] }, "include": ["src/**/*.ts", "vitest.config.mts"] }
  vitest.config.mts   defineConfig({ test: { ...sharedTestOptions, environment: 'node', include: ['src/**/*.test.ts'] } })
  README.md           rules table, function table, "Using it in an app", parity rule
  src/*.ts            modules below, each with a *.test.ts beside it
```

Add a row to `packages/README.md`. Consumers add `"@kitstak/programs-engine": "workspace:*"`, add it to `transpilePackages` in `next.config.ts` (projects:45, pulse:45, crm:31, wms:109), and run `pnpm install`.

`money.ts` is MOVED verbatim from `apps/pulse/src/lib/money.ts` (with `money.test.ts`). `apps/pulse/src/lib/money.ts` becomes `export * from '@kitstak/programs-engine/money';` and its test file stays and keeps passing against the re-export. `calendar.ts` is MOVED from `apps/pulse/src/lib/profit/calendar.ts` the same way (Pulse re-exports; `IsoDate` and `SharedSpread` types move to engine `types.ts` and Pulse `profit/types.ts` re-exports them). `perUnitRevenue`, `hourlyRevenue` and `priceFor` move to `accrual.ts` and `price.ts`; `apps/pulse/src/lib/profit/revenue.ts` re-exports them. ES2017 target: use `BigInt(n)`, never `10n`.

### 3.2 Types (`types.ts`)

```ts
export type IsoDate = string;   // YYYY-MM-DD
export type IsoMonth = string;  // YYYY-MM
export type Decimal = number | string;
export type Cents = bigint;
export type PriceLineKind = 'per_unit' | 'per_order' | 'per_hour' | 'flat_monthly' | 'monthly_minimum';
export type LedgerKind = 'per_order' | 'per_hour' | 'flat_monthly' | 'setup' | 'adjustment' | 'minimum_top_up';
export type ChargeKind = 'per_unit' | LedgerKind;
export type PriceSource = 'build' | 'variant' | 'card' | 'job' | 'none';
export type Posting = 'program' | 'program_job' | 'build_job' | 'unbilled';

export interface CardLine {
  readonly id: string;
  readonly kind: PriceLineKind;
  readonly variantId: string | null;
  readonly ruleId: string | null;
  readonly unitPrice: string | null;   // per_unit, 4 decimals
  readonly rateCents: number | null;   // per_hour
  readonly amountCents: string | null; // per_order, flat_monthly, monthly_minimum
  readonly prorate: boolean;
  readonly chargeWhilePaused: boolean;
  readonly label: string | null;
}
export interface RateRule { readonly id: string; readonly attributeId: string; readonly valueId: string; readonly op: 'add' | 'set'; readonly amount: string }
export interface CardVersion { readonly id: string; readonly number: number | null; readonly effectiveFrom: IsoDate; readonly lines: readonly CardLine[]; readonly rules: readonly RateRule[] }
export interface JobPriceRow { readonly effectiveFrom: IsoDate; readonly unitPrice: string | null }
export interface DateRange { readonly from: IsoDate; readonly to: IsoDate | null }
export interface ProgramCalendar {
  readonly timezone: string;
  readonly workingDays: readonly number[];   // already resolved from the workspace calendar or the program
  readonly daysOff: readonly IsoDate[];      // workspace holidays (when used) plus program extra days off
  readonly extraWorkDays: readonly IsoDate[];
  readonly activeFrom: IsoDate | null;       // pm.projects.start_date
  readonly activeTo: IsoDate | null;         // pm.projects.due_date
  readonly paused: readonly DateRange[];
}
export interface OutputRow {
  readonly buildId: string;
  readonly variantId: string | null;
  readonly workDate: IsoDate;
  readonly qty: string;                // 3 decimals
  readonly scrapQty: string;
  readonly unitPrice: string;          // concrete, 4 decimals
  readonly priceSource: PriceSource;
  readonly versionId: string | null;
  readonly revenueCents: string;       // snapshot
  readonly posting: Posting;
  readonly pulseJobId: string | null;
}
export interface FinishedBuild { readonly buildId: string; readonly buildKey: string; readonly variantId: string | null; readonly finishedOn: IsoDate; readonly builtQty: string }
export interface TimeDay { readonly workDate: IsoDate; readonly buildId: string | null; readonly variantId: string | null; readonly minutes: number }
export interface OneTimeCharge { readonly id: string; readonly kind: 'setup' | 'adjustment'; readonly chargeOn: IsoDate; readonly amountCents: string; readonly label: string; readonly variantId: string | null; readonly countsTowardMinimum: boolean }
export interface LedgerRow { readonly ref: string; readonly kind: LedgerKind; readonly chargeDate: IsoDate; readonly cents: Cents; readonly quantity: string | null; readonly unitPrice: string | null; readonly variantId: string | null; readonly buildId: string | null; readonly versionId: string | null; readonly lineId: string | null; readonly oneTimeId: string | null; readonly label: string; readonly countsTowardMinimum: boolean }
```

`daysOff` and `extraWorkDays` are merged by the domain (`programCalendar(ctx, program)`, 4.2) from `pm.org_calendar` and `pm.program_settings`; the engine never reads settings. `isWorkDay(calendar, date)` = `extraWorkDays` has it, or (weekday in `workingDays` and not in `daysOff`).

### 3.3 Price resolution (`price.ts`)

```ts
export function priceFor<T extends { effectiveFrom: IsoDate }>(rows: readonly T[], workDate: IsoDate): T | null; // moved from Pulse, unchanged
export function versionFor(versions: readonly CardVersion[], workDate: IsoDate): CardVersion | null; // = priceFor over published versions
export interface ResolveInput {
  readonly workDate: IsoDate;
  readonly variantId: string | null;
  readonly buildOverride: string | null;
  readonly versions: readonly CardVersion[];   // published only; [] for a build outside a program
  readonly jobPrices?: readonly JobPriceRow[]; // only when the posting is a job
}
export interface ResolvedPrice { readonly unitPrice: string; readonly source: PriceSource; readonly versionId: string | null; readonly lineId: string | null }
export function resolveUnitPrice(input: ResolveInput): ResolvedPrice;
export function resolveOrderCharge(versions: readonly CardVersion[], variantId: string | null, finishedOn: IsoDate): { amountCents: Cents; versionId: string; lineId: string } | null;
export function resolveHourRate(versions: readonly CardVersion[], workDate: IsoDate): { rateCents: number; versionId: string; lineId: string } | null;
export function compileRateRules(input: { defaultUnitPrice: string | null; rules: readonly RateRule[]; variants: readonly { id: string; attributes: Readonly<Record<string, string>> }[]; handLines: readonly { variantId: string; unitPrice: string }[] }):
  { lines: readonly { variantId: string; unitPrice: string; ruleId: string }[]; conflicts: readonly { variantId: string; ruleIds: readonly string[] }[] };
export function cardSummary(version: CardVersion | null, unitSingular: string): string; // "$1.95 per kit · $1,500 monthly · $30,000 minimum"
```

`resolveUnitPrice` algorithm, first match wins:

1. `buildOverride` not null: `{ unitPrice: normalize4(buildOverride), source: 'build', versionId: null, lineId: null }`.
2. `v = versionFor(versions, workDate)`. If `v` has a `per_unit` line with `variantId === input.variantId` (and `variantId` not null): source `variant`.
3. If `v` has a `per_unit` line with `variantId === null`: source `card`.
4. If `jobPrices` given and `priceFor(jobPrices, workDate)?.unitPrice` not null: source `job`, `unitPrice` set to that price, `versionId: null`.
5. Else `{ unitPrice: '0.0000', source: 'none', versionId: null, lineId: null }`.

`normalize4` renders 4 decimals with `fromScaled(priceToScaled(x), 4)` so equal prices compare equal as strings. `resolveOrderCharge` uses the same variant then default order of `per_order` lines on the version in force on `finishedOn`. `resolveHourRate` uses the version in force on the work date.

`compileRateRules`: for each variant with no hand typed line: collect the rules whose `(attributeId, valueId)` matches the variant's attributes. No match: no line (the variant uses the card default). One or more `set` rules: two `set` rules are a conflict ("Two rules set a price for XL Yellow."); one `set` gives its amount plus the sum of matching `add` rules. Only `add` rules: `defaultUnitPrice + sum(add)`; with no default rate, `add` rules are a conflict ("Add a card rate before you add to it."). A result below 0 is a conflict ("This rule makes the XL Yellow rate less than $0."). The line's `ruleId` is the first matching rule by position. All math in scaled 4 decimal bigint.

### 3.4 Accrual and posting (`accrual.ts`)

```ts
export function perUnitRevenue(qty: Decimal, unitPrice: Decimal | null | undefined): Cents; // moved from Pulse
export function hourlyRevenue(hours: Decimal, rateCents: CentsLike | null | undefined): Cents; // moved from Pulse
export function accrueDay(qty: Decimal, unitPrice: Decimal | null): Cents; // = perUnitRevenue; 0 when price is null
export function minutesToHours(minutes: number): string; // fromScaled(divRound(BigInt(minutes) * BigInt(100), BigInt(60)), 2), matches Pulse projectTimeByDay rounding
export function postingTarget(input: { buildJob: LiveJob | null; programId: string | null; programJob: LiveJob | null }):
  | { posting: 'build_job'; jobId: string }
  | { posting: 'program_job'; jobId: string }
  | { posting: 'program'; jobId: null }
  | { posting: 'unbilled'; jobId: null };
export interface LiveJob { readonly id: string; readonly live: boolean } // live = Pulse job exists and is not deleted (getJobFacts)
export function canLinkJob(job: { pricingModel: 'per_unit' | 'fixed' | 'hourly'; kind: 'one_time' | 'ongoing'; feedsFromWorkOrder: boolean; hasTypedUnits: boolean; programId: string | null }, target: { kind: 'program' | 'build'; programId: string | null }):
  { ok: true } | { ok: false; reason: 'not_per_unit' | 'not_ongoing' | 'work_order_fed' | 'has_typed_units' | 'other_program' };
```

`postingTarget`: a live build job beats a live program job beats the program; with no program and no live build job the result is `unbilled`. A job that is not live counts as no job (and the domain raises `pulse_out_of_sync`). `canLinkJob`: a program job must be `per_unit` and `ongoing`, not linked to a WMS work order, have no typed units in open months, and not take revenue from another program; a build job must be `per_unit`, not linked to a work order, have no typed units in open months, and not belong to a different program than the build's. Reasons map to UI copy: "Only per unit jobs can take build output.", "Programs link to ongoing jobs.", "This job gets units from a WMS work order, so builds cannot feed it.", "This job already has units typed in an open month. Move them to an adjustment in Pulse first.", "This job already takes revenue from another program."

### 3.5 Month charges (`month.ts`)

```ts
export interface MonthInput {
  readonly programId: string;
  readonly month: IsoMonth;
  readonly asOf: IsoDate;                       // today in the program time zone
  readonly calendar: ProgramCalendar;
  readonly versions: readonly CardVersion[];    // published only
  readonly output: readonly OutputRow[];        // live rows of live builds with work_date in the month
  readonly finished: readonly FinishedBuild[];  // live, not cancelled builds with finished_on in the month
  readonly time: readonly TimeDay[];            // minutes per day per task in the program time zone (filters in 3.14)
  readonly oneTime: readonly OneTimeCharge[];   // live setup fees and adjustments with charge_on in the month
}
export interface Charge {
  readonly ref: string;          // stable, 3.6
  readonly kind: ChargeKind;
  readonly date: IsoDate;
  readonly cents: Cents;
  readonly quantity: string | null;   // units, hours or null
  readonly unitPrice: string | null;  // dollars, 4 decimals
  readonly variantId: string | null;
  readonly buildId: string | null;
  readonly versionId: string | null;
  readonly lineId: string | null;
  readonly oneTimeId: string | null;
  readonly label: string;             // statement text
  readonly countsTowardMinimum: boolean;
  readonly posted: boolean;           // false only for the current month's minimum preview
}
export interface MonthResult {
  readonly month: IsoMonth;
  readonly units: string;                 // sum of qty
  readonly work: { readonly perUnitCents: Cents; readonly perOrderCents: Cents; readonly perHourCents: Cents; readonly totalCents: Cents };
  readonly fixed: { readonly monthlyFeeCents: Cents; readonly setupCents: Cents; readonly totalCents: Cents };
  readonly adjustments: { readonly totalCents: Cents; readonly towardMinimumCents: Cents };
  readonly minimum: { readonly minimumCents: Cents; readonly gapSoFarCents: Cents; readonly topUpCents: Cents; readonly status: 'none' | 'met' | 'short' | 'pending' };
  readonly totalCents: Cents;             // work + fixed + adjustments + posted top up
  readonly charges: readonly Charge[];    // every line item, per unit charges grouped by build day
  readonly byVariant: readonly VariantRollup[];
  readonly byDay: readonly DayRollup[];
  readonly unpricedUnits: string;         // units with source none
}
export function monthCharges(input: MonthInput): MonthResult;
export function ledgerRows(result: MonthResult): LedgerRow[]; // posted charges except per unit
export function fixedLineForMonth(input: { month: IsoMonth; calendar: ProgramCalendar; versions: readonly CardVersion[]; kind: 'flat_monthly' | 'monthly_minimum' }): { cents: Cents; segments: readonly { versionId: string; lineId: string; from: IsoDate; to: IsoDate; cents: Cents }[] };
```

Exact math (all `bigint` cents, one rounding per step):

1. Active days. `D = daysInMonth`. `firstActive = max(monthStart, activeFrom ?? monthStart)`, `lastActive = min(monthEnd, activeTo ?? monthEnd)`. If `firstActive > lastActive` the month has no fixed charges. `A` = the count of active days.
2. Per unit. For each output row: `cents = BigInt(row.revenueCents)` (the snapshot). A charge per row with ref `pmb:<buildId>:<workDate>`, kind `per_unit`, quantity `row.qty`, unitPrice `row.unitPrice`. `perUnitCents = sum`. A helper `accrueRow(row) = accrueDay(row.qty, row.unitPrice)` is asserted equal to the snapshot in tests and in the Pulse parity check.
3. Per batch. For each finished build with `builtQty > 0`: `resolveOrderCharge(versions, variantId, finishedOn)`; if found, a charge `pmf:<programId>:order:<buildId>` dated `finishedOn`, label "Batch fee · {buildKey}" (or the line's own label plus the key), quantity `1`.
4. Per hour. Group `time` by work date. For each day with total minutes greater than 0: `hours = minutesToHours(dayMinutes)` (rounded once per day), `rate = resolveHourRate(versions, workDate)`; no rate means no charge. `cents = mulHoursRate(hours, rate.rateCents)`. One charge per day: ref `pmf:<programId>:hours:<workDate>`, quantity the day's hours, unitPrice `rate/100` with 4 decimals. For the by variant rollup, split the day's cents over variants (null is program level) with `money.allocate` (largest remainder) weighted by minutes, so the split adds back exactly.
5. Monthly fee. `fixedLineForMonth(kind 'flat_monthly')`: build the version segments of the active range (contiguous runs of active days where the same version is in force and has the line). When the line has `chargeWhilePaused = false`, paused days are removed from the segment and from `A` for that line. Each segment `s` with `d_s` days and amount `a_s` contributes `divRound(a_s * d_s, D)` when its line has `prorate = true`, and `divRound(a_s * d_s, A)` when `prorate = false` (a whole month split by days across versions). So one version all month gives `a`; a mid month change splits by days; a program that starts on the 15th with prorate on pays its share of the month, with prorate off the full amount. Sum to `monthlyFeeCents`. One charge `pmf:<programId>:monthly:<YYYY-MM>` dated `firstActive`, posted only when `asOf >= firstActive`.
6. One time charges. Each live one time charge with `chargeOn <= asOf` (and inside the month) makes a charge: setup `pmf:<programId>:setup:<id>` (kind `setup`, counts in `fixed.setupCents`), adjustment `pmf:<programId>:adj:<id>` (kind `adjustment`, signed, `countsTowardMinimum` copied). The id is the charge row's own id, so it is charged once ever whatever the card does.
7. Minimum. `minimumCents = fixedLineForMonth(kind 'monthly_minimum').cents`. `forMinimum = perUnit + perOrder + perHour + adjustments.towardMinimumCents`. `gapSoFarCents = max(0, minimumCents - forMinimum)`. If `asOf > monthEnd`: `topUpCents = gapSoFarCents`, status `met` when 0 else `short`, and a posted charge `pmf:<programId>:minimum:<YYYY-MM>` dated `lastActive`, kind `minimum_top_up`, label "Minimum top up", when greater than 0. Else `topUpCents = 0`, status `pending`, and an unposted preview charge. No `monthly_minimum` line: status `none`.
8. `totalCents = work.totalCents + fixed.totalCents + adjustments.totalCents + topUpCents`.

Only charges dated on or before `asOf` are posted, except per unit rows, which are always on or before `asOf` by the domain rule. `ledgerRows` returns the posted charges of steps 3 to 7.

### 3.6 Stable refs (shared by the ledger, statements and Pulse rows)

| Ref | Stored in | Where Pulse writes it | Kind |
|---|---|---|---|
| `pmb:<buildId>:<YYYY-MM-DD>` | `pm.build_output` | `production_entries` (source `projects`, shift `projects`): units, scrap, unit price, and the build's labor hours and headcount for that day | per unit |
| `pmf:<programId>:order:<buildId>` | ledger | `revenue_entries` kind `fee` | per batch |
| `pmf:<programId>:hours:<YYYY-MM-DD>` | ledger | `revenue_entries` kind `fee`, quantity = hours, unit_price = rate | per hour |
| `pmf:<programId>:monthly:<YYYY-MM>` | ledger | `revenue_entries` kind `fee` | monthly fee |
| `pmf:<programId>:setup:<chargeId>` | ledger | `revenue_entries` kind `fee` | setup fee |
| `pmf:<programId>:adj:<chargeId>` | ledger | `revenue_entries` kind `adjustment` | adjustment |
| `pmf:<programId>:minimum:<YYYY-MM>` | ledger | `revenue_entries` kind `adjustment` | minimum top up |
| `pmt:<programId>:<taskId>:<YYYY-MM-DD>` | none (from time) | `production_entries` hours only, shift `projects_time`, `pm_task_id` = the prep task (opt in per task) | labor |
| `pmt:<programId>:program:<YYYY-MM-DD>` | none (from time) | `production_entries` hours only, shift `projects_time`, `pm_task_id` null (prep task time not opted in) | labor |

None of these start with `pm:`, so `removeGoneProjectTime` (which matches `pm:<projectId>:`) never touches them.

### 3.7 Rollups (`rollup.ts`)

```ts
export interface VariantRollup { readonly variantId: string | null; readonly units: string; readonly builds: number; readonly perUnitCents: Cents; readonly perOrderCents: Cents; readonly perHourCents: Cents; readonly totalCents: Cents; readonly avgUnitPrice: string | null }
export interface DayRollup { readonly date: IsoDate; readonly units: string; readonly workCents: Cents; readonly feeCents: Cents; readonly cumulativeCents: Cents; readonly plannedUnits: string }
export function rollupByVariant(result: Omit<MonthResult, 'byVariant' | 'byDay'>): VariantRollup[]; // fixed lines, one time charges and top up excluded; a null variant row holds program level hours
export function rollupByDay(result: Omit<MonthResult, 'byVariant' | 'byDay'>, planned: readonly { date: IsoDate; qty: string }[]): DayRollup[]; // every calendar day of the month through month end
export function rangeRollup(months: readonly MonthResult[]): { units: string; totalCents: Cents; workCents: Cents; fixedCents: Cents; adjustmentCents: Cents; topUpCents: Cents };
export function programHeadline(input: { months: readonly MonthResult[] }): { revenueCents: Cents; units: string };
```

Invariants (tested): `sum(byVariant.totalCents) + fixed.totalCents + adjustments.totalCents + topUpCents === totalCents`; `sum(byDay.workCents + feeCents) === totalCents` when the month is over; `avgUnitPrice = fromScaled(divRound(perUnitCents * BigInt(100000), unitsScaled3), 4)` (cents times 10^5 over thousandths of a unit gives price scaled by 10^4), null when units are 0.

### 3.8 Forecast and health (`forecast.ts`)

```ts
export interface ForecastInput {
  readonly month: IsoMonth;
  readonly asOf: IsoDate;
  readonly calendar: ProgramCalendar;
  readonly versions: readonly CardVersion[];
  readonly result: MonthResult;                              // actuals through asOf
  readonly trailingDaily: readonly { date: IsoDate; workCents: Cents; units: string }[]; // last 20 work days before asOf (may cross months)
  readonly planned: readonly { buildId: string; date: IsoDate; remainingQty: string; unitPrice: string; orderCents: Cents | null }[]; // open builds dated asOf to month end
  readonly targetCents: Cents | null;
}
export interface ForecastResult {
  readonly actualCents: Cents;
  readonly recentCents: Cents;          // "Based on recent days"
  readonly plannedCents: Cents;         // "Based on planned builds"
  readonly forecastCents: Cents;        // the chosen one
  readonly method: 'planned' | 'recent';
  readonly remainingWorkDays: number;
  readonly avgDailyWorkCents: Cents;
  readonly projectedGapCents: Cents;    // max(0, minimum - projected work charges for minimum)
  readonly targetGapCents: Cents | null;
  readonly targetBp: number | null;     // forecast / target in basis points ("105% of target")
}
export function forecastMonth(input: ForecastInput): ForecastResult;
export type Health = 'on_track' | 'at_risk' | 'off_track';
export function programHealth(input: { targetBp: number | null; dailyTargetUnits: string | null; recentUnitsPerDay: string | null; lastWorkDays: readonly { planned: string; built: string }[] }): { health: Health; basis: 'money_target' | 'unit_target' | 'plan' } | null;
```

Math:

- `remainingWorkDays` = work days strictly after `asOf` through month end (`isWorkDay`, inside the active range, outside paused ranges).
- `avgDailyWorkCents` = `divRound(sum(trailingDaily.workCents), n)` over the last `n = min(10, available)` work days before `asOf` inside the active range. 0 when `n = 0`.
- Today remainder: if `asOf` is a work day, `todayRemainder = max(0, avg - todayWork)`, else 0.
- `recentWork = actualWork + todayRemainder + avg * remainingWorkDays`.
- `plannedWork = actualWork + sum(accrueDay(remainingQty, unitPrice) + (orderCents ?? 0))` over `planned`.
- `method = 'planned'` when the planned builds cover at least 80 percent of the remaining work days (a day is covered when it has at least one open build), else `recent`. With 0 remaining work days, `planned` when today has open builds, else `recent`.
- For both: `projectedWork`, then `projectedTopUp = max(0, minimumCents - (projectedWork + adjustments.towardMinimumCents))`, and `fixedForMonth` = `fixedLineForMonth('flat_monthly')` for the whole month plus setup fees and adjustments dated in the month.
- `forecastCents = projectedWork + fixedForMonth + projectedTopUp` for the chosen method; `recentCents` and `plannedCents` are both returned.
- `targetBp = ratioBp(forecastCents, targetCents)`.
- `programHealth`, first basis that has data wins: money target (`targetBp`): on track at 10000 or more, at risk 9000 to 9999, off track below 9000; unit target (`recentUnitsPerDay / dailyTargetUnits`, same bands); plan (sum built over sum planned for the last 5 work days that had builds: on track at 95 percent or more, at risk 85 to 94, off track below 85). Null when none has data. The UI tip says which basis was used ("From the money target", "From the daily unit target", "From planned vs built, last 5 work days").

### 3.9 Variants and imports (`variants.ts`, `import.ts`)

```ts
export interface AttributeAxis { readonly id: string; readonly name: string; readonly values: readonly { id: string; label: string; code: string }[] }
export interface GeneratedVariant { readonly comboKey: string; readonly attributes: Readonly<Record<string, string>>; readonly name: string; readonly key: string; readonly sku: string | null }
export function cartesian(axes: readonly AttributeAxis[]): GeneratedVariant[]; // order: first axis outer, value order kept
export function applyPattern(pattern: string, axes: readonly AttributeAxis[], attributes: Readonly<Record<string, string>>, extra?: { program?: string }): string;
export function generateVariants(input: { axes: readonly AttributeAxis[]; namePattern: string; keyPattern: string; skuPattern: string | null; programKey: string }): GeneratedVariant[];
export function findConflicts(generated: readonly GeneratedVariant[], existing: readonly { key: string; name: string; sku: string | null; attributes: Record<string, string> }[]):
  readonly { comboKey: string; field: 'key' | 'name' | 'sku' | 'combo'; with: string }[];
export function suggestCode(label: string, taken: ReadonlySet<string>): string;
export function inferAxes(input: { text: string; separator?: string }): {
  mode: 'columns' | 'sku';
  axes: readonly { name: string; values: readonly { label: string; code: string }[] }[];
  rows: readonly { raw: string; attributes: Readonly<Record<string, string>>; sku: string | null; name: string | null; qty: string | null; rate: string | null }[];
  unmatched: readonly { line: number; raw: string; why: string }[];
};
// import.ts
export function parsePlanPaste(input: { text: string; variants: readonly VariantMatch[]; dates: readonly IsoDate[] }): { cells: readonly { variantId: string; date: IsoDate; qty: string }[]; unmatched: readonly { line: number; raw: string; why: string }[] };
export function parseOutputCsv(input: { text: string; variants: readonly VariantMatch[] }): { rows: readonly { workDate: IsoDate; variantId: string; qty: string; scrapQty: string }[]; unmatched: readonly { line: number; raw: string; why: string }[] };
export function parsePlanCsv(input: { text: string; variants: readonly VariantMatch[] }): { rows: readonly { buildDate: IsoDate; variantId: string; qty: string }[]; unmatched: readonly { line: number; raw: string; why: string }[] };
export interface VariantMatch { readonly id: string; readonly key: string; readonly name: string; readonly sku: string | null }
export function matchVariant(token: string, variants: readonly VariantMatch[]): VariantMatch | null; // exact SKU, then key, then name (case and space insensitive)
```

`suggestCode`: known words table first (Small S, Medium M, Large L, Extra large or X-Large XL, XXL, Black BLK, White WHT, Brown BRN, Yellow YLW, Red RED, Blue BLU, Green GRN, Gray GRY, Navy NVY, Pink PNK, Orange ORG, Purple PRP), labels of 3 or fewer letters as typed, else the first 3 letters; upper case; a digit is added until unique.

Pattern tokens: `{AttrName}` (value label), `{AttrName.code}` (value code), `{program}` (program key). Matching of `AttrName` is case insensitive. Defaults: name `{Size} {Color}`, key `{Size.code}-{Color.code}`, SKU `{program}-{Size.code}-{Color.code}`. Output keys and SKUs are upper cased, spaces become `-`, characters outside `[A-Z0-9-]` are dropped, repeated `-` collapse. Max 200 combinations (the UI blocks above that with "That makes {n} variants. The limit is 200.").

`inferAxes`:

- Columns mode (the text has tabs or commas on most lines): the first row is a header when no cell in it looks like a number or a SKU of the others. Columns named (case insensitive) "SKU", "Name", "Qty" or "Default qty", "Rate" or "Price" fill those fields; every other column is an attribute axis named by its header ("Size", "Color"; no header: "Attribute 1"). Values are trimmed, de duplicated case insensitive in first seen order, and coded with `suggestCode`.
- SKU mode (one token per line): split each SKU by the separator (given, else the most common of `-`, `_`, `/`, space). A leading part shared by every line is the program prefix and dropped. Every remaining position is an axis ("Part 1", "Part 2"; the UI asks for names), its values are the codes seen, labels from the known words table reversed (`BRN` becomes Brown, `S` becomes Small) else the code itself. Lines with a different number of parts go to `unmatched` with "This SKU has 4 parts. The others have 3."
- At most 4 axes and 200 rows; more goes to `unmatched` with the reason.

`parsePlanPaste` and `parsePlanCsv` read rows of SKU or variant and columns of dates (header row of dates, any of `2026-11-30`, `11/30`, `Nov 30`, `Mon Nov 30` resolved inside `dates`) or rows of date, variant and qty. `parseOutputCsv` reads columns date, SKU or variant, qty, scrap (scrap optional). All three are pure and report each line they could not read.

### 3.10 Schedule and runs (`schedule.ts`, `runs.ts`)

```ts
export interface ScheduleRule { readonly pattern: 'daily' | 'weekdays' | 'custom_days' | 'every_n_weeks'; readonly days: readonly number[]; readonly intervalWeeks: number; readonly startsOn: IsoDate; readonly endsOn: IsoDate | null; readonly skipHolidays: boolean; readonly skipDates: readonly IsoDate[] }
export interface ScheduleLine { readonly variantId: string; readonly qty: string; readonly qtyByWeekday: Readonly<Record<string, string>> | null }
export function occurrences(rule: ScheduleRule, calendar: ProgramCalendar, from: IsoDate, to: IsoDate): IsoDate[]; // inclusive, sorted, unique
export function nextOccurrence(rule: ScheduleRule, calendar: ProgramCalendar, after: IsoDate): IsoDate | null;
export function qtyFor(line: ScheduleLine, date: IsoDate): string; // qtyByWeekday[weekday] ?? qty
export function generationWindow(input: { asOf: IsoDate; leadDays: number; generatedThrough: IsoDate | null; startsOn: IsoDate; endsOn: IsoDate | null }): { from: IsoDate; to: IsoDate } | null;
export function describeRule(rule: ScheduleRule, calendar: ProgramCalendar): string; // "Every weekday", "Mon, Wed and Fri", "Every 2 weeks on Monday"
export function todayIn(timezone: string, now: Date): IsoDate; // Intl.DateTimeFormat('en-CA', { timeZone }) parts
export function nextWorkDay(calendar: ProgramCalendar, after: IsoDate): IsoDate;
export function nextOccurrenceDate(from: IsoDate, recurrence: { frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; weekdays?: readonly number[] }): IsoDate; // extracted from apps/projects tasks.ts so task recurrence becomes time zone safe

// runs.ts
export interface RunBuild { readonly buildId: string; readonly containerId: string; readonly buildDate: IsoDate; readonly scheduleId: string | null; readonly scheduleName: string | null; readonly statusCategory: 'todo' | 'in_progress' | 'done' | 'cancelled'; readonly plannedQty: string; readonly builtQty: string; readonly closedShort: boolean }
export interface Run { readonly id: string; readonly containerId: string; readonly date: IsoDate; readonly scheduleId: string | null; readonly name: string; readonly builds: number; readonly done: number; readonly cancelled: number; readonly plannedUnits: string; readonly builtUnits: string; readonly state: 'planned' | 'in_progress' | 'done' | 'short' | 'cancelled' }
export function runId(input: { scheduleId: string | null; date: IsoDate }): string; // 'run:<scheduleId>:<date>' or 'run:manual:<date>'
export function parseRunId(id: string): { scheduleId: string | null; date: IsoDate } | null;
export function groupRuns(builds: readonly RunBuild[]): Run[]; // sorted by date then schedule name, 'Unscheduled' last
```

Rules: `daily` is every calendar day; `weekdays` is the program's work days (`isWorkDay`); `custom_days` uses `days`; `every_n_weeks` uses `days` in weeks where `floor(daysBetween(startOfWeek(startsOn), startOfWeek(date)) / 7) % intervalWeeks === 0` (weeks start Monday). Days off are skipped when `skipHolidays`, and paused ranges always skip. `skipDates` always skip. `generationWindow`: `from = max(startsOn, generatedThrough + 1 day, asOf)`, `to = min(endsOn, asOf + leadDays)`; null when `from > to`. Past days are never generated.

Run state: `cancelled` when every build is cancelled; `done` when every build that is not cancelled is done and none is closed short; `short` when every build is done or cancelled and at least one closed short or the run's built units are below its planned units; `in_progress` when any build has output or an in progress status; else `planned`. The run name is the schedule name, or "Unscheduled".

### 3.11 Deal helpers (`deal.ts`)

```ts
export function isWonStage(label: { isDone?: boolean | null; name?: string | null }): boolean; // A12
export function dealValueToCents(amount: unknown): Cents | null; // whole currency units number or numeric string -> cents, Math.round(x * 100) semantics done with toScaled(x, 2)
export function monthlyFromDeal(input: { valueCents: Cents; termMonths: number | null }): Cents | null; // valueCents / (termMonths ?? 12), divRound
export function dealPrefill(input: { deal: { currency: string | null; valueCents: Cents | null; rates: DealRates }; programCurrency: string }): { rates: DealRates | null; currencyNote: string | null }; // rates only when currencies match (a null deal currency counts as the program currency), else "This deal is in EUR. Type the rates in USD."
```

### 3.12 Format and barcodes (`format.ts`, `barcode.ts`)

`formatCents(cents, { compact? })` and `formatMarginBp` (same output as `@kitstak/pulse-bridge/format`; pulse-bridge `format.ts` re-exports them from here), `formatUnitPrice("1.9500") -> "$1.95"` (trims to 2 decimals unless more are needed: `"1.8525" -> "$1.8525"`), `formatQty("1200.000") -> "1,200"`, `unitLabel(n, { singular, plural }) -> "1 kit" | "1,200 kits"`, `formatHours("1.58") -> "1.58 h"`, `formatPercentBp(10533) -> "105%"`. Fixed `en-US` for hydration safety. `code128(text): { bars: readonly number[]; checksum: number }` encodes Code 128 B for build tickets (pure; rendered as SVG by the UI kit).

### 3.13 Wizard projection (`projection.ts`)

```ts
export function projectMonth(input: { month: IsoMonth; calendar: ProgramCalendar; versions: readonly CardVersion[]; schedules: readonly { rule: ScheduleRule; lines: readonly ScheduleLine[] }[] }): { workDays: number; result: MonthResult };
```

Builds a synthetic month: for every occurrence of every schedule in the month, one output row per line with `qtyFor(line, date)` at `resolveUnitPrice` of the card, plus one finished build per row for the per batch line; then `monthCharges` with `asOf` = month end plus one day (so the top up shows). The wizard and the price card editor both call it. No server call.

### 3.14 Input filters (normative for the shared loader, 4.3.1)

The engine does not query, but every caller must hand it the same inputs. The one loader that does this is `loadProgramMonthInputs` (`@kitstak/db/programs`, L1). Its filters are part of this spec:

- Output: `pm.build_output.deleted_at IS NULL`, joined to `pm.tasks` and `pm.projects` with both `deleted_at IS NULL`.
- Finished: builds with `finished_on` in the month, task live, status category not `cancelled`, `built_qty > 0`.
- Time: `pm.time_entries` with `deleted_at IS NULL`, `ended_at IS NOT NULL`, `duration_minutes > 0`, task and project live, task in the program; `billable = true` unless the program's `hourly_time_basis = 'all'`; day = `(started_at AT TIME ZONE program timezone)::date`.
- One time: live rows with `charge_on` in the month.
- Versions: published, live.
- Calendar: `programCalendar` merge (A15).

### 3.15 Engine test cases (normative; copy into `*.test.ts`)

GLOVE setup used below: variants with Size Small, Medium, Large, XL (codes S, M, L, XL) and Color Brown, Yellow (codes BRN, YLW), 8 variants. Card v1 effective 2026-09-15: per kit $1.85, rate rule "Size is XL: set $2.10", monthly fee $1,500.00 with prorate on, monthly minimum $30,000.00 with prorate on. Setup fee $2,500.00 as a one time charge on 2026-09-15. Card v2 effective 2026-11-01: per kit $1.95, rule "Size is XL: add $0.25" (XL $2.20), fee and minimum unchanged. Working days Mon to Fri. Day off 2026-11-26. Program starts 2026-09-15. Time zone America/Chicago.

| # | Case | Expected |
|---|---|---|
| E1 | `accrueDay('100', '1.85')` | `18500n` ($185.00) |
| E2 | `accrueDay('333', '1.8525')` | `61688n` (616.8825 rounds to 616.88) |
| E3 | `accrueDay('1', '0.0050')` | `1n` (half a cent rounds away from zero) |
| E4 | `accrueDay('3', '0.1250')` | `38n` (37.5 cents rounds to 38) |
| E5 | `accrueDay('0.5', '2.1000')` | `105n` |
| E6 | `accrueDay('100', null)` | `0n` |
| E7 | Resolve Small Brown on 2026-10-30, no override | `{ unitPrice: '1.8500', source: 'card', versionId: v1 }` |
| E8 | Resolve XL Brown on 2026-11-02 | `{ unitPrice: '2.2000', source: 'variant', versionId: v2 }` |
| E9 | Resolve XL Brown on 2026-11-02 with build override `2.05` | `{ unitPrice: '2.0500', source: 'build' }` |
| E10 | Resolve on 2026-09-14 (before v1), no job | `{ unitPrice: '0.0000', source: 'none' }` |
| E11 | Resolve on 2026-09-14 with job prices `[{ effectiveFrom: '0001-01-01', unitPrice: '1.7000' }]` | `{ unitPrice: '1.7000', source: 'job' }` |
| E12 | One November work day, 100 of each variant | Small, Medium, Large: 600 x $1.95 = $1,170.00; XL: 200 x $2.20 = $440.00; day work charges `161000n` |
| E13 | One October work day, 100 of each | 600 x $1.85 + 200 x $2.10 = `153000n` |
| E14 | September: 12 work days (Sep 15 to 30) at E13 volume | work `1836000n` ($18,360.00); monthly fee `divRound(150000 * 16, 30) = 80000n` ($800.00); setup `250000n`; minimum `divRound(3000000 * 16, 30) = 1600000n`; gap 0; status `met`; total `2166000n` ($21,660.00) |
| E15 | October: 22 work days, Oct 12 to 16 at 50 per variant, other days 100 | work = 17 x 153000 + 5 x 76500 = `2983500n` ($29,835.00); fee `150000n`; minimum `3000000n`; asOf 2026-11-25 so gap `16500n` posted as top up `pmf:<id>:minimum:2026-10` dated 2026-10-31; total `3150000n` ($31,500.00) |
| E16 | November asOf 2026-11-24 end of day: 17 work days at E12 volume | work `2737000n`; fee `150000n` dated 2026-11-01 (the first active day, even though it is a Sunday); minimum status `pending`, gap so far `263000n` preview only; total `2887000n` ($28,870.00) |
| E17 | Forecast for November asOf 2026-11-24, no planned builds, trailing 10 days at 161000 | remaining work days after Nov 24: Nov 25, 27, 30 (26 is a day off) = 3; today remainder 0 (Nov 24 fully logged); recent work = 2737000 + 3 x 161000 = `3220000n`; fixed `150000n`; projected gap 0; forecast `3370000n` ($33,700.00), method `recent` |
| E18 | Same as E17 with planned builds for Nov 25, 27 and 30 (8 builds each, 100 per build) | planned work `3220000n`, method `planned`, forecast `3370000n` |
| E19 | Monthly fee with a version change on day 16 of a 30 day month, fee $1,500 then $1,800, prorate on for both | `divRound(150000*15,30) + divRound(180000*15,30) = 75000 + 90000 = 165000n` |
| E20 | Per hour MAHCO $42.00 per hour, 95 minutes on one day | hours `'1.58'`, cents `6636n` |
| E21 | Per hour split: 31 minutes on variant A and 31 minutes at program level, same day | day minutes 62, hours `'1.03'`, day charge `4326n`; split by allocate 2163 and 2163; quantity `'1.03'` (not 1.04) |
| E22 | DUDE per batch $45.00, 3 builds finished on 2026-11-23 with output, 1 finished with 0 built | three charges `4500n` each, refs `pmf:<id>:order:<buildId>`; the empty build makes no charge |
| E23 | Setup fee one time charge on 2026-09-15; card v2 published later | charged once (`250000n` in September only, ref `pmf:<id>:setup:<chargeId>`) |
| E24 | `postingTarget({ buildJob: { id: 'J2', live: true }, programId: 'P', programJob: { id: 'J1', live: true } })` | `{ posting: 'build_job', jobId: 'J2' }` |
| E25 | Variant invariant over random 500 rows | `sum(byVariant.totalCents) + fixed + adjustments + topUp === totalCents` |
| E26 | Parity property: 2,000 random (qty 0 to 99999.999, price 0 to 999.9999) pairs | `accrueDay` equals a reference implementation of Postgres `round(numeric)` half away from zero in string decimal arithmetic (no `Math.round`) |
| E27 | `generateVariants` with Size Small, Medium, Large, XL (codes S, M, L, XL) x Color Brown, Yellow (codes BRN, YLW), program GLOVE | 8 variants, first `{ name: 'Small Brown', key: 'S-BRN', sku: 'GLOVE-S-BRN' }`, last `{ name: 'XL Yellow', key: 'XL-YLW', sku: 'GLOVE-XL-YLW' }` |
| E28 | `occurrences(weekdays, Nov 2026, daysOff [11-26])` | 20 dates; first 2026-11-02, last 2026-11-30, no 11-26 |
| E29 | `every_n_weeks` interval 2 on Monday from 2026-11-02 | 2026-11-02, 2026-11-16, 2026-11-30 |
| E30 | `todayIn('America/Chicago', new Date('2026-11-26T04:30:00Z'))` | `'2026-11-25'` |
| E31 | `isWonStage({ isDone: true, name: 'Closed' })`, `({ isDone: null, name: 'Won' })`, `({ isDone: false, name: 'Won back later' })` | true, true, false |
| E32 | `projectMonth` December 2026, weekdays, days off [12-25], schedule "every work day, 100 of each", card v2 | 22 work days; work `3542000n`; fee `150000n`; minimum met; total `3692000n` ($36,920.00) |
| E33 | Mixed options: fee $1,500 prorate off from Nov 1, v3 from Nov 16 fee $1,800 prorate on, active all month | `divRound(150000*15,30) + divRound(180000*15,30) = 165000n`; never more than one month of either |
| E34 | Fee introduced mid month: v1 has no fee, v2 from Nov 16 has $1,800 prorate off, active all month | `divRound(180000*15,30) = 90000n` |
| E35 | Program starts Sep 15 with fee $1,500 prorate off | `150000n` (A = 16 of 16 active days) |
| E36 | Paused Nov 9 to Nov 15, fee $1,500 with charge while paused off, prorate on | `divRound(150000*23,30) = 115000n`; with charge while paused on: `150000n` |
| E37 | Adjustments: credit `-20000` counts toward minimum, rush fee `+15000` does not, minimum $30,000, work $29,900 after month end | for minimum = 2990000 - 20000 = 2970000; top up `30000n`; total = work + fee + (-20000 + 15000) + 30000 |
| E38 | `compileRateRules` default $1.95; rules "Size is XL: add $0.25", "Color is Yellow: add $0.10"; hand line for Small Brown $1.90 | XL Brown 2.2000, XL Yellow 2.3000, Small Yellow 2.0500, Small Brown has no compiled line (hand line wins), Medium Brown none |
| E39 | `compileRateRules` with two `set` rules on XL Yellow | conflict listing both rule ids |
| E40 | `inferAxes` over "GLOVE-S-BRN", "GLOVE-S-YLW", "GLOVE-M-BRN", "GLOVE-XL-YLW" | mode `sku`; prefix GLOVE dropped; axes [{ values S, M, XL as Small, Medium, XL }, { values BRN, YLW as Brown, Yellow }]; 4 rows |
| E41 | `inferAxes` over a tab sheet with header "Size\tColor\tSKU" and 8 rows | mode `columns`; axes Size and Color; sku filled per row |
| E42 | `groupRuns` 8 builds on 2026-11-25 by schedule S (5 done, 1 in progress, 2 todo) plus 1 hand made build | runs `run:S:2026-11-25` (state in_progress, 5 of 8 done, 560 of 800 when built is 5 x 100 + 60) and `run:manual:2026-11-25` ("Unscheduled") |
| E43 | `qtyFor({ qty: '240', qtyByWeekday: { '6': '120', '1': '300' } }, '2026-11-28')` (a Saturday) | `'120'`; Monday 2026-11-30 gives `'300'`; Wednesday gives `'240'` |
| E44 | `programHealth` with no target, no daily unit target, last 5 work days planned 4000 built 3600 | `{ health: 'at_risk', basis: 'plan' }` (90 percent) |
| E45 | `avgUnitPrice` for perUnit `161000n` over units `800.000` | `'2.0125'` |
| E46 | `parseOutputCsv` with 3 good lines and one unknown SKU | 3 rows, 1 unmatched with "No variant has the SKU GLOVE-XXL-RED." |
| E47 | `dealPrefill` deal currency EUR, program USD | rates null, note "This deal is in EUR. Type the rates in USD." |

Note on E16: the fee is dated on the first active day of the month, which is the 1st even when it is not a work day. Work days matter only for forecasts and schedules.

---

## 4. Projects server

### 4.1 Kind isolation and program rules in existing code (every place that must change)

Rule: project surfaces show `kind = 'project'` containers only. Program surfaces show `kind = 'program'` only. Builds show inside their own container (a program, or the project that holds them) and in the cross work places this table names. Filters live in the domain layer, never in components. `visibleProjectsWhere(ctx, opts?: { kind?: ProjectKind | 'any' })` gains a `kind` option that defaults to `'project'`; every caller that needs programs passes `'program'` or `'any'` explicitly. Generic project mutations never act on a program: they refuse with VALIDATION "Use the program settings." or delegate to the programs domain, as listed. Which layer edits each file is set in section 10 (Projects rows are L2 unless marked).

| File | Function or line | Change |
|---|---|---|
| `apps/projects/src/server/domain/access.ts` | `visibleProjectsWhere` L105 | add `kind` option, default `'project'` |
| same | `loadProject` L60, `requireProject` L70 | add `opts.kind?: ProjectKind | 'any'` (default `'any'`, so links, comments, files and time keep working on programs); return `kind` on the row. `requireProgram(ctx, keyOrId, action)` wraps it with `kind: 'program'` and NOT_FOUND otherwise |
| `server/domain/projects.ts` | `listProjects` L146 | `kind` option default `'project'`; `listPrograms` is separate (4.2) |
| same | `insertProject` L337 | accepts `kind`; programs get `DEFAULT_PROGRAM_STATUSES`, a `pm.program_settings` row (time zone from the workspace calendar), activity verb `program.created`, notify url `/programs/KEY` |
| same | `updateProject` L489 | for a program: name, description, owner, color, icon pass through; `startDate`, `dueDate`, `status`, `visibility` and `spaceId` are refused with "Use the program settings." (the programs domain owns them, 4.3.7) |
| same | `archiveProject` L565, `deleteProject` L587, `restoreProject` L595 | refuse programs with "Use the program settings." (`archiveProgram`, `deleteProgram`, `restoreProgram` check locks, schedules and Pulse links) |
| same | `duplicateProject` L710, template conversion | refuse programs (they use `copyProgram` and `saveProgramTemplate`) |
| `server/domain/tasks.ts` | `insertTask` L391 | new internal option `kind?: TaskKind` (default `'task'`); `'build'` is only passed by `domain/programs/builds.ts`. Generic callers (forms in task mode, triage, templates, automations follow ups, recurrence spawn, duplicate) always make tasks. |
| same | `listProjectTasks` L275 | returns builds of that container with the `build` block (projects can hold builds); option `workKind: 'tasks' | 'builds' | 'all'` default `'all'` |
| same | `listMyTasks` L290 | option `include: 'tasks' | 'builds' | 'all'` default `'tasks'`; My Work passes `'all'` and groups builds |
| same | `applyTaskUpdate` L540, `bulkUpdateTasks` L794, `moveTask` L832, `setTaskDone` L1257 | for builds: status changes run in the same transaction as `refreshLedgerFor(tx, ctx, { programIds, dates })` (4.3.2) and emit `pm_program_changed`; date changes go through `builds.updateBuild` rules (locks, `build_date` mirror); `start_date`/`due_date` edits on a build keep `pm.builds.build_date` equal to `due_date` |
| same | `moveTaskToProject` L897 | refuse a build (VALIDATION "Use Move to program or Move to project for builds."); a task may move into or out of a program, but is refused when it has time entries on a locked day of either side ("This task has time in a closed month. Copy it instead."); moving a task with time refreshes both sides' per hour ledger |
| same | `duplicateTask` L972 | builds duplicate through `duplicateBuild` (copies the builds row, no output) |
| same | `deleteTasks` L1024 | for builds: refused when any output row or ledger row of the build is on a locked day ("This build has output in a closed month. Cancel it instead."); else soft deletes the build's live output rows in the same transaction, refreshes the ledger for the affected months and emits `pm_program_changed` |
| same | `restoreTasks` L1051 | for builds: restores only output rows whose dates are still open, then refreshes the ledger |
| same | `nextOccurrenceDate` L724 | replaced by the engine `nextOccurrenceDate` (time zone safe) |
| `server/domain/task-queries.ts` | `taskSummaryColumns` L32 | add `kind` (task), `projectKind`, and a nullable `build` block (variant, build date, planned, built, unplanned, posting); `selectTaskSummaries` gains a `kind` filter option |
| `server/domain/structure.ts` | `updateStatus` L55 (category change), `deleteStatus` L99 (moves tasks) | when the status belongs to a program or a project with builds: run `refreshLedgerFor` for the builds whose status category changed, in the same transaction; emit `pm_program_changed`. Leaving done in a locked month is allowed; the ledger row stays (A7) |
| `server/domain/time.ts` | `startTimer` L53, `stopTimer` L76, `addManualTime` L87, `updateTimeEntry` L138, `deleteTimeEntry` L157 | when the task is in a program, or is a build that bills to a job: `assertOpen` on the entry's day (and on the old day for updates and deletes); default `billable = true` for new entries on a program with a per hour line; refresh the per hour ledger for the touched days; `timeChanged` L71 also emits `pm_program_changed` |
| `server/domain/prefs.ts` | `listFavorites` L56, `listRecents` L95 | return the project `kind`; the sidebar shows programs with the program icon and route |
| `server/domain/cycles.ts` | `listCycles` L172, `setTasksCycle` L353 | programs have no cycles: `listCycles` returns empty for a program; `setTasksCycle` refuses builds |
| `server/domain/views.ts` | L37, L64 (list and create views) | filter and write `surface` (`'work'` default; `'programs'` for the directory; `'floor'` for Floor today) |
| `server/domain/templates.ts` | list, `templateFromProject` L91, instantiate L291 | list filters `kind` (project template gallery and project wizard get `'project'` only); program templates are made by `programs/templates.ts saveProgramTemplate` and opened by the program wizard (`ProgramTemplatePayload`, 4.5) |
| `server/domain/forms.ts` | form submit | a form may target "Creates a build in {program}" with field mappings for variant and qty (5.17); task forms unchanged |
| `server/domain/triage.ts` | accept | always `kind='task'` |
| `server/domain/onboarding.ts` | `createSampleProject` L19 | passes `kind: 'project'` explicitly |
| `server/domain/search.ts` | L30, L37, L49 | tasks: include builds with `kind` on the hit; projects query `kind='project'`; add a programs query (`kind='program'`) returning `programs[]`; all three also add `is_template = false` and `archived_at IS NULL` (fixes the existing gap) |
| `server/domain/search-full.ts` | L63, L91, L145 | `FullSearchType` adds `'programs'`; tasks bucket includes builds with a Build badge field; projects tab via `listProjects` (project only) |
| `server/domain/portfolio.ts` | `getPortfolioReport` L304 | project only |
| `server/domain/goals.ts` | `projectPercents` L17 | project only for automatic percents; `linkGoalProject` accepts programs (a goal can track a program; its percent is the program's `targetBp` capped at 100 percent) |
| `server/domain/spaces.ts` | `listSpaces` L37 | counts project only; programs have no space in v1 |
| `server/domain/links.ts` | `findLinkedWork` L181, `countLinkedWork` L207 | `kind` option; CRM and WMS panels ask for `'project'` (programs have their own panels); `listProjectLinks` adds `core.record_links` edges of the project (program chips with this month's units, 5.14) |
| `server/domain/due-reminders.ts` | L24 to L59 | skip `kind='build'` (builds have their own end of day reminder, 4.9); url uses `routes.taskAny` |
| `server/domain/automations.ts` | `rulesFor` L300, `applyAction` L359 | global rules (project_id null) skip builds unless the rule has the condition `workKind is build`; `move_to_project` refuses builds; `create_follow_up` always makes a task; new run triggers (5.17) |
| `server/automations/engine.ts` | `EngineTask` L21 | add `kind`; condition fields `workKind`, `variant` |
| `server/domain/automation-sweep.ts` | `scopeOf` L90 | sweeps include programs; build reminders and run triggers come from 4.9 |
| `server/domain/activity.ts` | `toDTO` | strips `before.money`, `after.money` and `meta.money` when the reader cannot see money for that program (4.10) |
| `server/domain/integration-summary.ts` | L20 to L35 | project only |
| `server/integrations/customer-pulse.ts` | L225 | project only for the project list; a `programs` array is added for the customer strip |
| `server/integrations/customer360.ts` | L468 | same |
| `server/integrations/events.ts` | L103 to L124 | url built with `routes.taskAny(kind, key, number)` |
| `server/integrations/record-triggers.ts` (L6) | `fireDealWon` L358 | existing check "deal already has a project" filters `kind='project'`; new action `create_program` (6.2) |
| `app/(app)/p/[key]/layout.tsx` | | if `kind='program'` redirect to `/programs/KEY` keeping the tab or number (`/p/GLOVE/212` goes to `/programs/GLOVE/212`) |
| `app/(app)/layout.tsx` | 404 pre check | also match `/programs/KEY` and `/programs/KEY/NUMBER` and check kind |
| `features/projects/projects-page.tsx` | direct db query | add `kind='project'` to its integration links query |
| `packages/pm-bridge/src/read.ts` (L6) | `loadProjects` L81, `loadTasks` L143, `listLinkedWork` L192, `countLinkedWork` L241, `listWritableProjects` L276 | `p.kind = 'project'` and `t.kind = 'task'`, added only when `pmAvailability(db).kinds` is true (column detection, 6.5) |
| `packages/pm-bridge/src/write.ts` (L6) | `createTaskFromExternal` L125, `linkProjectToRecord` L248 | refuse programs (BridgeError VALIDATION "Programs take builds, not tasks from other apps.") and insert `kind='task'` explicitly when the column exists |
| `packages/pm-bridge/src/access.ts` (L6) | L69 | return kind |
| `apps/pulse/src/server/integrations/projects.ts` (L5) | `getProjects` L97, `tasksOfProjects` L186 | project list filters `kind='project'` when the column exists; `tasksOfProjects(ctx, projectIds, keepIds, { include: 'tasks' | 'all' })`: the Log work picker passes `'tasks'`, validation passes `'all'` |
| `apps/portal/src/server/onboarding.ts` (L6) | L146 | project and task counts filter kind when the column exists; adds a programs count |

### 4.2 Domain modules (new folder `apps/projects/src/server/domain/programs/`)

Every exported function takes `DomainContext` first, checks permission, runs one transaction with activity rows, then notifications, then after commit work (automations, bridge events), exactly like `tasks.ts` (header L1 to L8). All reads return DTOs from `src/lib/program-types.ts`. All errors are `DomainError` codes `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `LOCKED`.

| File | Functions |
|---|---|
| `index.ts` | barrel |
| `access.ts` | `requireProgram(ctx, keyOrId, action)`, `programCapabilities(ctx, program, settings)` -> `{ canEdit, canPlan, canLog, canPropose, canPrice, canManage, canClose, seesMoney, seesSync }`, `assertMoney(ctx, program)`, `seesMoneyFor(ctx, programIds)` (batch, for activity and lists) |
| `calendar.ts` | `getOrgCalendar(ctx)`, `updateOrgCalendar(ctx, patch, expectedVersion)` (owners and admins; refreshes the ledger nowhere: days off only change forecasts and future generation), `programCalendar(ctx, program)` -> engine `ProgramCalendar` (A15 merge) |
| `programs.ts` | `listPrograms(ctx, opts: { status?; customerId?; q?; ids?; includeArchived?; ownerId?; health? })` -> `ProgramListItemDTO[]`; `getProgramDetail(ctx, key)`; `createProgram(ctx, payload: ProgramWizardPayload)` (one transaction: `insertProject(kind='program')`, settings, attributes, variants, card version published unless "Set prices later", rules, one time charges, schedules, record links, CRM `created_from` link, Pulse job link; activity; notify members; after commit: generate builds for schedules, emit bridge event; returns `{ key, url, generated: { builds, units, through } }`); `updateProgram(ctx, key, patch)`; `setProgramStatus(ctx, key, status, { futureBuilds: 'cancel' | 'keep', endsOn? })` (4.3.7); `archiveProgram`, `restoreProgram`, `deleteProgram` (owner; soft delete; refuses when any output or ledger row is locked; Pulse edges are removed and Pulse is told); `copyProgram(ctx, key, { name, key, startDate, include: { variants, priceCard, schedules, members, links } })`; `takenKeys(ctx)` (shares `takenProjectKeys`) |
| `settings.ts` | `getProgramSettings`, `updateProgramSettings(ctx, key, patch, expectedVersion)` (time zone change refused once a locked month holds time or output, A8; work day changes re plan nothing, only future generation; `hourly_time_basis` change refreshes the open per hour ledger) |
| `variants.ts` | `listVariants(ctx, key, { includeRetired })`, `createVariants(ctx, key, rows[])` (from the generator or a pasted list; validates with engine `findConflicts`; rates go to the pending draft, 4.4.3), `updateVariant(ctx, id, patch, expectedVersion)`, `reorderVariants`, `retireVariant`, `restoreVariant`, `deleteVariant` (only without builds), `linkVariantKit(ctx, id, { coreItemId?, wmsProductId? })` (writes `uses_kit` edge and the cache columns), `saveAttributes(ctx, key, axes[], { valuesForExisting?: Record<attributeId, valueId> })` (adding an axis with variants in place requires a value for them; removing one requires unique combinations) |
| `price-cards.ts` | `listCardVersions(ctx, key)`, `getCardVersion`, `createDraftVersion(ctx, key, { from: versionId | 'current' | 'empty', effectiveFrom })`, `updateDraftVersion(ctx, versionId, { effectiveFrom, label, note, lines[], rules[] }, expectedVersion)` (recompiles rule lines), `previewVersion(ctx, versionId | draftPayload)` -> `CardImpactDTO` (4.4.5), `publishVersion(ctx, versionId, expectedVersion)` (4.4.2), `unpublishVersion(ctx, versionId)` (Scheduled only, back to draft), `deleteVersion(ctx, versionId)` (drafts any time; published only while Scheduled), `setVariantRate(ctx, variantId, { unitPrice | null, startsOn })` (writes the pending draft, 4.4.3), `requestReview(ctx, versionId)`, `sendBack(ctx, versionId, note)` (4.4.4) |
| `one-time.ts` | `listOneTimeCharges(ctx, key, { month? })`, `addOneTimeCharge(ctx, key, input)`, `updateOneTimeCharge(ctx, id, patch, expectedVersion)`, `deleteOneTimeCharge(ctx, id)`; every write checks `assertOpen(charge_on)`, needs `pricing:manage` for setup fees and `pricing:propose` for adjustments up to the program's limit (owners any), refreshes the ledger |
| `builds.ts` | `listBuilds(ctx, containerKey, { from, to, status?, variantIds?, assigneeIds?, runId?, cursor?, limit<=500 })`, `getBuild(ctx, taskId)`, `createBuild(ctx, containerKey, { variantId?, buildDate, plannedQty, title?, assigneeId?, statusId?, rateOverride?, reason?, plannedFrom? })` (works in programs and projects), `createBuilds(ctx, key, rows[])` (planner and imports; up to 500 rows per call; returns `{ createdIds, skipped }`), `updateBuild(ctx, taskId, patch, expectedVersion)` (variant, date, planned qty, override; updates open output prices when the variant or override changes), `moveBuild(ctx, taskId, { toContainerKey, variantId? })` (sets `pm.build_move`, updates task and builds row, adopts the new program's card for open output; refused when output is locked), `splitBuild(ctx, taskId, { qty, toDate })` (makes a linked build with the remaining qty, `planned_from='split'`, `split_from_id`, a `created_from` edge; the original closes at its built qty with `closed_short=false` and reason "Moved {qty} to {date}"), `closeShort(ctx, taskId, { reason })` (status done, `closed_short`, fires `build_done_short`), `duplicateBuild(ctx, taskId, { to: 'here' | 'tomorrow' | 'next_scheduled' | IsoDate })`, `copyDay(ctx, key, { fromDate, toDates[], mode: 'planned' | 'built' })`, `cancelBuilds(ctx, ids[])` (keeps output and its per unit revenue; never a batch charge), `undoCreateBuilds(ctx, ids[])` (deletes builds that still have no output, time or comments) |
| `runs.ts` | `listRuns(ctx, key, { from, to })` -> `RunDTO[]` (engine `groupRuns`), `getRun(ctx, runId)`, `moveRun(ctx, runId, { toDate })`, `cancelRun(ctx, runId)`, `copyRun(ctx, runId, { toDates[] })`, `closeRun(ctx, runId, { decisions: [{ buildId, action: 'close_short' | 'move_rest' | 'leave_open', reason?, toDate? }] })` (one transaction through `logOutput` rules), `floorToday(ctx, { date })` -> `FloorTodayDTO` (every program's runs for the day, the org capacity, units and estimated hours) |
| `output.ts` | `getOutputSheet(ctx, key, date, { runId? })` -> `OutputSheetDTO` (builds dated that day, plus open builds from earlier days with remaining qty, plus today's rows); `logOutput(ctx, key, { date, entries, endOfDay? })` (4.3.3); `deleteOutput(ctx, outputId, expectedVersion)`; `repriceOpenDays(ctx, key, { from })` (internal: after publish, override, variant, job price or posting changes) |
| `imports.ts` | `previewOutputImport(ctx, key, csv)`, `commitOutputImport(ctx, key, previewToken)` (one batch through `logOutput`, makes builds per day and variant when none exist with `planned_from='import'`, respects locks, reports refused days), `previewPlanImport(ctx, key, csv | paste, { dates })` and `commitPlanImport` (through `createBuilds`) |
| `schedules.ts` | `listSchedules`, `createSchedule(ctx, key, input)`, `updateSchedule(ctx, id, patch, expectedVersion, { regenerateFuture })` (changes apply to dates not yet generated; `regenerateFuture` removes generated builds dated after today that have no output, no time and no comments and are still in a todo status, frees their occurrence keys (2.2.10), then regenerates), `pauseSchedule`, `resumeSchedule`, `endSchedule(ctx, id, { endsOn })`, `skipDate(ctx, id, date)`, `previewSchedule(ctx, input, { from, to })` (read only), `runScheduleGeneration(ctx, { programId? })` (4.9) |
| `ledger.ts` | `refreshLedgerFor(tx, ctx, { programIds, dates | months })`, `settleDue(tx, ctx, programId, asOf)` (4.3.2) |
| `locks.ts` | `programLocks(ctx, program)` -> `{ lockedThrough: IsoDate | null; programClosed: IsoMonth[]; pulseClosed: IsoMonth[]; pulseApplies: boolean }` (Pulse months through `@kitstak/pulse-bridge/programs getClosedMonths`, fail soft to none); `isLocked(locks, date, { goesToJob })`; `assertOpen(ctx, program, date, { goesToJob })` throws `LOCKED` with "October is closed in Pulse. Ask a Pulse admin to reopen it." or "October is closed for GLOVE. An owner can reopen it." |
| `closes.ts` | `getCloseChecklist(ctx, key, month)`, `closeMonth(ctx, key, month)`, `reopenMonth(ctx, key, month, reason)` (4.3.4) |
| `summary.ts` | `getProgramSummary(ctx, key, { month })` -> `ProgramSummaryDTO`: reads output and the ledger (never recomputes past fees), runs `monthCharges` only for the current month's preview items (minimum gap so far) and `forecastMonth`, compares the engine with the ledger for open months and schedules `settleDue` after the response when they differ; strips money when `!seesMoney`; `getProgramRange(ctx, key, { from, to })`; `getStatement(ctx, key, month)`; `statementCsv`; `statementPdf` (pdf-lib, the statement layout of 5.6) |
| `reports.ts` | `programTrends(ctx, { from, to, groupBy: 'program' | 'customer' })` -> months x programs units and revenue (reads output and ledger); `trendsCsv`; `shareReport(ctx, { key, runId? | week?, includeCharges, format: 'pdf' | 'csv' })` (units by variant: planned, built, scrap; charges only when asked and `seesMoney`); `dashboardPrograms(ctx)` (the three dashboard panels, 5.20) |
| `links.ts` | `listRecordLinksFor(ctx, ref: { type: 'pm_program' | 'pm_build' | 'pm_project'; id })` -> union of `core.record_links`, `pm.integration_links`, `pulse.job_links` mirrors (1.2 rule 4) resolved to `LinkedRecordDTO` (title, status, url, app, money edge flag, dangling flag); `linkRecord(ctx, from, to, relation)`, `unlinkRecord(ctx, linkId)`; `linkPulseJob(ctx, { programKey } | { buildId }, jobId)` (4.3.3); `unlinkPulseJob(...)`; `allLinkedWork(ctx, key, month)` (program total plus related jobs through `getJobsSummary`) |
| `kits.ts` | `variantKit(ctx, variantId)` -> WMS capacity (6.3); `buildShortages(ctx, buildId)`; `plannerCapacity(ctx, key, { from, to })` (per linked variant: what WMS can build and the first short component) |
| `prices-elsewhere.ts` | `otherPricesForCustomer(ctx, key)` -> WMS billing fees for the client (6.3) and Pulse job prices (6.1), each with a mismatch flag against the card in force |
| `prefill.ts` | `wizardPrefill(ctx, { crmItemId?, templateId?, copyKey?, customerId? })` -> `ProgramWizardPayload` partial (CRM deal facts through `server/integrations/crm.ts dealFactsFor` and engine `dealPrefill`, a template payload, or a copy) |
| `templates.ts` | `saveProgramTemplate(ctx, key, { name, description })`, `listProgramTemplates(ctx)` |
| `drafts.ts` | `listDrafts(ctx)`, `saveDraft(ctx, { id?, title, step, payload }, expectedVersion?)`, `deleteDraft(ctx, id)` |
| `updates.ts` | `draftProgramUpdate(ctx, key)` -> text for the status update composer ("5 of 8 builds done today · $29,970.40 this month · 105% of target"); posting reuses the project updates domain |
| `notify.ts` | program notifications (4.9) |
| `events.ts` | `emitProgramChanged(tx, ctx, programId)` -> `emitBridgeEvent(tx, { kind: 'pm_program_changed', targetId: programId })` (savepoint, never throws) |
| `sweep.ts` | `scheduleProgramSweep(orgId)` (4.9) |

### 4.3 Money in the domain

#### 4.3.1 Shared loader

`@kitstak/db/programs` (L1, `packages/db/src/programs/**`) holds the only SQL that reads program money inputs, so Projects, pm-bridge and Pulse read the same rows with the same filters (3.14):

```ts
loadProgramMonthInputs(db: Executor, orgId: string, programId: string, month: IsoMonth): Promise<Omit<MonthInput, 'asOf'>>; // Projects ledger writer and summary
readProgramMonth(db: Executor, orgId: string, programId: string, month: IsoMonth): Promise<{ output: OutputRow[]; ledger: LedgerRow[]; settledThrough: IsoDate | null }>; // statements, pm-bridge, Pulse sync
readBuildOutput(db: Executor, orgId: string, buildIds: readonly string[], range: { from: IsoDate; to: IsoDate }): Promise<OutputRow[]>; // builds outside programs
loadBuildHoursByDay(db: Executor, orgId: string, input: { buildIds: readonly string[]; timezone: string; from: IsoDate; to: IsoDate }): Promise<{ buildId: string; workDate: IsoDate; minutes: number; people: number }[]>; // Pulse labor on pmb rows
loadPrepTimeByDay(db: Executor, orgId: string, input: { programId: string; timezone: string; from: IsoDate; to: IsoDate; perTaskIds: readonly string[] }): Promise<{ taskId: string | null; workDate: IsoDate; minutes: number; people: number }[]>; // Pulse pmt rows
programsAvailable(db: Executor): Promise<{ kinds: boolean; tables: boolean }>; // information_schema column check and to_regclass('pm.build_output'), cached 60s
```

Raw `sql` over a structural executor, driver portable, never throws for "not installed" (returns empty and `programsAvailable` false).

#### 4.3.2 Ledger writer

`refreshLedgerFor(tx, ctx, { programIds, months })`:

1. `SELECT ... FROM pm.program_settings WHERE program_id = ANY(...) ORDER BY program_id FOR UPDATE` (one lock order for every writer).
2. For each program and each touched month that has at least one open day: `loadProgramMonthInputs`, `monthCharges` with `asOf = todayIn(program tz)`, `ledgerRows`.
3. For each produced row whose `charge_date` is open: upsert by `(org_id, ref)` (update cents, quantity, unit price, label, posting and job when changed; `computed_at = now()`). Rows dated on a locked day are never written, even when the engine now says something else.
4. Live ledger rows of that program and month that were not produced and are on an open day are soft deleted.
5. Posting of fees: `program_job` with the program's live `bills_to` job, else `program`.

Callers, always inside the transaction that changed the input: `logOutput`, `deleteOutput`, build status paths (4.1), `cancelBuilds`, `deleteTasks`/`restoreTasks`, time entry writes, `publishVersion`/`unpublishVersion`, one time charge writes, program date and status changes, `hourly_time_basis` changes, `linkPulseJob`/`unlinkPulseJob`, and `repriceOpenDays`.

`settleDue(tx, ctx, programId, asOf)` runs from the sweep (4.9): refreshes the current month (monthly fee on the first active day, setup fees and adjustments that came due) and, for each month that ended since `settled_through`, refreshes that month (the minimum top up) and sets `settled_through` to its last day. Months that are locked are skipped and still count as settled. Reads never write; a summary that sees a due charge not yet in the ledger schedules `settleDue` after the response and shows the ledger.

#### 4.3.3 Output, posting and job links

`logOutput(ctx, key, { date, entries, endOfDay? })`, one transaction for the batch:

1. `assertOpen(date)` for each entry (with `goesToJob` from the build's current posting).
2. `SELECT ... FROM pm.program_settings WHERE program_id = $1 FOR SHARE`, then `SELECT ... FROM pm.builds WHERE task_id = ANY(...) ORDER BY task_id FOR UPDATE` (sorted, so two batches never deadlock).
3. Entries: `{ buildId, mode: 'add' | 'set', qty, scrapQty?, note?, markDone?, expectedVersion? }`, or `{ newBuild: { variantId, title? }, qty, scrapQty?, note? }` ("Add a row": makes a build in that container dated `date` with `planned = qty`, `unplanned = true`, `planned_from = 'unplanned'`, a todo status and auto done when `auto_done_when_full`). Mode `add` writes `INSERT INTO pm.build_output (...) VALUES (...) ON CONFLICT (build_id, work_date) WHERE deleted_at IS NULL DO UPDATE SET qty = build_output.qty + EXCLUDED.qty, scrap_qty = build_output.scrap_qty + EXCLUDED.scrap_qty, version = build_output.version + 1`. Mode `set` needs `expectedVersion` (`UPDATE ... WHERE id = $1 AND version = $2`, or an insert when the row does not exist and `expectedVersion` is null). A unique violation or a zero row update maps to `CONFLICT` for that entry.
4. Price and posting: `resolveUnitPrice` with the versions in force (read under the `FOR SHARE` lock, so a concurrent publish waits) and, when the posting is a job, `getJobPriceRows` read once per job per batch. Write the snapshot (M4). `pm.builds.built_qty = built_qty + delta`, `scrap_qty = scrap_qty + delta`.
5. Status: auto start; mark done (the finish trigger sets `finished_on`).
6. `endOfDay.decisions` (the "Close the day" step): `close_short` (reason required), `move_rest` (`splitBuild` to the given day, default `nextWorkDay`), or `leave_open`, applied in the same transaction.
7. `refreshLedgerFor(program, month of date)`; activity `build.output_logged` per build with before and after qty (money only under `after.money`); after commit one `pm_program_changed` event; returns the new sheet plus `undo` (the before values) and `createdBuildIds`.

`linkPulseJob(ctx, target, jobId)`: reads `getJobFacts` (live, model, kind, work order feed, typed units in open months, current program) and runs `canLinkJob`; writes the `bills_to` edge (the indexes refuse a second job or a second program with `TAKEN`); updates `posting` and `pulse_job_id` on open output rows of the program (or the build) whose posting changes, re resolving `job` priced rows; refreshes the ledger for open months; emits `pm_program_changed`. Locked rows keep their posting. When the job's site time zone differs from the program's, the link succeeds and Pulse shows the note in 6.1. `unlinkPulseJob` removes the edge, moves open rows to `program` (or `unbilled` for a build outside a program), refreshes the ledger, and emits the event so Pulse removes its open rows (6.1 step 4).

A job that is no longer live behind an edge: `postingTarget` resolves to the program (or unbilled); the next write re posts open rows; the summary raises `pulse_out_of_sync` with "Pulse job J-1040 was deleted. Revenue now stays in this program." and the action "Remove link".

#### 4.3.4 Locks and month close

`assertOpen(ctx, program, date, { goesToJob })` refuses when `date <= locked_through`, or when `goesToJob` and the month of `date` is in Pulse's closed months. It runs on: log, edit and delete output; build date moves into or out of a locked day; variant, override, container and posting changes on builds with output on locked days ("This build has output in a closed month. Make a new build instead."); build delete with locked output; time entry create, update and delete on a program or job billed build; moving a task with time into or out of a program; card versions starting on or before a locked day; one time charge writes; program start or end date edits that would change a locked month; a program time zone change once a locked month holds time or output; program deletion with locked rows. Locked rows are never repriced, re posted or deleted.

Month close (`closes.ts`, owners; the action `program:close`):

- `getCloseChecklist(month)`: the month has ended in the program time zone; every month before it is closed (or before the start); no open builds dated in the month (each listed with "Close short", "Move the rest" or "Cancel"); no units with no price (`unpricedUnits = 0`, else "120 kits have no price"); the ledger is settled for the month; adjustments reviewed (a checkbox the owner ticks, listing the month's adjustments); Pulse parity for the month when a job is linked (shown, not required).
- `closeMonth`: re checks the list, refreshes the ledger for the month one last time, writes `pm.program_closes` (total and units from `readProgramMonth`), sets `locked_through` to the month end, activity `program.month_closed`, emits `pm_program_changed`.
- `reopenMonth(reason)`: only the latest closed month; sets `reopened_*`, moves `locked_through` back to the end of the month before (or null), activity `program.month_reopened` with the reason.

#### 4.3.5 Finish, cancel and batch charges

- `finished_on` follows the status through the trigger (2.2.1). The batch charge exists only in the ledger and only when `built_qty > 0` and the build is not cancelled.
- Re finishing in an open month charges on `first_finished_on` (the first finish day), unless the person picks "Charge on the new date" in the done confirmation, which sets `first_finished_on` to today first.
- Leaving done when the charge is on a locked day: allowed; the ledger row stays; the drawer tip says "The batch fee for Oct 30 stays because October is closed."
- Cancel: per unit output and its revenue stay; no batch charge; the cancel dialog says "Cancel build · keeps logged output, stops the batch fee".

#### 4.3.6 Deleting and restoring

- Delete build: refused with locked output (cancel instead); else soft deletes its open output in the same transaction, refreshes the ledger, emits the event. Every reader of output (summary, the shared loader, pm-bridge, Pulse) joins `pm.tasks` and `pm.projects` with `deleted_at IS NULL`.
- Restore build: brings back only output rows whose dates are still open.
- Delete program: refused when any output or ledger row is locked; soft deletes the project row, its open output and open ledger rows; removes its `bills_to` edges; Pulse sync then removes the program's open `pmb` and `pmf` rows and skips the deleted program (6.1).

#### 4.3.7 Program dates and status

- `start_date` and `due_date` live on `pm.projects`; `updateProgram` edits them with `assertOpen` on every day whose fixed charges would change, then refreshes the ledger for the open months between the old and new dates.
- Pause: `paused_ranges` gains `{ from: today, to: null }`; active schedules pause; the person chooses "Cancel the {n} planned builds from today on" (default) or "Keep them". Fixed lines with "Charge while paused" off skip paused days. Resume closes the range.
- End: requires an end date (default today in the program time zone) that is open; schedules end with `ends_on` = the end date; the same choice for planned builds after the end date ("Cancel the {n} planned builds after Dec 31" default, or "Keep them"); status `completed`.
- Archive: ends the program first when it has no end date (same dialog), then archives. Archived and ended programs post nothing after their end date because fixed lines stop at `activeTo`.

### 4.4 Price card states, publishing and review

#### 4.4.1 States

| State | Stored | Rule | Editable |
|---|---|---|---|
| Draft | `status = 'draft'` | any start date | lines, rules, start date, label, note |
| Scheduled | `published`, `effective_from > today` | starts later | not edited in place: "Edit" moves it back to a draft (`unpublishVersion`, activity `price_card.unpublished`), then publish again |
| In force | `published`, the version `versionFor(today)` | | never |
| Ended | `published`, a later version is in force | | never |

Lines and rules change only while the version is a draft (one rule in `price-cards.ts`, checked by every line and rule write). Version numbers are given at first publish.

#### 4.4.2 Publish

`publishVersion(ctx, versionId, expectedVersion)` (owners, `pricing:manage`):

1. `SELECT ... FROM pm.program_settings WHERE program_id = $1 FOR UPDATE`.
2. `effective_from` must be after every locked day of the program.
3. Same day fold: when a published version already starts on `effective_from` and no output row and no ledger row references it, the new version replaces it (the old one is soft deleted, activity `price_card.version_replaced`). Otherwise the unique index refuses with CONFLICT "A published version already starts on Nov 25."
4. Set `status`, `number` (first publish only), `published_at/by`; clear `review_status`.
5. Every open output row on or after `effective_from` is repriced in the same transaction (`repriceOpenDays`); there is no option to skip it. The confirm dialog shows the count ("Updates prices on 3 open days from Nov 23") and is the only confirmation.
6. Refresh the ledger for open months from `effective_from`; activity `price_card.version_published` (number, start, line summary under `after.money`, repriced rows); emit the event; notify followers when it starts later.

#### 4.4.3 Pending rate changes from the Variants tab

`setVariantRate(ctx, variantId, { unitPrice | null, startsOn })` (needs `pricing:propose`):

1. `startsOn` defaults to today (program time zone) and must be open.
2. Find or make the pending changes draft for `(program, startsOn)` (`source = 'variant_tab'`, copied from the version in force on `startsOn` with its rules).
3. Set or clear the hand line for the variant in that draft (null removes it, so the variant falls back to rules or the card default).
4. Return `{ versionId, pendingCount, startsOn }`. The Variants tab shows a sticky bar "3 rate changes starting Nov 25 · Review and publish" that opens the price card editor on that draft with the impact preview. Nothing is in force until it is published, so a second and third change on the same day go into the same draft and never make extra versions.

#### 4.4.4 Review

Editors with `pricing:propose` make and edit drafts, and "Ask for review" (`review_status = 'waiting'`, notifies the program owners, chip "Waiting for review"). Owners "Publish" or "Send back" with a required note (`sent_back`, chip "Sent back", note shown on the draft, notifies the requester). Activity `price_card.review_requested`, `price_card.sent_back`.

#### 4.4.5 Impact preview

`CardImpactDTO`:

```ts
interface CardImpactDTO {
  effectiveFrom: IsoDate;
  openDays: { from: IsoDate; to: IsoDate; count: number } | null; // open past days that this publish updates
  lockedDays: { through: IsoDate; reason: 'pulse' | 'program' } | null;
  thisMonth: { beforeCents: string; afterCents: string; deltaCents: string; deltaBp: number | null };
  nextMonth: { beforeCents: string; afterCents: string; deltaCents: string; deltaBp: number | null }; // forecast with recent volume
  byVariant: { variantId: string | null; name: string; beforePrice: string | null; afterPrice: string | null; units: string; deltaCents: string }[];
  minimum: { before: string; after: string; gapBefore: string; gapAfter: string };
  rules: { ruleId: string; text: string; variants: number }[];               // "Size is XL: add $0.25 · 2 variants"
  conflicts: { variantId: string; text: string }[];                          // from compileRateRules
  warnings: ('no_per_unit_line' | 'lower_than_current' | 'starts_in_past' | 'locked_days_keep_old_price' | 'unpriced_variants')[];
}
```

Computed by running `monthCharges` twice (current versions vs versions with the draft applied) over this month and over a synthetic next month made of the recent volume per variant (trailing 20 work days average per variant times next month's work days).

### 4.5 DTOs (`apps/projects/src/lib/program-types.ts`)

```ts
export interface ProgramListItemDTO {
  id: string; key: string; name: string; color: string | null; icon: string | null;
  status: ProjectStatus; health: Health | null; healthBasis: 'money_target' | 'unit_target' | 'plan' | null; healthAuto: boolean;
  customer: { kind: 'core' | 'crm_account'; id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  unit: { singular: string; plural: string };
  variantsCount: number; schedulesActive: number; scheduleText: string | null;
  today: { date: IsoDate; builds: number; done: number; plannedUnits: string; builtUnits: string };
  month: { month: IsoMonth; units: string; revenueCents: string | null; forecastCents: string | null; targetCents: string | null; targetBp: number | null; minimumGapSoFarCents: string | null; projectedGapCents: string | null; linkedJobsCents: string | null };
  sparkline: { date: IsoDate; units: string }[]; // last 30 days
  pulseJob: { id: string; number: string; name: string } | null;
  starred: boolean; archivedAt: string | null; updatedAt: string;
  moneyHidden: boolean;
}
export interface ProgramDetailDTO extends ProgramListItemDTO {
  description: string | null; startDate: IsoDate | null; endDate: IsoDate | null;
  settings: ProgramSettingsDTO; calendar: ProgramCalendarDTO; statuses: StatusDTO[]; members: ProjectMemberDTO[];
  capabilities: ProgramCapabilities; locks: { lockedThrough: IsoDate | null; programClosed: IsoMonth[]; pulseClosed: IsoMonth[] };
  currentVersion: CardVersionDTO | null; nextVersion: CardVersionDTO | null; draftsCount: number; pendingRateChanges: { versionId: string; startsOn: IsoDate; count: number } | null;
  setup: { hasPriceCard: boolean; hasVariants: boolean; hasSchedule: boolean; hasPulseJob: boolean | null };
  links: { crmDeal: LinkedRecordDTO | null; crmAccount: LinkedRecordDTO | null; pulseJob: LinkedRecordDTO | null; count: number };
}
export interface VariantDTO { id; key; name; sku; attributes: Record<string, string>; defaultQty: string | null; packQty: string | null; stdMinutesPerUnit: string | null; materialCostPerUnit: string | null; color; position; status; coreItem: { id; sku; name } | null; wmsProduct: { id; sku; name } | null; currentRate: { unitPrice: string; source: 'variant' | 'card' | 'none'; ruleText: string | null }; monthUnits: string; monthRevenueCents: string | null; version: number }
export interface BuildDTO extends TaskSummaryDTO { kind: 'build'; build: { containerKind: ProjectKind; programId: string | null; variantId: string | null; variantName: string | null; variantColor: string | null; buildDate: IsoDate; plannedQty: string; plannedFrom: PlannedFrom; plannedFromText: string; builtQty: string; remainingQty: string; scrapQty: string; unplanned: boolean; closedShort: boolean; closeReason: string | null; splitFrom: { id: string; key: string } | null; rateOverride: string | null; rateOverrideReason: string | null; currentPrice: { unitPrice: string; source: PriceSource } | null; revenueCents: string | null; posting: Posting; pulseJob: { id: string; number: string } | null; finishedOn: IsoDate | null; batchFeeLocked: boolean; runId: string; scheduleId: string | null; locked: boolean; version: number } }
export interface RunDTO { id: string; programKey: string; date: IsoDate; name: string; scheduleId: string | null; state: Run['state']; builds: number; done: number; cancelled: number; plannedUnits: string; builtUnits: string; revenueCents: string | null; buildIds: string[] }
export interface FloorTodayDTO { date: IsoDate; capacityHours: string | null; programs: { key: string; name: string; unit: { singular: string; plural: string }; runs: RunDTO[]; estHours: string | null; moneyHidden: boolean }[]; totals: { builds: number; done: number; plannedUnitsByUnit: { unit: string; units: string }[]; estHours: string | null } }
export interface OutputSheetDTO { date: IsoDate; locked: boolean; lockReason: string | null; nextWorkDay: IsoDate; rows: OutputSheetRow[]; totals: { plannedUnits: string; builtUnits: string; revenueCents: string | null }; scanIndex: { sku: string | null; variantKey: string | null; buildKey: string; buildId: string; packQty: string }[] }
export interface OutputSheetRow { buildId: string; key: string; title: string; variant: { id: string; name: string; color: string | null; sku: string | null } | null; buildDate: IsoDate; carriedOver: boolean; unplanned: boolean; runId: string; statusId: string; statusCategory: StatusCategory; plannedQty: string; builtBefore: string; builtToday: string; outputId: string | null; outputVersion: number | null; unitPrice: string | null; priceSource: PriceSource; assignee: PersonDTO | null }
export interface ProgramSummaryDTO { month: IsoMonth; asOf: IsoDate; result: MonthResultDTO; forecast: ForecastResultDTO; byVariant: VariantRollupDTO[]; byDay: DayRollupDTO[]; today: TodayDTO; alerts: ProgramAlertDTO[]; pulse: PulseParityDTO | null; linkedWork: LinkedWorkDTO | null; moneyHidden: boolean }
export type ProgramAlertDTO =
  | { kind: 'no_output_yesterday'; date: IsoDate; builds: number }
  | { kind: 'behind_today'; plannedUnits: string; builtUnits: string }        // only after remind_at on a work day
  | { kind: 'minimum_at_risk'; projectedGapCents: string }                   // forecast.projectedGapCents > 0 only
  | { kind: 'unpriced_units'; units: string }
  | { kind: 'no_price_card' }
  | { kind: 'kit_shortage'; variantId: string; sku: string; component: string; shortQty: string; date: IsoDate }
  | { kind: 'version_starts_soon'; versionNumber: number; effectiveFrom: IsoDate }
  | { kind: 'pulse_out_of_sync'; deltaCents: string | null; reason: 'gap' | 'job_deleted' | 'pending' } // owners and admins only
  | { kind: 'over_plan'; buildId: string; buildKey: string; overQty: string; date: IsoDate };   // builds dated in the last 7 days
export interface ProgramWizardPayload {
  start: { mode: 'scratch' | 'deal' | 'template' | 'copy' | 'quick'; crmItemId?: string; templateId?: string; copyKey?: string };
  basics: { name: string; key: string; description?: string; customer?: { kind: 'core' | 'crm_account'; id: string } | null; ownerId: string; startDate: IsoDate; endDate?: IsoDate | null; unit: { singular: string; plural: string }; timezone: string; calendar: { useWorkspace: boolean; workingDays: number[] | null; extraDaysOff: IsoDate[]; extraWorkDays: IsoDate[] }; color?: string; icon?: string; monthlyTargetCents?: string | null };
  variants: { mode: 'matrix' | 'list' | 'paste'; axes: AttributeAxisInput[]; patterns: { name: string; key: string; sku: string | null }; rows: { comboKey: string; include: boolean; name: string; key: string; sku: string | null; defaultQty: string | null; unitPrice: string | null; coreItemId?: string | null }[]; manual: { name: string; key: string; sku: string | null; defaultQty: string | null; unitPrice: string | null }[] };
  priceCard: { later: boolean; effectiveFrom: IsoDate; lines: CardLineInput[]; rules: RateRuleInput[]; oneTime: { label: string; amountCents: string; chargeOn: IsoDate }[] };
  schedule: { enabled: boolean; name: string; pattern: SchedulePattern; days: number[]; intervalWeeks: number; startsOn: IsoDate; endsOn: IsoDate | null; leadDays: number; lines: { variantKey: string; qty: string; qtyByWeekday?: Record<string, string> | null; assigneeId?: string | null }[]; defaultAssigneeId?: string | null };
  links: { crmDealId?: string | null; crmAccountId?: string | null; pulseJobId?: string | null; createPulseJob?: boolean; projectIds?: string[]; members?: { userId: string; role: ProjectRole }[] };
}
export interface ProgramTemplatePayload {
  kind: 'program'; version: 1;
  settings: Pick<ProgramSettingsDTO, 'unitSingular' | 'unitPlural' | 'buildTitlePattern' | 'autoStartOnOutput' | 'autoDoneWhenFull' | 'moneyMinRole' | 'hourlyTimeBasis' | 'remindAt'> & { workingDays: number[] | null };
  attributes: AttributeAxisInput[];
  variants: { key: string; name: string; sku: string | null; attributes: Record<string, string>; defaultQty: string | null; packQty: string | null; stdMinutesPerUnit: string | null }[];
  card: { lines: Omit<CardLineInput, 'id'>[]; rules: Omit<RateRuleInput, 'id'>[] } | null; // no dates
  oneTime: { label: string; amountCents: string; offsetDays: number }[];                     // setup fees, days after the start
  schedules: { name: string; pattern: SchedulePattern; days: number[]; intervalWeeks: number; startOffsetDays: number; endOffsetDays: number | null; leadDays: number; lines: { variantKey: string; qty: string; qtyByWeekday: Record<string, string> | null }[] }[];
}
```

Every DTO with money carries `null` money fields when `moneyHidden` is true. Cents are strings.

### 4.6 Server actions (`apps/projects/src/server/actions/{programs,variants,price-cards,builds,runs,output,imports,schedules,program-links,program-closes,org-calendar}.ts`)

All use `runAction` and return `ActionResult<T>`. Zod schemas live in `actions/program-schemas.ts` (reuse `schemas.ts` pieces). Chatty actions pass `{ revalidate: false }` and invalidate with React Query keys instead.

| Action | Input (zod) | Returns | Revalidate |
|---|---|---|---|
| `createProgramAction` | `ProgramWizardPayload` | `{ key, url, generated: { builds, units, through } }` | layout |
| `saveProgramDraftAction` | `{ id?, title, step, payload, expectedVersion? }` | `{ id, version, savedAt }` | false |
| `deleteProgramDraftAction` | `{ id }` | `{}` | false |
| `updateProgramAction` | `{ key, patch: { name?, description?, ownerId?, startDate?, endDate?, color?, icon?, visibility?, healthOverride? } }` | `ProgramDetailDTO` | layout |
| `setProgramStatusAction` | `{ key, status, futureBuilds?, endsOn? }` | `{ cancelledBuilds: number }` | layout |
| `archiveProgramAction`, `restoreProgramAction`, `deleteProgramAction` | `{ key }` | `{}` | layout |
| `copyProgramAction` | `{ key, name, newKey, startDate, include }` | `{ key, url }` | layout |
| `saveProgramTemplateAction` | `{ key, name, description? }` | `{ templateId }` | false |
| `updateProgramSettingsAction` | `{ key, patch, expectedVersion }` | `ProgramSettingsDTO` | false |
| `updateOrgCalendarAction` | `{ patch, expectedVersion }` | `OrgCalendarDTO` | layout |
| `createVariantsAction` | `{ key, rows, axes?, rates? }` | `VariantDTO[]` | false |
| `updateVariantAction` | `{ id, patch, expectedVersion }` | `VariantDTO` | false |
| `reorderVariantsAction` | `{ key, ids }` | `{}` | false |
| `retireVariantAction`, `restoreVariantAction`, `deleteVariantAction` | `{ id }` | `{}` | false |
| `linkVariantKitAction` | `{ id, coreItemId?, wmsProductId? }` | `VariantDTO` | false |
| `saveAttributesAction` | `{ key, axes, valuesForExisting? }` | `AttributeDTO[]` | false |
| `setVariantRateAction` | `{ variantId, unitPrice, startsOn }` | `{ versionId, pendingCount, startsOn }` | false |
| `createDraftVersionAction` | `{ key, from, effectiveFrom }` | `CardVersionDTO` | false |
| `updateDraftVersionAction` | `{ versionId, effectiveFrom, label, note, lines, rules, expectedVersion }` | `CardVersionDTO` | false |
| `publishVersionAction` | `{ versionId, expectedVersion }` | `{ repricedRows: number; number: number }` | false |
| `unpublishVersionAction`, `deleteVersionAction` | `{ versionId }` | `{}` | false |
| `requestReviewAction` | `{ versionId }` | `{}` | false |
| `sendBackAction` | `{ versionId, note }` | `{}` | false |
| `addOneTimeChargeAction`, `updateOneTimeChargeAction`, `deleteOneTimeChargeAction` | `{ key, kind, chargeOn, amountCents, label, reason?, variantId?, countsTowardMinimum? }` / `{ id, patch, expectedVersion }` / `{ id }` | `OneTimeChargeDTO` / `{}` | false |
| `createBuildAction` | `{ containerKey, variantId?, buildDate, plannedQty, title?, assigneeId?, statusId?, rateOverride?, reason? }` | `BuildDTO` | false |
| `createBuildsAction` | `{ key, rows: [...] (max 500) }` | `{ createdIds: string[]; skipped: { reason, variantId, date }[] }` | false |
| `undoCreateBuildsAction` | `{ ids }` | `{ removed: number; kept: number }` | false |
| `updateBuildAction` | `{ taskId, patch, expectedVersion }` | `BuildDTO` | false |
| `moveBuildAction` | `{ taskId, toContainerKey, variantId? }` | `BuildDTO` | false |
| `splitBuildAction` | `{ taskId, qty, toDate }` | `{ newBuildId }` | false |
| `closeShortAction` | `{ taskId, reason }` | `BuildDTO` | false |
| `duplicateBuildAction` | `{ taskId, to }` | `BuildDTO` | false |
| `copyDayAction` | `{ key, fromDate, toDates, mode }` | `{ createdIds }` | false |
| `cancelBuildsAction`, `restoreBuildsAction` | `{ ids }` | `{ changed: number }` | false |
| `moveRunAction`, `cancelRunAction`, `copyRunAction`, `closeRunAction` | `{ runId, toDate }` / `{ runId }` / `{ runId, toDates }` / `{ runId, decisions }` | `{ changed: number; createdIds?: string[] }` | false |
| `logOutputAction` | `{ key, date, entries, endOfDay? }` | `{ sheet: OutputSheetDTO; undo: UndoToken; createdBuildIds: string[] }` | false |
| `undoLogOutputAction` | `{ key, undo }` | `OutputSheetDTO` | false |
| `deleteOutputAction` | `{ outputId, expectedVersion }` | `{}` | false |
| `previewOutputImportAction`, `commitOutputImportAction`, `previewPlanImportAction`, `commitPlanImportAction` | `{ key, text }` / `{ key, token }` | `ImportPreviewDTO` / `{ created, logged, refused }` | false |
| `createScheduleAction`, `updateScheduleAction`, `pauseScheduleAction`, `resumeScheduleAction`, `endScheduleAction`, `skipScheduleDateAction`, `runScheduleNowAction` | as 4.2 | `ScheduleDTO` / `{ createdIds }` | false |
| `linkRecordAction`, `unlinkRecordAction` | `{ from, to, relation }` / `{ linkId }` | `LinkedRecordDTO` / `{}` | false |
| `linkPulseJobAction`, `unlinkPulseJobAction` | `{ programKey } or { buildId }, jobId` | `{ repostedRows: number }` | false |
| `closeMonthAction`, `reopenMonthAction` | `{ key, month }` / `{ key, month, reason }` | `CloseDTO` | false |
| `postProgramUpdateAction` | `{ key, health, body }` | `ProjectUpdateDTO` | false |

Field errors use the `fields` map so the wizard can send people back to the right step.

### 4.7 HTTP API (`apps/projects/src/app/api/v1/programs/**`, thin calls through `apiRoute`)

| Method and path | Domain call | Notes |
|---|---|---|
| GET `/api/v1/programs?status=&customer=&q=&ids=&owner=&health=` | `listPrograms` | directory, sidebar, palette |
| GET `/api/v1/programs/today?date=` | `floorToday` | Floor today |
| GET `/api/v1/programs/trends?from=&to=&group=&format=json|csv` | `programTrends` / `trendsCsv` | Trends layout; money parts need `money:read` per program |
| GET `/api/v1/programs/drafts` | `listDrafts` | |
| GET `/api/v1/programs/keys/suggest?name=` | `suggestProjectKey` + `takenKeys` | wizard key hint |
| GET `/api/v1/programs/prefill?crmItem=&template=&copy=&customer=` | `wizardPrefill` | |
| GET `/api/v1/programs/templates` | `listProgramTemplates` | wizard gallery |
| GET `/api/v1/calendar` | `getOrgCalendar` | |
| GET `/api/v1/programs/[key]` | `getProgramDetail` | |
| GET `/api/v1/programs/[key]/summary?month=YYYY-MM` | `getProgramSummary` | Overview; staleTime 30s |
| GET `/api/v1/programs/[key]/range?from=&to=` | `getProgramRange` | trend chart, max 24 months |
| GET `/api/v1/programs/[key]/statement?month=&format=json|csv|pdf` | `getStatement` / `statementCsv` / `statementPdf` | `Content-Disposition: attachment; filename="GLOVE-2026-11-statement.csv"` (or `.pdf`); needs `money:read` |
| GET `/api/v1/programs/[key]/report?run=|week=&charges=0|1&format=pdf|csv` | `shareReport` | units only unless `charges=1` and `money:read` |
| GET `/api/v1/programs/[key]/close?month=` | `getCloseChecklist` | |
| GET `/api/v1/programs/[key]/builds?from=&to=&status=&variant=&assignee=&run=&cursor=&limit=` | `listBuilds` | views; default window today minus 14 to plus 14 days |
| GET `/api/v1/programs/[key]/runs?from=&to=` | `listRuns` | |
| GET `/api/v1/programs/[key]/output?date=&run=` | `getOutputSheet` | log dialog |
| GET `/api/v1/programs/[key]/variants?retired=1` | `listVariants` | |
| GET `/api/v1/programs/[key]/attributes` | `listAttributes` | |
| GET `/api/v1/programs/[key]/price-card` | `listCardVersions` | |
| GET `/api/v1/programs/[key]/one-time?month=` | `listOneTimeCharges` | |
| GET `/api/v1/programs/[key]/other-prices` | `otherPricesForCustomer` | read only, retry false |
| POST `/api/v1/programs/[key]/price-card/preview` | `previewVersion` | read only, CSRF checked, body is a draft |
| GET `/api/v1/programs/[key]/schedules` | `listSchedules` | |
| POST `/api/v1/programs/[key]/schedules/preview` | `previewSchedule` | read only |
| GET `/api/v1/programs/[key]/links` | `listRecordLinksFor(pm_program)` | |
| GET `/api/v1/programs/[key]/linked-work?month=` | `allLinkedWork` | |
| GET `/api/v1/programs/[key]/planner-capacity?from=&to=` | `plannerCapacity` | WMS read only, retry false |
| GET `/api/v1/programs/[key]/variants/[id]/kit` | `variantKit` | WMS read only, retry false |
| GET `/api/v1/programs/[key]/activity?cursor=&filter=` | `listProjectActivity` with program verbs | money stripped per 4.10 |
| GET `/api/v1/programs/[key]/pulse` | Pulse parity and job summary (6.1) | sync details only for `seesSync` |
| GET `/api/v1/builds/[id]` | `getBuild` | id is uuid or `GLOVE-212` through `resolveTaskParam` |
| GET `/api/v1/builds/[id]/links` | `listRecordLinksFor(pm_build)` | |
| GET `/api/v1/builds/[id]/shortages` | `buildShortages` | |
| GET `/api/v1/projects/[key]/record-links` | `listRecordLinksFor(pm_project)` | project Linked panel and overview chips |

The existing `/api/v1/tasks/[id]` keeps working for builds (generic task fields).

### 4.8 Client data plumbing

`src/lib/query-keys.ts` adds a parallel prefix:

```ts
qk.programs = (filters?) => ['programs', filters ?? {}];
qk.programsToday = (date) => ['programs', 'today', date];
qk.programTrends = (from, to, group) => ['programs', 'trends', from, to, group];
qk.program = (key) => ['program', key];
qk.programSummary = (key, month) => ['program', key, 'summary', month];
qk.programRange = (key, from, to) => ['program', key, 'range', from, to];
qk.programBuilds = (key, window) => ['program', key, 'builds', window];
qk.programRuns = (key, window) => ['program', key, 'runs', window];
qk.programOutput = (key, date, runId) => ['program', key, 'output', date, runId ?? null];
qk.programVariants = (key) => ['program', key, 'variants'];
qk.programAttributes = (key) => ['program', key, 'attributes'];
qk.programCard = (key) => ['program', key, 'price-card'];
qk.programOneTime = (key, month) => ['program', key, 'one-time', month];
qk.programOtherPrices = (key) => ['program', key, 'other-prices'];
qk.programSchedules = (key) => ['program', key, 'schedules'];
qk.programLinks = (key) => ['program', key, 'links'];
qk.programLinkedWork = (key, month) => ['program', key, 'linked-work', month];
qk.programPulse = (key) => ['program', key, 'pulse'];
qk.programClose = (key, month) => ['program', key, 'close', month];
qk.plannerCapacity = (key, from, to) => ['program', key, 'capacity', from, to];
qk.variantKit = (key, id) => ['program', key, 'kit', id];
qk.buildLinks = (id) => ['build', id, 'links'];
qk.projectRecordLinks = (key) => ['project', key, 'record-links'];
qk.programDrafts = () => ['programs', 'drafts'];
qk.programTemplates = () => ['programs', 'templates'];
qk.orgCalendar = () => ['calendar'];
```

Builds also live under `qk.project(key)` because they are tasks: every build mutation invalidates both `qk.program(key)` and `qk.projectTasks(key)`, and `qk.programsToday(date)`.

`src/lib/hooks/use-programs.ts`: `usePrograms`, `useFloorToday`, `useProgramTrends`, `useProgram`, `useProgramSummary`, `useProgramRange`, `useProgramBuilds`, `useProgramRuns`, `useOutputSheet`, `useVariants`, `useAttributes`, `usePriceCard`, `useCardPreview` (debounced 300ms POST), `useOneTimeCharges`, `useOtherPrices`, `useSchedules`, `useSchedulePreview`, `useProgramLinks`, `useBuildLinks`, `useProjectRecordLinks`, `useLinkedWork`, `usePlannerCapacity`, `useVariantKit` (retry false, staleTime 60s), `useProgramPulse` (retry false, staleTime 30s, refetch every 120s), `useCloseChecklist`, `useProgramDrafts`, `useProgramTemplates`, `useOrgCalendar`. Each accepts `initialData`. Mutations use `useServerAction` with `invalidate: [qk.program(key)]`.

Routes (`src/lib/routes.ts`):

```ts
programs: () => '/programs',
programsToday: (date?: IsoDate) => date ? `/programs/today?date=${date}` : '/programs/today',
newProgram: (opts?: { mode?: 'scratch' | 'deal' | 'template' | 'copy' | 'quick'; crmItem?: string; template?: string; copy?: string; customer?: string; name?: string; draft?: string }) => '/programs/new?...',
program: (key) => `/programs/${key}`,
programTab: (key, tab: ProgramTab) => tab === 'overview' ? `/programs/${key}` : `/programs/${key}/${tab}`,
programBuilds: (key, view: BuildView = 'runs') => `/programs/${key}/builds/${view}`,
build: (key, number) => `/programs/${key}/${number}`,
taskAny: (kind: ProjectKind, key, number) => kind === 'program' ? routes.build(key, number) : routes.task(key, number),
calendarSettings: () => '/settings/calendar',
// ProgramTab = 'overview' | 'builds' | 'variants' | 'price-card' | 'schedule' | 'linked' | 'activity' | 'settings'
// BuildView = 'runs' | 'board' | 'list' | 'table' | 'calendar' | 'timeline'
// Overlay params: ?task=GLOVE-212 (drawer), ?log=2026-11-25 (log output, optional &run=), ?plan=week|day (planner),
//   ?version=<id> (card editor), ?statement=2026-11, ?close=2026-10, ?import=output|plan, ?report=<runId|week>
```

### 4.9 Lazy jobs (no job runner)

`scheduleProgramSweep(orgId)` in `domain/programs/sweep.ts`, the `automation-sweep.ts` pattern: runs in `after()`, throttled to once per 5 minutes per org (in memory map plus `pm.build_schedules.last_run_at`). Callers: program layout loads, the directory loader, Floor today, notification reads (next to `scheduleAutomationSweep`), and the cron route `api/v1/integrations/events/route.ts` (every 5 minutes on Vercel, so it runs with nobody signed in). Steps, each idempotent:

1. Schedule generation: for every active schedule of a running program, `generationWindow` then `occurrences`; insert builds per line with `qtyFor(line, date)`, `planned_from='schedule'`, through `INSERT ... ON CONFLICT ON CONSTRAINT builds_schedule_occurrence_key DO NOTHING` semantics (insert task and builds row in one savepoint per occurrence; on unique violation roll the savepoint back). Titles from `build_title_pattern`. Set `generated_through`. Activity: one `schedule.generated` row per run per schedule `{ dates, count }`, actor kind `system`.
2. Settle: `settleDue` per program (4.3.2).
3. End of day reminder: after `remind_at` program time on a work day (skipped when `remind_at` is null), for builds dated today that are open with no output, one `program` notification to the build assignee (or the program owner): "3 GLOVE builds have no output logged today." Dedupe key `(program, date, user)`.
4. Run triggers: "All builds of a run are done" and "A run is below plan by X% at {time}" automations (5.17) evaluated per run once per day per rule.
5. Job price watch: for programs and builds whose open output rows have source `job`, compare the snapshot with `getJobPriceRows` now; when a job price changed, run `repriceOpenDays` from the change date (open rows only) and refresh the ledger.
6. Minimum watch: on work days after the 15th, when `forecast.projectedGapCents > 0`, one notification per program per week to the owners: "MAHCO may miss its $12,000.00 minimum by $1,240.00 this month." (the projected gap, the same number as the `minimum_at_risk` alert).
7. Version reminder: the day before a published version starts, notify program owners: "Price card v3 for GLOVE starts tomorrow."

### 4.10 Activity verbs and money in activity

Verbs (add to the catalog comment in `activity.ts`): `program.created`, `program.updated`, `program.status_changed`, `program.archived`, `program.restored`, `program.deleted`, `program.copied`, `program.settings_changed`, `program.month_closed`, `program.month_reopened`, `program.update_posted`, `variant.created`, `variant.updated`, `variant.retired`, `variant.restored`, `variant.deleted`, `variant.kit_linked`, `attributes.changed`, `price_card.draft_created`, `price_card.version_published`, `price_card.version_replaced`, `price_card.unpublished`, `price_card.version_deleted`, `price_card.variant_rate_changed`, `price_card.review_requested`, `price_card.sent_back`, `one_time.added`, `one_time.updated`, `one_time.deleted`, `build.created` (kept as `task.created` with `after.kind='build'` for existing readers, plus `build.planned` summary for bulk), `build.updated`, `build.moved`, `build.split`, `build.closed_short`, `build.rate_override_set`, `build.output_logged`, `build.output_deleted`, `build.repriced`, `run.moved`, `run.cancelled`, `run.copied`, `run.closed`, `schedule.created`, `schedule.updated`, `schedule.paused`, `schedule.resumed`, `schedule.ended`, `schedule.generated`, `link.added`, `link.removed`, `program.pulse_job_linked`, `program.pulse_job_unlinked`, `calendar.updated`. Activity text renderers in `src/lib/activity-text.ts` get a sentence for each ("Maya logged 100 kits on Small Brown for Nov 25.").

Money rule: any money value in an activity row lives only under a `money` key (`before.money`, `after.money`, `meta.money`), for example `after: { qty: '100', money: { revenueDeltaCents: '19500' } }`. `activity.ts toDTO` removes those keys when the reader fails `money:read` for the activity's program (batch `seesMoneyFor`). This covers the program Activity tab, the task drawer activity, inbox and home feeds, and the API. Sentences that mention money have a units only form ("Maya changed the XL Brown rate." instead of "... to $2.20").

---

## 5. Projects UI

Visual language is the existing Projects language (pm-ui map): warm cream canvas, white bordered panels (`Panel`, radius xl, shadow xs), 56px top bar, 252px sidebar, Inter, 24px H1, 13px muted subtitles, crimson only for primary buttons, focus rings and stepper accents, neutral gray selected states, token colors only (dark mode flips `data-theme`). Money is right aligned and tabular. Numbers use `formatCents`, `formatQty`, `formatUnitPrice`, `formatPercentBp` from the engine. Every bare number in UI copy has a word next to it ("5 of 8 builds", never "5/8").

Menu rule for every program menu: items are grouped in labeled sections (DropdownMenu `Label`), destructive items sit last under "Danger", and every item that changes money or history has a one line description under its label.

### 5.1 Route map (`apps/projects/src/app/(app)/programs/**`)

| Route | Page component | Title |
|---|---|---|
| `/programs` | `features/programs/directory/programs-page.tsx` (server) -> `ProgramsDirectory` | Programs |
| `/programs/today` | `features/programs/floor/floor-today-page.tsx` | Floor today |
| `/programs/new` | `features/programs/wizard/new-program-page.tsx` -> `NewProgramWizard` | New program |
| `/programs/[key]` | `features/programs/overview/program-overview.tsx` | {name} · Overview |
| `/programs/[key]/builds` | redirect to the last used view (localStorage `ks-programs:builds-view:{key}`), default `runs` | |
| `/programs/[key]/builds/[view]` | `features/programs/builds/builds-view.tsx` (`view` is `runs`, `board`, `list`, `table`, `calendar`, `timeline`) | {name} · Builds |
| `/programs/[key]/variants` | `features/programs/variants/variants-tab.tsx` | {name} · Variants |
| `/programs/[key]/price-card` | `features/programs/price-card/price-card-tab.tsx` | {name} · Price card |
| `/programs/[key]/schedule` | `features/programs/schedule/schedule-tab.tsx` | {name} · Schedule |
| `/programs/[key]/linked` | `features/programs/linked/linked-tab.tsx` | {name} · Linked |
| `/programs/[key]/activity` | `features/programs/activity/program-activity.tsx` | {name} · Activity |
| `/programs/[key]/settings` | `features/programs/settings/program-settings.tsx` | {name} · Settings |
| `/programs/[key]/[number]` | full build page (reuses `TaskDetail` with build sections) | GLOVE-212 · {title} |
| `/programs/[key]/tickets?run=&from=&to=` | `features/programs/reports/build-tickets-page.tsx` (print layout, no shell) | {name} · Build tickets |
| `/settings/calendar` | `features/settings/work-calendar.tsx` | Work calendar |

`programs/[key]/layout.tsx`: cached `loadProgram` (`requireProgram` read), seeds `ProgramProvider` (program detail, statuses, variants, capabilities) and `ProjectProvider` (so shared views and the drawer work), records the visit (`recordVisit(ctx, 'project', id)`), and kicks `scheduleProgramSweep`. It seeds builds for the window today minus 14 days to plus 14 days only (not every build). The `(app)/layout.tsx` pre check returns a real 404 for unknown keys and for keys of `kind='project'` on `/programs/...` (and `/p/KEY` for a program redirects, 4.1). Page `params` and `searchParams` are awaited. `/programs/today` is a static segment and wins over `[key]` (keys are upper case, so no clash).

### 5.2 Shell integration

Sidebar (`features/shell/sidebar.tsx`):

- `primary[]` gains "Programs" (icon `Repeat2`, href `/programs`) right after "Projects", with a count badge of running programs, and "Floor today" (icon `Factory`, href `/programs/today`) under it when the org has a running program.
- A new section under Starred and above Spaces: heading "PROGRAMS" (SectionHeading), up to 8 running or paused programs ordered by the user's recents then name, each a `ProgramRow` (28px: 18px EntityIcon, name, and on the right today's progress as "5 of 8" in 11px tabular muted text with the tooltip and `aria-label` "5 of 8 builds done today"; when every build is done the text becomes a check icon plus "8 of 8" in success tone). Row hover shows a `+` IconButton "Plan builds" and a `...` menu (Open, Log output, Plan builds, Star or Unstar, Copy link). "Show all programs" link when there are more. The section header has a `+` IconButton "New program" (needs `project:create`). Collapsible state saved in the shell store (`programsOpen`).
- Starred shows starred programs with the program icon (favorites return `kind`).
- Spaces tree continues to show projects only (`listProjects` default kind).

Top bar: the red "New task" button stays. Its split menu (SplitButton) gains "New build" (opens quick add in build mode) and "New program".

Command palette (`features/command/command-palette.tsx`):

- Create group: "New program" (icon Repeat2, keywords program, recurring, kitting), "New build" (opens quick add in build mode), "Log output" (opens a program picker, then the log dialog for today), "Plan builds" (program picker, then planner), "Floor today".
- Go to: "Programs" with chord `G R`, "Floor today" with chord `G F` (also added to `use-shell-hotkeys.ts` and the shortcuts dialog).
- "In {program}" group when the path is `/programs/KEY`: Overview, Builds (each view), Variants, Price card, Schedule, Linked, Activity, Settings, plus actions Log output (O), Plan builds (Shift B), New build (B), Add variants, New price version, This month's statement, Close last month (owners), Import output, Copy program.
- A "Programs" group listing programs (like Projects) with key chips and today's progress text ("5 of 8 builds today").
- Remote search groups add "Programs" and show builds in Tasks with a "Build" badge, the variant and qty ("GLOVE-212 · Small Brown · 60 of 100 kits").

Keyboard shortcuts (added to `SHORTCUT_GROUPS` under a new "Programs" group): `G R` go to Programs; `G F` Floor today; inside a program: `O` log output for today, `B` new build, `Shift B` plan builds; in the log dialog: `/` focuses "Scan or type a SKU", `Enter` next row, `Shift Enter` previous row, `=` in a qty cell fills the remaining qty, `Mod Enter` save, `Esc` close (asks to keep or discard unsaved rows); in the planner: arrow keys move between cells, `Mod D` fill right, `Mod Shift D` fill down, `Delete` clears, `Mod V` pastes a block from a spreadsheet, `Mod Enter` create builds. No tab number shortcuts (keeps the set small).

Home (`features/home`): a "Programs today" card (when the user can see any program) listing each running program with today's runs ("Weekday glove run · 5 of 8 builds · 560 of 800 kits"), and a "Log output" button; "Open Floor today" link; empty when no program runs today ("No builds today"). Getting started gains "Set up a program" as an optional item when the org has none and the user can create projects.

Search page (`features/search`): a Programs tab (name, key, customer, variant SKUs); builds in Tasks with the Build badge.

### 5.3 Programs directory (`/programs`)

Layout: `Page` width default 1240. Title "Programs". Subtitle (13px muted, inline counts): "4 running · 1 paused · {total} this month · 1 below target" (money parts hidden without money access; the numbers come from `listPrograms`). Actions: secondary "Floor today", secondary "Log output" (opens program picker) and primary "New program" (split button; menu with descriptions: "From scratch", "Quick setup · one page", "From a won CRM deal" (shown when CRM is entitled), "From a template", "Copy a program", and "Resume a draft" with a count when drafts exist). Each menu item opens `/programs/new?mode=...`, which skips the Start step.

Drafts strip: when the user has drafts, a slim sunken strip under the header: "You have 2 program drafts" with chips (title, "Step 3 of 6", saved "2 days ago") that resume, and a "..." per chip with Delete.

Filter row (one 32px row, ToolbarButton style): search input w-64 "Search programs" (name, key, customer, variant SKU); a "Filter" button that opens Linear style chips: Customer (core customers and CRM accounts), Status (Running, Paused, Setting up, Ended, Archived; default Running, Paused, Setting up), Health (On track, At risk, Off track), Owner, Starred. Active filters show as removable chips with "Clear filters". Right side: layout toggle (Cards, Table, Trends), sort select (Name, Revenue this month, % of target, Today's builds, Updated), direction toggle. Prefs saved under `ks-programs:directory`.

Saved views: the "All programs" saved view menu (SavedViewsMenu pattern, scoped to org, stored as `pm.saved_views` with `project_id` null and `surface = 'programs'`): Save view, Save as new, Rename, Set as my default, Share with workspace (editor), Delete.

Program card (`ProgramCard`, article rounded-xl border-subtle bg-panel p-4 shadow-xs, hover lift 1px):

- Row 1: 36px EntityIcon, name (16px semibold), key in font-key muted, star IconButton, status pill (Running green subtle, Paused warning subtle, Setting up neutral, Ended neutral outline).
- Row 2: customer chip (CRM or core mark), unit label "kits", schedule text "Every weekday".
- Row 3: KPI strip of 3 metrics (12px muted label over 20px semibold tabular value): "This month" revenue (or units when money is hidden), "Forecast" with a target chip (`105% of target` success, `92% of target` warning, `81% of target` danger; without a target, a health chip with its basis tip), "Today" ("5 of 8 builds" plus ProgressBar sm).
- Row 4: 30 day units sparkline (LineChart mini, chart-1, no axes, a dashed daily target line when set), with an accessible label "Units per day, last 30 days".
- Footer: owner avatar, Pulse job chip "J-1040" when linked, a minimum chip only when the projected gap is above 0 ("May miss minimum by $1,240"), last updated.
- Card menu (`...`), sections: Work (Open, Log output, Plan builds, Floor today), Money (Price card, This month's statement), Program (Copy program, Save as template, Star or Unstar, Copy link, Pause or Resume), Danger (Archive, Delete: owner, ConfirmDialog typed key).

Table layout (`ProgramTable`, sticky header, 37px rows, row checkboxes, totals footer): columns Name (icon, name, key), Customer, Status, Health (with basis tip), Today (builds done of planned), Units this month, Revenue this month, With linked jobs (optional, hidden by default: program revenue plus related jobs, 5.6), Forecast, Target, % of target, Below minimum so far, Pulse job, Owner, Updated. Sortable headers (SortHeader). Column visibility menu. Totals row sums money, and units per unit label group, never across labels ("{n} kits · {n} packs · {n} orders", values from the seed check). Bulk bar for selected rows: Pause, Resume, Archive, Export CSV.

Trends layout: see 5.19.

States:

- Loading: 6 skeleton cards (or 8 skeleton rows) with the shimmer.
- Empty org (no programs ever): EmptyState size lg, illustration "workspace", title "Run repeat work as programs", text "A program holds the kits you build again and again for one customer, with one price card for all of them.", actions primary "New program", secondary "How programs work" (a 3 step explainer dialog with illustrations and no numbers: "Add the kits you build", "Set one price card", "Log what you build each day").
- No results for filters: EmptyState sm "No programs match these filters" with "Clear filters".
- Error: EmptyState error "Programs did not load" with "Try again".
- Permission limited: viewers see the directory and cards without New program; a hint under the title "You can view programs. Ask an admin to make you a member to create one."
- Money hidden: money metrics become units; the subtitle drops money.

### 5.4 New program wizard (`/programs/new`)

Pattern: `new-project-wizard.tsx` (WizardSteps at top, max width 760 forms, `animate-step-in`, sticky 320px preview rail on lg, sticky bottom bar on mobile). Steps (labels in WizardSteps):

0. Start
1. Basics
2. Variants
3. Price card
4. Schedule
5. Links and review

Step 0 is skipped (and hidden from the stepper, which then counts 5 steps) when the URL already says how to start: `?mode=`, `?crmItem=`, `?template=` or `?copy=`. `?mode=quick` opens Quick setup (below).

Header right: "Save draft" (secondary, also `Mod S`), saved state text "Draft saved 2 min ago" (autosave 2 seconds after the last change once the name is filled, through `saveProgramDraftAction`), and Close (ghost IconButton; if there are unsaved changes ConfirmDialog "Leave without saving?" with "Save draft", "Discard", "Keep editing").

URL params: `?mode=`, `?crmItem=`, `?template=`, `?copy=KEY`, `?customer=`, `?name=`, `?draft=` (resumes a draft at its step). Prefill comes from `GET /api/v1/programs/prefill` on the server page and is DERIVED into initial state (same rule as the project wizard: inputs fall back to prefill values until edited).

Live preview rail (all steps after Start, lg screens; on md and smaller it becomes a collapsible "Preview" panel above the footer):

- Program chip: icon, name, key, customer.
- "Projected month" card: big number (Bebas Neue 32px numerals) from engine `projectMonth` for the next full month (schedule lines times occurrences, the card, fixed lines and setup fees); below it a stacked bar of Work charges, Monthly fee, Minimum top up, and the line "Based on 22 work days in December" (the GLOVE example: $36,920.00, E32). When the schedule is off: "Add a schedule to see a projection" and the card shows the rates only. When prices are set later: "Add prices to see revenue" and the card shows units only ("17,600 kits in December").
- Variants mini list (first 6 with color dot and rate, "+2 more").
- Checklist with green checks: Name and key, Customer, Variants, Price card, Schedule, Links (optional ones say "Optional"; "Price card" says "Later" when skipped).

Footer (border-t pt-5): ghost "Back" left; right side: secondary "Skip" on optional steps (Schedule, Links), primary "Continue" (or "Create program" on the last step, loading state "Creating program"). `Enter` in a single line field moves to the next field, not the next step. Validation runs on Continue; errors show inline (Field error) and the first invalid field gets focus; the step header shows a red count "2 to fix". Server field errors send the user back to the owning step (`fields` key prefix `basics.`, `variants.` and so on).

#### Step 0 Start

Four large radio cards in a 2 by 2 grid (sm: 1 column), each 96px tall with icon, title and one line:

- "Start from scratch" · "Set up variants, rates and a schedule yourself."
- "From a won CRM deal" · "Use the deal's customer, value and rates." (hidden when CRM is not entitled; disabled with the tip "No won deals yet" when none exist). Picking it opens an inline searchable list (RecordPicker over CRM deals filtered by `isWonStage`, newest first, showing account, value, close date and a "Has a program" chip when a program already links to it, with the tip "This deal already has a program: GLOVE").
- "From a template" · "Start from a saved program template." Shows the program template gallery (`pm.templates` with `kind = 'program'` only) with a micro preview of variants and the card summary. Empty: "No program templates yet. Save a program as a template from its menu."
- "Copy a program" · "Copy variants, rates and schedules from another program." Shows a program picker; then checkboxes: Variants (on), Price card (on), Schedules (on, copied as paused), Members (on), Links (off).

Under the grid: "Quick setup" text link ("Name, kits and one rate on one page") and "Resume a draft" when drafts exist. "Continue" is enabled when a mode (and its pick) is chosen.

#### Quick setup (`?mode=quick`)

One page, max-w 760: Program name and Key; Customer; "What do builds count?"; a "Paste your kits" box (the Paste a list mode of Step 2, with its found matrix shown inline) or "Add kits one by one"; one "Price per {unit}" field with "Set prices later" link; "Make builds every work day" switch with "How many of each" (default 100). Primary "Create program". Every other setting takes its default (workspace calendar, start today, no fees, no links). A "Use the full setup" link moves everything typed into the 6 step wizard.

#### Step 1 Basics

Form, max-w 760:

- "Starting from" summary card when mode is not scratch (deal: "Gripwell Safety Supply · Glove kitting program · $386,400 · Won Sep 2" with Change).
- AppearancePicker (44px) next to Field "Program name" (size lg, required, 1 to 80 chars, no placeholder; hint "For example Glove kitting") and Field "Key" (font-key, required, `^[A-Z][A-Z0-9]{1,5}$`, auto suggested from the name with `suggestProjectKey`, live hint "Build ids: GLOVE-1, GLOVE-2", live check against taken keys: "GLOVE is taken by the project Glove research. Try GLOVK.").
- Field "Customer" (Combobox over core customers and CRM accounts, grouped "Customers" and "CRM accounts", each with its app mark; "No customer" option; optional). When a CRM account is picked and a core customer links to it, both are stored.
- Field "Description" (Textarea, optional).
- Two column grid: "Owner" (UserPicker, default me), "Starts" (IsoDatePicker, required, default today), "Ends" (IsoDatePicker, optional, hint "Leave empty for an ongoing program"), "Time zone" (Select of IANA zones grouped by region with search, default the workspace zone).
- Field "What do builds count?" (ToggleGroup: Kits, Orders, Units, Packs, Boxes, Custom; Custom reveals two inputs "One" and "Many", e.g. "case" and "cases").
- Field "Work days": switch "Use the workspace calendar" (on; shows "Mon to Fri · 2 holidays" with "Edit workspace calendar" for admins). Off reveals 7 day chips Mon to Sun. Under it "Days off for this program" and "Extra work days" (date multi pickers, optional).
- Field "Monthly revenue target" (currency input, optional, hidden without money access) with hint "Used for the % of target and health."

Validation: name required; key format and free; start date required; end on or after start; at least one work day.

#### Step 2 Variants (the variant generator)

Top: segmented control "Make a matrix" (default), "Paste a list", "Add one by one".

Make a matrix:

- Attribute editor: up to 4 attribute rows. Each row: name input ("Size"), value chips input (type and Enter adds; each chip shows label and its code in font-key, click to edit label, code and color; drag to reorder; x removes), and a row menu (Rename, Move up, Move down, Remove). "+ Add attribute" button. Quick presets menu "Use a preset": Sizes S M L XL, Sizes XS to XXL, Colors (Black, White, Brown, Yellow, Red, Blue), Left and Right. Codes come from `suggestCode` and stay editable.
- Patterns row (collapsed under "Names and SKUs" disclosure, open by default the first time): "Name" pattern input (default `{Size} {Color}`), "Key" pattern (default `{Size.code}-{Color.code}`), "SKU" pattern (default `{program}-{Size.code}-{Color.code}`, can be cleared). Token chips under the inputs insert tokens at the cursor ("{Size}", "{Size.code}", "{Color}", "{Color.code}", "{program}"). Live example "Small Brown · S-BRN · GLOVE-S-BRN".
- Matrix preview: when there are exactly 2 attributes, a grid with the first attribute as rows and the second as columns (row and column headers sticky). Each cell is a variant card (120 x 72): include checkbox, name, SKU (font-key, 11px), default qty input, rate input (empty shows the rate the card will give it, e.g. "$1.95 card"). Clicking a row header selects the row; clicking a column header selects the column; a selection toolbar appears above the grid: "Set qty", "Set rate", "Include", "Leave out". With 1, 3 or 4 attributes the preview is a table with one row per combination (columns: include, name, key, SKU, default qty, rate, kit match).
- Rate rules (under the matrix, "Rates by attribute"): rows "{Attribute} is {value}" then "Add $" or "Set $" and an amount ("Size is XL · Add $0.25"). "+ Add a rule". The cells show the result live ("$2.20 · rule"). A typed cell rate beats rules and shows "typed". Conflicts from `compileRateRules` show inline ("Two rules set a price for XL Yellow.").
- Conflict states from `findConflicts`: a red outline and tip "Another variant already uses GLOVE-S-BRN".
- Kit matching (only when the program has a core customer): a "Match kits" button tries `core.items` SKUs equal to the generated SKU for that customer; matched cells show a green "Kit found" chip with the item name; unmatched show nothing. A manual "Link kit" per variant opens an item picker (core items for the customer, filtered `is_kit`).
- Footer summary: "8 variants · 800 kits per run at default qty".

Paste a list:

- A large textarea "Paste SKUs or a sheet" with the help "One SKU per line, or rows copied from a spreadsheet with a header row." and a "Separator" select (Auto, Dash, Underscore, Slash, Space) for SKU lists.
- Live result from engine `inferAxes`: "Found 2 attributes and 8 kits" with the axes as editable rows (name input, value chips with labels and codes; SKU mode names start as "Part 1", "Part 2" with a nudge "Name these, for example Size and Color"), the matrix preview above, and an "Could not read" list for unmatched lines with the reason. "Use these kits" moves the result into the matrix mode so it can be refined.

Add one by one: a table editor with rows (name, key, SKU, default qty, rate) and "+ Add variant".

Validation: at least one included variant; names, keys and SKUs unique; default qty greater than 0 when set; rates are dollars with up to 4 decimals; no rule conflicts.

Rates and rules entered here become the first card version (A3).

#### Step 3 Price card

Layout: form left (max-w 760), the rail shows the projection.

- Field "Starts" (date, default the program start date, cannot be before it).
- Section "Work charges" (each line is a row with a Switch to turn it on, the amount input, and a short help line):
  - "Per {unit}" (on by default): "$ per kit" input, required when on. Under it a collapsible "Rates by variant" table listing variants with the rates and rules from step 2 and editable cells (blank means the card rate).
  - "Per batch": "$ each time a build is marked done". Help: "Charged once each time a build is marked done." The statement line reads "Batch fee · GLOVE-212". "Name on statement" lets ECOMM call it something else.
  - "Per hour": "$ per hour". Help: "Charged for billable time logged on this program." with a "Count all time" checkbox (`hourly_time_basis = 'all'`).
- Section "Fixed":
  - "Monthly fee": amount, Switch "Charge part of it in a partial month" (on), Switch "Charge while paused" (on).
  - "Setup fee": amount and "Charge on" date (default the start date). "+ Add another setup fee". Help: "Setup fees are charged once on their date. New price versions never charge them again."
- Section "Minimum":
  - "Monthly minimum": amount, the same two switches. Help: "If work charges are lower than this, a minimum top up brings the month up to it after the month ends."
- Labels: each line has an optional "Name on statement" input behind a small pencil link.
- When the start mode is a CRM deal: a callout "From the deal: $386,400 over 12 months is about $32,200 a month." with "Use as monthly minimum" and "Use as target" buttons, plus any rate columns the deal has (unit price, monthly fee, setup fee, monthly minimum) already filled and marked with a "From deal" chip. When the deal currency differs: the callout says "This deal is in EUR. Type the rates in USD." and nothing is filled (`dealPrefill`).
- Live math table under the form: "One run of every variant earns $1,610.00" and "A month at this schedule earns about $36,920.00 · Based on 22 work days in December", recomputed by `projectMonth` on every change (no server call).
- "Set prices later" (ghost button, bottom left): skips the step; the program is made without a card version, the Overview shows a setup checklist card "Add a price card" and the `no_price_card` alert, and output is stamped "No price" until a version is published (which then updates the open days).

Validation: at least one line on (unless later); per unit amount when on; amounts 0 or more with at most 4 decimals for rates and 2 for money; minimum greater than 0 when on.

#### Step 4 Schedule (optional)

- Switch "Make builds on a schedule" (on by default for scratch, deal and template; copy mode follows the source).
- Field "Name" (default "{Program} run"). This is the run name everywhere.
- Field "Repeats" (Select): Every day, Every work day (uses the work days from step 1), On certain days (reveals day chips), Every few weeks (reveals interval stepper 1 to 12 and day chips).
- Fields "First day" (default start date), "Last day" (optional), "Make builds ahead" (stepper 0 to 60 days, default 7, hint "Builds from today through the next 7 days are made for you."), Switch "Skip days off" (on).
- "What to build each time": a table of variants (from step 2) with an include checkbox, qty (default from the variant's default qty), a "Vary by day" toggle per row that opens a 7 column qty row (Mon to Sun, blank means the row qty; non work days dimmed), and assignee (UserPicker, optional). Header buttons: "Same qty for all" (popover with a number), "Use default qty".
- Preview: a 2 week mini calendar (Mon to Sun columns) with dots per occurrence and the text "Next 5 runs: Wed Nov 25, Thu Nov 26 skipped (Thanksgiving), Fri Nov 27, Mon Nov 30, Tue Dec 1" from `occurrences`, and the generation count from the same window the server will use: "40 builds and 4,000 kits in the next 7 days" (GLOVE example: Nov 25 to Dec 2 has 5 work days).

#### Step 5 Links and review

- "People": member picker with role select (Owner, Editor, Commenter, Viewer), creator is owner. A note under it: "Only members at Editor or above see money. Change this in Settings."
- "CRM" (CRM entitled): deal picker (prefilled from the start), account picker (prefilled from the customer). Each pick shows a RecordChip.
- "Pulse" (Pulse entitled and the user can manage jobs in Pulse): radio "Do not link a job" (default), "Link an ongoing job" (picker of ongoing per unit Pulse jobs for the customer's Pulse client, refusing others with the `canLinkJob` reason inline), "Make a new Pulse job" (after create, a deep link to Pulse `newJobFromProgram` prefilled, see 6.1; the program saves first). Help: "Build output and fees go to this job, so Pulse can show cost and margin." When Pulse is not entitled: a muted card "Add Pulse to see labor, cost and margin for this program." with "Learn more" only when `notInPlan` says it can be bought.
- "Projects": link related projects (multi select of projects).
- Review panel: a read only summary with "Edit" links per step: basics, variants (count and list), card (lines and rules, or "Prices later"), schedule (rule text), links. Checkbox "Open the build planner after I create it" (default on when no schedule) and checkbox "Bring in past output after I create it" (default off; for programs that start mid contract).
- "Create program" runs `createProgramAction`. On success: toast "GLOVE is ready. {n} builds were planned for the next {lead} days." built from the returned `generated` counts (no schedule: "GLOVE is ready."), with "Open"; route to `/programs/GLOVE`; draft deleted. On failure: toast error with the message and the wizard stays (fields sent back to their step).

Permission fallback: without `project:create`, the wizard shows the same fallback panel as the project wizard ("Ask an admin to let you create programs").

### 5.5 Program workspace frame (`features/programs/frame/program-frame.tsx`)

Clone of `ProjectFrame` with program content:

- Header (bg-panel border-b px-6 pt-4): 32px EntityIcon, H1 name, star IconButton, program status pill, health badge (auto, with the basis tip; a "Set by hand" badge when overridden).
- Meta line (12px muted, middle dots): `GLOVE` (font-key) · customer chip · "kits" · schedule text "Every weekday" · "Card v2 since Nov 1" · lock chip when a month is closed ("Closed through Oct 31", tooltip with which app closed it).
- Header right: compact KPI pair (only md and up): "This month $29,970.40" and "Today 5 of 8 builds", each a link to Overview sections; AvatarGroup md; secondary "Plan builds" (Shift B); primary "Log output" (O); `...` menu.
- `...` program menu (DropdownMenu, labeled sections, icons):
  - Create: "New build" (B), "Add variants", "New price version".
  - Statement: one row per month (This month, Last month, then "Pick a month"), each row with a View icon and a CSV icon and a PDF icon on the right, plus "Close {last month}" for owners when it is not closed.
  - Connect: "Link Pulse job" (or "Open Pulse job J-1040" and "Remove Pulse link").
  - Program: "Copy program", "Save as template", "Post an update", "Pause program" or "Resume program", "End program" (description "Sets an end date. You choose what happens to planned builds.").
  - Danger: "Archive", "Delete" (owner, description "Only when no month is closed").
- Overlays: `?log`, `?plan`, `?import` and `?report` open on any program page (host in `app-shell.tsx`). Statement and month close sheets belong to the Overview, so their menu rows link to `/programs/KEY?statement=YYYY-MM` and `/programs/KEY?close=YYYY-MM`.
- Tabs (ProjectTabs overflow pattern with More menu): Overview (LayoutDashboard), Builds (Boxes), Variants (Shapes), Price card (Receipt; a dot when a pending rate change or a draft waits for review), Schedule (CalendarClock), Linked (Link2), Activity (Activity), Settings (Settings2, only with `project:update`). Active tab underline crimson 2px.
- Under the tabs on Builds pages: the range bar (5.7).

### 5.6 Overview tab

Answers "are we OK today and this month" first. Grid lg `[1.65fr 1fr]`, max-w 1240, gap 16.

Top: Alerts strip (full width, only when there are alerts). Up to 3 alerts in one row of compact cards (icon, sentence, one action), sorted by severity; "See all {n}" opens a popover with the rest. Sentences: "No output logged yesterday for 3 builds" (Log output), "Behind today: 560 of 800 kits" (only after the remind time; Log output), "May miss the minimum by $1,240.00" (projected gap only; View forecast), "120 kits have no price" (Open price card), "No price card yet" (Add a price card), "Short 120 of GLV-LINER for tomorrow's XL builds" (View kit), "Price card v3 starts Jan 1" (View), "GLOVE-{n} is 12 kits over plan" (Open). Sync alerts ("Pulse is $12.40 off from Projects", "Pulse job J-1040 was deleted") show only to program owners and org admins; others see "Pulse is catching up" only after a gap has lasted 10 minutes, else nothing. For the seed on 2026-11-25, GLOVE shows exactly one alert: the Nov 20 Small Brown build 12 kits over plan.

Setup checklist card (only while something is missing, above the KPI row): "Finish setting up GLOVE" with rows Add variants, Add a price card, Add a schedule, Link a Pulse job (when entitled), each with its action; dismiss after all are done.

Left column:

1. KPI row (Panel without header, 4 metrics, 12px label over 24px semibold tabular value, a line under each in 12px):
   - "Revenue this month" $29,970.40 · "up 27% vs last month at this point" (success or danger tone).
   - "Built this month" 14,172 kits · "Avg 801 a work day".
   - "Forecast" $33,708.40 · chip "105% of $32,000 target" · tag "Based on planned builds" or "Based on recent days" with a popover "How we got this" listing actual, remaining work days, average per day, planned builds, fees and the minimum.
   - "Minimum" "Met" (success), or "Below minimum by $1,529.60 so far" with the line "on track to meet it" (neutral) when the projected gap is 0, or "May miss it by $1,240.00" (warning) when the projected gap is above 0, or "Not set".
   Units only mode (money hidden): Built this month, Builds done, Today, % of daily target.
2. "This month" chart Panel (header: title, month picker `<` Nov 2026 `>`, metric toggle Revenue or Units, legend): `LineChart` with cumulative actual (chart-1 solid), ONE forecast line from today in the chosen basis (chart-1 dashed), the target as a straight line from 0 to the target at month end (warning dashed), and the minimum line (danger dotted) only when a minimum is set. Hover shows a day tooltip: date, units, revenue, cumulative. Screen reader table toggle (existing charts behavior). Below it a `ColumnChart` of daily units with today's column highlighted and planned future columns in a lighter tint.
3. "By variant" Panel: `StackedBars` (one bar per variant, units, colored by variant color) on the left and a table on the right: variant, units, avg price, revenue, share of revenue (ProgressBar), trend sparkline (last 4 weeks). Footer rows "Fixed and one time" (monthly fee, setup fees, adjustments, per hour on program level) and "Total". Clicking a variant filters the Builds tab by that variant.
4. "All linked work" Panel (only when the program has related Pulse jobs): rows "Program $29,970.40", "Other linked jobs $4,200.00" with each job ("J-1077 Liner retool · related"), and "Total $34,170.40". A footnote: "The program's own Pulse job is part of the program, so it is not added again."
5. "Updates" Panel: the project status update composer reused (`features/projects/status-updates-panel.tsx`), with "Post an update" prefilled by `draftProgramUpdate` ("5 of 8 builds done today · $29,970.40 this month · 105% of target") and the health choice; the last 3 updates.

Right column:

1. "Today's run" Panel (header: "Today · Wed Nov 25", actions "Log output" and "Plan tomorrow"): one block per run ("Weekday glove run · 560 of 800 kits · 5 of 8 done" with a progress ring), then rows per build (StatusIcon, variant chip, assignee avatar, ProgressBar of built vs planned, "60 of 100", over plan chip, a kit shortage chip when WMS says short). Clicking opens the drawer. Run actions in the block menu (5.7). Empty: "No builds today" with "Plan builds".
2. "Price card" Panel: current version chip "v2 · since Nov 1", the lines and rules as a compact list ("$1.95 per kit", "Size is XL: add $0.25", "$1,500 monthly fee", "$30,000 monthly minimum"), next version note, pending changes or review chip, buttons "Open price card" and "New version".
3. "Statement" Panel: this month's charges grouped (Per kit, Per batch, Per hour, Monthly fee, Setup, Adjustments, Minimum top up) with totals, "View statement" (sheet), CSV and PDF icons, "Add adjustment" (owners and proposers). Hidden without money access.
4. "Pulse" Panel (Pulse entitled): linked job row (JobRow pattern from `pulse-profit-strip.tsx`: number tag, name, status pill, revenue, cost, profit, margin), parity line "Matches Pulse to the cent" (success) for everyone who sees money; for owners and admins, the gap line "Pulse is $12.40 off. Last sync 3 min ago." with "Sync now" (emits the bridge event); "Open in Pulse". No job: "Link a Pulse job to see labor, cost and margin." with "Link job" (if allowed). Pulse not entitled: hidden.
5. Tabbed Panel "Details · Linked · Activity": Details (owner, customer, unit, time zone, work days and calendar source, start and end, schedules count, members), Linked (first 5 links as RecordChips with "See all"), Activity (last 8 program activity rows with "See all").

Statement sheet (`?statement=2026-11`, SidePanel 720px, mounted by the Overview page): header "GLOVE statement · November 2026", lines table (date, line, qty, rate, amount), group subtotals, total, notes "The minimum top up is added after the month ends.", actions "Export CSV", "Download PDF" and "Print" (print stylesheet hides the shell). For an ended month that is not closed, owners see a primary "Close November" (5.20). A closed month shows "Closed by Maya on Dec 2 · $29,970.40" and "Reopen" (owners, reason required).

### 5.7 Builds tab (shared views)

Views: Runs (default), Board, List, Table, Calendar, Timeline, chosen by a ToggleGroup in the toolbar (also routes). They reuse `features/views` and the view components through a new seam:

- `features/views/task-source.tsx`: `TaskSourceProvider({ tasks, isLoading, error, queryKey, workKind })` and `useTaskSource()`. The existing views call `useTaskSource()`; when no provider is mounted it falls back to `useProjectTasks(project.key)` (projects unchanged). Programs mount a provider backed by `useProgramBuilds(key, window)`.
- `features/views/card-extras.tsx`: `CardExtrasProvider({ renderCardFooter, renderRowCells, extraColumns, extraGroupings, extraFilters, foldBefore })` so board cards, list rows and table columns can show build facts without forking the views.

Toolbar (one 32px row): the view toggle; the Date range control (presets: Today, Yesterday, This week, Next 7 days, Last 7 days, This month, Custom range; drives the server window and the URL param `range`); one "Filter" button (Linear style chips: Variant, Status, Assignee, Labels, Short, Unplanned, Work type (Builds, Tasks, Both; default Builds), Mine); "Display"; and a "More" menu (Import output, Import plan, Export CSV, Print build tickets for the range). Search lives inside Filter as the first chip ("Search builds").

Range bar (under the tabs): when the range is one day, the day strip: left and right day arrows, the day ("Wed Nov 25"), its run summary ("Weekday glove run · 560 of 800 kits · 5 of 8 done"), "Today" button, and "Log output for this day". When the range is longer, the range summary: "Nov 23 to Nov 29 · 40 builds · 3,560 of 4,000 kits". Both read and write the same `range` param.

Display menu additions: Group by (Run, Status, Day, Variant, Assignee, Schedule; default Run for List), Swimlanes (Variant, Day, Assignee), Show (Qty progress, Revenue, Rate, Variant chip, SKU), Order cards by (Day, Variant order, Remaining qty).

Runs view (default, `features/programs/builds/runs-view.tsx`): one expandable row per run, newest day first inside the range, today expanded: progress ring, "Wed Nov 25 · Weekday glove run · 560 of 800 kits · 5 of 8 done", state chip (Planned, Building, Done, Short, Cancelled), revenue when shown, and a run menu: "Log run" (opens the log dialog for that run), "Close run" (the end of day step for that run), "Move run to day" (date picker; refused into closed days), "Copy run to" (date multi picker), "Print build tickets", "Share report", "Cancel run" (description "Cancels every build in this run that has no output"). Expanded rows are the list rows of its builds with inline Built today inputs.

Board: default range Today. Columns are statuses. Done cards dated before the range start, and in long ranges Done cards older than today, fold into one collapsed row at the top of Done: "Done earlier (142)" that expands on click.

Build card (board and list): title row (StatusIcon, title), variant chip (color dot, name), qty line "60 of 100 kits" with ProgressBar sm (success when full, warning when over), badges "Unplanned" and "Closed short" when set, footer (font-key `GLOVE-212`, date, assignee avatar, revenue when shown, lock icon when locked, shortage chip). Card menu (build items first, then the shared task items):
- Build: "Log output", "Set planned qty", "Change variant" (submenu list of variants), "Move to day" (submenu: Today, Tomorrow, Next work day, Pick a date), "Set build rate", "Duplicate" (submenu: Here, To tomorrow, To next scheduled day), "Move to program or project".
- Task items (Assign, Labels, Watch, Copy link).
- Danger: "Cancel build" (description "Keeps logged output, stops the batch fee"), "Delete build" (description "Only when nothing was logged"; hidden when it has output).

Table columns (in addition to the task columns): Variant, SKU, Day, Run, Planned, Planned from, Built, Remaining, Scrap, Rate, Price from (chip: Build rate, Variant rate, Card rate, Job price, No price), Revenue, Revenue goes to, Schedule. Inline editing: Planned (number), Variant (select), Day (date), Built (opens a small popover "Built on {day}" with add or set). Totals footer: planned, built, remaining, revenue.

Calendar: month grid; each day shows a compact stack "8 builds · 800 kits" with a done ratio ring; clicking a day opens a popover listing runs and builds with quick log inputs; drag a build to another day moves it (refused into locked days with a toast). Week view shows builds per variant rows.

Timeline: rows grouped by variant, bars from start to due (multi day builds show length), today line, drag to move dates.

Bulk bar (selection): Log output (opens the log dialog with only these builds), Set status, Set assignee, Move to day, Set planned qty, Change variant, Cancel, Delete. Cancel and Delete toasts have Undo (restore while none of them has new output).

Empty states: no builds in the range "No builds from Nov 11 to Dec 9" with "Plan builds" and "Change dates"; no variants yet "Add variants before you plan builds" with "Add variants".

### 5.8 Build drawer and full page

The existing drawer (`?task=GLOVE-212`) and `TaskDetail` render builds with these changes (owned by L4b in `features/task/**`):

- Header breadcrumb "GLOVE / Builds / GLOVE-212" (or "{Project} / GLOVE-212" for a build in a project).
- Under the title, a "Build" property block (PropertyRow grid): Variant (picker, shows SKU and kit link; hidden outside a program), Day (date), Run (link "Weekday glove run · Wed Nov 25"), Planned (number with unit, and "from Weekday glove run" or "from variant default" in muted text), Built (read only total with a "Log output" link), Remaining, Scrap, Rate (the resolved price and a "Price from" chip; "Set build rate" opens a popover with amount and required reason, then the line "Updates prices on 2 open days: +$15.00"), "Revenue goes to" (chip with the Pulse job, "This program", or "Not billed" in warning tone with the line "This build is not billed anywhere. Move it to a program or bill it to a Pulse job."; link "Bill this build to another job" opens a job picker, permission and `canLinkJob` checked), Schedule ("Made by Weekday glove run" link), Split from (when set).
- "Output" section (SectionHeading with count and "+ Log output"): a table of output days (date, qty, scrap, price, revenue, who, source, note) with inline edit (add or set) and a delete action per row; locked rows show a lock icon and the tip with the reason. When a batch fee sits on a closed day: "The batch fee for Oct 30 stays because October is closed."
- "Kit" section (WMS entitled and the variant links a WMS kit): "Can build 496 · as of 10:42 AM" and shortages for the remaining qty ("Short 120 of GLV-LINER (need 400, free 280)"), with "Open in WMS". Not linked: "Link this variant to a kit to see stock." (link to the Variants tab). WMS not entitled: hidden.
- "Linked" section: the union of links for `pm_build` (record links plus legacy task links), RecordChips with Open and Remove, and "Link a record" (the shared `LinkRecordDialog` with Build, Program, Project, CRM deal, WMS shipment order and Pulse job tabs).
- Recurrence and estimate rows are hidden for builds. Subtasks are allowed (they are tasks).
- Done confirmation for a build whose first finish was earlier in an open month: a small choice "Charge the batch fee on Nov 20 (first finished)" (default) or "Charge on the new date".

### 5.9 Log output dialog (`?log=YYYY-MM-DD[&run=<runId>]`, `features/programs/log-output/log-output-dialog.tsx`)

DialogContent size xl (960px), full screen sheet below 640px. The fastest way to enter a day's numbers for many builds, and to end the day cleanly.

- Header: title "Log output", program chip, date control (`<` Wed Nov 25 `>` with a calendar; future dates disabled; locked dates disabled with tooltip "Locked: October is closed in Pulse"), a "Show" toggle (This run, Today's builds, All open builds; "This run" only when opened from a run).
- Scan bar (first row of the body): input "Scan or type a SKU" (`/` focuses it). A match on SKU, variant key or build key focuses that row's Built today cell and flashes it. With "Count each scan" on (switch beside it, remembered per user), each scan adds 1, or the variant's pack qty, to that row and keeps focus in the scan input. No match: inline "No build today for GLOVE-XXL-RED. Add a row?" which opens Add a row with the variant chosen when the SKU is a known variant.
- Body: a table with sticky header. Columns: Build (status icon, `GLOVE-212`, variant chip, "Unplanned" badge when so), Planned, Built before (other days), Built today (number input, autofocus on the first row, right aligned, `inputmode="decimal"`), Mode (a small segmented "Add" or "Set" per row, default Add when the row already has output today, else Set), Remaining after (live), Scrap (input, collapsed column behind "Show scrap"), Done (checkbox "Mark done", defaults per `auto_done_when_full` when the value fills the plan), Note (icon button opens a one line note popover). Rows carried over from earlier days show a "From Nov 24" chip.
- "Add a row" (under the table): a variant picker (search by name, key or SKU) and a qty; it adds a row badged "Unplanned" that becomes a build with planned equal to built when saved.
- Row helpers: a "Fill" text button per row sets Built today to the remaining qty; `=` key does the same; a header "Fill all" button fills every row to plan (with Undo inside the dialog).
- Footer: live totals "560 of 800 kits today · $1,092.00" (money hidden: units only), a warning line when any row goes over plan ("2 builds will be over plan"), "Cancel", secondary "Save", and primary "Save and close the day" (`Mod Enter` saves).
- "Close the day" step (after "Save and close the day", same dialog, a second pane): lists the builds of that day still below plan. For each: "Close short" (reason required, picks from recent reasons or typed; sets done with `closed_short` and fires `build_done_short`), "Move the rest to {next work day}" (the default for scheduled runs; the date is editable; makes a linked build with the remaining qty and closes the original at its built qty), or "Leave open". Footer: "Back" and primary "Close the day". Everything from both panes is one `logOutputAction` batch.
- Success toast "Logged 560 kits on 6 builds" (plus ", closed 1 short, moved 2" when the day was closed) with Undo (reverts the whole batch using the returned before values and removes builds it made that still have no other output). Conflict rows (someone else changed a Set row) stay open with an inline message "Someone logged 40 more while you were typing. Now 100." and the new value pre filled.
- Unsaved changes on close: ConfirmDialog "Save 3 changes before closing?" (Save, Discard, Keep editing).
- States: loading skeleton rows; no builds that day "No builds on Wed Nov 25" with "Add a row", "Plan builds for this day" and "Show all open builds"; error state with Try again; read only for viewers (inputs disabled, banner "You can view output. Editors can log it.").

### 5.10 Build planner (`?plan=week` or `?plan=day`, `features/programs/planner/build-planner.tsx`)

Full screen dialog (DialogContent size full with a 56px header and a 64px footer).

- Header: title "Plan builds", program chip, range control (ToggleGroup Day, Week, 2 weeks; date arrows; "This week" button), and an actions menu with sections: Fill ("Copy yesterday", "Copy last week", "Apply schedule" (submenu per schedule; fills cells from `qtyFor` for the occurrences in range), "Use default qty" (fills empty cells), "Suggest from history" (the average built per variant per weekday over the last 4 weeks, rounded to the variant's default qty step when set, else to whole units; cells it fills are tinted and say "suggested" until edited)); Bring in ("Paste from spreadsheet" (opens a paste box: rows SKU or variant, columns dates), "Import CSV" (columns date, SKU or variant, qty)); Clear ("Clear all"). Paste and import show a preview of the cells they will fill and a list of unmatched rows with the reason before anything changes.
- Body: a matrix with variants as rows (sticky first column: color dot, name, SKU, default qty) and days as columns (header: weekday, date, total for the day; non work days and days off shaded with their name ("Thanksgiving"); locked days hatched and read only). Cells: number inputs for planned qty of NEW builds; existing builds for that variant and day show as a chip inside the cell ("GLOVE-212 · 100") that cannot be edited here (click opens the drawer). Row end: row total. Footer row: day totals.
- Kit capacity (WMS entitled and the variant links a WMS kit): when the row's planned total over the range (existing plus new) is more than WMS can build, the row's cells get a warning tint and the row total shows a warning icon with the tip "WMS can build 300 · short 120 of GLV-LINER". Read only; nothing is reserved.
- Selection: click and drag selects a block; `Mod D` fills right, `Mod Shift D` fills down, typing a number fills the selection, `Delete` clears, `Mod V` pastes a copied block; a floating mini toolbar on selection: "Set qty", "Add 10 percent", "Clear".
- Right rail (collapsible, 280px): "Summary": new builds count, units, planned revenue (money gated), estimated hours when variants have standard minutes (and against the workspace daily capacity: "62 of 80 hours a day"), by day sparkline, "Assign to" (UserPicker applied to new builds), "Status" (todo statuses), "Title pattern" preview, toggle "One build per variant per day" (on).
- Footer: "Cancel" and primary "Create 40 builds" (`Mod Enter`). Runs `createBuildsAction`; partial skips (a build already exists for that day and variant when "One build per variant per day" is on) are listed in the toast "Created 38 builds. 2 already existed." The success toast has Undo (`undoCreateBuildsAction` on the returned ids; builds that got output, time or comments since are kept and the toast says how many). Success closes the planner and the Builds view refreshes.

### 5.11 Variants tab

- Header row: title "Variants" with count, search, "Show retired" toggle, actions: secondary "Edit attributes" (opens the matrix generator in a dialog with the existing variants marked; new combinations can be added, existing ones are never removed here; adding an attribute while variants exist asks "Value for the 8 existing variants" (required select of the new axis values) and writes it into their attributes; removing an attribute is allowed only when the remaining combinations stay unique, else "Small Brown and Small Brown would match. Keep this attribute or retire one of them first."), primary "Add variants" (menu: Make a matrix, Paste a list, Add one).
- Table (drag handle to reorder, 37px rows): color dot, Name (inline edit), Key, SKU (inline edit), attributes chips, Default qty (inline), Pack qty, Standard minutes (inline, for Workload), Rate (current card rate for the variant with "Price from" chip and the rule text when a rule sets it; click opens "Change rate": amount or "Use card rate", "Starting" date default today, then "Add to changes"), Material cost (money gated, inline), Kit (core item chip or WMS product chip with "Can build 496"; "Link kit" picker otherwise), This month (units, revenue), Status (Active or Retired chip), row menu sections: Edit (Edit, Change rate, Link kit, Unlink kit), Work (Plan builds for this variant, View builds), Danger (Retire or Restore, Delete when no builds).
- Pending changes bar (sticky at the bottom when the pending draft has changes): "3 rate changes starting Nov 25 · Review and publish" (owners) or "· Ask for review" (proposers), plus "Discard changes". It opens the price card editor on that draft with the impact rail.
- Empty: "No variants yet" with "Make a matrix", "Paste a list" and "Add one".
- Kit availability is fetched lazily per visible row (`useVariantKit`), with a small spinner and "as of" time; WMS off: the Kit column shows core item links only and hides capacity.

### 5.12 Price card tab

Two pane layout:

- Left rail (280px): "Versions" timeline list, newest first. Each item: number chip (v3) or "Draft", state chip (Draft, Scheduled "Starts Jan 1", In force, Ended), date range ("Nov 1 to now", "Sep 15 to Oct 31"), label, author, and a review chip when waiting or sent back. The in force version is highlighted with a green left edge. Buttons: "New version" (menu: Copy the current version, Start empty), and per item menu: Open, Duplicate as draft, Edit (Scheduled only; "Moves this version back to a draft so you can change it"), Delete (drafts, or Scheduled versions).
- Main: the selected version. In force and Ended versions are read only with the banner "This version is in force, so it does not change. Make a new version to change rates." and "Copy into a new version". Scheduled versions show "This version starts Jan 1. Edit it to make changes, then publish it again." with "Edit". Drafts are editable:
  - "Starts" date field (min: the first open day; days before today allowed only for owners and only on open days, with the note "Publishing updates prices on open days from Nov 20.").
  - Label and note fields.
  - Line sections as in wizard step 3, plus "Rates by variant" (hand typed rates) and "Rate rules" ("Size is XL · Add $0.25"; copying a version keeps its rules, so changing the default rate moves every rule based rate at once).
  - "Setup fees and adjustments" is not part of a version; a link "One time charges are on the Statement" opens the statement sheet.
- Right rail (320px, sticky): "Impact" from `useCardPreview`: this month before and after with delta and percent, next month forecast before and after, minimum gap before and after, by variant deltas table, rules summary ("Size is XL: add $0.25 · 2 variants"), conflicts, open days count, locked days note, warnings list. Owners: primary "Publish v3" with a ConfirmDialog that repeats the impact numbers and, when the start date is in the past, says "This updates prices on 3 open days from Nov 23." "Save draft" secondary. "Discard draft" ghost danger. Proposers: "Ask for review" instead of Publish; owners see "Send back" (note required) next to Publish on a waiting draft.
- Compare: a "Compare with" select at the top of main (any other version) switches the main area to a two column diff (changed amounts highlighted, added lines in success subtle, removed in danger subtle).
- "Other prices for this customer" (a disclosure under the main area, read only, fetched lazily): WMS billing fees on the client's active contract for VAS and kitting operations (WMS entitled and a client link exists) and Pulse job prices for the program's job and the customer's other ongoing jobs, each row with a mismatch chip against the card in force ("WMS bills $1.85, card says $1.95"). Nothing here can be edited from Projects.

Permission: `pricing:manage` publishes, unpublishes and edits fixed lines; `pricing:propose` makes and edits drafts and asks for review; others see the tab read only; money hidden roles see "Money is hidden for your role." and no amounts.

### 5.13 Schedule tab

- List of schedules (cards): name, rule text ("Every weekday"), lines summary ("8 variants · 800 kits each time", or "8 variants · 800 kits Mon to Fri, 400 on Sat" when a line varies by day), status pill, next 3 runs, made through date ("Builds made through Dec 2"), actions: Edit, Pause or Resume, Skip a date, Run now (makes builds up to the lead window immediately), End, Delete.
- "New schedule" opens the schedule editor dialog (the same fields as wizard step 4, including "Vary by day", plus "Default status").
- Calendar preview below (month view): occurrences dotted per schedule color, skipped days crossed, days off labeled; hovering a day lists what would be built with the qty for that weekday.
- Editing an active schedule shows the option "Also update builds already made after today that have no output" (`regenerateFuture`).
- Empty: "No schedules. Builds are only made when you plan them." with "New schedule".

### 5.14 Linked tab and the project side

- Sections: "Customer" (core customer and CRM account cards), "CRM deals", "Pulse jobs" (program job with "Bills to" badge; related jobs with "Related"; builds with their own jobs listed with counts), "Projects", "Programs", "Builds" (builds linked to builds, and split builds), "Kits and items" (from variant `uses_kit` edges), "WMS" (shipment orders, clients), "Other links".
- Each row is a RecordChip with title, app mark, status (cached), "Open" (sibling app URL), and a menu (Open, Copy link, Remove link). Dangling links show "This record is no longer available" and Remove.
- "Link a record" opens `LinkRecordDialog` (`features/integrations/link-record-dialog.tsx`, extended by L3) with tabs for Customer, CRM deal, CRM account, Pulse job, Project, Program, Build, Item, WMS shipment order (types available per entitlement; Pulse job picks run `canLinkJob` for `bills_to` and allow any job as `related`).
- Legacy link rows (from `pm.integration_links`) show the same and can be removed with the same action.
- Project side: the project Linked panel (`project-overview.tsx LinksPanel`) also reads `core.record_links` for the project and shows linked programs as chips with this month's units ("GLOVE · 14,172 kits this month"); the project Overview Details shows "Programs: GLOVE" when linked. Builds that live in a project show their links in the build drawer.

### 5.15 Activity tab

`listProjectActivity` with a filter menu: All, Output, Prices, Variants, Builds, Runs, Schedules, Links, Month close, Settings, People. Rows use `activity-text.ts` sentences, grouped by day, with before and after values for money (only for people who see money) and qty. Export as CSV (owners).

### 5.16 Settings tab

Sections (Panel each, Save per section with version check):

- General: name, key (change allowed when no Pulse job is linked; warns that old links redirect), description, icon and color, owner, who can open it (Everyone in the workspace, or Only people added), status (Pause, Resume and End open the same dialogs as the menu), start and end dates (refused into closed months with the reason), health (Auto with its basis, or Set by hand).
- Units and calendar: unit labels, time zone (refused once a closed month has time or output: "October is closed, so the time zone cannot change."), "Use the workspace calendar" with its summary, own work days, extra days off, extra work days, build title pattern (with preview), "Start builds when output is logged" switch, "Mark done when full" default, "Remind if no output by" (time picker, default 6:00 PM, or Off).
- Money: monthly target, daily target units, who sees money (Select: Owners only, Editors and owners, Everyone in the program; the help says "Only people added to this program count. Workspace members who are not added see units only."), hours that count for the per hour line (Billable time, All time), currency (display only).
- Month close: the list of months with state (Open, Ready to close, Closed by Maya on Dec 2, Closed in Pulse), "Close {Month}" and "Reopen" (owners, reason required).
- People: members and roles (reuse project members panel).
- Pulse check (Pulse entitled, a job is linked, owners and admins): "This month in Projects $29,970.40 · in Pulse $29,970.40 · Matches" and per variant comparison table; "Sync now"; the time zone note when the job's site zone differs ("J-1040's site uses America/New_York. Days are counted in GLOVE's zone, America/Chicago.").
- Danger zone: Archive, Delete (owner, typed key confirm "Type GLOVE to delete this program").

### 5.17 Quick add, My Work, notifications, automations and forms

Quick add (`features/quick-add`, parser `src/lib/nl-parse-build.ts`):

- Build mode starts when the text begins with "build " or when opened as "New build". Grammar: `build [qty] [variant words] [program word or +KEY] [date words] [@assignee] [!priority]`. Example "build 100 small brown glove tomorrow" -> program GLOVE (word "glove" matches the program name or key), variant Small Brown (best match over variant names, keys and SKUs within that program), qty 100, date tomorrow. "+ECOMM 250 gift fri" works too. A project key (`+FRA`) makes a build in that project (no variant).
- `parseBuildQuickAdd(text, { containers: [{ id, key, name, kind, unit, variants: [{ id, key, name, sku }] }], today })` -> `{ containerId?, variantId?, qty?, date?, assigneeToken?, priority?, segments, unresolved[] }`. Pure, deterministic, unit tested.
- The dialog shows chips for program, variant, qty and date (unresolved ones red with a suggestion list), a "Planned {unit}" field, and saves with `createBuildAction`. "Add another" keeps the program and date.

Builds in projects (`features/views`, project toolbar and task menus): the project "New task" split menu and the project board column `+` menu gain "New build" (title, day, planned units, optional Pulse job); project views gain the Work type chip in Filter (Tasks, Builds, Both; default Both, shown only when the project has builds); build cards in projects show qty progress and "Revenue goes to".

My Work (`features/my-work`): a "Builds" group under the task groups (toggle "Show builds", default on), showing the user's open builds for today and overdue builds grouped by run, each with variant, qty progress and a "Log" inline button that opens the log dialog filtered to that build. Focus mode skips builds.

Notifications (new kind `program`, inbox filter chip "Programs"): end of day missing output, minimum at risk (projected), version starting tomorrow, price card waiting for review, price card sent back, schedule paused by someone, Pulse link removed in Pulse, a month ready to close (owners, on the 2nd work day after month end). Assignment and mentions on builds use the existing kinds. Notification url points to the program route.

Automations (`features/automations`): new triggers "Output is logged on a build" (`build_output_logged`, optional "at least N units"), "A build is marked done short of plan" (`build_done_short`), "A build goes over plan" (`build_over_plan`), "All builds of a run are done" (`run_done`), "A run is below plan by X% at {time}" (`run_below_plan`, checked by the sweep at that program time); new condition fields "Work type" (`workKind`: Task, Build), "Variant" and "Program". Global rules default to "Applies to tasks" and say so in the builder. Actions allowed on builds: set status, set assignee, notify, add comment, add watcher, create follow up (makes a task in the same program). Move to project is hidden for build triggers.

Forms (`features/forms`): a form setting "Creates a build in {program}" (program picker) with field mapping: a Variant field (choice list filled from the program's active variants, or a SKU text field matched with `matchVariant`), a Qty field, and a Date field (default the next work day). Submissions make builds with `planned_from='form'` through `createBuild`; unmatched SKUs land as a task in the program titled "Form request could not be matched: {text}" so nothing is lost. Example: an ECOMM "Order count for tomorrow" form.

### 5.18 Floor today (`/programs/today`)

The run sheet for the whole floor. Page width 1240. Title "Floor today", subtitle "Wed Nov 25 · 4 programs · {done} of {builds} builds done" and a second line with units per unit label ("560 of 800 kits · {built} of {planned} orders"; never added across labels; the seed check prints the values), date arrows and "Today".

- Capacity strip (when the workspace has a daily capacity and variants have standard minutes): "Planned work 62 of 80 hours" with a bar per program.
- One Panel per program (ordered by the user's recents): header with program chip, "Log output" and "Close the day"; then its runs as rows with the progress ring, run line, and inline Built today inputs per build (the same cells as the log dialog, saved per program in one `logOutputAction` when the row loses focus or with "Save").
- Footer: primary "Close the day for all" (opens the Close the day step across programs, grouped by program). Saved views (surface `floor`) keep which programs show.
- Money hidden: no revenue anywhere on the page. Empty: "No builds today" with "Plan builds".

### 5.19 Trends, dashboards and workload

Trends layout (third toggle in the directory): months as columns (last 12, scrolling), programs as rows (grouped by customer with a customer subtotal row), each cell "14,172 kits · $29,970" (units only without money access), a totals row by unit label, a metric toggle (Units, Revenue, Both), and "Export CSV". Clicking a cell opens that program's statement for the month.

Dashboards (`features/dashboards`): a "Programs" section on the dashboards page with three panels: "Program revenue by month" (stacked columns by program, last 12 months), "Units by variant" (top 10 variants this month across programs, bar), and "Programs vs target" (each program's forecast as % of target, bar with the 100 percent line). Money panels show units for people without money access.

Workload (`features/workload`): builds count as planned units per assignee per day, and as estimated hours (`planned_qty x std_minutes_per_unit / 60`) when the variant has standard minutes; a toggle "Show builds" (default on); the day capacity line uses the workspace `daily_capacity_hours` when set.

Work calendar (`/settings/calendar`, owners and admins): time zone, work days, holidays (table with date and name, "+ Add holiday", "Copy last year's holidays"), daily capacity hours. Changes say "Changes apply to future builds and forecasts. Logged output does not change."

### 5.20 Month close, adjustments and reports

Close {Month} (`?close=2026-10`, SidePanel 720px, owners): the checklist from `getCloseChecklist` with a state per row (green check, warning with a fix action): "October has ended", "September is closed", "No open builds dated in October" (else the list with Close short, Move the rest, Cancel), "Every unit has a price" (else "Open price card"), "Monthly charges are added" (the ledger is settled), "Adjustments reviewed" (checkbox with the month's adjustments listed), "Matches Pulse" (shown when a job is linked; information only). The statement total and units at the bottom, and primary "Close October" (disabled until every required row passes). After close: toast "October is closed for GLOVE." and the statement shows the closed line. "Reopen" asks for a reason.

Adjustments (Statement sheet and Overview Statement panel, "Add adjustment"): fields Date (open days only), Label, Amount (a Charge or Credit toggle), Reason (required), Variant (optional), "Counts toward minimum" (off by default; help "Turn on when this credit or charge is for work, so the minimum is checked against it."). Shown on the statement under "Adjustments".

Share report (run menu, week range menu, statement sheet): dialog "Share a production report": range (this run, this week, a date range), format (PDF, CSV), "Include charges" (off; money access only). The PDF lists by variant: planned, built, scrap, and the days. It never shows money unless "Include charges" is on.

Print build tickets (run menu, Builds More menu): a print page with one ticket per build: program, build key as a Code 128 barcode (`code128`), variant, SKU, planned qty, day.

Import output (Builds More menu; the wizard review checkbox "Bring in past output after I create it" opens it with `?import=output` on the new program): dialog with a CSV drop zone (columns date, SKU or variant, qty, scrap), a preview table (matched rows, builds that will be made per day and variant, locked days that will be refused) and an "Could not read" list; primary "Import 1,240 rows". Runs one batch through `logOutput`.

### 5.21 States and quality rules for every program screen

- Loading: skeletons shaped like the final layout (never spinners alone, except inline cells).
- Error: EmptyState error with the server message and "Try again"; network errors in mutations show a toast with "Try again".
- Permission limited: controls are hidden, not disabled, except where a disabled control explains itself with a tooltip; read only banners say what the person can do.
- App not installed or not entitled: CRM, Pulse and WMS sections are hidden, with one muted "Add {App}" card per program only where `notInPlan` says it can be bought.
- Money hidden: every money field disappears, including inside activity; charts switch to units; the statement, PDF and CSV routes return FORBIDDEN.
- Locked days: lock icon, hatched cells, inputs disabled, tooltip with the reason and who can unlock.
- Copy: no em dash, en dash or double dash anywhere; ranges read "to"; middle dot separators; no placeholder text in inputs that repeats the label; none of the words in 1.4.
- Every button does something real; every menu item works; every empty state has a real next step; every bulk or batch create has Undo.

---

## 6. Cross app

### 6.1 Pulse

Goal: Pulse shows labor, cost, revenue and margin for a program and for each variant, with revenue to the cent equal to Projects. Pulse never computes program fees: it copies the ledger and the output snapshots.

Reader (new file `apps/pulse/src/server/integrations/programs.ts`, through `siblingDb` (runs as the owner, so `core` and `pm` rows are visible), allow listed in `db-guard.test.ts`, strict reads with `throwOnError` like `projectTimeByDay`):

- `programEdges(ctx)`: every `core.record_links` `bills_to` edge of the org whose target is a Pulse job, with `throwOnError`. The sync never removes mirrors or rows unless this read succeeded. Guard rail: if it returns 0 edges while live `pm_program` or `pm_build` mirrors exist and `to_regclass('core.record_links')` says the table exists, the step aborts and records a sync error "Program links could not be read. Nothing was removed."
- `programFeeds(ctx, edges)`: for program edges, the program (`pm.projects` live, `kind='program'`), settings and `settled_through`; for build edges, the build and its container.
- Output and fees through `@kitstak/db/programs` (`readProgramMonth`, `readBuildOutput`, `loadBuildHoursByDay`, `loadPrepTimeByDay`), so the filters are the Projects filters.
- `listProgramsForPicker(ctx, { q, clientId? })`: programs (`kind='program'`, live, not archived) for Pulse's "Link a program" picker.
- Detection: `projectsReady` also checks the `pm.projects.kind` column and `to_regclass('pm.build_output')`; without them the program step is skipped and program UI is hidden.

Sync (`apps/pulse/src/server/domain/sync.ts`, new step `syncPrograms(ctx, tally)` called inside the projects run after `syncProjects`; `EVENT_SOURCE.pm_program_changed = 'projects'`):

1. Mirror edges: for every `bills_to` edge pointing at a live Pulse job of this org, upsert `pulse.job_links` (`target_type` `pm_program` or `pm_build`, `target_id`, cached title, status, path; `imports_time` true for programs when the link asks for prep task labor). Remove mirrors whose edge is gone (only after a successful edge read).
2. Guard: skip a program job that is not `per_unit`, is fixed or hourly, or links a WMS work order; record a Pulse alert "Program GLOVE cannot feed J-1040 because the job is not per unit." Count as skipped. Add an alert "GLOVE uses America/Chicago but J-1040's site uses America/New_York. Days are counted in GLOVE's zone." when the zones differ (information only).
3. Units and build labor: for each output row whose posting job is this job (`posting = 'program_job'` with the program edge, or `posting = 'build_job'` with the build edge), plus each build day that has build time but no output, write one production entry: `source='projects'`, `shift='projects'`, `source_ref='pmb:<buildId>:<date>'`, `work_date`, `units_good=qty`, `units_scrap=scrap_qty`, `hours` and `headcount` from `loadBuildHoursByDay` (in the program zone), `pm_task_id=buildId`, `pm_variant_id`, `pm_program_id` (null for a build outside a program), `unit_price` (the snapshot, always concrete), `material_cost_per_unit` from the variant, `site_id` = the job's site, labor class = job default. A build's time always lands on the build's own posting job, never on the program job when they differ. Closed months: skipped and counted, never errors.
4. Gone and moved rows: `removeGoneProgramRows(ctx, orgId, seenRefs)` runs over every job of the org that has live `source='projects'` rows with `pmb:` or `pmf:` refs for the org's programs and builds (not only linked jobs), and soft deletes rows that were not seen, only in open months and only when not locked by a person. When a ref already lives on a different job than its current posting target (the build was re posted from J1 to J2), the row is moved in one transaction (`UPDATE job_id, site_id, labor_class_id`), and both jobs are restamped; it is never inserted twice (the `(org, source, source_ref)` key is unique across jobs). Deleted programs are skipped and their open rows removed.
5. Fees: for each program job, read the ledger (`readProgramMonth`) for every open month from the program start through the current month, and write each ledger row as a `revenue_entries` row on the program job: `source='projects'`, `source_ref` = the ledger ref, `kind` `fee` (or `adjustment` for adjustments and the minimum top up), `revenue_date` = charge date, `quantity` and `unit_price` for per hour and per batch, `amount_cents`, `pm_program_id`, `pm_variant_id` when set, `client_id` = job client, `site_id` = job site, `description` = ledger label. Upsert by ref; delete refs no longer in the ledger in open months.
6. Prep task labor: time on program tasks that are not builds is written as hours only rows (shift `projects_time`): per task `pmt:<programId>:<taskId>:<date>` when the program link opts in to labor per task (`meta.importTaskTime = true`), else one `pmt:<programId>:program:<date>` row per day. These rows go to the program job. `syncProjects` keeps reading `pm_project` links only; program labor never runs through the project day import, so `job_links_project_time_key` is unchanged.
7. Recalc: rows are written in batches per job and month (one transaction, a multi row upsert by ref, one `restampProduction` over `WHERE source_ref = ANY(...)`, one `finishWrite`), and the `sync_state` lease is renewed between batches, so a first backfill of about 1,500 rows plus fees finishes inside the 5 minute lease.

Month close in Pulse (`apps/pulse/src/server/domain/periods.ts closePeriod` L125 and `getCloseChecklist` L104):

- `closePeriod` first runs `syncPrograms` for the org, then refuses while a `pm_program_changed` bridge event for the org is pending ("Programs are still syncing. Try again in a minute.").
- New checklist item "Programs settled": for every program feeding a job of the org, `settled_through >= month end`; else "GLOVE has not added October's monthly charges yet. This happens on its own a few minutes after the month ends." Required.
- New checklist item "Programs synced": no pending program events and the last program sync after the month end. Required.

Writes from Pulse people:

- Production lines from builds (`pmb:` refs) are read only in Pulse for units, scrap, price, hours and crew (edit dialog shows "This line comes from build GLOVE-212 in Projects." with "Open in Projects"). People may add typed lines on the job; on a program fed job, typed lines carry hours and crew only.
- `assertTaskOnJob` (`production.ts` L179) gains a dedicated path: a typed line tagged to a build (`pm_task_id` of a `kind='build'` task) passes when the build has a `bills_to` edge to this job, or the build's program has one; other tags go through `tasksOfProjects(..., { include: 'all' })` over `pm_project` and `pm_program` links. Sync written `pmb:` rows are not checked this way (the sync owns them).
- Typed `units_good` on lines of a program fed job are refused: "Units for this job come from builds in Projects." The CSV import (`imports.ts commitImportBatch` L1747) refuses unit columns for program fed jobs with the same message per row.
- Revenue rows with a `pmf:` ref cannot be edited or deleted (`saveRevenue` L431, `deleteRevenue` L505, `saveRevenueBulk`): "This fee comes from the GLOVE price card in Projects."
- Job prices section on a program fed job: read only with "Prices come from GLOVE price card v2 in Projects." and "Open price card". Changing a program job's pricing model away from `per_unit`, or linking a WMS work order to it, is refused while the program link exists.
- `deleteJob` (`jobs.ts` L898) refuses while a `bills_to` edge points at the job: "GLOVE bills to this job. Remove the link in Projects first." (Projects still handles a dead job, 4.3.3.)
- Linking a program from Pulse (job page, Links: "Link a program") runs `canLinkJob` through the bridge facts (including `has_typed_units`: the dialog offers "Move those units to a typed adjustment" which turns open month typed units into a revenue adjustment row, or Cancel), then writes the `core.record_links` edge through `@kitstak/db/record-links` and the mirror in one transaction as `pulse_app` (0015 grants and policy), then emits nothing (Projects reads the edge directly and reposts on its next write or sweep).

Pulse UI (layer L5):

- Job page: a "Program" badge next to the job number and a "Program" card: program name and key (link to Projects), unit label, this month units and revenue (from Pulse stamps), "Matches Projects" check (per program and job: the sum of `pmb` rows posting to this job plus all `pmf` rows when this is the program job, vs `readProgramMonth`), and "Open program".
- New job page section "By variant" (only for program fed jobs): table per `pm_variant_id`, filtered by `pm_program_id`: variant name (from the reader), units, revenue, labor, material, profit, margin, share; footer "Program fees" (revenue entries with `pm_program_id` and no variant) and totals equal to `job_stats`. Variant names come from the program reader; unknown ids show "Removed variant". A build job fed by builds of several programs shows one block per program.
- Jobs list: "Program" badge column chip; filter "Fed by a program".
- Profit page: group by "Program" option (sum per `pm_program_id`).
- New job prefill: `pulseUrls().newJobFromProgram({ programId, name, clientHint, unitLabel })` in `packages/pulse-bridge/src/urls.ts` opens the new job form with `kind='ongoing'`, `pricing_model='per_unit'`, unit label, client matched by core customer or CRM account, and a pending "Link program" that completes on save.

pulse-bridge additions (`packages/pulse-bridge/src/programs.ts`, exported as `@kitstak/pulse-bridge/programs`, L2; never throw, `{ available: false, reason }` when Pulse is missing):

```ts
getClosedMonths(db, orgId): Promise<{ available: true; months: IsoMonth[] } | PulseUnavailable>; // the set, not a high water mark
getJobFacts(db, who, jobId): Promise<{ available: true; job: { id; number; name; status; live: boolean; kind; pricingModel; unitLabel; siteId; siteTimezone; feedsFromWorkOrder: boolean; hasTypedUnits: boolean; programId: string | null; clientId } | null } | PulseUnavailable>;
getJobPriceRows(db, orgId, jobId): Promise<JobPriceRow[]>;
getJobsSummary(db, who, { jobIds, month }): Promise<{ available: true; jobs: { id; number; name; revenueCents: string; costCents: string; profitCents: string; marginBp: number | null }[] } | PulseUnavailable>; // All linked work
searchProgramJobs(db, who, { q, clientId?, purpose: 'bills_to' | 'related' }): Promise<{ available: true; jobs: JobPick[] } | PulseUnavailable>; // with canLinkJob reasons for bills_to
getProgramPulse(db, who, { programId, month }): Promise<{ available: true; moneyHidden: boolean; job: PulseJobSummary | null; stamped: { perUnitCents: string; feesCents: string; totalCents: string; byVariant: { variantId: string | null; units: string; revenueCents: string; laborCents: string; materialCents: string; profitCents: string; marginBp: number | null }[] }; pendingSync: boolean; pendingSince: string | null; lastSyncAt: string | null } | PulseUnavailable>;
```

Parity (shown in Projects Overview and Settings to owners and admins): per (program, job), the Projects side is `readProgramMonth` for rows posting to the job plus all ledger rows when the job is the program job; the Pulse side is `stamped.totalCents` filtered by `pm_program_id`. Equal: "Matches Pulse to the cent". Different and a sync is pending: "Pulse is catching up" (shown to everyone who sees money only after 10 minutes pending). Different and nothing pending: "Pulse is $12.40 off" with "Sync now" (owners and admins only).

### 6.2 CRM

Shared deal facts: extract `dealFacts` from `apps/crm/src/server/services/pulse-bridge.ts` L122 into `packages/db/src/crm-deal-facts.ts` (L1), exported as `@kitstak/db/crm-deal-facts` (raw SQL over `crm.items`, `crm.columns`, `crm.customer_links` through a structural executor; uses engine `isWonStage` and `dealValueToCents`), returning `{ itemId, name, boardKind: 'deal' | 'account', valueCents, currency, won, closeDate, accountItemId, accountName, coreCustomerId, rates: { unitPrice?, monthlyFeeCents?, setupFeeCents?, monthlyMinimumCents?, termMonths? } }`. Rates are read from columns whose key or label matches (case insensitive): unit price ("unit_price", "Price per kit", "Unit price"), monthly fee, setup fee, monthly minimum, term months. CRM `pulse-bridge.ts` and Projects `integrations/crm.ts dealFactsFor` both call it. Projects prefills rates only through engine `dealPrefill` (same currency).

pm-bridge (`packages/pm-bridge/src/programs.ts`, exported from `index.ts`, L6):

```ts
listLinkedPrograms(db, actor, targets: BridgeTarget[], urls, { month }): Promise<{ available: true; moneyHidden: boolean; programs: BridgeProgram[] } | Unavailable>;
// matches core.record_links (crm_deal, crm_account, core_customer edges), pm.integration_links on the program, and pm.projects.crm_item_id / crm_customer_id, with p.kind = 'program'
countLinkedPrograms(db, actor, targets): Promise<number>;
listProgramsForKit(db, actor, { coreItemId?, wmsProductId? }): Promise<{ available: true; programs: { key; name; url; variant: { id; name; sku }; plannedThisWeek: string; builtThisMonth: string; nextBuildDate: IsoDate | null }[] } | Unavailable>;
programUrl(urls, key): string; newProgramUrl(urls, { crmItem, name, customer }): string;
interface BridgeProgram { id; key; name; status; statusLabel; unit: { singular; plural }; customerName: string | null; month: { units: string; revenueCents: string | null; forecastCents: string | null }; today: { builds: number; done: number }; cardSummary: string | null; deal: { valueCents: string; termMonths: number | null; onTrackForCents: string | null } | null; url: string; linkVia: 'record_link' | 'integration_link' | 'deal_pointer' | 'customer_pointer' }
```

Month to date money in `listLinkedPrograms` comes from `@kitstak/db/programs readProgramMonth` (output snapshots plus the ledger), so it equals Projects; the forecast is engine `forecastMonth` over the same rows. `deal.onTrackForCents` is, over the deal term counted in months from the program start month, the revenue of the months before this one, plus this month's forecast, plus this month's forecast times the months left in the term ("Deal $386,400 over 12 months · program on track for $390,244"). `moneyHidden` uses the Projects rule (explicit program role and `money_min_role`, A10) computed from `core.member` and `pm.project_members` (mirror helper in `packages/pm-bridge/src/permissions.ts`, kept in lockstep with `apps/projects/src/lib/permissions.ts` by a shared test table). `pmAvailability` gains `kinds` (a cached `information_schema.columns` check for `pm.projects.kind`) and `programs` (`to_regclass('pm.build_output')`); older databases return `{ available: false, reason: 'not_installed' }` for program reads and skip kind filters.

CRM server: `apps/crm/src/server/services/programs-bridge.ts` (clone of projects-bridge: `availability`, `targetsFor`, `rethrow`), `getItemPrograms(ctx, itemId)` -> `ItemProgramsDto { available, reason, programs, createProgramUrl, deal: { valueCents, currency, won, accountName } | null, moneyHidden, projectsUrl }`. Route `apps/crm/src/app/api/v1/crm/items/[itemId]/programs/route.ts` (withApi, `item:read`, `uuidParams('itemId')`).

CRM UI (`apps/crm/src/features/item-panel/programs/{api.ts, programs-tab.tsx, programs-health.tsx}`):

- `PANEL_TABS` (`url-state.ts:10`) gains `programs`. Tab shown for deals and accounts, top level only, when Projects is entitled and available (gating like Pulse at `item-panel.tsx` L518).
- Health line under the item name (next to ProjectsHealthLine): "1 program · $29,970 this month" (money hidden: "1 program · 14,172 kits this month").
- Tab content: header "Programs" with count and actions: primary "Start a program" (opens `createProgramUrl` in Projects), More menu (Open KitStak Projects). Won deal with no program: a banner card "This deal is won. Start a program to track builds and revenue." with "Start a program". List of program cards: icon, name, key, status pill, customer, card summary, "This month" units and revenue, "Today 5 of 8 builds", on deals the line "Deal $386,400 over 12 months · program on track for $390,244", "Open in Projects". Empty (not won): "No programs yet. Programs track repeat builds under one price card." with "Start a program".
- States: skeleton, error with retry, `not_licensed` card ("Add Projects to run programs") only when the plan can add it, else hidden.

Projects side of CRM (`record-triggers.ts`, L6):

- The `crm_deal_won` trigger config gains `action: 'create_project' | 'create_program'` (default `create_project`, so existing triggers are unchanged) and, for programs, `programTemplateId` or `copyProgramKey`. `fireDealWon` with `create_program` runs `createProgram` with `wizardPrefill({ crmItemId })` plus the template and links the deal (`created_from` and `belongs_to` edges). Idempotent: `createProgram` with `start.mode = 'deal'` takes `pg_advisory_xact_lock(hashtext('program-from-deal:' || dealId))` and re checks the `created_from` edge under the lock, so duplicate or retried events make one program; a key clash (`projects_org_key_live_unique`) retries with the next suggested key up to 5 times. Trigger UI in `features/automations` record triggers panel gains the action select "Start a project" or "Start a program" and the template picker.
- `wonDeals` uses `isWonStage` (A12).
- Stage changes: `notifyProjectsOfStageChange` already refreshes `pm.integration_links` caches; add `refreshLinkCache(db, orgId, { type: 'crm_deal', id })` for `core.record_links` edges in `apps/crm/src/server/services/item-events.ts` (L49 area, savepoint, never throws).

### 6.3 WMS (read only)

No WMS write path, route or migration changes. The only WMS code change is moving one read function to a shared package, proven unchanged by a snapshot test.

Projects reader `apps/projects/src/server/integrations/wms-kits.ts` (L2; uses `wmsSchemaFor(ctx)` then `wmsTableExists`, every table through `wmsTable(schema, t)`, never the platform `wms` schema for another org, fail soft):

- `resolveKitProduct(ctx, { coreItemId?, wmsProductId? })`: `products` where `id = $wmsProductId` or `core_item_id = $coreItemId AND is_kit`.
- `variantKitCapacity(ctx, variant)` -> `{ available: true; product: { id; sku; name; url }; warehouses: { id; name; netKittingCapacity: string; currentInventoryQty: string; pendingOrderQty: string; asOf: string }[] } | { available: false; reason: 'not_entitled' | 'no_tenant' | 'not_linked' | 'not_found' }` from `kit_inventory_stats` (shows `updated_at` as "as of"; an empty table during a rebuild returns `warehouses: []` with the text "Kit stock is being updated. Check back in a few minutes.").
- `variantKitShortages(ctx, variant, plannedQty, warehouseId?)` -> components from `kit_components` joined to `products`, need per component = `plannedQty * quantity`, compared with usable free stock from `freeStockSql(schema, productIds)` in `packages/db/src/wms-free-stock.ts` (L1 moves `freeStockRows` from `apps/wms/src/server/repositories/work-orders-availability.ts` there; WMS imports it back). Output: `{ component: { sku; name }, need, free, short }[]`.
- `clientBillingFees(ctx, { wmsClientId })` -> active contract fees for VAS and kitting operations from `billing_fees` (read only, for "Other prices for this customer").

The move is guarded by `apps/wms/src/server/repositories/work-orders-availability.snapshot.db.test.ts` (L1): it runs `freeStockRows` for the seed tenant through the old and the new function and asserts identical rows (product, warehouse, location, lot, qty), and the existing WMS free stock tests still pass.

WMS UI (`apps/wms`, L6):

- `components/products/product-detail.tsx`: for kit products, a "Programs" panel inside the Kit tab (L544 area) listing `listProgramsForKit` results: program key and name (link to Projects), variant, planned this week, built this month, next build date. Copy: "These programs build this kit in KitStak Projects. Planned builds do not reserve stock." Gated by the bridge `unavailable()` rule (bridge.ts L91); hidden when Projects is missing.
- Work order detail aside (L826): unchanged. No work orders or movements are ever created from builds.

### 6.4 Portal, search and app switcher

- Portal `apps/portal/src/server/onboarding.ts` L146: counts filter kind (when the column exists), adds "programs" to the Projects card ("9 projects · 4 programs").
- `packages/ui/src/app-switcher/app-switcher.tsx` APPS projects description: "Projects, programs and tasks".
- Projects global search: Programs bucket (name, key, customer, variant SKUs), builds in Tasks with a Build badge.

### 6.5 Graceful degradation matrix

| Missing | Effect in Projects | Effect elsewhere |
|---|---|---|
| Projects not entitled | Programs routes show the existing LockedScreen | CRM Programs tab hidden; WMS Programs panel hidden; Pulse program picker empty with "Projects is not part of this plan" |
| Pulse not entitled or not installed | Pulse panels, job links, parity and Pulse locks hidden; posting is "This program" (or "Not billed" for builds in projects); job price fallback never used; program month close is the only lock | Nothing |
| Pulse installed, user cannot see money in Pulse | Projects money follows the Projects rule only; Pulse job row shows no money (`moneyHidden` from Pulse) | |
| CRM not entitled | "From a won CRM deal" start hidden; CRM pickers hidden; CRM links render as "CRM record" chips without detail | |
| WMS not entitled or no tenant | Kit capacity, planner capacity tint, shortages and WMS billing fees hidden; kit link picker offers core items only | |
| `core.record_links` missing (older DB) | Linked panels show legacy links only; link actions are hidden and the panel says "Linking is not ready yet. Ask an admin to update the database." | Pulse program step skipped |
| `pm.projects.kind` missing (Projects 0006 not applied yet) | n/a | pm-bridge, Pulse and Portal skip kind filters (cached column check) and hide program reads |
| pm program tables missing | Programs nav hidden (feature detection through `programsAvailable`) | pm-bridge program reads return `not_installed`; Pulse program step skipped |

---

## 7. Seed data

Owner: layer L7. Seeds are deterministic and idempotent. Every program row id is a uuidv5 of `(orgId, programKey)`, every variant of `(programId, variantKey)`, every build of `(programId, variantKey, buildDate, n)`, every output row of `(buildId, workDate)`, and every one time charge of `(programId, label, chargeOn)`, so Pulse `pmb`/`pmf` refs and `core.record_links` edges stay valid across reseeds. Each run first wipes the org's program rows through the existing `wipe.ts` (which gains the new tables) and deletes the org's `core.record_links` rows that have a `pm_*` endpoint; the Pulse seed wipe sets `pulse.allow_purge = 'on'` for its own `pmb:`, `pmf:` and `pmt:` rows only.

Today in the seed is the run date; all dates are offsets so charts always cover the last 60+ days. The examples below and in section 5 use 2026-11-25 as today. The program start for GLOVE is today minus 71 days (2026-09-15).

### 7.1 Northwind Robotics (`maya@northwind-robotics.example`)

Northwind has no `core.customers` and no WMS. Customers are CRM accounts (CRM seed adds them) and Pulse clients (Pulse seed adds them, linked to the CRM accounts). Workspace calendar: America/Chicago, Mon to Fri, holidays 2026-11-26 "Thanksgiving" and 2026-12-25 "Christmas Day", daily capacity 80 hours.

CRM seed additions (`apps/crm` northwind fixtures): accounts "Gripwell Safety Supply", "Dude Brothers Outfitters", "Mahco Hardware Supply", "Brightcart Online"; won deals "Gripwell Safety Supply · Glove kitting program" ($386,400, 12 months, USD, columns unit price 1.85, monthly fee 1500, setup 2500, monthly minimum 30000), "Dude Brothers · Grooming kit program" ($148,000), "Mahco Hardware · Hardware pack program" ($144,000), "Brightcart · Order kitting" ($210,000), plus one won deal with no program yet "Gripwell Safety Supply · Winter liner add on" ($42,000) so the "Start a program" banner shows.

Projects programs (new data file `apps/projects/src/server/db/seed/data/northwind-programs.ts`, built by a new `ProgramBuilder` in `seed/program-builder.ts` that calls the program domain functions, then backdates like `backdate.ts`):

| Key | Name | Customer (CRM account) | Unit | Calendar | Variants | Card | Schedule | Pulse |
|---|---|---|---|---|---|---|---|---|
| GLOVE | Glove kitting | Gripwell Safety Supply | kits | workspace | Size Small, Medium, Large, XL x Color Brown, Yellow (8), keys S-BRN to XL-YLW, SKUs GLOVE-S-BRN to GLOVE-XL-YLW, default qty 100, standard minutes 0.6 | v1 from start: $1.85 per kit, rule "Size is XL: set $2.10", $1,500 monthly fee, $30,000 minimum; setup fee $2,500 one time on the start date. v2 from Nov 1: $1.95, rule "Size is XL: add $0.25". Draft v3 from Jan 1: $1.99, same rule, waiting for review (asked by Sofia) | "Weekday glove run": every work day, 100 of each variant, lead 7 days | J-1040 "Gripwell glove kitting program" (ongoing, per unit, kits) bills_to; J-1077 "Liner retool" (fixed, one time) related |
| DUDE | Grooming kits | Dude Brothers Outfitters | kits | own work days Mon, Wed, Fri | Starter, Pro, Refill (3) | $3.40 per kit, Pro $3.90, $45.00 per batch, $750 monthly fee | "MWF run": custom days Mon, Wed, Fri, 250 each | J-1041 |
| MAHCO | Hardware packs | Mahco Hardware Supply | packs | workspace | Hinge pack A, Hinge pack B, Bracket pack, Fastener pack (4) | $0.95 per pack, $42.00 per hour (billable time), $12,000 minimum (part month on) | "Monday hardware run": every week on Monday, 500 each; builds take 2 to 3 days (multi day output) | J-1042, program link imports prep task time |
| ECOMM | Order kitting | Brightcart Online | orders | own work days Mon to Sat, workspace holidays | Standard order, Gift order (2) | $2.75 per order, Gift $3.25, $2,000 monthly fee | "Daily orders": Mon to Sat, Standard 240 (Sat 120, Mon 300 by "Vary by day"), Gift 40; Black Friday (Nov 27) planned by hand at 900 Standard and 160 Gift | no Pulse job (program only) |

Output generation rules (deterministic, exact numbers, no random noise for GLOVE):

- GLOVE: every work day from start to yesterday, exactly 100 per build, with these exceptions only: Oct 12 to 16: 50 per build (comment on each build of Oct 12: "Liner supply short, ran half batches."), which makes the October minimum top up $165.00 (E15); Nov 18 XL Yellow has a build rate $2.05 with reason "Rush order credit"; Nov 20 Small Brown built 112 (12 over plan). Today: Small Brown, Small Yellow, Medium Brown, Medium Yellow and Large Brown Done at 100; Large Yellow Building at 60; XL Brown and XL Yellow Planned with no output. Tomorrow to 7 days out: generated by the schedule (Planned). Every finished build is Done; October is closed in the program by Maya on Nov 3 (so the Close and Reopen paths have data); September is closed too.
- DUDE: each run builds 250 of each, one Pro build closed short (230, reason "Out of Pro razors", comment) on Nov 4; finished builds drive batch charges; one unplanned Refill build on Nov 11 (40).
- MAHCO: weekly builds of 500 each, output split over Mon to Wed (200, 200, 100). Billable time entries: 1 to 2 hours on Tue and Thu for "Sort and recount" prep tasks (per hour line). Work charges stay under $12,000 most months so top ups exist for September (part month) and October, and November shows a projected gap.
- ECOMM: daily orders Standard 180 to 320, Gift 20 to 60 (seeded RNG per program; Gift rises in November), Black Friday planned; one credit adjustment "Credit for 200 bad orders" (-$550.00, counts toward minimum off) on Nov 10.
- Each program also has 3 to 6 plain tasks (prep work), a few comments, watchers, and time entries for builders on builds (so Pulse labor per variant has data for MAHCO and GLOVE).
- One project build: the existing project FRA gets one build "Sample kits for trade show" (100 units, no Pulse job), so the "Not billed" state has data.
- Members: Maya owner of all; Sofia editor on GLOVE and ECOMM; Ethan editor on DUDE and MAHCO; Aisha viewer on all (units only). Liam Patel is a workspace member who is not added to any program (an implicit editor for tasks, units only for money).
- Links: each program `belongs_to` its CRM account, `created_from` its deal; GLOVE, DUDE, MAHCO `bills_to` their Pulse job and GLOVE `related` J-1077 (written by the Pulse seed when the jobs exist, see 7.3).
- One wizard draft for Maya: "Winter liner add on" at step 2. One program template "Glove style kitting" saved from GLOVE.

### 7.2 KitStak org (`admin@kitstak.io`)

Program `TEES` "Tee bundle kitting" for core customer APX (Apex Threads Co.), unit kits, variants M (linked to core item `APX-KIT-TEE3`, so WMS capacity and the planner tint show), L and XL (not linked), card $1.20 per kit, $500 monthly fee, schedule weekdays 150 each for L and XL, and for M a daily qty of 40 percent of the seeded WMS net kitting capacity for APX-KIT-TEE3 rounded up to 10 (read from `kit_inventory_stats` at seed time), so a planned week is above what WMS can build and the planner tint shows; 30 days of output, no Pulse job. This proves the WMS read only panels, WMS billing fees in "Other prices for this customer", and core customer linking.

### 7.3 Pulse seed

`apps/pulse/src/server/db/seed/rich/northwind.ts` adds clients GRIPWELL, DUDEBRO, MAHCO, BRIGHTCART (linked to the CRM accounts) and ongoing per unit jobs J-1040 (GRIPWELL), J-1041 (DUDEBRO), J-1042 (MAHCO) with `program: 'GLOVE'` style specs, plus J-1077 "Liner retool" (GRIPWELL, fixed, one time, $4,200.00 revenue in November). The rich engine (`engine.ts`) gains: for jobs with `program`, do NOT generate synthetic units; write the `core.record_links` `bills_to` edge to the program (looked up by key, skipped quietly when Projects has no such program) and the `related` edge for J-1077; write typed labor lines with hours only (crew and pace from the spec) where useful; then run `syncPrograms` for the org BEFORE closing months (`closed: [-38]` closes October in Pulse, after the October ledger is settled). The seed summary prints program revenue per month and asserts it equals `readProgramMonth` (fails the seed otherwise). Seed order note in `docs/DEPLOYMENT.md` and the seed READMEs: CRM seed, then Projects seed, then the Pulse seed.

### 7.4 Seed check values (run date 2026-11-25)

The Projects seed prints these, the L7 seed check compares them, and section 5 copy uses them. GLOVE:

| Fact | Value |
|---|---|
| September total | $21,660.00 (E14) |
| October total | $31,500.00, including the $165.00 minimum top up (E15) |
| November work charges through Nov 24 | $27,378.40 (17 days at $1,610.00, plus $23.40 for 12 extra Small Brown on Nov 20, less $15.00 for the Nov 18 XL Yellow build rate) |
| Today (Nov 25) | 5 of 8 builds done · 560 of 800 kits · $1,092.00 |
| This month (MTD) | $29,970.40 (work charges $28,470.40 plus the $1,500.00 monthly fee) |
| Built this month | 14,172 kits · Avg 801 a work day |
| vs last month at this point | up 27% (October through Oct 25 was $23,685.00) |
| Forecast | $33,708.40 · Based on planned builds (open today $518.00, Nov 27 and Nov 30 $1,610.00 each) · 105% of $32,000 target |
| Minimum | Below minimum by $1,529.60 so far · on track to meet it (projected gap 0, so no minimum alert) |
| Alerts | one: the Nov 20 Small Brown build is 12 kits over plan |
| Schedule window | builds made through Dec 2 (lead 7) |
| December projection | $36,920.00 · 22 work days (E32) |
| Deal line | Deal $386,400 over 12 months · program on track for $390,244 |
| All linked work | Program $29,970.40 · Other linked jobs $4,200.00 · Total $34,170.40 |

The seed check also prints the same facts for DUDE, MAHCO (including its projected minimum gap, which the MAHCO alert and notification must show) and ECOMM, and the Floor today totals; L7 pastes that output into `apps/projects/src/server/db/seed/README.md` so screenshots can be checked against it.

---

## 8. Cross cutting rules

### 8.1 Permissions

`apps/projects/src/lib/permissions.ts` (L1):

- ProjectAction adds `money:read`, `pricing:propose` (min `editor`), `pricing:manage` (min `owner`), `output:log` (min `editor`), `build:plan` (min `editor`), `schedule:manage` (min `editor`), `program:close` (min `owner`).
- `money:read` is special: it passes for org owners and admins, and for an explicit `pm.project_members` role at or above the program's `money_min_role`. The implicit role from `IMPLICIT_ORG_PROJECT_ROLE` (an org `member` is an implicit editor on org visible projects) never passes it. Guests never see money.
- Other program actions keep the project rule: an org member is an implicit editor on an org visible program and can log output and plan builds (the normal floor flow). Owners who want only added people to work in a program set its visibility to private in Settings, General.
- `programCapabilities(ctx, program, settings)` resolves them, plus `seesSync` (program owners and org admins: parity details, Sync now, sync alerts).
- Non user actors (automations, system, integration) act as owner (existing rule), but the sweep never edits prices or closes months.
- Every program read strips money fields on the server when `money:read` fails, activity included (4.10). Statement, PDF, CSV and report with charges routes return FORBIDDEN.
- pm-bridge mirrors the money rule for CRM and WMS panels.

### 8.2 Activity and audit

All mutations write `pm.activity` in the same transaction (4.10). Output rows keep `entered_by` and `version`. Price versions keep `published_by` and `published_at`; published versions never change (a Scheduled version can be moved back to a draft, which is logged). Month closes keep who and when, and reopens keep the reason. Deleting a program soft deletes its rows; a hard delete never happens through the UI.

### 8.3 Locking

The full rule is 4.3.4 (M9). In short: a closed program month, or a closed Pulse month for days that go to a Pulse job, freezes output, prices, postings, fees and time on those days. Locked rows are never repriced, re posted or deleted. Reopen is an owner action with a reason.

### 8.4 Concurrency

- New mutable tables carry `version`. Updates use `WHERE id = $1 AND version = $expected` and `version = version + 1`; zero rows -> `CONFLICT` "Someone else changed this. Reload to see their change." The UI refetches and shows the newer value with the person's edit kept for retry where possible.
- Output "add" mode is one `INSERT ... ON CONFLICT (build_id, work_date) WHERE deleted_at IS NULL DO UPDATE SET qty = build_output.qty + EXCLUDED.qty`, so two people adding at once both count, including on the first log of a day. Unique violations map to `CONFLICT`, never a 500.
- Lock order for money writers: `pm.program_settings` (`FOR SHARE` for output, `FOR UPDATE` for publish, unpublish, rate changes, one time charges, close and reopen, and the ledger writer), then `pm.builds` rows `FOR UPDATE` ordered by `task_id`. `built_qty` changes as `built_qty + delta` under that lock. Two batches in different orders cannot deadlock, and an output row priced against an old card cannot commit after a publish of a new one.
- Schedule generation uses the unique occurrence index plus savepoints; parallel sweeps cannot double make builds.
- Deal won program creation takes an advisory lock per deal (6.2).

### 8.5 Performance

- Budgets: program layout server render under 250 ms p95 with one year of GLOVE (about 2,000 builds and 2,000 output rows); summary endpoint under 150 ms p95; directory under 200 ms for 50 programs; Floor today under 250 ms for 10 programs; log dialog save under 300 ms for 50 rows; ledger refresh for one month under 50 ms.
- Indexes in 2.2, including `time_entries_project_started_idx` for hours by day per program (both apps).
- Summary reads month rows once with the covering index and the ledger by `(program, month)`; it never recomputes closed months.
- Directory stats: one grouped query for all visible programs (today and month units and cents from `pm.build_output`, fees from `pm.program_ledger`); no N+1.
- Builds views fetch a date window (default 4 weeks), never all builds. Board columns virtualize after 100 cards (existing behavior if present, else `content-visibility: auto`), and Done folds older cards (5.7).
- React Query: summary staleTime 30s, builds 15s, kit 60s, Pulse 30s with 120s refetch. Mutations update the cache optimistically for output cells and revert on error.
- Pulse sync writes in batches per job and month (6.1 step 7).
### 8.6 Accessibility

- Every input has a label (visible or `aria-label` such as "Built today for Small Brown, GLOVE-212").
- Grids (log dialog, planner) use `role="grid"` semantics with roving focus, arrow key movement and `aria-rowindex`/`aria-colindex`; changes announce through a polite live region ("Saved 8 rows").
- Charts keep the existing keyboard roving focus and screen reader table.
- Color is never the only signal (status pills have text, target chips have numbers, run rings have "5 of 8" text, locked cells have an icon, the all done check has text).
- Contrast meets WCAG AA in both themes; focus ring is the crimson token.
- Dialogs trap focus and return it to the trigger.

### 8.7 Dark mode and mobile

- Only tokens; verify every new screen in `--theme dark` screenshots.
- At 375px: directory cards one column; workspace tabs fold into More; header KPIs move under the title; log dialog becomes a full screen sheet with one card per build (big number input and Fill button); planner keeps a horizontally scrolling matrix inside its container with a sticky first column (no page scroll); wizard steps show "Step 2 of 6 · Variants" instead of the stepper (5 when Step 0 is skipped); Floor today shows one program per card with its runs folded; matrix generator shows the table layout; tables scroll inside their Panel.

---

## 9. Test plan and acceptance

### 9.1 Unit (vitest, pure)

- `packages/programs-engine`: all cases E1 to E47 plus property tests (E25, E26), money and calendar tests moved from Pulse.
- Projects `src/lib/nl-parse-build.test.ts`: 25 cases (qty, variants by name, key and SKU, program by word or +KEY, project builds, dates, unresolved tokens).
- `src/lib/program-types` zod schemas: payload validation cases (wizard, template payload, log batch with new rows and end of day decisions).
- `activity-text` sentences for every new verb, with and without money.
- `copy-rules.test.ts` covers the new folders automatically (features, components, app, seed) and fails on the 1.4 words in program folders.
- Permissions table test shared by `apps/projects/src/lib/permissions.ts` and `packages/pm-bridge/src/permissions.ts` (same inputs, same `money:read` answers; an implicit org editor never passes).

### 9.2 DB tests (`*.db.test.ts`)

Harness for Projects: `apps/projects/vitest.config.mts` gains `setupFiles: ['src/test/setup-env.ts']` (dotenv) and a `db` project that only runs `*.db.test.ts`; `src/test/db.ts` with `databaseReady()` and `createTestOrg()` (copy of `apps/pulse/src/test/db.ts`). Tests skip when no database.

- Kind isolation: create a project and a program; `listProjects`, search, portfolio, spaces counts, `listMyTasks` default, pm-bridge `loadProjects` and `listWritableProjects` never show the program or its builds; project templates never list program templates; My Work saved views never include program directory or floor views (surface filter regression).
- Generic project mutations: `updateProject` dates, `archiveProject`, `deleteProject`, `duplicateProject` and template conversion refuse a program with the exact message.
- Trigger guards: KP101 (build as subtask), KP102 (project kind change), KP103 (task kind change), KP104 (build `project_id` change outside `moveBuild`), KP105 (builds row container mismatch, variant of another program).
- Builds in projects: a build in a project billed to a job prices at its job price and posts `build_job`; with no job it is `unbilled`; `moveBuild` into a program adopts the card for open days and refuses when output is locked.
- insertTask callers: a form submission in task mode and a triage accept into a program make `kind='task'`; a build form makes a build.
- Program create: wizard payload with 8 variants, rules, card, schedule (lead 7, created on 2026-11-25 with the Thanksgiving day off) -> rows, statuses, settings, edges, 40 generated builds (one week of work days, Nov 25 to Dec 2) and the returned `generated` counts.
- Output: add and set modes; two concurrent adds on the first log of a day both count (no 500); version conflict on set; deadlock free with two 50 row batches in opposite orders; auto start; mark done sets `finished_on`; zero rows soft delete; unplanned "Add a row"; close short; move the rest (`splitBuild`); revenue snapshot equals engine; `unit_price` is never null.
- Ledger: per batch, per hour, monthly fee, setup and adjustments are in `pm.program_ledger` after the input change in the same transaction; leaving done in an open month removes the batch fee, in a closed month keeps it; re finishing keeps the first finish date; a cancelled build has no batch fee and keeps per unit revenue; a status category change in `structure.ts` updates the ledger; a time entry edit on a closed day is refused; moving a task with closed day time between a project and a program is refused.
- Price versions: publish future; publish past (always updates open rows only); locked rows untouched; Scheduled version moved back to draft and republished; same day fold replaces a version with no stamped rows; pending changes from three variant rate edits make one draft; review request and send back.
- Schedules: run the sweep twice and in parallel; delete a generated build and rerun, it does not come back; `regenerateFuture` with a changed qty regenerates the removed builds (counts equal, keys freed); `qty_by_weekday` gives the Saturday qty.
- Locks and close: a program close and a fake closed Pulse period (insert into `pulse.periods` when the schema exists) refuse edits with the exact messages; closing out of order and reopening a non latest month are refused; `lockedThrough` treats a reopened September before a closed October as open (set membership).
- Deletes: deleting a build soft deletes its open output and refreshes the ledger; refused with locked output; restore brings back only open rows; readers ignore deleted builds.
- Money visibility: an org member with no program membership sees `moneyHidden = true` on the program, its summary, its activity endpoint and task activity; a viewer sees no `money` keys in activity rows.
- Parity (Pulse db test `apps/pulse/src/server/domain/sync-programs.db.test.ts`): seed a program with variants, two card versions, rules, overrides, a month of output, finished builds, time, a setup fee and an adjustment; link a per unit job; run `syncPrograms`; assert per variant `base_revenue_cents` sums and every `pmf` row equal `readProgramMonth`; rerun sync is a no op; delete an output row and resync removes the Pulse row; unlink the job and resync removes every open `pmb`/`pmf` row from the old job; repost a build from J1 to J2 moves the row (no duplicate, both jobs restamped); build time lands on the `pmb` row of the build's own job; MAHCO prep task labor hours land as `pmt` rows; closed month rows stay and count as skipped; an empty edge read with live mirrors aborts without removing anything; `closePeriod` refuses while the program has not settled the month; `pmf` rows refuse edits; a second program cannot bill to the same job.
- pm-bridge `listLinkedPrograms` month money equals Projects `getProgramSummary`; with `pm.projects.kind` dropped in a scratch schema, project panels still load.
- WMS free stock snapshot (`work-orders-availability.snapshot.db.test.ts`): identical rows before and after the move.
- Deal won: two concurrent `crm_deal_won` events for one deal make one program.

### 9.3 End to end (Playwright scripts, `apps/projects/scripts/e2e-programs.mjs`)

Flows run against the dev server with Maya:

1. Wizard from scratch: GLOVE2 with Paste a list (8 SKUs), a rate rule for XL, card, weekday schedule, no links -> lands on Overview; the toast count equals the builds made (40 when run on 2026-11-25).
2. Wizard from a won deal (from the directory split button, so Step 0 is skipped): "Gripwell Safety Supply · Winter liner add on" prefill shows the deal value callout and links; "Set prices later" makes a program with the setup checklist.
3. Planner: plan next week from "Copy last week", then "Suggest from history", create, Undo, create again, verify counts.
4. Log output: open with `O`, scan two SKUs, fill all, add an unplanned row, "Save and close the day" with one close short and one move the rest; verify Overview KPIs, the run row and the toast Undo.
5. Price card: three variant rate changes from the Variants tab make one pending draft; review and publish; the impact equals the new summary.
6. Month close: close October for a fresh program copy, see the lock chip, reopen with a reason.
7. Kind isolation in the UI: Projects directory, sidebar Spaces and palette project list do not show programs; Programs shows them; a project build shows "Not billed".
8. Pulse: J-1040 job page shows the Program card, the By variant table, and the same month revenue as GLOVE Overview.
9. CRM: the Gripwell account panel Programs tab lists GLOVE with the same month revenue and the deal line.
10. Money hidden: Aisha and Liam see units only everywhere, including Activity, and CSV and PDF export return 403.
11. Floor today: log one row per program inline and "Close the day for all".

### 9.4 Visual acceptance criteria (screenshots at 1440x900 light and dark, and 375x812)

Capture with `cd apps/projects && node scripts/shot.mjs --base http://localhost:3400 --user maya@northwind-robotics.example --password Northwind-Demo-2026! --theme light --wait 2500 --out /tmp/claude-0/shots <paths>` (and `--theme dark`). Every number in a shot must equal the 7.4 seed check output.

| Screen | Path | Must show |
|---|---|---|
| Directory cards | `/programs` | 4 program cards with real numbers, sparklines, target chips, a drafts strip, aligned 3 column grid, no text overflow |
| Directory table | `/programs` (table layout pref) | totals footer by unit, sortable headers, sticky header, health with basis tip |
| Directory trends | `/programs` (trends layout pref) | 12 months, customer subtotals, units and revenue |
| Floor today | `/programs/today` | every program's runs, inline inputs, capacity strip |
| Wizard start | `/programs/new` | 4 start cards, Quick setup link, stepper, preview rail hidden on step 0 |
| Wizard variants | `/programs/new?draft=<id>` step 2 | Size x Color matrix 4 x 2 with codes, SKUs, qty and rate cells, one rate rule, conflict free; Paste a list mode with found axes |
| Wizard price card | step 3 | sections, live math "$36,920.00 · Based on 22 work days in December", projection rail with stacked bar |
| Wizard schedule | step 4 | rule select, variant qty table with one "Vary by day" row open, 2 week preview, "40 builds and 4,000 kits in the next 7 days" |
| Wizard review | step 5 | summary with Edit links, Pulse job picker |
| Overview | `/programs/GLOVE` | one alert, KPI row ($29,970.40, 14,172 kits, $33,708.40 at 105% of target, below minimum by $1,529.60 so far), chart with one forecast line, target and minimum, by variant, All linked work, Today's run "560 of 800 kits · 5 of 8 done", price card, statement, Pulse panel "Matches Pulse to the cent", Details · Linked · Activity tabs, Updates |
| Builds runs | `/programs/GLOVE/builds/runs` | run rows with rings, today expanded |
| Builds list | `/programs/GLOVE/builds/list` | grouped by run, qty progress, variant chips, day strip |
| Builds board | `/programs/GLOVE/builds/board` | Today range, status columns, "Done earlier" fold |
| Builds table | `/programs/GLOVE/builds/table` | build columns, Price from chips, totals |
| Builds calendar | `/programs/GLOVE/builds/calendar` | day stacks with rings |
| Builds timeline | `/programs/MAHCO/builds/timeline` | multi day bars per variant |
| Build drawer | `/programs/GLOVE/builds/list?task=GLOVE-<n>` | Build block, Output table, Rate with Price from, Revenue goes to, Linked section |
| Project build | `/p/FRA/board?task=FRA-<n>` | "Not billed" warning line |
| Log output | `/programs/GLOVE?log=<today>` | scan bar, 8 rows, fill buttons, Add a row, totals with money |
| Close the day | log dialog, second pane | short builds with Close short and Move the rest |
| Planner | `/programs/GLOVE?plan=week` | matrix, Thanksgiving column shaded, existing build chips, summary rail with hours |
| Planner capacity | admin@kitstak.io `/programs/TEES?plan=week` | warning tint on M with the WMS tip |
| Variants | `/programs/GLOVE/variants` | 8 rows, rates with Price from and rule text, kit column, pending changes bar after one edit |
| Price card | `/programs/GLOVE/price-card?version=<v3>` | version rail with v1, v2 and the v3 draft waiting for review, rules, impact rail, Other prices disclosure |
| Schedule | `/programs/GLOVE/schedule` | schedule card and month preview |
| Linked | `/programs/GLOVE/linked` | CRM account and deal, J-1040 with Bills to, J-1077 Related |
| Activity | `/programs/GLOVE/activity` | output, price, review and month close sentences |
| Settings | `/programs/GLOVE/settings` | sections, month close list, Pulse check table |
| Statement | `/programs/GLOVE?statement=2026-10` | October lines including the $165.00 minimum top up, closed line, PDF and CSV |
| Month close | `/programs/ECOMM?close=2026-10` | checklist with states |
| Money hidden | Aisha `/programs/GLOVE` | units only, no money anywhere, activity without money |
| Kit panels | admin@kitstak.io `/programs/TEES/variants` | "Can build" for M with as of time |
| Work calendar | `/settings/calendar` | holidays table, capacity |
| Mobile | `/programs`, `/programs/GLOVE`, `/programs/today`, log dialog | one column, no page horizontal scroll |

The critic checks each shot side by side against Linear, Asana, Monday, ClickUp and Smartsheet equivalents (project list, project overview, board, table, intake form wizard, Monday subitems for runs, Smartsheet row entry for the log dialog) and fails it on: misaligned baselines, mixed font sizes in one row, unlabeled numbers, any em dash, any 1.4 word, any placeholder or dead control, truncated text without a tooltip, colors outside tokens, empty panels, inconsistent numbers between two places on the same screen, between Projects and Pulse, or against the seed check.

---

## 10. Work breakdown

Rules for every layer:

- A file is owned by exactly one layer (tables below). A layer never edits a file it does not own. If a layer needs a change in another layer's file, it reports the need to the orchestrator, which sends it to the owner. New files a layer creates inside its owned folders are its own. Folder globs are owned except for the files another layer owns by exact path.
- Dependencies are added only by L0 (one `pnpm install`). The only later `package.json` edits are `exports` entries: `packages/db` by L1 (`./record-links`, `./crm-deal-facts`, `./programs`, `./wms-free-stock`) and `packages/pulse-bridge` by L2 (`./programs`); those layers own only that block.
- Each layer ends green: `pnpm --filter <touched packages and apps> typecheck lint test`, plus `pnpm --filter kitstak-projects test` (copy rules) when it touched Projects UI copy.
- UI layers must screenshot their routes in light, dark and 375px width and pass the critic (10.3) before they are done. Every number in a shot must match the 7.4 seed check (L7 provides the final seed; before L7, layers use the L2 fixture program and check against `/summary`).
- Never restart the running dev stack. Apply migrations with each app's `db:migrate` script only in L1.

### 10.1 Dependency order

```
L0 engine and dependencies
  -> L1 schema, migrations and shared data access
    -> L2 Projects server (kind isolation, program domain, ledger, actions, API, hooks)
      -> L3 program UI foundation, shared editors and shell
        -> L4a directory, wizard, trends, dashboards, workload, calendar, automations, forms   (parallel)
        -> L4b builds work surfaces: runs, views, drawer, log dialog, planner, Floor today      (parallel)
        -> L4c overview, money and configuration tabs                                          (parallel)
      -> L5 Pulse                                    (parallel with L3 and L4; needs L2)
      -> L6 CRM, pm-bridge, WMS and Portal           (parallel with L3 and L4; needs L2)
        -> L7 seed, end to end and critic sign off   (needs every other layer)
```

Until L5 lands, `pm_program_changed` events stay pending in Pulse (harmless: pending events fold into one by the pending unique key).

### 10.2 Layers

#### L0 Engine package and dependencies

- Goal: `@kitstak/programs-engine` with everything in section 3; Pulse money, calendar and revenue moved in and re-exported; every dependency of the feature installed once.
- Owns: `packages/programs-engine/**`; `packages/README.md`; `apps/pulse/src/lib/money.ts`; `apps/pulse/src/lib/profit/calendar.ts`; `apps/pulse/src/lib/profit/revenue.ts`; `apps/pulse/src/lib/profit/types.ts` (re-exports of moved types only); `packages/pulse-bridge/src/format.ts` (re-export of `formatCents` and `formatMarginBp`); the dependency entries (not `exports`) in `apps/projects/package.json` (`@kitstak/programs-engine`, `pdf-lib` 1.17.1), `apps/pulse/package.json`, `apps/crm/package.json`, `apps/wms/package.json`, `packages/db/package.json`, `packages/pm-bridge/package.json` and `packages/pulse-bridge/package.json`; the `transpilePackages` entries in the four apps' `next.config.ts`; `pnpm-lock.yaml`.
- Acceptance: E1 to E47 pass; `pnpm --filter @kitstak/programs-engine typecheck test`; `pnpm --filter kitstak-pulse typecheck test` unchanged results (money and calendar tests pass through re-exports); `pnpm --filter @kitstak/pulse-bridge test`; coverage at least the shared thresholds.
- Screenshots: none.

#### L1 Schema, migrations and shared data access

- Goal: section 2 applied to the dev DB with mirrors, constants and permissions; the shared SQL that every app uses to read program money (4.3.1); the record links helper; deal facts; the WMS free stock move.
- Owns: `packages/db/drizzle/0007_core_record_links.sql`, `packages/db/drizzle/meta/_journal.json`, `packages/db/drizzle/README.md`, `packages/db/src/schema/core/record-links.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/record-links.ts` (+ `record-links.db.test.ts`), `packages/db/src/crm-deal-facts.ts` (+ test), `packages/db/src/programs/**` (+ db tests), `packages/db/src/wms-free-stock.ts`, `packages/db/src/wms-tenants.ts` (re-export only), the `exports` block of `packages/db/package.json`; `apps/projects/drizzle/0006_programs.sql`, `apps/projects/drizzle/meta/_journal.json`, `apps/projects/drizzle/README.md`, `apps/projects/src/server/db/schema/{programs.ts,projects.ts,tasks.ts,studio.ts,planning.ts,collaboration.ts,index.ts}`, `apps/projects/src/lib/constants.ts`, `apps/projects/src/lib/permissions.ts` (+ test), `apps/projects/src/lib/copy-rules.test.ts`, `apps/projects/vitest.config.mts`, `apps/projects/src/test/{db.ts,setup-env.ts}`, new `apps/projects/src/server/db/programs-schema.db.test.ts`; `apps/pulse/drizzle/0015_program_builds.sql`, `apps/pulse/drizzle/meta/_journal.json`, `apps/pulse/drizzle/README.md`, `apps/pulse/src/server/db/schema/**` (columns and checks for 0015), `apps/pulse/src/lib/constants.ts` (`LINK_TARGET_TYPES`), `apps/pulse/src/server/domain/_shared.ts` (link message map), `packages/pulse-bridge/src/types.ts` (`BRIDGE_EVENT_KINDS`, `PULSE_RECORD_TYPES`); `apps/wms/src/server/repositories/work-orders-availability.ts` (imports `freeStockSql` back; no behavior change) and `apps/wms/src/server/repositories/work-orders-availability.snapshot.db.test.ts`.
- Acceptance: `pnpm --filter @kitstak/db db:migrate`, `pnpm --filter kitstak-projects db:migrate`, `pnpm --filter kitstak-pulse db:migrate` succeed on the live DB and are no ops on a second run; `\d` shows every column, check, trigger and index of section 2; KP101 to KP105 and the finish trigger work (db test); `pulse_app` can read and write `core.record_links` only for its org (db test with `SET LOCAL ROLE`); the shared loader returns E14 to E16 inputs for a fixture; the WMS snapshot test passes; all apps typecheck; existing test suites pass.
- Screenshots: none.

#### L2 Projects server

- Goal: sections 4.1 to 4.10 complete and tested: programs and builds never leak into project surfaces; generic project mutations respect program rules; every program operation, the ledger, locks, closes, runs, imports, reports and links are available to the UI; pulse-bridge program reads.
- Owns: `apps/projects/src/server/domain/**`; `apps/projects/src/server/automations/**`; `apps/projects/src/server/actions/**`; `apps/projects/src/server/integrations/**` except `record-triggers.ts`; `apps/projects/src/app/api/**`; `apps/projects/src/lib/{types.ts,program-types.ts,automation-types.ts,routes.ts,query-keys.ts,activity-text.ts}` (+ tests); `apps/projects/src/lib/hooks/{use-programs.ts,use-data.ts}`; `apps/projects/src/app/(app)/layout.tsx`; `apps/projects/src/app/(app)/p/[key]/layout.tsx`; `apps/projects/src/features/projects/projects-page.tsx`; `packages/pulse-bridge/src/programs.ts` (+ test) and the `./programs` export in `packages/pulse-bridge/package.json`.
- Acceptance: the 9.2 Projects db tests pass (kind isolation, generic mutations, guards, builds in projects, create, output, ledger, prices, schedules, locks and close, deletes, money visibility); all existing Projects tests pass; API routes return the DTOs with money stripped for a viewer and for an implicit org member; `curl` with a session cookie for `/api/v1/programs`, `/today`, `/summary`, `/builds`, `/runs`, `/output`, `/statement?format=pdf` returns data for a fixture program; ledger and snapshots equal the engine; `/projects`, `/p/FRA/board`, `/my-work`, `/search?q=glove` show no programs once a fixture program exists.
- Screenshots: `/projects`, `/p/FRA/board`, `/my-work` (before and after must be identical for projects data). The layer posts sample JSON of `/summary` and `/today` for the fixture to the orchestrator.

#### L3 Program UI foundation, shared editors and shell

- Goal: the shared program UI atoms, providers, the workspace frame, the editors used by more than one screen, and the shell (5.2), so the parallel UI layers build on one look.
- Owns: `apps/projects/src/features/programs/kit/**` (ProgramChip, VariantChip, VariantDot, PriceFromChip, RevenueGoesToChip, MoneyText, QtyProgress, RunRing, RunLine, TargetChip, HealthWithBasis, LockBadge, UnitText, ProgramStatusPill, MoneyHiddenNote, OutputCell, Barcode), `apps/projects/src/features/programs/editors/**` (VariantGenerator, PasteList, RateRulesEditor, PriceLinesEditor, OneTimeChargesEditor, ScheduleEditor, VaryByDayRow), `apps/projects/src/features/programs/program-context.tsx`, `apps/projects/src/features/programs/frame/**` (ProgramFrame, ProgramTabs, RangeBar, ProgramMenu), `apps/projects/src/app/(app)/programs/[key]/{layout.tsx,loading.tsx,not-found.tsx}`, `apps/projects/src/features/shell/**` except `app-shell.tsx`, `apps/projects/src/features/command/**`, `apps/projects/src/features/home/**`, `apps/projects/src/features/search/**`, `apps/projects/src/features/integrations/**` (LinkRecordDialog tabs for Program, Build, WMS shipment order and `related` jobs; RecordChip), `apps/projects/src/features/dashboards/charts.tsx` (only additive props such as dashed series and reference lines), `apps/projects/src/features/projects/{project-overview.tsx,status-updates-panel.tsx}` (extract the status update composer; program chips in the project Linked panel).
- Acceptance: frame renders for the fixture with every tab link (tabs whose pages are not built yet 404 until their layer lands; the critic waits for L4 to judge them); kit atoms render money through the engine format helpers only and hide money when `moneyHidden`; editors have pure helper tests for any logic they hold; sidebar, palette, `G R`, `G F`, home card and search Programs tab work; project overview still renders the same for projects without links.
- Screenshots: `/programs/GLOVE` header and tabs (frame only), dark and mobile; sidebar with the Programs section; palette open on `/programs/GLOVE`; `/` home card; `/p/FRA` overview (regression).

#### L4a Directory, wizard, trends, dashboards, workload, calendar, automations and forms

- Goal: 5.3, 5.4 (including Quick setup), 5.17 automations and forms, 5.19.
- Owns: `apps/projects/src/app/(app)/programs/page.tsx`, `apps/projects/src/app/(app)/programs/new/page.tsx`, `apps/projects/src/features/programs/{directory,wizard,trends}/**`, `apps/projects/src/features/dashboards/**` except `charts.tsx`, `apps/projects/src/features/workload/**`, `apps/projects/src/features/settings/**`, `apps/projects/src/app/(app)/settings/calendar/**`, `apps/projects/src/features/templates/**`, `apps/projects/src/features/automations/**`, `apps/projects/src/features/forms/**`, `apps/projects/src/features/inbox/**`.
- Acceptance: wizard creates GLOVE2 end to end (all start modes, Quick setup, Paste a list, rate rules, Set prices later; Step 0 skipped from the split button; drafts save and resume; validation per step; server errors route back; the toast count equals the generated builds); directory filters, sort, saved views (surface `programs`), table totals, Trends layout and CSV; dashboards Programs panels; workload counts builds and hours; Work calendar saves; automation builder offers the build and run triggers; record trigger "Start a program"; a build form makes builds; inbox Programs filter.
- Screenshots: `/programs` (cards, table, trends), `/programs/new` every step and Quick setup, `/dashboards`, `/workload`, `/settings/calendar`, automation builder with a run trigger, form builder in build mode.

#### L4b Builds work surfaces

- Goal: 5.7, 5.8, 5.9, 5.10, 5.17 quick add, builds in projects and My Work, 5.18 Floor today, and from 5.20 share report, build tickets and import.
- Owns: `apps/projects/src/app/(app)/programs/[key]/builds/**`, `apps/projects/src/app/(app)/programs/[key]/[number]/page.tsx`, `apps/projects/src/app/(app)/programs/[key]/tickets/page.tsx`, `apps/projects/src/app/(app)/programs/today/**`, `apps/projects/src/features/programs/{builds,log-output,planner,floor,imports,reports,overlays}/**`, `apps/projects/src/features/{views,board,list,table,calendar,timeline,task}/**`, `apps/projects/src/features/shell/app-shell.tsx` (mounts `ProgramOverlaysHost` for `?log`, `?plan`, `?import`, `?report`), `apps/projects/src/lib/nl-parse-build.ts` (+ test), `apps/projects/src/features/quick-add/**`, `apps/projects/src/features/my-work/**`.
- Acceptance: all six views for GLOVE with the Filter chips, the range bar, group by run, Done fold, inline edits, bulk bar with Undo; run actions (log, close, move, copy, cancel, tickets, report); the drawer build block, output table, Revenue goes to, Linked section, Not billed state for a project build; log 8 rows in under 10 seconds by keyboard only, scan input, Add a row, Close the day; planner fills a week from last week and from history, paste and CSV import with unmatched lists, WMS capacity tint for TEES, create with Undo; quick add parses the examples; My Work shows builds by run; Floor today logs and closes the day for all; projects views unchanged (screenshot diff of `/p/FRA/board`, `/p/FRA/table`).
- Screenshots: every builds view, the drawer, the full build page, the log dialog (desktop and mobile sheet, both panes), planner, quick add in build mode, My Work with builds, Floor today, a project build drawer, build tickets print page, `/p/FRA/board` regression.

#### L4c Overview, money and configuration tabs

- Goal: 5.5 frame content is L3; this layer builds 5.6, 5.11 to 5.16, and from 5.20 the statement sheet, month close and adjustments.
- Owns: `apps/projects/src/app/(app)/programs/[key]/page.tsx` and `apps/projects/src/app/(app)/programs/[key]/{variants,price-card,schedule,linked,activity,settings}/**`, `apps/projects/src/features/programs/{overview,variants,price-card,schedule,linked,activity,settings,statement,close,adjustments}/**`.
- Acceptance: Overview numbers equal `/summary` and the seed check (one forecast line, alerts strip, tabbed right panel, All linked work, Updates); statement CSV and PDF; month close checklist, close and reopen; adjustments change the statement and the minimum only when marked; price card states (Draft, Scheduled, In force, Ended), publish with impact, unpublish a Scheduled version, review and send back, rate rules, Other prices for this customer; Variants tab pending changes bar and Edit attributes with the new axis value prompt; schedule edit with Vary by day and preview; linked tab shows legacy and new links; settings sections save with conflict handling.
- Screenshots: each tab for GLOVE, statement for October, month close for ECOMM, money hidden as Aisha.

#### L5 Pulse

- Goal: 6.1 complete with parity.
- Owns: `apps/pulse/**` except files owned by L0, L1 and L7; `packages/pulse-bridge/**` except `types.ts` (L1), `format.ts` (L0), `programs.ts` and `package.json` (L2). Includes `apps/pulse/src/server/integrations/{projects.ts,programs.ts}`, `apps/pulse/src/server/domain/{sync.ts,recalc.ts,production.ts,jobs.ts,entries.ts,ledger.ts,periods.ts,imports.ts}`, Pulse job, jobs list, close checklist and profit UI, `db-guard.test.ts` allow list, `packages/pulse-bridge/src/urls.ts`.
- Acceptance: `sync-programs.db.test.ts` (every case in 9.2) passes; Pulse typecheck, lint, test; J-1040 job page shows the program card and By variant table; build lines and `pmf` rows are read only; refusals for typed units (UI and CSV), model changes, job delete with an edge, and a second program on a job; close refuses until programs are settled and synced.
- Screenshots (Pulse dev server): job page for J-1040, jobs list with Program chips, profit grouped by program, close checklist with the Programs rows.

#### L6 CRM, pm-bridge, WMS and Portal

- Goal: 6.2, 6.3 WMS UI, 6.4 and the pm-bridge parts of 4.1.
- Owns: `packages/pm-bridge/**`; `apps/crm/**` except seed fixtures (L7); `apps/projects/src/server/integrations/record-triggers.ts`; `apps/wms/**` except the two L1 files; `apps/portal/src/server/onboarding.ts`; `packages/ui/src/app-switcher/app-switcher.tsx`.
- Acceptance: pm-bridge db tests (kind filters with and without the column, `listLinkedPrograms` money equals Projects, `listProgramsForKit`, permissions table shared with Projects); CRM item panel Programs tab for the Gripwell account and deals, won deal banner, deal line; deal won trigger with `create_program` creates one program for two concurrent events; CRM typecheck, lint, test with `ENTITLEMENTS_DEV_ALLOW_ALL=0` hiding the tab when Projects is not licensed; WMS product detail shows the Programs panel; Portal counts.
- Screenshots: CRM account panel Programs tab, won deal banner, deal panel health line; WMS product detail for APX-KIT-TEE3; Portal Projects card.

#### L7 Seed, end to end and critic sign off

- Goal: section 7 (deterministic, idempotent, with the parity assertion and the 7.4 seed check), 9.3 flows automated, 9.4 table captured, final critic sign off.
- Owns: `apps/projects/src/server/db/seed/**`, `apps/pulse/src/server/db/seed/**`, `apps/crm/src/server/db/seed/**`, `docs/DEPLOYMENT.md` (migration order and seed order notes), `apps/projects/scripts/e2e-programs.mjs` and its README section in `apps/projects/scripts/README.md` (create if missing).
- Acceptance: running the CRM, Projects and Pulse seeds twice gives the same counts and the same ids; the Pulse seed parity assertion passes; the seed check prints exactly the 7.4 values on a 2026-11-25 run (and equal internal consistency on any other date); GLOVE October statement shows the $165.00 minimum top up; every chart in Overview has 60 or more days of data; all 9.3 flows pass twice in a row; every screen in 9.4 passes the critic.
- Screenshots: every row of 9.4.

### 10.3 Critic loop (applies to L3, L4a, L4b, L4c, L5, L6, L7)

1. The builder captures its screens (light, dark, 375px) and lists the operations it verified.
2. A separate critic agent (harsh reviewer, no write access) opens the screenshots and the running app, performs the flows, and compares each screen side by side and blind with the closest equivalent in Linear, Asana, Monday, ClickUp and Smartsheet (for example: directory vs Asana portfolios, Floor today vs a Monday dashboard, runs view vs Monday items with subitems, overview vs Monday dashboards, builds table vs Smartsheet grid, wizard vs ClickUp space setup, log dialog vs a Smartsheet row entry, price card vs a Smartsheet approval flow). For each pair it states which is better and why.
3. Any "the other product is better", any visual defect from 9.4, any number mismatch (on one screen, across apps, or against 7.4), any dead control or copy rule break returns the layer to step 1 with a numbered list of fixes.
4. The layer is done only when the critic says KitStak wins every pair and finds no defects.

---

## Appendix A. Critic findings and how version 2.0 resolves them

Every blocker and major is resolved. Every minor is accepted. Where the fix differs from what the critic proposed, the row says so and A.3 gives the reason. Claims were checked against the code: `studio.ts` templates has no kind column; `views.ts` L37 and L64 treat `project_id` null as My Work; `IMPLICIT_ORG_PROJECT_ROLE` makes an org member an implicit editor; `structure.ts updateStatus` and `deleteStatus` change task closure without touching builds; `time.ts` time writes have no lock check; `pm.time_entries` has only the task and user indexes and a `billable` column that defaults to false; Pulse `assertTaskOnJob` (production.ts L179) only accepts tasks of `pm_project` links; `production_entries_key` includes `pm_task_id` (0014) and `source_ref` keys are unique per `(org, source, source_ref)` across jobs; `closePeriod` (periods.ts L125) does not sync first; 0009 grants `pulse_app` only `core.organization`, `member` and `user`; Pulse sibling reads go through `siblingDb`, which runs as the owner (`detect.ts` L26); `docs/DEPLOYMENT.md` deploys CRM before the Projects migration; `pdf-lib` 1.17.1 is already used by WMS; WMS `billing_fees` exists per contract; the project status update composer is local to `project-overview.tsx`.

### A.1 Product critic

| # | Finding | Resolution |
|---|---|---|
| P1 | blocker: builds could not exist without a program | D4, 1.2 rule 1, 2.2.1 (KP101 is now "build as subtask"; builds may live in projects), 2.2.10 (`container_id`, nullable `program_id`), 3.4 (`unbilled`), 4.2 `moveBuild`, 5.8 Not billed line, 5.17 builds in projects, 9.2 |
| P2 | blocker: no Run concept | A14, 1.1, 3.10 `runs.ts`, 4.2 `runs.ts`, 5.7 Runs view (default) and run actions, Board Today window and "Done earlier" fold, 5.6 Today's run, E42 |
| P3 | major: end of day and unplanned output | 4.2 `splitBuild`, `closeShort`, 4.3.3 entries with `newBuild` and `endOfDay`, 5.9 Add a row and Close the day |
| P4 | major: future published versions contradiction | 4.4.1 states table (Draft, Scheduled, In force, Ended), one rule: lines change only on drafts; a Scheduled version is edited by moving it back to a draft (changed, A.3) |
| P5 | major: second variant rate change refused | 4.4.3 pending changes draft per start date, 5.11 sticky bar, 4.4.2 same day fold |
| P6 | major: `pm.templates` has no kind | 2.2.1 column and index, 2.2.16 mirror, 4.1 templates filter, 4.5 `ProgramTemplatePayload` |
| P7 | major: directory views leak into My Work | 2.2.1 `saved_views.surface`, 2.2.2, 4.1 `views.ts`, 9.2 regression |
| P8 | major: 40 vs 80 builds | 5.4 Step 4 "40 builds and 4,000 kits in the next 7 days", toast from returned counts, 9.2 "one week of work days" |
| P9 | major: minimum alert vs KPI | 4.5 `minimum_at_risk` uses the projected gap only, 4.9 step 6, 5.6 KPI "Below minimum by ... so far · on track to meet it" |
| P10 | major: December projection wrong | 5.4 and E32 (amount changed, A.3) |
| P11 | major: examples disagree with the seed | 7.4 seed check values; 5.2, 5.5, 5.6 use them; 9.4 compares every shot with them |
| P12 | major: no cross program views | 5.18 Floor today, 5.19 Trends, dashboards panels, Workload with standard minutes and workspace capacity |
| P13 | major: planner not smart | 5.10 WMS capacity tint, Suggest from history, paste and CSV import with unmatched lists; 4.2 `plannerCapacity`, 3.9 import parsers |
| P14 | major: qty by weekday | 2.2.14 `qty_by_weekday`, 3.10 `qtyFor`, E43, 5.4 and 5.13 Vary by day |
| P15 | major: rate rules by attribute | 2.2.8 `pm.price_card_rules` and `rule_id`, 3.3 `compileRateRules`, E38 and E39, 5.4, 5.12 |
| P16 | major: paste SKUs | 3.9 `inferAxes`, E40 and E41, 5.4 Paste a list, Quick setup |
| P17 | major: two way linking missing | 4.2 `listRecordLinksFor` (program, build, project), 4.7 routes, 5.8 Linked section, 5.14 project side |
| P18 | major: linked jobs never roll up | M2, 5.6 All linked work, 5.3 With linked jobs column, `getJobsSummary` |
| P19 | major: price still in three places | 6.1 job prices read only on program fed jobs, 5.12 Other prices for this customer (WMS billing fees, Pulse job prices, mismatch chips), 6.2 deal line |
| P20 | major: per order charge on reopen and cancel | A7, A13 ledger, 4.3.5, 5.8 tip and "Charge on the new date" |
| P21 | major: no adjustments | 2.2.9 one time charges (`adjustment`), 3.5 step 6, E37, 5.20 |
| P22 | major: no month close workflow | A9, 2.2.13, 4.3.4 `closes.ts`, 5.20 Close {Month}, 5.6 statement PDF |
| P23 | major: wizard too heavy | 5.4 Step 0 skipped with URL modes, Set prices later with setup checklist, Quick setup |
| P24 | major: Overview clutter | 5.6 alerts strip (max 3), one forecast line, tabbed Details · Linked · Activity, right column order |
| P25 | major: Builds toolbar crowded | 5.7 toolbar (view, range, Filter, Display, More), range bar with one `range` param |
| P26 | major: menus unstructured | 5.1 menu rule, 5.5 program menu sections, 5.7 build menu order, Duplicate submenu, Cancel and Delete descriptions |
| P27 | major: copy words | 1.4 word list and replacements, `copy-rules.test.ts` (L1) |
| P28 | major: "Per order" label | D6, 2.2.17 labels "Per batch", statement "Batch fee · GLOVE-212" |
| P29 | major: holidays per program only | A15, 2.2.3 `pm.org_calendar`, 2.2.4 overrides, 5.19 Work calendar |
| P30 | major: no rate proposal flow | A10, 2.2.7 review columns, 4.4.4, 8.1 `pricing:propose` |
| P31 | minor: version number gaps | 2.2.7 numbers at first publish |
| P32 | minor: fixed 6 PM reminder | 2.2.4 `remind_at`, 4.9 step 3, 5.16 |
| P33 | minor: scan input | 5.9 scan bar, `pack_qty`, 5.20 build tickets, 3.12 `code128` |
| P34 | minor: output import | 4.2 `imports.ts`, 3.9 `parseOutputCsv`, 5.20 |
| P35 | minor: customer production report | 4.2 `reports.ts shareReport`, 5.20 Share report |
| P36 | minor: no status updates | 5.6 Updates panel, 4.2 `updates.ts`, L3 extracts the composer |
| P37 | minor: health only from money | 3.8 `programHealth` with basis, E44, 4.5 `healthBasis` |
| P38 | minor: bare "6/8" | 5.2 "5 of 8" with tooltip and aria label, check icon when done |
| P39 | minor: parity alert to everyone | 5.6, 6.1 parity, 8.1 `seesSync` |
| P40 | minor: planner create without Undo | 5.10 Undo, 5.7 bulk Undo, 4.2 `undoCreateBuilds` |
| P41 | minor: qty precedence unstated | 2.2.14 precedence, `planned_from`, 5.8 "Planned 120 · from Weekday glove run" |
| P42 | minor: adding an axis to existing variants | 2.2.5, 4.2 `saveAttributes`, 5.11 |
| P43 | minor: End program effect undefined | 4.3.7 End |
| P44 | minor: WMS move risk | D11, 6.3 snapshot test owned by L1 |
| P45 | minor: forms and run triggers | 5.17 build forms and run triggers, 4.9 step 4 |

### A.2 Engine critic

| # | Finding | Resolution |
|---|---|---|
| X1 | blocker: setup line ids cannot repeat across versions | 2.2.9 `pm.program_one_time_charges` outside the card, ref `pmf:<id>:setup:<chargeId>`, E23 |
| X2 | blocker: regenerate hits the occurrence key | 2.2.10 key `(schedule_id, schedule_date, occurrence_variant_id)` all set together; `regenerateFuture` frees keys; 9.2 test |
| X3 | blocker: `assertTaskOnJob` refuses build rows | 6.1 dedicated build path; `tasksOfProjects` `include` option (4.1) |
| X4 | blocker: `pulse_app` cannot use `core.record_links` | 2.3 grant and org policy for writes; 6.1 edge read with `throwOnError` and the empty read guard rail (read part changed, A.3) |
| X5 | blocker: fees not snapshotted | A13 `pm.program_ledger`, 4.3.2 writer in the same transaction, 4.3.4 lock list (time entries, task moves, dates), 4.1 `structure.ts` and `time.ts` |
| X6 | major: Pulse closes before the top up exists | A5, 2.2.4 `settled_through`, 6.1 month close (sync first, refuse while pending, Programs settled) |
| X7 | major: lock as a high water mark | M9, 4.2 `programLocks` with month sets, 4.3.4, 9.2 |
| X8 | major: null unit price falls back in Pulse | M4 concrete price always, 2.2.11, 2.3 recalc uses the snapshot for `pmb:` rows, no write on read, 4.9 step 5 job price watch |
| X9 | major: gone rows and moved rows | 6.1 step 4 remover over every job and in place move |
| X10 | major: typed units before linking | 3.4 `has_typed_units`, 6.1 link dialog and CSV refusal |
| X11 | major: two programs on one job | 2.1 `record_links_one_program_per_job`, 2.3 `job_links_one_program_per_job`, 6.1 parity and By variant per program |
| X12 | major: dead job behind an edge | 3.4 `LiveJob`, 4.3.3, 6.1 `deleteJob` refusal |
| X13 | major: deleted builds keep revenue | 4.1 `deleteTasks`/`restoreTasks`, 4.3.6, 3.14 reader filters |
| X14 | major: status paths outside `applyTaskUpdate` | 2.2.1 finish trigger, 4.1 `structure.ts` ledger refresh, 4.3.5 |
| X15 | major: generic project mutations bypass rules | 2.2.4 dates live on `pm.projects` only, 4.1 `projects.ts` refusals |
| X16 | major: guards incomplete | 2.2.1 KP103, KP104, KP105 with `check_build_match` |
| X17 | major: concurrency gaps | 4.3.3 `ON CONFLICT` add, lock order, 8.4 |
| X18 | major: publish flag and contradictions | 4.4.2 publish always updates open rows; 4.4.1 one immutability rule |
| X19 | major: mixed prorate | 3.5 step 5 per segment rule, E33 to E35 (approach changed, A.3) |
| X20 | major: per hour rounding and filters | 3.5 step 4 round once per day then allocate, 3.14 filters, `hourly_time_basis`, E21 |
| X21 | major: `pmt` rows collide with `pmb` rows | 3.6 build labor on the `pmb` row, `projects_time` shift for prep tasks, 6.1 step 3 |
| X22 | major: program labor never imported | 6.1 step 6 inside `syncPrograms` (approach changed, A.3) |
| X23 | major: three input loaders | 4.3.1 `@kitstak/db/programs` |
| X24 | major: copied time zone drifts | A8, 4.2 settings rule, 6.1 zone note (changed, A.3) |
| X25 | major: implicit role sees money | A10, 8.1, 9.2 |
| X26 | major: money in activity | 4.10 `money` keys stripped in `toDTO` |
| X27 | major: deploy order breaks CRM | section 2 deploy order, 6.5 column and table detection, L7 updates `docs/DEPLOYMENT.md` |
| X28 | major: work breakdown inversions | section 10: kind isolation and the program domain are one layer (L2); `structure.ts`, `prefs.ts`, `cycles.ts`, `time.ts`, `onboarding.ts`, `views.ts` have owners; `program-types.ts` is L2; templates kind in 0006 |
| X29 | major: paused and ended programs keep charging | 4.3.7, `paused_ranges`, `charge_while_paused`, E36 |
| X30 | major: deal won race | 6.2 advisory lock and key retry, 9.2 |
| X31 | minor: sync too slow for the lease | 6.1 step 7 batches and lease renewal |
| X32 | minor: `pmf` rows editable, site missing | 6.1 refusals, `site_id` = job site, parity definition |
| X33 | minor: `avgUnitPrice` scale | 3.7, E45 |
| X34 | minor: E27 labels | 3.15 labels and codes spelled out |
| X35 | minor: 0015 not rerunnable | 2.3 `DO` blocks |
| X36 | minor: seed ids change | section 7 uuidv5 ids, link wipe, `allow_purge` for own rows |
| X37 | minor: no time entries project index | 2.2.1 `time_entries_project_started_idx` |
| X38 | minor: deal currency | 3.11 `dealPrefill`, E47, 5.4 |

### A.3 Changed or declined, with reasons

- P4: the critic asked that Scheduled versions be editable in place. X18 asked for published versions to be immutable. Version 2.0 keeps one rule (only drafts change) and makes "Edit" on a Scheduled version move it back to a draft in one click. The person gets the same result, and the audit trail shows the unpublish.
- P10: the critic's corrected figure ($38,530.00, 23 work days) assumed no December holidays. The seed now has a workspace calendar with Christmas Day (P29), so the example is $36,920.00 for 22 work days, and E32 checks it.
- P2: the critic suggested Group by Run as the List default plus a Runs layout. Version 2.0 makes Runs the default Builds view and still defaults List to Group by Run.
- P22 and A9: the "Lock output through" date setting is replaced by month close. A free date lock and a month close would be two locks with different rules; closing months in order gives one lock that matches statements.
- X4: Pulse reads `core` and `pm` through `siblingDb`, which runs as the owner (`apps/pulse/src/server/integrations/detect.ts`), so the edge read already sees rows. The grant and policy are still added for the write path (linking a program from Pulse inside a `pulse_app` transaction), and the empty read guard rail is added anyway.
- X19: the critic offered two options. Version 2.0 splits fixed lines by days across versions (time weighted) instead of forbidding mid month changes, because a mid month rate change is a normal contract event and E19 already depends on it.
- X22: instead of widening `syncProjects` and the `job_links_project_time_key` index, program labor moves wholly into `syncPrograms` with explicit refs, so the project day import stays exactly as it is.
- X24: the critic proposed refusing a job link when zones differ and locked months hold time. Because both apps now count program days in the program's own zone (A8), linking never moves a day, so the link is allowed with a note; the refusal applies to changing the program zone instead.
- X5: the ledger holds fees only. Per unit revenue is already frozen per row in `pm.build_output` (M4), so it is not copied into the ledger.
- X25: the money half of the fix is taken (explicit membership for `money:read`). The other half (programs private by default) is declined: floor staff log output without being added one by one, which is how kitting floors work; owners can still make a program private.
- P12: "Dashboards widgets" are added as a Programs section of the existing dashboards page, because that page is a fixed set of report panels, not a widget builder.
