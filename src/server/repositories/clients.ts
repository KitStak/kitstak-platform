/**
 * Clients repository (M11): grid, detail (KPIs, settings, addresses, users with access,
 * billing contracts), 4-step create, full edit, settings-only edit, bulk activate /
 * deactivate and guarded delete. Every write logs field-level change_log on "client".
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient, scopedWhere } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import {
  CLIENT_FIELDS, CLIENT_SEARCH_FIELDS, CLIENT_SORT_FIELDS, flattenSettings, fullSettings, settingLabel, type ClientSave, type ClientSettingsForm,
} from "@/lib/grid-defs/organization/clients";
import { BACKLOG_STATUSES } from "./orders";
import { assertVersion, compileGrid, domainCtxOf, listAddresses, logCreate, logDelete, logUpdate, saveAddresses, type Actor, type GridBinding, type OwnedAddress } from "./clients-shared";
import { contractsForClient, type ContractRow } from "./billing";

const c = s.clients;
export const CLIENT_ENTITY = "client";
export type ClientStatus = (typeof c.$inferSelect)["status"];

const backlog = sql.join(BACKLOG_STATUSES.map((v) => sql`${v}`), sql`, `);
const productCountSql = sql<number>`(SELECT COUNT(*) FROM products p WHERE p.client_id = clients.id)`;
const openOrdersSql = sql<number>`(SELECT COUNT(*) FROM shipment_orders so WHERE so.client_id = clients.id AND so.status IN (${backlog}))`;
const totalOrdersSql = sql<number>`(SELECT COUNT(*) FROM shipment_orders so WHERE so.client_id = clients.id)`;
const createdByNameSql = sql<string | null>`(SELECT u.name FROM users u WHERE u.id = clients.created_by)`;

const BINDING: GridBinding = {
  exprs: {
    code: sql`${c.code}`, name: sql`${c.name}`, officialName: sql`${c.officialName}`, taxId: sql`${c.taxId}`, status: sql`${c.status}`, currency: sql`${c.currency}`,
    productCount: productCountSql, openOrders: openOrdersSql, createdAt: sql`${c.createdAt}`,
  },
  fields: CLIENT_FIELDS, sortable: CLIENT_SORT_FIELDS, search: CLIENT_SEARCH_FIELDS,
  defaultSort: [{ field: "name", dir: "asc" }], tiebreaker: c.id,
};

export interface ClientListRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly officialName: string | null;
  readonly fullName: string;
  readonly taxId: string | null;
  readonly status: ClientStatus;
  readonly currency: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly phone: string;
  readonly billingPlan: string;
  readonly productCount: number;
  readonly openOrders: number;
  readonly totalOrders: number;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly version: number;
}

const ROW = {
  id: c.id, code: c.code, name: c.name, officialName: c.officialName, taxId: c.taxId, status: c.status, currency: c.currency, contactName: c.contactName,
  contactEmail: c.contactEmail, phone: c.phone, billingPlan: c.billingPlan, productCount: productCountSql, openOrders: openOrdersSql, totalOrders: totalOrdersSql,
  createdAt: c.createdAt, createdByName: createdByNameSql, version: c.version,
};

/** Clients are scoped by their own id. */
export const clientScope = (auth: AuthContext, view = true): SQL | undefined => scopedWhere(c, view ? auth.viewScope : auth.scope, { clientId: c.id });

/** `f.warehouseId=in:<id>` (shared ClientSelect) = clients usable in that warehouse: Active ones. */
function pickerFilter(query: GridQuery): { query: GridQuery; activeOnly: boolean } {
  const filters = query.filters.filter((f) => f.field !== "warehouseId");
  return { query: { ...query, filters }, activeOnly: filters.length !== query.filters.length };
}

const fullName = (r: { officialName: string | null; name: string; code: string }): string => `${r.officialName || r.name} (${r.code})`;

export function listClients(db: AppDb, auth: AuthContext, rawQuery: GridQuery): { rows: ClientListRow[]; total: number } {
  const { query, activeOnly } = pickerFilter(rawQuery);
  const grid = compileGrid(BINDING, query, [clientScope(auth), activeOnly ? eq(c.status, "Active") : undefined]);
  const result = paginate(db.select(ROW).from(c).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(c).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return { rows: (result.rows as Omit<ClientListRow, "fullName">[]).map((r) => ({ ...r, fullName: fullName(r) })), total: result.total };
}

export function loadClient(db: AppDb, auth: AuthContext, id: string): typeof c.$inferSelect {
  const row = db.select().from(c).where(eq(c.id, id)).get();
  if (!row || !hasClient(auth.scope, row.id)) throw notFoundError("Client");
  return row;
}

export interface ClientKpis {
  readonly orders30d: number;
  readonly unitsShipped30d: number;
  readonly inventoryUnits: number;
  readonly openPos: number;
  readonly openOrders: number;
  readonly products: number;
  readonly skusInStock: number;
}

export function clientKpis(db: AppDb, auth: AuthContext, id: string, now = new Date()): ClientKpis {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const wh = auth.viewScope.warehouseIds.length ? sql.join(auth.viewScope.warehouseIds.map((w) => sql`${w}`), sql`, `) : sql`''`;
  const one = (q: SQL): number => Number(db.get<{ n: number | null }>(q)?.n ?? 0);
  return {
    orders30d: one(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE client_id = ${id} AND warehouse_id IN (${wh}) AND created_at >= ${since}`),
    unitsShipped30d: one(sql`SELECT COALESCE(SUM(ol.shipped_quantity), 0) AS n FROM order_lines ol JOIN shipment_orders so ON so.id = ol.order_id
      WHERE so.client_id = ${id} AND so.warehouse_id IN (${wh}) AND so.shipped_at >= ${since}`),
    inventoryUnits: one(sql`SELECT COALESCE(SUM(on_hand), 0) AS n FROM inventory WHERE client_id = ${id} AND warehouse_id IN (${wh})`),
    skusInStock: one(sql`SELECT COUNT(DISTINCT product_id) AS n FROM inventory WHERE client_id = ${id} AND warehouse_id IN (${wh}) AND on_hand > 0`),
    openPos: one(sql`SELECT COUNT(*) AS n FROM purchase_orders WHERE client_id = ${id} AND warehouse_id IN (${wh}) AND status IN ('Pending', 'Started', 'Receiving')`),
    openOrders: one(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE client_id = ${id} AND warehouse_id IN (${wh}) AND status IN (${backlog})`),
    products: one(sql`SELECT COUNT(*) AS n FROM products WHERE client_id = ${id}`),
  };
}

export interface ClientUserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly access: "All clients" | "Assigned";
}

export function usersWithAccess(db: AppDb, clientId: string): ClientUserRow[] {
  const rows = db.all<{ id: string; name: string; email: string; role: string; isActive: number; allClients: number }>(sql`
    SELECT u.id, u.name, u.email, u.role, u.is_active AS isActive, u.all_clients AS allClients FROM users u
    WHERE u.all_clients = 1 OR EXISTS (SELECT 1 FROM user_clients uc WHERE uc.user_id = u.id AND uc.client_id = ${clientId})
    ORDER BY u.all_clients ASC, u.name ASC`);
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, isActive: Boolean(r.isActive), access: r.allClients ? "All clients" : "Assigned" }));
}

export interface ClientDetail extends ClientListRow {
  readonly settings: ClientSettingsForm;
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly addresses: readonly OwnedAddress[];
  readonly kpis: ClientKpis;
  readonly contracts: readonly ContractRow[];
  readonly users: readonly ClientUserRow[];
  readonly updatedAt: string;
}

export function getClient(db: AppDb, auth: AuthContext, id: string): ClientDetail {
  const row = loadClient(db, auth, id);
  const view = db.select(ROW).from(c).where(eq(c.id, id)).get() as Omit<ClientListRow, "fullName">;
  return {
    ...view, fullName: fullName(view), settings: fullSettings(row.settings), customFields: row.customFields ?? {}, addresses: listAddresses(db, "client", id),
    kpis: clientKpis(db, auth, id), contracts: contractsForClient(db, auth, id), users: usersWithAccess(db, id), updatedAt: row.updatedAt,
  };
}

/* ---------------- writes ---------------- */

function snapshot(row: typeof c.$inferSelect): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: row.name, code: row.code, officialName: row.officialName ?? "", status: row.status, contactName: row.contactName, contactEmail: row.contactEmail,
    phone: row.phone, currency: row.currency, taxId: row.taxId ?? "", billingPlan: row.billingPlan,
  };
  for (const [k, v] of Object.entries(flattenSettings(fullSettings(row.settings)))) out[settingLabel(k) ?? k] = v ? "On" : "Off";
  for (const [k, v] of Object.entries(row.customFields ?? {})) out[`Custom field ${k}`] = v ?? "";
  return out;
}

function assertCodeFree(db: AppDb, code: string, exceptId?: string): void {
  const clash = db.select({ id: c.id }).from(c).where(sql`upper(${c.code}) = upper(${code})`).get();
  if (clash && clash.id !== exceptId) throw new AppError("DUPLICATE", `Client code ${code} is already used`, { fieldErrors: { code: ["This client code is already used"] } });
}

function assertNameFree(db: AppDb, name: string, exceptId?: string): void {
  const clash = db.select({ id: c.id }).from(c).where(sql`lower(${c.name}) = lower(${name})`).get();
  if (clash && clash.id !== exceptId) throw new AppError("DUPLICATE", `A client named ${name} already exists`, { fieldErrors: { name: ["A client with this display name already exists"] } });
}

function columns(input: ClientSave) {
  return {
    name: input.name.trim(), code: input.code, officialName: input.officialName.trim(), status: input.status, contactName: input.contactName ?? "",
    contactEmail: input.contactEmail ?? "", phone: input.phone ?? "", currency: input.currency, taxId: input.taxId, billingPlan: input.billingPlan,
    settings: input.settings, customFields: input.customFields,
  };
}

function addNote(tx: AppDb, actor: Actor, clientId: string, body: string | null): void {
  if (!body) return;
  tx.insert(s.entityNotes).values({ entityType: CLIENT_ENTITY, entityId: clientId, body, userId: actor.userId }).run();
}

export function createClient(tx: AppDb, auth: AuthContext, actor: Actor, input: ClientSave): { id: string; code: string; name: string } {
  if (auth.scope.clientIds !== "all") throw new AppError("FORBIDDEN", "Only users with access to all clients can create clients");
  assertCodeFree(tx, input.code);
  assertNameFree(tx, input.name.trim());
  const row = tx.insert(c).values({ ...columns(input), createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: c.id, code: c.code, name: c.name }).get();
  const ctx = domainCtxOf(actor, auth);
  logCreate(tx, ctx, CLIENT_ENTITY, row.id, row.code);
  if (input.addresses.length) saveAddresses(tx, ctx, { type: "client", id: row.id, code: row.code, userId: actor.userId }, input.addresses);
  addNote(tx, actor, row.id, input.note);
  return row;
}

export function updateClient(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: ClientSave): { id: string; code: string; name: string; version: number } {
  const before = loadClient(tx, auth, id);
  assertVersion(before.version, input.version);
  if (input.code !== before.code) throw new AppError("VALIDATION", "Client code can't change", { fieldErrors: { code: ["Client code can't change after creation"] } });
  assertNameFree(tx, input.name.trim(), id);
  const after = tx.update(c).set({ ...columns(input), updatedBy: actor.userId, version: sql`${c.version} + 1` }).where(eq(c.id, id)).returning().get();
  const ctx = domainCtxOf(actor, auth);
  logUpdate(tx, ctx, CLIENT_ENTITY, id, after.code, snapshot(before), snapshot(after));
  saveAddresses(tx, ctx, { type: "client", id, code: after.code, userId: actor.userId }, input.addresses);
  addNote(tx, actor, id, input.note);
  return { id, code: after.code, name: after.name, version: after.version };
}

export function updateClientSettings(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: { currency: ClientSave["currency"]; settings: ClientSettingsForm; version?: number }): { id: string; version: number } {
  const before = loadClient(tx, auth, id);
  assertVersion(before.version, input.version);
  const after = tx.update(c).set({ currency: input.currency, settings: input.settings, updatedBy: actor.userId, version: sql`${c.version} + 1` }).where(eq(c.id, id)).returning().get();
  logUpdate(tx, domainCtxOf(actor, auth), CLIENT_ENTITY, id, after.code, snapshot(before), snapshot(after));
  return { id, version: after.version };
}

export function setClientStatus(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], status: ClientStatus): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadClient(inner, auth, id);
    if (row.status === status) throw new AppError("INVALID_STATE", `${row.name} is already ${status.toLowerCase()}`);
    if (status === "Inactive") {
      const open = Number(inner.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE client_id = ${id} AND status IN (${backlog})`)?.n ?? 0);
      if (open > 0) throw new AppError("INVALID_STATE", `${row.name} has ${open} open ${open === 1 ? "order" : "orders"}`);
    }
    inner.update(c).set({ status, updatedBy: actor.userId, version: sql`${c.version} + 1` }).where(eq(c.id, id)).run();
    logUpdate(inner, ctx, CLIENT_ENTITY, id, row.code, { status: row.status }, { status });
  });
}

/** Why a client can't be deleted (null = deletable). */
export function clientDeleteBlocker(db: AppDb, id: string): string | null {
  const counts = db.get<{ products: number; orders: number; pos: number; inv: number; contracts: number }>(sql`SELECT
    (SELECT COUNT(*) FROM products WHERE client_id = ${id}) AS products,
    (SELECT COUNT(*) FROM shipment_orders WHERE client_id = ${id}) AS orders,
    (SELECT COUNT(*) FROM purchase_orders WHERE client_id = ${id}) AS pos,
    (SELECT COUNT(*) FROM inventory WHERE client_id = ${id} AND on_hand > 0) AS inv,
    (SELECT COUNT(*) FROM billing_contracts WHERE client_id = ${id}) AS contracts`);
  if (!counts) return null;
  const parts = [
    counts.products ? `${counts.products} products` : "", counts.orders ? `${counts.orders} orders` : "", counts.pos ? `${counts.pos} POs` : "",
    counts.inv ? "stock on hand" : "", counts.contracts ? `${counts.contracts} billing forms` : "",
  ].filter(Boolean);
  return parts.length ? `has ${parts.join(", ")}; deactivate it instead` : null;
}

export function deleteClients(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadClient(inner, auth, id);
    const reason = clientDeleteBlocker(inner, id);
    if (reason) throw new AppError("INVALID_STATE", `${row.name} ${reason}`);
    for (const table of ["customers", "vendors", "user_clients", "lookup_values", "vas_operations", "shipment_package_clients", "printout_template_clients", "carrier_connection_clients"]) {
      inner.run(sql`DELETE FROM ${sql.raw(table)} WHERE client_id = ${id}`);
    }
    inner.delete(s.addresses).where(and(eq(s.addresses.ownerType, "client"), eq(s.addresses.ownerId, id))).run();
    inner.delete(c).where(eq(c.id, id)).run();
    logDelete(inner, ctx, CLIENT_ENTITY, id, row.code);
  });
}

/** Lightweight id → label options for other module screens (Active only by default). */
export function clientOptions(db: AppDb, auth: AuthContext, includeInactive = false): { id: string; code: string; name: string; status: ClientStatus }[] {
  return db.select({ id: c.id, code: c.code, name: c.name, status: c.status }).from(c)
    .where(and(clientScope(auth, false), includeInactive ? undefined : eq(c.status, "Active"))).orderBy(asc(c.name)).all();
}

export function clientsByIds(db: AppDb, ids: readonly string[]): Map<string, typeof c.$inferSelect> {
  if (ids.length === 0) return new Map();
  return new Map(db.select().from(c).where(inArray(c.id, [...ids])).all().map((r) => [r.id, r]));
}
