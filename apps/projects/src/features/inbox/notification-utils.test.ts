import { describe, expect, it } from 'vitest';
import type { NotificationDTO } from '@/lib/types';
import { groupByDate, inboxDateGroup, taskKeyFromUrl } from './notification-utils';

describe('taskKeyFromUrl', () => {
  it('reads OPS-42 from task URLs', () => {
    expect(taskKeyFromUrl('/p/OPS/42')).toBe('OPS-42');
    expect(taskKeyFromUrl('/p/ops/7?tab=comments')).toBe('OPS-7');
    expect(taskKeyFromUrl('/p/WH/3#comment-1')).toBe('WH-3');
  });
  it('ignores non-task URLs', () => {
    expect(taskKeyFromUrl('/p/OPS')).toBeNull();
    expect(taskKeyFromUrl('/p/OPS/board')).toBeNull();
    expect(taskKeyFromUrl('/goals')).toBeNull();
    expect(taskKeyFromUrl(null)).toBeNull();
  });
});

describe('inbox date groups', () => {
  const now = new Date(2026, 10, 11, 15, 0); // Wed Nov 11
  const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();
  it('labels by local day', () => {
    expect(inboxDateGroup(at(2026, 10, 11), now)).toBe('Today');
    expect(inboxDateGroup(at(2026, 10, 10), now)).toBe('Yesterday');
    expect(inboxDateGroup(at(2026, 10, 9), now)).toBe('Earlier this week');
    expect(inboxDateGroup(at(2026, 10, 3), now)).toBe('Last week');
    expect(inboxDateGroup(at(2026, 9, 1), now)).toBe('Older');
  });
  it('groups consecutive items in order', () => {
    const item = (id: string, createdAt: string) => ({ id, createdAt }) as NotificationDTO;
    const groups = groupByDate([item('a', at(2026, 10, 11, 12)), item('b', at(2026, 10, 11, 8)), item('c', at(2026, 10, 10))], now);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
    ]);
  });
});
