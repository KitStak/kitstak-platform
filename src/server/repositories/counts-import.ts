/**
 * Count plan imports (M07): "Import Location Count Plan" and "Import SKU Count Plan".
 * Rows sharing a Count Plan Name (per warehouse) build one Pending plan; a row whose
 * plan already exists adds a line to it while it is still Pending.
 */
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { hasClient, hasWarehouse } from "@/server/auth/scope";
import { changeLog } from "@/server/domain";
import { DomainError } from "@/server/domain/errors";
import type { ImportApplyContext, ImportApplyResult, ImportRowValues } from "@/server/imports/types";
import { COUNT_NAME_MAX } from "./counts-plans";

const str = (v: ImportRowValues[string] | undefined): string | null => (v === null || v === undefined || v === "" ? null : String(v).trim());
const fail = (message: string): never => { throw new DomainError("VALIDATION", message); };

function scheduled(raw: string | null): string {
  if (!raw) return new Date().toISOString();
  const t = Date.parse(raw);
  return Number.isNaN(t) ? fail(`Planned Date "${raw}" is not a valid date`) : new Date(t).toISOString();
}

function planFor(ctx: ImportApplyContext, row: ImportRowValues, countType: "Location" | "SKU"): { plan: typeof schema.countPlans.$inferSelect; warehouseId: string; created: boolean } {
  const { db, auth, actor } = ctx;
  const name = str(row.planName) ?? fail("Count Plan Name is required");
  if (name.length > COUNT_NAME_MAX) fail(`Count Plan Name can have at most ${COUNT_NAME_MAX} characters`);
  const whCode = str(row.warehouseCode) ?? fail("Warehouse Code is required");
  const wh = db.select().from(schema.warehouses).where(eq(schema.warehouses.code, whCode)).get();
  if (!wh || !hasWarehouse(auth.scope, wh.id)) fail(`Warehouse "${whCode}" was not found`);
  const warehouseId = (wh as typeof schema.warehouses.$inferSelect).id;
  const jobType = str(row.jobType);
  if (jobType) {
    const jt = db.select().from(schema.jobTypes).where(and(eq(schema.jobTypes.warehouseId, warehouseId), eq(schema.jobTypes.code, jobType), eq(schema.jobTypes.operationType, "Count"))).get();
    if (!jt) fail(`Count job type "${jobType}" was not found in ${whCode}`);
  }
  const existing = db.select().from(schema.countPlans).where(and(eq(schema.countPlans.warehouseId, warehouseId), sql`lower(${schema.countPlans.code}) = lower(${name})`)).get();
  if (existing) {
    if (existing.status !== "Pending") fail(`Count plan ${existing.code} is ${existing.status}; lines can only be added to pending plans`);
    if (existing.countType !== countType) fail(`Count plan ${existing.code} is a ${existing.countType} count`);
    return { plan: existing, warehouseId, created: false };
  }
  const blind = row.blindCount === true ? "Blind count" : null;
  const plan = db.insert(schema.countPlans).values({
    code: name, warehouseId, description: [blind, jobType ? `Job type ${jobType}` : null, `Imported (batch ${ctx.batchId.slice(0, 8)})`].filter(Boolean).join(" · "),
    scheduledAt: scheduled(str(row.plannedDate)), countType, operationType: "Cycle Count", status: "Pending", createdBy: actor.userId, updatedBy: actor.userId,
  }).returning().get();
  changeLog.recordCreate(db, actor, { entityType: "count_plan", entityId: plan.id, entityCode: plan.code });
  return { plan, warehouseId, created: true };
}

const stock = (ctx: ImportApplyContext, where: ReturnType<typeof sql>): number => ctx.db.get<{ n: number | null }>(sql`SELECT SUM(on_hand) AS n FROM inventory WHERE on_hand > 0 AND ${where}`)?.n ?? 0;

export function importLocationRow(ctx: ImportApplyContext, row: ImportRowValues): ImportApplyResult {
  const { plan, warehouseId, created } = planFor(ctx, row, "Location");
  const code = str(row.locationCode) ?? fail("Location Code is required");
  const loc = ctx.db.select().from(schema.locations).where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.code, code))).get() ?? fail(`Location "${code}" was not found`);
  const dup = ctx.db.select({ id: schema.countPlanLines.id }).from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, plan.id), eq(schema.countPlanLines.locationId, loc.id))).get();
  if (dup) fail(`Location ${code} is already in count plan ${plan.code}`);
  ctx.db.insert(schema.countPlanLines).values({ planId: plan.id, locationId: loc.id, status: "Pending", initialStockQty: stock(ctx, sql`location_id = ${loc.id}`), createdBy: ctx.actor.userId, updatedBy: ctx.actor.userId }).run();
  return { entityId: plan.id, message: created ? `Count plan ${plan.code} created` : `Added to ${plan.code}` };
}

export function importSkuRow(ctx: ImportApplyContext, row: ImportRowValues): ImportApplyResult {
  const clientCode = str(row.clientCode) ?? fail("Client Code is required");
  const client = ctx.db.select().from(schema.clients).where(eq(schema.clients.code, clientCode)).get();
  if (!client || !hasClient(ctx.auth.scope, client.id)) fail(`Client "${clientCode}" was not found`);
  const sku = str(row.sku) ?? fail("SKU is required");
  const product = ctx.db.select().from(schema.products).where(and(eq(schema.products.clientId, (client as typeof schema.clients.$inferSelect).id), eq(schema.products.sku, sku))).get() ?? fail(`SKU "${sku}" was not found for client ${clientCode}`);
  const { plan, warehouseId, created } = planFor(ctx, row, "SKU");
  const dup = ctx.db.select({ id: schema.countPlanLines.id }).from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, plan.id), eq(schema.countPlanLines.productId, product.id))).get();
  if (dup) fail(`SKU ${sku} is already in count plan ${plan.code}`);
  ctx.db.insert(schema.countPlanLines).values({ planId: plan.id, productId: product.id, status: "Pending", initialStockQty: stock(ctx, sql`product_id = ${product.id} AND warehouse_id = ${warehouseId}`), createdBy: ctx.actor.userId, updatedBy: ctx.actor.userId }).run();
  return { entityId: plan.id, message: created ? `Count plan ${plan.code} created` : `Added to ${plan.code}` };
}
