/**
 * Scheduled report delivery (M13). A schedule is a saved report view (grid key + grid query,
 * i.e. the filters, sort and search the user had on screen) delivered daily or weekly as an
 * XLSX or CSV file: the file lands in Excel Export History and a download link is emailed to
 * the recipients through the company mailer (`sendCompanyMail`; in development the message is
 * written to the server log).
 *
 * Storage: one `user_grid_prefs` row per owner under the key `report-schedules` (the JSON
 * holds `schedules[]`), so no schema change is needed. Runs as the owner, with the owner's
 * scope and permissions at delivery time: a schedule never shows data its owner cannot see.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError, toAppError, validationError } from "@/server/api/errors";
import { buildAuthContext, type AuthContext } from "@/server/auth/context";
import { can } from "@/server/auth/permissions";
import type { SessionUser } from "@/server/auth/session-store";
import { backgroundTasks, userGridPrefs, users } from "@/server/db/schema";
import { buildXlsx } from "@/server/exports/xlsx";
import { EXPORT_PAGE_SIZE, exportFileName, MAX_EXPORT_ROWS } from "@/server/exports/runner";
import type { ExportRow } from "@/server/exports/types";
import { fileStore, type FileStore } from "@/server/files/files";
import { log } from "@/server/log";
import { parseGridQuery } from "@/server/query/grid-query";
import { isValidTimeZone, localMidnightUtc, localParts, zoneOffsetMs } from "@/server/scheduler/timezone";
import { exportColumnsOf, type ReportDef } from "@/lib/grid-defs/reports/types";
import { CHANNEL_SALES_DEF, ORDER_INVENTORY_DEF } from "@/lib/grid-defs/reports/orders";
import { REPLENISHMENT_DEF, SERIAL_RECEIPTS_DEF, SERIAL_SHIPMENTS_DEF, SERIAL_TRACKING_DEF, SNAPSHOT_DEF } from "@/lib/grid-defs/reports/inventory";
import { CHANGE_LOG_DEF, MISSING_LOG_DEF, SERIAL_TRANSACTIONS_DEF, TRANSACTION_HISTORY_DEF } from "@/lib/grid-defs/reports/logs";
import { PO_RECEIVING_DEF, USER_PERFORMANCE_DEF } from "@/lib/grid-defs/reports/receiving";
import { AGING_DEF, UTILIZATION_DEF } from "@/lib/grid-defs/reports/analysis";
import { ORDER_LINES_DEF } from "@/lib/grid-defs/reports/order-lines";
import { sendCompanyMail } from "./company-mail";
import type { ReportLister } from "./reports-api";
import { reportZoneOffset } from "./reports-grid";
import { listAging, listUtilization } from "./reports-analysis";
import { listChannelSales, listOrderInventory } from "./reports-orders";
import { listReplenishment, listSerialReceipts, listSerialShipments, listSerialTracking, listSnapshot } from "./reports-inventory";
import { listChangeLog, listMissingLog, listSerialTransactions, listTransactions } from "./reports-logs";
import { listPoReceiving, listUserPerformance } from "./reports-receiving";
import { listOrderLines } from "./reports-order-lines";

export const SCHEDULES_PREFS_KEY = "report-schedules";
export const SCHEDULE_FREQUENCIES = ["daily", "weekly"] as const;
export const SCHEDULE_FORMATS = ["xlsx", "csv"] as const;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MAX_SCHEDULES_PER_USER = 25;

/** Every report a schedule can deliver (the M13 report grids). */
export const SCHEDULABLE: ReadonlyMap<string, { readonly def: ReportDef; readonly list: ReportLister }> = new Map(
  ([
    [CHANNEL_SALES_DEF, listChannelSales], [ORDER_INVENTORY_DEF, listOrderInventory], [SERIAL_TRACKING_DEF, listSerialTracking],
    [SERIAL_SHIPMENTS_DEF, listSerialShipments], [SERIAL_RECEIPTS_DEF, listSerialReceipts], [REPLENISHMENT_DEF, listReplenishment],
    [SNAPSHOT_DEF, listSnapshot], [CHANGE_LOG_DEF, listChangeLog], [TRANSACTION_HISTORY_DEF, listTransactions],
    [SERIAL_TRANSACTIONS_DEF, listSerialTransactions], [MISSING_LOG_DEF, listMissingLog], [PO_RECEIVING_DEF, listPoReceiving],
    [USER_PERFORMANCE_DEF, listUserPerformance], [AGING_DEF, listAging], [UTILIZATION_DEF, listUtilization], [ORDER_LINES_DEF, listOrderLines],
  ] as const).map(([def, list]) => [def.gridKey, { def, list: list as ReportLister }]),
);

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 h)");
export const scheduleInputSchema = z.object({
  gridKey: z.string().min(1).max(80),
  name: z.string().trim().min(1, "Name the schedule").max(120),
  query: z.string().max(4000).default(""),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  weekday: z.number().int().min(0).max(6).default(1),
  time: timeSchema,
  timeZone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
  format: z.enum(SCHEDULE_FORMATS).default("xlsx"),
  recipients: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses")).min(1, "Add at least one recipient").max(20),
  columns: z.array(z.string().max(120)).max(200).optional(),
  active: z.boolean().default(true),
});
export type ScheduleInput = z.input<typeof scheduleInputSchema>;
export const schedulePatchSchema = scheduleInputSchema.partial().omit({ gridKey: true });

export interface ReportSchedule {
  readonly id: string;
  readonly gridKey: string;
  readonly reportTitle: string;
  readonly name: string;
  readonly query: string;
  readonly frequency: (typeof SCHEDULE_FREQUENCIES)[number];
  readonly weekday: number;
  readonly time: string;
  readonly timeZone: string;
  readonly format: (typeof SCHEDULE_FORMATS)[number];
  readonly recipients: readonly string[];
  readonly columns?: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly nextRunAt: string;
  readonly lastRunAt: string | null;
  readonly lastStatus: "ok" | "error" | null;
  readonly lastMessage: string | null;
  readonly lastTaskId: string | null;
}

export interface ScheduleView extends ReportSchedule {
  readonly ownerId: string;
  readonly ownerName: string;
  readonly mine: boolean;
  /** "Daily at 07:00 (America/New_York)" */
  readonly cadence: string;
}

/* ---------------------------------------------------------------- timing */

const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Next delivery strictly after `after`, at `time` local in `timeZone` (weekly: on `weekday`). */
export function nextRunAfter(s: Pick<ReportSchedule, "frequency" | "weekday" | "time" | "timeZone">, after: Date): Date {
  const [hh, mm] = s.time.split(":").map(Number);
  const today = localParts(after, s.timeZone).date;
  for (let i = 0; i < 15; i += 1) {
    const day = addDays(today, i);
    if (s.frequency === "weekly" && new Date(`${day}T12:00:00Z`).getUTCDay() !== s.weekday) continue;
    const mid = localMidnightUtc(day, s.timeZone);
    const naive = mid.getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000;
    // A DST change between midnight and the delivery time shifts the wall clock: correct for it.
    const at = new Date(naive - (zoneOffsetMs(new Date(naive), s.timeZone) - zoneOffsetMs(mid, s.timeZone)));
    if (at.getTime() > after.getTime()) return at;
  }
  return new Date(after.getTime() + 86_400_000);
}

export function cadenceLabel(s: Pick<ReportSchedule, "frequency" | "weekday" | "time" | "timeZone">): string {
  const day = s.frequency === "weekly" ? `Weekly on ${WEEKDAYS[s.weekday] ?? "Monday"}` : "Daily";
  return `${day} at ${s.time} (${s.timeZone})`;
}

/* --------------------------------------------------------------- storage */

interface StoredPrefs { readonly schedules?: readonly ReportSchedule[] }

function readOwn(db: AppDb, userId: string): ReportSchedule[] {
  const row = db.select({ prefs: userGridPrefs.prefs }).from(userGridPrefs)
    .where(and(eq(userGridPrefs.userId, userId), eq(userGridPrefs.gridKey, SCHEDULES_PREFS_KEY))).get();
  return [...((row?.prefs as unknown as StoredPrefs | undefined)?.schedules ?? [])];
}

function writeOwn(db: AppDb, userId: string, schedules: readonly ReportSchedule[]): void {
  // The row keeps the grid-prefs shape so the shared prefs readers never trip over it.
  const prefs = { visible: [], order: [], widths: {}, density: "Small", pageSize: 100, schedules } as unknown as typeof userGridPrefs.$inferInsert.prefs;
  db.insert(userGridPrefs).values({ userId, gridKey: SCHEDULES_PREFS_KEY, prefs })
    .onConflictDoUpdate({ target: [userGridPrefs.userId, userGridPrefs.gridKey], set: { prefs } }).run();
}

function allSchedules(db: AppDb): { ownerId: string; ownerName: string; schedules: ReportSchedule[] }[] {
  const rows = db.all<{ uid: string; name: string; prefs: string }>(sql`
    SELECT p.user_id AS uid, u.name AS name, p.prefs AS prefs FROM user_grid_prefs p JOIN users u ON u.id = p.user_id
    WHERE p.grid_key = ${SCHEDULES_PREFS_KEY} AND u.is_active = 1`);
  return rows.map((r) => {
    let parsed: StoredPrefs = {};
    try { parsed = (typeof r.prefs === "string" ? JSON.parse(r.prefs) : r.prefs) as StoredPrefs; } catch { /* corrupt row: ignore */ }
    return { ownerId: r.uid, ownerName: r.name, schedules: [...(parsed.schedules ?? [])] };
  });
}

const toView = (s: ReportSchedule, ownerId: string, ownerName: string, me: string): ScheduleView => ({ ...s, ownerId, ownerName, mine: ownerId === me, cadence: cadenceLabel(s) });

/** The caller's schedules; supervisors and admins (`settings.users.view`) also see their team's. */
export function listSchedules(db: AppDb, auth: AuthContext, gridKey?: string): ScheduleView[] {
  const team = can(auth, "settings.users.view" as Parameters<typeof can>[1]);
  const out: ScheduleView[] = [];
  for (const o of allSchedules(db)) {
    if (o.ownerId !== auth.user.id && !team) continue;
    for (const s of o.schedules) if (!gridKey || s.gridKey === gridKey) out.push(toView(s, o.ownerId, o.ownerName, auth.user.id));
  }
  return out.sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
}

function validateQuery(query: string): void {
  const parsed = parseGridQuery(new URLSearchParams(query));
  if (parsed.issues.length > 0) {
    const first = parsed.issues[0];
    throw validationError(`Invalid report filters: ${first?.param ?? ""} ${first?.message ?? ""}`.trim());
  }
}

function reportOf(auth: AuthContext, gridKey: string): ReportDef {
  const entry = SCHEDULABLE.get(gridKey);
  if (!entry) throw validationError(`This report cannot be scheduled ("${gridKey}")`, { gridKey: ["Unknown report"] });
  if (!can(auth, entry.def.permission as Parameters<typeof can>[1])) throw new AppError("FORBIDDEN", "You do not have permission to view this report");
  return entry.def;
}

export function createSchedule(db: AppDb, auth: AuthContext, raw: unknown, now: Date = new Date()): ScheduleView {
  const input = scheduleInputSchema.parse(raw);
  const def = reportOf(auth, input.gridKey);
  validateQuery(input.query);
  const own = readOwn(db, auth.user.id);
  if (own.length >= MAX_SCHEDULES_PER_USER) throw validationError(`You can keep up to ${MAX_SCHEDULES_PER_USER} schedules. Delete one first.`);
  const base = {
    id: randomUUID(), gridKey: def.gridKey, reportTitle: def.title, name: input.name, query: input.query,
    frequency: input.frequency, weekday: input.weekday, time: input.time, timeZone: input.timeZone, format: input.format,
    recipients: [...new Set(input.recipients)], ...(input.columns?.length ? { columns: input.columns } : {}), active: input.active,
    createdAt: now.toISOString(), lastRunAt: null, lastStatus: null, lastMessage: null, lastTaskId: null,
  };
  const s: ReportSchedule = { ...base, nextRunAt: nextRunAfter(base, now).toISOString() };
  writeOwn(db, auth.user.id, [...own, s]);
  return toView(s, auth.user.id, auth.user.name, auth.user.id);
}

function ownIndex(db: AppDb, auth: AuthContext, id: string): { own: ReportSchedule[]; i: number } {
  const own = readOwn(db, auth.user.id);
  const i = own.findIndex((s) => s.id === id);
  if (i < 0) throw notFoundError("Schedule");
  return { own, i };
}

export function updateSchedule(db: AppDb, auth: AuthContext, id: string, raw: unknown, now: Date = new Date()): ScheduleView {
  const patch = schedulePatchSchema.parse(raw);
  const { own, i } = ownIndex(db, auth, id);
  const cur = own[i] as ReportSchedule;
  if (patch.query !== undefined) validateQuery(patch.query);
  const merged = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as ReportSchedule;
  const next: ReportSchedule = { ...merged, recipients: [...new Set(merged.recipients)], nextRunAt: nextRunAfter(merged, now).toISOString() };
  own[i] = next;
  writeOwn(db, auth.user.id, own);
  return toView(next, auth.user.id, auth.user.name, auth.user.id);
}

export function deleteSchedule(db: AppDb, auth: AuthContext, id: string): { id: string } {
  const { own, i } = ownIndex(db, auth, id);
  own.splice(i, 1);
  writeOwn(db, auth.user.id, own);
  return { id };
}

/* -------------------------------------------------------------- delivery */

function csvOf(columns: readonly { key: string; label: string }[], rows: readonly ExportRow[]): Uint8Array {
  const cell = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // spreadsheet formula injection guard
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell((r as Record<string, unknown>)[c.key])).join(","))];
  return new TextEncoder().encode(`﻿${lines.join("\r\n")}\r\n`);
}

function ownerAuth(db: AppDb, ownerId: string): AuthContext | null {
  const u = db.select().from(users).where(eq(users.id, ownerId)).get();
  if (!u || !u.isActive) return null;
  const session: SessionUser = {
    id: u.id, email: u.email, name: u.name, role: u.role, userType: u.userType, allClients: u.allClients, isApiUser: u.isApiUser,
    sessionId: "report-schedule", sessionVersion: u.sessionVersion ?? 0, sessionExpiresAt: "",
  } as SessionUser;
  return buildAuthContext(db, session);
}

export interface DeliveryResult { readonly taskId: string | null; readonly rows: number; readonly mailed: boolean; readonly status: "ok" | "error"; readonly message: string }

/**
 * Builds the report file as the owner, records it as an export (Excel Export History and
 * the Transactions tray show it), then emails the download link to every recipient.
 */
export async function deliverSchedule(db: AppDb, ownerId: string, s: ReportSchedule, deps: { readonly now?: Date; readonly store?: FileStore; readonly mail?: typeof sendCompanyMail; readonly baseUrl?: string } = {}): Promise<DeliveryResult> {
  const now = deps.now ?? new Date();
  const auth = ownerAuth(db, ownerId);
  if (!auth) return { taskId: null, rows: 0, mailed: false, status: "error", message: "The schedule's owner is inactive" };
  const entry = SCHEDULABLE.get(s.gridKey);
  if (!entry) return { taskId: null, rows: 0, mailed: false, status: "error", message: "Unknown report" };
  if (!can(auth, entry.def.permission as Parameters<typeof can>[1])) return { taskId: null, rows: 0, mailed: false, status: "error", message: "The owner no longer has access to this report" };
  const task = db.insert(backgroundTasks).values({
    kind: "export", title: `${entry.def.title} export (scheduled: ${s.name})`, gridKey: s.gridKey, query: s.query, status: "started", progress: 1, userId: ownerId,
  }).returning().get();
  const set = (patch: Partial<typeof backgroundTasks.$inferInsert>) => db.update(backgroundTasks).set(patch).where(eq(backgroundTasks.id, task.id)).run();
  try {
    const query = parseGridQuery(new URLSearchParams(s.query)).query;
    const tzOffsetMinutes = reportZoneOffset(db, auth.viewScope.warehouseIds, now);
    const rows: ExportRow[] = [];
    for (let page = 1; ; page += 1) {
      const res = entry.list(db, auth, { ...query, page, pageSize: EXPORT_PAGE_SIZE, tzOffsetMinutes });
      rows.push(...(res.rows as readonly ExportRow[]));
      if (rows.length > MAX_EXPORT_ROWS) throw new AppError("VALIDATION", `Exports are limited to ${MAX_EXPORT_ROWS.toLocaleString("en-US")} rows. Narrow the schedule's filters.`);
      if (res.rows.length === 0 || rows.length >= res.total) break;
    }
    const all = exportColumnsOf(entry.def).filter((c) => c.key !== "action");
    const picked = s.columns?.length ? s.columns.map((k) => all.find((c) => c.key === k)).filter((c): c is (typeof all)[number] => Boolean(c)) : [];
    const columns = picked.length ? picked : all;
    const base = exportFileName(`${entry.def.title} - ${s.name}`, now, s.timeZone);
    const name = s.format === "csv" ? base.replace(/\.xlsx$/i, "") + ".csv" : base;
    const bytes = s.format === "csv" ? csvOf(columns, rows) : await buildXlsx({ name: entry.def.title, columns, rows });
    const file = (deps.store ?? fileStore()).store(db, { name, bytes, purpose: "export", ownerEntityType: "background_task", ownerEntityId: task.id, uploadedBy: ownerId });
    set({ status: "completed", progress: 100, rowCount: rows.length, fileId: file.id, finishedAt: new Date(Math.max(Date.now(), now.getTime())).toISOString() });
    const link = `${deps.baseUrl ?? process.env.APP_URL ?? "http://localhost:3000"}/api/files/${file.id}`;
    const text = [
      `${entry.def.title}: ${s.name}`,
      `${rows.length.toLocaleString("en-US")} rows, ${s.format.toUpperCase()}, ${cadenceLabel(s)}.`,
      "",
      `Download (sign-in required, kept 7 days): ${link}`,
      `Open the report: ${deps.baseUrl ?? process.env.APP_URL ?? "http://localhost:3000"}${entry.def.path.replace(/^\/api/, "")}${s.query ? `?${s.query}` : ""}`,
    ].join("\n");
    const mail = deps.mail ?? sendCompanyMail;
    let mailed = false;
    for (const to of s.recipients) {
      try { mailed = (await mail(db, { to, subject: `[KitStak] ${entry.def.title} - ${s.name}`, text })).delivered || mailed; } catch (e: unknown) { log.warn("scheduled report mail failed", { to, err: e }); }
    }
    return { taskId: task.id, rows: rows.length, mailed, status: "ok", message: `${rows.length} rows sent to ${s.recipients.length} recipient${s.recipients.length === 1 ? "" : "s"}${mailed ? "" : " (email delivery not set up: logged on the server)"}` };
  } catch (error: unknown) {
    const appError = toAppError(error);
    const message = appError.code === "INTERNAL" ? "The scheduled export failed." : appError.message;
    if (appError.code === "INTERNAL") log.error("scheduled report failed", { scheduleId: s.id, err: error });
    set({ status: "error", errorMessage: message, finishedAt: now.toISOString() });
    return { taskId: task.id, rows: 0, mailed: false, status: "error", message };
  }
}

function recordRun(db: AppDb, ownerId: string, id: string, r: DeliveryResult, now: Date, advance: boolean): void {
  const own = readOwn(db, ownerId);
  const i = own.findIndex((x) => x.id === id);
  if (i < 0) return;
  const cur = own[i] as ReportSchedule;
  own[i] = {
    ...cur, lastRunAt: now.toISOString(), lastStatus: r.status, lastMessage: r.message, lastTaskId: r.taskId,
    nextRunAt: advance ? nextRunAfter(cur, now).toISOString() : cur.nextRunAt,
  };
  writeOwn(db, ownerId, own);
}

/** "Send now" from the UI: delivers once without moving the next scheduled run. */
export async function runScheduleNow(db: AppDb, auth: AuthContext, id: string, now: Date = new Date()): Promise<ScheduleView> {
  const { own, i } = ownIndex(db, auth, id);
  const s = own[i] as ReportSchedule;
  const r = await deliverSchedule(db, auth.user.id, s, { now });
  recordRun(db, auth.user.id, id, r, now, false);
  const updated = readOwn(db, auth.user.id).find((x) => x.id === id) ?? s;
  return toView(updated, auth.user.id, auth.user.name, auth.user.id);
}

/** Scheduler tick: delivers every active schedule whose next run is due, then moves it on. */
export async function runDueSchedules(db: AppDb, now: Date = new Date()): Promise<{ readonly delivered: number; readonly failed: number }> {
  let delivered = 0;
  let failed = 0;
  for (const o of allSchedules(db)) {
    for (const s of o.schedules) {
      if (!s.active || Date.parse(s.nextRunAt) > now.getTime()) continue;
      const r = await deliverSchedule(db, o.ownerId, s, { now });
      recordRun(db, o.ownerId, s.id, r, now, true);
      if (r.status === "ok") delivered += 1; else failed += 1;
    }
  }
  return { delivered, failed };
}
