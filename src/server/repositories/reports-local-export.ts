/**
 * Export As Excel for M13 report grids that are not (yet) in the shared export registry
 * (`src/server/exports/grid-keys.ts` is foundation-owned; RA-R4-1). Same contract as
 * `POST /api/exports`: a `background_tasks` row (kind=export) the Transactions tray and
 * Excel Export History read, then an xlsx built through the report's own lister with the
 * caller's scope. Once a key is registered, `ReportGridPage` switches back to the shared
 * footer export automatically and this path is no longer used for it.
 */
import { eq } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError, toAppError, validationError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { can } from "@/server/auth/permissions";
import { backgroundTasks } from "@/server/db/schema";
import { fileStore, type FileStore } from "@/server/files/files";
import { log } from "@/server/log";
import { parseGridQuery } from "@/server/query/grid-query";
import { buildXlsx } from "@/server/exports/xlsx";
import { EXPORT_PAGE_SIZE, exportFileName, MAX_EXPORT_ROWS, type BackgroundTask } from "@/server/exports/runner";
import { isGridKey } from "@/server/exports/grid-keys";
import type { ExportColumn, ExportRow } from "@/server/exports/types";
import { AGING_DEF, UTILIZATION_DEF } from "@/lib/grid-defs/reports/analysis";
import { ORDER_LINES_DEF } from "@/lib/grid-defs/reports/order-lines";
import { exportColumnsOf, type ReportDef } from "@/lib/grid-defs/reports/types";
import type { ReportLister } from "./reports-api";
import { reportZoneOffset } from "./reports-grid";
import { listAging, listUtilization } from "./reports-analysis";
import { listOrderLines } from "./reports-order-lines";

interface LocalExport { readonly def: ReportDef; readonly list: ReportLister }

/** M13 grids exported through this path while their key is unregistered. */
export const LOCAL_EXPORTS: ReadonlyMap<string, LocalExport> = new Map<string, LocalExport>([
  [AGING_DEF.gridKey, { def: AGING_DEF, list: listAging }],
  [UTILIZATION_DEF.gridKey, { def: UTILIZATION_DEF, list: listUtilization }],
  [ORDER_LINES_DEF.gridKey, { def: ORDER_LINES_DEF, list: listOrderLines }],
]);

/** Grid keys the client should export through `POST /api/reports/exports`. */
export const LOCAL_EXPORT_KEYS: readonly string[] = [...LOCAL_EXPORTS.keys()];

export function isLocalExportKey(gridKey: string): boolean {
  return LOCAL_EXPORTS.has(gridKey) && !isGridKey(gridKey);
}

/** Validates key, permission and query grammar, then records a queued export task. */
export function queueLocalExport(db: AppDb, input: { readonly auth: AuthContext; readonly gridKey: string; readonly query: string }): BackgroundTask {
  const entry = LOCAL_EXPORTS.get(input.gridKey);
  if (!entry) throw validationError(`Unknown report "${input.gridKey}"`, { gridKey: ["Unknown report"] });
  if (!can(input.auth, entry.def.permission as Parameters<typeof can>[1])) throw new AppError("FORBIDDEN", "You do not have permission to export this report");
  const parsed = parseGridQuery(new URLSearchParams(input.query));
  if (parsed.issues.length > 0) {
    const first = parsed.issues[0];
    throw validationError(`Invalid export query: ${first?.param ?? ""} ${first?.message ?? ""}`.trim());
  }
  return db.insert(backgroundTasks).values({
    kind: "export",
    title: `${entry.def.title} export`,
    gridKey: entry.def.gridKey,
    query: input.query,
    status: "queued",
    progress: 0,
    userId: input.auth.user.id,
  }).returning().get();
}

export interface RunLocalExportDeps {
  readonly auth: AuthContext;
  readonly columns?: readonly ExportColumn[];
  readonly timeZone?: string;
  readonly store?: FileStore;
  readonly now?: () => Date;
}

/** Runs a queued local export to completion. Never throws; the task row records the outcome. */
export async function runLocalExport(db: AppDb, taskId: string, deps: RunLocalExportDeps): Promise<BackgroundTask> {
  const now = deps.now ?? (() => new Date());
  const set = (patch: Partial<typeof backgroundTasks.$inferInsert>) => db.update(backgroundTasks).set(patch).where(eq(backgroundTasks.id, taskId)).run();
  const task = db.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).get();
  if (!task || task.kind !== "export") throw notFoundError("Export");
  if (task.status !== "queued") return task;
  set({ status: "started", progress: 1 });
  try {
    const entry = task.gridKey ? LOCAL_EXPORTS.get(task.gridKey) : undefined;
    if (!entry) throw new AppError("VALIDATION", `Unknown report "${task.gridKey ?? ""}"`);
    const query = parseGridQuery(new URLSearchParams(task.query ?? "")).query;
    const tzOffsetMinutes = reportZoneOffset(db, deps.auth.viewScope.warehouseIds);
    const rows: ExportRow[] = [];
    for (let page = 1; ; page += 1) {
      const res = entry.list(db, deps.auth, { ...query, page, pageSize: EXPORT_PAGE_SIZE, tzOffsetMinutes });
      rows.push(...(res.rows as readonly ExportRow[]));
      if (rows.length > MAX_EXPORT_ROWS) throw new AppError("VALIDATION", `Exports are limited to ${MAX_EXPORT_ROWS.toLocaleString("en-US")} rows. Narrow the filters and try again.`);
      if (res.total > 0) set({ progress: Math.min(90, Math.floor((rows.length / res.total) * 90)) });
      if (res.rows.length === 0 || rows.length >= res.total) break;
    }
    const sheetColumns = exportColumnsOf(entry.def).filter((c) => c.key !== "action");
    const known = new Set(sheetColumns.map((c) => c.key));
    // Visible grid columns from the client (order kept), restricted to the report's own columns.
    const requested = (deps.columns ?? []).filter((c) => known.has(c.key)).map((c) => sheetColumns.find((s) => s.key === c.key) ?? c);
    const columns = requested.length > 0 ? requested : sheetColumns;
    const bytes = await buildXlsx({ name: entry.def.title, columns, rows });
    const file = (deps.store ?? fileStore()).store(db, {
      name: exportFileName(entry.def.title, now(), deps.timeZone),
      bytes,
      purpose: "export",
      ownerEntityType: "background_task",
      ownerEntityId: taskId,
      uploadedBy: task.userId,
    });
    set({ status: "completed", progress: 100, rowCount: rows.length, fileId: file.id, finishedAt: now().toISOString() });
  } catch (error: unknown) {
    const appError = toAppError(error);
    const message = appError.code === "INTERNAL" ? "The export failed. Please try again." : appError.message;
    if (appError.code === "INTERNAL") log.error("report export failed", { taskId, gridKey: task.gridKey, err: error });
    set({ status: "error", errorMessage: message, finishedAt: now().toISOString() });
  }
  return db.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).get() ?? task;
}
