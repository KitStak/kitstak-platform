'use client';
import { useRouter } from 'next/navigation';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { Bell, Keyboard, LayoutGrid, LogOut, Settings2, UserRound } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { useShell } from './shell-context';
import { useShellStore } from './store';

export function UserMenu() {
  const { user, appUrls } = useShell();
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
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<UserRound aria-hidden />} onSelect={() => router.push('/settings?section=profile')}>
          My settings
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Bell aria-hidden />} onSelect={() => router.push('/settings?section=notifications')}>
          Notification settings
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Keyboard aria-hidden />} shortcut="?" onSelect={openShortcuts}>
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<LayoutGrid aria-hidden />} onSelect={() => window.location.assign(withThemeParam(appUrls.portal))}>
          All KitStak apps
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Settings2 aria-hidden />} onSelect={() => router.push('/settings')}>
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" icon={<LogOut aria-hidden />} onSelect={() => void onSignOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
