import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigWriter } from './config-writer';

describe('createConfigWriter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces 20 rapid edits into one PATCH carrying the final text', async () => {
    const send = vi.fn((slice: { title: string }) => Promise.resolve(slice));
    const settled = vi.fn();
    const writer = createConfigWriter<{ title: string }>({ delayMs: 350, send, onSettled: settled });
    const text = 'Critic intake form!!';
    for (let index = 1; index <= text.length; index += 1) {
      writer.edit({ title: '' }, { title: text.slice(0, index) });
      vi.advanceTimersByTime(40);
    }
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ title: text });
    expect(settled).toHaveBeenCalledWith({ title: text });
  });

  it('serializes writes and ignores stale responses while newer edits are pending', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const send = vi
      .fn<(slice: { title: string }) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementation((slice) => Promise.resolve(slice));
    const settled = vi.fn();
    const writer = createConfigWriter<{ title: string }>({ delayMs: 350, send, onSettled: settled });
    writer.edit({ title: '' }, { title: 'Ci' }, true);
    writer.edit({ title: '' }, { title: 'Critic' }, true); // in flight → queued, not sent
    expect(send).toHaveBeenCalledTimes(1);
    resolveFirst({ title: 'Ci' });
    await vi.runAllTimersAsync();
    expect(settled).not.toHaveBeenCalledWith({ title: 'Ci' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ title: 'Critic' });
    expect(settled).toHaveBeenLastCalledWith({ title: 'Critic' });
  });

  it('flushes pending edits on dispose (unmount)', () => {
    const send = vi.fn(() => Promise.resolve(null));
    const writer = createConfigWriter<{ a: number }>({ delayMs: 350, send });
    writer.edit({ a: 0 }, { a: 1 });
    writer.dispose();
    expect(send).toHaveBeenCalledWith({ a: 1 });
  });
});
