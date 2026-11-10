/**
 * Retailers repository (M11, BETA): company-level (not client scoped) big-box retailers
 * for B2B labeling. Grid, detail, 3-step create / edit (General with logo + address,
 * Advanced label settings + documents, Other Info custom fields), bulk delete blocked
 * while shipment orders reference the retailer.
 *
 * Documents: until `retailer` is a platform entity type (docs/requests REQ-2) the
 * uploaded document file ids live in `custom_fields._documents` (local adapter).
 */
import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { countryName } from "@/lib/countries";
import type { CustomFieldValues } from "@/lib/enums";
import { RETAILER_FIELDS, RETAILER_SEARCH_FIELDS, RETAILER_SORT_FIELDS, type RetailerSave } from "@/lib/grid-defs/organization/retailers";
import { assertVersion, compileGrid, countryCode, deleteAddresses, domainCtxOf, logCreate, logDelete, logUpdate, type Actor, type GridBinding } from "./clients-shared";

const t = s.retailers;
export const RETAILER_ENTITY = "retailer";
export const DOCS_KEY = "_documents";

const addr = (col: string) => sql.raw(`(SELECT a.${col} FROM addresses a WHERE a.owner_type = 'retailer' AND a.owner_id = retailers.id ORDER BY a.is_default DESC, a.created_at LIMIT 1)`);
const countrySql = sql<string | null>`${addr("country")}`;
const citySql = sql<string | null>`${addr("city")}`;
const orderCountSql = sql<number>`(SELECT COUNT(*) FROM shipment_orders so WHERE so.retailer_id = retailers.id)`;

const BINDING: GridBinding = {
  exprs: {
    name: sql`${t.name}`, businessName: sql`${t.businessName}`, isActive: sql`${t.isActive}`, country: countrySql, city: citySql, createCaseLabels: sql`${t.createCaseLabels}`,
    orderCount: orderCountSql, createdAt: sql`${t.createdAt}`,
  },
  fields: RETAILER_FIELDS, sortable: RETAILER_SORT_FIELDS, search: RETAILER_SEARCH_FIELDS,
  defaultSort: [{ field: "name", dir: "asc" }], tiebreaker: t.id,
};

export interface RetailerDocument {
  readonly fileId: string;
  readonly name: string;
  readonly size: number;
  readonly mime: string;
}

export interface RetailerRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly businessName: string | null;
  readonly logoFileId: string | null;
  readonly isActive: boolean;
  readonly createCaseLabels: boolean;
  readonly caseLabelPrintQty: number;
  readonly lpLabelPrintQty: number;
  readonly country: string | null;
  readonly address: string;
  readonly orderCount: number;
  readonly documentCount: number;
  readonly createdAt: string;
  readonly version: number;
}

type AddressRow = typeof s.addresses.$inferSelect;

function addressOf(db: AppDb, id: string): AddressRow | undefined {
  return db.select().from(s.addresses).where(and(eq(s.addresses.ownerType, "retailer"), eq(s.addresses.ownerId, id))).orderBy(sql`${s.addresses.isDefault} DESC`).get();
}

const oneLine = (a: AddressRow | undefined): string => (a ? [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(" "), a.country].filter((p) => p && String(p).trim()).join(", ") : "");

function docsOf(customFields: Readonly<Record<string, unknown>> | null | undefined): RetailerDocument[] {
  const raw = customFields?.[DOCS_KEY];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RetailerDocument[]).filter((d) => d && typeof d.fileId === "string") : [];
  } catch {
    return [];
  }
}

function visibleCustomFields(customFields: Readonly<Record<string, unknown>> | null | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(customFields ?? {}).filter(([k]) => !k.startsWith("_")));
}

function toRow(db: AppDb, r: typeof t.$inferSelect & { orderCount: number }, address?: AddressRow): RetailerRow {
  const a = address ?? addressOf(db, r.id);
  return {
    id: r.id, name: r.name, description: r.description, businessName: r.businessName, logoFileId: r.logoFileId, isActive: Boolean(r.isActive), createCaseLabels: Boolean(r.createCaseLabels),
    caseLabelPrintQty: r.caseLabelPrintQty, lpLabelPrintQty: r.lpLabelPrintQty, country: a?.country ?? null, address: oneLine(a), orderCount: Number(r.orderCount ?? 0),
    documentCount: docsOf(r.customFields).length, createdAt: r.createdAt, version: r.version,
  };
}

export function listRetailers(db: AppDb, _auth: AuthContext, query: GridQuery): { rows: RetailerRow[]; total: number } {
  const grid = compileGrid(BINDING, query);
  const result = paginate(db.select({ r: t, orderCount: orderCountSql }).from(t).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(t).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  const rows = (result.rows as { r: typeof t.$inferSelect; orderCount: number }[]).map((x) => toRow(db, { ...x.r, orderCount: x.orderCount }));
  return { rows, total: result.total };
}

export function loadRetailer(db: AppDb, id: string): typeof t.$inferSelect {
  const row = db.select().from(t).where(eq(t.id, id)).get();
  if (!row) throw notFoundError("Retailer");
  return row;
}

export interface RetailerDetail extends RetailerRow {
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly documents: readonly RetailerDocument[];
  readonly customFields: Readonly<Record<string, unknown>>;
}

export function getRetailer(db: AppDb, id: string): RetailerDetail {
  const row = loadRetailer(db, id);
  const a = addressOf(db, id);
  const orderCount = Number(db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE retailer_id = ${id}`)?.n ?? 0);
  return {
    ...toRow(db, { ...row, orderCount }, a), line1: a?.line1 || null, line2: a?.line2 ?? null, city: a?.city || null, state: a?.state ?? null,
    postalCode: a?.postalCode || null, countryCode: countryCode(a?.country), email: a?.email ?? null, phone: a?.phone ?? null, documents: docsOf(row.customFields),
    customFields: visibleCustomFields(row.customFields),
  };
}

function assertNameFree(db: AppDb, name: string, exceptId?: string): void {
  const clash = db.select({ id: t.id }).from(t).where(sql`lower(${t.name}) = lower(${name})`).get();
  if (clash && clash.id !== exceptId) throw new AppError("DUPLICATE", `A retailer named ${name} already exists`, { fieldErrors: { name: ["A retailer with this name already exists"] } });
}

function documentsFor(db: AppDb, ids: readonly string[]): RetailerDocument[] {
  if (ids.length === 0) return [];
  const rows = db.all<{ id: string; name: string; size: number; mime: string }>(sql`SELECT id, name, size, mime FROM files WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => ({ fileId: r.id, name: r.name, size: r.size, mime: r.mime }));
}

function cols(db: AppDb, input: RetailerSave) {
  const docs = documentsFor(db, input.documentFileIds);
  return {
    name: input.name.trim(), description: input.description, businessName: input.businessName, logoFileId: input.logoFileId ?? null, isActive: input.isActive,
    createCaseLabels: input.createCaseLabels, caseLabelPrintQty: input.caseLabelPrintQty, lpLabelPrintQty: input.lpLabelPrintQty,
    customFields: { ...input.customFields, ...(docs.length ? { [DOCS_KEY]: JSON.stringify(docs) } : {}) } as CustomFieldValues,
  };
}

function writeAddress(tx: AppDb, id: string, userId: string | null, input: RetailerSave): void {
  deleteAddresses(tx, "retailer", id);
  // Country is required on the form, so a retailer always keeps at least its country (grid column, filters).
  if (!input.line1 && !input.city && !input.postalCode && !input.country) return;
  tx.insert(s.addresses).values({
    ownerType: "retailer", ownerId: id, name: "Main", usageType: "Shipping", companyName: input.businessName, line1: input.line1 ?? "", line2: input.line2,
    city: input.city ?? "", state: input.state || null, postalCode: (input.postalCode ?? "").toUpperCase(), country: countryName(input.country) || input.country,
    phone: input.phone, email: input.email, isDefault: true, isActive: true, createdBy: userId, updatedBy: userId,
  }).run();
}

function snapshot(db: AppDb, row: typeof t.$inferSelect): Record<string, unknown> {
  const a = addressOf(db, row.id);
  return {
    name: row.name, description: row.description ?? "", businessName: row.businessName ?? "", isActive: row.isActive, logo: row.logoFileId ? "Uploaded" : "None",
    address: oneLine(a), email: a?.email ?? "", phone: a?.phone ?? "", createCaseLabels: row.createCaseLabels, caseLabelPrintQty: row.caseLabelPrintQty,
    lpLabelPrintQty: row.lpLabelPrintQty, documents: docsOf(row.customFields).map((d) => d.name).join(", "),
    ...Object.fromEntries(Object.entries(visibleCustomFields(row.customFields)).map(([k, v]) => [`Custom field ${k}`, v ?? ""])),
  };
}

function assertAdmin(auth: AuthContext): void {
  if (auth.scope.clientIds !== "all") throw new AppError("FORBIDDEN", "Retailers are company-wide; only users with access to all clients can change them");
}

export function createRetailer(tx: AppDb, auth: AuthContext, actor: Actor, input: RetailerSave): { id: string; name: string } {
  assertAdmin(auth);
  assertNameFree(tx, input.name.trim());
  const row = tx.insert(t).values({ ...cols(tx, input), createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: t.id, name: t.name }).get();
  writeAddress(tx, row.id, actor.userId, input);
  logCreate(tx, domainCtxOf(actor, auth), RETAILER_ENTITY, row.id, row.name);
  return row;
}

export function updateRetailer(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: RetailerSave): { id: string; name: string; version: number } {
  assertAdmin(auth);
  const before = loadRetailer(tx, id);
  assertVersion(before.version, input.version);
  assertNameFree(tx, input.name.trim(), id);
  const old = snapshot(tx, before);
  const after = tx.update(t).set({ ...cols(tx, input), updatedBy: actor.userId, version: sql`${t.version} + 1` }).where(eq(t.id, id)).returning().get();
  writeAddress(tx, id, actor.userId, input);
  logUpdate(tx, domainCtxOf(actor, auth), RETAILER_ENTITY, id, after.name, old, snapshot(tx, after));
  return { id, name: after.name, version: after.version };
}

export function retailerDeleteBlocker(db: AppDb, id: string): string | null {
  const n = Number(db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE retailer_id = ${id}`)?.n ?? 0);
  return n > 0 ? `is used by ${n} shipment ${n === 1 ? "order" : "orders"}` : null;
}

export function deleteRetailers(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  assertAdmin(auth);
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadRetailer(inner, id);
    const reason = retailerDeleteBlocker(inner, id);
    if (reason) throw new AppError("INVALID_STATE", `${row.name} ${reason}`);
    deleteAddresses(inner, "retailer", id);
    inner.delete(t).where(eq(t.id, id)).run();
    logDelete(inner, ctx, RETAILER_ENTITY, id, row.name);
  });
}
