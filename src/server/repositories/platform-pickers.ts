/**
 * Async picker search (BUILD_PLAN F7 `/api/pickers/*`): small, scoped `{ id, label,
 * sublabel }` lists for the shared entity pickers. Every picker filters by the caller's
 * view scope; `ids=a,b` resolves already-selected values (still scoped).
 */
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { AREA_TYPES, JOB_STATUSES, SO_STATUSES } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { validationError } from "@/server/api/errors";
import { hasClient, hasWarehouse, scopedWhere, type Scope } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { idSchema, likeEscape } from "./platform-common";

export const PICKER_DEFAULT_LIMIT = 20;
export const PICKER_MAX_LIMIT = 50;
const MAX_IDS = 100;

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z.string().max(4000).transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(item).max(MAX_IDS));

export const pickerQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  mode: z.enum(["ct", "sw"]).default("ct"),
  limit: z.coerce.number().int().min(1).max(PICKER_MAX_LIMIT).default(PICKER_DEFAULT_LIMIT),
  ids: csv(idSchema).optional(),
  warehouseId: idSchema.optional(),
  clientId: idSchema.optional(),
  includeInactive: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export type PickerQuery = z.output<typeof pickerQuerySchema>;

export interface PickerOption {
  readonly id: string;
  readonly label: string;
  readonly sublabel: string | null;
  readonly meta?: Readonly<Record<string, unknown>>;
}

interface PickerConfig {
  readonly table: SQLiteTable;
  readonly id: SQLiteColumn;
  readonly label: SQLiteColumn | SQL;
  readonly sublabel: SQLiteColumn | SQL | null;
  readonly search: readonly (SQLiteColumn | SQL)[];
  readonly order: SQLiteColumn | SQL;
  readonly scope?: SQL;
  readonly active?: SQLiteColumn;
  readonly filters?: readonly (SQL | undefined)[];
  readonly meta?: Readonly<Record<string, SQLiteColumn | SQL>>;
}

/** Narrows the view scope to an explicit warehouse/client filter (must be inside it). */
function narrow(scope: Scope, query: PickerQuery): Scope {
  if (query.warehouseId && !hasWarehouse(scope, query.warehouseId)) throw validationError("Warehouse not found", { warehouseId: ["Warehouse not found"] });
  if (query.clientId && !hasClient(scope, query.clientId)) throw validationError("Client not found", { clientId: ["Client not found"] });
  return {
    warehouseIds: query.warehouseId ? [query.warehouseId] : scope.warehouseIds,
    clientIds: query.clientId ? [query.clientId] : scope.clientIds,
  };
}

function searchWhere(cfg: PickerConfig, query: PickerQuery): SQL | undefined {
  if (query.ids) return inArray(cfg.id, query.ids.length ? query.ids : [""]);
  if (!query.q) return undefined;
  const pattern = likeEscape(query.q.toLowerCase(), query.mode === "sw" ? "startsWith" : "contains");
  return or(...cfg.search.map((col) => sql`lower(${col}) LIKE ${pattern} ESCAPE '\\'`));
}

function runPicker(db: AppDb, cfg: PickerConfig, query: PickerQuery): PickerOption[] {
  const where = and(
    cfg.scope,
    searchWhere(cfg, query),
    cfg.active && !query.includeInactive && !query.ids ? eq(cfg.active, true) : undefined,
    ...(cfg.filters ?? []),
  );
  const metaCols = cfg.meta ?? {};
  const rows = db.select({ id: cfg.id, label: cfg.label, sublabel: cfg.sublabel ?? sql`NULL`, ...metaCols })
    .from(cfg.table).where(where).orderBy(asc(cfg.order))
    .limit(query.ids ? MAX_IDS : query.limit).all() as Record<string, unknown>[];
  const metaKeys = Object.keys(metaCols);
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label ?? ""),
    sublabel: r.sublabel === null || r.sublabel === undefined ? null : String(r.sublabel),
    ...(metaKeys.length ? { meta: Object.fromEntries(metaKeys.map((k) => [k, r[k]])) } : {}),
  }));
}

const extraSchemas = {
  locations: z.object({ areaType: z.enum(AREA_TYPES).optional() }),
  lps: z.object({ locationId: idSchema.optional() }),
  orders: z.object({ status: csv(z.enum(SO_STATUSES)).optional() }),
  jobs: z.object({ status: csv(z.enum(JOB_STATUSES)).optional(), jobTypeId: idSchema.optional() }),
  carrierServices: z.object({ connectionId: idSchema.optional() }),
} as const;

function extra<K extends keyof typeof extraSchemas>(key: K, raw: Readonly<Record<string, string>>): z.output<(typeof extraSchemas)[K]> {
  const parsed = extraSchemas[key].safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid filter");
  return parsed.data as z.output<(typeof extraSchemas)[K]>;
}

type PickerFn = (db: AppDb, scope: Scope, query: PickerQuery, raw: Readonly<Record<string, string>>) => PickerOption[];

const locations: PickerFn = (db, scope, query, raw) => {
  const f = extra("locations", raw);
  const t = s.locations;
  return runPicker(db, {
    table: t, id: t.id, label: t.code, sublabel: t.areaType, search: [t.code, t.barcode], order: t.code,
    scope: scopedWhere(t, narrow(scope, query)), active: t.isActive,
    filters: [f.areaType ? eq(t.areaType, f.areaType) : undefined],
    meta: { warehouseId: t.warehouseId, areaType: t.areaType, zone: t.zone },
  }, query);
};

const lps: PickerFn = (db, scope, query, raw) => {
  const f = extra("lps", raw);
  const t = s.licensePlates;
  return runPicker(db, {
    table: t, id: t.id, label: t.number, sublabel: t.status, search: [t.number, t.alternateBarcode], order: t.number,
    scope: scopedWhere(t, narrow(scope, query)),
    filters: [f.locationId ? eq(t.locationId, f.locationId) : undefined],
    meta: { warehouseId: t.warehouseId, locationId: t.locationId, status: t.status },
  }, query);
};

const users: PickerFn = (db, scope, query) => {
  const t = s.users;
  const wh = query.warehouseId ? narrow(scope, query).warehouseIds : null;
  const linked = wh
    ? or(eq(t.role, "admin"), inArray(t.id, db.select({ id: s.userWarehouses.userId }).from(s.userWarehouses).where(inArray(s.userWarehouses.warehouseId, [...wh]))))
    : undefined;
  return runPicker(db, {
    table: t, id: t.id, label: t.name, sublabel: t.email, search: [t.name, t.email], order: t.name, active: t.isActive,
    filters: [linked, eq(t.isApiUser, false)],
  }, query);
};

const products: PickerFn = (db, scope, query) => {
  const t = s.products;
  return runPicker(db, {
    table: t, id: t.id, label: t.sku, sublabel: t.name, search: [t.sku, t.name, t.barcode], order: t.sku,
    scope: scopedWhere(t, narrow(scope, query)),
    meta: { clientId: t.clientId, name: t.name, uom: t.uom, imageUrl: t.imageUrl, isKit: t.isKit },
  }, query);
};

const customers: PickerFn = (db, scope, query) => {
  const t = s.customers;
  const name = sql<string>`trim(${t.firstName} || ' ' || ${t.lastName})`;
  return runPicker(db, {
    table: t, id: t.id, label: name, sublabel: t.email, search: [t.firstName, t.lastName, t.email], order: name,
    scope: scopedWhere(t, narrow(scope, query)), active: t.isActive, meta: { clientId: t.clientId },
  }, query);
};

const vendors: PickerFn = (db, scope, query) => {
  const t = s.vendors;
  return runPicker(db, {
    table: t, id: t.id, label: t.displayName, sublabel: t.vendorName, search: [t.displayName, t.vendorName], order: t.displayName,
    scope: scopedWhere(t, narrow(scope, query)), active: t.isActive, meta: { clientId: t.clientId },
  }, query);
};

const orders: PickerFn = (db, scope, query, raw) => {
  const f = extra("orders", raw);
  const t = s.shipmentOrders;
  return runPicker(db, {
    table: t, id: t.id, label: t.code, sublabel: t.customerName, search: [t.code, t.storeOrderNumber, t.customerName], order: t.code,
    scope: scopedWhere(t, narrow(scope, query)),
    filters: [sql`${t.deletedAt} IS NULL`, f.status?.length ? inArray(t.status, f.status) : undefined],
    meta: { status: t.status, warehouseId: t.warehouseId, clientId: t.clientId, storeOrderNumber: t.storeOrderNumber },
  }, query);
};

const jobs: PickerFn = (db, scope, query, raw) => {
  const f = extra("jobs", raw);
  const t = s.jobs;
  return runPicker(db, {
    table: t, id: t.id, label: t.code, sublabel: t.jobType, search: [t.code], order: t.code,
    scope: scopedWhere(t, narrow(scope, query)),
    filters: [f.status?.length ? inArray(t.status, f.status) : undefined, f.jobTypeId ? eq(t.jobTypeId, f.jobTypeId) : undefined],
    meta: { status: t.status, warehouseId: t.warehouseId, assignedToUserId: t.assignedToUserId, unitCount: t.unitCount },
  }, query);
};

const carrierServices: PickerFn = (db, scope, query, raw) => {
  const f = extra("carrierServices", raw);
  const t = s.carrierServices;
  const conns = db.select({ id: s.carrierConnections.id }).from(s.carrierConnections)
    .where(and(scopedWhere(s.carrierConnections, narrow(scope, query)), eq(s.carrierConnections.isActive, true)));
  return runPicker(db, {
    table: t, id: t.id, label: t.name, sublabel: t.serviceCode, search: [t.name, t.serviceCode, t.carrierCode], order: t.name,
    scope: inArray(t.connectionId, conns), active: t.isActive,
    filters: [f.connectionId ? eq(t.connectionId, f.connectionId) : undefined],
    meta: { connectionId: t.connectionId, carrierCode: t.carrierCode, transitDays: t.transitDays, isInternational: t.isInternational },
  }, query);
};

const shipmentPackages: PickerFn = (db, scope, query) => {
  const t = s.shipmentPackages;
  return runPicker(db, {
    table: t, id: t.id, label: t.code, sublabel: t.description, search: [t.code, t.description], order: t.code,
    scope: scopedWhere(t, narrow(scope, query)), active: t.isActive,
    meta: { warehouseId: t.warehouseId, length: t.length, width: t.width, height: t.height, emptyWeight: t.emptyWeight },
  }, query);
};

export const PICKERS = {
  locations, lps, users, products, customers, vendors, orders, jobs,
  "carrier-services": carrierServices,
  "shipment-packages": shipmentPackages,
} as const satisfies Readonly<Record<string, PickerFn>>;

export type PickerKey = keyof typeof PICKERS;

export function runNamedPicker(db: AppDb, key: PickerKey, scope: Scope, query: PickerQuery, raw: Readonly<Record<string, string>>): PickerOption[] {
  return PICKERS[key](db, scope, query, raw);
}
