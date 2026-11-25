import { describe, expect, it } from 'vitest';
import type { OutputSheetDTO, OutputSheetRow } from '@/lib/program-types';
import { addScan, closeDayCandidates, defaultMode, emptyDraft, entriesFor, matchScan, remainingAfter, todayAfter, totalsFor, visibleRows, willBeDone, type RowDraft } from './log-model';

function row(id: string, over: Partial<OutputSheetRow> = {}): OutputSheetRow {
  return {
    buildId: id,
    key: `GLOVE-${id}`,
    title: 'Small Brown',
    variant: { id: `v${id}`, name: `Variant ${id}`, color: null, sku: `SKU-${id}` },
    buildDate: '2026-11-25',
    carriedOver: false,
    unplanned: false,
    runId: 'run:s:2026-11-25',
    statusId: 's-todo',
    statusCategory: 'todo',
    plannedQty: '100.000',
    builtBefore: '0.000',
    builtToday: '0.000',
    scrapToday: '0.000',
    outputId: null,
    outputVersion: null,
    unitPrice: '1.9500',
    priceSource: 'card',
    assignee: null,
    version: 1,
    ...over,
  };
}

const sheet = (rows: OutputSheetRow[]): OutputSheetDTO => ({
  date: '2026-11-25',
  locked: false,
  lockReason: null,
  nextWorkDay: '2026-11-26',
  rows,
  totals: { plannedUnits: '0', builtUnits: '0', revenueCents: '0' },
  scanIndex: rows.map((r) => ({ sku: r.variant?.sku ?? null, variantKey: `K${r.buildId}`, buildKey: r.key, buildId: r.buildId, packQty: r.buildId === '2' ? '10' : '1' })),
  moneyHidden: false,
});

const d = (over: Partial<RowDraft>): RowDraft => ({ built: '', mode: 'set', scrap: '', done: null, note: '', ...over });

describe('modes and math', () => {
  it('defaults to Add when the day has output, else Set', () => {
    expect(defaultMode(row('1'))).toBe('set');
    expect(defaultMode(row('1', { builtToday: '40.000' }))).toBe('add');
    expect(emptyDraft(row('1', { builtToday: '40.000' })).mode).toBe('add');
  });

  it('adds or sets the day total and computes remaining', () => {
    const r = row('1', { builtBefore: '20.000', builtToday: '30.000' });
    expect(todayAfter(r, d({ built: '10', mode: 'add' }))).toBe(BigInt(40_000));
    expect(todayAfter(r, d({ built: '10', mode: 'set' }))).toBe(BigInt(10_000));
    expect(remainingAfter(r, d({ built: '10', mode: 'add' }))).toBe('40.000');
    expect(remainingAfter(r, d({ built: '500', mode: 'add' }))).toBe('0.000');
  });

  it('marks full rows done when auto done is on', () => {
    const r = row('1');
    expect(willBeDone(r, d({ built: '100' }), true)).toBe(true);
    expect(willBeDone(r, d({ built: '100' }), false)).toBe(false);
    expect(willBeDone(r, d({ built: '100', done: false }), true)).toBe(false);
    expect(willBeDone(r, d({ built: '60' }), true)).toBe(false);
  });
});

describe('totals and entries', () => {
  it('sums units and cents with one rounding per row', () => {
    const rows = [row('1', { builtToday: '100.000' }), row('2')];
    const drafts = new Map([['2', d({ built: '60' })]]);
    const totals = totalsFor(rows, drafts, [], false, () => null);
    expect(totals.planned).toBe('200.000');
    expect(totals.built).toBe('160.000');
    expect(totals.revenueCents).toBe('31200');
    expect(totals.changed).toBe(1);
    expect(totalsFor(rows, drafts, [], true, () => null).revenueCents).toBeNull();
  });

  it('builds entries with expected versions on Set and new rows as unplanned builds', () => {
    const rows = [row('1', { builtToday: '40.000', outputVersion: 3 }), row('2')];
    const drafts = new Map([
      ['1', d({ built: '100', mode: 'set' })],
      ['2', d({ built: '5', mode: 'add', note: 'late start' })],
    ]);
    const entries = entriesFor(rows, drafts, [{ id: 'n1', variantId: 'v9', variantName: 'XL Red', variantColor: null, qty: '12' }], true);
    expect(entries).toEqual([
      { buildId: '1', mode: 'set', qty: '100.000', expectedVersion: 3, markDone: true },
      { buildId: '2', mode: 'add', qty: '5.000', note: 'late start' },
      { newBuild: { variantId: 'v9' }, qty: '12.000', markDone: true },
    ]);
  });

  it('skips rows that did not change', () => {
    expect(entriesFor([row('1')], new Map([['1', d({ built: '' })]]), [], true)).toEqual([]);
  });
});

describe('scan and close the day', () => {
  it('matches build keys, SKUs and variant keys, then known variants', () => {
    const s = sheet([row('1'), row('2')]);
    expect(matchScan('glove-2', s, new Set(['1', '2']), [])).toEqual({ kind: 'row', buildId: '2', packQty: '10' });
    expect(matchScan('SKU-1', s, new Set(['1']), [])).toMatchObject({ kind: 'row', buildId: '1' });
    expect(matchScan('XL-RED', s, new Set(), [{ id: 'v9', key: 'XL-RED', sku: null, name: 'XL Red', packQty: null }])).toEqual({ kind: 'variant', variantId: 'v9', packQty: '1' });
    expect(matchScan('nothing', s, new Set(), [])).toEqual({ kind: 'none' });
    expect(addScan('', '10')).toBe('10');
    expect(addScan('10', '1')).toBe('11');
  });

  it('lists builds of the day still below plan', () => {
    const rows = [row('1'), row('2'), row('3', { buildDate: '2026-11-26' }), row('4', { statusCategory: 'cancelled' })];
    const drafts = new Map([
      ['1', d({ built: '100' })],
      ['2', d({ built: '60' })],
    ]);
    expect(closeDayCandidates(sheet(rows), rows, drafts, true).map((r) => r.buildId)).toEqual(['2']);
  });

  it('shows run rows, the day, or every open build', () => {
    const rows = [row('1', { runId: 'a' }), row('2', { runId: 'b', buildDate: '2026-11-24', carriedOver: true }), row('3', { runId: 'b', buildDate: '2026-11-20', statusCategory: 'done' })];
    const s = sheet(rows);
    expect(visibleRows(s, 'run', 'a', null).map((r) => r.buildId)).toEqual(['1']);
    expect(visibleRows(s, 'today', null, null).map((r) => r.buildId)).toEqual(['1', '2']);
    expect(visibleRows(s, 'open', null, null).map((r) => r.buildId)).toEqual(['1', '2']);
    expect(visibleRows(s, 'today', null, ['3']).map((r) => r.buildId)).toEqual(['3']);
  });
});
