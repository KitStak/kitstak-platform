'use client';
import { memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useOrgId } from '@/lib/hooks';
import type { ItemDto } from '@/server/services/contracts/dto';
import type { SubitemState, TableRow } from '../lib/rows';
import { useTable } from '../table-context';
import { ColumnHeaderRow } from './column-header-row';
import { CollapsedGroupRow, GroupHeaderRow } from './group-rows';
import { ItemRow } from './item-row';
import { AddItemRow, EmptyGroupRow, FooterRow, SubAddRow, SubStatusRow } from './misc-rows';

const NO_ITEMS: readonly ItemDto[] = [];
const NO_IDS: readonly string[] = [];

export interface RowRendererProps {
  readonly row: TableRow;
  readonly index: number;
  readonly start: number;
  readonly width: number;
  readonly buckets: ReadonlyMap<string, readonly ItemDto[]>;
  readonly subitems: ReadonlyMap<string, SubitemState>;
  readonly dragDisabled: boolean;
}

/** Maps one row-model entry to its component. */
export const RowRenderer = memo(function RowRenderer({
  row,
  index,
  start,
  width,
  buckets,
  subitems,
  dragDisabled,
}: RowRendererProps) {
  const { groupsById, visibleIdsByGroup, layout } = useTable();
  const queryClient = useQueryClient();
  const orgId = useOrgId();
  if (row.kind === 'gap') return null;
  const group = groupsById.get(row.groupId);
  if (!group) return null;
  const position = { index, start, height: row.height, width };
  const groupItems = buckets.get(group.id) ?? NO_ITEMS;

  switch (row.kind) {
    case 'group-header':
      return <GroupHeaderRow group={group} items={groupItems} {...position} />;
    case 'collapsed':
      return <CollapsedGroupRow group={group} items={groupItems} {...position} />;
    case 'column-header':
      return (
        <ColumnHeaderRow
          groupId={group.id}
          groupColor={group.color}
          scope="item"
          itemIds={visibleIdsByGroup.get(group.id) ?? NO_IDS}
          {...position}
          width={layout.totalWidth}
        />
      );
    case 'item':
      return (
        <ItemRow
          item={row.item}
          rowKey={row.key}
          variant="item"
          groupColor={group.color}
          siblingIds={visibleIdsByGroup.get(group.id) ?? NO_IDS}
          isLastItem={row.isLastItem}
          dragDisabled={dragDisabled}
          {...position}
        />
      );
    case 'sub-header': {
      const state = subitems.get(row.parentId);
      const ids = Array.isArray(state) ? state.map((item) => item.id) : NO_IDS;
      return (
        <ColumnHeaderRow
          groupId={group.id}
          groupColor={group.color}
          scope="subitem"
          itemIds={ids}
          {...position}
        />
      );
    }
    case 'subitem': {
      const state = subitems.get(row.parentId);
      const ids = Array.isArray(state) ? state.map((item) => item.id) : NO_IDS;
      return (
        <ItemRow
          item={row.item}
          rowKey={row.key}
          variant="subitem"
          groupColor={group.color}
          siblingIds={ids}
          isLastItem={false}
          dragDisabled
          {...position}
        />
      );
    }
    case 'sub-status':
      return (
        <SubStatusRow
          status={row.status}
          groupColor={group.color}
          position={position}
          onRetry={() =>
            void queryClient.invalidateQueries({ queryKey: queryKeys.subitems(orgId, row.parentId) })
          }
        />
      );
    case 'sub-add': {
      const parent = groupItems.find((item) => item.id === row.parentId);
      return parent ? <SubAddRow parent={parent} groupColor={group.color} position={position} /> : null;
    }
    case 'add-item':
      return <AddItemRow group={group} position={position} rowKey={row.key} />;
    case 'empty-group':
      return <EmptyGroupRow group={group} position={position} />;
    case 'footer':
      return <FooterRow group={group} items={groupItems} position={position} />;
    default:
      return null;
  }
});
