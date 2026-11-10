/**
 * Printouts & Labels repository (M14): type cards with correct counts, per-type template grid,
 * create / edit (5-step wizard incl. the designer layout and client access), duplicate, delete
 * (the default template is protected), the print-modal template list and the live preview.
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { fileStore } from "@/server/files";
import { PRINT_TYPES, getPrintType } from "@/server/print/catalog";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import {
  normalizeLayout, PRINTOUT_FIELDS, PRINTOUT_SEARCH_FIELDS, PRINTOUT_SORT_FIELDS, printoutOptionsSchema, templatesFor, typeTitle,
  type PrintoutLayout, type PrintoutSave, blockSummary } from "@/lib/grid-defs/admin/printouts";
import { getCompany, readCompanyLogo } from "./company";
import { customBindableFields, recordsForPreview, renderLayoutPdf, renderLayoutZpl } from "./printouts-render";
import { getBranding } from "./apps-branding";

/** Custom Branding on printouts: heading accent and logo on/off (identity when the app is inactive). */
function branded(db: AppDb, layout: PrintoutLayout): { layout: PrintoutLayout; showLogo: boolean; accent: string | null } {
  const b = getBranding(db);
  if (!b) return { layout, showLogo: true, accent: null };
  return { layout: b.printoutAccent ? { ...layout, accentColor: b.accentColor } : layout, showLogo: b.logoOnPrintouts, accent: b.printoutAccent ? b.accentColor : null };
}
import { assertFound, assertVersion, compileGrid, domainCtxOf, duplicateError, logCreate, logDelete, logUpdate, qc, type Actor, type GridBinding } from "./users-shared";

const p = s.printoutTemplates;
export const PRINTOUT_ENTITY = "printout_template";

const statusSql = sql<string>`CASE WHEN ${qc(p.isActive)} = 1 THEN 'Active' ELSE 'Passive' END`;
const createdByNameSql = sql<string | null>`(SELECT u.name FROM users u WHERE u.id = ${qc(p.createdBy)})`;
const clientCountSql = sql<number>`(SELECT COUNT(*) FROM printout_template_clients pc WHERE pc.template_id = ${qc(p.id)} AND pc.has_access = 1)`;

const SQLS: Readonly<Record<string, SQL>> = {
  name: sql`${qc(p.name)}`, description: sql`${qc(p.description)}`, typeKey: sql`${qc(p.typeKey)}`, status: statusSql, printMode: sql`${qc(p.printMode)}`,
  printerType: sql`${qc(p.printerType)}`, isDefault: sql`${qc(p.isDefault)}`, createdAt: sql`${qc(p.createdAt)}`, updatedAt: sql`${qc(p.updatedAt)}`, createdByName: createdByNameSql,
};

const BINDING: GridBinding = {
  exprs: SQLS, fields: PRINTOUT_FIELDS, sortable: PRINTOUT_SORT_FIELDS, search: PRINTOUT_SEARCH_FIELDS,
  defaultSort: [{ field: "isDefault", dir: "desc" }, { field: "name", dir: "asc" }], tiebreaker: p.id,
};

export interface PrintoutRow {
  readonly id: string;
  readonly typeKey: string;
  readonly typeName: string;
  readonly name: string;
  readonly description: string;
  readonly recordsPerPage: string;
  readonly printMode: string;
  readonly printerType: string;
  readonly status: "Active" | "Passive";
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly allClients: boolean;
  readonly clientCount: number;
  readonly baseTemplate: string;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly updatedAt: string;
  readonly version: number;
}

const COLUMNS = {
  id: p.id, typeKey: p.typeKey, name: p.name, description: p.description, recordsPerPage: p.recordsPerPage, printMode: p.printMode, printerType: p.printerType,
  isActive: p.isActive, isDefault: p.isDefault, allClients: p.allClients, baseTemplate: p.baseTemplate, createdAt: p.createdAt, updatedAt: p.updatedAt, version: p.version,
  status: statusSql, createdByName: createdByNameSql, clientCount: clientCountSql,
};

const toRow = (r: Record<string, unknown>): PrintoutRow => ({
  ...(r as unknown as PrintoutRow), typeName: typeTitle(String(r.typeKey)), isActive: Boolean(r.isActive), isDefault: Boolean(r.isDefault), allClients: Boolean(r.allClients),
});

/**
 * Every print type ships with a locked system default (Logiwa parity): it can be
 * duplicated and edited but not deleted/deactivated. Idempotent; runs on read so a new
 * tenant (or a DB seeded before defaults existed) always has something to print.
 */
export function ensureDefaultPrintouts(db: AppDb): number {
  const have = new Set(db.select({ k: p.typeKey }).from(p).where(eq(p.isDefault, true)).all().map((r) => r.k));
  const missing = PRINT_TYPES.filter((t) => !have.has(t.key));
  if (!missing.length) return 0;
  db.insert(p).values(missing.map((t) => ({
    typeKey: t.key, name: `${t.name} (Default)`, description: `System default ${t.name.toLowerCase()} template`,
    recordsPerPage: (t.category === "labels" ? "Single Record" : "Multiple Records") as (typeof p.$inferInsert)["recordsPerPage"],
    printMode: (t.printerType === "Label Printer" ? "Direct Print" : "PDF Preview") as (typeof p.$inferInsert)["printMode"],
    printerType: t.printerType, baseTemplate: t.renderer ?? t.key, layout: { ...normalizeLayout(t.key, null) },
    options: { useRetailerPackingList: false, groupBy: "none", labelCopies: 1 }, allClients: true, isActive: true, isDefault: true,
  }))).run();
  return missing.length;
}

export function printoutTypes(db: AppDb): { key: string; name: string; category: string; beta: boolean; printerType: string; count: number; implemented: boolean }[] {
  ensureDefaultPrintouts(db);
  const counts = new Map(db.select({ k: p.typeKey, n: sql<number>`count(*)` }).from(p).groupBy(p.typeKey).all().map((r) => [r.k, r.n]));
  return PRINT_TYPES.map((t) => ({ key: t.key, name: t.name, category: t.category, beta: Boolean(t.beta), printerType: t.printerType, count: counts.get(t.key) ?? 0, implemented: Boolean(t.renderer) }));
}

export function listPrintouts(db: AppDb, query: GridQuery, typeKey?: string): { rows: PrintoutRow[]; total: number } {
  ensureDefaultPrintouts(db);
  const grid = compileGrid(BINDING, query, [typeKey ? eq(p.typeKey, typeKey) : undefined]);
  const result = paginate(
    db.select(COLUMNS).from(p).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(p).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as Record<string, unknown>[]).map(toRow), total: result.total };
}

export interface PrintoutDetail extends PrintoutRow {
  readonly layout: PrintoutLayout;
  readonly options: { useRetailerPackingList: boolean; groupBy: "none" | "location" | "sku" | "zone"; labelCopies: number };
  readonly clientIds: readonly string[];
}

export function loadPrintout(db: AppDb, id: string): typeof p.$inferSelect {
  return assertFound(db.select().from(p).where(eq(p.id, id)).get(), "Printout");
}

export function getPrintout(db: AppDb, id: string): PrintoutDetail {
  const row = assertFound(db.select({ ...COLUMNS, layout: p.layout, options: p.options }).from(p).where(eq(p.id, id)).get(), "Printout");
  const clientIds = db.select({ id: s.printoutTemplateClients.clientId }).from(s.printoutTemplateClients).where(and(eq(s.printoutTemplateClients.templateId, id), eq(s.printoutTemplateClients.hasAccess, true))).all().map((r) => r.id);
  const opts = printoutOptionsSchema.safeParse(row.options ?? {});
  return { ...toRow(row as Record<string, unknown>), layout: normalizeLayout(row.typeKey, row.layout), options: opts.success ? opts.data : printoutOptionsSchema.parse({}), clientIds };
}

function assertNameFree(db: AppDb, typeKey: string, name: string, exceptId?: string): void {
  const clash = db.select({ id: p.id }).from(p).where(and(eq(p.typeKey, typeKey), sql`lower(${p.name}) = lower(${name.trim()})`)).get();
  if (clash && clash.id !== exceptId) throw duplicateError("name", `A ${typeTitle(typeKey)} printout named ${name.trim()} already exists`);
}

function writeClients(tx: AppDb, id: string, allClients: boolean, clientIds: readonly string[]): void {
  tx.delete(s.printoutTemplateClients).where(eq(s.printoutTemplateClients.templateId, id)).run();
  if (allClients) return;
  const unique = [...new Set(clientIds)];
  const valid = unique.length ? new Set(tx.select({ id: s.clients.id }).from(s.clients).where(inArray(s.clients.id, unique)).all().map((r) => r.id)) : new Set<string>();
  if (valid.size !== unique.length) throw new AppError("VALIDATION", "One of the selected clients no longer exists", { fieldErrors: { clientIds: ["Unknown client"] } });
  if (unique.length) tx.insert(s.printoutTemplateClients).values(unique.map((clientId) => ({ templateId: id, clientId, hasAccess: true }))).run();
}

function snapshot(db: AppDb, id: string): Record<string, unknown> {
  const d = getPrintout(db, id);
  const names = d.clientIds.length ? db.select({ name: s.clients.name }).from(s.clients).where(inArray(s.clients.id, [...d.clientIds])).all().map((c) => c.name).sort().join(", ") : "";
  return {
    name: d.name, description: d.description, recordsPerPage: d.recordsPerPage, printMode: d.printMode, printerType: d.printerType, status: d.status,
    template: templatesFor(d.typeKey).find((t) => t.key === d.baseTemplate)?.name ?? d.baseTemplate,
    paper: d.layout.paper, font: `${d.layout.font} ${d.layout.fontSize} pt`, logoPosition: d.layout.logoPosition, title: d.layout.title, footerText: d.layout.footerText,
    barcode: d.layout.barcodeType, printerLanguage: d.layout.family === "label" ? d.layout.labelLanguage : undefined,
    sections: d.layout.sections.filter((x) => x.enabled).map((x) => { const b = d.layout.blocks.find((blk) => `block:${blk.id}` === x.key); return b ? blockSummary(b) : x.key; }).join(" > "), columns: d.layout.columns.filter((x) => x.enabled).map((x) => x.key).join(", "),
    retailerPackingList: d.options.useRetailerPackingList, clientAccess: d.allClients ? "All clients" : names,
  };
}

const columnsOf = (input: PrintoutSave) => ({
  name: input.name.trim(), description: input.description.trim(), recordsPerPage: input.recordsPerPage, printMode: input.printMode, printerType: input.printerType,
  baseTemplate: input.baseTemplate, layout: { ...normalizeLayout(input.typeKey, input.layout) }, options: input.options, allClients: input.allClients, isActive: input.isActive,
});

export function createPrintout(tx: AppDb, auth: AuthContext, actor: Actor, input: PrintoutSave): { id: string; name: string } {
  assertNameFree(tx, input.typeKey, input.name);
  const row = tx.insert(p).values({ typeKey: input.typeKey, ...columnsOf(input), isDefault: false, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: p.id, name: p.name }).get();
  writeClients(tx, row.id, input.allClients, input.clientIds);
  logCreate(tx, domainCtxOf(actor, auth), { entityType: PRINTOUT_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

export function updatePrintout(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: PrintoutSave): { id: string; version: number } {
  const before = loadPrintout(tx, id);
  assertVersion(before.version, input.version);
  if (input.typeKey !== before.typeKey) throw new AppError("VALIDATION", "A printout can't change type", { fieldErrors: { typeKey: ["Type is fixed"] } });
  if (before.isDefault && !input.isActive) throw new AppError("VALIDATION", "The default template must stay active", { fieldErrors: { isActive: ["The default template must stay active"] } });
  if (before.isDefault && !input.allClients) throw new AppError("VALIDATION", "The default template is available to every client", { fieldErrors: { clientIds: ["The default template is available to every client"] } });
  assertNameFree(tx, before.typeKey, input.name, id);
  const prev = snapshot(tx, id);
  const after = tx.update(p).set({ ...columnsOf(input), updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${p.version} + 1` }).where(eq(p.id, id)).returning({ version: p.version, name: p.name }).get();
  writeClients(tx, id, input.allClients, input.clientIds);
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: PRINTOUT_ENTITY, entityId: id, entityCode: after.name }, prev, snapshot(tx, id));
  return { id, version: after.version };
}

export function duplicatePrintout(tx: AppDb, auth: AuthContext, actor: Actor, id: string): { id: string; name: string } {
  const src = loadPrintout(tx, id);
  let name = `${src.name.replace(/ \(Default\)$/, "")} (copy)`;
  for (let i = 2; tx.select({ id: p.id }).from(p).where(and(eq(p.typeKey, src.typeKey), sql`lower(${p.name}) = lower(${name})`)).get(); i += 1) name = `${src.name.replace(/ \(Default\)$/, "")} (copy ${i})`;
  const row = tx.insert(p).values({
    typeKey: src.typeKey, name, description: src.description, recordsPerPage: src.recordsPerPage, printMode: src.printMode, printerType: src.printerType,
    baseTemplate: src.baseTemplate, layout: src.layout ?? normalizeLayout(src.typeKey, null), options: src.options, allClients: src.allClients, isActive: true, isDefault: false,
    createdBy: actor.userId, updatedBy: actor.userId,
  }).returning({ id: p.id, name: p.name }).get();
  const clients = tx.select().from(s.printoutTemplateClients).where(eq(s.printoutTemplateClients.templateId, id)).all();
  if (clients.length) tx.insert(s.printoutTemplateClients).values(clients.map((c) => ({ templateId: row.id, clientId: c.clientId, hasAccess: c.hasAccess }))).run();
  logCreate(tx, domainCtxOf(actor, auth), { entityType: PRINTOUT_ENTITY, entityId: row.id, entityCode: row.name });
  return row;
}

export function deletePrintouts(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadPrintout(inner, id);
    if (row.isDefault) throw new AppError("INVALID_STATE", `${row.name} is the default template and can't be deleted`);
    inner.delete(p).where(eq(p.id, id)).run();
    logDelete(inner, ctx, { entityType: PRINTOUT_ENTITY, entityId: id, entityCode: row.name });
  });
}

/** Templates for the print modal: active ones of the given types the client may use. */
export function printTemplatesFor(db: AppDb, typeKeys: readonly string[], clientId: string | null) {
  if (typeKeys.length === 0) return [];
  const rows = db.select({ id: p.id, typeKey: p.typeKey, name: p.name, description: p.description, printerType: p.printerType, isDefault: p.isDefault, allClients: p.allClients })
    .from(p).where(and(inArray(p.typeKey, [...typeKeys]), eq(p.isActive, true))).orderBy(asc(p.typeKey), sql`${p.isDefault} DESC`, asc(p.name)).all();
  const access = rows.length ? db.select().from(s.printoutTemplateClients).where(and(inArray(s.printoutTemplateClients.templateId, rows.map((r) => r.id)), eq(s.printoutTemplateClients.hasAccess, true))).all() : [];
  return rows
    .map((r) => ({ ...r, isDefault: Boolean(r.isDefault), allClients: Boolean(r.allClients), clientIds: access.filter((a) => a.templateId === r.id).map((a) => a.clientId) }))
    .filter((r) => r.allClients || !clientId || r.clientIds.includes(clientId));
}

/** Bindable fields for the designer: built-in record fields plus active custom fields of the type's entity. */
export function printoutCustomFields(db: AppDb, typeKey: string) {
  const entity = typeKey === "product-label" ? "product" : typeKey === "location-label" ? "location" : "shipment_order";
  return customBindableFields(db, entity);
}

/** Records + branding for the designer's in-browser canvas preview (same data the PDF uses). */
export function previewRecords(db: AppDb, auth: AuthContext, typeKey: string, sampleIds: readonly string[]) {
  if (!getPrintType(typeKey)) throw notFoundError("Printout type");
  const company = getCompany(db);
  const b = getBranding(db);
  return { records: recordsForPreview(db, auth, typeKey, sampleIds), companyName: company.displayName, logoUrl: b && !b.logoOnPrintouts ? null : company.logoUrl, brandAccent: b?.printoutAccent ? b.accentColor : null };
}

/** ZPL II preview for label templates (raw text the printer receives). */
export function previewZpl(db: AppDb, auth: AuthContext, typeKey: string, layout: PrintoutLayout, sampleIds: readonly string[], copies = 1): string {
  if (!getPrintType(typeKey)) throw notFoundError("Printout type");
  const company = getCompany(db);
  return renderLayoutZpl(normalizeLayout(typeKey, layout), recordsForPreview(db, auth, typeKey, sampleIds), { companyName: company.displayName }, copies);
}

/** Live preview PDF for the designer (or a saved template). */
export async function previewPdf(db: AppDb, auth: AuthContext, typeKey: string, layout: PrintoutLayout, sampleIds: readonly string[]): Promise<Uint8Array> {
  if (!getPrintType(typeKey)) throw notFoundError("Printout type");
  const company = getCompany(db);
  const brand = branded(db, normalizeLayout(typeKey, layout));
  const logo = brand.showLogo ? readCompanyLogo(db, fileStore()) : null;
  return renderLayoutPdf(typeKey, brand.layout, recordsForPreview(db, auth, typeKey, sampleIds), {
    companyName: company.displayName, logo: logo ? { bytes: new Uint8Array(logo.bytes), mime: logo.mime } : null,
  });
}
