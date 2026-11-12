import { describe, expect, it, vi } from 'vitest';
import { createEventQueue } from '@/server/db/seed/queue';

describe('event queue', () => {
  it('runs events by time, ties in insertion order, including events scheduled while draining', async () => {
    const q = createEventQueue(100);
    const seen: string[] = [];
    q.schedule(30, 'c', () => void seen.push('c'));
    q.schedule(10, 'a', () => {
      seen.push('a');
      q.schedule(20, 'b', () => void seen.push('b'));
    });
    q.schedule(30, 'd', async () => {
      await Promise.resolve();
      seen.push('d');
    });
    const before = vi.fn();
    const executed = await q.drain({ before, onError: () => undefined });
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    expect(executed).toBe(4);
    expect(before.mock.calls.map((c) => c[0])).toEqual([10, 20, 30, 30]);
  });

  it('drops events after the end and non-finite times', () => {
    const q = createEventQueue(50);
    expect(q.schedule(51, 'late', () => undefined)).toBe(false);
    expect(q.schedule(Number.NaN, 'nan', () => undefined)).toBe(false);
    expect(q.schedule(50, 'edge', () => undefined)).toBe(true);
    expect(q.size()).toBe(1);
  });

  it('reports failing events and keeps going', async () => {
    const q = createEventQueue(10);
    const errors: string[] = [];
    let ran = false;
    q.schedule(1, 'boom', () => {
      throw new Error('nope');
    });
    q.schedule(2, 'ok', () => {
      ran = true;
    });
    await q.drain({ onError: (label, e) => errors.push(`${label}:${(e as Error).message}`) });
    expect(errors).toEqual(['boom:nope']);
    expect(ran).toBe(true);
  });

  it('orders a large random set correctly', async () => {
    const q = createEventQueue(10_000);
    const times = Array.from({ length: 500 }, (_, i) => (i * 7919) % 1000);
    const seen: number[] = [];
    for (const t of times) q.schedule(t, String(t), () => void seen.push(t));
    await q.drain({ onError: () => undefined });
    expect(seen).toEqual([...times].sort((a, b) => a - b));
  });
});
