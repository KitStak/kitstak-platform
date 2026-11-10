/**
 * Customers repository (M11): grid (default shipping address columns), detail with
 * addresses and recent orders, create / edit (at least one Shipping address), bulk
 * activate / deactivate and delete (blocked while orders reference the customer).
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient, scopedWhere } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { CUSTOMER_FIELDS, CUSTOMER_SEARCH_FIELDS, CUSTOMER_SORT_FIELDS, type CustomerSave } from "@/lib/grid-defs/organization/customers";
import { assertVersion, compileGrid, deleteAddresses, domainCtxOf, listAddresses, logCreate, logDelete, logUpdate, namesOf, saveAddresses, type Actor, type GridBinding, type OwnedAddress } from "./clients-shared";

const t = s.customers;
export const CUSTOMER_ENTITY = "customer";

const addr = (col: string) => sql.raw(`(SELECT a.${col} FROM addresses a WHERE a.owner_type = 'customer' AND a.owner_id = customers.id AND a.usage_type = 'Shipping' AND a.is_active = 1 ORDER BY a.is_default DESC, a.created_at LIMIT 1)`);
const fullNameSql = sql<string>`(${t.firstName} || ' ' || ${t.lastName})`;
const clientNameSql = sql<string>`(SELECT cl.name FROM clients cl WHERE cl.id = customers.client_id)`;
const orderCountSql = sql<number>`(SELECT COUNT(*) FROM shipment_orders so WHERE so.customer_id = customers.id)`;
const citySql = sql<string | null>`${addr("city")}`;
const stateSql = sql<string | null>`${addr("state")}`;
const countrySql = sql<string | null>`${addr("country")}`;

const BINDING: GridBinding = {
  exprs: {
    isActive: sql`${t.isActive}`, clientId: sql`${t.clientId}`, email: sql`${t.email}`, phone: sql`${t.phone}`, fullName: fullNameSql, clientName: clientNameSql,
    city: citySql, state: stateSql, country: countrySql, orderCount: orderCountSql, createdAt: sql`${t.createdAt}`,
  },
  fields: CUSTOMER_FIELDS, sortable: CUSTOMER_SORT_FIELDS, search: CUSTOMER_SEARCH_FIELDS,
  defaultSort: [{ field: "fullName", dir: "asc" }], tiebreaker: t.id,
};

export interface CustomerRow {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly country: string | null;
  readonly isActive: boolean;
  readonly orderCount: number;
  readonly createdAt: string;
  readonly version: number;
}

const ROW = {
  id: t.id, firstName: t.firstName, lastName: t.lastName, fullName: fullNameSql, email: t.email, phone: t.phone, clientId: t.clientId, clientName: clientNameSql,
  city: citySql, state: stateSql, country: countrySql, isActive: t.isActive, orderCount: orderCountSql, createdAt: t.createdAt, version: t.version,
};

const scope = (auth: AuthContext): SQL | undefined => scopedWhere(t, auth.viewScope);

export function listCustomers(db: AppDb, auth: AuthContext, query: GridQuery): { rows: CustomerRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [scope(auth)]);
  const result = paginate(db.select(ROW).from(t).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(t).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return { rows: (result.rows as CustomerRow[]).map((r) => ({ ...r, isActive: Boolean(r.isActive) })), total: result.total };
}

export function loadCustomer(db: AppDb, auth: AuthContext, id: string): typeof t.$inferSelect {
  const row = db.select().from(t).where(eq(t.id, id)).get();
  if (!row || !hasClient(auth.scope, row.clientId)) throw notFoundError("Customer");
  return row;
}

export interface CustomerDetail extends CustomerRow {
  readonly addresses: readonly OwnedAddress[];
  readonly recentOrders: readonly { id: string; code: string; status: string; orderDate: string }[];
}

export function getCustomer(db: AppDb, auth: AuthContext, id: string): CustomerDetail {
  loadCustomer(db, auth, id);
  const row = db.select(ROW).from(t).where(eq(t.id, id)).get() as CustomerRow;
  const recentOrders = db.all<{ id: string; code: string; status: string; orderDate: string }>(sql`SELECT id, code, status, order_date AS orderDate FROM shipment_orders WHERE customer_id = ${id} ORDER BY order_date DESC LIMIT 5`);
  return { ...row, isActive: Boolean(row.isActive), addresses: listAddresses(db, "customer", id), recentOrders };
}

function snapshot(db: AppDb, row: typeof t.$inferSelect): Record<string, unknown> {
  return { firstName: row.firstName, lastName: row.lastName, email: row.email, phone: row.phone, clientId: namesOf(db, "clients", [row.clientId]).get(row.clientId) ?? "", isActive: row.isActive };
}

function assertWritable(db: AppDb, auth: AuthContext, input: CustomerSave): void {
  if (!hasClient(auth.scope, input.clientId)) throw new AppError("VALIDATION", "Choose a client you have access to", { fieldErrors: { clientId: ["Choose a client you have access to"] } });
  const client = db.select({ status: s.clients.status }).from(s.clients).where(eq(s.clients.id, input.clientId)).get();
  if (!client) throw new AppError("VALIDATION", "Choose a client", { fieldErrors: { clientId: ["Choose a client"] } });
}

function assertEmailFree(db: AppDb, clientId: string, email: string, exceptId?: string): void {
  const clash = db.select({ id: t.id }).from(t).where(and(eq(t.clientId, clientId), sql`lower(${t.email}) = lower(${email})`)).get();
  if (clash && clash.id !== exceptId) throw new AppError("DUPLICATE", `${email} is already a customer of this client`, { fieldErrors: { email: ["This client already has a customer with this e-mail"] } });
}

const cols = (input: CustomerSave) => ({ firstName: input.firstName.trim(), lastName: input.lastName.trim(), email: input.email.trim().toLowerCase(), phone: input.phone.trim(), clientId: input.clientId, isActive: input.isActive });

export function createCustomer(tx: AppDb, auth: AuthContext, actor: Actor, input: CustomerSave): { id: string; fullName: string } {
  assertWritable(tx, auth, input);
  assertEmailFree(tx, input.clientId, input.email);
  const row = tx.insert(t).values({ ...cols(input), createdBy: actor.userId, updatedBy: actor.userId }).returning().get();
  const ctx = domainCtxOf(actor, auth);
  logCreate(tx, ctx, CUSTOMER_ENTITY, row.id, row.email);
  saveAddresses(tx, ctx, { type: "customer", id: row.id, code: row.email, userId: actor.userId }, input.addresses);
  return { id: row.id, fullName: `${row.firstName} ${row.lastName}` };
}

export function updateCustomer(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: CustomerSave): { id: string; fullName: string; version: number } {
  const before = loadCustomer(tx, auth, id);
  assertVersion(before.version, input.version);
  assertWritable(tx, auth, input);
  assertEmailFree(tx, input.clientId, input.email, id);
  if (input.clientId !== before.clientId) {
    const orders = Number(tx.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE customer_id = ${id}`)?.n ?? 0);
    if (orders > 0) throw new AppError("VALIDATION", "Client is locked once orders exist", { fieldErrors: { clientId: [`Locked: ${orders} orders reference this customer`] } });
  }
  const after = tx.update(t).set({ ...cols(input), updatedBy: actor.userId, version: sql`${t.version} + 1` }).where(eq(t.id, id)).returning().get();
  const ctx = domainCtxOf(actor, auth);
  logUpdate(tx, ctx, CUSTOMER_ENTITY, id, after.email, snapshot(tx, before), snapshot(tx, after));
  saveAddresses(tx, ctx, { type: "customer", id, code: after.email, userId: actor.userId }, input.addresses);
  return { id, fullName: `${after.firstName} ${after.lastName}`, version: after.version };
}

export function setCustomersActive(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[], isActive: boolean): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadCustomer(inner, auth, id);
    if (Boolean(row.isActive) === isActive) throw new AppError("INVALID_STATE", `${row.firstName} ${row.lastName} is already ${isActive ? "active" : "inactive"}`);
    inner.update(t).set({ isActive, updatedBy: actor.userId, version: sql`${t.version} + 1` }).where(eq(t.id, id)).run();
    logUpdate(inner, ctx, CUSTOMER_ENTITY, id, row.email, { isActive: row.isActive }, { isActive });
  });
}

export function deleteCustomers(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadCustomer(inner, auth, id);
    const orders = Number(inner.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE customer_id = ${id}`)?.n ?? 0);
    if (orders > 0) throw new AppError("INVALID_STATE", `${row.firstName} ${row.lastName} has ${orders} ${orders === 1 ? "order" : "orders"}; deactivate instead`);
    deleteAddresses(inner, "customer", id);
    inner.delete(t).where(eq(t.id, id)).run();
    logDelete(inner, ctx, CUSTOMER_ENTITY, id, row.email);
  });
}
