'use client';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from './cn';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly description?: string;
  /** Extra search terms. */
  readonly keywords?: readonly string[];
  readonly disabled?: boolean;
}

interface ComboboxBaseProps {
  readonly options: readonly ComboboxOption[];
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly id?: string;
  readonly 'aria-label'?: string;
  readonly className?: string;
  /** Shows a footer action (e.g. "+ Create “query”"). Receives the current search text. */
  readonly renderFooter?: (query: string, close: () => void) => ReactNode;
}

export interface ComboboxSingleProps extends ComboboxBaseProps {
  readonly multiple?: false;
  readonly value: string | null;
  readonly onValueChange: (value: string | null) => void;
}

export interface ComboboxMultiProps extends ComboboxBaseProps {
  readonly multiple: true;
  readonly value: readonly string[];
  readonly onValueChange: (value: string[]) => void;
}

export type ComboboxProps = ComboboxSingleProps | ComboboxMultiProps;

/** Searchable select (single or multi) with keyboard navigation via cmdk. */
export function Combobox(props: ComboboxProps) {
  const {
    options,
    placeholder = 'Select…',
    searchPlaceholder = 'Search…',
    emptyMessage = 'No matches',
    disabled,
    invalid,
    id,
    className,
    renderFooter,
  } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();

  const selectedValues = useMemo<readonly string[]>(
    () => (props.multiple ? props.value : props.value ? [props.value] : []),
    [props.multiple, props.value],
  );
  const selectedLabels = options.filter((option) => selectedValues.includes(option.value)).map((option) => option.label);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const toggle = (value: string) => {
    if (props.multiple) {
      const next = props.value.includes(value) ? props.value.filter((v) => v !== value) : [...props.value, value];
      props.onValueChange(next);
    } else {
      props.onValueChange(props.value === value ? null : value);
      close();
    }
  };

  const triggerText =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(', ')
        : `${selectedLabels.slice(0, 2).join(', ')} +${selectedLabels.length - 2}`;

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={props['aria-label']}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            'inline-flex h-8 w-full items-center justify-between gap-2 rounded-sm border border-border-input bg-panel px-2.5 text-left text-base',
            'transition-[border-color,box-shadow] duration-[var(--duration-fast)] outline-none hover:border-border-input-hover',
            'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--focus-ring-soft)] data-[state=open]:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger',
            selectedLabels.length === 0 ? 'text-fg-placeholder' : 'text-fg',
            className,
          )}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-icon" />
        </button>
      </PopoverTrigger>
      <PopoverContent flush className="w-[max(var(--radix-popover-trigger-width),240px)]">
        <Command
          loop
          className="flex flex-col"
          // Open with the highlight on the current selection (Enter keeps it instead of picking the first row).
          defaultValue={(() => {
            const selected = options.find((option) => option.value === selectedValues[0]);
            return selected ? `${selected.label} ${selected.value}` : undefined;
          })()}
        >
          <div className="flex items-center gap-2 border-b border-border-subtle px-3">
            <Search aria-hidden className="size-4 text-icon" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
              className="h-10 flex-1 bg-transparent text-base outline-none"
            />
          </div>
          <Command.List id={listId} className="max-h-64 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">{emptyMessage}</Command.Empty>
            {options.map((option) => {
              const checked = selectedValues.includes(option.value);
              return (
                <Command.Item
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  keywords={option.keywords ? [...option.keywords] : undefined}
                  disabled={option.disabled}
                  onSelect={() => toggle(option.value)}
                  className="ks-menu-item pr-8 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-fg-disabled"
                >
                  {option.icon}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.description ? <span className="truncate text-xs text-fg-muted">{option.description}</span> : null}
                  </span>
                  {checked ? <Check aria-hidden className="absolute right-2.5 !size-4 !text-primary-text" /> : null}
                </Command.Item>
              );
            })}
          </Command.List>
          {renderFooter ? <div className="border-t border-border-subtle p-1.5">{renderFooter(query, close)}</div> : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
