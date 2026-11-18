/**
 * Reconciliation proof: the SQL stamps and rollups of the domain layer and the pure formulas in
 * `@/lib/profit` give the same answer to the cent.
 *
 * The suite seeds a throwaway organization with the minimal seed, then, for every seeded job,
 * rebuilds the whole profit summary from the raw typed inputs (hours, units, rates, prices, usage)
 * with nothing but the pure library, and compares it with three SQL answers: the stamps on the
 * stream rows, the `fact_days` rollup, and the cached `job_stats` row (plus the DTO of `getJobProfit`).
 * Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { seedMinimal } from '@/server/db/seed/minimal';
import { ZERO, mulQuantityPrice, type Cents } from '@/lib/money';
import {
  actualMaterial,
  companyBridge,
  fixedRevenueStamps,
  fixedTrueUp,
  hourlyRevenue,
  laborCost,
  perUnitRevenue,
  poolPeriod,
  priceFor,
  profitSummary,
  rateFor,
  serviceAmount,
  sharedGap,
  spreadSharedCost,
  standardMaterial,
  sumFacts,
  type FactKind,
  type LaborRateInput,
  type MoneyBuckets,
  type PartsOwner,
  type RateRow,
  type SharedCostRule,
  type SharedSpread,
} from '@/lib/profit';
import type { DomainContext } from './_shared';
import { getCompanyBridge, getJobProfit, getProfit } from './test-exports';

const ready = await databaseReady();
const big = (value: string | number | null | undefined): bigint => BigInt(value ?? 0);

interface RateDbRow extends RateRow, LaborRateInput {
  readonly billRateCents: number | null;
}
interface EntryRow {
  id: string;
  site_id: string;
  job_id: string | null;
  work_date: string;
  shift: string | null;
  labor_class_id: string | null;
  class_code: string | null;
  units_good: string;
  units_scrap: string;
  hours: string;
  overtime_hours: string;
  rate_cents: number | null;
  overtime_rate_cents: number | null;
  labor_cost_cents: string;
  overhead_cents: string;
  gross_pay_cents: string;
  shared_cents: string;
  base_revenue_cents: string;
  std_material_cents: string;
  std_scrap_cents: string;
  needs_rate: boolean;
}
interface JobRow {
  id: string;
  name: string;
  pricing_model: 'per_unit' | 'fixed' | 'hourly';
  material_method: 'standard' | 'actual' | 'none';
  planned_units: string;
  fixed_price_cents: string | null;
  status: string;
  parts_owner: PartsOwner | null;
  client_parts_owner: PartsOwner | null;
}

describe.skipIf(!ready)('SQL rollups equal the pure profit library (seeded org)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let jobs: JobRow[];
  let rates: RateDbRow[];
  let settings: { shared_cost_rule: SharedCostRule; shared_spread: SharedSpread; week_start: number; shared_pct_bp: number; default_loaded_rate_cents: number | null; default_overtime_multiplier: string; default_parts_owner: PartsOwner };
  let defaultClassId: string | null;
  let production: EntryRow[];
  /** Pure answers, keyed by row id. */
  const pureShared = new Map<string, Cents>();
  const pureBuckets = new Map<string, MoneyBuckets & { billedCents: Cents; unitsGood: number }>();

  const rateOf = (row: { labor_class_id: string | null; site_id: string; work_date: string }) =>
    rateFor(rates, { laborClassId: row.labor_class_id, siteId: row.site_id, workDate: row.work_date }, {
      defaultLaborClassId: defaultClassId,
      defaultLoadedRateCents: settings.default_loaded_rate_cents,
      defaultOvertimeMultiplier: settings.default_overtime_multiplier,
    });

  beforeAll(async () => {
    org = await createTestOrg('pulse-reconcile');
    owner = await org.member('owner', 'Rita Reconcile');
    await seedMinimal(owner);

    [settings] = (await org.query(
      `select shared_cost_rule, shared_spread, week_start, shared_pct_bp, default_loaded_rate_cents, default_overtime_multiplier::text, default_parts_owner
         from pulse.settings where org_id = $1`,
      [org.orgId],
    )) as [typeof settings];
    defaultClassId = ((await org.query<{ id: string }>(`select id from pulse.labor_classes where org_id = $1 and is_default and deleted_at is null`, [org.orgId]))[0]?.id ?? null) as string | null;
    rates = (
      await org.query<{ labor_class_id: string; site_id: string | null; effective_from: string; wage_cents: number; payroll_tax_bp: number; benefits_bp: number; other_burden_bp: number; overhead_per_hour_cents: number; overtime_multiplier: string; bill_rate_cents: number | null }>(
        `select labor_class_id, site_id, to_char(effective_from, 'YYYY-MM-DD') as effective_from, wage_cents, payroll_tax_bp, benefits_bp, other_burden_bp,
                overhead_per_hour_cents, overtime_multiplier::text, bill_rate_cents
           from pulse.labor_rates where org_id = $1 and deleted_at is null`,
        [org.orgId],
      )
    ).map((row) => ({
      laborClassId: row.labor_class_id,
      siteId: row.site_id,
      effectiveFrom: row.effective_from,
      wageCents: row.wage_cents,
      payrollTaxBp: row.payroll_tax_bp,
      benefitsBp: row.benefits_bp,
      otherBurdenBp: row.other_burden_bp,
      overheadPerHourCents: row.overhead_per_hour_cents,
      overtimeMultiplier: row.overtime_multiplier,
      billRateCents: row.bill_rate_cents,
    }));
    jobs = await org.query<JobRow>(
      `select j.id, j.name, j.pricing_model, j.material_method, j.planned_units::text, j.fixed_price_cents::text, j.status, j.parts_owner, c.parts_owner as client_parts_owner
         from pulse.jobs j join pulse.clients c on c.id = j.client_id where j.org_id = $1 and j.deleted_at is null order by j.name`,
      [org.orgId],
    );
    production = await org.query<EntryRow>(
      `select p.id, p.site_id, p.job_id, to_char(p.work_date, 'YYYY-MM-DD') as work_date, p.shift, p.labor_class_id, lc.code as class_code,
              p.units_good::text, p.units_scrap::text, p.hours::text, p.overtime_hours::text, p.rate_cents, p.overtime_rate_cents,
              p.labor_cost_cents::text, p.overhead_cents::text, p.gross_pay_cents::text, p.shared_cents::text, p.base_revenue_cents::text,
              p.std_material_cents::text, p.std_scrap_cents::text, p.needs_rate
         from pulse.production_entries p left join pulse.labor_classes lc on lc.id = p.labor_class_id
        where p.org_id = $1 and p.deleted_at is null order by p.work_date, p.id`,
      [org.orgId],
    );
  }, 180_000);

  afterAll(async () => {
    if (org) await org.destroy();
  }, 60_000);

  it('seeded enough to be a real test', () => {
    expect(jobs.length).toBeGreaterThanOrEqual(5);
    expect(production.length).toBeGreaterThan(30);
    expect(production.some((row) => Number(row.overtime_hours) > 0)).toBe(true);
    expect(production.some((row) => Number(row.units_scrap) > 0)).toBe(true);
    expect(jobs.some((job) => job.pricing_model === 'fixed')).toBe(true);
  });

  it('every production stamp equals laborCost, perUnitRevenue, fixedRevenueStamps and standardMaterial', async () => {
    const prices = await org.query<{ job_id: string; effective_from: string; unit_price: string | null; bill_rate_cents: number | null; material_cost_per_unit: string | null }>(
      `select job_id, to_char(effective_from, 'YYYY-MM-DD') as effective_from, unit_price::text, bill_rate_cents, material_cost_per_unit::text from pulse.job_prices where org_id = $1`,
      [org.orgId],
    );
    for (const job of jobs) {
      const entries = production.filter((row) => row.job_id === job.id);
      const jobPrices = prices.filter((row) => row.job_id === job.id).map((row) => ({ ...row, effectiveFrom: row.effective_from }));
      const fixed =
        job.pricing_model === 'fixed'
          ? new Map(fixedRevenueStamps(entries.map((row) => ({ id: row.id, workDate: row.work_date, shift: row.shift, laborClassCode: row.class_code, unitsGood: row.units_good })), job.fixed_price_cents, job.planned_units).map((stamp) => [stamp.id, stamp.stampCents]))
          : null;
      for (const row of entries) {
        const where = `${job.name} ${row.work_date} ${row.class_code}`;
        const choice = rateOf(row);
        const stamp = laborCost({ hours: row.hours, overtimeHours: row.overtime_hours, rate: choice.rate });
        expect(big(row.labor_cost_cents), `labor ${where}`).toBe(stamp.laborCostCents);
        expect(big(row.overhead_cents), `overhead ${where}`).toBe(stamp.overheadCents);
        expect(big(row.gross_pay_cents), `gross pay ${where}`).toBe(stamp.grossPayCents);
        expect(big(row.rate_cents), `rate ${where}`).toBe(stamp.rateCents ?? ZERO);
        expect(big(row.overtime_rate_cents), `overtime rate ${where}`).toBe(stamp.overtimeRateCents ?? ZERO);
        expect(row.needs_rate, `needs rate ${where}`).toBe(stamp.needsRate);

        const price = priceFor(jobPrices, row.work_date);
        const revenue =
          job.pricing_model === 'per_unit'
            ? perUnitRevenue(row.units_good, price?.unit_price)
            : job.pricing_model === 'hourly'
              ? hourlyRevenue(row.hours, price?.bill_rate_cents ?? choice.row?.billRateCents ?? null)
              : (fixed?.get(row.id) ?? ZERO);
        expect(big(row.base_revenue_cents), `base revenue ${where}`).toBe(revenue);

        const material = job.material_method === 'standard' ? standardMaterial({ unitsGood: row.units_good, unitsScrap: row.units_scrap, materialCostPerUnit: price?.material_cost_per_unit }) : { stdMaterialCents: ZERO, stdScrapCents: ZERO };
        expect(big(row.std_material_cents), `standard material ${where}`).toBe(material.stdMaterialCents);
        expect(big(row.std_scrap_cents), `standard scrap ${where}`).toBe(material.stdScrapCents);
      }
    }
  });

  it('time not on a job is spread exactly like spreadSharedCost, pool by pool', async () => {
    const indirect = await org.query<{ id: string; site_id: string; work_date: string; labor_class_id: string | null; hours: string; overtime_hours: string; cost_cents: string }>(
      `select id, site_id, to_char(work_date, 'YYYY-MM-DD') as work_date, labor_class_id, hours::text, overtime_hours::text, cost_cents::text
         from pulse.indirect_entries where org_id = $1 and deleted_at is null`,
      [org.orgId],
    );
    const vas = await org.query<{ id: string; site_id: string; work_date: string; hours: string; labor_cost_cents: string; shared_cents: string }>(
      `select id, site_id, to_char(work_date, 'YYYY-MM-DD') as work_date, hours::text, labor_cost_cents::text, shared_cents::text from pulse.vas_entries where org_id = $1 and deleted_at is null`,
      [org.orgId],
    );
    const missing = await org.query<{ site_id: string; work_date: string; missing_cents: string }>(
      `select site_id, to_char(work_date, 'YYYY-MM-DD') as work_date, missing_cents::text from pulse.company_days where org_id = $1`,
      [org.orgId],
    );
    // The stamped cost of each indirect row is laborCost too.
    for (const row of indirect) expect(big(row.cost_cents), `indirect ${row.work_date}`).toBe(laborCost({ hours: row.hours, overtimeHours: row.overtime_hours, rate: rateOf(row).rate }).laborCostCents);

    const poolKey = (siteId: string, date: string): string => `${siteId}:${poolPeriod(date, settings.shared_spread, settings.week_start).start}`;
    const pools = new Map<string, { indirect: bigint; missing: bigint; takers: { id: string; workDate: string; hours: string; laborCostCents: bigint }[] }>();
    const pool = (key: string) => {
      let found = pools.get(key);
      if (!found) pools.set(key, (found = { indirect: ZERO, missing: ZERO, takers: [] }));
      return found;
    };
    for (const row of indirect) pool(poolKey(row.site_id, row.work_date)).indirect += big(row.cost_cents);
    for (const row of missing) pool(poolKey(row.site_id, row.work_date)).missing += big(row.missing_cents);
    for (const row of production) pool(poolKey(row.site_id, row.work_date)).takers.push({ id: row.id, workDate: row.work_date, hours: row.hours, laborCostCents: big(row.labor_cost_cents) });
    for (const row of vas) pool(poolKey(row.site_id, row.work_date)).takers.push({ id: row.id, workDate: row.work_date, hours: row.hours, laborCostCents: big(row.labor_cost_cents) });
    expect(pools.size).toBeGreaterThanOrEqual(2);

    let pooled = ZERO;
    let handed = ZERO;
    for (const entry of pools.values()) {
      const spread = spreadSharedCost({ rule: settings.shared_cost_rule, indirectCents: entry.indirect, missingCents: entry.missing, sharedPctBp: settings.shared_pct_bp, takers: entry.takers });
      pooled += spread.poolCents;
      for (const share of spread.shares) {
        pureShared.set(share.id, share.sharedCents);
        handed += share.sharedCents;
      }
    }
    const stamped = new Map<string, bigint>([...production.map((row) => [row.id, big(row.shared_cents)] as const), ...vas.map((row) => [row.id, big(row.shared_cents)] as const)]);
    expect(stamped.size).toBe(pureShared.size);
    for (const [id, cents] of stamped) expect(cents, `shared share of row ${id}`).toBe(pureShared.get(id));
    // Largest remainder: every pool with takers is handed out to the last cent.
    expect(handed).toBe(pooled);
    expect(handed).toBeGreaterThan(ZERO);
  });

  it('every seeded job: pure summary = fact_days = job_stats = getJobProfit, to the cent', async () => {
    const vas = await org.query<{ id: string; job_id: string | null; site_id: string; work_date: string; labor_class_id: string | null; quantity: string; unit_price: string | null; amount_cents: string | null; hours: string; overtime_hours: string; material_cents: string; labor_cost_cents: string }>(
      `select id, job_id, site_id, to_char(work_date, 'YYYY-MM-DD') as work_date, labor_class_id, quantity::text, unit_price::text, amount_cents::text, hours::text, overtime_hours::text,
              material_cents::text, labor_cost_cents::text from pulse.vas_entries where org_id = $1 and deleted_at is null`,
      [org.orgId],
    );
    const usage = await org.query<{ job_id: string; quantity_used: string; quantity_scrapped: string; unit_cost: string; supplied_by: PartsOwner | null; item_owner: PartsOwner | null; cost_cents: string }>(
      `select m.job_id, m.quantity_used::text, m.quantity_scrapped::text, m.unit_cost::text, m.supplied_by, i.supplied_by as item_owner, m.cost_cents::text
         from pulse.material_usage m left join pulse.items i on i.id = m.item_id where m.org_id = $1 and m.deleted_at is null`,
      [org.orgId],
    );
    const costs = await org.query<{ job_id: string; amount_cents: string }>(`select job_id, amount_cents::text from pulse.cost_entries where org_id = $1 and deleted_at is null and scope = 'job'`, [org.orgId]);
    const revenue = await org.query<{ job_id: string; kind: string; amount_cents: string; approved: boolean; source: string }>(
      `select job_id, kind, amount_cents::text, approved, source from pulse.revenue_entries where org_id = $1 and deleted_at is null and job_id is not null`,
      [org.orgId],
    );
    const facts = await org.query<{ job_id: string; kind: FactKind; amount_cents: string }>(`select job_id, kind, amount_cents::text from pulse.fact_days where org_id = $1 and job_id is not null`, [org.orgId]);
    const stats = await org.query<Record<string, string | number | null> & { job_id: string }>(
      `select job_id, revenue_cents::text, base_revenue_cents::text, vas_revenue_cents::text, other_revenue_cents::text, billed_cents::text, labor_cents::text, material_cents::text,
              other_cents::text, shared_cents::text, cost_cents::text, profit_cents::text, margin_bp, margin_before_shared_bp, units_good::text, hours::text
         from pulse.job_stats where org_id = $1`,
      [org.orgId],
    );
    expect(pureShared.size).toBeGreaterThan(0);

    let withMoney = 0;
    for (const job of jobs) {
      const entries = production.filter((row) => row.job_id === job.id);
      const services = vas.filter((row) => row.job_id === job.id);
      // Labor: production plus service labor, from hours and the dated rate.
      let labor = ZERO;
      let base = ZERO;
      let material = ZERO;
      let shared = ZERO;
      let units = 0;
      for (const row of entries) {
        labor += laborCost({ hours: row.hours, overtimeHours: row.overtime_hours, rate: rateOf(row).rate }).laborCostCents;
        // Base revenue and standard material were proven row by row above; fixed stamps depend on order, so reuse the proven stamp.
        base += big(row.base_revenue_cents);
        material += big(row.std_material_cents);
        shared += pureShared.get(row.id) ?? ZERO;
        units += Number(row.units_good);
      }
      let serviceRevenue = ZERO;
      for (const row of services) {
        const stamp = laborCost({ hours: row.hours, overtimeHours: row.overtime_hours, rate: rateOf(row).rate }).laborCostCents;
        expect(big(row.labor_cost_cents), `service labor ${job.name}`).toBe(stamp);
        labor += stamp;
        const amount = serviceAmount({ quantity: row.quantity, unitPrice: row.unit_price });
        expect(amount === null ? null : amount, `service amount ${job.name}`).toBe(row.amount_cents === null ? null : big(row.amount_cents));
        serviceRevenue += amount ?? ZERO;
        material += big(row.material_cents);
        shared += pureShared.get(row.id) ?? ZERO;
      }
      if (job.material_method === 'actual') {
        for (const row of usage.filter((item) => item.job_id === job.id)) {
          const owner: PartsOwner = row.supplied_by ?? row.item_owner ?? job.parts_owner ?? job.client_parts_owner ?? settings.default_parts_owner;
          const stamp = actualMaterial({ quantityUsed: row.quantity_used, quantityScrapped: row.quantity_scrapped, unitCost: row.unit_cost, suppliedBy: owner });
          expect(big(row.cost_cents), `material usage ${job.name}`).toBe(stamp.costCents);
          if (owner === 'us') expect(stamp.costCents).toBe(mulQuantityPrice(Number(row.quantity_used) + Number(row.quantity_scrapped), row.unit_cost));
          material += stamp.costCents;
        }
      }
      const other = costs.filter((row) => row.job_id === job.id).reduce((sum, row) => sum + big(row.amount_cents), ZERO);
      let otherRevenue = ZERO;
      let billed = ZERO;
      for (const row of revenue.filter((item) => item.job_id === job.id)) {
        if (row.kind === 'invoice') {
          if (row.approved) billed += big(row.amount_cents);
        } else if (row.kind === 'fixed_true_up') base += big(row.amount_cents);
        else otherRevenue += big(row.amount_cents);
      }
      if (job.pricing_model === 'fixed' && job.status === 'completed') {
        const trueUp = revenue.find((row) => row.job_id === job.id && row.kind === 'fixed_true_up');
        expect(big(trueUp?.amount_cents)).toBe(fixedTrueUp(job.fixed_price_cents ?? 0, entries.map((row) => ({ stampCents: row.base_revenue_cents }))));
      }

      const buckets: MoneyBuckets = { revenueCents: base + serviceRevenue + otherRevenue, laborCents: labor, materialCents: material, otherCents: other, sharedCents: shared };
      const pure = profitSummary(buckets, units);
      pureBuckets.set(job.id, { ...buckets, billedCents: billed, unitsGood: units });
      if (pure.revenueCents !== ZERO || pure.costCents !== ZERO) withMoney += 1;

      // 1. The fact_days rollup.
      const rolled = sumFacts(facts.filter((row) => row.job_id === job.id).map((row) => ({ kind: row.kind, amountCents: row.amount_cents })));
      expect(rolled.revenueCents, `facts revenue ${job.name}`).toBe(pure.revenueCents);
      expect(rolled.baseRevenueCents, `facts base revenue ${job.name}`).toBe(base);
      expect(rolled.serviceRevenueCents, `facts service revenue ${job.name}`).toBe(serviceRevenue);
      expect(rolled.otherRevenueCents, `facts other revenue ${job.name}`).toBe(otherRevenue);
      expect(rolled.laborCents, `facts labor ${job.name}`).toBe(pure.laborCents);
      expect(rolled.materialCents, `facts material ${job.name}`).toBe(pure.materialCents);
      expect(rolled.otherCents, `facts other ${job.name}`).toBe(pure.otherCents);
      expect(rolled.sharedCents, `facts shared ${job.name}`).toBe(pure.sharedCents);
      expect(rolled.billedCents, `facts billed ${job.name}`).toBe(billed);

      // 2. The cached job_stats row.
      const stat = stats.find((row) => row.job_id === job.id);
      expect(stat, `job_stats row ${job.name}`).toBeDefined();
      expect(big(stat!.revenue_cents as string), `stats revenue ${job.name}`).toBe(pure.revenueCents);
      expect(big(stat!.labor_cents as string), `stats labor ${job.name}`).toBe(pure.laborCents);
      expect(big(stat!.material_cents as string), `stats material ${job.name}`).toBe(pure.materialCents);
      expect(big(stat!.other_cents as string), `stats other ${job.name}`).toBe(pure.otherCents);
      expect(big(stat!.shared_cents as string), `stats shared ${job.name}`).toBe(pure.sharedCents);
      expect(big(stat!.cost_cents as string), `stats cost ${job.name}`).toBe(pure.costCents);
      expect(big(stat!.profit_cents as string), `stats profit ${job.name}`).toBe(pure.profitCents);
      expect(big(stat!.billed_cents as string), `stats billed ${job.name}`).toBe(billed);
      expect(stat!.margin_bp, `stats margin ${job.name}`).toBe(pure.marginBp);
      expect(stat!.margin_before_shared_bp, `stats margin before shared ${job.name}`).toBe(pure.marginBeforeSharedBp);
      expect(Number(stat!.units_good), `stats units ${job.name}`).toBe(units);

      // 3. The DTO the screens read.
      if (entries.length + services.length > 0 || other !== ZERO || otherRevenue !== ZERO) {
        const dto = await getJobProfit(owner, job.id);
        expect(dto.revenueCents, `dto revenue ${job.name}`).toBe(Number(pure.revenueCents));
        expect(dto.laborCents, `dto labor ${job.name}`).toBe(Number(pure.laborCents));
        expect(dto.materialCents, `dto material ${job.name}`).toBe(Number(pure.materialCents));
        expect(dto.otherCents, `dto other ${job.name}`).toBe(Number(pure.otherCents));
        expect(dto.sharedCents, `dto shared ${job.name}`).toBe(Number(pure.sharedCents));
        expect(dto.costCents, `dto cost ${job.name}`).toBe(Number(pure.costCents));
        expect(dto.profitCents, `dto profit ${job.name}`).toBe(Number(pure.profitCents));
        expect(dto.marginBp, `dto margin ${job.name}`).toBe(pure.marginBp);
        expect(dto.marginBeforeSharedBp, `dto margin before shared ${job.name}`).toBe(pure.marginBeforeSharedBp);
        expect(dto.laborPctBp, `dto labor percent ${job.name}`).toBe(pure.laborPctOfRevenueBp);
        expect(dto.costPerUnitCents, `dto cost per unit ${job.name}`).toBe(pure.costPerUnitCents === null ? null : Number(pure.costPerUnitCents));
        expect(dto.profitPerUnitCents, `dto profit per unit ${job.name}`).toBe(pure.profitPerUnitCents === null ? null : Number(pure.profitPerUnitCents));
      }
    }
    expect(withMoney).toBeGreaterThanOrEqual(4);
    // The named example: the healthy per unit job has every bucket filled.
    const gift = jobs.find((job) => job.name === 'Holiday gift kits');
    const giftBuckets = gift ? pureBuckets.get(gift.id) : undefined;
    expect(giftBuckets).toBeDefined();
    for (const key of ['revenueCents', 'laborCents', 'materialCents', 'otherCents', 'sharedCents'] as const) expect(giftBuckets![key], `Holiday gift kits ${key}`).toBeGreaterThan(ZERO);
  });

  it('the profit page total and the company bridge equal the pure sums', async () => {
    const all = await getProfit(owner, 'job', { from: '0001-01-01', to: '9999-12-31' });
    let revenue = ZERO;
    let cost = ZERO;
    for (const bucket of pureBuckets.values()) {
      revenue += bucket.revenueCents;
      cost += bucket.laborCents + bucket.materialCents + bucket.otherCents + bucket.sharedCents;
    }
    expect(all.total.revenueCents).toBe(Number(revenue));
    expect(all.total.costCents).toBe(Number(cost));
    expect(all.total.profitCents).toBe(Number(revenue - cost));
    expect(all.rows.reduce((sum, row) => sum + (row.profitCents ?? 0), 0)).toBe(Number(revenue - cost));

    const [day] = await org.query<{ indirect: string; applied: string; missing: string; company: string; overhead: string }>(
      `select coalesce(sum(indirect_cents), 0)::text as indirect, coalesce(sum(shared_applied_cents), 0)::text as applied, coalesce(sum(missing_cents), 0)::text as missing,
              coalesce(sum(company_cost_cents), 0)::text as company, coalesce(sum(overhead_absorbed_cents), 0)::text as overhead
         from pulse.company_days where org_id = $1`,
      [org.orgId],
    );
    const gap = sharedGap({ rule: settings.shared_cost_rule, indirectCents: day!.indirect, missingCents: day!.missing, sharedAppliedCents: day!.applied });
    const pure = companyBridge({ workProfitCents: revenue - cost, sharedGapCents: gap, missingCents: day!.missing, companyCostCents: day!.company, overheadAbsorbedCents: day!.overhead, rule: settings.shared_cost_rule });
    const dto = await getCompanyBridge(owner, { from: '0001-01-01', to: '9999-12-31' });
    expect(dto.workProfitCents).toBe(Number(pure.workProfitCents));
    expect(dto.sharedGapCents).toBe(Number(pure.sharedGapCents));
    expect(dto.missingCostCents).toBe(Number(pure.missingCents));
    expect(dto.overheadGapCents).toBe(pure.showsOverheadGap ? Number(pure.overheadGapCents) : null);
    expect(dto.companyProfitCents).toBe(Number(pure.companyProfitCents));
    // The lines of the walk add up to company profit.
    expect(pure.lines.slice(0, -1).reduce((sum, line) => sum + line.amountCents, ZERO)).toBe(pure.companyProfitCents);
    // Applied shared cost on the company days equals what the pure spread handed out.
    let handed = ZERO;
    for (const cents of pureShared.values()) handed += cents;
    expect(big(day!.applied)).toBe(handed);
  });
});
