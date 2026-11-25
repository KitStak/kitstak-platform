import { describe, expect, it } from 'vitest';
import { ACTIVITY_FILTERS, activityCsv, dayGroups, foldActivity, isDiscardedDraft, matchesFilter } from './activity-model';

describe('activity model', () => {
  it('filters by kind', () => {
    expect(matchesFilter({ verb: 'price_card.version_published' }, 'prices')).toBe(true);
    expect(matchesFilter({ verb: 'program.month_closed' }, 'prices')).toBe(false);
    expect(matchesFilter({ verb: 'program.month_closed' }, 'close')).toBe(true);
    expect(ACTIVITY_FILTERS.close.server).toBe('money');
    expect(matchesFilter({ verb: 'schedule.generated' }, 'runs')).toBe(false);
  });
  it('keeps Everything to program rows', () => {
    for (const verb of ['build.output_logged', 'price_card.version_published', 'task.moved', 'schedule.paused', 'comment.added', 'program.month_closed']) expect(matchesFilter({ verb }, 'all')).toBe(true);
    for (const verb of ['automation.created', 'form.created', 'form.deleted', 'field.updated', 'label.created']) expect(matchesFilter({ verb }, 'all')).toBe(false);
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

describe('activity folding', () => {
  const base = { actorId: 'maya', actorKind: 'user' as const, taskId: null };
  const created = (id: string, at: string, from = '2026-11-26') => ({ ...base, id, verb: 'price_card.draft_created', before: null, after: { effectiveFrom: from }, createdAt: at });
  const deleted = (id: string, at: string, from = '2026-11-26') => ({ ...base, id, verb: 'price_card.version_deleted', before: { status: 'draft', number: null, effectiveFrom: from }, after: null, createdAt: at });
  it('folds started and discarded drafts into one line with a count', () => {
    const rows = [deleted('d4', '8'), created('c4', '7'), deleted('d3', '6'), created('c3', '5'), deleted('d2', '4'), created('c2', '3'), deleted('d1', '2'), created('c1', '1')];
    const lines = foldActivity(rows);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'cycle', count: 4, effectiveFrom: '2026-11-26' });
    expect(lines[0]!.rows).toHaveLength(8);
  });
  it('keeps a draft that is still open, and other people, on their own lines', () => {
    const rows = [created('c2', '3'), deleted('d1', '2'), created('c1', '1'), { ...created('x', '0'), actorId: 'jo' }];
    const lines = foldActivity(rows);
    expect(lines.map((line) => [line.kind, line.count])).toEqual([['single', 1], ['cycle', 1], ['single', 1]]);
    expect(isDiscardedDraft(deleted('d', '1'))).toBe(true);
    expect(isDiscardedDraft({ verb: 'price_card.version_deleted', before: { status: 'scheduled' } })).toBe(false);
  });
  it('folds the same action on the same build in a row', () => {
    const row = (id: string, taskId: string) => ({ ...base, id, taskId, verb: 'task.updated', before: null, after: null, createdAt: id });
    const lines = foldActivity([row('3', 't1'), row('2', 't1'), row('1', 't2')]);
    expect(lines.map((line) => [line.kind, line.count])).toEqual([['repeat', 2], ['single', 1]]);
  });
  it('treats a rate typed into a draft and then discarded as one cycle', () => {
    const rate = (id: string, at: string) => ({ ...base, id, verb: 'price_card.variant_rate_changed', before: null, after: { startsOn: '2026-11-25', variants: 1 }, createdAt: at });
    const lines = foldActivity([deleted('d2', '4', '2026-11-25'), rate('r2', '3'), deleted('d1', '2', '2026-11-25'), rate('r1', '1')]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'cycle', count: 2, effectiveFrom: '2026-11-25' });
  });
});
