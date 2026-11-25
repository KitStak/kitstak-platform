/**
 * Links (docs/programs/SPEC.md D3, 1.2, 4.2 `links.ts`, 4.3.3). The Linked panel reads the union
 * of `core.record_links` (both directions), legacy `pm.integration_links` and Pulse
 * `pulse.job_links` mirrors that point at the record, de duplicated by (type, id). Money edges are
 * only `bills_to` to a Pulse job: `linkPulseJob` checks the job, writes the edge, reposts open
 * output, refreshes the ledger and tells Pulse.
 */
import 'server-only';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { linkRecords, listRecordLinks, RecordLinkError, unlinkRecords, type RecordLinkRow, type RecordRef } from '@kitstak/db/record-links';
import { canLinkJob, LINK_JOB_MESSAGES } from '@kitstak/programs-engine/accrual';
import { firstDayOfMonth, lastDayOfMonth } from '@kitstak/programs-engine/calendar';
import { getJobFacts, getJobsSummary } from '@kitstak/pulse-bridge/programs';
import { db, type Executor } from '@/server/db';
import { builds, integrationLinks, projects, tasks } from '@/server/db/schema';
import { appUrls } from '@/server/env';
import { conflict, invalid, notFound } from '@/server/errors';
import { linkHref } from '@/server/integrations/link-url';
import type { IsoMonth, LinkedRecordDTO, LinkedRecordType, LinkedWorkDTO, LinkRelation } from '@/lib/program-types';
import { routes } from '@/lib/routes';
import { taskKey } from '@/lib/task-key';
import type { DomainContext } from '../_shared';
import { requireProject, requireTask } from '../access';
import { logActivity } from '../activity';
import { bridge, centsOut, lockSettings, shared, todayInZone } from './_program';
import { requireProgram } from './access';
import { emitProgramChanged } from './events';
import { monthsFrom, refreshLedgerFor } from './ledger';
import { programLocks } from './locks';
import { restampOutput } from './pricing';

export type LinkRef = { readonly type: 'pm_program' | 'pm_build' | 'pm_project'; readonly id: string };

const APP_OF: Readonly<Record<string, LinkedRecordDTO['app']>> = {
  core_customer: 'core',
  core_item: 'core',
  crm_deal: 'crm',
  crm_account: 'crm',
  pm_project: 'projects',
  pm_program: 'projects',
  pm_task: 'projects',
  pm_build: 'projects',
  pm_variant: 'projects',
  pulse_job: 'pulse',
  wms_work_order: 'wms',
  wms_shipment_order: 'wms',
  wms_client: 'wms',
  wms_product: 'wms',
};

function absolute(type: string, path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const app = APP_OF[type];
  const urls = appUrls();
  if (app === 'pulse') return `${urls.pulse}${path}`;
  if (app === 'crm') return linkHref('crm_item', path);
  if (app === 'wms') return linkHref('wms_order', path);
  return path;
}

interface PmTitle {
  title: string;
  status: string | null;
  url: string;
  live: boolean;
}

/** Titles and urls of pm records (programs, projects, builds, tasks) for the union. */
async function pmTitles(executor: Executor, ctx: DomainContext, refs: readonly { type: string; id: string }[]): Promise<Map<string, PmTitle>> {
  const out = new Map<string, PmTitle>();
  const projectIds = refs.filter((r) => r.type === 'pm_project' || r.type === 'pm_program').map((r) => r.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const taskIds = refs.filter((r) => r.type === 'pm_build' || r.type === 'pm_task').map((r) => r.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (projectIds.length) {
    const rows = await executor.select({ id: projects.id, key: projects.key, name: projects.name, kind: projects.kind, status: projects.status, deletedAt: projects.deletedAt }).from(projects).where(and(eq(projects.orgId, ctx.orgId), sql`${projects.id} in (${sql.join(projectIds.map((id) => sql`${id}::uuid`), sql`, `)})`));
    for (const row of rows) {
      const type = row.kind === 'program' ? 'pm_program' : 'pm_project';
      out.set(`${type}:${row.id}`, { title: `${row.name} (${row.key})`, status: row.status, url: row.kind === 'program' ? routes.program(row.key) : routes.project(row.key), live: !row.deletedAt });
    }
  }
  if (taskIds.length) {
    const rows = await executor
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, kind: tasks.kind, deletedAt: tasks.deletedAt, key: projects.key, projectKind: projects.kind })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.orgId, ctx.orgId), sql`${tasks.id} in (${sql.join(taskIds.map((id) => sql`${id}::uuid`), sql`, `)})`));
    for (const row of rows) {
      const type = row.kind === 'build' ? 'pm_build' : 'pm_task';
      out.set(`${type}:${row.id}`, { title: `${taskKey(row.key, row.number)} ${row.title}`, status: null, url: routes.taskAny(row.projectKind, row.key, row.number), live: !row.deletedAt });
    }
  }
  return out;
}

async function pulseJobTitles(executor: Executor, ctx: DomainContext, jobIds: readonly string[]): Promise<Map<string, { number: string; name: string; status: string; live: boolean }>> {
  const out = new Map<string, { number: string; name: string; status: string; live: boolean }>();
  for (const id of new Set(jobIds)) {
    const facts = await getJobFacts(bridge(executor), { orgId: ctx.orgId, userId: ctx.userId }, id);
    if (facts.available && facts.job) out.set(id, { number: facts.job.number, name: facts.job.name, status: facts.job.status, live: facts.job.live });
    else if (facts.available) out.set(id, { number: '', name: '', status: '', live: false });
  }
  return out;
}

function fromEdge(edge: RecordLinkRow, self: RecordRef): Omit<LinkedRecordDTO, 'title' | 'status' | 'url' | 'dangling'> & { cachedTitle: string | null; cachedStatus: string | null; cachedUrl: string | null } {
  const outbound = edge.from.type === self.type && edge.from.id === self.id;
  const other = outbound ? edge.to : edge.from;
  return {
    linkId: edge.id,
    source: 'record_links',
    type: other.type as LinkedRecordType,
    id: other.id,
    relation: edge.relation as LinkRelation,
    direction: outbound ? 'out' : 'in',
    app: APP_OF[other.type] ?? 'core',
    moneyEdge: edge.relation === 'bills_to',
    removable: true,
    createdAt: edge.createdAt,
    cachedTitle: edge.cachedTitle,
    cachedStatus: edge.cachedStatus,
    cachedUrl: edge.cachedUrl,
  };
}

/** The union of every link that touches a program, build or project (1.2 rule 4). */
export async function listRecordLinksFor(ctx: DomainContext, ref: LinkRef, executor: Executor = db): Promise<LinkedRecordDTO[]> {
  if (ref.type === 'pm_build') await requireTask(ctx, ref.id, 'project:read', executor);
  else await requireProject(ctx, { id: ref.id }, 'project:read', executor, { kind: ref.type === 'pm_program' ? 'program' : 'project' });
  const edges = await listRecordLinks(shared(executor), ctx.orgId, ref);
  const items = edges.map((edge) => fromEdge(edge, ref));
  // Legacy project and task links.
  const legacy = await executor
    .select()
    .from(integrationLinks)
    .where(and(eq(integrationLinks.orgId, ctx.orgId), ref.type === 'pm_build' ? eq(integrationLinks.taskId, ref.id) : and(eq(integrationLinks.projectId, ref.id), isNull(integrationLinks.taskId))));
  // Pulse mirrors (`pulse.job_links`) that point at the record.
  let mirrors: { id: string; job_id: string; created_at: string | null }[] = [];
  try {
    const result = await executor.execute(
      sql`select l.id::text as id, l.job_id::text as job_id, l.created_at::text as created_at from pulse.job_links l
           where l.org_id = ${ctx.orgId}::uuid and l.target_type = ${ref.type} and l.target_id = ${ref.id}`,
    );
    mirrors = (result as unknown as { rows: typeof mirrors }).rows;
  } catch {
    mirrors = [];
  }
  const pm = await pmTitles(executor, ctx, items);
  const jobs = await pulseJobTitles(executor, ctx, [...items.filter((i) => i.type === 'pulse_job').map((i) => i.id), ...mirrors.map((m) => m.job_id)]);
  const seen = new Set<string>();
  const out: LinkedRecordDTO[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pmTitle = pm.get(key);
    const job = item.type === 'pulse_job' ? jobs.get(item.id) : undefined;
    const title = pmTitle?.title ?? (job && job.number ? `${job.number} ${job.name}` : (item.cachedTitle ?? 'Linked record'));
    const dangling = item.app === 'projects' ? !pmTitle || !pmTitle.live : item.type === 'pulse_job' ? Boolean(job && !job.live) : false;
    const url = pmTitle?.url ?? (job && job.number ? `${appUrls().pulse}/jobs/${encodeURIComponent(job.number)}` : absolute(item.type, item.cachedUrl));
    out.push({
      linkId: item.linkId,
      source: item.source,
      type: item.type,
      id: item.id,
      relation: item.relation,
      direction: item.direction,
      title: dangling ? 'This record is no longer available' : title,
      status: pmTitle?.status ?? job?.status ?? item.cachedStatus,
      url: dangling ? null : url,
      app: item.app,
      moneyEdge: item.moneyEdge,
      dangling,
      removable: true,
      createdAt: item.createdAt,
    });
  }
  for (const row of legacy) {
    const type: LinkedRecordType = row.targetType === 'crm_item' ? ((row.meta as { boardKind?: string } | null)?.boardKind === 'account' ? 'crm_account' : 'crm_deal') : row.targetType === 'wms_order' ? 'wms_shipment_order' : (row.targetType as LinkedRecordType);
    const key = `${type}:${row.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      linkId: `legacy:integration_links:${row.id}`,
      source: 'integration_links',
      type,
      id: row.targetId,
      relation: 'related',
      direction: 'out',
      title: row.cachedTitle ?? 'Linked record',
      status: row.cachedStatus,
      url: linkHref(row.targetType, row.cachedUrl),
      app: APP_OF[type] ?? 'core',
      moneyEdge: false,
      dangling: false,
      removable: true,
      createdAt: row.createdAt.toISOString(),
    });
  }
  for (const mirror of mirrors) {
    const key = `pulse_job:${mirror.job_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const job = jobs.get(mirror.job_id);
    out.push({
      linkId: `legacy:job_links:${mirror.id}`,
      source: 'job_links',
      type: 'pulse_job',
      id: mirror.job_id,
      relation: 'related',
      direction: 'in',
      title: job && job.number ? `${job.number} ${job.name}` : 'Pulse job',
      status: job?.status ?? null,
      url: job && job.number ? `${appUrls().pulse}/jobs/${encodeURIComponent(job.number)}` : null,
      app: 'pulse',
      moneyEdge: false,
      dangling: Boolean(job && !job.live),
      removable: false,
      createdAt: mirror.created_at,
    });
  }
  return out;
}

async function assertCanLink(ctx: DomainContext, ref: RecordRef): Promise<void> {
  if (ref.type === 'pm_program') await requireProgram(ctx, { id: ref.id }, 'project:update');
  else if (ref.type === 'pm_build' || ref.type === 'pm_task') await requireTask(ctx, ref.id, 'task:update');
  else if (ref.type === 'pm_project') await requireProject(ctx, { id: ref.id }, 'project:update');
}

/** Adds a non money link. `bills_to` goes through `linkPulseJob`. */
export async function linkRecord(ctx: DomainContext, from: RecordRef, to: RecordRef, relation: LinkRelation = 'related', cache?: { title?: string; status?: string; url?: string }): Promise<LinkedRecordDTO> {
  if (relation === 'bills_to') throw invalid('Use Link a Pulse job to bill a program or a build to a job.');
  const pmSide = [from, to].find((ref) => ref.type.startsWith('pm_'));
  if (!pmSide) throw invalid('One side of a link has to be a program, project or build.');
  await assertCanLink(ctx, pmSide);
  try {
    const row = await linkRecords(shared(db), { orgId: ctx.orgId, from, to, relation, cache, createdBy: ctx.userId });
    await db.transaction((tx) => logActivity(tx, ctx, { verb: 'link.added', entityType: pmSide.type === 'pm_build' ? 'task' : 'project', entityId: pmSide.id, projectId: pmSide.type === 'pm_build' ? null : pmSide.id, taskId: pmSide.type === 'pm_build' ? pmSide.id : null, after: { type: row.from.id === pmSide.id ? row.to.type : row.from.type, relation } }));
    const list = await listRecordLinksFor(ctx, { type: pmSide.type as LinkRef['type'], id: pmSide.id });
    const other = row.from.id === pmSide.id && row.from.type === pmSide.type ? row.to : row.from;
    return list.find((item) => item.type === other.type && item.id === other.id) ?? list[0]!;
  } catch (error) {
    if (error instanceof RecordLinkError) throw error.code === 'TAKEN' ? conflict(error.message) : invalid(error.message);
    throw error;
  }
}

export async function unlinkRecord(ctx: DomainContext, linkId: string): Promise<void> {
  if (linkId.startsWith('legacy:integration_links:')) {
    const id = linkId.split(':')[2]!;
    const [row] = await db.select().from(integrationLinks).where(and(eq(integrationLinks.id, id), eq(integrationLinks.orgId, ctx.orgId)));
    if (!row) throw notFound('That link');
    if (row.projectId) await requireProject(ctx, { id: row.projectId }, 'project:update');
    else if (row.taskId) await requireTask(ctx, row.taskId, 'task:update');
    await db.delete(integrationLinks).where(eq(integrationLinks.id, id));
    return;
  }
  if (linkId.startsWith('legacy:')) throw invalid('This link lives in Pulse. Remove it there.');
  const result = await db.execute(sql`select from_type, from_id, to_type, to_id, relation from core.record_links where id = ${linkId}::uuid and org_id = ${ctx.orgId}::uuid`);
  const edge = (result as unknown as { rows: { from_type: string; from_id: string; to_type: string; to_id: string; relation: string }[] }).rows[0];
  if (!edge) throw notFound('That link');
  if (edge.relation === 'bills_to') {
    const target = edge.from_type === 'pm_program' ? { programId: edge.from_id } : { buildId: edge.from_id };
    await unlinkPulseJob(ctx, target);
    return;
  }
  const pmSide = edge.from_type.startsWith('pm_') ? { type: edge.from_type, id: edge.from_id } : { type: edge.to_type, id: edge.to_id };
  await assertCanLink(ctx, pmSide as RecordRef);
  await unlinkRecords(shared(db), ctx.orgId, linkId);
  await db.transaction((tx) => logActivity(tx, ctx, { verb: 'link.removed', entityType: 'project', entityId: pmSide.id, projectId: pmSide.type === 'pm_build' ? null : pmSide.id, before: { relation: edge.relation } }));
}

type JobTarget = { readonly programKey: string } | { readonly programId: string } | { readonly buildId: string };

async function resolveTarget(ctx: DomainContext, target: JobTarget) {
  if ('buildId' in target) {
    const { task, project } = await requireTask(ctx, target.buildId, 'project:update');
    if (task.kind !== 'build') throw notFound('That build');
    const [row] = await db.select().from(builds).where(eq(builds.taskId, task.id));
    return { kind: 'build' as const, ref: { type: 'pm_build' as const, id: task.id }, programId: row?.programId ?? null, container: project, program: project.kind === 'program' ? project : null };
  }
  const access = await requireProgram(ctx, 'programKey' in target ? target.programKey : { id: target.programId }, 'pricing:manage');
  return { kind: 'program' as const, ref: { type: 'pm_program' as const, id: access.program.id }, programId: access.program.id, container: access.program, program: access.program };
}

/** Bills a program or a build to a Pulse job (4.3.3). */
export async function linkPulseJob(ctx: DomainContext, target: JobTarget, jobId: string): Promise<{ repostedRows: number }> {
  const resolved = await resolveTarget(ctx, target);
  const facts = await getJobFacts(bridge(db), { orgId: ctx.orgId, userId: ctx.userId }, jobId);
  if (!facts.available) throw invalid('Pulse is not available, so a job cannot be linked right now.');
  if (!facts.job || !facts.job.live) throw notFound('That Pulse job');
  const verdict = canLinkJob(facts.job, { kind: resolved.kind, programId: resolved.programId });
  if (!verdict.ok) throw invalid(LINK_JOB_MESSAGES[verdict.reason]);
  const reposted = await db.transaction(async (tx) => {
    if (resolved.programId) await lockSettings(tx, [resolved.programId], 'update');
    try {
      await linkRecords(shared(tx), { orgId: ctx.orgId, from: resolved.ref, to: { type: 'pulse_job', id: jobId }, relation: 'bills_to', cache: { title: `${facts.job!.number} ${facts.job!.name}`, status: facts.job!.status, url: `/jobs/${encodeURIComponent(facts.job!.number)}` }, createdBy: ctx.userId });
    } catch (error) {
      if (error instanceof RecordLinkError) throw error.code === 'TAKEN' ? conflict(error.message) : invalid(error.message);
      throw error;
    }
    const locks = resolved.program ? await programLocks(ctx, resolved.program, tx) : null;
    const count = await restampOutput(tx, ctx, { containerId: resolved.container.id, programId: resolved.programId, locks, buildIds: resolved.kind === 'build' ? [resolved.ref.id] : undefined });
    if (resolved.programId && resolved.program) {
      const zone = await tx.execute(sql`select timezone from pm.program_settings where program_id = ${resolved.programId}::uuid`);
      const timezone = (zone as unknown as { rows: { timezone: string }[] }).rows[0]?.timezone ?? 'America/Chicago';
      const today = todayInZone(timezone);
      await refreshLedgerFor(tx, ctx, { programIds: [resolved.programId], months: monthsFrom(resolved.program.startDate ?? today, today) });
    }
    await logActivity(tx, ctx, { verb: 'program.pulse_job_linked', entityType: resolved.kind === 'build' ? 'task' : 'project', entityId: resolved.ref.id, projectId: resolved.container.id, taskId: resolved.kind === 'build' ? resolved.ref.id : null, after: { jobId, number: facts.job!.number, reposted: count } });
    await emitProgramChanged(tx, ctx, resolved.programId);
    return count;
  });
  return { repostedRows: reposted };
}

/** Removes a `bills_to` edge; open rows move to the program (or unbilled). */
export async function unlinkPulseJob(ctx: DomainContext, target: JobTarget): Promise<{ repostedRows: number }> {
  const resolved = await resolveTarget(ctx, target);
  const reposted = await db.transaction(async (tx) => {
    if (resolved.programId) await lockSettings(tx, [resolved.programId], 'update');
    const edges = await listRecordLinks(shared(tx), ctx.orgId, resolved.ref, { relation: 'bills_to', otherType: 'pulse_job' });
    if (edges.length === 0) return 0;
    for (const edge of edges) await unlinkRecords(shared(tx), ctx.orgId, edge.id);
    const locks = resolved.program ? await programLocks(ctx, resolved.program, tx) : null;
    const count = await restampOutput(tx, ctx, { containerId: resolved.container.id, programId: resolved.programId, locks, buildIds: resolved.kind === 'build' ? [resolved.ref.id] : undefined });
    if (resolved.programId && resolved.program) {
      const zone = await tx.execute(sql`select timezone from pm.program_settings where program_id = ${resolved.programId}::uuid`);
      const timezone = (zone as unknown as { rows: { timezone: string }[] }).rows[0]?.timezone ?? 'America/Chicago';
      const today = todayInZone(timezone);
      await refreshLedgerFor(tx, ctx, { programIds: [resolved.programId], months: monthsFrom(resolved.program.startDate ?? today, today) });
    }
    await logActivity(tx, ctx, { verb: 'program.pulse_job_unlinked', entityType: resolved.kind === 'build' ? 'task' : 'project', entityId: resolved.ref.id, projectId: resolved.container.id, taskId: resolved.kind === 'build' ? resolved.ref.id : null, after: { reposted: count } });
    await emitProgramChanged(tx, ctx, resolved.programId);
    return count;
  });
  return { repostedRows: reposted };
}

/** The program total plus related Pulse jobs (M2: `bills_to` jobs are never added again). */
export async function allLinkedWork(ctx: DomainContext, key: string, month: IsoMonth): Promise<LinkedWorkDTO> {
  const access = await requireProgram(ctx, key);
  const hidden = !access.caps.seesMoney;
  const totals = await db.execute(
    sql`select (select coalesce(sum(revenue_cents), 0) from pm.build_output where program_id = ${access.program.id}::uuid and deleted_at is null and work_date between ${firstDayOfMonth(month)}::date and ${lastDayOfMonth(month)}::date)
             + (select coalesce(sum(cents), 0) from pm.program_ledger where program_id = ${access.program.id}::uuid and deleted_at is null and month = ${firstDayOfMonth(month)}::date) as cents`,
  );
  const programCents = BigInt(String((totals as unknown as { rows: { cents: string }[] }).rows[0]?.cents ?? '0'));
  const related = (await listRecordLinks(shared(db), ctx.orgId, { type: 'pm_program', id: access.program.id }, { relation: 'related', otherType: 'pulse_job' })).map((edge) => (edge.to.type === 'pulse_job' ? edge.to.id : edge.from.id));
  const summary = related.length ? await getJobsSummary(bridge(db), { orgId: ctx.orgId, userId: ctx.userId }, { jobIds: related, month }) : null;
  const jobs = summary && summary.available ? summary.jobs : [];
  const relatedCents = jobs.reduce((sum, job) => sum + BigInt(job.revenueCents), BigInt(0));
  const jobHidden = hidden || Boolean(summary && summary.available && summary.moneyHidden);
  return {
    month,
    programCents: centsOut(programCents, hidden),
    relatedJobs: jobs.map((job) => ({ id: job.id, number: job.number, name: job.name, revenueCents: centsOut(job.revenueCents, jobHidden), url: `${appUrls().pulse}/jobs/${encodeURIComponent(job.number)}` })),
    relatedCents: centsOut(relatedCents, jobHidden),
    totalCents: centsOut(programCents + (jobHidden ? BigInt(0) : relatedCents), hidden),
    pulseAvailable: summary === null || summary.available,
  };
}

/** Program chips with this month's units for a project's Linked panel (5.14). */
export async function projectProgramChips(ctx: DomainContext, projectId: string): Promise<{ key: string; name: string; units: string }[]> {
  const edges = await listRecordLinks(shared(db), ctx.orgId, { type: 'pm_project', id: projectId }, { otherType: 'pm_program' });
  const ids = edges.map((edge) => (edge.from.type === 'pm_program' ? edge.from.id : edge.to.id));
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: projects.id, key: projects.key, name: projects.name })
    .from(projects)
    .where(and(eq(projects.orgId, ctx.orgId), or(...ids.map((id) => eq(projects.id, id))), isNull(projects.deletedAt)));
  const out: { key: string; name: string; units: string }[] = [];
  for (const row of rows) {
    const access = await requireProgram(ctx, { id: row.id }).catch(() => null);
    if (!access) continue;
    const today = todayInZone(access.settings.timezone);
    const month = today.slice(0, 7);
    const units = await db.execute(sql`select coalesce(sum(qty), 0)::text as units from pm.build_output where program_id = ${row.id}::uuid and deleted_at is null and work_date between ${firstDayOfMonth(month)}::date and ${today}::date`);
    out.push({ key: row.key, name: row.name, units: (units as unknown as { rows: { units: string }[] }).rows[0]?.units ?? '0' });
  }
  return out;
}

