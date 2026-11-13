'use client';
/**
 * Searchable option list for pickers and filter popovers (cmdk): type to narrow, arrows to
 * move, Enter to pick. `multiple` keeps the list open and toggles checks; single mode calls
 * `onPick` once. Optional "create" row (e.g. a new label from the search text).
 */
import { useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, Plus, Search } from 'lucide-react';
import { cn } from '@/components/ui';

export interface OptionItem {
  readonly value: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly hint?: ReactNode;
  /** Extra words cmdk matches on (emails, keys). */
  readonly keywords?: string;
}

export interface OptionListProps {
  readonly options: readonly OptionItem[];
  readonly selected: readonly string[];
  readonly onToggle: (value: string) => void;
  readonly multiple?: boolean;
  readonly placeholder?: string;
  readonly emptyText?: string;
  /** Hide the search box for short fixed lists. */
  readonly searchable?: boolean;
  readonly heading?: ReactNode;
  readonly footer?: ReactNode;
  readonly onCreate?: (text: string) => void;
  readonly createLabel?: (text: string) => string;
  readonly className?: string;
}

export function OptionList({
  options,
  selected,
  onToggle,
  multiple = true,
  placeholder = 'Search…',
  emptyText = 'Nothing matches',
  searchable = true,
  heading,
  footer,
  onCreate,
  createLabel = (text) => `Create “${text}”`,
  className,
}: OptionListProps) {
  const [search, setSearch] = useState('');
  const chosen = new Set(selected);
  const text = search.trim();
  const exact = options.some((option) => option.label.toLowerCase() === text.toLowerCase());
  return (
    <Command loop className={cn('flex max-h-[360px] flex-col', className)} onClick={(event) => event.stopPropagation()}>
      {heading ? <div className="border-b border-border-subtle px-3 py-2 text-xs font-semibold text-fg-muted">{heading}</div> : null}
      {searchable ? (
        <div className="flex items-center gap-2 border-b border-border-subtle px-3">
          <Search aria-hidden className="size-4 shrink-0 text-icon" />
          <Command.Input
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder={placeholder}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
          />
        </div>
      ) : null}
      <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
        <Command.Empty className="px-3 py-5 text-center text-sm text-fg-muted">{emptyText}</Command.Empty>
        {options.map((option) => {
          const on = chosen.has(option.value);
          return (
            <Command.Item
              key={option.value}
              value={`${option.label} ${option.keywords ?? ''} ${option.value}`}
              onSelect={() => onToggle(option.value)}
              className="ks-menu-item"
              data-checked={on || undefined}
            >
              {multiple ? (
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors',
                    on ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-panel',
                  )}
                >
                  {on ? <Check className="!size-3" strokeWidth={3} /> : null}
                </span>
              ) : null}
              {option.icon}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.hint ? <span className="shrink-0 text-xs text-fg-muted tabular-nums">{option.hint}</span> : null}
              {!multiple && on ? <Check aria-hidden className="size-4 shrink-0 text-primary-text" /> : null}
            </Command.Item>
          );
        })}
        {onCreate && text && !exact ? (
          <Command.Item value={`__create__ ${text}`} onSelect={() => { onCreate(text); setSearch(''); }} className="ks-menu-item">
            <Plus aria-hidden className="size-4 text-icon" />
            <span className="min-w-0 flex-1 truncate">{createLabel(text)}</span>
          </Command.Item>
        ) : null}
      </Command.List>
      {footer ? <div className="border-t border-border-subtle p-1.5">{footer}</div> : null}
    </Command>
  );
}
