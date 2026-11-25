import { describe, expect, it } from 'vitest';
import { CALENDAR, SETUP, VARIANTS, VERSIONS, line } from './glove.fixture';
import { HOURS_NOT_PROJECTED_NOTE, PROJECTION_PROGRAM_ID, projectMonth } from './projection';
import type { ScheduleRule } from './schedule';
import type { CardVersion } from './types';

const EVERY_WORK_DAY: ScheduleRule = { pattern: 'weekdays', days: [], intervalWeeks: 1, startsOn: '2026-09-15', endsOn: null, skipHolidays: true, skipDates: [] };
const LINES = VARIANTS.map((variant) => ({ variantId: variant.id, qty: '100', qtyByWeekday: null }));

describe('projectMonth (3.13)', () => {
  it('E32 December at 100 of each every work day', () => {
    const { workDays, result } = projectMonth({ month: '2026-12', calendar: CALENDAR, versions: VERSIONS, schedules: [{ rule: EVERY_WORK_DAY, lines: LINES }] });
    expect(workDays).toBe(22);
    expect(result.work.totalCents).toBe(BigInt(3542000));
    expect(result.fixed.monthlyFeeCents).toBe(BigInt(150000));
    expect(result.minimum.status).toBe('met');
    expect(result.totalCents).toBe(BigInt(3692000));
    expect(result.charges.every((charge) => charge.posted)).toBe(true);
    expect(result.charges.some((charge) => charge.ref.startsWith(`pmf:${PROJECTION_PROGRAM_ID}:`))).toBe(true);
  });

  it('a slow schedule shows the minimum top up and the batch fee', () => {
    const version: CardVersion = { ...VERSIONS[1]!, id: 'v3', effectiveFrom: '2026-12-01', lines: [...VERSIONS[1]!.lines, line({ id: 'v3-order', kind: 'per_order', amountCents: '1000' })] };
    const mondays: ScheduleRule = { pattern: 'custom_days', days: [1], intervalWeeks: 1, startsOn: '2026-12-01', endsOn: null, skipHolidays: true, skipDates: [] };
    const { result } = projectMonth({
      month: '2026-12',
      calendar: CALENDAR,
      versions: [...VERSIONS, version],
      schedules: [{ rule: mondays, lines: [{ variantId: 'v-S-BRN', qty: '100', qtyByWeekday: null }, { variantId: 'v-M-BRN', qty: '0', qtyByWeekday: null }] }],
      oneTime: [{ ...SETUP, id: 'dec-setup', chargeOn: '2026-12-01' }],
    });
    expect(result.work.perUnitCents).toBe(BigInt(4 * 19500));
    expect(result.work.perOrderCents).toBe(BigInt(4 * 1000));
    expect(result.fixed.setupCents).toBe(BigInt(250000));
    expect(result.minimum.status).toBe('short');
    expect(result.minimum.topUpCents).toBe(BigInt(3000000 - 4 * 19500 - 4 * 1000));
  });

  it('no schedule projects only the fixed lines', () => {
    const { result } = projectMonth({ month: '2026-12', calendar: CALENDAR, versions: VERSIONS, schedules: [] });
    expect(result.totalCents).toBe(BigInt(3150000));
  });
});

describe('projectMonth hours (3.13)', () => {
  const mahco: CardVersion = {
    id: 'mahco',
    number: 1,
    effectiveFrom: '2026-01-01',
    rules: [],
    lines: [line({ id: 'mahco-hour', kind: 'per_hour', rateCents: 4200 }), line({ id: 'mahco-min', kind: 'monthly_minimum', amountCents: '500000' })],
  };
  const daily: ScheduleRule = { ...EVERY_WORK_DAY, startsOn: '2026-12-01' };

  it('turns minutes per occurrence into hours at the card rate', () => {
    const { result, hoursNotProjected } = projectMonth({ month: '2026-12', calendar: CALENDAR, versions: [mahco], schedules: [{ rule: daily, lines: [], minutesPerOccurrence: 480 }] });
    // 22 work days at 8 hours and $42.00 an hour.
    expect(result.work.perHourCents).toBe(BigInt(22 * 8 * 4200));
    expect(result.minimum.topUpCents).toBe(BigInt(0));
    expect(hoursNotProjected).toBe(false);
  });

  it('flags an hourly card projected without hours, so the UI can say so', () => {
    const { result, hoursNotProjected } = projectMonth({ month: '2026-12', calendar: CALENDAR, versions: [mahco], schedules: [{ rule: daily, lines: [] }] });
    expect(result.work.perHourCents).toBe(BigInt(0));
    expect(hoursNotProjected).toBe(true);
    expect(HOURS_NOT_PROJECTED_NOTE).toBe('Hourly work is not in this estimate.');
    // A card with no per hour line never raises the flag.
    expect(projectMonth({ month: '2026-12', calendar: CALENDAR, versions: VERSIONS, schedules: [{ rule: EVERY_WORK_DAY, lines: LINES }] }).hoursNotProjected).toBe(false);
  });

  it('refuses a bad month and minutes that are not whole', () => {
    expect(() => projectMonth({ month: '2026-13', calendar: CALENDAR, versions: [mahco], schedules: [] })).toThrow(RangeError);
    expect(() => projectMonth({ month: '2026-12', calendar: CALENDAR, versions: [mahco], schedules: [{ rule: daily, lines: [], minutesPerOccurrence: 1.5 }] })).toThrow(RangeError);
  });
});
