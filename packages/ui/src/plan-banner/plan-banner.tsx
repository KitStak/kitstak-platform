'use client';
/**
 * The one plan banner every KitStak app shows at the top of its shell (docs/billing/CONTRACTS.md
 * section 17, SPEC 9.2): one row, an icon by tone, the words, and one action as a real link. The
 * words and the link come from `planNoticeFor` in `@kitstak/billing`, so CRM, WMS, Projects, Pulse
 * and the Portal always say the same thing. This package does not import `@kitstak/billing`: the
 * props repeat the notice shape, and each app passes a `PlanNotice` straight in.
 *
 * Styling uses tokens.css custom properties only (see plan-banner.css), so the banner follows each
 * app's light and dark theme. It is a client component only because an info banner can be hidden for
 * the day. Warning and danger banners can never be hidden.
 */
import * as React from 'react';
import './plan-banner.css';

export interface PlanBannerNotice {
  readonly kind: string;
  readonly tone: 'info' | 'warning' | 'danger';
  readonly text: string;
  readonly action: { readonly label: string; readonly href: string } | null;
  readonly testId: string;
}

export interface PlanBannerProps {
  /** null renders nothing. */
  readonly notice: PlanBannerNotice | null;
  /** Info banners can be hidden for the day (localStorage key per kind). Warning and danger cannot. */
  readonly dismissible?: boolean;
  readonly className?: string;
}

/** Storage key of a hidden info banner. The value is the day it was hidden (`YYYY-MM-DD`). */
export function planBannerStorageKey(kind: string): string {
  return `kitstak-notice-hidden:${kind}`;
}

/** The day used for "hidden for the day". Changes at midnight UTC, the same in every app. */
export function planBannerDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** True when this banner may be hidden by the person: only info banners, and only when asked for. */
export function planBannerCanHide(notice: PlanBannerNotice, dismissible: boolean | undefined): boolean {
  return dismissible === true && notice.tone === 'info';
}

const CHANGE_EVENT = 'kitstak-notice';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readHidden(kind: string): boolean {
  try {
    return window.localStorage.getItem(planBannerStorageKey(kind)) === planBannerDay();
  } catch {
    // Storage is blocked (private mode, strict settings): the banner simply stays.
    return false;
  }
}

function useHiddenToday(kind: string, enabled: boolean): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => (enabled ? readHidden(kind) : false),
    () => false,
  );
}

function ToneIcon({ tone }: { readonly tone: PlanBannerNotice['tone'] }) {
  const common = {
    'aria-hidden': true,
    width: 18,
    height: 18,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'ks-planbanner-icon',
  } as const;
  if (tone === 'warning') {
    return (
      <svg {...common}>
        <path d="M10 3.2 17.4 16H2.6L10 3.2Z" />
        <path d="M10 8.2v3.6" />
        <path d="M10 14.1v.1" />
      </svg>
    );
  }
  if (tone === 'danger') {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="7.2" />
        <path d="M10 6.4v4.2" />
        <path d="M10 13.4v.1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 9.2v4.4" />
      <path d="M10 6.5v.1" />
    </svg>
  );
}

function CloseIcon() {
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
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

/** One full width row. `role="status"` for info, `role="alert"` for warning and danger. */
export function PlanBanner({ notice, dismissible, className }: PlanBannerProps): React.JSX.Element | null {
  const canHide = notice !== null && planBannerCanHide(notice, dismissible);
  const hidden = useHiddenToday(notice?.kind ?? '', canHide);
  if (notice === null || hidden) return null;
  const urgent = notice.tone === 'warning' || notice.tone === 'danger';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      data-testid={notice.testId}
      data-tone={notice.tone}
      data-kind={notice.kind}
      className={className ? `ks-planbanner ${className}` : 'ks-planbanner'}
    >
      <div className="ks-planbanner-inner">
        <ToneIcon tone={notice.tone} />
        <p className="ks-planbanner-text">{notice.text}</p>
        {notice.action ? (
          <a href={notice.action.href} data-testid="plan-notice-action" className="ks-planbanner-action">
            {notice.action.label}
          </a>
        ) : null}
        {canHide ? (
          <button
            type="button"
            aria-label="Hide for today"
            title="Hide for today"
            className="ks-planbanner-close"
            onClick={() => {
              try {
                window.localStorage.setItem(planBannerStorageKey(notice.kind), planBannerDay());
              } catch {
                // Storage is blocked: nothing to remember, the banner stays.
              }
              window.dispatchEvent(new Event(CHANGE_EVENT));
            }}
          >
            <CloseIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}
