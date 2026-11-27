'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, ExternalLink } from 'lucide-react';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
  toast,
} from '@/components/ui';
import { organization } from '@/lib/auth-client';
import { useShell } from './shell-context';

/** 'Northwind Robotics' -> 'NR'. */
export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return (second ? `${first}${second}` : name.trim().slice(0, 2)).toUpperCase();
}

/** Switch the active organization (shared session: every KitStak app follows). */
export function OrgSwitcher({ className }: { readonly className?: string }) {
  const { org, orgs, appUrls } = useShell();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const switchTo = async (orgId: string) => {
    if (orgId === org.id) return;
    setSwitchingTo(orgId);
    try {
      const result = await organization.setActive({ organizationId: orgId });
      if (result.error) throw new Error(result.error.message);
      queryClient.clear();
      router.push('/');
      router.refresh();
    } catch (error) {
      toast.error("Couldn't switch organizations", error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSwitchingTo(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="org-switcher"
        className={cn(
          'inline-flex h-8 min-w-0 shrink items-center gap-1.5 rounded-md border border-border-input bg-panel px-1.5 text-sm font-medium text-fg sm:max-w-[200px] sm:px-2',
          'hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=open]:bg-selected',
          className,
        )}
      >
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-sunken text-2xs font-bold text-fg-secondary">
          {orgInitials(org.name)}
        </span>
        {/* Initials only on phones and where the top nav needs the room (lg to xl); the name stays for screen readers. */}
        <span className="sr-only sm:not-sr-only sm:truncate lg:sr-only xl:not-sr-only xl:truncate">{org.name}</span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-icon" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {orgs.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            onSelect={() => void switchTo(entry.id)}
            icon={
              <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-sunken text-2xs font-bold text-fg-secondary">
                {orgInitials(entry.name)}
              </span>
            }
            description={<span className="capitalize">{entry.role}</span>}
            shortcut={switchingTo === entry.id ? 'Switching…' : entry.id === org.id ? '✓ Current' : undefined}
          >
            {entry.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<ExternalLink aria-hidden />}
          description="Members, invites and billing in the Portal"
          onSelect={() => window.location.assign(withThemeParam(`${appUrls.portal}/settings/organization`))}
        >
          Manage organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
