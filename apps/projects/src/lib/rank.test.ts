import { describe, expect, it } from 'vitest';
import { compareRank, rankAfter, rankBefore, rankBetween, rankForIndex, ranksBetween } from './rank';

describe('rank', () => {
  it('appends and prepends in order', () => {
    const a = rankAfter(null);
    const b = rankAfter(a);
    const z = rankBefore(a);
    expect(compareRank(z, a)).toBe(-1);
    expect(compareRank(a, b)).toBe(-1);
  });

  it('finds a key strictly between two neighbours', () => {
    const [a, b] = ranksBetween(2);
    const mid = rankBetween(a, b);
    expect(compareRank(a, mid)).toBe(-1);
    expect(compareRank(mid, b)).toBe(-1);
  });

  it('survives many inserts at the same spot', () => {
    let lo = rankAfter(null);
    const hi = rankAfter(lo);
    for (let i = 0; i < 200; i += 1) {
      const next = rankBetween(lo, hi);
      expect(compareRank(lo, next)).toBe(-1);
      expect(compareRank(next, hi)).toBe(-1);
      lo = next;
    }
  });

  it('recovers from out-of-order neighbours', () => {
    const [a, b] = ranksBetween(2);
    const r = rankBetween(b, a);
    expect(compareRank(b, r)).toBe(-1);
  });

  it('computes a drop rank for any index', () => {
    const ranks = ranksBetween(3);
    expect(compareRank(rankForIndex(ranks, 0), ranks[0])).toBe(-1);
    const middle = rankForIndex(ranks, 1);
    expect(compareRank(ranks[0], middle)).toBe(-1);
    expect(compareRank(middle, ranks[1])).toBe(-1);
    expect(compareRank(ranks[2], rankForIndex(ranks, 99))).toBe(-1);
  });

  it('spreads N keys in sorted order', () => {
    const keys = ranksBetween(10);
    expect([...keys].sort(compareRank)).toEqual(keys);
    expect(new Set(keys).size).toBe(10);
  });
});
