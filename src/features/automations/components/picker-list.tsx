'use client';
/**
 * Searchable, keyboard-first option list used inside token popovers. Arrow keys move the active
 * row, Enter selects, typing filters. Supports single select and multi select (checkboxes).
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { SearchInput, cn } from '@/components/ui';

export interface PickerOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** Replaces the default label rendering (e.g. a colored label pill). */
  readonly render?: ReactNode;
  readonly description?: string;
  readonly section?: string;
  readonly keywords?: readonly string[];
}

export interface PickerListProps {
  readonly options: readonly PickerOption[];
  readonly selected: readonly string[];
  readonly onSelect: (value: string) => void;
  readonly multiple?: boolean;
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly label: string;
  readonly footer?: ReactNode;
}

const SEARCH_THRESHOLD = 6;

export function PickerList({
  options,
  selected,
  onSelect,
  multiple,
  searchPlaceholder = 'Search',
  emptyMessage = 'No matches',
  label,
  footer,
}: PickerListProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      [option.label, option.description ?? '', ...(option.keywords ?? [])].some((text) =>
        text.toLowerCase().includes(q),
      ),
    );
  }, [options, query]);
  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));

  const move = (delta: number) => {
    if (filtered.length === 0) return;
    const next = (activeIndex + delta + filtered.length) % filtered.length;
    setActive(next);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      const option = filtered[activeIndex];
      if (option) {
        event.preventDefault();
        onSelect(option.value);
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(filtered.length - 1);
    }
  };

  const showSearch = options.length >= SEARCH_THRESHOLD || query.length > 0;
  let lastSection: string | undefined;

  return (
    <div className="flex w-[min(320px,calc(100vw-32px))] flex-col" onKeyDown={onKeyDown}>
      {showSearch ? (
        <div className="border-b border-border-subtle p-2">
          <SearchInput
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setActive(0);
            }}
            placeholder={searchPlaceholder}
            aria-label={`Search ${label}`}
            aria-controls={listId}
            aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            size="sm"
            autoFocus
          />
        </div>
      ) : null}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        tabIndex={showSearch ? -1 : 0}
        autoFocus={!showSearch}
        aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        className="max-h-72 overflow-y-auto p-1 outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-fg-secondary">{emptyMessage}</p>
        ) : (
          filtered.map((option, index) => {
            const isSelected = selected.includes(option.value);
            const header = option.section && option.section !== lastSection ? option.section : null;
            lastSection = option.section;
            return (
              <div key={option.value}>
                {header ? (
                  <div className="px-2.5 pt-2 pb-1 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                    {header}
                  </div>
                ) : null}
                <div
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  data-active={index === activeIndex || undefined}
                  onMouseMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(option.value)}
                  className={cn(
                    'flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1 text-sm text-fg transition-colors duration-[var(--duration-instant)]',
                    'data-[active]:bg-hover active:bg-pressed',
                    isSelected && !multiple && 'bg-primary-selected data-[active]:bg-primary-selected-hover',
                  )}
                >
                  {multiple ? (
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-fg'
                          : 'border-border-input bg-panel',
                      )}
                    >
                      {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                  ) : null}
                  {option.icon ? (
                    <span className="flex shrink-0 text-icon [&_svg]:size-4">{option.icon}</span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    {option.render ?? <span className="block truncate">{option.label}</span>}
                    {option.description ? (
                      <span className="block truncate text-xs text-fg-secondary">{option.description}</span>
                    ) : null}
                  </span>
                  {!multiple && isSelected ? (
                    <Check aria-hidden className="size-4 shrink-0 text-primary-text" />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      {footer ? <div className="border-t border-border-subtle p-2">{footer}</div> : null}
    </div>
  );
}
