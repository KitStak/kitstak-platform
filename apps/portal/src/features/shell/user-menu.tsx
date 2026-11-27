'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, KeyRound, LayoutGrid, LogOut, Moon, Settings2, Sun, UserRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { toggleTheme } from './theme-toggle';

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function UserMenu({
  name,
  email,
  billingOnly = false,
}: {
  readonly name: string;
  readonly email: string;
  /** A person who only manages billing has no apps: the "Apps" row is left out. */
  readonly billingOnly?: boolean;
}) {
  const router = useRouter();

  const onSignOut = async () => {
    await signOut();
    router.replace('/login?notice=signed-out');
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-full bg-inverse text-xs font-bold text-fg-inverse',
          'hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        {initials(name, email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold text-fg">{name}</p>
          <p className="truncate text-xs text-fg-muted">{email}</p>
        </div>
        <DropdownMenuSeparator />
        {billingOnly ? null : (
          <DropdownMenuItem asChild>
            <Link href="/">
              <LayoutGrid aria-hidden className="size-4 text-icon" />
              Apps
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/billing">
            <CreditCard aria-hidden className="size-4 text-icon" />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/organization">
            <Settings2 aria-hidden className="size-4 text-icon" />
            Organization settings
          </Link>
        </DropdownMenuItem>
        {/* Name, email and "Set a password" (review round 4). */}
        <DropdownMenuItem asChild>
          <Link href="/settings/account" data-testid="menu-account">
            <UserRound aria-hidden className="size-4 text-icon" />
            My account
          </Link>
        </DropdownMenuItem>
        {/* Personal tokens for programs such as Claude (docs/integration/AGENT_WRITE_API.md). */}
        <DropdownMenuItem asChild>
          <Link href="/settings/api-tokens" data-testid="menu-api-tokens">
            <KeyRound aria-hidden className="size-4 text-icon" />
            API tokens
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleTheme} data-testid="menu-theme">
          <Sun aria-hidden className="size-4 text-icon dark:hidden" />
          <Moon aria-hidden className="hidden size-4 text-icon dark:inline" />
          Light or dark theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void onSignOut()}
          className="text-danger-text data-[highlighted]:bg-danger-subtle"
        >
          <LogOut aria-hidden className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
