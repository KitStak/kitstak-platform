/** 5.3 Data streams (dated, closed months refuse writes) and the rollup tables. */
import { boolean, date, integer, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { base, cents, heads, hrs, id, orgId, price, pulseSchema, qty, stream } from './_shared';

const laborStamps = () => ({
  rateCents: integer('rate_cents'),
  overtimeRateCents: integer('overtime_rate_cents'),
  overheadCents: cents('overhead_cents').notNull().default(BigInt(0)),
  grossPayCents: cents('gross_pay_cents').notNull().default(BigInt(0)),
  needsRate: boolean('needs_rate').notNull().default(false),
});

export const productionEntries = pulseSchema.table('production_entries', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  jobId: uuid('job_id').notNull(),
  workDate: date('work_date').notNull(),
  shift: text('shift').notNull().default('day'),
  laborClassId: uuid('labor_class_id'),
  unitsGood: qty('units_good').notNull().default('0'),
  unitsScrap: qty('units_scrap').notNull().default('0'),
  unitsRework: qty('units_rework').notNull().default('0'),
  headcount: heads('headcount'),
  hours: hrs('hours').notNull().default('0'),
  overtimeHours: hrs('overtime_hours').notNull().default('0'),
  setupHours: hrs('setup_hours').notNull().default('0'),
  hoursConfirmed: boolean('hours_confirmed').notNull().default(true),
  note: text('note'),
  /** Projects task the hours were for (0014). Checked against the job's linked projects on save. */
  pmTaskId: uuid('pm_task_id'),
  /** Optional count of that step's output. Never part of units_good, progress, revenue or pace. */
  taskUnits: qty('task_units'),
  ...laborStamps(),
  laborCostCents: cents('labor_cost_cents').notNull().default(BigInt(0)),
  sharedCents: cents('shared_cents').notNull().default(BigInt(0)),
  baseRevenueCents: cents('base_revenue_cents').notNull().default(BigInt(0)),
  stdMaterialCents: cents('std_material_cents').notNull().default(BigInt(0)),
  stdScrapCents: cents('std_scrap_cents').notNull().default(BigInt(0)),
  enteredBy: uuid('entered_by'),
  ...stream(),
});

export const indirectEntries = pulseSchema.table('indirect_entries', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  workDate: date('work_date').notNull(),
  laborClassId: uuid('labor_class_id'),
  reason: text('reason').notNull(),
  headcount: heads('headcount'),
  hours: hrs('hours').notNull(),
  overtimeHours: hrs('overtime_hours').notNull().default('0'),
  note: text('note'),
  ...laborStamps(),
  costCents: cents('cost_cents').notNull().default(BigInt(0)),
  ...stream(),
});

export const paidHours = pulseSchema.table('paid_hours', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  workDate: date('work_date').notNull(),
  laborClassId: uuid('labor_class_id'),
  paidHours: hrs('paid_hours').notNull(),
  paidCents: cents('paid_cents'),
  ...stream(),
});

export const timePunches = pulseSchema.table('time_punches', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  workDate: date('work_date').notNull(),
  employeeCode: text('employee_code').notNull(),
  employeeName: text('employee_name'),
  jobId: uuid('job_id'),
  reason: text('reason'),
  laborClassId: uuid('labor_class_id'),
  hours: hrs('hours').notNull(),
  overtimeHours: hrs('overtime_hours').notNull().default('0'),
  payCents: cents('pay_cents'),
  ...stream(),
});

export const materialUsage = pulseSchema.table('material_usage', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  jobId: uuid('job_id').notNull(),
  usageDate: date('usage_date').notNull(),
  itemId: uuid('item_id'),
  itemSku: text('item_sku'),
  itemName: text('item_name'),
  quantityUsed: qty('quantity_used').notNull(),
  quantityScrapped: qty('quantity_scrapped').notNull().default('0'),
  quantityPlanned: qty('quantity_planned'),
  unitCost: price('unit_cost').notNull().default('0'),
  uom: text('uom'),
  lot: text('lot'),
  suppliedBy: text('supplied_by'),
  resolvedSuppliedBy: text('resolved_supplied_by').notNull().default('us'),
  note: text('note'),
  costCents: cents('cost_cents').notNull().default(BigInt(0)),
  scrapCents: cents('scrap_cents').notNull().default(BigInt(0)),
  ...stream(),
});

export const costEntries = pulseSchema.table('cost_entries', {
  ...base(),
  siteId: uuid('site_id'),
  scope: text('scope').notNull(),
  jobId: uuid('job_id'),
  clientId: uuid('client_id'),
  costDate: date('cost_date').notNull(),
  category: text('category').notNull(),
  amountCents: cents('amount_cents').notNull(),
  vendor: text('vendor'),
  reference: text('reference'),
  note: text('note'),
  ...stream(),
});

export const revenueEntries = pulseSchema.table('revenue_entries', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  jobId: uuid('job_id'),
  clientId: uuid('client_id').notNull(),
  revenueDate: date('revenue_date').notNull(),
  kind: text('kind').notNull(),
  description: text('description'),
  quantity: qty('quantity'),
  unitPrice: price('unit_price'),
  amountCents: cents('amount_cents').notNull(),
  invoiceNumber: text('invoice_number'),
  vasServiceId: uuid('vas_service_id'),
  serviceLabel: text('service_label'),
  approved: boolean('approved').notNull().default(true),
  note: text('note'),
  ...stream(),
});

export const vasEntries = pulseSchema.table('vas_entries', {
  ...base(),
  siteId: uuid('site_id').notNull(),
  vasServiceId: uuid('vas_service_id').notNull(),
  clientId: uuid('client_id').notNull(),
  jobId: uuid('job_id'),
  workDate: date('work_date').notNull(),
  quantity: qty('quantity').notNull(),
  unitPrice: price('unit_price'),
  amountCents: cents('amount_cents'),
  laborClassId: uuid('labor_class_id'),
  headcount: heads('headcount'),
  hours: hrs('hours').notNull().default('0'),
  overtimeHours: hrs('overtime_hours').notNull().default('0'),
  materialCents: cents('material_cents').notNull().default(BigInt(0)),
  note: text('note'),
  ...laborStamps(),
  laborCostCents: cents('labor_cost_cents').notNull().default(BigInt(0)),
  sharedCents: cents('shared_cents').notNull().default(BigInt(0)),
  ...stream(),
});

export const factDays = pulseSchema.table('fact_days', {
  id: id(),
  orgId: orgId(),
  workDate: date('work_date').notNull(),
  siteId: uuid('site_id').notNull(),
  clientId: uuid('client_id').notNull(),
  jobId: uuid('job_id'),
  jobTypeId: uuid('job_type_id'),
  vasServiceId: uuid('vas_service_id'),
  kind: text('kind').notNull(),
  amountCents: cents('amount_cents').notNull().default(BigInt(0)),
  unitsGood: numeric('units_good', { precision: 16, scale: 3 }).notNull().default('0'),
  unitsScrap: numeric('units_scrap', { precision: 16, scale: 3 }).notNull().default('0'),
  hours: numeric('hours', { precision: 12, scale: 2 }).notNull().default('0'),
});

export const companyDays = pulseSchema.table('company_days', {
  orgId: orgId(),
  siteId: uuid('site_id').notNull(),
  workDate: date('work_date').notNull(),
  directHours: numeric('direct_hours', { precision: 12, scale: 2 }).notNull().default('0'),
  indirectHours: numeric('indirect_hours', { precision: 12, scale: 2 }).notNull().default('0'),
  paidHours: numeric('paid_hours', { precision: 12, scale: 2 }).notNull().default('0'),
  missingHours: numeric('missing_hours', { precision: 12, scale: 2 }).notNull().default('0'),
  indirectCents: cents('indirect_cents').notNull().default(BigInt(0)),
  sharedAppliedCents: cents('shared_applied_cents').notNull().default(BigInt(0)),
  missingCents: cents('missing_cents').notNull().default(BigInt(0)),
  paidCents: cents('paid_cents'),
  grossPayCents: cents('gross_pay_cents').notNull().default(BigInt(0)),
  companyCostCents: cents('company_cost_cents').notNull().default(BigInt(0)),
  overheadAbsorbedCents: cents('overhead_absorbed_cents').notNull().default(BigInt(0)),
  overLogged: boolean('over_logged').notNull().default(false),
});
