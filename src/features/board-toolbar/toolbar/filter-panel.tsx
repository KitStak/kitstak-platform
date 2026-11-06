'use client';

/**
 * Filter popover body (TB-004): Quick tab (value chips per column, each with a faceted count)
 * and Advanced tab (rule rows with AND/OR). Changes apply live; incomplete advanced rows stay
 * in the editor until they can be applied.
 */
import { useMemo, useState } from 'react';
import { Check, FilterX, ListPlus, Plus, Trash2 } from 'lucide-react';
import { Avatar, Button, EmptyState, IconButton, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@/components/ui';
import { plural, type FilterGroup, type FilterRule } from '@/features/board-table';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import {
  applicableFilters,
  buildFacets,
  coerceValue,
  countRules,
  defaultOperator,
  isFacetSelected,
  isFilterable,
  toggleDateFacet,
  type Facet,
} from '../lib/filter-model';
import { ConjunctionLead, FilterRuleRow } from './filter-rule-row';
import { PanelHeader } from './toolbar-popover';

export interface FilterPanelProps {
  readonly columns: readonly ColumnDto[];
  readonly users: readonly UserSummaryDto[];
  readonly items: readonly ItemDto[];
  readonly filters: FilterGroup;
  readonly search: string;
  readonly personFilter: string | null;
  readonly visibleCount: number;
  readonly noun: string;
  readonly onFiltersChange: (filters: FilterGroup) => void;
  readonly onToggleValue: (columnKey: string, valueId: string | null) => void;
  readonly onClearAll: () => void;
}

const MAX_CHIPS = 12;
const MAX_RULES = 50;
const MAX_GROUPS = 10;

function QuickColumn({ facet, filters, onToggle }: { readonly facet: Facet; readonly filters: FilterGroup; readonly onToggle: (id: string | null) => void }) {
  const [expanded, setExpanded] = useState(false);
  const values = expanded ? facet.values : facet.values.slice(0, MAX_CHIPS);
  return (
    <section className="flex min-w-0 flex-col gap-1.5" aria-label={facet.column.title}>
      <h3 className="truncate text-xs font-semibold tracking-wide text-fg-muted uppercase">{facet.column.title}</h3>
      {facet.values.length === 0 ? <p className="text-sm text-fg-muted">No values yet</p> : null}
      <ul className="flex flex-col gap-1">
        {values.map((value) => {
          const selected = isFacetSelected(filters, facet.column.key, value.id);
          return (
            <li key={value.id ?? 'empty'}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onToggle(value.id)}
                data-testid="quick-filter-chip"
                className={cn(
                  'flex h-7 w-full min-w-0 items-center gap-2 rounded-sm border px-2 text-left text-sm transition-[background-color,border-color] duration-[var(--duration-instant)] ease-out',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                  selected ? 'border-primary bg-primary-subtle text-fg' : 'border-transparent bg-muted text-fg hover:border-border-strong',
                  value.count === 0 && !selected && 'text-fg-muted',
                )}
              >
                {value.userId ? (
                  <Avatar name={value.name} colorKey={value.userId} size="xs" />
                ) : (
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: value.color ? `var(--label-${value.color})` : 'var(--border-strong)' }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{value.name}</span>
                {selected ? <Check aria-hidden className="size-3.5 shrink-0 text-primary-text" /> : null}
                <span className="shrink-0 text-xs text-fg-muted tabular-nums">{value.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {facet.values.length > MAX_CHIPS ? (
        <Button variant="tertiary" size="xs" className="self-start" onClick={() => setExpanded((open) => !open)}>
          {expanded ? 'Show less' : `Show ${facet.values.length - MAX_CHIPS} more`}
        </Button>
      ) : null}
    </section>
  );
}

interface GroupEditorProps {
  readonly group: FilterGroup;
  readonly depth: number;
  readonly columns: readonly ColumnDto[];
  readonly users: readonly UserSummaryDto[];
  readonly total: number;
  readonly onChange: (group: FilterGroup) => void;
  readonly onRemove?: () => void;
}

function newRule(columns: readonly ColumnDto[]): FilterRule | null {
  const column = columns.find((entry) => entry.type !== 'name') ?? columns[0];
  if (!column) return null;
  const operator = defaultOperator(column);
  return { columnKey: column.key, operator, value: coerceValue(column, operator, undefined) };
}

/** A list of rules + nested groups sharing one And/Or (the top level, or a nested group). */
function GroupEditor({ group, depth, columns, users, total, onChange, onRemove }: GroupEditorProps) {
  const groups = group.groups ?? [];
  const setRules = (rules: FilterRule[]) => onChange({ ...group, rules });
  const setGroups = (next: FilterGroup[]) => onChange({ ...group, groups: next });
  const setConjunction = (conjunction: 'and' | 'or') => onChange({ ...group, conjunction });
  const addRule = () => {
    const rule = newRule(columns);
    if (rule) setRules([...group.rules, rule]);
  };
  const addGroup = () => {
    const rule = newRule(columns);
    if (rule) setGroups([...groups, { conjunction: 'and', rules: [rule] }]);
  };
  const atLimit = total >= MAX_RULES;
  const nested = depth > 0;

  return (
    <div
      className={cn('flex flex-col gap-1', nested && 'rounded-md border border-border-subtle bg-muted/60 px-3 py-2')}
      data-testid={nested ? 'filter-group' : 'filter-root'}
    >
      {nested ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Condition group</span>
          {onRemove ? (
            <IconButton label="Remove condition group" size="sm" icon={<Trash2 aria-hidden />} onClick={onRemove} />
          ) : null}
        </div>
      ) : null}
      {group.rules.length === 0 && groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default px-3 py-4 text-center text-sm text-fg-muted">
          Build rules like “Stage is Negotiation and Deal value greater than 10,000”, or add a group for “this or that”.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {group.rules.map((rule, index) => (
            <FilterRuleRow
              key={`r-${index}`}
              lead={<ConjunctionLead index={index} conjunction={group.conjunction} onChange={setConjunction} />}
              rule={rule}
              columns={columns}
              users={users}
              onChange={(next) => setRules(group.rules.map((entry, position) => (position === index ? next : entry)))}
              onRemove={() => setRules(group.rules.filter((_, position) => position !== index))}
            />
          ))}
          {groups.map((child, index) => (
            <li key={`g-${index}`} className="flex items-start gap-2 py-1">
              <span className="pt-2">
                <ConjunctionLead index={group.rules.length + index} conjunction={group.conjunction} onChange={setConjunction} />
              </span>
              <div className="min-w-0 flex-1">
                <GroupEditor
                  group={child}
                  depth={depth + 1}
                  columns={columns}
                  users={users}
                  total={total}
                  onChange={(next) => setGroups(groups.map((entry, position) => (position === index ? next : entry)))}
                  onRemove={() => setGroups(groups.filter((_, position) => position !== index))}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="tertiary"
          size="sm"
          leadingIcon={<Plus />}
          onClick={addRule}
          data-testid={nested ? 'filter-group-add-rule' : 'filter-add-rule'}
          disabled={atLimit}
        >
          Add rule
        </Button>
        {nested ? null : (
          <Button
            variant="tertiary"
            size="sm"
            leadingIcon={<ListPlus />}
            onClick={addGroup}
            data-testid="filter-add-group"
            disabled={atLimit || groups.length >= MAX_GROUPS}
          >
            Add group
          </Button>
        )}
      </div>
    </div>
  );
}

function AdvancedRules({
  columns,
  users,
  filters,
  onFiltersChange,
}: Pick<FilterPanelProps, 'columns' | 'users' | 'filters' | 'onFiltersChange'>) {
  const filterable = useMemo(() => columns.filter(isFilterable), [columns]);
  const byKey = useMemo(() => new Map(filterable.map((column) => [column.key, column])), [filterable]);
  // Draft tree: keeps incomplete rows in the editor; only complete ones are applied.
  const [tree, setTree] = useState<FilterGroup>(() => filters);
  const commit = (next: FilterGroup) => {
    setTree(next);
    onFiltersChange(applicableFilters(next, byKey));
  };
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <GroupEditor group={tree} depth={0} columns={filterable} users={users} total={countRules(tree)} onChange={commit} />
    </div>
  );
}

export function FilterPanel(props: FilterPanelProps) {
  const facets = useMemo(
    () =>
      buildFacets(props.items, {
        columns: props.columns,
        users: props.users,
        search: props.search,
        personFilter: props.personFilter,
        filters: props.filters,
      }),
    [props.columns, props.filters, props.items, props.personFilter, props.search, props.users],
  );
  const ruleCount = countRules(props.filters);
  const advancedOnly =
    (props.filters.groups?.length ?? 0) > 0 ||
    props.filters.rules.some((rule) => !['any_of', 'is_empty', 'within'].includes(rule.operator));
  return (
    <div className="flex max-h-[min(640px,calc(100dvh-160px))] flex-col">
      <PanelHeader
        title="Filter"
        aside={
          <span className="text-sm text-fg-muted tabular-nums" aria-live="polite" data-testid="filter-result-count">
            Showing {props.visibleCount.toLocaleString('en-US')} of {props.items.length.toLocaleString('en-US')}{' '}
            {plural(props.noun, props.items.length).toLowerCase()}
          </span>
        }
      />
      <Tabs defaultValue={ruleCount && advancedOnly ? 'advanced' : 'quick'} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border-subtle px-4 py-2">
          <TabsList variant="pill">
            <TabsTrigger variant="pill" value="quick">
              Quick filters
            </TabsTrigger>
            <TabsTrigger variant="pill" value="advanced" data-testid="filter-advanced-tab">
              Advanced
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="quick" className="min-h-0 flex-1 overflow-y-auto">
          {facets.length === 0 ? (
            <EmptyState
              size="sm"
              title="No quick filters for this board"
              description="Add a status, dropdown, people or date column, or use Advanced filters."
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 px-4 py-3">
              {facets.map((facet) => (
                <QuickColumn
                  key={facet.column.key}
                  facet={facet}
                  filters={props.filters}
                  onToggle={(id) =>
                    facet.kind === 'date'
                      ? props.onFiltersChange(toggleDateFacet(props.filters, facet.column.key, id))
                      : props.onToggleValue(facet.column.key, id)
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="advanced" className="min-h-0 flex-1 overflow-y-auto">
          <AdvancedRules columns={props.columns} users={props.users} filters={props.filters} onFiltersChange={props.onFiltersChange} />
        </TabsContent>
      </Tabs>
      <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2">
        <span className="text-sm text-fg-muted">{ruleCount ? `${ruleCount} active ${ruleCount === 1 ? 'rule' : 'rules'}` : 'No filters applied'}</span>
        <Button variant="ghost" size="sm" leadingIcon={<FilterX />} onClick={props.onClearAll} disabled={!ruleCount && !props.personFilter && !props.search}>
          Clear all
        </Button>
      </div>
    </div>
  );
}
