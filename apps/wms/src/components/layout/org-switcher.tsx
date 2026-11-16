'use client';

import * as React from 'react';
import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api-client';

export interface OrgRef {
  readonly id: string;
  readonly name: string;
}

/**
 * Which organization's warehouse is open (one separate warehouse per organization). Shows
 * the org name; with more than one warehouse it becomes a switcher. Switching sets the org
 * cookie server-side and reloads, so no client state from the previous warehouse survives.
 */
export function OrgSwitcher({ org, orgs }: { readonly org?: OrgRef; readonly orgs?: readonly OrgRef[] }) {
  const [busy, setBusy] = React.useState(false);
  if (!org) return null;
  const others = (orgs ?? []).filter((o) => o.id !== org.id);

  const label = (
    <>
      <Building2 className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
      <span className="max-w-[10rem] truncate">{org.name}</span>
    </>
  );
  if (others.length === 0) {
    return (
      <span
        className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-secondary md:flex"
        title={`Warehouse of ${org.name}`}
        data-testid="org-name"
      >
        {label}
      </span>
    );
  }

  const switchTo = async (target: OrgRef): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch('/api/tenancy/switch', { method: 'POST', body: { orgId: target.id } });
      // Full navigation on purpose: drops every cached query of the previous warehouse.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/');
    } catch (error) {
      setBusy(false);
      toast.error('Could not switch warehouse', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          data-testid="org-switcher"
          className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-secondary outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-pressed md:flex"
        >
          {label}
          <span className="sr-only"> (switch organization)</span>
          <ChevronDown className="size-3.5 text-fg-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Organization warehouses</DropdownMenuLabel>
        <DropdownMenuItem icon={Check} disabled>
          {org.name}
        </DropdownMenuItem>
        {others.map((o) => (
          <DropdownMenuItem key={o.id} icon={Building2} onSelect={() => void switchTo(o)}>
            {o.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={Plus} href="/setup-warehouse">
          Set up a warehouse
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
