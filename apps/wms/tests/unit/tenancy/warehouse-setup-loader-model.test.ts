import { describe, expect, it } from 'vitest';
import {
  indexAt,
  SETUP_LOADERS,
  SETUP_MESSAGES,
  shuffled,
} from '@/lib/warehouse-setup-loader-model';

describe('warehouse setup loader content', () => {
  it('has thirty distinct warehouse chores', () => {
    expect(SETUP_MESSAGES).toHaveLength(30);
    expect(new Set(SETUP_MESSAGES).size).toBe(30);
  });

  it('cycles through every app loader, WMS first', () => {
    expect(SETUP_LOADERS[0]?.key).toBe('wms');
    expect(new Set(SETUP_LOADERS.map((l) => l.key)).size).toBe(SETUP_LOADERS.length);
    for (const loader of SETUP_LOADERS) expect(loader.src).toMatch(/^\/brand\/.+\.svg$/);
  });
});

describe('shuffled', () => {
  it('returns the same items in a new array without touching the input', () => {
    const input = ['a', 'b', 'c', 'd'] as const;
    const out = shuffled(input, () => 0);
    expect(out).not.toBe(input);
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the order when random always picks the last slot', () => {
    expect(shuffled([1, 2, 3], () => 0.999)).toEqual([1, 2, 3]);
  });
});

describe('indexAt', () => {
  it('wraps around the list', () => {
    expect(indexAt(6, 0)).toBe(0);
    expect(indexAt(6, 5)).toBe(5);
    expect(indexAt(6, 6)).toBe(0);
    expect(indexAt(6, 13)).toBe(1);
  });

  it('handles an empty list and negative ticks', () => {
    expect(indexAt(0, 4)).toBe(0);
    expect(indexAt(3, -1)).toBe(2);
  });
});
