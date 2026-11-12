'use client';

/** Toolbar pickers: connected boards, person filter and date range. */
import { useMemo, useState } from 'react';
import { CalendarRange, Check, ChevronDown, LayoutGrid, UserRound, X } from 'lucide-react';
import {
  Avatar,
  AvatarGroup,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RangeCalendar,
  SearchInput,
  Switch,
  cn,
  type DateRange,
} from '@/components/ui';
import type { UserSummaryDto } from '@/server/services/contracts/dto';
import type { DashboardSourceBoard } from '@/server/services/contracts/dashboard-insights';
import { EntityIcon } from '@/features/shell/entity-icon';
import { RANGE_LABELS, RANGE_PRESETS, describeRange, type DashboardFilterState, type RangePreset } from '../lib/filters';

const chip = cn(
  'inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-base outline-none transition-colors duration-[var(--duration-instant)]',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-[0.38] [&_svg]:size-4',
);

function chipClass(active: boolean) {
  return cn(chip, active ? 'border-primary bg-primary-subtle text-primary-text hover:bg-primary-selected' : 'border-border-input bg-panel text-fg hover:bg-muted');
}

// ------------------------------------------------------------------------------------------------
// Boards
// ------------------------------------------------------------------------------------------------

export function BoardsPicker({
  boards,
  connected,
  canEdit,
  autoInclude,
  onChange,
  onAutoIncludeChange,
}: {
  readonly boards: readonly DashboardSourceBoard[];
  readonly connected: readonly string[];
  readonly canEdit: boolean;
  readonly autoInclude: boolean;
  readonly onChange: (ids: string[]) => void;
  readonly onAutoIncludeChange: (value: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const connectedBoards = boards.filter((board) => connected.includes(board.id));
  const others = boards.filter((board) => !connected.includes(board.id) && board.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={chipClass(false)} data-testid="boards-chip">
          <LayoutGrid aria-hidden />
          <span className="tabular-nums">{connected.length}</span>
          <span className="hidden sm:inline">{connected.length === 1 ? 'connected board' : 'connected boards'}</span>
          <ChevronDown aria-hidden className="text-icon" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-0" flush>
        <div className="border-b border-border-subtle p-3">
          <p className="text-sm font-semibold text-fg">Connected boards</p>
          <p className="text-xs text-fg-muted">Widgets read from these boards unless they pick their own.</p>
        </div>
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto p-1.5" aria-label="Connected boards">
          {connectedBoards.length === 0 ? <li className="px-2 py-2 text-sm text-fg-muted">No boards connected yet.</li> : null}
          {connectedBoards.map((board) => (
            <li key={board.id} className="flex h-8 items-center gap-2 rounded-sm px-2 hover:bg-hover">
              <EntityIcon type="board" boardKind={board.kind as never} />
              <span className="min-w-0 flex-1 truncate text-base text-fg">{board.name}</span>
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`Disconnect ${board.name}`}
                  onClick={() => onChange(connected.filter((id) => id !== board.id))}
                  className="flex size-6 items-center justify-center rounded-sm text-icon outline-none hover:bg-pressed hover:text-fg focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-3.5"
                >
                  <X aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <>
            <div className="border-t border-border-subtle p-2">
              <SearchInput value={query} onValueChange={setQuery} placeholder="Search boards to connect" aria-label="Search boards" size="sm" />
            </div>
            <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5" aria-label="Available boards">
              {others.length === 0 ? <li className="px-2 py-2 text-sm text-fg-muted">{query ? 'No boards match.' : 'Every board is connected.'}</li> : null}
              {others.map((board) => (
                <li key={board.id}>
                  <button
                    type="button"
                    onClick={() => onChange([...connected, board.id])}
                    className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-base text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                  >
                    <EntityIcon type="board" boardKind={board.kind as never} />
                    <span className="min-w-0 flex-1 truncate">{board.name}</span>
                    <span className="text-xs font-medium text-primary-text">Connect</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-border-subtle p-3">
              <Switch size="sm" label="Include new boards in existing widgets" checked={autoInclude} onCheckedChange={(value) => onAutoIncludeChange(value === true)} />
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------------------------------------
// People
// ------------------------------------------------------------------------------------------------

export function PersonFilter({ users, selected, onChange }: { readonly users: readonly UserSummaryDto[]; readonly selected: readonly string[]; readonly onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('');
  const chosen = users.filter((user) => selected.includes(user.id));
  const visible = users.filter((user) => user.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={chipClass(selected.length > 0)} data-testid="person-filter" aria-label={selected.length ? `Person filter: ${chosen.map((user) => user.name).join(', ')}` : 'Filter by person'}>
          {chosen.length > 0 ? (
            <AvatarGroup people={chosen.map((user) => ({ id: user.id, name: user.name, src: user.image }))} max={3} size="xs" />
          ) : (
            <UserRound aria-hidden />
          )}
          <span className="hidden md:inline">{chosen.length === 0 ? 'Person' : chosen.length === 1 ? chosen[0]?.name.split(' ')[0] : `${chosen.length} people`}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0" flush>
        <div className="p-2">
          <SearchInput value={query} onValueChange={setQuery} placeholder="Search people" aria-label="Search people" size="sm" autoFocus />
        </div>
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5" role="listbox" aria-multiselectable="true" aria-label="People">
          {visible.map((user) => {
            const active = selected.includes(user.id);
            return (
              <li key={user.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => onChange(active ? selected.filter((id) => id !== user.id) : [...selected, user.id])}
                  className={cn('flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-base outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus', active && 'bg-primary-subtle')}
                >
                  <Avatar name={user.name} src={user.image} size="sm" colorKey={user.id} />
                  <span className="min-w-0 flex-1 truncate text-fg">{user.name}</span>
                  {active ? <Check aria-hidden className="size-4 text-primary" /> : null}
                </button>
              </li>
            );
          })}
          {visible.length === 0 ? <li className="px-2 py-2 text-sm text-fg-muted">No people match.</li> : null}
        </ul>
        {selected.length > 0 ? (
          <div className="border-t border-border-subtle p-2">
            <Button variant="ghost" size="sm" fullWidth onClick={() => onChange([])}>
              Clear person filter
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------------------------------------
// Date range
// ------------------------------------------------------------------------------------------------

function isoOf(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10);
}

function localDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
}

export function DateRangeFilter({ state, onChange }: { readonly state: DashboardFilterState; readonly onChange: (next: Pick<DashboardFilterState, 'range' | 'from' | 'to'>) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(state.range === 'custom');
  const selected: DateRange | undefined = useMemo(
    () => (state.range === 'custom' ? { from: localDate(state.from), to: localDate(state.to) } : undefined),
    [state.range, state.from, state.to],
  );
  const presets = RANGE_PRESETS.filter((preset) => preset !== 'custom');
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setCustom(state.range === 'custom'); }}>
      <PopoverTrigger asChild>
        <button type="button" className={chipClass(state.range !== 'all')} data-testid="date-range-filter">
          <CalendarRange aria-hidden />
          <span className="max-w-[180px] truncate">{describeRange(state)}</span>
          <ChevronDown aria-hidden className="text-icon" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('p-0', custom ? 'w-auto' : 'w-[220px]')} flush>
        <div className="flex">
          <ul className="flex w-[220px] shrink-0 flex-col gap-0.5 p-1.5" role="listbox" aria-label="Date range">
            {presets.map((preset: RangePreset) => (
              <li key={preset} role="option" aria-selected={state.range === preset}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ range: preset });
                    setOpen(false);
                  }}
                  className={cn('flex h-8 w-full items-center justify-between rounded-sm px-2.5 text-left text-base outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus', state.range === preset && 'bg-primary-subtle font-medium text-primary-text')}
                >
                  {RANGE_LABELS[preset]}
                  {state.range === preset ? <Check aria-hidden className="size-4" /> : null}
                </button>
              </li>
            ))}
            <li role="option" aria-selected={state.range === 'custom'} className="mt-1 border-t border-border-subtle pt-1">
              <button
                type="button"
                onClick={() => setCustom(true)}
                className={cn('flex h-8 w-full items-center rounded-sm px-2.5 text-left text-base outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus', (custom || state.range === 'custom') && 'bg-primary-subtle font-medium text-primary-text')}
              >
                Custom range…
              </button>
            </li>
          </ul>
          {custom ? (
            <div className="border-l border-border-subtle p-2">
              <RangeCalendar
                selected={selected}
                numberOfMonths={1}
                onSelect={(range) => {
                  onChange({ range: 'custom', from: isoOf(range?.from), to: isoOf(range?.to ?? range?.from) });
                }}
              />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
