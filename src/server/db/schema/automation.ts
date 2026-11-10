/** Automation: putaway/allocation algorithms, workflows, rate shopping presets. */
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { OrderByClause, RuleCondition, RuleConditionNode } from "../../../lib/domain-types";
import {
  ACTIVE_PASSIVE,
  ALGORITHM_KINDS,
  MATCH_MODES,
  RATE_SHOPPING_METHODS,
  WORKFLOW_TRIGGERS,
} from "../../../lib/enums";
import type { WORKFLOW_ACTIONS } from "../../../lib/enums";
import { bool, EMPTY_JSON_ARRAY, json, nowIso, pk, stamps } from "../columns";
import { carrierServices } from "./integrations";
import { warehouses } from "./org";

export const algorithms = sqliteTable("algorithms", {
  id: pk(),
  name: text("name").notNull(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  kind: text("kind", { enum: ALGORITHM_KINDS }).notNull(),
  status: text("status", { enum: ACTIVE_PASSIVE }).notNull().default("Active"),
  isDynamicReplenishment: bool("is_dynamic_replenishment").notNull().default(false),
  enforceSuggestedLocations: bool("enforce_suggested_locations").notNull().default(false),
  isSystem: bool("is_system").notNull().default(false),
  ...stamps(),
}, (t) => [uniqueIndex("algorithms_name_idx").on(t.warehouseId, t.kind, t.name)]);

export interface AlgorithmAction {
  action: string;
  value?: unknown;
}

export const algorithmRules = sqliteTable("algorithm_rules", {
  id: pk(),
  algorithmId: text("algorithm_id").notNull().references(() => algorithms.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  name: text("name").notNull(),
  isActive: bool("is_active").notNull().default(true),
  conditions: json<RuleCondition[]>("conditions").notNull(), // [] = Apply To All
  inventoryConditions: json<RuleCondition[]>("inventory_conditions"), // allocation only
  actions: json<AlgorithmAction[]>("actions"), // putaway only (38 action keys)
  orderBy: json<OrderByClause[]>("order_by").notNull(),
}, (t) => [index("algorithm_rules_algo_idx").on(t.algorithmId, t.sequence)]);

export interface WorkflowAction {
  action: (typeof WORKFLOW_ACTIONS)[number];
  params: Record<string, unknown>;
}

export const workflows = sqliteTable("workflows", {
  id: pk(),
  name: text("name").notNull(),
  description: text("description"),
  trigger: text("trigger", { enum: WORKFLOW_TRIGGERS }).notNull(),
  warehouseId: text("warehouse_id"),
  clientId: text("client_id"),
  match: text("match", { enum: MATCH_MODES }).notNull().default("All"),
  conditions: json<RuleConditionNode[]>("conditions").notNull().default(EMPTY_JSON_ARRAY), // conditions and nested AND/OR groups
  actions: json<WorkflowAction[]>("actions").notNull(),
  sequence: integer("sequence").notNull().default(0),
  isActive: bool("is_active").notNull().default(true),
  stopProcessing: bool("stop_processing").notNull().default(false),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: text("last_run_at"),
  ...stamps(),
}, (t) => [index("workflows_trigger_idx").on(t.trigger, t.sequence)]);

export const workflowRuns = sqliteTable("workflow_runs", {
  id: pk(),
  workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  matched: bool("matched").notNull(),
  actionsApplied: json<string[]>("actions_applied"),
  blockType: text("block_type", { enum: ["Fully", "Partially"] }),
  error: text("error"),
  at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [index("wf_runs_entity_idx").on(t.entityType, t.entityId)]);

export const rateShoppingPresets = sqliteTable("rate_shopping_presets", {
  id: pk(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  clientId: text("client_id").notNull(),
  method: text("method", { enum: RATE_SHOPPING_METHODS }).notNull(),
  transitDays: integer("transit_days"),
  showErrors: bool("show_errors").notNull().default(false),
  useAllServices: bool("use_all_services").notNull().default(false),
  isActive: bool("is_active").notNull().default(true),
  ...stamps(),
});

export const rateShoppingPresetServices = sqliteTable("rate_shopping_preset_services", {
  presetId: text("preset_id").notNull().references(() => rateShoppingPresets.id, { onDelete: "cascade" }),
  carrierServiceId: text("carrier_service_id").notNull().references(() => carrierServices.id),
  isSelected: bool("is_selected").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.presetId, t.carrierServiceId] })]);
