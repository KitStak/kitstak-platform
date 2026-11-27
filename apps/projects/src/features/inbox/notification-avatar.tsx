'use client';
/** Who (or what) a notification came from: a person with a kind badge, or a kind glyph for reminders. */
import {
  AlarmClock,
  AtSign,
  Bell,
  CalendarClock,
  CircleDot,
  Eye,
  FolderKanban,
  Link2,
  MessageSquare,
  Repeat,
  UserPlus,
  Workflow,
} from 'lucide-react';
import { cn } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import type { NotificationKind } from '@/lib/constants';
import type { NotificationDTO } from '@/lib/types';

export const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  mention: AtSign,
  assigned: UserPlus,
  comment: MessageSquare,
  status_changed: CircleDot,
  due_soon: CalendarClock,
  overdue: AlarmClock,
  watching: Eye,
  automation: Workflow,
  integration: Link2,
  project: FolderKanban,
  program: Repeat,
};

/**
 * Text color for a kind's glyph and word. Everything is neutral ink except overdue, the one kind
 * that means something is late (docs/design/UI-CLEANUP.md: no crimson on data, no tinted circles).
 */
export const KIND_TONE: Partial<Record<NotificationKind, string>> = {
  overdue: 'text-danger-text',
};

/** Who (or what) the notification came from: the person with a kind badge, or a kind glyph for reminders. */
export function NotificationAvatar({ item, size = 'md' }: { readonly item: NotificationDTO; readonly size?: 'sm' | 'md' }) {
  const Icon = KIND_ICON[item.kind] ?? Bell;
  if (!item.actorId) {
    return (
      <span className={cn('mt-0.5 flex shrink-0 items-center justify-center rounded-full bg-sunken', size === 'md' ? 'size-8' : 'size-6')}>
        <Icon aria-hidden className={cn(size === 'md' ? 'size-4' : 'size-3.5', KIND_TONE[item.kind] ?? 'text-icon')} />
      </span>
    );
  }
  return (
    <span className="relative mt-0.5 shrink-0">
      <PersonAvatar userId={item.actorId} size={size} />
      {/* Small kind badge tucked outside the corner so the initials stay readable. */}
      <span className={cn('absolute flex items-center justify-center rounded-full bg-panel ring-1 ring-border-subtle', size === 'md' ? '-right-1.5 -bottom-1.5 size-4' : '-right-1.5 -bottom-1.5 size-3.5')}>
        <Icon aria-hidden className={cn(size === 'md' ? 'size-2.5' : 'size-2', KIND_TONE[item.kind] ?? 'text-icon')} />
      </span>
    </span>
  );
}

