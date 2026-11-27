import { describe, expect, it } from 'vitest';
import type { ProductionEntryDTO } from '@/lib/types';
import { latestWorkByDay } from './latest-work';

const line = (patch: Partial<ProductionEntryDTO>): ProductionEntryDTO =>
  ({
    id: 'x',
    workDate: '2026-11-18',
    unitsGood: '0.000',
    hours: '0.00',
    setupHours: '0.00',
    hoursConfirmed: true,
    laborCostCents: 0,
    deletedAt: null,
    ...patch,
  }) as ProductionEntryDTO;

describe('latestWorkByDay', () => {
  it('folds the crew line and the line lead line of one day into one row with summed hours', () => {
    const rows = latestWorkByDay([
      line({ id: 'a', workDate: '2026-11-18', unitsGood: '1719.000', hours: '60.00', laborCostCents: 150000 }),
      line({ id: 'b', workDate: '2026-11-18', unitsGood: '0.000', hours: '4.00', laborCostCents: 12000 }),
      line({ id: 'c', workDate: '2026-11-17', unitsGood: '1500.000', hours: '60.00', laborCostCents: 150000 }),
      line({ id: 'd', workDate: '2026-11-17', unitsGood: '0.000', hours: '4.00', laborCostCents: 12000 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ workDate: '2026-11-18', unitsGood: '1719.000', hours: '64.00', laborCostCents: 162000, lines: 2, hoursConfirmed: true });
    expect(rows[1]).toMatchObject({ workDate: '2026-11-17', hours: '64.00' });
  });

  it('newest day first, skips deleted lines and keeps only the latest days', () => {
    const rows = latestWorkByDay(
      [
        line({ id: 'a', workDate: '2026-11-10', unitsGood: '5' }),
        line({ id: 'b', workDate: '2026-11-12', unitsGood: '7', deletedAt: '2026-11-13T00:00:00Z' }),
        line({ id: 'c', workDate: '2026-11-14', unitsGood: '9' }),
        line({ id: 'd', workDate: '2026-11-11', unitsGood: '1' }),
      ],
      2,
    );
    expect(rows.map((row) => row.workDate)).toEqual(['2026-11-14', '2026-11-11']);
  });

  it('flags a day with a line still waiting for hours, and hides cost when any line hides it', () => {
    const [row] = latestWorkByDay([
      line({ id: 'a', unitsGood: '10', hours: '8.00', laborCostCents: null }),
      line({ id: 'b', unitsGood: '2', hours: '0.00', hoursConfirmed: false, laborCostCents: null }),
    ]);
    expect(row).toMatchObject({ unitsGood: '12.000', hoursConfirmed: false, laborCostCents: null });
  });
});
