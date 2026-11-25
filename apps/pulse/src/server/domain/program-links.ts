/**
 * Linking a KitStak program to a job from Pulse (docs/programs/SPEC.md 6.1, "Link a program").
 * The job is checked with the engine's `canLinkJob` (per unit, ongoing, no WMS work order, no
 * typed units in an open month, no other program), then the `bills_to` edge is written into
 * `core.record_links` through `@kitstak/db/record-links` and mirrored into `pulse.job_links`,
 * in one transaction as `pulse_app` (0015 grants it the table for its own org only).
 *
 * Nothing is sent to Projects: Projects reads the edge itself and moves the program's open days
 * to the job on its next change or sweep, and the next Pulse sync copies them in.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { linkRecords, RecordLinkError, type Executor as LinkExecutor } from '@kitstak/db/record-links';
import { canLinkJob, LINK_JOB_MESSAGES, type LinkJobRefusal } from '@kitstak/programs-engine/accrual';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { conflict, invalid, isDomainError } from '@/server/errors';
import { listProgramsForPicker, programEdgeOf, programsReady, readPrograms } from '@/server/integrations/programs';
import type { JobDetailDTO, ProgramToLinkDTO } from '@/lib/types';
import { inTx, isUuid, rows, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { logActivity } from './activity';
import { getJob, getJobRow } from './jobs';
import { closedMonths, finishWrite, newTouched, restampProduction, touchDay, touchJob } from './recalc';

interface LinkFacts {
  readonly pricingModel: 'per_unit' | 'fixed' | 'hourly';
  readonly kind: 'one_time' | 'ongoing';
  readonly feedsFromWorkOrder: boolean;
  readonly hasTypedUnits: boolean;
  readonly programId: string | null;
}

/** The facts `canLinkJob` needs, read in Pulse. Typed units count only in open months. */
async function linkFacts(executor: Executor, ctx: DomainContext, jobId: string): Promise<LinkFacts> {
  const [row] = await rows<{ pricing_model: string; kind: string; work_order: boolean; typed_units: boolean; program_id: string | null }>(
    executor,
    sql`SELECT j.pricing_model, j.kind,
               EXISTS (SELECT 1 FROM pulse.job_links w WHERE w.job_id = j.id AND w.target_type = 'wms_work_order') AS work_order,
               EXISTS (SELECT 1 FROM pulse.production_entries e
                        WHERE e.job_id = j.id AND e.deleted_at IS NULL AND e.units_good > 0
                          AND NOT (e.source = 'projects' AND COALESCE(e.source_ref, '') LIKE 'pmb:%')
                          AND NOT EXISTS (SELECT 1 FROM pulse.periods pp WHERE pp.org_id = e.org_id AND pp.status = 'closed' AND pp.period_month = date_trunc('month', e.work_date)::date)) AS typed_units,
               (SELECT l.target_id FROM pulse.job_links l WHERE l.job_id = j.id AND l.target_type = 'pm_program' LIMIT 1) AS program_id
          FROM pulse.jobs j WHERE j.org_id = ${ctx.orgId} AND j.id = ${jobId}`,
  );
  return {
    pricingModel: (row?.pricing_model ?? 'per_unit') as LinkFacts['pricingModel'],
    kind: (row?.kind ?? 'one_time') as LinkFacts['kind'],
    feedsFromWorkOrder: Boolean(row?.work_order),
    hasTypedUnits: Boolean(row?.typed_units),
    programId: row?.program_id ?? null,
  };
}

/** Programs for the picker, each with the reason it cannot be linked here (null when it can). */
export const listProgramsToLink = scoped(async function listProgramsToLink(ctx: DomainContext, jobRef: string, q: string | null): Promise<ProgramToLinkDTO[]> {
  await requirePulse(ctx, 'job:manage');
  const job = await getJobRow(ctx, jobRef);
  if (!(await programsReady(ctx))) return [];
  const [client] = await rows<{ core_customer_id: string | null }>(db, sql`SELECT core_customer_id::text AS core_customer_id FROM pulse.clients WHERE id = ${job.clientId}`);
  const facts = await linkFacts(db, ctx, job.id);
  const picks = await listProgramsForPicker(ctx, { q, coreCustomerId: client?.core_customer_id ?? null });
  return picks.map((pick) => {
    const verdict = canLinkJob(facts, { kind: 'program', programId: pick.id });
    const elsewhere = pick.billsToJobId && pick.billsToJobId !== job.id;
    const refusal = elsewhere ? 'This program already bills to another job.' : verdict.ok ? null : LINK_JOB_MESSAGES[verdict.reason];
    return {
      id: pick.id,
      key: pick.key,
      name: pick.name,
      status: pick.status,
      unitPlural: pick.unitPlural,
      customerName: pick.customerName,
      sameCustomer: Boolean(client?.core_customer_id && pick.coreCustomerId === client.core_customer_id),
      linkedHere: pick.billsToJobId === job.id,
      refusal,
      refusalReason: elsewhere ? 'other_job' : verdict.ok ? null : verdict.reason,
      path: pick.path,
    };
  });
});

/**
 * Turns typed units in open months into one revenue adjustment per month, so the job can take
 * build output. The lines keep their hours and crew; their units go to 0.
 */
async function moveTypedUnits(tx: Executor, ctx: DomainContext, jobId: string, programKey: string): Promise<number> {
  const lines = await rows<{ id: string; site_id: string; work_date: string; base_revenue_cents: string; units_good: string }>(
    tx,
    sql`SELECT e.id, e.site_id, to_char(e.work_date, 'YYYY-MM-DD') AS work_date, e.base_revenue_cents::text AS base_revenue_cents, e.units_good::text AS units_good
          FROM pulse.production_entries e
         WHERE e.org_id = ${ctx.orgId} AND e.job_id = ${jobId} AND e.deleted_at IS NULL AND e.units_good > 0
           AND NOT (e.source = 'projects' AND COALESCE(e.source_ref, '') LIKE 'pmb:%')
         FOR UPDATE`,
  );
  const closed = await closedMonths(tx, ctx.orgId);
  const open = lines.filter((line) => !closed.has(`${line.work_date.slice(0, 7)}-01`));
  if (open.length === 0) return 0;
  const [job] = await rows<{ client_id: string; site_id: string }>(tx, sql`SELECT client_id, site_id FROM pulse.jobs WHERE id = ${jobId}`);
  const byMonth = new Map<string, { cents: bigint; units: number; last: string }>();
  for (const line of open) {
    const month = line.work_date.slice(0, 7);
    const entry = byMonth.get(month) ?? { cents: BigInt(0), units: 0, last: line.work_date };
    entry.cents += BigInt(line.base_revenue_cents);
    entry.units += 1;
    if (line.work_date > entry.last) entry.last = line.work_date;
    byMonth.set(month, entry);
  }
  const touched = newTouched();
  await tx.execute(sql`UPDATE pulse.production_entries SET units_good = 0, version = version + 1, updated_by = ${ctx.userId}, updated_at = now() WHERE org_id = ${ctx.orgId} AND id IN (${sql.join(open.map((line) => sql`${line.id}::uuid`), sql`, `)})`);
  for (const line of open) touchDay(touched, line.site_id, line.work_date);
  for (const [, entry] of byMonth) {
    if (entry.cents === BigInt(0)) continue;
    await tx.execute(
      sql`INSERT INTO pulse.revenue_entries (org_id, site_id, job_id, client_id, revenue_date, kind, description, amount_cents, approved, source, created_by, updated_by)
          VALUES (${ctx.orgId}, ${job!.site_id}, ${jobId}, ${job!.client_id}, ${entry.last}::date, 'adjustment', ${`Typed units moved to an adjustment before linking ${programKey}`}, ${entry.cents.toString()}::bigint, true, 'manual', ${ctx.userId}, ${ctx.userId})`,
    );
  }
  await restampProduction(tx, ctx.orgId, sql`src.id IN (${sql.join(open.map((line) => sql`${line.id}::uuid`), sql`, `)})`);
  touchJob(touched, jobId, job!.client_id);
  await finishWrite(tx, ctx, touched);
  await logActivity(tx, ctx, { verb: 'production.edited', entityType: 'job', entityId: jobId, jobId, clientId: job!.client_id, after: { unitsMovedToAdjustment: open.length }, meta: { via: 'link_program', programKey } });
  return open.length;
}

/**
 * Links a program to a job: checks, writes the `bills_to` edge and its mirror in one transaction.
 * `moveTypedUnits` answers the dialog's "Move those units to a typed adjustment".
 */
export const linkProgramToJob = scoped(async function linkProgramToJob(ctx: DomainContext, jobRef: string, programId: string, options: { moveTypedUnits?: boolean } = {}): Promise<JobDetailDTO> {
  await requirePulse(ctx, 'job:manage');
  const job0 = await getJobRow(ctx, jobRef);
  await inTx((tx) => attachProgramInTx(tx, ctx, job0.id, programId, options)).catch(mapLinkError);
  return getJob(ctx, job0.id);
});

function mapLinkError(error: unknown): never {
  if (isDomainError(error)) throw error;
  const code = (error as { code?: string; cause?: { code?: string } } | null)?.code ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
  if (code === '23505') throw conflict('This job already takes another program.');
  throw error;
}

/**
 * The link itself, inside the caller's transaction (also used by a new job made from a program,
 * so the job and its link are saved together or not at all).
 */
export const attachProgramInTx = scoped(async function attachProgramInTx(tx: Executor, ctx: DomainContext, jobId: string, programId: string, options: { moveTypedUnits?: boolean } = {}): Promise<void> {
  if (!isUuid(programId)) throw invalid('Pick a program.', { programId: 'Pick a program.' });
  if (!(await programsReady(ctx))) throw conflict('Programs are not ready in this workspace yet. Ask an admin to update Projects.');
  const program = (await readPrograms(ctx, [programId])).get(programId);
  if (!program || program.deleted) throw invalid('That program is no longer in Projects.', { programId: 'Pick another program.' });
  const existing = await programEdgeOf(ctx, programId);
  if (existing && existing.jobId !== jobId) throw conflict(`${program.key} already bills to another job. Remove that link in Projects first.`);
  const job = await getJobRow(ctx, jobId, tx);
  await tx.execute(sql`SELECT 1 FROM pulse.jobs WHERE id = ${job.id} FOR UPDATE`);
  let facts = await linkFacts(tx, ctx, job.id);
  let verdict = canLinkJob(facts, { kind: 'program', programId });
  if (!verdict.ok && verdict.reason === 'has_typed_units' && options.moveTypedUnits) {
    await moveTypedUnits(tx, ctx, job.id, program.key);
    facts = await linkFacts(tx, ctx, job.id);
    verdict = canLinkJob(facts, { kind: 'program', programId });
  }
  if (!verdict.ok) throw refusal(verdict.reason);
  let edgeId = existing?.id ?? null;
  if (!edgeId) {
    try {
      const edge = await linkRecords(tx as unknown as LinkExecutor, {
        orgId: ctx.orgId,
        from: { type: 'pm_program', id: programId },
        to: { type: 'pulse_job', id: job.id },
        relation: 'bills_to',
        cache: { title: `${job.number} ${job.name}`, status: job.status, url: `/jobs/${encodeURIComponent(job.number)}` },
        meta: { linkedFrom: 'pulse' },
        createdBy: ctx.userId,
      });
      edgeId = edge.id;
    } catch (error) {
      if (error instanceof RecordLinkError) throw conflict(error.code === 'TAKEN' ? `${program.key} already bills to a job, or this job already takes another program.` : error.message);
      throw error;
    }
  }
  const meta = JSON.stringify({ key: program.key, name: program.name, edgeId, unitPlural: program.unitPlural, timezone: program.timezone });
  await tx.execute(
    sql`INSERT INTO pulse.job_links (org_id, job_id, target_type, target_id, imports_time, cached_title, cached_status, cached_url, cached_at, meta, created_by)
        VALUES (${ctx.orgId}, ${job.id}, 'pm_program', ${programId}, true, ${`${program.key} ${program.name}`}, ${program.status}, ${program.path}, now(), ${meta}::jsonb, ${ctx.userId})
        ON CONFLICT (job_id, target_type, target_id) DO UPDATE SET cached_title = EXCLUDED.cached_title, cached_status = EXCLUDED.cached_status,
          cached_url = EXCLUDED.cached_url, cached_at = now(), meta = EXCLUDED.meta, updated_at = now()`,
  );
  await logActivity(tx, ctx, { verb: 'link.added', entityType: 'job', entityId: job.id, jobId: job.id, clientId: job.clientId, after: { targetType: 'pm_program', targetId: programId, key: program.key }, meta: { via: 'link_program' } });
}, 1);

function refusal(reason: LinkJobRefusal) {
  return conflict(LINK_JOB_MESSAGES[reason]);
}

/** The program a new job form was opened from (`/jobs/new?program=`). Null when it cannot take a job. */
export const programForNewJob = scoped(async function programForNewJob(ctx: DomainContext, programId: string): Promise<{ id: string; key: string; name: string; unitPlural: string; coreCustomerId: string | null } | null> {
  await requirePulse(ctx, 'job:manage');
  if (!isUuid(programId) || !(await programsReady(ctx))) return null;
  const program = (await readPrograms(ctx, [programId])).get(programId);
  if (!program || program.deleted) return null;
  if (await programEdgeOf(ctx, programId)) return null;
  return { id: program.id, key: program.key, name: program.name, unitPlural: program.unitPlural, coreCustomerId: program.coreCustomerId };
});
