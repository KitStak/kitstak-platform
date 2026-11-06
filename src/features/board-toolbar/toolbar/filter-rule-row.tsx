'use client';

/** One advanced filter rule: [Where/And/Or] [column] [operator] [value] [remove]. */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Avatar, Combobox, IconButton, Input, Select, cn } from '@/components/ui';
import { ColumnTypeIcon } from '@/features/cells';
import type { FilterOperator, FilterRule } from '@/features/board-table';
import type { ColumnDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { RELATIVE_DATE_OPTIONS, coerceValue, defaultOperator, labelsOf, operatorsFor, valueKind } from '../lib/filter-model';

export interface FilterRuleRowProps {
  /** "Where" / the And-Or select / "And" (see `ConjunctionLead`). */
  readonly lead: ReactNode;
  readonly rule: FilterRule;
  readonly columns: readonly ColumnDto[];
  readonly users: readonly UserSummaryDto[];
  readonly onChange: (rule: FilterRule) => void;
  readonly onRemove: () => void;
}

/** The left-hand word of a rule or group row: Where · [And|Or] select · And/Or. */
export function ConjunctionLead({
  index,
  conjunction,
  onChange,
}: {
  readonly index: number;
  readonly conjunction: 'and' | 'or';
  readonly onChange: (value: 'and' | 'or') => void;
}) {
  return (
    <span className="w-16 shrink-0 text-sm text-fg-secondary">
      {index === 0 ? (
        'Where'
      ) : index === 1 ? (
        <Select
          size="sm"
          aria-label="Match all or any condition"
          value={conjunction}
          onValueChange={(value) => onChange(value === 'or' ? 'or' : 'and')}
          options={[
            { value: 'and', label: 'And' },
            { value: 'or', label: 'Or' },
          ]}
        />
      ) : (
        <span className="pl-2">{conjunction === 'or' ? 'Or' : 'And'}</span>
      )}
    </span>
  );
}

function Swatch({ color }: { readonly color: string }) {
  return <span aria-hidden className="size-3 shrink-0 rounded-xs" style={{ background: `var(--label-${color})` }} />;
}

function ValueEditor({ rule, column, users, onChange }: { readonly rule: FilterRule; readonly column: ColumnDto; readonly users: readonly UserSummaryDto[]; readonly onChange: (value: unknown) => void }) {
  const kind = valueKind(column, rule.operator);
  const list = Array.isArray(rule.value) ? rule.value.map(String) : [];
  const text = typeof rule.value === 'string' || typeof rule.value === 'number' ? String(rule.value) : '';
  const common = 'min-w-0 flex-1 basis-40';
  switch (kind) {
    case 'none':
      return <span className={cn(common, 'hidden sm:block')} />;
    case 'labels':
      return (
        <Combobox
          multiple
          aria-label={`${column.title} values`}
          className={common}
          value={list}
          onValueChange={onChange}
          placeholder="Choose values"
          searchPlaceholder="Search labels"
          options={labelsOf(column)
            .filter((label) => !label.isDefault)
            .map((label) => ({ value: label.id, label: label.name, icon: <Swatch color={label.color} /> }))}
        />
      );
    case 'people':
      return (
        <Combobox
          multiple
          aria-label={`${column.title} people`}
          className={common}
          value={list}
          onValueChange={onChange}
          placeholder="Choose people"
          searchPlaceholder="Search people"
          options={users.map((user) => ({
            value: user.id,
            label: user.name,
            keywords: [user.email],
            icon: <Avatar name={user.name} src={user.image} colorKey={user.id} size="xs" />,
          }))}
        />
      );
    case 'checkbox':
      return (
        <Select
          aria-label={`${column.title} state`}
          className={common}
          value={list[0] ?? 'true'}
          onValueChange={(value) => onChange([value])}
          options={[
            { value: 'true', label: 'Checked' },
            { value: 'false', label: 'Unchecked' },
          ]}
        />
      );
    case 'date':
      return <Input type="date" aria-label={`${column.title} date`} containerClassName={common} value={text} onChange={(event) => onChange(event.target.value)} />;
    case 'date-range':
      return (
        <span className={cn(common, 'flex items-center gap-1')}>
          <Input type="date" aria-label="From date" containerClassName="min-w-0 flex-1" value={list[0] ?? ''} onChange={(event) => onChange([event.target.value, list[1] ?? ''])} />
          <span className="text-sm text-fg-muted">to</span>
          <Input type="date" aria-label="To date" containerClassName="min-w-0 flex-1" value={list[1] ?? ''} onChange={(event) => onChange([list[0] ?? '', event.target.value])} />
        </span>
      );
    case 'relative-date':
      return (
        <Select
          aria-label={`${column.title} relative date`}
          className={common}
          value={typeof rule.value === 'string' ? rule.value : 'this_week'}
          onValueChange={onChange}
          options={RELATIVE_DATE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        />
      );
    case 'number-range':
      return (
        <span className={cn(common, 'flex items-center gap-1')}>
          <Input type="number" inputMode="decimal" aria-label="From value" placeholder="From" containerClassName="min-w-0 flex-1" value={list[0] ?? ''} onChange={(event) => onChange([event.target.value, list[1] ?? ''])} />
          <span className="text-sm text-fg-muted">and</span>
          <Input type="number" inputMode="decimal" aria-label="To value" placeholder="To" containerClassName="min-w-0 flex-1" value={list[1] ?? ''} onChange={(event) => onChange([list[0] ?? '', event.target.value])} />
        </span>
      );
    case 'number':
      return (
        <Input
          type="number"
          inputMode="decimal"
          aria-label={`${column.title} value`}
          placeholder="Value"
          containerClassName={common}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    default:
      return <Input aria-label={`${column.title} text`} placeholder="Type a value" containerClassName={common} value={text} onChange={(event) => onChange(event.target.value)} />;
  }
}

export function FilterRuleRow({ lead, rule, columns, users, onChange, onRemove }: FilterRuleRowProps) {
  const column = columns.find((entry) => entry.key === rule.columnKey);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md py-1" data-testid="filter-rule">
      {lead}
      <Select
        aria-label="Column"
        className="min-w-0 flex-1 basis-32"
        value={rule.columnKey}
        onValueChange={(key) => {
          const next = columns.find((entry) => entry.key === key);
          if (!next) return;
          const operator = defaultOperator(next);
          onChange({ columnKey: key, operator, value: coerceValue(next, operator, undefined) });
        }}
        options={columns.map((entry) => ({ value: entry.key, label: entry.title, icon: <ColumnTypeIcon type={entry.type} /> }))}
      />
      {column ? (
        <>
          <Select
            aria-label="Condition"
            className="w-36 shrink-0"
            value={rule.operator}
            onValueChange={(operator) =>
              onChange({ ...rule, operator: operator as FilterOperator, value: coerceValue(column, operator as FilterOperator, rule.value) })
            }
            options={operatorsFor(column)}
          />
          <ValueEditor rule={rule} column={column} users={users} onChange={(value) => onChange({ ...rule, value })} />
        </>
      ) : null}
      <IconButton label="Remove rule" size="sm" icon={<X aria-hidden />} onClick={onRemove} />
    </li>
  );
}
