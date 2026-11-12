'use client';
/**
 * Shared cross-app launcher menu (BLUEPRINT.md §6): a module-grid trigger in each app's top bar
 * opening a popover that lists Portal / CRM / WMS. Purely presentational — origins and
 * entitlement flags arrive as props (no data fetching here), and styling uses tokens.css custom
 * properties exclusively so the menu inherits the host app's light/dark theme. Keyboard and
 * focus behavior (aria-haspopup/expanded, Escape, focus return) come from the Radix popover.
 */
import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import './app-switcher.css';

export type AppSwitcherAppId = 'portal' | 'crm' | 'wms';

export interface AppSwitcherUrls {
  readonly portal: string;
  readonly crm: string;
  readonly wms: string;
}

/** Per-module unlock state. Omit the prop entirely to show both product apps unlocked. */
export interface AppSwitcherEntitled {
  readonly crm: boolean;
  readonly wms: boolean;
}

export interface AppSwitcherProps {
  readonly current: AppSwitcherAppId;
  readonly urls: AppSwitcherUrls;
  readonly entitled?: AppSwitcherEntitled;
}

interface AppMeta {
  readonly id: AppSwitcherAppId;
  readonly name: string;
  readonly descriptor: string;
}

const APPS: readonly AppMeta[] = [
  { id: 'portal', name: 'KitStak Portal', descriptor: 'Launcher, billing and organization' },
  { id: 'crm', name: 'KitStak CRM', descriptor: 'Pipelines, boards and automations' },
  { id: 'wms', name: 'KitStak WMS', descriptor: 'Receiving, inventory and shipping' },
];

function GridIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      {[1, 7.25, 13.5].flatMap((y) =>
        [1, 7.25, 13.5].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="3.5" height="3.5" rx="1" />),
      )}
    </svg>
  );
}

function PortalMarkIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.5" />
    </svg>
  );
}

function CrmMarkIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M2 3h12l-4.5 5.2V13l-3 1.5V8.2L2 3Z" />
    </svg>
  );
}

function WmsMarkIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M8 1.8 14 5v6L8 14.2 2 11V5l6-3.2Z" />
      <path d="M2 5l6 3 6-3M8 8v6.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 8.5 3.2 3.2L13 4.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

const MARK_ICONS: Readonly<Record<AppSwitcherAppId, () => React.ReactElement>> = {
  portal: PortalMarkIcon,
  crm: CrmMarkIcon,
  wms: WmsMarkIcon,
};

function isUnlocked(id: AppSwitcherAppId, entitled: AppSwitcherEntitled | undefined): boolean {
  if (id === 'portal' || entitled === undefined) return true;
  return entitled[id];
}

function AppRow({
  app,
  current,
  locked,
  href,
  onNavigate,
}: {
  readonly app: AppMeta;
  readonly current: boolean;
  readonly locked: boolean;
  readonly href: string;
  readonly onNavigate: () => void;
}) {
  const Mark = MARK_ICONS[app.id];
  return (
    <li>
      <a
        href={href}
        aria-current={current ? 'true' : undefined}
        data-locked={locked ? '' : undefined}
        data-testid={`app-switcher-${app.id}`}
        className="ks-appswitcher-row"
        onClick={onNavigate}
      >
        <span className={`ks-appswitcher-mark ks-appswitcher-mark-${app.id}`}>
          <Mark />
        </span>
        <span className="ks-appswitcher-text">
          <span className="ks-appswitcher-name">{app.name}</span>
          <span className="ks-appswitcher-desc">
            {locked ? 'Locked — unlock in Portal billing' : app.descriptor}
          </span>
        </span>
        {current ? (
          <span className="ks-appswitcher-end">
            <CheckIcon />
            <span className="ks-appswitcher-sr">Current app</span>
          </span>
        ) : locked ? (
          <span className="ks-appswitcher-end">
            <LockIcon />
            <span className="ks-appswitcher-sr">Locked — opens billing</span>
          </span>
        ) : null}
      </a>
    </li>
  );
}

/** Module-grid button + popover listing Portal / CRM / WMS with entitlement-aware rows. */
export function AppSwitcher({ current, urls, entitled }: AppSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const billingHref = `${urls.portal.replace(/\/+$/, '')}/billing`;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        type="button"
        aria-label="Switch app"
        data-testid="app-switcher"
        className="ks-appswitcher-trigger"
      >
        <GridIcon />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label="KitStak apps"
          data-testid="app-switcher-menu"
          className="ks-appswitcher-menu"
        >
          <p className="ks-appswitcher-heading">KitStak apps</p>
          <ul className="ks-appswitcher-list">
            {APPS.map((app) => {
              const locked = !isUnlocked(app.id, entitled);
              return (
                <AppRow
                  key={app.id}
                  app={app}
                  current={app.id === current}
                  locked={locked}
                  href={locked ? billingHref : urls[app.id]}
                  onNavigate={() => setOpen(false)}
                />
              );
            })}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
