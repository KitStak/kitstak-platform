import { describe, expect, it } from 'vitest';
import type { TrendsDTO } from '@/lib/program-types';
import { cellText, last12, monthLabel, shiftMonth, trendsTable } from './trends-model';

const months = ['2026-10', '2026-11'];
const row = (id: string, name: string, unit: string, units: [string, string], cents: [string, string]) => ({
  id,
  key: id.toUpperCase(),
  name,
  unit,
  cells: months.map((month, index) => ({ month, units: units[index]!, revenueCents: cents[index]! })),
  totalUnits: (Number(units[0]) + Number(units[1])).toFixed(3),
  totalCents: String(BigInt(cents[0]) + BigInt(cents[1])),
  moneyHidden: false,
});

const data: TrendsDTO = {
  from: '2026-10',
  to: '2026-11',
  groupBy: 'program',
  months,
  rows: [row('glove', 'Glove kitting', 'kits', ['15000.000', '14172.000'], ['3100000', '2997040']), row('tees', 'Tee kits', 'kits', ['100.000', '200.000'], ['10000', '20000']), row('ecomm', 'Orders', 'orders', ['3000.000', '3120.000'], ['900000', '1000000'])],
  totals: [],
};

const info = new Map([
  ['glove', { customer: { id: 'g', name: 'Gripwell' }, unit: { singular: 'kit', plural: 'kits' } }],
  ['tees', { customer: { id: 'g', name: 'Gripwell' }, unit: { singular: 'kit', plural: 'kits' } }],
  ['ecomm', { customer: null, unit: { singular: 'order', plural: 'orders' } }],
]);

describe('trends model', () => {
  it('moves months', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(last12('2026-11')).toEqual({ from: '2025-12', to: '2026-11' });
    expect(monthLabel('2026-11')).toBe('Nov 2026');
  });

  it('groups by customer with a subtotal and totals per unit label', () => {
    const table = trendsTable(data, info);
    expect(table.groups.map((group) => group.name)).toEqual(['Gripwell', 'No customer']);
    expect(table.groups[0]!.subtotal?.cells[1]).toEqual({ month: '2026-11', units: '14372.000', revenueCents: '3017040' });
    expect(table.groups[1]!.subtotal).toBeNull();
    expect(table.totals.map((line) => line.name)).toEqual(['Total kits', 'Total orders']);
  });

  it('prints cells as units and money', () => {
    const table = trendsTable(data, info);
    const cell = table.groups[0]!.programs[0]!.cells[1]!;
    expect(cellText(cell, { singular: 'kit', plural: 'kits' }, 'both')).toEqual({ units: '14,172 kits', money: '$29,970' });
    expect(cellText({ ...cell, revenueCents: null }, { singular: 'kit', plural: 'kits' }, 'both')).toEqual({ units: '14,172 kits', money: null });
  });
});
