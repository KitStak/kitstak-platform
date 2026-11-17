/**
 * Jobs (SPEC 5.2): CRUD, numbering, status changes, copy, archive, soft delete and restore,
 * dated prices and links to sibling records. List and detail DTOs carry the cached rollup
 * (`job_stats`) with the status reasons rendered for the reader.
 */
import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { clients, jobLinks, jobPlanLines, jobPlans, jobPrices, jobStats, jobTypes, jobs, sites, type UsualCrewLine } from '@/server/db/schema';
import { appUrls } from '@/server/env';
import { conflict, invalid, notFound } from '@/server/errors';
import {
  PULSE_STATUSES,
  type ConfidenceValue,
  type JobKindValue,
  type JobModeValue,
  type JobStatusValue,
  type LinkTargetType,
  type MaterialMethodValue,
  type PartsOwnerValue,
  type PricingModelValue,
  type PulseStatus,
  type StreamSource,
} from '@/lib/constants';
import { NEXT_STEP_LABELS, riskHeadline, riskSentence, type NextStep, type RiskRule } from '@/lib/profit';
import type { JobDetailDTO, JobDTO, JobLinkDTO, JobListFilters, JobListItemDTO, JobPriceDTO, JobStatsDTO, RiskReasonDTO } from '@/lib/types';
import { assertVersion, cleanText, defined, diff, hideUnless, inTx, iso, isoRequired, isUuid, moneyOut, monthName, rows, singular, todayInZone, type DomainContext } from './_shared';
import { restoreRow, softDeleteRow } from './_crud';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { ensureClientByName, getClientRow, getJobTypeRow, resolveSite } from './catalog';
import { recomputeJobs } from './job-stats';
import { filterOrgMembers, getPeople } from './people';
import { loadPlans, upsertPlan, type PlanInput } from './plans';
import { assertOpen, closedMonths, finishWrite, newTouched, restampFixedJob, restampProduction, restampUsage, touchDay } from './recalc';
import { generalJobTypeId, loadSettings } from './settings';

export type JobRow = typeof jobs.$inferSelect;
type StatsRow = typeof jobStats.$inferSelect;
type Access = Pick<PulseAccess, 'seesMoney'>;

interface JoinedJob {
  job: JobRow;
  clientName: string;
  clientCode: string;
  jobTypeName: string;
  siteName: string;
  stats: StatsRow | null;
}

export function toJobDTO(row: JoinedJob, access: Access): JobDTO {
  const job = row.job;
  const money = access.seesMoney;
  return {
    id: job.id,
    number: job.number,
    name: job.name,
    clientId: job.clientId,
    clientName: row.clientName,
    clientCode: row.clientCode,
    jobTypeId: job.jobTypeId,
    jobTypeName: row.jobTypeName,
    siteId: job.siteId,
    siteName: row.siteName,
    kind: job.kind as JobKindValue,
    status: job.status as JobStatusValue,
    pricingModel: job.pricingModel as PricingModelValue,
    unitLabel: job.unitLabel,
    plannedUnits: job.plannedUnits,
    unitPrice: hideUnless(money, job.unitPrice),
    fixedPriceCents: moneyOut(money, job.fixedPriceCents),
    billRateCents: moneyOut(money, job.billRateCents),
    materialMethod: job.materialMethod as MaterialMethodValue,
    materialCostPerUnit: hideUnless(money, job.materialCostPerUnit),
    partsOwner: job.partsOwner as PartsOwnerValue | null,
    defaultLaborClassId: job.defaultLaborClassId,
    usualCrew: job.usualCrew ?? [],
    standardUph: job.standardUph,
    targetMarginBp: hideUnless(money, job.targetMarginBp),
    startDate: job.startDate,
    dueDate: job.dueDate,
    completedDate: job.completedDate,
    poNumber: job.poNumber,
    ownerId: job.ownerId,
    description: job.description,
    kitSku: job.kitSku,
    kitName: job.kitName,
    wmsShortage: job.wmsShortage,
    pinnedNote: job.pinnedNote,
    archivedAt: iso(job.archivedAt),
    deletedAt: iso(job.deletedAt),
    source: job.source as StreamSource,
    isSample: job.isSample,
    version: job.version,
    createdAt: isoRequired(job.createdAt),
    updatedAt: isoRequired(job.updatedAt),
    moneyHidden: !money,
  };
}

interface StoredReason {
  rule: RiskRule;
  params: Record<string, string | number | null>;
  impactCents: number | null;
  nextStep: NextStep | null;
}

/** The cached rollup as a DTO. Reasons become words here, per reader (SPEC section 3). */
export function toJobStatsDTO(stats: StatsRow | null, access: Access, unitLabel = 'unit'): JobStatsDTO {
  const money = access.seesMoney;
  const options = { seesMoney: money, unitLabel: singular(unitLabel) };
  const stored = ((stats?.riskReasons as StoredReason[] | undefined) ?? []).filter((reason) => reason && typeof reason.rule === 'string');
  const reasons: RiskReasonDTO[] = stored.map((reason) => ({
    rule: reason.rule,
    params: money ? (reason.params ?? {}) : {},
    impactCents: money ? (reason.impactCents ?? 0) : null,
    nextStep: reason.nextStep ?? null,
    nextStepLabel: reason.nextStep ? (NEXT_STEP_LABELS[reason.nextStep] ?? null) : null,
    text: riskSentence({ rule: reason.rule, params: reason.params ?? {} }, options),
  }));
  const needs = (stats?.needs ?? {}) as Record<string, unknown>;
  const status = (stats?.riskStatus as PulseStatus | null) ?? null;
  const first = stored[0];
  const headline = status ? riskHeadline({ status, headline: first ? { rule: first.rule, params: first.params ?? {}, status, impactCents: BigInt(first.impactCents ?? 0), nextStep: (first.nextStep ?? 'review_job') as NextStep } : null, summary: (needs.summary as Record<string, string | number | null>) ?? {} }, options) : '';
  const revenue = stats?.revenueCents ?? BigInt(0);
  const billed = stats?.billedCents ?? BigInt(0);
  const { summary: _summary, ...publicNeeds } = needs;
  void _summary;
  return {
    unitsGood: stats?.unitsGood ?? '0',
    unitsScrap: stats?.unitsScrap ?? '0',
    unitsRework: stats?.unitsRework ?? '0',
    hours: stats?.hours ?? '0',
    overtimeHours: stats?.overtimeHours ?? '0',
    setupHours: stats?.setupHours ?? '0',
    paceHours: stats?.paceHours ?? '0',
    evidenceDays: stats?.evidenceDays ?? 0,
    revenueCents: moneyOut(money, revenue),
    baseRevenueCents: moneyOut(money, stats?.baseRevenueCents ?? 0),
    vasRevenueCents: moneyOut(money, stats?.vasRevenueCents ?? 0),
    otherRevenueCents: moneyOut(money, stats?.otherRevenueCents ?? 0),
    billedCents: moneyOut(money, billed),
    notBilledYetCents: moneyOut(money, revenue - billed),
    laborCents: moneyOut(money, stats?.laborCents ?? 0),
    materialCents: moneyOut(money, stats?.materialCents ?? 0),
    scrapCents: moneyOut(money, stats?.scrapCents ?? 0),
    otherCents: moneyOut(money, stats?.otherCents ?? 0),
    sharedCents: moneyOut(money, stats?.sharedCents ?? 0),
    costCents: moneyOut(money, stats?.costCents ?? 0),
    profitCents: moneyOut(money, stats?.profitCents ?? 0),
    marginBp: hideUnless(money, stats?.marginBp),
    marginBeforeSharedBp: hideUnless(money, stats?.marginBeforeSharedBp),
    uph: stats?.uph ?? null,
    standardUph: stats?.standardUph ?? null,
    productivityBp: stats?.productivityBp ?? null,
    pctCompleteBp: stats?.pctCompleteBp ?? null,
    targetMarginBp: hideUnless(money, stats?.targetMarginBp),
    mode: (stats?.mode as JobModeValue | null) ?? null,
    costAtFinishCents: moneyOut(money, stats?.costAtFinishCents),
    revenueAtFinishCents: moneyOut(money, stats?.revenueAtFinishCents),
    projectedProfitCents: moneyOut(money, stats?.projectedProfitCents),
    projectedMarginBp: hideUnless(money, stats?.projectedMarginBp),
    projectedLaborHours: stats?.projectedLaborHours ?? null,
    projectedFinishDate: stats?.projectedFinishDate ?? null,
    paceUph: stats?.paceUph ?? null,
    paceWeightBp: stats?.paceWeightBp ?? null,
    confidence: (stats?.confidence as ConfidenceValue | null) ?? null,
    riskStatus: status,
    riskReasons: reasons,
    headline,
    needs: publicNeeds,
    laborMissing: Boolean(needs.laborMissing),
    firstEntryDate: stats?.firstEntryDate ?? null,
    lastEntryDate: stats?.lastEntryDate ?? null,
    entryCount: stats?.entryCount ?? 0,
    computedAt: iso(stats?.computedAt),
    moneyHidden: !money,
  };
}

const joined = (executor: Executor) =>
  executor
    .select({ job: jobs, clientName: clients.name, clientCode: clients.code, jobTypeName: jobTypes.name, siteName: sites.name, stats: jobStats })
    .from(jobs)
    .innerJoin(clients, eq(clients.id, jobs.clientId))
    .innerJoin(jobTypes, eq(jobTypes.id, jobs.jobTypeId))
    .innerJoin(sites, eq(sites.id, jobs.siteId))
    .leftJoin(jobStats, eq(jobStats.jobId, jobs.id));

const RISK_ORDER = sql`CASE ${jobStats.riskStatus} WHEN 'losing' THEN 0 WHEN 'at_risk' THEN 1 WHEN 'no_data' THEN 2 WHEN 'heads_up' THEN 3 WHEN 'on_track' THEN 4 ELSE 5 END`;

async function planHours(executor: Executor, orgId: string, jobIds: readonly string[]): Promise<Map<string, string>> {
  if (jobIds.length === 0) return new Map();
  const plans = await executor
    .select({ jobId: jobPlans.jobId, plan: jobPlans.plan, laborHours: jobPlans.laborHours })
    .from(jobPlans)
    .where(and(eq(jobPlans.orgId, orgId), inArray(jobPlans.jobId, [...jobIds])));
  const out = new Map<string, string>();
  for (const plan of plans) if (plan.plan === 'budget' || !out.has(plan.jobId)) out.set(plan.jobId, plan.laborHours);
  return out;
}

/** Jobs for the Jobs page. The Open tab is the at risk list: worst status first, then lowest projected profit. */
export async function listJobs(ctx: DomainContext, filters: JobListFilters = {}): Promise<JobListItemDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const where: (SQL | undefined)[] = [eq(jobs.orgId, ctx.orgId)];
  if (!filters.includeDeleted) where.push(isNull(jobs.deletedAt));
  const tab = filters.tab ?? 'all';
  if (tab === 'open') where.push(inArray(jobs.status, ['active', 'on_hold']));
  if (tab === 'completed') where.push(inArray(jobs.status, ['completed', 'cancelled']));
  if (tab === 'planned') where.push(eq(jobs.status, 'planned'));
  if (!filters.includeArchived && tab !== 'all') where.push(isNull(jobs.archivedAt));
  if (filters.status && filters.status.length > 0) where.push(inArray(jobs.status, [...filters.status]));
  if (filters.clientId) where.push(eq(jobs.clientId, filters.clientId));
  if (filters.jobTypeId) where.push(eq(jobs.jobTypeId, filters.jobTypeId));
  if (filters.siteId) where.push(eq(jobs.siteId, filters.siteId));
  if (filters.ownerId) where.push(eq(jobs.ownerId, filters.ownerId));
  const risk = (filters.risk ?? []).filter((value) => (PULSE_STATUSES as readonly string[]).includes(value));
  if (risk.length > 0) where.push(inArray(jobStats.riskStatus, risk));
  const q = cleanText(filters.q)?.toLowerCase().replace(/[%_\\]/g, '');
  if (q) where.push(sql`(lower(${jobs.number}) like ${`${q}%`} or lower(${jobs.name}) like ${`%${q}%`} or lower(${clients.name}) like ${`%${q}%`} or lower(coalesce(${jobs.poNumber}, '')) like ${`${q}%`})`);
  const found = await joined(db)
    .where(and(...where))
    .orderBy(...(tab === 'open' ? [RISK_ORDER, sql`${jobStats.projectedProfitCents} asc nulls last`, asc(jobs.dueDate)] : [desc(jobs.createdAt)]), asc(jobs.number))
    .limit(Math.min(filters.limit ?? 1000, 5000));
  const hours = await planHours(db, ctx.orgId, found.map((row) => row.job.id));
  return found.map((row) => ({ ...toJobDTO(row, access), stats: toJobStatsDTO(row.stats, access, row.job.unitLabel), planLaborHours: hours.get(row.job.id) ?? null }));
}

/** Losing and at risk jobs, worst first (Home "Jobs that need you", the bridge, the wall). */
export async function listJobsNeedingAttention(ctx: DomainContext, limit = 10): Promise<JobListItemDTO[]> {
  const all = await listJobs(ctx, { tab: 'open', risk: ['losing', 'at_risk', 'no_data'], limit: Math.min(Math.max(limit, 1), 100) });
  return all;
}

/** Counts per status for the filter chips on the Jobs page. */
export async function countJobsByRisk(ctx: DomainContext, filters: Pick<JobListFilters, 'clientId' | 'jobTypeId' | 'siteId'> = {}): Promise<Record<PulseStatus | 'none', number>> {
  await requirePulse(ctx, 'pulse:read');
  const found = await rows<{ risk: string | null; n: number }>(
    db,
    sql`SELECT st.risk_status AS risk, count(*)::int AS n FROM pulse.jobs j LEFT JOIN pulse.job_stats st ON st.job_id = j.id
         WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.archived_at IS NULL AND j.status IN ('active', 'on_hold')
           ${filters.clientId ? sql`AND j.client_id = ${filters.clientId}` : sql``} ${filters.jobTypeId ? sql`AND j.job_type_id = ${filters.jobTypeId}` : sql``}
           ${filters.siteId ? sql`AND j.site_id = ${filters.siteId}` : sql``}
         GROUP BY st.risk_status`,
  );
  const out: Record<PulseStatus | 'none', number> = { losing: 0, at_risk: 0, heads_up: 0, on_track: 0, no_data: 0, none: 0 };
  for (const row of found) out[(row.risk as PulseStatus | null) ?? 'none'] += row.n;
  return out;
}

/**
 * `/jobs/[ref]`: a uuid that is a job id wins, else the job number without case (SPEC 5.2).
 * Deleted jobs are found only with `includeDeleted`.
 */
export async function getJobRow(ctx: DomainContext, ref: string, executor: Executor = db, includeDeleted = false): Promise<JobRow> {
  const live = includeDeleted ? undefined : isNull(jobs.deletedAt);
  if (isUuid(ref)) {
    const [row] = await executor.select().from(jobs).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, ref), live));
    if (row) return row;
  }
  const [row] = await executor
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, ctx.orgId), sql`lower(${jobs.number}) = ${ref.trim().toLowerCase()}`, live))
    .orderBy(sql`${jobs.deletedAt} nulls first`)
    .limit(1);
  if (!row) throw notFound('That job');
  return row;
}

function linkUrl(type: LinkTargetType, path: string | null): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null;
  const urls = appUrls();
  const host = type.startsWith('crm_') ? urls.crm : type.startsWith('wms_') ? urls.wms : urls.projects;
  return `${host.replace(/\/+$/, '')}${path}`;
}

function toLinkDTO(row: typeof jobLinks.$inferSelect): JobLinkDTO {
  return { id: row.id, jobId: row.jobId, targetType: row.targetType as LinkTargetType, targetId: row.targetId, importsTime: row.importsTime, title: row.cachedTitle, status: row.cachedStatus, url: linkUrl(row.targetType as LinkTargetType, row.cachedUrl) };
}

function toPriceDTO(row: typeof jobPrices.$inferSelect, access: Access): JobPriceDTO {
  const money = access.seesMoney;
  return { id: row.id, jobId: row.jobId, effectiveFrom: row.effectiveFrom, unitPrice: hideUnless(money, row.unitPrice), billRateCents: moneyOut(money, row.billRateCents), materialCostPerUnit: hideUnless(money, row.materialCostPerUnit), note: row.note, createdAt: isoRequired(row.createdAt) };
}

async function detail(ctx: DomainContext, jobId: string, access: Access, executor: Executor = db): Promise<JobDetailDTO> {
  const [row] = await joined(executor).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, jobId)));
  if (!row) throw notFound('That job');
  // One at a time: inside a transaction all four share one connection.
  const prices = await executor.select().from(jobPrices).where(and(eq(jobPrices.orgId, ctx.orgId), eq(jobPrices.jobId, jobId))).orderBy(desc(jobPrices.effectiveFrom));
  const plans = await loadPlans(ctx, jobId, access, executor);
  const links = await executor.select().from(jobLinks).where(and(eq(jobLinks.orgId, ctx.orgId), eq(jobLinks.jobId, jobId))).orderBy(asc(jobLinks.createdAt));
  const people = await getPeople(row.job.ownerId ? [row.job.ownerId] : [], executor);
  const plan = plans.budget ?? plans.quote;
  return {
    ...toJobDTO(row, access),
    stats: toJobStatsDTO(row.stats, access, row.job.unitLabel),
    planLaborHours: plan?.laborHours ?? null,
    prices: prices.map((price) => toPriceDTO(price, access)),
    quote: plans.quote,
    budget: plans.budget,
    links: links.map(toLinkDTO),
    owner: row.job.ownerId ? (people.get(row.job.ownerId) ?? null) : null,
  };
}

export async function getJob(ctx: DomainContext, ref: string): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const row = await getJobRow(ctx, ref, db, true);
  return detail(ctx, row.id, access);
}

/** One `UPDATE ... RETURNING` per try, repeated while the number is taken by an imported or warehouse coded job. */
export async function nextJobNumber(tx: Executor, orgId: string): Promise<string> {
  await loadSettings(orgId, tx);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const [row] = await rows<{ seq: number; prefix: string }>(tx, sql`UPDATE pulse.settings SET job_seq = job_seq + 1 WHERE org_id = ${orgId} RETURNING job_seq AS seq, job_number_prefix AS prefix`);
    if (!row) break;
    const candidate = `${row.prefix}${row.seq}`;
    const taken = await rows(tx, sql`SELECT 1 FROM pulse.jobs WHERE org_id = ${orgId} AND lower(number) = ${candidate.toLowerCase()} AND deleted_at IS NULL`);
    if (taken.length === 0) return candidate;
  }
  throw conflict('Pulse could not find a free job number. Type one by hand.');
}

export interface JobLinkInput {
  targetType: LinkTargetType;
  targetId: string;
  importsTime?: boolean;
  title?: string | null;
  status?: string | null;
  /** A path into the sibling app that starts with one slash. */
  url?: string | null;
}

export interface JobInput {
  number?: string | null;
  name: string;
  clientId?: string | null;
  /** Used when `clientId` is not given: finds the client by name or makes it. */
  clientName?: string | null;
  jobTypeId?: string | null;
  siteId?: string | null;
  kind?: JobKindValue;
  status?: JobStatusValue;
  pricingModel?: PricingModelValue;
  unitLabel?: string | null;
  plannedUnits?: string;
  unitPrice?: string | null;
  fixedPriceCents?: number | null;
  billRateCents?: number | null;
  materialMethod?: MaterialMethodValue;
  materialCostPerUnit?: string;
  partsOwner?: PartsOwnerValue | null;
  defaultLaborClassId?: string | null;
  usualCrew?: UsualCrewLine[];
  standardUph?: string | null;
  targetMarginBp?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  completedDate?: string | null;
  poNumber?: string | null;
  ownerId?: string | null;
  description?: string | null;
  kitSku?: string | null;
  kitName?: string | null;
  pinnedNote?: string | null;
  quote?: PlanInput | null;
  budget?: PlanInput | null;
  links?: JobLinkInput[];
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
}

function safePath(url: string | null | undefined): string | null {
  const path = cleanText(url);
  return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
}

async function insertLinks(tx: Executor, ctx: DomainContext, jobId: string, links: readonly JobLinkInput[]): Promise<void> {
  for (const link of links) {
    const targetId = cleanText(link.targetId);
    if (!targetId) continue;
    const [row] = await tx
      .insert(jobLinks)
      .values({ orgId: ctx.orgId, jobId, targetType: link.targetType, targetId, importsTime: Boolean(link.importsTime), cachedTitle: cleanText(link.title), cachedStatus: cleanText(link.status), cachedUrl: safePath(link.url), cachedAt: new Date(), createdBy: ctx.userId })
      .onConflictDoNothing({ target: [jobLinks.jobId, jobLinks.targetType, jobLinks.targetId] })
      .returning();
    if (row) await logActivity(tx, ctx, { verb: 'link.added', entityType: 'link', entityId: row.id, jobId, after: { targetType: row.targetType, targetId: row.targetId, importsTime: row.importsTime } });
  }
}

async function ownerOrNull(tx: Executor, ctx: DomainContext, ownerId: string | null | undefined): Promise<string | null> {
  if (!ownerId) return null;
  const ok = await filterOrgMembers(ctx, [ownerId], tx);
  if (ok.length === 0) throw invalid('The owner must be a member of this workspace.', { ownerId: 'Pick a member of this workspace.' });
  return ownerId;
}

/** Inserts a job with its first price row, optional plans and links, inside `tx`. Returns the row. */
export async function insertJob(tx: Executor, ctx: DomainContext, input: JobInput): Promise<JobRow> {
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the job a name.', { name: 'Give the job a name.' });
  await loadSettings(ctx.orgId, tx);
  const client = input.clientId ? await getClientRow(ctx, input.clientId, tx) : await ensureClientByName(tx, ctx, input.clientName ?? '');
  const jobType = await getJobTypeRow(ctx, input.jobTypeId ?? (await generalJobTypeId(ctx.orgId, tx)), tx);
  const site = await resolveSite(ctx, input.siteId, tx);
  const typed = cleanText(input.number);
  const number = typed ?? (await nextJobNumber(tx, ctx.orgId));
  const status = input.status ?? 'planned';
  const pricingModel = input.pricingModel ?? (jobType.defaultPricingModel as PricingModelValue);
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw invalid('The due date is before the start date.', { dueDate: 'The due date is before the start date.' });
  const completedDate = status === 'completed' ? (input.completedDate ?? todayInZone(site.timezone)) : null;
  const [row] = await tx
    .insert(jobs)
    .values({
      orgId: ctx.orgId,
      number,
      name,
      clientId: client.id,
      jobTypeId: jobType.id,
      siteId: site.id,
      kind: input.kind ?? 'one_time',
      status,
      pricingModel,
      unitLabel: cleanText(input.unitLabel) ?? jobType.unitLabel,
      plannedUnits: input.plannedUnits ?? '0',
      unitPrice: input.unitPrice ?? null,
      fixedPriceCents: input.fixedPriceCents === null || input.fixedPriceCents === undefined ? null : BigInt(input.fixedPriceCents),
      billRateCents: input.billRateCents ?? null,
      materialMethod: input.materialMethod ?? 'standard',
      materialCostPerUnit: input.materialCostPerUnit ?? '0',
      partsOwner: input.partsOwner ?? null,
      defaultLaborClassId: input.defaultLaborClassId ?? jobType.defaultLaborClassId,
      usualCrew: input.usualCrew ?? [],
      standardUph: input.standardUph ?? null,
      targetMarginBp: input.targetMarginBp ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      completedDate,
      activatedAt: status === 'active' || status === 'completed' ? new Date() : null,
      poNumber: cleanText(input.poNumber),
      ownerId: await ownerOrNull(tx, ctx, input.ownerId),
      description: cleanText(input.description),
      kitSku: cleanText(input.kitSku),
      kitName: cleanText(input.kitName),
      pinnedNote: cleanText(input.pinnedNote),
      source: input.source ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      isSample: Boolean(input.isSample),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  const job = row!;
  // The first price row of a job covers every date (SPEC 5.2).
  await tx.insert(jobPrices).values({ orgId: ctx.orgId, jobId: job.id, effectiveFrom: '0001-01-01', unitPrice: job.unitPrice, billRateCents: job.billRateCents, materialCostPerUnit: job.materialCostPerUnit, createdBy: ctx.userId });
  await logActivity(tx, ctx, { verb: 'job.created', entityType: 'job', entityId: job.id, jobId: job.id, clientId: job.clientId, after: { number: job.number, name: job.name, status: job.status, clientId: job.clientId, jobTypeId: job.jobTypeId } });
  if (input.quote) await upsertPlan(tx, ctx, job.id, 'quote', input.quote);
  if (input.budget) await upsertPlan(tx, ctx, job.id, 'budget', input.budget);
  if (input.links && input.links.length > 0) await insertLinks(tx, ctx, job.id, input.links);
  return job;
}

export async function createJob(ctx: DomainContext, input: JobInput): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const job = await insertJob(tx, ctx, input);
    await recomputeJobs(tx, ctx, [job.id]);
    return detail(ctx, job.id, access, tx);
  });
}

/**
 * The quick add row on the Jobs page and the log grid: client, job name, units, price per unit.
 * Uses the General job type, starts today, is active at once and makes the quote from the price.
 */
export async function quickAddJob(ctx: DomainContext, input: { clientId?: string | null; clientName?: string | null; name: string; plannedUnits?: string | null; unitPrice?: string | null; siteId?: string | null }): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const site = await resolveSite(ctx, input.siteId, tx);
    const units = input.plannedUnits ?? '0';
    const [revenue] = await rows<{ cents: string }>(tx, sql`SELECT round(${units}::numeric * ${input.unitPrice ?? '0'}::numeric * 100)::bigint::text AS cents`);
    const hasQuote = Number(units) > 0 && input.unitPrice !== null && input.unitPrice !== undefined;
    const job = await insertJob(tx, ctx, {
      name: input.name,
      clientId: input.clientId,
      clientName: input.clientName,
      siteId: site.id,
      status: 'active',
      plannedUnits: units,
      unitPrice: input.unitPrice ?? null,
      startDate: todayInZone(site.timezone),
      quote: hasQuote ? { units, revenueCents: Number(revenue?.cents ?? 0), origin: 'typed' } : null,
    });
    await recomputeJobs(tx, ctx, [job.id]);
    return detail(ctx, job.id, access, tx);
  });
}

export type JobPatch = Partial<Omit<JobInput, 'clientName' | 'quote' | 'budget' | 'links' | 'status' | 'unitPrice' | 'billRateCents' | 'materialCostPerUnit' | 'source' | 'sourceRef' | 'isSample' | 'completedDate'>>;

/** Fields whose change moves stamps on the job's open entries (SPEC 4.17). */
const RESTAMP_FIELDS = ['plannedUnits', 'fixedPriceCents', 'pricingModel', 'materialMethod', 'partsOwner', 'siteId'] as const;

async function touchWholeJob(tx: Executor, ctx: DomainContext, jobId: string): Promise<void> {
  const touched = newTouched();
  touched.jobIds.add(jobId);
  const days = await rows<{ site_id: string; d: string }>(
    tx,
    sql`SELECT DISTINCT site_id, to_char(work_date, 'YYYY-MM-DD') AS d FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND job_id = ${jobId}
        UNION SELECT DISTINCT site_id, to_char(work_date, 'YYYY-MM-DD') FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND job_id = ${jobId}`,
  );
  for (const day of days) touchDay(touched, day.site_id, day.d);
  await finishWrite(tx, ctx, touched);
}

/**
 * Edits a job. Prices change through `setJobPrice` (they are dated) and status through
 * `setJobStatus`. Planned units, fixed price, pricing model, material method and parts owner
 * restamp the job's open entries in the same transaction.
 */
export async function updateJob(ctx: DomainContext, jobId: string, patch: JobPatch, version?: number | null): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const before = await getJobRow(ctx, jobId, tx);
    assertVersion(before.version, version);
    if (patch.clientId) await getClientRow(ctx, patch.clientId, tx);
    if (patch.jobTypeId) await getJobTypeRow(ctx, patch.jobTypeId, tx);
    if (patch.siteId) await resolveSite(ctx, patch.siteId, tx);
    const start = patch.startDate === undefined ? before.startDate : patch.startDate;
    const due = patch.dueDate === undefined ? before.dueDate : patch.dueDate;
    if (start && due && due < start) throw invalid('The due date is before the start date.', { dueDate: 'The due date is before the start date.' });
    const values = defined({
      number: patch.number === undefined ? undefined : (cleanText(patch.number) ?? before.number),
      name: patch.name === undefined ? undefined : (cleanText(patch.name) ?? before.name),
      clientId: patch.clientId ?? undefined,
      jobTypeId: patch.jobTypeId ?? undefined,
      siteId: patch.siteId ?? undefined,
      kind: patch.kind,
      pricingModel: patch.pricingModel,
      unitLabel: patch.unitLabel === undefined ? undefined : (cleanText(patch.unitLabel) ?? 'units'),
      plannedUnits: patch.plannedUnits,
      fixedPriceCents: patch.fixedPriceCents === undefined ? undefined : patch.fixedPriceCents === null ? null : BigInt(patch.fixedPriceCents),
      materialMethod: patch.materialMethod,
      partsOwner: patch.partsOwner,
      defaultLaborClassId: patch.defaultLaborClassId,
      usualCrew: patch.usualCrew,
      standardUph: patch.standardUph,
      targetMarginBp: patch.targetMarginBp,
      startDate: patch.startDate,
      dueDate: patch.dueDate,
      poNumber: patch.poNumber === undefined ? undefined : cleanText(patch.poNumber),
      ownerId: patch.ownerId === undefined ? undefined : await ownerOrNull(tx, ctx, patch.ownerId),
      description: patch.description === undefined ? undefined : cleanText(patch.description),
      kitSku: patch.kitSku === undefined ? undefined : cleanText(patch.kitSku),
      kitName: patch.kitName === undefined ? undefined : cleanText(patch.kitName),
      pinnedNote: patch.pinnedNote === undefined ? undefined : cleanText(patch.pinnedNote),
    });
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return detail(ctx, before.id, access, tx);
    if ('siteId' in change.after) {
      const [used] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND job_id = ${before.id} AND deleted_at IS NULL`);
      if ((used?.n ?? 0) > 0) throw conflict('This job already has work logged at its site. Copy the job to run it at another site.');
    }
    await tx.update(jobs).set({ ...values, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(jobs.id, before.id));
    await logActivity(tx, ctx, { verb: 'job.updated', entityType: 'job', entityId: before.id, jobId: before.id, clientId: before.clientId, ...change });
    if (RESTAMP_FIELDS.some((field) => field in change.after)) {
      await restampProduction(tx, ctx.orgId, sql`src.job_id = ${before.id}`);
      await restampUsage(tx, ctx.orgId, sql`src.job_id = ${before.id}`);
      await restampFixedJob(tx, ctx, before.id);
      await touchWholeJob(tx, ctx, before.id);
    } else if ('clientId' in change.after || 'jobTypeId' in change.after) {
      const touched = newTouched();
      touched.jobIds.add(before.id);
      await finishWrite(tx, ctx, touched);
    } else {
      await recomputeJobs(tx, ctx, [before.id]);
    }
    return detail(ctx, before.id, access, tx);
  });
}

const STATUS_MOVES: Readonly<Record<JobStatusValue, readonly JobStatusValue[]>> = {
  planned: ['active', 'on_hold', 'cancelled', 'completed'],
  active: ['on_hold', 'completed', 'cancelled', 'planned'],
  on_hold: ['active', 'cancelled', 'completed', 'planned'],
  completed: ['active'],
  cancelled: ['planned', 'active'],
};

/**
 * Changes a job's status. Completing stamps the completed date (today at the job's site unless
 * given) and, for a fixed price job, writes the true up; that date may not sit in a closed month.
 */
export async function setJobStatus(ctx: DomainContext, jobId: string, status: JobStatusValue, options: { completedDate?: string | null; version?: number | null } = {}): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const before = await getJobRow(ctx, jobId, tx);
    assertVersion(before.version, options.version);
    const from = before.status as JobStatusValue;
    if (from === status) return detail(ctx, before.id, access, tx);
    if (!STATUS_MOVES[from].includes(status)) throw conflict('That status change is not allowed. Reopen the job first.');
    const site = await resolveSite(ctx, before.siteId, tx);
    const completedDate = status === 'completed' ? (options.completedDate ?? todayInZone(site.timezone)) : null;
    if (completedDate && before.pricingModel === 'fixed') {
      const closed = await closedMonths(tx, ctx.orgId);
      const month = `${completedDate.slice(0, 7)}-01`;
      if (closed.has(month)) throw conflict(`Reopen ${monthName(month)} first.`);
    }
    if (from === 'completed' && before.completedDate && before.pricingModel === 'fixed') {
      const closed = await closedMonths(tx, ctx.orgId);
      const month = `${before.completedDate.slice(0, 7)}-01`;
      if (closed.has(month)) throw conflict(`Reopen ${monthName(month)} first.`);
    }
    await tx
      .update(jobs)
      .set({ status, completedDate, activatedAt: status === 'active' && !before.activatedAt ? new Date() : before.activatedAt, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(jobs.id, before.id));
    await logActivity(tx, ctx, { verb: 'job.status_changed', entityType: 'job', entityId: before.id, jobId: before.id, clientId: before.clientId, field: 'status', before: { status: from, completedDate: before.completedDate }, after: { status, completedDate } });
    await restampFixedJob(tx, ctx, before.id);
    const touched = newTouched();
    touched.jobIds.add(before.id);
    await finishWrite(tx, ctx, touched);
    return detail(ctx, before.id, access, tx);
  });
}

/** Bulk actions on the Jobs page: set status or owner on many jobs. Returns how many changed. */
export async function bulkUpdateJobs(ctx: DomainContext, jobIds: readonly string[], patch: { status?: JobStatusValue; ownerId?: string | null; archived?: boolean }): Promise<{ changed: number; failed: { jobId: string; message: string }[] }> {
  await requirePulse(ctx, 'job:manage');
  let changed = 0;
  const failed: { jobId: string; message: string }[] = [];
  for (const jobId of [...new Set(jobIds)].slice(0, 500)) {
    try {
      if (patch.status) await setJobStatus(ctx, jobId, patch.status);
      if (patch.ownerId !== undefined) await updateJob(ctx, jobId, { ownerId: patch.ownerId });
      if (patch.archived !== undefined) await archiveJob(ctx, jobId, patch.archived);
      changed += 1;
    } catch (error) {
      failed.push({ jobId, message: error instanceof Error ? error.message : 'This job could not be changed.' });
    }
  }
  return { changed, failed };
}

/** "Copy this job": same setup, new number, planned, no entries. Plans come along unless `withPlans` is false. */
export async function duplicateJob(ctx: DomainContext, jobId: string, options: { name?: string | null; withPlans?: boolean; startDate?: string | null; dueDate?: string | null } = {}): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const source = await getJobRow(ctx, jobId, tx, true);
    const copy = await insertJob(tx, ctx, {
      name: cleanText(options.name) ?? `${source.name} (copy)`,
      clientId: source.clientId,
      jobTypeId: source.jobTypeId,
      siteId: source.siteId,
      kind: source.kind as JobKindValue,
      status: 'planned',
      pricingModel: source.pricingModel as PricingModelValue,
      unitLabel: source.unitLabel,
      plannedUnits: source.plannedUnits,
      unitPrice: source.unitPrice,
      fixedPriceCents: source.fixedPriceCents === null ? null : Number(source.fixedPriceCents),
      billRateCents: source.billRateCents,
      materialMethod: source.materialMethod as MaterialMethodValue,
      materialCostPerUnit: source.materialCostPerUnit,
      partsOwner: source.partsOwner as PartsOwnerValue | null,
      defaultLaborClassId: source.defaultLaborClassId,
      usualCrew: source.usualCrew,
      standardUph: source.standardUph,
      targetMarginBp: source.targetMarginBp,
      startDate: options.startDate ?? null,
      dueDate: options.dueDate ?? null,
      ownerId: source.ownerId,
      description: source.description,
      kitSku: source.kitSku,
      kitName: source.kitName,
    });
    if (options.withPlans !== false) {
      const plans = await tx.select().from(jobPlans).where(and(eq(jobPlans.orgId, ctx.orgId), eq(jobPlans.jobId, source.id)));
      for (const plan of plans.sort((a) => (a.plan === 'quote' ? -1 : 1))) {
        const lines = await tx.select().from(jobPlanLines).where(eq(jobPlanLines.planId, plan.id)).orderBy(asc(jobPlanLines.position));
        await upsertPlan(tx, ctx, copy.id, plan.plan as 'quote' | 'budget', {
          units: plan.units,
          revenueCents: Number(plan.revenueCents),
          laborHours: plan.laborHours,
          laborCents: Number(plan.laborCents),
          setupHours: plan.setupHours,
          setupCents: Number(plan.setupCents),
          materialCents: Number(plan.materialCents),
          otherCents: Number(plan.otherCents),
          sharedCents: plan.sharedAuto ? null : Number(plan.sharedCents),
          lines:
            lines.length > 0
              ? lines.map((line) => ({ category: line.category as 'revenue', description: line.description, quantity: line.quantity, unit: line.unit as 'unit' | null, unitAmount: line.unitAmount, amountCents: Number(line.amountCents), flex: line.flex, laborClassId: line.laborClassId, vasServiceId: line.vasServiceId, itemId: line.itemId }))
              : undefined,
          origin: plan.origin as 'typed',
          originRef: plan.originRef,
          note: plan.note,
        });
      }
    }
    await logActivity(tx, ctx, { verb: 'job.duplicated', entityType: 'job', entityId: copy.id, jobId: copy.id, clientId: copy.clientId, meta: { fromJobId: source.id, fromNumber: source.number } });
    await recomputeJobs(tx, ctx, [copy.id]);
    return detail(ctx, copy.id, access, tx);
  });
}

export async function archiveJob(ctx: DomainContext, jobId: string, archived = true): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const before = await getJobRow(ctx, jobId, tx);
    if (archived && before.status === 'active') throw conflict('Finish, hold or cancel the job before you archive it.');
    if (Boolean(before.archivedAt) !== archived) {
      await tx.update(jobs).set({ archivedAt: archived ? new Date() : null, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(jobs.id, before.id));
      await logActivity(tx, ctx, { verb: archived ? 'job.archived' : 'job.unarchived', entityType: 'job', entityId: before.id, jobId: before.id, clientId: before.clientId });
    }
    return detail(ctx, before.id, access, tx);
  });
}

/** Soft delete: the job and its numbers leave every screen and rollup. `restoreJob` undoes it. */
export async function deleteJob(ctx: DomainContext, jobId: string): Promise<void> {
  await requirePulse(ctx, 'job:manage');
  await inTx(async (tx) => {
    const before = await getJobRow(ctx, jobId, tx);
    const closed = await closedMonths(tx, ctx.orgId);
    if (closed.size > 0) {
      const [hit] = await rows<{ m: string }>(
        tx,
        sql`SELECT to_char(min(date_trunc('month', d)), 'YYYY-MM-DD') AS m FROM (
              SELECT work_date AS d FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND job_id = ${before.id} AND deleted_at IS NULL
              UNION ALL SELECT usage_date FROM pulse.material_usage WHERE org_id = ${ctx.orgId} AND job_id = ${before.id} AND deleted_at IS NULL
              UNION ALL SELECT cost_date FROM pulse.cost_entries WHERE org_id = ${ctx.orgId} AND job_id = ${before.id} AND deleted_at IS NULL
              UNION ALL SELECT revenue_date FROM pulse.revenue_entries WHERE org_id = ${ctx.orgId} AND job_id = ${before.id} AND deleted_at IS NULL
              UNION ALL SELECT work_date FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND job_id = ${before.id} AND deleted_at IS NULL
            ) u WHERE date_trunc('month', d)::date = ANY(${sql`ARRAY[${sql.join([...closed].map((month) => sql`${month}`), sql`, `)}]::date[]`})`,
      );
      if (hit?.m) throw conflict(`This job has rows in ${monthName(hit.m)}, which is closed. Ask the owner to reopen it, or archive the job instead.`);
    }
    await softDeleteRow(tx, ctx.orgId, 'jobs', before.id, 'That job');
    await logActivity(tx, ctx, { verb: 'job.deleted', entityType: 'job', entityId: before.id, jobId: before.id, clientId: before.clientId, before: { number: before.number, name: before.name } });
    await touchWholeJob(tx, ctx, before.id);
  });
}

export async function restoreJob(ctx: DomainContext, jobId: string): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const before = await getJobRow(ctx, jobId, tx, true);
    if (!before.deletedAt) return detail(ctx, before.id, access, tx);
    const taken = await rows(tx, sql`SELECT 1 FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND lower(number) = ${before.number.toLowerCase()} AND deleted_at IS NULL`);
    if (taken.length > 0) throw conflict(`Another job now uses the number ${before.number}. Change that number first.`);
    await restoreRow(tx, ctx.orgId, 'jobs', before.id, 'That job');
    await logActivity(tx, ctx, { verb: 'job.restored', entityType: 'job', entityId: before.id, jobId: before.id, clientId: before.clientId });
    await restampProduction(tx, ctx.orgId, sql`src.job_id = ${before.id}`);
    await restampFixedJob(tx, ctx, before.id);
    await touchWholeJob(tx, ctx, before.id);
    return detail(ctx, before.id, access, tx);
  });
}

/* ---------------------------------------------------------------- dated prices */

export async function listJobPrices(ctx: DomainContext, jobId: string): Promise<JobPriceDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJobRow(ctx, jobId, db, true);
  const found = await db.select().from(jobPrices).where(and(eq(jobPrices.orgId, ctx.orgId), eq(jobPrices.jobId, job.id))).orderBy(desc(jobPrices.effectiveFrom));
  return found.map((row) => toPriceDTO(row, access));
}

export interface JobPriceInput {
  /** "From which day?" Left out means today at the job's site. Moved up to the first open day when it falls in a closed month. */
  effectiveFrom?: string | null;
  unitPrice?: string | null;
  billRateCents?: number | null;
  materialCostPerUnit?: string;
  note?: string | null;
}

/** First day on or after `date` that is not in a closed month. */
function firstOpenDay(date: string, closed: Set<string>): string {
  let current = date;
  for (let guard = 0; guard < 1200 && closed.has(`${current.slice(0, 7)}-01`); guard += 1) {
    const year = Number(current.slice(0, 4));
    const month = Number(current.slice(5, 7));
    current = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  }
  return current;
}

/**
 * Adds or edits a dated price row of a job (unit price, bill rate, material cost per unit) and
 * restamps the job's open production entries dated on or after it. Fields left out keep the
 * value of the row in force on that day. Returns the day the price really starts.
 */
export async function setJobPrice(ctx: DomainContext, jobId: string, input: JobPriceInput): Promise<{ effectiveFrom: string; moved: boolean; job: JobDetailDTO }> {
  const access = await requirePulse(ctx, 'revenue:manage');
  return inTx(async (tx) => {
    const job = await getJobRow(ctx, jobId, tx);
    const site = await resolveSite(ctx, job.siteId, tx);
    const wanted = input.effectiveFrom ?? todayInZone(site.timezone);
    const closed = await closedMonths(tx, ctx.orgId);
    const effectiveFrom = wanted === '0001-01-01' ? wanted : firstOpenDay(wanted, closed);
    const [inForce] = await tx.select().from(jobPrices).where(and(eq(jobPrices.jobId, job.id), sql`${jobPrices.effectiveFrom} <= ${effectiveFrom}::date`)).orderBy(desc(jobPrices.effectiveFrom)).limit(1);
    const values = {
      unitPrice: input.unitPrice === undefined ? (inForce?.unitPrice ?? null) : input.unitPrice,
      billRateCents: input.billRateCents === undefined ? (inForce?.billRateCents ?? null) : input.billRateCents,
      materialCostPerUnit: input.materialCostPerUnit ?? inForce?.materialCostPerUnit ?? '0',
      note: cleanText(input.note),
    };
    const [existing] = await tx.select().from(jobPrices).where(and(eq(jobPrices.jobId, job.id), eq(jobPrices.effectiveFrom, effectiveFrom)));
    if (existing) await tx.update(jobPrices).set({ ...values, updatedAt: new Date() }).where(eq(jobPrices.id, existing.id));
    else await tx.insert(jobPrices).values({ orgId: ctx.orgId, jobId: job.id, effectiveFrom, ...values, createdBy: ctx.userId });
    // The job row mirrors its newest price row.
    const [newest] = await tx.select().from(jobPrices).where(eq(jobPrices.jobId, job.id)).orderBy(desc(jobPrices.effectiveFrom)).limit(1);
    await tx.update(jobs).set({ unitPrice: newest!.unitPrice, billRateCents: newest!.billRateCents, materialCostPerUnit: newest!.materialCostPerUnit, version: sql`version + 1`, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    await logActivity(tx, ctx, {
      verb: 'price.changed',
      entityType: 'job',
      entityId: job.id,
      jobId: job.id,
      clientId: job.clientId,
      before: inForce ? { unitPrice: inForce.unitPrice, billRateCents: inForce.billRateCents, materialCostPerUnit: inForce.materialCostPerUnit } : null,
      after: { unitPrice: values.unitPrice, billRateCents: values.billRateCents, materialCostPerUnit: values.materialCostPerUnit },
      meta: { effectiveFrom, askedFor: wanted },
    });
    await restampProduction(tx, ctx.orgId, sql`src.job_id = ${job.id} AND src.work_date >= ${effectiveFrom}::date`);
    await restampFixedJob(tx, ctx, job.id);
    const touched = newTouched();
    touched.jobIds.add(job.id);
    await finishWrite(tx, ctx, touched);
    return { effectiveFrom, moved: effectiveFrom !== wanted, job: await detail(ctx, job.id, access, tx) };
  });
}

/** Removes a dated price row (never the first one) and restamps from that day. */
export async function deleteJobPrice(ctx: DomainContext, priceId: string): Promise<JobDetailDTO> {
  const access = await requirePulse(ctx, 'revenue:manage');
  return inTx(async (tx) => {
    const [price] = isUuid(priceId) ? await tx.select().from(jobPrices).where(and(eq(jobPrices.orgId, ctx.orgId), eq(jobPrices.id, priceId))) : [];
    if (!price) throw notFound('That price');
    if (price.effectiveFrom === '0001-01-01') throw conflict('The first price of a job cannot be deleted. Edit it instead.');
    await assertOpen(tx, ctx.orgId, [price.effectiveFrom]);
    await tx.delete(jobPrices).where(eq(jobPrices.id, price.id));
    const [newest] = await tx.select().from(jobPrices).where(eq(jobPrices.jobId, price.jobId)).orderBy(desc(jobPrices.effectiveFrom)).limit(1);
    if (newest) await tx.update(jobs).set({ unitPrice: newest.unitPrice, billRateCents: newest.billRateCents, materialCostPerUnit: newest.materialCostPerUnit, version: sql`version + 1`, updatedAt: new Date() }).where(eq(jobs.id, price.jobId));
    await logActivity(tx, ctx, { verb: 'price.changed', entityType: 'job', entityId: price.jobId, jobId: price.jobId, before: { unitPrice: price.unitPrice, billRateCents: price.billRateCents, materialCostPerUnit: price.materialCostPerUnit }, meta: { effectiveFrom: price.effectiveFrom, deleted: true } });
    await restampProduction(tx, ctx.orgId, sql`src.job_id = ${price.jobId} AND src.work_date >= ${price.effectiveFrom}::date`);
    await restampFixedJob(tx, ctx, price.jobId);
    const touched = newTouched();
    touched.jobIds.add(price.jobId);
    await finishWrite(tx, ctx, touched);
    return detail(ctx, price.jobId, access, tx);
  });
}

/* ---------------------------------------------------------------- links to sibling records */

export async function addJobLink(ctx: DomainContext, jobId: string, link: JobLinkInput): Promise<JobLinkDTO[]> {
  await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const job = await getJobRow(ctx, jobId, tx);
    await insertLinks(tx, ctx, job.id, [link]);
    const found = await tx.select().from(jobLinks).where(and(eq(jobLinks.orgId, ctx.orgId), eq(jobLinks.jobId, job.id))).orderBy(asc(jobLinks.createdAt));
    return found.map(toLinkDTO);
  });
}

export async function removeJobLink(ctx: DomainContext, linkId: string): Promise<void> {
  await requirePulse(ctx, 'job:manage');
  await inTx(async (tx) => {
    const [row] = isUuid(linkId) ? await tx.delete(jobLinks).where(and(eq(jobLinks.orgId, ctx.orgId), eq(jobLinks.id, linkId))).returning() : [];
    if (!row) throw notFound('That link');
    await logActivity(tx, ctx, { verb: 'link.removed', entityType: 'link', entityId: row.id, jobId: row.jobId, before: { targetType: row.targetType, targetId: row.targetId } });
  });
}

/**
 * Jobs linked to a sibling record (`/jobs/by-link`, the bridge). `core_customer` and `crm_account`
 * also match through the job's client. Newest first.
 */
export async function findJobsByLink(ctx: DomainContext, type: LinkTargetType | 'core_customer', targetId: string): Promise<JobListItemDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const id = targetId.trim();
  if (!id) return [];
  const viaLink = type === 'core_customer' ? [] : await db.select({ jobId: jobLinks.jobId }).from(jobLinks).where(and(eq(jobLinks.orgId, ctx.orgId), eq(jobLinks.targetType, type), eq(jobLinks.targetId, id)));
  const ids = new Set(viaLink.map((row) => row.jobId));
  if ((type === 'core_customer' || type === 'crm_account' || type === 'wms_client') && isUuid(id)) {
    const column = type === 'crm_account' ? clients.crmAccountItemId : clients.coreCustomerId;
    const viaClient = await db.select({ id: jobs.id }).from(jobs).innerJoin(clients, eq(clients.id, jobs.clientId)).where(and(eq(jobs.orgId, ctx.orgId), eq(column, id), isNull(jobs.deletedAt)));
    for (const row of viaClient) ids.add(row.id);
  }
  if (ids.size === 0) return [];
  const found = await joined(db).where(and(eq(jobs.orgId, ctx.orgId), inArray(jobs.id, [...ids]), isNull(jobs.deletedAt))).orderBy(desc(jobs.createdAt));
  const hours = await planHours(db, ctx.orgId, found.map((row) => row.job.id));
  return found.map((row) => ({ ...toJobDTO(row, access), stats: toJobStatsDTO(row.stats, access, row.job.unitLabel), planLaborHours: hours.get(row.job.id) ?? null }));
}

/** Deleted jobs, newest first, for the "Recently deleted" list. */
export async function listDeletedJobs(ctx: DomainContext): Promise<JobListItemDTO[]> {
  const access = await requirePulse(ctx, 'job:manage');
  const found = await joined(db).where(and(eq(jobs.orgId, ctx.orgId), isNotNull(jobs.deletedAt))).orderBy(desc(jobs.deletedAt)).limit(200);
  return found.map((row) => ({ ...toJobDTO(row, access), stats: toJobStatsDTO(row.stats, access, row.job.unitLabel), planLaborHours: null }));
}
