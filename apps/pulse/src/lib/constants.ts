/**
 * Enums shared by the database schema, server domain layer and client UI.
 * Pure module (no server imports): safe to use anywhere. Every list that is stored in a table is
 * mirrored by a CHECK constraint in apps/pulse/drizzle/*.sql; change both together (new migration).
 */

/** Who performed a change. Non-user actors are treated as the workspace owner by the domain. */
export const ACTOR_KINDS = ['user', 'automation', 'system', 'integration', 'device'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * Risk status of a job (docs/pulse/SPEC.md 4.14). Worst first. The labels are the only words
 * people ever see for a status, in every app, export and report.
 */
export const PULSE_STATUSES = ['losing', 'at_risk', 'heads_up', 'on_track', 'no_data'] as const;
export type PulseStatus = (typeof PULSE_STATUSES)[number];

export const PULSE_STATUS_LABELS: Readonly<Record<PulseStatus, string>> = {
  losing: 'Losing money',
  at_risk: 'At risk',
  heads_up: 'Heads up',
  on_track: 'On track',
  no_data: 'Not enough data',
};

export const DEPENDENCY_KINDS = ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

/** Named colors from the shared token palette (`--label-<name>-*` in @kitstak/ui tokens.css; same set as CRM). */
export const LABEL_COLORS = [
  'green',
  'orange',
  'red',
  'gray',
  'blue',
  'dark-blue',
  'purple',
  'pink',
  'teal',
  'yellow',
  'lime',
  'brown',
  'sky',
  'berry',
  'indigo',
  'peach',
  'green-light',
  'orange-light',
  'red-light',
  'blue-light',
  'purple-light',
  'pink-light',
  'teal-light',
  'yellow-light',
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

/* ------------------------------------------------------------------------------------------
 * Stored enums of the `pulse` schema (docs/pulse/SPEC.md section 5). Each list mirrors a CHECK.
 * ---------------------------------------------------------------------------------------- */

export const JOB_STATUS_VALUES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type JobStatusValue = (typeof JOB_STATUS_VALUES)[number];
export const JOB_STATUS_LABELS: Readonly<Record<JobStatusValue, string>> = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
/** Statuses that count as "open" on the Jobs page. */
export const OPEN_JOB_STATUSES: readonly JobStatusValue[] = ['active', 'on_hold'];

export const JOB_KIND_VALUES = ['one_time', 'ongoing'] as const;
export type JobKindValue = (typeof JOB_KIND_VALUES)[number];

export const PRICING_MODEL_VALUES = ['per_unit', 'fixed', 'hourly'] as const;
export type PricingModelValue = (typeof PRICING_MODEL_VALUES)[number];
export const PRICING_MODEL_LABELS: Readonly<Record<PricingModelValue, string>> = {
  per_unit: 'Price per unit',
  fixed: 'One fixed price',
  hourly: 'Price per labor hour',
};

export const MATERIAL_METHOD_VALUES = ['standard', 'actual'] as const;
export type MaterialMethodValue = (typeof MATERIAL_METHOD_VALUES)[number];

export const PARTS_OWNER_VALUES = ['us', 'client'] as const;
export type PartsOwnerValue = (typeof PARTS_OWNER_VALUES)[number];

export const LABOR_CLASS_KINDS = ['employee', 'temp_agency'] as const;
export type LaborClassKind = (typeof LABOR_CLASS_KINDS)[number];

export const VAS_BILLING_VALUES = ['per_unit', 'per_hour', 'flat'] as const;
export type VasBilling = (typeof VAS_BILLING_VALUES)[number];

export const STANDARD_BASIS_VALUES = ['typed', 'history', 'time_study'] as const;
export type StandardBasis = (typeof STANDARD_BASIS_VALUES)[number];

export const TARGET_SCOPES = ['org', 'site', 'client', 'job_type', 'vas_service'] as const;
export type TargetScope = (typeof TARGET_SCOPES)[number];
export const TARGET_METRICS = ['margin_pct', 'profit', 'revenue', 'units_per_labor_hour', 'labor_pct_of_revenue', 'cost_per_unit', 'utilization_pct'] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

export const PLAN_KINDS = ['quote', 'budget'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const PLAN_ORIGINS = ['typed', 'csv', 'calculator', 'crm_deal', 'wms_contract', 'copied_from_quote', 'sample'] as const;
export type PlanOrigin = (typeof PLAN_ORIGINS)[number];
export const PLAN_LINE_CATEGORIES = ['revenue', 'labor', 'setup', 'material', 'other'] as const;
export type PlanLineCategory = (typeof PLAN_LINE_CATEGORIES)[number];
export const PLAN_LINE_UNITS = ['unit', 'hour', 'each', 'flat'] as const;
export type PlanLineUnit = (typeof PLAN_LINE_UNITS)[number];

export const LINK_TARGET_TYPES = ['crm_deal', 'crm_account', 'wms_work_order', 'wms_shipment_order', 'wms_client', 'pm_project', 'pm_task'] as const;
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number];

export const STREAM_SOURCES = ['manual', 'csv', 'wms', 'crm', 'projects', 'punch', 'system', 'sample'] as const;
export type StreamSource = (typeof STREAM_SOURCES)[number];

export const INDIRECT_REASONS = ['meeting', 'training', 'cleanup', 'waiting', 'maintenance', 'break', 'other'] as const;
export type IndirectReason = (typeof INDIRECT_REASONS)[number];
export const INDIRECT_REASON_LABELS: Readonly<Record<IndirectReason, string>> = {
  meeting: 'Meeting',
  training: 'Training',
  cleanup: 'Cleanup',
  waiting: 'Waiting',
  maintenance: 'Maintenance',
  break: 'Break',
  other: 'Other',
};

export const COST_SCOPES = ['job', 'client', 'company'] as const;
export type CostScope = (typeof COST_SCOPES)[number];
export const COST_CATEGORIES = [
  'freight',
  'packaging',
  'equipment',
  'outside_service',
  'rework',
  'supplies',
  'storage',
  'rent',
  'utilities',
  'salaried_staff',
  'insurance',
  'other',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const COST_CATEGORY_LABELS: Readonly<Record<CostCategory, string>> = {
  freight: 'Freight',
  packaging: 'Packaging',
  equipment: 'Equipment',
  outside_service: 'Outside help',
  rework: 'Rework',
  supplies: 'Supplies',
  storage: 'Storage',
  rent: 'Rent',
  utilities: 'Utilities',
  salaried_staff: 'Salaried staff',
  insurance: 'Insurance',
  other: 'Other',
};

/** Revenue kinds a person may type. `fixed_true_up` is written by the system only. */
export const REVENUE_KINDS = ['invoice', 'fee', 'adjustment', 'credit'] as const;
export type RevenueKind = (typeof REVENUE_KINDS)[number];
export type StoredRevenueKind = RevenueKind | 'fixed_true_up';
export const REVENUE_KIND_LABELS: Readonly<Record<StoredRevenueKind, string>> = {
  invoice: 'Invoice',
  fee: 'Fee',
  adjustment: 'Adjustment',
  credit: 'Credit',
  fixed_true_up: 'Fixed price true up',
};

export const FACT_KINDS = ['revenue_base', 'revenue_vas', 'revenue_other', 'labor', 'material', 'other', 'shared', 'billed_memo'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
/** Kinds that count in profit. `billed_memo` never does. */
export const PROFIT_KINDS: readonly FactKind[] = ['revenue_base', 'revenue_vas', 'revenue_other', 'labor', 'material', 'other', 'shared'];

export const PROFIT_GROUPS = ['job', 'client', 'type', 'service', 'site', 'month', 'week', 'day'] as const;
export type ProfitGroup = (typeof PROFIT_GROUPS)[number];

export const SHARED_COST_RULE_VALUES = ['none', 'by_labor_hours', 'full', 'percent_of_labor'] as const;
export type SharedCostRuleValue = (typeof SHARED_COST_RULE_VALUES)[number];
export const SHARED_SPREAD_VALUES = ['day', 'week', 'month'] as const;
export type SharedSpreadValue = (typeof SHARED_SPREAD_VALUES)[number];

export const DAY_REVIEW_STATUSES = ['complete', 'approved', 'sent_back'] as const;
export type DayReviewStatus = (typeof DAY_REVIEW_STATUSES)[number];

export const ALERT_KINDS = [
  'job_losing',
  'job_at_risk',
  'margin_below',
  'labor_over_budget',
  'material_over_budget',
  'productivity_below',
  'no_entry_days',
  'due_soon_behind',
  'missing_rate',
  'missing_price',
  'missing_hours',
  'unbilled_above',
  'client_margin_below',
  'vas_margin_below',
  'missing_time_above',
  'overhead_rate_off',
  'wms_shortage',
  'deal_won_no_job',
  'month_ready_to_close',
  'import_failed',
  'sync_failed',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const ALERT_STATUSES = ['open', 'snoozed', 'resolved', 'dismissed'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const ALERT_ENTITY_TYPES = ['job', 'client', 'vas_service', 'site', 'period', 'import', 'sync', 'deal'] as const;
export type AlertEntityType = (typeof ALERT_ENTITY_TYPES)[number];

export const SAVED_VIEW_PAGES = ['jobs', 'profit', 'log', 'labor', 'reports', 'alerts'] as const;
export type SavedViewPage = (typeof SAVED_VIEW_PAGES)[number];

export const JOB_MODE_VALUES = ['projected', 'actuals', 'final'] as const;
export type JobModeValue = (typeof JOB_MODE_VALUES)[number];
export const CONFIDENCE_VALUES = ['plan', 'early', 'good', 'solid'] as const;
export type ConfidenceValue = (typeof CONFIDENCE_VALUES)[number];

/** Tabs of the Jobs page. */
export const JOB_TABS = ['open', 'all', 'completed', 'planned'] as const;
export type JobTab = (typeof JOB_TABS)[number];

/** How many days back a supervisor may log or edit (SPEC section 3). */
export const SUPERVISOR_EDIT_DAYS = 7;
