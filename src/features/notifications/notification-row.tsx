'use client';
/** One notification row: avatar/system icon, rich sentence, breadcrumb, time, hover actions. */
import Link from 'next/link';
import { memo, type ComponentType, type SVGProps } from 'react';
import {
  AtSign,
  BellOff,
  CalendarClock,
  ChevronDown,
  Check,
  CircleDot,
  ExternalLink,
  LayoutGrid,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PanelRightOpen,
  Reply,
  Share2,
  SmilePlus,
  Trash2,
  Undo2,
  UserPlus,
  Zap,
} from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  cn,
} from '@/components/ui';
import type { NotificationDto, NotificationKind } from '@/server/services/contracts/dto';
import { describeNotification, formatFullTime, formatShortTime } from './describe';
import { useMenuTooltip } from './menu-tooltip';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const KIND_BADGE: Readonly<Record<NotificationKind, { icon: Icon; tone: string; label: string }>> = {
  mention: { icon: AtSign, tone: 'bg-primary text-primary-fg', label: 'Mention' },
  assigned: { icon: UserPlus, tone: 'bg-success text-white', label: 'Assignment' },
  update_reply: { icon: Reply, tone: 'bg-[var(--label-indigo)] text-white', label: 'Reply' },
  update_on_subscribed: { icon: MessageSquare, tone: 'bg-[var(--label-teal)] text-white', label: 'Update' },
  status_change: { icon: CircleDot, tone: 'bg-[var(--label-orange)] text-white', label: 'Status change' },
  due_date: { icon: CalendarClock, tone: 'bg-[var(--label-orange)] text-white', label: 'Reminder' },
  invitation: { icon: Mail, tone: 'bg-primary text-primary-fg', label: 'Invitation' },
  automation: { icon: Zap, tone: 'bg-[var(--label-purple)] text-white', label: 'Automation' },
  reaction: { icon: SmilePlus, tone: 'bg-[var(--label-pink)] text-white', label: 'Reaction' },
  board_shared: { icon: Share2, tone: 'bg-[var(--label-dark-blue)] text-white', label: 'Board shared' },
};

function SystemAvatar({ kind }: { readonly kind: NotificationKind }) {
  const Glyph = kind === 'due_date' ? CalendarClock : Zap;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 items-center justify-center rounded-full',
        kind === 'due_date'
          ? 'bg-[var(--label-orange-subtle)] text-[var(--label-orange)]'
          : 'bg-[var(--label-purple-subtle)] text-[var(--label-purple)]',
      )}
    >
      <Glyph className="size-5" />
    </span>
  );
}

export interface NotificationRowProps {
  readonly entry: NotificationDto;
  readonly href: string | null;
  readonly now: Date;
  /** Newly arrived through realtime: plays a short highlight. */
  readonly fresh?: boolean;
  /** `navigate` is true when the caller must route (menu); link clicks route themselves. */
  readonly onOpen: (entry: NotificationDto, navigate?: boolean) => void;
  readonly onToggleRead: (entry: NotificationDto) => void;
  readonly onDelete: (entry: NotificationDto) => void;
  /** Turn off notifications for the entry's item. */
  readonly onMute?: (entry: NotificationDto) => void;
  /** Older identical system events folded under this row. */
  readonly similarCount?: number;
  readonly similarExpanded?: boolean;
  readonly onToggleSimilar?: (entry: NotificationDto) => void;
  /** Rendered inside an expanded "+N similar" run (indented, no own expander). */
  readonly nested?: boolean;
}

export const NotificationRow = memo(function NotificationRow({
  entry,
  href,
  now,
  fresh,
  onOpen,
  onToggleRead,
  onDelete,
  onMute,
  similarCount = 0,
  similarExpanded = false,
  onToggleSimilar,
  nested = false,
}: NotificationRowProps) {
  const menuTooltip = useMenuTooltip();
  const description = describeNotification(entry);
  const unread = !entry.readAt;
  const badge = KIND_BADGE[entry.kind];
  const BadgeIcon = badge.icon;
  const time = formatShortTime(entry.createdAt, now);
  const ariaLabel =
    `${unread ? 'Unread. ' : ''}${description.label}. ${entry.boardName ?? ''} ${time}`.trim();

  const body = (
    <>
      {unread ? (
        <span aria-hidden className="absolute top-[27px] left-2.5 size-2 rounded-full bg-primary" />
      ) : null}
      <span className="relative shrink-0">
        {description.system ? (
          <SystemAvatar kind={entry.kind} />
        ) : (
          <Avatar
            name={description.actorName}
            src={entry.actor?.image ?? null}
            size="lg"
            colorKey={entry.actor?.id}
          />
        )}
        {description.system ? null : (
          <span
            aria-hidden
            className={cn(
              'absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full ring-2 ring-[var(--surface-raised)]',
              badge.tone,
            )}
          >
            <BadgeIcon className="size-[11px]" strokeWidth={2.5} />
          </span>
        )}
      </span>
      {/* pr reserves room for the hover toolbar (2 x 28px + padding) so it never covers text. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1 pr-[72px]">
        <span className={cn('line-clamp-2 text-base text-fg', unread ? 'text-fg' : 'text-fg-secondary')}>
          {description.segments.map((segment, index) =>
            segment.strong ? (
              <strong key={index} className="font-semibold text-fg">
                {segment.text}
              </strong>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </span>
        {description.preview ? (
          <span className="line-clamp-2 border-l-2 border-border-default pl-2 text-sm text-fg-secondary">
            {description.preview}
          </span>
        ) : null}
        {entry.boardName ? (
          <span className="flex min-w-0 items-center gap-1 text-sm text-fg-muted">
            <LayoutGrid aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{entry.boardName}</span>
          </span>
        ) : null}
      </span>
    </>
  );

  const rowClass = cn(
    'relative flex w-full items-start gap-3 py-3 pr-4 text-left outline-none',
    nested ? 'pl-12' : 'pl-6',
    'transition-colors duration-[var(--duration-instant)] ease-out',
    'hover:bg-hover active:bg-pressed focus-visible:bg-hover focus-visible:shadow-[inset_0_0_0_2px_var(--focus-ring)]',
    // The unread tint lives on the <li> so a folded row's "+N similar" strip shares it.
    unread && 'hover:bg-[var(--primary-selected)] focus-visible:bg-[var(--primary-selected)]',
    fresh && 'animate-fade-in',
  );

  return (
    <li
      className={cn(
        'group/row relative',
        unread && 'bg-highlight',
        // Hairline between rows, inset to the text column so stacked unread tints stay distinct.
        'before:pointer-events-none before:absolute before:top-0 before:right-0 before:z-[1] before:h-px before:bg-border-subtle first:before:hidden',
        nested ? 'before:left-[100px]' : 'before:left-[76px]',
      )}
      data-testid="notification-row"
      data-notification-id={entry.id}
      data-unread={unread || undefined}
    >
      {href ? (
        <Link
          href={href}
          className={rowClass}
          aria-label={ariaLabel}
          data-notification-link
          onClick={() => onOpen(entry)}
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          className={rowClass}
          aria-label={ariaLabel}
          data-notification-link
          onClick={() => onOpen(entry)}
        >
          {body}
        </button>
      )}
      <Tooltip content={formatFullTime(entry.createdAt)}>
        <time
          dateTime={entry.createdAt}
          className={cn(
            'absolute top-3 right-4 text-xs text-fg-muted tabular-nums transition-opacity duration-[var(--duration-fast)]',
            'group-focus-within/row:opacity-0 group-hover/row:opacity-0',
            // Touch: the "..." trigger is always shown, so the time sits beside it and stays.
            '[@media(hover:none)]:pointer-events-none [@media(hover:none)]:right-10 [@media(hover:none)]:group-focus-within/row:opacity-100',
          )}
        >
          {time}
        </time>
      </Tooltip>
      {/*
        Row actions: not in the Tab order (roving: ArrowRight from the row, ArrowLeft back).
        Hidden ones take no clicks; on touch (no hover) a compact "..." trigger is always shown.
      */}
      <div
        data-row-actions
        className={cn(
          'pointer-events-none absolute top-2 right-2 z-[2] flex items-center gap-0.5 rounded-md bg-raised p-0.5 opacity-0 shadow-xs',
          'transition-opacity duration-[var(--duration-fast)]',
          'group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100',
          'group-hover/row:pointer-events-auto group-hover/row:opacity-100',
          'has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100',
          '[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:top-1.5 [@media(hover:none)]:right-1.5',
          '[@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100 [@media(hover:none)]:shadow-none',
        )}
      >
        <IconButton
          size="sm"
          tabIndex={-1}
          className="[@media(hover:none)]:hidden"
          label={unread ? 'Mark as read' : 'Mark as unread'}
          icon={unread ? <Check aria-hidden /> : <Undo2 aria-hidden />}
          onClick={() => onToggleRead(entry)}
          data-testid="notification-toggle-read"
        />
        <DropdownMenu {...menuTooltip.menuProps}>
          <Tooltip content="More actions" open={menuTooltip.open} onOpenChange={menuTooltip.onOpenChange}>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                tabIndex={-1}
                hideTooltip
                label="More actions"
                icon={<MoreHorizontal aria-hidden />}
                data-testid="notification-more"
                {...menuTooltip.triggerProps}
              />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            className="w-[300px] max-w-[calc(100vw-24px)]"
            onCloseAutoFocus={menuTooltip.onCloseAutoFocus}
          >
            {href ? (
              <>
                <DropdownMenuItem icon={<PanelRightOpen aria-hidden />} onSelect={() => onOpen(entry, true)}>
                  {entry.itemId ? 'Open item' : 'Open board'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<ExternalLink aria-hidden />}
                  onSelect={() => window.open(href, '_blank', 'noopener')}
                >
                  Open in new tab
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem
              icon={unread ? <Check aria-hidden /> : <Undo2 aria-hidden />}
              onSelect={() => onToggleRead(entry)}
            >
              {unread ? 'Mark as read' : 'Mark as unread'}
            </DropdownMenuItem>
            {entry.itemId && onMute ? (
              <DropdownMenuItem
                icon={<BellOff aria-hidden />}
                onSelect={() => onMute(entry)}
                data-testid="notification-mute"
              >
                Turn off notifications for this item
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="danger"
              icon={<Trash2 aria-hidden />}
              onSelect={() => {
                // The row is removed: the panel moves focus to its neighbour.
                menuTooltip.skipFocusRestore();
                onDelete(entry);
              }}
            >
              Delete notification
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {similarCount > 0 && onToggleSimilar ? (
        <button
          type="button"
          aria-expanded={similarExpanded}
          onClick={() => onToggleSimilar(entry)}
          data-testid="notification-similar"
          className={cn(
            'relative z-[2] -mt-1.5 mb-2 ml-[76px] inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium text-fg-secondary',
            'transition-colors duration-[var(--duration-instant)] ease-out hover:bg-hover hover:text-fg active:bg-pressed',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          )}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3.5 transition-transform duration-[var(--duration-fast)] ease-out',
              similarExpanded ? 'rotate-180' : '',
            )}
          />
          {similarExpanded ? 'Hide similar' : `+${similarCount} similar`}
        </button>
      ) : null}
    </li>
  );
});
