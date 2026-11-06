'use client';
import Link from 'next/link';
import {
  BookOpen,
  Bell,
  CircleHelp,
  Inbox,
  Keyboard,
  LifeBuoy,
  Menu,
  MessageSquareText,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import {
  CountBadge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Tooltip,
  useModKey,
} from '@/components/ui';
import { useMe } from './api';
import { Logo } from './logo';
import { useCan, useOrg } from './org-context';
import { routes } from './routes';
import { useShellStore } from './store';
import { UserMenu } from './user-menu';
import { NotificationsRealtime } from '@/features/notifications';

function HelpMenu() {
  const openPanel = useShellStore((state) => state.openPanel);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Help" icon={<CircleHelp aria-hidden />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          icon={<Keyboard aria-hidden />}
          shortcut="?"
          onSelect={() => openPanel('shortcuts')}
        >
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<BookOpen aria-hidden />}
          onSelect={() => window.open('/docs', '_blank', 'noopener')}
          description="Guides for boards, automations and CRM"
        >
          Help center
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Sparkles aria-hidden />}
          onSelect={() => window.open('/docs/whats-new', '_blank', 'noopener')}
        >
          What&apos;s new
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<LifeBuoy aria-hidden />}
          onSelect={() => window.open('mailto:support@kitstak.com?subject=KitStak%20CRM%20support', '_self')}
        >
          Contact support
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<MessageSquareText aria-hidden />}
          onSelect={() =>
            window.open('mailto:feedback@kitstak.com?subject=KitStak%20CRM%20feedback', '_self')
          }
        >
          Give feedback
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Slim top bar: brand, global search trigger, activity icons, invite, help and account. */
export function TopBar() {
  const { org } = useOrg();
  const me = useMe(org.id);
  const panel = useShellStore((state) => state.panel);
  const openPanel = useShellStore((state) => state.openPanel);
  const closePanel = useShellStore((state) => state.closePanel);
  const canInvite = useCan('member:invite');
  const unread = me.data?.unreadNotifications ?? 0;
  const mod = useModKey();
  const setMobileNavOpen = useShellStore((state) => state.setMobileNavOpen);

  const togglePanel = (target: 'notifications' | 'search') =>
    panel === target ? closePanel() : openPanel(target);

  return (
    <header role="banner" className="flex h-[var(--topbar-height)] shrink-0 items-center gap-1.5 px-2 sm:gap-3 sm:px-3">
      <IconButton
        label="Open navigation"
        icon={<Menu aria-hidden />}
        className="md:hidden"
        onClick={() => setMobileNavOpen(true)}
      />
      <Link
        href={routes.home(org.slug)}
        className="flex h-9 items-center rounded-md px-1.5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Logo size={26} />
        <span className="sr-only"> – home</span>
      </Link>

      <div className="flex min-w-0 flex-1 justify-end sm:justify-center sm:px-4">
        <IconButton
          label="Search everything"
          icon={<Search aria-hidden />}
          className="sm:hidden"
          data-search-trigger=""
          onClick={() => togglePanel('search')}
        />
        <button
          type="button"
          onClick={() => togglePanel('search')}
          data-search-trigger=""
          data-testid="topbar-search"
          aria-keyshortcuts="Control+K Meta+K"
          className="group hidden h-9 w-full max-w-[520px] items-center sm:flex gap-2 rounded-lg border border-border-default bg-panel px-3 text-left text-base text-fg-placeholder shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Search aria-hidden className="size-4 text-icon" />
          <span className="flex-1 truncate">Search boards, items and people</span>
          <span className="hidden items-center gap-0.5 lg:inline-flex">
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <nav aria-label="Quick actions" className="flex shrink-0 items-center gap-1">
        <NotificationsRealtime />
        <IconButton
          label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
          icon={<Bell aria-hidden />}
          active={panel === 'notifications'}
          aria-expanded={panel === 'notifications'}
          aria-haspopup="dialog"
          data-notifications-trigger=""
          data-testid="notifications-bell"
          onClick={() => togglePanel('notifications')}
          badge={<CountBadge count={unread} />}
        />
        <Tooltip content="Inbox">
          <Link
            href={routes.inbox(org.slug)}
            aria-label="Inbox"
            className="hidden size-8 items-center justify-center rounded-sm text-icon sm:inline-flex transition-colors hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-[18px]"
          >
            <Inbox aria-hidden />
          </Link>
        </Tooltip>
        {canInvite ? (
          <IconButton
            label="Invite members"
            icon={<UserPlus aria-hidden />}
            className="hidden sm:inline-flex"
            onClick={() => openPanel('invite')}
          />
        ) : null}
        <span className="hidden sm:contents">
          <HelpMenu />
        </span>
        <span aria-hidden className="mx-1.5 hidden h-6 w-px bg-border-default sm:block" />
        <UserMenu />
      </nav>
    </header>
  );
}
