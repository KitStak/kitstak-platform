/**
 * Zod contracts for the wave-rule and job-type wizards. Shared by the client (per-step
 * validation, inline errors) and the API (authoritative validation).
 */
import { z } from "zod";
import { filterConditionSchema, jobTypeSettingsSchema, orderByClauseSchema } from "@/lib/domain-types";
import { OPERATION_TYPES, WAVE_ASSIGN_MODES, WAVE_DELETE_METHODS, WAVE_OP_TYPES, WEEKDAYS } from "@/lib/enums";
import { isTime } from "./schedule";

export const WAVE_PRIORITIES = ["None", "High", "Medium", "Low"] as const;

const name = z.string().trim().min(1, "Enter a name").max(100, "At most 100 characters");
const id = z.string().trim().min(1).max(64);

export const waveRuleBaseSchema = z.object({
  name,
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  operationType: z.enum(WAVE_OP_TYPES),
  priority: z.enum(WAVE_PRIORITIES).default("None"),
  deleteIfNotStarted: z.boolean().default(false),
  deleteMethod: z.enum(WAVE_DELETE_METHODS).default("None"),
  deleteTime: z.string().trim().max(10).nullish(),
  jobTypeIds: z.array(id).max(50).default([]),
  filters: z.array(filterConditionSchema).max(50).default([]),
  orderBy: z.array(orderByClauseSchema).max(20).default([]),
  scheduleDays: z.array(z.enum(WEEKDAYS)).max(7).default([]),
  scheduleTimes: z.array(z.string().refine(isTime, "Use HH:mm")).max(288).default([]),
  assignMode: z.enum(WAVE_ASSIGN_MODES).default("Pool"),
  assigneeRoleIds: z.array(id).max(100).default([]),
  assigneeUserIds: z.array(id).max(500).default([]),
  countType: z.enum(["Location", "SKU"]).nullish(),
  lockLocations: z.boolean().default(false),
  softAllocation: z.boolean().default(false),
  mergeRuleIds: z.array(id).max(20).default([]),
  version: z.number().int().min(1).optional(),
});

type WaveRuleBase = z.output<typeof waveRuleBaseSchema>;

/** Cross-field rules (Logiwa: red border + inline text). */
export function waveRuleIssues(v: Pick<WaveRuleBase, "operationType" | "jobTypeIds" | "mergeRuleIds" | "scheduleDays" | "scheduleTimes" | "deleteIfNotStarted" | "deleteMethod" | "deleteTime" | "assignMode" | "assigneeRoleIds" | "assigneeUserIds" | "countType">): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (v.operationType === "Order Merge") {
    if (v.mergeRuleIds.length === 0) issues.push({ path: "mergeRuleIds", message: "Select at least one rule" });
  } else if (v.jobTypeIds.length === 0) {
    issues.push({ path: "jobTypeIds", message: "Select at least one job type" });
  }
  if (v.operationType === "Cycle Count" && !v.countType) issues.push({ path: "countType", message: "Choose a count type" });
  if (v.scheduleDays.length > 0 && v.scheduleTimes.length === 0) issues.push({ path: "scheduleTimes", message: "Set at least one time for the selected days" });
  if (v.deleteIfNotStarted) {
    if (v.deleteMethod === "None") issues.push({ path: "deleteMethod", message: "Choose a delete method" });
    else if (v.deleteMethod === "At Specific Time" && !(v.deleteTime && isTime(v.deleteTime))) issues.push({ path: "deleteTime", message: "Enter a time (HH:mm)" });
    else if (v.deleteMethod === "After Hours" && !(v.deleteTime && /^\d{1,3}$/.test(v.deleteTime) && Number(v.deleteTime) > 0)) issues.push({ path: "deleteTime", message: "Enter the number of hours" });
  }
  if (v.operationType !== "Order Merge") {
    if (v.assignMode === "Roles" && v.assigneeRoleIds.length === 0) issues.push({ path: "assigneeRoleIds", message: "Assign at least one role" });
    if (v.assignMode === "Users" && v.assigneeUserIds.length === 0) issues.push({ path: "assigneeUserIds", message: "Assign at least one user" });
  }
  return issues;
}

export const waveRuleInputSchema = waveRuleBaseSchema.superRefine((v, ctx) => {
  for (const issue of waveRuleIssues(v)) ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
});
export type WaveRuleInput = z.output<typeof waveRuleInputSchema>;
export type WaveRuleFormValues = z.input<typeof waveRuleBaseSchema>;

/* ------------------------------------------------------------- job types */

export const jobTypeInputSchema = z.object({
  code: name,
  description: z.string().trim().min(1, "Enter a description").max(300),
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  operationType: z.enum(OPERATION_TYPES),
  allocationAlgorithmId: z.string().trim().max(64).nullish(),
  template: z.string().max(60).nullish(),
  settings: jobTypeSettingsSchema,
  conditions: z.array(filterConditionSchema).max(50).default([]),
  locationConditions: z.array(filterConditionSchema).max(50).nullish(),
  skuConditions: z.array(filterConditionSchema).max(50).nullish(),
  sourceLocationConditions: z.array(filterConditionSchema).max(50).nullish(),
  destinationLocationConditions: z.array(filterConditionSchema).max(50).nullish(),
  lpConditions: z.array(filterConditionSchema).max(50).nullish(),
  productConditions: z.array(filterConditionSchema).max(50).nullish(),
  orderBy: z.array(orderByClauseSchema).max(20).default([{ field: "walkingPathPriority", dir: "asc" }]),
  groupBy: z.array(z.string().max(60)).max(10).nullish(),
  version: z.number().int().min(1).optional(),
}).superRefine((v, ctx) => {
  if ((v.operationType === "Picking" || v.operationType === "Work Order") && !v.allocationAlgorithmId) {
    ctx.addIssue({ code: "custom", path: ["allocationAlgorithmId"], message: "Choose an allocation algorithm" });
  }
  if (v.operationType === "Count" && (v.locationConditions?.length ?? 0) > 0 && (v.skuConditions?.length ?? 0) > 0) {
    ctx.addIssue({ code: "custom", path: ["skuConditions"], message: "Location count conditions can't be combined with SKU count conditions" });
  }
  if (v.settings.batch.max < v.settings.batch.min) ctx.addIssue({ code: "custom", path: ["settings", "batch", "max"], message: "Max must be at least min" });
});
export type JobTypeInput = z.output<typeof jobTypeInputSchema>;
