import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { likePattern, offsetOf, type ListResult } from "./shared";

const { auditLog, users } = schema;

export interface AuditListParams {
  page: number;
  pageSize: number;
  search?: string;
  entity?: string;
}

export interface AuditListRow {
  id: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string;
  detail: string | null;
  at: string;
}

export function listAuditLog(params: AuditListParams): ListResult<AuditListRow> {
  const conds: Array<SQL | undefined> = [];
  if (params.entity) conds.push(eq(auditLog.entity, params.entity));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(or(like(auditLog.action, p), like(auditLog.detail, p), like(auditLog.entityId, p)));
  }
  const where = and(...conds);
  const rows = db
    .select({
      id: auditLog.id,
      userName: users.name,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      detail: auditLog.detail,
      at: auditLog.at,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(where)
    .orderBy(desc(auditLog.at))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize))
    .all();
  const total = db.select({ n: count() }).from(auditLog).where(where).get()?.n ?? 0;
  return { rows, total };
}
