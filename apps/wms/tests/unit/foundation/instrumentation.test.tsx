// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { register, shouldStartScheduler } from '@/instrumentation';
import * as scheduler from '@/server/scheduler';

describe('instrumentation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('starts the scheduler only in the nodejs runtime', () => {
    expect(shouldStartScheduler({ NEXT_RUNTIME: 'nodejs' })).toBe(true);
    expect(shouldStartScheduler({ NEXT_RUNTIME: 'edge' })).toBe(false);
    expect(shouldStartScheduler({})).toBe(false);
    expect(shouldStartScheduler({ NEXT_RUNTIME: 'nodejs', SCHEDULER_ENABLED: '0' })).toBe(false);
  });

  it('register() calls startScheduler in nodejs', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const spy = vi.spyOn(scheduler, 'startScheduler');
    await register();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('register() never throws when the scheduler fails', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.spyOn(scheduler, 'startScheduler').mockRejectedValue(new Error('boom'));
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(register()).resolves.toBeUndefined();
    expect(String(write.mock.calls[0]?.[0])).toContain('boom');
  });

  it('scheduler stays off under test', async () => {
    await expect(scheduler.startScheduler()).resolves.toEqual({
      started: false,
      reason: 'Scheduler disabled under test',
    });
  });
});

describe('component test harness (jsdom + RTL + user-event)', () => {
  function Counter() {
    const [n, setN] = useState(0);
    return <button onClick={() => setN(n + 1)}>Clicked {n}</button>;
  }

  it('renders TSX and handles user events', async () => {
    render(<Counter />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('Clicked 1');
  });
});
