/**
 * Program sync (docs/programs/SPEC.md 6.1): copies what KitStak Programs stored in Projects onto
 * the Pulse jobs the programs and builds bill to. Pulse never computes program money here: units
 * and unit prices come from the output snapshots (`pm.build_output`), fees from the ledger
 * (`pm.program_ledger`), both through the shared loader. Every step is safe to run again.
 *
 *  1. Mirror every `bills_to` edge into `pulse.job_links` (`pm_program`, `pm_build`) and remove
 *     mirrors whose edge is gone, only after the edge read succeeded. `jobs.program_job` is then
 *     set on every job with a `pm_program` mirror and cleared on every other job.
 *  2. Guard: a program job that is not per unit, or takes units from a WMS work order, is skipped
 *     with an alert. A time zone that differs from the job's site raises a note.
 *  3. One production line per build per day (`pmb:<buildId>:<date>`, shift `projects`) with the
 *     day's units, scrap, price snapshot, standard material and the build's labor.
 *  4. Lines and fees no longer in Projects leave Pulse (open months only); a line whose build now
 *     bills to another job moves there in one transaction and both jobs are restamped.
 *  5. Every ledger row becomes a fee or adjustment row on the program job (`pmf:` refs).
 *  6. Time on prep tasks becomes hours only lines on the program job (`pmt:` refs).
 *  7. Rows are written in batches per job and month, each one transaction with one restamp and
 *     one rollup, and the sync lease is renewed between batches.
 *
 * Closed Pulse months are never written: their rows are skipped and counted.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import type { OutputRow } from '@kitstak/programs-engine/types';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { conflict } from '@/server/errors';
import { tableExists } from '@/server/integrations/detect';
import {
  buildHours,
  buildOutput,
  existingEdgeIds,
  prepHours,
  prepTaskIds,
  programBuildIds,
  programEdges,
  programMonth,
  programsReady,
  programVariants,
  readBuilds,
  readPrograms,
  type BuildFeed,
  type ProgramEdge,
  type ProgramFeed,
} from '@/server/integrations/programs';
import { inTx, monthStart, rows, todayInZone, uuidArray, type DomainContext } from './_shared';
import { logActivity } from './activity';
import { clearAlert, raiseAlert } from './alerts';
import { closedMonths, finishWrite, newTouched, restampProduction, touchDay, touchJob, type Touched } from './recalc';
import { loadSettings } from './settings';

export interface ProgramSyncTally {
  created: number;
  updated: number;
  skipped: number;
  skippedClosed: number;
  counts: Record<string, number>;
}

export interface SyncProgramsOptions {
  /** Test hook: replaces the edge read (to prove the empty read guard rail). */
  readonly readEdges?: (ctx: DomainContext) => Promise<ProgramEdge[]>;
  /** Today, for tests. Defaults to today in each program's time zone. */
  readonly today?: string;
  /** Renews the sync lease between batches. */
  readonly renewLease?: () => Promise<void>;
}

export const EDGE_READ_FAILED = 'Program links could not be read. Nothing was removed.';
const LEASE_MINUTES = 5;

interface JobRow {
  id: string;
  number: string;
  name: string;
  status: string;
  client_id: string;
  site_id: string;
  timezone: string;
  pricing_model: string;
  kind: string;
  default_labor_class_id: string | null;
  work_order: boolean;
  deleted: boolean;
}

interface MirrorRow {
  id: string;
  job_id: string;
  target_type: 'pm_program' | 'pm_build';
  target_id: string;
  cached_title: string | null;
  cached_status: string | null;
  cached_url: string | null;
  imports_time: boolean;
  meta: Record<string, unknown> | null;
}

/** One production line the sync wants in Pulse. */
interface WantLine {
  readonly ref: string;
  readonly jobId: string;
  readonly workDate: string;
  readonly shift: 'projects' | 'projects_time';
  readonly unitsGood: string;
  readonly unitsScrap: string;
  readonly hours: string;
  readonly headcount: string | null;
  readonly pmTaskId: string | null;
  readonly unitPrice: string | null;
  readonly materialCostPerUnit: string | null;
  readonly pmProgramId: string | null;
  readonly pmVariantId: string | null;
  readonly meta: Record<string, unknown>;
}

/** One fee row the sync wants in Pulse. */
interface WantFee {
  readonly ref: string;
  readonly jobId: string;
  readonly revenueDate: string;
  readonly kind: 'fee' | 'adjustment';
  readonly description: string;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly amountCents: string;
  readonly pmProgramId: string;
  readonly pmVariantId: string | null;
  readonly programKey: string;
}

interface HaveLine {
  id: string;
  job_id: string;
  site_id: string;
  work_date: string;
  source_ref: string;
  units_good: string;
  units_scrap: string;
  hours: string;
  headcount: string | null;
  pm_task_id: string | null;
  unit_price: string | null;
  material_cost_per_unit: string | null;
  pm_program_id: string | null;
  pm_variant_id: string | null;
  labor_class_id: string | null;
  shift: string;
  meta: Record<string, unknown> | null;
  job_live: boolean;
}

interface HaveFee {
  id: string;
  job_id: string | null;
  site_id: string;
  client_id: string;
  revenue_date: string;
  source_ref: string;
  kind: string;
  description: string | null;
  quantity: string | null;
  unit_price: string | null;
  amount_cents: string;
  pm_program_id: string | null;
  pm_variant_id: string | null;
  meta: Record<string, unknown> | null;
  job_live: boolean;
}

const sameNum = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if ((a === null || a === undefined) !== (b === null || b === undefined)) return false;
  return Number(a ?? 0) === Number(b ?? 0);
};
const sameText = (a: string | null | undefined, b: string | null | undefined): boolean => (a ?? null) === (b ?? null);
const hoursOf = (minutes: number): string => (Math.round((minutes / 60) * 100) / 100).toFixed(2);
const peopleOf = (people: number, minutes: number): string | null => (minutes > 0 ? String(Math.max(people, 1)) : null);
const lockedFields = (meta: Record<string, unknown> | null): string[] => (Array.isArray(meta?.locked_fields) ? (meta?.locked_fields as string[]) : []);

/** Months from `from` through `to` as `YYYY-MM`. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

const LEDGER_ADJUSTMENT_KINDS = new Set(['adjustment', 'minimum_top_up']);

/** Words for a job that cannot take a program. */
function guardMessage(programKey: string, job: JobRow): string | null {
  if (job.pricing_model !== 'per_unit') return `Program ${programKey} cannot feed ${job.number} because the job is not per unit.`;
  if (job.work_order) return `Program ${programKey} cannot feed ${job.number} because the job takes units from a WMS work order.`;
  return null;
}

async function jobsById(ctx: DomainContext, ids: readonly string[]): Promise<Map<string, JobRow>> {
  if (ids.length === 0) return new Map();
  const found = await rows<JobRow>(
    db,
    sql`SELECT j.id, j.number, j.name, j.status, j.client_id, j.site_id, s.timezone, j.pricing_model, j.kind, j.default_labor_class_id,
               EXISTS (SELECT 1 FROM pulse.job_links w WHERE w.job_id = j.id AND w.target_type = 'wms_work_order') AS work_order,
               (j.deleted_at IS NOT NULL) AS deleted
          FROM pulse.jobs j JOIN pulse.sites s ON s.id = j.site_id
         WHERE j.org_id = ${ctx.orgId} AND j.id = ANY(${uuidArray([...new Set(ids)])})`,
  );
  return new Map(found.map((row) => [row.id, row]));
}

/**
 * Step 1: the mirrors. Removes mirrors whose edge is gone first (a program that moved jobs must
 * leave its old job before the one program per job index lets it in), then upserts the rest, then
 * brings `jobs.program_job` in line with the mirrors.
 */
async function mirrorEdges(ctx: DomainContext, edges: readonly ProgramEdge[], jobs: ReadonlyMap<string, JobRow>, programs: ReadonlyMap<string, ProgramFeed>, builds: ReadonlyMap<string, BuildFeed>, have: readonly MirrorRow[], tally: ProgramSyncTally): Promise<void> {
  const want = new Map<string, { edge: ProgramEdge; title: string; status: string | null; path: string; meta: Record<string, unknown>; importsTime: boolean }>();
  for (const edge of edges) {
    const job = jobs.get(edge.jobId);
    if (!job || job.deleted) continue;
    if (edge.fromType === 'pm_program') {
      const program = programs.get(edge.fromId);
      if (!program || program.deleted) continue;
      want.set(`${edge.jobId}|pm_program|${edge.fromId}`, {
        edge,
        title: `${program.key} ${program.name}`,
        status: program.status,
        path: program.path,
        meta: { key: program.key, name: program.name, edgeId: edge.id, unitPlural: program.unitPlural, timezone: program.timezone, importTaskTime: edge.meta.importTaskTime ?? false },
        importsTime: edge.meta.importPrepTime !== false,
      });
    } else {
      const build = builds.get(edge.fromId);
      if (!build || build.deleted) continue;
      const program = build.programId ? programs.get(build.programId) : undefined;
      want.set(`${edge.jobId}|pm_build|${edge.fromId}`, {
        edge,
        title: `${build.key} ${build.title}`,
        status: null,
        path: build.path,
        meta: { key: build.key, edgeId: edge.id, programId: build.programId, programKey: program?.key ?? null },
        importsTime: false,
      });
    }
  }
  const stale = have.filter((row) => !want.has(`${row.job_id}|${row.target_type}|${row.target_id}`));
  if (stale.length > 0) {
    await inTx(async (tx) => {
      await tx.execute(sql`DELETE FROM pulse.job_links WHERE org_id = ${ctx.orgId} AND id = ANY(${uuidArray(stale.map((row) => row.id))})`);
      await logActivity(
        tx,
        ctx,
        stale.map((row) => ({ verb: 'link.removed', entityType: 'link', entityId: row.id, jobId: row.job_id, before: { targetType: row.target_type, targetId: row.target_id }, meta: { via: 'program_sync' } })),
      );
    });
    tally.updated += stale.length;
  }
  const haveByKey = new Map(have.map((row) => [`${row.job_id}|${row.target_type}|${row.target_id}`, row]));
  for (const [key, item] of want) {
    const existing = haveByKey.get(key);
    const meta = JSON.stringify({ ...(existing?.meta ?? {}), ...item.meta });
    if (existing && existing.cached_title === item.title && existing.cached_status === item.status && existing.cached_url === item.path && existing.imports_time === item.importsTime && JSON.stringify({ ...(existing.meta ?? {}), ...item.meta }) === JSON.stringify(existing.meta ?? {})) continue;
    await inTx(async (tx) => {
      const [row] = await rows<{ id: string; inserted: boolean }>(
        tx,
        sql`INSERT INTO pulse.job_links (org_id, job_id, target_type, target_id, imports_time, cached_title, cached_status, cached_url, cached_at, meta)
            VALUES (${ctx.orgId}, ${item.edge.jobId}, ${item.edge.fromType}, ${item.edge.fromId}, ${item.importsTime}, ${item.title}, ${item.status}, ${item.path}, now(), ${meta}::jsonb)
            ON CONFLICT (job_id, target_type, target_id) DO UPDATE SET imports_time = EXCLUDED.imports_time, cached_title = EXCLUDED.cached_title,
              cached_status = EXCLUDED.cached_status, cached_url = EXCLUDED.cached_url, cached_at = now(), meta = EXCLUDED.meta, updated_at = now()
            RETURNING id, (xmax = 0) AS inserted`,
      );
      if (row?.inserted) {
        await logActivity(tx, ctx, { verb: 'link.added', entityType: 'link', entityId: row.id, jobId: item.edge.jobId, after: { targetType: item.edge.fromType, targetId: item.edge.fromId }, meta: { via: 'program_sync' } });
        tally.created += 1;
      } else tally.updated += 1;
    });
  }
  await syncProgramJobFlags(ctx);
}

/**
 * `jobs.program_job` follows the mirrors: true for every job with a `pm_program` mirror, false for
 * every other job of the org. Only jobs whose flag is wrong are written, so a second run writes
 * nothing. It looks at the whole org, so a flag left behind by a link removed outside the sync is
 * cleared too.
 */
async function syncProgramJobFlags(ctx: DomainContext): Promise<void> {
  await db.execute(
    sql`UPDATE pulse.jobs j SET program_job = NOT j.program_job, updated_at = now()
         WHERE j.org_id = ${ctx.orgId}
           AND j.program_job <> EXISTS (SELECT 1 FROM pulse.job_links l WHERE l.org_id = j.org_id AND l.job_id = j.id AND l.target_type = 'pm_program')`,
  );
}

/** One batch: the lines and fees of one job and one month, in one transaction. */
async function writeBatch(ctx: DomainContext, job: JobRow, lines: readonly WantLine[], fees: readonly WantFee[], haveLines: ReadonlyMap<string, HaveLine>, haveFees: ReadonlyMap<string, HaveFee>, jobs: ReadonlyMap<string, JobRow>, tally: ProgramSyncTally): Promise<void> {
  const counts = { created: 0, updated: 0, moved: 0 };
  await inTx(async (tx) => {
    const touched = newTouched();
    const restamp: string[] = [];
    for (const line of lines) {
      const have = haveLines.get(line.ref);
      const meta = JSON.stringify({ ...(have?.meta ?? {}), ...line.meta });
      if (have) {
        const moved = have.job_id !== job.id;
        const locked = lockedFields(have.meta);
        const same =
          !moved &&
          have.work_date === line.workDate &&
          sameNum(have.units_good, line.unitsGood) &&
          sameNum(have.units_scrap, line.unitsScrap) &&
          (locked.includes('hours') || sameNum(have.hours, line.hours)) &&
          (locked.includes('headcount') || sameNum(have.headcount, line.headcount)) &&
          sameNum(have.unit_price, line.unitPrice) &&
          sameNum(have.material_cost_per_unit, line.materialCostPerUnit) &&
          sameText(have.pm_program_id, line.pmProgramId) &&
          sameText(have.pm_variant_id, line.pmVariantId) &&
          sameText(have.pm_task_id, line.pmTaskId) &&
          JSON.stringify({ ...(have.meta ?? {}), ...line.meta }) === JSON.stringify(have.meta ?? {});
        if (same) continue;
        if (moved) {
          const from = jobs.get(have.job_id);
          touchDay(touched, have.site_id, have.work_date);
          touchJob(touched, have.job_id, from?.client_id ?? null);
        }
        await tx.execute(
          sql`UPDATE pulse.production_entries
                 SET job_id = ${job.id}, site_id = ${job.site_id}, labor_class_id = ${moved ? job.default_labor_class_id : have.labor_class_id},
                     work_date = ${line.workDate}::date, shift = ${line.shift},
                     units_good = ${line.unitsGood}::numeric, units_scrap = ${line.unitsScrap}::numeric,
                     hours = ${locked.includes('hours') ? sql`hours` : sql`${line.hours}::numeric`},
                     headcount = ${locked.includes('headcount') ? sql`headcount` : sql`${line.headcount}::numeric`},
                     hours_confirmed = true, pm_task_id = ${line.pmTaskId}, unit_price = ${line.unitPrice}::numeric,
                     material_cost_per_unit = ${line.materialCostPerUnit}::numeric, pm_program_id = ${line.pmProgramId}::uuid,
                     pm_variant_id = ${line.pmVariantId}::uuid, meta = ${meta}::jsonb,
                     version = version + 1, updated_by = ${ctx.userId}, updated_at = now()
               WHERE id = ${have.id} AND org_id = ${ctx.orgId}`,
        );
        restamp.push(have.id);
        if (moved) counts.moved += 1;
        else counts.updated += 1;
      } else {
        const [row] = await rows<{ id: string }>(
          tx,
          sql`INSERT INTO pulse.production_entries (org_id, site_id, job_id, work_date, shift, labor_class_id, units_good, units_scrap, headcount, hours,
                                                     hours_confirmed, note, pm_task_id, unit_price, material_cost_per_unit, pm_program_id, pm_variant_id,
                                                     source, source_ref, meta, created_by, updated_by)
              VALUES (${ctx.orgId}, ${job.site_id}, ${job.id}, ${line.workDate}::date, ${line.shift}, ${job.default_labor_class_id}, ${line.unitsGood}::numeric,
                      ${line.unitsScrap}::numeric, ${line.headcount}::numeric, ${line.hours}::numeric, true, null, ${line.pmTaskId}::uuid,
                      ${line.unitPrice}::numeric, ${line.materialCostPerUnit}::numeric, ${line.pmProgramId}::uuid, ${line.pmVariantId}::uuid,
                      'projects', ${line.ref}, ${meta}::jsonb, ${ctx.userId}, ${ctx.userId})
              RETURNING id`,
        );
        if (row) restamp.push(row.id);
        counts.created += 1;
      }
      touchDay(touched, job.site_id, line.workDate);
    }
    for (const fee of fees) {
      const have = haveFees.get(fee.ref);
      if (have) {
        const moved = have.job_id !== job.id;
        const same =
          !moved &&
          have.revenue_date === fee.revenueDate &&
          have.kind === fee.kind &&
          sameText(have.description, fee.description) &&
          sameNum(have.quantity, fee.quantity) &&
          sameNum(have.unit_price, fee.unitPrice) &&
          have.amount_cents === fee.amountCents &&
          sameText(have.pm_program_id, fee.pmProgramId) &&
          sameText(have.pm_variant_id, fee.pmVariantId) &&
          have.meta?.programKey === fee.programKey;
        if (same) continue;
        if (moved && have.job_id) touchJob(touched, have.job_id, have.client_id);
        await tx.execute(
          sql`UPDATE pulse.revenue_entries
                 SET job_id = ${job.id}, site_id = ${job.site_id}, client_id = ${job.client_id}, revenue_date = ${fee.revenueDate}::date, kind = ${fee.kind},
                     description = ${fee.description}, quantity = ${fee.quantity}::numeric, unit_price = ${fee.unitPrice}::numeric,
                     amount_cents = ${fee.amountCents}::bigint, pm_program_id = ${fee.pmProgramId}::uuid, pm_variant_id = ${fee.pmVariantId}::uuid,
                     meta = ${JSON.stringify({ ...(have.meta ?? {}), programKey: fee.programKey })}::jsonb, version = version + 1, updated_by = ${ctx.userId}, updated_at = now()
               WHERE id = ${have.id} AND org_id = ${ctx.orgId}`,
        );
        if (moved) counts.moved += 1;
        else counts.updated += 1;
      } else {
        await tx.execute(
          sql`INSERT INTO pulse.revenue_entries (org_id, site_id, job_id, client_id, revenue_date, kind, description, quantity, unit_price, amount_cents,
                                                  approved, pm_program_id, pm_variant_id, source, source_ref, meta, created_by, updated_by)
              VALUES (${ctx.orgId}, ${job.site_id}, ${job.id}, ${job.client_id}, ${fee.revenueDate}::date, ${fee.kind}, ${fee.description},
                      ${fee.quantity}::numeric, ${fee.unitPrice}::numeric, ${fee.amountCents}::bigint, true, ${fee.pmProgramId}::uuid,
                      ${fee.pmVariantId}::uuid, 'projects', ${fee.ref}, ${JSON.stringify({ programKey: fee.programKey })}::jsonb, ${ctx.userId}, ${ctx.userId})`,
        );
        counts.created += 1;
      }
    }
    if (counts.created + counts.updated + counts.moved === 0) return;
    if (restamp.length > 0) await restampProduction(tx, ctx.orgId, sql`src.id = ANY(${uuidArray(restamp)})`);
    touchJob(touched, job.id, job.client_id);
    await finishWrite(tx, ctx, touched);
    await logActivity(tx, ctx, { verb: 'sync.updated', entityType: 'job', entityId: job.id, jobId: job.id, clientId: job.client_id, after: { added: counts.created, changed: counts.updated, moved: counts.moved }, meta: { via: 'program_sync', month: (lines[0]?.workDate ?? fees[0]?.revenueDate ?? '').slice(0, 7) } });
  });
  tally.created += counts.created;
  tally.updated += counts.updated + counts.moved;
}

/** Step 4: lines and fees the sync wrote that Projects no longer has, per job and month. */
async function removeGoneProgramRows(ctx: DomainContext, seen: ReadonlySet<string>, haveLines: ReadonlyMap<string, HaveLine>, haveFees: ReadonlyMap<string, HaveFee>, jobs: ReadonlyMap<string, JobRow>, closed: ReadonlySet<string>, tally: ProgramSyncTally, renew: () => Promise<void>): Promise<void> {
  const groups = new Map<string, { lines: HaveLine[]; fees: HaveFee[] }>();
  for (const line of haveLines.values()) {
    if (seen.has(line.source_ref) || !line.job_live) continue;
    if (closed.has(monthStart(line.work_date))) {
      tally.skippedClosed += 1;
      continue;
    }
    if (lockedFields(line.meta).includes('hours') && line.source_ref.startsWith('pmt:')) continue;
    const key = `${line.job_id}|${line.work_date.slice(0, 7)}`;
    const group = groups.get(key) ?? { lines: [], fees: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  for (const fee of haveFees.values()) {
    if (seen.has(fee.source_ref) || !fee.job_live) continue;
    if (closed.has(monthStart(fee.revenue_date))) {
      tally.skippedClosed += 1;
      continue;
    }
    const key = `${fee.job_id ?? 'none'}|${fee.revenue_date.slice(0, 7)}`;
    const group = groups.get(key) ?? { lines: [], fees: [] };
    group.fees.push(fee);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    await inTx(async (tx) => {
      const touched: Touched = newTouched();
      if (group.lines.length > 0) {
        await tx.execute(sql`UPDATE pulse.production_entries SET deleted_at = now(), version = version + 1, updated_by = ${ctx.userId}, updated_at = now() WHERE org_id = ${ctx.orgId} AND id = ANY(${uuidArray(group.lines.map((line) => line.id))})`);
        for (const line of group.lines) {
          touchDay(touched, line.site_id, line.work_date);
          touchJob(touched, line.job_id, jobs.get(line.job_id)?.client_id ?? null);
        }
      }
      if (group.fees.length > 0) {
        await tx.execute(sql`UPDATE pulse.revenue_entries SET deleted_at = now(), version = version + 1, updated_by = ${ctx.userId}, updated_at = now() WHERE org_id = ${ctx.orgId} AND id = ANY(${uuidArray(group.fees.map((fee) => fee.id))})`);
        for (const fee of group.fees) touchJob(touched, fee.job_id, fee.client_id);
      }
      await finishWrite(tx, ctx, touched);
      const jobId = group.lines[0]?.job_id ?? group.fees[0]?.job_id ?? null;
      await logActivity(tx, ctx, { verb: 'sync.updated', entityType: 'job', entityId: jobId, jobId, after: { removed: group.lines.length + group.fees.length }, meta: { via: 'program_sync' } });
    });
    tally.updated += group.lines.length + group.fees.length;
    await renew();
  }
}

/**
 * The program step of the Projects sync. Throws (the run records it as a failed sync) only when
 * the edge read cannot be trusted; every other problem is counted and skipped.
 */
export const syncPrograms = scoped(async function syncPrograms(ctx: DomainContext, tally: ProgramSyncTally, options: SyncProgramsOptions = {}): Promise<void> {
  if (!(await programsReady(ctx))) {
    tally.counts.programJobs = 0;
    return;
  }
  const renew =
    options.renewLease ??
    (async () => {
      await db.execute(sql`UPDATE pulse.sync_state SET locked_until = now() + make_interval(mins => ${LEASE_MINUTES}), updated_at = now() WHERE org_id = ${ctx.orgId} AND source = 'projects' AND locked_until IS NOT NULL`);
    });

  // Strict reads: a failure throws, so nothing is removed on a read that went wrong.
  const edges = await (options.readEdges ?? programEdges)(ctx);
  const mirrors = await rows<MirrorRow>(
    db,
    sql`SELECT id, job_id, target_type, target_id, cached_title, cached_status, cached_url, imports_time, meta FROM pulse.job_links
         WHERE org_id = ${ctx.orgId} AND target_type IN ('pm_program', 'pm_build')`,
  );
  if (edges.length === 0 && mirrors.length > 0 && (await tableExists('core.record_links'))) {
    // Zero edges with live mirrors is either the last link removed in Projects, or a read gone wrong.
    // The mirrors keep the id of their edge: if any of those edges is still there, the read is wrong.
    const ids = mirrors.map((row) => (typeof row.meta?.edgeId === 'string' ? row.meta.edgeId : null)).filter((id): id is string => Boolean(id));
    const still = ids.length > 0 ? await existingEdgeIds(ctx, ids) : new Set<string>();
    if (ids.length < mirrors.length || still.size > 0) throw conflict(EDGE_READ_FAILED);
  }

  const buildEdges = edges.filter((edge) => edge.fromType === 'pm_build');
  const builds = await readBuilds(ctx, buildEdges.map((edge) => edge.fromId), { throwOnError: true });
  const programIds = [...new Set([...edges.filter((edge) => edge.fromType === 'pm_program').map((edge) => edge.fromId), ...[...builds.values()].map((build) => build.programId).filter((id): id is string => Boolean(id))])];
  const programs = await readPrograms(ctx, programIds, { throwOnError: true });
  const jobs = await jobsById(ctx, [...new Set([...edges.map((edge) => edge.jobId), ...mirrors.map((row) => row.job_id)])]);

  // 1. Mirrors.
  await mirrorEdges(ctx, edges, jobs, programs, builds, mirrors, tally);

  const settings = await loadSettings(ctx.orgId);
  const closed = await closedMonths(db, ctx.orgId);
  const variants = await programVariants(ctx, programIds, { throwOnError: true });
  const materialOf = (variantId: string | null): string | null => (variantId ? (variants.get(variantId)?.materialCostPerUnit ?? null) : null);

  // Which job each program and build bills to (live, not blocked).
  const programJob = new Map<string, JobRow>();
  const buildJob = new Map<string, JobRow>();
  let blocked = 0;
  for (const edge of edges) {
    const job = jobs.get(edge.jobId);
    if (!job || job.deleted) continue;
    if (edge.fromType === 'pm_program') {
      const program = programs.get(edge.fromId);
      if (!program || program.deleted) continue;
      // 2. Guard.
      const refusal = guardMessage(program.key, job);
      await inTx(async (tx) => {
        if (refusal) await raiseAlert(tx, ctx, { kind: 'sync_failed', entityType: 'job', entityId: job.id, params: { source: 'Projects', title: `${program.key} cannot feed ${job.number}`, message: refusal, jobNumber: job.number }, url: `/jobs/${encodeURIComponent(job.number)}` });
        else await clearAlert(tx, ctx, 'sync_failed', 'job', job.id);
        const zoneKey = `program-zone:${job.id}`;
        if (program.timezone !== job.timezone) {
          await raiseAlert(tx, ctx, {
            kind: 'sync_failed',
            entityType: 'sync',
            entityId: zoneKey,
            params: { source: 'Projects', title: `${program.key} and ${job.number} use different time zones`, message: `${program.key} uses ${program.timezone} but ${job.number}'s site uses ${job.timezone}. Days are counted in ${program.key}'s zone.`, note: true },
            url: `/jobs/${encodeURIComponent(job.number)}`,
          });
        } else await clearAlert(tx, ctx, 'sync_failed', 'sync', zoneKey);
      });
      if (refusal) {
        blocked += 1;
        tally.skipped += 1;
        continue;
      }
      programJob.set(program.id, job);
    } else {
      const build = builds.get(edge.fromId);
      if (!build || build.deleted || job.pricing_model !== 'per_unit') continue;
      buildJob.set(build.id, job);
    }
  }
  tally.counts.programJobs = programJob.size;
  tally.counts.buildJobs = buildJob.size;
  tally.counts.programJobsBlocked = blocked;

  const lines = new Map<string, WantLine>();
  const fees = new Map<string, WantFee>();
  const seen = new Set<string>();

  /** The job a stored output row goes to, when it is one Pulse feeds. */
  const targetOf = (row: OutputRow, programId: string | null): JobRow | null => {
    if (!row.pulseJobId) return null;
    if (row.posting === 'build_job') {
      const job = buildJob.get(row.buildId);
      return job && job.id === row.pulseJobId ? job : null;
    }
    if (row.posting === 'program_job' && programId) {
      const job = programJob.get(programId);
      return job && job.id === row.pulseJobId ? job : null;
    }
    return null;
  };

  // Programs whose rows feed a job: their program job, or builds with their own job.
  const feedingPrograms = new Set<string>([...programJob.keys(), ...[...buildJob.keys()].map((id) => builds.get(id)?.programId).filter((id): id is string => Boolean(id))]);
  const buildIdsByProgram = await programBuildIds(ctx, [...feedingPrograms]);
  let outputRows = 0;

  for (const programId of feedingPrograms) {
    const program = programs.get(programId);
    if (!program || program.deleted) continue;
    const today = options.today ?? todayInZone(program.timezone);
    const months = monthsBetween((program.startDate ?? today).slice(0, 7), today.slice(0, 7));
    const jobOfProgram = programJob.get(programId) ?? null;
    const output: OutputRow[] = [];
    for (const month of months) {
      const read = await programMonth(ctx, programId, month);
      output.push(...read.output);
      // 5. Fees: every ledger row of the month goes to the program job (M2).
      if (jobOfProgram) {
        for (const entry of read.ledger) {
          fees.set(entry.ref, {
            ref: entry.ref,
            jobId: jobOfProgram.id,
            revenueDate: entry.chargeDate,
            kind: LEDGER_ADJUSTMENT_KINDS.has(entry.kind) ? 'adjustment' : 'fee',
            description: entry.label,
            quantity: entry.kind === 'per_hour' || entry.kind === 'per_order' ? entry.quantity : null,
            unitPrice: entry.kind === 'per_hour' || entry.kind === 'per_order' ? entry.unitPrice : null,
            amountCents: entry.cents.toString(),
            pmProgramId: programId,
            pmVariantId: entry.variantId,
            programKey: program.key,
          });
        }
      }
    }
    outputRows += output.length;
    const first = `${months[0] ?? today.slice(0, 7)}-01`;
    // 3. Build labor, in the program's zone, for every build of the program that feeds a job.
    const feedingBuilds = (buildIdsByProgram.get(programId) ?? []).filter((id) => buildJob.has(id) || jobOfProgram !== null);
    const hours = feedingBuilds.length > 0 ? await buildHours(ctx, { buildIds: feedingBuilds, timezone: program.timezone, from: first, to: today }) : [];
    const hoursByRef = new Map(hours.map((day) => [`pmb:${day.buildId}:${day.workDate}`, day]));
    // Keys and variants of every build with a line here, for the words on the line and time only days.
    const lineBuilds = await readBuilds(ctx, [...new Set([...output.map((row) => row.buildId), ...hours.map((day) => day.buildId)])], { throwOnError: true });
    const buildVariant = new Map<string, string | null>([...lineBuilds.values()].map((build) => [build.id, build.variantId]));
    const keys = new Map<string, string>([...lineBuilds.values()].map((build) => [build.id, build.key]));
    for (const row of output) {
      const job = targetOf(row, programId);
      if (!job) continue;
      const ref = `pmb:${row.buildId}:${row.workDate}`;
      const day = hoursByRef.get(ref);
      lines.set(ref, {
        ref,
        jobId: job.id,
        workDate: row.workDate,
        shift: 'projects',
        unitsGood: row.qty,
        unitsScrap: row.scrapQty,
        hours: hoursOf(day?.minutes ?? 0),
        headcount: day ? peopleOf(day.people, day.minutes) : null,
        pmTaskId: row.buildId,
        unitPrice: row.unitPrice,
        materialCostPerUnit: materialOf(row.variantId),
        pmProgramId: programId,
        pmVariantId: row.variantId,
        meta: { buildKey: keys.get(row.buildId) ?? builds.get(row.buildId)?.key ?? null, programKey: program.key },
      });
    }
    // A build day with time and no output still carries its labor, on the build's own posting job.
    for (const day of hours) {
      const ref = `pmb:${day.buildId}:${day.workDate}`;
      if (lines.has(ref) || day.minutes <= 0) continue;
      const job = buildJob.get(day.buildId) ?? jobOfProgram;
      if (!job) continue;
      lines.set(ref, {
        ref,
        jobId: job.id,
        workDate: day.workDate,
        shift: 'projects',
        unitsGood: '0',
        unitsScrap: '0',
        hours: hoursOf(day.minutes),
        headcount: peopleOf(day.people, day.minutes),
        pmTaskId: day.buildId,
        unitPrice: '0.0000',
        materialCostPerUnit: materialOf(buildVariant.get(day.buildId) ?? null),
        pmProgramId: programId,
        pmVariantId: buildVariant.get(day.buildId) ?? null,
        meta: { buildKey: keys.get(day.buildId) ?? null, programKey: program.key },
      });
    }
    // 6. Prep task labor on the program job.
    const mirror = mirrors.find((row) => row.target_type === 'pm_program' && row.target_id === programId);
    const edge = edges.find((item) => item.fromType === 'pm_program' && item.fromId === programId);
    if (jobOfProgram && settings.projectsTimeImport && edge && edge.meta.importPrepTime !== false && (mirror?.imports_time ?? true)) {
      const optIn = edge.meta.importTaskTime;
      const perTask = optIn === true ? await prepTaskIds(ctx, programId) : Array.isArray(optIn) ? optIn.filter((id): id is string => typeof id === 'string') : [];
      const prep = await prepHours(ctx, { programId, timezone: program.timezone, from: first, to: today, perTaskIds: perTask });
      for (const day of prep) {
        if (day.minutes <= 0) continue;
        const ref = `pmt:${programId}:${day.taskId ?? 'program'}:${day.workDate}`;
        lines.set(ref, {
          ref,
          jobId: jobOfProgram.id,
          workDate: day.workDate,
          shift: 'projects_time',
          unitsGood: '0',
          unitsScrap: '0',
          hours: hoursOf(day.minutes),
          headcount: peopleOf(day.people, day.minutes),
          pmTaskId: day.taskId,
          unitPrice: null,
          materialCostPerUnit: null,
          pmProgramId: programId,
          pmVariantId: null,
          meta: { programKey: program.key },
        });
      }
    }
  }

  // Builds outside any program that bill to their own job.
  const loose = [...buildJob.keys()].filter((id) => !builds.get(id)?.programId);
  if (loose.length > 0) {
    const looseBuilds = loose.map((id) => builds.get(id)!).filter(Boolean);
    const from = looseBuilds.reduce((min, build) => (build.buildDate < min ? build.buildDate : min), looseBuilds[0]!.buildDate);
    for (const [zone, ids] of groupBy(looseBuilds, (build) => buildJob.get(build.id)!.timezone)) {
      const today = options.today ?? todayInZone(zone);
      const start = `${from.slice(0, 7)}-01`;
      const output = await buildOutput(ctx, ids.map((build) => build.id), { from: start, to: today });
      outputRows += output.length;
      const hours = await buildHours(ctx, { buildIds: ids.map((build) => build.id), timezone: zone, from: start, to: today });
      const hoursByRef = new Map(hours.map((day) => [`pmb:${day.buildId}:${day.workDate}`, day]));
      for (const row of output) {
        const job = targetOf(row, null);
        if (!job) continue;
        const ref = `pmb:${row.buildId}:${row.workDate}`;
        const day = hoursByRef.get(ref);
        lines.set(ref, { ref, jobId: job.id, workDate: row.workDate, shift: 'projects', unitsGood: row.qty, unitsScrap: row.scrapQty, hours: hoursOf(day?.minutes ?? 0), headcount: day ? peopleOf(day.people, day.minutes) : null, pmTaskId: row.buildId, unitPrice: row.unitPrice, materialCostPerUnit: null, pmProgramId: null, pmVariantId: null, meta: { buildKey: builds.get(row.buildId)?.key ?? null } });
      }
      for (const day of hours) {
        const ref = `pmb:${day.buildId}:${day.workDate}`;
        const job = buildJob.get(day.buildId);
        if (lines.has(ref) || day.minutes <= 0 || !job) continue;
        lines.set(ref, { ref, jobId: job.id, workDate: day.workDate, shift: 'projects', unitsGood: '0', unitsScrap: '0', hours: hoursOf(day.minutes), headcount: peopleOf(day.people, day.minutes), pmTaskId: day.buildId, unitPrice: '0.0000', materialCostPerUnit: null, pmProgramId: null, pmVariantId: null, meta: { buildKey: builds.get(day.buildId)?.key ?? null } });
      }
    }
  }
  tally.counts.programOutputRows = outputRows;
  tally.counts.programLines = lines.size;
  tally.counts.programFees = fees.size;

  // What Pulse has now: every live line and fee the program sync owns, on any job of the org.
  const haveLines = new Map(
    (
      await rows<HaveLine>(
        db,
        sql`SELECT e.id, e.job_id, e.site_id, to_char(e.work_date, 'YYYY-MM-DD') AS work_date, e.source_ref, e.units_good::text AS units_good,
                   e.units_scrap::text AS units_scrap, e.hours::text AS hours, e.headcount::text AS headcount, e.pm_task_id, e.unit_price::text AS unit_price,
                   e.material_cost_per_unit::text AS material_cost_per_unit, e.pm_program_id, e.pm_variant_id, e.labor_class_id, e.shift, e.meta,
                   (j.deleted_at IS NULL) AS job_live
              FROM pulse.production_entries e JOIN pulse.jobs j ON j.id = e.job_id
             WHERE e.org_id = ${ctx.orgId} AND e.source = 'projects' AND e.deleted_at IS NULL
               AND (e.source_ref LIKE 'pmb:%' OR e.source_ref LIKE 'pmt:%')`,
      )
    ).map((row) => [row.source_ref, row]),
  );
  const haveFees = new Map(
    (
      await rows<HaveFee>(
        db,
        sql`SELECT r.id, r.job_id, r.site_id, r.client_id, to_char(r.revenue_date, 'YYYY-MM-DD') AS revenue_date, r.source_ref, r.kind, r.description,
                   r.quantity::text AS quantity, r.unit_price::text AS unit_price, r.amount_cents::text AS amount_cents, r.pm_program_id, r.pm_variant_id, r.meta,
                   (j.id IS NULL OR j.deleted_at IS NULL) AS job_live
              FROM pulse.revenue_entries r LEFT JOIN pulse.jobs j ON j.id = r.job_id
             WHERE r.org_id = ${ctx.orgId} AND r.source = 'projects' AND r.deleted_at IS NULL AND r.source_ref LIKE 'pmf:%'`,
      )
    ).map((row) => [row.source_ref, row]),
  );

  // 7. Batches per job and month. Closed months are skipped and counted.
  const batches = new Map<string, { job: JobRow; lines: WantLine[]; fees: WantFee[] }>();
  const allJobs = new Map<string, JobRow>([...programJob.values(), ...buildJob.values()].map((job) => [job.id, job]));
  for (const line of lines.values()) {
    seen.add(line.ref);
    if (closed.has(monthStart(line.workDate))) {
      const have = haveLines.get(line.ref);
      if (!have || have.job_id !== line.jobId || !sameNum(have.units_good, line.unitsGood) || !sameNum(have.unit_price, line.unitPrice) || !sameNum(have.hours, line.hours)) tally.skippedClosed += 1;
      continue;
    }
    // A row that sits in a closed month on its old job cannot move. It stays where it is.
    const have = haveLines.get(line.ref);
    if (have && have.job_id !== line.jobId && closed.has(monthStart(have.work_date))) {
      tally.skippedClosed += 1;
      continue;
    }
    const key = `${line.jobId}|${line.workDate.slice(0, 7)}`;
    const batch = batches.get(key) ?? { job: allJobs.get(line.jobId)!, lines: [], fees: [] };
    batch.lines.push(line);
    batches.set(key, batch);
  }
  for (const fee of fees.values()) {
    seen.add(fee.ref);
    if (closed.has(monthStart(fee.revenueDate))) {
      const have = haveFees.get(fee.ref);
      if (!have || have.amount_cents !== fee.amountCents || have.job_id !== fee.jobId) tally.skippedClosed += 1;
      continue;
    }
    const key = `${fee.jobId}|${fee.revenueDate.slice(0, 7)}`;
    const batch = batches.get(key) ?? { job: allJobs.get(fee.jobId)!, lines: [], fees: [] };
    batch.fees.push(fee);
    batches.set(key, batch);
  }
  for (const batch of [...batches.values()].sort((a, b) => (a.job.number + (a.lines[0]?.workDate ?? a.fees[0]?.revenueDate ?? '')).localeCompare(b.job.number + (b.lines[0]?.workDate ?? b.fees[0]?.revenueDate ?? '')))) {
    await writeBatch(ctx, batch.job, batch.lines, batch.fees, haveLines, haveFees, jobs, tally);
    await renew();
  }

  // 4. Gone rows, after the writes (a moved row was updated in place, so it is not gone).
  await removeGoneProgramRows(ctx, seen, haveLines, haveFees, jobs, closed, tally, renew);
});

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

/** Whether a program change note is still waiting for the sync (close checks, the job page). */
export const pendingProgramEvents = scoped(async function pendingProgramEvents(executor: Executor, ctx: DomainContext): Promise<{ pending: number; since: string | null }> {
  const [row] = await rows<{ pending: number; since: string | null }>(
    executor,
    sql`SELECT count(*)::int AS pending, to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS since
          FROM pulse.bridge_events WHERE org_id = ${ctx.orgId} AND kind = 'pm_program_changed' AND processed_at IS NULL`,
  );
  return { pending: row?.pending ?? 0, since: row?.since ?? null };
}, 1);
