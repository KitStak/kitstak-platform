/** Reads for the billing activity page. Always scoped to one organization, the caller's active one. */
import 'server-only';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { billingAuditLog } from '@kitstak/db/schema';
import { db } from '@/server/db';
import { ACTION_KIND, actionsFor, type ActivityFilter, type ActivityItem, type ActivityKind } from './model';

const columns = {
  id: billingAuditLog.id,
  at: billingAuditLog.createdAt,
  actorLabel: billingAuditLog.actorLabel,
  action: billingAuditLog.action,
  summary: billingAuditLog.summary,
  data: billingAuditLog.data,
};

export async function listActivity(input: {
  orgId: string;
  filter: ActivityFilter;
  limit: number;
  before?: Date;
}): Promise<ActivityItem[]> {
  const limit = Math.min(Math.max(Math.round(input.limit), 1), 5000);
  const actions = actionsFor(input.filter);
  const where = and(
    eq(billingAuditLog.orgId, input.orgId),
    actions ? inArray(billingAuditLog.action, [...actions]) : undefined,
    input.before ? lt(billingAuditLog.createdAt, input.before) : undefined,
  );
  return db.select(columns).from(billingAuditLog).where(where).orderBy(desc(billingAuditLog.createdAt), desc(billingAuditLog.id)).limit(limit);
}

/** How many rows each filter holds, for the numbers on the tabs. One query. */
export async function countActivity(orgId: string): Promise<Readonly<Record<ActivityFilter, number>>> {
  const found = await db
    .select({ action: billingAuditLog.action, count: sql<number>`count(*)::int` })
    .from(billingAuditLog)
    .where(eq(billingAuditLog.orgId, orgId))
    .groupBy(billingAuditLog.action);
  const counts: Record<ActivityFilter, number> = { all: 0, payments: 0, plan: 0, emails: 0 };
  for (const row of found) {
    const kind: ActivityKind = (ACTION_KIND as Readonly<Record<string, ActivityKind>>)[row.action] ?? 'plan';
    counts[kind] += row.count;
    counts.all += row.count;
  }
  return counts;
}
