'use client';
/**
 * Sentence tokens for the automation builder: an underlined bold word ("a task is marked done")
 * that opens a picker. Same look as the CRM automation builder: solid underline when set,
 * dashed + muted when it still needs a choice, red when it blocks saving.
 */
import { useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, cn } from '@/components/ui';
import { OptionList, type OptionItem } from '@/features/views/option-list';

export interface TokenChipProps {
  readonly text: string;
  readonly set?: boolean;
  readonly invalid?: boolean;
  /** Spoken name of the token ("Trigger", "Status"). */
  readonly label: string;
  readonly children: (close: () => void) => ReactNode;
  readonly width?: number;
  readonly disabled?: boolean;
  readonly testId?: string;
}

export function TokenChip({
  text,
  set = true,
  invalid,
  label,
  children,
  width = 280,
  disabled,
  testId,
}: TokenChipProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        {/* A span (not <button>) so long tokens wrap inline with the sentence like text. */}
        <span
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-haspopup="dialog"
          aria-label={`${label}: ${set ? text : 'not set'}`}
          aria-disabled={disabled || undefined}
          data-testid={testId ?? 'automation-token'}
          data-set={set || undefined}
          data-invalid={invalid || undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
          className={cn(
            'mx-0.5 inline cursor-pointer rounded-xs px-0.5 font-semibold underline box-decoration-clone decoration-2 underline-offset-[6px]',
            'transition-colors duration-[var(--duration-fast)] ease-out outline-none',
            'hover:bg-primary-subtle focus-visible:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            'data-[state=open]:bg-primary-selected',
            set
              ? 'text-primary-text decoration-primary'
              : 'text-fg-secondary decoration-dashed decoration-fg-muted',
            invalid && 'text-danger-text decoration-danger',
            disabled && 'pointer-events-none cursor-default text-fg no-underline',
          )}
        >
          {text}
        </span>
      </PopoverTrigger>
      <PopoverContent flush align="start" style={{ width }}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

export interface TokenSelectProps {
  readonly label: string;
  readonly value: string | null | undefined;
  readonly options: readonly OptionItem[];
  readonly onChange: (value: string) => void;
  /** Text shown when nothing is picked. */
  readonly placeholder: string;
  readonly invalid?: boolean;
  readonly heading?: ReactNode;
  readonly footer?: ReactNode;
  readonly emptyText?: string;
  readonly testId?: string;
  /** Text shown for the current value when it differs from the option label. */
  readonly display?: string;
}

/** A token whose picker is a searchable single-choice list. */
export function TokenSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  invalid,
  heading,
  footer,
  emptyText,
  testId,
  display,
}: TokenSelectProps) {
  const current = options.find((option) => option.value === value);
  // A saved choice whose list hasn't arrived yet (project details still loading): don't ask to pick again.
  const waiting = Boolean(value) && !current && options.length === 0;
  const set = Boolean(current) || waiting;
  return (
    <TokenChip
      text={display ?? current?.label ?? (waiting ? 'loading…' : placeholder)}
      set={set}
      invalid={invalid && !set}
      label={label}
      testId={testId}
    >
      {(close) => (
        <OptionList
          options={options}
          selected={value ? [value] : []}
          multiple={false}
          searchable={options.length > 7}
          heading={heading}
          footer={footer}
          emptyText={emptyText}
          onToggle={(next) => {
            onChange(next);
            close();
          }}
        />
      )}
    </TokenChip>
  );
}

export interface GroupedOption extends OptionItem {
  readonly group: string;
  /** Muted note on the right ("Not connected"). */
  readonly note?: string;
}

/** A token whose picker lists choices under group headings ("Task changes", "Dates", …). */
export function TokenGroupedSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly GroupedOption[];
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly testId?: string;
}) {
  const current = options.find((option) => option.value === value);
  const groups = [...new Set(options.map((option) => option.group))];
  return (
    <TokenChip
      text={current?.label ?? placeholder}
      set={Boolean(current)}
      label={label}
      testId={testId}
      width={320}
    >
      {(close) => (
        <Command loop className="flex max-h-[380px] flex-col">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3">
            <Search aria-hidden className="size-4 shrink-0 text-icon" />
            <Command.Input
              autoFocus
              placeholder="Search…"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
            />
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-5 text-center text-sm text-fg-muted">
              Nothing matches
            </Command.Empty>
            {groups.map((group) => (
              <Command.Group
                key={group}
                heading={
                  <span className="block px-2 pt-1.5 pb-1 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                    {group}
                  </span>
                }
              >
                {options
                  .filter((option) => option.group === group)
                  .map((option) => (
                    <Command.Item
                      key={option.value}
                      value={`${option.label} ${option.keywords ?? ''} ${option.value}`}
                      onSelect={() => {
                        onChange(option.value);
                        close();
                      }}
                      className="ks-menu-item"
                      data-checked={option.value === value || undefined}
                    >
                      {option.icon}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.note ? (
                        <span className="shrink-0 text-xs text-fg-muted">{option.note}</span>
                      ) : null}
                      {option.value === value ? (
                        <Check aria-hidden className="size-4 shrink-0 text-primary-text" />
                      ) : null}
                    </Command.Item>
                  ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      )}
    </TokenChip>
  );
}
