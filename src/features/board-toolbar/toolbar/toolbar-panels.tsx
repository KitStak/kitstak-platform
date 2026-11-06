'use client';

/** Popover bodies for Person filter, Sort, Hide and Group by. */
import { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, Eye, EyeOff, Plus, UserRound, X } from 'lucide-react';
import { Avatar, Button, Checkbox, EmptyState, IconButton, SearchInput, Select, ToggleGroup, cn } from '@/components/ui';
import type { SortRule } from '@/features/board-table';
import { ColumnTypeIcon } from '@/features/cells';
import type { ColumnDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { DATE_BUCKETS, type DateBucket, type GroupBySpec } from '../lib/draft';
import { isDateLike, isGroupable } from '../lib/group-by';
import { PanelHeader } from './toolbar-popover';

// Person ----------------------------------------------------------------------------------------

export interface PersonPanelProps {
  readonly people: readonly (UserSummaryDto & { readonly count: number })[];
  readonly selected: string | null;
  readonly onSelect: (userId: string | null) => void;
  readonly noun: string;
}

export function PersonPanel({ people, selected, onSelect, noun }: PersonPanelProps) {
  const [query, setQuery] = useState('');
  const visible = people.filter((person) => person.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="flex flex-col">
      <PanelHeader
        title="Filter by person"
        aside={
          selected ? (
            <Button variant="tertiary" size="xs" onClick={() => onSelect(null)}>
              Clear
            </Button>
          ) : null
        }
      />
      <div className="px-4 pt-3">
        <SearchInput size="sm" value={query} onValueChange={setQuery} placeholder="Search people" aria-label="Search people" />
      </div>
      {people.length === 0 ? (
        <EmptyState
          size="sm"
          visual={<UserRound aria-hidden className="size-7 text-icon" />}
          title="No one is assigned yet"
          description={`Assign people to ${noun.toLowerCase()}s to filter by them.`}
        />
      ) : (
        <ul className="flex max-h-72 flex-wrap gap-2 overflow-y-auto px-4 py-3" aria-label="People">
          {visible.map((person) => {
            const active = person.id === selected;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(active ? null : person.id)}
                  data-testid="person-filter-option"
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition-[background-color,border-color] duration-[var(--duration-instant)] ease-out',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                    active ? 'border-primary bg-primary-subtle text-fg' : 'border-border-subtle bg-panel text-fg hover:border-border-strong hover:bg-muted',
                  )}
                >
                  <Avatar name={person.name} src={person.image} colorKey={person.id} size="sm" />
                  <span className="max-w-32 truncate">{person.name}</span>
                  <span className="text-xs text-fg-muted tabular-nums">{person.count}</span>
                  {active ? <Check aria-hidden className="size-3.5 text-primary-text" /> : null}
                </button>
              </li>
            );
          })}
          {visible.length === 0 ? <li className="py-2 text-sm text-fg-muted">No one matches “{query}”.</li> : null}
        </ul>
      )}
    </div>
  );
}

// Sort ------------------------------------------------------------------------------------------

export interface SortPanelProps {
  readonly columns: readonly ColumnDto[];
  readonly sort: readonly SortRule[];
  readonly onChange: (sort: readonly SortRule[]) => void;
}

export function SortPanel({ columns, sort, onChange }: SortPanelProps) {
  const sortable = columns.filter((column) => column.type !== 'button' && column.type !== 'files');
  const used = new Set(sort.map((rule) => rule.columnKey));
  const add = () => {
    const next = sortable.find((column) => !used.has(column.key));
    if (next) onChange([...sort, { columnKey: next.key, direction: 'asc' }]);
  };
  return (
    <div className="flex flex-col">
      <PanelHeader
        title="Sort"
        aside={
          sort.length ? (
            <Button variant="tertiary" size="xs" onClick={() => onChange([])}>
              Clear
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-2 px-4 py-3">
        {sort.length === 0 ? (
          <p className="text-sm text-fg-muted">Sort by one or more columns. Ties on the first rule fall through to the next.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {sort.map((rule, index) => (
              <li key={rule.columnKey} className="flex items-center gap-2" data-testid="sort-rule">
                <span className="w-14 shrink-0 text-sm text-fg-secondary">{index === 0 ? 'Sort by' : 'then by'}</span>
                <Select
                  aria-label="Sort column"
                  className="min-w-0 flex-1"
                  value={rule.columnKey}
                  onValueChange={(columnKey) => onChange(sort.map((entry, position) => (position === index ? { ...entry, columnKey } : entry)))}
                  options={sortable
                    .filter((column) => column.key === rule.columnKey || !used.has(column.key))
                    .map((column) => ({ value: column.key, label: column.title, icon: <ColumnTypeIcon type={column.type} /> }))}
                />
                <ToggleGroup<'asc' | 'desc'>
                  label="Direction"
                  size="sm"
                  value={rule.direction}
                  onValueChange={(direction) => onChange(sort.map((entry, position) => (position === index ? { ...entry, direction } : entry)))}
                  options={[
                    { value: 'asc', label: 'Ascending', icon: <ArrowUpNarrowWide aria-hidden />, iconOnly: true },
                    { value: 'desc', label: 'Descending', icon: <ArrowDownWideNarrow aria-hidden />, iconOnly: true },
                  ]}
                />
                <IconButton label="Remove sort" size="sm" icon={<X aria-hidden />} onClick={() => onChange(sort.filter((_, position) => position !== index))} />
              </li>
            ))}
          </ol>
        )}
        <Button
          variant="tertiary"
          size="sm"
          leadingIcon={<Plus />}
          className="self-start"
          onClick={add}
          disabled={used.size >= Math.min(10, sortable.length)}
          data-testid="sort-add"
        >
          {sort.length ? 'Add another sort' : 'Add sort'}
        </Button>
      </div>
    </div>
  );
}

// Hide ------------------------------------------------------------------------------------------

export interface HidePanelProps {
  readonly columns: readonly ColumnDto[];
  readonly hidden: readonly string[];
  readonly onChange: (hidden: readonly string[]) => void;
}

export function HidePanel({ columns, hidden, onChange }: HidePanelProps) {
  const [query, setQuery] = useState('');
  const hideable = columns.filter((column) => column.type !== 'name');
  const hiddenSet = new Set(hidden);
  const shown = hideable.filter((column) => !hiddenSet.has(column.key)).length;
  const visible = hideable.filter((column) => column.title.toLowerCase().includes(query.trim().toLowerCase()));
  const allShown = shown === hideable.length;
  return (
    <div className="flex flex-col">
      <PanelHeader title="Columns" aside={<span className="text-sm text-fg-muted tabular-nums" data-testid="hide-count">{shown}/{hideable.length} shown</span>} />
      <div className="flex flex-col gap-2 px-4 pt-3">
        <SearchInput size="sm" value={query} onValueChange={setQuery} placeholder="Find a column" aria-label="Find a column" />
        <Checkbox
          label="All columns"
          checked={allShown ? true : shown === 0 ? false : 'indeterminate'}
          onCheckedChange={() => onChange(allShown ? hideable.map((column) => column.key) : [])}
        />
      </div>
      <ul className="flex max-h-80 flex-col overflow-y-auto px-2 py-2">
        {visible.map((column) => {
          const isShown = !hiddenSet.has(column.key);
          return (
            <li key={column.key}>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-base text-fg hover:bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus">
                <Checkbox
                  checked={isShown}
                  aria-label={column.title}
                  onCheckedChange={() => onChange(isShown ? [...hidden, column.key] : hidden.filter((key) => key !== column.key))}
                />
                <ColumnTypeIcon type={column.type} />
                <span className={cn('min-w-0 flex-1 truncate', !isShown && 'text-fg-muted')}>{column.title}</span>
                {isShown ? <Eye aria-hidden className="size-4 text-icon" /> : <EyeOff aria-hidden className="size-4 text-fg-muted" />}
              </label>
            </li>
          );
        })}
        {visible.length === 0 ? <li className="px-2 py-3 text-sm text-fg-muted">No column matches “{query}”.</li> : null}
      </ul>
    </div>
  );
}

// Group by --------------------------------------------------------------------------------------

const BUCKET_LABELS: Readonly<Record<DateBucket, string>> = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

export interface GroupByPanelProps {
  readonly columns: readonly ColumnDto[];
  readonly value: GroupBySpec | null;
  readonly onChange: (value: GroupBySpec | null) => void;
}

export function GroupByPanel({ columns, value, onChange }: GroupByPanelProps) {
  const groupable = useMemo(() => columns.filter(isGroupable), [columns]);
  const selected = groupable.find((column) => column.key === value?.columnKey);
  return (
    <div className="flex flex-col">
      <PanelHeader
        title="Group by"
        aside={
          value ? (
            <Button variant="tertiary" size="xs" onClick={() => onChange(null)}>
              Clear
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-3 px-4 py-3">
        <Select
          aria-label="Group items by"
          value={value?.columnKey ?? '__groups__'}
          onValueChange={(key) => {
            if (key === '__groups__') return onChange(null);
            const column = groupable.find((entry) => entry.key === key);
            onChange(column && isDateLike(column) ? { columnKey: key, bucket: 'month' } : { columnKey: key });
          }}
          options={[
            { value: '__groups__', label: 'Board groups (default)' },
            ...groupable.map((column) => ({ value: column.key, label: column.title, icon: <ColumnTypeIcon type={column.type} /> })),
          ]}
        />
        {selected && isDateLike(selected) ? (
          <ToggleGroup<DateBucket>
            label="Date bucket"
            size="sm"
            value={value?.bucket ?? 'month'}
            onValueChange={(bucket) => onChange({ columnKey: selected.key, bucket })}
            options={DATE_BUCKETS.map((bucket) => ({ value: bucket, label: BUCKET_LABELS[bucket] }))}
          />
        ) : null}
        <p className="text-sm text-fg-muted">
          {value
            ? 'Items are regrouped for this view only. Board groups are unchanged.'
            : 'Regroup items by a status, person, dropdown, checkbox or date column.'}
        </p>
      </div>
    </div>
  );
}
