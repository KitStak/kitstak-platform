import { describe, expect, it } from 'vitest';
import type { ColumnDto } from '@/server/services/contracts/dto';
import { cardFields } from './card-fields';

function column(partial: Partial<ColumnDto>): ColumnDto {
  return {
    id: partial.id ?? 'c1',
    boardId: 'b1',
    key: partial.key ?? 'col',
    title: partial.title ?? 'Column',
    description: null,
    type: partial.type ?? 'text',
    scope: partial.scope ?? 'item',
    settings: {},
    width: 160,
    position: 'a0',
    hidden: false,
    required: false,
    ...partial,
  };
}

const COLUMNS: readonly ColumnDto[] = [
  column({ id: 'n', key: 'name', title: 'Name', type: 'name', scope: 'item' }),
  column({ id: 'i1', key: 'owner', title: 'Owner', type: 'people', scope: 'item' }),
  column({ id: 'i2', key: 'status', title: 'Status', type: 'status', scope: 'item' }),
  column({ id: 's1', key: 'sub_owner', title: 'Owner', type: 'people', scope: 'subitem' }),
  column({ id: 's2', key: 'sub_status', title: 'Status', type: 'status', scope: 'subitem' }),
];

describe('cardFields', () => {
  it('shows only item-scoped columns for a top-level item', () => {
    expect(cardFields(COLUMNS, null).map((entry) => entry.id)).toEqual(['i1', 'i2']);
  });

  it('shows only subitem-scoped columns for a subitem', () => {
    expect(cardFields(COLUMNS, 'parent-id').map((entry) => entry.id)).toEqual(['s1', 's2']);
  });

  it('never includes the name column', () => {
    const withSubName = [...COLUMNS, column({ id: 'sn', key: 'sub_name', type: 'name', scope: 'subitem' })];
    expect(cardFields(withSubName, 'parent-id').some((entry) => entry.type === 'name')).toBe(false);
  });
});
