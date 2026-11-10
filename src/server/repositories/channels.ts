/**
 * Channel connections repository (M12, spec 06 §7–§7a): Integration Management catalog counts,
 * per-provider connection list, Connect Store (live credential validation, sandbox), Edit Store
 * Connection (general · warehouse mapping · advanced · configuration → the 4 channel methods),
 * guarded delete. Credentials are AES-GCM encrypted and only ever returned as last-4 hints.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { channelSettingsSchema, type ChannelSettings } from "@/lib/domain-types";
import { CHANNEL_METHODS } from "@/lib/enums";
import { CARRIERS, CHANNELS, monogramSvg, type IntegrationCatalogEntry } from "@/lib/channel-catalog";

const SANDBOX_CARRIER: IntegrationCatalogEntry = {
  key: "kitstaks-sandbox", name: "KitStaks Sandbox", kind: "carrier", availability: "available", brandColor: "#2E6BE6", monogram: "KS",
  logoPath: "/logos/carriers/kitstaks-sandbox.svg", logoSvg: monogramSvg("KS", "#2E6BE6"), description: "Built-in test carrier: realistic rates, labels and voids with no account needed.",
};
const CHANNEL_CATALOG = CHANNELS;
const CARRIER_CATALOG: readonly IntegrationCatalogEntry[] = [SANDBOX_CARRIER, ...CARRIERS];
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { describeError } from "@/server/domain/errors";
import type { BulkResult } from "@/server/domain/types";
import { runBulk } from "@/server/domain/bulk";
import { ChannelApiError, type ChannelLocation } from "@/server/integrations/channel-adapter";
import { credentialHints, decryptCredentials, encryptCredentials, mergeCredentials, type Credentials } from "@/server/integrations/crypto";
import { SANDBOX_LOCATIONS } from "@/server/integrations/sandbox";
import { DEFAULT_INTERVALS, LIVE_PROVIDERS, adapterFor, pauseReason } from "@/server/integrations/runtime/channel-runtime";
import { methodActiveFlags, type EditStoreSave } from "@/lib/grid-defs/integrations/channels";
import { connectStoreSchema } from "@/lib/grid-defs/integrations/channels";
import type { z } from "zod";
import { assertClientInScope, assertFound, assertVersion, domainCtxOf, fieldError, labelsOf, logCreate, logDelete, logUpdate, type Actor } from "./integration-logs-kit";

const c = s.channelConnections;
const ENTITY = "channel_connection";
type ConnRow = typeof c.$inferSelect;

/* ---------------- catalog ---------------- */

export interface CatalogCard {
  readonly key: string;
  readonly name: string;
  readonly kind: "channel" | "carrier";
  readonly availability: string;
  readonly brandColor: string;
  readonly monogram: string;
  readonly logoSvg: string;
  readonly description: string;
  readonly connected: number;
  readonly hasLiveApi: boolean;
}

const CARRIER_LIVE = new Set(["ups", "fedex", "easypost", "shippo", "kitstaks-sandbox"]);

export function integrationCatalog(db: AppDb, auth: AuthContext): CatalogCard[] {
  const clientScope = auth.viewScope.clientIds;
  const chCounts = db.select({ p: c.provider, n: sql<number>`COUNT(*)` }).from(c)
    .where(clientScope === "all" ? undefined : inArray(c.clientId, clientScope.length > 0 ? [...clientScope] : ["-"])).groupBy(c.provider).all();
  const cc = s.carrierConnections;
  const crCounts = db.select({ p: cc.provider, n: sql<number>`COUNT(*)` }).from(cc).where(inArray(cc.warehouseId, [...auth.viewScope.warehouseIds])).groupBy(cc.provider).all();
  const chMap = new Map(chCounts.map((x) => [x.p, Number(x.n)]));
  const crMap = new Map(crCounts.map((x) => [x.p, Number(x.n)]));
  const carrierKey = (k: string) => (k === "stamps-com" ? "usps-stamps" : k === "custom-carrier" ? "custom" : k);
  return [
    ...CHANNEL_CATALOG.map((e) => ({ key: e.key, name: e.name, kind: "channel" as const, availability: e.availability, brandColor: e.brandColor, monogram: e.monogram, logoSvg: e.logoSvg, description: e.description, connected: chMap.get(e.key) ?? 0, hasLiveApi: LIVE_PROVIDERS.has(e.key) })),
    ...CARRIER_CATALOG.map((e) => ({ key: e.key, name: e.name, kind: "carrier" as const, availability: e.availability, brandColor: e.brandColor, monogram: e.monogram, logoSvg: e.logoSvg, description: e.description, connected: crMap.get(carrierKey(e.key)) ?? 0, hasLiveApi: CARRIER_LIVE.has(carrierKey(e.key)) })),
  ];
}

export function catalogEntry(kind: "channel" | "carrier", key: string) {
  return (kind === "channel" ? CHANNEL_CATALOG : CARRIER_CATALOG).find((e) => e.key === key) ?? null;
}

/* ---------------- list / detail ---------------- */

export interface ChannelConnectionRow {
  readonly id: string;
  readonly provider: string;
  readonly storeName: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly distribution: ConnRow["distribution"];
  readonly isSandbox: boolean;
  readonly status: ConnRow["status"];
  readonly isActive: boolean;
  readonly warehouses: readonly string[];
  readonly activeMethods: number;
  readonly pauseReason: string | null;
  readonly lastOrderAt: string | null;
  readonly openMissing: number;
  readonly createdAt: string;
  readonly version: number;
}

export interface ChannelMethodInfo {
  readonly id: string;
  readonly method: string;
  readonly status: "Active" | "Passive";
  readonly intervalMinutes: number;
  readonly jobStatus: string;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastSuccessAt: string | null;
}

export interface ChannelConnectionDetail extends ChannelConnectionRow {
  readonly authMethod: ConnRow["authMethod"];
  readonly apiVersion: ConnRow["apiVersion"];
  readonly credentialHints: Readonly<Record<string, string>>;
  readonly settings: ChannelSettings;
  readonly mappings: readonly { readonly id: string; readonly channelLocationId: string; readonly channelLocationName: string; readonly warehouseId: string; readonly warehouseCode: string }[];
  readonly methods: readonly ChannelMethodInfo[];
  readonly counts: { readonly orders: number; readonly listings: number; readonly runs: number };
}

function scopeWhere(auth: AuthContext) {
  const cl = auth.viewScope.clientIds;
  return cl === "all" ? undefined : inArray(c.clientId, cl.length > 0 ? [...cl] : ["-"]);
}

function enrich(db: AppDb, rows: readonly ConnRow[]): ChannelConnectionRow[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const clients = labelsOf(db, "clients", rows.map((r) => r.clientId));
  const clientNames = new Map(db.select({ id: s.clients.id, name: s.clients.name }).from(s.clients).where(inArray(s.clients.id, rows.map((r) => r.clientId))).all().map((x) => [x.id, x.name]));
  const maps = db.select({ cid: s.channelLocationMappings.connectionId, code: s.warehouses.code }).from(s.channelLocationMappings)
    .innerJoin(s.warehouses, eq(s.warehouses.id, s.channelLocationMappings.warehouseId)).where(inArray(s.channelLocationMappings.connectionId, ids)).all();
  const active = db.select({ cid: s.channelMethods.connectionId, n: sql<number>`COUNT(*)` }).from(s.channelMethods).where(and(inArray(s.channelMethods.connectionId, ids), eq(s.channelMethods.status, "Active"))).groupBy(s.channelMethods.connectionId).all();
  const lastOrder = db.select({ cid: s.shipmentOrders.channelConnectionId, at: sql<string>`MAX(${s.shipmentOrders.orderDate})` }).from(s.shipmentOrders).where(inArray(s.shipmentOrders.channelConnectionId, ids)).groupBy(s.shipmentOrders.channelConnectionId).all();
  const missing = db.select({ cid: s.channelMissingOrders.connectionId, n: sql<number>`COUNT(*)` }).from(s.channelMissingOrders).where(and(inArray(s.channelMissingOrders.connectionId, ids), sql`${s.channelMissingOrders.status} <> 'Resolved'`)).groupBy(s.channelMissingOrders.connectionId).all();
  return rows.map((r) => ({
    id: r.id, provider: r.provider, storeName: r.storeName, clientId: r.clientId, clientName: clientNames.get(r.clientId) ?? clients.get(r.clientId) ?? "", distribution: r.distribution,
    isSandbox: r.distribution === "API", status: r.status, isActive: r.isActive,
    warehouses: [...new Set(maps.filter((m) => m.cid === r.id).map((m) => m.code))],
    activeMethods: Number(active.find((a) => a.cid === r.id)?.n ?? 0), pauseReason: pauseReason(r),
    lastOrderAt: lastOrder.find((x) => x.cid === r.id)?.at ?? null, openMissing: Number(missing.find((x) => x.cid === r.id)?.n ?? 0),
    createdAt: r.createdAt, version: r.version,
  }));
}

export function listChannelConnections(db: AppDb, auth: AuthContext, provider: string | null): ChannelConnectionRow[] {
  const rows = db.select().from(c).where(and(provider ? eq(c.provider, provider) : undefined, scopeWhere(auth))).orderBy(asc(c.storeName)).all();
  return enrich(db, rows);
}

export function loadChannelConnection(db: AppDb, auth: AuthContext, id: string): ConnRow {
  const row = assertFound(db.select().from(c).where(eq(c.id, id)).get(), "Store connection");
  if (!hasClient(auth.scope, row.clientId)) throw new AppError("NOT_FOUND", "Store connection not found");
  return row;
}

export function getChannelConnection(db: AppDb, auth: AuthContext, id: string): ChannelConnectionDetail {
  const r = loadChannelConnection(db, auth, id);
  const base = enrich(db, [r])[0] as ChannelConnectionRow;
  const mappings = db.select({ m: s.channelLocationMappings, code: s.warehouses.code }).from(s.channelLocationMappings)
    .innerJoin(s.warehouses, eq(s.warehouses.id, s.channelLocationMappings.warehouseId)).where(eq(s.channelLocationMappings.connectionId, id)).all();
  const order = (m: string) => CHANNEL_METHODS.indexOf(m as (typeof CHANNEL_METHODS)[number]);
  const methods = db.select().from(s.channelMethods).where(eq(s.channelMethods.connectionId, id)).all().sort((a, b) => order(a.method) - order(b.method));
  const n = (q: ReturnType<typeof sql>) => Number(db.get<{ n: number }>(q)?.n ?? 0);
  return {
    ...base, authMethod: r.authMethod, apiVersion: r.apiVersion, credentialHints: credentialHints(decryptCredentials(r.credentialsEnc)),
    settings: channelSettingsSchema.parse(r.settings ?? {}),
    mappings: mappings.map((x) => ({ id: x.m.id, channelLocationId: x.m.channelLocationId, channelLocationName: x.m.channelLocationName, warehouseId: x.m.warehouseId, warehouseCode: x.code })),
    methods: methods.map((m) => ({ id: m.id, method: m.method, status: m.status, intervalMinutes: m.intervalMinutes, jobStatus: m.jobStatus, nextRunAt: m.nextRunAt, lastRunAt: m.lastRunAt, lastSuccessAt: m.lastSuccessAt })),
    counts: {
      orders: n(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE channel_connection_id = ${id}`),
      listings: n(sql`SELECT COUNT(*) AS n FROM product_listings WHERE channel_connection_id = ${id}`),
      runs: n(sql`SELECT COUNT(*) AS n FROM channel_runs WHERE connection_id = ${id}`),
    },
  };
}

/* ---------------- connect ---------------- */

type ConnectBody = z.output<typeof connectStoreSchema>;

function credentialsOf(body: { authMethod?: string; accessToken?: string; apiClientId?: string; apiClientSecret?: string }): Credentials {
  if (body.authMethod === "Client ID & Secret") return { clientId: body.apiClientId ?? "", clientSecret: body.apiClientSecret ?? "" };
  return { accessToken: body.accessToken ?? "" };
}

/** Live validation, run OUTSIDE the DB transaction (network). Returns the store's locations. */
export async function validateConnection(db: AppDb, row: ConnRow, credentials: Credentials | null): Promise<readonly ChannelLocation[]> {
  const adapter = adapterFor(db, row);
  if (!adapter) throw fieldError("provider", "This channel has no live API adapter yet. Connect a KitStaks Sandbox store to try the flow.");
  try {
    const res = await adapter.validate({ connection: row, credentials, now: new Date() });
    return res.locations;
  } catch (error) {
    const status = error instanceof ChannelApiError ? error.status : 500;
    const message = status === 401 || status === 403 ? "The store rejected these credentials. Check the token (or client ID and secret) and the app's API scopes." : `Couldn't validate the store: ${describeError(error).message}`;
    throw fieldError(row.authMethod === "Client ID & Secret" ? "apiClientId" : "accessToken", message);
  }
}

export async function connectStore(db: AppDb, auth: AuthContext, actor: Actor, body: ConnectBody): Promise<ChannelConnectionDetail> {
  assertClientInScope(auth, body.clientId);
  if (!catalogEntry("channel", body.provider)) throw fieldError("provider", "Unknown channel");
  if (body.distribution === "Public App") {
    if (!process.env.SHOPIFY_CLIENT_ID || body.provider !== "shopify") throw fieldError("distribution", "The public app needs SHOPIFY_CLIENT_ID configured on the server; use a Custom App or a KitStaks Sandbox store");
  }
  const dup = db.select({ id: c.id }).from(c).where(and(eq(c.provider, body.provider), sql`lower(${c.storeName}) = lower(${body.storeName})`)).get();
  if (dup) throw fieldError("storeName", `A ${body.provider} store named "${body.storeName}" is already connected`, "VALIDATION");
  const sandbox = body.distribution === "API";
  const creds = sandbox ? null : credentialsOf(body);
  const draft: ConnRow = {
    id: "draft", provider: body.provider, storeName: body.storeName, clientId: body.clientId, distribution: body.distribution, authMethod: body.authMethod,
    credentialsEnc: creds ? encryptCredentials(creds) : null, apiVersion: body.apiVersion, status: "Pending", isActive: true, settings: {},
    createdAt: "", createdBy: null, updatedAt: "", updatedBy: null, version: 1,
  } as ConnRow;
  const locations = await validateConnection(db, draft, creds);
  const settings: ChannelSettings = channelSettingsSchema.parse({ paymentStatuses: ["paid"] });
  return db.transaction((tx) => {
    const row = tx.insert(c).values({
      provider: body.provider, storeName: body.storeName, clientId: body.clientId, distribution: body.distribution, authMethod: sandbox ? "Access Token" : body.authMethod,
      credentialsEnc: draft.credentialsEnc, apiVersion: body.apiVersion, status: "Completed", isActive: true, settings, createdBy: actor.userId, updatedBy: actor.userId,
    }).returning().get();
    tx.insert(s.channelMethods).values(CHANNEL_METHODS.map((method) => ({ connectionId: row.id, method, status: "Passive" as const, intervalMinutes: DEFAULT_INTERVALS[method], jobStatus: "Waiting For Next" as const }))).run();
    // A sandbox with a single in-scope warehouse is pre-mapped so it works out of the box.
    if (sandbox && auth.viewScope.warehouseIds.length === 1 && locations[0]) {
      tx.insert(s.channelLocationMappings).values({ connectionId: row.id, channelLocationId: locations[0].id, channelLocationName: locations[0].name, warehouseId: auth.viewScope.warehouseIds[0] as string }).run();
    }
    logCreate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: row.id, entityCode: row.storeName });
    return getChannelConnection(tx, auth, row.id);
  });
}

export async function storeLocations(db: AppDb, auth: AuthContext, id: string): Promise<readonly ChannelLocation[]> {
  const row = loadChannelConnection(db, auth, id);
  if (row.distribution === "API") return SANDBOX_LOCATIONS;
  const reason = pauseReason(row);
  if (reason) throw new AppError("INVALID_STATE", reason);
  return validateConnection(db, row, decryptCredentials(row.credentialsEnc));
}

/* ---------------- edit ---------------- */

function snapshot(db: AppDb, row: Pick<ConnRow, "storeName" | "isActive" | "apiVersion">, settings: ChannelSettings, mappings: readonly { channelLocationName: string; warehouseId: string }[], intervals: Readonly<Record<string, number>>) {
  const wh = labelsOf(db, "warehouses", mappings.map((m) => m.warehouseId));
  return {
    storeName: row.storeName, active: row.isActive, apiVersion: row.apiVersion,
    locationMapping: mappings.map((m) => `${m.channelLocationName} → ${wh.get(m.warehouseId) ?? m.warehouseId}`).sort().join(", ") || "None",
    paymentStatuses: settings.paymentStatuses.join(", ") || "None", taxIdMapping: settings.taxIdMapping,
    tagFilter: settings.tagFilter.tags.length > 0 ? `${settings.tagFilter.method} · ${settings.tagFilter.condition} · ${settings.tagFilter.tags.join(", ")}` : "None",
    downloadProducts: settings.products.download, productUom: settings.products.uom, downloadOrders: settings.orders.download, shipmentOrderType: settings.orders.shipmentOrderType,
    downloadOpenOrdersFrom: settings.orders.downloadFrom ?? "Let KitStaks decide", partialOrders: settings.orders.partialOrders,
    createNonexistentProducts: settings.orders.createNonexistentProducts, skipAddressVerification: settings.orders.skipAddressVerification,
    syncInventory: settings.inventory.sync, inventorySyncMethod: settings.inventory.method, sendShipmentInfo: settings.shipments.sendShipmentInfo,
    intervals: Object.entries(intervals).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v} min`).join(", "),
  };
}

export async function updateChannelConnection(db: AppDb, auth: AuthContext, actor: Actor, id: string, body: EditStoreSave): Promise<ChannelConnectionDetail> {
  const before = loadChannelConnection(db, auth, id);
  assertVersion(before.version, body.version);
  const rotating = Boolean(body.accessToken || body.apiClientId || body.apiClientSecret);
  let credentialsEnc = before.credentialsEnc;
  let authMethod = before.authMethod;
  if (rotating && before.distribution !== "API") {
    authMethod = body.authMethod ?? before.authMethod;
    const merged = mergeCredentials(authMethod === before.authMethod ? decryptCredentials(before.credentialsEnc) : null, authMethod === "Client ID & Secret" ? { clientId: body.apiClientId, clientSecret: body.apiClientSecret } : { accessToken: body.accessToken });
    await validateConnection(db, { ...before, authMethod, apiVersion: body.apiVersion }, merged);
    credentialsEnc = encryptCredentials(merged);
  }
  for (const m of body.mappings) if (!auth.scope.warehouseIds.includes(m.warehouseId)) throw fieldError("mappings", "Warehouse not found");
  return db.transaction((tx) => {
    const oldSettings = channelSettingsSchema.parse(before.settings ?? {});
    const oldMaps = tx.select().from(s.channelLocationMappings).where(eq(s.channelLocationMappings.connectionId, id)).all();
    const methods = tx.select().from(s.channelMethods).where(eq(s.channelMethods.connectionId, id)).all();
    const oldIntervals = Object.fromEntries(methods.map((m) => [m.method, m.intervalMinutes]));
    tx.update(c).set({
      storeName: body.storeName, isActive: body.isActive, apiVersion: body.apiVersion, authMethod, credentialsEnc, settings: body.settings,
      status: rotating ? "Completed" : before.status, updatedBy: actor.userId, version: sql`${c.version} + 1`,
    }).where(eq(c.id, id)).run();
    tx.delete(s.channelLocationMappings).where(eq(s.channelLocationMappings.connectionId, id)).run();
    if (body.mappings.length > 0) tx.insert(s.channelLocationMappings).values(body.mappings.map((m) => ({ connectionId: id, ...m }))).run();
    const flags = methodActiveFlags(body.settings);
    const now = new Date();
    const newIntervals: Record<string, number> = {};
    for (const method of CHANNEL_METHODS) {
      const existing = methods.find((m) => m.method === method);
      const interval = body.intervals[method] ?? existing?.intervalMinutes ?? DEFAULT_INTERVALS[method];
      newIntervals[method] = interval;
      const status = flags[method] && body.isActive ? "Active" : "Passive";
      if (existing) {
        const becameActive = existing.status !== "Active" && status === "Active";
        tx.update(s.channelMethods).set({ status, intervalMinutes: interval, ...(becameActive ? { nextRunAt: now.toISOString(), jobStatus: "Waiting For Next" as const } : {}) }).where(eq(s.channelMethods.id, existing.id)).run();
      } else {
        tx.insert(s.channelMethods).values({ connectionId: id, method, status, intervalMinutes: interval, jobStatus: "Waiting For Next", nextRunAt: status === "Active" ? now.toISOString() : null }).run();
      }
    }
    const ctx = domainCtxOf(actor, auth);
    logUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: body.storeName }, snapshot(tx, before, oldSettings, oldMaps, oldIntervals), snapshot(tx, body, body.settings, body.mappings, newIntervals));
    if (rotating) logUpdate(tx, ctx, { entityType: ENTITY, entityId: id, entityCode: body.storeName }, { credentials: "Previous credentials" }, { credentials: "Rotated (validated)" });
    return getChannelConnection(tx, auth, id);
  });
}

export function deleteChannelConnections(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadChannelConnection(inner, auth, id);
    const open = Number(inner.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE channel_connection_id = ${id} AND deleted_at IS NULL AND status NOT IN ('Shipped','Partially Shipped','Delivered','Cancelled')`)?.n ?? 0);
    if (open > 0) throw new AppError("INVALID_STATE", `${row.storeName} has ${open} open order${open === 1 ? "" : "s"}; set the connection inactive instead`);
    inner.delete(s.productChannelAllocations).where(eq(s.productChannelAllocations.channelConnectionId, id)).run();
    inner.delete(s.productListings).where(eq(s.productListings.channelConnectionId, id)).run();
    inner.delete(s.channelMissingOrders).where(eq(s.channelMissingOrders.connectionId, id)).run();
    inner.update(s.shipmentOrders).set({ channelConnectionId: null }).where(eq(s.shipmentOrders.channelConnectionId, id)).run();
    inner.delete(c).where(eq(c.id, id)).run();
    logDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: row.storeName });
  });
}

/** Setup-name options (Channel Setup Details dropdown, filters). */
export function connectionOptions(db: AppDb, auth: AuthContext): { id: string; storeName: string; provider: string; clientName: string }[] {
  return db.select({ id: c.id, storeName: c.storeName, provider: c.provider, clientName: s.clients.name }).from(c).innerJoin(s.clients, eq(s.clients.id, c.clientId))
    .where(scopeWhere(auth)).orderBy(asc(c.storeName)).all();
}

export const recentConnections = (db: AppDb) => db.select().from(c).orderBy(desc(c.createdAt)).limit(5).all();
