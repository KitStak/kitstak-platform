'use client';
import { useRouter } from 'next/navigation';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { Clock3, Keyboard, LayoutGrid, LogOut, Settings2, UserRound } from 'lucide-react';
import { Avatar, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, cn } from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { CREW_ROLE_LABELS } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { useShell } from './shell-context';
import { useShellStore } from './store';

export function UserMenu() {
  const { user, appUrls, crewRole, can, linkedPersonId } = useShell();
  const router = useRouter();
  const openShortcuts = useShellStore((state) => state.openShortcuts);

  const onSignOut = async () => {
    await signOut();
    router.replace('/login?notice=signed-out');
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        data-testid="user-menu"
        className={cn('inline-flex size-8 items-center justify-center rounded-full', 'hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus')}
      >
        <Avatar name={user.name || user.email} src={user.image} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold text-fg">{user.name}</p>
          <p className="truncate text-xs text-fg-muted">{user.email}</p>
          <p className="mt-1 text-xs text-fg-muted" data-testid="user-menu-role">
            Crew role: {CREW_ROLE_LABELS[crewRole]}
          </p>
        </div>
        <DropdownMenuSeparator />
        {linkedPersonId ? (
          <>
            <DropdownMenuItem icon={<UserRound aria-hidden />} onSelect={() => router.push(routes.me())}>
              My work
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Clock3 aria-hidden />} onSelect={() => router.push(routes.clock())}>
              Phone clock
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem icon={<Keyboard aria-hidden />} shortcut="?" onSelect={openShortcuts}>
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem icon={<LayoutGrid aria-hidden />} onSelect={() => window.location.assign(withThemeParam(appUrls.portal))}>
          All KitStak apps
        </DropdownMenuItem>
        {can('settings:manage') ? (
          <DropdownMenuItem icon={<Settings2 aria-hidden />} onSelect={() => router.push(routes.settings())}>
            Crew settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" icon={<LogOut aria-hidden />} onSelect={() => void onSignOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
