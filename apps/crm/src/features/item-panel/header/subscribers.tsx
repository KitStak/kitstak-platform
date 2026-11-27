'use client';

/**
 * Subscribers stack + invite popover. Subscribers get notified about new updates; anyone can
 * follow / unfollow themselves, editors can add or remove teammates.
 */
import { useMemo, useState } from 'react';
import { Bell, BellOff, Check, UserPlus } from 'lucide-react';
import {
  Avatar,
  Tooltip,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  cn,
} from '@/components/ui';
import type { UserSummaryDto } from '@/server/services/contracts/dto';
import { rankMentionCandidates } from '../lib/mentions';
import { useChangeSubscribers, useItemSubscribers } from '../hooks/use-panel-queries';

/** Visible avatars before the "+N" chip (keeps the breadcrumb readable at the default width). */
const MAX_VISIBLE = 3;
/** 2px ring in the panel surface colour separates overlapping avatars (BT-004). */
/** Overlap kept to 2px (about 10% of the 24px tile, like cells/parts/avatar-stack) so both initials stay whole. */
const OVERLAP = 2;
const RING = { boxShadow: '0 0 0 2px var(--surface-raised)' } as const;

/** Overflow chip: "+N" with every hidden name in its tooltip. */
function MoreChip({ people, className }: { readonly people: readonly UserSummaryDto[]; readonly className?: string }) {
  const names = people.map((person) => person.name).join(', ');
  return (
    <Tooltip content={names} side="bottom">
      <span
        tabIndex={0}
        aria-label={`${people.length} more: ${names}`}
        className={cn(
          'relative items-center justify-center rounded-full bg-muted text-2xs font-semibold text-fg-secondary tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          'size-6',
          className,
        )}
        style={{ ...RING, zIndex: MAX_VISIBLE + 1, marginLeft: OVERLAP }}
      >
        +{people.length}
      </span>
    </Tooltip>
  );
}

/**
 * Overlapping avatars. On a wide panel up to three show before "+N"; at the default panel width
 * the stack collapses to one avatar and "+N" sooner, so the breadcrumb and the close button
 * always keep their room.
 */
function SubscriberStack({ people }: { readonly people: readonly UserSummaryDto[] }) {
  const visible = people.slice(0, MAX_VISIBLE);
  const hidden = people.slice(MAX_VISIBLE);
  const narrowHidden = people.slice(1);
  return (
    <div role="group" aria-label={`${people.length} subscribers`} className="isolate hidden shrink-0 items-center pl-0.5 @min-[480px]:flex">
      {visible.map((person, index) => (
        <span
          key={person.id}
          className={cn('relative rounded-full', index === 0 ? 'inline-flex' : 'hidden @min-[760px]:inline-flex')}
          style={{ ...RING, zIndex: index + 1, marginLeft: index === 0 ? 0 : -OVERLAP }}
        >
          <Avatar name={person.name} src={person.image} colorKey={person.id} size="sm" showTooltip />
        </span>
      ))}
      {narrowHidden.length > 0 ? <MoreChip people={narrowHidden} className="inline-flex @min-[760px]:hidden" /> : null}
      {hidden.length > 0 ? <MoreChip people={hidden} className="hidden @min-[760px]:inline-flex" /> : null}
    </div>
  );
}

export function Subscribers({
  itemId,
  users,
  me,
  canEdit,
  term,
}: {
  readonly itemId: string;
  readonly users: readonly UserSummaryDto[];
  readonly me: UserSummaryDto | null;
  readonly canEdit: boolean;
  readonly term: string;
}) {
  const query = useItemSubscribers(itemId);
  const change = useChangeSubscribers(itemId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ids = useMemo(() => new Set(query.data?.userIds ?? []), [query.data?.userIds]);
  const byId = useMemo(() => {
    const map = new Map(users.map((user) => [user.id, user]));
    for (const user of query.data?.users ?? []) map.set(user.id, user);
    return map;
  }, [query.data?.users, users]);
  const people = [...ids].map((id) => byId.get(id)).filter((user): user is UserSummaryDto => Boolean(user));
  const subscribed = me ? ids.has(me.id) : false;
  const candidates = rankMentionCandidates(users, search, 50);

  const toggle = (user: UserSummaryDto) => {
    if (ids.has(user.id)) change.mutate({ remove: [user.id] });
    else change.mutate({ add: [user.id] });
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5" data-testid="item-subscribers">
      {/* No placeholder while loading: the stack is a nice-to-have next to Invite, and a grey pill
          that waits on a slow or remounted query reads as broken. It appears when it arrives. */}
      {people.length > 0 ? <SubscriberStack people={people} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" leadingIcon={<UserPlus aria-hidden />} aria-label={`Subscribers: ${people.length}. Invite`}>
            <span className="hidden @min-[760px]:inline">Invite</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-[300px] flex-col gap-2 p-2" aria-label="Subscribers">
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <div>
              <p className="text-sm font-semibold text-fg">Subscribers</p>
              <p className="text-xs text-fg-muted">Notified about updates on this {term.toLowerCase()}</p>
            </div>
          </div>
          {me ? (
            <Button
              variant={subscribed ? 'secondary' : 'primary'}
              size="sm"
              fullWidth
              loading={change.isPending && change.variables?.add?.[0] === me.id}
              leadingIcon={subscribed ? <BellOff aria-hidden /> : <Bell aria-hidden />}
              onClick={() => (subscribed ? change.mutate({ remove: [me.id] }) : change.mutate({ add: [me.id] }))}
            >
              {subscribed ? 'Unsubscribe me' : 'Subscribe me'}
            </Button>
          ) : null}
          {canEdit ? (
            <>
              <SearchInput value={search} onValueChange={setSearch} placeholder="Add teammates" size="sm" autoFocus aria-label="Search teammates" />
              <ul role="listbox" aria-label="Teammates" aria-multiselectable="true" className="max-h-64 overflow-y-auto">
                {candidates.length === 0 ? <li className="px-2 py-3 text-sm text-fg-muted">No teammates match</li> : null}
                {candidates.map((user) => {
                  const on = ids.has(user.id);
                  return (
                    <li key={user.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => toggle(user)}
                        className={cn('ks-menu-item w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus')}
                      >
                        <Avatar name={user.name} src={user.image} colorKey={user.id} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{user.id === me?.id ? `${user.name} (you)` : user.name}</span>
                          {user.title ? <span className="truncate text-xs text-fg-muted">{user.title}</span> : null}
                        </span>
                        {on ? <Check aria-hidden className="size-4 text-primary-text" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
