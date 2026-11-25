import { describe, expect, it } from 'vitest';
import { eachDay, isWorkDay, workDaysInMonth } from './calendar';
import { CALENDAR, OPEN_CALENDAR, PROGRAM_ID, SETUP, VARIANTS, VERSIONS, line, outputFor, seeded } from './glove.fixture';
import { type MonthInput, accrueRow, buildDayRef, feeRef, fixedLineForMonth, laborRef, ledgerRows, minimumStatusLabel, monthCharges, parseRef } from './month';
import { fromScaled } from './money';
import type { CardVersion, FinishedBuild, IsoDate, OneTimeCharge, TimeDay } from './types';

const ZERO = BigInt(0);

function workDays(from: IsoDate, to: IsoDate): IsoDate[] {
  return eachDay(from, to).filter((date) => isWorkDay(CALENDAR, date));
}

function month(partial: Partial<MonthInput> & Pick<MonthInput, 'month'>): MonthInput {
  return { programId: PROGRAM_ID, asOf: '2026-11-25', calendar: CALENDAR, versions: VERSIONS, output: [], finished: [], time: [], oneTime: [SETUP], ...partial };
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, ZERO);
}

describe('per unit days', () => {
  it('E12 one November work day at 100 of each', () => {
    const rows = outputFor(['2026-11-02']);
    const byPrice = (price: string): bigint => sum(rows.filter((row) => row.unitPrice === price).map((row) => BigInt(row.revenueCents)));
    expect(byPrice('1.9500')).toBe(BigInt(117000));
    expect(byPrice('2.2000')).toBe(BigInt(44000));
    const result = monthCharges(month({ month: '2026-11', output: rows }));
    expect(result.work.perUnitCents).toBe(BigInt(161000));
  });
  it('E13 one October work day at 100 of each', () => {
    const result = monthCharges(month({ month: '2026-10', output: outputFor(['2026-10-05']) }));
    expect(result.work.perUnitCents).toBe(BigInt(153000));
  });
  it('accrueRow equals every stored snapshot', () => {
    for (const row of outputFor(workDays('2026-09-15', '2026-11-24'))) expect(accrueRow(row).toString()).toBe(row.revenueCents);
  });
});

describe('GLOVE months (E14 to E16)', () => {
  it('E14 September: partial month with the setup fee', () => {
    const days = workDaysInMonth(CALENDAR, '2026-09');
    expect(days).toHaveLength(12);
    const result = monthCharges(month({ month: '2026-09', output: outputFor(days) }));
    expect(result.work.totalCents).toBe(BigInt(1836000));
    expect(result.fixed.monthlyFeeCents).toBe(BigInt(80000));
    expect(result.fixed.setupCents).toBe(BigInt(250000));
    expect(result.minimum).toEqual({ minimumCents: BigInt(1600000), gapSoFarCents: ZERO, topUpCents: ZERO, status: 'met' });
    expect(result.totalCents).toBe(BigInt(2166000));
    expect(result.units).toBe('9600.000');
    const fee = result.charges.find((charge) => charge.kind === 'flat_monthly');
    expect(fee).toMatchObject({ ref: `pmf:${PROGRAM_ID}:monthly:2026-09`, date: '2026-09-15', cents: BigInt(80000), posted: true });
    expect(result.charges.find((charge) => charge.kind === 'setup')).toMatchObject({ ref: `pmf:${PROGRAM_ID}:setup:setup-1`, cents: BigInt(250000), oneTimeId: 'setup-1' });
  });

  it('E15 October: a slow week leaves a gap that tops up after the month', () => {
    const days = workDays('2026-10-01', '2026-10-31');
    expect(days).toHaveLength(22);
    const slow = (date: IsoDate): string => (date >= '2026-10-12' && date <= '2026-10-16' ? '50' : '100');
    const result = monthCharges(month({ month: '2026-10', output: outputFor(days, slow) }));
    expect(result.work.totalCents).toBe(BigInt(2983500));
    expect(result.fixed.monthlyFeeCents).toBe(BigInt(150000));
    expect(result.minimum).toEqual({ minimumCents: BigInt(3000000), gapSoFarCents: BigInt(16500), topUpCents: BigInt(16500), status: 'short' });
    expect(result.totalCents).toBe(BigInt(3150000));
    const topUp = result.charges.find((charge) => charge.kind === 'minimum_top_up');
    expect(topUp).toMatchObject({ ref: `pmf:${PROGRAM_ID}:minimum:2026-10`, date: '2026-10-31', cents: BigInt(16500), posted: true, label: 'Minimum top up' });
    expect(ledgerRows(result).map((row) => row.ref)).toEqual([`pmf:${PROGRAM_ID}:monthly:2026-10`, `pmf:${PROGRAM_ID}:minimum:2026-10`]);
  });

  it('E16 November so far: the fee is dated the 1st and the minimum is a preview', () => {
    const days = workDays('2026-11-01', '2026-11-24');
    expect(days).toHaveLength(17);
    const result = monthCharges(month({ month: '2026-11', asOf: '2026-11-24', output: outputFor(days) }));
    expect(result.work.totalCents).toBe(BigInt(2737000));
    const fee = result.charges.find((charge) => charge.kind === 'flat_monthly');
    expect(fee).toMatchObject({ cents: BigInt(150000), date: '2026-11-01' });
    expect(result.minimum.status).toBe('pending');
    expect(result.minimum.gapSoFarCents).toBe(BigInt(263000));
    expect(result.minimum.topUpCents).toBe(ZERO);
    expect(result.charges.find((charge) => charge.kind === 'minimum_top_up')).toMatchObject({ cents: BigInt(263000), posted: false });
    expect(result.totalCents).toBe(BigInt(2887000));
    expect(ledgerRows(result).map((row) => row.kind)).toEqual(['flat_monthly']);
  });

  it('a month before the program starts has no fixed charges', () => {
    const result = monthCharges(month({ month: '2026-08' }));
    expect(result.totalCents).toBe(ZERO);
    expect(result.minimum.status).toBe('none');
    expect(result.charges).toEqual([]);
  });

  it('the fee waits for the first active day', () => {
    const result = monthCharges(month({ month: '2026-09', asOf: '2026-09-14' }));
    expect(result.fixed.monthlyFeeCents).toBe(ZERO);
    expect(result.minimum.status).toBe('pending');
  });
});

describe('fixed lines across versions', () => {
  const fee = (id: string, from: IsoDate, cents: string | null, prorate: boolean, chargeWhilePaused = true): CardVersion => ({
    id,
    number: null,
    effectiveFrom: from,
    rules: [],
    lines: cents === null ? [line({ id: `${id}-unit`, kind: 'per_unit', unitPrice: '1.00' })] : [line({ id: `${id}-fee`, kind: 'flat_monthly', amountCents: cents, prorate, chargeWhilePaused })],
  });
  it('E19 a change on day 16 splits the fee by days', () => {
    const result = fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [fee('a', '2026-11-01', '150000', true), fee('b', '2026-11-16', '180000', true)], kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(165000));
    expect(result.segments.map((segment) => [segment.versionId, segment.from, segment.to, segment.days, segment.cents])).toEqual([
      ['a', '2026-11-01', '2026-11-15', 15, BigInt(75000)],
      ['b', '2026-11-16', '2026-11-30', 15, BigInt(90000)],
    ]);
  });
  it('E33 mixed options never charge more than one month', () => {
    const result = fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [fee('v1', '2026-11-01', '150000', false), fee('v3', '2026-11-16', '180000', true)], kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(165000));
  });
  it('E34 a fee that starts mid month', () => {
    const result = fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [fee('v1', '2026-11-01', null, true), fee('v2', '2026-11-16', '180000', false)], kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(90000));
  });
  it('E35 a program that starts Sep 15 with the full fee', () => {
    const result = fixedLineForMonth({ month: '2026-09', calendar: CALENDAR, versions: [fee('v1', '2026-09-01', '150000', false)], kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(150000));
  });
  it('E36 paused days and charge while paused', () => {
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-09', to: '2026-11-15' }] };
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions: [fee('v1', '2026-11-01', '150000', true, false)], kind: 'flat_monthly' }).cents).toBe(BigInt(115000));
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions: [fee('v1', '2026-11-01', '150000', true, true)], kind: 'flat_monthly' }).cents).toBe(BigInt(150000));
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions: [fee('v1', '2026-11-01', '150000', false, false)], kind: 'flat_monthly' }).cents).toBe(BigInt(150000));
  });
  it('a program that ends mid month and a month fully paused', () => {
    const ending = { ...OPEN_CALENDAR, activeTo: '2026-11-10' };
    expect(fixedLineForMonth({ month: '2026-11', calendar: ending, versions: [fee('v1', '2026-11-01', '150000', true)], kind: 'flat_monthly' }).cents).toBe(BigInt(50000));
    const allPaused = { ...OPEN_CALENDAR, paused: [{ from: '2026-10-20', to: null }] };
    expect(fixedLineForMonth({ month: '2026-11', calendar: allPaused, versions: [fee('v1', '2026-11-01', '150000', true, false)], kind: 'flat_monthly' })).toEqual({ cents: ZERO, segments: [] });
  });
  it('the parts of a month add back to the whole month to the cent', () => {
    const three = [fee('a', '2026-11-01', '100001', true), fee('b', '2026-11-11', '100001', true), fee('c', '2026-11-21', '100001', true)];
    const result = fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: three, kind: 'flat_monthly' });
    expect(result.segments).toHaveLength(3);
    expect(result.cents).toBe(BigInt(100001));
    expect(sum(result.segments.map((segment) => segment.cents))).toBe(BigInt(100001));
    const uneven = [fee('a', '2026-11-01', '100001', true), fee('b', '2026-11-08', '100001', true), fee('c', '2026-11-19', '100001', true)];
    expect(fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: uneven, kind: 'flat_monthly' }).cents).toBe(BigInt(100001));
  });
  it('a same fee version change on day 16 bills exactly one month', () => {
    const result = fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [fee('a', '2026-11-01', '150001', true), fee('b', '2026-11-16', '150001', true)], kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(150001));
    expect(result.segments.map((segment) => segment.cents)).toEqual([BigInt(75001), BigInt(75000)]);
  });
  it('equal versions without proration and with paused days still add back exactly', () => {
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-09', to: '2026-11-15' }] };
    const off = [fee('a', '2026-11-01', '100001', false, false), fee('b', '2026-11-11', '100001', false, false), fee('c', '2026-11-21', '100001', false, false)];
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions: off, kind: 'flat_monthly' }).cents).toBe(BigInt(100001));
    const startsMid = { ...OPEN_CALENDAR, activeFrom: '2026-11-15' };
    const on = [fee('a', '2026-11-01', '100001', true), fee('b', '2026-11-20', '100001', true), fee('c', '2026-11-25', '100001', true)];
    expect(fixedLineForMonth({ month: '2026-11', calendar: startsMid, versions: on, kind: 'flat_monthly' }).cents).toBe(BigInt(53334));
  });
  it('E48 a 31 day month split 10 and 21 days rounds the month once (170323, not the 170322 of rounding each part)', () => {
    // $1,500.00 for Dec 1 to 10, then $1,800.00 for Dec 11 to 31: (150000 * 10 + 180000 * 21) / 31 = 170322.58, rounded once.
    const result = fixedLineForMonth({ month: '2026-12', calendar: OPEN_CALENDAR, versions: [fee('a', '2026-12-01', '150000', true), fee('b', '2026-12-11', '180000', true)], kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(170323));
    expect(result.segments.map((segment) => [segment.versionId, segment.days, segment.cents])).toEqual([
      ['a', 10, BigInt(48387)],
      ['b', 21, BigInt(121936)],
    ]);
    expect(sum(result.segments.map((segment) => segment.cents))).toBe(result.cents);
  });
  it('E49 paused Nov 1 to 15 under a line that does not charge while paused, then a full month line from Nov 16, charges that line once (300000)', () => {
    // Nov 1 to 15 charge nothing, so the only charging days are Nov 16 to 30 under the $3,000.00
    // line with "Charge part of it in a partial month" off: the frame is those 15 days, so it is
    // the full $3,000.00, one month, never more.
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-01', to: '2026-11-15' }] };
    const versions = [fee('a', '2026-11-01', '100000', true, false), fee('b', '2026-11-16', '300000', false, true)];
    const result = fixedLineForMonth({ month: '2026-11', calendar: paused, versions, kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(300000));
    expect(result.segments.map((segment) => [segment.versionId, segment.from, segment.to, segment.days, segment.cents])).toEqual([['b', '2026-11-16', '2026-11-30', 15, BigInt(300000)]]);
  });
  it('every day split of a month adds back to one month', () => {
    for (const amount of ['100001', '150001', '99999', '1']) {
      const daily = eachDay('2026-11-01', '2026-11-30').map((date) => fee(`v-${date}`, date, amount, true));
      expect(fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: daily, kind: 'flat_monthly' }).cents).toBe(BigInt(amount));
    }
  });
});

const PER_HOUR: CardVersion = {
  id: 'h1',
  number: 1,
  effectiveFrom: '2026-01-01',
  rules: [],
  lines: [line({ id: 'h1-hour', kind: 'per_hour', rateCents: 4200 }), line({ id: 'h1-order', kind: 'per_order', amountCents: '4500' })],
};

describe('per hour and per batch', () => {
  it('E20 95 minutes at $42.00 an hour', () => {
    const time: TimeDay[] = [{ workDate: '2026-11-23', buildId: 'b1', variantId: 'A', minutes: 95 }];
    const result = monthCharges(month({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [PER_HOUR], time, oneTime: [] }));
    const charge = result.charges.find((row) => row.kind === 'per_hour');
    expect(charge).toMatchObject({ ref: `pmf:${PROGRAM_ID}:hours:2026-11-23`, quantity: '1.58', cents: BigInt(6636), unitPrice: '42.0000', variantId: 'A' });
  });
  it('E21 hours round once per day, then split by minutes', () => {
    const time: TimeDay[] = [
      { workDate: '2026-11-23', buildId: 'b1', variantId: 'A', minutes: 31 },
      { workDate: '2026-11-23', buildId: null, variantId: null, minutes: 31 },
    ];
    const result = monthCharges(month({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [PER_HOUR], time, oneTime: [] }));
    const charge = result.charges.find((row) => row.kind === 'per_hour');
    expect(charge).toMatchObject({ quantity: '1.03', cents: BigInt(4326), variantId: null });
    expect(result.hourSplits.map((split) => [split.variantId, split.cents])).toEqual([
      ['A', BigInt(2163)],
      [null, BigInt(2163)],
    ]);
    expect(result.byVariant.map((row) => [row.variantId, row.perHourCents])).toEqual([
      ['A', BigInt(2163)],
      [null, BigInt(2163)],
    ]);
  });
  it('no time, no rate, or future time makes no hour charge', () => {
    const time: TimeDay[] = [
      { workDate: '2026-11-23', buildId: null, variantId: null, minutes: 0 },
      { workDate: '2026-11-30', buildId: null, variantId: null, minutes: 60 },
    ];
    expect(monthCharges(month({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [PER_HOUR], time, oneTime: [] })).work.perHourCents).toBe(ZERO);
    expect(monthCharges(month({ month: '2026-11', versions: VERSIONS, time: [{ workDate: '2026-11-23', buildId: null, variantId: null, minutes: 60 }] })).work.perHourCents).toBe(ZERO);
  });
  it('E22 three finished builds with output each pay the batch fee', () => {
    const finished: FinishedBuild[] = [
      { buildId: 'd1', buildKey: 'DUDE-1', variantId: null, finishedOn: '2026-11-23', builtQty: '40' },
      { buildId: 'd2', buildKey: 'DUDE-2', variantId: null, finishedOn: '2026-11-23', builtQty: '12.5' },
      { buildId: 'd3', buildKey: 'DUDE-3', variantId: null, finishedOn: '2026-11-23', builtQty: '1' },
      { buildId: 'd4', buildKey: 'DUDE-4', variantId: null, finishedOn: '2026-11-23', builtQty: '0' },
    ];
    const result = monthCharges(month({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [PER_HOUR], finished, oneTime: [] }));
    const orders = result.charges.filter((row) => row.kind === 'per_order');
    expect(orders.map((row) => [row.ref, row.cents, row.label])).toEqual([
      [`pmf:${PROGRAM_ID}:order:d1`, BigInt(4500), 'Batch fee · DUDE-1'],
      [`pmf:${PROGRAM_ID}:order:d2`, BigInt(4500), 'Batch fee · DUDE-2'],
      [`pmf:${PROGRAM_ID}:order:d3`, BigInt(4500), 'Batch fee · DUDE-3'],
    ]);
    expect(result.work.perOrderCents).toBe(BigInt(13500));
  });
});

describe('one time charges and the minimum', () => {
  it('E23 the setup fee is charged once, in its month only', () => {
    const later: CardVersion = { ...VERSIONS[1]!, id: 'v3', effectiveFrom: '2026-12-01' };
    const versions = [...VERSIONS, later];
    const setupCents = ['2026-09', '2026-10', '2026-11', '2026-12'].map((m) => monthCharges(month({ month: m, asOf: '2027-01-05', versions, oneTime: m === '2026-09' ? [SETUP] : [] })).fixed.setupCents);
    expect(setupCents).toEqual([BigInt(250000), ZERO, ZERO, ZERO]);
  });
  it('E37 adjustments count toward the minimum only when marked', () => {
    const version: CardVersion = {
      id: 'm1',
      number: 1,
      effectiveFrom: '2026-01-01',
      rules: [],
      lines: [line({ id: 'm1-unit', kind: 'per_unit', unitPrice: '29.90' }), line({ id: 'm1-fee', kind: 'flat_monthly', amountCents: '150000' }), line({ id: 'm1-min', kind: 'monthly_minimum', amountCents: '3000000' })],
    };
    const oneTime: OneTimeCharge[] = [
      { id: 'credit', kind: 'adjustment', chargeOn: '2026-10-20', amountCents: '-20000', label: 'Damaged kits credit', variantId: null, countsTowardMinimum: true },
      { id: 'rush', kind: 'adjustment', chargeOn: '2026-10-21', amountCents: '15000', label: 'Rush fee', variantId: null, countsTowardMinimum: false },
    ];
    const output = [{ buildId: 'b', variantId: null, workDate: '2026-10-15', qty: '1000', scrapQty: '0', unitPrice: '29.9000', priceSource: 'card' as const, versionId: 'm1', revenueCents: '2990000', posting: 'program' as const, pulseJobId: null }];
    const result = monthCharges(month({ month: '2026-10', calendar: OPEN_CALENDAR, versions: [version], output, oneTime }));
    expect(result.work.totalCents).toBe(BigInt(2990000));
    expect(result.adjustments).toEqual({ totalCents: BigInt(-5000), towardMinimumCents: BigInt(-20000) });
    expect(result.minimum.topUpCents).toBe(BigInt(30000));
    expect(result.totalCents).toBe(BigInt(2990000 + 150000 - 20000 + 15000 + 30000));
    expect(result.charges.find((row) => row.ref === `pmf:${PROGRAM_ID}:adj:credit`)).toMatchObject({ kind: 'adjustment', cents: BigInt(-20000), countsTowardMinimum: true });
  });
  it('a one time charge after today is not charged yet', () => {
    const later: OneTimeCharge = { ...SETUP, id: 'later', chargeOn: '2026-11-28' };
    expect(monthCharges(month({ month: '2026-11', oneTime: [later] })).fixed.setupCents).toBe(ZERO);
  });
  it('counts units with no price', () => {
    const rows = outputFor(['2026-09-14'], () => '10', []);
    const result = monthCharges(month({ month: '2026-09', output: rows, versions: [] }));
    expect(result.unpricedUnits).toBe('80.000');
    expect(result.charges[0]?.label).toBe('Built 10 · No price');
  });
});

describe('E25 the by variant rollup adds back to the month', () => {
  it('holds over 500 random rows with hours, batches and adjustments', () => {
    const random = seeded(500);
    const version: CardVersion = { ...VERSIONS[0]!, lines: [...VERSIONS[0]!.lines, line({ id: 'v1-hour', kind: 'per_hour', rateCents: 3850 }), line({ id: 'v1-order', kind: 'per_order', amountCents: '2500' })] };
    const versions = [version, VERSIONS[1]!];
    const days = workDays('2026-10-01', '2026-10-31');
    const output = Array.from({ length: 500 }, (_, index) => {
      const variant = VARIANTS[Math.floor(random() * VARIANTS.length)]!;
      const date = days[Math.floor(random() * days.length)]!;
      const qty = fromScaled(BigInt(Math.floor(random() * 500000)), 3);
      const unitPrice = fromScaled(BigInt(Math.floor(random() * 50000)), 4);
      return { buildId: `r${index}`, variantId: random() < 0.1 ? null : variant.id, workDate: date, qty, scrapQty: '0', unitPrice, priceSource: 'card' as const, versionId: 'v1', revenueCents: '0', posting: 'program' as const, pulseJobId: null };
    }).map((row) => ({ ...row, revenueCents: accrueRow(row).toString() }));
    const finished: FinishedBuild[] = output.slice(0, 60).map((row) => ({ buildId: row.buildId, buildKey: row.buildId, variantId: row.variantId, finishedOn: row.workDate, builtQty: row.qty }));
    const time: TimeDay[] = output.slice(0, 120).map((row) => ({ workDate: row.workDate, buildId: row.buildId, variantId: row.variantId, minutes: 1 + Math.floor(random() * 300) }));
    const oneTime: OneTimeCharge[] = [{ id: 'adj', kind: 'adjustment', chargeOn: '2026-10-09', amountCents: '-12345', label: 'Credit', variantId: null, countsTowardMinimum: true }];
    const result = monthCharges(month({ month: '2026-10', versions, output, finished, time, oneTime }));
    expect(sum(result.byVariant.map((row) => row.totalCents)) + result.fixed.totalCents + result.adjustments.totalCents + result.minimum.topUpCents).toBe(result.totalCents);
    expect(sum(result.byDay.map((row) => row.workCents + row.feeCents))).toBe(result.totalCents);
    expect(sum(result.hourSplits.map((row) => row.cents))).toBe(result.work.perHourCents);
    expect(result.byDay).toHaveLength(31);
    expect(result.byDay[30]!.cumulativeCents).toBe(result.totalCents);
    expect(result.work.perHourCents > ZERO && result.work.perOrderCents > ZERO).toBe(true);
  });
});

describe('refs', () => {
  it('builds and reads every ref (3.6)', () => {
    expect(buildDayRef('b1', '2026-11-02')).toBe('pmb:b1:2026-11-02');
    expect(laborRef.task('p', 't', '2026-11-02')).toBe('pmt:p:t:2026-11-02');
    expect(laborRef.program('p', '2026-11-02')).toBe('pmt:p:program:2026-11-02');
    expect(parseRef('pmb:b1:2026-11-02')).toEqual({ kind: 'build_day', buildId: 'b1', date: '2026-11-02' });
    expect(parseRef(feeRef.order('p', 'b'))).toEqual({ kind: 'order', programId: 'p', buildId: 'b' });
    expect(parseRef(feeRef.hours('p', '2026-11-02'))).toEqual({ kind: 'hours', programId: 'p', date: '2026-11-02' });
    expect(parseRef(feeRef.monthly('p', '2026-11'))).toEqual({ kind: 'monthly', programId: 'p', month: '2026-11' });
    expect(parseRef(feeRef.setup('p', 'c'))).toEqual({ kind: 'setup', programId: 'p', chargeId: 'c' });
    expect(parseRef(feeRef.adjustment('p', 'c'))).toEqual({ kind: 'adjustment', programId: 'p', chargeId: 'c' });
    expect(parseRef(feeRef.minimum('p', '2026-11'))).toEqual({ kind: 'minimum', programId: 'p', month: '2026-11' });
    expect(parseRef('pmt:p:program:2026-11-02')).toEqual({ kind: 'labor', programId: 'p', taskId: null, date: '2026-11-02' });
    expect(parseRef('pmt:p:t:2026-11-02')).toEqual({ kind: 'labor', programId: 'p', taskId: 't', date: '2026-11-02' });
    expect(parseRef('pm:p:2026-11-02')).toBeNull();
    expect(parseRef('pmf:p:other:x')).toBeNull();
  });
  it('says each minimum status', () => {
    expect(['none', 'met', 'short', 'pending'].map((status) => minimumStatusLabel(status as 'none'))).toEqual(['No minimum', 'Minimum met', 'Below minimum', 'Month still open']);
  });
});

describe('charges worth nothing make no line', () => {
  it('a $0 batch fee, a $0 hourly rate, a $0 monthly fee and $0 one time charges post nothing', () => {
    const free: CardVersion = {
      id: 'z1',
      number: 1,
      effectiveFrom: '2026-01-01',
      rules: [],
      lines: [
        line({ id: 'z1-unit', kind: 'per_unit', unitPrice: '1.00' }),
        line({ id: 'z1-order', kind: 'per_order', amountCents: '0' }),
        line({ id: 'z1-hour', kind: 'per_hour', rateCents: 0 }),
        line({ id: 'z1-fee', kind: 'flat_monthly', amountCents: '0' }),
        line({ id: 'z1-min', kind: 'monthly_minimum', amountCents: '100000' }),
      ],
    };
    const finished: FinishedBuild[] = [{ buildId: 'd1', buildKey: 'FREE-1', variantId: null, finishedOn: '2026-11-23', builtQty: '40' }];
    const time: TimeDay[] = [{ workDate: '2026-11-23', buildId: 'd1', variantId: null, minutes: 120 }];
    const oneTime: OneTimeCharge[] = [
      { id: 's0', kind: 'setup', chargeOn: '2026-11-02', amountCents: '0', label: 'Setup', variantId: null, countsTowardMinimum: false },
      { id: 'a0', kind: 'adjustment', chargeOn: '2026-11-03', amountCents: '0', label: 'No change', variantId: null, countsTowardMinimum: true },
    ];
    const result = monthCharges(month({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [free], finished, time, oneTime }));
    expect(result.charges.filter((charge) => charge.cents === ZERO)).toEqual([]);
    expect(result.charges.map((charge) => charge.kind)).toEqual(['minimum_top_up']);
    expect(result.hourSplits).toEqual([]);
    // The minimum preview still shows while the month is open, and is not a ledger row yet.
    expect(result.minimum).toMatchObject({ status: 'pending', gapSoFarCents: BigInt(100000) });
    expect(ledgerRows(result)).toEqual([]);
    const over = monthCharges(month({ month: '2026-11', asOf: '2026-12-01', calendar: OPEN_CALENDAR, versions: [free], finished, time, oneTime }));
    expect(ledgerRows(over).map((row) => [row.kind, row.cents])).toEqual([['minimum_top_up', BigInt(100000)]]);
  });
  it('ledgerRows never returns a 0 cent row', () => {
    const charge = { ref: 'pmf:p:adj:x', kind: 'adjustment' as const, date: '2026-11-02', cents: ZERO, quantity: null, unitPrice: null, variantId: null, buildId: null, versionId: null, lineId: null, oneTimeId: 'x', label: 'x', countsTowardMinimum: false, posted: true };
    expect(ledgerRows({ charges: [charge, { ...charge, ref: 'pmf:p:adj:y', cents: BigInt(5) }] }).map((row) => row.ref)).toEqual(['pmf:p:adj:y']);
  });
  it('lines below $0 never charge (the same floor for every kind)', () => {
    const negative: CardVersion = {
      id: 'n1',
      number: 1,
      effectiveFrom: '2026-01-01',
      rules: [],
      lines: [
        line({ id: 'n1-order', kind: 'per_order', amountCents: '-4500' }),
        line({ id: 'n1-hour', kind: 'per_hour', rateCents: -4200 }),
        line({ id: 'n1-fee', kind: 'flat_monthly', amountCents: '-150000' }),
        line({ id: 'n1-min', kind: 'monthly_minimum', amountCents: '-3000000' }),
      ],
    };
    const finished: FinishedBuild[] = [{ buildId: 'd1', buildKey: 'NEG-1', variantId: null, finishedOn: '2026-11-23', builtQty: '40' }];
    const time: TimeDay[] = [{ workDate: '2026-11-23', buildId: 'd1', variantId: null, minutes: 120 }];
    const result = monthCharges(month({ month: '2026-11', asOf: '2026-12-01', calendar: OPEN_CALENDAR, versions: [negative], finished, time, oneTime: [] }));
    expect(result.charges).toEqual([]);
    expect(result.totalCents).toBe(ZERO);
    expect(result.minimum.status).toBe('none');
  });
});

describe('A6 fixed lines never charge more than one month', () => {
  const version = (id: string, from: IsoDate, cents: string, prorate: boolean, chargeWhilePaused: boolean): CardVersion => ({
    id,
    number: null,
    effectiveFrom: from,
    rules: [],
    lines: [line({ id: `${id}-fee`, kind: 'flat_monthly', amountCents: cents, prorate, chargeWhilePaused }), line({ id: `${id}-min`, kind: 'monthly_minimum', amountCents: cents, prorate, chargeWhilePaused })],
  });

  it('mixed charge while paused options stay inside one month (the critic repro)', () => {
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-09', to: '2026-11-15' }] };
    const versions = [version('v1', '2026-01-01', '150000', false, true), version('v2', '2026-11-16', '150000', false, false)];
    const fee = fixedLineForMonth({ month: '2026-11', calendar: paused, versions, kind: 'flat_monthly' });
    // v1 charges Nov 1 to 15 (paused days too), v2 charges Nov 16 to 30: every day charges, so one whole month.
    expect(fee.cents).toBe(BigInt(150000));
    expect(sum(fee.segments.map((segment) => segment.cents))).toBe(BigInt(150000));
    // The minimum uses the same function, so the top up is never too high either.
    const result = monthCharges(month({ month: '2026-11', calendar: paused, versions, oneTime: [], asOf: '2026-12-01' }));
    expect(result.minimum.minimumCents).toBe(BigInt(150000));
    expect(result.minimum.topUpCents).toBe(BigInt(150000));
  });

  it('a paused stretch under a line that does not charge while paused shrinks the frame for every prorate off line', () => {
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-01', to: '2026-11-10' }] };
    // v1 does not charge while paused, so Nov 1 to 10 do not count; v2 is 20 of the 20 charged days.
    const versions = [version('v1', '2026-01-01', '150000', false, false), version('v2', '2026-11-11', '180000', false, true)];
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions, kind: 'flat_monthly' }).cents).toBe(BigInt(180000));
  });

  it('holds over random versions, options, pauses and active ranges', () => {
    const random = seeded(20261125);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const days = eachDay('2026-11-01', '2026-11-30');
    const amounts = ['150000', '180000', '100001', '99999', '1', '3', '7', '2500000'];
    let checked = 0;
    for (let run = 0; run < 4000; run += 1) {
      const count = 1 + Math.floor(random() * 4);
      const sameAmount = random() < 0.4;
      const amount = pick(amounts);
      const starts = [...new Set(Array.from({ length: count }, (_, index) => (index === 0 && random() < 0.7 ? '2026-10-15' : pick(days))))].sort();
      const versions = starts.map((from, index) => version(`r${index}`, from, sameAmount ? amount : pick(amounts), random() < 0.5, random() < 0.5));
      const pausedFrom = random() < 0.5 ? pick(days) : null;
      const pausedTo = pausedFrom ? pick(days.filter((date) => date >= pausedFrom)) : null;
      const activeFrom = random() < 0.3 ? pick(days) : null;
      const activeTo = random() < 0.3 ? pick(days.filter((date) => activeFrom === null || date >= activeFrom)) : null;
      const calendar = { ...OPEN_CALENDAR, activeFrom, activeTo, paused: pausedFrom && pausedTo ? [{ from: pausedFrom, to: pausedTo }] : [] };
      for (const kind of ['flat_monthly', 'monthly_minimum'] as const) {
        const result = fixedLineForMonth({ month: '2026-11', calendar, versions, kind });
        const largest = versions.reduce((top, row) => (BigInt(row.lines[0]!.amountCents!) > top ? BigInt(row.lines[0]!.amountCents!) : top), ZERO);
        expect(result.cents <= largest).toBe(true);
        expect(result.cents >= ZERO).toBe(true);
        expect(sum(result.segments.map((segment) => segment.cents))).toBe(result.cents);
        // One amount, active all month, a line every day: exactly one month whenever no
        // prorate on line loses a paused day (a prorate on line charges part of a paused month, E36).
        const wholeMonth = activeFrom === null && activeTo === null && starts[0]! <= '2026-11-01';
        const losesPausedDay = calendar.paused.length > 0 && versions.some((row) => row.lines[0]!.prorate) && result.segments.some((segment) => segment.days < eachDay(segment.from, segment.to).length);
        const someDayUncharged = calendar.paused.length > 0 && result.segments.reduce((total, segment) => total + segment.days, 0) < 30;
        if (sameAmount && wholeMonth && !losesPausedDay && !(someDayUncharged && versions.some((row) => row.lines[0]!.prorate))) {
          expect(result.cents).toBe(BigInt(amount));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('every prorate off mix adds up to at most one month', () => {
    const random = seeded(7);
    const days = eachDay('2026-11-01', '2026-11-30');
    for (let run = 0; run < 3000; run += 1) {
      const starts = [...new Set(['2026-10-01', ...Array.from({ length: 1 + Math.floor(random() * 3) }, () => days[Math.floor(random() * 30)] as IsoDate)])].sort();
      const versions = starts.map((from, index) => version(`p${index}`, from, String(100000 + Math.floor(random() * 200000)), false, random() < 0.5));
      const from = days[Math.floor(random() * 30)] as IsoDate;
      const calendar = { ...OPEN_CALENDAR, paused: [{ from, to: days[Math.min(29, days.indexOf(from) + Math.floor(random() * 10))] as IsoDate }] };
      const result = fixedLineForMonth({ month: '2026-11', calendar, versions, kind: 'flat_monthly' });
      const largest = versions.reduce((top, row) => (BigInt(row.lines[0]!.amountCents!) > top ? BigInt(row.lines[0]!.amountCents!) : top), ZERO);
      expect(result.cents <= largest).toBe(true);
    }
  });
});

describe('month to date never counts a fee before its version is in force (M3)', () => {
  const noFee: CardVersion = { id: 'v1', number: 1, effectiveFrom: '2026-01-01', rules: [], lines: [line({ id: 'v1-unit', kind: 'per_unit', unitPrice: '1.00' })] };
  const fee: CardVersion = { id: 'v2', number: 2, effectiveFrom: '2026-11-16', rules: [], lines: [line({ id: 'v2-fee', kind: 'flat_monthly', amountCents: '180000', prorate: false })] };
  it('E34 on Nov 5 has no fee yet, and from Nov 16 the fee is dated Nov 16', () => {
    const early = monthCharges(month({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [noFee, fee], oneTime: [], asOf: '2026-11-05' }));
    expect(early.fixed.monthlyFeeCents).toBe(ZERO);
    expect(early.charges.some((charge) => charge.kind === 'flat_monthly')).toBe(false);
    expect(ledgerRows(early)).toEqual([]);
    const late = monthCharges(month({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [noFee, fee], oneTime: [], asOf: '2026-11-16' }));
    expect(late.charges.find((charge) => charge.kind === 'flat_monthly')).toMatchObject({ ref: `pmf:${PROGRAM_ID}:monthly:2026-11`, date: '2026-11-16', cents: BigInt(90000), versionId: 'v2' });
  });
  it('E16 a fee in force on the 1st still dates on the 1st', () => {
    const result = monthCharges(month({ month: '2026-11', asOf: '2026-11-01' }));
    expect(result.charges.find((charge) => charge.kind === 'flat_monthly')).toMatchObject({ date: '2026-11-01', cents: BigInt(150000) });
  });
});

describe('monthCharges refuses bad input before any math', () => {
  it('refuses an asOf or a month that is not real', () => {
    expect(() => monthCharges(month({ month: '2026-11', asOf: 'nope' }))).toThrow(new RangeError('Not a YYYY-MM-DD date: "nope"'));
    expect(() => monthCharges(month({ month: '2026-11', asOf: '2026-02-30' }))).toThrow(RangeError);
    expect(() => monthCharges(month({ month: '2026-13' }))).toThrow(new RangeError('Not a YYYY-MM month: "2026-13"'));
    expect(() => monthCharges(month({ month: 'November' as never }))).toThrow(RangeError);
  });

  it('refuses two inputs that would make the same ref', () => {
    const rows = outputFor(['2026-11-02']);
    expect(() => monthCharges(month({ month: '2026-11', output: [...rows, rows[0]!] }))).toThrow(new RangeError(`Duplicate charge ref pmb:${rows[0]!.buildId}:2026-11-02`));
    const done: FinishedBuild = { buildId: 'b1', buildKey: 'DUDE-1', variantId: null, finishedOn: '2026-11-23', builtQty: '10' };
    const batch: CardVersion = { id: 'b', number: 1, effectiveFrom: '2026-01-01', rules: [], lines: [line({ id: 'b-order', kind: 'per_order', amountCents: '4500' })] };
    expect(() => monthCharges(month({ month: '2026-11', versions: [batch], finished: [done, done] }))).toThrow(new RangeError(`Duplicate charge ref pmf:${PROGRAM_ID}:order:b1`));
    const credit: OneTimeCharge = { id: 'c1', kind: 'adjustment', chargeOn: '2026-11-03', amountCents: '-500', label: 'Credit', variantId: null, countsTowardMinimum: false };
    expect(() => monthCharges(month({ month: '2026-11', oneTime: [credit, credit] }))).toThrow(new RangeError(`Duplicate charge ref pmf:${PROGRAM_ID}:adj:c1`));
    expect(() => monthCharges(month({ month: '2026-11', oneTime: [credit, { ...credit, kind: 'setup' }] }))).toThrow(RangeError);
    // One of each is fine and charges once.
    expect(monthCharges(month({ month: '2026-11', versions: [batch], finished: [done] })).work.perOrderCents).toBe(BigInt(4500));
  });
});
