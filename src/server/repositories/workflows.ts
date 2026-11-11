/**
 * Workflows repository (M12; KitStak-designed): grid with drag sequence, builder load/save,
 * bulk activate/deactivate/delete, run history and Test against order — the real condition
 * evaluator and action executors run inside a savepoint that is always rolled back.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { asc, desc } from "@/server/db/order";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient, hasWarehouse } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import { fieldLabel } from "@/server/domain/change-log";
import { evaluateConditionNode, evaluateConditions, type Facts } from "@/server/domain/conditions";
import { describeError } from "@/server/domain/errors";
import { orderFacts } from "@/server/domain/facts";
import { workflowEntityScope } from "@/server/domain/workflows";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { getWorkflowActionExecutor } from "@/server/workflows/actions";
import { conditionLeaves, describeConditionNode } from "@/lib/grid-defs/integrations/rule-fields";
import {
  PO_TRIGGERS, WORKFLOW_FIELDS, WORKFLOW_RUN_FIELDS, WORKFLOW_RUN_SORT_FIELDS, WORKFLOW_SEARCH_FIELDS, WORKFLOW_SORT_FIELDS, type WorkflowSave,
} from "@/lib/grid-defs/integrations/workflows";
import {
  assertFound, assertVersion, compileGrid, domainCtxOf, dryRun, duplicateError, fieldError, labelsOf, clientLabelsOf, logCreate, logDelete, logUpdate,
  type Actor, type GridBinding,
} from "./integration-logs-kit";
import { dbAll, flatMapSeq, forEachSeq, withWriteTx } from "@/server/db/sql";

type OrderStatus = (typeof s.shipmentOrders.$inferSelect)["status"];
const t = s.workflows;
const ENTITY = "workflow";
type Row = typeof t.$inferSelect;

const BINDING: GridBinding = {
  exprs: {
    name: sql`${t.name}`, description: sql`${t.description}`, trigger: sql`${t.trigger}`, warehouseId: sql`${t.warehouseId}`, clientId: sql`${t.clientId}`,
    isActive: sql`${t.isActive}`, runCount: sql`${t.runCount}`, lastRunAt: sql`${t.lastRunAt}`, sequence: sql`${t.sequence}`, updatedAt: sql`${t.updatedAt}`,
  },
  fields: WORKFLOW_FIELDS, sortable: WORKFLOW_SORT_FIELDS, search: WORKFLOW_SEARCH_FIELDS,
  defaultSort: [{ field: "sequence", dir: "asc" }], tiebreaker: t.id,
};

export interface WorkflowRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly trigger: Row["trigger"];
  readonly warehouseId: string | null;
  readonly warehouseCode: string | null;
  readonly clientId: string | null;
  /** Full client name (M12 rule: name everywhere, code alongside). */
  readonly clientName: string | null;
  readonly clientCode: string | null;
  readonly match: Row["match"];
  readonly conditionCount: number;
  readonly conditionSummary: string;
  readonly actions: readonly string[];
  readonly isActive: boolean;
  readonly stopProcessing: boolean;
  readonly sequence: number;
  readonly runCount: number;
  readonly lastRunAt: string | null;
  readonly blockedOpen: number;
  readonly version: number;
}

export interface WorkflowDetail extends WorkflowRow {
  readonly conditions: Row["conditions"];
  readonly actionList: Row["actions"];
}

/** Global workflows (no warehouse/client) are visible to everyone; scoped ones need the scope. */
function scopeWhere(auth: AuthContext) {
  const wh = auth.viewScope.warehouseIds;
  const cl = auth.viewScope.clientIds;
  return and(
    or(isNull(t.warehouseId), wh.length > 0 ? inArray(t.warehouseId, [...wh]) : sql`0 = 1`),
    cl === "all" ? undefined : or(isNull(t.clientId), cl.length > 0 ? inArray(t.clientId, [...cl]) : sql`0 = 1`),
  );
}

async function names(db: AppDb, rows: readonly Row[]) {
  return { wh: await labelsOf(db, "warehouses", rows.map((r) => r.warehouseId)), cl: await clientLabelsOf(db, rows.map((r) => r.clientId)) };
}

async function blockedCounts(db: AppDb, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await dbAll<{ id: string; n: number }>(db, sql`
    SELECT r.workflow_id AS id, COUNT(DISTINCT r.entity_id) AS n FROM workflow_runs r
    JOIN shipment_orders o ON o.id = r.entity_id AND o.workflow_blocked <> 'None'
    WHERE r.block_type IS NOT NULL AND r.workflow_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) GROUP BY r.workflow_id`);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

function toRow(r: Row, n: Awaited<ReturnType<typeof names>>, blocked: Map<string, number>): WorkflowRow {
  return {
    id: r.id, name: r.name, description: r.description, trigger: r.trigger, warehouseId: r.warehouseId, warehouseCode: r.warehouseId ? n.wh.get(r.warehouseId) ?? null : null,
    clientId: r.clientId, clientName: r.clientId ? n.cl.get(r.clientId)?.name ?? null : null, clientCode: r.clientId ? n.cl.get(r.clientId)?.code ?? null : null, match: r.match, conditionCount: conditionLeaves(r.conditions).length,
    conditionSummary: r.conditions.length === 0 ? "Every order" : r.conditions.map((c) => describeConditionNode("order", c)).join(r.match === "All" ? " AND " : " OR "),
    actions: r.actions.map((a) => a.action), isActive: r.isActive, stopProcessing: r.stopProcessing, sequence: r.sequence, runCount: r.runCount, lastRunAt: r.lastRunAt,
    blockedOpen: blocked.get(r.id) ?? 0, version: r.version,
  };
}

export async function listWorkflows(db: AppDb, auth: AuthContext, query: GridQuery): Promise<{ rows: WorkflowRow[]; total: number }> {
  const grid = compileGrid(BINDING, query, [scopeWhere(auth)]);
  const result = await paginate(db.select().from(t).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    async () => (await db.select({ n: sql<number>`count(*)` }).from(t).where(grid.where).limit(1))[0]?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  const n = await names(db, result.rows);
  const blocked = await blockedCounts(db, result.rows.map((r) => r.id));
  return { rows: result.rows.map((r) => toRow(r, n, blocked)), total: result.total };
}

export async function loadWorkflow(db: AppDb, auth: AuthContext, id: string): Promise<Row> {
  const row = assertFound((await db.select().from(t).where(eq(t.id, id)).limit(1))[0], "Workflow");
  if ((row.warehouseId && !hasWarehouse(auth.scope, row.warehouseId)) || (row.clientId && !hasClient(auth.scope, row.clientId))) throw new AppError("NOT_FOUND", "Workflow not found");
  return row;
}

export async function getWorkflow(db: AppDb, auth: AuthContext, id: string): Promise<WorkflowDetail> {
  const r = await loadWorkflow(db, auth, id);
  return { ...toRow(r, await names(db, [r]), await blockedCounts(db, [r.id])), conditions: r.conditions, actionList: r.actions };
}

function assertScope(auth: AuthContext, body: WorkflowSave): void {
  if (body.warehouseId && !hasWarehouse(auth.scope, body.warehouseId)) throw fieldError("warehouseId", "Warehouse not found");
  if (body.clientId && !hasClient(auth.scope, body.clientId)) throw fieldError("clientId", "Client not found");
}

async function assertUnique(db: AppDb, name: string, id: string | null) {
  const dup = (await db.select({ id: t.id }).from(t).where(and(sql`lower(${t.name}) = lower(${name})`, id ? sql`${t.id} <> ${id}` : undefined)).limit(1))[0];
  if (dup) throw duplicateError("name", `A workflow named "${name}" already exists`);
}

async function snapshot(db: AppDb, v: Pick<Row, "name" | "description" | "trigger" | "warehouseId" | "clientId" | "match" | "conditions" | "actions" | "isActive" | "stopProcessing">) {
  const wh = v.warehouseId ? (await labelsOf(db, "warehouses", [v.warehouseId])).get(v.warehouseId) ?? v.warehouseId : "All warehouses";
  const cl = v.clientId ? (await labelsOf(db, "clients", [v.clientId])).get(v.clientId) ?? v.clientId : "All clients";
  return {
    name: v.name, description: v.description, trigger: v.trigger, warehouse: wh, client: cl, match: v.match,
    conditions: v.conditions.map((c) => describeConditionNode("order", c)).join(v.match === "All" ? " AND " : " OR ") || "Every order",
    actions: v.actions.map((a) => a.action).join(" → "), active: v.isActive, stopProcessing: v.stopProcessing,
  };
}

const valuesOf = (body: WorkflowSave) => ({
  name: body.name, description: body.description, trigger: body.trigger, warehouseId: body.warehouseId, clientId: body.clientId, match: body.match,
  conditions: body.conditions, actions: body.actions.map((a) => ({ action: a.action, params: a.params })), isActive: body.isActive, stopProcessing: body.stopProcessing,
});

export async function createWorkflow(tx: AppDb, auth: AuthContext, actor: Actor, body: WorkflowSave): Promise<WorkflowDetail> {
  assertScope(auth, body);
  await assertUnique(tx, body.name, null);
  const max = (await tx.select({ n: sql<number>`COALESCE(MAX(${t.sequence}), 0)` }).from(t).limit(1))[0]?.n ?? 0;
  const row = (await tx.insert(t).values({ ...valuesOf(body), sequence: Number(max) + 1, createdBy: actor.userId, updatedBy: actor.userId }).returning())[0];
  await logCreate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: row.id, entityCode: row.name });
  return await getWorkflow(tx, auth, row.id);
}

export async function updateWorkflow(tx: AppDb, auth: AuthContext, actor: Actor, id: string, body: WorkflowSave): Promise<WorkflowDetail> {
  const before = await loadWorkflow(tx, auth, id);
  assertVersion(before.version, body.version);
  assertScope(auth, body);
  await assertUnique(tx, body.name, id);
  const values = valuesOf(body);
  await tx.update(t).set({ ...values, updatedBy: actor.userId, version: sql`${t.version} + 1` }).where(eq(t.id, id));
  await logUpdate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: id, entityCode: body.name }, await snapshot(tx, before), await snapshot(tx, values));
  return await getWorkflow(tx, auth, id);
}

export async function deleteWorkflows(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const w = await loadWorkflow(inner, auth, id);
    const blocked = (await blockedCounts(inner, [id])).get(id) ?? 0;
    if (blocked > 0) throw new AppError("INVALID_STATE", `${w.name} still blocks ${blocked} order${blocked === 1 ? "" : "s"}; release them first or deactivate it`);
    await inner.delete(t).where(eq(t.id, id));
    await logDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: w.name });
  });
}

export async function setWorkflowsActive(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], isActive: boolean): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const w = await loadWorkflow(inner, auth, id);
    if (w.isActive === isActive) throw new AppError("INVALID_STATE", `${w.name} is already ${isActive ? "active" : "inactive"}`);
    await inner.update(t).set({ isActive, updatedBy: actor.userId, version: sql`${t.version} + 1` }).where(eq(t.id, id));
    await logUpdate(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: w.name }, { active: w.isActive }, { active: isActive });
  });
}

/** Drag sequence: `ids` in the new order (visible subset); others keep their relative place after them. */
export async function reorderWorkflows(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): Promise<{ readonly ids: readonly string[] }> {
  const all = await tx.select().from(t).orderBy(asc(t.sequence), asc(t.createdAt));
  const visible = new Set(ids);
  for (const id of ids) await loadWorkflow(tx, auth, id);
  const ordered = [...ids, ...all.filter((w) => !visible.has(w.id)).map((w) => w.id)];
  const ctx = domainCtxOf(actor, auth);
  await forEachSeq(ordered, async (id, i) => {
    const w = all.find((x) => x.id === id);
    if (!w || w.sequence === i + 1) return;
    await tx.update(t).set({ sequence: i + 1 }).where(eq(t.id, id));
    await logUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: w.name }, { sequence: w.sequence }, { sequence: i + 1 });
  });
  return { ids: ordered };
}

/* ---------------- runs ---------------- */

const wr = s.workflowRuns;
const orderCodeSql = sql<string>`(SELECT o.code FROM shipment_orders o WHERE o.id = "workflow_runs"."entity_id")`;
const RUN_BINDING: GridBinding = {
  exprs: { matched: sql`${wr.matched}`, blockType: sql`${wr.blockType}`, orderCode: orderCodeSql, at: sql`${wr.at}` },
  fields: WORKFLOW_RUN_FIELDS, sortable: WORKFLOW_RUN_SORT_FIELDS, search: ["orderCode"], defaultSort: [{ field: "at", dir: "desc" }], tiebreaker: wr.id,
};

export interface WorkflowRunRow {
  readonly id: string;
  readonly at: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly orderCode: string | null;
  readonly matched: boolean;
  readonly actionsApplied: readonly string[];
  readonly blockType: "Fully" | "Partially" | null;
  readonly error: string | null;
}

export async function listWorkflowRuns(db: AppDb, auth: AuthContext, id: string, query: GridQuery): Promise<{ rows: WorkflowRunRow[]; total: number }> {
  await loadWorkflow(db, auth, id);
  const grid = compileGrid(RUN_BINDING, query, [eq(wr.workflowId, id)]);
  const result = await paginate(db.select({ r: wr, code: orderCodeSql }).from(wr).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    async () => (await db.select({ n: sql<number>`count(*)` }).from(wr).where(grid.where).limit(1))[0]?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return {
    rows: result.rows.map(({ r, code }) => ({ id: r.id, at: r.at, entityType: r.entityType, entityId: r.entityId, orderCode: code ?? null, matched: r.matched, actionsApplied: r.actionsApplied ?? [], blockType: r.blockType, error: r.error })),
    total: result.total,
  };
}

/* ---------------- test against order ---------------- */

export interface WorkflowTestResult {
  readonly orderCode: string;
  readonly inScope: boolean;
  readonly scopeNote: string | null;
  readonly matched: boolean;
  readonly conditions: readonly { readonly text: string; readonly passed: boolean }[];
  readonly actions: readonly { readonly action: string; readonly applied: boolean; readonly message: string | null }[];
  readonly changes: readonly { readonly field: string; readonly from: string; readonly to: string }[];
  readonly blockType: "Fully" | "Partially" | null;
}

const WATCH = ["priority", "workflowBlocked", "carrier", "shippingService", "rateShoppingPresetId", "shipmentPackageId", "orderTypeId", "note", "warehouseId"] as const;

/** Purchase Order Created: conditions on PO facts, Notify Users only (no order fields change). */
async function testPoWorkflow(db: AppDb, auth: AuthContext, actor: Actor, body: WorkflowSave, poId: string): Promise<WorkflowTestResult> {
  const po = assertFound((await db.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, poId)).limit(1))[0], "Purchase order");
  if (!hasWarehouse(auth.scope, po.warehouseId) || !hasClient(auth.scope, po.clientId)) throw new AppError("NOT_FOUND", "Purchase order not found");
  const notes: string[] = [];
  if (body.warehouseId && body.warehouseId !== po.warehouseId) notes.push("the purchase order is in another warehouse");
  if (body.clientId && body.clientId !== po.clientId) notes.push("the purchase order belongs to another client");
  return await dryRun(db, async (tx) => {
    const { facts } = await workflowEntityScope(tx, { type: "purchase_order", id: po.id });
    const conditions = body.conditions.map((c) => ({ text: describeConditionNode("purchaseOrder", c), passed: evaluateConditionNode(c, facts) }));
    const matched = evaluateConditions(body.conditions, facts, body.match);
    const actions: { action: string; applied: boolean; message: string | null }[] = [];
    if (matched) {
      const ctx = { ...domainCtxOf(actor, auth), source: "Workflow test" };
      for (const a of body.actions) {
        const exec = getWorkflowActionExecutor(a.action);
        if (!exec) { actions.push({ action: a.action, applied: false, message: "Not configured" }); continue; }
        try {
          const res = await withWriteTx(tx, async (inner) => exec(inner, ctx, { entity: { type: "purchase_order", id: po.id }, params: a.params, workflowId: "test", workflowName: body.name }));
          actions.push({ action: a.action, applied: res.applied, message: res.message ?? null });
        } catch (error) {
          actions.push({ action: a.action, applied: false, message: describeError(error).message });
        }
      }
    }
    return { orderCode: po.code, inScope: notes.length === 0, scopeNote: notes.length > 0 ? `In production this workflow would skip the purchase order: ${notes.join(" and ")}.` : null, matched, conditions, actions, changes: [], blockType: null };
  });
}

export async function testWorkflow(db: AppDb, auth: AuthContext, actor: Actor, body: WorkflowSave, orderId: string): Promise<WorkflowTestResult> {
  if (PO_TRIGGERS.has(body.trigger)) return await testPoWorkflow(db, auth, actor, body, orderId);
  const order = assertFound((await db.select().from(s.shipmentOrders).where(eq(s.shipmentOrders.id, orderId)).limit(1))[0], "Shipment order");
  if (!hasWarehouse(auth.scope, order.warehouseId) || !hasClient(auth.scope, order.clientId)) throw new AppError("NOT_FOUND", "Shipment order not found");
  const notes: string[] = [];
  if (body.warehouseId && body.warehouseId !== order.warehouseId) notes.push("the order is in another warehouse");
  if (body.clientId && body.clientId !== order.clientId) notes.push("the order belongs to another client");
  return await dryRun(db, async (tx) => {
    // Local adapter until REQ-1 lands: address lines are not in foundation orderFacts yet.
    const facts: Facts = { shipAddress: order.shipAddress, shipAddress2: order.shipAddress2, ...(await orderFacts(tx, order)) };
    const conditions = body.conditions.map((c) => ({ text: describeConditionNode("order", c), passed: evaluateConditionNode(c, facts) }));
    const matched = evaluateConditions(body.conditions, facts, body.match);
    const actions: { action: string; applied: boolean; message: string | null }[] = [];
    let blockType: "Fully" | "Partially" | null = null;
    if (matched) {
      const ctx = { ...domainCtxOf(actor, auth), source: "Workflow test" };
      for (const a of body.actions) {
        const exec = getWorkflowActionExecutor(a.action);
        if (!exec) { actions.push({ action: a.action, applied: false, message: "Not configured" }); continue; }
        try {
          const res = await withWriteTx(tx, async (inner) => exec(inner, ctx, { entity: { type: "shipment_order", id: order.id }, params: a.params, workflowId: "test", workflowName: body.name }));
          if (res.blockType) blockType = res.blockType;
          actions.push({ action: a.action, applied: res.applied, message: res.message ?? null });
        } catch (error) {
          actions.push({ action: a.action, applied: false, message: describeError(error).message });
        }
      }
    }
    const after = (await tx.select().from(s.shipmentOrders).where(eq(s.shipmentOrders.id, order.id)).limit(1))[0] ?? order;
    const label = async (k: string, v: unknown) => {
      if (v === null || v === undefined || v === "") return "—";
      if (k === "warehouseId") return (await labelsOf(tx, "warehouses", [String(v)])).get(String(v)) ?? String(v);
      if (k === "rateShoppingPresetId") return (await tx.select({ n: s.rateShoppingPresets.name }).from(s.rateShoppingPresets).where(eq(s.rateShoppingPresets.id, String(v))).limit(1))[0]?.n ?? String(v);
      if (k === "shipmentPackageId") return (await tx.select({ n: s.shipmentPackages.code }).from(s.shipmentPackages).where(eq(s.shipmentPackages.id, String(v))).limit(1))[0]?.n ?? String(v);
      if (k === "orderTypeId") return (await tx.select({ n: s.lookupValues.name }).from(s.lookupValues).where(eq(s.lookupValues.id, String(v))).limit(1))[0]?.n ?? String(v);
      return String(v);
    };
    const changes: { field: string; from: string; to: string }[] = await flatMapSeq(WATCH, async (k) => (order[k] !== after[k] ? [{ field: fieldLabel("shipment_order", k), from: await label(k, order[k]), to: await label(k, after[k]) }] : []));
    const tagsBefore = new Set((facts.orderTag as readonly string[] | undefined) ?? []);
    const tagsAfter = (await tx.select({ name: s.tags.name }).from(s.entityTags).innerJoin(s.tags, eq(s.tags.id, s.entityTags.tagId))
      .where(and(eq(s.entityTags.entityType, "shipment_order"), eq(s.entityTags.entityId, order.id)))).map((x) => x.name);
    const added = tagsAfter.filter((x) => !tagsBefore.has(x));
    if (added.length > 0) changes.push({ field: "Tags", from: [...tagsBefore].join(", ") || "—", to: tagsAfter.join(", ") });
    return { orderCode: order.code, inScope: notes.length === 0, scopeNote: notes.length > 0 ? `In production this workflow would skip the order: ${notes.join(" and ")}.` : null, matched, conditions, actions, changes, blockType };
  });
}

/** Records to test against: open orders, shipped orders (Order Shipped) or purchase orders. */
export type TestEntityKind = "open" | "shipped" | "po";

export async function testOrderOptions(db: AppDb, auth: AuthContext, q: string | null, kind: TestEntityKind = "open"): Promise<{ id: string; label: string }[]> {
  if (kind === "po") {
    const p = s.purchaseOrders;
    const conds = [inArray(p.warehouseId, [...auth.viewScope.warehouseIds])];
    if (auth.viewScope.clientIds !== "all") conds.push(inArray(p.clientId, auth.viewScope.clientIds.length > 0 ? [...auth.viewScope.clientIds] : ["-"]));
    if (q) conds.push(sql`(${p.code} ILIKE ${`%${q}%`} ESCAPE '' OR ${p.vendorName} ILIKE ${`%${q}%`} ESCAPE '' OR ${p.referenceNumber} ILIKE ${`%${q}%`} ESCAPE '')`);
    return (await db.select({ id: p.id, code: p.code, vendor: p.vendorName, status: p.status }).from(p).where(and(...conds)).orderBy(desc(p.createdAt)).limit(30))
      .map((x) => ({ id: x.id, label: `${x.code} · ${x.vendor ?? "No vendor"} · ${x.status}` }));
  }
  const o = s.shipmentOrders;
  const statuses: OrderStatus[] = kind === "shipped" ? ["Shipped", "Partially Shipped", "Delivered", "Ready to Ship"] : ["Open", "Shortage", "On Hold", "Ready to Pick"];
  const conds = [inArray(o.status, statuses), sql`${o.deletedAt} IS NULL`, inArray(o.warehouseId, [...auth.viewScope.warehouseIds])];
  if (auth.viewScope.clientIds !== "all") conds.push(inArray(o.clientId, auth.viewScope.clientIds.length > 0 ? [...auth.viewScope.clientIds] : ["-"]));
  if (q) conds.push(sql`(${o.code} ILIKE ${`%${q}%`} ESCAPE '' OR ${o.customerName} ILIKE ${`%${q}%`} ESCAPE '' OR ${o.shipAddress} ILIKE ${`%${q}%`} ESCAPE '')`);
  return (await db.select({ id: o.id, code: o.code, customer: o.customerName, addr: o.shipAddress }).from(o).where(and(...conds)).orderBy(desc(o.orderDate)).limit(30))
    .map((x) => ({ id: x.id, label: `${x.code} · ${x.customer} · ${x.addr}` }));
}
