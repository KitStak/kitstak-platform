import { describe, expect, it } from 'vitest';
import { createToggleQueue } from './toggle-queue';

describe('toggle queue', () => {
  it('tracks the latest toggle per automation', () => {
    const queue = createToggleQueue();
    const first = queue.begin('a');
    const second = queue.begin('a');
    const other = queue.begin('b');
    expect(queue.isLatest('a', first)).toBe(false);
    expect(queue.isLatest('a', second)).toBe(true);
    expect(queue.isLatest('b', other)).toBe(true);
  });

  it('serializes tasks for the same id, even after a failure', async () => {
    const queue = createToggleQueue();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const one = queue.enqueue('a', async () => {
      await gate;
      order.push('one');
      throw new Error('boom');
    });
    const two = queue.enqueue('a', async () => {
      order.push('two');
      return 2;
    });
    const parallel = queue.enqueue('b', async () => {
      order.push('b');
      return 'b';
    });
    await parallel;
    expect(order).toEqual(['b']);
    release();
    await expect(one).rejects.toThrow('boom');
    await expect(two).resolves.toBe(2);
    expect(order).toEqual(['b', 'one', 'two']);
  });

  it('rolls a failed burst back to the last server-confirmed value', () => {
    const queue = createToggleQueue();
    // Server: ON. User toggles OFF (fails), then ON (fails).
    queue.begin('a', true);
    queue.begin('a', false);
    queue.settle('a');
    queue.settle('a');
    expect(queue.confirmed('a')).toBe(true);
  });

  it('moves the baseline forward when a write in the burst succeeds', () => {
    const queue = createToggleQueue();
    queue.begin('a', true); // -> OFF, succeeds
    queue.begin('a', false); // -> ON, fails
    queue.settle('a', false);
    queue.settle('a');
    expect(queue.confirmed('a')).toBe(false);
    // A new burst re-snapshots from what is shown.
    queue.begin('a', false);
    expect(queue.confirmed('a')).toBe(false);
  });

  it('keeps the original baseline while toggles are still in flight', () => {
    const queue = createToggleQueue();
    queue.begin('a', true);
    queue.begin('a', false); // previous ignored: a write is pending
    expect(queue.confirmed('a')).toBe(true);
  });
});
