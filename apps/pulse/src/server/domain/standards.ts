/** Target pace rows (pulse.standards) and goals (pulse.targets). */
import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { standards, targets } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { StandardBasis, StreamSource, TargetMetric, TargetScope } from '@/lib/constants';
import type { PaceSuggestionDTO, StandardDTO, TargetDTO } from '@/lib/types';
import { assertVersion, cleanText, diff, inTx, isUuid, rows, type DomainContext } from './_shared';
import { softDeleteRow } from './_crud';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { recomputeJobs } from './job-stats';

type StandardRow = typeof standards.$inferSelect;
type TargetRow = typeof targets.$inferSelect;

function toStandardDTO(row: StandardRow): StandardDTO {
  return { id: row.id, jobTypeId: row.jobTypeId, clientId: row.clientId, vasServiceId: row.vasServiceId, laborClassId: row.laborClassId, unitsPerLaborHour: row.unitsPerLaborHour, effectiveFrom: row.effectiveFrom, basis: row.basis as StandardBasis, note: row.note, version: row.version };
}

export async function listStandards(ctx: DomainContext, filters: { jobTypeId?: string | null; vasServiceId?: string | null; clientId?: string | null } = {}): Promise<StandardDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  const found = await db
    .select()
    .from(standards)
    .where(
      and(
        eq(standards.orgId, ctx.orgId),
        isNull(standards.deletedAt),
        filters.jobTypeId ? eq(standards.jobTypeId, filters.jobTypeId) : undefined,
        filters.vasServiceId ? eq(standards.vasServiceId, filters.vasServiceId) : undefined,
        filters.clientId ? eq(standards.clientId, filters.clientId) : undefined,
      ),
    )
    .orderBy(desc(standards.effectiveFrom), desc(standards.createdAt));
  return found.map(toStandardDTO);
}

export interface StandardInput {
  id?: string | null;
  jobTypeId?: string | null;
  vasServiceId?: string | null;
  clientId?: string | null;
  laborClassId?: string | null;
  unitsPerLaborHour: string;
  effectiveFrom: string;
  basis?: StandardBasis;
  note?: string | null;
  version?: number | null;
  source?: StreamSource;
  isSample?: boolean;
}

/** A target pace feeds every open job of its job type: their projection and status are rebuilt. */
async function recomputeForType(tx: Executor, ctx: DomainContext, jobTypeIds: readonly (string | null)[]): Promise<void> {
  const ids = [...new Set(jobTypeIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const jobs = await rows<{ id: string }>(tx, sql`SELECT id FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND status IN ('active', 'on_hold', 'planned') AND job_type_id = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})`);
  await recomputeJobs(tx, ctx, jobs.map((job) => job.id));
}

export async function saveStandard(ctx: DomainContext, input: StandardInput): Promise<StandardDTO> {
  await requirePulse(ctx, 'standard:manage');
  if (Boolean(input.jobTypeId) === Boolean(input.vasServiceId)) throw invalid('A target pace is for a job type or for a service. Pick one.', { jobTypeId: 'Pick a job type or a service.' });
  if (!(Number(input.unitsPerLaborHour) > 0)) throw invalid('The target pace must be above zero.', { unitsPerLaborHour: 'Type a number above zero.' });
  return inTx(async (tx) => {
    const values = {
      jobTypeId: input.jobTypeId ?? null,
      vasServiceId: input.vasServiceId ?? null,
      clientId: input.clientId ?? null,
      laborClassId: input.laborClassId ?? null,
      unitsPerLaborHour: input.unitsPerLaborHour,
      effectiveFrom: input.effectiveFrom,
      basis: input.basis ?? 'typed',
      note: cleanText(input.note),
    };
    let row: StandardRow;
    let beforeType: string | null = null;
    if (input.id) {
      const [existing] = isUuid(input.id) ? await tx.select().from(standards).where(and(eq(standards.orgId, ctx.orgId), eq(standards.id, input.id), isNull(standards.deletedAt))) : [];
      if (!existing) throw notFound('That target pace');
      assertVersion(existing.version, input.version);
      beforeType = existing.jobTypeId;
      const change = diff(existing as unknown as Record<string, unknown>, values as Record<string, unknown>);
      if (!change) return toStandardDTO(existing);
      [row] = (await tx.update(standards).set({ ...values, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(standards.id, existing.id)).returning()) as [StandardRow];
      await logActivity(tx, ctx, { verb: 'standard.updated', entityType: 'standard', entityId: row.id, ...change });
    } else {
      [row] = (await tx.insert(standards).values({ orgId: ctx.orgId, ...values, source: input.source ?? 'manual', isSample: Boolean(input.isSample), createdBy: ctx.userId, updatedBy: ctx.userId }).returning()) as [StandardRow];
      await logActivity(tx, ctx, { verb: 'standard.created', entityType: 'standard', entityId: row.id, after: values });
    }
    await recomputeForType(tx, ctx, [row.jobTypeId, beforeType]);
    return toStandardDTO(row);
  });
}

export async function deleteStandard(ctx: DomainContext, standardId: string): Promise<void> {
  await requirePulse(ctx, 'standard:manage');
  await inTx(async (tx) => {
    const [existing] = isUuid(standardId) ? await tx.select().from(standards).where(and(eq(standards.orgId, ctx.orgId), eq(standards.id, standardId), isNull(standards.deletedAt))) : [];
    if (!existing) throw notFound('That target pace');
    await softDeleteRow(tx, ctx.orgId, 'standards', standardId, 'That target pace');
    await logActivity(tx, ctx, { verb: 'standard.deleted', entityType: 'standard', entityId: standardId, before: { jobTypeId: existing.jobTypeId, vasServiceId: existing.vasServiceId, unitsPerLaborHour: existing.unitsPerLaborHour, effectiveFrom: existing.effectiveFrom } });
    await recomputeForType(tx, ctx, [existing.jobTypeId]);
  });
}

/**
 * "Suggest from history": the median pace of the last 20 evidence days (days with units and
 * confirmed hours) of a job type, optionally for one client, with the spread.
 */
export async function suggestStandard(ctx: DomainContext, input: { jobTypeId: string; clientId?: string | null; laborClassId?: string | null }): Promise<PaceSuggestionDTO> {
  await requirePulse(ctx, 'pulse:read');
  const [row] = await rows<{ median: string | null; low: string | null; high: string | null; days: number; jobs: number }>(
    db,
    sql`WITH days AS (
          SELECT p.job_id, p.work_date, sum(p.units_good) AS units, sum(p.hours - p.setup_hours) AS pace_hours
            FROM pulse.production_entries p JOIN pulse.jobs j ON j.id = p.job_id
           WHERE p.org_id = ${ctx.orgId} AND p.deleted_at IS NULL AND j.deleted_at IS NULL AND p.hours_confirmed AND p.source <> 'projects'
             AND j.job_type_id = ${input.jobTypeId} ${input.clientId ? sql`AND j.client_id = ${input.clientId}` : sql``}
             ${input.laborClassId ? sql`AND p.labor_class_id = ${input.laborClassId}` : sql``}
           GROUP BY p.job_id, p.work_date
          HAVING sum(p.units_good) > 0 AND sum(p.hours - p.setup_hours) > 0
           ORDER BY p.work_date DESC LIMIT 20
        )
        SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY units / pace_hours))::numeric, 3)::text AS median,
               round(min(units / pace_hours), 3)::text AS low, round(max(units / pace_hours), 3)::text AS high,
               count(*)::int AS days, count(DISTINCT job_id)::int AS jobs
          FROM days`,
  );
  return { median: row?.median ?? null, low: row?.low ?? null, high: row?.high ?? null, days: row?.days ?? 0, jobs: row?.jobs ?? 0 };
}

/* ---------------------------------------------------------------- goals */

const MONEY_METRICS: readonly TargetMetric[] = ['margin_pct', 'profit', 'revenue', 'labor_pct_of_revenue', 'cost_per_unit'];

function toTargetDTO(row: TargetRow, access: Pick<PulseAccess, 'seesMoney'>): TargetDTO {
  const metric = row.metric as TargetMetric;
  return { id: row.id, scope: row.scope as TargetScope, scopeId: row.scopeId, metric, periodMonth: row.periodMonth, value: !access.seesMoney && MONEY_METRICS.includes(metric) ? null : row.value, version: row.version };
}

export async function listTargets(ctx: DomainContext, filters: { scope?: TargetScope | null; scopeId?: string | null; month?: string | null } = {}): Promise<TargetDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const found = await db
    .select()
    .from(targets)
    .where(
      and(
        eq(targets.orgId, ctx.orgId),
        isNull(targets.deletedAt),
        filters.scope ? eq(targets.scope, filters.scope) : undefined,
        filters.scopeId ? eq(targets.scopeId, filters.scopeId) : undefined,
        filters.month ? sql`(${targets.periodMonth} is null or ${targets.periodMonth} = ${`${filters.month.slice(0, 7)}-01`}::date)` : undefined,
      ),
    )
    .orderBy(targets.scope, targets.metric, sql`${targets.periodMonth} nulls first`);
  return found.map((row) => toTargetDTO(row, access));
}

export interface TargetInput {
  scope: TargetScope;
  scopeId?: string | null;
  metric: TargetMetric;
  /** Any day of the month, or null for every month. */
  periodMonth?: string | null;
  value: string;
  source?: StreamSource;
  isSample?: boolean;
}

/** Sets a goal. One goal per scope, measure and month, so this is an upsert. */
export async function saveTarget(ctx: DomainContext, input: TargetInput): Promise<TargetDTO> {
  const access = await requirePulse(ctx, 'target:manage');
  if ((input.scope === 'org') !== !input.scopeId) throw invalid(input.scope === 'org' ? 'A company goal has no site, client, job type or service.' : 'Pick what this goal is for.', { scopeId: 'Pick what this goal is for.' });
  const month = input.periodMonth ? `${input.periodMonth.slice(0, 7)}-01` : null;
  return inTx(async (tx) => {
    const [existing] = await tx
      .select()
      .from(targets)
      .where(
        and(
          eq(targets.orgId, ctx.orgId),
          eq(targets.scope, input.scope),
          input.scopeId ? eq(targets.scopeId, input.scopeId) : isNull(targets.scopeId),
          eq(targets.metric, input.metric),
          month ? eq(targets.periodMonth, month) : isNull(targets.periodMonth),
          isNull(targets.deletedAt),
        ),
      );
    if (existing) {
      if (Number(existing.value) === Number(input.value)) return toTargetDTO(existing, access);
      const [row] = await tx.update(targets).set({ value: input.value, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(targets.id, existing.id)).returning();
      await logActivity(tx, ctx, { verb: 'target.updated', entityType: 'target', entityId: existing.id, before: { value: existing.value }, after: { value: input.value }, meta: { scope: input.scope, metric: input.metric } });
      return toTargetDTO(row!, access);
    }
    const [row] = await tx
      .insert(targets)
      .values({ orgId: ctx.orgId, scope: input.scope, scopeId: input.scopeId ?? null, metric: input.metric, periodMonth: month, value: input.value, source: input.source ?? 'manual', isSample: Boolean(input.isSample), createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning();
    await logActivity(tx, ctx, { verb: 'target.created', entityType: 'target', entityId: row!.id, after: { scope: input.scope, scopeId: input.scopeId ?? null, metric: input.metric, periodMonth: month, value: input.value } });
    return toTargetDTO(row!, access);
  });
}

export async function deleteTarget(ctx: DomainContext, targetId: string): Promise<void> {
  await requirePulse(ctx, 'target:manage');
  await inTx(async (tx) => {
    await softDeleteRow(tx, ctx.orgId, 'targets', targetId, 'That goal');
    await logActivity(tx, ctx, { verb: 'target.deleted', entityType: 'target', entityId: targetId });
  });
}
