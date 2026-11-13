'use client';
import { UserRound } from 'lucide-react';
import { Avatar, type AvatarSize } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { usePeople } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';

/** Avatar for a user id (resolves name/photo from the org people cache). Unassigned shows a dashed ring. */
export function PersonAvatar({
  userId,
  size = 'sm',
  showName = false,
  decorative = false,
  className,
}: {
  readonly userId: string | null | undefined;
  readonly size?: AvatarSize;
  readonly showName?: boolean;
  /** The name is written right next to it (comment header, time entry): screen readers skip the avatar. */
  readonly decorative?: boolean;
  readonly className?: string;
}) {
  const people = usePeopleMap();
  const loaded = usePeople().data !== undefined;
  const person = userId ? people.get(userId) : undefined;
  // Still loading the org's people: a neutral placeholder, never "Former member".
  if (userId && !person && !loaded) {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} aria-busy="true" data-testid="person-pending">
        <span aria-hidden className="inline-block size-5 shrink-0 animate-pulse rounded-full bg-sunken motion-reduce:animate-none" />
        {showName ? <span aria-hidden className="inline-block h-2.5 w-20 animate-pulse rounded-full bg-sunken motion-reduce:animate-none" /> : null}
      </span>
    );
  }
  if (!userId || !person) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-fg-muted', className)} title="Unassigned">
        <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-border-strong">
          <UserRound className="size-3" />
        </span>
        {showName ? <span className="text-sm">{userId ? 'Former member' : 'Unassigned'}</span> : decorative ? null : <span className="sr-only">Unassigned</span>}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar name={person.name} src={person.image} size={size} showTooltip={!showName && !decorative} decorative={showName || decorative} />
      {showName ? <span className="truncate text-sm text-fg">{person.name}</span> : null}
    </span>
  );
}
