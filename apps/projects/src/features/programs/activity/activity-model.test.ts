import { describe, expect, it } from 'vitest';
import { ACTIVITY_FILTERS, activityCsv, dayGroups, matchesFilter } from './activity-model';

describe('activity model', () => {
  it('filters by kind', () => {
    expect(matchesFilter({ verb: 'price_card.version_published' }, 'prices')).toBe(true);
    expect(matchesFilter({ verb: 'program.month_closed' }, 'prices')).toBe(false);
    expect(matchesFilter({ verb: 'program.month_closed' }, 'close')).toBe(true);
    expect(ACTIVITY_FILTERS.close.server).toBe('money');
    expect(matchesFilter({ verb: 'schedule.generated' }, 'runs')).toBe(false);
  });
  it('groups by day and writes CSV', () => {
    const now = new Date('2026-11-25T18:00:00');
    const groups = dayGroups([{ createdAt: '2026-11-25T15:00:00' }, { createdAt: '2026-11-25T09:00:00' }, { createdAt: '2026-11-24T09:00:00' }], now);
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
    ]);
    expect(activityCsv([{ createdAt: '2026-11-25T15:00:00Z', verb: 'build.output_logged' }], () => 'Maya Chen', () => 'logged 100 kits, "Small"')).toBe('When,Who,What,Kind\n2026-11-25T15:00:00Z,Maya Chen,"logged 100 kits, ""Small""",build.output_logged\n');
  });
});
