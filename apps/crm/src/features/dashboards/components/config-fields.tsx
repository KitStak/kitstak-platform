'use client';

/** Small labelled controls used by the widget configuration form. */
import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import {
  Combobox,
  Field,
  Input,
  SearchInput,
  Select,
  Switch,
  cn,
  type ComboboxOption,
  type SelectOption,
} from '@/components/ui';
import type { ColumnDto } from '@/server/services/contracts/dto';
import type { DashboardSourceBoard } from '@/server/services/contracts/dashboard-insights';
import { EntityIcon } from '@/features/shell/entity-icon';
import { useWorkspaces } from '@/lib/hooks';

export const NONE = '__none__';

export function FormSection({ title, children, aside }: { readonly title: string; readonly children: ReactNode; readonly aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border-subtle px-5 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-muted ">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
  hint,
  allowNone,
  noneLabel = 'None',
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string | undefined) => void;
  readonly placeholder?: string;
  readonly hint?: ReactNode;
  readonly allowNone?: boolean;
  readonly noneLabel?: string;
}) {
  const all = allowNone ? [{ value: NONE, label: noneLabel }, ...options] : options;
  return (
    <Field label={label} hint={hint}>
      {({ inputId, describedBy }) => (
        <Select
          id={inputId}
          aria-describedby={describedBy}
          value={value ?? (allowNone ? NONE : undefined)}
          onValueChange={(next) => onChange(next === NONE ? undefined : next)}
          options={all}
          placeholder={placeholder ?? 'Choose…'}
          size="md"
        />
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  min,
  max,
  hint,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
  readonly placeholder?: string;
  readonly min?: number;
  readonly max?: number;
  readonly hint?: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      {({ inputId, describedBy }) => (
        <Input
          id={inputId}
          aria-describedby={describedBy}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(event.target.value === '' || !Number.isFinite(parsed) ? undefined : parsed);
          }}
        />
      )}
    </Field>
  );
}

/** Parses "$30,000,000", "30m", "1.5k" or "30000000" into a number (undefined when empty/invalid). */
export function parseFormattedNumber(text: string): number | undefined {
  const cleaned = text.replace(/[\s,$€£%]/g, '').toLowerCase();
  if (cleaned === '') return undefined;
  const match = /^(-?\d*\.?\d+)([kmb])?$/.exec(cleaned);
  if (!match) return undefined;
  const scale = match[2] === 'k' ? 1e3 : match[2] === 'm' ? 1e6 : match[2] === 'b' ? 1e9 : 1;
  const value = Number(match[1]) * scale;
  return Number.isFinite(value) ? value : undefined;
}

export function formatGrouped(value: number | undefined, prefix?: string, suffix?: string): string {
  if (value === undefined) return '';
  return `${prefix ?? ''}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix ?? ''}`;
}

/** Number input shown grouped with its unit ("$30,000,000"); typed freely, parsed on blur / Enter. */
export function FormattedNumberField({
  label,
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
  hint,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
  readonly placeholder?: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly hint?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = (text: string) => {
    const parsed = parseFormattedNumber(text);
    if (text.trim() !== '' && parsed === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(null);
    if (parsed !== value) onChange(parsed);
  };
  return (
    <Field label={label} hint={invalid ? 'Enter a number such as 30,000,000 or 30M.' : (hint ?? 'Accepts 30,000,000, 30M or 1.5k.')}>
      {({ inputId, describedBy }) => (
        <Input
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          inputMode="decimal"
          value={draft ?? formatGrouped(value, prefix, suffix)}
          placeholder={placeholder}
          onFocus={() => setDraft(value === undefined ? '' : String(value))}
          onChange={(event) => {
            setDraft(event.target.value);
            if (invalid) setInvalid(false);
          }}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(event.currentTarget.value);
          }}
        />
      )}
    </Field>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly maxLength?: number;
}) {
  return (
    <Field label={label}>
      {({ inputId }) => (
        <Input id={inputId} value={value ?? ''} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}

export function ToggleField({ label, description, checked, onChange }: { readonly label: string; readonly description?: string; readonly checked: boolean; readonly onChange: (value: boolean) => void }) {
  return <Switch label={label} description={description} checked={checked} onCheckedChange={(value) => onChange(value === true)} size="sm" />;
}

export function MultiColumnField({
  label,
  columns,
  value,
  onChange,
}: {
  readonly label: string;
  readonly columns: readonly ColumnDto[];
  readonly value: readonly string[];
  readonly onChange: (value: string[]) => void;
}) {
  const options: ComboboxOption[] = columns.map((column) => ({ value: column.key, label: column.title, description: column.type.replace('_', ' ') }));
  return (
    <Field label={label}>
      {({ inputId }) => (
        <Combobox id={inputId} multiple options={options} value={value} onValueChange={onChange} placeholder="Choose columns" searchPlaceholder="Search columns" />
      )}
    </Field>
  );
}

/** Board checklist with connected boards first. */
/** Boards grouped by workspace; a search box appears once the list is long. */
const BOARD_SEARCH_FROM = 8;

export function BoardChecklist({
  boards,
  selected,
  onChange,
  highlight,
}: {
  readonly boards: readonly DashboardSourceBoard[];
  readonly selected: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly highlight?: readonly string[];
}) {
  const workspaces = useWorkspaces();
  const [query, setQuery] = useState('');
  const workspaceName = (id: string) => workspaces.data?.find((workspace) => workspace.id === id)?.name ?? 'Workspace';
  const q = query.trim().toLowerCase();
  const matches = boards.filter((board) => !q || `${board.name} ${workspaceName(board.workspaceId)}`.toLowerCase().includes(q));
  const ordered = [...matches].sort(
    (a, b) =>
      Number(highlight?.includes(b.id) ?? false) - Number(highlight?.includes(a.id) ?? false) ||
      workspaceName(a.workspaceId).localeCompare(workspaceName(b.workspaceId)) ||
      a.name.localeCompare(b.name),
  );
  const groups = ordered.reduce<{ key: string; label: string; boards: DashboardSourceBoard[] }[]>((acc, board) => {
    const connected = highlight?.includes(board.id) ?? false;
    const key = connected ? 'connected' : board.workspaceId;
    const existing = acc.find((group) => group.key === key);
    if (existing) {
      existing.boards.push(board);
      return acc;
    }
    return [...acc, { key, label: connected ? 'Connected to this dashboard' : workspaceName(board.workspaceId), boards: [board] }];
  }, []);
  const nameCount = new Map<string, number>();
  for (const board of boards) nameCount.set(`${board.workspaceId}:${board.name}`, (nameCount.get(`${board.workspaceId}:${board.name}`) ?? 0) + 1);
  return (
    <div className="flex flex-col gap-2">
      {boards.length > BOARD_SEARCH_FROM ? (
        <SearchInput value={query} onValueChange={setQuery} placeholder="Search boards" aria-label="Search boards" size="sm" />
      ) : null}
      <div className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-border-subtle p-1" role="group" aria-label="Boards">
        {groups.length === 0 ? <p className="px-2 py-3 text-sm text-fg-muted">No boards match “{query}”.</p> : null}
        {groups.map((group) => (
          <div key={group.key} role="group" aria-label={group.label}>
            <p className="sticky top-0 z-[1] bg-panel px-2 pt-2 pb-1 text-2xs font-semibold text-fg-muted ">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.boards.map((board) => {
                const checked = selected.includes(board.id);
                const duplicate = (nameCount.get(`${board.workspaceId}:${board.name}`) ?? 0) > 1;
                return (
                  <li key={board.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => onChange(checked ? selected.filter((id) => id !== board.id) : [...selected, board.id])}
                      className={cn(
                        'flex h-9 w-full items-center gap-2.5 rounded-sm px-2 text-left text-base text-fg outline-none transition-colors duration-[var(--duration-instant)]',
                        'hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus active:bg-pressed',
                        checked && 'bg-primary-subtle',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors duration-[var(--duration-instant)] [&_svg]:size-3',
                          checked ? 'border-primary bg-primary text-primary-fg' : 'border-border-input bg-panel',
                        )}
                      >
                        {checked ? <Check strokeWidth={3} /> : null}
                      </span>
                      <EntityIcon type="board" boardKind={board.kind as never} />
                      <span className="min-w-0 flex-1 truncate">{board.name}</span>
                      <span className="max-w-[45%] shrink-0 truncate text-xs text-fg-muted">
                        {group.key === 'connected' ? workspaceName(board.workspaceId) : ''}
                        {duplicate ? `${group.key === 'connected' ? ' · ' : ''}#${board.id.slice(0, 4)}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
