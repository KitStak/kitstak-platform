'use client';
import type { ReactNode } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from './cn';
import { Tooltip } from './tooltip';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Readonly<Record<AvatarSize, string>> = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-2xs',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-16 text-xl',
};

export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

const PRESENCE: Readonly<Record<PresenceStatus, string>> = {
  online: 'bg-success',
  away: 'bg-warning-accent',
  busy: 'bg-danger',
  offline: 'bg-[var(--neutral-400)]',
};

/** Up to two initials from a display name or email. */
export function initialsFor(name: string): string {
  const clean = name.trim().replace(/@.*$/, '');
  if (!clean) return '?';
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return `${first}${last}`.toUpperCase();
}

export interface AvatarProps {
  readonly name: string;
  readonly src?: string | null;
  readonly size?: AvatarSize;
  /** Square tile (teams, workspaces) instead of a circle. */
  readonly shape?: 'circle' | 'square';
  readonly presence?: PresenceStatus;
  /** @deprecated Avatars are neutral now; kept so existing call sites compile. */
  readonly colorKey?: string;
  readonly showTooltip?: boolean;
  readonly className?: string;
  /** Cap the initials (1 for very small, overlapping stacks). Default 2. */
  readonly maxInitials?: 1 | 2;
  /** The name is already written next to it: hide the avatar from screen readers (no tooltip). */
  readonly decorative?: boolean;
}

export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'circle',
  presence,
  showTooltip = false,
  className,
  maxInitials = 2,
  decorative = false,
}: AvatarProps) {
  const avatar = (
    <span aria-hidden={decorative || undefined} className={cn('relative inline-flex shrink-0', className)}>
      <AvatarPrimitive.Root
        className={cn(
          // Neutral initials: people are told apart by their initials, not by a colour.
          'inline-flex items-center justify-center overflow-hidden bg-pressed font-medium text-fg-secondary select-none',
          shape === 'circle' ? 'rounded-full' : 'rounded-md',
          SIZE[size],
        )}
      >
        {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
        <AvatarPrimitive.Fallback delayMs={src ? 300 : 0} aria-hidden>
          {initialsFor(name).slice(0, maxInitials)}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {decorative ? null : <span className="sr-only">{name}</span>}
      {presence ? (
        <span
          aria-label={presence}
          className={cn(
            'absolute right-0 bottom-0 rounded-full ring-2 ring-[var(--surface-panel)]',
            size === 'xs' || size === 'sm' ? 'size-1.5' : 'size-2.5',
            PRESENCE[presence],
          )}
        />
      ) : null}
    </span>
  );
  return showTooltip && !decorative ? (
    <Tooltip content={name} side="top">
      <span tabIndex={0} className="inline-flex rounded-full">
        {avatar}
      </span>
    </Tooltip>
  ) : (
    avatar
  );
}

export interface AvatarGroupPerson {
  readonly id: string;
  readonly name: string;
  readonly src?: string | null;
}

export interface AvatarGroupProps {
  readonly people: readonly AvatarGroupPerson[];
  readonly max?: number;
  readonly size?: AvatarSize;
  readonly className?: string;
  /** Rendered for the overflow chip; defaults to "+N". */
  readonly renderOverflow?: (hidden: readonly AvatarGroupPerson[]) => ReactNode;
}

/** Overlapping stack of avatars with a "+N" overflow chip listing hidden names in a tooltip. */
export function AvatarGroup({ people, max = 4, size = 'sm', className, renderOverflow }: AvatarGroupProps) {
  const visible = people.slice(0, max);
  const hidden = people.slice(max);
  return (
    <div className={cn('flex items-center -space-x-1.5', className)} role="group" aria-label={people.length === 1 ? '1 person' : `${people.length} people`}>
      {visible.map((person) => (
        <span key={person.id} className="inline-flex rounded-full ring-2 ring-[var(--surface-panel)]">
          <Avatar name={person.name} src={person.src} colorKey={person.id} size={size} showTooltip />
        </span>
      ))}
      {hidden.length > 0 ? (
        <Tooltip content={hidden.map((person) => person.name).join(', ')} side="top">
          <span
            tabIndex={0}
            className={cn(
              'inline-flex items-center justify-center rounded-full bg-muted font-semibold text-fg-secondary ring-2 ring-[var(--surface-panel)]',
              SIZE[size],
            )}
          >
            {renderOverflow ? renderOverflow(hidden) : `+${hidden.length}`}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
