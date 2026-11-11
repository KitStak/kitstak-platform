'use client';
/**
 * Inline editors for My work rows: a full-bleed status pill with a label menu and a date
 * trigger with calendar + quick picks. Self-contained until @/features/cells ships shared ones.
 */
import { useState } from 'react';
import { CalendarDays, Check, X } from 'lucide-react';
import { addDays, nextMonday, startOfToday } from 'date-fns';
import {
  Calendar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  labelColorVars,
  toLabelColor,
} from '@/components/ui';
import type { MyWorkLabelDto } from '@/server/services/contracts/inbox-mywork';
import { formatDueDate, parseIsoDay, toIsoDay, type BucketId } from './my-work-model';

export interface StatusPillCellProps {
  readonly label: MyWorkLabelDto | null;
  readonly labels: readonly MyWorkLabelDto[];
  readonly columnTitle: string;
  readonly disabled?: boolean;
  readonly onChange: (labelId: string | null) => void;
}

/** Full-bleed colored pill; click opens the label menu (arrow keys, type-ahead, Esc). */
export function StatusPillCell({ label, labels, columnTitle, disabled, onChange }: StatusPillCellProps) {
  const vars = label ? labelColorVars(toLabelColor(label.color)) : null;
  const pill = (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${columnTitle}: ${label?.name || 'Empty'}${disabled ? '' : '. Change'}`}
      data-testid="my-work-status"
      className={cn(
        'group/pill relative flex h-8 w-full items-center justify-center overflow-hidden rounded-md px-2',
        'transition-colors duration-[var(--duration-instant)] ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        'disabled:cursor-default enabled:hover:bg-hover data-[state=open]:bg-pressed',
      )}
    >
      {/* Shared status pill: tinted background, label colour as text, solid dot. */}
      <span
        style={vars ? { background: vars.subtle, color: vars.text } : undefined}
        className={cn(
          'inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-full px-2 text-xs font-medium',
          vars ? '' : 'text-fg-muted ring-1 ring-border-default ring-inset',
        )}
      >
        {vars ? <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: vars.bg }} /> : null}
        <span className="truncate">{label?.name || (disabled ? '' : 'Set')}</span>
      </span>
    </button>
  );
  if (disabled) return pill;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{pill}</DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56 p-2">
        <div className="flex flex-col gap-1">
          {labels.map((option) => {
            const optionVars = labelColorVars(toLabelColor(option.color));
            const selected = option.id === label?.id;
            return (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => onChange(option.id)}
                className="h-8 justify-center rounded-sm p-0 font-medium data-[highlighted]:brightness-95 data-[highlighted]:ring-2 data-[highlighted]:ring-focus"
                style={{ background: optionVars.bg, color: optionVars.fg }}
              >
                <span className="flex w-full items-center justify-center gap-1.5 px-2">
                  {selected ? <Check aria-hidden className="size-3.5" /> : null}
                  <span className="truncate">{option.name || 'Unlabeled'}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </div>
        {label ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<X aria-hidden />} onSelect={() => onChange(null)}>
              Clear {columnTitle.toLowerCase()}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const QUICK_PICKS = [
  { label: 'Today', date: () => startOfToday() },
  { label: 'Tomorrow', date: () => addDays(startOfToday(), 1) },
  { label: 'Next Monday', date: () => nextMonday(startOfToday()) },
  { label: 'In 2 weeks', date: () => addDays(startOfToday(), 14) },
] as const;

export interface DateCellProps {
  readonly value: string | null;
  readonly columnTitle: string;
  readonly overdue?: boolean;
  /** Section the row sits in; keeps one date format per section. */
  readonly bucket?: BucketId;
  readonly disabled?: boolean;
  readonly onChange: (date: string | null) => void;
}

export function DateCell({ value, columnTitle, overdue, bucket, disabled, onChange }: DateCellProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseIsoDay(value) : null;
  const shown = value ? formatDueDate(value, new Date(), bucket) : null;
  const choose = (date: Date | null) => {
    onChange(date ? toIsoDay(date) : null);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid="my-work-date"
          aria-label={`${columnTitle}: ${shown ?? 'No date'}${disabled ? '' : '. Change'}`}
          className={cn(
            // Left-aligned with fixed padding: icons line up in one column whatever the label width.
            'group/date inline-flex h-8 w-full items-center justify-start gap-1.5 rounded-sm border border-transparent pr-2 pl-3 text-sm tabular-nums',
            'transition-[background-color,border-color] duration-[var(--duration-instant)] ease-out',
            'enabled:hover:border-border-input enabled:hover:bg-panel focus-visible:outline-2 focus-visible:outline-focus',
            'data-[state=open]:border-primary data-[state=open]:bg-panel disabled:cursor-default',
            value ? (overdue ? 'font-medium text-danger-text' : 'text-fg') : 'text-fg-placeholder',
          )}
        >
          <CalendarDays
            aria-hidden
            className={cn(
              'size-3.5 shrink-0',
              value ? 'opacity-70' : 'opacity-0 group-hover/date:opacity-70',
            )}
          />
          <span className="truncate">{shown ?? (disabled ? '' : 'Add date')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent flush align="center" className="w-[300px]">
        <div
          className="grid grid-cols-2 gap-1.5 border-b border-border-subtle p-3"
          data-testid="my-work-date-quick"
        >
          {QUICK_PICKS.map((pick) => (
            <button
              key={pick.label}
              type="button"
              onClick={() => choose(pick.date())}
              className="h-7 truncate rounded-full border border-border-default px-2.5 text-sm text-fg transition-colors hover:border-primary hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-focus active:bg-primary-selected"
            >
              {pick.label}
            </button>
          ))}
        </div>
        <div className="p-2">
          <Calendar
            selected={selected ?? undefined}
            onSelect={(date) => (date ? choose(date) : setOpen(false))}
            weekStartsOn={1}
          />
        </div>
        {value ? (
          <div className="border-t border-border-subtle p-2">
            <button
              type="button"
              onClick={() => choose(null)}
              className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm text-fg-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X aria-hidden className="size-4" /> Clear date
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
