# Program types: kitting, ecommerce, production and other

Status: approved for build (2026-11-27). Builds on `docs/programs/SPEC.md` (Programs v2) and `docs/programs/PULSE_PROGRAMS_SPEC.md`. Where they disagree, this file wins for program types. The questions that were open are settled in section 2. Two facts are still to check before building, each marked "To check before building" where it applies (the `shipped_at` format in 4.4, the WMS plan check in 8).

Conventions are the ones in SPEC.md: UI copy is plain 8th grade English with no em dash, en dash or double dash; money is whole cents; work dates are `YYYY-MM-DD`; file paths are repo relative.

---

## 0. Why

Every program today is a kitting program. SPEC.md A7 says so directly: ecommerce "counts orders as units" and uses the per unit line with the unit label "orders". The seed shows what that costs (`apps/projects/src/server/db/seed/data/northwind-programs.ts`, ECOMM):

| Today | Problem |
|---|---|
| ECOMM has variants "Gift box" and "Standard", and its orders are planned and logged as builds by hand. | WMS already ships those orders. Nothing makes the typed count match the shipped count. |
| WMS has its own 3PL billing engine: Shipment, Recurring, VAS, Pick & Pack, Receiving, Storage, Return and Work Order fees (`apps/wms/src/lib/enums.ts` `BILLING_OPERATION_TYPES`). | A client with WMS shipment fees and an ecommerce program with a per order line is charged twice, and nothing warns. |
| The New program wizard always asks for a variant matrix and a build schedule. | That fits gloves, not a stream of orders. |

Goal: a program has a type. The type picks where output comes from, the defaults of its workflow and which wizard steps show. The money engine does not change. Every type works when the team bought only Projects, and connects to WMS, Pulse and CRM when they bought those too.

---

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| T1 | The type is a setting, `pm.program_settings.program_type`, not a new `pm.projects.kind`. | Dozens of filters check `kind = 'program'` (SPEC.md 4.1, pm-bridge, the Pulse sync, Portal counts). A new kind value would drop these programs from all of them. |
| T2 | Four types: `kitting`, `ecommerce`, `production`, `other`. A type earns its place only when it changes the output source, the billing check or the workflow defaults. A type that would only change a label is not added; "other" plus a unit label covers it. | Keeps the list short and honest. |
| T3 | Types are defined once, as data, in `@kitstak/programs-engine` (`program-types.ts`, section 3). Code asks the registry what a type allows. No `type === 'ecommerce'` checks outside the registry and the wizard step map. | One place to read, one place to test. |
| T4 | The engine math does not change. Types choose inputs and defaults only. E1 to E47, E26 and the Pulse parity check stay as they are. | The engine is the part that is already right. |
| T5 | Every type works with Projects alone. Another app only adds an optional output source or an optional check. | Any one app can be bought on its own (`packages/billing` catalog). |
| T6 | Where output comes from is stored as dated periods (`pm.program_sources`, 4.2). It is never worked out from what the org is licensed for today. A license that ends, a trial that ends or a failed payment never changes a past day. | A live rule would let a lapsed license change who bills a closed month. |
| T7 | A team with WMS and no Projects gets no program screens in WMS. The WMS client page shows the upsell "Add Projects to track this client as a program." (section 8). | Agreed with the user 2026-11-27. A second copy of program screens in WMS is not built. |
| T8 | WMS stays read only (SPEC.md D11 holds). The ecommerce order sync reads shipped orders from the org's WMS schema and writes only `pm` rows. | No WMS write path, route or migration for this feature, except the upsell card and the fee filter fix in 9. |
| T9 | Output from WMS is stored as ordinary builds and output rows (`planned_from = 'wms'`, `source = 'wms'`). | The ledger, `pmb:` refs, the Pulse sync, rollups, forecasts and month close all keep working with no change. |
| T10 | The type can be changed at any time while it keeps the program's current output source. Changing the output source is a new dated period (4.2), never an edit of the old one. | The type alone moves no money; the source does. |

---

## 2. Settled questions (agreed with the user 2026-11-27, binding)

| # | Question | Decision | Declined option, and why |
|---|---|---|---|
| O1 | When WMS also bills the client, who bills ecommerce order fees? | The program price card bills order fees (per order, monthly fee, minimum, setup). WMS keeps storage, receiving and returns. When the client's approved WMS contract has Shipment, Pick & Pack or Recurring fees, publishing a card with a per unit or monthly fee line shows the overlap and needs a confirm (5.4). | WMS bills everything and the program tracks orders, target and minimum gap with no money of its own. Declined: it needs a reader for WMS billing reports and breaks "one engine for program money", so it is a much larger build. |
| O2 | What makes production different from kitting? | v1 production is kitting math with production defaults: statuses with a required Quality check, scrap logged with every run, schedule on. | Billing scrap, or passing material cost through to the customer. Declined for v1: both are engine changes (Pulse stamps `units_good * unit_price`, so billed scrap breaks parity) and need their own spec. |
| O3 | What is a variant for an ecommerce program? | One variant "Orders" by default. The person can pick "One per store" or "One per order type (D2C, B2B)" so rates can differ by store. | One variant per WMS channel. Declined as the default: store or order type is what rates usually differ by. |

---

## 3. The type registry (`packages/programs-engine/src/program-types.ts`)

Pure data and pure functions, no database, exported as `@kitstak/programs-engine/program-types` and from `index.ts`.

```ts
export const PROGRAM_TYPES = ['kitting', 'ecommerce', 'production', 'other'] as const;
export type ProgramType = (typeof PROGRAM_TYPES)[number];

export const OUTPUT_SOURCE_KINDS = ['manual', 'wms_orders'] as const;
export type OutputSourceKind = (typeof OUTPUT_SOURCE_KINDS)[number];

/** What an output source needs from the org. Checked by the caller with its own availability reads. */
export interface SourceNeeds {
  readonly module: 'wms' | null;     // entitlement needed, null = Projects alone
  readonly wmsTenant: boolean;        // an org WMS schema must exist
  readonly wmsClient: boolean;        // the program must name a WMS client
}

export interface ProgramTypeDef {
  readonly id: ProgramType;
  readonly label: string;                       // UI copy
  readonly blurb: string;                       // UI copy, one line
  readonly defaultUnit: { readonly singular: string; readonly plural: string };
  readonly sources: readonly OutputSourceKind[]; // first one is the default
  readonly variantsStep: 'matrix' | 'orders' | 'optional';
  readonly scheduleDefault: boolean;            // default of "Make builds on a schedule"
  readonly defaultLines: readonly ('per_unit' | 'per_order' | 'per_hour' | 'flat_monthly' | 'monthly_minimum')[];
  readonly statuses: 'program' | 'production';  // which default status set (3.2)
  readonly scrapPrompt: boolean;                // "Log scrap with every run" default
}

export const SOURCE_NEEDS: Record<OutputSourceKind, SourceNeeds>;
export const PROGRAM_TYPE_DEFS: Record<ProgramType, ProgramTypeDef>;

/** The sources this org can pick now, with the reason for each one it cannot. */
export function offeredSources(type: ProgramType, org: { readonly wms: boolean; readonly wmsTenant: boolean }): readonly { readonly source: OutputSourceKind; readonly available: boolean; readonly reason: 'not_entitled' | 'no_tenant' | null }[];
export function isProgramType(value: unknown): value is ProgramType;
```

### 3.1 Values

| Field | kitting | ecommerce | production | other |
|---|---|---|---|---|
| label | Kitting | Ecommerce orders | Production | Other |
| blurb | Build kits from parts on a schedule. | Count the orders you ship for a client. | Make runs of a product with scrap and quality checks. | Charge by the unit, the hour or the month for anything else. |
| defaultUnit | kit / kits | order / orders | unit / units | unit / units |
| sources | manual | wms_orders, manual | manual | manual |
| variantsStep | matrix | orders | matrix | optional |
| scheduleDefault | true | false | true | false |
| defaultLines | per_unit | per_unit | per_unit | per_unit |
| statuses | program | program | production | program |
| scrapPrompt | false | false | true | false |

`sources` lists `wms_orders` first for ecommerce, but `offeredSources` marks it unavailable without WMS or a tenant, and the wizard then preselects `manual` (T5).

### 3.2 Status sets

- `program`: `DEFAULT_PROGRAM_STATUSES` from SPEC.md 2.2.17, unchanged.
- `production`: Planned (todo, default), Staged (todo), Running (in_progress), Quality check (in_progress), Done (done), Cancelled (cancelled). A build cannot move from Running to Done without passing Quality check when the program setting `require_quality_check` is on (default on for production, 4.1).

Status sets are written once at create, like today. Changing the type later never rewrites statuses.

---

## 4. Data

### 4.1 `pm.program_settings` (new columns, `apps/projects/drizzle/0008_program_types.sql`)

| Column | Type | Rule |
|---|---|---|
| `program_type` | text NOT NULL DEFAULT 'kitting' | CHECK IN ('kitting','ecommerce','production','other'). Mirrors `PROGRAM_TYPES`. |
| `require_quality_check` | boolean NOT NULL DEFAULT false | True at create for production. |
| `scrap_prompt` | boolean NOT NULL DEFAULT false | Shows the scrap field open in Log output. |

Backfill: every existing program gets `kitting`, so nothing changes for anyone. The ECOMM seed program is set to `ecommerce` with its manual source (7).

### 4.2 `pm.program_sources` (dated output source periods)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | |
| `program_id` | uuid NOT NULL FK `pm.projects(id)` ON DELETE CASCADE | A `kind='program'` row (domain check). |
| `source` | text NOT NULL | CHECK IN ('manual','wms_orders'). Mirrors `OUTPUT_SOURCE_KINDS`. |
| `starts_on` | date NOT NULL | First day this source owns. |
| `ends_on` | date NULL | Last day it owns. Null is open ended. CHECK `ends_on IS NULL OR ends_on >= starts_on`. |
| `wms_client_id` | text NULL | CHECK `(source = 'wms_orders') = (wms_client_id IS NOT NULL)`. WMS client ids equal `core.customers` ids (WMS 0009 backfill keeps the value), so the program's customer usually maps straight to it. |
| `config` | jsonb NOT NULL DEFAULT '{}' | For `wms_orders`: `{ "count": "orders" | "units", "splitBy": "none" | "store" | "order_type", "variants": { "<store or order type>": "<variantId>" } }`. |
| `state` | text NOT NULL DEFAULT 'active' | CHECK IN ('active','waiting'). `waiting` means the source cannot be read now (4.4). Never set by a license read alone. |
| `synced_through` | date NULL | Last day the order sync wrote, program time zone. |
| `last_synced_at`, `last_error`, `last_error_at` | timestamptz, text, timestamptz | Sync health for Settings. |
| `created_by` | uuid NOT NULL | |
| `created_at`, `updated_at` | timestamptz | |

Rules (domain, with a db test for each):

1. Periods of one program never overlap. Enforced in the domain under `pg_advisory_xact_lock(hashtext('program-sources:' || program_id))`, plus a partial unique index `program_sources_open_key` on (program_id) WHERE ends_on IS NULL.
2. A day with no period belongs to `manual`. So programs made before this feature need no rows.
3. A period never starts or ends inside a locked month (SPEC.md M9). Refusal: "November is closed. Start the new source on Dec 1 or later."
4. Switching source ends the open period on the day before the new one starts, in the same transaction.

### 4.3 Widened constants (each mirrored by its CHECK)

```ts
// apps/projects/src/lib/constants.ts
export const OUTPUT_SOURCES = ['manual', 'scan', 'import', 'form', 'wms'] as const;
export const PLANNED_FROM = ['manual', 'schedule', 'variant_default', 'planner', 'unplanned', 'split', 'import', 'form', 'wms'] as const;
export const PROGRAM_TYPES = /* re-export of the engine list */;
```

`pm.build_output.source` and `pm.builds.planned_from` CHECKs widen in 0008. Nothing else in the build tables changes.

### 4.4 Ecommerce order sync

New sweep step 8 in `scheduleProgramSweep` (SPEC.md 4.9), file `apps/projects/src/server/domain/programs/wms-orders.ts`, reader in `apps/projects/src/server/integrations/wms-orders.ts` (through `wmsSchemaFor(ctx)` and `wmsTableExists`, like `wms-kits.ts`).

What counts:

- WMS `shipment_orders` rows with `client_id = wms_client_id` and `status IN ('Shipped', 'Partially Shipped', 'Delivered')`.
- The work date is `shipped_at` as a day in the program time zone. To check before building: the format of `shipped_at` (stored as text). If it can be a date with no time or zone, read it as that day.
- `count = 'orders'`: one per order. `count = 'units'`: `total_quantity`.
- `splitBy` picks the variant: `none` is the program's single variant, `store` uses `store_name` (empty is "No store"), `order_type` uses `order_type` (D2C, B2B). A store or type with no mapped variant gets a new variant the first time it is seen, named after it, with no rate (so the card rate applies).

How it writes:

1. Window: from the later of `starts_on` and the first open day of the program, through today in the program time zone, at most 92 days back. Older open days keep what they have, and Settings says "Days before Aug 27 were not checked again."
2. One grouped read per program: `(work date, variant key) -> count`. The read is strict: on any error, record `last_error`, write nothing, delete nothing. The same guard as the Pulse `programEdges` read.
3. Per (variant, day): find or make the build (`planned_from = 'wms'`, planned equals built, title from `build_title_pattern`, status Done), then upsert the output row (`source = 'wms'`) through the same domain call people use, so prices, posting, snapshots and the ledger refresh happen as today (SPEC.md 4.3.3).
4. A (variant, day) that is now 0, for example an order cancelled after it shipped, soft deletes that output row on an open day. Locked days are never touched; the difference shows as "WMS now says 4 fewer orders on Oct 3. October is closed." with "Add an adjustment".
5. Emit one `pm_program_changed` per program per sweep that changed rows, so Pulse picks the rows up.

People and WMS rows:

- Output with `source = 'wms'` cannot be edited or deleted by hand: "Orders for this day come from WMS. Add an adjustment to change the charge."
- Builds cannot be planned or logged by hand on days a `wms_orders` period owns: "WMS counts orders for ECOMM from Dec 1."

Performance: one grouped query per program per sweep, on the existing WMS indexes for client and status. Measure on the seed tenant before release.

---

## 5. Working with one app or all of them

### 5.1 What each mix gets

| Bought | Programs | Ecommerce program |
|---|---|---|
| WMS only | None. The WMS client page shows the upsell (8). | WMS billing and workflows cover the client alone. |
| Projects only | All four types. | Orders are typed or imported. The WMS source shows as unavailable with the reason. |
| Pulse only | None. Pulse jobs work alone, as today. | None. |
| CRM only | None. | None. |
| Projects + WMS | All four types. | Orders can come from WMS. The overlap check (5.4) runs. |
| Projects + Pulse | All four types, with cost and margin. | As Projects only, plus margin. |
| Projects + CRM | All four types; start from a won deal. | As Projects only. |
| All four | Everything. | Orders from WMS, margin in Pulse, start from a deal, overlap check. |

A test walks all 15 mixes through `offeredSources` and the wizard step map and checks the table above (9).

### 5.2 Adding WMS later

Settings and the Overview setup card offer "Count orders from WMS" on an ecommerce program once WMS and a tenant exist.

- The person picks the WMS client and the first day. The default first day is tomorrow.
- A first day in the past (open days only) replaces typed output on those days. A confirm shows both counts before anything changes: "This replaces 3,120 typed orders from Nov 1 to Nov 27 with 3,104 orders from WMS."
- Typed output before the first day stays as it is.

### 5.3 Losing WMS

The sync stops writing when the org is no longer entitled to WMS, the tenant is gone, the client is gone, or reads have failed for 24 hours. Then:

- The period's `state` becomes `waiting`. Nothing is deleted, and the period dates do not change (T6).
- The program shows the alert "Orders stopped coming from WMS on Dec 3. Type them in or turn WMS back on." and allows typed output on days after `synced_through`.
- When reads work again, the sync resumes from `synced_through`. Days that now have typed output are kept and listed: "Dec 4 to Dec 6 have typed orders. Use the WMS orders instead?" with "Use WMS orders" and "Keep typed orders".
- Losing Projects: SPEC.md 6.5 holds (LockedScreen; rows already in Pulse stay).

### 5.4 Overlap check (O1)

Runs when a card version for an ecommerce program is published, and on the wizard's Price card step, only when WMS is entitled and the program has a WMS client.

- Read the client's approved contract fees with operation type Shipment, Pick & Pack or Recurring (`clientBillingFees`, widened, 9).
- When the card has a per unit line or a monthly fee and such fees exist, show: "WMS already bills Brightcart Online for Shipment ($0.85) and Pick & Pack ($0.30). Charging per order here too bills them twice." with "I know, publish anyway" and "Cancel".
- Publishing anyway records activity `price_card.overlap_confirmed` with the fee names on that version. The version is dated, so the choice is dated too (T6).
- Without WMS the check does not run and says nothing.

---

## 6. New program wizard (`apps/projects/src/features/programs/wizard`)

### 6.1 Steps

New first step "Type". Steps: Type, Start, Basics, Variants (or Orders), Price card, Schedule, Links and review.

- Type is skipped and hidden when the URL has `?type=`, or the start is a template or a copy (both carry the type).
- Four radio cards, the same size and grid as Start, each with the registry label and blurb. Order: kitting, ecommerce, production, other. When the org's Portal setup profile says `businessType = '3pl'`, ecommerce moves first (read only, no new profile fields).
- `WizardState` gains `type: ProgramType` (default `kitting`). `stateFromDraft` already spreads defaults, so old drafts open as kitting; `v` stays 1.
- Quick setup gains the same choice as a ToggleGroup at the top.

### 6.2 Per type

Kitting: unchanged.

Ecommerce: the Variants step becomes "Orders".

- Field "Where do orders come from?" (radio):
  - "From KitStak WMS". Needs WMS and a tenant. Without WMS it is disabled with "Add WMS to count shipped orders on their own." (with "Learn more" only when the plan can add it). Without a tenant: "Set up your warehouse in WMS first."
  - "I will type or import them".
- When WMS: "WMS client" (preselected when the program customer is a WMS client), "Count" (Orders, Units), "Split by" (One line, Store, Order type), "Start counting on" (default the program start date). Preview from one read: "Last 30 days: 3,104 orders · about 103 a day".
- The Schedule step is hidden for the WMS source and off by default for typed orders.
- The Price card step runs the overlap check (5.4).

Production: the Variants step is titled "Products" (matrix as today). Schedule on by default. Basics gains "Require a quality check before done" (on) and "Log scrap with every run" (on).

Other: the Variants step shows "One line, no variants" (default) or the matrix. Schedule off by default.

### 6.3 Server

- `ProgramWizardPayload` gains `type` and, for ecommerce, `source: { kind: 'manual' } | { kind: 'wms_orders'; wmsClientId; count; splitBy; startsOn }`.
- `createProgramAction` validates the source with `offeredSources` against live availability at create time, writes `program_type`, the status set, and the first `pm.program_sources` row when the source is `wms_orders`, then runs one sync so the Overview is filled on first open.
- Program templates (`saveProgramTemplate`) store the type and source kind, never the WMS client.
- The CRM deal won trigger (SPEC.md 6.2) takes the type from its program template, else kitting.

---

## 7. Seed and other apps

- Seed: ECOMM gets `program_type = 'ecommerce'` with no source rows (manual). The seed check values in SPEC.md 7.4 do not change. A WMS sourced example is a later seed change in the Northwind tenant, with its own check values.
- Pulse: no change. WMS sourced output reaches Pulse as `pmb:` rows like any other output. The program card shows the type label next to the unit.
- CRM: the Programs tab shows the type label on each program card.
- Portal: no change beyond reading `businessType` for card order (6.1).

---

## 8. WMS only upsell

Place: the WMS client detail page (`apps/wms/src/app/(app)/clients/[id]`), in the side column.

- Shown when the WMS Projects bridge says `not_licensed` (`apps/wms/src/server/projects/bridge.ts`) and the plan can add Projects. The plan check is the one the Projects locked frame uses (`notInPlan` and `addHrefs` in `apps/projects/src/features/shell/locked-frame.tsx`); to check before building: whether the WMS shell already exposes those two values, else add them the same way. Hidden on manual grants. Dismissible per person.
- Title "Track this client as a program". Body "Add Projects to track this client as a program." Second line "See their orders against a monthly minimum and a target, and close each month." Button "Add Projects" opens Portal billing with Projects added.
- When the org has Projects, the same place shows "Programs for this client": `listLinkedPrograms` with a `core_customer` target equal to the client id, each with key, name, type label and this month's orders. Empty: "No programs for this client yet." with "Start a program" (`newProgramUrl` in `packages/pm-bridge/src/programs.ts` gains an optional `type`; here `type=ecommerce` and the customer).

---

## 9. Found while writing this

`clientBillingFees` in `apps/projects/src/server/integrations/wms-kits.ts` keeps fees whose `operation_type` is 'VAS', 'Kitting' or 'Value Added Service'. `billing_fees.operation_type` only allows `BILLING_OPERATION_TYPES` (`apps/wms/src/server/db/schema/billing.ts`), which has 'VAS' and 'Work Order' but no 'Kitting' or 'Value Added Service'. So kitting work order fees never show under "Other prices for this customer" today. Fix in the same change: filter on a passed list of operation types, using ('VAS', 'Work Order') for kitting and ('Shipment', 'Pick & Pack', 'Recurring') for the overlap check. Check prod data for legacy values before changing the filter.

---

## 10. Tests

Unit (vitest, pure):

- Registry: every type has every field; `offeredSources` for each type and each of the 4 org states; labels pass the copy rules.
- App mix table: all 15 mixes of crm, wms, projects and pulse against 5.1 (which types, which sources, which wizard steps, upsell shown or not).
- Wizard model: old drafts open as kitting; ecommerce with WMS hides Schedule; payload carries type and source.
- Order bucketing: ship date to program day across time zones and the day boundary; `splitBy` mapping; unknown store makes one variant once.

DB tests (`*.db.test.ts`):

- Source periods: no overlap, no start or end inside a locked month, switch closes the old period in the same transaction.
- Sync: idempotent (two runs, same rows); a failed read writes and deletes nothing; a cancelled order removes the row on an open day and leaves a locked day alone with the note; WMS rows refuse hand edits.
- Losing WMS: `waiting`, nothing deleted, typed output allowed after `synced_through`, resume keeps typed days until the person chooses.
- Overlap check: shows with overlapping fees, silent without WMS, the confirm is recorded on the version.
- Engine cases E1 to E47 and the Pulse parity assertion run unchanged.

End to end (`apps/projects/scripts/e2e-programs.mjs`): make an ecommerce program from the wizard on the Northwind tenant with the WMS source, see the first sync fill the Overview, publish a card through the overlap confirm, and see the same month total in Pulse.

---

## 11. Build order

1. Engine registry and tests (no app change).
2. Migration 0008, constants, domain for source periods; Settings shows the type (read only for the source until step 4).
3. Wizard Type step and per type steps, with the manual source only.
4. WMS order reader and sweep step, Settings source switch, losing and adding WMS (5.2, 5.3).
5. Overlap check and the `clientBillingFees` fix.
6. WMS client page upsell and "Programs for this client".
7. CRM and Pulse type labels, seed change, end to end script.

Steps 1 to 3 ship value alone: types and their defaults with typed output, for every app mix.
