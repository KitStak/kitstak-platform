import { describe, expect, it } from 'vitest';
import { slaWindow, taskWindow } from '@/server/repositories/jobs-planning';

describe('planned job window (Logiwa SLA)', () => {
  it('plans the job at created + 1h to created + 2h', () => {
    expect(slaWindow('2026-11-09T03:27:00.000Z')).toEqual({
      plannedStartAt: '2026-11-09T04:27:00.000Z',
      plannedEndAt: '2026-11-09T05:27:00.000Z',
    });
  });
  it('plans every task inside the job window', () => {
    const job = slaWindow('2026-11-09T03:27:00.000Z');
    expect(taskWindow(job)).toEqual({
      plannedStartAt: job.plannedStartAt,
      plannedFinishAt: job.plannedEndAt,
    });
  });
  it('is deterministic for the same created time', () => {
    expect(slaWindow('2026-11-09T10:00:00.000Z')).toEqual(slaWindow('2026-11-09T10:00:00.000Z'));
  });
  it('rejects an invalid created time', () => {
    expect(() => slaWindow('nope')).toThrow();
  });
});
