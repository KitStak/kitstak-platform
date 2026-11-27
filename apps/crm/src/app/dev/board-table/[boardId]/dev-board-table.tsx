'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Gauge, Maximize2, MessageCircle } from 'lucide-react';
import { Badge, Button, Drawer, DrawerContent, SearchInput, ToggleGroup } from '@/components/ui';
import { BoardTable, useBoardTableState, type OpenItemOptions } from '@/features/board-table';
import type { CellDensity } from '@/features/cells';
import { OrgProvider, useBoard, useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { BoardPayloadDto, ItemDto } from '@/server/services/contracts/dto';

interface DevBoardTableProps {
  readonly orgId: string;
  readonly boardId: string;
  readonly userId: string;
  readonly perfRows: number;
}

export function DevBoardTable(props: DevBoardTableProps) {
  return (
    <OrgProvider orgId={props.orgId}>
      <Harness {...props} />
    </OrgProvider>
  );
}

const PERF_PREFIX = 'perf-';

/** Pads the cached payload with synthetic rows cloned from real ones (read-only perf check). */
function usePerfRows(boardId: string, count: number) {
  const queryClient = useQueryClient();
  const orgId = useOrgId();
  const board = useBoard(boardId);
  useEffect(() => {
    const payload = board.data;
    if (!count || !payload || payload.items.length === 0) return;
    if (payload.items.some((item) => item.id.startsWith(PERF_PREFIX))) return;
    const source = payload.items;
    const groups = payload.groups;
    const extra: ItemDto[] = Array.from({ length: count }, (_, index) => {
      const base = source[index % source.length] as ItemDto;
      return {
        ...base,
        id: `${PERF_PREFIX}${index}`,
        name: `${base.name} #${index + 1}`,
        groupId: groups[index % groups.length]?.id ?? base.groupId,
        position: `z${index.toString(36).padStart(5, '0')}`,
        updateCount: 0,
        subitemCount: 0,
      };
    });
    queryClient.setQueryData<BoardPayloadDto>(queryKeys.boardPayload(orgId, boardId), (current) =>
      current
        ? { ...current, items: [...current.items, ...extra], totalItems: current.totalItems + extra.length }
        : current,
    );
  }, [board.data, boardId, count, orgId, queryClient]);
}

function Harness({ boardId, userId, perfRows }: DevBoardTableProps) {
  const board = useBoard(boardId);
  const view = useMemo(() => {
    const views = board.data?.views ?? [];
    return (
      views.find((entry) => entry.type === 'table' && entry.isDefault) ??
      views.find((entry) => entry.type === 'table') ??
      null
    );
  }, [board.data?.views]);
  const table = useBoardTableState(boardId, view);
  const [openItem, setOpenItem] = useState<{ id: string; tab?: string } | null>(null);
  usePerfRows(boardId, perfRows);
  const item = openItem ? board.data?.items.find((entry) => entry.id === openItem.id) : undefined;

  return (
    <div className="flex h-dvh flex-col bg-app p-2 max-sm:p-0">
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-panel shadow-xs max-sm:rounded-none">
        <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-6 py-3 max-sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="truncate text-xl font-medium text-fg">
              {board.data?.board.name ?? 'Board'}
            </h1>
            <Badge tone="neutral">
              Board table · dev
            </Badge>
            {perfRows ? (
              <Badge tone="warning" icon={<Gauge aria-hidden />}>
                +{perfRows.toLocaleString()} synthetic rows (read-only)
              </Badge>
            ) : null}
          </div>
          <SearchInput
            value={table.state.search}
            onValueChange={table.setSearch}
            placeholder="Search this board"
            aria-label="Search this board"
            containerClassName="w-60 max-sm:w-full"
          />
          <ToggleGroup<CellDensity>
            label="Row height"
            size="sm"
            value={table.state.density}
            onValueChange={table.setDensity}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'default', label: 'Default' },
              { value: 'comfortable', label: 'Roomy' },
            ]}
          />
          {table.hasFilters ? (
            <Button variant="tertiary" size="sm" onClick={table.clearFilters}>
              Clear filters ({table.state.filters.rules.length + (table.state.search ? 1 : 0)})
            </Button>
          ) : null}
          {table.state.sort.length ? (
            <Button variant="tertiary" size="sm" onClick={() => table.setSort([])}>
              Clear sort
            </Button>
          ) : null}
          <Link
            href={perfRows ? `/dev/board-table/${boardId}` : `/dev/board-table/${boardId}?perf=5000`}
            className="text-sm font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {perfRows ? 'Exit perf mode' : 'Perf mode (5k rows)'}
          </Link>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <BoardTable
            boardId={boardId}
            view={view}
            currentUserId={userId}
            readOnly={perfRows > 0}
            realtime={perfRows === 0}
            onOpenItem={(id: string, options?: OpenItemOptions) => setOpenItem({ id, tab: options?.tab })}
          />
        </div>
      </main>
      <Drawer open={openItem !== null} onOpenChange={(open) => (open ? undefined : setOpenItem(null))}>
        <DrawerContent
          title={item?.name ?? 'Item'}
          description="Item panel stand-in (the item-panel module owns the real one)."
          data-testid="item-panel"
        >
          <div className="flex flex-col gap-3 p-6 text-base text-fg-secondary">
            <p className="flex items-center gap-2">
              {openItem?.tab === 'updates' ? (
                <MessageCircle aria-hidden className="size-4" />
              ) : (
                <Maximize2 aria-hidden className="size-4" />
              )}
              Opened {openItem?.tab === 'updates' ? 'on the Updates tab' : 'from the table'}.
            </p>
            <p>{item ? `${item.updateCount} update(s) · ${item.subitemCount} subitem(s)` : null}</p>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
