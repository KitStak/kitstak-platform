'use client';
import Link from 'next/link';
import {
  BookOpen,
  Bell,
  CircleHelp,
  Keyboard,
  LifeBuoy,
  Menu,
  MessageSquareText,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { AppSwitcher } from '@kitstak/ui/app-switcher';
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
import { TopNav } from './top-nav/top-nav';
import { UserMenu } from './user-menu';
import { NotificationsRealtime } from '@/features/notifications';

/** Cross-app origins for the shared AppSwitcher (BLUEPRINT.md §6); dev defaults match the three dev ports. */
const APP_URLS = {
  portal: process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300',
  crm: process.env.NEXT_PUBLIC_CRM_URL ?? 'http://localhost:3100',
  wms: process.env.NEXT_PUBLIC_WMS_URL ?? 'http://localhost:3000',
} as const;

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

/**
 * The 56px top bar, identical in structure to KitStak WMS: logo with product badge, primary
 * navigation, search with its shortcut hint, notifications, help and the account menu.
 */
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
    <header
      role="banner"
      data-testid="top-bar"
      className="relative z-[var(--z-header)] flex h-[var(--topbar-height)] shrink-0 items-center gap-1 border-b border-border-subtle bg-panel px-3 lg:px-4"
    >
      <IconButton
        label="Open navigation"
        icon={<Menu aria-hidden />}
        className="md:hidden"
        onClick={() => setMobileNavOpen(true)}
      />
      <Link
        href={routes.home(org.slug)}
        className="mr-1 flex h-9 shrink-0 items-center rounded-md px-1.5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus lg:mr-3"
      >
        <Logo size={22} />
        <span className="sr-only"> – home</span>
      </Link>

      <TopNav />

      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <Tooltip
          content={
            <span className="flex items-center gap-1.5">
              Search boards, items and people <Kbd>{mod}</Kbd>
              <Kbd>K</Kbd>
            </span>
          }
        >
          <button
            type="button"
            onClick={() => togglePanel('search')}
            data-search-trigger=""
            data-testid="topbar-search"
            aria-label="Search boards, items and people"
            aria-keyshortcuts="Control+K Meta+K"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-sunken text-xs text-fg-secondary transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus xl:w-56 xl:px-3"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Search aria-hidden className="size-3.5 shrink-0" />
              <span className="hidden min-w-0 flex-1 truncate text-left xl:inline">Search…</span>
              <span className="hidden items-center gap-0.5 xl:inline-flex">
                <Kbd>{mod}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </span>
          </button>
        </Tooltip>

        <nav aria-label="Quick actions" className="flex shrink-0 items-center gap-0.5">
          <NotificationsRealtime />
          {canInvite ? (
            <IconButton
              label="Invite members"
              icon={<UserPlus aria-hidden />}
              className="hidden lg:inline-flex"
              onClick={() => openPanel('invite')}
            />
          ) : null}
          <span className="hidden sm:contents">
            <HelpMenu />
          </span>
          <IconButton
            label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
            icon={<Bell aria-hidden />}
            active={panel === 'notifications'}
            aria-expanded={panel === 'notifications'}
            aria-haspopup="dialog"
            data-notifications-trigger=""
            data-testid="notifications-bell"
            onClick={() => togglePanel('notifications')}
            badge={<CountBadge count={unread} ringClassName="ring-[var(--surface-panel)]" />}
          />
        </nav>
        <AppSwitcher current="crm" urls={APP_URLS} />
        <UserMenu />
      </div>
    </header>
  );
}
