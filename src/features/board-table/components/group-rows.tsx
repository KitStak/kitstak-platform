'use client';
import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { ColorPicker, Popover, PopoverContent, PopoverTrigger, cn, toLabelColor } from '@/components/ui';
import { CellSummary } from '@/features/cells';
import type { GroupDto, ItemDto } from '@/server/services/contracts/dto';
import { LAYOUT } from '../lib/rows';
import { countLabel } from '../lib/terminology';
import { useTableStore } from '../state/table-store';
import { groupColorVar, groupTextVar, useTable } from '../table-context';
import { DragGrip } from './drag-grip';
import { GroupMenu } from './group-menu';

interface GroupRowBase {
  readonly overlay?: boolean;
  readonly group: GroupDto;
  readonly items: readonly ItemDto[];
  readonly index: number;
  readonly start: number;
  readonly height: number;
  readonly width: number;
}

function GroupGutter({
  group,
  items,
  draggable,
}: {
  readonly group: GroupDto;
  readonly items: readonly ItemDto[];
  readonly draggable: boolean;
}) {
  return (
    <div className="bt-gutter self-stretch">
      <DragGrip
        id={`group:${group.id}`}
        data={{ type: 'group', groupId: group.id }}
        label={`Drag group ${group.title}`}
        disabled={!draggable}
      />
      <GroupMenu group={group} itemIds={items.map((item) => item.id)} />
    </div>
  );
}

/** Chevron + colored title (inline rename with color swatch) + terminology count. */
function GroupTitle({
  group,
  count,
  collapsed,
  overlay = false,
}: {
  readonly group: GroupDto;
  readonly count: number;
  readonly collapsed: boolean;
  readonly overlay?: boolean;
}) {
  const { actions, canEdit, terminology, groups, revealGroup } = useTable();
  const renaming = useTableStore((state) => state.renameGroupId === group.id) && !overlay;
  const setRenameGroup = useTableStore((state) => state.setRenameGroup);
  const toggleGroup = useTableStore((state) => state.toggleGroup);
  const setCollapsedGroups = useTableStore((state) => state.setCollapsedGroups);

  const onChevron = (event: MouseEvent) => {
    if (event.shiftKey) setCollapsedGroups(collapsed ? [] : groups.map((entry) => entry.id));
    else toggleGroup(group.id);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5 pr-3" style={{ color: groupTextVar(group.color) }}>
      <button
        type="button"
        data-testid="group-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand ${group.title}` : `Collapse ${group.title}`}
        title="Shift-click to toggle all groups"
        onClick={onChevron}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
      >
        <ChevronDown
          aria-hidden
          className="bt-chevron size-[18px]"
          style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}
        />
      </button>
      {renaming && canEdit ? (
        <GroupRenameInput
          group={group}
          onDone={() => setRenameGroup(null)}
          onSave={(title) => actions.updateGroup(group, { title })}
        />
      ) : (
        <button
          type="button"
          data-testid="group-title"
          disabled={!canEdit}
          onClick={() => {
            if (overlay) revealGroup(group.id);
            setRenameGroup(group.id);
          }}
          className={cn(
            'min-w-0 truncate rounded-sm border border-transparent px-1 py-0.5 text-left text-lg font-medium leading-6',
            'enabled:hover:border-border-input focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default',
          )}
        >
          {group.title}
        </button>
      )}
      <span
        className={cn('shrink-0 text-base text-fg-muted', !collapsed && 'bt-reveal')}
        data-testid="group-count"
      >
        {countLabel(count, terminology)}
      </span>
    </div>
  );
}

function GroupRenameInput({
  group,
  onDone,
  onSave,
}: {
  readonly group: GroupDto;
  readonly onDone: () => void;
  readonly onSave: (title: string) => void;
}) {
  const { actions } = useTable();
  const [draft, setDraft] = useState(group.title);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const title = draft.trim();
    if (save && title && title !== group.title) onSave(title);
    onDone();
  };
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-sm border border-primary bg-panel py-0.5 pr-1 pl-1 shadow-[0_0_0_2px_var(--focus-ring-soft)]">
      <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Change group color"
            data-testid="group-color-swatch"
            onMouseDown={(event) => event.preventDefault()}
            className="size-5 shrink-0 rounded-xs transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-focus"
            style={{ background: groupColorVar(group.color) }}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            ref.current?.focus();
          }}
        >
          <ColorPicker
            value={toLabelColor(group.color, 'blue')}
            columns={6}
            label="Group color"
            onChange={(color) => {
              actions.updateGroup(group, { color });
              setPaletteOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <input
        ref={ref}
        value={draft}
        maxLength={255}
        aria-label="Group name"
        data-testid="group-title-input"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') finish(true);
          if (event.key === 'Escape') finish(false);
        }}
        onBlur={() => {
          if (!paletteOpen) finish(true);
        }}
        className="h-6 min-w-[12ch] bg-transparent text-lg font-medium text-current outline-none"
        style={{ width: `${Math.max(12, draft.length + 2)}ch` }}
      />
    </div>
  );
}

/** Expanded group: title row above its column header. */
export const GroupHeaderRow = memo(function GroupHeaderRow({
  group,
  items,
  index,
  start,
  height,
  width,
  overlay,
}: GroupRowBase) {
  const { canEdit } = useTable();
  const drop = useTableStore((state) =>
    state.drop?.rowKey === `group:${group.id}` ? state.drop.side : null,
  );
  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      data-kind="group-header"
      data-drop={overlay ? undefined : 'group'}
      data-row-key={overlay ? undefined : `group:${group.id}`}
      data-testid={overlay ? 'board-group-sticky' : 'board-group'}
      data-group-id={group.id}
      className="bt-row items-end"
      style={{
        top: overlay ? undefined : start,
        position: overlay ? 'relative' : undefined,
        height,
        width,
      }}
    >
      <div className="bt-sticky h-full items-end bg-panel pb-1.5" role="rowheader" aria-label={group.title}>
        <GroupGutter group={group} items={items} draggable={canEdit && !overlay} />
        <GroupTitle group={group} count={items.length} collapsed={false} overlay={overlay} />
      </div>
      {drop ? <span className="bt-drop-line" data-side={drop} aria-hidden /> : null}
    </div>
  );
});

/** Collapsed group: one row with the stripe, title, count and every column's summary. */
export const CollapsedGroupRow = memo(function CollapsedGroupRow({
  group,
  items,
  index,
  start,
  height,
  width,
}: GroupRowBase) {
  const { canEdit, layout, cellBoard, users, view } = useTable();
  const isDragging = useTableStore((state) => state.dragKind === 'group' && state.dragIds.has(group.id));
  const drop = useTableStore((state) =>
    state.drop?.rowKey === `collapsed:${group.id}` ? state.drop.side : null,
  );
  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      data-kind="collapsed"
      data-drop="group"
      data-row-key={`collapsed:${group.id}`}
      data-testid="board-group"
      data-group-id={group.id}
      data-collapsed="true"
      className={cn('bt-row', isDragging && 'opacity-50')}
      style={
        {
          top: start,
          height,
          width,
          '--bt-group': groupColorVar(group.color),
        } as CSSProperties
      }
    >
      <div className="bt-sticky" style={{ width: layout.stickyWidth }}>
        <GroupGutter group={group} items={items} draggable={canEdit} />
        <div className="bt-stripe rounded-l-md" />
        <div
          role="rowheader"
          aria-label={group.title}
          className="bt-sticky-cell border-t border-t-border-subtle pl-1.5"
          style={{ width: layout.stickyWidth - LAYOUT.gutter - LAYOUT.stripe }}
        >
          <GroupTitle group={group} count={items.length} collapsed />
        </div>
      </div>
      <div className="bt-body">
        {layout.columns.map((entry) => (
          <div
            key={entry.column.id}
            role="gridcell"
            className="bt-cell flex-col border-t border-t-border-subtle"
            style={{ width: entry.width }}
          >
            {entry.collapsed ? null : (
              <>
                <span className="truncate px-2 pt-1.5 text-center text-xs text-fg-muted">
                  {entry.column.title}
                </span>
                <CellSummary
                  column={entry.column}
                  items={items}
                  board={cellBoard}
                  users={users}
                  compact
                  onFilterLabel={(labelId) => view.toggleLabelFilter(entry.column.key, labelId)}
                />
              </>
            )}
          </div>
        ))}
      </div>
      {drop ? <span className="bt-drop-line" data-side={drop} aria-hidden /> : null}
    </div>
  );
});
