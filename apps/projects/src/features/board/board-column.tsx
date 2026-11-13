'use client';
/** Board column header (status, count, WIP limit, menu), collapsed strip, and the droppable cell. */
import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronsLeftRight, ChevronsRightLeft, Gauge, MoreHorizontal, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  cn,
} from '@/components/ui';
import { StatusIcon } from '@/components/pm';
import { STATUS_CATEGORY_LABELS } from '@/lib/constants';
import type { StatusDTO } from '@/lib/types';

const WIP_OPTIONS = [3, 5, 8, 10, 15, 20] as const;

export const COLUMN_WIDTH = 'w-[256px] max-sm:w-[min(280px,calc(100vw-56px))]';
export const COLLAPSED_WIDTH = 'w-11';

export function CountPill({ count, wipCount, limit }: { readonly count: number; readonly wipCount: number; readonly limit: number | null }) {
  const over = limit !== null && wipCount > limit;
  const at = limit !== null && wipCount === limit;
  const text = limit !== null ? `${wipCount} / ${limit}` : String(count);
  const shown = count !== wipCount ? ` (${count} shown with your filters)` : '';
  return (
    <Tooltip
      content={over ? `${wipCount} tasks, over the limit of ${limit}. Finish something before starting more.${shown}` : limit !== null ? `${wipCount} of ${limit} allowed at a time${shown}` : `${count} ${count === 1 ? 'task' : 'tasks'}`}
      side="top"
    >
      <span
        tabIndex={0}
        data-testid="column-count"
        data-over={over || undefined}
        className={cn(
          'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-focus',
          over ? 'bg-danger-subtle text-danger-text' : at ? 'bg-warning-subtle text-warning-text' : 'bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] text-fg-secondary',
        )}
      >
        {text}
      </span>
    </Tooltip>
  );
}

export interface ColumnHeaderProps {
  readonly status: StatusDTO;
  readonly count: number;
  readonly wipCount: number;
  readonly canCreate: boolean;
  readonly canManage: boolean;
  readonly onAdd: () => void;
  readonly onCollapse: () => void;
  readonly onWipLimit: (limit: number | null) => void;
  readonly sticky?: boolean;
}

export function ColumnHeader({ status, count, wipCount, canCreate, canManage, onAdd, onCollapse, onWipLimit, sticky }: ColumnHeaderProps) {
  return (
    <header
      className={cn('flex h-10 shrink-0 items-center gap-2 rounded-t-xl pr-1 pl-3', sticky && 'bg-sunken')}
      style={{ boxShadow: `inset 0 2px 0 0 var(--label-${status.color}, var(--border-strong))` }}
    >
      <StatusIcon category={status.category} color={status.color} />
      <h2 className="min-w-0 truncate text-sm font-semibold text-fg" title={`${status.name} (${STATUS_CATEGORY_LABELS[status.category]})`}>
        {status.name}
      </h2>
      <CountPill count={count} wipCount={wipCount} limit={status.wipLimit} />
      <span className="ml-auto flex items-center">
        {canCreate ? <IconButton label={`Add a task to ${status.name}`} icon={<Plus aria-hidden />} size="sm" onClick={onAdd} data-testid="column-add" /> : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`${status.name} column options`} icon={<MoreHorizontal aria-hidden />} size="sm" data-testid="column-menu" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {canCreate ? (
              <DropdownMenuItem icon={<Plus aria-hidden />} onSelect={onAdd}>
                Add a task here
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem icon={<ChevronsRightLeft aria-hidden />} onSelect={onCollapse} data-testid="column-collapse">
              Collapse column
            </DropdownMenuItem>
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger icon={<Gauge aria-hidden />} description="Limit how many tasks sit here at once">
                    Work-in-progress limit
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    <DropdownMenuRadioGroup value={status.wipLimit === null ? 'none' : String(status.wipLimit)} onValueChange={(value) => onWipLimit(value === 'none' ? null : Number(value))}>
                      <DropdownMenuRadioItem value="none">No limit</DropdownMenuRadioItem>
                      {WIP_OPTIONS.map((limit) => (
                        <DropdownMenuRadioItem key={limit} value={String(limit)} data-testid={`wip-${limit}`}>
                          {`${limit} tasks`}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </header>
  );
}

/** A collapsed column: a narrow vertical strip that is still a drop target. */
export function CollapsedColumn({ status, count, containerId, onExpand, isOver }: { readonly status: StatusDTO; readonly count: number; readonly containerId: string; readonly onExpand: () => void; readonly isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: containerId, data: { type: 'cell' } });
  return (
    <div ref={setNodeRef} className={cn('flex h-full shrink-0', COLLAPSED_WIDTH)} data-testid="board-column-collapsed">
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Expand ${status.name} (${count})`}
        aria-expanded={false}
        className={cn(
          'flex w-full flex-col items-center gap-2 rounded-xl bg-sunken py-3 text-fg outline-none',
          'transition-[box-shadow,background-color] hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          isOver && 'bg-primary-selected shadow-[0_0_0_2px_var(--focus-ring)]',
        )}
        style={{ boxShadow: isOver ? undefined : `inset 0 2px 0 0 var(--label-${status.color}, var(--border-strong))` }}
      >
        <ChevronsLeftRight aria-hidden className="size-4 text-icon" />
        <StatusIcon category={status.category} color={status.color} />
        <span className="text-xs font-semibold text-fg-secondary tabular-nums">{count}</span>
        <span className="text-sm font-semibold whitespace-nowrap [writing-mode:vertical-rl]">{status.name}</span>
      </button>
    </div>
  );
}

/** Droppable + sortable list of cards for one status (in one swimlane). */
export function BoardCell({
  containerId,
  cardIds,
  isOver,
  dragging,
  fill,
  className,
  children,
  footer,
}: {
  readonly containerId: string;
  readonly cardIds: readonly string[];
  readonly isOver: boolean;
  readonly dragging: boolean;
  /** Fill the column height (no swimlanes) and scroll inside. */
  readonly fill: boolean;
  readonly className?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: containerId, data: { type: 'cell' } });
  return (
    <div className={cn('flex min-h-0 flex-col', fill && 'flex-1', className)}>
      <SortableContext id={containerId} items={cardIds as string[]} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          data-testid="board-cell"
          data-container={containerId}
          className={cn(
            'flex flex-col gap-2 rounded-lg p-1.5 transition-colors duration-[var(--duration-fast)]',
            fill ? 'min-h-24 flex-1 overflow-y-auto [scrollbar-width:thin]' : 'min-h-14',
            isOver && 'bg-primary-selected/60',
          )}
        >
          {children}
          {cardIds.length === 0 && dragging ? (
            <div aria-hidden className={cn('flex h-16 items-center justify-center rounded-lg border-2 border-dashed text-xs text-fg-muted', isOver ? 'border-primary text-primary-text' : 'border-border-default')}>
              Drop here
            </div>
          ) : null}
        </div>
      </SortableContext>
      {footer}
    </div>
  );
}
