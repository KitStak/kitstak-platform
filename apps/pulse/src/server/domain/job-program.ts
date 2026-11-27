/**
 * The program side of a job page (docs/programs/SPEC.md 6.1): the Program card (this month's
 * units and revenue from Pulse stamps, and whether they match Projects to the cent) and the By
 * variant table (units, revenue, labor, material, profit, margin and share per variant, with
 * footer rows so the totals equal the job's own numbers).
 *
 * Pulse money here is what Pulse stamped: `base_revenue_cents` of the build lines and the fee
 * rows the sync copied. The Projects side is the shared loader (`readProgramMonth`): output rows
 * that post to this job, plus every ledger row when this is the program's job. Equal means the
 * two apps show the same money.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { marginBp, ratioBp } from '@kitstak/programs-engine/money';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { cardVersionInForce, programMonth, programsReady, programVariants, readPrograms } from '@/server/integrations/programs';
import type { JobProgramDTO, JobProgramBlockDTO, JobProgramVariantDTO } from '@/lib/types';
import { moneyOut, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { getJobRowForReader } from './jobs';
import { jobProgramMirrors } from './program-feed';
import { pendingProgramEvents } from './sync-programs';

const B = (value: string | number | bigint | null | undefined): bigint => BigInt(value ?? 0);
const ZERO = BigInt(0);

interface VariantSum {
  program_id: string | null;
  variant_id: string | null;
  units: string;
  revenue: string;
  labor: string;
  shared: string;
  material: string;
  hours: string;
}

/** Plain decimal sum of quantity strings with 3 places, without floats. */
function addQty(a: string, b: string): string {
  const scale = (value: string): bigint => {
    const [whole = '0', part = ''] = value.split('.');
    const negative = whole.startsWith('-');
    const digits = BigInt(`${whole.replace('-', '')}${part.padEnd(3, '0').slice(0, 3)}`);
    return negative ? -digits : digits;
  };
  const total = scale(a) + scale(b);
  const negative = total < ZERO;
  const abs = negative ? -total : total;
  const text = abs.toString().padStart(4, '0');
  return `${negative ? '-' : ''}${text.slice(0, -3)}.${text.slice(-3)}`;
}

const lineKey = (programId: string | null, variantId: string | null): string => `${programId ?? '-'}|${variantId ?? '-'}`;
const toScaledInt = (value: string, places: number): bigint => {
  const [whole = '0', part = ''] = value.split('.');
  const negative = whole.startsWith('-');
  const digits = BigInt(`${whole.replace('-', '') || '0'}${part.padEnd(places, '0').slice(0, places)}`);
  return negative ? -digits : digits;
};
const toHundredths = (value: string): bigint => toScaledInt(value, 2);
const hundredthsText = (value: bigint): string => {
  const negative = value < ZERO;
  const text = (negative ? -value : value).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${text.slice(0, -2)}.${text.slice(-2)}`;
};

/** Splits `total` over `weights` so the parts add up exactly (largest remainder, ties to the first). */
function splitExact(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((acc, weight) => acc + weight, ZERO);
  if (sum <= ZERO) return weights.map(() => ZERO);
  const negative = total < ZERO;
  const abs = negative ? -total : total;
  const parts = weights.map((weight) => (abs * weight) / sum);
  let left = abs - parts.reduce((acc, part) => acc + part, ZERO);
  const order = weights
    .map((weight, index) => ({ index, rest: (abs * weight) % sum }))
    .sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of order) {
    if (left <= ZERO) break;
    parts[index] = parts[index]! + BigInt(1);
    left -= BigInt(1);
  }
  return negative ? parts.map((part) => -part) : parts;
}

/**
 * Labor cents and hours of hours only lines (typed days, prep time), spread over the build lines
 * of the same day by units. Days without build units keep their labor on the prep row.
 */
export function spreadByUnits(
  buildDays: readonly { work_date: string; program_id: string | null; variant_id: string | null; units: string }[],
  hoursOnlyDays: readonly { work_date: string; cents: string | number; hours: string }[],
): { byLine: Map<string, { cents: bigint; hundredths: bigint }>; cents: bigint; hundredths: bigint } {
  const byDay = new Map<string, { key: string; units: bigint }[]>();
  for (const row of buildDays) {
    const units = toScaledInt(row.units, 3);
    if (units <= ZERO) continue;
    const list = byDay.get(row.work_date) ?? [];
    list.push({ key: lineKey(row.program_id, row.variant_id), units });
    byDay.set(row.work_date, list);
  }
  const byLine = new Map<string, { cents: bigint; hundredths: bigint }>();
  let cents = ZERO;
  let hundredths = ZERO;
  for (const day of hoursOnlyDays) {
    const lines = byDay.get(day.work_date);
    if (!lines || lines.length === 0) continue;
    const dayCents = BigInt(String(day.cents).split('.')[0] ?? '0');
    const dayHours = toHundredths(day.hours);
    const weights = lines.map((line) => line.units);
    const centParts = splitExact(dayCents, weights);
    const hourParts = splitExact(dayHours, weights);
    lines.forEach((line, index) => {
      const have = byLine.get(line.key) ?? { cents: ZERO, hundredths: ZERO };
      byLine.set(line.key, { cents: have.cents + centParts[index]!, hundredths: have.hundredths + hourParts[index]! });
    });
    cents += dayCents;
    hundredths += dayHours;
  }
  return { byLine, cents, hundredths };
}

/** The Program card and By variant table of one job. `available: false` when no program feeds it. */
export const getJobProgram = scoped(async function getJobProgram(ctx: DomainContext, ref: string): Promise<JobProgramDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const job = await getJobRowForReader(ctx, ref, access);
  const money = access.seesMoney;
  const empty: JobProgramDTO = { available: false, jobId: job.id, month: null, blocks: [], totals: null, moneyHidden: !money, pendingSync: false, pendingSince: null, lastSyncAt: null, canSync: access.role === 'owner' || access.role === 'admin' || access.role === 'manager' };
  const mirrors = await jobProgramMirrors(db, ctx, job.id);
  if (mirrors.length === 0 || !(await programsReady(ctx))) return empty;

  const programIds = [...new Set(mirrors.map((mirror) => mirror.programId).filter((id): id is string => Boolean(id)))];
  const [programs, variants] = await Promise.all([readPrograms(ctx, programIds), programVariants(ctx, programIds)]);
  const programMirror = mirrors.find((mirror) => mirror.targetType === 'pm_program') ?? null;
  const [site] = await rows<{ timezone: string }>(db, sql`SELECT timezone FROM pulse.sites WHERE id = ${job.siteId}`);
  const zone = (programMirror && programs.get(programMirror.targetId)?.timezone) || site?.timezone || 'America/Chicago';
  const today = todayInZone(zone);
  const month = today.slice(0, 7);
  const from = `${month}-01`;

  // Lifetime sums per program and variant of the build lines on this job (the By variant table).
  const sums = await rows<VariantSum>(
    db,
    sql`SELECT e.pm_program_id::text AS program_id, e.pm_variant_id::text AS variant_id,
               COALESCE(sum(e.units_good), 0)::text AS units, COALESCE(sum(e.base_revenue_cents), 0)::text AS revenue,
               COALESCE(sum(e.labor_cost_cents), 0)::text AS labor, COALESCE(sum(e.shared_cents), 0)::text AS shared,
               COALESCE(sum(e.std_material_cents), 0)::text AS material, COALESCE(sum(e.hours), 0)::text AS hours
          FROM pulse.production_entries e JOIN pulse.jobs j ON j.id = e.job_id
         WHERE e.org_id = ${ctx.orgId} AND e.job_id = ${job.id} AND e.deleted_at IS NULL
           AND e.source = 'projects' AND e.source_ref LIKE 'pmb:%'
         GROUP BY 1, 2`,
  );
  // This month, Pulse side: build lines and fee rows by program.
  const month0 = await rows<{ program_id: string | null; units: string; revenue: string }>(
    db,
    sql`SELECT e.pm_program_id::text AS program_id, COALESCE(sum(e.units_good), 0)::text AS units, COALESCE(sum(e.base_revenue_cents), 0)::text AS revenue
          FROM pulse.production_entries e
         WHERE e.org_id = ${ctx.orgId} AND e.job_id = ${job.id} AND e.deleted_at IS NULL AND e.source = 'projects' AND e.source_ref LIKE 'pmb:%'
           AND e.work_date >= ${from}::date AND e.work_date < (${from}::date + interval '1 month')
         GROUP BY 1`,
  );
  const fees = await rows<{ program_id: string | null; month_cents: string; all_cents: string; rows: number }>(
    db,
    sql`SELECT r.pm_program_id::text AS program_id,
               COALESCE(sum(r.amount_cents) FILTER (WHERE r.revenue_date >= ${from}::date AND r.revenue_date < (${from}::date + interval '1 month')), 0)::text AS month_cents,
               COALESCE(sum(r.amount_cents), 0)::text AS all_cents, count(*)::int AS rows
          FROM pulse.revenue_entries r
         WHERE r.org_id = ${ctx.orgId} AND r.job_id = ${job.id} AND r.deleted_at IS NULL AND r.source = 'projects' AND r.source_ref LIKE 'pmf:%'
         GROUP BY 1`,
  );

  // Hours typed in Pulse (and program prep time) on a build day are the labor of that day's builds:
  // spread them over the day's build lines by units, so each variant carries real labor.
  const buildDays = await rows<{ work_date: string; program_id: string | null; variant_id: string | null; units: string }>(
    db,
    sql`SELECT to_char(e.work_date, 'YYYY-MM-DD') AS work_date, e.pm_program_id::text AS program_id, e.pm_variant_id::text AS variant_id,
               COALESCE(sum(e.units_good), 0)::text AS units
          FROM pulse.production_entries e
         WHERE e.org_id = ${ctx.orgId} AND e.job_id = ${job.id} AND e.deleted_at IS NULL AND e.source = 'projects' AND e.source_ref LIKE 'pmb:%'
         GROUP BY 1, 2, 3`,
  );
  const hoursOnlyDays = await rows<{ work_date: string; cents: string; hours: string }>(
    db,
    sql`SELECT to_char(work_date, 'YYYY-MM-DD') AS work_date, (COALESCE(sum(labor_cost_cents), 0) + COALESCE(sum(shared_cents), 0))::text AS cents,
               COALESCE(sum(hours), 0)::text AS hours
          FROM pulse.production_entries
         WHERE org_id = ${ctx.orgId} AND job_id = ${job.id} AND deleted_at IS NULL AND NOT (source = 'projects' AND COALESCE(source_ref, '') LIKE 'pmb:%')
           AND COALESCE(units_good, 0) = 0 AND COALESCE(base_revenue_cents, 0) = 0
         GROUP BY 1`,
  );
  const spread = spreadByUnits(buildDays, hoursOnlyDays);

  const blocks: JobProgramBlockDTO[] = [];
  let totalRevenue = ZERO;
  for (const programId of programIds) {
    const program = programs.get(programId);
    if (!program) continue;
    const isProgramJob = programMirror?.targetId === programId;
    const read = await programMonth(ctx, programId, month).catch(() => null);
    const projectsCents = read
      ? read.output.filter((row) => row.pulseJobId === job.id && (row.posting === 'program_job' || row.posting === 'build_job')).reduce((sum, row) => sum + B(row.revenueCents), ZERO) +
        (isProgramJob ? read.ledger.reduce((sum, row) => sum + row.cents, ZERO) : ZERO)
      : null;
    const projectsUnits = read ? read.output.filter((row) => row.pulseJobId === job.id).reduce((sum, row) => addQty(sum, row.qty), '0.000') : null;
    const pulseMonth = month0.find((row) => row.program_id === programId);
    const fee = fees.find((row) => row.program_id === programId);
    const pulseCents = B(pulseMonth?.revenue) + B(fee?.month_cents);
    const lines = sums.filter((row) => row.program_id === programId);
    const positionOf = (variantId: string | null): string => (variantId ? (variants.get(variantId)?.position ?? 'zzzz') : '~');
    const variantRows: JobProgramVariantDTO[] = [...lines]
      .sort((a, b) => {
        const left = positionOf(a.variant_id);
        const right = positionOf(b.variant_id);
        return left === right ? 0 : left < right ? -1 : 1;
      })
      .map((row) => {
        const revenue = B(row.revenue);
        const share = spread.byLine.get(lineKey(row.program_id, row.variant_id));
        const labor = B(row.labor) + B(row.shared) + (share?.cents ?? ZERO);
        const material = B(row.material);
        const profit = revenue - labor - material;
        const variant = row.variant_id ? variants.get(row.variant_id) : undefined;
        return {
          variantId: row.variant_id,
          name: row.variant_id ? (variant && !variant.deleted ? variant.name : 'Removed variant') : 'No variant',
          key: variant?.key ?? null,
          color: variant?.color ?? null,
          units: row.units,
          hours: hundredthsText(toHundredths(row.hours) + (share?.hundredths ?? ZERO)),
          revenueCents: moneyOut(money, revenue),
          laborCents: moneyOut(money, labor),
          materialCents: moneyOut(money, material),
          profitCents: moneyOut(money, profit),
          marginBp: money ? marginBp(profit, revenue) : null,
          shareBp: null,
        };
      });
    const blockRevenue = lines.reduce((sum, row) => sum + B(row.revenue), ZERO) + B(fee?.all_cents);
    totalRevenue += blockRevenue;
    const cardVersion = await cardVersionInForce(ctx, programId, today);
    blocks.push({
      programId,
      cardVersion,
      key: program.key,
      name: program.name,
      path: program.path,
      role: isProgramJob ? 'program_job' : 'build_job',
      unitSingular: program.unitSingular,
      unitPlural: program.unitPlural,
      timezone: program.timezone,
      monthUnits: pulseMonth?.units ?? '0.000',
      monthRevenueCents: moneyOut(money, pulseCents),
      projectsMonthUnits: projectsUnits,
      projectsMonthCents: projectsCents === null ? null : moneyOut(money, projectsCents),
      matches: projectsCents === null ? null : projectsCents === pulseCents,
      diffCents: projectsCents === null ? null : moneyOut(money, projectsCents - pulseCents),
      variants: variantRows,
      feesCents: moneyOut(money, B(fee?.all_cents)),
      feeRows: fee?.rows ?? 0,
      revenueCents: moneyOut(money, blockRevenue),
    });
  }
  // Share of the program revenue on this job, per variant row.
  const withShare = blocks.map((block) => ({
    ...block,
    variants: block.variants.map((row) => ({ ...row, shareBp: money && row.revenueCents !== null ? ratioBp(BigInt(row.revenueCents), totalRevenue) : null })),
  }));

  // Footer: everything else on the job, so the table adds up to the job's own numbers.
  const [stats] = await rows<{ revenue: string; labor: string; material: string; other: string; shared: string; units: string; hours: string }>(
    db,
    sql`SELECT COALESCE(revenue_cents, 0)::text AS revenue, COALESCE(labor_cents, 0)::text AS labor, COALESCE(material_cents, 0)::text AS material,
               COALESCE(other_cents, 0)::text AS other, COALESCE(shared_cents, 0)::text AS shared, COALESCE(units_good, 0)::text AS units, COALESCE(hours, 0)::text AS hours
          FROM pulse.job_stats WHERE job_id = ${job.id}`,
  );
  const [typed] = await rows<{ revenue: string; labor: string; shared: string; material: string; hours: string }>(
    db,
    sql`SELECT COALESCE(sum(base_revenue_cents), 0)::text AS revenue, COALESCE(sum(labor_cost_cents), 0)::text AS labor, COALESCE(sum(shared_cents), 0)::text AS shared,
               COALESCE(sum(std_material_cents), 0)::text AS material, COALESCE(sum(hours), 0)::text AS hours
          FROM pulse.production_entries
         WHERE org_id = ${ctx.orgId} AND job_id = ${job.id} AND deleted_at IS NULL AND NOT (source = 'projects' AND COALESCE(source_ref, '') LIKE 'pmb:%')`,
  );
  const jobRevenue = B(stats?.revenue);
  const jobCost = B(stats?.labor) + B(stats?.material) + B(stats?.other) + B(stats?.shared);
  const prepLabor = B(typed?.labor) + B(typed?.shared) - spread.cents;
  const prepMaterial = B(typed?.material);
  const variantsRevenue = blocks.reduce((sum, block) => sum + block.variants.reduce((inner, row) => inner + B(row.revenueCents ?? 0), ZERO), ZERO);
  const variantsLabor = blocks.reduce((sum, block) => sum + block.variants.reduce((inner, row) => inner + B(row.laborCents ?? 0), ZERO), ZERO);
  const variantsMaterial = blocks.reduce((sum, block) => sum + block.variants.reduce((inner, row) => inner + B(row.materialCents ?? 0), ZERO), ZERO);
  const feeTotal = blocks.reduce((sum, block) => sum + B(block.feesCents ?? 0), ZERO);
  const otherRevenue = jobRevenue - variantsRevenue - feeTotal - B(typed?.revenue);
  const otherCost = jobCost - variantsLabor - variantsMaterial - prepLabor - prepMaterial;
  const events = await pendingProgramEvents(db, ctx);
  const [state] = await rows<{ last_ok_at: string | null }>(
    db,
    sql`SELECT to_char(last_ok_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_ok_at FROM pulse.sync_state WHERE org_id = ${ctx.orgId} AND source = 'projects'`,
  );
  return {
    available: true,
    jobId: job.id,
    month,
    blocks: withShare,
    totals: {
      prepRevenueCents: moneyOut(money, B(typed?.revenue)),
      prepLaborCents: moneyOut(money, prepLabor),
      prepMaterialCents: moneyOut(money, prepMaterial),
      prepHours: hundredthsText(toHundredths(typed?.hours ?? '0') - spread.hundredths),
      otherRevenueCents: moneyOut(money, otherRevenue),
      otherCostCents: moneyOut(money, otherCost),
      revenueCents: moneyOut(money, jobRevenue),
      costCents: moneyOut(money, jobCost),
      profitCents: moneyOut(money, jobRevenue - jobCost),
      marginBp: money ? marginBp(jobRevenue - jobCost, jobRevenue) : null,
      units: stats?.units ?? '0',
    },
    moneyHidden: !money,
    pendingSync: events.pending > 0,
    pendingSince: events.since,
    lastSyncAt: state?.last_ok_at ?? null,
    canSync: empty.canSync,
  };
});
