'use client';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Pencil, Plus, Search, X } from 'lucide-react';
import { SearchInput, cn, labelColorStyle } from '@/components/ui';
import type { Label } from '@/server/db/schema/column-types';
import { defaultLabel, filterLabels, pickableLabels } from './lib/labels';
import { EmptyListMessage } from './parts/common';

export interface LabelPickerProps {
  /** Labels in board order. */
  readonly labels: readonly Label[];
  readonly mode: 'single' | 'multi';
  /** Selected label ids. */
  readonly value: readonly string[];
  /** single: pick a label (null = clear). multi: toggle the label. */
  readonly onSelect: (labelId: string | null) => void;
  /** Multi only: create a label from the search text. */
  readonly onCreate?: (name: string) => void;
  /** Shows "Edit labels" when provided. */
  readonly onEditLabels?: () => void;
  readonly className?: string;
  readonly 'aria-label'?: string;
}

const SEARCH_THRESHOLD = 10;

interface Option {
  readonly key: string;
  readonly label: Label | null; // null = clear / create row
  readonly kind: 'label' | 'clear' | 'create';
}

/**
 * Status / dropdown label list. Status renders full-width colored pills; dropdown renders a
 * checklist of colored chips. ↑/↓ + Enter, type-to-filter (a search box above 10 labels or for
 * dropdowns; smaller status lists filter as you type with a visible query chip — Backspace
 * edits it), current label ringed, "Edit labels" at the bottom.
 */
export function LabelPicker({
  labels,
  mode,
  value,
  onSelect,
  onCreate,
  onEditLabels,
  className,
  'aria-label': ariaLabel = 'Labels',
}: LabelPickerProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  // Start on the current label (single mode) so ↑/↓ move relative to it.
  const [active, setActive] = useState(() =>
    mode === 'single' ? Math.max(0, pickableLabels(labels).findIndex((label) => value.includes(label.id))) : 0,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const showSearch = mode === 'multi' || labels.length > SEARCH_THRESHOLD;
  const selected = useMemo(() => new Set(value), [value]);
  const blank = defaultLabel(labels);

  const options = useMemo<Option[]>(() => {
    const visible = filterLabels(pickableLabels(labels), query);
    const list: Option[] = visible.map((label) => ({ key: label.id, label, kind: 'label' }));
    const trimmed = query.trim();
    const exact = labels.some((label) => label.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (mode === 'multi' && onCreate && trimmed && !exact) list.push({ key: '__create__', label: null, kind: 'create' });
    if (mode === 'single' && !trimmed) list.push({ key: '__clear__', label: blank ?? null, kind: 'clear' });
    return list;
  }, [blank, labels, mode, onCreate, query]);

  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  const choose = (option: Option | undefined) => {
    if (!option) return;
    if (option.kind === 'create') {
      onCreate?.(query.trim());
      setQuery('');
    } else if (option.kind === 'clear') onSelect(null);
    else if (option.label) onSelect(option.label.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + delta + options.length) % Math.max(1, options.length));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(options[activeIndex]);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !(event.target instanceof HTMLInputElement)) {
      // Keep select-all inside the picker instead of selecting the page behind it.
      event.preventDefault();
    } else if (!showSearch && event.key === 'Backspace' && query) {
      event.preventDefault();
      setQuery(query.slice(0, -1));
      setActive(0);
    } else if (!showSearch && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === ' ' && !query) return;
      event.preventDefault();
      setQuery(query + event.key);
      setActive(0);
    }
  };

  const optionId = (index: number) => `${listId}-opt-${index}`;

  return (
    <div className={cn('flex flex-col gap-2', className)} onKeyDown={onKeyDown}>
      {showSearch ? (
        <SearchInput
          autoFocus
          size="sm"
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            setActive(0);
          }}
          placeholder={mode === 'multi' ? 'Search or create a label' : 'Search labels'}
          aria-controls={listId}
          aria-activedescendant={options.length ? optionId(activeIndex) : undefined}
        />
      ) : query ? (
        <div className="flex h-7 items-center gap-1.5 rounded-sm bg-muted pr-0.5 pl-2 text-sm text-fg-secondary" data-testid="label-filter-chip">
          <Search aria-hidden className="size-3.5 shrink-0 text-icon" />
          <span className="min-w-0 flex-1 truncate">
            Filter: <span className="font-semibold text-fg">{query}</span>
          </span>
          <button
            type="button"
            aria-label="Clear filter"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('');
              listRef.current?.focus();
            }}
            className="inline-flex size-6 items-center justify-center rounded-xs text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable={mode === 'multi' || undefined}
        aria-activedescendant={options.length ? optionId(activeIndex) : undefined}
        tabIndex={showSearch ? -1 : 0}
        autoFocus={!showSearch}
        className={cn('flex max-h-72 flex-col overflow-y-auto outline-none', mode === 'single' ? 'gap-1.5 p-0.5' : 'gap-0.5')}
      >
        {options.length === 0 ? (
          <EmptyListMessage>{query ? `No labels match “${query}”` : 'No labels yet'}</EmptyListMessage>
        ) : (
          options.map((option, index) => (
            <LabelOption
              key={option.key}
              id={optionId(index)}
              option={option}
              mode={mode}
              query={query}
              active={index === activeIndex}
              selected={option.label ? selected.has(option.label.id) : option.kind === 'clear' && value.length === 0}
              onHover={() => setActive(index)}
              onChoose={() => choose(option)}
            />
          ))
        )}
      </div>
      {onEditLabels ? (
        <>
          <div className="-mx-3 h-px bg-border-subtle" />
          <button
            type="button"
            onClick={onEditLabels}
            data-testid="edit-labels"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-sm text-sm font-medium text-fg-secondary transition-colors duration-[var(--duration-instant)] hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
          >
            <Pencil aria-hidden className="size-3.5" />
            Edit labels
          </button>
        </>
      ) : null}
    </div>
  );
}

interface LabelOptionProps {
  readonly id: string;
  readonly option: Option;
  readonly mode: 'single' | 'multi';
  readonly query: string;
  readonly active: boolean;
  readonly selected: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}

function LabelOption({ id, option, mode, query, active, selected, onHover, onChoose }: LabelOptionProps) {
  const common = {
    id,
    role: 'option' as const,
    'aria-selected': selected,
    onPointerMove: onHover,
    onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
    onClick: onChoose,
  };
  if (option.kind === 'create') {
    return (
      <div {...common} data-active={active} className="ks-menu-item not-data-[active=true]:bg-transparent data-[active=true]:bg-hover">
        <Plus aria-hidden />
        <span className="truncate">
          Create <span className="font-semibold">“{query.trim()}”</span>
        </span>
      </div>
    );
  }
  if (mode === 'multi' && option.label) {
    return (
      <div {...common} data-active={active} className="ks-menu-item not-data-[active=true]:bg-transparent data-[active=true]:bg-hover">
        <span
          aria-hidden
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-xs border-[1.5px] transition-colors duration-[var(--duration-instant)]',
            selected ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-panel',
          )}
        >
          {selected ? <Check strokeWidth={3} className="size-3" /> : null}
        </span>
        <span
          style={labelColorStyle(option.label.color)}
          className="inline-flex h-6 min-w-0 items-center rounded-sm bg-[var(--lc-subtle)] px-2 text-sm text-fg"
        >
          <span aria-hidden className="mr-1.5 size-2 shrink-0 rounded-full bg-[var(--lc-bg)]" />
          <span className="truncate">{option.label.name || 'Untitled'}</span>
        </span>
      </div>
    );
  }
  const label = option.label;
  const isClear = option.kind === 'clear';
  return (
    <div
      {...common}
      aria-label={isClear ? 'No label (clear)' : undefined}
      data-active={active}
      data-testid="label-option"
      style={label ? labelColorStyle(label.color) : undefined}
      className={cn(
        'relative flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-sm px-3 text-base font-medium select-none',
        'transition-[background-color,box-shadow,transform] duration-[var(--duration-instant)] ease-out active:scale-[0.98]',
        isClear
          ? 'border border-dashed border-border-strong bg-transparent text-fg-muted data-[active=true]:bg-hover'
          : 'bg-[var(--lc-bg)] text-[var(--lc-fg)] data-[active=true]:bg-[var(--lc-hover)]',
        active && 'shadow-[0_0_0_2px_var(--surface-raised),0_0_0_4px_var(--focus-ring)]',
        selected && !active && 'shadow-[0_0_0_2px_var(--surface-raised),0_0_0_4px_var(--border-strong)]',
      )}
    >
      <span className="truncate">{isClear ? (label?.name ? label.name : 'No label') : label?.name || ' '}</span>
      {selected && !isClear ? <Check aria-hidden strokeWidth={3} className="absolute right-2.5 size-3.5" /> : null}
    </div>
  );
}
