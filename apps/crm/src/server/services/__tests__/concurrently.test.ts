import { PgTransaction } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Executor } from '@/server/db';
import { concurrently } from '../context';

function tracker() {
  let active = 0;
  let peak = 0;
  const task =
    <T>(value: T) =>
    async (): Promise<T> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value;
    };
  return { task, peak: () => peak };
}

describe('concurrently', () => {
  it('runs tasks in parallel on a pooled executor and keeps result order', async () => {
    const { task, peak } = tracker();
    const pooled = { db: {} as Executor };
    const result = await concurrently(pooled, [task(1), task('two'), task(true)]);
    expect(result).toEqual([1, 'two', true]);
    expect(peak()).toBe(3);
  });

  it('runs tasks one at a time inside a transaction', async () => {
    const { task, peak } = tracker();
    const tx = { db: Object.create(PgTransaction.prototype) as Executor };
    const result = await concurrently(tx, [task('a'), task('b'), task('c')]);
    expect(result).toEqual(['a', 'b', 'c']);
    expect(peak()).toBe(1);
  });
});
