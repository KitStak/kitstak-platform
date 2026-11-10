/**
 * Count-plan commands (M07, replaces the 0.6 stub). Consumed by M03 for Cycle Count wave
 * rules: creates a Cycle Count plan for the wave's locations / SKUs and its jobs.
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import * as changeLog from "@/server/domain/change-log";
import * as sequences from "@/server/domain/sequences";
import { DomainError } from "@/server/domain/errors";
import { getCountPlanRow } from "@/server/domain/task-handlers/count";
import type { DomainCtx, Tx } from "@/server/domain/types";
import { createJobsForPlan, defaultCountJobType } from "./counts-jobs";
import { openCountConflicts } from "./counts-conflicts";
import { buildPlanLines } from "./counts-plans";

export interface CreateCountPlanFromWaveInput {
  readonly warehouseId: string;
  readonly waveId: string;
  readonly waveRuleId: string;
  readonly countType: "Location" | "SKU";
  readonly locationIds?: readonly string[];
  readonly productIds?: readonly string[];
  readonly lockLocations?: boolean;
  readonly assigneeUserIds?: readonly string[];
  /** Count job type to use; defaults to the warehouse's cycle count job type. */
  readonly jobTypeId?: string;
}

export interface CreateCountPlanFromWaveResult {
  readonly countPlanId: string;
  readonly code: string;
  readonly lineCount: number;
  readonly jobIds: readonly string[];
}

export type CreateCountPlanFromWave = (tx: Tx, ctx: DomainCtx, input: CreateCountPlanFromWaveInput) => CreateCountPlanFromWaveResult;

/** Cycle-count rotation when the wave passes no ids: stocked locations / SKUs counted longest ago. */
export const ROTATION_SIZE = 50;

function rotationLocations(tx: Tx, warehouseId: string): string[] {
  return tx.all<{ id: string }>(sql`
    SELECT lo.id FROM locations lo
    WHERE lo.warehouse_id = ${warehouseId} AND lo.is_active = 1 AND EXISTS (SELECT 1 FROM inventory i WHERE i.location_id = lo.id AND i.on_hand > 0)
      AND NOT EXISTS (SELECT 1 FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id WHERE l.location_id = lo.id AND p.status IN ('Pending','Ready To Count','Count Started','Count Completed'))
    ORDER BY COALESCE((SELECT MAX(l.completed_at) FROM count_plan_lines l WHERE l.location_id = lo.id), '') ASC, lo.walking_path_priority, lo.code
    LIMIT ${ROTATION_SIZE}`).map((r) => r.id);
}

function rotationProducts(tx: Tx, warehouseId: string): string[] {
  return tx.all<{ id: string }>(sql`
    SELECT i.product_id AS id FROM inventory i WHERE i.warehouse_id = ${warehouseId} AND i.on_hand > 0
      AND NOT EXISTS (SELECT 1 FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id WHERE l.product_id = i.product_id
        AND p.status IN ('Pending','Ready To Count','Count Started','Count Completed') AND l.status NOT IN ('Cancelled','Inventory Updated','Recount Created'))
    GROUP BY i.product_id
    ORDER BY COALESCE((SELECT MAX(l.completed_at) FROM count_plan_lines l WHERE l.product_id = i.product_id), '') ASC, i.product_id
    LIMIT ${ROTATION_SIZE}`).map((r) => r.id);
}

export const createCountPlanFromWave: CreateCountPlanFromWave = (tx, ctx, input) => {
  const wantedLocations = [...new Set(input.locationIds?.length ? input.locationIds : input.countType === "Location" ? rotationLocations(tx, input.warehouseId) : [])];
  const wantedProducts = [...new Set(input.productIds?.length ? input.productIds : input.countType === "SKU" ? rotationProducts(tx, input.warehouseId) : [])];
  // A location / SKU already in an open count plan is skipped, so a wave never double-counts stock.
  const taken = new Set(openCountConflicts(tx, { warehouseId: input.warehouseId, locationIds: input.countType === "Location" ? wantedLocations : [], productIds: input.countType === "SKU" ? wantedProducts : [] }).map((c) => c.id));
  const locationIds = wantedLocations.filter((id) => !taken.has(id));
  const productIds = wantedProducts.filter((id) => !taken.has(id));
  if ((input.countType === "Location" ? locationIds : productIds).length === 0) {
    throw new DomainError("VALIDATION", taken.size > 0
      ? `Every ${input.countType === "Location" ? "location" : "SKU"} the wave selected is already in an open count plan.`
      : `The wave found no ${input.countType === "Location" ? "locations" : "SKUs"} to count.`);
  }
  const wave = tx.select().from(schema.waves).where(eq(schema.waves.id, input.waveId)).get();
  const rule = tx.select().from(schema.waveRules).where(eq(schema.waveRules.id, input.waveRuleId)).get();
  const ruleJobType = rule?.jobTypeIds.find((id) => tx.select({ op: schema.jobTypes.operationType }).from(schema.jobTypes).where(eq(schema.jobTypes.id, id)).get()?.op === "Count");
  const jobType = { id: input.jobTypeId ?? ruleJobType ?? defaultCountJobType(tx, input.warehouseId).id };
  const code = sequences.next(tx, "count");
  const plan = tx.insert(schema.countPlans).values({
    code, warehouseId: input.warehouseId, description: wave ? `Cycle count wave ${wave.waveNo}` : "Cycle count wave", scheduledAt: new Date().toISOString(),
    lockLocations: input.lockLocations ?? false, countType: input.countType, operationType: "Cycle Count", status: "Pending",
    waveRuleId: input.waveRuleId, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  const lines = buildPlanLines(tx, { warehouseIds: [input.warehouseId], clientIds: "all" }, plan.id, { countType: input.countType, warehouseId: input.warehouseId, locationIds, productIds }, ctx.userId);
  for (const l of lines) tx.insert(schema.countPlanLines).values(l).run();
  changeLog.recordCreate(tx, ctx, { entityType: "count_plan", entityId: plan.id, entityCode: code });
  const jobIds = createJobsForPlan(tx, ctx, getCountPlanRow(tx, plan.id), { jobTypeId: jobType.id, batchSize: 1000, assigneeUserId: input.assigneeUserIds?.[0] ?? null });
  return { countPlanId: plan.id, code, lineCount: lines.length, jobIds };
};
