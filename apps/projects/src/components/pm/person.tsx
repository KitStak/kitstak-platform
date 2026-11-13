'use client';
import { UserRound } from 'lucide-react';
import { Avatar, type AvatarSize } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { usePeopleMap } from '@/lib/hooks/use-people';

/** Avatar for a user id (resolves name/photo from the org people cache). Unassigned shows a dashed ring. */
export function PersonAvatar({
  userId,
  size = 'sm',
  showName = false,
  className,
}: {
  readonly userId: string | null | undefined;
  readonly size?: AvatarSize;
  readonly showName?: boolean;
  readonly className?: string;
}) {
  const people = usePeopleMap();
  const person = userId ? people.get(userId) : undefined;
  if (!userId || !person) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-fg-muted', className)} title="Unassigned">
        <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-border-strong">
          <UserRound className="size-3" />
        </span>
        {showName ? <span className="text-sm">{userId ? 'Former member' : 'Unassigned'}</span> : <span className="sr-only">Unassigned</span>}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar name={person.name} src={person.image} size={size} showTooltip={!showName} />
      {showName ? <span className="truncate text-sm text-fg">{person.name}</span> : null}
    </span>
  );
}
