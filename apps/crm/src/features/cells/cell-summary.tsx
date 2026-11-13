'use client';
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Star } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Tooltip,
  cn,
  labelColorStyle,
  toast,
} from '@/components/ui';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import {
  formatCurrencyValue,
  formatNumberValue,
  formatTimelineRange,
  timelineProgress,
  type NumberFormatSettings,
} from './lib/format';
import {
  NUMERIC_FNS,
  NUMERIC_FN_LABELS,
  batterySummary,
  checkboxSummary,
  countSummary,
  dateRangeSummary,
  mirrorIsNumeric,
  numericSummary,
  numericValues,
  peopleSummary,
  type NumericFn,
} from './lib/summary';
import { useCellServices, useNow } from './services';
import type { CellBoard } from './types';
import { AvatarStack, StackAvatar } from './parts/avatar-stack';

export interface CellSummaryProps {
  readonly column: ColumnDto;
  readonly items: readonly ItemDto[];
  readonly board?: CellBoard;
  readonly users?: readonly UserSummaryDto[];
  /** Battery segment click → quick filter by that label (`null` = empty cells). */
  readonly onFilterLabel?: (labelId: string | null) => void;
  readonly className?: string;
  /** Collapsed-group rows render a slimmer summary. */
  readonly compact?: boolean;
}

/** Group-footer summary for one column (battery, sum/avg/…, date range, people, counts). */
export function CellSummary({ column, items, board, users = [], onFilterLabel, className, compact }: CellSummaryProps) {
  const kind = COLUMN_TYPE_REGISTRY[column.type].summary;
  let body: React.ReactNode = null;
  if (column.type === 'checkbox') body = <CheckboxSummary column={column} items={items} />;
  else if (kind === 'battery') body = <Battery column={column} items={items} onFilterLabel={onFilterLabel} compact={compact} />;
  else if (column.type === 'mirror' && !mirrorIsNumeric(column, items)) body = <CountSummary column={column} items={items} />;
  else if (kind === 'numeric') body = <NumericSummary column={column} items={items} board={board} />;
  else if (kind === 'date_range') body = <DateRange column={column} items={items} />;
  else if (kind === 'people') body = <PeopleStack column={column} items={items} users={users} />;
  else if (kind === 'count' && !['text', 'long_text', 'link'].includes(column.type)) body = <CountSummary column={column} items={items} />;
  // Totals line up under right-aligned numbers: same right inset (10px) as the number cells.
  const alignEnd = kind === 'numeric' && RIGHT_ALIGNED.has(column.type) && !(column.type === 'mirror' && !mirrorIsNumeric(column, items));
  return (
    <div
      data-testid="cell-summary"
      data-column-key={column.key}
      data-column-type={column.type}
      data-align={alignEnd ? 'end' : 'center'}
      className={cn(
        'group/summary flex h-[var(--row-height)] min-w-0 items-center',
        alignEnd ? 'justify-end pr-1 pl-1.5' : 'justify-center px-1.5',
        compact && 'h-8',
        className,
      )}
    >
      {body}
    </div>
  );
}

function Battery({
  column,
  items,
  onFilterLabel,
  compact,
}: {
  readonly column: ColumnDto;
  readonly items: readonly ItemDto[];
  readonly onFilterLabel?: (labelId: string | null) => void;
  readonly compact?: boolean;
}) {
  const summary = useMemo(() => batterySummary(column, items), [column, items]);
  if (summary.total === 0) return <span className="h-6 w-full rounded-sm bg-[var(--label-gray)] opacity-60" aria-label="No items" />;
  return (
    <div
      role="group"
      aria-label={`${column.title} distribution`}
      className={cn('flex w-full overflow-hidden rounded-sm', compact ? 'h-5' : 'h-6')}
      data-testid="battery"
    >
      {summary.segments.map((segment) => {
        const text = `${segment.name || 'Blank'} ${segment.count}/${summary.total} (${segment.percent}%)`;
        const style = segment.id === '__empty__' ? undefined : labelColorStyle(segment.color);
        return (
          <Tooltip key={segment.id} content={text} side="top" delayDuration={100}>
            <button
              type="button"
              aria-label={onFilterLabel ? `${text}. Filter by ${segment.name || 'blank'}` : text}
              onClick={() => onFilterLabel?.(segment.id === '__empty__' ? null : segment.id)}
              style={{ ...style, width: `${segment.percent}%` }}
              className={cn(
                'h-full min-w-1 transition-[filter,width] duration-[var(--duration-slow)] ease-out first:rounded-l-sm last:rounded-r-sm',
                'focus-visible:relative focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                segment.id === '__empty__' ? 'bg-[var(--label-gray)]' : 'bg-[var(--lc-bg)]',
                onFilterLabel ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
              )}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

function CheckboxSummary({ column, items }: { readonly column: ColumnDto; readonly items: readonly ItemDto[] }) {
  const { checked, total } = checkboxSummary(column.key, items);
  const pct = total ? Math.round((checked / total) * 100) : 0;
  return (
    <Tooltip content={`${checked} of ${total} checked (${pct}%)`} side="top">
      <span className="inline-flex items-center gap-1.5 text-sm text-fg-secondary tabular-nums" aria-label={`${checked} of ${total} checked`}>
        <Check aria-hidden className="size-3.5 text-success-text" strokeWidth={3} />
        {checked}/{total}
      </span>
    </Tooltip>
  );
}

function formatAggregate(column: ColumnDto, value: number, fn: NumericFn, compact: boolean): string {
  if (fn === 'count') return value.toLocaleString();
  if (column.type === 'currency') {
    const settings = column.settings as { currency?: string; decimals?: number };
    return formatCurrencyValue(value, settings.currency ?? 'USD', fn === 'average' ? Math.max(settings.decimals ?? 0, 0) : (settings.decimals ?? 0), { compact });
  }
  if (column.type === 'progress') return `${Math.round(value)}%`;
  if (column.type === 'rating') return value.toFixed(1);
  const settings = column.settings as NumberFormatSettings;
  const decimals = fn === 'average' || fn === 'median' ? Math.max(settings.decimals ?? 0, Number.isInteger(value) ? 0 : 1) : settings.decimals;
  return formatNumberValue(value, { ...settings, decimals }, { compact });
}

function defaultFn(column: ColumnDto): NumericFn {
  if (column.type === 'rating' || column.type === 'progress') return 'average';
  return ((column.settings as { summary?: NumericFn }).summary ?? 'sum') as NumericFn;
}

/** Column types whose cells right-align their numbers (their footers follow). */
const RIGHT_ALIGNED: ReadonlySet<string> = new Set(['number', 'currency', 'formula', 'mirror']);

function NumericSummary({ column, items, board }: { readonly column: ColumnDto; readonly items: readonly ItemDto[]; readonly board?: CellBoard }) {
  const services = useCellServices();
  const [override, setOverride] = useState<NumericFn | null>(null);
  const fn = override ?? defaultFn(column);
  const values = useMemo(() => numericValues(column, items, board?.columns ?? []), [board?.columns, column, items]);
  const result = numericSummary(values, fn);
  const full = result === null ? '' : formatAggregate(column, result, fn, false);
  const text = full.length > 11 && result !== null ? formatAggregate(column, result, fn, true) : full;
  const canChoose = column.type === 'number' || column.type === 'currency' || column.type === 'formula';

  const choose = (next: NumericFn) => {
    setOverride(next);
    if (!services.saveColumnSettings || (column.type !== 'number' && column.type !== 'currency')) return;
    services
      .saveColumnSettings(column, { ...(column.settings as object), summary: next } as never)
      .catch(() => {
        setOverride(null);
        toast.error("Couldn't change the summary");
      });
  };

  const content = (
    <span className="flex min-w-0 flex-col items-center leading-none group-data-[align=end]/summary:items-end">
      <span className="flex items-center gap-1 text-base font-semibold text-fg tabular-nums">
        {column.type === 'rating' && result !== null ? <Star aria-hidden className="size-3.5 fill-[var(--warning-accent)] text-[var(--warning-accent)]" /> : null}
        <span className="truncate">{fn === 'none' ? 'None' : text || 'None'}</span>
      </span>
      <span className="mt-0.5 text-2xs font-medium tracking-wide text-fg-muted lowercase">{NUMERIC_FN_LABELS[fn]}</span>
    </span>
  );

  if (!canChoose) return <Tooltip content={full} side="top" disabled={full === text}>{content}</Tooltip>;
  return (
    <DropdownMenu>
      <Tooltip content={full !== text ? full : `Change summary (${NUMERIC_FN_LABELS[fn]})`} side="top">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${column.title} ${NUMERIC_FN_LABELS[fn]}: ${full || 'none'}. Change summary`}
            className="group/sum relative flex h-[calc(100%-6px)] min-w-0 max-w-full items-center justify-center rounded-sm px-2 transition-colors group-data-[align=end]/summary:justify-end group-data-[align=end]/summary:pr-1.5 group-data-[align=end]/summary:pl-4 duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-hover"
          >
            {content}
            <ChevronDown aria-hidden className="absolute right-0.5 size-3 group-data-[align=end]/summary:right-auto group-data-[align=end]/summary:left-0.5 text-icon opacity-0 group-hover/sum:opacity-100 group-data-[state=open]/sum:opacity-100" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="center" className="min-w-40">
        <DropdownMenuRadioGroup value={fn} onValueChange={(next) => choose(next as NumericFn)}>
          {NUMERIC_FNS.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {NUMERIC_FN_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DateRange({ column, items }: { readonly column: ColumnDto; readonly items: readonly ItemDto[] }) {
  const now = useNow();
  const range = useMemo(() => dateRangeSummary(column, items), [column, items]);
  if (!range) return null;
  const text = formatTimelineRange(range.from, range.to, now);
  if (column.type === 'timeline') {
    const progress = timelineProgress(range.from, range.to, now);
    return (
      <span className="relative flex h-[22px] w-full items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--label-dark-blue)_40%,black)] text-xs font-semibold text-white" aria-label={`Span ${text}`}>
        <span aria-hidden className="ks-bar-fill absolute inset-0 bg-[var(--label-dark-blue)]" style={{ transform: `scaleX(${progress})` }} />
        <span className="relative truncate px-2">{text}</span>
      </span>
    );
  }
  return (
    <Tooltip content={`${range.count} dated of ${items.length}`} side="top">
      <span className="inline-flex h-6 max-w-full items-center rounded-full bg-[var(--label-dark-blue)] px-2.5 text-xs font-semibold text-[var(--label-dark-blue-fg)]">
        <span className="truncate">{text}</span>
      </span>
    </Tooltip>
  );
}

function PeopleStack({ column, items, users }: { readonly column: ColumnDto; readonly items: readonly ItemDto[]; readonly users: readonly UserSummaryDto[] }) {
  const people = useMemo(() => {
    const byId = new Map(users.map((user) => [user.id, user]));
    return peopleSummary(column.key, items)
      .map((entry) => ({ user: byId.get(entry.id), count: entry.count }))
      .filter((entry): entry is { user: UserSummaryDto; count: number } => Boolean(entry.user));
  }, [column.key, items, users]);
  if (people.length === 0) return null;
  const shown = people.slice(0, 4);
  const names = people.map((entry) => `${entry.user.name} (${entry.count})`).join(', ');
  return (
    <Tooltip content={names} side="top">
      <span className="inline-flex items-center" role="img" aria-label={names}>
        <AvatarStack
          size="xs"
          overflow={people.length - shown.length}
          entries={shown.map(({ user }) => ({
            key: user.id,
            node: <StackAvatar name={user.name} src={user.image} colorKey={user.id} size="xs" />,
          }))}
        />
      </span>
    </Tooltip>
  );
}

function CountSummary({ column, items }: { readonly column: ColumnDto; readonly items: readonly ItemDto[] }) {
  const { filled, total } = countSummary(column, items);
  if (total === 0) return null;
  return (
    <span className="text-xs font-medium text-fg-muted tabular-nums" aria-label={`${filled} of ${total} filled`}>
      {filled}/{total}
    </span>
  );
}
