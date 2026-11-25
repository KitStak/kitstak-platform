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
  });
  it('prorate off, charge while paused off, paused Nov 9 to 15 = 115000 (prorate never changes how a pause bills)', () => {
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-09', to: '2026-11-15' }] };
    // Active all month, so A = D = 30 and prorate has no effect: the 7 paused days leave d only.
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions: [fee('v1', '2026-11-01', '150000', false, false)], kind: 'flat_monthly' }).cents).toBe(BigInt(115000));
    // Paused Nov 2 to 30 leaves one day that charges: divRound(150000 * 1, 30) = 5000, with prorate on or off.
    const most = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-02', to: '2026-11-30' }] };
    expect(fixedLineForMonth({ month: '2026-11', calendar: most, versions: [fee('v1', '2026-11-01', '150000', false, false)], kind: 'flat_monthly' }).cents).toBe(BigInt(5000));
    expect(fixedLineForMonth({ month: '2026-11', calendar: most, versions: [fee('v1', '2026-11-01', '150000', true, false)], kind: 'flat_monthly' }).cents).toBe(BigInt(5000));
    // With charge while paused on the pause bills nothing less.
    expect(fixedLineForMonth({ month: '2026-11', calendar: most, versions: [fee('v1', '2026-11-01', '150000', false, true)], kind: 'flat_monthly' }).cents).toBe(BigInt(150000));
    // A program that starts Nov 15 with prorate off has A = 16: a pause Nov 20 to 23 leaves 12 of 16 days.
    const startsMid = { ...OPEN_CALENDAR, activeFrom: '2026-11-15', paused: [{ from: '2026-11-20', to: '2026-11-23' }] };
    expect(fixedLineForMonth({ month: '2026-11', calendar: startsMid, versions: [fee('v1', '2026-11-01', '150000', false, false)], kind: 'flat_monthly' }).cents).toBe(BigInt(112500));
  });
  it('a program that ends mid month and a month fully paused', () => {
    const ending = { ...OPEN_CALENDAR, activeTo: '2026-11-10' };
    expect(fixedLineForMonth({ month: '2026-11', calendar: ending, versions: [fee('v1', '2026-11-01', '150000', true)], kind: 'flat_monthly' }).cents).toBe(BigInt(50000));
    const allPaused = { ...OPEN_CALENDAR, paused: [{ from: '2026-10-20', to: null }] };
    // Nothing charges, but the line is still in force (a minimum reads as met, not "No minimum").
    expect(fixedLineForMonth({ month: '2026-11', calendar: allPaused, versions: [fee('v1', '2026-11-01', '150000', true, false)], kind: 'flat_monthly' })).toEqual({ cents: ZERO, segments: [], inForce: true });
    expect(fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [fee('v1', '2026-11-01', null, true)], kind: 'flat_monthly' })).toEqual({ cents: ZERO, segments: [], inForce: false });
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
  it('equal versions without proration and with paused days bill the same as one version', () => {
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-09', to: '2026-11-15' }] };
    const off = [fee('a', '2026-11-01', '100001', false, false), fee('b', '2026-11-11', '100001', false, false), fee('c', '2026-11-21', '100001', false, false)];
    const one = fixedLineForMonth({ month: '2026-11', calendar: paused, versions: [fee('a', '2026-11-01', '100001', false, false)], kind: 'flat_monthly' });
    // 23 of 30 days charge: divRound(100001 * 23, 30) = 76667, split over the three versions.
    expect(one.cents).toBe(BigInt(76667));
    const three = fixedLineForMonth({ month: '2026-11', calendar: paused, versions: off, kind: 'flat_monthly' });
    expect(three.cents).toBe(BigInt(76667));
    expect(sum(three.segments.map((segment) => segment.cents))).toBe(BigInt(76667));
    const startsMid = { ...OPEN_CALENDAR, activeFrom: '2026-11-15' };
    const on = [fee('a', '2026-11-01', '100001', true), fee('b', '2026-11-20', '100001', true), fee('c', '2026-11-25', '100001', true)];
    expect(fixedLineForMonth({ month: '2026-11', calendar: startsMid, versions: on, kind: 'flat_monthly' }).cents).toBe(BigInt(53334));
  });
  it('proposed E48: a 31 day month split 10 and 21 days rounds each part once, then adds (SPEC 3.5 step 5)', () => {
    // $1,500.00 for Dec 1 to 10, then $1,800.00 for Dec 11 to 31:
    // divRound(150000 * 10, 31) = 48387 (48387.10) and divRound(180000 * 21, 31) = 121935 (121935.48).
    const result = fixedLineForMonth({ month: '2026-12', calendar: OPEN_CALENDAR, versions: [fee('a', '2026-12-01', '150000', true), fee('b', '2026-12-11', '180000', true)], kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(170322));
    expect(result.segments.map((segment) => [segment.versionId, segment.days, segment.cents])).toEqual([
      ['a', 10, BigInt(48387)],
      ['b', 21, BigInt(121935)],
    ]);
    expect(sum(result.segments.map((segment) => segment.cents))).toBe(result.cents);
  });
  it('proposed E49: paused Nov 1 to 15 under a line that does not charge while paused, then a prorate off line from Nov 16, charges half a month (150000)', () => {
    // v1 ($1,000.00) charges nothing Nov 1 to 15 (paused, charge while paused off). v2 ($3,000.00,
    // prorate off) has the whole active month as its frame (A = 30), so its 15 days are
    // divRound(300000 * 15, 30) = 150000. Paused days only ever leave d.
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-01', to: '2026-11-15' }] };
    const versions = [fee('a', '2026-11-01', '100000', true, false), fee('b', '2026-11-16', '300000', false, true)];
    const result = fixedLineForMonth({ month: '2026-11', calendar: paused, versions, kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(150000));
    expect(result.segments.map((segment) => [segment.versionId, segment.from, segment.to, segment.days, segment.cents])).toEqual([['b', '2026-11-16', '2026-11-30', 15, BigInt(150000)]]);
    // The same v2 with charge while paused off bills the same: none of its days are paused.
    const offToo = [fee('a', '2026-11-01', '100000', true, false), fee('b', '2026-11-16', '300000', false, false)];
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions: offToo, kind: 'flat_monthly' }).cents).toBe(BigInt(150000));
  });
  it('each line rounds with its own frame: prorate on over D, prorate off over A', () => {
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-09', to: '2026-11-15' }] };
    // v1 prorate off, does not charge while paused: d = 8 (Nov 1 to 10 less the paused Nov 9 and
    // 10) over A = 30 (active all month) gives divRound(150000 * 8, 30) = 40000.
    // v2 prorate on, charges while paused: d = 20 (Nov 11 to 30) gives divRound(180000 * 20, 30) = 120000.
    const versions = [fee('v1', '2026-11-01', '150000', false, false), fee('v2', '2026-11-11', '180000', true, true)];
    const result = fixedLineForMonth({ month: '2026-11', calendar: paused, versions, kind: 'flat_monthly' });
    expect(result.segments.map((segment) => [segment.versionId, segment.days, segment.cents])).toEqual([
      ['v1', 8, BigInt(40000)],
      ['v2', 20, BigInt(120000)],
    ]);
    expect(result.cents).toBe(BigInt(160000));
    // A program that starts Nov 5: A = 26 and D = 30, so the two flags now give two frames.
    const startsMid = { ...OPEN_CALENDAR, activeFrom: '2026-11-05', paused: [{ from: '2026-11-09', to: '2026-11-15' }] };
    const mid = fixedLineForMonth({ month: '2026-11', calendar: startsMid, versions, kind: 'flat_monthly' });
    // v1: d = 4 (Nov 5 to 8, Nov 9 and 10 paused) over 26 = divRound(600000, 26) = 23077; v2: 120000.
    expect(mid.segments.map((segment) => [segment.versionId, segment.days, segment.cents])).toEqual([
      ['v1', 4, BigInt(23077)],
      ['v2', 20, BigInt(120000)],
    ]);
  });
  it('a split into many same terms parts adds back to exactly one month, for every amount', () => {
    for (const amount of ['100001', '150001', '99999', '1', '2', '29', '31', '2500000']) {
      const daily = eachDay('2026-11-01', '2026-11-30').map((date) => fee(`v-${date}`, date, amount, true));
      const result = fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions: daily, kind: 'flat_monthly' });
      // Thirty daily versions with the same fee are one rounding group, so the month is exactly the fee.
      expect(result.cents).toBe(BigInt(amount));
      expect(result.segments).toHaveLength(30);
      expect(sum(result.segments.map((segment) => segment.cents))).toBe(BigInt(amount));
      // The cents spread by days: no two parts differ by more than one cent.
      const values = result.segments.map((segment) => segment.cents);
      const high = values.reduce((top, value) => (value > top ? value : top), ZERO);
      const low = values.reduce((bottom, value) => (value < bottom ? value : bottom), high);
      expect(high - low <= BigInt(1)).toBe(true);
    }
  });
  it('three same fee versions in December (2, 2 and 27 days) bill exactly 150000', () => {
    // Rounded one by one these would be 9677 + 9677 + 130645 = 149999. They share terms, so they
    // round once as one group: divRound(150000 * 31, 31) = 150000, split 2 : 2 : 27.
    const versions = [fee('a', '2026-01-01', '150000', true), fee('b', '2026-12-03', '150000', true), fee('c', '2026-12-05', '150000', true)];
    const result = fixedLineForMonth({ month: '2026-12', calendar: OPEN_CALENDAR, versions, kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(150000));
    expect(result.segments.map((segment) => [segment.versionId, segment.days, segment.cents])).toEqual([
      ['a', 2, BigInt(9678)],
      ['b', 2, BigInt(9677)],
      ['c', 27, BigInt(130645)],
    ]);
  });
  it('same fee versions with random flags, no pauses and active all month always add back to the fee', () => {
    const random = seeded(31);
    for (const monthKey of ['2026-11', '2026-12', '2027-02'] as const) {
      const days = eachDay(`${monthKey}-01` as IsoDate, `${monthKey}-${monthKey === '2027-02' ? '28' : monthKey === '2026-11' ? '30' : '31'}` as IsoDate);
      for (let run = 0; run < 1500; run += 1) {
        const amount = String(1 + Math.floor(random() * 5000000));
        const count = 1 + Math.floor(random() * 12);
        const starts = [...new Set(['2026-01-01' as IsoDate, ...Array.from({ length: count }, () => days[Math.floor(random() * days.length)] as IsoDate)])].sort();
        // The flags are random per version. With no pauses and the program active all month,
        // prorate and "Charge while paused" give the same frame (D == A), so they never split.
        const versions = starts.map((from, index) => fee(`s${index}`, from, amount, random() < 0.5, random() < 0.5));
        const result = fixedLineForMonth({ month: monthKey, calendar: OPEN_CALENDAR, versions, kind: 'flat_monthly' });
        expect(result.cents).toBe(BigInt(amount));
        expect(sum(result.segments.map((segment) => segment.cents))).toBe(BigInt(amount));
      }
    }
  });
  it('a flag with no effect that month never splits the rounding (no pauses, chargeWhilePaused differs)', () => {
    // b does not charge while paused, but nothing is paused, so all three have frame 31 and round
    // once: 150000, not 9677 + 9677 + 130645 = 149999.
    const versions = [fee('a', '2026-01-01', '150000', true), fee('b', '2026-12-03', '150000', true, false), fee('c', '2026-12-05', '150000', true)];
    const result = fixedLineForMonth({ month: '2026-12', calendar: OPEN_CALENDAR, versions, kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(150000));
    expect(sum(result.segments.map((segment) => segment.cents))).toBe(BigInt(150000));
    expect(result.segments.map((segment) => segment.days)).toEqual([2, 2, 27]);
  });
  it('a flag with no effect that month never splits the rounding (active all month, prorate differs)', () => {
    // b has prorate off, but the program is active all month, so A == D == 31 and all three round once.
    const versions = [fee('a', '2026-01-01', '150000', true), fee('b', '2026-12-03', '150000', false), fee('c', '2026-12-05', '150000', true)];
    const result = fixedLineForMonth({ month: '2026-12', calendar: OPEN_CALENDAR, versions, kind: 'flat_monthly' });
    expect(result.cents).toBe(BigInt(150000));
    expect(sum(result.segments.map((segment) => segment.cents))).toBe(BigInt(150000));
  });
  it('proposed E50: a line that does not charge while paused is not charged more for a pause before it', () => {
    // Paused Nov 1 to 10. v1 ($1,500.00, prorate off, charges while paused) is in force Nov 1 to
    // 15, so its paused days charge: divRound(150000 * 15, 30) = 75000. v2 ($1,000.00, prorate
    // off, does not charge while paused) from Nov 16 has no paused days of its own, so its 15 days
    // are divRound(100000 * 15, 30) = 50000: the same as in a month with no pauses.
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-01', to: '2026-11-10' }] };
    const versions = [fee('v1', '2026-11-01', '150000', false, true), fee('v2', '2026-11-16', '100000', false, false)];
    const result = fixedLineForMonth({ month: '2026-11', calendar: paused, versions, kind: 'flat_monthly' });
    expect(result.segments.map((segment) => [segment.versionId, segment.days, segment.cents])).toEqual([
      ['v1', 15, BigInt(75000)],
      ['v2', 15, BigInt(50000)],
    ]);
    expect(result.cents).toBe(BigInt(125000));
    const unpaused = fixedLineForMonth({ month: '2026-11', calendar: OPEN_CALENDAR, versions, kind: 'flat_monthly' });
    expect(unpaused.segments[1]?.cents).toBe(BigInt(50000));
  });
  it('proposed E50b: two versions that both skip paused days bill the 20 days that charge', () => {
    // Paused Nov 1 to 10, both versions $1,000.00 with prorate off and the option off: A = 30,
    // v1 has 5 days that charge and v2 15. Same amount and frame, so one group:
    // divRound(100000 * 20, 30) = 66667, split 5 : 15 as 16667 + 50000.
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-01', to: '2026-11-10' }] };
    const versions = [fee('v1', '2026-11-01', '100000', false, false), fee('v2', '2026-11-16', '100000', false, false)];
    const result = fixedLineForMonth({ month: '2026-11', calendar: paused, versions, kind: 'flat_monthly' });
    expect(result.segments.map((segment) => [segment.versionId, segment.days, segment.cents])).toEqual([
      ['v1', 5, BigInt(16667)],
      ['v2', 15, BigInt(50000)],
    ]);
    expect(result.cents).toBe(BigInt(66667));
    // The same as one version over the same days.
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions: [versions[0]!], kind: 'flat_monthly' }).cents).toBe(BigInt(66667));
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

describe('a minimum in force in a month paused all month', () => {
  const waived: CardVersion = {
    id: 'w1',
    number: 1,
    effectiveFrom: '2026-01-01',
    rules: [],
    lines: [
      line({ id: 'w1-unit', kind: 'per_unit', unitPrice: '1.95' }),
      line({ id: 'w1-min', kind: 'monthly_minimum', amountCents: '3000000', chargeWhilePaused: false }),
      line({ id: 'w1-fee', kind: 'flat_monthly', amountCents: '150000', chargeWhilePaused: false }),
    ],
  };
  const pausedAllMonth = { ...OPEN_CALENDAR, paused: [{ from: '2026-10-20', to: null }] };
  it('reads as met (0 cents) once the month is over, never "No minimum"', () => {
    const result = monthCharges(month({ month: '2026-11', asOf: '2026-12-01', calendar: pausedAllMonth, versions: [waived], oneTime: [] }));
    expect(result.minimum).toEqual({ minimumCents: ZERO, gapSoFarCents: ZERO, topUpCents: ZERO, status: 'met' });
    expect(minimumStatusLabel(result.minimum.status)).toBe('Minimum met');
    expect(result.fixed.monthlyFeeCents).toBe(ZERO);
    expect(result.totalCents).toBe(ZERO);
    expect(ledgerRows(result)).toEqual([]);
  });
  it('reads as pending while the month is open', () => {
    const result = monthCharges(month({ month: '2026-11', asOf: '2026-11-25', calendar: pausedAllMonth, versions: [waived], oneTime: [] }));
    expect(result.minimum).toEqual({ minimumCents: ZERO, gapSoFarCents: ZERO, topUpCents: ZERO, status: 'pending' });
  });
  it('a $0 minimum never tops up, even when a credit that counts toward it passes the work', () => {
    const credit: OneTimeCharge = { id: 'c1', kind: 'adjustment', chargeOn: '2026-11-10', amountCents: '-20000', label: 'Credit', variantId: null, countsTowardMinimum: true };
    const result = monthCharges(month({ month: '2026-11', asOf: '2026-12-01', calendar: pausedAllMonth, versions: [waived], oneTime: [credit] }));
    expect(result.minimum).toEqual({ minimumCents: ZERO, gapSoFarCents: ZERO, topUpCents: ZERO, status: 'met' });
    expect(result.totalCents).toBe(BigInt(-20000));
  });
  it('a card with no minimum line still says No minimum', () => {
    const noMinimum: CardVersion = { ...waived, lines: waived.lines.filter((item) => item.kind !== 'monthly_minimum') };
    const result = monthCharges(month({ month: '2026-11', asOf: '2026-12-01', calendar: pausedAllMonth, versions: [noMinimum], oneTime: [] }));
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
    // v1 charges Nov 1 to 15, paused days too: divRound(150000 * 15, 30) = 75000. v2 does not
    // charge while paused, but none of its days are paused, so its 15 days are 75000 too.
    expect(fee.cents).toBe(BigInt(150000));
    expect(fee.segments.map((segment) => segment.cents)).toEqual([BigInt(75000), BigInt(75000)]);
    expect(sum(fee.segments.map((segment) => segment.cents))).toBe(BigInt(150000));
    // The minimum uses the same function, so the top up is never too high either.
    const result = monthCharges(month({ month: '2026-11', calendar: paused, versions, oneTime: [], asOf: '2026-12-01' }));
    expect(result.minimum.minimumCents).toBe(BigInt(150000));
    expect(result.minimum.topUpCents).toBe(BigInt(150000));
  });

  it('a paused stretch leaves only d, never the frame', () => {
    const paused = { ...OPEN_CALENDAR, paused: [{ from: '2026-11-01', to: '2026-11-10' }] };
    // v1 does not charge while paused, so Nov 1 to 10 charge nothing; v2's 20 days are
    // divRound(180000 * 20, 30) = 120000.
    const versions = [version('v1', '2026-01-01', '150000', false, false), version('v2', '2026-11-11', '180000', false, true)];
    expect(fixedLineForMonth({ month: '2026-11', calendar: paused, versions, kind: 'flat_monthly' }).cents).toBe(BigInt(120000));
  });

  /**
   * An oracle that shares nothing with the code: the exact share of the month in rationals, day by
   * day. Each active day that charges adds `a / frame` of the version in force that day, with
   * frame `D` (30) when its line has prorate on and `A` (the active days, paused days included)
   * when it is off. A paused day charges only when the line charges while paused. It returns the
   * exact amount as `numerator / denominator`, the amounts in force, and how many segments
   * (runs of one version) charge, which bounds how many roundings the code may make.
   */
  const exactShare = (calendar: typeof OPEN_CALENDAR, versions: readonly CardVersion[], kind: 'flat_monthly' | 'monthly_minimum'): { numerator: bigint; denominator: bigint; segments: number; amounts: bigint[] } => {
    const monthDays = 30;
    const from = calendar.activeFrom ?? '2026-11-01';
    const to = calendar.activeTo ?? '2026-11-30';
    const active = eachDay('2026-11-01', '2026-11-30').filter((date) => date >= from && date <= to);
    const isPaused = (date: IsoDate): boolean => calendar.paused.some((range) => date >= range.from && (range.to === null || date <= range.to));
    const inForce = (date: IsoDate): CardVersion | undefined => [...versions].filter((row) => row.effectiveFrom <= date).sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? 1 : -1))[0];
    const denominator = BigInt(monthDays * Math.max(1, active.length));
    let numerator = ZERO;
    const amounts: bigint[] = [];
    const charging = new Set<string>();
    let segment = 0;
    let previous: string | null = null;
    for (const date of active) {
      const row = inForce(date);
      const fixed = row?.lines.find((item) => item.kind === kind);
      if (!row || !fixed) {
        previous = null;
        continue;
      }
      if (row.id !== previous) segment += 1;
      previous = row.id;
      const amount = BigInt(fixed.amountCents!);
      amounts.push(amount);
      if (isPaused(date) && !fixed.chargeWhilePaused) continue;
      charging.add(String(segment));
      const frame = fixed.prorate ? monthDays : active.length;
      numerator += amount * (denominator / BigInt(frame));
    }
    return { numerator, denominator, segments: charging.size, amounts };
  };

  const randomCase = (random: () => number, options: { readonly allMonth?: boolean } = {}): { calendar: typeof OPEN_CALENDAR; versions: CardVersion[]; sameAmount: boolean; firstOnTime: boolean } => {
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const days = eachDay('2026-11-01', '2026-11-30');
    const amounts = ['150000', '180000', '100001', '99999', '1', '3', '7', '2500000'];
    const count = 1 + Math.floor(random() * 4);
    const sameAmount = random() < 0.4;
    const amount = pick(amounts);
    const starts = [...new Set(Array.from({ length: count }, (_, index) => (index === 0 && random() < 0.7 ? '2026-10-15' : pick(days))))].sort();
    const versions = starts.map((from, index) => version(`r${index}`, from, sameAmount ? amount : pick(amounts), random() < 0.5, random() < 0.5));
    const pausedFrom = random() < 0.5 ? pick(days) : null;
    const pausedTo = pausedFrom ? pick(days.filter((date) => date >= pausedFrom)) : null;
    const activeFrom = !options.allMonth && random() < 0.3 ? pick(days) : null;
    const activeTo = !options.allMonth && random() < 0.3 ? pick(days.filter((date) => activeFrom === null || date >= activeFrom)) : null;
    const calendar = { ...OPEN_CALENDAR, activeFrom, activeTo, paused: pausedFrom && pausedTo ? [{ from: pausedFrom, to: pausedTo }] : [] };
    return { calendar, versions, sameAmount, firstOnTime: (starts[0] as string) <= '2026-11-01' };
  };

  it('stays within half a cent per rounding of the exact rational share, over random versions, options, pauses and active ranges', () => {
    const random = seeded(20261125);
    let wholeMonths = 0;
    let checked = 0;
    for (let run = 0; run < 4000; run += 1) {
      const { calendar, versions, sameAmount, firstOnTime } = randomCase(random);
      for (const kind of ['flat_monthly', 'monthly_minimum'] as const) {
        const result = fixedLineForMonth({ month: '2026-11', calendar, versions, kind });
        const exact = exactShare(calendar, versions, kind);
        // |result - exact| <= segments * 0.5 cent, in whole numbers: |2 * (result * den - num)| <= segments * den.
        const diff = result.cents * exact.denominator - exact.numerator;
        const distance = diff < ZERO ? -diff : diff;
        expect(BigInt(2) * distance <= BigInt(exact.segments) * exact.denominator).toBe(true);
        // Never more than one month of the largest amount in force (A6), never below 0.
        const largest = exact.amounts.reduce((top, amount) => (amount > top ? amount : top), ZERO);
        expect(result.cents <= largest).toBe(true);
        expect(result.cents >= ZERO).toBe(true);
        expect(sum(result.segments.map((segment) => segment.cents))).toBe(result.cents);
        checked += 1;
        // Every version the same amount, in force from before the month, active all month and
        // nothing paused: exactly one month, whatever the flags.
        if (sameAmount && firstOnTime && calendar.activeFrom === null && calendar.activeTo === null && calendar.paused.length === 0) {
          expect(result.cents).toBe(BigInt(versions[0]!.lines[0]!.amountCents!));
          wholeMonths += 1;
        }
      }
    }
    expect(checked).toBe(8000);
    expect(wholeMonths).toBeGreaterThan(50);
  });

  it('A6: prorate has no effect when the program is active all month, over random pauses', () => {
    const random = seeded(606);
    const flip = (versions: readonly CardVersion[], prorate: boolean): CardVersion[] => versions.map((row) => ({ ...row, lines: row.lines.map((item) => ({ ...item, prorate })) }));
    let paused = 0;
    for (let run = 0; run < 3000; run += 1) {
      const { calendar, versions } = randomCase(random, { allMonth: true });
      if (calendar.paused.length > 0) paused += 1;
      for (const kind of ['flat_monthly', 'monthly_minimum'] as const) {
        const on = fixedLineForMonth({ month: '2026-11', calendar, versions: flip(versions, true), kind });
        const off = fixedLineForMonth({ month: '2026-11', calendar, versions: flip(versions, false), kind });
        const mixed = fixedLineForMonth({ month: '2026-11', calendar, versions, kind });
        expect(off.cents).toBe(on.cents);
        expect(mixed.cents).toBe(on.cents);
        expect(off.segments.map((segment) => segment.cents)).toEqual(on.segments.map((segment) => segment.cents));
      }
    }
    expect(paused).toBeGreaterThan(1000);
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

describe('the monthly fee is dated the first active day (3.5 step 5, E16)', () => {
  const noFee: CardVersion = { id: 'v1', number: 1, effectiveFrom: '2026-01-01', rules: [], lines: [line({ id: 'v1-unit', kind: 'per_unit', unitPrice: '1.00' })] };
  const fee: CardVersion = { id: 'v2', number: 2, effectiveFrom: '2026-11-16', rules: [], lines: [line({ id: 'v2-fee', kind: 'flat_monthly', amountCents: '180000', prorate: false })] };
  it('E34 a fee from a version that starts Nov 16 is one charge for the month, dated Nov 1 and posted from Nov 1', () => {
    for (const asOf of ['2026-11-01', '2026-11-10', '2026-11-16', '2026-11-30'] as const) {
      const result = monthCharges(month({ month: '2026-11', calendar: OPEN_CALENDAR, versions: [noFee, fee], oneTime: [], asOf }));
      expect(result.fixed.monthlyFeeCents).toBe(BigInt(90000));
      expect(result.charges.find((charge) => charge.kind === 'flat_monthly')).toMatchObject({ ref: `pmf:${PROGRAM_ID}:monthly:2026-11`, date: '2026-11-01', cents: BigInt(90000), versionId: 'v2', lineId: 'v2-fee', posted: true });
      expect(ledgerRows(result).map((row) => [row.kind, row.chargeDate, row.cents])).toEqual([['flat_monthly', '2026-11-01', BigInt(90000)]]);
    }
  });
  it('E16 a fee in force on the 1st dates on the 1st, a Sunday', () => {
    const result = monthCharges(month({ month: '2026-11', asOf: '2026-11-01' }));
    expect(result.charges.find((charge) => charge.kind === 'flat_monthly')).toMatchObject({ date: '2026-11-01', cents: BigInt(150000) });
  });
  it('a program that starts mid month dates the fee on its first day and posts nothing before it', () => {
    const before = monthCharges(month({ month: '2026-09', asOf: '2026-09-14' }));
    expect(before.charges.some((charge) => charge.kind === 'flat_monthly')).toBe(false);
    const on = monthCharges(month({ month: '2026-09', asOf: '2026-09-15' }));
    expect(on.charges.find((charge) => charge.kind === 'flat_monthly')).toMatchObject({ date: '2026-09-15', cents: BigInt(80000) });
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
