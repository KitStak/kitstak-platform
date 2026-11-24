/**
 * The one lock screen every KitStak app shows for an app that is not in the plan (docs/billing/
 * CONTRACTS.md section 17, SPEC 9.3). The title, the sentences and both links come from
 * `planLockFor` in `@kitstak/billing`; this component only lays them out, with the app's icon, so
 * the four apps look and read the same. It renders inside the app frame, never as a full page wall.
 *
 * No hooks and no browser APIs, so it works as a server component. Styling uses tokens.css custom
 * properties only (see plan-lock.css). This package does not import `@kitstak/billing`: the props
 * repeat the lock shape, and each app passes a `PlanLock` straight in.
 */
import * as React from 'react';
import { AppIcon } from '../app-icon';
import './plan-lock.css';

export interface PlanLockView {
  readonly title: string;
  readonly body: string;
  readonly priceLine: string | null;
  readonly primary: { readonly label: string; readonly href: string } | null;
  readonly secondary: { readonly label: string; readonly href: string };
  readonly testId: string;
}

export type PlanLockApp = 'crm' | 'wms' | 'projects' | 'pulse';

export interface PlanLockScreenProps {
  readonly app: PlanLockApp;
  readonly lock: PlanLockView;
  readonly className?: string;
}

/** What each app is for, in three short lines. Shown under the buttons so the screen is never bare. */
export const PLAN_LOCK_POINTS: Readonly<Record<PlanLockApp, { readonly name: string; readonly points: readonly string[] }>> = {
  crm: {
    name: 'KitStak CRM',
    points: ['Track every lead and deal on boards.', 'See your whole pipeline at a glance.', 'Automate follow ups and reminders.'],
  },
  wms: {
    name: 'KitStak WMS',
    points: ['Receive, store and ship with barcode scans.', 'Know what is in stock, in real time.', 'Bill your clients for storage and handling.'],
  },
  projects: {
    name: 'KitStak Projects',
    points: ['Plan work with tasks and timelines.', 'See who is doing what, and when it is due.', 'Link projects to your CRM deals.'],
  },
  pulse: {
    name: 'KitStak Pulse',
    points: ['See profit by job, client and service.', 'Spot what makes money and what does not.', 'One flat price for your whole team.'],
  },
};

function LockBadge() {
  return (
    <span className="ks-planlock-badge" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="7" width="10" height="7" rx="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      </svg>
    </span>
  );
}

function PointIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="ks-planlock-point-icon">
      <path d="m3.2 8.4 3 3L12.8 4.8" />
    </svg>
  );
}

export interface PlanLockFrameProps {
  /** The app's own lockup, already a link home where the app has one. */
  readonly logo: React.ReactNode;
  /** The organization the person is in. Hidden on phones, where the bar has no room for it. */
  readonly orgName?: string | null;
  /** The shared app switcher, so a person can go to an app that is in the plan. */
  readonly switcher?: React.ReactNode;
  /** The lock screen. */
  readonly children: React.ReactNode;
}

/**
 * The one frame around the lock screen in CRM, WMS, Projects and Pulse: a quiet top bar with the
 * app's logo, the organization name and the app switcher, then the lock card. No navigation and no
 * create buttons, because nothing in a locked app can be opened or made. Server safe.
 */
export function PlanLockFrame({ logo, orgName, switcher, children }: PlanLockFrameProps): React.JSX.Element {
  return (
    <div className="ks-planlock-frame" data-testid="plan-lock-frame">
      <header className="ks-planlock-bar">
        <div className="ks-planlock-bar-logo">{logo}</div>
        <div className="ks-planlock-bar-end">
          {orgName ? <span className="ks-planlock-bar-org">{orgName}</span> : null}
          {switcher}
        </div>
      </header>
      <main id="main-content" className="ks-planlock-main">
        {children}
      </main>
    </div>
  );
}

/** Centered card: app icon, title, one or two sentences, the main link and a way back. */
export function PlanLockScreen({ app, lock, className }: PlanLockScreenProps): React.JSX.Element {
  const meta = PLAN_LOCK_POINTS[app];
  const headingId = `ks-planlock-title-${app}`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={lock.testId}
      data-app={app}
      className={className ? `ks-planlock ${className}` : 'ks-planlock'}
    >
      <div className="ks-planlock-card">
        <div className="ks-planlock-mark">
          <AppIcon app={app} size={56} />
          <LockBadge />
        </div>
        <p className="ks-planlock-eyebrow">{meta.name}</p>
        <h1 id={headingId} className="ks-planlock-title">
          {lock.title}
        </h1>
        <p className="ks-planlock-body">{lock.body}</p>
        {lock.priceLine ? <p className="ks-planlock-price">{lock.priceLine}</p> : null}
        <div className="ks-planlock-actions">
          {lock.primary ? (
            <a href={lock.primary.href} data-testid="plan-lock-primary" className="ks-planlock-button ks-planlock-button-primary">
              {lock.primary.label}
            </a>
          ) : null}
          <a
            href={lock.secondary.href}
            data-testid="plan-lock-secondary"
            className={
              lock.primary ? 'ks-planlock-button ks-planlock-button-quiet' : 'ks-planlock-button ks-planlock-button-primary'
            }
          >
            {lock.secondary.label}
          </a>
        </div>
        <ul className="ks-planlock-points" aria-label={`What ${meta.name} does`}>
          {meta.points.map((point) => (
            <li key={point} className="ks-planlock-point">
              <PointIcon />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
