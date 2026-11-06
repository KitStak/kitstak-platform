import { describe, expect, it } from 'vitest';
import type { ActivityDto, ColumnDto } from '@/server/services/contracts/dto';
import { describeActivity, formatWhen, shouldShowValues, valueText } from './activity-format';

const stage = {
  key: 'stage',
  type: 'status',
  title: 'Stage',
  settings: { labels: [{ id: 'won', name: 'Won', color: 'green' }] },
} as unknown as ColumnDto;
const owner = { key: 'owner', type: 'people', title: 'Owner', settings: {} } as unknown as ColumnDto;
const columns = new Map([[stage.key, stage]]);

function entry(partial: Partial<ActivityDto>): ActivityDto {
  return {
    id: 'a',
    boardId: 'b',
    itemId: 'i',
    actorId: 'u',
    actorName: 'Ada',
    actorImage: null,
    automationId: null,
    action: 'item.created',
    columnKey: null,
    before: null,
    after: null,
    createdAt: '2026-11-06T10:00:00Z',
    ...partial,
  };
}

describe('activity format', () => {
  it('describes actions', () => {
    expect(describeActivity(entry({ action: 'item.value_changed', columnKey: 'stage' }), columns)).toBe('changed Stage on');
    expect(describeActivity(entry({ action: 'column.created', after: { title: 'Notes' } }), columns)).toBe('added a column “Notes”');
    expect(describeActivity(entry({ action: 'weird.thing_done' }), columns)).toBe('weird thing done');
    expect(shouldShowValues(entry({ action: 'item.renamed' }))).toBe(true);
    expect(shouldShowValues(entry({ action: 'item.created' }))).toBe(false);
  });

  it('renders before / after values', () => {
    const users = new Map([['u1', { name: 'Ada' }]]);
    expect(valueText({ labelId: 'won' }, stage, users)).toBe('Won');
    expect(valueText({ ids: ['u1', 'x'] }, owner, users)).toBe('Ada');
    expect(valueText({ from: '2026-01-01', to: '2026-02-01' }, owner, users)).toBe('2026-01-01 → 2026-02-01');
    expect(valueText('Old name', undefined, users)).toBe('Old name');
    expect(valueText(null, stage, users)).toBe('');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    expect(formatWhen('2026-11-06T11:59:50Z', now)).toBe('just now');
    expect(formatWhen('2026-11-06T10:00:00Z', now)).toBe('2 hours ago');
    expect(formatWhen('2026-10-01T10:00:00Z', now)).toMatch(/Oct 1, 2026/);
  });
});
