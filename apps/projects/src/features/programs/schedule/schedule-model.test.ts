import { describe, expect, it } from 'vitest';
import type { ScheduleDTO, VariantDTO } from '@/lib/program-types';
import { editorValueFor, linesSummary, monthGrid, toScheduleInput } from './schedule-model';

const unit = { singular: 'kit', plural: 'kits' };
const schedule = (patch: Partial<ScheduleDTO> = {}): ScheduleDTO => ({
  id: 's1',
  programId: 'p',
  name: 'Weekday glove run',
  status: 'active',
  pattern: 'weekdays',
  days: [],
  intervalWeeks: 1,
  startsOn: '2026-11-02',
  endsOn: null,
  leadDays: 7,
  skipHolidays: true,
  skipDates: ['2026-11-27'],
  defaultAssigneeId: null,
  defaultStatusId: null,
  generatedThrough: '2026-12-02',
  lastRunAt: null,
  text: 'Every weekday',
  nextDate: '2026-11-26',
  lines: [
    { id: 'l1', variantId: 'v1', variantName: 'Small Brown', qty: '100.000', qtyByWeekday: null, assigneeId: null, position: 0 },
    { id: 'l2', variantId: 'v2', variantName: 'Small Yellow', qty: '100.000', qtyByWeekday: null, assigneeId: null, position: 1 },
  ],
  version: 1,
  ...patch,
});
const calendar = { timezone: 'America/Chicago', workingDays: [1, 2, 3, 4, 5], daysOff: ['2026-11-26'], extraWorkDays: [], activeFrom: '2026-11-02', activeTo: null, paused: [] };

describe('schedule model', () => {
  it('summarizes lines, with Vary by day', () => {
    expect(linesSummary(schedule(), unit)).toBe('2 variants · 200 kits each time');
    const varied = schedule({ pattern: 'custom_days', days: [1, 2, 3, 4, 5, 6], lines: [{ id: 'l1', variantId: 'v1', variantName: 'S', qty: '400.000', qtyByWeekday: { '6': '200' }, assigneeId: null, position: 0 }, { id: 'l2', variantId: 'v2', variantName: 'Y', qty: '400.000', qtyByWeekday: { '6': '200' }, assigneeId: null, position: 1 }] });
    expect(linesSummary(varied, unit)).toBe('2 variants · 800 kits Mon to Fri, 400 on Sat');
  });

  it('round trips the editor value', () => {
    const variants = [{ id: 'v1', key: 'S-BR', status: 'active', defaultQty: '100.000' }, { id: 'v2', key: 'S-YE', status: 'active', defaultQty: '100.000' }, { id: 'v3', key: 'XL-BR', status: 'active', defaultQty: '50.000' }] as unknown as VariantDTO[];
    const value = editorValueFor(schedule(), variants);
    expect(value.lines.map((line) => [line.variantKey, line.include, line.qty])).toEqual([
      ['S-BR', true, '100'],
      ['S-YE', true, '100'],
      ['XL-BR', false, '50'],
    ]);
    const input = toScheduleInput(value, { skipDates: ['2026-11-27'], defaultAssigneeId: null, defaultStatusId: null });
    expect(input.lines.map((line) => line.variantKey)).toEqual(['S-BR', 'S-YE']);
    expect(input.skipDates).toEqual(['2026-11-27']);
  });

  it('marks runs, skipped days and days off in the month grid', () => {
    const cells = monthGrid('2026-11', [schedule()], calendar, '2026-11-25');
    const byDate = new Map(cells.map((cell) => [cell.date, cell]));
    expect(cells.length % 7).toBe(0);
    expect(byDate.get('2026-11-25')?.runs).toEqual([{ scheduleId: 's1', units: 200, skipped: false }]);
    expect(byDate.get('2026-11-26')?.dayOff).toBe(true);
    expect(byDate.get('2026-11-26')?.runs[0]?.skipped).toBe(true);
    expect(byDate.get('2026-11-27')?.runs[0]?.skipped).toBe(true);
    expect(byDate.get('2026-11-28')?.runs).toEqual([]);
  });
});
