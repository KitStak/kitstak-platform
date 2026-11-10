/** Work: jobs, job types, tasks, wave rules, waves, allocation exceptions. */
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { FilterCondition, JobTypeSettings, OrderByClause } from "../../../lib/domain-types";
import {
  JOB_LABEL_STATUSES,
  JOB_STATUSES,
  OPERATION_TYPES,
  PICK_LIST_STATUSES,
  PRIORITIES,
  REPLENISHMENT_PHASES,
  SHORT_STATUSES,
  TASK_STATUSES,
  TASK_TYPES,
  WAVE_ASSIGN_MODES,
  WAVE_DELETE_METHODS,
  WAVE_OP_TYPES,
  WAVE_STATUSES,
} from "../../../lib/enums";
import type { WEEKDAYS } from "../../../lib/enums";
import { bool, EMPTY_JSON_ARRAY, json, nowIso, pk, requiredPk, stamps } from "../columns";
import { users } from "./identity";
import { clients, warehouses } from "./org";
import { shipmentOrders } from "./outbound";

export const jobTypes = sqliteTable("job_types", {
  id: pk(),
  code: text("code").notNull(),
  description: text("description").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  operationType: text("operation_type", { enum: OPERATION_TYPES }).notNull(),
  allocationAlgorithmId: text("allocation_algorithm_id"),
  template: text("template"),
  // order scope, flags, batch {method,min,max}, mobile screens, count/replen/WO flags
  settings: json<JobTypeSettings>("settings").notNull(),
  conditions: json<FilterCondition[]>("conditions").notNull().default(EMPTY_JSON_ARRAY),
  locationConditions: json<FilterCondition[]>("location_conditions"),
  skuConditions: json<FilterCondition[]>("sku_conditions"),
  sourceLocationConditions: json<FilterCondition[]>("source_location_conditions"),
  destinationLocationConditions: json<FilterCondition[]>("destination_location_conditions"),
  lpConditions: json<FilterCondition[]>("lp_conditions"),
  productConditions: json<FilterCondition[]>("product_conditions"),
  orderBy: json<OrderByClause[]>("order_by").notNull().default(sql`'[{"field":"walkingPathPriority","dir":"asc"}]'`),
  groupBy: json<string[]>("group_by"),
  isActive: bool("is_active").notNull().default(true),
  ...stamps(),
}, (t) => [uniqueIndex("job_types_code_idx").on(t.warehouseId, t.code)]);

/** `jobType` is the job-type code snapshot (plain text); `jobTypeId` is authoritative. */
export const jobs = sqliteTable("jobs", {
  id: requiredPk(),
  code: text("code").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  clientId: text("client_id").references(() => clients.id),
  jobType: text("job_type").notNull(),
  status: text("status", { enum: JOB_STATUSES }).notNull(),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("None"),
  assignedToUserId: text("assigned_to_user_id").references(() => users.id),
  orderCount: integer("order_count").notNull().default(0),
  unitCount: integer("unit_count").notNull().default(0),
  completedUnits: integer("completed_units").notNull().default(0),
  waveNumber: text("wave_number"),
  ruleName: text("rule_name"),
  completedAt: text("completed_at"),
  jobTypeId: text("job_type_id").references(() => jobTypes.id),
  operationType: text("operation_type", { enum: OPERATION_TYPES }).notNull().default("Picking"),
  waveId: text("wave_id"),
  waveRuleId: text("wave_rule_id"),
  countPlanId: text("count_plan_id"),
  workOrderId: text("work_order_id"),
  plannedStartAt: text("planned_start_at"),
  plannedEndAt: text("planned_end_at"),
  startedAt: text("started_at"),
  labelStatus: text("label_status", { enum: JOB_LABEL_STATUSES }).notNull().default("No Label"),
  pickListStatus: text("pick_list_status", { enum: PICK_LIST_STATUSES }).notNull().default("Not Printed"),
  mobileCartId: text("mobile_cart_id"),
  pickingZone: text("picking_zone"),
  isResolutionJob: bool("is_resolution_job").notNull().default(false),
  isPrecartonization: bool("is_precartonization").notNull().default(false),
  taskCount: integer("task_count").notNull().default(0),
  completedTaskCount: integer("completed_task_count").notNull().default(0),
  ...stamps(),
}, (t) => [
  uniqueIndex("jobs_code_idx").on(t.code),
  index("jobs_status_idx").on(t.warehouseId, t.status),
  index("jobs_wave_idx").on(t.waveId),
  // Count plan grids look up their jobs by plan (counts REQ-8).
  index("jobs_count_plan_idx").on(t.countPlanId),
]);

export const jobOrders = sqliteTable("job_orders", {
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull().references(() => shipmentOrders.id),
  toteOrCell: text("tote_or_cell"),
}, (t) => [
  primaryKey({ columns: [t.jobId, t.orderId] }),
  index("job_orders_order_idx").on(t.orderId),
]);

export const tasks = sqliteTable("tasks", {
  id: pk(),
  taskNo: integer("task_no").notNull(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  warehouseId: text("warehouse_id").notNull(),
  clientId: text("client_id"),
  taskType: text("task_type", { enum: TASK_TYPES }).notNull(),
  status: text("status", { enum: TASK_STATUSES }).notNull().default("Pending"),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("None"),
  sequence: integer("sequence").notNull().default(0),
  orderId: text("order_id"),
  orderLineId: text("order_line_id"),
  allocationId: text("allocation_id"),
  workOrderId: text("work_order_id"),
  countPlanId: text("count_plan_id"),
  countLineId: text("count_line_id"),
  productId: text("product_id"),
  packType: text("pack_type"),
  toPackType: text("to_pack_type"),
  plannedQty: integer("planned_qty").notNull().default(0),
  actualQty: integer("actual_qty").notNull().default(0),
  sourceLocationId: text("source_location_id"),
  sourceLpId: text("source_lp_id"),
  targetLocationId: text("target_location_id"),
  targetLpId: text("target_lp_id"),
  targetCartId: text("target_cart_id"),
  lotNumber: text("lot_number"),
  expiryDate: text("expiry_date"),
  productionDate: text("production_date"),
  damageReason: text("damage_reason"),
  replenishmentPhase: text("replenishment_phase", { enum: REPLENISHMENT_PHASES }),
  lpSwap: bool("lp_swap").notNull().default(false),
  lpAutoRemoved: bool("lp_auto_removed").notNull().default(false),
  packTypeConversionApplied: bool("pack_type_conversion_applied").notNull().default(false),
  pickShortStatus: text("pick_short_status", { enum: SHORT_STATUSES }).notNull().default("None"),
  packShortStatus: text("pack_short_status", { enum: SHORT_STATUSES }).notNull().default("None"),
  assigneeUserId: text("assignee_user_id"),
  executedByUserId: text("executed_by_user_id"),
  plannedStartAt: text("planned_start_at"),
  plannedFinishAt: text("planned_finish_at"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  ...stamps(),
}, (t) => [
  index("tasks_job_idx").on(t.jobId),
  index("tasks_order_idx").on(t.orderId),
  index("tasks_status_idx").on(t.taskType, t.status),
  uniqueIndex("tasks_no_idx").on(t.taskNo),
  // Open-task counts per location (locations grid, detail, delete guard; facility-config REQ-R2-8).
  index("tasks_source_location_idx").on(t.sourceLocationId, t.status),
  index("tasks_target_location_idx").on(t.targetLocationId, t.status),
]);

export const waveRules = sqliteTable("wave_rules", {
  id: pk(),
  ruleSeq: integer("rule_seq").notNull(),
  name: text("name").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  operationType: text("operation_type", { enum: WAVE_OP_TYPES }).notNull(),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("None"),
  deleteIfNotStarted: bool("delete_if_not_started").notNull().default(false),
  deleteMethod: text("delete_method", { enum: WAVE_DELETE_METHODS }).notNull().default("None"),
  deleteTime: text("delete_time"),
  jobTypeIds: json<string[]>("job_type_ids").notNull().default(EMPTY_JSON_ARRAY), // ordered precedence
  filters: json<FilterCondition[]>("filters").notNull().default(EMPTY_JSON_ARRAY),
  orderBy: json<OrderByClause[]>("order_by").notNull().default(EMPTY_JSON_ARRAY),
  scheduleDays: json<(typeof WEEKDAYS)[number][]>("schedule_days").notNull().default(EMPTY_JSON_ARRAY),
  scheduleTimes: json<string[]>("schedule_times").notNull().default(EMPTY_JSON_ARRAY), // "HH:mm" warehouse tz
  assignMode: text("assign_mode", { enum: WAVE_ASSIGN_MODES }).notNull().default("Pool"),
  assigneeRoleIds: json<string[]>("assignee_role_ids"),
  assigneeUserIds: json<string[]>("assignee_user_ids"),
  countType: text("count_type", { enum: ["Location", "SKU"] }),
  lockLocations: bool("lock_locations").notNull().default(false),
  softAllocation: bool("soft_allocation").notNull().default(false),
  mergeRuleIds: json<string[]>("merge_rule_ids"),
  isActive: bool("is_active").notNull().default(true),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: text("last_run_at"),
  lastRunBy: text("last_run_by"),
  lastWaveNo: text("last_wave_no"),
  nextRunAt: text("next_run_at"),
  ...stamps(),
}, (t) => [index("wave_rules_wh_idx").on(t.warehouseId, t.operationType)]);

export const waves = sqliteTable("waves", {
  id: pk(),
  waveNo: text("wave_no").notNull(),
  waveRuleId: text("wave_rule_id").references(() => waveRules.id),
  warehouseId: text("warehouse_id").notNull(),
  status: text("status", { enum: WAVE_STATUSES }).notNull().default("Pending"),
  ordersMet: integer("orders_met").notNull().default(0),
  shortageOrders: integer("shortage_orders").notNull().default(0),
  jobsCreated: integer("jobs_created").notNull().default(0),
  allocatedOrders: integer("allocated_orders").notNull().default(0),
  mergedOrders: integer("merged_orders").notNull().default(0),
  message: text("message"),
  runBy: text("run_by").notNull(), // user name | "Integration" (scheduler)
  runAt: text("run_at").notNull().$defaultFn(nowIso),
  finishedAt: text("finished_at"),
}, (t) => [
  uniqueIndex("waves_no_idx").on(t.waveNo),
  index("waves_rule_idx").on(t.waveRuleId),
]);

export const allocationExceptions = sqliteTable("allocation_exceptions", {
  id: pk(),
  orderId: text("order_id").notNull(),
  waveId: text("wave_id"),
  waveNo: text("wave_no").notNull(), // wave no | "Manual Allocation" | "Manual Allocation - Work Order"
  waveRuleName: text("wave_rule_name"),
  algorithmName: text("algorithm_name"),
  algorithmRuleName: text("algorithm_rule_name"),
  shortageProductId: text("shortage_product_id"),
  inventoryUomQty: integer("inventory_uom_qty"),
  orderLineQty: integer("order_line_qty"),
  explanation: text("explanation").notNull(),
  isRolledBack: bool("is_rolled_back").notNull().default(false),
  runBy: text("run_by").notNull(),
  runAt: text("run_at").notNull().$defaultFn(nowIso),
  warehouseId: text("warehouse_id").notNull(),
  clientId: text("client_id").notNull(),
}, (t) => [
  index("alloc_exc_wave_idx").on(t.waveNo),
  index("alloc_exc_order_idx").on(t.orderId),
]);
