'use client';
import { memo, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEventHandler } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Archive,
  ArrowRightLeft,
  Copy,
  ExternalLink,
  FolderInput,
  Link2,
  ListPlus,
  ListTree,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  cn,
} from '@/components/ui';
import { isCellEmpty, rawCellValue, type CellBoard } from '@/features/cells';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { CardField } from './card-field';

export interface KanbanCardActions {
  readonly onOpen: (itemId: string) => void;
  readonly onDuplicate: (itemId: string) => void;
  readonly onArchive: (itemId: string) => void;
  readonly onDelete: (itemId: string) => void;
  readonly onCommit: (item: ItemDto, column: ColumnDto, value: unknown) => void;
  /** Move the card to another lane (keyboard / menu alternative to dragging). */
  readonly onMoveToLane: (itemId: string, laneId: string) => void;
  readonly onMoveToGroup: (itemId: string, groupId: string) => void;
  readonly onAddSubitem: (itemId: string) => void;
}

export interface CardTarget {
  readonly id: string;
  readonly title: string;
}

/** Optimistic (not yet persisted) cards carry a client temp id. */
export function isPendingItem(item: Pick<ItemDto, 'id'>): boolean {
  return item.id.startsWith('temp-');
}

export interface KanbanCardProps {
  readonly item: ItemDto;
  readonly laneId: string;
  readonly fields: readonly ColumnDto[];
  readonly board: CellBoard;
  readonly users: readonly UserSummaryDto[];
  readonly userMap: ReadonlyMap<string, UserSummaryDto>;
  readonly noun: string;
  /** Lane is a closed state (done / won / lost): no overdue nagging. */
  readonly closed: boolean;
  readonly lanes: readonly CardTarget[];
  readonly groups: readonly CardTarget[];
  readonly showEmptyFields: boolean;
  readonly actions: KanbanCardActions;
  readonly canEdit: boolean;
  /** Rendered inside the DragOverlay (no sortable wiring). */
  readonly overlay?: boolean;
  readonly onNavigate?: (event: KeyboardEvent<HTMLElement>, itemId: string) => boolean;
}

function CardMenu({ item, laneId, noun, lanes, groups, actions, canEdit }: KanbanCardProps) {
  const otherLanes = lanes.filter((lane) => lane.id !== laneId);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${noun} actions for ${item.name}`}
          data-card-menu=""
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            '-mt-0.5 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-icon',
            'opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/card:opacity-100 group-focus-within/card:opacity-100',
            'hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus',
            'data-[state=open]:bg-hover data-[state=open]:opacity-100 max-[768px]:opacity-100',
          )}
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => actions.onOpen(item.id)}>
          Open {noun.toLowerCase()}
        </DropdownMenuItem>
        {otherLanes.length ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<ArrowRightLeft aria-hidden />} disabled={!canEdit} data-testid="kanban-card-move">
              Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {otherLanes.map((lane) => (
                <DropdownMenuItem key={lane.id} onSelect={() => actions.onMoveToLane(item.id, lane.id)} data-testid="kanban-card-move-target">
                  {lane.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {groups.length > 1 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<FolderInput aria-hidden />} disabled={!canEdit}>
              Move to group
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {groups.map((group) => (
                <DropdownMenuItem key={group.id} disabled={group.id === item.groupId} onSelect={() => actions.onMoveToGroup(item.id, group.id)}>
                  {group.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuItem icon={<ListPlus aria-hidden />} disabled={!canEdit} onSelect={() => actions.onAddSubitem(item.id)}>
          Add subitem
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Copy aria-hidden />} disabled={!canEdit} onSelect={() => actions.onDuplicate(item.id)}>
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Link2 aria-hidden />}
          onSelect={() => {
            const url = new URL(window.location.href);
            url.searchParams.set('item', item.id);
            void navigator.clipboard?.writeText(url.toString());
          }}
        >
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Archive aria-hidden />} disabled={!canEdit} onSelect={() => actions.onArchive(item.id)}>
          Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" disabled={!canEdit} onSelect={() => actions.onDelete(item.id)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Memoised separately from the sortable wrapper: drag moves re-render only the shell. */
const CardBody = memo(function CardBody(props: KanbanCardProps) {
  const { item, fields, board, users, userMap, closed, showEmptyFields, actions, canEdit, overlay } = props;
  const visible = showEmptyFields ? fields : fields.filter((column) => !isCellEmpty(column.type, rawCellValue(column, item)));
  const pending = isPendingItem(item);
  const editable = canEdit && !overlay && !pending;
  return (
    <>
      <div className="flex items-start gap-2">
        <h4 className="line-clamp-3 min-w-0 flex-1 text-base font-medium break-words text-fg" title={item.name}>
          {item.name}
        </h4>
        {pending ? (
          <span className="-mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 text-xs text-fg-muted" data-testid="kanban-card-saving">
            <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
            Saving…
          </span>
        ) : overlay ? null : (
          <CardMenu {...props} />
        )}
      </div>
      {visible.length > 0 ? (
        <div aria-label={`${item.name} fields`} className="mt-2 flex flex-col gap-1">
          {visible.map((column) => (
            <CardField
              key={column.key}
              column={column}
              item={item}
              board={board}
              users={users}
              userMap={userMap}
              editable={editable}
              closed={closed}
              onCommit={actions.onCommit}
            />
          ))}
        </div>
      ) : null}
      {item.updateCount > 0 || item.subitemCount > 0 ? (
        <div className="mt-2 flex items-center gap-3 text-xs text-fg-muted">
          {item.updateCount > 0 ? (
            <span className="inline-flex items-center gap-1" title={`${item.updateCount} updates`}>
              <MessageSquare aria-hidden className="size-3.5" />
              <span className="tabular-nums">{item.updateCount}</span>
              <span className="sr-only">updates</span>
            </span>
          ) : null}
          {item.subitemCount > 0 ? (
            <span className="inline-flex items-center gap-1" title={`${item.subitemCount} subitems`}>
              <ListTree aria-hidden className="size-3.5" />
              <span className="tabular-nums">{item.subitemCount}</span>
              <span className="sr-only">subitems</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
});

const CARD_CLASS =
  'group/card relative rounded-lg border border-border-subtle bg-panel p-3 text-left shadow-xs outline-none';

export const KanbanCard = memo(function KanbanCard(props: KanbanCardProps) {
  const { item, laneId, actions, canEdit, onNavigate } = props;
  const pending = isPendingItem(item);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: 'card', laneId },
    disabled: !canEdit || pending,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (pending || (event.target as HTMLElement).closest('[data-ks-cell],[data-card-menu],[role="menu"]')) return;
    actions.onOpen(item.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!pending) actions.onOpen(item.id);
      return;
    }
    if (onNavigate?.(event, item.id)) return;
    listeners?.onKeyDown?.(event);
  };
  return (
    <article
      ref={setNodeRef}
      style={style}
      role="listitem"
      tabIndex={0}
      aria-roledescription="draggable card"
      aria-label={item.name}
      aria-describedby={attributes['aria-describedby']}
      aria-busy={pending || undefined}
      data-testid="kanban-card"
      data-card-id={item.id}
      data-item-id={item.id}
      data-pending={pending ? 'true' : undefined}
      onClick={onClick}
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLElement> | undefined}
      onKeyDown={onKeyDown}
      className={cn(
        CARD_CLASS,
        'cursor-pointer transition-[box-shadow,border-color] duration-[var(--duration-fast)] ease-out',
        'hover:border-border-default hover:shadow-md focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]',
        // Browser-level windowing: off-screen cards skip layout and paint.
        '[contain-intrinsic-size:auto_112px] [content-visibility:auto]',
        isDragging && 'border-dashed border-primary bg-primary-subtle shadow-none [&>*]:invisible',
        (!canEdit || pending) && 'cursor-default',
        pending && 'opacity-70',
      )}
    >
      <CardBody {...props} />
    </article>
  );
});

/** Floating copy of a card while it is dragged (tilted, lifted). */
export function KanbanCardOverlay(props: KanbanCardProps) {
  return (
    <article
      aria-hidden
      className={cn(
        CARD_CLASS,
        'w-[256px] cursor-grabbing opacity-95 shadow-lg ring-1 ring-primary/30',
        'rotate-[2.5deg] motion-reduce:rotate-0',
      )}
    >
      <CardBody {...props} overlay />
    </article>
  );
}
