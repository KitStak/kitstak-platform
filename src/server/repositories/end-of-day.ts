/**
 * End Of The Day (M02). Rows are stored manifests merged with "pending" manifests computed
 * live from shipping labels that are not attached to one yet (grouped by warehouse, carrier
 * connection and the warehouse-local label date). Total package is always the live count of
 * active (non-voided) shipping labels, so a new label adds one and a void takes one away.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import { EOD_SEARCH_FIELDS, parsePendingEodId, parseSplitEodId, pendingEodId, splitEodId } from "@/lib/grid-defs/shipping/end-of-day";
import { applyLocalGridQuery, type FieldValue } from "@/lib/local-grid-query";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { shipping } from "@/server/domain";
import { localDate } from "@/server/domain/shipping/common";
import type { BulkResult, DomainCtx } from "@/server/domain/types";
import { fileStore, type FileStore } from "@/server/files";
import type { GridQuery } from "@/server/query/grid-query";
import { compileSort } from "@/server/query/sort";
import { attachLabels, detachOtherCarriers, ensureOpenManifest, markPrinted } from "./end-of-day-adapter";
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
  /** Manifest number for this carrier setup and ship day (1, then 2 for labels made after a close). */
  readonly sequence: number;
  /** Open manifest whose ship day is already past in the warehouse's time zone: it was never closed. */
  readonly isOverdue: boolean;
  /** Warehouse IANA time zone (reports print local times in it). */
  readonly timezone: string;
  /** Earliest carrier pickup scheduled for this manifest's active packages (Schedule pickup). */
  readonly scheduledPickupAt: string | null;
}

interface ManifestRaw {
  readonly sequence: number;
  readonly timezone: string;
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
  readonly scheduledPickupAt: string | null;
}

function clientFilter(scope: Scope): SQL {
  return scope.clientIds === "all" ? sql`1 = 1` : inList(raw("s.client_id"), scope.clientIds);
}

function loadManifests(db: AppDb, scope: Scope, where?: SQL): ManifestRaw[] {
  return db.all<ManifestRaw>(sql`
    SELECT m.id AS id, m.warehouse_id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
      m.carrier_connection_id AS carrierConnectionId, COALESCE(NULLIF(m.carrier_prefix, ''), cc.account_prefix, '') AS carrierPrefix,
      m.carrier_code AS carrierCode, cc.setup_name AS carrierName, m.ship_date AS shipDate, m.close_date AS closeDate,
      m.is_printed AS isPrinted, m.status AS status, m.sequence AS sequence, w.timezone AS timezone, m.report_file_id AS reportFileId, m.version AS version
    FROM end_of_day_manifests m
    JOIN warehouses w ON w.id = m.warehouse_id
    LEFT JOIN carrier_connections cc ON cc.id = m.carrier_connection_id
    WHERE ${scopeSql(raw("m.warehouse_id"), null, scope)} ${where ? sql`AND ${where}` : sql``}`);
}

type Counts = { active: number; voided: number; pickup?: string | null };
const minIso = (a: string | null | undefined, b: string | null | undefined): string | null => (!a ? b ?? null : !b ? a : a < b ? a : b);

/** Active / voided shipping-label counts per (manifest, carrier code), in the caller's client scope. */
function loadManifestCounts(db: AppDb, scope: Scope): Map<string, Map<string, Counts>> {
  const rows = db.all<{ mid: string; carrierCode: string; active: number; voided: number; pickup: string | null }>(sql`
    SELECT s.end_of_day_manifest_id AS mid, s.carrier_code AS carrierCode,
      SUM(CASE WHEN s.label_status = 'Active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN s.label_status = 'Voided' THEN 1 ELSE 0 END) AS voided,
      MIN(CASE WHEN s.label_status = 'Active' THEN s.scheduled_pickup_at END) AS pickup
    FROM shipments s
    WHERE s.end_of_day_manifest_id IS NOT NULL AND s.label_type = 'Shipping Label' AND ${clientFilter(scope)}
    GROUP BY s.end_of_day_manifest_id, s.carrier_code`);
  const out = new Map<string, Map<string, Counts>>();
  for (const r of rows) {
    const m = out.get(r.mid) ?? new Map<string, Counts>();
    m.set(r.carrierCode, { active: Number(r.active), voided: Number(r.voided), pickup: r.pickup ?? null });
    out.set(r.mid, m);
  }
  return out;
}

/**
 * Labels that still need a manifest of their own carrier: on no manifest, or on an Open
 * manifest of another carrier (for example a USPS service on a UPS carrier setup). They are
 * moved to their own carrier's manifest when that manifest is closed.
 */
function loadPendingLabels(db: AppDb, scope: Scope, where?: SQL): PendingLabel[] {
  return db.all<PendingLabel>(sql`
    SELECT s.id AS id, s.warehouse_id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName, w.timezone AS timezone,
      s.carrier_connection_id AS carrierConnectionId, cc.account_prefix AS carrierPrefix, cc.setup_name AS carrierName,
      s.carrier_code AS carrierCode, s.label_created_at AS labelCreatedAt, s.label_status AS labelStatus,
      s.scheduled_pickup_at AS scheduledPickupAt
    FROM shipments s
    JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN carrier_connections cc ON cc.id = s.carrier_connection_id
    LEFT JOIN end_of_day_manifests em ON em.id = s.end_of_day_manifest_id
    WHERE (s.end_of_day_manifest_id IS NULL OR (em.status = 'Open' AND em.carrier_code <> s.carrier_code))
      AND s.label_type = 'Shipping Label' AND s.carrier_connection_id IS NOT NULL
      AND ${scopeSql(raw("s.warehouse_id"), raw("s.client_id"), scope)} ${where ? sql`AND ${where}` : sql``}`);
}

/** EOD row key: one manifest per warehouse, carrier setup, carrier and warehouse-local ship day. */
export const eodKeyOf = (warehouseId: string, connectionId: string, carrierCode: string, shipDate: string): string => `${warehouseId}|${connectionId}|${carrierCode}|${shipDate}`;
const dayKeyOf = (warehouseId: string, connectionId: string, shipDate: string): string => `${warehouseId}|${connectionId}|${shipDate}`;

function manifestRow(m: ManifestRaw, counts: Counts, now: Date, split?: { id: string; carrierCode: string }): EodRow {
  return {
    timezone: m.timezone, sequence: m.sequence ?? 1, isOverdue: m.status === "Open" && m.shipDate < localDate(now, m.timezone),
    id: split?.id ?? m.id, isPending: false, manifestId: m.id, warehouseId: m.warehouseId, warehouseCode: m.warehouseCode, shipFrom: m.warehouseName,
    carrierConnectionId: m.carrierConnectionId, carrierPrefix: m.carrierPrefix, carrierCode: split?.carrierCode ?? m.carrierCode, carrierName: m.carrierName ?? m.carrierCode,
    shipDate: m.shipDate, closeDate: m.closeDate, isPrinted: Boolean(m.isPrinted), totalPackages: counts.active,
    voidedPackages: counts.voided, status: m.status, reportFileId: m.reportFileId, version: m.version,
    scheduledPickupAt: counts.pickup ?? null,
  };
}

/**
 * Every EOD row in scope (stored + pending), unfiltered. Each row holds one carrier's packages:
 * a closed manifest that also holds another carrier's labels shows them as a separate closed
 * row, and such labels on an open manifest count on their own carrier's row.
 */
export function buildEodRows(db: AppDb, scope: Scope, now: Date = new Date()): EodRow[] {
  const manifests = loadManifests(db, scope);
  const counts = loadManifestCounts(db, scope);
  const lastSeq = new Map<string, number>();
  for (const m of manifests) {
    const k = dayKeyOf(m.warehouseId, m.carrierConnectionId, m.shipDate);
    lastSeq.set(k, Math.max(lastSeq.get(k) ?? 0, m.sequence ?? 1));
  }
  const openByKey = new Map(manifests.filter((m) => m.status === "Open").map((m) => [eodKeyOf(m.warehouseId, m.carrierConnectionId, m.carrierCode, m.shipDate), m]));
  const extra = new Map<string, Counts>();
  const pending = new Map<string, { label: PendingLabel; shipDate: string; active: number; voided: number; pickup: string | null }>();
  for (const l of loadPendingLabels(db, scope)) {
    const shipDate = localDate(new Date(l.labelCreatedAt), l.timezone);
    const key = eodKeyOf(l.warehouseId, l.carrierConnectionId, l.carrierCode, shipDate);
    const isActive = l.labelStatus === "Active";
    const open = openByKey.get(key);
    if (open) {
      const e = extra.get(open.id) ?? { active: 0, voided: 0 };
      extra.set(open.id, { active: e.active + (isActive ? 1 : 0), voided: e.voided + (isActive ? 0 : 1), pickup: isActive ? minIso(e.pickup, l.scheduledPickupAt) : e.pickup ?? null });
      continue;
    }
    const g = pending.get(key) ?? { label: l, shipDate, active: 0, voided: 0, pickup: null };
    pending.set(key, { ...g, active: g.active + (isActive ? 1 : 0), voided: g.voided + (isActive ? 0 : 1), pickup: isActive ? minIso(g.pickup, l.scheduledPickupAt) : g.pickup });
  }
  const stored: EodRow[] = [];
  for (const m of manifests) {
    const byCarrier = counts.get(m.id) ?? new Map<string, Counts>();
    const own = byCarrier.get(m.carrierCode) ?? { active: 0, voided: 0 };
    const e = extra.get(m.id) ?? { active: 0, voided: 0 };
    const mine = { active: own.active + e.active, voided: own.voided + e.voided, pickup: minIso(own.pickup, e.pickup) };
    // An open manifest that only holds other carriers' labels has nothing of its own to close.
    if (m.status === "Closed" || mine.active + mine.voided > 0) stored.push(manifestRow(m, mine, now));
    if (m.status !== "Closed") continue; // other carriers' labels on an open manifest are pending (above)
    for (const [carrierCode, c] of byCarrier) {
      if (carrierCode === m.carrierCode || c.active + c.voided === 0) continue;
      stored.push(manifestRow(m, c, now, { id: splitEodId(m.id, carrierCode), carrierCode }));
    }
  }
  // A group whose labels were all voided has nothing to hand to the carrier: no manifest row.
  const derived = [...pending.values()].filter((g) => g.active > 0).map((g): EodRow => ({
    id: pendingEodId(g.label.warehouseId, g.label.carrierConnectionId, g.shipDate, g.label.carrierCode), isPending: true, manifestId: null,
    warehouseId: g.label.warehouseId, warehouseCode: g.label.warehouseCode, shipFrom: g.label.warehouseName,
    carrierConnectionId: g.label.carrierConnectionId, carrierPrefix: g.label.carrierPrefix ?? "", carrierCode: g.label.carrierCode,
    carrierName: g.label.carrierName ?? g.label.carrierCode, shipDate: g.shipDate, closeDate: null, isPrinted: false,
    totalPackages: g.active, voidedPackages: g.voided, status: "Open", reportFileId: null, version: 0,
    sequence: (lastSeq.get(dayKeyOf(g.label.warehouseId, g.label.carrierConnectionId, g.shipDate)) ?? 0) + 1,
    isOverdue: g.shipDate < localDate(now, g.label.timezone), timezone: g.label.timezone, scheduledPickupAt: g.pickup,
  }));
  return [...stored, ...derived];
}

const SORTABLE = new Set(["scheduledPickupAt", "isOverdue", "sequence", "carrierPrefix", "carrierCode", "warehouseCode", "shipDate", "closeDate", "isPrinted", "totalPackages", "voidedPackages", "status"]);

export function listEndOfDay(db: AppDb, auth: AuthContext, query: GridQuery, now: Date = new Date()): ListResult<EodRow> {
  const bad = query.sort.find((s) => !SORTABLE.has(s.field));
  if (bad) compileSort({}, [bad]); // throws the standard VALIDATION error
  const rows = buildEodRows(db, auth.viewScope, now);
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

export interface ResolvedGroup {
  readonly row: EodRow;
  readonly pendingIds: readonly string[];
}

/** An EOD grid row id (stored, split or pending) → its row and the pending label ids it would attach. */
export function resolveGroup(db: AppDb, scope: Scope, id: string): ResolvedGroup {
  const pending = parsePendingEodId(id);
  const manifestId = parseSplitEodId(id)?.manifestId ?? id;
  const warehouseId = pending?.warehouseId ?? db.get<{ w: string }>(sql`SELECT warehouse_id AS w FROM end_of_day_manifests WHERE id = ${manifestId}`)?.w;
  if (!warehouseId || !hasWarehouse(scope, warehouseId)) throw notFoundError("End of day manifest");
  const row = buildEodRows(db, { ...scope, warehouseIds: [warehouseId] }).find((r) => r.id === id);
  if (!row) throw notFoundError("End of day manifest");
  const labels = loadPendingLabels(db, scope, sql`s.warehouse_id = ${row.warehouseId} AND s.carrier_connection_id = ${row.carrierConnectionId} AND s.carrier_code = ${row.carrierCode} AND s.label_status = 'Active'`);
  const pendingIds = labels.filter((l) => localDate(new Date(l.labelCreatedAt), l.timezone) === row.shipDate).map((l) => l.id);
  return { row, pendingIds };
}

function reportOf(db: AppDb, row: EodRow, manifestId: string | null, pendingIds: readonly string[], closeDate: string | null, clientName: string | null = null): ReportManifest {
  const where = manifestId
    ? sql`(s.end_of_day_manifest_id = ${manifestId}${pendingIds.length ? sql` OR ${inList(raw("s.id"), pendingIds)}` : sql``})`
    : inList(raw("s.id"), pendingIds);
  const packages = db.all<ReportPackage>(sql`
    SELECT o.code AS orderCode, c.name AS clientName, o.customer_name AS customerName, s.service_name AS serviceName,
      s.tracking_number AS trackingNumber, s.weight AS weightOz, s.label_created_at AS labelCreatedAt
    FROM shipments s JOIN shipment_orders o ON o.id = s.order_id LEFT JOIN clients c ON c.id = s.client_id
    WHERE ${where} AND s.carrier_code = ${row.carrierCode} ${clientName ? sql`AND c.name = ${clientName}` : sql``} AND s.label_type = 'Shipping Label' AND s.label_status = 'Active' ORDER BY s.label_created_at, s.package_seq`);
  return {
    title: "End of the day report", carrierCode: row.carrierCode, carrierPrefix: row.carrierPrefix, shipFrom: row.shipFrom,
    shipDate: row.shipDate, closeDate, timezone: row.timezone, packages,
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
 * Print End Of The Day Report: attaches pending labels, closes each manifest through
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
      if (row.status === "Closed" || parseSplitEodId(row.id)) throw new AppError("INVALID_STATE", `The ${row.carrierPrefix} manifest for ${row.shipDate} is already closed.`);
      if (row.totalPackages === 0) throw new AppError("INVALID_STATE", `The ${row.carrierPrefix} manifest for ${row.shipDate} has no active packages.`);
      const closed = db.transaction((tx) => {
        const manifest = ensureOpenManifest(tx, ctx, { warehouseId: row.warehouseId, carrierConnectionId: row.carrierConnectionId, shipDate: row.shipDate, carrierCode: row.carrierCode });
        detachOtherCarriers(tx, manifest.id, manifest.carrierCode);
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
    const id = storePdf(tx, store, auth, `End Of The Day Report ${fileStamp()}.pdf`, bytes, reports.length === 1 ? reports[0].manifestId : null);
    for (const r of reports) markPrinted(tx, ctx, r.manifestId, { totalPackages: r.report.packages.length, reportFileId: id });
    return id;
  });
  return { succeeded, failed, fileId };
}

/** Reprint: re-renders the closed manifests' report (no state change beyond Printed). */
export async function reprintManifests(db: AppDb, auth: AuthContext, ids: readonly string[], store: FileStore = fileStore()): Promise<EodPrintResult> {
  const groups = [...new Set(ids)].map((id) => resolveGroup(db, auth.scope, id));
  const open = groups.find((g) => g.row.status !== "Closed");
  if (open) throw new AppError("INVALID_STATE", `The ${open.row.carrierPrefix} manifest for ${open.row.shipDate} is still open — print the End Of The Day Report first.`);
  const reports = groups.map((g) => reportOf(db, g.row, g.row.manifestId, [], g.row.closeDate));
  const bytes = await renderManifestReport(reports);
  const fileId = storePdf(db, store, auth, `End Of The Day Report (reprint) ${fileStamp()}.pdf`, bytes, groups.length === 1 ? groups[0].row.manifestId : null);
  return { succeeded: groups.map((g) => g.row.id), failed: [], fileId };
}

/**
 * Open printed report: returns the closed manifest's stored End Of The Day Report. When the manifest
 * is marked printed but has no retrievable file (seeded / migrated rows, or a print file that expired),
 * the report is regenerated from the manifest's packages on demand, stored and linked to the manifest,
 * so "Report printed? Yes" always comes with a report. Open manifests have no printed report yet.
 */
export async function openManifestReport(db: AppDb, auth: AuthContext, ctx: DomainCtx, id: string, store: FileStore = fileStore()): Promise<{ readonly fileId: string; readonly regenerated: boolean }> {
  const { row } = resolveGroup(db, auth.scope, id);
  if (row.status !== "Closed") throw new AppError("INVALID_STATE", `The ${row.carrierPrefix} manifest for ${row.shipDate} is still open, so it has no printed report yet. Print the End Of The Day Report first.`);
  if (row.reportFileId) {
    try {
      store.get(db, row.reportFileId);
      return { fileId: row.reportFileId, regenerated: false };
    } catch {
      // The stored file is gone (expired or never written): fall through and regenerate it.
    }
  }
  const manifestId = row.manifestId;
  if (!manifestId) throw notFoundError("End of day manifest");
  const bytes = await renderManifestReport([reportOf(db, row, manifestId, [], row.closeDate)]);
  const fileId = db.transaction((tx) => {
    const fid = storePdf(tx, store, auth, `End Of The Day Report ${row.carrierPrefix} ${row.shipDate}.pdf`, bytes, manifestId);
    const m = schema.endOfDayManifests;
    tx.update(m).set({ reportFileId: fid, isPrinted: true, updatedBy: ctx.userId }).where(eq(m.id, manifestId)).run();
    return fid;
  });
  return { fileId, regenerated: true };
}

/** Print Custom Report: totals by client and service; works for open and closed manifests. */
export async function printCustomReport(db: AppDb, auth: AuthContext, ids: readonly string[], store: FileStore = fileStore()): Promise<EodPrintResult> {
  const groups = [...new Set(ids)].map((id) => resolveGroup(db, auth.scope, id));
  const reports = groups.map((g) => reportOf(db, g.row, g.row.manifestId, g.pendingIds, g.row.closeDate));
  const bytes = await renderCustomReport(reports);
  const fileId = storePdf(db, store, auth, `Custom EOD Report ${fileStamp()}.pdf`, bytes, null);
  return { succeeded: groups.map((g) => g.row.id), failed: [], fileId };
}

/** Parameters of the standalone Print Custom Report dialog (Logiwa parity: date range, carrier, client). */
export interface CustomReportParams {
  readonly from: string; // YYYY-MM-DD, warehouse-local ship date
  readonly to: string;
  readonly carrierCodes?: readonly string[];
  readonly warehouseCodes?: readonly string[];
  readonly clientName?: string | null;
}

/** Pure: the EOD rows a custom report covers (ship date in range, optional carrier / warehouse). */
export function selectCustomReportRows(rows: readonly EodRow[], p: CustomReportParams): EodRow[] {
  const [from, to] = p.from <= p.to ? [p.from, p.to] : [p.to, p.from];
  return rows
    .filter((r) => r.shipDate >= from && r.shipDate <= to)
    .filter((r) => !p.carrierCodes?.length || p.carrierCodes.includes(r.carrierCode))
    .filter((r) => !p.warehouseCodes?.length || p.warehouseCodes.includes(r.warehouseCode))
    .sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.carrierPrefix.localeCompare(b.carrierPrefix));
}

/** Print Custom Report from parameters — independent of the grid selection. Scope comes from buildEodRows. */
export async function printCustomReportByParams(db: AppDb, auth: AuthContext, params: CustomReportParams, store: FileStore = fileStore()): Promise<EodPrintResult> {
  const rows = selectCustomReportRows(buildEodRows(db, auth.scope), params);
  const reports = rows
    .map((row) => {
      const { pendingIds } = resolveGroup(db, auth.scope, row.id);
      return reportOf(db, row, row.manifestId, pendingIds, row.closeDate, params.clientName ?? null);
    })
    .filter((r) => r.packages.length > 0);
  if (reports.length === 0) throw new AppError("INVALID_STATE", "No active packages match these report parameters.");
  const bytes = await renderCustomReport(reports);
  const fileId = storePdf(db, store, auth, `Custom EOD Report ${params.from} to ${params.to}.pdf`, bytes, null);
  return { succeeded: rows.map((r) => r.id), failed: [], fileId };
}
