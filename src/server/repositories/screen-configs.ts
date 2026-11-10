/**
 * Screen Configuration repository (M14 #9): Receiving screen configurations per warehouse —
 * grid (caller's warehouse scope), detail, create / edit (optimistic `version`), duplicate,
 * delete, the condition options and the config that applies to a purchase order.
 * Writes `change_log` (entity "screen_config").
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { PO_TYPES } from "@/lib/enums";
import {
  conditionsMatch, conditionsSchema, normalizeSteps, receivingPlan, RECEIVING_SCREEN_NAME, RECEIVING_STEPS, SCREEN_CONFIG_FIELDS, SCREEN_CONFIG_SEARCH_FIELDS, SCREEN_CONFIG_SORT_FIELDS,
  type PoFacts, type ProductTrackingFacts, type ReceivingPlan, type ScreenConditions, type ScreenConfigSave, type ScreenStep,
} from "@/lib/grid-defs/admin/screen-configs";
import { assertFound, assertVersion, compileGrid, domainCtxOf, duplicateError, fieldError, logCreate, logDelete, logUpdate, qc, type Actor, type GridBinding } from "./users-shared";

const c = s.screenConfigs;
export const SCREEN_CONFIG_ENTITY = "screen_config";

const warehouseNameSql = sql<string>`(SELECT w.name FROM warehouses w WHERE w.id = ${qc(c.warehouseId)})`;
const createdByNameSql = sql<string | null>`(SELECT u.name FROM users u WHERE u.id = ${qc(c.createdBy)})`;

const BINDING: GridBinding = {
  exprs: {
    name: sql`${qc(c.name)}`, warehouseId: sql`${qc(c.warehouseId)}`, warehouseName: warehouseNameSql, operationType: sql`${qc(c.operationType)}`,
    screenName: sql`${qc(c.screenName)}`, isActive: sql`${qc(c.isActive)}`, createdAt: sql`${qc(c.createdAt)}`, updatedAt: sql`${qc(c.updatedAt)}`, createdByName: createdByNameSql,
  },
  fields: SCREEN_CONFIG_FIELDS, sortable: SCREEN_CONFIG_SORT_FIELDS, search: SCREEN_CONFIG_SEARCH_FIELDS,
  defaultSort: [{ field: "createdAt", dir: "desc" }], tiebreaker: c.id,
};

export interface ScreenConfigRow {
  readonly id: string;
  readonly name: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly operationType: string;
  readonly screenName: string;
  readonly isActive: boolean;
  readonly conditionCount: number;
  readonly enabledSteps: number;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ScreenConfigDetail extends ScreenConfigRow {
  readonly conditions: ScreenConditions;
  readonly steps: ScreenStep[];
}

const COLUMNS = {
  id: c.id, name: c.name, warehouseId: c.warehouseId, operationType: c.operationType, screenName: c.screenName, isActive: c.isActive,
  conditions: c.conditions, config: c.config, createdAt: c.createdAt, updatedAt: c.updatedAt, version: c.version,
  warehouseName: warehouseNameSql, createdByName: createdByNameSql,
};

type Raw = { conditions: unknown; config: { steps?: ScreenStep[] } | null } & Record<string, unknown>;

function parseConditions(raw: unknown): ScreenConditions {
  const parsed = conditionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : conditionsSchema.parse({});
}

function toDetail(r: Raw): ScreenConfigDetail {
  const conditions = parseConditions(r.conditions);
  const steps = normalizeSteps(r.config?.steps);
  return {
    id: String(r.id), name: String(r.name), warehouseId: String(r.warehouseId), warehouseName: String(r.warehouseName ?? ""), operationType: String(r.operationType),
    screenName: String(r.screenName), isActive: Boolean(r.isActive), createdAt: String(r.createdAt), createdByName: (r.createdByName as string | null) ?? null,
    updatedAt: String(r.updatedAt), version: Number(r.version), conditions, steps,
    conditionCount: conditions.clientIds.length + conditions.poTypes.length + conditions.vendorIds.length, enabledSteps: steps.filter((x) => x.enabled).length,
  };
}

const toRow = (r: Raw): ScreenConfigRow => {
  const d = toDetail(r);
  return {
    id: d.id, name: d.name, warehouseId: d.warehouseId, warehouseName: d.warehouseName, operationType: d.operationType, screenName: d.screenName, isActive: d.isActive,
    conditionCount: d.conditionCount, enabledSteps: d.enabledSteps, createdAt: d.createdAt, createdByName: d.createdByName, updatedAt: d.updatedAt, version: d.version,
  };
};

const scopeSql = (auth: AuthContext): SQL => (auth.scope.warehouseIds.length ? inArray(c.warehouseId, [...auth.scope.warehouseIds]) : sql`0 = 1`);

export function listScreenConfigs(db: AppDb, auth: AuthContext, query: GridQuery, operationType = "Receiving"): { rows: ScreenConfigRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [scopeSql(auth), eq(c.operationType, operationType as "Receiving")]);
  const result = paginate(
    db.select(COLUMNS).from(c).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(c).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as Raw[]).map(toRow), total: result.total };
}

export function loadScreenConfig(db: AppDb, auth: AuthContext, id: string): ScreenConfigDetail {
  const row = assertFound(db.select(COLUMNS).from(c).where(and(eq(c.id, id), scopeSql(auth))).get(), "Screen configuration");
  return toDetail(row as Raw);
}

function assertWarehouse(db: AppDb, auth: AuthContext, warehouseId: string): void {
  const wh = db.select({ id: s.warehouses.id }).from(s.warehouses).where(eq(s.warehouses.id, warehouseId)).get();
  if (!wh || !auth.scope.warehouseIds.includes(warehouseId)) throw fieldError("warehouseId", "Choose a warehouse you have access to");
}

function assertNameFree(db: AppDb, warehouseId: string, name: string, exceptId?: string): void {
  const clash = db.select({ id: c.id }).from(c).where(and(eq(c.warehouseId, warehouseId), sql`lower(${c.name}) = lower(${name.trim()})`)).get();
  if (clash && clash.id !== exceptId) throw duplicateError("name", `A configuration named ${name.trim()} already exists in this warehouse`);
}

function assertConditionIds(db: AppDb, cond: ScreenConditions): void {
  const clients = [...new Set(cond.clientIds)];
  if (clients.length && db.select({ id: s.clients.id }).from(s.clients).where(inArray(s.clients.id, clients)).all().length !== clients.length) {
    throw fieldError("conditions.clientIds", "One of the selected clients no longer exists");
  }
  const vendors = [...new Set(cond.vendorIds)];
  if (vendors.length && db.select({ id: s.vendors.id }).from(s.vendors).where(inArray(s.vendors.id, vendors)).all().length !== vendors.length) {
    throw fieldError("conditions.vendorIds", "One of the selected vendors no longer exists");
  }
}

function namesOf(db: AppDb, table: "clients" | "vendors", ids: readonly string[]): string {
  if (!ids.length) return "";
  const rows = table === "clients"
    ? db.select({ name: s.clients.name }).from(s.clients).where(inArray(s.clients.id, [...ids])).all()
    : db.select({ name: s.vendors.displayName }).from(s.vendors).where(inArray(s.vendors.id, [...ids])).all();
  return rows.map((r) => r.name).sort().join(", ");
}

/** Display snapshot for the field-level change log (ids resolved to names). */
function snapshot(db: AppDb, d: ScreenConfigDetail): Record<string, unknown> {
  const label = (k: string) => RECEIVING_STEPS.find((x) => x.key === k)?.label ?? k;
  return {
    name: d.name, warehouse: d.warehouseName, isActive: d.isActive, join: d.conditions.join,
    clients: namesOf(db, "clients", d.conditions.clientIds), poTypes: d.conditions.poTypes.join(", "), vendors: namesOf(db, "vendors", d.conditions.vendorIds),
    steps: d.steps.filter((x) => x.enabled).map((x) => `${label(x.key)}${x.required ? " (required)" : ""}`).join(", "),
  };
}

const valuesOf = (input: ScreenConfigSave) => ({
  name: input.name.trim(), warehouseId: input.warehouseId, isActive: input.isActive, operationType: input.operationType, screenName: RECEIVING_SCREEN_NAME,
  conditions: { ...input.conditions, clientIds: [...new Set(input.conditions.clientIds)], vendorIds: [...new Set(input.conditions.vendorIds)], poTypes: [...new Set(input.conditions.poTypes)] },
  config: { steps: normalizeSteps(input.steps) },
});

export function createScreenConfig(tx: AppDb, auth: AuthContext, actor: Actor, input: ScreenConfigSave): { id: string; name: string } {
  assertWarehouse(tx, auth, input.warehouseId);
  assertNameFree(tx, input.warehouseId, input.name);
  assertConditionIds(tx, input.conditions);
  const row = tx.insert(c).values({ ...valuesOf(input), createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: c.id, name: c.name }).get();
  logCreate(tx, domainCtxOf(actor, auth), { entityType: SCREEN_CONFIG_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

export function updateScreenConfig(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: ScreenConfigSave): { id: string; version: number } {
  const before = loadScreenConfig(tx, auth, id);
  assertVersion(before.version, input.version);
  assertWarehouse(tx, auth, input.warehouseId);
  assertNameFree(tx, input.warehouseId, input.name, id);
  assertConditionIds(tx, input.conditions);
  const prev = snapshot(tx, before);
  const after = tx.update(c).set({ ...valuesOf(input), updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${c.version} + 1` })
    .where(eq(c.id, id)).returning({ version: c.version, name: c.name }).get();
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: SCREEN_CONFIG_ENTITY, entityId: id, entityCode: after.name }, prev, snapshot(tx, loadScreenConfig(tx, auth, id)));
  return { id, version: after.version };
}

export function setScreenConfigsActive(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], isActive: boolean): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const before = loadScreenConfig(inner, auth, id);
    if (before.isActive === isActive) return;
    inner.update(c).set({ isActive, updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${c.version} + 1` }).where(eq(c.id, id)).run();
    logUpdate(inner, ctx, { entityType: SCREEN_CONFIG_ENTITY, entityId: id, entityCode: before.name }, { isActive: before.isActive }, { isActive });
  });
}

export function duplicateScreenConfig(tx: AppDb, auth: AuthContext, actor: Actor, id: string): { id: string; name: string } {
  const src = loadScreenConfig(tx, auth, id);
  let name = `${src.name} (copy)`;
  for (let i = 2; tx.select({ id: c.id }).from(c).where(and(eq(c.warehouseId, src.warehouseId), sql`lower(${c.name}) = lower(${name})`)).get(); i += 1) name = `${src.name} (copy ${i})`;
  const row = tx.insert(c).values({
    name, warehouseId: src.warehouseId, operationType: "Receiving", screenName: src.screenName, isActive: false,
    conditions: src.conditions, config: { steps: src.steps }, createdBy: actor.userId, updatedBy: actor.userId,
  }).returning({ id: c.id, name: c.name }).get();
  logCreate(tx, domainCtxOf(actor, auth), { entityType: SCREEN_CONFIG_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

export function deleteScreenConfigs(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadScreenConfig(inner, auth, id);
    inner.delete(c).where(eq(c.id, id)).run();
    logDelete(inner, ctx, { entityType: SCREEN_CONFIG_ENTITY, entityId: id, entityCode: row.name });
  });
}

export function assertScreenConfigExists(db: AppDb, auth: AuthContext, id: string): void {
  loadScreenConfig(db, auth, id);
}

/** Options for the General / Conditions tabs: scoped warehouses, clients, vendors and PO types. */
export function screenConfigOptions(db: AppDb, auth: AuthContext) {
  const warehouses = db.select({ id: s.warehouses.id, code: s.warehouses.code, name: s.warehouses.name }).from(s.warehouses).orderBy(asc(s.warehouses.code)).all()
    .filter((w) => auth.scope.warehouseIds.includes(w.id));
  const clients = db.select({ id: s.clients.id, code: s.clients.code, name: s.clients.name }).from(s.clients).orderBy(asc(s.clients.name)).all()
    .filter((cl) => auth.scope.clientIds === "all" || auth.scope.clientIds.includes(cl.id));
  const clientIds = new Set(clients.map((cl) => cl.id));
  const vendors = db.select({ id: s.vendors.id, name: s.vendors.displayName, clientId: s.vendors.clientId }).from(s.vendors).where(eq(s.vendors.isActive, true)).orderBy(asc(s.vendors.displayName)).all()
    .filter((v) => clientIds.has(v.clientId));
  return { warehouses, clients, vendors, poTypes: [...PO_TYPES] };
}

/**
 * The active configuration that applies to a PO in a warehouse: the first (oldest) whose
 * conditions match, preferring configs with conditions over catch-alls. Null = defaults.
 */
export function configForPurchaseOrder(db: AppDb, warehouseId: string, po: PoFacts): { id: string; name: string; steps: ScreenStep[] } | null {
  const rows = db.select({ id: c.id, name: c.name, conditions: c.conditions, config: c.config }).from(c)
    .where(and(eq(c.warehouseId, warehouseId), eq(c.operationType, "Receiving"), eq(c.isActive, true))).orderBy(asc(c.createdAt), asc(c.id)).all();
  const parsed = rows.map((r) => ({ id: r.id, name: r.name, conditions: parseConditions(r.conditions), steps: normalizeSteps(r.config?.steps) }));
  const specific = parsed.filter((r) => r.conditions.clientIds.length + r.conditions.poTypes.length + r.conditions.vendorIds.length > 0);
  const hit = specific.find((r) => conditionsMatch(r.conditions, po)) ?? parsed.find((r) => !specific.includes(r));
  if (!hit) return null;
  return { id: hit.id, name: hit.name, steps: hit.steps };
}

/**
 * Receiving plan for one product on one PO: resolves the single matching configuration
 * (conditions honoured) and returns show / required per step plus the tracking the receive
 * command must enforce. Drop-in replacement for `purchase-orders.receivingRequirements`
 * (request RP-2 / REQ-R4-3), which today unions every active config and ignores conditions.
 */
export function receivingPlanForPurchaseOrder(db: AppDb, warehouseId: string, po: PoFacts, product: ProductTrackingFacts): ReceivingPlan {
  return receivingPlan(configForPurchaseOrder(db, warehouseId, po), product);
}
