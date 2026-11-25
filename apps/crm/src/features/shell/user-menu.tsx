'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { billingLink } from '@kitstak/billing/links';
import {
  Building2,
  CreditCard,
  Keyboard,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Shield,
  Sun,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  toast,
} from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { useCan, useOrg } from './org-context';
import { routes } from './routes';
import { useShellStore } from './store';
import { useTheme, type ThemePreference } from './theme';

const ROLE_LABEL: Readonly<Record<string, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
  guest: 'Guest',
};

function isThemePreference(value: string): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Avatar menu: account, organization admin, theme, shortcuts and sign out. */
export function UserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { org, user, role, apps } = useOrg();
  const { preference, setPreference } = useTheme();
  const openPanel = useShellStore((state) => state.openPanel);
  const canAdmin = useCan('org:update');
  const canMembers = useCan('member:read');
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const result = await signOut();
      if (result.error) throw new Error(result.error.message ?? 'Sign out failed');
      queryClient.clear();
      router.replace('/login');
      router.refresh();
    } catch {
      setSigningOut(false);
      toast.error("Couldn't sign out", 'Check your connection and try again.');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user.name}`}
          data-testid="account-menu"
          className="group relative flex size-9 items-center justify-center rounded-full transition-[box-shadow] hover:shadow-[0_0_0_3px_var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=open]:shadow-[0_0_0_2px_var(--primary)]"
        >
          <Avatar name={user.name} src={user.image} colorKey={user.id} size="md" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-16px)]">
        <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
          <Avatar name={user.name} src={user.image} colorKey={user.id} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-fg" title={user.name}>{user.name}</p>
            <p className="truncate text-sm text-fg-muted" title={user.email} data-testid="account-email">{user.email}</p>
          </div>
        </div>
        <DropdownMenuItem
          icon={<UserRound aria-hidden />}
          onSelect={() => router.push(routes.profile(org.slug))}
        >
          My profile
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            icon={
              preference === 'dark' ? (
                <Moon aria-hidden />
              ) : preference === 'light' ? (
                <Sun aria-hidden />
              ) : (
                <Monitor aria-hidden />
              )
            }
          >
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup
              value={preference}
              onValueChange={(value) => {
                if (isThemePreference(value)) setPreference(value);
              }}
            >
              <DropdownMenuRadioItem value="light" icon={<Sun aria-hidden />}>
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" icon={<Moon aria-hidden />}>
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system" icon={<Monitor aria-hidden />}>
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          icon={<Keyboard aria-hidden />}
          shortcut="?"
          onSelect={() => openPanel('shortcuts')}
        >
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="flex min-w-0 items-center gap-1.5">
            <Building2 aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{org.name}</span>
          </span>
          <Badge size="sm" tone="primary">
            {ROLE_LABEL[role] ?? role}
          </Badge>
        </DropdownMenuLabel>
        {canAdmin ? (
          <DropdownMenuItem
            icon={<Shield aria-hidden />}
            onSelect={() => router.push(routes.admin(org.slug))}
          >
            Administration
          </DropdownMenuItem>
        ) : null}
        {canAdmin ? (
          <DropdownMenuItem
            icon={<CreditCard aria-hidden />}
            data-testid="user-menu-plan"
            onSelect={() =>
              window.location.assign(billingLink(apps?.urls.portal ?? 'http://localhost:3300', { to: 'home' }, 'crm'))
            }
          >
            Plan and payment
          </DropdownMenuItem>
        ) : null}
        {canMembers ? (
          <DropdownMenuItem
            icon={<Users aria-hidden />}
            onSelect={() => router.push(routes.members(org.slug))}
          >
            Members &amp; teams
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          icon={<Settings aria-hidden />}
          onSelect={() => router.push(routes.profile(org.slug))}
        >
          Preferences
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Trash2 aria-hidden />} onSelect={() => router.push(routes.trash(org.slug))}>
          Trash
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<LogOut aria-hidden />}
          variant="danger"
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          {signingOut ? 'Signing out…' : 'Log out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
