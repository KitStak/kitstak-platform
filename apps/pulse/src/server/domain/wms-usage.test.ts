import { describe, expect, it } from 'vitest';
import { planUsage, refDate, usageDays, wmsUsageRef } from './wms-usage';

const q = (n: number): bigint => BigInt(n * 1000);
const open = (): boolean => false;
const C = 'comp-1';

describe('usageDays', () => {
  it('dates parts by the ledger day, not the sync day', () => {
    expect(usageDays([{ date: '2026-10-14', qty: q(12) }], q(12), '2026-11-18')).toEqual([{ date: '2026-10-14', qty: q(12) }]);
  });
  it('puts parts the ledger does not explain on the build day', () => {
    expect(usageDays([{ date: '2026-10-14', qty: q(10) }], q(12), '2026-10-15')).toEqual([
      { date: '2026-10-14', qty: q(10) },
      { date: '2026-10-15', qty: q(2) },
    ]);
  });
  it('cuts the latest days back when the ledger says more than the warehouse count', () => {
    expect(usageDays([{ date: '2026-10-14', qty: q(10) }, { date: '2026-10-15', qty: q(5) }], q(12), '2026-10-15')).toEqual([
      { date: '2026-10-14', qty: q(10) },
      { date: '2026-10-15', qty: q(2) },
    ]);
  });
  it('nets a disassembly against the same day', () => {
    expect(usageDays([{ date: '2026-10-14', qty: q(10) }, { date: '2026-10-14', qty: q(-4) }], q(6), '2026-10-20')).toEqual([{ date: '2026-10-14', qty: q(6) }]);
  });
});

describe('planUsage', () => {
  it('adds one row per day with a stable ref', () => {
    const plan = planUsage(C, [{ date: '2026-10-14', qty: q(12) }], [], [], open);
    expect(plan.create).toEqual([{ date: '2026-10-14', qty: q(12) }]);
    expect(wmsUsageRef(C, '2026-10-14')).toBe('woc:comp-1:2026-10-14');
  });

  it('changes nothing on a second run', () => {
    const plan = planUsage(C, [{ date: '2026-10-14', qty: q(12) }], [{ id: 'a', date: '2026-10-14', qty: q(12), ref: wmsUsageRef(C, '2026-10-14') }], [], open);
    expect(plan).toEqual({ create: [], update: [], remove: [], skippedClosed: 0 });
  });

  it('moves an old row dated on the sync day to the day the parts were used', () => {
    const plan = planUsage(C, [{ date: '2026-10-14', qty: q(12) }], [{ id: 'a', date: '2026-11-18', qty: q(12), ref: 'woc:comp-1:2026-11-18:12' }], [], open);
    expect(plan.update).toEqual([{ id: 'a', date: '2026-10-14', qty: q(12), ref: 'woc:comp-1:2026-10-14' }]);
    expect(plan.create).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('folds two old rows from the same sync day into one and removes the extra', () => {
    const own = [
      { id: 'a', date: '2026-11-18', qty: q(5), ref: 'woc:comp-1:2026-11-18:5' },
      { id: 'b', date: '2026-11-18', qty: q(7), ref: 'woc:comp-1:2026-11-18:12' },
    ];
    const plan = planUsage(C, [{ date: '2026-10-14', qty: q(12) }], own, [], open);
    expect(plan.update).toEqual([{ id: 'a', date: '2026-10-14', qty: q(12), ref: 'woc:comp-1:2026-10-14' }]);
    expect(plan.remove).toEqual(['b']);
  });

  it('counts rows that came another way and never adds them twice', () => {
    const plan = planUsage(C, [{ date: '2026-10-14', qty: q(12) }], [], [{ date: '2026-10-14', qty: q(12) }], open);
    expect(plan).toEqual({ create: [], update: [], remove: [], skippedClosed: 0 });
  });

  it('leaves closed months alone and counts them', () => {
    const closed = (date: string): boolean => date.startsWith('2026-09');
    const own = [{ id: 'a', date: '2026-09-30', qty: q(4), ref: 'woc:comp-1:2026-09-30:4' }];
    const plan = planUsage(C, [{ date: '2026-09-29', qty: q(4) }, { date: '2026-10-02', qty: q(6) }], own, [], closed);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([{ date: '2026-10-02', qty: q(6) }]);
    expect(plan.skippedClosed).toBe(0);
    const later = planUsage(C, [{ date: '2026-09-29', qty: q(4) }], [], [], closed);
    expect(later.skippedClosed).toBe(1);
  });

  it('reads the day out of old and new refs only for its own part', () => {
    expect(refDate('woc:comp-1:2026-10-14', C)).toBe('2026-10-14');
    expect(refDate('woc:comp-1:2026-10-14:12', C)).toBe('2026-10-14');
    expect(refDate('woc:comp-2:2026-10-14', C)).toBeNull();
    expect(refDate('pick:WO1:2026-10-14:SKU', C)).toBeNull();
  });
});
