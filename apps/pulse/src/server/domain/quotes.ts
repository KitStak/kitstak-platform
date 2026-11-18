/**
 * Quote calculator and what if scenarios (SPEC section 6, `/calculator`; table `pulse.quote_scenarios`).
 *
 * A scenario stores what a person typed (`inputs`) and the answer the pure calculator gave
 * (`result`). The answer is always worked out again on the server from the inputs with
 * `runCalc`, so a stored result can never disagree with the math, and a job made from a scenario
 * carries exactly the plan the calculator showed.
 *
 * Everything here needs money rights: a quote is all money.
 */
import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { quoteScenarios } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { ratioBp } from '@/lib/money';
import { EMPTY_CALC, bpToPercent, reviveInputs, runCalc, trimDecimal, type CalcInputs, type CalcSummary } from '@/features/calculator/calc-model';
import { canPulse } from '@/lib/permissions';
import { centsToDecimal } from '@/lib/money';
import { cleanText, inTx, isUuid, isoRequired, jsonSafe, rows, type DomainContext } from './_shared';
import { requireMoney, requirePulse } from './access';
import { logActivity } from './activity';
import { createJob, getJob } from './jobs';
import { loadSettings } from './settings';

type ScenarioRow = typeof quoteScenarios.$inferSelect;

export const QUOTE_STATUSES = ['draft', 'sent', 'won', 'lost'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export interface QuoteScenarioDTO {
  readonly id: string;
  readonly name: string;
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly jobTypeId: string | null;
  readonly jobTypeName: string | null;
  /** The job this scenario was made from, or the job that was made from it. */
  readonly jobId: string | null;
  readonly jobNumber: string | null;
  readonly inputs: CalcInputs;
  readonly result: CalcSummary | null;
  readonly status: QuoteStatus;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Names {
  client_name: string | null;
  job_type_name: string | null;
  job_number: string | null;
}

function toDTO(row: ScenarioRow, names: Partial<Names> = {}): QuoteScenarioDTO {
  const result = row.result && typeof row.result === 'object' && 'costCents' in row.result ? (row.result as unknown as CalcSummary) : null;
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    clientName: names.client_name ?? null,
    jobTypeId: row.jobTypeId,
    jobTypeName: names.job_type_name ?? null,
    jobId: row.jobId,
    jobNumber: names.job_number ?? null,
    inputs: reviveInputs(row.inputs),
    result,
    status: (QUOTE_STATUSES as readonly string[]).includes(row.status) ? (row.status as QuoteStatus) : 'draft',
    createdBy: row.createdBy,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

async function namesFor(ctx: DomainContext, found: readonly ScenarioRow[]): Promise<Map<string, Names>> {
  if (found.length === 0) return new Map();
  const named = await rows<Names & { id: string }>(
    db,
    sql`SELECT q.id, c.name AS client_name, t.name AS job_type_name, j.number AS job_number
          FROM pulse.quote_scenarios q
          LEFT JOIN pulse.clients c ON c.id = q.client_id AND c.org_id = q.org_id
          LEFT JOIN pulse.job_types t ON t.id = q.job_type_id AND t.org_id = q.org_id
          LEFT JOIN pulse.jobs j ON j.id = q.job_id AND j.org_id = q.org_id AND j.deleted_at IS NULL
         WHERE q.org_id = ${ctx.orgId} AND q.deleted_at IS NULL`,
  );
  return new Map(named.map((row) => [row.id, row]));
}

/** Saved scenarios, newest first. `jobId` narrows to the what ifs of one job. */
export async function listQuoteScenarios(ctx: DomainContext, filters: { jobId?: string | null } = {}): Promise<QuoteScenarioDTO[]> {
  await requireMoney(ctx);
  const found = await db
    .select()
    .from(quoteScenarios)
    .where(and(eq(quoteScenarios.orgId, ctx.orgId), isNull(quoteScenarios.deletedAt), filters.jobId && isUuid(filters.jobId) ? eq(quoteScenarios.jobId, filters.jobId) : undefined))
    .orderBy(desc(quoteScenarios.updatedAt))
    .limit(200);
  const names = await namesFor(ctx, found);
  return found.map((row) => toDTO(row, names.get(row.id)));
}

async function scenarioRow(ctx: DomainContext, id: string, includeDeleted = false): Promise<ScenarioRow> {
  const [row] = isUuid(id) ? await db.select().from(quoteScenarios).where(and(eq(quoteScenarios.orgId, ctx.orgId), eq(quoteScenarios.id, id), includeDeleted ? undefined : isNull(quoteScenarios.deletedAt))) : [];
  if (!row) throw notFound('That scenario');
  return row;
}

export async function getQuoteScenario(ctx: DomainContext, id: string): Promise<QuoteScenarioDTO> {
  await requireMoney(ctx);
  const row = await scenarioRow(ctx, id);
  return toDTO(row, (await namesFor(ctx, [row])).get(row.id));
}

export interface QuoteScenarioInput {
  id?: string | null;
  name: string;
  inputs: unknown;
  status?: QuoteStatus;
}

/** Saves a scenario (new, or over an existing one). The answer is worked out here, never taken from the browser. */
export async function saveQuoteScenario(ctx: DomainContext, input: QuoteScenarioInput): Promise<QuoteScenarioDTO> {
  await requireMoney(ctx);
  await requirePulse(ctx, 'plan:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the scenario a name.', { name: 'Give the scenario a name, like "Holiday kit at 40 an hour".' });
  if (name.length > 120) throw invalid('Keep the name to 120 characters or fewer.', { name: 'Keep the name to 120 characters or fewer.' });
  const inputs = reviveInputs(input.inputs);
  const settings = await loadSettings(ctx.orgId);
  const run = runCalc(inputs, { workingDays: settings.workingDays });
  if (!run.summary) throw invalid('Fill in the units, the pace, the crew and the target margin first.', run.errors as Record<string, string>);
  const values = {
    name,
    clientId: inputs.clientId && isUuid(inputs.clientId) ? inputs.clientId : null,
    jobTypeId: inputs.jobTypeId && isUuid(inputs.jobTypeId) ? inputs.jobTypeId : null,
    jobId: inputs.jobId && isUuid(inputs.jobId) ? inputs.jobId : null,
    inputs: jsonSafe(inputs) as Record<string, unknown>,
    result: jsonSafe(run.summary) as Record<string, unknown>,
    status: input.status ?? undefined,
    updatedAt: new Date(),
  };
  const saved = await inTx(async (tx) => {
    if (input.id) {
      const [before] = isUuid(input.id) ? await tx.select().from(quoteScenarios).where(and(eq(quoteScenarios.orgId, ctx.orgId), eq(quoteScenarios.id, input.id), isNull(quoteScenarios.deletedAt))) : [];
      if (!before) throw notFound('That scenario');
      const [row] = await tx.update(quoteScenarios).set({ ...values, status: values.status ?? before.status }).where(eq(quoteScenarios.id, before.id)).returning();
      await logActivity(tx, ctx, { verb: 'scenario.updated', entityType: 'quote_scenario', entityId: before.id, jobId: values.jobId, clientId: values.clientId, before: { name: before.name, status: before.status }, after: { name, status: row!.status } });
      return row!;
    }
    const [row] = await tx.insert(quoteScenarios).values({ orgId: ctx.orgId, ...values, status: values.status ?? 'draft', createdBy: ctx.userId }).returning();
    await logActivity(tx, ctx, { verb: 'scenario.created', entityType: 'quote_scenario', entityId: row!.id, jobId: values.jobId, clientId: values.clientId, after: { name } });
    return row!;
  });
  return toDTO(saved, (await namesFor(ctx, [saved])).get(saved.id));
}

export async function setQuoteScenarioStatus(ctx: DomainContext, id: string, status: QuoteStatus): Promise<QuoteScenarioDTO> {
  await requireMoney(ctx);
  await requirePulse(ctx, 'plan:manage');
  if (!(QUOTE_STATUSES as readonly string[]).includes(status)) throw invalid('Pick draft, sent, won or lost.');
  const before = await scenarioRow(ctx, id);
  const saved = await inTx(async (tx) => {
    const [row] = await tx.update(quoteScenarios).set({ status, updatedAt: new Date() }).where(eq(quoteScenarios.id, before.id)).returning();
    if (before.status !== status) await logActivity(tx, ctx, { verb: 'scenario.updated', entityType: 'quote_scenario', entityId: before.id, field: 'status', before: { status: before.status }, after: { status } });
    return row!;
  });
  return toDTO(saved, (await namesFor(ctx, [saved])).get(saved.id));
}

async function toggleScenario(ctx: DomainContext, id: string, restore: boolean): Promise<QuoteScenarioDTO> {
  await requireMoney(ctx);
  await requirePulse(ctx, 'plan:manage');
  const before = await scenarioRow(ctx, id, true);
  if (restore ? !before.deletedAt : Boolean(before.deletedAt)) throw notFound('That scenario');
  const saved = await inTx(async (tx) => {
    const [row] = await tx.update(quoteScenarios).set({ deletedAt: restore ? null : new Date(), updatedAt: new Date() }).where(eq(quoteScenarios.id, before.id)).returning();
    await logActivity(tx, ctx, { verb: restore ? 'scenario.restored' : 'scenario.deleted', entityType: 'quote_scenario', entityId: before.id, before: { name: before.name } });
    return row!;
  });
  return toDTO(saved, (await namesFor(ctx, [saved])).get(saved.id));
}

export const deleteQuoteScenario = (ctx: DomainContext, id: string): Promise<QuoteScenarioDTO> => toggleScenario(ctx, id, false);
export const restoreQuoteScenario = (ctx: DomainContext, id: string): Promise<QuoteScenarioDTO> => toggleScenario(ctx, id, true);

/* ---------------------------------------------------------------- what the form needs */

export interface CalculatorSetupDTO {
  readonly clients: readonly { readonly id: string; readonly name: string; readonly targetMarginBp: number | null; readonly partsOwner: 'us' | 'client' | null }[];
  readonly jobTypes: readonly { readonly id: string; readonly name: string; readonly unitLabel: string; readonly targetMarginBp: number | null; readonly defaultLaborClassId: string | null; readonly targetPace: string | null }[];
  readonly laborClasses: readonly { readonly id: string; readonly name: string; readonly isDefault: boolean; readonly rateCents: number | null }[];
  readonly services: readonly { readonly id: string; readonly name: string; readonly unitLabel: string; readonly defaultPrice: string | null; readonly defaultCostPerUnit: string | null }[];
  /** Target pace rows for one job type and one client, newest first. */
  readonly clientPaces: readonly { readonly jobTypeId: string; readonly clientId: string; readonly pace: string }[];
  readonly defaults: {
    readonly targetMarginBp: number;
    /** Time not on a job as a share of labor cost, the way your plans fill it in. */
    readonly sharedPctBp: number;
    readonly sharedRule: string;
    readonly shiftHours: string;
    readonly partsOwner: 'us' | 'client';
    readonly defaultRateCents: number | null;
    readonly workingDays: readonly number[];
    readonly today: string;
  };
  readonly hasRate: boolean;
  readonly canSave: boolean;
  readonly canCreateJob: boolean;
  readonly canManageRates: boolean;
}

/** Lists, rates and defaults the calculator form starts from. */
export async function getCalculatorSetup(ctx: DomainContext): Promise<CalculatorSetupDTO> {
  const access = await requireMoney(ctx);
  const settings = await loadSettings(ctx.orgId);
  const [clients, jobTypes, classes, services, paces, recent, today] = await Promise.all([
    rows<{ id: string; name: string; target_margin_bp: number | null; parts_owner: 'us' | 'client' | null }>(db, sql`SELECT id, name, target_margin_bp, parts_owner FROM pulse.clients WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND status = 'active' ORDER BY lower(name)`),
    rows<{ id: string; name: string; unit_label: string; target_margin_bp: number | null; default_labor_class_id: string | null; default_standard_uph: string | null; pace: string | null }>(
      db,
      sql`SELECT t.id, t.name, t.unit_label, t.target_margin_bp, t.default_labor_class_id, t.default_standard_uph::text,
                 (SELECT s.units_per_labor_hour::text FROM pulse.standards s
                   WHERE s.org_id = t.org_id AND s.job_type_id = t.id AND s.client_id IS NULL AND s.labor_class_id IS NULL AND s.deleted_at IS NULL AND s.effective_from <= CURRENT_DATE
                   ORDER BY s.effective_from DESC LIMIT 1) AS pace
            FROM pulse.job_types t WHERE t.org_id = ${ctx.orgId} AND t.deleted_at IS NULL AND t.archived_at IS NULL ORDER BY t.position, lower(t.name)`,
    ),
    rows<{ id: string; name: string; is_default: boolean; rate: number | null }>(
      db,
      sql`SELECT lc.id, lc.name, lc.is_default,
                 (SELECT lr.loaded_rate_cents FROM pulse.labor_rates lr WHERE lr.labor_class_id = lc.id AND lr.deleted_at IS NULL AND lr.effective_from <= CURRENT_DATE
                   ORDER BY (lr.site_id IS NULL) DESC, lr.effective_from DESC LIMIT 1) AS rate
            FROM pulse.labor_classes lc WHERE lc.org_id = ${ctx.orgId} AND lc.deleted_at IS NULL AND lc.archived_at IS NULL ORDER BY lc.is_default DESC, lower(lc.name)`,
    ),
    rows<{ id: string; name: string; unit_label: string; default_price: string | null; default_cost_per_unit: string | null }>(db, sql`SELECT id, name, unit_label, default_price::text, default_cost_per_unit::text FROM pulse.vas_services WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND active ORDER BY lower(name)`),
    rows<{ job_type_id: string; client_id: string; pace: string }>(
      db,
      sql`SELECT DISTINCT ON (job_type_id, client_id) job_type_id, client_id, units_per_labor_hour::text AS pace FROM pulse.standards
           WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND job_type_id IS NOT NULL AND client_id IS NOT NULL AND labor_class_id IS NULL AND effective_from <= CURRENT_DATE
           ORDER BY job_type_id, client_id, effective_from DESC`,
    ),
    rows<{ shared: string; labor: string }>(db, sql`SELECT COALESCE(sum(amount_cents) FILTER (WHERE kind = 'shared'), 0)::text AS shared, COALESCE(sum(amount_cents) FILTER (WHERE kind = 'labor'), 0)::text AS labor FROM pulse.fact_days WHERE org_id = ${ctx.orgId} AND work_date > CURRENT_DATE - 90`),
    rows<{ today: string }>(db, sql`SELECT to_char((now() AT TIME ZONE ${settings.timezone})::date, 'YYYY-MM-DD') AS today`),
  ]);
  const rule = settings.sharedCostRule;
  const sharedPctBp = rule === 'none' ? 0 : rule === 'percent_of_labor' ? settings.sharedPctBp : (ratioBp(BigInt(recent[0]?.shared ?? 0), BigInt(recent[0]?.labor ?? 0)) ?? 0);
  const defaultRate = settings.defaultLoadedRateCents === null || settings.defaultLoadedRateCents === undefined ? null : Number(settings.defaultLoadedRateCents);
  return {
    clients: clients.map((row) => ({ id: row.id, name: row.name, targetMarginBp: row.target_margin_bp, partsOwner: row.parts_owner })),
    jobTypes: jobTypes.map((row) => ({ id: row.id, name: row.name, unitLabel: row.unit_label, targetMarginBp: row.target_margin_bp, defaultLaborClassId: row.default_labor_class_id, targetPace: row.pace ?? row.default_standard_uph })),
    laborClasses: classes.map((row) => ({ id: row.id, name: row.name, isDefault: row.is_default, rateCents: row.rate === null ? defaultRate : Number(row.rate) })),
    services: services.map((row) => ({ id: row.id, name: row.name, unitLabel: row.unit_label, defaultPrice: row.default_price, defaultCostPerUnit: row.default_cost_per_unit })),
    clientPaces: paces.map((row) => ({ jobTypeId: row.job_type_id, clientId: row.client_id, pace: row.pace })),
    defaults: {
      targetMarginBp: settings.defaultTargetMarginBp,
      sharedPctBp: Math.max(0, Math.min(sharedPctBp, 100_000)),
      sharedRule: rule,
      shiftHours: trimDecimal(String(settings.defaultShiftHours)) || '8',
      partsOwner: settings.defaultPartsOwner === 'client' ? 'client' : 'us',
      defaultRateCents: defaultRate,
      workingDays: settings.workingDays,
      today: today[0]?.today ?? new Date().toISOString().slice(0, 10),
    },
    hasRate: defaultRate !== null || classes.some((row) => row.rate !== null),
    canSave: canPulse(access.role, 'plan:manage'),
    canCreateJob: canPulse(access.role, 'job:manage') && canPulse(access.role, 'plan:manage'),
    canManageRates: canPulse(access.role, 'rate:manage'),
  };
}

/* ---------------------------------------------------------------- what happened last time */

export interface SimilarJobDTO {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly clientName: string;
  readonly status: string;
  readonly sameClient: boolean;
  readonly unitsGood: string;
  readonly unitLabel: string;
  /** Units per person per hour over the counted days. */
  readonly uph: string | null;
  readonly targetUph: string | null;
  readonly marginBp: number | null;
  readonly revenueCents: number;
  readonly costCents: number;
  /** Revenue and cost for one good unit, in cents. */
  readonly revenuePerUnitCents: number | null;
  readonly costPerUnitCents: number | null;
  readonly lastEntryDate: string | null;
  readonly laborMissing: boolean;
}

/** Jobs like this one that already ran: same job type, the same client first. Jobs with missing labor are marked. */
export async function listSimilarJobs(ctx: DomainContext, filters: { jobTypeId?: string | null; clientId?: string | null; excludeJobId?: string | null; limit?: number }): Promise<SimilarJobDTO[]> {
  await requireMoney(ctx);
  if (!filters.jobTypeId || !isUuid(filters.jobTypeId)) return [];
  const clientId = filters.clientId && isUuid(filters.clientId) ? filters.clientId : null;
  const found = await rows<{
    id: string;
    number: string;
    name: string;
    client_name: string;
    client_id: string;
    status: string;
    unit_label: string;
    units_good: string;
    uph: string | null;
    standard_uph: string | null;
    margin_bp: number | null;
    revenue_cents: string;
    cost_cents: string;
    per_unit_revenue: string | null;
    per_unit_cost: string | null;
    last_entry_date: string | null;
    labor_missing: boolean;
  }>(
    db,
    sql`SELECT j.id, j.number, j.name, c.name AS client_name, j.client_id, j.status, j.unit_label, st.units_good::text, st.uph::text, st.standard_uph::text, st.margin_bp,
               st.revenue_cents::text, st.cost_cents::text,
               CASE WHEN st.units_good > 0 THEN round(st.revenue_cents / st.units_good)::text END AS per_unit_revenue,
               CASE WHEN st.units_good > 0 THEN round(st.cost_cents / st.units_good)::text END AS per_unit_cost,
               to_char(st.last_entry_date, 'YYYY-MM-DD') AS last_entry_date,
               COALESCE((st.needs ->> 'laborMissing')::boolean, false) AS labor_missing
          FROM pulse.jobs j JOIN pulse.job_stats st ON st.job_id = j.id JOIN pulse.clients c ON c.id = j.client_id
         WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.job_type_id = ${filters.jobTypeId} AND st.units_good > 0 AND st.hours > 0
           ${filters.excludeJobId && isUuid(filters.excludeJobId) ? sql`AND j.id <> ${filters.excludeJobId}` : sql``}
         ORDER BY ${clientId ? sql`(j.client_id = ${clientId}) DESC,` : sql``} (j.status = 'completed') DESC, st.last_entry_date DESC NULLS LAST
         LIMIT ${Math.min(Math.max(filters.limit ?? 5, 1), 20)}`,
  );
  return found.map((row) => ({
    id: row.id,
    number: row.number,
    name: row.name,
    clientName: row.client_name,
    status: row.status,
    sameClient: clientId !== null && row.client_id === clientId,
    unitsGood: row.units_good,
    unitLabel: row.unit_label,
    uph: row.uph,
    targetUph: row.standard_uph,
    marginBp: row.margin_bp,
    revenueCents: Number(row.revenue_cents),
    costCents: Number(row.cost_cents),
    revenuePerUnitCents: row.per_unit_revenue === null ? null : Number(row.per_unit_revenue),
    costPerUnitCents: row.per_unit_cost === null ? null : Number(row.per_unit_cost),
    lastEntryDate: row.last_entry_date,
    laborMissing: row.labor_missing,
  }));
}

/* ---------------------------------------------------------------- start from a real job */

export interface QuoteFromJobDTO {
  readonly jobId: string;
  readonly jobNumber: string;
  readonly jobName: string;
  readonly inputs: CalcInputs;
  /** Where each prefilled number came from, in plain words, shown under the form. */
  readonly notes: readonly string[];
  readonly actual: { readonly unitsGood: string; readonly hours: string; readonly uph: string | null; readonly marginBp: number | null; readonly revenueCents: number | null; readonly costCents: number | null; readonly status: string };
}

const per = (cents: number | null, units: number): string => (cents === null || !(units > 0) ? '' : trimDecimal((cents / 100 / units).toFixed(4)));

/**
 * Fills the calculator from a job's real numbers, to quote the next one like it or to test a
 * new price, pace or crew against it. Actual pace, actual labor cost of an hour, actual
 * material per unit and actual other costs are used where the job has them; the job's own
 * settings fill the rest.
 */
export async function quoteFromJob(ctx: DomainContext, ref: string): Promise<QuoteFromJobDTO> {
  await requireMoney(ctx);
  const job = await getJob(ctx, ref);
  const setup = await getCalculatorSetup(ctx);
  const stats = job.stats;
  const notes: string[] = [];
  const unitsGood = Number(stats.unitsGood);
  const hours = Number(stats.hours);
  const planned = Number(job.plannedUnits);
  const units = planned > 0 ? job.plannedUnits : stats.unitsGood;
  notes.push(planned > 0 ? `Units are the ${job.unitLabel} planned for ${job.number}.` : `Units are the ${job.unitLabel} finished on ${job.number}.`);

  let pace = '';
  if (stats.uph && Number(stats.uph) > 0) {
    pace = trimDecimal(Number(stats.uph).toFixed(1));
    notes.push(`The pace is what the crew really did: ${pace} units per person per hour${stats.standardUph ? `, against a target pace of ${trimDecimal(Number(stats.standardUph).toFixed(1))}` : ''}.`);
  } else if (stats.standardUph || job.standardUph) {
    pace = trimDecimal(String(stats.standardUph ?? job.standardUph));
    notes.push('No hours are logged yet, so the pace is the target pace.');
  }

  const actualRate = stats.laborCents !== null && hours > 0 ? Math.round(stats.laborCents / hours) : null;
  const classes = new Map(setup.laborClasses.map((item) => [item.id, item]));
  let crew: CalcInputs['crew'];
  if (job.usualCrew.length > 0) {
    crew = job.usualCrew.map((line) => {
      const item = classes.get(line.laborClassId);
      return { laborClassId: line.laborClassId, label: item?.name ?? 'Crew', headcount: String(line.headcount), rate: item?.rateCents === null || item?.rateCents === undefined ? '' : centsToDecimal(item.rateCents) };
    });
    notes.push("The crew is the job's usual crew at today's real cost of an hour.");
  } else {
    const item = (job.defaultLaborClassId ? classes.get(job.defaultLaborClassId) : undefined) ?? setup.laborClasses.find((entry) => entry.isDefault) ?? setup.laborClasses[0];
    const rate = actualRate ?? item?.rateCents ?? setup.defaults.defaultRateCents;
    crew = [{ laborClassId: item?.id ?? null, label: item?.name ?? 'Crew', headcount: '1', rate: rate === null || rate === undefined ? '' : centsToDecimal(rate) }];
    if (actualRate !== null) notes.push('The cost of an hour is what this job really paid: labor cost divided by labor hours.');
  }

  const owner = job.partsOwner ?? setup.clients.find((item) => item.id === job.clientId)?.partsOwner ?? setup.defaults.partsOwner;
  let material = '';
  if (owner === 'us') {
    if (stats.materialCents !== null && stats.materialCents > 0 && unitsGood > 0) {
      material = per(stats.materialCents, unitsGood);
      notes.push('Material per unit is the real material cost divided by the good units.');
    } else if (job.materialCostPerUnit) material = trimDecimal(job.materialCostPerUnit);
  }
  const otherCosts: { label: string; amount: string }[] = [];
  if (stats.otherCents !== null && stats.otherCents > 0) {
    otherCosts.push({ label: `Other costs on ${job.number}`, amount: centsToDecimal(stats.otherCents) });
    notes.push('Other costs are what this job really spent on freight, packaging and the like.');
  }
  let price = '';
  if (job.unitPrice) price = trimDecimal(job.unitPrice);
  else if (stats.baseRevenueCents !== null && unitsGood > 0) price = per(stats.baseRevenueCents, unitsGood);
  if (price) notes.push(job.unitPrice ? 'The price is the price on the job today.' : 'The price is what the job earned for each good unit.');

  const targetBp = stats.targetMarginBp ?? job.targetMarginBp ?? setup.defaults.targetMarginBp;
  const inputs: CalcInputs = {
    ...EMPTY_CALC,
    clientId: job.clientId,
    jobTypeId: job.jobTypeId,
    jobId: job.id,
    unitLabel: job.unitLabel || 'units',
    units: trimDecimal(units),
    standardUph: pace,
    crew,
    shiftHours: setup.defaults.shiftHours,
    setupHours: Number(stats.setupHours) > 0 ? trimDecimal(stats.setupHours) : '',
    partsOwner: owner,
    materialPerUnit: material,
    services: [],
    otherCosts,
    sharedPct: bpToPercent(setup.defaults.sharedPctBp) || '0',
    targetMarginPct: bpToPercent(targetBp) || '30',
    pricePerUnit: price,
    startDate: null,
  };
  return {
    jobId: job.id,
    jobNumber: job.number,
    jobName: job.name,
    inputs,
    notes,
    actual: { unitsGood: stats.unitsGood, hours: stats.hours, uph: stats.uph, marginBp: stats.marginBp, revenueCents: stats.revenueCents, costCents: stats.costCents, status: job.status },
  };
}

/* ---------------------------------------------------------------- scenario to job */

export interface JobFromScenarioInput {
  scenarioId: string;
  name: string;
  /** Needed when the scenario has no client. */
  clientId?: string | null;
  clientName?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

/**
 * Makes a real job from a saved scenario. The scenario's price becomes the job's price, its
 * pace the target pace, its crew the usual crew, and its totals the job's quote (origin
 * "calculator"), so plan vs actual starts from exactly what was quoted. The scenario is marked won.
 */
export async function createJobFromScenario(ctx: DomainContext, input: JobFromScenarioInput): Promise<{ jobId: string; jobNumber: string }> {
  await requireMoney(ctx);
  await requirePulse(ctx, 'job:manage');
  await requirePulse(ctx, 'plan:manage');
  const row = await scenarioRow(ctx, input.scenarioId);
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the job a name.', { name: 'Give the job a name.' });
  const inputs = reviveInputs(row.inputs);
  const clientId = (input.clientId && isUuid(input.clientId) ? input.clientId : null) ?? row.clientId;
  const clientName = cleanText(input.clientName);
  if (!clientId && !clientName) throw invalid('Pick the client this job is for.', { clientId: 'Pick a client, or type a new client name.' });
  const settings = await loadSettings(ctx.orgId);
  const run = runCalc(inputs, { workingDays: settings.workingDays });
  if (!run.summary || !run.plan || !run.summary.chosen) throw conflict('This scenario is missing numbers. Open it, fill in the form and save it again.');
  if (row.jobId) {
    const [made] = await rows<{ number: string }>(db, sql`SELECT j.number FROM pulse.jobs j JOIN pulse.job_plans p ON p.job_id = j.id WHERE j.org_id = ${ctx.orgId} AND j.id = ${row.jobId} AND j.deleted_at IS NULL AND p.plan = 'quote' AND p.origin = 'calculator' AND p.origin_ref = ${row.id}`);
    if (made) throw conflict(`This scenario already became job ${made.number}. Save it under a new name to make another job.`);
  }
  const crew = inputs.crew.filter((line) => line.laborClassId && isUuid(line.laborClassId) && Number(line.headcount) > 0);
  const job = await createJob(ctx, {
    name,
    clientId,
    clientName: clientId ? null : clientName,
    jobTypeId: row.jobTypeId,
    status: 'planned',
    pricingModel: 'per_unit',
    unitLabel: inputs.unitLabel,
    plannedUnits: run.plan.units,
    unitPrice: run.summary.chosen.pricePerUnit,
    materialMethod: 'standard',
    materialCostPerUnit: run.input?.materialPerUnit ? String(run.input.materialPerUnit) : '0',
    partsOwner: inputs.partsOwner,
    defaultLaborClassId: crew[0]?.laborClassId ?? null,
    usualCrew: crew.map((line) => ({ laborClassId: line.laborClassId as string, headcount: Math.max(1, Math.round(Number(line.headcount))) })),
    standardUph: run.input ? String(run.input.standardUph) : null,
    targetMarginBp: run.summary.targetMarginBp,
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    description: `Made from the calculator scenario "${row.name}".`,
    quote: {
      units: run.plan.units,
      revenueCents: run.plan.revenueCents,
      laborHours: run.plan.laborHours,
      laborCents: run.plan.laborCents,
      setupHours: run.plan.setupHours,
      setupCents: run.plan.setupCents,
      materialCents: run.plan.materialCents,
      otherCents: run.plan.otherCents,
      sharedCents: run.plan.sharedCents,
      origin: 'calculator',
      originRef: row.id,
      note: `From the scenario "${row.name}".`,
    },
  });
  await inTx(async (tx) => {
    await tx.update(quoteScenarios).set({ jobId: job.id, clientId: job.clientId, status: 'won', updatedAt: new Date() }).where(eq(quoteScenarios.id, row.id));
    await logActivity(tx, ctx, { verb: 'scenario.became_job', entityType: 'quote_scenario', entityId: row.id, jobId: job.id, clientId: job.clientId, after: { jobNumber: job.number, name } });
  });
  return { jobId: job.id, jobNumber: job.number };
}
