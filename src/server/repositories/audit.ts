/**
 * Audit Log repository (M14): security events from `audit_log` (sign-ins, CSRF rejects,
 * permission denials, user / role changes, session revocations) with the grid grammar.
 * Targets are resolved to emails / role names so the grid never shows raw ids.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import * as s from "@/server/db/schema";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { AUDIT_FIELDS, AUDIT_SEARCH_FIELDS, AUDIT_SORT_FIELDS, auditActionLabel, auditCategory, type AuditCategory } from "@/lib/grid-defs/admin/audit";
import { lookupByType } from "@/lib/grid-defs/admin/lookups";
import { getPrintType } from "@/server/print/catalog";
import { compileGrid, qc, type GridBinding } from "./users-shared";

const a = s.auditLog;

const categorySql = sql<string>`CASE
  WHEN ${qc(a.action)} LIKE 'auth.login%' THEN 'Sign-in'
  WHEN ${qc(a.action)} LIKE 'auth.logout%' OR ${qc(a.action)} LIKE 'session.%' THEN 'Session'
  WHEN ${qc(a.action)} LIKE 'auth.password%' OR ${qc(a.action)} = 'user.password_reset' THEN 'Password'
  WHEN ${qc(a.action)} LIKE 'security.csrf%' THEN 'CSRF rejected'
  WHEN ${qc(a.action)} LIKE 'security.permission%' THEN 'Permission denied'
  WHEN ${qc(a.action)} LIKE 'user.%' THEN 'User change'
  WHEN ${qc(a.action)} LIKE 'role.%' THEN 'Role change'
  WHEN ${qc(a.action)} LIKE 'company.%' OR ${qc(a.action)} LIKE 'app.%' OR ${qc(a.action)} LIKE 'printout.%' OR ${qc(a.action)} LIKE 'screen_config.%' OR ${qc(a.action)} LIKE 'lookup.%' OR ${qc(a.action)} LIKE 'sequence.%' THEN 'Settings change'
  ELSE 'Other' END`;

const userNameSql = sql<string | null>`(SELECT x.name FROM users x WHERE x.id = ${qc(a.userId)})`;
const userEmailSql = sql<string | null>`COALESCE((SELECT x.email FROM users x WHERE x.id = ${qc(a.userId)}), json_extract(${qc(a.detail)}, '$.email'))`;
const entityLabelSql = sql<string | null>`CASE
  WHEN ${qc(a.entity)} = 'user' THEN COALESCE((SELECT x.email FROM users x WHERE x.id = ${qc(a.entityId)}), ${qc(a.entityId)})
  WHEN ${qc(a.entity)} = 'role' THEN COALESCE((SELECT x.name FROM roles x WHERE x.id = ${qc(a.entityId)}), json_extract(${qc(a.detail)}, '$.name'), 'Deleted role')
  WHEN ${qc(a.entity)} = 'app' THEN COALESCE((SELECT x.name FROM apps x WHERE x.key = ${qc(a.entityId)}), ${qc(a.entityId)})
  WHEN ${qc(a.entity)} = 'company' THEN 'Company settings'
  WHEN ${qc(a.entity)} = 'printout' THEN COALESCE((SELECT x.name FROM printout_templates x WHERE x.id = ${qc(a.entityId)}), json_extract(${qc(a.detail)}, '$.name'), 'Deleted printout')
  ELSE COALESCE(json_extract(${qc(a.detail)}, '$.name'), ${qc(a.entityId)}) END`;

const AUDIT_SQL: Readonly<Record<string, SQL>> = {
  at: sql`${qc(a.at)}`,
  category: categorySql,
  action: sql`${qc(a.action)}`,
  outcome: sql`${qc(a.outcome)}`,
  userId: sql`${qc(a.userId)}`,
  userName: userNameSql,
  userEmail: userEmailSql,
  ip: sql`${qc(a.ip)}`,
  entityLabel: entityLabelSql,
};

const BINDING: GridBinding = {
  exprs: AUDIT_SQL, fields: AUDIT_FIELDS, sortable: AUDIT_SORT_FIELDS, search: AUDIT_SEARCH_FIELDS,
  defaultSort: [{ field: "at", dir: "desc" }], tiebreaker: a.id,
};

export interface AuditRow {
  readonly id: string;
  readonly at: string;
  readonly action: string;
  readonly actionLabel: string;
  readonly category: AuditCategory;
  readonly outcome: "success" | "failure";
  readonly userName: string | null;
  readonly userEmail: string | null;
  readonly entity: string;
  readonly entityLabel: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly detail: string | null;
  /** Human summary of the detail JSON ("reason: bad password · method: POST"). */
  readonly summary: string;
  /** Events collapsed into this row (1 = not grouped). */
  readonly repeatCount: number;
}

const SKIP_DETAIL = new Set(["email", "name"]);

/** Detail values shown with their human label (a lookup type key reads as its Data Setup noun). */
function detailValue(key: string, v: unknown): unknown {
  if (key === "type" && typeof v === "string") return lookupByType(v)?.noun ?? getPrintType(v)?.name ?? v;
  return v;
}

export function summarizeDetail(detail: string | null): string {
  if (!detail) return "";
  try {
    const raw = JSON.parse(detail) as Record<string, unknown>;
    const parsed = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, detailValue(k, v)]));
    return Object.entries(parsed)
      .filter(([k, v]) => !SKIP_DETAIL.has(k) && v !== null && v !== undefined && v !== "" && !/Id$/.test(k))
      .map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${Array.isArray(v) ? v.join(", ") || "none" : typeof v === "object" ? JSON.stringify(v) : String(v).replace(/_/g, " ")}`)
      .join(" · ");
  } catch {
    return detail.slice(0, 200);
  }
}

/** Repeat group: same action, user, IP, outcome and detail within one calendar day (UTC). */
const REPEAT_PARTITION = "x.action, COALESCE(x.user_id, ''), COALESCE(x.ip, ''), x.outcome, COALESCE(x.detail, ''), substr(x.at, 1, 10)";
/** Keeps only the newest event of each repeat group ("Group repeats", on by default). */
const latestOfGroupSql = sql`${qc(a.id)} IN (SELECT id FROM (SELECT x.id AS id, ROW_NUMBER() OVER (PARTITION BY ${sql.raw(REPEAT_PARTITION)} ORDER BY x.at DESC, x.id DESC) AS rn FROM audit_log x) WHERE rn = 1)`;
const repeatCountSql = sql<number>`(SELECT COUNT(*) FROM audit_log x WHERE x.action = ${qc(a.action)} AND COALESCE(x.user_id, '') = COALESCE(${qc(a.userId)}, '') AND COALESCE(x.ip, '') = COALESCE(${qc(a.ip)}, '') AND x.outcome = ${qc(a.outcome)} AND COALESCE(x.detail, '') = COALESCE(${qc(a.detail)}, '') AND substr(x.at, 1, 10) = substr(${qc(a.at)}, 1, 10))`;

export interface AuditListOptions {
  readonly groupRepeats?: boolean;
  /** Exact-match filters (`?entityId=` / `?entity=` or `?entityType=`). */
  readonly entityId?: string | null;
  readonly entity?: string | null;
}

export function listAuditLog(db: AppDb, query: GridQuery, opts: AuditListOptions = {}): { rows: AuditRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [
    opts.groupRepeats ? latestOfGroupSql : undefined,
    opts.entityId ? sql`${a.entityId} = ${opts.entityId}` : undefined,
    opts.entity ? sql`${a.entity} = ${opts.entity}` : undefined,
  ]);
  const result = paginate(
    db.select({
      id: a.id, at: a.at, action: a.action, outcome: a.outcome, entity: a.entity, ip: a.ip, userAgent: a.userAgent, detail: a.detail,
      category: categorySql, userName: userNameSql, userEmail: userEmailSql, entityLabel: entityLabelSql,
      repeatCount: opts.groupRepeats ? repeatCountSql : sql<number>`1`,
    }).from(a).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(a).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  const rows = result.rows.map((r) => ({
    ...r,
    category: (r.category as AuditCategory) ?? auditCategory(r.action),
    actionLabel: auditActionLabel(r.action),
    summary: summarizeDetail(r.detail),
  })) as AuditRow[];
  return { rows, total: result.total };
}

/** Counters for the page header strip (last 24 hours). */
export function auditStats(db: AppDb, now: Date = new Date()): { signIns: number; failedSignIns: number; denied: number; csrf: number } {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const row = db.get<{ signIns: number; failedSignIns: number; denied: number; csrf: number }>(sql`SELECT
    SUM(CASE WHEN action = 'auth.login' AND outcome = 'success' THEN 1 ELSE 0 END) AS signIns,
    SUM(CASE WHEN action LIKE 'auth.login%' AND outcome = 'failure' THEN 1 ELSE 0 END) AS failedSignIns,
    SUM(CASE WHEN action LIKE 'security.permission%' THEN 1 ELSE 0 END) AS denied,
    SUM(CASE WHEN action LIKE 'security.csrf%' THEN 1 ELSE 0 END) AS csrf
    FROM audit_log WHERE at >= ${since}`);
  return { signIns: row?.signIns ?? 0, failedSignIns: row?.failedSignIns ?? 0, denied: row?.denied ?? 0, csrf: row?.csrf ?? 0 };
}
