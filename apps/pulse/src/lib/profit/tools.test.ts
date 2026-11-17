/** The calculator, cost to serve, trends, the calendar helpers and sentence helpers. */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addWorkDays,
  bestAndWorst,
  breakevenPrice,
  breakevenUnits,
  bucketStart,
  bucketStarts,
  compareMoney,
  compareNumber,
  comparePeriods,
  costToServe,
  countWord,
  dayNumber,
  daysBetween,
  endOfMonth,
  fromDayNumber,
  isRealDate,
  isWorkDay,
  moneySeries,
  movingAverage,
  poolPeriod,
  previousPeriod,
  priceBelow,
  quoteCalculator,
  quoteSensitivity,
  rankByProfit,
  revenueForMargin,
  rowsToReachProfitShare,
  runningTotal,
  samePeriodLastYear,
  sentenceMoney,
  sentenceNumber,
  sentencePercent,
  shortDate,
  sparkline,
  startOfMonth,
  startOfWeek,
  streak,
  suggestBucket,
  trendLine,
  weekday,
  weekdayName,
  workDaysBetween,
  type QuoteInput,
} from './index';

const b = (n: number | string): bigint => BigInt(n);

const QUOTE: QuoteInput = { units: 10000, standardUph: 40, crewSize: 5, laborRateCents: 2200, materialPerUnit: '0.45', otherCostCents: 100000, targetMarginBp: 3000 };

describe('what if quote calculator', () => {
  it('prices a job to the target margin', () => {
    const quote = quoteCalculator(QUOTE);
    expect(quote.laborHours).toBe(250);
    expect(quote.laborCents).toBe(b(550000));
    expect(quote.materialCents).toBe(b(450000));
    expect(quote.costCents).toBe(b(1100000));
    expect(quote.costPerUnit).toBe('1.1000');
    expect(quote.target).toMatchObject({ pricePerUnit: '1.5715', revenueCents: b(1571500), profitCents: b(471500), marginBp: 3000, meetsTarget: true, breakevenUnits: 1750 });
    expect(quote.breakeven).toMatchObject({ pricePerUnit: '1.1000', profitCents: b(0), marginBp: 0 });
    expect(quote.lowest?.pricePerUnit).toBe('1.1000');
    expect(quote.atPrice).toBeNull();
    expect(quote.fixedCostCents).toBe(b(100000));
    expect(quote.variableCostPerUnit).toBe('1.0000');
  });
  it('works out crew days and a finish date', () => {
    const quote = quoteCalculator({ ...QUOTE, startDate: '2026-11-17' });
    expect(quote.workDays).toBe(7); // 250 hours over 5 people x 8 hours
    expect(quote.finishDate).toBe('2026-11-25');
    expect(quoteCalculator({ ...QUOTE, crewSize: 0 }).workDays).toBeNull();
    expect(quoteCalculator({ ...QUOTE, crewSize: 10, shiftHours: '12.5' }).workDays).toBe(2);
    expect(quoteCalculator(QUOTE).finishDate).toBeNull();
  });
  it('adds time not on a job and keeps the lowest price before it', () => {
    const quote = quoteCalculator({ ...QUOTE, sharedPctBp: 800 });
    expect(quote.sharedCents).toBe(b(44000));
    expect(quote.costCents).toBe(b(1144000));
    expect(quote.costBeforeSharedCents).toBe(b(1100000));
    expect(quote.target?.pricePerUnit).toBe('1.6343');
    expect(quote.breakeven?.pricePerUnit).toBe('1.1440');
    expect(quote.lowest?.pricePerUnit).toBe('1.1000');
    expect(quote.lowest?.marginBeforeSharedBp).toBe(0);
    expect((quote.lowest?.profitCents ?? b(0)) < b(0)).toBe(true);
    expect(quote.variableCostPerUnit).toBe('1.0440');
  });
  it('counts setup hours as fixed cost', () => {
    const quote = quoteCalculator({ ...QUOTE, setupHours: 10 });
    expect(quote.runHours).toBe(250);
    expect(quote.setupHours).toBe(10);
    expect(quote.laborHours).toBe(260);
    expect(quote.laborCents).toBe(b(572000));
    expect(quote.fixedCostCents).toBe(b(122000));
    expect(quote.planTotals).toMatchObject({ laborHours: 260, setupHours: 10, setupCents: b(22000) });
  });
  it('lets extra services carry part of the revenue', () => {
    const quote = quoteCalculator({ ...QUOTE, services: [{ label: 'Labels', quantity: 10000, unitPrice: '0.05', costPerUnit: '0.02' }, { quantity: 1, unitPrice: '0' }] });
    expect(quote.serviceRevenueCents).toBe(b(50000));
    expect(quote.serviceCostCents).toBe(b(20000));
    expect(quote.costCents).toBe(b(1120000));
    expect(quote.target).toMatchObject({ pricePerUnit: '1.5500', revenueCents: b(1600000), marginBp: 3000 });
    expect(quote.planTotals?.otherCents).toBe(b(120000));
  });
  it('tests a typed price against the target', () => {
    const low = quoteCalculator({ ...QUOTE, pricePerUnit: '1.25' });
    expect(low.atPrice).toMatchObject({ pricePerUnit: '1.2500', revenueCents: b(1250000), profitCents: b(150000), marginBp: 1200, meetsTarget: false, breakevenUnits: 4000, profitPerUnitCents: b(15) });
    expect(low.planTotals?.revenueCents).toBe(b(1250000));
    const losing = quoteCalculator({ ...QUOTE, pricePerUnit: '0.95' });
    expect(losing.atPrice).toMatchObject({ profitCents: b(-150000), marginBp: -1579, breakevenUnits: null });
    expect(quoteCalculator({ ...QUOTE, pricePerUnit: 2 }).atPrice?.meetsTarget).toBe(true);
  });
  it('always reaches the target margin, even with awkward numbers', () => {
    let seed = 99;
    const next = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let round = 0; round < 200; round += 1) {
      const targetMarginBp = next(9000);
      const quote = quoteCalculator({
        units: 1 + next(50000),
        standardUph: `${1 + next(300)}.${String(next(1000)).padStart(3, '0')}`,
        laborRateCents: 1000 + next(4000),
        materialPerUnit: `${next(5)}.${String(next(10000)).padStart(4, '0')}`,
        otherCostCents: next(500000),
        sharedPctBp: next(2000),
        setupHours: next(40),
        targetMarginBp,
      });
      expect(quote.target?.marginBp ?? -1).toBeGreaterThanOrEqual(targetMarginBp);
      expect((quote.breakeven?.profitCents ?? b(-1)) >= b(0)).toBe(true);
      expect(quote.laborCents + quote.materialCents + quote.otherCents + quote.serviceCostCents + quote.sharedCents).toBe(quote.costCents);
    }
  });
  it('handles zero units, a 100% target and bad input', () => {
    const empty = quoteCalculator({ ...QUOTE, units: 0 });
    expect(empty.target).toBeNull();
    expect(empty.breakeven).toBeNull();
    expect(empty.costPerUnit).toBeNull();
    expect(empty.planTotals).toBeNull();
    expect(empty.costCents).toBe(b(100000));
    expect(quoteCalculator({ ...QUOTE, targetMarginBp: 10000 }).target).toBeNull();
    expect(() => quoteCalculator({ ...QUOTE, standardUph: 0 })).toThrow(RangeError);
    expect(() => quoteCalculator({ ...QUOTE, units: -1 })).toThrow(RangeError);
  });
  it('shows what a slow or fast crew does to profit', () => {
    const rows = quoteSensitivity(QUOTE, '1.5715');
    expect(rows.map((row) => row.paceBp)).toEqual([7000, 8000, 9000, 10000, 11000, 12000]);
    expect(rows[1]).toMatchObject({ uph: 32, costCents: b(1237500), profitCents: b(334000), marginBp: 2125 });
    expect(rows[3]).toMatchObject({ uph: 40, profitCents: b(471500), marginBp: 3000 });
    expect(rows[5]?.profitCents).toBeGreaterThan(rows[3]?.profitCents ?? b(0));
    expect(quoteSensitivity(QUOTE, '1.5715', [5000])).toHaveLength(1);
  });
  it('offers the small breakeven helpers on their own', () => {
    expect(revenueForMargin(1100000, 3000)).toBe(b(1571429));
    expect(revenueForMargin(1100000, 0)).toBe(b(1100000));
    expect(revenueForMargin(1100000, 10000)).toBeNull();
    expect(breakevenPrice(1100000, 10000)).toBe('1.1000');
    expect(breakevenPrice(100, 3)).toBe('0.3334');
    expect(breakevenPrice(100, 0)).toBeNull();
    expect(breakevenUnits({ fixedCostCents: 100000, pricePerUnit: '1.5715', variableCostPerUnit: '1.00' })).toBe(1750);
    expect(breakevenUnits({ fixedCostCents: 100000, pricePerUnit: '1.00', variableCostPerUnit: '1.00' })).toBeNull();
    expect(breakevenUnits({ fixedCostCents: 0, pricePerUnit: '1.50', variableCostPerUnit: '1.00' })).toBe(0);
    expect(priceBelow('1.0999', '1.10')).toBe(true);
    expect(priceBelow('1.10', '1.1000')).toBe(false);
  });
});

describe('cost to serve and rankings', () => {
  const jobs = [
    { revenueCents: b(700000), laborCents: b(287500), materialCents: b(190000), otherCents: b(40000), sharedCents: b(26000), unitsGood: 4000 },
    { revenueCents: b(300000), laborCents: b(150000), materialCents: b(50000), otherCents: b(10000), sharedCents: b(5000), unitsGood: '1500.000' },
  ];
  it('adds every cost of the client jobs and the client level costs', () => {
    const result = costToServe({ jobs, clientCostCents: 30000, clientRevenueCents: 420000, untrackedRevenueCents: 420000 });
    expect(result.jobCount).toBe(2);
    expect(result.unitsGood).toBe(5500);
    expect(result.revenueCents).toBe(b(1420000));
    expect(result.costToServeCents).toBe(b(788500));
    expect(result.profitCents).toBe(b(631500));
    expect(result.marginBp).toBe(4447);
    expect(result.costPerUnitCents).toBe(b(143));
    expect(result.costPerJobCents).toBe(b(394250));
    expect(result.costPctOfRevenueBp).toBe(5553);
    expect(result.untrackedRevenueCents).toBe(b(420000));
  });
  it('has no per unit or per job number with nothing to divide by', () => {
    const empty = costToServe({ jobs: [], clientCostCents: 30000 });
    expect(empty).toMatchObject({ jobCount: 0, costToServeCents: b(30000), profitCents: b(-30000), marginBp: null, costPerUnitCents: null, costPerJobCents: null, costPctOfRevenueBp: null });
  });
  it('ranks by profit with shares and a running total', () => {
    const clients = [
      { name: 'Acme', revenueCents: b(500000), profitCents: b(150000) },
      { name: 'Birch', revenueCents: b(300000), profitCents: b(-50000) },
      { name: 'Cedar', revenueCents: b(200000), profitCents: b(100000) },
    ];
    const ranked = rankByProfit(clients, (client) => client);
    expect(ranked.map((row) => row.item.name)).toEqual(['Acme', 'Cedar', 'Birch']);
    expect(ranked[0]).toMatchObject({ rank: 1, marginBp: 3000, revenueShareBp: 5000, profitShareBp: 7500, cumulativeProfitShareBp: 7500 });
    expect(ranked[1]).toMatchObject({ cumulativeProfitCents: b(250000), cumulativeProfitShareBp: 12500 });
    expect(ranked[2]).toMatchObject({ profitShareBp: -2500, cumulativeProfitShareBp: 10000 });
    expect(rowsToReachProfitShare(ranked)).toBe(2);
    expect(rowsToReachProfitShare(ranked, 5000)).toBe(1);
    const allLosing = rankByProfit([{ revenueCents: b(100), profitCents: b(-10) }], (row) => row);
    expect(allLosing[0]?.profitShareBp).toBeNull();
    expect(rowsToReachProfitShare(allLosing)).toBeNull();
    expect(rankByProfit([], (row: { revenueCents: bigint; profitCents: bigint }) => row)).toEqual([]);
  });
});

describe('period over period and trends', () => {
  it('finds the period before', () => {
    expect(previousPeriod({ from: '2026-11-01', to: '2026-11-30' })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(previousPeriod({ from: '2026-10-01', to: '2026-12-31' })).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(previousPeriod({ from: '2026-11-10', to: '2026-11-16' })).toEqual({ from: '2026-11-03', to: '2026-11-09' });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod({ from: '2026-11-17', to: '2026-11-17' })).toEqual({ from: '2026-11-16', to: '2026-11-16' });
  });
  it('finds the same period last year', () => {
    expect(samePeriodLastYear({ from: '2028-02-01', to: '2028-02-29' })).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(samePeriodLastYear({ from: '2026-11-10', to: '2026-11-16' })).toEqual({ from: '2025-11-10', to: '2025-11-16' });
  });
  it('compares money and numbers with a tone', () => {
    expect(compareMoney(b(120000), b(100000), 'up')).toEqual({ currentCents: b(120000), previousCents: b(100000), deltaCents: b(20000), changeBp: 2000, direction: 'up', tone: 'good' });
    expect(compareMoney(b(120000), b(100000), 'down').tone).toBe('bad');
    expect(compareMoney(b(100), b(100), 'up')).toMatchObject({ direction: 'flat', tone: 'neutral', changeBp: 0 });
    expect(compareMoney(b(100), b(0), 'up')).toMatchObject({ changeBp: null, direction: 'up', tone: 'good' });
    expect(compareMoney(b(100), null, 'up')).toMatchObject({ deltaCents: null, changeBp: null, tone: 'neutral' });
    expect(compareNumber(32, 40, 'up')).toMatchObject({ delta: -8, changeBp: -2000, direction: 'down', tone: 'bad' });
    expect(compareNumber(2236, 2571, 'up').delta).toBe(-335);
    expect(compareNumber(null, 40, 'up')).toMatchObject({ delta: null, tone: 'neutral' });
    expect(compareNumber(5, 0, 'up').changeBp).toBeNull();
  });
  it('compares two periods line by line', () => {
    const now = { revenueCents: b(700000), laborCents: b(287500), materialCents: b(190000), otherCents: b(40000), sharedCents: b(26000) };
    const before = { revenueCents: b(600000), laborCents: b(240000), materialCents: b(170000), otherCents: b(50000), sharedCents: b(20000) };
    const result = comparePeriods(now, before);
    expect(result.revenue).toMatchObject({ deltaCents: b(100000), changeBp: 1667, tone: 'good' });
    expect(result.labor).toMatchObject({ deltaCents: b(47500), tone: 'bad' });
    expect(result.other.tone).toBe('good');
    expect(result.cost.deltaCents).toBe(b(63500));
    expect(result.profit).toMatchObject({ currentCents: b(156500), previousCents: b(120000), tone: 'good' });
    expect(result.margin).toMatchObject({ current: 2236, previous: 2000, delta: 236, tone: 'good' });
    const first = comparePeriods(now, null);
    expect(first.profit.previousCents).toBeNull();
    expect(first.margin.tone).toBe('neutral');
  });
  it('buckets dated money with no holes, and the buckets add up', () => {
    const rows = [
      { date: '2026-11-02', cents: b(100) },
      { date: '2026-11-03', cents: b(250) },
      { date: '2026-11-16', cents: b(-40) },
      { date: '2026-12-01', cents: b(999) },
    ];
    const range = { from: '2026-11-02', to: '2026-11-22' };
    const weekly = moneySeries(rows, range, 'week', (row) => row);
    expect(weekly).toEqual([
      { start: '2026-11-02', cents: b(350) },
      { start: '2026-11-09', cents: b(0) },
      { start: '2026-11-16', cents: b(-40) },
    ]);
    expect(moneySeries(rows, range, 'day', (row) => row)).toHaveLength(21);
    expect(moneySeries(rows, { from: '2026-10-15', to: '2026-12-15' }, 'month', (row) => row).map((point) => point.start)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
    expect(runningTotal(weekly.map((point) => point.cents))).toEqual([b(350), b(350), b(310)]);
    expect(bucketStart('2026-11-18', 'week')).toBe('2026-11-16');
    expect(bucketStart('2026-11-18', 'week', 0)).toBe('2026-11-15');
    expect(bucketStart('2026-11-18', 'month')).toBe('2026-11-01');
    expect(bucketStarts({ from: '2026-11-30', to: '2026-12-02' }, 'day')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
    expect(suggestBucket({ from: '2026-11-01', to: '2026-11-30' })).toBe('day');
    expect(suggestBucket({ from: '2026-09-01', to: '2026-11-30' })).toBe('week');
    expect(suggestBucket({ from: '2026-01-01', to: '2026-12-31' })).toBe('month');
  });
  it('smooths and fits a trend', () => {
    expect(movingAverage([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
    expect(movingAverage([10, null, 30], 3)).toEqual([10, 10, 20]);
    expect(movingAverage([null], 3)).toEqual([null]);
    const up = trendLine([10, 12, 14, 16]);
    expect(up).toMatchObject({ slope: 2, intercept: 10, direction: 'up', next: 18, points: 4 });
    expect(trendLine([16, 14, 12, 10])?.direction).toBe('down');
    expect(trendLine([100, 100.5, 99.8, 100.2])?.direction).toBe('flat');
    expect(trendLine([5])).toBeNull();
    expect(trendLine([null, null])).toBeNull();
    expect(trendLine([10, null, 14])?.slope).toBe(2);
  });
  it('scales a sparkline and finds the best and worst points', () => {
    expect(sparkline([10, 20, 15])).toEqual([0, 1, 0.5]);
    expect(sparkline([7, 7, 7])).toEqual([0.5, 0.5, 0.5]);
    expect(sparkline([10, null, 20])).toEqual([0, null, 1]);
    expect(sparkline([null])).toEqual([null]);
    expect(bestAndWorst([10, 40, null, 5])).toEqual({ best: { index: 1, value: 40 }, worst: { index: 3, value: 5 } });
    expect(bestAndWorst([])).toBeNull();
    expect(streak([5, 4, 6, 7, 9])).toEqual({ direction: 'up', length: 3 });
    expect(streak([9, 8, 7])).toEqual({ direction: 'down', length: 2 });
    expect(streak([9, 8, 8])).toEqual({ direction: 'flat', length: 0 });
    expect(streak([9])).toEqual({ direction: 'flat', length: 0 });
  });
});

describe('calendar helpers', () => {
  it('moves between dates and day numbers', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(dayNumber('2026-11-17'))).toBe('2026-11-17');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(daysBetween('2026-11-17', '2026-12-14')).toBe(27);
    expect(weekday('2026-11-17')).toBe(2);
    expect(weekdayName('2026-11-20')).toBe('Friday');
    expect(shortDate('2026-12-09')).toBe('Dec 9');
  });
  it('refuses dates that are not real', () => {
    expect(() => dayNumber('2026-02-30')).toThrow(RangeError);
    expect(() => dayNumber('11/17/2026')).toThrow(RangeError);
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate(20261117)).toBe(false);
    expect(isRealDate('0001-01-01')).toBe(true);
  });
  it('counts work days', () => {
    expect(isWorkDay('2026-11-21')).toBe(false);
    expect(isWorkDay('2026-11-21', [1, 2, 3, 4, 5, 6])).toBe(true);
    expect(addWorkDays('2026-11-17', 19)).toBe('2026-12-14');
    expect(addWorkDays('2026-11-20', 1)).toBe('2026-11-23');
    expect(addWorkDays('2026-11-17', 0)).toBe('2026-11-17');
    expect(addWorkDays('2026-11-17', 1, [])).toBeNull();
    expect(workDaysBetween('2026-11-17', '2026-11-20')).toBe(3);
    expect(workDaysBetween('2026-11-20', '2026-11-23')).toBe(1);
    expect(workDaysBetween('2026-11-20', '2026-11-17')).toBe(0);
  });
  it('finds month and week edges', () => {
    expect(startOfMonth('2026-11-17')).toBe('2026-11-01');
    expect(endOfMonth('2026-11-17')).toBe('2026-11-30');
    expect(endOfMonth('2026-12-05')).toBe('2026-12-31');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(startOfWeek('2026-11-17')).toBe('2026-11-16');
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09');
    expect(startOfWeek('2026-11-15', 0)).toBe('2026-11-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-17', 2)).toBe('2027-01-17');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
  it('cuts a shared cost pool at the month boundary', () => {
    expect(poolPeriod('2026-11-18', 'week')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(poolPeriod('2026-11-30', 'week')).toEqual({ start: '2026-11-30', end: '2026-11-30' });
    expect(poolPeriod('2026-12-01', 'week')).toEqual({ start: '2026-12-01', end: '2026-12-06' });
    expect(poolPeriod('2026-11-18', 'day')).toEqual({ start: '2026-11-18', end: '2026-11-18' });
    expect(poolPeriod('2026-11-18', 'month')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(poolPeriod('2026-11-18', 'week', 0)).toEqual({ start: '2026-11-15', end: '2026-11-21' });
  });
});

describe('sentence helpers', () => {
  it('rounds money for sentences', () => {
    expect(sentenceMoney(b(184049))).toBe('$1,840');
    expect(sentenceMoney(b(-184050))).toBe('$1,841');
    expect(sentenceMoney(b(312))).toBe('$3.12');
    expect(sentenceMoney(b(1000))).toBe('$10');
    expect(sentencePercent(2236)).toBe('22%');
    expect(sentenceNumber(31.46, 1)).toBe('31.5');
    expect(countWord(1, 'day')).toBe('1 day');
    expect(countWord(3, 'day')).toBe('3 days');
  });
});
