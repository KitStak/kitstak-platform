'use client';
/**
 * Shared cross-app launcher menu (BLUEPRINT.md §6): a module-grid trigger in each app's top bar
 * opening a popover that lists Portal / CRM / WMS / Projects / Pulse / Crew / Ledger. Purely presentational: origins and
 * entitlement flags arrive as props (no data fetching here), and styling uses tokens.css custom
 * properties exclusively so the menu inherits the host app's light/dark theme. Keyboard and
 * focus behavior (aria-haspopup/expanded, Escape, focus return) come from the Radix popover.
 */
import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { AppIcon } from '../app-icon';
import { HandoffScreen, useHandoff } from '../handoff';
import { APP_SWITCHER_BADGE_LABELS, type AppSwitcherPlanBadge } from './labels';
import './app-switcher.css';

/** Icon box in a row. The supplied artwork carries its own padding, so it fills the tile. */
const MARK_SIZE = 32;

/** The apps a plan can hold. Plan badges and "add to plan" links exist only for these. */
export type AppSwitcherBilledAppId = 'portal' | 'crm' | 'wms' | 'projects' | 'pulse';
/**
 * Every app the switcher can list. Crew and Ledger are in preview (not sold yet): they have no plan
 * badge and no "add to plan" link. At launch they move into AppSwitcherBilledAppId.
 */
export type AppSwitcherAppId = AppSwitcherBilledAppId | 'crew' | 'ledger';

const BILLED_APP_IDS: readonly AppSwitcherAppId[] = ['portal', 'crm', 'wms', 'projects', 'pulse'];

function isBilledApp(id: AppSwitcherAppId): id is AppSwitcherBilledAppId {
  return BILLED_APP_IDS.includes(id);
}

export interface AppSwitcherUrls {
  readonly portal: string;
  readonly crm: string;
  readonly wms: string;
  /** KitStak Projects origin. Omitted → the Projects row is hidden (app not deployed for this host). */
  readonly projects?: string;
  /** KitStak Pulse origin. Omitted → the Pulse row is hidden (app not deployed for this host). */
  readonly pulse?: string;
  /**
   * KitStak Crew and KitStak Ledger origins. Omitted → their rows are hidden. Before launch a host
   * passes them only for an org the preview gate lets in (`previewAccess` in @kitstak/entitlements).
   */
  readonly crew?: string;
  readonly ledger?: string;
}

/**
 * Per-module unlock state. Omit the prop entirely to show every product app unlocked; an
 * omitted `projects` or `pulse` flag counts as unlocked so hosts that predate those apps keep working.
 */
export interface AppSwitcherEntitled {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects?: boolean;
  readonly pulse?: boolean;
  readonly crew?: boolean;
  readonly ledger?: boolean;
}

export interface AppSwitcherProps {
  readonly current: AppSwitcherAppId;
  readonly urls: AppSwitcherUrls;
  readonly entitled?: AppSwitcherEntitled;
  /**
   * Apps this org cannot use on any plan (for example WMS outside the platform org). Their rows
   * read "Not in your plan" with a lock and open Portal billing, whatever `entitled` says.
   */
  readonly notInPlan?: readonly AppSwitcherAppId[];
  /**
   * Plan state per app, from `AppPlanView.badges` in `@kitstak/billing`. When an app has a badge
   * the badge decides the row: its words show next to the name, and "Not in your plan" turns the
   * row into a link to the plan picker with that app turned on. Apps with no badge keep the
   * `entitled` and `notInPlan` behavior, so old callers work unchanged.
   */
  readonly planBadges?: Partial<Record<AppSwitcherBilledAppId, AppSwitcherPlanBadge>>;
  /** Link for a row that is not in the plan. Default `${urls.portal}/billing/plan?add=<app>`. */
  readonly addHref?: (app: AppSwitcherBilledAppId) => string;
  /**
   * True for a person who only manages billing (the bookkeeper). They have no seat in any app, so
   * the app rows are plain text that says so, not links to a screen they cannot open. The Portal
   * row stays a link.
   */
  readonly billingOnly?: boolean;
}

/** The second line of an app row for a person who only manages billing. */
export const APP_SWITCHER_BILLING_ONLY = 'Billing only. Ask an owner for access.';

export interface AppSwitcherRowState {
  /** The row does not open the app: it opens the Portal instead. */
  readonly locked: boolean;
  readonly href: string;
  /** Badge next to the name, or null. */
  readonly badge: AppSwitcherPlanBadge | null;
  /** Second line of a locked row with no badge (old callers). null: show the app's descriptor. */
  readonly lockedLabel: string | null;
  /** Title of the handoff screen while the browser leaves this app. */
  readonly handoffTitle: string;
  /** Screen reader words for the icon at the end of a locked row. */
  readonly lockedHint: string;
}

/** Where a row goes and what it says. Pure, so the rules are unit tested without a DOM. */
export function appSwitcherRow(
  app: { readonly id: AppSwitcherAppId; readonly name: string },
  props: Pick<AppSwitcherProps, 'current' | 'urls' | 'entitled' | 'notInPlan' | 'planBadges' | 'addHref'>,
): AppSwitcherRowState {
  const portal = props.urls.portal.replace(/\/+$/, '');
  const own = props.urls[app.id] ?? '/';
  const isCurrent = app.id === props.current;
  const billedId = isBilledApp(app.id) && app.id !== 'portal' ? app.id : null;
  const badge = billedId === null ? null : (props.planBadges?.[billedId] ?? null);

  if (badge !== null && billedId !== null) {
    if (badge === 'not_in_plan' && !isCurrent) {
      return {
        locked: true,
        href: props.addHref ? props.addHref(billedId) : `${portal}/billing/plan?add=${billedId}`,
        badge,
        lockedLabel: null,
        handoffTitle: 'Opening your plan',
        lockedHint: 'Not in your plan. Opens the plan picker.',
      };
    }
    return { locked: false, href: own, badge, lockedLabel: null, handoffTitle: `Opening ${app.name}`, lockedHint: '' };
  }

  const unavailable = !isCurrent && (props.notInPlan?.includes(app.id) ?? false);
  const locked = unavailable || !isUnlocked(app.id, props.entitled);
  return {
    locked,
    href: locked ? `${portal}/billing` : own,
    badge: null,
    lockedLabel: locked ? (unavailable ? 'Not in your plan' : 'Locked. Unlock it in Portal billing') : null,
    handoffTitle: locked ? 'Opening Portal billing' : `Opening ${app.name}`,
    lockedHint: 'Locked, opens billing',
  };
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
  { id: 'projects', name: 'KitStak Projects', descriptor: 'Projects, programs and tasks' },
  { id: 'pulse', name: 'KitStak Pulse', descriptor: 'Profit by job, client and service' },
  { id: 'crew', name: 'KitStak Crew', descriptor: 'People, shifts and the time clock' },
  { id: 'ledger', name: 'KitStak Ledger', descriptor: 'Invoices, bills and month-end close' },
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

function PlusIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
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

/** An app a billing only person cannot open: the name and why, with no link and no press. */
function NoSeatRow({ app }: { readonly app: AppMeta }) {
  return (
    <li>
      <div className="ks-appswitcher-row" data-locked="" data-no-seat="" data-testid={`app-switcher-${app.id}`}>
        <span className="ks-appswitcher-mark">
          <AppIcon app={app.id} size={MARK_SIZE} />
        </span>
        <span className="ks-appswitcher-text">
          <span className="ks-appswitcher-title">
            <span className="ks-appswitcher-name">{app.name}</span>
          </span>
          <span className="ks-appswitcher-desc">{APP_SWITCHER_BILLING_ONLY}</span>
        </span>
        <span className="ks-appswitcher-end">
          <LockIcon />
        </span>
      </div>
    </li>
  );
}

function AppRow({
  app,
  current,
  row,
  onNavigate,
}: {
  readonly app: AppMeta;
  readonly current: boolean;
  readonly row: AppSwitcherRowState;
  readonly onNavigate: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <li>
      <a
        href={row.href}
        aria-current={current ? 'true' : undefined}
        data-locked={row.locked ? '' : undefined}
        data-testid={`app-switcher-${app.id}`}
        className="ks-appswitcher-row"
        onClick={onNavigate}
      >
        <span className="ks-appswitcher-mark">
          <AppIcon app={app.id} size={MARK_SIZE} />
        </span>
        <span className="ks-appswitcher-text">
          <span className="ks-appswitcher-title">
            <span className="ks-appswitcher-name">{app.name}</span>
            {row.badge ? (
              <span className="ks-appswitcher-badge" data-badge={row.badge} data-testid={`app-switcher-badge-${app.id}`}>
                {APP_SWITCHER_BADGE_LABELS[row.badge]}
              </span>
            ) : null}
          </span>
          <span className="ks-appswitcher-desc">{row.lockedLabel ?? app.descriptor}</span>
        </span>
        {current ? (
          <span className="ks-appswitcher-end">
            <CheckIcon />
            <span className="ks-appswitcher-sr">Current app</span>
          </span>
        ) : row.locked ? (
          <span className="ks-appswitcher-end">
            {row.badge ? <PlusIcon /> : <LockIcon />}
            <span className="ks-appswitcher-sr">{row.lockedHint}</span>
          </span>
        ) : null}
      </a>
    </li>
  );
}

/** Module-grid button + popover listing Portal / CRM / WMS / Projects / Pulse with entitlement-aware rows. */
export function AppSwitcher({ current, urls, entitled, notInPlan, planBadges, addHref, billingOnly = false }: AppSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const [handoff, startHandoff] = useHandoff();
  const [handoffTitle, setHandoffTitle] = React.useState('');
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
              if (billingOnly && app.id !== 'portal') return <NoSeatRow key={app.id} app={app} />;
              const found = appSwitcherRow(app, { current, urls, entitled, notInPlan, planBadges, addHref });
              // A billing only person has one place in the Portal: Billing.
              const row = billingOnly && app.id === 'portal' ? { ...found, href: `${urls.portal.replace(/\/+$/, '')}/billing` } : found;
              return (
                <AppRow
                  key={app.id}
                  app={app}
                  current={app.id === current}
                  row={row}
                  onNavigate={(event) => {
                    setOpen(false);
                    // Plain left click that leaves this app: show the KitStak handoff screen until
                    // the next app paints. New-tab clicks and the current app skip it.
                    const newTab = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
                    if (app.id === current || newTab) return;
                    setHandoffTitle(billingOnly ? 'Opening Billing' : row.handoffTitle);
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
