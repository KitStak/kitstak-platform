'use client';

/** Active filters as removable chips under the toolbar (TB-005), plus sort / group summaries. */
import { ArrowUpDown, Group, ListFilter, Search, UserRound, X } from 'lucide-react';
import { Button, cn } from '@/components/ui';
import type { ColumnDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { WorkingState } from '../hooks/use-working-state';
import { countRules, ruleSummary } from '../lib/filter-model';

interface ChipProps {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onRemove: () => void;
  readonly onClick?: () => void;
  readonly tone?: 'filter' | 'neutral';
}

function FilterChip({ icon, label, onRemove, onClick, tone = 'filter' }: ChipProps) {
  return (
    <li
      className={cn(
        'flex h-7 max-w-72 min-w-0 items-center rounded-full border text-sm animate-fade-in',
        tone === 'filter' ? 'border-primary/40 bg-primary-subtle text-fg' : 'border-border-subtle bg-muted text-fg-secondary',
      )}
      data-testid="filter-chip"
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        title={label}
        className="flex h-full min-w-0 items-center gap-1.5 rounded-l-full pr-1 pl-2.5 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus disabled:hover:no-underline [&_svg]:size-3.5 [&_svg]:shrink-0"
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-icon transition-colors duration-[var(--duration-instant)] hover:bg-pressed hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}

export interface FilterChipsProps {
  readonly state: WorkingState;
  readonly columns: readonly ColumnDto[];
  readonly users: readonly UserSummaryDto[];
  readonly onOpenFilter: () => void;
}

export function FilterChips({ state, columns, users, onOpenFilter }: FilterChipsProps) {
  const { table, working } = state;
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const person = users.find((user) => user.id === working.personFilter);
  const search = table.state.search.trim();
  const groupColumn = working.groupBy ? byKey.get(working.groupBy.columnKey) : undefined;
  const ruleCount = countRules(working.filters);
  const groups = working.filters.groups ?? [];
  const hasAny = ruleCount > 0 || person || search || working.sort.length > 0 || groupColumn;
  if (!hasAny) return null;
  const conj = working.filters.conjunction === 'or' ? 'Any of' : null;
  return (
    <div className="flex items-start gap-2 px-8 pb-2 max-md:px-4" data-testid="filter-chips">
      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label="Active filters">
        {conj && working.filters.rules.length + groups.length > 1 ? <li className="text-sm text-fg-muted">{conj}:</li> : null}
        {search ? <FilterChip icon={<Search aria-hidden />} label={`“${search}”`} onRemove={() => table.setSearch('')} /> : null}
        {person ? (
          <FilterChip icon={<UserRound aria-hidden />} label={`Person is ${person.name}`} onRemove={() => table.setPersonFilter(null)} />
        ) : null}
        {working.filters.rules.map((rule, index) => (
          <FilterChip
            // Rules may repeat a column; position is their identity here.
            key={`${rule.columnKey}-${index}`}
            icon={<ListFilter aria-hidden />}
            label={ruleSummary(rule, byKey.get(rule.columnKey), users)}
            onClick={onOpenFilter}
            onRemove={() =>
              table.setFilters({ ...working.filters, rules: working.filters.rules.filter((_, position) => position !== index) })
            }
          />
        ))}
        {groups.map((group, index) => (
          <FilterChip
            key={`group-${index}`}
            icon={<ListFilter aria-hidden />}
            label={`(${group.rules.map((rule) => ruleSummary(rule, byKey.get(rule.columnKey), users)).join(group.conjunction === 'or' ? ' or ' : ' and ')})`}
            onClick={onOpenFilter}
            onRemove={() => table.setFilters({ ...working.filters, groups: groups.filter((_, position) => position !== index) })}
          />
        ))}
        {working.sort.length ? (
          <FilterChip
            tone="neutral"
            icon={<ArrowUpDown aria-hidden />}
            label={`Sorted by ${working.sort
              .map((rule) => `${byKey.get(rule.columnKey)?.title ?? rule.columnKey} ${rule.direction === 'desc' ? '↓' : '↑'}`)
              .join(', ')}`}
            onRemove={() => table.setSort([])}
          />
        ) : null}
        {groupColumn ? (
          <FilterChip
            tone="neutral"
            icon={<Group aria-hidden />}
            label={`Grouped by ${groupColumn.title}${working.groupBy?.bucket ? ` (${working.groupBy.bucket})` : ''}`}
            onRemove={() => state.setGroupBy(null)}
          />
        ) : null}
      </ul>
      {ruleCount || person || search ? (
        <Button variant="ghost" size="xs" onClick={table.clearFilters} className="mt-0.5 shrink-0" data-testid="clear-filters">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
