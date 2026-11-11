'use client';

/** Table widget: cross-board item list with board/group indicator and formatted cells. */
import { useMemo } from 'react';
import Link from 'next/link';
import { Avatar, AvatarGroup, StatusPill, toLabelColor } from '@/components/ui';
import { cellDisplay, type CellDisplay } from '@/features/board-overview/cell-display';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { cssColor } from '../lib/colors';
import { NoDataState } from './shared';
import type { WidgetRenderProps } from './types';
import { useElementSize } from './use-element-size';

/** Cards narrower than this render rows as a stacked list. */
const CARD_LIST_BELOW = 480;

interface NumberStyle {
  readonly unit?: string;
  readonly prefix: boolean;
  readonly percent: boolean;
  readonly decimals: number;
}

/** A number column's unit / percent settings (the board's own formatting). */
export function numberStyleOf(column: ColumnDto | undefined): NumberStyle | null {
  if (!column || (column.type !== 'number' && column.type !== 'formula')) return null;
  const settings = (column.settings ?? {}) as { unit?: unknown; unitPosition?: unknown; format?: unknown; decimals?: unknown };
  const unit = typeof settings.unit === 'string' && settings.unit.trim() ? settings.unit.trim() : undefined;
  const percent = settings.format === 'percent' || unit === '%';
  return {
    unit: percent ? '%' : unit,
    prefix: settings.unitPosition === 'prefix',
    percent,
    decimals: typeof settings.decimals === 'number' ? settings.decimals : 0,
  };
}

export function formatWithUnit(value: number, style: NumberStyle): string {
  const text = value.toLocaleString('en-US', { maximumFractionDigits: style.decimals, minimumFractionDigits: style.decimals });
  if (!style.unit) return text;
  if (style.percent) return `${text}%`;
  return style.prefix ? `${style.unit}${text}` : `${text} ${style.unit}`;
}

/** Number with the column's unit; percentages get a small progress bar like the board column. */
function NumberCell({ value, style, compact }: { readonly value: number; readonly style: NumberStyle; readonly compact?: boolean }) {
  const label = formatWithUnit(value, style);
  if (!style.percent || compact) return <span className="block text-right tabular-nums">{label}</span>;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span className="flex items-center gap-2" role="img" aria-label={label}>
      <span aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
      </span>
      <span aria-hidden className="w-9 shrink-0 text-right text-xs tabular-nums text-fg-secondary">
        {label}
      </span>
    </span>
  );
}

function Cell({ display }: { readonly display: CellDisplay }) {
  switch (display.kind) {
    case 'empty':
      return <span className="text-fg-muted">—</span>;
    case 'text':
      return <span className={display.align === 'end' ? 'block text-right tabular-nums' : 'block truncate'}>{display.text}</span>;
    case 'label':
      return <StatusPill label={display.label} color={toLabelColor(display.color)} />;
    case 'labels':
      return <span className="block truncate">{display.labels.map((label) => label.label).join(', ')}</span>;
    case 'people': {
      const [only] = display.people;
      if (display.people.length === 1 && only) {
        // One owner: avatar plus name (first name + initial when space is short).
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar name={only.name} src={only.image} colorKey={only.id} size="sm" />
            <span className="min-w-0 truncate text-sm text-fg">{only.name}</span>
          </span>
        );
      }
      return <AvatarGroup people={display.people.map((person) => ({ id: person.id, name: person.name, src: person.image }))} max={3} size="sm" />;
    }
    case 'check':
      return <span aria-label={display.checked ? 'Checked' : 'Not checked'}>{display.checked ? '✓' : ''}</span>;
  }
}

function ValueCell({
  column,
  item,
  users,
  compact,
}: {
  readonly column: ColumnDto;
  readonly item: ItemDto;
  readonly users: ReadonlyMap<string, UserSummaryDto>;
  readonly compact?: boolean;
}) {
  const style = numberStyleOf(column);
  const raw = (item.values as Record<string, unknown> | undefined)?.[column.key];
  if (style && typeof raw === 'number') return <NumberCell value={raw} style={style} compact={compact} />;
  return <Cell display={cellDisplay(column, item, users)} />;
}

export function TableWidget({ insight, orgSlug, filtered, onConfigure, expanded }: WidgetRenderProps) {
  const users = useMemo(() => new Map<string, UserSummaryDto>(insight.users.map((user) => [user.id, user])), [insight.users]);
  const headers = useMemo(
    () => insight.tableKeys.map((key) => insight.columns.find((column) => column.key === key)).filter((column): column is ColumnDto => Boolean(column)),
    [insight.tableKeys, insight.columns],
  );
  const [ref, size] = useElementSize<HTMLDivElement>();
  if (insight.rows.length === 0) return <NoDataState filtered={filtered} onConfigure={onConfigure} />;
  const columnOf = (item: ItemDto, key: string) => insight.columns.find((column) => column.boardId === item.boardId && column.key === key);
  const multiBoard = insight.boards.length > 1;
  const singleBoard = insight.boards.length === 1 ? insight.boards[0] : undefined;
  const footer = (
    <div className="mt-1.5 flex shrink-0 items-center justify-between gap-3 text-xs text-fg-muted">
      <p>
        {insight.rowsTruncated ? `Showing ${insight.rows.length} of ${insight.itemCount.toLocaleString('en-US')} items` : `${insight.rows.length} items`}
      </p>
      {singleBoard && (insight.rowsTruncated || expanded) ? (
        <Link
          href={`/${orgSlug}/boards/${singleBoard.id}`}
          className="font-medium text-primary-text outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          data-testid="table-open-board"
        >
          Open in board
        </Link>
      ) : null}
    </div>
  );
  if (size.width > 0 && size.width < CARD_LIST_BELOW) {
    // Narrow cards: a stacked list (name, first label pill, first number) instead of a clipped table.
    const pillHeader = headers.find((column) => column.type === 'status');
    const valueHeader = headers.find((column) => ['number', 'currency', 'formula'].includes(column.type));
    return (
      <div ref={ref} className="flex h-full min-h-0 flex-col" data-testid="table-widget" data-layout="cards">
        <ul className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
          {insight.rows.map((item) => {
            const group = insight.groups.find((entry) => entry.id === item.groupId);
            const pillColumn = pillHeader ? columnOf(item, pillHeader.key) : undefined;
            const valueColumn = valueHeader ? columnOf(item, valueHeader.key) : undefined;
            return (
              <li key={item.id} className="relative flex items-center gap-2 py-2 pr-2.5 pl-3.5 hover:bg-hover">
                <span aria-hidden className="absolute top-0 bottom-0 left-0 w-1" style={{ background: cssColor(toLabelColor(group?.color, 'blue')) }} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/${orgSlug}/boards/${item.boardId}?item=${item.id}`}
                    className="block truncate text-sm font-medium text-fg outline-none hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {item.name}
                  </Link>
                  {pillColumn ? (
                    <div className="mt-1 w-28">
                      <Cell display={cellDisplay(pillColumn, item, users)} />
                    </div>
                  ) : group ? (
                    <span className="block truncate text-2xs text-fg-muted">{group.title}</span>
                  ) : null}
                </div>
                {valueColumn ? (
                  <span className="shrink-0 text-sm font-semibold text-fg">
                    <ValueCell column={valueColumn} item={item} users={users} compact />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {footer}
      </div>
    );
  }
  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col" data-testid="table-widget" data-layout="table">
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border-subtle">
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-[1] bg-muted">
            <tr>
              <th scope="col" className="h-8 border-b border-border-subtle px-3 text-left text-xs font-medium text-fg-muted">
                Name
              </th>
              {headers.map((column) => (
                <th key={column.key} scope="col" className="h-8 min-w-[110px] border-b border-l border-border-subtle px-2 text-center text-xs font-medium text-fg-muted">
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {insight.rows.map((item) => {
              const group = insight.groups.find((entry) => entry.id === item.groupId);
              const board = insight.boards.find((entry) => entry.id === item.boardId);
              return (
                <tr key={item.id} className="group h-9 hover:bg-hover">
                  <th scope="row" className="relative max-w-[260px] border-b border-border-subtle pr-3 pl-3 text-left font-normal">
                    <span aria-hidden className="absolute top-0 bottom-0 left-0 w-1" style={{ background: cssColor(toLabelColor(group?.color, 'blue')) }} />
                    <Link
                      href={`/${orgSlug}/boards/${item.boardId}?item=${item.id}`}
                      className="block truncate text-fg outline-none hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {item.name}
                    </Link>
                    {multiBoard || group ? (
                      <span className="block truncate text-2xs text-fg-muted">
                        {multiBoard ? `${board?.name ?? 'Board'} · ` : ''}
                        {group?.title}
                      </span>
                    ) : null}
                  </th>
                  {headers.map((header) => {
                    const column = columnOf(item, header.key);
                    return (
                      <td key={header.key} className="max-w-[200px] border-b border-l border-border-subtle px-2 text-fg">
                        {column ? <ValueCell column={column} item={item} users={users} /> : <span className="text-fg-muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
