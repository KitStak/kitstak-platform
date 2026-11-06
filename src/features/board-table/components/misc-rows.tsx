'use client';
import { memo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { CircleAlert, Columns3 } from 'lucide-react';
import { Button, Skeleton, cn } from '@/components/ui';
import { CellSummary } from '@/features/cells';
import type { GroupDto, ItemDto } from '@/server/services/contracts/dto';
import { LAYOUT } from '../lib/rows';
import { useTableStore } from '../state/table-store';
import { groupColorVar, useTable } from '../table-context';

interface RowPosition {
  readonly index: number;
  readonly start: number;
  readonly height: number;
  readonly width: number;
}

function rowStyle(position: RowPosition, groupColor?: string): CSSProperties {
  return {
    top: position.start,
    height: position.height,
    width: position.width,
    ...(groupColor && { '--bt-group': groupColorVar(groupColor) }),
  } as CSSProperties;
}

/** Ghost input row at the bottom of each group: Enter adds and keeps focus; multi-line paste adds N. */
export const AddItemRow = memo(function AddItemRow({
  group,
  position,
  rowKey,
}: {
  readonly group: GroupDto;
  readonly position: RowPosition;
  readonly rowKey: string;
}) {
  const { actions, terminology, layout } = useTable();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const drop = useTableStore((state) => (state.drop?.rowKey === rowKey ? state.drop.side : null));
  const noun = terminology.toLowerCase();

  const submit = () => {
    if (!draft.trim()) return;
    actions.createItem(group.id, draft);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft('');
      inputRef.current?.blur();
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text/plain');
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.split('\t')[0] ?? '')
      .filter((line) => line.trim());
    if (lines.length < 2) return;
    event.preventDefault();
    void actions.createItems(group.id, lines);
  };

  return (
    <div
      role="row"
      aria-rowindex={position.index + 1}
      data-kind="add-item"
      data-row-key={rowKey}
      data-drop="group-end"
      data-group-id={group.id}
      className="bt-row"
      style={rowStyle(position, group.color)}
    >
      <div className="bt-sticky" style={{ width: layout.stickyWidth }}>
        <div className="bt-gutter" />
        <div className="bt-stripe" data-edge="bottom" data-faint="true" />
        <div className="bt-sticky-cell" style={{ width: LAYOUT.check }} aria-hidden />
        <div role="gridcell" className="bt-sticky-cell px-1.5" style={{ width: layout.nameWidth }}>
          <input
            ref={inputRef}
            value={draft}
            maxLength={2_000}
            data-testid="add-item-input"
            aria-label={`Add ${noun} to ${group.title}`}
            placeholder={`+ Add ${noun}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={submit}
            className={cn(
              'h-7 w-full min-w-0 rounded-xs border border-transparent bg-transparent px-1.5 text-base text-fg outline-none',
              'placeholder:text-fg-muted hover:border-border-input focus:border-primary focus:bg-panel focus:shadow-[0_0_0_2px_var(--focus-ring-soft)]',
            )}
          />
        </div>
      </div>
      <div className="bt-body flex-1 border-b border-border-subtle" />
      {drop ? <span className="bt-drop-line" data-side={drop} aria-hidden /> : null}
    </div>
  );
});

/** Read-only boards: an empty group says so instead of offering an add row. */
export const EmptyGroupRow = memo(function EmptyGroupRow({
  group,
  position,
}: {
  readonly group: GroupDto;
  readonly position: RowPosition;
}) {
  const { terminology, layout } = useTable();
  return (
    <div
      role="row"
      aria-rowindex={position.index + 1}
      data-kind="empty-group"
      className="bt-row"
      style={rowStyle(position, group.color)}
    >
      <div className="bt-sticky" style={{ width: layout.stickyWidth }}>
        <div className="bt-gutter" />
        <div className="bt-stripe" data-edge="bottom" data-faint="true" />
        <div
          role="gridcell"
          className="bt-sticky-cell px-3 text-fg-muted"
          style={{ width: layout.stickyWidth - LAYOUT.gutter - LAYOUT.stripe }}
        >
          No {terminology.toLowerCase()}s in this group yet
        </div>
      </div>
    </div>
  );
});

/** Group footer: per-column summaries (battery, sums, date ranges, people). */
export const FooterRow = memo(function FooterRow({
  items,
  position,
}: {
  readonly group: GroupDto;
  readonly items: readonly ItemDto[];
  readonly position: RowPosition;
}) {
  const { layout, cellBoard, users, view } = useTable();
  return (
    <div
      role="row"
      aria-rowindex={position.index + 1}
      data-kind="footer"
      data-testid="group-footer"
      className="bt-row"
      style={rowStyle(position)}
    >
      <div className="bt-sticky" style={{ width: layout.stickyWidth }}>
        <div className="bt-gutter" />
        <div className="w-[calc(100%-32px)] bg-panel" aria-hidden />
      </div>
      <div className="flex">
        {layout.columns.map((entry, index) => (
          <div
            key={entry.column.id}
            role="gridcell"
            aria-label={`${entry.column.title} summary`}
            className={cn('bt-cell bg-panel', index === 0 && 'border-l border-l-border-subtle')}
            style={{ width: entry.width }}
          >
            {entry.collapsed ? null : (
              <CellSummary
                column={entry.column}
                items={items}
                board={cellBoard}
                users={users}
                className="w-full"
                onFilterLabel={(labelId) => view.toggleLabelFilter(entry.column.key, labelId)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

/** "+ Add subitem" row inside an expanded item. */
export const SubAddRow = memo(function SubAddRow({
  parent,
  groupColor,
  position,
}: {
  readonly parent: ItemDto;
  readonly groupColor: string;
  readonly position: RowPosition;
}) {
  const { actions, subLayout, canEdit } = useTable();
  const [draft, setDraft] = useState('');
  const submit = () => {
    if (!draft.trim()) return;
    actions.createSubitem(parent, draft);
    setDraft('');
  };
  return (
    <div
      role="row"
      aria-rowindex={position.index + 1}
      data-kind="sub-add"
      className="bt-row bt-sub-enter"
      style={rowStyle(position, groupColor)}
    >
      <div className="bt-sticky" style={{ width: subLayout.stickyWidth }}>
        <div className="bt-gutter" />
        <div className="bt-stripe" />
        <div className="bt-sticky-cell border-b-0" style={{ width: LAYOUT.check }} aria-hidden />
        <div className="bt-sticky-cell" style={{ width: LAYOUT.subCheck }} aria-hidden />
        <div
          role="gridcell"
          className="bt-sticky-cell px-1.5"
          style={{ width: subLayout.nameWidth - LAYOUT.subCheck }}
        >
          <input
            value={draft}
            maxLength={2_000}
            data-testid="add-subitem-input"
            aria-label={`Add subitem to ${parent.name}`}
            placeholder="+ Add subitem"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
              if (event.key === 'Escape') setDraft('');
            }}
            onBlur={submit}
            className="h-6 w-full min-w-0 rounded-xs border border-transparent bg-transparent px-1.5 text-sm text-fg outline-none placeholder:text-fg-muted hover:border-border-input focus:border-primary focus:bg-panel"
          />
        </div>
      </div>
      {canEdit && subLayout.columns.length === 0 ? <SubitemColumnsPrompt /> : null}
    </div>
  );
});

/** Subitem columns seeded by the one-click prompt (monday-style Owner / Status / Date). */
const DEFAULT_SUBITEM_COLUMNS = [
  { type: 'people', title: 'Owner' },
  { type: 'status', title: 'Status' },
  { type: 'date', title: 'Date' },
] as const;

/** Shown beside "+ Add subitem" while the board has no subitem columns yet. */
function SubitemColumnsPrompt() {
  const { actions, subLayout } = useTable();
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      for (const entry of DEFAULT_SUBITEM_COLUMNS)
        await actions.createColumn(entry.type, { scope: 'subitem', title: entry.title });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="gridcell"
      className="sticky z-[2] flex items-center gap-2 pl-3"
      style={{ left: subLayout.stickyWidth }}
      data-testid="subitem-columns-prompt"
    >
      <Columns3 aria-hidden className="size-4 shrink-0 text-icon" />
      <span className="text-sm whitespace-nowrap text-fg-secondary">Subitems have no columns yet.</span>
      <Button size="sm" variant="tertiary" loading={busy} onClick={() => void add()}>
        Add Owner, Status and Date
      </Button>
    </div>
  );
}

/** Loading / error placeholder while an item's subitems are fetched. */
export const SubStatusRow = memo(function SubStatusRow({
  status,
  groupColor,
  position,
  onRetry,
}: {
  readonly status: 'loading' | 'error';
  readonly groupColor: string;
  readonly position: RowPosition;
  readonly onRetry: () => void;
}) {
  const { subLayout } = useTable();
  return (
    <div
      role="row"
      aria-rowindex={position.index + 1}
      data-kind="sub-status"
      className="bt-row"
      style={rowStyle(position, groupColor)}
      aria-busy={status === 'loading' || undefined}
    >
      <div className="bt-sticky" style={{ width: subLayout.stickyWidth }}>
        <div className="bt-gutter" />
        <div className="bt-stripe" />
        <div className="bt-sticky-cell border-b-0" style={{ width: LAYOUT.check }} aria-hidden />
        <div role="gridcell" className="bt-sticky-cell gap-2 px-3" style={{ width: subLayout.nameWidth }}>
          {status === 'loading' ? (
            <span data-skeleton="" className="flex flex-1 items-center gap-2">
              <Skeleton width={14} height={14} />
              <Skeleton height={10} width="55%" rounded="full" />
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm text-danger-text">
              <CircleAlert aria-hidden className="size-4" />
              Couldn&apos;t load subitems
              <button
                type="button"
                onClick={onRetry}
                className="font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              >
                Retry
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
