/**
 * Option lists for the order wizard and bulk modals, in one scoped call:
 * warehouses, clients, Data Setup lookups, carrier connections + services, rate
 * shopping presets, shipment packages, retailers and return addresses.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { asc, desc } from "@/server/db/order";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { hasClient, hasWarehouse } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { codeNameLabel } from "@/lib/utils";
import { filterSeq } from "@/server/db/sql";

export const orderOptionsQuerySchema = z.object({
  warehouseId: z.string().max(64).optional(),
  clientId: z.string().max(64).optional(),
});

export interface Option {
  readonly value: string;
  readonly label: string;
  readonly description?: string | null;
}

export interface CarrierOption {
  readonly connectionId: string;
  readonly label: string;
  readonly carrierCode: string;
  readonly services: readonly { readonly id: string; readonly name: string; readonly transitDays: number; readonly isInternational: boolean }[];
}

export interface OrderFormOptions {
  readonly warehouses: readonly Option[];
  readonly clients: readonly Option[];
  readonly orderTypes: readonly Option[];
  readonly cancelReasons: readonly Option[];
  readonly packingWarningTypes: readonly Option[];
  readonly damageReasons: readonly Option[];
  readonly carriers: readonly CarrierOption[];
  readonly carrierCodes: readonly Option[];
  readonly presets: readonly Option[];
  readonly shipmentPackages: readonly Option[];
  readonly retailers: readonly Option[];
  readonly returnAddresses: readonly Option[];
  readonly tags: readonly Option[];
}

async function lookups(db: AppDb, type: (typeof schema.lookupValues.$inferSelect)["type"], clientId?: string): Promise<Option[]> {
  const lv = schema.lookupValues;
  return await db.select({ value: lv.id, label: lv.name }).from(lv)
    .where(and(eq(lv.type, type), eq(lv.isActive, true), clientId ? or(isNull(lv.clientId), eq(lv.clientId, clientId)) : isNull(lv.clientId)))
    .orderBy(asc(lv.sortOrder), asc(lv.name));
}

export async function orderFormOptions(db: AppDb, scope: Scope, input: z.output<typeof orderOptionsQuerySchema>): Promise<OrderFormOptions> {
  const warehouseId = input.warehouseId && hasWarehouse(scope, input.warehouseId) ? input.warehouseId : undefined;
  const clientId = input.clientId && hasClient(scope, input.clientId) ? input.clientId : undefined;
  const wh = schema.warehouses;
  const warehouses = (await db.select().from(wh).where(and(eq(wh.isActive, true), scope.warehouseIds.length ? inArray(wh.id, [...scope.warehouseIds]) : eq(wh.id, "-"))).orderBy(asc(wh.code)))
    .map((w) => ({ value: w.id, label: codeNameLabel(w.code, w.name) }));
  const c = schema.clients;
  const clients = (await db.select().from(c).where(and(eq(c.status, "Active"), scope.clientIds === "all" ? undefined : inArray(c.id, [...scope.clientIds, "-"]))).orderBy(asc(c.name)))
    .map((x) => ({ value: x.id, label: x.name, description: x.code }));

  const cc = schema.carrierConnections;
  const conns = await filterSeq((await db.select().from(cc).where(and(eq(cc.isActive, true), warehouseId ? eq(cc.warehouseId, warehouseId) : inArray(cc.warehouseId, [...scope.warehouseIds, "-"])))), async (conn) => {
      if (conn.allClients || !clientId) return true;
      return Boolean((await db.select().from(schema.carrierConnectionClients).where(and(eq(schema.carrierConnectionClients.connectionId, conn.id), eq(schema.carrierConnectionClients.clientId, clientId), eq(schema.carrierConnectionClients.hasAccess, true))).limit(1))[0]);
    });
  const services = conns.length
    ? await db.select().from(schema.carrierServices).where(and(inArray(schema.carrierServices.connectionId, conns.map((x) => x.id)), eq(schema.carrierServices.isActive, true))).orderBy(asc(schema.carrierServices.transitDays))
    : [];
  const carriers = conns.map((conn) => ({
    connectionId: conn.id,
    label: conn.setupName,
    carrierCode: services.find((s) => s.connectionId === conn.id)?.carrierCode ?? conn.provider.toUpperCase(),
    services: services.filter((s) => s.connectionId === conn.id).map((s) => ({ id: s.id, name: s.name, transitDays: s.transitDays, isInternational: Boolean(s.isInternational) })),
  }));
  const carrierCodes = [...new Set([...services.map((s) => s.carrierCode), ...(await db.select({ c: schema.shipmentOrders.carrier }).from(schema.shipmentOrders).groupBy(schema.shipmentOrders.carrier)).flatMap((r) => (r.c ? [r.c] : []))])]
    .sort().map((code) => ({ value: code, label: code }));

  const rp = schema.rateShoppingPresets;
  const presets = (await db.select().from(rp).where(and(eq(rp.isActive, true), warehouseId ? eq(rp.warehouseId, warehouseId) : undefined, clientId ? eq(rp.clientId, clientId) : undefined)))
    .map((p) => ({ value: p.id, label: p.name, description: p.method }));
  const sp = schema.shipmentPackages;
  const shipmentPackages = warehouseId
    ? (await db.select().from(sp).where(eq(sp.warehouseId, warehouseId)).orderBy(asc(sp.code)))
      .map((p) => ({ value: p.id, label: p.code, description: `${p.length} × ${p.width} × ${p.height} ${p.dimensionUnit === "Inch" ? "in" : p.dimensionUnit}` }))
    : [];
  const retailers = (await db.select().from(schema.retailers).where(eq(schema.retailers.isActive, true)).orderBy(asc(schema.retailers.name)))
    .map((r) => ({ value: r.id, label: r.name, description: r.businessName }));
  const ad = schema.addresses;
  const owners = [warehouseId, clientId].filter((x): x is string => Boolean(x));
  const returnAddresses = owners.length
    ? (await db.select().from(ad).where(and(inArray(ad.ownerId, owners), eq(ad.isActive, true))))
      .map((a) => ({ value: a.id, label: a.name ?? `${a.line1}, ${a.city}`, description: [a.line1, a.city, a.state].filter(Boolean).join(", ") }))
    : [];
  const tags = (await db.select().from(schema.tags).where(inArray(schema.tags.scope, ["shipment_order", "any"])).orderBy(asc(schema.tags.name)))
    .map((t) => ({ value: t.id, label: t.name }));

  return {
    warehouses, clients,
    orderTypes: await lookups(db, "so_type", clientId),
    cancelReasons: await lookups(db, "so_cancel_reason", clientId),
    packingWarningTypes: await lookups(db, "packing_warning_type", clientId),
    damageReasons: await lookups(db, "damage_reason", clientId),
    carriers, carrierCodes, presets, shipmentPackages, retailers, returnAddresses, tags,
  };
}

/* --------------------------------------------------- picking / job operations */

export const jobOptionsQuerySchema = z.object({ warehouseId: z.string().min(1).max(64) });

export interface JobTypeOption {
  readonly id: string;
  readonly code: string;
  readonly description: string;
  readonly batchMethod: "Nof Order" | "Nof Item";
  readonly batchMin: number;
  readonly batchMax: number;
}

export interface MergeableJobOption {
  readonly id: string;
  readonly code: string;
  readonly jobType: string;
  readonly status: string;
  readonly orderCount: number;
  readonly unitCount: number;
  readonly completedUnits: number;
  readonly assigneeName: string | null;
}

export interface OrderJobOptions {
  readonly jobTypes: readonly JobTypeOption[];
  readonly mergeableJobs: readonly MergeableJobOption[];
  /** Preselected job type: the one this warehouse used for its latest picking job, else the first. */
  readonly defaultJobTypeId: string | null;
}

/**
 * Picking/Job Operations modal lists for one warehouse: the Picking job types (with their
 * batch rules) and the Pending picking jobs an order can be merged into.
 */
export async function orderJobOptions(db: AppDb, scope: Scope, warehouseId: string): Promise<OrderJobOptions> {
  if (!hasWarehouse(scope, warehouseId)) return { jobTypes: [], mergeableJobs: [], defaultJobTypeId: null };
  const jt = schema.jobTypes;
  const jobTypes = (await db.select({ id: jt.id, code: jt.code, description: jt.description, settings: jt.settings }).from(jt)
    .where(and(eq(jt.warehouseId, warehouseId), eq(jt.operationType, "Picking"), eq(jt.isActive, true))).orderBy(asc(jt.code)))
    .map((t) => {
      const batch = parseBatch(t.settings);
      return { id: t.id, code: t.code, description: t.description, batchMethod: batch.method, batchMin: batch.min, batchMax: batch.max };
    });
  const j = schema.jobs;
  const u = schema.users;
  const mergeableJobs = await db.select({
    id: j.id, code: j.code, jobType: j.jobType, status: j.status, orderCount: j.orderCount, unitCount: j.unitCount,
    completedUnits: j.completedUnits, assigneeName: u.name,
  }).from(j).leftJoin(u, eq(u.id, j.assignedToUserId))
    .where(and(eq(j.warehouseId, warehouseId), eq(j.operationType, "Picking"), eq(j.status, "Pending")))
    .orderBy(asc(j.code)).limit(100);
  const latest = (await db.select({ id: j.jobTypeId }).from(j)
    .where(and(eq(j.warehouseId, warehouseId), eq(j.operationType, "Picking"))).orderBy(desc(j.createdAt)).limit(20))
    .map((r) => r.id).find((id) => id && jobTypes.some((t) => t.id === id));
  return { jobTypes, mergeableJobs, defaultJobTypeId: latest ?? jobTypes[0]?.id ?? null };
}

function parseBatch(raw: unknown): { method: "Nof Order" | "Nof Item"; min: number; max: number } {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  const batch = (value && typeof value === "object" ? (value as { batch?: unknown }).batch : null) as { method?: unknown; min?: unknown; max?: unknown } | null;
  const int = (v: unknown, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : d);
  return { method: batch?.method === "Nof Item" ? "Nof Item" : "Nof Order", min: int(batch?.min, 1), max: int(batch?.max, 50) };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
