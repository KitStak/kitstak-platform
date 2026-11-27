/**
 * The append only activity log (pulse.activity): the audit log and the job activity feed.
 * EVERY mutation in the domain layer calls `logActivity` inside its transaction with a dotted verb:
 *
 *   job.created | job.updated | job.status_changed | job.archived | job.restored | job.deleted | job.duplicated
 *   price.changed | plan.revised | link.added | link.removed
 *   production.logged | production.edited | production.deleted | production.restored
 *   indirect.* | paid_hours.* | material.* | cost.* | revenue.* | service_entry.* (logged, edited, deleted, restored)
 *   client.* | job_type.* | labor_class.* | item.* | service.* | site.* | standard.* | target.* (created, updated, deleted, restored)
 *   rate.changed | shared.moved | day.completed | day.approved | day.sent_back | period.closed | period.reopened
 *   alert_rule.* | alert.updated | view.* | role.changed | money_access.changed | settings.changed | note.added | export.run
 *
 * `before` and `after` are redacted for readers without `money:read` by a field allow list per
 * entity type (never by guessing from key names).
 */
import 'server-only';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { verbLabel } from '@/features/settings/audit-format';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { activity } from '@/server/db/schema';
import { invalid } from '@/server/errors';
import type { ActivityDTO, Page } from '@/lib/types';
import { cleanText, inTx, isoRequired, jsonSafe, type DomainContext } from './_shared';
import { hideLinesInText } from '@/features/alerts/rule-kinds';
import { requirePulse } from './access';
import { assertReadableRefs, liveRefsOnly } from './deleted';
import { getPeople } from './people';

export interface ActivityEntry {
  readonly verb: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly jobId?: string | null;
  readonly clientId?: string | null;
  readonly field?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly meta?: Record<string, unknown>;
  readonly body?: string | null;
}

/** Append one or more events. Call inside the mutation's transaction. */
export const logActivity = scoped(async function logActivity(executor: Executor, ctx: DomainContext, entries: ActivityEntry | readonly ActivityEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? (entries as readonly ActivityEntry[]) : [entries as ActivityEntry];
  if (list.length === 0) return;
  await executor.insert(activity).values(
    list.map((entry) => ({
      orgId: ctx.orgId,
      actorId: ctx.actorKind === 'user' || ctx.actorKind === 'integration' ? ctx.userId : null,
      actorKind: ctx.actorKind,
      verb: entry.verb,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      jobId: entry.jobId ?? null,
      clientId: entry.clientId ?? null,
      field: entry.field ?? null,
      before: entry.before === undefined ? null : jsonSafe(entry.before),
      after: entry.after === undefined ? null : jsonSafe(entry.after),
      meta: (jsonSafe(entry.meta ?? {}) as Record<string, unknown>) ?? {},
      body: entry.body ?? null,
    })),
  );
}, 1);

/** Fields a reader without `money:read` may see in `before` and `after`, per entity type. */
export const ACTIVITY_SAFE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  job: ['number', 'name', 'clientId', 'jobTypeId', 'siteId', 'kind', 'status', 'pricingModel', 'unitLabel', 'plannedUnits', 'materialMethod', 'partsOwner', 'defaultLaborClassId', 'usualCrew', 'standardUph', 'startDate', 'dueDate', 'completedDate', 'poNumber', 'ownerId', 'description', 'kitSku', 'kitName', 'pinnedNote', 'archivedAt'],
  production: ['jobId', 'workDate', 'shift', 'laborClassId', 'unitsGood', 'unitsScrap', 'unitsRework', 'headcount', 'hours', 'overtimeHours', 'setupHours', 'hoursConfirmed', 'note', 'siteId', 'pmTaskId', 'taskUnits'],
  indirect: ['workDate', 'laborClassId', 'reason', 'headcount', 'hours', 'overtimeHours', 'note', 'siteId'],
  paid_hours: ['workDate', 'laborClassId', 'paidHours', 'siteId'],
  material: ['jobId', 'usageDate', 'itemId', 'itemSku', 'itemName', 'quantityUsed', 'quantityScrapped', 'quantityPlanned', 'uom', 'lot', 'suppliedBy', 'note'],
  service_entry: ['vasServiceId', 'clientId', 'jobId', 'workDate', 'quantity', 'laborClassId', 'headcount', 'hours', 'overtimeHours', 'note'],
  client: ['code', 'name', 'status', 'contactName', 'contactEmail', 'phone', 'partsOwner', 'notes', 'color'],
  job_type: ['code', 'name', 'unitLabel', 'defaultPricingModel', 'defaultLaborClassId', 'defaultStandardUph', 'color', 'icon', 'position', 'archivedAt'],
  labor_class: ['code', 'name', 'kind', 'isDefault', 'color', 'archivedAt'],
  item: ['sku', 'name', 'uom', 'suppliedBy', 'clientId'],
  service: ['code', 'name', 'unitLabel', 'billing', 'standardUph', 'defaultLaborClassId', 'color', 'active'],
  site: ['code', 'name', 'timezone', 'isDefault', 'archivedAt'],
  standard: ['jobTypeId', 'clientId', 'vasServiceId', 'laborClassId', 'unitsPerLaborHour', 'effectiveFrom', 'basis', 'note'],
  day: ['status', 'note', 'flags'],
  period: ['status', 'reopenReason'],
  alert_rule: ['name', 'kind', 'severity', 'enabled', 'notifyRoles', 'notifyUserIds', 'scope'],
  alert: ['status', 'snoozedUntil', 'assignedTo'],
  view: ['name', 'page', 'shared', 'isDefault'],
  member_role: ['role', 'seesMoney'],
  link: ['targetType', 'targetId', 'importsTime'],
  note: [],
};

function redact(entityType: string, value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = ACTIVITY_SAFE_FIELDS[entityType];
  if (!allowed) return null;
  const out: Record<string, unknown> = {};
  for (const key of allowed) if (key in (value as Record<string, unknown>)) out[key] = (value as Record<string, unknown>)[key];
  // Older rule names can hold the line of the rule ("under $2,000"). The line is money, so it is taken out.
  if (entityType === 'alert_rule' && typeof out.name === 'string') out.name = hideLinesInText(out.name);
  return Object.keys(out).length > 0 ? out : null;
}

/** Verbs whose meta holds money (shared cost moved, rate previews): dropped for no money readers. */
const MONEY_META_VERBS = new Set(['shared.moved', 'rate.changed', 'price.changed', 'plan.revised', 'period.closed']);

export interface ActivityFilters {
  readonly jobId?: string | null;
  readonly clientId?: string | null;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly actorId?: string | null;
  readonly verbPrefix?: string | null;
  /** Free text: matches the action, the record type, a note and (for money readers) the before and after values. */
  readonly q?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly cursor?: string | null;
  readonly limit?: number;
}

/** The audit feed, newest first, with a `createdAt|id` cursor. */
export const listActivity = scoped(async function listActivity(ctx: DomainContext, filters: ActivityFilters = {}): Promise<Page<ActivityDTO>> {
  const access = await requirePulse(ctx, 'pulse:read');
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  // The history of a deleted job or client is for a person who may manage jobs (deleted.ts).
  const seesDeletedRows = await assertReadableRefs(
    ctx,
    { jobId: filters.jobId ?? (filters.entityType === 'job' ? filters.entityId : null), clientId: filters.clientId ?? (filters.entityType === 'client' ? filters.entityId : null) },
    access,
  );
  const where: SQL[] = [eq(activity.orgId, ctx.orgId)];
  if (!seesDeletedRows) where.push(liveRefsOnly({ job: activity.jobId, client: activity.clientId }));
  if (filters.jobId) where.push(eq(activity.jobId, filters.jobId));
  if (filters.clientId) where.push(eq(activity.clientId, filters.clientId));
  if (filters.entityType) where.push(eq(activity.entityType, filters.entityType));
  if (filters.entityId) where.push(eq(activity.entityId, filters.entityId));
  if (filters.actorId) where.push(eq(activity.actorId, filters.actorId));
  if (filters.verbPrefix) where.push(sql`${activity.verb} like ${`${filters.verbPrefix.replace(/[%_]/g, '')}%`}`);
  if (filters.q && filters.q.trim() !== '') {
    const like = `%${filters.q.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    // People search for the words on the screen ("Undid an import", "Changed a role") and for a name,
    // so the stored action codes are matched through their on screen words too.
    const needle = filters.q.trim().toLowerCase();
    const known = await db.selectDistinct({ verb: activity.verb }).from(activity).where(eq(activity.orgId, ctx.orgId));
    const worded = known.map((row) => row.verb).filter((verb) => verbLabel(verb).toLowerCase().includes(needle));
    const byWords = worded.length > 0 ? sql` or ${inArray(activity.verb, worded)}` : sql``;
    const byName = sql` or ${activity.actorId} in (select m.user_id from core.member m join core."user" u on u.id = m.user_id where m.organization_id = ${ctx.orgId} and u.name ilike ${like})`;
    where.push(
      access.seesMoney
        ? sql`(${activity.verb} ilike ${like} or ${activity.entityType} ilike ${like} or ${activity.body} ilike ${like} or ${activity.before}::text ilike ${like} or ${activity.after}::text ilike ${like} or ${activity.meta}::text ilike ${like}${byWords}${byName})`
        : sql`(${activity.verb} ilike ${like} or ${activity.entityType} ilike ${like} or ${activity.body} ilike ${like}${byWords}${byName})`,
    );
  }
  if (filters.from) where.push(gte(activity.createdAt, new Date(`${filters.from}T00:00:00Z`)));
  if (filters.to) where.push(lte(activity.createdAt, new Date(`${filters.to}T23:59:59.999Z`)));
  if (filters.cursor) {
    const [at, id] = filters.cursor.split('|');
    const when = new Date(at ?? '');
    if (Number.isNaN(when.getTime()) || !id) throw invalid('That page link is not valid any more. Start from the top.');
    where.push(sql`(${activity.createdAt}, ${activity.id}) < (${when.toISOString()}::timestamptz, ${id}::uuid)`);
  }
  const found = await db
    .select()
    .from(activity)
    .where(and(...where))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(limit + 1);
  const page = found.slice(0, limit);
  const people = await getPeople(page.map((row) => row.actorId).filter((id): id is string => Boolean(id)));
  const items = page.map((row): ActivityDTO => {
    const hide = !access.seesMoney;
    return {
      id: row.id,
      actor: row.actorId ? (people.get(row.actorId) ?? null) : null,
      actorKind: row.actorKind,
      verb: row.verb,
      entityType: row.entityType,
      entityId: row.entityId,
      jobId: row.jobId,
      clientId: row.clientId,
      field: row.field,
      before: hide ? redact(row.entityType, row.before) : row.before,
      after: hide ? redact(row.entityType, row.after) : row.after,
      meta: hide && MONEY_META_VERBS.has(row.verb) ? {} : row.meta,
      body: row.body,
      createdAt: isoRequired(row.createdAt),
    };
  });
  const last = page[page.length - 1];
  return { items, nextCursor: found.length > limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null };
});

/** A note on a job or a client (the composer on the Activity tab). */
export const addNote = scoped(async function addNote(ctx: DomainContext, input: { jobId?: string | null; clientId?: string | null; body: string }): Promise<{ id: string }> {
  await requirePulse(ctx, 'production:log');
  const body = cleanText(input.body);
  if (!body) throw invalid('Write a note first.', { body: 'Write a note first.' });
  if (!input.jobId && !input.clientId) throw invalid('A note needs a job or a client.');
  return inTx(async (tx) => {
    if (input.jobId) {
      const found = await tx.execute(sql`select 1 from pulse.jobs where org_id = ${ctx.orgId} and id = ${input.jobId}`);
      if (found.rows.length === 0) throw invalid('That job does not exist in this workspace.');
    }
    if (input.clientId) {
      const found = await tx.execute(sql`select 1 from pulse.clients where org_id = ${ctx.orgId} and id = ${input.clientId}`);
      if (found.rows.length === 0) throw invalid('That client does not exist in this workspace.');
    }
    const [row] = await tx
      .insert(activity)
      .values({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorKind: ctx.actorKind,
        verb: 'note.added',
        entityType: 'note',
        jobId: input.jobId ?? null,
        clientId: input.clientId ?? null,
        body,
      })
      .returning({ id: activity.id });
    return { id: row!.id };
  });
});

/** Ids of activity rows for tests and exports. */
export const countActivity = scoped(async function countActivity(ctx: DomainContext, verbs: readonly string[], since?: Date): Promise<number> {
  const where: SQL[] = [eq(activity.orgId, ctx.orgId)];
  if (verbs.length > 0) where.push(inArray(activity.verb, [...verbs]));
  if (since) where.push(gte(activity.createdAt, since));
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(activity).where(and(...where));
  return row?.n ?? 0;
});

