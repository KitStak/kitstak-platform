/**
 * End Of The Day (M02). Rows are stored manifests merged with "pending" manifests computed
 * live from shipping labels that are not attached to one yet (grouped by warehouse, carrier
 * connection and the warehouse-local label date). Total package is always the live count of
 * active (non-voided) shipping labels, so a new label adds one and a void takes one away.
 */
import { sql, type SQL } from "drizzle-orm";
import { EOD_SEARCH_FIELDS, parsePendingEodId, pendingEodId } from "@/lib/grid-defs/shipping/end-of-day";
import { applyLocalGridQuery, type FieldValue } from "@/lib/local-grid-query";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import { shipping } from "@/server/domain";
import { localDate } from "@/server/domain/shipping/common";
import type { BulkResult, DomainCtx } from "@/server/domain/types";
import { fileStore, type FileStore } from "@/server/files";
import type { GridQuery } from "@/server/query/grid-query";
import { compileSort } from "@/server/query/sort";
import { attachLabels, ensureOpenManifest, markPrinted } from "./end-of-day-adapter";
import { renderCustomReport, renderManifestReport, type ReportManifest, type ReportPackage } from "./end-of-day-report";
import { inList, scopeSql } from "./shipping-grid";
import type { ListResult } from "./shipping";

const raw = (expr: string): SQL => sql.raw(expr);

export interface EodRow {
  readonly id: string;
  readonly isPending: boolean;
  readonly manifestId: string | null;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly shipFrom: string;
  readonly carrierConnectionId: string;
  readonly carrierPrefix: string;
  readonly carrierCode: string;
  readonly carrierName: string;
  readonly shipDate: string;
  readonly closeDate: string | null;
  readonly isPrinted: boolean;
  readonly totalPackages: number;
  readonly voidedPackages: number;
  readonly status: "Open" | "Closed";
  readonly reportFileId: string | null;
  readonly version: number;
}

interface ManifestRaw {
  readonly id: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly carrierConnectionId: string;
  readonly carrierPrefix: string;
  readonly carrierCode: string;
  readonly carrierName: string | null;
  readonly shipDate: string;
  readonly closeDate: string | null;
  readonly isPrinted: number;
  readonly status: "Open" | "Closed";
  readonly reportFileId: string | null;
  readonly version: number;
  readonly active: number;
  readonly voided: number;
}

interface PendingLabel {
  readonly id: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly timezone: string;
  readonly carrierConnectionId: string;
  readonly carrierPrefix: string | null;
  readonly carrierName: string | null;
  readonly carrierCode: string;
  readonly labelCreatedAt: string;
  readonly labelStatus: string;
}

function clientFilter(scope: Scope): SQL {
  return scope.clientIds === "all" ? sql`1 = 1` : inList(raw("s.client_id"), scope.clientIds);
}

function loadManifests(db: AppDb, scope: Scope, where?: SQL): ManifestRaw[] {
  const cf = clientFilter(scope);
  return db.all<ManifestRaw>(sql`
    SELECT m.id AS id, m.warehouse_id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
      m.carrier_connection_id AS carrierConnectionId, COALESCE(NULLIF(m.carrier_prefix, ''), cc.account_prefix, '') AS carrierPrefix,
      m.carrier_code AS carrierCode, cc.setup_name AS carrierName, m.ship_date AS shipDate, m.close_date AS closeDate,
      m.is_printed AS isPrinted, m.status AS status, m.report_file_id AS reportFileId, m.version AS version,
      (SELECT COUNT(*) FROM shipments s WHERE s.end_of_day_manifest_id = m.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active' AND ${cf}) AS active,
      (SELECT COUNT(*) FROM shipments s WHERE s.end_of_day_manifest_id = m.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Voided' AND ${cf}) AS voided
    FROM end_of_day_manifests m
    JOIN warehouses w ON w.id = m.warehouse_id
    LEFT JOIN carrier_connections cc ON cc.id = m.carrier_connection_id
    WHERE ${scopeSql(raw("m.warehouse_id"), null, scope)} ${where ? sql`AND ${where}` : sql``}`);
}

function loadPendingLabels(db: AppDb, scope: Scope, where?: SQL): PendingLabel[] {
  return db.all<PendingLabel>(sql`
    SELECT s.id AS id, s.warehouse_id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName, w.timezone AS timezone,
      s.carrier_connection_id AS carrierConnectionId, cc.account_prefix AS carrierPrefix, cc.setup_name AS carrierName,
      s.carrier_code AS carrierCode, s.label_created_at AS labelCreatedAt, s.label_status AS labelStatus
    FROM shipments s
    JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN carrier_connections cc ON cc.id = s.carrier_connection_id
    WHERE s.end_of_day_manifest_id IS NULL AND s.label_type = 'Shipping Label' AND s.carrier_connection_id IS NOT NULL
      AND ${scopeSql(raw("s.warehouse_id"), raw("s.client_id"), scope)} ${where ? sql`AND ${where}` : sql``}`);
}

const keyOf = (warehouseId: string, connectionId: string, shipDate: string): string => `${warehouseId}|${connectionId}|${shipDate}`;

function manifestRow(m: ManifestRaw, extra: { active: number; voided: number }): EodRow {
  return {
    id: m.id, isPending: false, manifestId: m.id, warehouseId: m.warehouseId, warehouseCode: m.warehouseCode, shipFrom: m.warehouseName,
    carrierConnectionId: m.carrierConnectionId, carrierPrefix: m.carrierPrefix, carrierCode: m.carrierCode, carrierName: m.carrierName ?? m.carrierCode,
    shipDate: m.shipDate, closeDate: m.closeDate, isPrinted: Boolean(m.isPrinted), totalPackages: m.active + extra.active,
    voidedPackages: m.voided + extra.voided, status: m.status, reportFileId: m.reportFileId, version: m.version,
  };
}

/** Every EOD row in scope (stored + pending), unfiltered. */
export function buildEodRows(db: AppDb, scope: Scope): EodRow[] {
  const manifests = loadManifests(db, scope);
  const openByKey = new Map(manifests.filter((m) => m.status === "Open").map((m) => [keyOf(m.warehouseId, m.carrierConnectionId, m.shipDate), m]));
  const extra = new Map<string, { active: number; voided: number }>();
  const pending = new Map<string, { label: PendingLabel; shipDate: string; active: number; voided: number; carriers: Map<string, number> }>();
  for (const l of loadPendingLabels(db, scope)) {
    const shipDate = localDate(new Date(l.labelCreatedAt), l.timezone);
    const key = keyOf(l.warehouseId, l.carrierConnectionId, shipDate);
    const isActive = l.labelStatus === "Active";
    const open = openByKey.get(key);
    if (open) {
      const e = extra.get(open.id) ?? { active: 0, voided: 0 };
      extra.set(open.id, { active: e.active + (isActive ? 1 : 0), voided: e.voided + (isActive ? 0 : 1) });
      continue;
    }
    const g = pending.get(key) ?? { label: l, shipDate, active: 0, voided: 0, carriers: new Map<string, number>() };
    g.carriers.set(l.carrierCode, (g.carriers.get(l.carrierCode) ?? 0) + 1);
    pending.set(key, { ...g, active: g.active + (isActive ? 1 : 0), voided: g.voided + (isActive ? 0 : 1) });
  }
  const stored = manifests.map((m) => manifestRow(m, extra.get(m.id) ?? { active: 0, voided: 0 }));
  // A group whose labels were all voided has nothing to hand to the carrier: no manifest row.
  const derived = [...pending.values()].filter((g) => g.active > 0).map((g): EodRow => {
    const carrierCode = [...g.carriers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? g.label.carrierCode;
    return {
      id: pendingEodId(g.label.warehouseId, g.label.carrierConnectionId, g.shipDate), isPending: true, manifestId: null,
      warehouseId: g.label.warehouseId, warehouseCode: g.label.warehouseCode, shipFrom: g.label.warehouseName,
      carrierConnectionId: g.label.carrierConnectionId, carrierPrefix: g.label.carrierPrefix ?? "", carrierCode,
      carrierName: g.label.carrierName ?? carrierCode, shipDate: g.shipDate, closeDate: null, isPrinted: false,
      totalPackages: g.active, voidedPackages: g.voided, status: "Open", reportFileId: null, version: 0,
    };
  });
  return [...stored, ...derived];
}

const SORTABLE = new Set(["carrierPrefix", "carrierCode", "warehouseCode", "shipDate", "closeDate", "isPrinted", "totalPackages", "voidedPackages", "status"]);

export function listEndOfDay(db: AppDb, auth: AuthContext, query: GridQuery, now: Date = new Date()): ListResult<EodRow> {
  const bad = query.sort.find((s) => !SORTABLE.has(s.field));
  if (bad) compileSort({}, [bad]); // throws the standard VALIDATION error
  const rows = buildEodRows(db, auth.viewScope);
  const sorted = { ...query, sort: query.sort.length > 0 ? query.sort : [{ field: "shipDate", dir: "desc" as const }, { field: "carrierPrefix", dir: "asc" as const }] };
  const get = (row: EodRow, field: string): FieldValue => {
    const value = (row as unknown as Record<string, unknown>)[field];
    if (field === "shipDate" && typeof value === "string") return `${value}T12:00:00.000Z`;
    return value as FieldValue;
  };
  const all = applyLocalGridQuery(rows, { ...sorted, page: 1, pageSize: 1_000_000 }, { get, searchFields: EOD_SEARCH_FIELDS, now });
  const start = (query.page - 1) * query.pageSize;
  return { rows: all.rows.slice(start, start + query.pageSize), total: all.total };
}

/* --------------------------------------------------------------- commands */

interface ResolvedGroup {
  readonly row: EodRow;
  readonly pendingIds: readonly string[];
}

function resolveGroup(db: AppDb, scope: Scope, id: string): ResolvedGroup {
  const pending = parsePendingEodId(id);
  const warehouseId = pending?.warehouseId ?? db.get<{ w: string }>(sql`SELECT warehouse_id AS w FROM end_of_day_manifests WHERE id = ${id}`)?.w;
  if (!warehouseId || !hasWarehouse(scope, warehouseId)) throw notFoundError("End of day manifest");
  const row = buildEodRows(db, { ...scope, warehouseIds: [warehouseId] }).find((r) => r.id === id);
  if (!row) throw notFoundError("End of day manifest");
  const labels = loadPendingLabels(db, scope, sql`s.warehouse_id = ${row.warehouseId} AND s.carrier_connection_id = ${row.carrierConnectionId} AND s.label_status = 'Active'`);
  const pendingIds = labels.filter((l) => localDate(new Date(l.labelCreatedAt), l.timezone) === row.shipDate).map((l) => l.id);
  return { row, pendingIds };
}

function reportOf(db: AppDb, row: EodRow, manifestId: string | null, pendingIds: readonly string[], closeDate: string | null): ReportManifest {
  const where = manifestId
    ? sql`(s.end_of_day_manifest_id = ${manifestId}${pendingIds.length ? sql` OR ${inList(raw("s.id"), pendingIds)}` : sql``})`
    : inList(raw("s.id"), pendingIds);
  const packages = db.all<ReportPackage>(sql`
    SELECT o.code AS orderCode, c.name AS clientName, o.customer_name AS customerName, s.service_name AS serviceName,
      s.tracking_number AS trackingNumber, s.weight AS weightOz, s.label_created_at AS labelCreatedAt
    FROM shipments s JOIN shipment_orders o ON o.id = s.order_id LEFT JOIN clients c ON c.id = s.client_id
    WHERE ${where} AND s.label_type = 'Shipping Label' AND s.label_status = 'Active' ORDER BY s.label_created_at, s.package_seq`);
  return {
    title: "End of the day report", carrierCode: row.carrierCode, carrierPrefix: row.carrierPrefix, shipFrom: row.shipFrom,
    shipDate: row.shipDate, closeDate, packages,
  };
}

function storePdf(db: AppDb, store: FileStore, auth: AuthContext, name: string, bytes: Uint8Array, manifestId: string | null): string {
  return store.store(db, {
    name, bytes, purpose: "print", uploadedBy: auth.user.id,
    ownerEntityType: manifestId ? "end_of_day_manifest" : null, ownerEntityId: manifestId,
  }).id;
}

export interface EodPrintResult extends BulkResult {
  readonly fileId: string | null;
}

/** `2026-11-06 1633` (UTC) — readable and filename-safe. */
const fileStamp = (): string => new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");

/**
 * Print End of the Day Report: attaches pending labels, closes each manifest through
 * `shipping.closeEndOfDay` (close date, Closed), marks it printed and renders one PDF
 * listing every package with its tracking barcode.
 */
export async function closeManifests(db: AppDb, auth: AuthContext, ctx: DomainCtx, ids: readonly string[], store: FileStore = fileStore()): Promise<EodPrintResult> {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  const reports: { manifestId: string; report: ReportManifest }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const { row, pendingIds } = resolveGroup(db, auth.scope, id);
      if (row.status === "Closed") throw new AppError("INVALID_STATE", `The ${row.carrierPrefix} manifest for ${row.shipDate} is already closed.`);
      if (row.totalPackages === 0) throw new AppError("INVALID_STATE", `The ${row.carrierPrefix} manifest for ${row.shipDate} has no active packages.`);
      const closed = db.transaction((tx) => {
        const manifest = ensureOpenManifest(tx, ctx, { warehouseId: row.warehouseId, carrierConnectionId: row.carrierConnectionId, shipDate: row.shipDate, carrierCode: row.carrierCode });
        attachLabels(tx, manifest.id, pendingIds);
        const done = shipping.closeEndOfDay(tx, ctx, { manifestId: manifest.id });
        markPrinted(tx, ctx, manifest.id, { totalPackages: row.totalPackages });
        return done;
      });
      reports.push({ manifestId: closed.id, report: reportOf(db, row, closed.id, [], closed.closeDate) });
      succeeded.push(id);
    } catch (error: unknown) {
      failed.push({ id, code: (error as { code?: string }).code ?? "INTERNAL", message: error instanceof Error ? error.message : "Close failed" });
    }
  }
  if (reports.length === 0) return { succeeded, failed, fileId: null };
  const bytes = await renderManifestReport(reports.map((r) => r.report));
  const fileId = db.transaction((tx) => {
    const id = storePdf(tx, store, auth, `End of the Day Report ${fileStamp()}.pdf`, bytes, reports.length === 1 ? reports[0].manifestId : null);
    for (const r of reports) markPrinted(tx, ctx, r.manifestId, { totalPackages: r.report.packages.length, reportFileId: id });
    return id;
  });
  return { succeeded, failed, fileId };
}

/** Reprint: re-renders the closed manifests' report (no state change beyond Printed). */
export async function reprintManifests(db: AppDb, auth: AuthContext, ids: readonly string[], store: FileStore = fileStore()): Promise<EodPrintResult> {
  const groups = [...new Set(ids)].map((id) => resolveGroup(db, auth.scope, id));
  const open = groups.find((g) => g.row.status !== "Closed");
  if (open) throw new AppError("INVALID_STATE", `The ${open.row.carrierPrefix} manifest for ${open.row.shipDate} is still open — print the End of the Day Report first.`);
  const reports = groups.map((g) => reportOf(db, g.row, g.row.manifestId, [], g.row.closeDate));
  const bytes = await renderManifestReport(reports);
  const fileId = storePdf(db, store, auth, `End of the Day Report (reprint) ${fileStamp()}.pdf`, bytes, groups.length === 1 ? groups[0].row.manifestId : null);
  return { succeeded: groups.map((g) => g.row.id), failed: [], fileId };
}

/** Print Custom Report: totals by client and service; works for open and closed manifests. */
export async function printCustomReport(db: AppDb, auth: AuthContext, ids: readonly string[], store: FileStore = fileStore()): Promise<EodPrintResult> {
  const groups = [...new Set(ids)].map((id) => resolveGroup(db, auth.scope, id));
  const reports = groups.map((g) => reportOf(db, g.row, g.row.manifestId, g.pendingIds, g.row.closeDate));
  const bytes = await renderCustomReport(reports);
  const fileId = storePdf(db, store, auth, `Custom EOD Report ${fileStamp()}.pdf`, bytes, null);
  return { succeeded: groups.map((g) => g.row.id), failed: [], fileId };
}
