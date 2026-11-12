'use client';

/**
 * Mobile fallback for the board table. Below 768px the grid leaves the name column a handful
 * of characters, so each row renders as a tappable card instead: name, the primary status
 * pill, owners and the first date column, grouped under slim group headers. Read-mostly —
 * tapping a card opens the item panel; editing happens there.
 */
import { useMemo } from 'react';
import { AvatarGroup, cn } from '@/components/ui';
import { LabelChip, labelsFromSettings, useMediaQuery } from '@/features/cells';
import { formatCurrencyValue, formatNumberValue, type NumberFormatSettings } from '@/features/cells/lib/format';
import { readCurrency, readNumber } from '@/features/cells/lib/values';
import type { Label } from '@/server/db/schema/column-types';
import type { BoardPayloadDto, ColumnDto, ItemDto, ViewDto } from '@/server/services/contracts/dto';
import { itemsByGroup } from '../lib/filter-sort';
import { countLabel } from '../lib/terminology';
import { useBoardTableState } from '../state/use-board-table-state';
import { groupColorVar, type OpenItemOptions } from '../table-context';

/** Below this width the board table renders as cards (matches the Tailwind `md` breakpoint). */
export const MOBILE_TABLE_QUERY = '(max-width: 767px)';

/** True when the board table should fall back to the card list. */
export function useMobileTable(): boolean {
  return useMediaQuery(MOBILE_TABLE_QUERY);
}

const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** "Dec 15" (adds the year when it differs from today's). */
function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(year, month - 1, day);
  const sameYear = year === new Date().getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

interface CardColumns {
  readonly status: ColumnDto | null;
  readonly statusLabels: readonly Label[];
  readonly people: ColumnDto | null;
  readonly date: ColumnDto | null;
  /** First currency/number column (deal value on the Deals board). */
  readonly value: ColumnDto | null;
}

function statusLabelOf(item: ItemDto, card: CardColumns): Label | null {
  if (!card.status) return null;
  const raw: unknown = item.values[card.status.key];
  const id = isRecord(raw) && typeof raw.labelId === 'string' ? raw.labelId : null;
  return card.statusLabels.find((label) => label.id === id) ?? null;
}

function peopleOf(
  item: ItemDto,
  card: CardColumns,
  usersById: ReadonlyMap<string, BoardPayloadDto['users'][number]>,
) {
  if (!card.people) return [];
  const raw: unknown = item.values[card.people.key];
  const ids: readonly unknown[] = isRecord(raw) && Array.isArray(raw.ids) ? raw.ids : [];
  return ids.flatMap((id) => {
    const user = typeof id === 'string' ? usersById.get(id) : undefined;
    return user ? [{ id: user.id, name: user.name, src: user.image }] : [];
  });
}

function dateOf(item: ItemDto, card: CardColumns): string | null {
  if (!card.date) return null;
  const raw: unknown = item.values[card.date.key];
  return isRecord(raw) && typeof raw.date === 'string' ? shortDate(raw.date) : null;
}

/** Deal value (or first numeric column), formatted exactly like the desktop cell. */
function valueOf(item: ItemDto, card: CardColumns): string | null {
  if (!card.value) return null;
  if (card.value.type === 'currency') {
    const value = readCurrency(item.values[card.value.key]);
    if (!value) return null;
    const decimals = (card.value.settings as { decimals?: number }).decimals ?? 0;
    return formatCurrencyValue(value.amount, value.currency, decimals);
  }
  const value = readNumber(item.values[card.value.key]);
  if (value === null) return null;
  return formatNumberValue(value, card.value.settings as NumberFormatSettings);
}

export interface BoardCardListProps {
  readonly boardId: string;
  readonly payload: BoardPayloadDto;
  readonly items: readonly ItemDto[];
  readonly view?: ViewDto | null;
  readonly onOpenItem: (itemId: string, options?: OpenItemOptions) => void;
}

export function BoardCardList({ boardId, payload, items, view, onOpenItem }: BoardCardListProps) {
  const { state, hasFilters } = useBoardTableState(boardId, view);
  const terminology = payload.board.itemTerminology || 'Item';

  const groups = useMemo(
    () => [...payload.groups].filter((group) => !group.archivedAt).sort(byPosition),
    [payload.groups],
  );
  const columns = useMemo(
    () =>
      payload.columns
        .filter(
          (column) =>
            column.scope === 'item' && !column.hidden && !state.hiddenColumnKeys.includes(column.key),
        )
        .sort(byPosition),
    [payload.columns, state.hiddenColumnKeys],
  );
  const card = useMemo<CardColumns>(() => {
    const status = columns.find((column) => column.type === 'status') ?? null;
    return {
      status,
      statusLabels: status ? labelsFromSettings(status.settings) : [],
      people: columns.find((column) => column.type === 'people') ?? null,
      date: columns.find((column) => column.type === 'date') ?? null,
      value: columns.find((column) => column.type === 'currency' || column.type === 'number') ?? null,
    };
  }, [columns]);
  const usersById = useMemo(
    () => new Map(payload.users.map((user) => [user.id, user])),
    [payload.users],
  );
  const buckets = useMemo(
    () =>
      itemsByGroup(
        items,
        groups.map((group) => group.id),
        state,
        { columns, users: usersById },
      ),
    [columns, groups, items, state, usersById],
  );
  const visibleTotal = useMemo(
    () => [...buckets.values()].reduce((total, list) => total + list.length, 0),
    [buckets],
  );

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-8"
      data-testid="board-card-list"
    >
      {visibleTotal === 0 ? (
        <p role="status" className="px-1 py-10 text-center text-base text-fg-secondary">
          {hasFilters
            ? `No ${terminology.toLowerCase()}s match this view.`
            : `No ${terminology.toLowerCase()}s yet.`}
        </p>
      ) : null}
      {groups.map((group) => {
        const list = buckets.get(group.id) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={group.id} aria-label={group.title}>
            <header className="sticky top-0 z-[1] flex items-baseline gap-2 bg-panel px-1 pt-4 pb-2">
              <span
                aria-hidden
                className="h-3 w-1 shrink-0 self-center rounded-full"
                style={{ background: groupColorVar(group.color) }}
              />
              <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{group.title}</h3>
              <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                {countLabel(list.length, terminology.toLowerCase())}
              </span>
            </header>
            <ul className="flex flex-col gap-2">
              {list.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  card={card}
                  usersById={usersById}
                  groupColor={group.color}
                  onOpen={() => onOpenItem(item.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ItemCard({
  item,
  card,
  usersById,
  groupColor,
  onOpen,
}: {
  readonly item: ItemDto;
  readonly card: CardColumns;
  readonly usersById: ReadonlyMap<string, BoardPayloadDto['users'][number]>;
  readonly groupColor: string;
  readonly onOpen: () => void;
}) {
  const label = statusLabelOf(item, card);
  const people = peopleOf(item, card, usersById);
  const date = dateOf(item, card);
  const value = valueOf(item, card);
  return (
    <li className="list-none">
      <button
        type="button"
        data-testid="board-item-card"
        onClick={onOpen}
        className={cn(
          'relative flex w-full flex-col gap-2 overflow-hidden rounded-md border border-border-subtle',
          'bg-raised px-3 py-2.5 pl-4 text-left',
          'active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        )}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: groupColorVar(groupColor) }}
        />
        <span className="line-clamp-2 min-w-0 text-base font-medium text-fg">{item.name}</span>
        {label || people.length > 0 || date || value ? (
          <span className="flex min-w-0 items-center gap-2">
            {label ? <LabelChip label={label} className="h-5 max-w-36 text-xs" /> : null}
            {date ? <span className="shrink-0 text-sm text-fg-secondary tabular-nums">{date}</span> : null}
            {people.length > 0 ? (
              <AvatarGroup people={people} max={3} size="xs" className="ml-auto" />
            ) : null}
            {value ? (
              <span
                data-testid="board-card-value"
                className={cn(
                  'shrink-0 text-right text-sm font-medium text-fg tabular-nums',
                  people.length === 0 && 'ml-auto',
                )}
              >
                {value}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    </li>
  );
}
