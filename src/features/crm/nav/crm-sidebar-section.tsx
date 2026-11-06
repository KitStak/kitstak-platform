'use client';
/**
 * "CRM" object nav for the shell sidebar (SH-021 / CR-001): Pipeline cockpit, the CRM object
 * boards (Deals, Leads, Contacts, Accounts, Activities) and Duplicates. Collapsed, it renders
 * icon-rail links with tooltips. Imported directly by the shell sidebar (not via the index)
 * to keep the shell bundle small.
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, ChevronDown, Contact, CopyCheck, Gauge, Handshake, PhoneCall, UserPlus } from 'lucide-react';
import { Skeleton, Tooltip, cn } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { NavRow } from '@/features/shell/sidebar/nav-row';
import type { CrmObjectKind } from '@/server/services/crm-contracts';
import { useCrmBoards } from '../api';

interface CrmNavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly active: boolean;
}

const OBJECTS: readonly { kind: CrmObjectKind; label: string; icon: ReactNode }[] = [
  { kind: 'deals', label: 'Deals', icon: <Handshake aria-hidden className="size-[18px]" /> },
  { kind: 'leads', label: 'Leads', icon: <UserPlus aria-hidden className="size-[18px]" /> },
  { kind: 'contacts', label: 'Contacts', icon: <Contact aria-hidden className="size-[18px]" /> },
  { kind: 'accounts', label: 'Accounts', icon: <Building2 aria-hidden className="size-[18px]" /> },
  { kind: 'activities', label: 'Activities', icon: <PhoneCall aria-hidden className="size-[18px]" /> },
];

function useCrmNavItems(): CrmNavItem[] | null {
  const { org } = useOrg();
  const pathname = usePathname() ?? '';
  const boards = useCrmBoards();
  const primary = boards.data?.primary;
  if (boards.isError && !primary) return [];
  if (!primary) return null;
  const hasAny = Object.keys(primary).length > 0;
  if (!hasAny) return [];
  const base = `/${org.slug}/crm`;
  const items: CrmNavItem[] = [];
  if (primary.deals) {
    items.push({
      key: 'pipeline',
      label: 'Pipeline',
      href: `${base}/pipeline`,
      icon: <Gauge aria-hidden className="size-[18px]" />,
      active: pathname.startsWith(`${base}/pipeline`),
    });
  }
  for (const object of OBJECTS) {
    const board = primary[object.kind];
    if (!board) continue;
    const href = `/${org.slug}/boards/${board.id}`;
    const inRecordPage = pathname.startsWith(`${base}/${object.kind}/`);
    items.push({ key: object.kind, label: object.label, href, icon: object.icon, active: pathname.startsWith(href) || inRecordPage });
  }
  if (primary.contacts || primary.accounts) {
    items.push({
      key: 'duplicates',
      label: 'Duplicates',
      href: `${base}/duplicates`,
      icon: <CopyCheck aria-hidden className="size-[18px]" />,
      active: pathname.startsWith(`${base}/duplicates`),
    });
  }
  return items;
}

/** Rows reserved while the CRM boards load (Pipeline + 5 objects + Duplicates), so nothing below shifts. */
const PLACEHOLDER_ROWS = 7;
const RAIL_PLACEHOLDERS = 5;

function SectionSkeleton({ collapsed }: { readonly collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border-subtle pt-3" aria-hidden data-testid="crm-rail-skeleton">
        {Array.from({ length: RAIL_PLACEHOLDERS }, (_, index) => (
          <Skeleton key={index} width={36} height={36} rounded="md" />
        ))}
      </div>
    );
  }
  return (
    <section aria-label="CRM (loading)" aria-busy="true" className="flex shrink-0 flex-col gap-1" data-testid="crm-sidebar-skeleton">
      <div className="flex h-7 items-center pl-2">
        <span className="font-sans text-sm font-medium text-fg-secondary">CRM</span>
      </div>
      <ul className="flex flex-col gap-px" aria-hidden>
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
          <li key={index} className="flex h-8 items-center gap-2 pl-2">
            <Skeleton width={18} height={18} rounded="sm" />
            <Skeleton width={`${48 + ((index * 17) % 36)}%`} height={12} rounded="sm" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CrmSidebarSection({ collapsed = false }: { readonly collapsed?: boolean }) {
  const items = useCrmNavItems();
  const [open, setOpen] = useState(true);
  // Loading: reserve the section's space; hide it only once boards are known to be empty.
  if (items === null) return <SectionSkeleton collapsed={collapsed} />;
  if (items.length === 0) return null;
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border-subtle pt-3" data-testid="crm-rail">
        {items
          .filter((item) => item.key !== 'activities' && item.key !== 'duplicates')
          .map((item) => (
            <Tooltip key={item.key} content={item.label} side="right">
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={item.active ? 'page' : undefined}
                className="inline-flex size-9 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:bg-selected aria-[current=page]:text-primary-text"
              >
                {item.icon}
              </Link>
            </Tooltip>
          ))}
      </div>
    );
  }
  return (
    <section aria-labelledby="sidebar-crm" className="flex shrink-0 flex-col gap-1" data-testid="crm-sidebar-section">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="sidebar-crm-list"
        onClick={() => setOpen((value) => !value)}
        className="group flex h-7 items-center justify-between rounded-sm pr-1 pl-2 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <h2 id="sidebar-crm" className="font-sans text-sm font-medium text-fg-secondary">
          CRM
        </h2>
        <ChevronDown
          aria-hidden
          className={cn('size-4 text-icon transition-transform duration-[var(--duration-fast)]', !open && '-rotate-90')}
        />
      </button>
      {open ? (
        <ul id="sidebar-crm-list" className="flex flex-col gap-px">
          {items.map((item) => (
            <li key={item.key}>
              <NavRow href={item.href} icon={item.icon} label={item.label} active={item.active} testId={`crm-nav-${item.key}`} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
