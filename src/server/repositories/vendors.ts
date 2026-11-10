/**
 * Vendors repository (M05; table owner per Part C: vendors + vendor addresses).
 *
 * Reads are scoped through the vendor's client (`scopedWhere`); cross-scope ids are
 * reported as NOT_FOUND. Writes log field-level change_log rows (entity "vendor").
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { countryName, COUNTRIES } from "@/lib/countries";
import { VENDOR_GRID_FIELDS, VENDOR_SEARCH_FIELDS, VENDOR_SORT_FIELDS, type VendorAddressInput, type VendorFormValues } from "@/lib/grid-defs/receiving/vendors";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, hasClient, scopedWhere, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, type DomainCtx } from "@/server/domain";
import type { GridQuery } from "@/server/query/grid-query";
import { compileGrid, type GridSpec } from "./purchase-orders-grid";
import { assertVersion } from "./platform-common";

const v = schema.vendors;
const OPEN_PO_SQL: SQL = sql`(SELECT count(*) FROM purchase_orders p WHERE p.vendor_id = ${v.id} AND p.status IN ('Pending','Started','Receiving'))`;
const CLIENT_NAME_SQL: SQL = sql`(SELECT c.name FROM clients c WHERE c.id = ${v.clientId})`;

const SPEC: GridSpec = {
  fields: VENDOR_GRID_FIELDS,
  sortFields: VENDOR_SORT_FIELDS,
  searchFields: VENDOR_SEARCH_FIELDS,
  exprs: {
    clientId: sql`${v.clientId}`,
    vendorName: sql`${v.vendorName}`,
    displayName: sql`${v.displayName}`,
    isActive: sql`${v.isActive}`,
    clientName: CLIENT_NAME_SQL,
    openPoCount: OPEN_PO_SQL,
    createdAt: sql`${v.createdAt}`,
  },
  defaultOrder: [sql`${v.displayName} COLLATE NOCASE ASC`],
};

export interface VendorAddress {
  readonly name: string;
  readonly line1: string;
  readonly line2: string;
  readonly postalCode: string;
  readonly city: string;
  readonly phone: string;
  /** ISO code. */
  readonly country: string;
  readonly state: string;
}

export interface VendorRow {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly displayName: string;
  readonly vendorName: string;
  readonly isActive: boolean;
  readonly useShipAsBilling: boolean;
  readonly openPoCount: number;
  readonly city: string | null;
  readonly state: string | null;
  readonly version: number;
  readonly createdAt: string;
}

export interface VendorDetail extends VendorRow {
  readonly shipping: VendorAddress | null;
  readonly billing: VendorAddress | null;
}

const vendorScope = (scope: Scope): SQL | undefined => scopedWhere(v, scope, { clientId: v.clientId });

function codeForCountry(value: string | null | undefined): string {
  if (!value) return "US";
  if (value.length === 2) return value.toUpperCase();
  return COUNTRIES.find((c) => c.name.toLowerCase() === value.toLowerCase())?.code ?? "US";
}

type AddressRow = typeof schema.addresses.$inferSelect;

function toAddress(row: AddressRow | undefined): VendorAddress | null {
  if (!row) return null;
  return {
    name: row.name ?? "", line1: row.line1, line2: row.line2 ?? "", postalCode: row.postalCode, city: row.city,
    phone: row.phone ?? "", country: codeForCountry(row.country), state: row.state ?? "",
  };
}

function addressesOf(db: AppDb, vendorIds: readonly string[]): Map<string, { shipping?: AddressRow; billing?: AddressRow }> {
  const out = new Map<string, { shipping?: AddressRow; billing?: AddressRow }>();
  if (vendorIds.length === 0) return out;
  const rows = db.select().from(schema.addresses)
    .where(and(eq(schema.addresses.ownerType, "vendor"), inArray(schema.addresses.ownerId, [...vendorIds]), eq(schema.addresses.isActive, true))).all();
  for (const row of rows) {
    const entry = out.get(row.ownerId) ?? {};
    if (row.usageType === "Billing") entry.billing = row;
    else if (row.usageType === "Shipping") entry.shipping = row;
    out.set(row.ownerId, entry);
  }
  return out;
}

const SELECT = {
  id: v.id, clientId: v.clientId, clientName: sql<string>`${CLIENT_NAME_SQL}`, displayName: v.displayName, vendorName: v.vendorName,
  isActive: v.isActive, useShipAsBilling: v.useShipAsBilling, openPoCount: sql<number>`${OPEN_PO_SQL}`, version: v.version, createdAt: v.createdAt,
};

export interface VendorListOptions {
  /** PO wizard: restrict to one client (must be in scope). */
  readonly clientId?: string | null;
  readonly activeOnly?: boolean;
}

export function listVendors(db: AppDb, auth: AuthContext, query: GridQuery, options: VendorListOptions = {}): { rows: VendorRow[]; total: number } {
  if (options.clientId && !hasClient(auth.scope, options.clientId)) return { rows: [], total: 0 };
  const extra = [
    vendorScope(options.clientId ? auth.scope : auth.viewScope),
    options.clientId ? eq(v.clientId, options.clientId) : undefined,
    options.activeOnly ? eq(v.isActive, true) : undefined,
  ];
  const { where, orderBy } = compileGrid(SPEC, query, extra);
  const total = db.select({ n: sql<number>`count(*)` }).from(v).where(where).get()?.n ?? 0;
  const base = db.select(SELECT).from(v).where(where).orderBy(...orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize).all();
  const addr = addressesOf(db, base.map((r) => r.id));
  const rows = base.map((r) => {
    const ship = addr.get(r.id)?.shipping;
    return { ...r, isActive: Boolean(r.isActive), useShipAsBilling: Boolean(r.useShipAsBilling), city: ship?.city || null, state: ship?.state || null };
  });
  return { rows, total };
}

export function getVendor(db: AppDb, scope: Scope, id: string): VendorDetail {
  const row = db.select(SELECT).from(v).where(eq(v.id, id)).get();
  if (!row) throw notFoundError("Vendor");
  assertInScope(scope, { clientId: row.clientId }, "Vendor");
  const addr = addressesOf(db, [id]).get(id) ?? {};
  const shipping = toAddress(addr.shipping);
  const billing = row.useShipAsBilling ? shipping : toAddress(addr.billing);
  return {
    ...row, isActive: Boolean(row.isActive), useShipAsBilling: Boolean(row.useShipAsBilling),
    city: shipping?.city || null, state: shipping?.state || null, shipping, billing,
  };
}

function flatAddress(prefix: string, a: VendorAddress | null): Record<string, string> {
  if (!a) return {};
  return {
    [`${prefix}Name`]: a.name, [`${prefix}Line1`]: a.line1, [`${prefix}Line2`]: a.line2, [`${prefix}PostalCode`]: a.postalCode,
    [`${prefix}City`]: a.city, [`${prefix}Phone`]: a.phone, [`${prefix}Country`]: countryName(a.country) || a.country, [`${prefix}State`]: a.state,
  };
}

function upsertAddress(tx: AppDb, ctx: DomainCtx, vendorId: string, usage: "Shipping" | "Billing", input: VendorAddressInput | null): void {
  const existing = tx.select().from(schema.addresses)
    .where(and(eq(schema.addresses.ownerType, "vendor"), eq(schema.addresses.ownerId, vendorId), eq(schema.addresses.usageType, usage))).get();
  if (!input) {
    if (existing) tx.update(schema.addresses).set({ isActive: false, updatedBy: ctx.userId }).where(eq(schema.addresses.id, existing.id)).run();
    return;
  }
  const values = {
    name: input.name || null, line1: input.line1 ?? "", line2: input.line2 || null, postalCode: input.postalCode ?? "", city: input.city ?? "",
    phone: input.phone || null, country: countryName(input.country) || input.country, state: input.state, isActive: true, isDefault: true, updatedBy: ctx.userId,
  };
  if (existing) tx.update(schema.addresses).set(values).where(eq(schema.addresses.id, existing.id)).run();
  else tx.insert(schema.addresses).values({ ...values, ownerType: "vendor", ownerId: vendorId, usageType: usage, createdBy: ctx.userId }).run();
}

function assertUniqueName(tx: AppDb, clientId: string, displayName: string, exceptId?: string): void {
  const clash = tx.select({ id: v.id }).from(v)
    .where(and(eq(v.clientId, clientId), sql`lower(${v.displayName}) = lower(${displayName})`, exceptId ? sql`${v.id} <> ${exceptId}` : undefined)).get();
  if (clash) {
    throw new AppError("DUPLICATE", "A vendor with this display name already exists for the client.", {
      fieldErrors: { displayName: ["A vendor with this display name already exists for the client."] },
    });
  }
}

export function createVendor(tx: AppDb, ctx: DomainCtx, scope: Scope, values: VendorFormValues): VendorDetail {
  assertInScope(scope, { clientId: values.clientId }, "Client");
  const client = tx.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, values.clientId)).get();
  if (!client) throw notFoundError("Client");
  assertUniqueName(tx, values.clientId, values.displayName);
  const row = tx.insert(v).values({
    clientId: values.clientId, displayName: values.displayName, vendorName: values.vendorName,
    useShipAsBilling: values.useShipAsBilling, isActive: true, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  upsertAddress(tx, ctx, row.id, "Shipping", values.shipping);
  upsertAddress(tx, ctx, row.id, "Billing", values.useShipAsBilling ? null : values.billing ?? null);
  changeLog.recordCreate(tx, ctx, { entityType: "vendor", entityId: row.id, entityCode: row.displayName });
  return getVendor(tx, scope, row.id);
}

export function updateVendor(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, values: Omit<VendorFormValues, "clientId"> & { clientId?: string }): VendorDetail {
  const before = getVendor(tx, scope, id);
  assertVersion(before.version, values.version);
  if (values.clientId && values.clientId !== before.clientId) {
    throw new AppError("VALIDATION", "The client of a vendor can't be changed.", { fieldErrors: { clientId: ["The client of a vendor can't be changed."] } });
  }
  assertUniqueName(tx, before.clientId, values.displayName, id);
  tx.update(v).set({
    displayName: values.displayName, vendorName: values.vendorName, useShipAsBilling: values.useShipAsBilling,
    updatedBy: ctx.userId, version: before.version + 1,
  }).where(eq(v.id, id)).run();
  upsertAddress(tx, ctx, id, "Shipping", values.shipping);
  upsertAddress(tx, ctx, id, "Billing", values.useShipAsBilling ? null : values.billing ?? null);
  const after = getVendor(tx, scope, id);
  // Keep the PO display snapshot in sync for open orders.
  if (after.displayName !== before.displayName) {
    tx.update(schema.purchaseOrders).set({ vendorName: after.displayName })
      .where(and(eq(schema.purchaseOrders.vendorId, id), inArray(schema.purchaseOrders.status, ["Pending", "Started", "Receiving"]))).run();
  }
  changeLog.recordUpdate(tx, ctx, {
    entityType: "vendor", entityId: id, entityCode: after.displayName,
    before: { displayName: before.displayName, vendorName: before.vendorName, useShipAsBilling: before.useShipAsBilling, ...flatAddress("shipping", before.shipping), ...flatAddress("billing", before.useShipAsBilling ? null : before.billing) },
    after: { displayName: after.displayName, vendorName: after.vendorName, useShipAsBilling: after.useShipAsBilling, ...flatAddress("shipping", after.shipping), ...flatAddress("billing", after.useShipAsBilling ? null : after.billing) },
  });
  return after;
}

export const VENDOR_OPEN_PO_MESSAGE = "This vendor has open purchase orders. Complete or cancel them before deactivating.";

export function setVendorActive(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, active: boolean, version?: number): VendorDetail {
  const before = getVendor(tx, scope, id);
  assertVersion(before.version, version);
  if (before.isActive === active) return before;
  if (!active && before.openPoCount > 0) throw new AppError("INVALID_STATE", VENDOR_OPEN_PO_MESSAGE);
  tx.update(v).set({ isActive: active, updatedBy: ctx.userId, version: before.version + 1 }).where(eq(v.id, id)).run();
  changeLog.recordUpdate(tx, ctx, { entityType: "vendor", entityId: id, entityCode: before.displayName, before: { isActive: before.isActive }, after: { isActive: active } });
  return getVendor(tx, scope, id);
}

/** Import helper: the client's vendor with this display name, created when missing. */
export function ensureVendor(tx: AppDb, ctx: DomainCtx, scope: Scope, clientId: string, displayName: string, vendorName?: string | null): { id: string; created: boolean } {
  const existing = tx.select({ id: v.id }).from(v).where(and(eq(v.clientId, clientId), sql`lower(${v.displayName}) = lower(${displayName})`)).get();
  if (existing) return { id: existing.id, created: false };
  assertInScope(scope, { clientId }, "Client");
  const row = tx.insert(v).values({
    clientId, displayName: displayName.slice(0, 100), vendorName: (vendorName || displayName).slice(0, 255), useShipAsBilling: true,
    isActive: true, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  changeLog.recordCreate(tx, ctx, { entityType: "vendor", entityId: row.id, entityCode: row.displayName });
  return { id: row.id, created: true };
}
