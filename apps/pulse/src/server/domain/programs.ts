/**
 * The program tracker (docs/programs/PULSE_PROGRAMS_SPEC.md section 4). A program is tracked by
 * month and by variant, with its plan read from Projects; the Pulse job under it (the "program
 * job") holds its typed hours, prep labor, materials and fees.
 *
 * A program's numbers are summed by `pm_program_id`, not by job (decision 2):
 * - revenue and units: `pmb:` build lines and `pmf:` fee rows with the program id, on any job;
 * - cost: the build lines' own cost (also on lines billed to other jobs), plus every other cost on
 *   the program job (typed and kiosk hours, `pmt:` prep rows, material use, cost rows, services).
 * Typed revenue on the program job is not program revenue (Projects owns the price), so Pulse
 * revenue equals Projects' month revenue to the cent (SPEC 6.1 parity).
 *
 * The plan (planned units, forecast, target, minimum) comes from Projects through
 * `program-plan.ts`; Pulse adds the cost forecast, margins and the program alerts.
 *
 * Every read uses `requirePulse` and `moneyOut`: a reader without money rights gets units, hours,
 * units per hour and planned units, never cents or margins, and only the P6 and P7 alerts.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { conflict, invalid, isDomainError, notFound } from '@/server/errors';
import { integrationAvailability } from '@/server/integrations/detect';
import { logSoftFail } from '@/server/integrations/log';
import {
  cardVersionInForce,
  programCardFacts,
  programDirectory,
  programMonth,
  programsReady,
  programTimeByPerson,
  programVariants,
  readPrograms,
  type ProgramDirectoryRow,
  type ProgramVariant,
} from '@/server/integrations/programs';
import { fixedLineForMonth } from '@kitstak/programs-engine/month';
import { fromScaled, hoursToScaled, marginBp, quantityToScaled, ratioBp, ZERO } from '@/lib/money';
import {
  eachDay,
  firstDayOfMonth,
  isPlannableDay,
  isRealMonth,
  isWorkDay,
  lastDayOfMonth,
  monthsBetween,
  programAlerts,
  programCostForecast,
  programMonthFigures,
  programTargetMargin,
  shiftMonth,
  unitsPerHourText,
  type FeeLine,
  type JobCostLine,
  type ProgramAlert,
  type ProgramCostForecast,
  type ProgramLine,
  type ProgramMonth,
  type ProgramMonthPlan,
  type ProgramTotals,
  type ProgramVariantFigures,
} from '@/lib/profit';
import {
  PROGRAM_STATUS_LABELS,
  type JobProgramRefDTO,
  type ProgramAlertDTO,
  type ProgramChartDayDTO,
  type ProgramCostForecastDTO,
  type ProgramDayRowDTO,
  type ProgramDaysDTO,
  type ProgramFiguresDTO,
  type ProgramHeaderDTO,
  type ProgramHealth,
  type ProgramLaborDTO,
  type ProgramLaborRowDTO,
  type ProgramListDTO,
  type ProgramListRowDTO,
  type ProgramMonthDTO,
  type ProgramMonthMetaDTO,
  type ProgramMonthRowDTO,
  type ProgramMonthsDTO,
  type ProgramNotTrackedDTO,
  type ProgramParityDTO,
  type ProgramPersonRowDTO,
  type ProgramPlanDTO,
  type ProgramsAvailabilityDTO,
  type ProgramStatus,
  type ProgramTargetDTO,
  type ProgramVariantRowDTO,
  type ProgramVariantsDTO,
  type TrackedProgramDTO,
} from '@/lib/program-types';
import { routes } from '@/lib/routes';
import { inTx, isUuid, moneyOut, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { recomputeJobs } from './job-stats';
import { getJobRow, getJobRowForReader, insertJob } from './jobs';
import { loadProgramPlan, type LoadedProgramPlan } from './program-plan';
import { attachProgramInTx } from './program-links';
import { closedMonths } from './recalc';
import { loadSettings, type SettingsRow } from './settings';
import { pendingProgramEvents } from './sync-programs';

const B = (value: string | number | bigint | null | undefined): bigint => BigInt(value ?? 0);
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{1,5}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
/** P1, P2, P4 and P5 make a program at risk; the others are a heads up (spec 6, `ProgramHealth`). */
const AT_RISK_RULES = new Set(['P1', 'P2', 'P4', 'P5']);
/** "Pulse is catching up" shows to money readers who are not admins once a sync has waited this long (SPEC 6.1). */
const CATCHING_UP_MINUTES = 10;
/** How many months before the shown month are read for the early month cost per unit (3.4) and P3. */
const PRIOR_MONTHS = 6;
/** The By month tab reads at most this many months. */
const MAX_MONTHS = 36;

/* ------------------------------------------------------------ availability */

/** Whether the program tracker can be shown here (nav item, pages). Never throws. */
export const getProgramsAvailability = scoped(async function getProgramsAvailability(ctx: DomainContext): Promise<ProgramsAvailabilityDTO> {
  await requirePulse(ctx, 'pulse:read');
  return availabilityOf(ctx);
});

async function availabilityOf(ctx: DomainContext): Promise<ProgramsAvailabilityDTO> {
  if (await programsReady(ctx)) return { available: true, reason: null };
  const entitled = await integrationAvailability(ctx)
    .then((apps) => apps.projects)
    .catch(() => false);
  return { available: false, reason: entitled ? 'not_ready' : 'not_entitled' };
}

/* ---------------------------------------------------------------- lookups */

interface ProgramJob {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientTargetMarginBp: number | null;
}

interface TrackedProgram {
  readonly program: ProgramDirectoryRow;
  /** The program job: the job its `pm_program` link points at, or for a deleted program the job that holds its rows. */
  readonly job: ProgramJob | null;
}

const statusOf = (status: string): ProgramStatus => (status in PROGRAM_STATUS_LABELS ? (status as ProgramStatus) : 'active');

async function jobsById(executor: Executor, ctx: DomainContext, ids: readonly string[]): Promise<Map<string, ProgramJob>> {
  const out = new Map<string, ProgramJob>();
  const clean = [...new Set(ids.filter(isUuid))];
  if (clean.length === 0) return out;
  const found = await rows<{ id: string; number: string; name: string; client_id: string; client_name: string; target: number | null }>(
    executor,
    sql`SELECT j.id::text AS id, j.number, j.name, j.client_id::text AS client_id, c.name AS client_name, c.target_margin_bp AS target
          FROM pulse.jobs j JOIN pulse.clients c ON c.id = j.client_id
         WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.id IN (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})`,
  );
  for (const row of found) out.set(row.id, { id: row.id, number: row.number, name: row.name, clientId: row.client_id, clientName: row.client_name, clientTargetMarginBp: row.target === null ? null : Number(row.target) });
  return out;
}

/** Program id to the job its `pm_program` mirror points at (live jobs only). */
async function programMirrors(executor: Executor, ctx: DomainContext, programIds?: readonly string[]): Promise<Map<string, string>> {
  const ids = programIds ? programIds.filter(isUuid) : null;
  if (ids && ids.length === 0) return new Map();
  const found = await rows<{ program_id: string; job_id: string }>(
    executor,
    sql`SELECT l.target_id AS program_id, l.job_id::text AS job_id
          FROM pulse.job_links l JOIN pulse.jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
         WHERE l.org_id = ${ctx.orgId} AND l.target_type = 'pm_program'
           ${ids ? sql`AND l.target_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql``}
         ORDER BY l.created_at`,
  );
  const out = new Map<string, string>();
  for (const row of found) if (!out.has(row.program_id)) out.set(row.program_id, row.job_id);
  return out;
}

/**
 * For programs with no live link (deleted in Projects): the job that holds their Pulse rows, the
 * fee rows' job first, else the job of the latest build line. Programs with no rows are left out.
 */
async function jobsHoldingRows(ctx: DomainContext, programIds: readonly string[]): Promise<Map<string, string>> {
  const ids = programIds.filter(isUuid);
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const found = await rows<{ program_id: string; job_id: string }>(
    db,
    sql`SELECT DISTINCT ON (x.program_id) x.program_id::text AS program_id, x.job_id::text AS job_id FROM (
          SELECT r.pm_program_id AS program_id, r.job_id, 0 AS rank, r.revenue_date AS d FROM pulse.revenue_entries r
           WHERE r.org_id = ${ctx.orgId} AND r.deleted_at IS NULL AND r.source = 'projects' AND r.source_ref LIKE 'pmf:%' AND r.job_id IS NOT NULL AND r.pm_program_id IN (${list})
          UNION ALL
          SELECT e.pm_program_id, e.job_id, 1, e.work_date FROM pulse.production_entries e
           WHERE e.org_id = ${ctx.orgId} AND e.deleted_at IS NULL AND e.source = 'projects' AND e.source_ref LIKE 'pmb:%' AND e.pm_program_id IN (${list})
        ) x JOIN pulse.jobs j ON j.id = x.job_id AND j.deleted_at IS NULL
        ORDER BY x.program_id, x.rank, x.d DESC`,
  );
  for (const row of found) out.set(row.program_id, row.job_id);
  return out;
}

/**
 * The tracked program with this key (case insensitive, this org only): a live program with a
 * Pulse link first, else a program deleted in Projects that still has rows in Pulse. Throws
 * NOT_FOUND for anything else (a program that is not tracked, another org's key).
 */
async function resolveProgram(ctx: DomainContext, key: string): Promise<TrackedProgram> {
  const clean = key.trim();
  if (!KEY_RE.test(clean) || !(await programsReady(ctx))) throw notFound('That program');
  const candidates = await programDirectory(ctx, { key: clean, throwOnError: true });
  if (candidates.length === 0) throw notFound('That program');
  const mirrors = await programMirrors(db, ctx, candidates.map((program) => program.id));
  let picked: { program: ProgramDirectoryRow; jobId: string } | null = null;
  for (const program of candidates) {
    const jobId = mirrors.get(program.id);
    if (jobId) {
      picked = { program, jobId };
      break;
    }
  }
  if (!picked) {
    const deleted = candidates.filter((program) => program.deleted);
    const holders = await jobsHoldingRows(ctx, deleted.map((program) => program.id));
    const program = deleted.find((row) => holders.has(row.id));
    if (program) picked = { program, jobId: holders.get(program.id) as string };
  }
  if (!picked) throw notFound('That program');
  const jobs = await jobsById(db, ctx, [picked.jobId]);
  return { program: picked.program, job: jobs.get(picked.jobId) ?? null };
}

function parseMonth(month: string | null | undefined, fallback: string): string {
  if (month === null || month === undefined || month === '') return fallback;
  const clean = month.trim().slice(0, 7);
  if (!MONTH_RE.test(clean) || !isRealMonth(clean)) throw invalid('Pick a month like 2026-11.', { month: 'Pick a month like 2026-11.' });
  return clean;
}

/* ------------------------------------------------------------ Pulse rows */

interface ProgramRows {
  readonly lines: ProgramLine[];
  readonly fees: FeeLine[];
  readonly jobCosts: JobCostLine[];
}

/**
 * The Pulse rows of a program from `from` to `to`, summed per day (and per variant for build
 * lines): build lines and fee rows by `pm_program_id` on any live job, and every other cost on the
 * program job. Material follows each job's material method, as in job stats.
 */
async function loadProgramRows(ctx: DomainContext, programId: string, jobId: string | null, from: string, to: string): Promise<ProgramRows> {
  const [lines, fees, costs] = await Promise.all([
    rows<{ d: string; v: string | null; units: string; scrap: string; revenue: string; labor: string; hours: string; material: string; shared: string }>(
      db,
      sql`SELECT to_char(e.work_date, 'YYYY-MM-DD') AS d, e.pm_variant_id::text AS v,
                 COALESCE(sum(e.units_good), 0)::text AS units, COALESCE(sum(e.units_scrap), 0)::text AS scrap,
                 COALESCE(sum(e.base_revenue_cents), 0)::text AS revenue, COALESCE(sum(e.labor_cost_cents), 0)::text AS labor,
                 COALESCE(sum(e.hours), 0)::text AS hours,
                 COALESCE(sum(e.std_material_cents) FILTER (WHERE j.material_method = 'standard'), 0)::text AS material,
                 COALESCE(sum(e.shared_cents), 0)::text AS shared
            FROM pulse.production_entries e JOIN pulse.jobs j ON j.id = e.job_id AND j.deleted_at IS NULL
           WHERE e.org_id = ${ctx.orgId} AND e.deleted_at IS NULL AND e.source = 'projects' AND e.source_ref LIKE 'pmb:%'
             AND e.pm_program_id = ${programId}::uuid AND e.work_date BETWEEN ${from}::date AND ${to}::date
           GROUP BY 1, 2`,
    ),
    rows<{ d: string; kind: string; cents: string }>(
      db,
      sql`SELECT to_char(r.revenue_date, 'YYYY-MM-DD') AS d, r.kind, COALESCE(sum(r.amount_cents), 0)::text AS cents
            FROM pulse.revenue_entries r LEFT JOIN pulse.jobs j ON j.id = r.job_id
           WHERE r.org_id = ${ctx.orgId} AND r.deleted_at IS NULL AND r.source = 'projects' AND r.source_ref LIKE 'pmf:%'
             AND r.pm_program_id = ${programId}::uuid AND r.revenue_date BETWEEN ${from}::date AND ${to}::date
             AND (r.job_id IS NULL OR j.deleted_at IS NULL)
           GROUP BY 1, 2`,
    ),
    jobId
      ? rows<{ d: string; hours: string; labor: string; material: string; other: string; shared: string }>(
          db,
          sql`SELECT to_char(x.d, 'YYYY-MM-DD') AS d, COALESCE(sum(x.hours), 0)::text AS hours, COALESCE(sum(x.labor), 0)::text AS labor,
                     COALESCE(sum(x.material), 0)::text AS material, COALESCE(sum(x.other), 0)::text AS other, COALESCE(sum(x.shared), 0)::text AS shared
                FROM (
                  SELECT e.work_date AS d, e.hours, e.labor_cost_cents AS labor,
                         CASE WHEN j.material_method = 'standard' THEN e.std_material_cents ELSE 0 END AS material, 0::bigint AS other, e.shared_cents AS shared
                    FROM pulse.production_entries e JOIN pulse.jobs j ON j.id = e.job_id
                   WHERE e.org_id = ${ctx.orgId} AND e.job_id = ${jobId}::uuid AND e.deleted_at IS NULL
                     AND NOT (e.source = 'projects' AND COALESCE(e.source_ref, '') LIKE 'pmb:%') AND e.work_date BETWEEN ${from}::date AND ${to}::date
                  UNION ALL
                  SELECT m.usage_date, 0, 0, m.cost_cents, 0, 0 FROM pulse.material_usage m JOIN pulse.jobs j ON j.id = m.job_id
                   WHERE m.org_id = ${ctx.orgId} AND m.job_id = ${jobId}::uuid AND m.deleted_at IS NULL AND j.material_method = 'actual'
                     AND m.usage_date BETWEEN ${from}::date AND ${to}::date
                  UNION ALL
                  SELECT c.cost_date, 0, 0, 0, c.amount_cents, 0 FROM pulse.cost_entries c
                   WHERE c.org_id = ${ctx.orgId} AND c.job_id = ${jobId}::uuid AND c.scope = 'job' AND c.deleted_at IS NULL
                     AND c.cost_date BETWEEN ${from}::date AND ${to}::date
                  UNION ALL
                  SELECT v.work_date, v.hours, v.labor_cost_cents, v.material_cents, 0, v.shared_cents FROM pulse.vas_entries v
                   WHERE v.org_id = ${ctx.orgId} AND v.job_id = ${jobId}::uuid AND v.deleted_at IS NULL AND v.work_date BETWEEN ${from}::date AND ${to}::date
                ) x
               GROUP BY 1`,
        )
      : Promise.resolve([]),
  ]);
  return {
    lines: lines.map((row) => ({ date: row.d, variantId: row.v, units: row.units, scrap: row.scrap, revenueCents: row.revenue, laborCents: row.labor, hours: row.hours, materialCents: row.material, sharedCents: row.shared })),
    fees: fees.map((row) => ({ date: row.d, kind: row.kind, amountCents: row.cents })),
    jobCosts: costs.map((row) => ({ date: row.d, hours: row.hours, laborCents: row.labor, materialCents: row.material, otherCents: row.other, sharedCents: row.shared })),
  };
}

function figuresFor(data: ProgramRows, month: string): ProgramMonth {
  const inMonth = (date: string): boolean => date.startsWith(`${month}-`);
  return programMonthFigures({ month, lines: data.lines.filter((row) => inMonth(row.date)), fees: data.fees.filter((row) => inMonth(row.date)), jobCosts: data.jobCosts.filter((row) => inMonth(row.date)) });
}

/* -------------------------------------------------------------- the month */

interface MonthContext {
  readonly access: PulseAccess;
  readonly settings: SettingsRow;
  readonly closed: ReadonlySet<string>;
  readonly variants: ReadonlyMap<string, ProgramVariant>;
}

interface BuiltMonth {
  readonly month: string;
  readonly meta: ProgramMonthMetaDTO;
  readonly today: string;
  readonly figures: ProgramMonth;
  readonly loaded: LoadedProgramPlan | null;
  readonly costForecast: ProgramCostForecast | null;
  readonly target: { readonly targetMarginBp: number; readonly source: 'client' | 'org' };
  readonly alerts: ProgramAlert[];
  readonly health: ProgramHealth;
}

async function monthContext(ctx: DomainContext, access: PulseAccess, programIds: readonly string[]): Promise<MonthContext> {
  const [settings, closed, variants] = await Promise.all([loadSettings(ctx.orgId), closedMonths(db, ctx.orgId), programVariants(ctx, programIds)]);
  return { access, settings, closed, variants };
}

function monthMeta(month: string, today: string, closed: ReadonlySet<string>): ProgramMonthMetaDTO {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  return { month, asOf: today < from ? from : today > to ? to : today, closed: closed.has(from), when: today < from ? 'future' : today > to ? 'past' : 'current' };
}

/** Everything one program month needs: figures, plan, cost forecast, target, alerts and health. */
async function buildMonth(ctx: DomainContext, tracked: TrackedProgram, month: string, mc: MonthContext): Promise<BuiltMonth> {
  const { program, job } = tracked;
  const today = todayInZone(program.timezone);
  const meta = monthMeta(month, today, mc.closed);
  const prior = shiftMonth(month, -PRIOR_MONTHS);
  const data = await loadProgramRows(ctx, program.id, job?.id ?? null, firstDayOfMonth(prior), lastDayOfMonth(month));
  const figures = figuresFor(data, month);
  const priorFigures = monthsBetween(prior, shiftMonth(month, -1)).map((m) => figuresFor(data, m));
  let loaded: LoadedProgramPlan | null = null;
  if (!program.deleted) {
    try {
      loaded = await loadProgramPlan(ctx, program, month, today);
    } catch (error) {
      logSoftFail(ctx.orgId, 'programs.buildMonth.plan', error);
    }
  }
  const plan = loaded?.plan ?? null;
  const costForecast = plan
    ? programCostForecast({ figures, plannedUnits: plan.plannedUnits, forecastRevenueCents: plan.forecastCents, priorDays: priorFigures.flatMap((row) => row.days) })
    : null;
  const target = programTargetMargin({ clientTargetMarginBp: job?.clientTargetMarginBp ?? null, orgDefaultBp: mc.settings.defaultTargetMarginBp });
  const variantNames: Record<string, string> = {};
  for (const variant of mc.variants.values()) if (variant.programId === program.id && !variant.deleted) variantNames[variant.id] = variant.name;
  const alerts = programAlerts(
    {
      programLabel: program.key,
      asOf: meta.asOf,
      figures,
      plan: plan ? { projectedGapCents: plan.projectedGapCents, minimumCents: plan.minimumCents } : { projectedGapCents: ZERO, minimumCents: null },
      forecastMarginBp: costForecast?.forecastMarginBp ?? null,
      targetMarginBp: target.targetMarginBp,
      thresholds: { atRiskGapBp: mc.settings.atRiskGapBp, marginFloorBp: mc.settings.marginFloorBp },
      closedMonths: priorFigures.filter((row) => mc.closed.has(firstDayOfMonth(row.month))).map((row) => ({ month: row.month, units: row.totals.units, costCents: row.totals.costCents })),
      variantNames,
    },
    { seesMoney: mc.access.seesMoney, unitLabel: program.unitSingular, currency: mc.settings.currency },
  );
  return { month, meta, today, figures, loaded, costForecast, target, alerts, health: healthOf(alerts, figures, plan, costForecast, mc.access.seesMoney) };
}

function healthOf(alerts: readonly ProgramAlert[], figures: ProgramMonth, plan: ProgramMonthPlan | null, forecast: ProgramCostForecast | null, seesMoney: boolean): ProgramHealth {
  if (seesMoney && forecast?.forecastMarginBp !== null && forecast?.forecastMarginBp !== undefined && forecast.forecastMarginBp < 0 && figures.totals.daysWithUnits >= 3) return 'losing';
  if (alerts.some((alert) => AT_RISK_RULES.has(alert.rule))) return 'at_risk';
  if (alerts.length > 0) return 'heads_up';
  const noUnits = quantityToScaled(figures.totals.units) <= ZERO;
  const noPlan = plan === null || quantityToScaled(plan.plannedUnits) <= ZERO;
  if (noUnits && noPlan) return 'no_data';
  return 'on_track';
}

/* ---------------------------------------------------------------- mappers */

function figuresDTO(totals: ProgramTotals, money: boolean): ProgramFiguresDTO {
  return {
    units: totals.units,
    scrap: totals.scrap,
    hours: totals.hours,
    unitsPerHour: totals.unitsPerHour,
    revenueCents: moneyOut(money, totals.revenueCents),
    workRevenueCents: moneyOut(money, totals.workRevenueCents),
    feeCents: moneyOut(money, totals.feeCents),
    laborCents: moneyOut(money, totals.laborCents),
    materialCents: moneyOut(money, totals.materialCents),
    otherCents: moneyOut(money, totals.otherCents),
    sharedCents: moneyOut(money, totals.sharedCents),
    costCents: moneyOut(money, totals.costCents),
    profitCents: moneyOut(money, totals.profitCents),
    marginBp: money ? totals.marginBp : null,
    revenuePerUnitCents: moneyOut(money, totals.revenuePerUnitCents),
    costPerUnitCents: moneyOut(money, totals.costPerUnitCents),
    profitPerUnitCents: moneyOut(money, totals.profitPerUnitCents),
    daysWithUnits: totals.daysWithUnits,
  };
}

function planDTO(plan: ProgramMonthPlan, money: boolean): ProgramPlanDTO {
  return {
    asOf: plan.asOf,
    builtUnits: plan.builtUnits,
    plannedUnits: plan.plannedUnits,
    forecastCents: moneyOut(money, plan.forecastCents),
    forecastMethod: plan.forecastMethod,
    targetCents: moneyOut(money, plan.targetCents),
    minimumCents: moneyOut(money, plan.minimumCents),
    projectedGapCents: moneyOut(money, plan.projectedGapCents),
    actualCents: moneyOut(money, plan.actualCents),
  };
}

function costForecastDTO(forecast: ProgramCostForecast, money: boolean): ProgramCostForecastDTO {
  return {
    basis: forecast.basis,
    daysUsed: forecast.daysUsed,
    unitsSoFar: forecast.unitsSoFar,
    remainingUnits: forecast.remainingUnits,
    costSoFarCents: moneyOut(money, forecast.costSoFarCents),
    costPerUnitCents: moneyOut(money, forecast.costPerUnitCents),
    forecastRevenueCents: moneyOut(money, forecast.forecastRevenueCents),
    forecastCostCents: moneyOut(money, forecast.forecastCostCents),
    forecastProfitCents: moneyOut(money, forecast.forecastProfitCents),
    forecastMarginBp: money ? forecast.forecastMarginBp : null,
    enoughDays: money && forecast.forecastMarginBp !== null,
  };
}

const alertDTO = (alert: ProgramAlert): ProgramAlertDTO => ({ rule: alert.rule, sentence: alert.sentence, action: alert.action, actionLabel: alert.actionLabel, variantId: alert.variantId });

async function headerDTO(ctx: DomainContext, tracked: TrackedProgram, access: PulseAccess, today: string): Promise<ProgramHeaderDTO> {
  const { program, job } = tracked;
  const status = statusOf(program.status);
  return {
    programId: program.id,
    key: program.key,
    name: program.name,
    status,
    statusLabel: PROGRAM_STATUS_LABELS[status],
    deleted: program.deleted,
    readOnly: program.deleted || !canManage(access),
    customerName: program.customerName,
    unit: { singular: program.unitSingular, plural: program.unitPlural },
    timezone: program.timezone,
    client: job ? { id: job.clientId, name: job.clientName } : null,
    job: job ? { id: job.id, number: job.number, name: job.name, path: routes.programJob(job.number) } : null,
    cardVersion: program.deleted ? null : await cardVersionInForce(ctx, program.id, today),
    projectsPath: program.path,
    path: routes.program(program.key),
  };
}

const canManage = (access: PulseAccess): boolean => access.role === 'owner' || access.role === 'admin' || access.role === 'manager';
const isAdmin = (access: PulseAccess): boolean => access.role === 'owner' || access.role === 'admin';

function targetDTO(built: BuiltMonth, job: ProgramJob | null, money: boolean): ProgramTargetDTO {
  return { targetMarginBp: money ? built.target.targetMarginBp : null, source: built.target.source, clientId: job?.clientId ?? null, clientPath: job ? routes.client(job.clientId) : null };
}

/** Pulse against Projects for the month (SPEC 6.1), with the audience rule. */
async function parityOf(ctx: DomainContext, tracked: TrackedProgram, built: BuiltMonth, access: PulseAccess): Promise<ProgramParityDTO> {
  const money = access.seesMoney;
  const pulseCents = built.figures.totals.revenueCents;
  let projectsCents: bigint | null = null;
  if (!tracked.program.deleted) {
    try {
      const read = await programMonth(ctx, tracked.program.id, built.month);
      projectsCents = read.output.reduce((sum, row) => sum + B(row.revenueCents), ZERO) + read.ledger.reduce((sum, row) => sum + row.cents, ZERO);
    } catch (error) {
      logSoftFail(ctx.orgId, 'programs.parity', error);
    }
  }
  const [events, state] = await Promise.all([
    pendingProgramEvents(db, ctx),
    rows<{ last_ok_at: string | null }>(
      db,
      sql`SELECT to_char(last_ok_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_ok_at FROM pulse.sync_state WHERE org_id = ${ctx.orgId} AND source = 'projects'`,
    ),
  ]);
  const pending = events.pending > 0;
  const status: ProgramParityDTO['status'] = projectsCents === null ? 'unknown' : projectsCents === pulseCents ? 'matches' : pending ? 'catching_up' : 'off';
  const waitedMinutes = events.since ? (Date.now() - Date.parse(events.since)) / 60_000 : 0;
  const visible = isAdmin(access) || (status === 'catching_up' && money && waitedMinutes >= CATCHING_UP_MINUTES);
  return {
    status,
    visible,
    diffCents: projectsCents === null ? null : moneyOut(money, projectsCents - pulseCents),
    projectsCents: projectsCents === null ? null : moneyOut(money, projectsCents),
    pulseCents: moneyOut(money, pulseCents),
    pendingSince: events.since,
    lastSyncAt: state[0]?.last_ok_at ?? null,
    canSync: isAdmin(access),
  };
}

function chartOf(built: BuiltMonth, money: boolean): ProgramChartDayDTO[] {
  const byDate = new Map(built.figures.days.map((day) => [day.date, day]));
  let revenue = ZERO;
  let cost = ZERO;
  let units = ZERO;
  const out: ProgramChartDayDTO[] = [];
  const from = firstDayOfMonth(built.month);
  if (built.meta.when === 'future') return out;
  for (const date of eachDay(from, built.meta.asOf)) {
    const day = byDate.get(date);
    if (day) {
      revenue += day.revenueCents;
      cost += day.costCents;
      units += quantityToScaled(day.units);
    }
    out.push({ date, revenueCents: moneyOut(money, revenue), costCents: moneyOut(money, cost), units: fromScaled(units, 3) });
  }
  return out;
}

/* ------------------------------------------------------------------ reads */

/**
 * The Overview of one program month (spec 4, 7.3): header, figures, plan from Projects, cost
 * forecast, the customer's target margin, parity with Projects and the alerts. `month` is
 * `YYYY-MM`, this month in the program zone when left out.
 */
export const getProgramMonth = scoped(async function getProgramMonth(ctx: DomainContext, key: string, monthArg?: string | null): Promise<ProgramMonthDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const tracked = await resolveProgram(ctx, key);
  const month = parseMonth(monthArg, todayInZone(tracked.program.timezone).slice(0, 7));
  const mc = await monthContext(ctx, access, [tracked.program.id]);
  const built = await buildMonth(ctx, tracked, month, mc);
  const money = access.seesMoney;
  const plan = built.loaded?.plan ?? null;
  const [header, parity] = await Promise.all([headerDTO(ctx, tracked, access, built.today), parityOf(ctx, tracked, built, access)]);
  return {
    header,
    month: built.meta,
    figures: figuresDTO(built.figures.totals, money),
    plan: plan ? planDTO(plan, money) : null,
    costForecast: built.costForecast ? costForecastDTO(built.costForecast, money) : null,
    target: targetDTO(built, tracked.job, money),
    parity,
    alerts: built.alerts.map(alertDTO),
    health: built.health,
    chart: chartOf(built, money),
    moneyHidden: !money,
  };
});

function variantRowDTO(row: ProgramVariantFigures, variant: ProgramVariant | undefined, planned: string | null, money: boolean): ProgramVariantRowDTO {
  return {
    variantId: row.variantId,
    name: row.variantId === null ? 'Not tied to a variant' : variant && !variant.deleted ? variant.name : 'Removed variant',
    key: variant?.key ?? null,
    sku: variant?.sku ?? null,
    color: variant?.color ?? null,
    retired: variant?.retired ?? false,
    plannedUnits: planned,
    units: row.units,
    scrap: row.scrap,
    hours: row.hours,
    revenueCents: moneyOut(money, row.revenueCents),
    laborCents: moneyOut(money, row.laborCents),
    materialCents: moneyOut(money, row.materialCents),
    otherCents: moneyOut(money, row.otherCents),
    sharedCents: moneyOut(money, row.sharedCents),
    costCents: moneyOut(money, row.costCents),
    profitCents: moneyOut(money, row.profitCents),
    marginBp: money ? row.marginBp : null,
    profitPerUnitCents: moneyOut(money, row.profitPerUnitCents),
    revenueShareBp: money ? row.revenueShareBp : null,
  };
}

const EMPTY_VARIANT = (variantId: string): ProgramVariantFigures => ({
  variantId,
  units: '0.000',
  scrap: '0.000',
  hours: '0.00',
  revenueCents: ZERO,
  laborCents: ZERO,
  materialCents: ZERO,
  otherCents: ZERO,
  sharedCents: ZERO,
  costCents: ZERO,
  profitCents: ZERO,
  marginBp: null,
  profitPerUnitCents: null,
  revenueShareBp: null,
});

/** The By variant tab (spec 4, 7.3): one row per variant with planned units, then fees and "Not tied to a variant"; with the total they equal the Overview. */
export const getProgramVariants = scoped(async function getProgramVariants(ctx: DomainContext, key: string, monthArg?: string | null): Promise<ProgramVariantsDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const tracked = await resolveProgram(ctx, key);
  const month = parseMonth(monthArg, todayInZone(tracked.program.timezone).slice(0, 7));
  const mc = await monthContext(ctx, access, [tracked.program.id]);
  const built = await buildMonth(ctx, tracked, month, mc);
  const money = access.seesMoney;
  const planned = new Map((built.loaded?.plan.plannedByVariant ?? []).map((row) => [row.variantId, row.units]));
  const seen = new Set(built.figures.byVariant.map((row) => row.variantId));
  const plannedOnly = [...planned.keys()]
    .filter((id): id is string => id !== null && !seen.has(id))
    .sort((a, b) => {
      const left = mc.variants.get(a)?.position ?? 'zzzz';
      const right = mc.variants.get(b)?.position ?? 'zzzz';
      return left === right ? (a < b ? -1 : 1) : left < right ? -1 : 1;
    });
  const variants = [...built.figures.byVariant, ...plannedOnly.map(EMPTY_VARIANT)].map((row) => variantRowDTO(row, row.variantId ? mc.variants.get(row.variantId) : undefined, built.loaded ? (planned.get(row.variantId) ?? '0.000') : null, money));
  const header = await headerDTO(ctx, tracked, access, built.today);
  return {
    header,
    month: built.meta,
    variants,
    fees: { totalCents: moneyOut(money, built.figures.fees.totalCents), byKind: built.figures.fees.byKind.map((row) => ({ kind: row.kind, cents: moneyOut(money, row.cents) })) },
    notTiedToVariant: variantRowDTO(built.figures.notTiedToVariant, undefined, planned.has(null) ? (planned.get(null) as string) : null, money),
    total: figuresDTO(built.figures.totals, money),
    moneyHidden: !money,
  };
});

/** The Days tab (spec 4, 7.3): every work day of the month with its planned units, plus days off that had activity. */
export const getProgramDays = scoped(async function getProgramDays(ctx: DomainContext, key: string, monthArg?: string | null): Promise<ProgramDaysDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const tracked = await resolveProgram(ctx, key);
  const month = parseMonth(monthArg, todayInZone(tracked.program.timezone).slice(0, 7));
  const mc = await monthContext(ctx, access, [tracked.program.id]);
  const built = await buildMonth(ctx, tracked, month, mc);
  const money = access.seesMoney;
  const activity = new Map(built.figures.days.map((day) => [day.date, day]));
  const planned = new Map((built.loaded?.plan.plannedByDay ?? []).map((row) => [row.date, row.units]));
  const calendar = built.loaded?.calendar ?? null;
  const days: ProgramDayRowDTO[] = [];
  for (const date of eachDay(firstDayOfMonth(month), lastDayOfMonth(month))) {
    const workDay = calendar ? isPlannableDay(calendar, date) : isWorkDay(date, mc.settings.workingDays);
    const day = activity.get(date);
    const plannedUnits = planned.get(date) ?? '0.000';
    if (!workDay && !day && quantityToScaled(plannedUnits) <= ZERO) continue;
    days.push({
      date,
      workDay,
      plannedUnits,
      units: day?.units ?? '0.000',
      scrap: day?.scrap ?? '0.000',
      hours: day?.hours ?? '0.00',
      unitsPerHour: day?.unitsPerHour ?? null,
      revenueCents: moneyOut(money, day?.revenueCents ?? ZERO),
      costCents: moneyOut(money, day?.costCents ?? ZERO),
      profitCents: moneyOut(money, day?.profitCents ?? ZERO),
      missingHours: day?.missingHours ?? false,
      addHoursPath: tracked.job ? routes.log({ date, job: tracked.job.number }) : null,
    });
  }
  const header = await headerDTO(ctx, tracked, access, built.today);
  return { header, month: built.meta, days, moneyHidden: !money };
});

/** The By month tab (spec 4, 7.3): one row per month from `from` to `to` (default the last 12 months), newest first. */
export const getProgramMonths = scoped(async function getProgramMonths(ctx: DomainContext, key: string, range: { from?: string | null; to?: string | null } = {}): Promise<ProgramMonthsDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const tracked = await resolveProgram(ctx, key);
  const { program, job } = tracked;
  const today = todayInZone(program.timezone);
  const to = parseMonth(range.to, today.slice(0, 7));
  const from = parseMonth(range.from, shiftMonth(to, -11));
  if (from > to) throw invalid('The first month is after the last month.', { from: 'Pick a month before the last month.' });
  const months = monthsBetween(from, to);
  if (months.length > MAX_MONTHS) throw invalid(`Pick at most ${MAX_MONTHS} months.`, { from: `Pick at most ${MAX_MONTHS} months.` });
  const money = access.seesMoney;
  const [settings, closed, data, card, feed, topUps] = await Promise.all([
    loadSettings(ctx.orgId),
    closedMonths(db, ctx.orgId),
    loadProgramRows(ctx, program.id, job?.id ?? null, firstDayOfMonth(from), lastDayOfMonth(to)),
    programCardFacts(ctx, program.id).catch((error: unknown) => {
      logSoftFail(ctx.orgId, 'programs.months.card', error);
      return null;
    }),
    readPrograms(ctx, [program.id]),
    rows<{ m: string; cents: string }>(
      db,
      sql`SELECT to_char(r.revenue_date, 'YYYY-MM') AS m, COALESCE(sum(r.amount_cents), 0)::text AS cents FROM pulse.revenue_entries r
           WHERE r.org_id = ${ctx.orgId} AND r.deleted_at IS NULL AND r.source = 'projects' AND r.pm_program_id = ${program.id}::uuid
             AND r.source_ref LIKE ${`pmf:${program.id}:minimum:%`} AND r.revenue_date BETWEEN ${firstDayOfMonth(from)}::date AND ${lastDayOfMonth(to)}::date
           GROUP BY 1`,
    ),
  ]);
  const target = programTargetMargin({ clientTargetMarginBp: job?.clientTargetMarginBp ?? null, orgDefaultBp: settings.defaultTargetMarginBp });
  const settledThrough = feed.get(program.id)?.settledThrough ?? null;
  const topUp = new Map(topUps.map((row) => [row.m, B(row.cents)]));
  const out: ProgramMonthRowDTO[] = months
    .slice()
    .reverse()
    .map((month) => {
      const figures = figuresFor(data, month).totals;
      let minimum: ProgramMonthRowDTO['minimum'] = null;
      let minimumCents: bigint | null = null;
      if (money && card) {
        const line = fixedLineForMonth({ month, calendar: card.facts.calendar, versions: card.versions, kind: 'monthly_minimum' });
        if (!line.inForce || line.cents <= ZERO) minimum = 'none';
        else {
          minimumCents = line.cents;
          if ((topUp.get(month) ?? ZERO) > ZERO) minimum = 'missed';
          else if (settledThrough !== null && settledThrough >= lastDayOfMonth(month)) minimum = 'met';
          else minimum = 'open';
        }
      }
      return {
        month,
        units: figures.units,
        hours: figures.hours,
        unitsPerHour: figures.unitsPerHour,
        revenueCents: moneyOut(money, figures.revenueCents),
        costCents: moneyOut(money, figures.costCents),
        profitCents: moneyOut(money, figures.profitCents),
        marginBp: money ? figures.marginBp : null,
        targetMarginBp: money ? target.targetMarginBp : null,
        minimum,
        minimumCents: moneyOut(money, minimumCents),
        closed: closed.has(firstDayOfMonth(month)),
      };
    });
  const header = await headerDTO(ctx, tracked, access, today);
  return { header, from, to, months: out, moneyHidden: !money };
});

const hoursText = (hundredths: bigint): string => fromScaled(hundredths, 2);

/**
 * The Labor tab (spec 7.3): hours and labor cost by labor class, with prep work logged in Projects
 * (`pmt:` rows) as its own row "Prep work in Projects", and hours by person (time logged in
 * Projects on the program, and time punches on the program job).
 */
export const getProgramLabor = scoped(async function getProgramLabor(ctx: DomainContext, key: string, monthArg?: string | null): Promise<ProgramLaborDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const tracked = await resolveProgram(ctx, key);
  const { program, job } = tracked;
  const today = todayInZone(program.timezone);
  const month = parseMonth(monthArg, today.slice(0, 7));
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const money = access.seesMoney;
  const jobFilter = job ? sql`${job.id}::uuid` : sql`NULL::uuid`;
  const [classes, unitsRow, people, punches, closed] = await Promise.all([
    rows<{ bucket: 'class' | 'prep'; class_id: string | null; name: string | null; hours: string; labor: string }>(
      db,
      sql`SELECT x.bucket, x.class_id::text AS class_id, lc.name, COALESCE(sum(x.hours), 0)::text AS hours, COALESCE(sum(x.labor), 0)::text AS labor
            FROM (
              SELECT 'class' AS bucket, e.labor_class_id AS class_id, e.hours, e.labor_cost_cents AS labor
                FROM pulse.production_entries e JOIN pulse.jobs j ON j.id = e.job_id AND j.deleted_at IS NULL
               WHERE e.org_id = ${ctx.orgId} AND e.deleted_at IS NULL AND e.source = 'projects' AND e.source_ref LIKE 'pmb:%'
                 AND e.pm_program_id = ${program.id}::uuid AND e.work_date BETWEEN ${from}::date AND ${to}::date
              UNION ALL
              SELECT CASE WHEN e.source = 'projects' AND COALESCE(e.source_ref, '') LIKE 'pmt:%' THEN 'prep' ELSE 'class' END,
                     CASE WHEN e.source = 'projects' AND COALESCE(e.source_ref, '') LIKE 'pmt:%' THEN NULL ELSE e.labor_class_id END, e.hours, e.labor_cost_cents
                FROM pulse.production_entries e
               WHERE e.org_id = ${ctx.orgId} AND e.job_id = ${jobFilter} AND e.deleted_at IS NULL
                 AND NOT (e.source = 'projects' AND COALESCE(e.source_ref, '') LIKE 'pmb:%') AND e.work_date BETWEEN ${from}::date AND ${to}::date
              UNION ALL
              SELECT 'class', v.labor_class_id, v.hours, v.labor_cost_cents FROM pulse.vas_entries v
               WHERE v.org_id = ${ctx.orgId} AND v.job_id = ${jobFilter} AND v.deleted_at IS NULL AND v.work_date BETWEEN ${from}::date AND ${to}::date
            ) x
            LEFT JOIN pulse.labor_classes lc ON lc.id = x.class_id
           GROUP BY 1, 2, 3`,
    ),
    rows<{ units: string }>(
      db,
      sql`SELECT COALESCE(sum(e.units_good), 0)::text AS units FROM pulse.production_entries e JOIN pulse.jobs j ON j.id = e.job_id AND j.deleted_at IS NULL
           WHERE e.org_id = ${ctx.orgId} AND e.deleted_at IS NULL AND e.source = 'projects' AND e.source_ref LIKE 'pmb:%'
             AND e.pm_program_id = ${program.id}::uuid AND e.work_date BETWEEN ${from}::date AND ${to}::date`,
    ),
    program.deleted ? Promise.resolve([]) : programTimeByPerson(ctx, { programId: program.id, timezone: program.timezone, from, to }),
    job
      ? rows<{ code: string; name: string | null; hours: string; pay: string | null }>(
          db,
          sql`SELECT t.employee_code AS code, max(t.employee_name) AS name, COALESCE(sum(t.hours), 0)::text AS hours, sum(t.pay_cents)::text AS pay
                FROM pulse.time_punches t
               WHERE t.org_id = ${ctx.orgId} AND t.job_id = ${job.id}::uuid AND t.deleted_at IS NULL AND t.work_date BETWEEN ${from}::date AND ${to}::date
               GROUP BY 1 ORDER BY 3 DESC`,
        )
      : Promise.resolve([]),
    closedMonths(db, ctx.orgId),
  ]);
  let totalHours = ZERO;
  let totalLabor = ZERO;
  for (const row of classes) {
    totalHours += hoursToScaled(row.hours);
    totalLabor += B(row.labor);
  }
  const classRows: ProgramLaborRowDTO[] = classes
    .filter((row) => row.bucket === 'class' && (hoursToScaled(row.hours) !== ZERO || B(row.labor) !== ZERO))
    .sort((a, b) => {
      const diff = hoursToScaled(b.hours) - hoursToScaled(a.hours);
      return diff === ZERO ? (a.name ?? '').localeCompare(b.name ?? '') : diff > ZERO ? 1 : -1;
    })
    .map((row) => ({
      laborClassId: row.class_id,
      kind: 'class' as const,
      name: row.class_id ? (row.name ?? 'Removed labor class') : 'No labor class',
      hours: hoursText(hoursToScaled(row.hours)),
      laborCents: moneyOut(money, B(row.labor)),
      hoursShareBp: ratioBp(hoursToScaled(row.hours), totalHours),
    }));
  const prep = classes.filter((row) => row.bucket === 'prep');
  if (prep.length > 0) {
    const hours = prep.reduce((sum, row) => sum + hoursToScaled(row.hours), ZERO);
    const labor = prep.reduce((sum, row) => sum + B(row.labor), ZERO);
    classRows.push({ laborClassId: null, kind: 'prep', name: 'Prep work in Projects', hours: hoursText(hours), laborCents: moneyOut(money, labor), hoursShareBp: ratioBp(hours, totalHours) });
  }
  const byPersonId = new Map<string, { name: string; build: number; prep: number }>();
  for (const row of people) {
    const have = byPersonId.get(row.userId) ?? { name: row.name, build: 0, prep: 0 };
    if (row.kind === 'build') have.build += row.minutes;
    else have.prep += row.minutes;
    byPersonId.set(row.userId, have);
  }
  const minutesToHundredths = (minutes: number): bigint => BigInt(Math.round((minutes * 100) / 60));
  let named = ZERO;
  const byPerson: ProgramPersonRowDTO[] = [];
  for (const [personId, person] of [...byPersonId.entries()].sort((a, b) => b[1].build + b[1].prep - (a[1].build + a[1].prep) || a[1].name.localeCompare(b[1].name))) {
    const hours = minutesToHundredths(person.build + person.prep);
    named += hours;
    byPerson.push({ source: 'projects', personId, name: person.name, hours: hoursText(hours), buildHours: hoursText(minutesToHundredths(person.build)), prepHours: hoursText(minutesToHundredths(person.prep)), payCents: null });
  }
  for (const punch of punches) {
    const hours = hoursToScaled(punch.hours);
    named += hours;
    byPerson.push({ source: 'punch', personId: punch.code, name: punch.name ?? punch.code, hours: hoursText(hours), buildHours: '0.00', prepHours: '0.00', payCents: punch.pay === null ? null : moneyOut(money && access.seesWages, B(punch.pay)) });
  }
  const unnamed = totalHours > named ? totalHours - named : ZERO;
  const header = await headerDTO(ctx, tracked, access, today);
  return {
    header,
    month: monthMeta(month, today, closed),
    byClass: classRows,
    byPerson,
    hoursWithoutName: hoursText(unnamed),
    totals: { hours: hoursText(totalHours), laborCents: moneyOut(money, totalLabor), unitsPerHour: unitsPerHourText(quantityToScaled(unitsRow[0]?.units ?? '0'), totalHours) },
    moneyHidden: !money,
  };
});

/* ------------------------------------------------------------------- list */

/** Pulse clients matched to programs by core customer or CRM account (spec 4 `trackProgram`). */
async function matchedClients(executor: Executor, ctx: DomainContext, programs: readonly ProgramDirectoryRow[]): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  const customers = [...new Set(programs.map((program) => program.coreCustomerId).filter((id): id is string => isUuid(id)))];
  const items = [...new Set(programs.map((program) => program.crmItemId).filter((id): id is string => isUuid(id)))];
  if (customers.length === 0 && items.length === 0) return out;
  const list = (ids: readonly string[]) => (ids.length ? sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `) : sql`NULL::uuid`);
  const found = await rows<{ id: string; name: string; core_customer_id: string | null; crm_account_item_id: string | null }>(
    executor,
    sql`SELECT id::text AS id, name, core_customer_id::text AS core_customer_id, crm_account_item_id::text AS crm_account_item_id FROM pulse.clients
         WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND (core_customer_id IN (${list(customers)}) OR crm_account_item_id IN (${list(items)}))`,
  );
  for (const program of programs) {
    const hit = found.find((row) => program.coreCustomerId && row.core_customer_id === program.coreCustomerId) ?? found.find((row) => program.crmItemId && row.crm_account_item_id === program.crmItemId);
    if (hit) out.set(program.id, { id: hit.id, name: hit.name });
  }
  return out;
}

/**
 * The Programs list (spec 4, 7.2): one row per program with a Pulse link (and deleted programs
 * that still have rows), with this month's numbers, plan, forecast and health; plus "Not tracked
 * yet": programs running in Projects with no Pulse job. `month` defaults to this month.
 */
export const listTrackedPrograms = scoped(async function listTrackedPrograms(ctx: DomainContext, options: { month?: string | null } = {}): Promise<ProgramListDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const money = access.seesMoney;
  const availability = await availabilityOf(ctx);
  const fallbackMonth = todayInZone('America/Chicago').slice(0, 7);
  const emptyTotals = { revenueCents: moneyOut(money, ZERO), costCents: moneyOut(money, ZERO), profitCents: moneyOut(money, ZERO), marginBp: null, unitsByLabel: [] };
  if (!availability.available) {
    return { available: false, reason: availability.reason, month: parseMonth(options.month, fallbackMonth), programs: [], notTracked: [], totals: emptyTotals, canTrack: false, moneyHidden: !money };
  }
  const directory = await programDirectory(ctx, { throwOnError: true });
  const mirrors = await programMirrors(db, ctx, directory.map((program) => program.id));
  const deletedHolders = await jobsHoldingRows(ctx, directory.filter((program) => program.deleted && !mirrors.has(program.id)).map((program) => program.id));
  const trackedIds = new Map<string, string>([...mirrors, ...deletedHolders]);
  const tracked = directory.filter((program) => trackedIds.has(program.id));
  const zone = tracked.find((program) => !program.deleted)?.timezone ?? directory[0]?.timezone ?? 'America/Chicago';
  const month = parseMonth(options.month, todayInZone(zone).slice(0, 7));
  const jobs = await jobsById(db, ctx, [...trackedIds.values()]);
  const mc = await monthContext(ctx, access, tracked.map((program) => program.id));
  const lastActivity = tracked.length
    ? await rows<{ program_id: string; last: string }>(
        db,
        sql`SELECT pm_program_id::text AS program_id, to_char(max(work_date), 'YYYY-MM-DD') AS last FROM pulse.production_entries
             WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND source = 'projects' AND pm_program_id IN (${sql.join(tracked.map((program) => sql`${program.id}::uuid`), sql`, `)})
             GROUP BY 1`,
      )
    : [];
  const lastById = new Map(lastActivity.map((row) => [row.program_id, row.last]));

  const programs: ProgramListRowDTO[] = [];
  let revenue = ZERO;
  let cost = ZERO;
  const unitsByLabel = new Map<string, bigint>();
  for (const program of tracked) {
    const job = jobs.get(trackedIds.get(program.id) as string) ?? null;
    const built = await buildMonth(ctx, { program, job }, month, mc);
    const totals = built.figures.totals;
    revenue += totals.revenueCents;
    cost += totals.costCents;
    unitsByLabel.set(program.unitPlural, (unitsByLabel.get(program.unitPlural) ?? ZERO) + quantityToScaled(totals.units));
    const status = statusOf(program.status);
    const plan = built.loaded?.plan ?? null;
    programs.push({
      programId: program.id,
      key: program.key,
      name: program.name,
      customerName: program.customerName,
      status,
      statusLabel: PROGRAM_STATUS_LABELS[status],
      deleted: program.deleted,
      unit: { singular: program.unitSingular, plural: program.unitPlural },
      jobId: job?.id ?? null,
      jobNumber: job?.number ?? null,
      units: totals.units,
      plannedUnits: plan?.plannedUnits ?? null,
      hours: totals.hours,
      unitsPerHour: totals.unitsPerHour,
      revenueCents: moneyOut(money, totals.revenueCents),
      costCents: moneyOut(money, totals.costCents),
      profitCents: moneyOut(money, totals.profitCents),
      marginBp: money ? totals.marginBp : null,
      targetMarginBp: money ? built.target.targetMarginBp : null,
      forecastRevenueCents: plan ? moneyOut(money, plan.forecastCents) : null,
      forecastMarginBp: money ? (built.costForecast?.forecastMarginBp ?? null) : null,
      health: built.health,
      healthReason: built.alerts[0]?.sentence ?? null,
      lastActivityDate: lastById.get(program.id) ?? null,
      path: routes.program(program.key),
      projectsPath: program.path,
    });
  }
  // Live, not archived or ended, and no Pulse job behind a link or a mirror.
  const untracked = directory.filter((program) => !program.deleted && !trackedIds.has(program.id) && !program.billsToJobId && program.status !== 'archived' && program.status !== 'completed');
  const clients = await matchedClients(db, ctx, untracked);
  const notTracked: ProgramNotTrackedDTO[] = untracked.map((program) => {
    const status = statusOf(program.status);
    return {
      programId: program.id,
      key: program.key,
      name: program.name,
      customerName: program.customerName,
      status,
      statusLabel: PROGRAM_STATUS_LABELS[status],
      unit: { singular: program.unitSingular, plural: program.unitPlural },
      matchedClient: clients.get(program.id) ?? null,
      projectsPath: program.path,
    };
  });
  return {
    available: true,
    reason: null,
    month,
    programs,
    notTracked,
    totals: {
      revenueCents: moneyOut(money, revenue),
      costCents: moneyOut(money, cost),
      profitCents: moneyOut(money, revenue - cost),
      marginBp: money ? marginBp(revenue - cost, revenue) : null,
      unitsByLabel: [...unitsByLabel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unitPlural, units]) => ({ unitPlural, units: fromScaled(units, 3) })),
    },
    canTrack: canManage(access),
    moneyHidden: !money,
  };
});

/** How many programs are tracked in Pulse (the Jobs list footer: "8 programs are tracked under Programs."). 0 when programs are not available. */
export const countTrackedPrograms = scoped(async function countTrackedPrograms(ctx: DomainContext): Promise<number> {
  await requirePulse(ctx, 'pulse:read');
  if (!(await programsReady(ctx))) return 0;
  const [row] = await rows<{ n: number }>(
    db,
    sql`SELECT count(DISTINCT l.target_id)::int AS n FROM pulse.job_links l JOIN pulse.jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
         WHERE l.org_id = ${ctx.orgId} AND l.target_type = 'pm_program'`,
  );
  return row?.n ?? 0;
});

/**
 * The program a job holds, for the job page redirect and banner (`/jobs/J-1040` goes to
 * `/programs/GLOVE`). Null when no program link points at the job or programs are not available.
 */
export const programForJob = scoped(async function programForJob(ctx: DomainContext, jobRef: string): Promise<JobProgramRefDTO | null> {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJobRowForReader(ctx, jobRef, access);
  if (!(await programsReady(ctx))) return null;
  const [link] = await rows<{ program_id: string }>(
    db,
    sql`SELECT target_id AS program_id FROM pulse.job_links WHERE org_id = ${ctx.orgId} AND job_id = ${job.id} AND target_type = 'pm_program' ORDER BY created_at LIMIT 1`,
  );
  if (!link || !isUuid(link.program_id)) return null;
  const [program] = await programDirectory(ctx, { ids: [link.program_id] });
  if (!program) return null;
  return {
    programId: program.id,
    key: program.key,
    name: program.name,
    cardVersion: program.deleted ? null : await cardVersionInForce(ctx, program.id, todayInZone(program.timezone)),
    deleted: program.deleted,
    path: routes.program(program.key),
    projectsPath: program.path,
  };
});

/* ----------------------------------------------------------------- writes */

/** Leaves a change note so the next background sync copies the program's rows in (spec 4 `trackProgram`). */
async function queueProgramSync(tx: Executor, ctx: DomainContext, programId: string, via: string): Promise<void> {
  await tx.execute(
    sql`INSERT INTO pulse.bridge_events (org_id, kind, target_id, payload) VALUES (${ctx.orgId}, 'pm_program_changed', ${programId}, ${JSON.stringify({ via })}::jsonb)
        ON CONFLICT (org_id, kind, target_id) WHERE processed_at IS NULL DO NOTHING`,
  );
}

const trackedLine = (jobNumber: string, key: string): string => `${jobNumber} is now tracked as the ${key} program.`;

function jobStatusFor(status: string): 'active' | 'on_hold' | 'planned' {
  if (status === 'on_hold') return 'on_hold';
  if (status === 'planning') return 'planned';
  return 'active';
}

/**
 * Tracks a program in Pulse (spec 4). Without `jobRef` it makes the program job: ongoing, per
 * unit, the program's unit word, the client matched by core customer or CRM account (or
 * `clientId` when none matches: it asks with a `clientId` field error), no quote, no budget, no
 * typed price. With `jobRef` it links that existing job instead. Either way `canLinkJob` runs
 * first (a job that is not per unit is refused), then the `bills_to` edge, the mirror and
 * `program_job` are written in one transaction, and a program sync is queued. Needs `job:manage`.
 * A program that already has a Pulse job is refused.
 */
export const trackProgram = scoped(async function trackProgram(ctx: DomainContext, programId: string, options: { clientId?: string | null; jobRef?: string | null } = {}): Promise<TrackedProgramDTO> {
  await requirePulse(ctx, 'job:manage');
  if (!isUuid(programId)) throw invalid('Pick a program.', { programId: 'Pick a program.' });
  if (!(await programsReady(ctx))) throw conflict('Programs are not ready in this workspace yet. Ask an admin to update Projects.');
  const [program] = await programDirectory(ctx, { ids: [programId], throwOnError: true });
  if (!program || program.deleted) throw invalid('That program is no longer in Projects.', { programId: 'Pick another program.' });
  const refuseTaken = async (jobId: string): Promise<never> => {
    const holder = (await jobsById(db, ctx, [jobId])).get(jobId);
    throw conflict(holder ? `${program.key} is already tracked in Pulse on ${holder.number}.` : `${program.key} already bills to a job. Remove that link in Projects first.`);
  };
  const mirrored = (await programMirrors(db, ctx, [programId])).get(programId);
  if (mirrored) await refuseTaken(mirrored);
  if (program.billsToJobId) await refuseTaken(program.billsToJobId);
  try {
    return await inTx(async (tx) => {
      // One track at a time per program, so two clicks make one job.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pulse-track-program:${ctx.orgId}:${programId}`}))`);
      const again = (await programMirrors(tx, ctx, [programId])).get(programId);
      if (again) await refuseTaken(again);
      let jobId: string;
      let jobNumber: string;
      let clientId: string;
      if (options.jobRef) {
        const job = await getJobRow(ctx, options.jobRef, tx);
        jobId = job.id;
        jobNumber = job.number;
        clientId = job.clientId;
      } else {
        let chosen = options.clientId ?? null;
        if (chosen && !isUuid(chosen)) throw invalid('Pick a client.', { clientId: 'Pick a client.' });
        if (!chosen) chosen = (await matchedClients(tx, ctx, [program])).get(program.id)?.id ?? null;
        if (!chosen) throw invalid(`Pick the Pulse client for ${program.key}.`, { clientId: `Pick the client ${program.key} works for.` });
        const job = await insertJob(tx, ctx, {
          name: program.name,
          clientId: chosen,
          kind: 'ongoing',
          pricingModel: 'per_unit',
          unitLabel: program.unitPlural,
          status: jobStatusFor(program.status),
          startDate: program.startDate,
        });
        jobId = job.id;
        jobNumber = job.number;
        clientId = job.clientId;
      }
      await attachProgramInTx(tx, ctx, jobId, programId);
      await queueProgramSync(tx, ctx, programId, 'track_program');
      await logActivity(tx, ctx, { verb: 'job.updated', entityType: 'job', entityId: jobId, jobId, clientId, field: 'program_job', before: { programJob: false }, after: { programJob: true }, body: trackedLine(jobNumber, program.key), meta: { via: 'track_program', programKey: program.key, programId } });
      await recomputeJobs(tx, ctx, [jobId]);
      return { programId, key: program.key, jobId, jobNumber, changed: true, path: routes.program(program.key) };
    });
  } catch (error) {
    if (isDomainError(error)) throw error;
    const code = (error as { code?: string; cause?: { code?: string } } | null)?.code ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
    if (code === '23505') throw conflict(`${program.key} already bills to a job, or this job already takes another program.`);
    throw error;
  }
});

/**
 * Makes a job that a program link already points at a program job (spec 4, all 8 in production):
 * sets `program_job` and writes one activity line ("J-26131 is now tracked as the GLOVE
 * program."). Its plans and typed price stay but are not used. Idempotent: a second call changes
 * nothing and writes no line. Needs `job:manage`.
 */
export const convertToProgramJob = scoped(async function convertToProgramJob(ctx: DomainContext, jobRef: string): Promise<TrackedProgramDTO> {
  await requirePulse(ctx, 'job:manage');
  const job = await getJobRow(ctx, jobRef);
  const [link] = await rows<{ program_id: string; key: string | null }>(
    db,
    sql`SELECT target_id AS program_id, meta->>'key' AS key FROM pulse.job_links WHERE org_id = ${ctx.orgId} AND job_id = ${job.id} AND target_type = 'pm_program' ORDER BY created_at LIMIT 1`,
  );
  if (!link) throw conflict(`${job.number} is not linked to a program. Link one from the job page first.`);
  const key = link.key ?? (await programDirectory(ctx, { ids: [link.program_id] }))[0]?.key ?? 'program';
  return inTx(async (tx) => {
    const changed = await rows<{ id: string }>(tx, sql`UPDATE pulse.jobs SET program_job = true, updated_at = now() WHERE org_id = ${ctx.orgId} AND id = ${job.id} AND NOT program_job RETURNING id::text AS id`);
    if (changed.length > 0) {
      await logActivity(tx, ctx, { verb: 'job.updated', entityType: 'job', entityId: job.id, jobId: job.id, clientId: job.clientId, field: 'program_job', before: { programJob: false }, after: { programJob: true }, body: trackedLine(job.number, key), meta: { via: 'convert_program_job', programKey: key, programId: link.program_id } });
      await recomputeJobs(tx, ctx, [job.id]);
    }
    return { programId: link.program_id, key, jobId: job.id, jobNumber: job.number, changed: changed.length > 0, path: routes.program(key) };
  });
});
