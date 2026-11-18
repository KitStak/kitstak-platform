/**
 * `recomputeJobs` (SPEC 4.18): the cached rollup of a job in `pulse.job_stats`.
 * Heavy lifting is SQL (one grouped read per stream for the whole batch); the projection (4.13)
 * and the risk rules (4.14) are the pure functions in `@/lib/profit`, so the numbers on a job
 * page, in a report and in a unit test come from the same code.
 */
import 'server-only';
import { getTableColumns, sql } from 'drizzle-orm';
import type { Executor } from '@/server/db';
import { jobStats } from '@/server/db/schema';
import { marginBp } from '@/lib/money';
import {
  addDays,
  assessRisk,
  daysMissingHours,
  evidenceDayCount,
  isWorkDay,
  lastEvidenceWindow,
  paceDays,
  paceOverall,
  planHasCosts,
  productivityBp,
  projectJob,
  targetMarginBp,
  targetPace,
  type ActualTotals,
  type PaceRow,
  type PlanTotals,
  type StandardRow,
} from '@/lib/profit';
import { centsOut, rows, todayInZone, uuidArray, type DomainContext } from './_shared';
import { loadSettings, type SettingsRow } from './settings';

const B = (value: string | number | bigint | null | undefined): bigint => BigInt(value ?? 0);

interface JobRow {
  id: string;
  status: string;
  kind: string;
  pricing_model: string;
  planned_units: string;
  unit_price: string | null;
  fixed_price_cents: string | null;
  bill_rate_cents: number | null;
  material_method: string;
  material_cost_per_unit: string;
  standard_uph: string | null;
  target_margin_bp: number | null;
  type_margin_bp: number | null;
  client_margin_bp: number | null;
  type_standard_uph: string | null;
  due_date: string | null;
  start_date: string | null;
  activated_date: string | null;
  created_date: string;
  wms_shortage: boolean;
  client_id: string;
  job_type_id: string;
  default_labor_class_id: string | null;
  timezone: string;
  fallback_rate_cents: number | null;
  has_plan: boolean;
  plan_units: string | null;
  plan_revenue_cents: string | null;
  plan_labor_hours: string | null;
  plan_labor_cents: string | null;
  plan_setup_hours: string | null;
  plan_setup_cents: string | null;
  plan_material_cents: string | null;
  plan_other_cents: string | null;
  plan_shared_cents: string | null;
  usage_cents: string;
  usage_scrap_cents: string;
  usage_planned_rows: number;
  usage_planned_left_cents: string;
  vas_revenue_cents: string;
  vas_labor_cents: string;
  vas_material_cents: string;
  vas_shared_cents: string;
  vas_hours: string;
  vas_no_price: number;
  vas_needs_rate: number;
  other_cost_cents: string;
  other_revenue_cents: string;
  true_up_cents: string;
  billed_cents: string;
  l30_revenue: string;
  l30_labor: string;
  l30_material: string;
  l30_other: string;
  l30_shared: string;
  l30_units: string;
  l30_hours: string;
  l30_entry_days: number;
}

interface ProdRow {
  job_id: string;
  work_date: string;
  units_good: string;
  units_scrap: string;
  units_rework: string;
  hours: string;
  overtime_hours: string;
  setup_hours: string;
  hours_confirmed: boolean;
  source: string;
  labor_cost_cents: string;
  shared_cents: string;
  base_revenue_cents: string;
  std_material_cents: string;
  std_scrap_cents: string;
  needs_rate: boolean;
}

/** Fully past work days in a row with nothing logged, for rule W5. */
function workDaysQuiet(job: JobRow, lastEntry: string | null, today: string, workingDays: readonly number[]): number | null {
  if (job.status !== 'active') return null;
  const starts = [job.start_date, job.activated_date ?? job.created_date].filter((date): date is string => Boolean(date)).sort();
  const from = starts[starts.length - 1] ?? today;
  let cursor = lastEntry && lastEntry >= from ? addDays(lastEntry, 1) : from;
  let quiet = 0;
  for (let guard = 0; cursor < today && guard < 400; guard += 1) {
    if (isWorkDay(cursor, workingDays)) quiet += 1;
    cursor = addDays(cursor, 1);
  }
  return quiet;
}

function sumScaled(values: readonly string[], scale: number): string {
  let total = BigInt(0);
  const factor = BigInt(10) ** BigInt(scale);
  for (const value of values) {
    const [whole = '0', frac = ''] = value.replace('-', '').split('.');
    const scaled = BigInt(whole) * factor + BigInt((frac + '0'.repeat(scale)).slice(0, scale) || '0');
    total += value.startsWith('-') ? -scaled : scaled;
  }
  const negative = total < BigInt(0);
  const abs = negative ? -total : total;
  const text = `${abs / factor}.${(abs % factor).toString().padStart(scale, '0')}`;
  return negative ? `-${text}` : text;
}

const fixed = (value: number | null, digits: number): string | null => (value === null || !Number.isFinite(value) ? null : value.toFixed(digits));

/**
 * Rebuilds `pulse.job_stats` for the given jobs: totals from the stream tables, then the
 * projection and the risk rules, then one batched upsert. Runs inside the caller's transaction.
 */
export async function recomputeJobs(executor: Executor, ctx: DomainContext, jobIds: readonly string[], options: { settings?: SettingsRow } = {}): Promise<void> {
  const unique = [...new Set(jobIds)];
  if (unique.length === 0) return;
  const settings = options.settings ?? (await loadSettings(ctx.orgId, executor));
  const standards = (
    await rows<{ id: string; job_type_id: string | null; vas_service_id: string | null; client_id: string | null; labor_class_id: string | null; uph: string; effective_from: string; created_at: string }>(
      executor,
      sql`select id, job_type_id, vas_service_id, client_id, labor_class_id, units_per_labor_hour::text as uph,
                 to_char(effective_from, 'YYYY-MM-DD') as effective_from, created_at::text as created_at
            from pulse.standards where org_id = ${ctx.orgId} and deleted_at is null and job_type_id is not null`,
    )
  ).map(
    (row): StandardRow => ({
      id: row.id,
      jobTypeId: row.job_type_id,
      vasServiceId: row.vas_service_id,
      clientId: row.client_id,
      laborClassId: row.labor_class_id,
      unitsPerLaborHour: row.uph,
      effectiveFrom: row.effective_from,
      createdAt: row.created_at,
    }),
  );
  for (let offset = 0; offset < unique.length; offset += 200) {
    await recomputeChunk(executor, ctx, unique.slice(offset, offset + 200), settings, standards);
  }
}

async function recomputeChunk(executor: Executor, ctx: DomainContext, ids: readonly string[], settings: SettingsRow, standards: readonly StandardRow[]): Promise<void> {
  const idList = uuidArray(ids);
  const jobs = await rows<JobRow>(
    executor,
    sql`
    SELECT j.id, j.status, j.kind, j.pricing_model, j.planned_units::text, j.unit_price::text, j.fixed_price_cents::text, j.bill_rate_cents,
           j.material_method, j.material_cost_per_unit::text, j.standard_uph::text, j.target_margin_bp,
           jt.target_margin_bp AS type_margin_bp, c.target_margin_bp AS client_margin_bp, jt.default_standard_uph::text AS type_standard_uph,
           to_char(j.due_date, 'YYYY-MM-DD') AS due_date, to_char(j.start_date, 'YYYY-MM-DD') AS start_date,
           to_char((j.activated_at AT TIME ZONE s.timezone)::date, 'YYYY-MM-DD') AS activated_date,
           to_char((j.created_at AT TIME ZONE s.timezone)::date, 'YYYY-MM-DD') AS created_date,
           j.wms_shortage, j.client_id, j.job_type_id, j.default_labor_class_id, s.timezone,
           (SELECT CASE WHEN r.found THEN r.rate_cents END FROM pulse.rate_for(j.org_id, j.default_labor_class_id, j.site_id, (now() AT TIME ZONE s.timezone)::date) r) AS fallback_rate_cents,
           (pl.id IS NOT NULL) AS has_plan, pl.units::text AS plan_units, pl.revenue_cents::text AS plan_revenue_cents, pl.labor_hours::text AS plan_labor_hours,
           pl.labor_cents::text AS plan_labor_cents, pl.setup_hours::text AS plan_setup_hours, pl.setup_cents::text AS plan_setup_cents,
           pl.material_cents::text AS plan_material_cents, pl.other_cents::text AS plan_other_cents, pl.shared_cents::text AS plan_shared_cents,
           mu.usage_cents::text, mu.usage_scrap_cents::text, mu.usage_planned_rows, mu.usage_planned_left_cents::text,
           v.vas_revenue_cents::text, v.vas_labor_cents::text, v.vas_material_cents::text, v.vas_shared_cents::text, v.vas_hours::text, v.vas_no_price, v.vas_needs_rate,
           ce.other_cost_cents::text, re.other_revenue_cents::text, re.true_up_cents::text, re.billed_cents::text,
           l30.l30_revenue::text, l30.l30_labor::text, l30.l30_material::text, l30.l30_other::text, l30.l30_shared::text, l30.l30_units::text, l30.l30_hours::text,
           (SELECT count(DISTINCT p.work_date)::int FROM pulse.production_entries p
             WHERE p.job_id = j.id AND p.deleted_at IS NULL AND p.work_date > (now() AT TIME ZONE s.timezone)::date - 30) AS l30_entry_days
      FROM pulse.jobs j
      JOIN pulse.job_types jt ON jt.id = j.job_type_id
      JOIN pulse.clients c ON c.id = j.client_id
      JOIN pulse.sites s ON s.id = j.site_id
      LEFT JOIN LATERAL (SELECT * FROM pulse.job_plans p WHERE p.job_id = j.id ORDER BY (p.plan = 'budget') DESC LIMIT 1) pl ON true
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(m.cost_cents), 0) AS usage_cents, COALESCE(sum(m.scrap_cents), 0) AS usage_scrap_cents,
               count(*) FILTER (WHERE m.quantity_planned IS NOT NULL AND m.resolved_supplied_by = 'us')::int AS usage_planned_rows,
               COALESCE(sum(round(GREATEST(0, m.quantity_planned - m.quantity_used - m.quantity_scrapped) * m.unit_cost * 100))
                        FILTER (WHERE m.quantity_planned IS NOT NULL AND m.resolved_supplied_by = 'us'), 0) AS usage_planned_left_cents
          FROM pulse.material_usage m WHERE m.job_id = j.id AND m.deleted_at IS NULL
      ) mu
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(e.amount_cents), 0) AS vas_revenue_cents, COALESCE(sum(e.labor_cost_cents), 0) AS vas_labor_cents,
               COALESCE(sum(e.material_cents), 0) AS vas_material_cents, COALESCE(sum(e.shared_cents), 0) AS vas_shared_cents,
               COALESCE(sum(e.hours), 0) AS vas_hours, count(*) FILTER (WHERE e.amount_cents IS NULL)::int AS vas_no_price,
               count(*) FILTER (WHERE e.needs_rate)::int AS vas_needs_rate
          FROM pulse.vas_entries e WHERE e.job_id = j.id AND e.deleted_at IS NULL
      ) v
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(x.amount_cents), 0) AS other_cost_cents FROM pulse.cost_entries x WHERE x.job_id = j.id AND x.scope = 'job' AND x.deleted_at IS NULL
      ) ce
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(x.amount_cents) FILTER (WHERE x.kind IN ('fee', 'adjustment', 'credit')), 0) AS other_revenue_cents,
               COALESCE(sum(x.amount_cents) FILTER (WHERE x.kind = 'fixed_true_up'), 0) AS true_up_cents,
               COALESCE(sum(x.amount_cents) FILTER (WHERE x.kind = 'invoice' AND x.approved), 0) AS billed_cents
          FROM pulse.revenue_entries x WHERE x.job_id = j.id AND x.deleted_at IS NULL
      ) re
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind IN ('revenue_base', 'revenue_vas', 'revenue_other')), 0) AS l30_revenue,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'labor'), 0) AS l30_labor,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'material'), 0) AS l30_material,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'other'), 0) AS l30_other,
               COALESCE(sum(f.amount_cents) FILTER (WHERE f.kind = 'shared'), 0) AS l30_shared,
               COALESCE(sum(f.units_good) FILTER (WHERE f.kind = 'revenue_base'), 0) AS l30_units,
               COALESCE(sum(f.hours), 0) AS l30_hours
          FROM pulse.fact_days f WHERE f.org_id = j.org_id AND f.job_id = j.id AND f.work_date > (now() AT TIME ZONE s.timezone)::date - 30
      ) l30
     WHERE j.org_id = ${ctx.orgId} AND j.id = ANY(${idList})`,
  );
  if (jobs.length === 0) return;
  const production = await rows<ProdRow>(
    executor,
    sql`SELECT job_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, units_good::text, units_scrap::text, units_rework::text, hours::text, overtime_hours::text,
               setup_hours::text, hours_confirmed, source, labor_cost_cents::text, shared_cents::text, base_revenue_cents::text, std_material_cents::text,
               std_scrap_cents::text, needs_rate
          FROM pulse.production_entries
         WHERE org_id = ${ctx.orgId} AND job_id = ANY(${idList}) AND deleted_at IS NULL
         ORDER BY job_id, work_date`,
  );
  const byJob = new Map<string, ProdRow[]>();
  for (const row of production) {
    const list = byJob.get(row.job_id);
    if (list) list.push(row);
    else byJob.set(row.job_id, [row]);
  }
  const thresholds = {
    marginFloorBp: settings.marginFloorBp,
    atRiskGapBp: settings.atRiskGapBp,
    laborWatchOverBp: settings.laborWatchOverBp,
    laborRiskOverBp: settings.laborRiskOverBp,
    productivityWatchBp: settings.productivityWatchBp,
    productivityRiskBp: settings.productivityRiskBp,
    materialWatchOverBp: settings.materialWatchOverBp,
    noEntryDays: settings.noEntryDays,
  };
  const values: (typeof jobStats.$inferInsert)[] = [];
  for (const job of jobs) {
    const entries = byJob.get(job.id) ?? [];
    const today = todayInZone(job.timezone);
    const prodLabor = entries.reduce((sum, row) => sum + B(row.labor_cost_cents), BigInt(0));
    const prodShared = entries.reduce((sum, row) => sum + B(row.shared_cents), BigInt(0));
    const prodBase = entries.reduce((sum, row) => sum + B(row.base_revenue_cents), BigInt(0));
    const stdMaterial = entries.reduce((sum, row) => sum + B(row.std_material_cents), BigInt(0));
    const stdScrap = entries.reduce((sum, row) => sum + B(row.std_scrap_cents), BigInt(0));
    const unitsGood = sumScaled(entries.map((row) => row.units_good), 3);
    const unitsScrap = sumScaled(entries.map((row) => row.units_scrap), 3);
    const unitsRework = sumScaled(entries.map((row) => row.units_rework), 3);
    const prodHours = sumScaled(entries.map((row) => row.hours), 2);
    const overtimeHours = sumScaled(entries.map((row) => row.overtime_hours), 2);
    const setupHours = sumScaled(entries.map((row) => row.setup_hours), 2);
    const hours = sumScaled([prodHours, job.vas_hours], 2);
    const standard = job.material_method === 'standard';
    const baseRevenue = prodBase + B(job.true_up_cents);
    const vasRevenue = B(job.vas_revenue_cents);
    const otherRevenue = B(job.other_revenue_cents);
    const revenue = baseRevenue + vasRevenue + otherRevenue;
    const labor = prodLabor + B(job.vas_labor_cents);
    const material = (standard ? stdMaterial : B(job.usage_cents)) + B(job.vas_material_cents);
    const scrap = standard ? stdScrap : B(job.usage_scrap_cents);
    const other = B(job.other_cost_cents);
    const shared = prodShared + B(job.vas_shared_cents);
    const cost = labor + material + other + shared;
    const profit = revenue - cost;

    const paceRows: PaceRow[] = entries.map((row) => ({
      workDate: row.work_date,
      unitsGood: row.units_good,
      hours: row.hours,
      setupHours: row.setup_hours,
      hoursConfirmed: row.hours_confirmed,
      source: row.source,
      laborCostCents: B(row.labor_cost_cents),
    }));
    const days = paceDays(paceRows);
    const overall = paceOverall(days);
    const window = lastEvidenceWindow(days);
    const evidenceDays = evidenceDayCount(days);
    const plan: PlanTotals | null = job.has_plan
      ? {
          units: job.plan_units,
          revenueCents: B(job.plan_revenue_cents),
          laborHours: job.plan_labor_hours,
          laborCents: B(job.plan_labor_cents),
          setupHours: job.plan_setup_hours,
          setupCents: B(job.plan_setup_cents),
          materialCents: B(job.plan_material_cents),
          otherCents: B(job.plan_other_cents),
          sharedCents: B(job.plan_shared_cents),
        }
      : null;
    const pace = targetPace({
      jobStandardUph: job.standard_uph,
      standards,
      query: { jobTypeId: job.job_type_id, clientId: job.client_id, laborClassId: job.default_labor_class_id, date: today },
      plan,
    });
    const target = pace.uph ?? (job.type_standard_uph ? Number(job.type_standard_uph) : null);
    const actual: ActualTotals = {
      unitsGood,
      hours,
      revenueCents: revenue,
      laborCents: labor,
      materialCents: material,
      scrapCents: scrap,
      otherCents: other,
      sharedCents: shared,
      setupHours,
      uph: overall.uph,
    };
    const status = job.status as 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled';
    const projection = projectJob({
      status,
      kind: job.kind as 'one_time' | 'ongoing',
      pricingModel: job.pricing_model as 'per_unit' | 'fixed' | 'hourly',
      plannedUnits: job.planned_units,
      plan,
      actual,
      serviceRevenueCents: vasRevenue,
      otherRevenueCents: otherRevenue,
      serviceCostCents: B(job.vas_labor_cents) + B(job.vas_material_cents) + B(job.vas_shared_cents),
      serviceMaterialCents: B(job.vas_material_cents),
      window: window.days > 0 ? { days: window.days, unitsGood: window.unitsGood, paceHours: window.paceHours, hours: window.hours, laborCostCents: window.laborCostCents } : null,
      evidenceDays,
      targetPace: target,
      unitPrice: job.unit_price,
      fixedPriceCents: job.fixed_price_cents === null ? null : B(job.fixed_price_cents),
      billRateCents: job.bill_rate_cents === null ? null : B(job.bill_rate_cents),
      materialMethod: job.material_method as 'standard' | 'actual',
      materialCostPerUnit: job.material_cost_per_unit,
      plannedMaterialLeftCents: !standard && job.usage_planned_rows > 0 ? B(job.usage_planned_left_cents) : null,
      fallbackRateCents: job.fallback_rate_cents !== null ? B(job.fallback_rate_cents) : settings.defaultLoadedRateCents !== null ? B(settings.defaultLoadedRateCents) : null,
      today,
      workingDays: settings.workingDays,
      last30: {
        revenueCents: B(job.l30_revenue),
        laborCents: B(job.l30_labor),
        materialCents: B(job.l30_material),
        otherCents: B(job.l30_other),
        sharedCents: B(job.l30_shared),
        unitsGood: job.l30_units,
        hours: job.l30_hours,
      },
    });
    const noPrice =
      (job.pricing_model === 'per_unit' && job.unit_price === null) ||
      (job.pricing_model === 'fixed' && job.fixed_price_cents === null) ||
      (job.pricing_model === 'hourly' && job.bill_rate_cents === null && entries.some((row) => Number(row.hours) > 0 && B(row.base_revenue_cents) === BigInt(0)));
    const needsRateCount = entries.filter((row) => row.needs_rate).length + job.vas_needs_rate;
    // D1: warehouse rows that still need crew hours, plus typed days with units and no hours at all.
    const missingDays = daysMissingHours(days) + days.filter((day) => !day.missingHours && Number(day.unitsGood) > 0 && Number(day.hours) === 0).length;
    const lastEntry = entries.length > 0 ? entries[entries.length - 1]!.work_date : null;
    const targetMargin = targetMarginBp({ job: job.target_margin_bp, jobType: job.type_margin_bp, client: job.client_margin_bp, orgDefault: settings.defaultTargetMarginBp });
    const risk = assessRisk({
      status,
      projection,
      actual,
      plan,
      plannedUnits: job.planned_units,
      targetMarginBp: targetMargin,
      thresholds,
      evidenceDays,
      window: window.days > 0 ? { uph: window.uph, paceHours: window.paceHours, unitsGood: window.unitsGood, days: window.days } : null,
      targetPace: target,
      unitPrice: job.unit_price,
      dueDate: job.due_date,
      today,
      workingDays: settings.workingDays,
      wmsShortage: job.wms_shortage,
      daysMissingHours: missingDays,
      noPrice,
      needsRate: needsRateCount > 0,
      workDaysSinceLastEntry: workDaysQuiet(job, lastEntry, today, settings.workingDays),
      entryDays30: job.l30_entry_days,
      hasMonthlyPlan: job.kind === 'ongoing' && job.has_plan,
    });
    const hasMode = projection.mode !== null;
    values.push({
      jobId: job.id,
      orgId: ctx.orgId,
      unitsGood,
      unitsScrap,
      unitsRework,
      hours,
      overtimeHours,
      setupHours,
      paceHours: fixed(overall.paceHours, 2) ?? '0',
      evidenceDays,
      revenueCents: revenue,
      baseRevenueCents: baseRevenue,
      vasRevenueCents: vasRevenue,
      otherRevenueCents: otherRevenue,
      billedCents: B(job.billed_cents),
      laborCents: labor,
      materialCents: material,
      scrapCents: scrap,
      otherCents: other,
      sharedCents: shared,
      costCents: cost,
      profitCents: profit,
      marginBp: marginBp(profit, revenue),
      marginBeforeSharedBp: marginBp(profit + shared, revenue),
      uph: fixed(overall.uph, 3),
      standardUph: fixed(target, 3),
      productivityBp: productivityBp(overall.uph, target),
      pctCompleteBp: projection.pctCompleteBp === null ? null : Math.min(projection.pctCompleteBp, 2_000_000_000),
      targetMarginBp: targetMargin,
      mode: projection.mode,
      costAtFinishCents: hasMode && projection.costKnown ? projection.costAtFinishCents : null,
      revenueAtFinishCents: hasMode ? projection.revenueAtFinishCents : null,
      projectedProfitCents: hasMode && projection.costKnown ? projection.projectedProfitCents : null,
      projectedMarginBp: hasMode ? projection.projectedMarginBp : null,
      projectedLaborHours: hasMode ? fixed(projection.projectedLaborHours, 2) : null,
      projectedFinishDate: hasMode ? projection.projectedFinishDate : null,
      paceUph: hasMode ? fixed(projection.paceUph, 3) : null,
      paceWeightBp: hasMode ? projection.paceWeightBp : null,
      confidence: hasMode ? projection.confidence : null,
      riskStatus: risk.status,
      riskReasons: risk.reasons.map((reason) => ({ rule: reason.rule, params: reason.params, impactCents: centsOut(reason.impactCents), nextStep: reason.nextStep })),
      needs: {
        laborMissing: risk.laborMissing,
        needsRate: needsRateCount,
        noPrice,
        daysMissingHours: missingDays,
        serviceNoPrice: job.vas_no_price,
        noPlan: !planHasCosts(plan),
        summary: risk.summary,
      },
      firstEntryDate: entries[0]?.work_date ?? null,
      lastEntryDate: lastEntry,
      entryCount: entries.length,
      computedAt: new Date(),
    });
  }
  const columns = getTableColumns(jobStats);
  const set: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns)) {
    if (key === 'jobId' || key === 'orgId') continue;
    set[key] = sql.raw(`excluded."${column.name}"`);
  }
  await executor.insert(jobStats).values(values).onConflictDoUpdate({ target: jobStats.jobId, set });
}
