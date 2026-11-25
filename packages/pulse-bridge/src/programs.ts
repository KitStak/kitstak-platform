/**
 * `@kitstak/pulse-bridge/programs`: the Pulse facts KitStak Programs needs from the shared
 * database (docs/programs/SPEC.md 6.1). Projects uses these to lock days that go to a Pulse job,
 * to price output at a job price, to check a job before a program or build bills to it, and to
 * show the Pulse side of a program (parity, All linked work).
 *
 * Like every bridge read, nothing here throws: when Pulse is not installed (or a read fails) the
 * answer is `{ available: false, reason }`, or an empty list for the price rows.
 */
import { sql } from 'drizzle-orm';
import type { IsoMonth, JobPriceRow } from '@kitstak/programs-engine/types';
import { canLinkJob, LINK_JOB_MESSAGES, type LinkJobRefusal } from '@kitstak/programs-engine/accrual';
import { resolvePulseAccess } from './access';
import { isUuid, pulseAvailability, query, queryOne, toInt, type BridgeExecutor } from './executor';
import type { PulseReader, PulseUnavailable } from './types';

const NOT_INSTALLED: PulseUnavailable = { available: false, reason: 'not_installed' };
const NO_ACCESS: PulseUnavailable = { available: false, reason: 'no_access' };
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type JobPricingModel = 'per_unit' | 'fixed' | 'hourly';
export type JobKind = 'one_time' | 'ongoing';

export interface ProgramJobFacts {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly status: string;
  /** The job exists and is not deleted. */
  readonly live: boolean;
  readonly kind: JobKind;
  readonly pricingModel: JobPricingModel;
  readonly unitLabel: string;
  readonly siteId: string | null;
  readonly siteTimezone: string | null;
  /** A WMS work order is linked to the job, so it gets units from WMS. */
  readonly feedsFromWorkOrder: boolean;
  /** People typed units on the job in a month that is still open. */
  readonly hasTypedUnits: boolean;
  /** The program that already bills to this job (a `bills_to` edge), if any. */
  readonly programId: string | null;
  readonly clientId: string | null;
}

export interface JobPick {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly status: string;
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly unitLabel: string;
  readonly pricingModel: JobPricingModel;
  readonly kind: JobKind;
  /** For `bills_to` searches: why the job cannot take the link, in UI copy. */
  readonly refusal: { readonly reason: LinkJobRefusal; readonly message: string } | null;
}

export interface LinkedJobMoney {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly revenueCents: string;
  readonly costCents: string;
  readonly profitCents: string;
  readonly marginBp: number | null;
}

export interface ProgramPulseVariant {
  readonly variantId: string | null;
  readonly units: string;
  readonly revenueCents: string;
  readonly laborCents: string;
  readonly materialCents: string;
  readonly profitCents: string;
  readonly marginBp: number | null;
}

export interface ProgramPulseJob {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly status: string;
  readonly unitLabel: string;
  readonly path: string;
}

export interface ProgramPulse {
  readonly available: true;
  readonly moneyHidden: boolean;
  readonly job: ProgramPulseJob | null;
  /** What Pulse stamped for the program in the month (`pmb` rows plus `pmf` fees). Zero strings when money is hidden. */
  readonly stamped: {
    readonly perUnitCents: string;
    readonly feesCents: string;
    readonly totalCents: string;
    readonly byVariant: readonly ProgramPulseVariant[];
  };
  /**
   * The bills-to job's own totals to date, the numbers its Pulse job page shows ("Revenue earned",
   * "Cost so far"): from `pulse.job_stats`, cost is labor, material, other and shared cost. Null
   * with no job, no stats yet, or money hidden.
   */
  readonly jobTotals: { readonly revenueCents: string; readonly costCents: string; readonly profitCents: string; readonly marginBp: number | null } | null;
  readonly pendingSync: boolean;
  readonly pendingSince: string | null;
  readonly lastSyncAt: string | null;
}

/** Month `YYYY-MM` to its first day, or null. */
function monthStart(month: string): string | null {
  return ISO_MONTH.test(month) ? `${month}-01` : null;
}

async function hasTable(db: BridgeExecutor, name: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(db, sql`select to_regclass(${name}) is not null as ok`);
  return row?.ok === true;
}

function marginOf(profit: bigint, revenue: bigint): number | null {
  if (revenue <= BigInt(0)) return null;
  const bp = (profit * BigInt(20000) + (profit >= BigInt(0) ? revenue : -revenue)) / (revenue * BigInt(2));
  const n = Number(bp);
  return Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000 ? n : null;
}

const big = (value: unknown): bigint => {
  if (value === null || value === undefined) return BigInt(0);
  try {
    return BigInt(String(value).split('.')[0] ?? '0');
  } catch {
    return BigInt(0);
  }
};

/**
 * The months closed in Pulse for the org (`pulse.periods` with status `closed`), as `YYYY-MM`.
 * The set, not a high water mark: a reopened September before a closed October is open.
 */
export async function getClosedMonths(db: BridgeExecutor, orgId: string): Promise<{ available: true; months: IsoMonth[] } | PulseUnavailable> {
  try {
    if (!isUuid(orgId)) return NO_ACCESS;
    if (!(await hasTable(db, 'pulse.periods'))) return NOT_INSTALLED;
    const rows = await query<{ month: string }>(
      db,
      sql`select to_char(period_month, 'YYYY-MM') as month from pulse.periods
           where org_id = ${orgId}::uuid and status = 'closed' order by period_month`,
    );
    return { available: true, months: rows.map((row) => row.month) };
  } catch {
    return NOT_INSTALLED;
  }
}

interface FactsRow {
  id: string;
  number: string;
  name: string;
  status: string;
  live: boolean;
  kind: string;
  pricing_model: string;
  unit_label: string | null;
  site_id: string | null;
  site_timezone: string | null;
  feeds_from_work_order: boolean;
  has_typed_units: boolean;
  client_id: string | null;
}

/** The facts `canLinkJob` needs about one job, live or deleted. `job: null` when it does not exist. */
export async function getJobFacts(
  db: BridgeExecutor,
  who: PulseReader,
  jobId: string,
): Promise<{ available: true; job: ProgramJobFacts | null } | PulseUnavailable> {
  try {
    if (!isUuid(who.orgId)) return NO_ACCESS;
    if (!(await pulseAvailability(db)).installed) return NOT_INSTALLED;
    if (!isUuid(jobId)) return { available: true, job: null };
    const row = await queryOne<FactsRow>(
      db,
      sql`select j.id::text as id, j.number, j.name, j.status, (j.deleted_at is null) as live, j.kind, j.pricing_model,
                 j.unit_label, j.site_id::text as site_id, s.timezone as site_timezone, j.client_id::text as client_id,
                 exists (select 1 from pulse.job_links l where l.job_id = j.id and l.target_type = 'wms_work_order') as feeds_from_work_order,
                 exists (select 1 from pulse.production_entries e
                          where e.job_id = j.id and e.deleted_at is null and e.source <> 'projects' and e.units_good > 0
                            and not exists (select 1 from pulse.periods p where p.org_id = j.org_id and p.status = 'closed'
                                             and p.period_month = date_trunc('month', e.work_date)::date)) as has_typed_units
            from pulse.jobs j
            left join pulse.sites s on s.id = j.site_id
           where j.org_id = ${who.orgId}::uuid and j.id = ${jobId}::uuid`,
    );
    if (!row) return { available: true, job: null };
    let programId: string | null = null;
    if (await hasTable(db, 'core.record_links')) {
      const edge = await queryOne<{ id: string }>(
        db,
        sql`select from_id as id from core.record_links
             where org_id = ${who.orgId}::uuid and relation = 'bills_to' and from_type = 'pm_program'
               and to_type = 'pulse_job' and to_id = ${jobId} limit 1`,
      );
      programId = edge?.id ?? null;
    }
    return {
      available: true,
      job: {
        id: row.id,
        number: row.number,
        name: row.name,
        status: row.status,
        live: row.live === true,
        kind: row.kind === 'ongoing' ? 'ongoing' : 'one_time',
        pricingModel: row.pricing_model === 'fixed' || row.pricing_model === 'hourly' ? row.pricing_model : 'per_unit',
        unitLabel: row.unit_label || 'units',
        siteId: row.site_id,
        siteTimezone: row.site_timezone,
        feedsFromWorkOrder: row.feeds_from_work_order === true,
        hasTypedUnits: row.has_typed_units === true,
        programId,
        clientId: row.client_id,
      },
    };
  } catch {
    return NOT_INSTALLED;
  }
}

/** The job's dated unit prices, oldest first (`pulse.job_prices`). `[]` when Pulse is away. */
export async function getJobPriceRows(db: BridgeExecutor, orgId: string, jobId: string): Promise<JobPriceRow[]> {
  try {
    if (!isUuid(orgId) || !isUuid(jobId)) return [];
    if (!(await hasTable(db, 'pulse.job_prices'))) return [];
    const rows = await query<{ effective_from: string; unit_price: string | null }>(
      db,
      sql`select effective_from::text as effective_from, unit_price::text as unit_price
            from pulse.job_prices
           where org_id = ${orgId}::uuid and job_id = ${jobId}::uuid
           order by effective_from`,
    );
    return rows.map((row) => ({ effectiveFrom: row.effective_from.slice(0, 10), unitPrice: row.unit_price }));
  } catch {
    return [];
  }
}

/** Month money of a few jobs ("All linked work"), from the rows Pulse stamped in the month. */
export async function getJobsSummary(
  db: BridgeExecutor,
  who: PulseReader,
  input: { readonly jobIds: readonly string[]; readonly month: IsoMonth },
): Promise<{ available: true; moneyHidden: boolean; jobs: LinkedJobMoney[] } | PulseUnavailable> {
  try {
    if (!isUuid(who.orgId) || !isUuid(who.userId)) return NO_ACCESS;
    if (!(await pulseAvailability(db)).installed) return NOT_INSTALLED;
    const access = await resolvePulseAccess(db, who);
    if (access.role === 'none') return NO_ACCESS;
    const ids = [...new Set(input.jobIds.filter(isUuid))].slice(0, 100);
    const from = monthStart(input.month);
    if (ids.length === 0 || !from) return { available: true, moneyHidden: !access.seesMoney, jobs: [] };
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const rows = await query<{ id: string; number: string; name: string; production: string | null; labor: string | null; material: string | null; revenue: string | null; costs: string | null }>(
      db,
      sql`select j.id::text as id, j.number, j.name,
                 (select coalesce(sum(e.base_revenue_cents), 0)::text from pulse.production_entries e
                   where e.job_id = j.id and e.deleted_at is null and e.work_date >= ${from}::date and e.work_date < (${from}::date + interval '1 month')) as production,
                 (select coalesce(sum(e.labor_cost_cents + e.overhead_cents + e.shared_cents), 0)::text from pulse.production_entries e
                   where e.job_id = j.id and e.deleted_at is null and e.work_date >= ${from}::date and e.work_date < (${from}::date + interval '1 month')) as labor,
                 (select coalesce(sum(e.std_material_cents + e.std_scrap_cents), 0)::text from pulse.production_entries e
                   where e.job_id = j.id and e.deleted_at is null and e.work_date >= ${from}::date and e.work_date < (${from}::date + interval '1 month')) as material,
                 (select coalesce(sum(r.amount_cents), 0)::text from pulse.revenue_entries r
                   where r.job_id = j.id and r.deleted_at is null and r.revenue_date >= ${from}::date and r.revenue_date < (${from}::date + interval '1 month')) as revenue,
                 (select coalesce(sum(c.amount_cents), 0)::text from pulse.cost_entries c
                   where c.job_id = j.id and c.deleted_at is null and c.cost_date >= ${from}::date and c.cost_date < (${from}::date + interval '1 month')) as costs
            from pulse.jobs j
           where j.org_id = ${who.orgId}::uuid and j.deleted_at is null and j.id in (${idList})
           order by j.number`,
    ).catch(() =>
      query<{ id: string; number: string; name: string; production: string | null; labor: string | null; material: string | null; revenue: string | null; costs: string | null }>(
        db,
        sql`select j.id::text as id, j.number, j.name, coalesce(st.revenue_cents, 0)::text as production, coalesce(st.cost_cents, 0)::text as labor,
                   '0' as material, '0' as revenue, '0' as costs
              from pulse.jobs j left join pulse.job_stats st on st.job_id = j.id
             where j.org_id = ${who.orgId}::uuid and j.deleted_at is null and j.id in (${idList})
             order by j.number`,
      ),
    );
    const money = access.seesMoney;
    return {
      available: true,
      moneyHidden: !money,
      jobs: rows.map((row) => {
        const revenue = big(row.production) + big(row.revenue);
        const cost = big(row.labor) + big(row.material) + big(row.costs);
        const profit = revenue - cost;
        return {
          id: row.id,
          number: row.number,
          name: row.name,
          revenueCents: money ? revenue.toString() : '0',
          costCents: money ? cost.toString() : '0',
          profitCents: money ? profit.toString() : '0',
          marginBp: money ? marginOf(profit, revenue) : null,
        };
      }),
    };
  } catch {
    return NOT_INSTALLED;
  }
}

/** Jobs for the "Link a Pulse job" picker. For `bills_to`, each job says why it cannot take the link. */
export async function searchProgramJobs(
  db: BridgeExecutor,
  who: PulseReader,
  input: { readonly q?: string; readonly clientId?: string | null; readonly purpose: 'bills_to' | 'related'; readonly target?: { readonly kind: 'program' | 'build'; readonly programId: string | null } },
): Promise<{ available: true; jobs: JobPick[] } | PulseUnavailable> {
  try {
    if (!isUuid(who.orgId) || !isUuid(who.userId)) return NO_ACCESS;
    if (!(await pulseAvailability(db)).installed) return NOT_INSTALLED;
    const term = (input.q ?? '').trim().slice(0, 80);
    const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const client = input.clientId && isUuid(input.clientId) ? sql` and j.client_id = ${input.clientId}::uuid` : sql``;
    const search = term ? sql` and (j.number ilike ${like} or j.name ilike ${like} or c.name ilike ${like})` : sql``;
    const rows = await query<{ id: string; number: string; name: string; status: string; client_id: string | null; client_name: string | null; unit_label: string | null; pricing_model: string; kind: string }>(
      db,
      sql`select j.id::text as id, j.number, j.name, j.status, j.client_id::text as client_id, c.name as client_name,
                 j.unit_label, j.pricing_model, j.kind
            from pulse.jobs j
            left join pulse.clients c on c.id = j.client_id
           where j.org_id = ${who.orgId}::uuid and j.deleted_at is null and j.archived_at is null
                 and j.status not in ('completed', 'cancelled')${client}${search}
           order by j.number desc limit 25`,
    );
    const jobs: JobPick[] = [];
    for (const row of rows) {
      let refusal: JobPick['refusal'] = null;
      if (input.purpose === 'bills_to') {
        const facts = await getJobFacts(db, who, row.id);
        if (facts.available && facts.job) {
          const verdict = canLinkJob(facts.job, input.target ?? { kind: 'program', programId: null });
          if (!verdict.ok) refusal = { reason: verdict.reason, message: LINK_JOB_MESSAGES[verdict.reason] };
        }
      }
      jobs.push({
        id: row.id,
        number: row.number,
        name: row.name,
        status: row.status,
        clientId: row.client_id,
        clientName: row.client_name,
        unitLabel: row.unit_label || 'units',
        pricingModel: row.pricing_model === 'fixed' || row.pricing_model === 'hourly' ? row.pricing_model : 'per_unit',
        kind: row.kind === 'ongoing' ? 'ongoing' : 'one_time',
        refusal,
      });
    }
    return { available: true, jobs };
  } catch {
    return NOT_INSTALLED;
  }
}

/** The Pulse side of one program for a month: its job, what Pulse stamped, and whether sync is behind. */
export async function getProgramPulse(
  db: BridgeExecutor,
  who: PulseReader,
  input: { readonly programId: string; readonly month: IsoMonth },
): Promise<ProgramPulse | PulseUnavailable> {
  try {
    if (!isUuid(who.orgId) || !isUuid(who.userId) || !isUuid(input.programId)) return NO_ACCESS;
    const availability = await pulseAvailability(db);
    if (!availability.installed) return NOT_INSTALLED;
    const access = await resolvePulseAccess(db, who);
    if (access.role === 'none') return NO_ACCESS;
    const from = monthStart(input.month);
    if (!from) return NO_ACCESS;
    let job: ProgramPulseJob | null = null;
    if (await hasTable(db, 'core.record_links')) {
      const row = await queryOne<{ id: string; number: string; name: string; status: string; unit_label: string | null }>(
        db,
        sql`select j.id::text as id, j.number, j.name, j.status, j.unit_label
              from core.record_links l
              join pulse.jobs j on j.id::text = l.to_id and j.org_id = l.org_id and j.deleted_at is null
             where l.org_id = ${who.orgId}::uuid and l.relation = 'bills_to' and l.from_type = 'pm_program'
               and l.from_id = ${input.programId} and l.to_type = 'pulse_job'
             limit 1`,
      );
      if (row) job = { id: row.id, number: row.number, name: row.name, status: row.status, unitLabel: row.unit_label || 'units', path: `/jobs/${encodeURIComponent(row.number)}` };
    }
    const hasProgramColumns = await queryOne<{ ok: boolean }>(
      db,
      sql`select exists (select 1 from information_schema.columns where table_schema = 'pulse' and table_name = 'production_entries' and column_name = 'pm_program_id') as ok`,
    );
    let perUnit = BigInt(0);
    let fees = BigInt(0);
    const byVariant: ProgramPulseVariant[] = [];
    if (hasProgramColumns?.ok === true) {
      const variants = await query<{ variant_id: string | null; units: string; revenue: string; labor: string; material: string }>(
        db,
        sql`select e.pm_variant_id::text as variant_id, coalesce(sum(e.units_good), 0)::text as units,
                   coalesce(sum(e.base_revenue_cents), 0)::text as revenue,
                   coalesce(sum(e.labor_cost_cents + e.overhead_cents), 0)::text as labor,
                   coalesce(sum(e.std_material_cents + e.std_scrap_cents), 0)::text as material
              from pulse.production_entries e
             where e.org_id = ${who.orgId}::uuid and e.pm_program_id = ${input.programId}::uuid and e.deleted_at is null
               and e.source = 'projects' and e.work_date >= ${from}::date and e.work_date < (${from}::date + interval '1 month')
             group by e.pm_variant_id
             order by 3 desc`,
      );
      for (const row of variants) {
        const revenue = big(row.revenue);
        const labor = big(row.labor);
        const material = big(row.material);
        perUnit += revenue;
        const profit = revenue - labor - material;
        byVariant.push({
          variantId: row.variant_id,
          units: row.units,
          revenueCents: access.seesMoney ? revenue.toString() : '0',
          laborCents: access.seesMoney ? labor.toString() : '0',
          materialCents: access.seesMoney ? material.toString() : '0',
          profitCents: access.seesMoney ? profit.toString() : '0',
          marginBp: access.seesMoney ? marginOf(profit, revenue) : null,
        });
      }
      const feeRow = await queryOne<{ total: string | null }>(
        db,
        sql`select coalesce(sum(r.amount_cents), 0)::text as total from pulse.revenue_entries r
             where r.org_id = ${who.orgId}::uuid and r.pm_program_id = ${input.programId}::uuid and r.deleted_at is null
               and r.source = 'projects' and r.revenue_date >= ${from}::date and r.revenue_date < (${from}::date + interval '1 month')`,
      );
      fees = big(feeRow?.total);
    }
    let pendingSince: string | null = null;
    let lastSyncAt: string | null = null;
    if (availability.events) {
      const pending = await queryOne<{ since: string | null; last: string | null }>(
        db,
        sql`select (select min(created_at)::text from pulse.bridge_events
                     where org_id = ${who.orgId}::uuid and kind = 'pm_program_changed' and target_id = ${input.programId} and processed_at is null) as since,
                   (select max(processed_at)::text from pulse.bridge_events
                     where org_id = ${who.orgId}::uuid and kind = 'pm_program_changed' and target_id = ${input.programId} and processed_at is not null) as last`,
      ).catch(() => undefined);
      pendingSince = pending?.since ?? null;
      lastSyncAt = pending?.last ?? null;
    }
    const money = access.seesMoney;
    let jobTotals: ProgramPulse['jobTotals'] = null;
    if (job && money && (await hasTable(db, 'pulse.job_stats'))) {
      const stats = await queryOne<{ revenue: string; cost: string }>(
        db,
        sql`select coalesce(revenue_cents, 0)::text as revenue,
                   (coalesce(labor_cents, 0) + coalesce(material_cents, 0) + coalesce(other_cents, 0) + coalesce(shared_cents, 0))::text as cost
              from pulse.job_stats where job_id = ${job.id}::uuid and org_id = ${who.orgId}::uuid`,
      ).catch(() => undefined);
      if (stats) {
        const revenue = big(stats.revenue);
        const cost = big(stats.cost);
        jobTotals = { revenueCents: revenue.toString(), costCents: cost.toString(), profitCents: (revenue - cost).toString(), marginBp: marginOf(revenue - cost, revenue) };
      }
    }
    return {
      available: true,
      moneyHidden: !money,
      job,
      jobTotals,
      stamped: {
        perUnitCents: money ? perUnit.toString() : '0',
        feesCents: money ? fees.toString() : '0',
        totalCents: money ? (perUnit + fees).toString() : '0',
        byVariant,
      },
      pendingSync: pendingSince !== null,
      pendingSince,
      lastSyncAt,
    };
  } catch {
    return NOT_INSTALLED;
  }
}

/** Exposed for tests: margin in basis points, half away from zero, null without revenue. */
export const marginBpOf = (profitCents: string | number, revenueCents: string | number): number | null =>
  marginOf(big(profitCents), big(revenueCents));

/** Exposed for tests: a whole number from a count column. */
export const countOf = (value: unknown): number => toInt(value) ?? 0;
