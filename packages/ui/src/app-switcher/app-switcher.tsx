'use client';
/**
 * Shared cross-app launcher menu (BLUEPRINT.md §6): a module-grid trigger in each app's top bar
 * opening a popover that lists Portal / CRM / WMS / Projects. Purely presentational: origins and
 * entitlement flags arrive as props (no data fetching here), and styling uses tokens.css custom
 * properties exclusively so the menu inherits the host app's light/dark theme. Keyboard and
 * focus behavior (aria-haspopup/expanded, Escape, focus return) come from the Radix popover.
 */
import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { HandoffScreen, useHandoff } from '../handoff';
import './app-switcher.css';

export type AppSwitcherAppId = 'portal' | 'crm' | 'wms' | 'projects';

export interface AppSwitcherUrls {
  readonly portal: string;
  readonly crm: string;
  readonly wms: string;
  /** KitStak Projects origin. Omitted → the Projects row is hidden (app not deployed for this host). */
  readonly projects?: string;
}

/**
 * Per-module unlock state. Omit the prop entirely to show every product app unlocked; an
 * omitted `projects` flag counts as unlocked so hosts that predate Projects keep working.
 */
export interface AppSwitcherEntitled {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects?: boolean;
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
  { id: 'projects', name: 'KitStak Projects', descriptor: 'Projects, tasks and timelines' },
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

/**
 * Brand-pack app marks (`apps/<app>/public/brand/kitstak-icon-<app>.svg`), inlined with their
 * exact rects so they render on every origin without fetching an asset. Two-tone red/pink;
 * locked rows render them desaturated through CSS.
 */
type MarkRect = readonly [x: number, y: number, w: number, h: number, pink?: boolean];

const MARK_RECTS: Readonly<Record<AppSwitcherAppId, readonly MarkRect[]>> = {
  portal: [
    [38, 56, 56, 38],
    [106, 56, 56, 38, true],
    [38, 106, 56, 38, true],
    [106, 106, 56, 38],
  ],
  crm: [
    [36, 50, 128, 26],
    [56, 87, 88, 26, true],
    [76, 124, 48, 26],
  ],
  wms: [
    [46, 54, 30, 28, true],
    [86, 62, 26, 20, true],
    [122, 50, 32, 32, true],
    [34, 82, 132, 14],
    [44, 110, 36, 26, true],
    [90, 116, 28, 20, true],
    [128, 106, 26, 30, true],
    [34, 136, 132, 14],
  ],
  projects: [
    [38, 52, 80, 26],
    [68, 87, 80, 26, true],
    [98, 122, 64, 26],
  ],
};

function BrandMark({ app }: { readonly app: AppSwitcherAppId }) {
  return (
    <svg aria-hidden width="22" height="18" viewBox="28 40 144 120" className="ks-appswitcher-brand">
      {MARK_RECTS[app].map(([x, y, w, h, pink]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill={pink ? '#D65A6E' : '#C8102E'} />
      ))}
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

function isUnlocked(id: AppSwitcherAppId, entitled: AppSwitcherEntitled | undefined): boolean {
  if (id === 'portal' || entitled === undefined) return true;
  return entitled[id] ?? true;
}

function appUrl(id: AppSwitcherAppId, urls: AppSwitcherUrls): string | undefined {
  return urls[id];
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
  readonly onNavigate: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
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
          <BrandMark app={app.id} />
        </span>
        <span className="ks-appswitcher-text">
          <span className="ks-appswitcher-name">{app.name}</span>
          <span className="ks-appswitcher-desc">
            {locked ? 'Locked. Unlock it in Portal billing' : app.descriptor}
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
            <span className="ks-appswitcher-sr">Locked, opens billing</span>
          </span>
        ) : null}
      </a>
    </li>
  );
}

/** Module-grid button + popover listing Portal / CRM / WMS / Projects with entitlement-aware rows. */
export function AppSwitcher({ current, urls, entitled }: AppSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const [handoff, startHandoff] = useHandoff();
  const [handoffTitle, setHandoffTitle] = React.useState('');
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
              const href = appUrl(app.id, urls);
              // The current app always lists itself; another app with no configured origin is hidden.
              if (href === undefined && app.id !== current) return null;
              const locked = !isUnlocked(app.id, entitled);
              return (
                <AppRow
                  key={app.id}
                  app={app}
                  current={app.id === current}
                  locked={locked}
                  href={locked ? billingHref : (href ?? '/')}
                  onNavigate={(event) => {
                    setOpen(false);
                    // Plain left click that leaves this app: show the KitStak handoff screen until
                    // the next app paints. New-tab clicks and the current app skip it.
                    const newTab = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
                    if (app.id === current || newTab) return;
                    setHandoffTitle(locked ? 'Opening Portal billing' : `Opening ${app.name}`);
                    startHandoff();
                  }}
                />
              );
            })}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
      {handoff ? <HandoffScreen title={handoffTitle} detail="Taking you there with the same account" /> : null}
    </PopoverPrimitive.Root>
  );
}
