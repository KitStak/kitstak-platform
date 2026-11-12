/** Counts: count plans, plan lines, per-bucket count entries. */
import { index, integer, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { wmsSchema } from './_schema';
import {
  COUNT_LINE_STATUSES,
  COUNT_OPERATION_TYPES,
  COUNT_PLAN_STATUSES,
  COUNT_TYPES,
} from '../../../lib/enums';
import { bool, nowIso, pk, stamps } from '../columns';
import { warehouses } from './org';

export const countPlans = wmsSchema.table(
  'count_plans',
  {
    id: pk(),
    code: text('code').notNull(),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    description: text('description'),
    scheduledAt: text('scheduled_at').notNull(),
    lockLocations: bool('lock_locations').notNull().default(false),
    countType: text('count_type', { enum: COUNT_TYPES }).notNull(),
    operationType: text('operation_type', { enum: COUNT_OPERATION_TYPES }).notNull().default('Cycle Count'),
    status: text('status', { enum: COUNT_PLAN_STATUSES }).notNull().default('Pending'),
    isAi: bool('is_ai').notNull().default(false),
    waveRuleId: text('wave_rule_id'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    inventoryUpdatedAt: text('inventory_updated_at'),
    inventoryUpdatedBy: text('inventory_updated_by'),
    ...stamps(),
  },
  (t) => [uniqueIndex('count_plan_code_idx').on(t.warehouseId, t.code)],
);

export const countPlanLines = wmsSchema.table(
  'count_plan_lines',
  {
    id: pk(),
    planId: text('plan_id')
      .notNull()
      .references(() => countPlans.id, { onDelete: 'cascade' }),
    locationId: text('location_id'),
    productId: text('product_id'),
    lpId: text('lp_id'),
    jobId: text('job_id'),
    status: text('status', { enum: COUNT_LINE_STATUSES }).notNull().default('Pending'),
    initialStockQty: integer('initial_stock_qty').notNull().default(0),
    countedQty: integer('counted_qty'),
    approvedStockQty: integer('approved_stock_qty'),
    approvedCountQty: integer('approved_count_qty'),
    isRecountLine: bool('is_recount_line').notNull().default(false),
    recountOfLineId: text('recount_of_line_id'),
    recounted: bool('recounted').notNull().default(false),
    countUserId: text('count_user_id'),
    note: text('note'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    inventoryUpdatedAt: text('inventory_updated_at'),
    inventoryUpdatedBy: text('inventory_updated_by'),
    ...stamps(),
  },
  (t) => [
    index('count_lines_plan_idx').on(t.planId),
    index('count_lines_plan_status_idx').on(t.planId, t.status),
    index('count_lines_location_idx').on(t.locationId),
  ],
);

/** One row per bucket counted in a line. */
export const countLineEntries = wmsSchema.table(
  'count_line_entries',
  {
    id: pk(),
    lineId: text('line_id')
      .notNull()
      .references(() => countPlanLines.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    locationId: text('location_id').notNull(),
    lpId: text('lp_id'),
    lotNumber: text('lot_number'),
    expiryDate: text('expiry_date'),
    damageReason: text('damage_reason'),
    packType: text('pack_type').notNull(),
    systemQty: integer('system_qty').notNull(),
    countedQty: integer('counted_qty').notNull(),
    countedBy: text('counted_by'),
    countedAt: text('counted_at').notNull().$defaultFn(nowIso),
  },
  (t) => [index('count_entries_line_idx').on(t.lineId)],
);
