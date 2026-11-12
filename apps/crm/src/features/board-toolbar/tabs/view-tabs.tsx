'use client';

/**
 * View tab strip (BV-001/002): icon + label tabs with an active underline, drag to reorder,
 * double-click to rename, a per-tab "…" menu (also on right-click), an "N more" overflow menu
 * and the "+" Add view menu.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, Copy, Home, Link2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@/components/ui';
import { viewTypeMeta, type ViewTypeMeta } from '@/features/board-views';
import type { ViewDto } from '@/server/services/contracts/dto';
import { InlineText } from '../header/inline-text';
import { AddViewMenu } from './add-view-menu';

export interface ViewTabsProps {
  readonly views: readonly ViewDto[];
  readonly activeId: string | null;
  readonly canEdit: boolean;
  readonly onSelect: (viewId: string) => void;
  readonly onAdd: (meta: ViewTypeMeta) => void;
  readonly adding: boolean;
  readonly renamingId: string | null;
  readonly onRenamingChange: (viewId: string | null) => void;
  readonly onRename: (view: ViewDto, name: string) => void;
  readonly onDuplicate: (view: ViewDto) => void;
  readonly onDelete: (view: ViewDto) => void;
  readonly onSetDefault: (view: ViewDto) => void;
  readonly onCopyLink: (view: ViewDto) => void;
  readonly onReorder: (from: number, to: number) => void;
}

const RESERVED = 128;

function ViewIcon({ view, className }: { readonly view: ViewDto; readonly className?: string }) {
  const meta = viewTypeMeta(view.type);
  const Icon = view.isDefault && view.type === 'table' ? Home : (meta?.icon ?? Home);
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} />;
}

interface TabProps {
  readonly view: ViewDto;
  readonly active: boolean;
  readonly hidden: boolean;
  readonly props: ViewTabsProps;
  readonly onMeasure: (id: string, width: number) => void;
}

function TabMenuItems({ view, props }: { readonly view: ViewDto; readonly props: ViewTabsProps }) {
  return (
    <>
      <DropdownMenuItem icon={<Pencil aria-hidden />} disabled={!props.canEdit} onSelect={() => props.onRenamingChange(view.id)}>
        Rename view
      </DropdownMenuItem>
      <DropdownMenuItem icon={<Copy aria-hidden />} disabled={!props.canEdit} onSelect={() => props.onDuplicate(view)}>
        Duplicate view
      </DropdownMenuItem>
      <DropdownMenuItem
        icon={<Home aria-hidden />}
        disabled={!props.canEdit || view.isDefault}
        onSelect={() => props.onSetDefault(view)}
        description={view.isDefault ? 'This is the default view' : undefined}
      >
        Set as default
      </DropdownMenuItem>
      <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => props.onCopyLink(view)}>
        Copy link to view
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        icon={<Trash2 aria-hidden />}
        variant="danger"
        disabled={!props.canEdit || props.views.length <= 1}
        onSelect={() => props.onDelete(view)}
        data-testid="view-tab-delete"
      >
        Delete view
      </DropdownMenuItem>
    </>
  );
}

function Tab({ view, active, hidden, props, onMeasure }: TabProps) {
  const sortable = useSortable({ id: view.id, disabled: !props.canEdit || props.renamingId === view.id });
  const ref = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const renaming = props.renamingId === view.id;

  useLayoutEffect(() => {
    if (!hidden && ref.current) onMeasure(view.id, ref.current.offsetWidth);
  });

  return (
    <div
      ref={(node) => {
        ref.current = node;
        sortable.setNodeRef(node);
      }}
      role="presentation"
      data-testid="view-tab"
      data-view-id={view.id}
      data-active={active || undefined}
      className={cn('group/tab relative flex shrink-0 items-center', hidden && 'hidden', sortable.isDragging && 'z-10 opacity-80')}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {renaming ? (
        <span className="flex h-8 items-center gap-1.5 px-2 text-base">
          <ViewIcon view={view} className="text-icon" />
          <InlineText
            value={view.name}
            label="View name"
            required
            maxLength={120}
            editing
            onEditingChange={(editing) => (editing ? undefined : props.onRenamingChange(null))}
            onCommit={(name) => props.onRename(view, name)}
            className="h-7 text-base"
            testId="view-name"
          />
        </span>
      ) : (
        <button
          type="button"
          {...sortable.attributes}
          role="tab"
          aria-selected={active}
          aria-roledescription={undefined}
          tabIndex={active ? 0 : -1}
          {...sortable.listeners}
          onClick={() => props.onSelect(view.id)}
          onDoubleClick={() => props.canEdit && props.onRenamingChange(view.id)}
          onKeyDown={(event) => {
            if (event.key === 'F2' && props.canEdit) props.onRenamingChange(view.id);
            else sortable.listeners?.onKeyDown?.(event);
          }}
          className={cn(
            'relative inline-flex h-8 max-w-56 items-center gap-1.5 rounded-sm pr-7 pl-2.5 text-base whitespace-nowrap outline-none',
            'transition-[background-color,color] duration-[var(--duration-instant)] ease-out',
            'hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
            'after:absolute after:inset-x-2 after:-bottom-1 after:h-0.5 after:rounded-full after:transition-colors after:duration-[var(--duration-fast)]',
            active ? 'font-medium text-fg after:bg-primary' : 'text-fg-secondary after:bg-transparent',
            props.canEdit && 'cursor-pointer active:cursor-grabbing',
          )}
        >
          <ViewIcon view={view} className={active ? 'text-primary-text' : 'text-icon'} />
          <span className="truncate">{view.name}</span>
        </button>
      )}
      {renaming ? null : (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${view.name} view options`}
              data-testid="view-tab-menu"
              className={cn(
                'absolute right-1 inline-flex size-6 items-center justify-center rounded-xs text-icon transition-[opacity,background-color] duration-[var(--duration-fast)]',
                'hover:bg-pressed hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-pressed data-[state=open]:opacity-100',
                active ? 'opacity-60 max-md:opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
              )}
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <TabMenuItems view={view} props={props} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function ViewTabs(props: ViewTabsProps) {
  const { views, activeId, canEdit } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({});
  const [available, setAvailable] = useState<number>(Number.POSITIVE_INFINITY);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry?.contentRect.width ?? Number.POSITIVE_INFINITY));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const onMeasure = useCallback((id: string, width: number) => {
    setWidths((current) => (current[id] === width ? current : { ...current, [id]: width }));
  }, []);

  /** Ids that fit; the active tab always stays visible. */
  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    let used = 0;
    const budget = available - RESERVED;
    for (const view of views) {
      const width = widths[view.id] ?? 120;
      if (used + width > budget && ids.length > 0) break;
      ids.push(view.id);
      used += width + 2;
    }
    if (activeId && !ids.includes(activeId) && ids.length > 0) ids[ids.length - 1] = activeId;
    return new Set(ids);
  }, [activeId, available, views, widths]);
  const overflow = views.filter((view) => !visibleIds.has(view.id));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = views.findIndex((view) => view.id === active.id);
    const to = views.findIndex((view) => view.id === over.id);
    if (from >= 0 && to >= 0) props.onReorder(from, to);
  };

  return (
    <div className="flex h-10 items-center gap-1 border-b border-border-subtle px-8 max-md:px-4" data-testid="view-tabs">
      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-0.5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={views.map((view) => view.id)} strategy={horizontalListSortingStrategy}>
            <div role="tablist" aria-label="Board views" className="flex min-w-0 items-center gap-0.5">
              {views.map((view) => (
                <Tab
                  key={view.id}
                  view={view}
                  active={view.id === activeId}
                  hidden={!visibleIds.has(view.id)}
                  props={props}
                  onMeasure={onMeasure}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {overflow.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="view-tabs-more"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm px-2 text-base text-fg-secondary transition-colors duration-[var(--duration-instant)] hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-selected"
              >
                {overflow.length} more
                <ChevronDown aria-hidden className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {overflow.map((view) => (
                <DropdownMenuItem key={view.id} icon={<ViewIcon view={view} />} onSelect={() => props.onSelect(view.id)}>
                  {view.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canEdit ? <AddViewMenu onAdd={props.onAdd} pending={props.adding} /> : null}
      </div>
    </div>
  );
}
