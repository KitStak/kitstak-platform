/**
 * Cost to serve and client rankings (docs/pulse/SPEC.md 4.9). Cost to serve is all cost of the
 * client's jobs plus client level costs, also per unit and per job. Pure functions.
 */
import { type Cents, type CentsLike, type Decimal, ZERO, divRound, marginBp, quantityToScaled, ratioBp, scaledToNumber, toCents } from '../money';
import type { MoneyBuckets } from './types';

/** One job's money inside a date range. */
export interface JobMoney extends MoneyBuckets {
  readonly unitsGood?: Decimal;
}

export interface CostToServeInput {
  readonly jobs: readonly JobMoney[];
  /** Client level costs with no job (4.7). */
  readonly clientCostCents?: CentsLike;
  /** Client level revenue with no job: fees, adjustments, credits. */
  readonly clientRevenueCents?: CentsLike;
  /** The part of client level revenue with no cost tracked behind it, for example storage billed by the warehouse. */
  readonly untrackedRevenueCents?: CentsLike;
}

export interface CostToServe {
  readonly jobCount: number;
  readonly unitsGood: number;
  readonly revenueCents: Cents;
  readonly laborCents: Cents;
  readonly materialCents: Cents;
  readonly otherCents: Cents;
  readonly sharedCents: Cents;
  /** Costs on the client with no job. */
  readonly clientCostCents: Cents;
  /** All cost of the client's jobs plus client level costs. */
  readonly costToServeCents: Cents;
  readonly profitCents: Cents;
  readonly marginBp: number | null;
  readonly costPerUnitCents: Cents | null;
  readonly costPerJobCents: Cents | null;
  /** Cost to serve as a share of revenue, in basis points. */
  readonly costPctOfRevenueBp: number | null;
  /** Revenue with no cost tracked. When above zero the client page says so, because it flatters the margin. */
  readonly untrackedRevenueCents: Cents;
}

/** Rolls a client's jobs and client level rows into cost to serve, profit and margin. */
export function costToServe(input: CostToServeInput): CostToServe {
  let revenue = toCents(input.clientRevenueCents ?? ZERO);
  let labor = ZERO;
  let material = ZERO;
  let other = ZERO;
  let shared = ZERO;
  let units = ZERO;
  for (const job of input.jobs) {
    revenue += job.revenueCents;
    labor += job.laborCents;
    material += job.materialCents;
    other += job.otherCents;
    shared += job.sharedCents;
    units += quantityToScaled(job.unitsGood ?? 0);
  }
  const clientCostCents = toCents(input.clientCostCents ?? ZERO);
  const costToServeCents = labor + material + other + shared + clientCostCents;
  const profitCents = revenue - costToServeCents;
  const jobCount = input.jobs.length;
  return {
    jobCount,
    unitsGood: scaledToNumber(units, 3),
    revenueCents: revenue,
    laborCents: labor,
    materialCents: material,
    otherCents: other,
    sharedCents: shared,
    clientCostCents,
    costToServeCents,
    profitCents,
    marginBp: marginBp(profitCents, revenue),
    costPerUnitCents: units > ZERO ? divRound(costToServeCents * BigInt(1000), units) : null,
    costPerJobCents: jobCount > 0 ? divRound(costToServeCents, BigInt(jobCount)) : null,
    costPctOfRevenueBp: ratioBp(costToServeCents, revenue),
    untrackedRevenueCents: toCents(input.untrackedRevenueCents ?? ZERO),
  };
}

export interface RankedRow<T> {
  readonly item: T;
  /** 1 is the most profit. */
  readonly rank: number;
  readonly revenueCents: Cents;
  readonly profitCents: Cents;
  readonly marginBp: number | null;
  /** This row's share of all revenue, in basis points. */
  readonly revenueShareBp: number | null;
  /** This row's share of all profit, in basis points. `null` when total profit is 0 or less. */
  readonly profitShareBp: number | null;
  /** Running profit from the top of the list down to this row. */
  readonly cumulativeProfitCents: Cents;
  /** Running share of all profit, in basis points. It can pass 10000 before money losing rows pull it back. */
  readonly cumulativeProfitShareBp: number | null;
}

/**
 * Ranks clients, job types or services by profit, most first, with each one's share of revenue
 * and profit and the running total. The running total is the "whale curve": it shows how few
 * clients make most of the profit and which ones give some of it back.
 */
export function rankByProfit<T>(items: readonly T[], pick: (item: T) => { revenueCents: Cents; profitCents: Cents }): RankedRow<T>[] {
  const rows = items.map((item) => ({ item, ...pick(item) }));
  let totalRevenue = ZERO;
  let totalProfit = ZERO;
  for (const row of rows) {
    totalRevenue += row.revenueCents;
    totalProfit += row.profitCents;
  }
  rows.sort((a, b) => (a.profitCents === b.profitCents ? 0 : a.profitCents > b.profitCents ? -1 : 1));
  let running = ZERO;
  return rows.map((row, index) => {
    running += row.profitCents;
    return {
      item: row.item,
      rank: index + 1,
      revenueCents: row.revenueCents,
      profitCents: row.profitCents,
      marginBp: marginBp(row.profitCents, row.revenueCents),
      revenueShareBp: ratioBp(row.revenueCents, totalRevenue),
      profitShareBp: ratioBp(row.profitCents, totalProfit),
      cumulativeProfitCents: running,
      cumulativeProfitShareBp: ratioBp(running, totalProfit),
    };
  });
}

/** How many of the top rows it takes to reach a share of all profit (default 80%). `null` when total profit is 0 or less. */
export function rowsToReachProfitShare<T>(ranked: readonly RankedRow<T>[], shareBp = 8000): number | null {
  for (const row of ranked) if (row.cumulativeProfitShareBp !== null && row.cumulativeProfitShareBp >= shareBp) return row.rank;
  return null;
}
