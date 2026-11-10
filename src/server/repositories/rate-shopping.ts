/**
 * Rate Shopping Presets repository (M12, spec 06 §6): grid, detail with the client-accessible
 * carrier services, create/update (warehouse + client locked on edit), guarded delete.
 * Presets are consumed at label time by foundation `shipping/labels.ts`.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { RATE_SHOPPING_FIELDS, RATE_SHOPPING_SEARCH_FIELDS, RATE_SHOPPING_SORT_FIELDS, type PresetSave } from "@/lib/grid-defs/integrations/rate-shopping";
import {
  assertClientInScope, assertFound, assertVersion, assertWarehouseInScope, compileGrid, domainCtxOf, duplicateError, fieldError, labelsOf, listScope,
  logCreate, logDelete, logUpdate, type Actor, type GridBinding,
} from "./integration-logs-kit";

const t = s.rateShoppingPresets;
const ps = s.rateShoppingPresetServices;
const ENTITY = "rate_shopping_preset";

const clientCodeSql = sql<string>`(SELECT c.name FROM clients c WHERE c.id = "rate_shopping_presets"."client_id")`;
const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = "rate_shopping_presets"."warehouse_id")`;
const serviceCountSql = sql<number>`(SELECT COUNT(*) FROM rate_shopping_preset_services x WHERE x.preset_id = "rate_shopping_presets"."id" AND x.is_selected = 1)`;

const BINDING: GridBinding = {
  exprs: {
    name: sql`${t.name}`, description: sql`${t.description}`, method: sql`${t.method}`, showErrors: sql`${t.showErrors}`, useAllServices: sql`${t.useAllServices}`,
    isActive: sql`${t.isActive}`, transitDays: sql`${t.transitDays}`, clientId: sql`${t.clientId}`, warehouseId: sql`${t.warehouseId}`,
    clientCode: clientCodeSql, warehouseCode: warehouseCodeSql, serviceCount: serviceCountSql,
  },
  fields: RATE_SHOPPING_FIELDS, sortable: RATE_SHOPPING_SORT_FIELDS, search: RATE_SHOPPING_SEARCH_FIELDS,
  defaultSort: [{ field: "name", dir: "asc" }], tiebreaker: t.id,
};

export interface PresetRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly method: PresetSave["method"];
  readonly transitDays: number | null;
  readonly showErrors: boolean;
  readonly useAllServices: boolean;
  readonly isActive: boolean;
  readonly clientId: string;
  readonly clientName: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly serviceCount: number;
  readonly version: number;
}

export interface PresetService {
  readonly id: string;
  readonly setupName: string;
  readonly connectionId: string;
  readonly provider: string;
  readonly carrierCode: string;
  readonly name: string;
  readonly transitDays: number;
  readonly isInternational: boolean;
  readonly selected: boolean;
}

export interface PresetDetail extends PresetRow {
  readonly services: readonly PresetService[];
  readonly openOrders: number;
}

type Row = typeof t.$inferSelect;
const toRow = (r: Row, clientName: string, warehouseCode: string, serviceCount: number): PresetRow => ({
  id: r.id, name: r.name, description: r.description, method: r.method, transitDays: r.transitDays, showErrors: r.showErrors, useAllServices: r.useAllServices,
  isActive: r.isActive, clientId: r.clientId, clientName, warehouseId: r.warehouseId, warehouseCode, serviceCount: Number(serviceCount), version: r.version,
});

export function listPresets(db: AppDb, auth: AuthContext, query: GridQuery): { rows: PresetRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [listScope(t, auth, { warehouseId: t.warehouseId, clientId: t.clientId })]);
  const result = paginate(
    db.select({ r: t, c: clientCodeSql, w: warehouseCodeSql, n: serviceCountSql }).from(t).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(t).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: result.rows.map((x) => toRow(x.r, x.c, x.w, x.n)), total: result.total };
}

export function loadPreset(db: AppDb, auth: AuthContext, id: string): Row {
  const row = assertFound(db.select().from(t).where(eq(t.id, id)).get(), "Rate shopping preset");
  assertWarehouseInScope(auth, row.warehouseId, "Rate shopping preset");
  assertClientInScope(auth, row.clientId, "Rate shopping preset");
  return row;
}

/** Active services of active carrier setups in the warehouse that the client may use. */
export function availableServices(db: AppDb, auth: AuthContext, warehouseId: string, clientId: string, selected: ReadonlySet<string> = new Set()): PresetService[] {
  assertWarehouseInScope(auth, warehouseId);
  assertClientInScope(auth, clientId);
  const cc = s.carrierConnections;
  const rows = db.select({ svc: s.carrierServices, conn: cc }).from(s.carrierServices).innerJoin(cc, eq(cc.id, s.carrierServices.connectionId))
    .where(and(eq(cc.warehouseId, warehouseId), eq(cc.isActive, true), eq(s.carrierServices.isActive, true),
      sql`(${cc.allClients} = 1 OR EXISTS (SELECT 1 FROM carrier_connection_clients x WHERE x.connection_id = ${cc.id} AND x.client_id = ${clientId} AND x.has_access = 1))`))
    .orderBy(asc(cc.setupName), asc(s.carrierServices.transitDays), asc(s.carrierServices.name)).all();
  return rows.map(({ svc, conn }) => ({
    id: svc.id, setupName: conn.setupName, connectionId: conn.id, provider: conn.provider, carrierCode: svc.carrierCode, name: svc.name,
    transitDays: svc.transitDays, isInternational: svc.isInternational, selected: selected.has(svc.id),
  }));
}

const openOrdersOf = (db: AppDb, id: string): number =>
  db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE rate_shopping_preset_id = ${id} AND deleted_at IS NULL AND status NOT IN ('Shipped','Partially Shipped','Delivered','Cancelled')`)?.n ?? 0;

export function getPreset(db: AppDb, auth: AuthContext, id: string): PresetDetail {
  const r = loadPreset(db, auth, id);
  const selected = new Set(db.select({ id: ps.carrierServiceId }).from(ps).where(and(eq(ps.presetId, id), eq(ps.isSelected, true))).all().map((x) => x.id));
  const services = availableServices(db, auth, r.warehouseId, r.clientId, selected);
  return {
    ...toRow(r, labelsOf(db, "clients", [r.clientId]).get(r.clientId) ?? "", labelsOf(db, "warehouses", [r.warehouseId]).get(r.warehouseId) ?? "", selected.size),
    services, openOrders: openOrdersOf(db, id),
  };
}

function snapshot(db: AppDb, v: Pick<PresetSave, "name" | "description" | "method" | "transitDays" | "showErrors" | "useAllServices" | "isActive">, serviceIds: readonly string[]) {
  const names = labelsOf(db, "carrier_services", serviceIds);
  return {
    name: v.name, description: v.description, rateCalculationMethod: v.method, transitTime: v.transitDays, showErrorMessages: v.showErrors,
    useAllAvailableServices: v.useAllServices, active: v.isActive,
    shippingOptions: v.useAllServices ? "All available" : [...names.values()].sort().join(", ") || "None",
  };
}

function writeServices(tx: AppDb, auth: AuthContext, presetId: string, body: PresetSave): readonly string[] {
  tx.delete(ps).where(eq(ps.presetId, presetId)).run();
  if (body.useAllServices) return [];
  const allowed = new Set(availableServices(tx, auth, body.warehouseId, body.clientId).map((x) => x.id));
  const ids = [...new Set(body.serviceIds)];
  const bad = ids.find((x) => !allowed.has(x));
  if (bad) throw fieldError("serviceIds", "One of the selected shipping options is no longer available for this client");
  if (ids.length > 0) tx.insert(ps).values(ids.map((carrierServiceId) => ({ presetId, carrierServiceId, isSelected: true }))).run();
  return ids;
}

function assertUnique(tx: AppDb, body: PresetSave, id: string | null) {
  const dup = tx.select({ id: t.id }).from(t).where(and(eq(t.clientId, body.clientId), eq(t.warehouseId, body.warehouseId), sql`lower(${t.name}) = lower(${body.name})`, id ? ne(t.id, id) : sql`1 = 1`)).get();
  if (dup) throw duplicateError("name", `A preset named "${body.name}" already exists for this client`);
}

export function createPreset(tx: AppDb, auth: AuthContext, actor: Actor, body: PresetSave): PresetDetail {
  assertWarehouseInScope(auth, body.warehouseId);
  assertClientInScope(auth, body.clientId);
  assertUnique(tx, body, null);
  const row = tx.insert(t).values({
    name: body.name, description: body.description, warehouseId: body.warehouseId, clientId: body.clientId, method: body.method,
    transitDays: body.method === "Cheapest In Time" ? body.transitDays : null, showErrors: body.showErrors, useAllServices: body.useAllServices, isActive: body.isActive,
    createdBy: actor.userId, updatedBy: actor.userId,
  }).returning().get();
  writeServices(tx, auth, row.id, body);
  logCreate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: row.id, entityCode: row.name });
  return getPreset(tx, auth, row.id);
}

export function updatePreset(tx: AppDb, auth: AuthContext, actor: Actor, id: string, body: PresetSave): PresetDetail {
  const before = loadPreset(tx, auth, id);
  assertVersion(before.version, body.version);
  if (before.warehouseId !== body.warehouseId) throw fieldError("warehouseId", "Warehouse can't change after the preset is created");
  if (before.clientId !== body.clientId) throw fieldError("clientId", "Client can't change after the preset is created");
  assertUnique(tx, body, id);
  const oldIds = tx.select({ id: ps.carrierServiceId }).from(ps).where(eq(ps.presetId, id)).all().map((x) => x.id);
  tx.update(t).set({
    name: body.name, description: body.description, method: body.method, transitDays: body.method === "Cheapest In Time" ? body.transitDays : null,
    showErrors: body.showErrors, useAllServices: body.useAllServices, isActive: body.isActive, updatedBy: actor.userId, version: sql`${t.version} + 1`,
  }).where(eq(t.id, id)).run();
  const newIds = writeServices(tx, auth, id, body);
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: id, entityCode: body.name }, snapshot(tx, before, oldIds), snapshot(tx, body, newIds));
  return getPreset(tx, auth, id);
}

export function deletePresets(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const p = loadPreset(inner, auth, id);
    const open = openOrdersOf(inner, id);
    if (open > 0) throw new AppError("INVALID_STATE", `${p.name} is set on ${open} open order${open === 1 ? "" : "s"}; set it inactive instead`);
    inner.delete(t).where(eq(t.id, id)).run();
    logDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: p.name });
  });
}

/** Presets an order can use (workflow builder / order editor pickers). */
export function presetOptions(db: AppDb, auth: AuthContext, filter: { warehouseId?: string | null; clientId?: string | null }): { id: string; label: string; warehouseId: string; clientId: string }[] {
  const conds = [eq(t.isActive, true), listScope(t, auth, { warehouseId: t.warehouseId, clientId: t.clientId })];
  if (filter.warehouseId) conds.push(eq(t.warehouseId, filter.warehouseId));
  if (filter.clientId) conds.push(eq(t.clientId, filter.clientId));
  return db.select({ id: t.id, name: t.name, method: t.method, warehouseId: t.warehouseId, clientId: t.clientId, client: clientCodeSql }).from(t).where(and(...conds)).orderBy(asc(t.name)).all()
    .map((x) => ({ id: x.id, label: `${x.name} · ${x.method} · ${x.client}`, warehouseId: x.warehouseId, clientId: x.clientId }));
}

export const presetIdsIn = (db: AppDb, ids: readonly string[]) => (ids.length === 0 ? [] : db.select({ id: t.id }).from(t).where(inArray(t.id, [...ids])).all());
