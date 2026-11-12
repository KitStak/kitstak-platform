'use client';
/**
 * Portal ⌘/Ctrl+K command palette ('/' works too). A deliberate small sibling of the CRM
 * palette (apps/crm/src/features/shell/command-palette.tsx) sharing its visual language:
 * same dialog frame, group headings, row anatomy and footer hint bar — but portal-scoped
 * commands only: open the apps, portal pages, switch org, sign out.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  ArrowUpRight,
  Check,
  CornerDownLeft,
  CreditCard,
  LayoutGrid,
  Lock,
  LogOut,
  Search,
  Settings2,
} from 'lucide-react';
import { Kbd, Spinner, cn } from '@/components/ui';
import { organization, signOut } from '@/lib/auth-client';

export interface PaletteOrg {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: string;
}

export interface CommandPaletteProps {
  readonly orgs: readonly PaletteOrg[];
  readonly activeOrgId: string | null;
  readonly crmUrl: string;
  readonly wmsUrl: string;
  readonly entitled: { readonly crm: boolean; readonly wms: boolean };
}

const groupClass =
  '[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function PaletteItem({
  value,
  keywords,
  onSelect,
  icon,
  children,
  meta,
  hint,
  external,
  disabled,
}: {
  readonly value: string;
  readonly keywords?: readonly string[];
  readonly onSelect: () => void;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  /** Second line (role, url…). */
  readonly meta?: ReactNode;
  /** Right-aligned content (check, badge, spinner). */
  readonly hint?: ReactNode;
  readonly external?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords ? [...keywords] : undefined}
      onSelect={onSelect}
      disabled={disabled}
      data-testid="palette-item"
      className={cn(
        'group/item mx-2 flex cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-fg select-none',
        meta ? 'min-h-12 py-1.5' : 'h-10',
        'data-[selected=true]:bg-hover data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm text-icon">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {meta ? <span className="truncate text-xs text-fg-muted">{meta}</span> : null}
      </span>
      {hint ? <span className="flex shrink-0 items-center text-xs text-fg-muted">{hint}</span> : null}
      <span
        aria-hidden
        className="hidden shrink-0 items-center gap-1 text-fg-muted group-data-[selected=true]/item:flex"
      >
        {external ? <ArrowUpRight className="size-3.5" /> : null}
        <CornerDownLeft className="size-3.5" />
      </span>
    </Command.Item>
  );
}

export function CommandPalette({ orgs, activeOrgId, crmUrl, wmsUrl, entitled }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  // Ctrl/⌘+K toggles; '/' opens when focus is not in an editable control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const openApp = useCallback(
    (url: string) => {
      close();
      window.open(url, '_blank', 'noopener');
    },
    [close],
  );

  const switchOrg = useCallback(
    async (orgId: string) => {
      if (orgId === activeOrgId) {
        close();
        return;
      }
      setSwitchingTo(orgId);
      try {
        await organization.setActive({ organizationId: orgId });
        close();
        router.refresh();
      } finally {
        setSwitchingTo(null);
      }
    },
    [activeOrgId, close, router],
  );

  const onSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
      close();
      router.replace('/login?notice=signed-out');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [close, router]);

  return (
    <>
      <button
        type="button"
        data-search-trigger
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        className={cn(
          'inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-muted',
          'hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        <Search aria-hidden className="size-4" />
        <span className="hidden items-center gap-1 md:inline-flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <Command.Dialog
        open={open}
        onOpenChange={(value) => (value ? setOpen(true) : close())}
        label="Commands"
        shouldFilter
        loop
        overlayClassName="fixed inset-0 z-50 bg-overlay/60 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
        contentClassName={cn(
          'fixed top-[10vh] left-1/2 z-50 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden',
          'rounded-xl border border-border-subtle bg-raised shadow-modal outline-none',
          'data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in',
        )}
        className="flex max-h-[min(480px,70vh)] flex-col"
      >
        <div className="flex items-center gap-3 border-b border-border-subtle px-4">
          <Search aria-hidden className="size-5 shrink-0 text-icon" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Jump to an app, page or organization…"
            className="h-13 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-placeholder"
          />
          <Kbd>Esc</Kbd>
        </div>
        <Command.List className="min-h-0 flex-1 overflow-y-auto pb-2">
          <Command.Empty className="px-6 py-8 text-center text-sm text-fg-muted">
            No matches. Try an app, page or organization name.
          </Command.Empty>
          <Command.Group heading="Apps" className={groupClass}>
            <PaletteItem
              value="open-crm"
              keywords={['crm', 'deals', 'pipeline', 'sales']}
              onSelect={() => (entitled.crm ? openApp(crmUrl) : go('/billing?module=crm'))}
              icon={
                entitled.crm ? (
                  <ArrowUpRight aria-hidden className="size-4" />
                ) : (
                  <Lock aria-hidden className="size-4" />
                )
              }
              meta={entitled.crm ? 'Pipelines, boards and automations' : 'Locked. View billing'}
              external={entitled.crm}
            >
              Open CRM
            </PaletteItem>
            <PaletteItem
              value="open-wms"
              keywords={['wms', 'warehouse', 'orders', 'inventory', 'shipping']}
              onSelect={() => (entitled.wms ? openApp(wmsUrl) : go('/billing?module=wms'))}
              icon={
                entitled.wms ? (
                  <ArrowUpRight aria-hidden className="size-4" />
                ) : (
                  <Lock aria-hidden className="size-4" />
                )
              }
              meta={entitled.wms ? 'Warehouse operations' : 'Locked. View billing'}
              external={entitled.wms}
            >
              Open WMS
            </PaletteItem>
          </Command.Group>
          <Command.Group heading="Portal" className={groupClass}>
            <PaletteItem
              value="apps-home"
              keywords={['apps', 'home', 'launcher', 'start']}
              onSelect={() => go('/')}
              icon={<LayoutGrid aria-hidden className="size-4" />}
            >
              Apps
            </PaletteItem>
            <PaletteItem
              value="billing"
              keywords={['billing', 'plan', 'entitlements', 'subscription']}
              onSelect={() => go('/billing')}
              icon={<CreditCard aria-hidden className="size-4" />}
            >
              Billing
            </PaletteItem>
            <PaletteItem
              value="org-settings"
              keywords={['organization', 'settings', 'members', 'invite', 'team']}
              onSelect={() => go('/settings/organization')}
              icon={<Settings2 aria-hidden className="size-4" />}
            >
              Organization settings
            </PaletteItem>
          </Command.Group>
          {orgs.length > 0 ? (
            <Command.Group heading="Switch organization" className={groupClass}>
              {orgs.map((org) => (
                <PaletteItem
                  key={org.id}
                  value={`org-${org.slug}`}
                  keywords={['switch', 'organization', org.name]}
                  onSelect={() => void switchOrg(org.id)}
                  icon={
                    <span className="inline-flex size-6 items-center justify-center rounded-sm bg-sunken text-2xs font-bold text-fg-secondary uppercase">
                      {org.name.slice(0, 2)}
                    </span>
                  }
                  meta={<span className="capitalize">{org.role}</span>}
                  hint={
                    switchingTo === org.id ? (
                      <Spinner size="xs" label={null} />
                    ) : org.id === activeOrgId ? (
                      <Check aria-hidden className="size-4 text-success" />
                    ) : null
                  }
                >
                  {org.name}
                </PaletteItem>
              ))}
            </Command.Group>
          ) : null}
          <Command.Group heading="Account" className={groupClass}>
            <PaletteItem
              value="sign-out"
              keywords={['sign out', 'log out', 'logout', 'leave']}
              onSelect={() => void onSignOut()}
              icon={<LogOut aria-hidden className="size-4" />}
              hint={signingOut ? <Spinner size="xs" label={null} /> : null}
            >
              Sign out
            </PaletteItem>
          </Command.Group>
        </Command.List>
        <div className="hidden items-center gap-4 border-t border-border-subtle bg-sunken px-4 py-2 text-xs text-fg-muted sm:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </Command.Dialog>
    </>
  );
}
