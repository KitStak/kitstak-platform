'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronRight, Maximize2, MessageCircle, MessageCirclePlus, Pencil } from 'lucide-react';
import { Tooltip, cn } from '@/components/ui';
import type { ItemDto } from '@/server/services/contracts/dto';
import { useTableStore } from '../state/table-store';
import { useTable, type GridDirection } from '../table-context';

const NAME_MAX = 2_000;

function isPrintable(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
}

export interface NameCellProps {
  readonly item: ItemDto;
  readonly rowKey: string;
  readonly width: number;
  readonly tabIndex: number;
  readonly variant: 'item' | 'subitem';
  readonly flash: boolean;
  readonly expanded?: boolean;
  readonly onToggleExpand?: () => void;
  readonly readOnly: boolean;
  readonly dragHandleProps?: Record<string, unknown>;
}

/**
 * Sticky item name cell: a click anywhere (the name included) opens the item — matching
 * monday.com — while inline rename sits behind the hover pencil (or F2/Enter/typing with the
 * cell focused). The bubble opens Updates, the chevron expands subitems, Ctrl/Cmd+Enter opens.
 */
export function NameCell({
  item,
  rowKey,
  width,
  tabIndex,
  variant,
  flash,
  expanded = false,
  onToggleExpand,
  readOnly,
  dragHandleProps,
}: NameCellProps) {
  const { actions, onOpenItem, navigate, terminology } = useTable();
  const editing = useTableStore((state) =>
    state.editingName?.itemId === item.id ? state.editingName : null,
  );
  const editName = useTableStore((state) => state.editName);
  const cellRef = useRef<HTMLDivElement>(null);
  const isTemp = item.id.startsWith('temp-');
  const canRename = !readOnly && !isTemp;

  const finish = (draft: string | null, direction?: GridDirection) => {
    if (draft !== null) actions.rename(item, draft.slice(0, NAME_MAX));
    editName(null);
    requestAnimationFrame(() => {
      if (direction) navigate(rowKey, 1, direction);
      else cellRef.current?.focus({ preventScroll: true });
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || editing) return;
    if ((event.key === 'Enter' || event.key === 'F2') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!isTemp) onOpenItem(item.id);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'F2') && canRename) {
      event.preventDefault();
      editName(item.id, null, true);
      return;
    }
    if (canRename && isPrintable(event) && !(event.key === ' ' && event.shiftKey)) {
      event.preventDefault();
      editName(item.id, event.key);
    }
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || editing || isTemp) return;
    onOpenItem(item.id);
  };

  const bubble = item.updateCount > 0;
  return (
    <div
      ref={cellRef}
      role="gridcell"
      tabIndex={tabIndex}
      data-grid-col={1}
      data-column-key="name"
      data-column-type="name"
      data-testid="name-cell"
      data-editing={editing ? 'true' : undefined}
      onKeyDown={onKeyDown}
      onClick={onClick}
      className={cn(
        'bt-sticky-cell bt-focusable group/name cursor-pointer gap-1 pr-1.5',
        variant === 'subitem' ? 'pl-1' : 'pl-1.5',
        editing && 'shadow-[inset_0_0_0_2px_var(--focus-ring)]',
      )}
      style={{ width, ...(flash && { animation: 'bt-flash 600ms var(--ease-out)' }) }}
      {...(editing ? {} : dragHandleProps)}
    >
      {variant === 'item' && !editing ? (
        <ExpandToggle count={item.subitemCount} expanded={expanded} onToggle={onToggleExpand} />
      ) : null}
      {editing ? (
        <NameInput
          initial={editing.seed ?? item.name}
          selectAll={editing.selectAll && editing.seed === null}
          label={`${terminology} name`}
          onDone={finish}
        />
      ) : (
        <span
          data-name-text=""
          className="min-w-0 truncate rounded-xs px-1 py-0.5 text-base text-fg underline-offset-2 group-hover/name:underline"
          title={item.name.length > 40 ? item.name : undefined}
        >
          {item.name}
        </span>
      )}
      {!editing && canRename ? (
        <button
          type="button"
          tabIndex={-1}
          data-testid="name-edit"
          aria-label={`Rename ${item.name}`}
          onClick={(event) => {
            event.preventDefault();
            editName(item.id, null, true);
          }}
          className="bt-reveal inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Pencil aria-hidden className="size-3.5" />
        </button>
      ) : null}
      {/* Reserve room for the absolute "Open" reveal so the pencil never sits under it. */}
      {editing ? null : <span className="min-w-16 flex-1" />}
      {!editing && !isTemp ? (
        <>
          <button
            type="button"
            className="bt-reveal absolute right-10 inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border-default bg-[var(--bt-row-bg)] px-1.5 text-xs font-medium text-fg-secondary shadow-[-10px_0_8px_-2px_var(--bt-row-bg)] hover:border-border-strong hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
            onClick={(event) => {
              event.preventDefault();
              onOpenItem(item.id);
            }}
            tabIndex={-1}
            aria-label={`Open ${item.name}`}
          >
            <Maximize2 aria-hidden className="size-3.5" />
            <span>Open</span>
          </button>
          <Tooltip
            content={
              bubble
                ? `${item.updateCount} update${item.updateCount === 1 ? '' : 's'}`
                : 'Start a conversation'
            }
          >
            <button
              type="button"
              data-testid="updates-bubble"
              tabIndex={-1}
              aria-label={
                bubble ? `${item.updateCount} updates on ${item.name}` : `Add an update to ${item.name}`
              }
              onClick={(event) => {
                event.preventDefault();
                onOpenItem(item.id, { tab: 'updates' });
              }}
              className={cn(
                'relative inline-flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors duration-[var(--duration-instant)]',
                'focus-visible:outline-2 focus-visible:outline-focus',
                bubble
                  ? 'text-primary hover:bg-primary-subtle'
                  : 'bt-reveal text-icon hover:bg-hover hover:text-icon-strong max-sm:hidden',
              )}
            >
              {bubble ? (
                <>
                  <MessageCircle
                    aria-hidden
                    className="size-[22px] fill-primary text-primary"
                    strokeWidth={1.5}
                  />
                  <span className="absolute inset-0 flex items-center justify-center pb-px text-2xs font-semibold text-primary-fg tabular-nums">
                    {item.updateCount > 9 ? '9+' : item.updateCount}
                  </span>
                </>
              ) : (
                <MessageCirclePlus aria-hidden className="size-[18px]" />
              )}
            </button>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

function ExpandToggle({
  count,
  expanded,
  onToggle,
}: {
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle?: () => void;
}) {
  const has = count > 0;
  return (
    <button
      type="button"
      tabIndex={-1}
      data-testid="subitems-toggle"
      aria-expanded={expanded}
      aria-label={expanded ? 'Hide subitems' : has ? `Show ${count} subitems` : 'Add subitems'}
      onClick={(event) => {
        event.preventDefault();
        onToggle?.();
      }}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-0.5 rounded-sm px-0.5 text-xs text-fg-muted hover:bg-hover hover:text-fg',
        'focus-visible:outline-2 focus-visible:outline-focus',
        !has && !expanded && 'bt-reveal max-sm:hidden',
      )}
    >
      <ChevronRight
        aria-hidden
        className="bt-chevron size-4"
        style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
      />
      {has ? <span className="min-w-3 tabular-nums">{count}</span> : null}
    </button>
  );
}

function NameInput({
  initial,
  selectAll,
  label,
  onDone,
}: {
  readonly initial: string;
  readonly selectAll: boolean;
  readonly label: string;
  readonly onDone: (draft: string | null, direction?: GridDirection) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if (selectAll) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }, [selectAll]);

  const complete = (value: string | null, direction?: GridDirection) => {
    if (done.current) return;
    done.current = true;
    onDone(value !== null && value.trim() ? value : null, direction);
  };

  return (
    <input
      ref={ref}
      value={draft}
      maxLength={NAME_MAX}
      aria-label={label}
      data-testid="name-input"
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.preventDefault()}
      onDoubleClick={(event) => {
        // The native double-click selects one word; a name edit selects the whole name.
        const input = event.currentTarget;
        event.preventDefault();
        requestAnimationFrame(() => input.select());
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          complete(draft, 'down');
        } else if (event.key === 'Escape') {
          event.preventDefault();
          complete(null);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          complete(draft, event.shiftKey ? 'prev' : 'next');
        }
      }}
      onBlur={() => complete(draft)}
      className="h-7 w-full min-w-0 flex-1 rounded-xs border border-primary bg-panel px-1 text-base text-fg outline-none shadow-[0_0_0_2px_var(--focus-ring-soft)]"
    />
  );
}
