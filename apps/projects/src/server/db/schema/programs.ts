/**
 * Program side tables (drizzle/0006_programs.sql, docs/programs/SPEC.md 2.2). Typed mirror for
 * queries only: CHECKs, triggers (KP101 to KP105, finish sync) and partial indexes live in the SQL.
 *
 * A program is a pm.projects row with kind 'program'; a build is a pm.tasks row with kind 'build'
 * plus its 1 to 1 pm.builds row. Money is whole cents (bigint, mode 'bigint'), unit prices are
 * numeric(14,4) strings, quantities numeric(14,3) strings, dates of work 'YYYY-MM-DD' strings.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  HOURLY_TIME_BASES,
  LEDGER_KINDS,
  LEDGER_POSTINGS,
  ONE_TIME_KINDS,
  OUTPUT_SOURCES,
  PLANNED_FROM,
  POSTINGS,
  PRICE_LINE_KINDS,
  PRICE_SOURCES,
  PROJECT_ROLES,
  RATE_RULE_OPS,
  REVIEW_STATUSES,
  SCHEDULE_PATTERNS,
  SCHEDULE_STATUSES,
  VARIANT_STATUSES,
  VERSION_SOURCES,
  VERSION_STATUSES,
  WIZARD_DRAFT_KINDS,
  type LabelColor,
} from '@/lib/constants';
import { createdAt, deletedAt, id, orgId, pmSchema, tstz, updatedAt } from './_shared';
import { projects, statuses } from './projects';
import { tasks } from './tasks';

/** A workspace holiday ("Thanksgiving"). */
export interface CalendarHoliday {
  readonly date: string;
  readonly name: string;
}

/** A paused stretch of a program. `to` is null while it is paused. */
export interface PausedRange {
  readonly from: string;
  readonly to: string | null;
}

/** One value of a variant attribute axis ("Small", code "S"). */
export interface AttributeValue {
  readonly id: string;
  readonly label: string;
  readonly code: string;
  readonly color: LabelColor | null;
}

/** Variant attributes: `{ [attributeId]: valueId }`. */
export type VariantAttributes = Record<string, string>;

/** "Vary by day": weekday "0" to "6" to a qty string. */
export type QtyByWeekday = Record<string, string>;

const version = () => integer('version').notNull().default(1);
const money = (name: string) => bigint(name, { mode: 'bigint' });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
const price = (name: string) => numeric(name, { precision: 14, scale: 4 });
const day = (name: string) => date(name, { mode: 'string' });

/** 2.2.3 Workspace calendar (1 to 1 with an org). A missing row means the defaults. */
export const orgCalendar = pmSchema.table('org_calendar', {
  orgId: uuid('org_id').primaryKey(),
  timezone: text('timezone').notNull().default('America/Chicago'),
  /** JS weekday numbers, 0 is Sunday. */
  workingDays: smallint('working_days').array().notNull().default(sql`'{1,2,3,4,5}'`),
  holidays: jsonb('holidays').$type<CalendarHoliday[]>().notNull().default(sql`'[]'::jsonb`),
  dailyCapacityHours: numeric('daily_capacity_hours', { precision: 10, scale: 2 }),
  version: version(),
  updatedAt: updatedAt(),
});

/** 2.2.4 Program settings (1 to 1 with a program). */
export const programSettings = pmSchema.table(
  'program_settings',
  {
    programId: uuid('program_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    orgId: orgId(),
    unitSingular: text('unit_singular').notNull().default('kit'),
    unitPlural: text('unit_plural').notNull().default('kits'),
    timezone: text('timezone').notNull(),
    /** Null uses the workspace work days. */
    workingDays: smallint('working_days').array(),
    useOrgHolidays: boolean('use_org_holidays').notNull().default(true),
    extraDaysOff: day('extra_days_off').array().notNull().default(sql`'{}'`),
    extraWorkDays: day('extra_work_days').array().notNull().default(sql`'{}'`),
    currency: text('currency').notNull().default('USD'),
    monthlyTargetCents: money('monthly_target_cents'),
    dailyTargetUnits: qty('daily_target_units'),
    buildTitlePattern: text('build_title_pattern').notNull().default('{variant} · {date}'),
    autoStartOnOutput: boolean('auto_start_on_output').notNull().default(true),
    autoDoneWhenFull: boolean('auto_done_when_full').notNull().default(true),
    moneyMinRole: text('money_min_role', { enum: PROJECT_ROLES }).notNull().default('editor'),
    hourlyTimeBasis: text('hourly_time_basis', { enum: HOURLY_TIME_BASES }).notNull().default('billable'),
    /** "Remind if no output by". Null is Off. */
    remindAt: time('remind_at').default('18:00'),
    pausedRanges: jsonb('paused_ranges').$type<PausedRange[]>().notNull().default(sql`'[]'::jsonb`),
    /** Cache: last day of the latest closed program month. Written only by close and reopen. */
    lockedThrough: day('locked_through'),
    /** Last month end whose month end charges are in the ledger. Written by the sweep. */
    settledThrough: day('settled_through'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('program_settings_org_idx').on(t.orgId)],
);

/** 2.2.5 Variant generator axes (Size, Color). */
export const programAttributes = pmSchema.table(
  'program_attributes',
  {
    id: id(),
    orgId: orgId(),
    programId: uuid('program_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    values: jsonb('values').$type<AttributeValue[]>().notNull().default(sql`'[]'::jsonb`),
    position: text('position').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('program_attributes_program_name_live').on(t.programId, sql`lower(${t.name})`).where(sql`${t.deletedAt} IS NULL`)],
);

/** 2.2.6 The program's kits (Small Brown). */
export const programVariants = pmSchema.table(
  'program_variants',
  {
    id: id(),
    orgId: orgId(),
    programId: uuid('program_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    attributes: jsonb('attributes').$type<VariantAttributes>().notNull().default(sql`'{}'::jsonb`),
    sku: text('sku'),
    defaultQty: qty('default_qty'),
    packQty: qty('pack_qty'),
    stdMinutesPerUnit: numeric('std_minutes_per_unit', { precision: 10, scale: 3 }),
    /** Money field (Pulse margin per variant). */
    materialCostPerUnit: price('material_cost_per_unit'),
    /** Cached copy of the `uses_kit` edge to core.items. */
    coreItemId: uuid('core_item_id'),
    /** Cached copy of the `uses_kit` edge to the WMS kit product. */
    wmsProductId: text('wms_product_id'),
    color: text('color'),
    position: text('position').notNull(),
    status: text('status', { enum: VARIANT_STATUSES }).notNull().default('active'),
    version: version(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('program_variants_program_key_live').on(t.programId, t.key).where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('program_variants_program_name_live').on(t.programId, sql`lower(${t.name})`).where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('program_variants_program_sku_live').on(t.programId, t.sku).where(sql`${t.deletedAt} IS NULL AND ${t.sku} IS NOT NULL`),
    index('program_variants_core_item_idx').on(t.orgId, t.coreItemId).where(sql`${t.coreItemId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('program_variants_wms_product_idx').on(t.orgId, t.wmsProductId).where(sql`${t.wmsProductId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
);

/** 2.2.7 Dated copies of the price card. Only drafts change (4.4). */
export const priceCardVersions = pmSchema.table(
  'price_card_versions',
  {
    id: id(),
    orgId: orgId(),
    programId: uuid('program_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Given at first publish and kept if the version moves back to a draft. */
    number: integer('number'),
    status: text('status', { enum: VERSION_STATUSES }).notNull().default('draft'),
    effectiveFrom: day('effective_from').notNull(),
    label: text('label'),
    note: text('note'),
    source: text('source', { enum: VERSION_SOURCES }).notNull().default('manual'),
    sourceRef: text('source_ref'),
    reviewStatus: text('review_status', { enum: REVIEW_STATUSES }).notNull().default('none'),
    reviewNote: text('review_note'),
    reviewRequestedBy: uuid('review_requested_by'),
    reviewRequestedAt: tstz('review_requested_at'),
    publishedAt: tstz('published_at'),
    publishedBy: uuid('published_by'),
    version: version(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('price_card_versions_program_number_key').on(t.programId, t.number).where(sql`${t.number} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex('price_card_versions_published_day_key').on(t.programId, t.effectiveFrom).where(sql`${t.status} = 'published' AND ${t.deletedAt} IS NULL`),
    uniqueIndex('price_card_versions_pending_day_key')
      .on(t.programId, t.effectiveFrom)
      .where(sql`${t.status} = 'draft' AND ${t.source} = 'variant_tab' AND ${t.deletedAt} IS NULL`),
    index('price_card_versions_program_status_idx').on(t.programId, t.status, t.effectiveFrom).where(sql`${t.deletedAt} IS NULL`),
  ],
);

/** 2.2.8 Rate rules ("Size is XL: add $0.25"), compiled into per unit variant lines. */
export const priceCardRules = pmSchema.table(
  'price_card_rules',
  {
    id: id(),
    orgId: orgId(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => priceCardVersions.id, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => programAttributes.id, { onDelete: 'restrict' }),
    valueId: text('value_id').notNull(),
    op: text('op', { enum: RATE_RULE_OPS }).notNull(),
    amount: price('amount').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [unique('price_card_rules_value_key').on(t.versionId, t.attributeId, t.valueId), index('price_card_rules_attribute_idx').on(t.attributeId)],
);

/** 2.2.8 One charge on a version. */
export const priceCardLines = pmSchema.table(
  'price_card_lines',
  {
    id: id(),
    orgId: orgId(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => priceCardVersions.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: PRICE_LINE_KINDS }).notNull(),
    /** `per_unit` and `per_order` only; null is the card default for the kind. */
    variantId: uuid('variant_id').references(() => programVariants.id, { onDelete: 'restrict' }),
    /** Set on per unit variant lines compiled from rules. */
    ruleId: uuid('rule_id').references(() => priceCardRules.id, { onDelete: 'cascade' }),
    unitPrice: price('unit_price'),
    rateCents: integer('rate_cents'),
    amountCents: money('amount_cents'),
    /** Fixed lines: "Charge part of it in a partial month". */
    prorate: boolean('prorate').notNull().default(true),
    chargeWhilePaused: boolean('charge_while_paused').notNull().default(true),
    label: text('label'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('price_card_lines_version_kind_variant_key').on(t.versionId, t.kind, sql`coalesce(${t.variantId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    index('price_card_lines_variant_idx').on(t.variantId).where(sql`${t.variantId} IS NOT NULL`),
  ],
);

/** 2.2.9 Setup fees and adjustments, dated charges outside the versioned card. */
export const programOneTimeCharges = pmSchema.table(
  'program_one_time_charges',
  {
    id: id(),
    orgId: orgId(),
    programId: uuid('program_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ONE_TIME_KINDS }).notNull(),
    chargeOn: day('charge_on').notNull(),
    /** Signed: a negative adjustment is a credit. */
    amountCents: money('amount_cents').notNull(),
    label: text('label').notNull(),
    reason: text('reason'),
    variantId: uuid('variant_id').references(() => programVariants.id, { onDelete: 'set null' }),
    countsTowardMinimum: boolean('counts_toward_minimum').notNull().default(false),
    version: version(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('program_one_time_charges_program_day_idx').on(t.programId, t.chargeOn).where(sql`${t.deletedAt} IS NULL`)],
);

/** 2.2.14 Repeating rules that make builds ahead of time. */
export const buildSchedules = pmSchema.table(
  'build_schedules',
  {
    id: id(),
    orgId: orgId(),
    programId: uuid('program_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status', { enum: SCHEDULE_STATUSES }).notNull().default('active'),
    pattern: text('pattern', { enum: SCHEDULE_PATTERNS }).notNull(),
    days: smallint('days').array().notNull().default(sql`'{}'`),
    intervalWeeks: smallint('interval_weeks').notNull().default(1),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on'),
    leadDays: smallint('lead_days').notNull().default(7),
    skipHolidays: boolean('skip_holidays').notNull().default(true),
    skipDates: day('skip_dates').array().notNull().default(sql`'{}'`),
    defaultAssigneeId: uuid('default_assignee_id'),
    defaultStatusId: uuid('default_status_id').references(() => statuses.id, { onDelete: 'set null' }),
    generatedThrough: day('generated_through'),
    lastRunAt: tstz('last_run_at'),
    version: version(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('build_schedules_program_idx').on(t.programId, t.status).where(sql`${t.deletedAt} IS NULL`),
    index('build_schedules_org_active_idx').on(t.orgId).where(sql`${t.status} = 'active' AND ${t.deletedAt} IS NULL`),
  ],
);

/** 2.2.14 One variant line of a schedule. */
export const buildScheduleLines = pmSchema.table(
  'build_schedule_lines',
  {
    id: id(),
    orgId: orgId(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => buildSchedules.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => programVariants.id, { onDelete: 'cascade' }),
    qty: qty('qty').notNull(),
    qtyByWeekday: jsonb('qty_by_weekday').$type<QtyByWeekday>(),
    assigneeId: uuid('assignee_id'),
    position: integer('position').notNull().default(0),
  },
  (t) => [unique('build_schedule_lines_variant_key').on(t.scheduleId, t.variantId), index('build_schedule_lines_variant_idx').on(t.variantId)],
);

/** 2.2.10 Build facts (1 to 1 with a kind 'build' task; kept consistent by `builds_match_task`). */
export const builds = pmSchema.table(
  'builds',
  {
    taskId: uuid('task_id')
      .primaryKey()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    orgId: orgId(),
    /** The task's project (a program or a project). */
    containerId: uuid('container_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The container when it is a program, else null. */
    programId: uuid('program_id').references(() => projects.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => programVariants.id, { onDelete: 'restrict' }),
    buildDate: day('build_date').notNull(),
    plannedQty: qty('planned_qty').notNull(),
    plannedFrom: text('planned_from', { enum: PLANNED_FROM }).notNull().default('manual'),
    /** Cache: sum of live output qty, changed as `built_qty + delta` under a row lock. */
    builtQty: qty('built_qty').notNull().default('0'),
    scrapQty: qty('scrap_qty').notNull().default('0'),
    rateOverride: price('rate_override'),
    rateOverrideReason: text('rate_override_reason'),
    unplanned: boolean('unplanned').notNull().default(false),
    closedShort: boolean('closed_short').notNull().default(false),
    closeReason: text('close_reason'),
    splitFromId: uuid('split_from_id').references((): AnyPgColumn => builds.taskId, { onDelete: 'set null' }),
    /** First day the build entered done (trigger). */
    firstFinishedOn: day('first_finished_on'),
    /** The batch charge date while done (trigger). */
    finishedOn: day('finished_on'),
    scheduleId: uuid('schedule_id').references(() => buildSchedules.id, { onDelete: 'set null' }),
    /** The occurrence date that made it. Never changes. */
    scheduleDate: day('schedule_date'),
    /** The variant the occurrence was made for. Never changes. */
    occurrenceVariantId: uuid('occurrence_variant_id'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('builds_container_date_idx').on(t.containerId, t.buildDate),
    index('builds_program_variant_date_idx').on(t.programId, t.variantId, t.buildDate).where(sql`${t.programId} IS NOT NULL`),
    index('builds_open_idx').on(t.orgId, t.buildDate).where(sql`${t.finishedOn} IS NULL`),
    index('builds_program_finished_idx').on(t.programId, t.finishedOn).where(sql`${t.finishedOn} IS NOT NULL`),
    index('builds_variant_idx').on(t.variantId).where(sql`${t.variantId} IS NOT NULL`),
    uniqueIndex('builds_schedule_occurrence_key').on(t.scheduleId, t.scheduleDate, t.occurrenceVariantId).where(sql`${t.scheduleId} IS NOT NULL`),
  ],
);

/** 2.2.11 One row per build per work date, with its price snapshot (M4). */
export const buildOutput = pmSchema.table(
  'build_output',
  {
    id: id(),
    orgId: orgId(),
    containerId: uuid('container_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').references(() => projects.id, { onDelete: 'cascade' }),
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.taskId, { onDelete: 'cascade' }),
    variantId: uuid('variant_id'),
    workDate: day('work_date').notNull(),
    qty: qty('qty').notNull(),
    scrapQty: qty('scrap_qty').notNull().default('0'),
    /** Concrete snapshot: '0.0000' for source none. */
    unitPrice: price('unit_price').notNull(),
    priceSource: text('price_source', { enum: PRICE_SOURCES }).notNull(),
    cardVersionId: uuid('card_version_id'),
    revenueCents: money('revenue_cents').notNull().default(BigInt(0)),
    posting: text('posting', { enum: POSTINGS }).notNull(),
    pulseJobId: uuid('pulse_job_id'),
    source: text('source', { enum: OUTPUT_SOURCES }).notNull().default('manual'),
    note: text('note'),
    enteredBy: uuid('entered_by'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('build_output_build_day_key').on(t.buildId, t.workDate).where(sql`${t.deletedAt} IS NULL`),
    index('build_output_program_day_idx').on(t.orgId, t.programId, t.workDate).where(sql`${t.deletedAt} IS NULL`),
    index('build_output_container_day_idx').on(t.orgId, t.containerId, t.workDate).where(sql`${t.deletedAt} IS NULL`),
    index('build_output_job_day_idx').on(t.orgId, t.pulseJobId, t.workDate).where(sql`${t.pulseJobId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
);

/** 2.2.12 Posted fees (A13). Only the ledger writer changes rows. */
export const programLedger = pmSchema.table(
  'program_ledger',
  {
    id: id(),
    orgId: orgId(),
    programId: uuid('program_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Stable ref (3.6), `pmf:<programId>:...`. */
    ref: text('ref').notNull(),
    kind: text('kind', { enum: LEDGER_KINDS }).notNull(),
    chargeDate: day('charge_date').notNull(),
    /** First day of the charge's month. */
    month: day('month').notNull(),
    cents: money('cents').notNull(),
    quantity: qty('quantity'),
    unitPrice: price('unit_price'),
    variantId: uuid('variant_id'),
    buildId: uuid('build_id'),
    versionId: uuid('version_id'),
    lineId: uuid('line_id'),
    oneTimeId: uuid('one_time_id'),
    label: text('label').notNull(),
    countsTowardMinimum: boolean('counts_toward_minimum').notNull().default(false),
    posting: text('posting', { enum: LEDGER_POSTINGS }).notNull(),
    pulseJobId: uuid('pulse_job_id'),
    computedAt: tstz('computed_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('program_ledger_ref_key').on(t.orgId, t.ref).where(sql`${t.deletedAt} IS NULL`),
    index('program_ledger_program_month_idx').on(t.orgId, t.programId, t.month).where(sql`${t.deletedAt} IS NULL`),
  ],
);

/** 2.2.13 Month close (A9). */
export const programCloses = pmSchema.table(
  'program_closes',
  {
    id: id(),
    orgId: orgId(),
    programId: uuid('program_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** First day of the month. */
    month: day('month').notNull(),
    totalCents: money('total_cents').notNull(),
    units: qty('units').notNull(),
    checklist: jsonb('checklist').$type<Record<string, unknown>>().notNull(),
    closedBy: uuid('closed_by').notNull(),
    closedAt: tstz('closed_at').notNull(),
    reopenedBy: uuid('reopened_by'),
    reopenedAt: tstz('reopened_at'),
    reopenReason: text('reopen_reason'),
  },
  (t) => [
    uniqueIndex('program_closes_program_month_key').on(t.programId, t.month).where(sql`${t.reopenedAt} IS NULL`),
    index('program_closes_program_idx').on(t.orgId, t.programId, t.month),
  ],
);

/** 2.2.15 Program wizard drafts, private to their author. */
export const wizardDrafts = pmSchema.table(
  'wizard_drafts',
  {
    id: id(),
    orgId: orgId(),
    userId: uuid('user_id').notNull(),
    kind: text('kind', { enum: WIZARD_DRAFT_KINDS }).notNull(),
    title: text('title').notNull().default('Untitled program'),
    step: smallint('step').notNull().default(0),
    /** `ProgramWizardPayload` (validated by zod on read). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('wizard_drafts_user_idx').on(t.orgId, t.userId, t.updatedAt.desc())],
);

export type OrgCalendar = typeof orgCalendar.$inferSelect;
export type ProgramSettingsRow = typeof programSettings.$inferSelect;
export type ProgramAttribute = typeof programAttributes.$inferSelect;
export type ProgramVariant = typeof programVariants.$inferSelect;
export type PriceCardVersion = typeof priceCardVersions.$inferSelect;
export type PriceCardRule = typeof priceCardRules.$inferSelect;
export type PriceCardLine = typeof priceCardLines.$inferSelect;
export type ProgramOneTimeCharge = typeof programOneTimeCharges.$inferSelect;
export type BuildSchedule = typeof buildSchedules.$inferSelect;
export type BuildScheduleLine = typeof buildScheduleLines.$inferSelect;
export type Build = typeof builds.$inferSelect;
export type NewBuild = typeof builds.$inferInsert;
export type BuildOutputRow = typeof buildOutput.$inferSelect;
export type ProgramLedgerEntry = typeof programLedger.$inferSelect;
export type ProgramClose = typeof programCloses.$inferSelect;
export type WizardDraft = typeof wizardDrafts.$inferSelect;
