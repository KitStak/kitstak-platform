/**
 * Async xlsx export runner (BUILD_PLAN F6 `exports/`).
 *
 *   const task = queueExport(db, { auth, gridKey: "orders-backlog", query: "f.status=in:Open" });
 *   after(() => runExport(db, task.id, { auth, listFetcher, columns }));   // F7 POST /api/exports
 *
 * `queueExport` writes a `background_tasks` row (`kind=export`, `queued`) that the header
 * Transactions tray and Export History read. `runExport` resolves the module provider for
 * the gridKey (or the generic fallback), pages through the rows, writes a styled xlsx to
 * file storage (expires after 7 days) and completes the task. Failures set `error` with a
 * user-safe message; they never throw out of `runExport`.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError, toAppError, validationError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { can } from "@/server/auth/permissions";
import { backgroundTasks, files, warehouses } from "@/server/db/schema";
import { DEFAULT_WAREHOUSE_TIME_ZONE } from "@/lib/context-label";
import { fileStore, type FileStore } from "@/server/files/files";
import { log } from "@/server/log";
import { parseGridQuery } from "@/server/query/grid-query";
import { createGenericProvider } from "./generic";
import { getGridExportDef } from "./grid-keys";
import { getModuleExportProvider } from "./providers";
import type { ExportColumn, ExportContext, ExportProvider, ExportRow, GridExportDef, ListFetcher } from "./types";
import { EXPORT_COLUMN_TYPES } from "./types";
import { buildXlsx, inferColumns } from "./xlsx";

export const EXPORT_PAGE_SIZE = 1000;
export const MAX_EXPORT_ROWS = 100_000;
export const MAX_QUERY_LENGTH = 8000;

export type BackgroundTask = typeof backgroundTasks.$inferSelect;

export const exportColumnsSchema = z.array(z.object({
  key: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.]+$/),
  label: z.string().min(1).max(120),
  type: z.enum(EXPORT_COLUMN_TYPES).optional(),
})).max(200);

/** True for an IANA zone the runtime knows (`America/Chicago`). */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const queueExportSchema = z.object({
  gridKey: z.string().min(1).max(80),
  query: z.string().max(MAX_QUERY_LENGTH).default(""),
  columns: exportColumnsSchema.optional(),
  /** The requester's IANA time zone; the file name is stamped in it. */
  timeZone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone").optional(),
});

export interface QueueExportInput {
  readonly auth: AuthContext;
  readonly gridKey: string;
  readonly query: string;
}

/** Validates the gridKey, permission and query grammar, then records a queued export. */
export function queueExport(db: AppDb, input: QueueExportInput): BackgroundTask {
  const def = getGridExportDef(input.gridKey);
  if (!def) throw validationError(`Unknown grid "${input.gridKey}"`, { gridKey: ["Unknown grid"] });
  if (!can(input.auth, def.permission)) throw new AppError("FORBIDDEN", "You do not have permission to export this list");
  const parsed = parseGridQuery(new URLSearchParams(input.query));
  if (parsed.issues.length > 0) {
    const first = parsed.issues[0];
    throw validationError(`Invalid export query: ${first?.param ?? ""} ${first?.message ?? ""}`.trim());
  }
  return db.insert(backgroundTasks).values({
    kind: "export",
    title: `${def.title} export`,
    gridKey: def.gridKey,
    query: input.query,
    status: "queued",
    progress: 0,
    userId: input.auth.user.id,
  }).returning().get();
}

export interface RunExportDeps {
  readonly auth: AuthContext;
  readonly listFetcher?: ListFetcher;
  /** Visible grid columns from the client (order preserved). */
  readonly columns?: readonly ExportColumn[];
  readonly store?: FileStore;
  readonly now?: () => Date;
  /** IANA zone for the file-name stamp (defaults to UTC). */
  readonly timeZone?: string;
  /** Test hook: overrides provider resolution. */
  readonly provider?: ExportProvider;
}

export function resolveExportProvider(def: GridExportDef): ExportProvider {
  return getModuleExportProvider(def.gridKey) ?? createGenericProvider(def);
}

function setTask(db: AppDb, id: string, patch: Partial<typeof backgroundTasks.$inferInsert>): void {
  db.update(backgroundTasks).set(patch).where(eq(backgroundTasks.id, id)).run();
}

/**
 * Pages through the provider until the reported total is reached. Endpoints may cap the
 * page size below the one requested, so a short page only ends the run when no total is
 * known; a max-page guard stops endpoints that ignore `page` from looping.
 */
async function collectRows(ctx: ExportContext, provider: ExportProvider, onProgress: (pct: number) => void): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  let maxPages = Number.POSITIVE_INFINITY;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await provider.fetchPage(ctx, page, EXPORT_PAGE_SIZE);
    rows.push(...result.rows);
    if (rows.length > MAX_EXPORT_ROWS) {
      throw new AppError("VALIDATION", `Exports are limited to ${MAX_EXPORT_ROWS.toLocaleString("en-US")} rows. Narrow the filters and try again.`);
    }
    const total = result.total;
    if (page === 1 && total !== undefined && result.rows.length > 0) maxPages = Math.ceil(total / result.rows.length);
    if (total !== undefined && total > 0) onProgress(Math.min(90, Math.floor((rows.length / total) * 90)));
    const done = result.rows.length === 0 || (total !== undefined ? rows.length >= total : result.rows.length < EXPORT_PAGE_SIZE);
    if (done) return rows;
  }
  return rows;
}


/**
 * Time zone for export file names: the caller's browser zone when valid, else the working
 * context warehouse's zone (else the first warehouse in scope) — never raw UTC, so the
 * name matches the local time the Transactions tray shows.
 */
export function resolveExportTimeZone(db: AppDb, auth: Pick<AuthContext, "context" | "scope">, requested?: string): string {
  if (requested && isValidTimeZone(requested)) return requested;
  const warehouseId = auth.context.warehouseId ?? auth.scope.warehouseIds[0] ?? null;
  const zone = warehouseId ? db.select({ timezone: warehouses.timezone }).from(warehouses).where(eq(warehouses.id, warehouseId)).get()?.timezone : undefined;
  return zone && isValidTimeZone(zone) ? zone : DEFAULT_WAREHOUSE_TIME_ZONE;
}

/** `Shipment Orders 2026-11-05 2228.xlsx`, stamped in `timeZone` (UTC when omitted). */
export function exportFileName(title: string, at: Date, timeZone = "UTC"): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${title} ${part("year")}-${part("month")}-${part("day")} ${part("hour")}${part("minute")}.xlsx`;
}

/** Runs a queued export to completion. Never throws; the task row records the outcome. */
export async function runExport(db: AppDb, taskId: string, deps: RunExportDeps): Promise<BackgroundTask> {
  const now = deps.now ?? (() => new Date());
  const task = db.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).get();
  if (!task || task.kind !== "export") throw notFoundError("Export");
  if (task.status !== "queued") return task;

  setTask(db, taskId, { status: "started", progress: 1 });
  try {
    const def = task.gridKey ? getGridExportDef(task.gridKey) : undefined;
    if (!def) throw new AppError("VALIDATION", `Unknown grid "${task.gridKey ?? ""}"`);
    const rawQuery = task.query ?? "";
    const ctx: ExportContext = {
      db,
      auth: deps.auth,
      gridKey: def.gridKey,
      query: parseGridQuery(new URLSearchParams(rawQuery)).query,
      rawQuery,
      ...(deps.listFetcher ? { listFetcher: deps.listFetcher } : {}),
    };
    const provider = deps.provider ?? resolveExportProvider(def);
    const rows = await collectRows(ctx, provider, (progress) => setTask(db, taskId, { progress }));
    const columns = deps.columns && deps.columns.length > 0 ? deps.columns : provider.columns ?? inferColumns(rows);
    const bytes = await buildXlsx({ name: def.title, columns, rows });
    const file = (deps.store ?? fileStore()).store(db, {
      name: exportFileName(def.title, now(), deps.timeZone),
      bytes,
      purpose: "export",
      ownerEntityType: "background_task",
      ownerEntityId: taskId,
      uploadedBy: task.userId,
    });
    setTask(db, taskId, { status: "completed", progress: 100, rowCount: rows.length, fileId: file.id, finishedAt: now().toISOString() });
  } catch (error: unknown) {
    const appError = toAppError(error);
    const message = appError.code === "INTERNAL" ? "The export failed. Please try again." : appError.message;
    if (appError.code === "INTERNAL") log.error("export failed", { taskId, gridKey: task.gridKey, err: error });
    else log.warn("export rejected", { taskId, gridKey: task.gridKey, code: appError.code, message: appError.message });
    setTask(db, taskId, { status: "error", errorMessage: message, finishedAt: now().toISOString() });
  }
  return db.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).get() ?? task;
}

export interface ExportHistoryRow {
  readonly id: string;
  readonly title: string;
  readonly gridKey: string | null;
  readonly status: BackgroundTask["status"];
  readonly progress: number;
  readonly rowCount: number | null;
  readonly errorMessage: string | null;
  readonly fileId: string | null;
  readonly fileName: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

/** Export History for one user (newest first). `userId` null = all users (admin report). */
export function listExportHistory(
  db: AppDb,
  options: { readonly userId: string | null; readonly page: number; readonly pageSize: number },
): { readonly rows: ExportHistoryRow[]; readonly total: number } {
  const where = options.userId
    ? and(eq(backgroundTasks.kind, "export"), eq(backgroundTasks.userId, options.userId))
    : eq(backgroundTasks.kind, "export");
  const total = db.select({ n: sql<number>`count(*)` }).from(backgroundTasks).where(where).get()?.n ?? 0;
  const rows = db.select({
    id: backgroundTasks.id,
    title: backgroundTasks.title,
    gridKey: backgroundTasks.gridKey,
    status: backgroundTasks.status,
    progress: backgroundTasks.progress,
    rowCount: backgroundTasks.rowCount,
    errorMessage: backgroundTasks.errorMessage,
    fileId: backgroundTasks.fileId,
    fileName: files.name,
    createdAt: backgroundTasks.createdAt,
    finishedAt: backgroundTasks.finishedAt,
  }).from(backgroundTasks)
    .leftJoin(files, eq(files.id, backgroundTasks.fileId))
    .where(where)
    .orderBy(desc(backgroundTasks.createdAt))
    .limit(options.pageSize)
    .offset((Math.max(1, options.page) - 1) * options.pageSize)
    .all();
  return { rows, total };
}

/** Marks exports stuck in queued/started (e.g. the server restarted mid-run) as failed. */
export function failStaleExports(db: AppDb, olderThan: Date, now: Date = new Date()): number {
  const stale = db.select({ id: backgroundTasks.id }).from(backgroundTasks).where(and(
    eq(backgroundTasks.kind, "export"),
    inArray(backgroundTasks.status, ["queued", "started"]),
    lt(backgroundTasks.createdAt, olderThan.toISOString()),
  )).all();
  if (stale.length === 0) return 0;
  db.update(backgroundTasks).set({
    status: "error",
    errorMessage: "The export was interrupted. Please run it again.",
    finishedAt: now.toISOString(),
  }).where(inArray(backgroundTasks.id, stale.map((row) => row.id))).run();
  return stale.length;
}
