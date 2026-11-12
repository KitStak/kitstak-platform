import { describe, expect, it } from 'vitest';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { cellDisplay, formatIsoDate, formatNumber } from './cell-display';

function column(overrides: Partial<ColumnDto>): ColumnDto {
  return {
    id: 'c1',
    boardId: 'b1',
    key: 'k',
    title: 'K',
    description: null,
    type: 'text',
    scope: 'item',
    settings: {} as ColumnDto['settings'],
    width: 140,
    position: 'a0',
    hidden: false,
    required: false,
    ...overrides,
  };
}

function item(values: Record<string, unknown>, computed: Record<string, unknown> = {}): ItemDto {
  return {
    id: 'i1',
    boardId: 'b1',
    groupId: 'g1',
    parentItemId: null,
    name: 'Item',
    position: 'a0',
    values: values as ItemDto['values'],
    computed,
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: '',
    updatedAt: '',
    archivedAt: null,
    deletedAt: null,
  };
}

const maya: UserSummaryDto = { id: 'u1', name: 'Maya Chen', email: 'm@x.test', image: null, title: null };
const users = new Map([[maya.id, maya]]);

describe('cellDisplay', () => {
  it('resolves status labels from column settings', () => {
    const status = column({
      type: 'status',
      settings: { labels: [{ id: 'l1', name: 'Won', color: 'green', position: 0 }] } as ColumnDto['settings'],
    });
    expect(cellDisplay(status, item({ k: { labelId: 'l1' } }), users)).toEqual({
      kind: 'label',
      label: 'Won',
      color: 'green',
    });
    expect(cellDisplay(status, item({ k: { labelId: 'missing' } }), users)).toEqual({ kind: 'empty' });
  });
  it('maps people ids to known users only', () => {
    const people = column({ type: 'people' });
    expect(cellDisplay(people, item({ k: { ids: ['u1', 'ghost'] } }), users)).toEqual({
      kind: 'people',
      people: [maya],
    });
  });
  it('formats currency, dates and timelines', () => {
    expect(
      cellDisplay(column({ type: 'currency' }), item({ k: { amount: 12500, currency: 'USD' } }), users),
    ).toMatchObject({ text: '$12,500' });
    expect(cellDisplay(column({ type: 'date' }), item({ k: { date: '2026-03-04' } }), users)).toEqual({
      kind: 'text',
      text: 'Mar 4, 2026',
    });
    expect(
      cellDisplay(column({ type: 'timeline' }), item({ k: { from: '2026-01-01', to: '2026-01-31' } }), users),
    ).toMatchObject({ kind: 'text' });
  });
  it('prefers computed values and treats missing checkboxes as unchecked', () => {
    expect(cellDisplay(column({ type: 'formula' }), item({}, { k: 42 }), users)).toEqual({
      kind: 'text',
      text: '42',
      align: 'end',
    });
    expect(cellDisplay(column({ type: 'checkbox' }), item({}), users)).toEqual({
      kind: 'check',
      checked: false,
    });
  });
  it('unwraps formula results and last-updated timestamps', () => {
    expect(cellDisplay(column({ type: 'formula' }), item({}, { k: { result: 28000 } }), users)).toEqual({
      kind: 'text',
      text: '28,000',
      align: 'end',
    });
    expect(
      cellDisplay(
        column({ type: 'last_updated' }),
        item({}, { k: { at: '2026-11-01T09:21:49.706Z', userId: 'u1' } }),
        users,
      ),
    ).toEqual({ kind: 'text', text: 'Nov 1, 2026' });
    expect(cellDisplay(column({ type: 'formula' }), item({}, { k: { result: null } }), users)).toEqual({
      kind: 'empty',
    });
  });
  it('rejects malformed values safely', () => {
    expect(cellDisplay(column({ type: 'email' }), item({ k: 5 }), users)).toEqual({ kind: 'empty' });
    expect(formatIsoDate('nope')).toBeNull();
    expect(formatNumber(10, 'NOT-A-CODE')).toBe('10 NOT-A-CODE');
  });
});
