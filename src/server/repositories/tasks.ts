/**
 * Task Details repository (M03, Logiwa 02 §7): order-operations (67 columns), count (48)
 * and replenishment (50) grids, plus assign/unassign for tasks. Execute / update / cancel
 * go through `domain/tasks`.
 */
import { and, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { TASK_GRIDS, TASK_TYPES_BY_KIND, type TaskKind } from "@/lib/grid-defs/jobs/tasks";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { scopedWhere } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { recordUpdate } from "@/server/domain/change-log";
import { assertUserInWarehouse } from "@/server/domain/jobs";
import { getTask } from "@/server/domain/tasks";
import type { BulkResult, DomainCtx } from "@/server/domain/types";
import type { GridQuery } from "@/server/query/grid-query";
import { pageOffset } from "@/server/query/paginate";
import { asBool, compileGrid, type FieldSqlMap, qc } from "./jobs-grid";

const t = schema.tasks;

const job = (col: string): SQL => sql`(SELECT ${sql.raw(col)} FROM jobs jj WHERE jj.id = ${qc(t.jobId)})`;
const order = (col: string): SQL => sql`(SELECT ${sql.raw(col)} FROM shipment_orders so WHERE so.id = ${qc(t.orderId)})`;
const product = (col: string): SQL => sql`(SELECT ${sql.raw(col)} FROM products pp WHERE pp.id = ${qc(t.productId)})`;
const loc = (ref: SQL, col: string): SQL => sql`(SELECT ${sql.raw(col)} FROM locations ll WHERE ll.id = ${ref})`;
const zone = (ref: SQL): SQL => sql`(SELECT COALESCE(lv.name, ll.zone) FROM locations ll LEFT JOIN lookup_values lv ON lv.id = ll.location_zone_id WHERE ll.id = ${ref})`;
const lp = (ref: SQL, col = "number"): SQL => sql`(SELECT lpx.${sql.raw(col)} FROM license_plates lpx WHERE lpx.id = ${ref})`;
const parentLp = (ref: SQL): SQL => sql`(SELECT par.number FROM license_plates lpx JOIN license_plates par ON par.id = lpx.parent_lp_id WHERE lpx.id = ${ref})`;
const parentLpType = (ref: SQL): SQL => sql`(SELECT ty.code FROM license_plates lpx JOIN license_plates par ON par.id = lpx.parent_lp_id JOIN lp_types ty ON ty.id = par.lp_type_id WHERE lpx.id = ${ref})`;
const userName = (ref: SQL): SQL => sql`(SELECT uu.name FROM users uu WHERE uu.id = ${ref})`;
const uomQty = sql`COALESCE((SELECT pt.uom_qty FROM product_pack_types pt WHERE pt.product_id = ${qc(t.productId)} AND pt.pack_type = ${qc(t.packType)} LIMIT 1), 1)`;
const countLine = (col: string): SQL => sql`(SELECT cl.${sql.raw(col)} FROM count_plan_lines cl WHERE cl.id = ${qc(t.countLineId)})`;

const SRC_LOC = sql`${qc(t.sourceLocationId)}`;
const TGT_LOC = sql`${qc(t.targetLocationId)}`;
const SRC_LP = sql`${qc(t.sourceLpId)}`;
const TGT_LP = sql`${qc(t.targetLpId)}`;

export const TASK_SQL: FieldSqlMap = {
  warehouse: sql`(SELECT w.name FROM warehouses w WHERE w.id = ${qc(t.warehouseId)})`,
  client: sql`(SELECT c.name FROM clients c WHERE c.id = ${qc(t.clientId)})`,
  waveNumber: job("wave_number"),
  taskNo: sql`${qc(t.taskNo)}`,
  jobCode: job("code"),
  jobType: job("job_type"),
  jobStatus: sql`(SELECT CASE WHEN jj.status = 'In Progress' THEN 'Started' ELSE jj.status END FROM jobs jj WHERE jj.id = ${qc(t.jobId)})`,
  orderCode: order("code"),
  poNumber: sql`(SELECT i.po_number FROM inventory_allocations a JOIN inventory i ON i.id = a.inventory_id WHERE a.id = ${qc(t.allocationId)})`,
  storeOrderNumber: order("store_order_number"),
  orderType: sql`(SELECT COALESCE(lv.name, so.order_type) FROM shipment_orders so LEFT JOIN lookup_values lv ON lv.id = so.order_type_id WHERE so.id = ${qc(t.orderId)})`,
  taskType: sql`${qc(t.taskType)}`,
  status: sql`${qc(t.status)}`,
  pickShortStatus: sql`${qc(t.pickShortStatus)}`,
  packShortStatus: sql`${qc(t.packShortStatus)}`,
  priority: sql`${qc(t.priority)}`,
  sequence: sql`${qc(t.sequence)}`,
  workOrderCode: sql`(SELECT wo.code FROM work_orders wo WHERE wo.id = ${qc(t.workOrderId)})`,
  workOrderType: sql`(SELECT CASE WHEN wo.operation_type LIKE '%without%' THEN 'Work Order without Picking' ELSE 'Work Order with Picking' END FROM work_orders wo WHERE wo.id = ${qc(t.workOrderId)})`,
  productImage: product("image_url"),
  sku: product("sku"),
  productName: product("name"),
  barcode: product("barcode"),
  suggestedPackage: sql`(SELECT sp.code FROM shipment_orders so JOIN shipment_packages sp ON sp.id = so.shipment_package_id WHERE so.id = ${qc(t.orderId)})`,
  targetLpType: sql`(SELECT ty.code FROM license_plates lpx JOIN lp_types ty ON ty.id = lpx.lp_type_id WHERE lpx.id = ${qc(t.targetLpId)})`,
  packType: sql`${qc(t.packType)}`,
  toPackType: sql`${qc(t.toPackType)}`,
  uomPackType: product("uom"),
  taskUomQty: sql`(${qc(t.plannedQty)} * ${uomQty})`,
  actualQty: sql`${qc(t.actualQty)}`,
  plannedQty: sql`${qc(t.plannedQty)}`,
  plannedPackQty: sql`${qc(t.plannedQty)}`,
  sourceZone: zone(SRC_LOC),
  sourceLocation: loc(SRC_LOC, "code"),
  sourceLocationDisplay: loc(SRC_LOC, "display_member"),
  sourceLpn: lp(SRC_LP),
  targetZone: zone(TGT_LOC),
  targetCart: sql`(SELECT mc.code FROM mobile_carts mc WHERE mc.id = ${qc(t.targetCartId)})`,
  targetLocation: loc(TGT_LOC, "code"),
  targetLocationDisplay: loc(TGT_LOC, "display_member"),
  targetLpn: lp(TGT_LP),
  assignee: userName(sql`${qc(t.assigneeUserId)}`),
  executedBy: userName(sql`${qc(t.executedByUserId)}`),
  plannedStartAt: sql`${qc(t.plannedStartAt)}`,
  startedAt: sql`${qc(t.startedAt)}`,
  plannedFinishAt: sql`${qc(t.plannedFinishAt)}`,
  finishedAt: sql`${qc(t.finishedAt)}`,
  createdAt: sql`${qc(t.createdAt)}`,
  createdBy: sql`COALESCE(${userName(sql`${qc(t.createdBy)}`)}, 'System')`,
  lotNumber: sql`${qc(t.lotNumber)}`,
  expiryDate: sql`${qc(t.expiryDate)}`,
  damageReason: sql`${qc(t.damageReason)}`,
  orderDate: order("order_date"),
  channel: order("channel"),
  carrier: order("carrier"),
  customer: order("customer_name"),
  customerAddress: sql`(SELECT so.ship_address || ', ' || so.ship_city || ', ' || so.ship_state FROM shipment_orders so WHERE so.id = ${qc(t.orderId)})`,
  updatedBy: userName(sql`${qc(t.updatedBy)}`),
  sourceParentLp: parentLp(SRC_LP),
  fromOriginalParentLp: parentLp(SRC_LP),
  sourceParentLpType: parentLpType(SRC_LP),
  targetParentLp: parentLp(TGT_LP),
  fromOriginalLp: lp(SRC_LP, "original_number"),
  targetParentLpType: parentLpType(TGT_LP),
  toOriginalParentLp: parentLp(TGT_LP),
  toOriginalLp: lp(TGT_LP, "original_number"),
  receivingDate: sql`(SELECT i.received_at FROM inventory_allocations a JOIN inventory i ON i.id = a.inventory_id WHERE a.id = ${qc(t.allocationId)})`,
  productionDate: sql`${qc(t.productionDate)}`,
  // count
  countPlanCode: sql`(SELECT cp.code FROM count_plans cp WHERE cp.id = ${qc(t.countPlanId)})`,
  countPlanId: sql`${qc(t.countPlanId)}`,
  initialPackQty: countLine("initial_stock_qty"),
  initialUomQty: sql`(${countLine("initial_stock_qty")} * ${uomQty})`,
  initialApprovedPackQty: countLine("approved_stock_qty"),
  approvedUomQty: sql`(${countLine("approved_count_qty")} * ${uomQty})`,
  approvedPackQty: countLine("approved_count_qty"),
  taskPackQty: sql`${qc(t.plannedQty)}`,
  initialTaskQty: sql`${qc(t.plannedQty)}`,
  aiJobDescription: sql`NULL`,
  // replenishment
  replenishmentPhase: sql`${qc(t.replenishmentPhase)}`,
  lpSwap: asBool(sql`${qc(t.lpSwap)} = 1`),
  packTypeConversionApplied: asBool(sql`${qc(t.packTypeConversionApplied)} = 1`),
  lpAutoRemoved: asBool(sql`${qc(t.lpAutoRemoved)} = 1`),
};

const FIELD_SQL: FieldSqlMap = { ...TASK_SQL, taskUomQty: TASK_SQL.taskUomQty as SQL };

export interface TaskListRow {
  readonly id: string;
  readonly jobId: string;
  readonly orderId: string | null;
  readonly warehouseId: string;
  readonly assigneeUserId: string | null;
  readonly version: number;
  readonly [key: string]: unknown;
}

function selection(kind: TaskKind): Record<string, SQL> {
  const out: Record<string, SQL> = {
    id: sql`${qc(t.id)}`, jobId: sql`${qc(t.jobId)}`, orderId: sql`${qc(t.orderId)}`, warehouseId: sql`${qc(t.warehouseId)}`,
    assigneeUserId: sql`${qc(t.assigneeUserId)}`, version: sql`${qc(t.version)}`, countPlanId: sql`${qc(t.countPlanId)}`,
  };
  const skip = new Set(kind === "order" ? ["countPlanCode", "initialPackQty", "initialUomQty", "initialApprovedPackQty", "approvedUomQty", "approvedPackQty"] : []);
  for (const [key, value] of Object.entries(FIELD_SQL)) if (!skip.has(key)) out[key] = value;
  return out;
}

export function listTasks(db: AppDb, auth: AuthContext, kind: TaskKind, query: GridQuery): { rows: TaskListRow[]; total: number } {
  const spec = TASK_GRIDS[kind];
  const { where, orderBy } = compileGrid(query, spec, FIELD_SQL, {
    defaultSort: [{ field: "taskNo", dir: "desc" }], tiebreaker: sql`${qc(t.id)}`,
    extra: [scopedWhere(t, auth.viewScope), inArray(t.taskType, [...TASK_TYPES_BY_KIND[kind]] as (typeof t.taskType._.data)[])],
  });
  const rows = db.select(selection(kind)).from(t).where(where).orderBy(...orderBy).limit(query.pageSize).offset(pageOffset(query)).all() as unknown as TaskListRow[];
  const total = db.select({ n: count() }).from(t).where(where).get()?.n ?? 0;
  return {
    rows: rows.map((r) => ({ ...r, lpSwap: Boolean(r.lpSwap), packTypeConversionApplied: Boolean(r.packTypeConversionApplied), lpAutoRemoved: Boolean(r.lpAutoRemoved) })),
    total,
  };
}

/** Assigns (or clears) the assignee of pending/started tasks. Same-warehouse guard like jobs. */
export function assignTasks(db: AppDb, ctx: DomainCtx, input: { ids: readonly string[]; userId: string | null }): BulkResult {
  const rows = db.select({ wh: t.warehouseId }).from(t).where(inArray(t.id, [...input.ids])).all();
  if (new Set(rows.map((r) => r.wh)).size > 1) {
    throw new AppError("VALIDATION", "Assign and unassign can only be performed for tasks in the same warehouse. Please update your selection and try again.");
  }
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of new Set(input.ids)) {
    try {
      const task = getTask(db, ctx, id);
      if (task.status === "Completed" || task.status === "Cancelled") throw new AppError("INVALID_STATE", `Task ${task.taskNo} is ${task.status.toLowerCase()}.`);
      if (input.userId) assertUserInWarehouse(db, input.userId, task.warehouseId);
      db.update(t).set({ assigneeUserId: input.userId, updatedBy: ctx.userId, version: sql`${qc(t.version)} + 1` }).where(and(eq(t.id, id))).run();
      recordUpdate(db, ctx, { entityType: "task", entityId: id, entityCode: String(task.taskNo), before: { assigneeUserId: task.assigneeUserId }, after: { assigneeUserId: input.userId } });
      succeeded.push(id);
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError("INVALID_STATE", e instanceof Error ? e.message : "Failed");
      failed.push({ id, code: err.code, message: err.message });
    }
  }
  return { succeeded, failed };
}
