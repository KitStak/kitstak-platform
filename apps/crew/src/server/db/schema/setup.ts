/** 5.1 Setup: settings, roles, sites, labor rules, break rules, areas, labor classes. */
import { boolean, date, integer, jsonb, numeric, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { base, createdAt, crewSchema, deletedAt, src, tstz, updatedAt, version } from './_shared';

export const settings = crewSchema.table('settings', {
  orgId: uuid('org_id').primaryKey(),
  defaultMemberRole: text('default_member_role').notNull().default('none'),
  weekStart: smallint('week_start').notNull().default(0),
  defaultTimezone: text('default_timezone').notNull().default('America/Chicago'),
  pinLength: smallint('pin_length').notNull().default(4),
  phoneClock: boolean('phone_clock').notNull().default(true),
  fenceMode: text('fence_mode').notNull().default('flag'),
  punchPhotos: boolean('punch_photos').notNull().default(false),
  photoRetentionDays: smallint('photo_retention_days').notNull().default(90),
  scheduleEmail: boolean('schedule_email').notNull().default(true),
  agencyLinks: boolean('agency_links').notNull().default(true),
  numberPrefixTemp: text('number_prefix_temp').notNull().default('T-'),
  numberSeq: integer('number_seq').notNull().default(1000),
  indirectBp: integer('indirect_bp').notNull().default(0),
  onboarding: jsonb('onboarding').$type<Record<string, unknown>>().notNull().default({}),
  sampleLoadedAt: tstz('sample_loaded_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberRoles = crewSchema.table('member_roles', {
  ...base(),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull(),
  /** null = all sites; only read for supervisor and lead. */
  siteIds: uuid('site_ids').array(),
  updatedBy: uuid('updated_by'),
});

export interface SiteAddress {
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly country?: string;
}

export const sites = crewSchema.table('sites', {
  ...base(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  address: jsonb('address').$type<SiteAddress>(),
  geoLat: numeric('geo_lat', { precision: 9, scale: 6 }),
  geoLng: numeric('geo_lng', { precision: 9, scale: 6 }),
  fenceRadiusM: integer('fence_radius_m').notNull().default(150),
  weekStart: smallint('week_start').notNull(),
  defaultTemplateId: uuid('default_template_id'),
  pulseSiteId: uuid('pulse_site_id'),
  wmsWarehouseId: text('wms_warehouse_id'),
  lastRolloverDate: date('last_rollover_date'),
  archivedAt: tstz('archived_at'),
  version: version(),
  deletedAt: deletedAt(),
});

export const siteRules = crewSchema.table('site_rules', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  preset: text('preset').notNull().default('federal'),
  roundingMode: text('rounding_mode').notNull().default('exact'),
  roundIncrementMinutes: smallint('round_increment_minutes'),
  lateGraceMinutes: smallint('late_grace_minutes').notNull().default(5),
  earlyOutGraceMinutes: smallint('early_out_grace_minutes').notNull().default(5),
  shortBreakPaidUnderMinutes: smallint('short_break_paid_under_minutes').notNull().default(20),
  otWeeklyMinutes: integer('ot_weekly_minutes').default(2400),
  otDailyMinutes: integer('ot_daily_minutes'),
  dtDailyMinutes: integer('dt_daily_minutes'),
  seventhDayRule: boolean('seventh_day_rule').notNull().default(false),
  note: text('note'),
  version: version(),
});

export const breakRules = crewSchema.table('break_rules', {
  ...base(),
  siteRuleId: uuid('site_rule_id').notNull(),
  kind: text('kind').notNull(),
  nth: smallint('nth').notNull().default(1),
  afterWorkedMinutes: integer('after_worked_minutes').notNull(),
  minMinutes: smallint('min_minutes').notNull(),
  paid: boolean('paid').notNull(),
  checked: boolean('checked').notNull().default(true),
});

export const areas = crewSchema.table('areas', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  color: text('color'),
  position: integer('position').notNull().default(0),
  archivedAt: tstz('archived_at'),
  deletedAt: deletedAt(),
});

export const laborClasses = crewSchema.table('labor_classes', {
  ...base(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('employee'),
  isDefault: boolean('is_default').notNull().default(false),
  pulseLaborClassId: uuid('pulse_labor_class_id'),
  archivedAt: tstz('archived_at'),
  deletedAt: deletedAt(),
  ...src(),
});
