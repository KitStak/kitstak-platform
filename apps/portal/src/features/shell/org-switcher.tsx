'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Building2, Check, ChevronsUpDown, Settings2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
  cn,
} from '@/components/ui';
import { organization } from '@/lib/auth-client';

/** 'Northwind Robotics' -> 'NR'; single-word names fall back to their first two letters. */
function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return second ? `${first}${second}` : name.trim().slice(0, 2);
}

export interface OrgOption {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: string;
}

export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  readonly orgs: readonly OrgOption[];
  readonly activeOrgId: string;
}) {
  const router = useRouter();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const active = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  if (!active) return null;

  const switchTo = async (orgId: string) => {
    if (orgId === activeOrgId) return;
    setSwitchingTo(orgId);
    try {
      await organization.setActive({ organizationId: orgId });
      router.refresh();
    } finally {
      setSwitchingTo(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-border-input bg-panel px-2 text-sm font-medium text-fg sm:max-w-[260px] sm:gap-2 sm:px-2.5',
          'hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          'data-[state=open]:bg-selected',
        )}
      >
        <Building2 aria-hidden className="hidden size-4 shrink-0 text-icon sm:block" />
        {/* At phone widths the full name truncates to nothing useful; show an initials chip
            instead and let the dropdown carry the full name. */}
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-sunken text-2xs font-bold text-fg-secondary uppercase sm:hidden"
        >
          {orgInitials(active.name)}
        </span>
        <span className="sr-only sm:hidden">{active.name}</span>
        <span className="hidden truncate sm:block">{active.name}</span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-icon" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {orgs.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => void switchTo(org.id)}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-sunken text-2xs font-bold text-fg-secondary uppercase">
              {orgInitials(org.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{org.name}</span>
              <span className="block text-2xs text-fg-muted capitalize">{org.role}</span>
            </span>
            {switchingTo === org.id ? (
              <Spinner size="xs" label={null} />
            ) : org.id === activeOrgId ? (
              <Check aria-hidden className="size-4 text-success" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/organization">
            <Settings2 aria-hidden className="size-4 text-icon" />
            Organization settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
