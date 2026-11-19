import { describe, expect, it } from 'vitest';
import type { ProfitPivotDTO, ProfitRowDTO } from '@/lib/types';
import { parsePeriod, periodQuery } from './period';
import { compareRows, contribution, csvValue, defaultSort, drillTarget, formatValue, modesFor, paretoView, parseSort, pivotCsv, rowLabel, rowScope, sortParam, sortRows, viewToQuery, visibleColumns } from './profit-model';

const row = (key: string, label: string, patch: Partial<ProfitRowDTO> = {}): ProfitRowDTO =>
  ({ key, label, sublabel: null, revenueCents: 100000, baseRevenueCents: 100000, vasRevenueCents: 0, otherRevenueCents: 0, laborCents: 40000, materialCents: 20000, otherCents: 5000, sharedCents: 5000, costCents: 70000, profitCents: 30000, marginBp: 3000, marginBeforeSharedBp: 3500, laborPctBp: 4000, billedCents: 0, unitsGood: '1000.000', unitsScrap: '0.000', hours: '25.00', uph: '40.000', costPerUnitCents: 70, profitPerUnitCents: 30, jobCount: 1, prior: null, trend: null, laborMissing: false, costMissing: false, riskStatus: null, ...patch }) as ProfitRowDTO;

const RANGE = { from: '2026-10-05', to: '2026-11-17' };

describe('columns and sorting', () => {
  it('shows the usual columns, or the chosen ones in catalog order, and drops money for people who may not see it', () => {
    expect(visibleColumns(null, true).map((column) => column.id)).toEqual(['revenue', 'labor', 'material', 'other', 'shared', 'profit', 'margin', 'units', 'hours', 'uph']);
    expect(visibleColumns(['margin', 'revenue', 'nope'], true).map((column) => column.id)).toEqual(['revenue', 'margin']);
    expect(visibleColumns(null, false).map((column) => column.id)).toEqual(['units', 'hours', 'uph']);
  });

  it('reads and writes the sort, and falls back on a bad column', () => {
    const fallback = defaultSort('client', true);
    expect(fallback).toEqual({ column: 'profit', direction: 'desc' });
    expect(defaultSort('week', true)).toEqual({ column: 'name', direction: 'asc' });
    expect(defaultSort('job', false)).toEqual({ column: 'units', direction: 'desc' });
    expect(parseSort('-margin', fallback)).toEqual({ column: 'margin', direction: 'desc' });
    expect(parseSort('name', fallback)).toEqual({ column: 'name', direction: 'asc' });
    expect(parseSort('drop table', fallback)).toBe(fallback);
    expect(sortParam({ column: 'margin', direction: 'desc' })).toBe('-margin');
  });

  it('sorts numbers and names, and keeps rows with nothing to sort on at the bottom either way', () => {
    const rows = [row('a', 'Beta', { profitCents: 10 }), row('b', 'Alpha', { profitCents: null }), row('c', 'Gamma', { profitCents: -5 })];
    expect(sortRows('client', rows, { column: 'profit', direction: 'desc' }, new Map()).map((item) => item.key)).toEqual(['a', 'c', 'b']);
    expect(sortRows('client', rows, { column: 'profit', direction: 'asc' }, new Map()).map((item) => item.key)).toEqual(['c', 'a', 'b']);
    expect(sortRows('client', rows, { column: 'name', direction: 'asc' }, new Map()).map((item) => item.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('formats cells for the screen and for a spreadsheet', () => {
    expect(formatValue(123456, 'money')).toBe('$1,234.56');
    expect(formatValue(2236, 'percent')).toBe('22.4%');
    expect(formatValue(null, 'money')).toBe('');
    expect(csvValue(123456, 'money')).toEqual({ raw: '1234.56' });
    expect(csvValue(-4500, 'money')).toEqual({ raw: '-45.00' });
    expect(csvValue(2236, 'percent')).toEqual({ raw: '22.36' });
    expect(csvValue(1200.5, 'number')).toBe(1200.5);
    expect(csvValue(null, 'money')).toBe('');
  });
});

describe('comparing two periods', () => {
  it('matches clients by key', () => {
    const now = [row('a', 'Acme', { profitCents: 30000, marginBp: 3000 }), row('b', 'Bolt', { profitCents: 5000, marginBp: 1000 })];
    const then = [row('a', 'Acme', { profitCents: 20000, marginBp: 2500 })];
    const compared = compareRows('client', now, then);
    expect(compared.get('a')).toMatchObject({ profitDelta: 10000, marginDelta: 500 });
    expect(compared.get('b')).toMatchObject({ profitDelta: null, marginDelta: null });
  });

  it('matches weeks by position, the first week against the first week', () => {
    const now = [row('2026-11-09', ''), row('2026-11-02', '', { profitCents: 1000 })];
    const then = [row('2026-10-26', '', { profitCents: 400 }), row('2026-11-02', '', { profitCents: 99999 }), row('2026-10-19', '', { profitCents: 700 })];
    const compared = compareRows('week', now, then);
    expect(compared.get('2026-11-02')?.profitDelta).toBe(1000 - 700);
    expect(compared.get('2026-11-09')?.profitDelta).toBe(30000 - 400);
  });

  it('has nothing to say when there is no other period', () => {
    expect(compareRows('client', [row('a', 'Acme')], null).size).toBe(0);
  });
});

describe('drilling down', () => {
  it('goes one level down from every grouping and ends at the entries', () => {
    expect(drillTarget('client', row('c1', 'Acme'), RANGE)?.patch).toMatchObject({ by: 'job', client: 'c1' });
    expect(drillTarget('type', row('t1', 'Kitting'), RANGE)?.patch).toMatchObject({ by: 'job', jobType: 't1' });
    expect(drillTarget('site', row('s1', 'Main'), RANGE)?.patch).toMatchObject({ by: 'client', site: 's1' });
    expect(drillTarget('service', row('v1', 'Labeling'), RANGE)?.patch).toMatchObject({ by: 'client', service: 'v1' });
    expect(drillTarget('job', row('j1', 'J-1001'), RANGE)?.patch).toMatchObject({ by: 'day', job: 'j1' });
    expect(drillTarget('month', row('2026-10-01', ''), RANGE)?.patch).toMatchObject({ by: 'week', range: 'custom', from: '2026-10-05', to: '2026-10-31' });
    expect(drillTarget('week', row('2026-11-16', ''), RANGE)?.patch).toMatchObject({ by: 'day', from: '2026-11-16', to: '2026-11-17' });
    expect(drillTarget('day', row('2026-11-16', ''), RANGE)?.patch).toEqual({ entries: 'all', day: '2026-11-16' });
    expect(drillTarget('client', row('c1', 'Acme'), RANGE)?.words).toBe('See the jobs of Acme');
  });

  it('has nothing below a row with no key', () => {
    expect(drillTarget('job', row('none', 'Put on a client, not on a job'), RANGE)).toBeNull();
    expect(rowScope('service', 'none', RANGE)).toBeNull();
  });

  it('scopes a time row to its own days inside the page range', () => {
    expect(rowScope('month', '2026-11-01', RANGE)).toEqual({ from: '2026-11-01', to: '2026-11-17' });
    expect(rowScope('day', '2026-11-03', RANGE)).toEqual({ from: '2026-11-03', to: '2026-11-03' });
    expect(rowScope('client', 'c1', RANGE)).toEqual({ clientId: 'c1' });
  });

  it('names time rows by their first day', () => {
    expect(rowLabel('month', { key: '2026-11-01', label: '2026-11-01' })).toBe('November 2026');
    expect(rowLabel('week', { key: '2026-11-16', label: '' })).toBe('Week of Nov 16, 2026');
    expect(rowLabel('client', { key: 'c1', label: 'Acme' })).toBe('Acme');
  });
});

describe('views', () => {
  it('offers Pareto for things, never for time, and cost to serve only for clients', () => {
    expect(modesFor('client')).toEqual(['table', 'chart', 'contribution', 'pareto', 'pivot', 'serve']);
    expect(modesFor('month')).toEqual(['table', 'chart', 'contribution', 'pivot']);
    expect(modesFor('job')).not.toContain('serve');
  });

  it('works out contribution with the profit library', () => {
    expect(contribution(row('a', 'Acme'))).toEqual({ directCents: 65000, contributionCents: 35000 });
    expect(contribution(row('a', 'Acme', { revenueCents: null }))).toBeNull();
  });

  it('ranks by profit and says how few make 80% of it', () => {
    const view = paretoView([row('a', 'A', { profitCents: 70000 }), row('b', 'B', { profitCents: 20000 }), row('c', 'C', { profitCents: 10000 }), row('d', 'D', { profitCents: -5000 })]);
    expect(view.ranked.map((item) => item.item.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(view.toEighty).toBe(2);
    expect(view.losing).toBe(1);
    expect(paretoView([row('a', 'A', { profitCents: -1 })]).toEighty).toBeNull();
  });

  it('measures every share against profit from the rows that made money, so the running share tops out at 100%', () => {
    const view = paretoView([row('a', 'A', { profitCents: 60000 }), row('b', 'B', { profitCents: 30000 }), row('c', 'C', { profitCents: 10000 }), row('d', 'D', { profitCents: -40000 })]);
    expect(view.madeCents).toBe(BigInt(100000));
    expect(view.gaveBackCents).toBe(BigInt(40000));
    expect(view.ranked.map((item) => item.cumulativeProfitShareBp)).toEqual([6000, 9000, 10000, 6000]);
    expect(view.ranked.map((item) => item.profitShareBp)).toEqual([6000, 3000, 1000, -4000]);
    expect(Math.max(...view.ranked.map((item) => item.cumulativeProfitShareBp ?? 0))).toBeLessThanOrEqual(10000);
    expect(view.toEighty).toBe(2);
  });

  it('writes the pivot grid as rows with totals', () => {
    const cell = (profit: number) => ({ revenueCents: profit * 2, costCents: profit, profitCents: profit, marginBp: 5000, unitsGood: '10.000', hours: '1.00', costMissing: false });
    const pivot: ProfitPivotDTO = { rowBy: 'client', colBy: 'month', from: '2026-10-01', to: '2026-11-17', rows: [{ key: 'a', label: 'Acme', sublabel: null }], cols: [{ key: '2026-10-01', label: '2026-10-01', sublabel: null }, { key: '2026-11-01', label: '2026-11-01', sublabel: null }], cells: { a: { '2026-10-01': cell(1000) } }, rowTotals: { a: cell(1000) }, colTotals: { '2026-10-01': cell(1000) }, total: cell(1000), moneyHidden: false };
    const csv = pivotCsv(pivot, 'profit');
    expect(csv.headers).toEqual(['Clients', 'October 2026', 'November 2026', 'Total']);
    expect(csv.rows).toEqual([
      ['Acme', { raw: '10.00' }, '', { raw: '10.00' }],
      ['Total', { raw: '10.00' }, '', { raw: '10.00' }],
    ]);
  });

  it('writes "No cost yet" in place of a margin for extra service work with no cost logged', () => {
    const cell = (costMissing: boolean) => ({ revenueCents: 1000, costCents: costMissing ? 0 : 400, profitCents: costMissing ? 1000 : 600, marginBp: costMissing ? null : 6000, unitsGood: '0.000', hours: '0.00', costMissing });
    const pivot: ProfitPivotDTO = { rowBy: 'service', colBy: 'month', from: '2026-10-01', to: '2026-10-31', rows: [{ key: 'a', label: 'Labeling', sublabel: null }], cols: [{ key: '2026-10-01', label: '2026-10-01', sublabel: null }], cells: { a: { '2026-10-01': cell(true) } }, rowTotals: { a: cell(true) }, colTotals: { '2026-10-01': cell(false) }, total: cell(false), moneyHidden: false };
    expect(pivotCsv(pivot, 'margin').rows).toEqual([
      ['Labeling', 'No cost yet', 'No cost yet'],
      ['Total', { raw: '60.00' }, { raw: '60.00' }],
    ]);
    // Other numbers of the same cell are written as they are.
    expect(pivotCsv(pivot, 'revenue').rows[0]).toEqual(['Labeling', { raw: '10.00' }, { raw: '10.00' }]);
  });
});

describe('saved views and the period in the URL', () => {
  it('opens a view saved from the explorer as it was', () => {
    expect(viewToQuery({ query: { by: 'client', range: 'last_month', sort: '-margin', empty: '' } })).toEqual({ by: 'client', range: 'last_month', sort: '-margin' });
  });

  it('maps the plain fields of older views', () => {
    expect(viewToQuery({ by: 'client', sort: 'profit', direction: 'asc', range: 'this_quarter', compare: true })).toEqual({ by: 'client', range: 'this_quarter', sort: 'profit', compare: 'prior' });
    expect(viewToQuery({ by: 'service', sort: 'margin', range: 'last_30_days', direction: 'desc' })).toEqual({ by: 'service', range: 'last_30', sort: '-margin' });
    expect(viewToQuery({ by: 'job' })).toEqual({});
  });

  it('reads a period from the query and writes it back without the defaults', () => {
    const query: Record<string, string> = { range: 'last_month', compare: 'prior' };
    const period = parsePeriod((name) => query[name], '2026-11-17', 1);
    expect(period).toMatchObject({ preset: 'last_month', from: '2026-10-01', to: '2026-10-31', compare: 'prior', compareTo: { from: '2026-08-31', to: '2026-09-30' } });
    expect(periodQuery(period)).toEqual({ range: 'last_month', from: undefined, to: undefined, compare: 'prior' });
    const custom = parsePeriod((name) => ({ from: '2026-11-03', to: '2026-11-09' })[name], '2026-11-17', 1);
    expect(custom).toMatchObject({ preset: 'custom', from: '2026-11-03', to: '2026-11-09', compareTo: null });
    expect(periodQuery(custom)).toEqual({ range: 'custom', from: '2026-11-03', to: '2026-11-09', compare: undefined });
    expect(periodQuery(parsePeriod(() => null, '2026-11-17', 1))).toEqual({ range: undefined, from: undefined, to: undefined, compare: undefined });
    // A bad preset and backwards days never break the page.
    expect(parsePeriod((name) => ({ range: 'forever' })[name], '2026-11-17', 1).preset).toBe('this_month');
    expect(parsePeriod((name) => ({ range: 'custom', from: '2026-11-09', to: '2026-11-03' })[name], '2026-11-17', 1)).toMatchObject({ from: '2026-11-03', to: '2026-11-09' });
  });
});
