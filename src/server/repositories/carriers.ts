/**
 * Carrier integrations repository (M12, spec 06 §7b + §17): setup list per provider, Add New
 * Connection (live credential check in Production), Edit (general · clients + markups · services ·
 * packages · advanced), guarded delete, and the Carrier Errors call-log grids + transaction detail.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { carrierSettingsSchema, type CarrierSettings } from "@/lib/domain-types";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import { CarrierError } from "@/server/domain/carriers/adapter";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { CARRIER_DEFS, providerCatalog } from "@/server/integrations/carriers";
import { credentialHints, decryptCredentials, encryptCredentials, mergeCredentials } from "@/server/integrations/crypto";
import { CALL_LOG_FIELDS, CALL_LOG_SORT_FIELDS, type CallStep, type EditCarrierSave } from "@/lib/grid-defs/integrations/carriers";
import type { CARRIER_CALL_STEPS } from "@/lib/enums";
import type { createCarrierSchema } from "@/lib/grid-defs/integrations/carriers";
import type { z } from "zod";
import {
  assertFound, assertVersion, assertWarehouseInScope, compileGrid, domainCtxOf, fieldError, labelsOf, listScope, logCreate, logDelete, logUpdate,
  type Actor, type GridBinding,
} from "./integration-logs-kit";

const t = s.carrierConnections;
const ENTITY = "carrier_connection";
type Row = typeof t.$inferSelect;

export interface CarrierConnectionRow {
  readonly id: string;
  readonly provider: string;
  readonly setupName: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly environment: Row["environment"];
  readonly isActive: boolean;
  readonly connectionLabel: string;
  readonly serviceCount: number;
  readonly activeServices: number;
  readonly allClients: boolean;
  readonly clientCount: number;
  readonly hasCredentials: boolean;
  readonly errors24h: number;
  readonly version: number;
}

export interface CarrierConnectionDetail extends CarrierConnectionRow {
  readonly payorAccountNumber: string | null;
  readonly credentialHints: Readonly<Record<string, string>>;
  readonly credentialFields: readonly { key: string; label: string; secret: boolean }[];
  readonly allServices: boolean;
  readonly allPackages: boolean;
  readonly settings: CarrierSettings;
  readonly clients: readonly { clientId: string; code: string; name: string; hasAccess: boolean; markupType: "Percentage" | "Fixed Price" | null; markupAmount: number | null }[];
  readonly services: readonly { id: string; carrierCode: string; serviceCode: string; name: string; isActive: boolean; transitDays: number; isInternational: boolean; presetCount: number }[];
  readonly packages: readonly { id: string; code: string; name: string; isActive: boolean }[];
  readonly thirdParty: readonly { id: string; accountNumber: string; billingCountry: string; billingZip: string }[];
  readonly openOrders: number;
}

const providerName = (p: string) => (p === "kitstaks-sandbox" ? "KitStak Sandbox" : p === "usps-stamps" ? "Stamps.com" : p === "shipstation" ? "ShipStation" : p.toUpperCase());

/** "Main UPS - UPS"; just the setup name when it already is the carrier name ("KitStak Sandbox", not "KitStak Sandbox - KitStak Sandbox"). */
export function connectionLabelOf(setupName: string, provider: string): string {
  const carrier = providerName(provider);
  const name = setupName.trim();
  return !name ? carrier : name.toLowerCase().includes(carrier.toLowerCase()) ? name : `${name} - ${carrier}`;
}

function enrich(db: AppDb, rows: readonly Row[]): CarrierConnectionRow[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const wh = labelsOf(db, "warehouses", rows.map((r) => r.warehouseId));
  const svc = db.select({ cid: s.carrierServices.connectionId, n: sql<number>`COUNT(*)`, a: sql<number>`SUM(CASE WHEN ${s.carrierServices.isActive} = 1 THEN 1 ELSE 0 END)` }).from(s.carrierServices).where(inArray(s.carrierServices.connectionId, ids)).groupBy(s.carrierServices.connectionId).all();
  const cl = db.select({ cid: s.carrierConnectionClients.connectionId, n: sql<number>`SUM(CASE WHEN ${s.carrierConnectionClients.hasAccess} = 1 THEN 1 ELSE 0 END)` }).from(s.carrierConnectionClients).where(inArray(s.carrierConnectionClients.connectionId, ids)).groupBy(s.carrierConnectionClients.connectionId).all();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const err = db.select({ cid: s.carrierCallLogs.connectionId, n: sql<number>`COUNT(*)` }).from(s.carrierCallLogs).where(and(inArray(s.carrierCallLogs.connectionId, ids), eq(s.carrierCallLogs.status, "Error"), sql`${s.carrierCallLogs.at} >= ${since}`)).groupBy(s.carrierCallLogs.connectionId).all();
  return rows.map((r) => ({
    id: r.id, provider: r.provider, setupName: r.setupName, warehouseId: r.warehouseId, warehouseCode: wh.get(r.warehouseId) ?? "", environment: r.environment, isActive: r.isActive,
    connectionLabel: connectionLabelOf(r.setupName, r.provider), serviceCount: Number(svc.find((x) => x.cid === r.id)?.n ?? 0), activeServices: Number(svc.find((x) => x.cid === r.id)?.a ?? 0),
    allClients: r.allClients, clientCount: Number(cl.find((x) => x.cid === r.id)?.n ?? 0), hasCredentials: Boolean(r.credentialsEnc) || r.provider === "kitstaks-sandbox",
    errors24h: Number(err.find((x) => x.cid === r.id)?.n ?? 0), version: r.version,
  }));
}

export function listCarrierConnections(db: AppDb, auth: AuthContext, provider: string | null): CarrierConnectionRow[] {
  const rows = db.select().from(t).where(and(provider ? eq(t.provider, provider) : undefined, listScope(t, auth, { warehouseId: t.warehouseId }))).orderBy(asc(t.setupName)).all();
  return enrich(db, rows);
}

export function loadCarrierConnection(db: AppDb, auth: AuthContext, id: string): Row {
  const row = assertFound(db.select().from(t).where(eq(t.id, id)).get(), "Carrier connection");
  assertWarehouseInScope(auth, row.warehouseId, "Carrier connection");
  return row;
}

/**
 * Adds catalog services / packages a connection is missing (the carrier catalog grew after it was
 * created, e.g. the full 21-service UPS list). Idempotent. New rows start active when the setup
 * uses "All services" / "All packages", otherwise inactive so a curated list stays curated.
 */
export function syncCarrierCatalog(db: AppDb, row: Pick<typeof t.$inferSelect, "id" | "provider" | "allServices" | "allPackages">): number {
  const catalog = providerCatalog(row.provider);
  if (catalog.services.length === 0 && catalog.packages.length === 0) return 0;
  const haveSvc = new Set(db.select({ c: s.carrierServices.serviceCode, k: s.carrierServices.carrierCode }).from(s.carrierServices).where(eq(s.carrierServices.connectionId, row.id)).all().map((x) => `${x.k}|${x.c}`));
  const havePkg = new Set(db.select({ c: s.carrierPackages.code }).from(s.carrierPackages).where(eq(s.carrierPackages.connectionId, row.id)).all().map((x) => x.c));
  const svc = catalog.services.filter((x) => !haveSvc.has(`${x.carrierCode}|${x.code}`));
  const pkg = catalog.packages.filter((p) => !havePkg.has(p.code));
  if (svc.length === 0 && pkg.length === 0) return 0;
  db.transaction((tx) => {
    if (svc.length > 0) tx.insert(s.carrierServices).values(svc.map((x) => ({ connectionId: row.id, carrierCode: x.carrierCode, serviceCode: x.code, name: x.name, transitDays: x.transitDays, isInternational: x.international, isActive: row.allServices }))).run();
    if (pkg.length > 0) tx.insert(s.carrierPackages).values(pkg.map((p) => ({ connectionId: row.id, code: p.code, name: p.name, isActive: row.allPackages }))).run();
  });
  return svc.length + pkg.length;
}

/** Syncs every connection's catalog rows (cheap; used before listing services for rate shopping). */
export function syncAllCarrierCatalogs(db: AppDb): number {
  return db.select({ id: t.id, provider: t.provider, allServices: t.allServices, allPackages: t.allPackages }).from(t).all().reduce((n, r) => n + syncCarrierCatalog(db, r), 0);
}

export function getCarrierConnection(db: AppDb, auth: AuthContext, id: string): CarrierConnectionDetail {
  const r = loadCarrierConnection(db, auth, id);
  syncCarrierCatalog(db, r);
  const base = enrich(db, [r])[0] as CarrierConnectionRow;
  const access = db.select().from(s.carrierConnectionClients).where(eq(s.carrierConnectionClients.connectionId, id)).all();
  const clientList = db.select({ id: s.clients.id, code: s.clients.code, name: s.clients.name }).from(s.clients).where(eq(s.clients.status, "Active")).orderBy(asc(s.clients.name)).all()
    .filter((c) => auth.scope.clientIds === "all" || auth.scope.clientIds.includes(c.id));
  const presetUse = db.all<{ id: string; n: number }>(sql`SELECT x.carrier_service_id AS id, COUNT(*) AS n FROM rate_shopping_preset_services x JOIN carrier_services cs ON cs.id = x.carrier_service_id WHERE cs.connection_id = ${id} GROUP BY x.carrier_service_id`);
  const catalog = providerCatalog(r.provider);
  return {
    ...base, payorAccountNumber: r.payorAccountNumber, credentialHints: credentialHints(decryptCredentials(r.credentialsEnc)), credentialFields: catalog.credentialFields,
    allServices: r.allServices, allPackages: r.allPackages, settings: carrierSettingsSchema.parse(r.settings ?? {}),
    clients: clientList.map((c) => {
      const a = access.find((x) => x.clientId === c.id);
      return { clientId: c.id, code: c.code, name: c.name, hasAccess: a?.hasAccess ?? false, markupType: a?.markupType ?? null, markupAmount: a?.markupAmount ?? null };
    }),
    services: db.select().from(s.carrierServices).where(eq(s.carrierServices.connectionId, id)).orderBy(asc(s.carrierServices.isInternational), asc(s.carrierServices.transitDays), asc(s.carrierServices.name)).all()
      .map((x) => ({ id: x.id, carrierCode: x.carrierCode, serviceCode: x.serviceCode, name: x.name, isActive: x.isActive, transitDays: x.transitDays, isInternational: x.isInternational, presetCount: Number(presetUse.find((p) => p.id === x.id)?.n ?? 0) })),
    packages: db.select().from(s.carrierPackages).where(eq(s.carrierPackages.connectionId, id)).orderBy(asc(s.carrierPackages.name)).all().map((x) => ({ id: x.id, code: x.code, name: x.name, isActive: x.isActive })),
    thirdParty: db.select().from(s.carrierThirdPartyAccounts).where(eq(s.carrierThirdPartyAccounts.connectionId, id)).all().map((x) => ({ id: x.id, accountNumber: x.accountNumber, billingCountry: x.billingCountry, billingZip: x.billingZip })),
    openOrders: Number(db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE carrier_connection_id = ${id} AND deleted_at IS NULL AND status NOT IN ('Shipped','Partially Shipped','Delivered','Cancelled')`)?.n ?? 0),
  };
}

/* ---------------- create ---------------- */

async function liveCheck(provider: string, environment: "Test" | "Production", creds: Readonly<Record<string, string>>, field: string): Promise<void> {
  const def = CARRIER_DEFS[provider];
  if (!def || environment !== "Production") return;
  try {
    await def.live.validate(creds, environment);
  } catch (error) {
    const code = error instanceof CarrierError ? error.httpCode : 500;
    throw fieldError(field, code === 401 || code === 403 ? `${def.carrierCode} rejected these credentials. Check the key and secret for the Production account.` : `Couldn't validate with ${def.carrierCode}: ${error instanceof Error ? error.message : "network error"}`);
  }
}

export async function createCarrierConnection(db: AppDb, auth: AuthContext, actor: Actor, body: z.output<typeof createCarrierSchema>): Promise<CarrierConnectionDetail> {
  assertWarehouseInScope(auth, body.warehouseId);
  const catalog = providerCatalog(body.provider);
  if (!catalog.live) throw fieldError("provider", "This carrier has no API adapter yet; use the KitStak Sandbox or another carrier");
  for (const f of catalog.credentialFields) if (!body.credentials[f.key]) throw fieldError(`credentials.${f.key}`, `${f.label} is required`);
  if (body.provider !== "kitstaks-sandbox" && !body.payorAccountNumber && (body.provider === "ups" || body.provider === "fedex")) throw fieldError("payorAccountNumber", "Payor account number is required");
  const dup = db.select({ id: t.id }).from(t).where(and(eq(t.warehouseId, body.warehouseId), sql`lower(${t.setupName}) = lower(${body.setupName})`)).get();
  if (dup) throw fieldError("setupName", `A carrier setup named "${body.setupName}" already exists in this warehouse`);
  const firstKey = catalog.credentialFields[0]?.key;
  await liveCheck(body.provider, body.environment, body.credentials, firstKey ? `credentials.${firstKey}` : "setupName");
  return db.transaction((tx) => {
    const row = tx.insert(t).values({
      provider: body.provider, setupName: body.setupName, accountPrefix: body.setupName.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "CARR",
      warehouseId: body.warehouseId, environment: body.environment, credentialsEnc: catalog.credentialFields.length > 0 ? encryptCredentials(body.credentials) : null,
      payorAccountNumber: body.payorAccountNumber, isActive: true, allClients: true, allServices: true, allPackages: true, settings: {}, createdBy: actor.userId, updatedBy: actor.userId,
    }).returning().get();
    if (catalog.services.length > 0) tx.insert(s.carrierServices).values(catalog.services.map((x) => ({ connectionId: row.id, carrierCode: x.carrierCode, serviceCode: x.code, name: x.name, transitDays: x.transitDays, isInternational: x.international, isActive: true }))).run();
    if (catalog.packages.length > 0) tx.insert(s.carrierPackages).values(catalog.packages.map((p) => ({ connectionId: row.id, code: p.code, name: p.name, isActive: true }))).run();
    logCreate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: row.id, entityCode: row.setupName });
    return getCarrierConnection(tx, auth, row.id);
  });
}

/* ---------------- update ---------------- */

function snapshot(db: AppDb, d: CarrierConnectionDetail) {
  const st = d.settings;
  return {
    setupName: d.setupName, active: d.isActive, environment: d.environment, payorAccountNumber: d.payorAccountNumber,
    clientAccess: d.allClients ? "All clients" : d.clients.filter((c) => c.hasAccess).map((c) => `${c.code}${c.markupType ? ` (${c.markupType === "Percentage" ? `${c.markupAmount}%` : `$${c.markupAmount}`})` : ""}`).join(", ") || "None",
    services: d.allServices ? "All services" : d.services.filter((x) => x.isActive).map((x) => x.name).join(", ") || "None",
    packages: d.allPackages ? "All packages" : d.packages.filter((x) => x.isActive).map((x) => x.name).join(", ") || "None",
    thirdPartyAccounts: d.thirdParty.map((x) => x.accountNumber).join(", ") || "None",
    shipFrom: st.shipFrom.useRetailerAddress ? "Retailer address" : st.shipFrom.address ? `${st.shipFrom.address.line1}, ${st.shipFrom.address.city} · ${st.shipFrom.address.phone ?? "no phone"}` : "Warehouse address",
    generalMarkup: st.generalMarkup ? `${st.generalMarkup.type} ${st.generalMarkup.amount}` : "None",
    labelFormat: st.label.format, labelSize: st.label.size, labelMessages: st.label.messages.join(" | ") || "None",
    taxType: st.international.taxType, taxId: st.international.taxId, componentsOnCommercialInvoice: st.international.useComponentsOnCommercialInvoice,
    returnLabelWithShipping: st.returnLabel.generateWithShippingLabel,
  };
}

export async function updateCarrierConnection(db: AppDb, auth: AuthContext, actor: Actor, id: string, body: EditCarrierSave): Promise<CarrierConnectionDetail> {
  const before = loadCarrierConnection(db, auth, id);
  assertVersion(before.version, body.version);
  const rotating = Object.values(body.credentials).some((v) => typeof v === "string" && v.length > 0);
  const merged = mergeCredentials(decryptCredentials(before.credentialsEnc), body.credentials);
  if (rotating || (body.environment === "Production" && before.environment !== "Production")) {
    const fields = providerCatalog(before.provider).credentialFields;
    if (body.environment === "Production") for (const f of fields) if (!merged[f.key]) throw fieldError(`credentials.${f.key}`, `${f.label} is required for Production`);
    await liveCheck(before.provider, body.environment, merged, fields[0] ? `credentials.${fields[0].key}` : "setupName");
  }
  const prior = getCarrierConnection(db, auth, id);
  return db.transaction((tx) => {
    tx.update(t).set({
      setupName: body.setupName, isActive: body.isActive, environment: body.environment, payorAccountNumber: body.payorAccountNumber,
      credentialsEnc: rotating ? encryptCredentials(merged) : before.credentialsEnc, allClients: body.allClients, allServices: body.allServices, allPackages: body.allPackages,
      settings: body.settings, updatedBy: actor.userId, version: sql`${t.version} + 1`,
    }).where(eq(t.id, id)).run();
    tx.delete(s.carrierConnectionClients).where(eq(s.carrierConnectionClients.connectionId, id)).run();
    const clients = body.clients.filter((c) => c.hasAccess || c.markupType);
    if (clients.length > 0) tx.insert(s.carrierConnectionClients).values(clients.map((c) => ({ connectionId: id, ...c }))).run();
    for (const svc of body.services) tx.update(s.carrierServices).set({ isActive: body.allServices ? true : svc.isActive }).where(and(eq(s.carrierServices.id, svc.id), eq(s.carrierServices.connectionId, id))).run();
    for (const p of body.packages) tx.update(s.carrierPackages).set({ isActive: body.allPackages ? true : p.isActive }).where(and(eq(s.carrierPackages.id, p.id), eq(s.carrierPackages.connectionId, id))).run();
    tx.delete(s.carrierThirdPartyAccounts).where(eq(s.carrierThirdPartyAccounts.connectionId, id)).run();
    if (body.thirdParty.length > 0) tx.insert(s.carrierThirdPartyAccounts).values(body.thirdParty.map((a) => ({ connectionId: id, accountNumber: a.accountNumber, billingCountry: a.billingCountry, billingZip: a.billingZip }))).run();
    const after = getCarrierConnection(tx, auth, id);
    const ctx = domainCtxOf(actor, auth);
    logUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: body.setupName }, snapshot(tx, prior), snapshot(tx, after));
    if (rotating) logUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: body.setupName }, { credentials: "Previous credentials" }, { credentials: "Rotated" });
    return after;
  });
}

export function deleteCarrierConnections(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadCarrierConnection(inner, auth, id);
    if (row.provider === "kitstaks-sandbox") throw new AppError("INVALID_STATE", "The KitStak Sandbox carrier is always available; set it inactive instead");
    const open = Number(inner.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE carrier_connection_id = ${id} AND deleted_at IS NULL AND status NOT IN ('Shipped','Partially Shipped','Delivered','Cancelled')`)?.n ?? 0);
    if (open > 0) throw new AppError("INVALID_STATE", `${row.setupName} is set on ${open} open order${open === 1 ? "" : "s"}`);
    const labels = Number(inner.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipments WHERE carrier_connection_id = ${id}`)?.n ?? 0);
    if (labels > 0) throw new AppError("INVALID_STATE", `${row.setupName} has ${labels} label${labels === 1 ? "" : "s"} in shipment history; set it inactive instead`);
    inner.delete(s.rateShoppingPresetServices).where(sql`${s.rateShoppingPresetServices.carrierServiceId} IN (SELECT id FROM carrier_services WHERE connection_id = ${id})`).run();
    inner.delete(t).where(eq(t.id, id)).run();
    logDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: row.setupName });
  });
}

export function carrierOptions(db: AppDb, auth: AuthContext) {
  return db.select({ id: t.id, setupName: t.setupName, provider: t.provider }).from(t).where(listScope(t, auth, { warehouseId: t.warehouseId })).orderBy(asc(t.setupName)).all();
}

/* ---------------- call logs (Carrier Errors) ---------------- */

const lg = s.carrierCallLogs;
const orderCodeSql = sql<string | null>`(SELECT o.code FROM shipment_orders o WHERE o.id = ${lg.orderId})`;
const CALL_BINDING: GridBinding = {
  exprs: {
    connectionId: sql`${lg.connectionId}`, provider: sql`${t.provider}`, clientId: sql`${lg.clientId}`, at: sql`${lg.at}`,
    isInternational: sql`(${lg.destinationType} = 'International')`, isRateShopping: sql`(${lg.rateShoppingName} IS NOT NULL)`, isReturnLabel: sql`(${lg.labelType} = 'Return Label')`,
    orderCode: orderCodeSql, trackingNumber: sql`${lg.trackingNumber}`, warehouseId: sql`${lg.warehouseId}`, status: sql`${lg.status}`, httpCode: sql`${lg.httpCode}`,
    responseMs: sql`${lg.responseMs}`, serviceName: sql`${lg.serviceName}`, setupName: sql`${t.setupName}`, clientName: sql`(SELECT c.name FROM clients c WHERE c.id = ${lg.clientId})`,
    userEmail: sql`(SELECT u.email FROM users u WHERE u.id = ${lg.userId})`, source: sql`${lg.source}`, labelType: sql`${lg.labelType}`, rateShoppingName: sql`${lg.rateShoppingName}`,
    warehouseCode: sql`(SELECT w.code FROM warehouses w WHERE w.id = ${lg.warehouseId})`,
  },
  fields: CALL_LOG_FIELDS, sortable: CALL_LOG_SORT_FIELDS, search: ["orderCode", "trackingNumber"], defaultSort: [{ field: "at", dir: "desc" }], tiebreaker: lg.id,
};

export interface CallLogRow {
  readonly id: string;
  readonly at: string;
  /** Carrier Errors grids list the three CallStep tabs; shipping also logs Tracking and Pickup calls. */
  readonly step: (typeof CARRIER_CALL_STEPS)[number];
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly trackingNumber: string | null;
  readonly destinationType: string | null;
  readonly status: "Success" | "Error";
  readonly httpCode: number;
  readonly error: string | null;
  readonly responseMs: number;
  readonly provider: string;
  readonly serviceName: string | null;
  readonly connectionLabel: string;
  readonly setupName: string;
  readonly warehouseCode: string;
  readonly clientName: string | null;
  readonly userEmail: string | null;
  readonly source: string | null;
  readonly labelType: string | null;
  readonly rateShoppingName: string | null;
}

export function listCallLogs(db: AppDb, auth: AuthContext, step: CallStep, query: GridQuery): { rows: CallLogRow[]; total: number } {
  const statusFiltered = query.filters.some((f) => f.field === "status");
  const cl = auth.viewScope.clientIds;
  const grid = compileGrid(CALL_BINDING, query, [
    eq(lg.step, step), inArray(lg.warehouseId, auth.viewScope.warehouseIds.length > 0 ? [...auth.viewScope.warehouseIds] : ["-"]),
    cl === "all" ? undefined : sql`(${lg.clientId} IS NULL OR ${inArray(lg.clientId, cl.length > 0 ? [...cl] : ["-"])})`,
    statusFiltered ? undefined : eq(lg.status, "Error"),
  ]);
  const ex = CALL_BINDING.exprs;
  const result = paginate(
    db.select({ l: lg, provider: t.provider, setupName: t.setupName, orderCode: orderCodeSql, clientName: ex.clientName, userEmail: ex.userEmail, warehouseCode: ex.warehouseCode })
      .from(lg).innerJoin(t, eq(t.id, lg.connectionId)).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(lg).innerJoin(t, eq(t.id, lg.connectionId)).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return {
    rows: result.rows.map((x) => ({
      id: x.l.id, at: x.l.at, step: x.l.step as CallStep, orderId: x.l.orderId, orderCode: x.orderCode ?? null, trackingNumber: x.l.trackingNumber, destinationType: x.l.destinationType,
      status: x.l.status, httpCode: x.l.httpCode, error: x.l.error, responseMs: x.l.responseMs, provider: x.provider, serviceName: x.l.serviceName,
      connectionLabel: connectionLabelOf(String(x.setupName), String(x.provider)), setupName: x.setupName, warehouseCode: String(x.warehouseCode ?? ""), clientName: (x.clientName as string | null) ?? null,
      userEmail: (x.userEmail as string | null) ?? null, source: x.l.source, labelType: x.l.labelType, rateShoppingName: x.l.rateShoppingName,
    })),
    total: result.total,
  };
}

export interface CallLogDetail extends CallLogRow { readonly requestJson: string; readonly responseJson: string }

export function getCallLog(db: AppDb, auth: AuthContext, id: string): CallLogDetail {
  const row = assertFound(db.select().from(lg).where(eq(lg.id, id)).get(), "Carrier transaction");
  if (!hasWarehouse(auth.scope, row.warehouseId)) throw new AppError("NOT_FOUND", "Carrier transaction not found");
  const conn = db.select().from(t).where(eq(t.id, row.connectionId)).get();
  const code = row.orderId ? db.select({ code: s.shipmentOrders.code }).from(s.shipmentOrders).where(eq(s.shipmentOrders.id, row.orderId)).get()?.code ?? null : null;
  const user = row.userId ? db.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, row.userId)).get()?.email ?? null : null;
  const client = row.clientId ? db.select({ name: s.clients.name }).from(s.clients).where(eq(s.clients.id, row.clientId)).get()?.name ?? null : null;
  return {
    id: row.id, at: row.at, step: row.step as CallStep, orderId: row.orderId, orderCode: code, trackingNumber: row.trackingNumber, destinationType: row.destinationType, status: row.status,
    httpCode: row.httpCode, error: row.error, responseMs: row.responseMs, provider: conn?.provider ?? "", serviceName: row.serviceName,
    connectionLabel: conn ? connectionLabelOf(conn.setupName, conn.provider) : "", setupName: conn?.setupName ?? "", warehouseCode: labelsOf(db, "warehouses", [row.warehouseId]).get(row.warehouseId) ?? "",
    clientName: client, userEmail: user, source: row.source, labelType: row.labelType, rateShoppingName: row.rateShoppingName, requestJson: row.requestJson, responseJson: row.responseJson,
  };
}
