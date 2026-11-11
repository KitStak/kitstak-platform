/**
 * Screen Configuration repository (M14 #9): Receiving screen configurations per warehouse —
 * grid (caller's warehouse scope), detail, create / edit (optimistic `version`), duplicate,
 * delete, the condition options and the config that applies to a purchase order.
 * Writes `change_log` (entity "screen_config").
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { asc } from "@/server/db/order";
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

export async function listScreenConfigs(db: AppDb, auth: AuthContext, query: GridQuery, operationType = "Receiving"): Promise<{ rows: ScreenConfigRow[]; total: number }> {
  const grid = compileGrid(BINDING, query, [scopeSql(auth), eq(c.operationType, operationType as "Receiving")]);
  const result = await paginate(
    db.select(COLUMNS).from(c).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    async () => (await db.select({ n: sql<number>`count(*)` }).from(c).where(grid.where).limit(1))[0]?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as Raw[]).map(toRow), total: result.total };
}

export async function loadScreenConfig(db: AppDb, auth: AuthContext, id: string): Promise<ScreenConfigDetail> {
  const row = assertFound((await db.select(COLUMNS).from(c).where(and(eq(c.id, id), scopeSql(auth))).limit(1))[0], "Screen configuration");
  return toDetail(row as Raw);
}

async function assertWarehouse(db: AppDb, auth: AuthContext, warehouseId: string): Promise<void> {
  const wh = (await db.select({ id: s.warehouses.id }).from(s.warehouses).where(eq(s.warehouses.id, warehouseId)).limit(1))[0];
  if (!wh || !auth.scope.warehouseIds.includes(warehouseId)) throw fieldError("warehouseId", "Choose a warehouse you have access to");
}

async function assertNameFree(db: AppDb, warehouseId: string, name: string, exceptId?: string): Promise<void> {
  const clash = (await db.select({ id: c.id }).from(c).where(and(eq(c.warehouseId, warehouseId), sql`lower(${c.name}) = lower(${name.trim()})`)).limit(1))[0];
  if (clash && clash.id !== exceptId) throw duplicateError("name", `A configuration named ${name.trim()} already exists in this warehouse`);
}

async function assertConditionIds(db: AppDb, cond: ScreenConditions): Promise<void> {
  const clients = [...new Set(cond.clientIds)];
  if (clients.length && (await db.select({ id: s.clients.id }).from(s.clients).where(inArray(s.clients.id, clients))).length !== clients.length) {
    throw fieldError("conditions.clientIds", "One of the selected clients no longer exists");
  }
  const vendors = [...new Set(cond.vendorIds)];
  if (vendors.length && (await db.select({ id: s.vendors.id }).from(s.vendors).where(inArray(s.vendors.id, vendors))).length !== vendors.length) {
    throw fieldError("conditions.vendorIds", "One of the selected vendors no longer exists");
  }
}

async function namesOf(db: AppDb, table: "clients" | "vendors", ids: readonly string[]): Promise<string> {
  if (!ids.length) return "";
  const rows = table === "clients"
    ? await db.select({ name: s.clients.name }).from(s.clients).where(inArray(s.clients.id, [...ids]))
    : await db.select({ name: s.vendors.displayName }).from(s.vendors).where(inArray(s.vendors.id, [...ids]));
  return rows.map((r) => r.name).sort().join(", ");
}

/** Display snapshot for the field-level change log (ids resolved to names). */
async function snapshot(db: AppDb, d: ScreenConfigDetail): Promise<Record<string, unknown>> {
  const label = (k: string) => RECEIVING_STEPS.find((x) => x.key === k)?.label ?? k;
  return {
    name: d.name, warehouse: d.warehouseName, isActive: d.isActive, join: d.conditions.join,
    clients: await namesOf(db, "clients", d.conditions.clientIds), poTypes: d.conditions.poTypes.join(", "), vendors: await namesOf(db, "vendors", d.conditions.vendorIds),
    steps: d.steps.filter((x) => x.enabled).map((x) => `${label(x.key)}${x.required ? " (required)" : ""}`).join(", "),
  };
}

const valuesOf = (input: ScreenConfigSave) => ({
  name: input.name.trim(), warehouseId: input.warehouseId, isActive: input.isActive, operationType: input.operationType, screenName: RECEIVING_SCREEN_NAME,
  conditions: { ...input.conditions, clientIds: [...new Set(input.conditions.clientIds)], vendorIds: [...new Set(input.conditions.vendorIds)], poTypes: [...new Set(input.conditions.poTypes)] },
  config: { steps: normalizeSteps(input.steps) },
});

export async function createScreenConfig(tx: AppDb, auth: AuthContext, actor: Actor, input: ScreenConfigSave): Promise<{ id: string; name: string }> {
  await assertWarehouse(tx, auth, input.warehouseId);
  await assertNameFree(tx, input.warehouseId, input.name);
  await assertConditionIds(tx, input.conditions);
  const row = (await tx.insert(c).values({ ...valuesOf(input), createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: c.id, name: c.name }))[0];
  await logCreate(tx, domainCtxOf(actor, auth), { entityType: SCREEN_CONFIG_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

export async function updateScreenConfig(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: ScreenConfigSave): Promise<{ id: string; version: number }> {
  const before = await loadScreenConfig(tx, auth, id);
  assertVersion(before.version, input.version);
  await assertWarehouse(tx, auth, input.warehouseId);
  await assertNameFree(tx, input.warehouseId, input.name, id);
  await assertConditionIds(tx, input.conditions);
  const prev = await snapshot(tx, before);
  const after = (await tx.update(c).set({ ...valuesOf(input), updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${c.version} + 1` })
    .where(eq(c.id, id)).returning({ version: c.version, name: c.name }))[0];
  await logUpdate(tx, domainCtxOf(actor, auth), { entityType: SCREEN_CONFIG_ENTITY, entityId: id, entityCode: after.name }, prev, await snapshot(tx, await loadScreenConfig(tx, auth, id)));
  return { id, version: after.version };
}

export async function setScreenConfigsActive(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], isActive: boolean): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const before = await loadScreenConfig(inner, auth, id);
    if (before.isActive === isActive) return;
    await inner.update(c).set({ isActive, updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${c.version} + 1` }).where(eq(c.id, id));
    await logUpdate(inner, ctx, { entityType: SCREEN_CONFIG_ENTITY, entityId: id, entityCode: before.name }, { isActive: before.isActive }, { isActive });
  });
}

export async function duplicateScreenConfig(tx: AppDb, auth: AuthContext, actor: Actor, id: string): Promise<{ id: string; name: string }> {
  const src = await loadScreenConfig(tx, auth, id);
  let name = `${src.name} (copy)`;
  for (let i = 2; (await tx.select({ id: c.id }).from(c).where(and(eq(c.warehouseId, src.warehouseId), sql`lower(${c.name}) = lower(${name})`)).limit(1))[0]; i += 1) name = `${src.name} (copy ${i})`;
  const row = (await tx.insert(c).values({
    name, warehouseId: src.warehouseId, operationType: "Receiving", screenName: src.screenName, isActive: false,
    conditions: src.conditions, config: { steps: src.steps }, createdBy: actor.userId, updatedBy: actor.userId,
  }).returning({ id: c.id, name: c.name }))[0];
  await logCreate(tx, domainCtxOf(actor, auth), { entityType: SCREEN_CONFIG_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

export async function deleteScreenConfigs(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  return await runBulk(tx, ids, async (inner, id) => {
    const row = await loadScreenConfig(inner, auth, id);
    await inner.delete(c).where(eq(c.id, id));
    await logDelete(inner, ctx, { entityType: SCREEN_CONFIG_ENTITY, entityId: id, entityCode: row.name });
  });
}

export async function assertScreenConfigExists(db: AppDb, auth: AuthContext, id: string): Promise<void> {
  await loadScreenConfig(db, auth, id);
}

/** Options for the General / Conditions tabs: scoped warehouses, clients, vendors and PO types. */
export async function screenConfigOptions(db: AppDb, auth: AuthContext) {
  const warehouses = (await db.select({ id: s.warehouses.id, code: s.warehouses.code, name: s.warehouses.name }).from(s.warehouses).orderBy(asc(s.warehouses.code)))
    .filter((w) => auth.scope.warehouseIds.includes(w.id));
  const clients = (await db.select({ id: s.clients.id, code: s.clients.code, name: s.clients.name }).from(s.clients).orderBy(asc(s.clients.name)))
    .filter((cl) => auth.scope.clientIds === "all" || auth.scope.clientIds.includes(cl.id));
  const clientIds = new Set(clients.map((cl) => cl.id));
  const vendors = (await db.select({ id: s.vendors.id, name: s.vendors.displayName, clientId: s.vendors.clientId }).from(s.vendors).where(eq(s.vendors.isActive, true)).orderBy(asc(s.vendors.displayName)))
    .filter((v) => clientIds.has(v.clientId));
  return { warehouses, clients, vendors, poTypes: [...PO_TYPES] };
}

/**
 * The active configuration that applies to a PO in a warehouse: the first (oldest) whose
 * conditions match, preferring configs with conditions over catch-alls. Null = defaults.
 */
export async function configForPurchaseOrder(db: AppDb, warehouseId: string, po: PoFacts): Promise<{ id: string; name: string; steps: ScreenStep[] } | null> {
  const rows = await db.select({ id: c.id, name: c.name, conditions: c.conditions, config: c.config }).from(c)
    .where(and(eq(c.warehouseId, warehouseId), eq(c.operationType, "Receiving"), eq(c.isActive, true))).orderBy(asc(c.createdAt), asc(c.id));
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
export async function receivingPlanForPurchaseOrder(db: AppDb, warehouseId: string, po: PoFacts, product: ProductTrackingFacts): Promise<ReceivingPlan> {
  return receivingPlan(await configForPurchaseOrder(db, warehouseId, po), product);
}
