/** M13 round 2 (parity loop): duration cap, low-sample quadrant, type colours/hints, change-log line identity, empty buckets. */
import { describe, expect, it } from 'vitest';
import {
  colorOfType,
  kindBreakdown,
  LOW_SAMPLE,
  MAX_GAP_MINUTES,
  quadrantPoints,
  QUADRANT_LABELS,
  taskMinutes,
  TASK_TYPE_COLORS,
  typeHref,
  typesHint,
  type TaskFact,
} from '@/server/repositories/analytics-labor';
import { parseRange } from '@/server/repositories/analytics-common';
import { EMPTY_RANK_LABEL } from '@/server/repositories/dashboard-live';
import { lineSubject } from '@/server/repositories/reports-logs';

const fact = (user: string, i: number, mins: number, type = 'Picking', measured = true): TaskFact => ({
  id: `${user}-${i}`,
  type,
  userId: user,
  user,
  day: '2026-11-01',
  qty: 1,
  mins,
  measured,
  timing: measured ? 'timed' : 'none',
});
const many = (user: string, n: number, mins: number) =>
  Array.from({ length: n }, (_, i) => fact(user, i, mins));

describe('task duration sanity window', () => {
  it('caps explicit start/finish durations like gap durations (no 180-min kitting outlier)', () => {
    expect(taskMinutes('2026-11-01T08:00:00Z', '2026-11-01T11:00:00Z', null)).toBe(MAX_GAP_MINUTES);
    expect(taskMinutes(null, '2026-11-01T11:00:00Z', '2026-11-01T08:00:00Z')).toBe(MAX_GAP_MINUTES);
    expect(taskMinutes('2026-11-01T08:00:00Z', '2026-11-01T08:05:00Z', null)).toBe(5);
  });
  it('returns null (unmeasured) without a start scan or an earlier task', () => {
    expect(taskMinutes(null, '2026-11-01T08:00:00Z', null)).toBeNull();
  });
});

describe('performance quadrant', () => {
  it('keeps low-sample associates out of medians and quadrants', () => {
    const facts = [
      ...many('Thao', 80, 5),
      ...many('Jonah', 40, 4),
      ...many('Diego', 30, 8),
      ...many('Mike', 3, 0.25),
    ];
    const { med, points } = quadrantPoints(facts);
    expect(points.find((p) => p.user === 'Mike')?.quadrant).toBe(LOW_SAMPLE);
    expect(med.x).toBe(40);
    // Mike's 240 tasks/h never sets the median speed.
    expect(med.y).toBe(12);
    expect(points.find((p) => p.user === 'Jonah')?.quadrant).toBe(QUADRANT_LABELS[0]);
    expect(points.find((p) => p.user === 'Diego')?.quadrant).toBe(QUADRANT_LABELS[3]);
  });
  it('speed counts measured tasks only', () => {
    const facts = [...many('A', 30, 6), fact('A', 99, 0, 'Picking', false)];
    expect(quadrantPoints(facts).points[0]).toMatchObject({ volume: 31, speed: 10 });
  });
});

describe('task-type presentation', () => {
  it('gives every known task type its own colour', () => {
    const colors = Object.values(TASK_TYPE_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colorOfType('Kitting', 0)).not.toBe(colorOfType('Packing', 1));
  });
  it("hint lists all types or says '+N more'", () => {
    expect(typesHint(['A', 'B', 'C', 'D'])).toBe('A, B, C, D');
    expect(typesHint(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C +3 more');
    expect(typesHint([])).toBeUndefined();
  });
  it('routes Count / Replenishment drilldowns to their own task tabs', () => {
    const r = parseRange({ from: '2026-11-01', to: '2026-11-02' });
    expect(typeHref(r, 'Count')).toMatch(/^\/tasks\/count\?/);
    expect(typeHref(r, 'Replenishment')).toMatch(/^\/tasks\/replenishment\?/);
    expect(typeHref(r, 'Kitting')).toMatch(/^\/tasks\/order-operations\?/);
  });
  it('states the per-tab split for KPIs spanning several task tabs', () => {
    expect(kindBreakdown([fact('a', 1, 1), fact('a', 2, 1, 'Count')])).toBe('Order ops 1 · Count 1');
    expect(kindBreakdown([fact('a', 1, 1)])).toBeUndefined();
  });
});

describe('dashboard empty buckets and change-log lines', () => {
  it('labels the empty carrier bucket in words', () => {
    expect(EMPTY_RANK_LABEL.carrier).toBe('No carrier assigned yet');
  });
  it('extracts the line subject from line-level change messages', () => {
    expect(lineSubject('APX-TEE-BLK-L -> Quantity is modified. 0 --> 1')).toBe('APX-TEE-BLK-L');
    expect(lineSubject('Status is modified. Open --> Ready')).toBeNull();
  });
});
