'use client';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Check, UserRound, Users, X } from 'lucide-react';
import { Avatar, Tooltip, cn, type AvatarSize } from '@/components/ui';
import { AvatarStack, StackAvatar } from '../parts/avatar-stack';
import type { TeamDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { readPeople } from '../lib/values';
import { EmptyGhost, EmptyListMessage } from '../parts/common';
import type { CellDensity } from '../types';

const AVATAR_SIZE: Readonly<Record<CellDensity, AvatarSize>> = { compact: 'xs', default: 'sm', comfortable: 'md' };
const MAX_VISIBLE = 2;

function TeamTile({ team, size }: { readonly team: TeamDto; readonly size: AvatarSize }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md bg-[var(--label-indigo-subtle)] text-[var(--label-indigo-text)]',
        size === 'xs' ? 'size-5' : size === 'md' ? 'size-8' : 'size-6',
      )}
    >
      <Users aria-hidden className="size-3.5" />
      <span className="sr-only">{team.name}</span>
    </span>
  );
}

function PeopleDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const { ids, teamIds } = readPeople(ctx.value);
  const people = ids.map((id) => ctx.usersById.get(id)).filter((user): user is UserSummaryDto => Boolean(user));
  const teams = teamIds
    .map((id) => ctx.services.teams?.find((team) => team.id === id))
    .filter((team): team is TeamDto => Boolean(team));
  const total = people.length + teams.length;
  if (total === 0) return ctx.readOnly ? null : <EmptyGhost icon={<UserRound aria-hidden />} label="Assign people" />;
  const size = AVATAR_SIZE[ctx.density];
  const visiblePeople = people.slice(0, total > MAX_VISIBLE + 1 ? MAX_VISIBLE : MAX_VISIBLE + 1);
  const visibleTeams = teams.slice(0, Math.max(0, (total > MAX_VISIBLE + 1 ? MAX_VISIBLE : MAX_VISIBLE + 1) - visiblePeople.length));
  const hiddenNames = [
    ...people.slice(visiblePeople.length).map((user) => user.name),
    ...teams.slice(visibleTeams.length).map((team) => team.name),
  ];
  const allNames = [...people.map((user) => user.name), ...teams.map((team) => team.name)].join(', ');
  return (
    <Tooltip content={allNames} side="top">
      <span className="flex flex-1 items-center justify-center" role="img" aria-label={allNames}>
        <AvatarStack
          size={size}
          overflow={hiddenNames.length}
          entries={[
            ...visiblePeople.map((user) => ({
              key: user.id,
              node: <StackAvatar name={user.name} src={user.image} colorKey={user.id} size={size} />,
            })),
            ...visibleTeams.map((team) => ({ key: team.id, square: true, node: <TeamTile team={team} size={size} /> })),
          ]}
        />
      </span>
    </Tooltip>
  );
}

interface Entry {
  readonly kind: 'user' | 'team';
  readonly id: string;
  readonly name: string;
  readonly subtitle: string | null;
  readonly image: string | null;
}

function PeopleEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const settings = ctx.column.settings as { allowMultiple?: boolean; allowTeams?: boolean };
  const allowMultiple = settings.allowMultiple !== false;
  const teams = useMemo(() => (settings.allowTeams || ctx.services.teams?.length ? (ctx.services.teams ?? []) : []), [ctx.services.teams, settings.allowTeams]);
  const [value, setValue] = useState(() => readPeople(ctx.value));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const entries = useMemo<Entry[]>(() => {
    const needle = query.trim().toLowerCase();
    const match = (...fields: (string | null)[]) => !needle || fields.some((field) => field?.toLowerCase().includes(needle));
    const users = ctx.users
      .filter((user) => match(user.name, user.email, user.title))
      .map((user): Entry => ({ kind: 'user', id: user.id, name: user.name, subtitle: user.title ?? user.email, image: user.image }));
    const teamEntries = teams
      .filter((team) => match(team.name))
      .map((team): Entry => ({ kind: 'team', id: team.id, name: team.name, subtitle: `${team.memberIds.length} members`, image: null }));
    return [...users, ...teamEntries];
  }, [ctx.users, query, teams]);

  const isSelected = (entry: Entry) => (entry.kind === 'user' ? value.ids : value.teamIds).includes(entry.id);

  const write = (next: { ids: string[]; teamIds: string[] }) => {
    setValue(next);
    const empty = next.ids.length + next.teamIds.length === 0;
    ctx.commit(empty ? null : next.teamIds.length ? next : { ids: next.ids });
  };

  const toggle = (entry: Entry) => {
    const key = entry.kind === 'user' ? 'ids' : 'teamIds';
    const list = value[key];
    if (!allowMultiple) {
      write({ ids: entry.kind === 'user' && !list.includes(entry.id) ? [entry.id] : [], teamIds: entry.kind === 'team' && !list.includes(entry.id) ? [entry.id] : [] });
      ctx.endEdit();
      return;
    }
    write({ ...value, [key]: list.includes(entry.id) ? list.filter((id) => id !== entry.id) : [...list, entry.id] });
    setQuery('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + delta + entries.length) % Math.max(1, entries.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[Math.min(active, entries.length - 1)];
      if (entry) toggle(entry);
    } else if (event.key === 'Backspace' && !query) {
      if (value.teamIds.length) write({ ...value, teamIds: value.teamIds.slice(0, -1) });
      else if (value.ids.length) write({ ...value, ids: value.ids.slice(0, -1) });
    }
  };

  const chips = [
    ...value.ids.map((id) => ({ kind: 'user' as const, id, name: ctx.usersById.get(id)?.name ?? 'Former member', image: ctx.usersById.get(id)?.image ?? null })),
    ...value.teamIds.map((id) => ({ kind: 'team' as const, id, name: teams.find((team) => team.id === id)?.name ?? 'Team', image: null })),
  ];
  const activeIndex = Math.min(active, Math.max(0, entries.length - 1));

  return (
    <div className="flex w-[280px] flex-col gap-2" data-testid="people-picker">
      {chips.length ? (
        <ul className="flex flex-wrap gap-1" aria-label="Assigned">
          {chips.map((chip) => (
            <li key={`${chip.kind}-${chip.id}`} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-muted pr-1 pl-0.5 text-sm text-fg">
              {chip.kind === 'user' ? <Avatar name={chip.name} src={chip.image} colorKey={chip.id} size="xs" /> : <Users aria-hidden className="ml-1 size-3.5 text-icon" />}
              <span className="max-w-[160px] truncate">{chip.name}</span>
              <button
                type="button"
                aria-label={`Remove ${chip.name}`}
                onClick={() => write(chip.kind === 'user' ? { ...value, ids: value.ids.filter((id) => id !== chip.id) } : { ...value, teamIds: value.teamIds.filter((id) => id !== chip.id) })}
                className="inline-flex size-5 items-center justify-center rounded-full text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={teams.length ? 'Search names, roles or teams' : 'Search names or roles'}
        aria-label="Search people"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={entries.length ? `${listId}-${activeIndex}` : undefined}
        className="h-8 w-full rounded-sm border border-border-input bg-panel px-2.5 text-base text-fg outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-input-hover focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]"
      />
      <div className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{query ? 'Results' : 'Suggested people'}</div>
      <ul id={listId} role="listbox" aria-multiselectable={allowMultiple} aria-label="People" className="-mx-1 flex max-h-64 flex-col overflow-y-auto">
        {entries.length === 0 ? <EmptyListMessage>No one matches “{query}”</EmptyListMessage> : null}
        {entries.map((entry, index) => (
          <li
            key={`${entry.kind}-${entry.id}`}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={isSelected(entry)}
            data-active={index === activeIndex}
            onPointerMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggle(entry)}
            className="ks-menu-item mx-1 min-h-11 py-1.5 not-data-[active=true]:bg-transparent data-[active=true]:bg-hover"
          >
            {entry.kind === 'user' ? (
              <Avatar name={entry.name} src={entry.image} colorKey={entry.id} size="sm" />
            ) : (
              <span className="inline-flex size-6 items-center justify-center rounded-md bg-[var(--label-indigo-subtle)] text-[var(--label-indigo-text)]">
                <Users aria-hidden className="size-3.5" />
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{entry.name}</span>
              {entry.subtitle ? <span className="truncate text-xs text-fg-muted">{entry.subtitle}</span> : null}
            </span>
            {isSelected(entry) ? <Check aria-hidden className="!size-4 !text-primary-text" /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const peopleRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, width: 280, popup: 'dialog' },
  Display: PeopleDisplay,
  Editor: PeopleEditor,
};
