import { describe, expect, it } from 'vitest';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { settleSubitem, tempSubitem } from '../hooks/create-subitem';
import { LINKED_BATCH, linkedIdsInOrder, pendingBatches } from '../hooks/use-linked-items';
import { columnWidth, headerTitleWidth } from './columns';

function item(id: string, partial: Partial<ItemDto> = {}): ItemDto {
  return {
    id,
    boardId: 'b',
    groupId: 'g1',
    parentItemId: null,
    name: id,
    position: id,
    values: {},
    computed: {},
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    ...partial,
  };
}

function column(partial: Partial<ColumnDto> & Pick<ColumnDto, 'key' | 'type'>): ColumnDto {
  return {
    id: `c-${partial.key}`,
    boardId: 'b',
    title: partial.key,
    description: null,
    scope: 'item',
    settings: {} as ColumnDto['settings'],
    width: null,
    position: partial.key,
    hidden: false,
    required: false,
    ...partial,
  } as ColumnDto;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('optimistic subitems', () => {
  it('creates a pending subitem positioned after the last sibling', () => {
    const parent = item('p', { groupId: 'g2' });
    const temp = tempSubitem(parent, 'Call back', [item('s1', { position: 'a0' }), item('s2', { position: 'a1' })]);
    expect(temp.id.startsWith('temp-')).toBe(true);
    expect(temp.parentItemId).toBe('p');
    expect(temp.groupId).toBe('g2');
    expect(temp.position > 'a1').toBe(true);
  });

  it('swaps the temp row for the server row, or drops it on failure', () => {
    const temp = item('temp-1');
    const list = [item('a'), temp];
    expect(settleSubitem(list, 'temp-1', item('real'))?.map((entry) => entry.id)).toEqual(['a', 'real']);
    expect(settleSubitem(list, 'temp-1', null)?.map((entry) => entry.id)).toEqual(['a']);
    // A refetch that already brought the real row in must not duplicate it.
    expect(settleSubitem([item('real'), temp], 'temp-1', item('real'))?.map((entry) => entry.id)).toEqual([
      'real',
    ]);
    expect(settleSubitem(undefined, 'temp-1', null)).toBeUndefined();
  });
});

describe('linked item names', () => {
  it('collects linked ids in display order without duplicates or junk', () => {
    const items = [
      item('1', { values: { account: { itemIds: [uuid(2), uuid(1)] } } as never }),
      item('2', { values: { account: { itemIds: [uuid(1), 'nope'] }, other: 'x' } as never }),
    ];
    expect(linkedIdsInOrder(items)).toEqual([uuid(2), uuid(1)]);
  });

  it('batches only ids that were not requested yet', () => {
    const ids = Array.from({ length: LINKED_BATCH + 5 }, (_, index) => uuid(index));
    const batches = pendingBatches(ids, new Set([uuid(0)]));
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(LINKED_BATCH);
    expect(batches[1]).toHaveLength(4);
    expect(pendingBatches(ids, new Set(ids))).toEqual([]);
  });
});

describe('default column widths', () => {
  it('widens an unsized column so its whole header title fits', () => {
    const long = column({ key: 'close', type: 'date', title: 'Expected close date' });
    expect(columnWidth(long, { columnWidths: {} })).toBeGreaterThanOrEqual(headerTitleWidth(long.title));
  });

  it('keeps a width the user chose in the view', () => {
    const long = column({ key: 'close', type: 'date', title: 'Expected close date' });
    expect(columnWidth(long, { columnWidths: { close: 120 } })).toBe(120);
  });
});
