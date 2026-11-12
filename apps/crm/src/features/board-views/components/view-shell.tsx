'use client';
/**
 * Shared chrome for every board view: the in-view toolbar (search + view-specific controls +
 * the settings popover), section building blocks for settings, error / filtered-empty states.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, RotateCcw, Search, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import {
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Select,
  cn,
  type SelectOption,
} from '@/components/ui';
import { ColumnTypeIcon } from '@/features/cells';
import type { ColumnDto } from '@/server/services/contracts/dto';

export interface ViewToolbarProps {
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly searchLabel: string;
  /** View-specific controls (left of search). */
  readonly children?: ReactNode;
  /** Right-aligned controls before the settings button. */
  readonly end?: ReactNode;
  readonly settings?: ReactNode;
  readonly settingsOpen?: boolean;
  readonly onSettingsOpenChange?: (open: boolean) => void;
  readonly settingsTitle?: string;
}

export function ViewToolbar({
  search,
  onSearch,
  searchLabel,
  children,
  end,
  settings,
  settingsOpen,
  onSettingsOpenChange,
  settingsTitle = 'Customize view',
}: ViewToolbarProps) {
  // Below 640px search collapses behind an icon so view controls keep a single row.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrap = useRef<HTMLDivElement>(null);
  const expanded = searchOpen || search.length > 0;
  useEffect(() => {
    if (searchOpen) searchWrap.current?.querySelector('input')?.focus();
  }, [searchOpen]);
  return (
    <div
      data-testid="view-toolbar"
      className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border-subtle bg-panel px-4 py-2 max-[640px]:px-3"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        <div
          ref={searchWrap}
          className={cn(!expanded && 'max-[640px]:hidden')}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !search) setSearchOpen(false);
          }}
        >
          <SearchInput
            size="sm"
            value={search}
            onValueChange={onSearch}
            aria-label={searchLabel}
            placeholder="Search"
            containerClassName="w-40 transition-[width] duration-[var(--duration-normal)] ease-out focus-within:w-56 max-[640px]:w-36 max-[640px]:focus-within:w-40"
          />
        </div>
        {expanded ? null : (
          <IconButton
            size="sm"
            label={searchLabel}
            icon={<Search aria-hidden />}
            className="hidden max-[640px]:inline-flex"
            onClick={() => setSearchOpen(true)}
            data-testid="view-search-toggle"
          />
        )}
        {end}
        {settings ? (
          <Popover open={settingsOpen} onOpenChange={onSettingsOpenChange}>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" leadingIcon={<SlidersHorizontal aria-hidden />} data-testid="view-settings-trigger">
                <span className="max-[480px]:sr-only">Customize</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              flush
              className="w-[min(340px,calc(100vw-24px))]"
              aria-label={settingsTitle}
              data-testid="view-settings"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <div className="sticky top-0 z-[var(--z-raised)] border-b border-border-subtle bg-raised px-4 py-3">
                <h2 className="text-md font-semibold text-fg">{settingsTitle}</h2>
                <p className="text-xs text-fg-muted">Changes apply instantly and are saved to this view.</p>
              </div>
              <div className="flex flex-col divide-y divide-border-subtle">{settings}</div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsSection({ title, children, hint }: { readonly title: string; readonly children: ReactNode; readonly hint?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 px-4 py-3">
      <h3 className="text-xs font-semibold text-fg-muted ">{title}</h3>
      {children}
      {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
    </section>
  );
}

export function SettingsSelect({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly testId?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-fg">
      <span className="shrink-0">{label}</span>
      <span className="w-44" data-testid={testId}>
        <Select size="sm" value={value} onValueChange={onChange} options={options} aria-label={label} />
      </span>
    </label>
  );
}

export function columnOptions(columns: readonly ColumnDto[], filter: (column: ColumnDto) => boolean): SelectOption[] {
  return columns.filter(filter).map((column) => ({
    value: column.key,
    label: column.title,
    icon: <ColumnTypeIcon type={column.type} className="size-4 text-icon" />,
  }));
}

function SortableField({ column, checked, onToggle }: { readonly column: ColumnDto; readonly checked: boolean; readonly onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key, disabled: !checked });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex h-8 items-center gap-2 rounded-sm px-1.5 hover:bg-hover',
        isDragging && 'relative z-[var(--z-raised)] bg-raised shadow-md',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${column.title}`}
        disabled={!checked}
        className="inline-flex size-5 cursor-grab items-center justify-center rounded-xs text-icon opacity-60 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing disabled:invisible"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden className="size-3.5" />
      </button>
      <Checkbox size="sm" checked={checked} onCheckedChange={onToggle} aria-label={`Show ${column.title}`} />
      <ColumnTypeIcon type={column.type} className="size-4 shrink-0 text-icon" />
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{column.title}</span>
    </li>
  );
}

/** Checklist of columns with search, select-all and drag-to-reorder of the selected fields. */
export function FieldPicker({
  columns,
  selected,
  onChange,
  max = 20,
}: {
  readonly columns: readonly ColumnDto[];
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly max?: number;
}) {
  const [query, setQuery] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const selectedSet = new Set(selected);
  const ordered = [
    ...selected.map((key) => columns.find((column) => column.key === key)).filter((column): column is ColumnDto => Boolean(column)),
    ...columns.filter((column) => !selectedSet.has(column.key)),
  ];
  const needle = query.trim().toLowerCase();
  const visible = needle ? ordered.filter((column) => column.title.toLowerCase().includes(needle)) : ordered;
  const allSelected = columns.length > 0 && columns.every((column) => selectedSet.has(column.key));
  const onDragEnd = (event: DragEndEvent) => {
    const from = selected.indexOf(String(event.active.id));
    const to = selected.indexOf(String(event.over?.id ?? ''));
    if (from < 0 || to < 0 || from === to) return;
    onChange(arrayMove([...selected], from, to));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <SearchInput size="sm" value={query} onValueChange={setQuery} aria-label="Search fields" placeholder="Search fields" containerClassName="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onChange(allSelected ? [] : columns.slice(0, max).map((column) => column.key))}
        >
          {allSelected ? 'Clear' : 'All'}
        </Button>
      </div>
      <p className="text-xs text-fg-muted tabular-nums" aria-live="polite">
        {selected.length} of {columns.length} shown · drag to reorder
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={selected.filter((key) => visible.some((column) => column.key === key))} strategy={verticalListSortingStrategy}>
          <ul className="flex max-h-56 flex-col overflow-y-auto" aria-label="Fields">
            {visible.map((column) => (
              <SortableField
                key={column.key}
                column={column}
                checked={selectedSet.has(column.key)}
                onToggle={() =>
                  onChange(
                    selectedSet.has(column.key)
                      ? selected.filter((key) => key !== column.key)
                      : [...selected, column.key].slice(0, max),
                  )
                }
              />
            ))}
            {visible.length === 0 ? <li className="px-2 py-3 text-sm text-fg-muted">No fields match “{query}”.</li> : null}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

export function ResetSettings({ onReset }: { readonly onReset: () => void }) {
  return (
    <div className="flex justify-end px-4 py-2.5">
      <Button variant="ghost" size="xs" leadingIcon={<RotateCcw aria-hidden />} onClick={onReset}>
        Reset to defaults
      </Button>
    </div>
  );
}

export function ViewError({ onRetry, what = 'this view' }: { readonly onRetry: () => void; readonly what?: string }) {
  return (
    <div role="alert" className="flex flex-1 items-center justify-center p-8">
      <EmptyState
        illustration="error"
        size="sm"
        title={`Couldn't load ${what}`}
        description="Check your connection and try again. Your data is safe."
        actions={
          <Button variant="secondary" size="sm" onClick={onRetry} leadingIcon={<TriangleAlert aria-hidden />}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

export function FilteredEmpty({ onClear, noun }: { readonly onClear: () => void; readonly noun: string }) {
  return (
    <EmptyState
      illustration="search"
      size="sm"
      title="No results match your filter"
      description={`No ${noun} match the search or filters on this view.`}
      actions={
        <Button variant="secondary" size="sm" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}

/** Wrapper that crossfades view content in and marks loading regions. */
export function ViewCanvas({
  children,
  busy,
  className,
  testId,
}: {
  readonly children: ReactNode;
  readonly busy?: boolean;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      aria-busy={busy || undefined}
      className={cn('relative flex min-h-0 flex-1 flex-col animate-fade-in motion-reduce:animate-none', className)}
    >
      {children}
    </div>
  );
}
