'use client';
import { useMemo, useRef, useState } from 'react';
import { LayoutGrid, Plus, SearchX } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Tooltip,
  cn,
} from '@/components/ui';
import { ColumnTypeIcon } from '@/features/cells';
import type { ColumnType } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY, type ColumnCategory } from '@/server/db/schema/column-types';

/** Most-used types, in picker order. */
export const QUICK_COLUMN_TYPES: readonly ColumnType[] = [
  'status',
  'text',
  'people',
  'dropdown',
  'date',
  'number',
  'files',
  'formula',
  'connect_boards',
  'timeline',
  'long_text',
  'currency',
];

const ESSENTIALS: ReadonlySet<ColumnType> = new Set([
  'status',
  'text',
  'people',
  'date',
  'number',
  'dropdown',
]);

const CATEGORIES: readonly { readonly id: 'all' | 'popular' | ColumnCategory; readonly label: string }[] = [
  { id: 'all', label: 'All columns' },
  { id: 'popular', label: 'Essentials' },
  { id: 'essentials', label: 'Text & labels' },
  { id: 'people', label: 'People' },
  { id: 'time', label: 'Time management' },
  { id: 'numbers', label: 'Numbers & math' },
  { id: 'contact', label: 'Contact & location' },
  { id: 'relations', label: 'Board power-ups' },
  { id: 'meta', label: 'Tracking & automation' },
];

/** Types offered for creation (unique types like Name / Item ID only once per board). */
export function addableTypes(existing: readonly ColumnType[]): ColumnType[] {
  const present = new Set(existing);
  return (Object.keys(COLUMN_TYPE_REGISTRY) as ColumnType[]).filter((type) => {
    if (type === 'name') return false;
    return !(COLUMN_TYPE_REGISTRY[type].unique && present.has(type));
  });
}

export interface AddColumnButtonProps {
  readonly existingTypes: readonly ColumnType[];
  readonly onAdd: (type: ColumnType) => void;
  /** Opens the Column Center; gets the "+" button so focus can return to it on close. */
  readonly onMore: (trigger: HTMLElement | null) => void;
  readonly disabled?: boolean;
  readonly label?: string;
}

/** The "+" header cell: quick picker of common types plus "More columns". */
export function AddColumnButton({
  existingTypes,
  onAdd,
  onMore,
  disabled,
  label = 'Add column',
}: AddColumnButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const allowed = new Set(addableTypes(existingTypes));
  const quick = QUICK_COLUMN_TYPES.filter((type) => allowed.has(type));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            disabled={disabled}
            aria-label={label}
            data-testid="add-column"
            className="inline-flex size-7 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed disabled:opacity-[0.38] data-[state=open]:bg-selected data-[state=open]:text-primary-text"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[340px] p-2" data-testid="column-quick-picker">
        <p className="px-1.5 pt-0.5 pb-1.5 text-xs font-semibold text-fg-muted">Essentials</p>
        <div className="grid grid-cols-2 gap-0.5">
          {quick.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setOpen(false);
                onAdd(type);
              }}
              className="flex h-9 items-center gap-2 rounded-sm px-1.5 text-left text-base text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
            >
              <ColumnTypeIcon type={type} variant="tile" size="md" />
              <span className="truncate">{COLUMN_TYPE_REGISTRY[type].label}</span>
            </button>
          ))}
        </div>
        <div className="mt-1.5 border-t border-border-subtle pt-1.5">
          <button
            type="button"
            data-testid="more-columns"
            onClick={() => {
              setOpen(false);
              onMore(triggerRef.current);
            }}
            className="flex h-9 w-full items-center gap-2 rounded-sm px-1.5 text-base font-medium text-primary-text hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-focus"
          >
            <LayoutGrid aria-hidden className="size-4" />
            More columns
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface ColumnCenterProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly existingTypes: readonly ColumnType[];
  readonly onAdd: (type: ColumnType) => void;
  /** Element that gets focus back when the dialog closes (the trigger unmounts first). */
  readonly returnFocus?: () => HTMLElement | null;
}

/** Column Center: category rail, search, and a gallery of every addable type. */
export function ColumnCenter({ open, onOpenChange, existingTypes, onAdd, returnFocus }: ColumnCenterProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['id']>('all');
  const types = useMemo(() => addableTypes(existingTypes), [existingTypes]);
  const needle = query.trim().toLowerCase();
  const visible = types.filter((type) => {
    const definition = COLUMN_TYPE_REGISTRY[type];
    if (needle) return `${definition.label} ${definition.description}`.toLowerCase().includes(needle);
    if (category === 'all') return true;
    if (category === 'popular') return ESSENTIALS.has(type);
    return definition.category === category;
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
    >
      <DialogContent
        size="xl"
        className="h-[min(640px,calc(100dvh-48px))]"
        data-testid="column-center"
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.();
          if (!target) return;
          event.preventDefault();
          target.focus({ preventScroll: true });
        }}
      >
        <DialogHeader title="Column Center" description="Pick a column type to add it to the board." />
        <div className="flex min-h-0 flex-1 gap-0 border-t border-border-subtle max-md:flex-col">
          <nav
            aria-label="Column categories"
            className="flex shrink-0 flex-col gap-0.5 border-r border-border-subtle p-3 md:w-56 max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b"
          >
            {CATEGORIES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={category === entry.id && !needle ? 'true' : undefined}
                onClick={() => {
                  setCategory(entry.id);
                  setQuery('');
                }}
                className={cn(
                  'h-8 shrink-0 rounded-sm px-2.5 text-left text-base whitespace-nowrap text-fg-secondary hover:bg-hover hover:text-fg',
                  'focus-visible:outline-2 focus-visible:outline-focus',
                  category === entry.id &&
                    !needle &&
                    'bg-selected font-medium text-primary-text hover:bg-selected-hover',
                )}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="p-4 pb-3">
              <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search column types"
                autoFocus
                aria-label="Search column types"
              />
            </div>
            {visible.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-fg-secondary">
                <SearchX aria-hidden className="size-8 text-icon" />
                <p>No column types match “{query}”.</p>
                <Button variant="tertiary" size="sm" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              </div>
            ) : (
              <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 overflow-y-auto px-4 pb-4">
                {visible.map((type) => {
                  const definition = COLUMN_TYPE_REGISTRY[type];
                  return (
                    <li key={type}>
                      <button
                        type="button"
                        data-testid={`column-type-${type}`}
                        onClick={() => {
                          onAdd(type);
                          onOpenChange(false);
                          setQuery('');
                        }}
                        className={cn(
                          'group/card flex w-full items-start gap-3 rounded-lg border border-border-subtle bg-panel p-3 text-left',
                          'transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-out',
                          'hover:-translate-y-px hover:border-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-focus active:translate-y-0',
                        )}
                      >
                        <ColumnTypeIcon type={type} variant="tile" size="lg" />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 font-medium text-fg">
                            {definition.label}
                            {ESSENTIALS.has(type) ? (
                              <span className="rounded-full bg-primary-subtle px-1.5 text-2xs font-semibold text-primary-text">
                                Popular
                              </span>
                            ) : null}
                          </span>
                          <span className="line-clamp-2 text-sm text-fg-secondary">
                            {definition.description}
                          </span>
                          <span className="mt-1 text-sm font-medium text-primary-text opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
                            Add to board
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
