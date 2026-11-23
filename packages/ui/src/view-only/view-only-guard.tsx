'use client';
/**
 * View only, told BEFORE a form opens (docs/billing/SPEC.md section 9.4).
 *
 * When a plan is view only (the trial ended, a payment is late, the plan is paused or ended) the
 * server refuses every change. Without this guard a person would fill in a whole form first and
 * hear "no" at the last click. With it, a press on anything that starts a change opens one small
 * dialog instead: why the plan is view only, in the banner's own words, and the banner's button.
 * No form opens.
 *
 * What counts as "starts a change":
 *   - any element marked `data-plan-write` (a button that opens a create or edit dialog),
 *   - any link to one of the app's create screens (`writePaths`, for example `/jobs/new`).
 * A create screen opened by typing its address is covered too: the same message is shown over the
 * page, with a way back, and it cannot be closed to reach the form.
 *
 * The server stays the judge. This is the polite half: it saves the person the wasted work.
 * Styling uses tokens.css custom properties only (see view-only.css), so it follows each app's theme.
 */
import * as React from 'react';
import type { PlanBannerNotice } from '../plan-banner';
import './view-only.css';

/** The one sentence every app's server answers with when a change is refused in view only. */
export const VIEW_ONLY_MESSAGE = 'Your plan is view only right now. Pick a plan in the Portal to make changes.';

export interface ViewOnlyGuardProps {
  /** True while the plan is view only. False renders nothing and listens to nothing. */
  readonly active: boolean;
  /** The plan banner's notice. Its words and its button are repeated in the dialog. */
  readonly notice: PlanBannerNotice | null;
  /** The current path, from the app's router, so a create screen opened by address is caught. */
  readonly pathname: string;
  /** This app's create and edit screens. A string matches the whole path or the end of it. */
  readonly writePaths?: readonly (string | RegExp)[];
  /** Where "Go back" leads when a create screen was opened by address. Default: the app's home. */
  readonly homeHref?: string;
}

const ASK_EVENT = 'kitstak:view-only';

/**
 * Opens the view only dialog from code, for an app whose create dialogs open through a store and
 * not through one button (the CRM): the store asks here instead of opening the form.
 */
export function askViewOnly(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ASK_EVENT));
}

/** True when `pathname` is one of the app's create or edit screens. PURE, exported for tests. */
export function isWritePath(pathname: string, writePaths: readonly (string | RegExp)[] = []): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return writePaths.some((pattern) => (typeof pattern === 'string' ? path === pattern || path.endsWith(pattern) : pattern.test(path)));
}

/** The link an element points to, as a path on this origin, or null (another site, no link). */
function pathOfLink(target: Element): string | null {
  const link = target.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return null;
  try {
    const url = new URL(link.href, window.location.href);
    return url.origin === window.location.origin ? url.pathname : null;
  } catch {
    return null;
  }
}

function LockIcon() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function ViewOnlyGuard({ active, notice, pathname, writePaths, homeHref = '/' }: ViewOnlyGuardProps): React.JSX.Element | null {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const [asked, setAsked] = React.useState(false);
  const titleId = React.useId();
  const textId = React.useId();
  const onWritePage = active && isWritePath(pathname, writePaths);
  const open = active && (asked || onWritePage);

  // A press on anything that starts a change is caught before the app sees it.
  React.useEffect(() => {
    if (!active) return;
    document.documentElement.dataset.planViewOnly = 'true';
    const paths = writePaths ?? [];
    const starts = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      if (target.closest('.ks-viewonly')) return false;
      if (target.closest('[data-plan-write]')) return true;
      const path = pathOfLink(target);
      return path !== null && isWritePath(path, paths);
    };
    const stop = (event: Event) => {
      if (!starts(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setAsked(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') stop(event);
    };
    // Capture phase on the document: this runs before the app's own handlers and before the router.
    document.addEventListener('click', stop, true);
    document.addEventListener('auxclick', stop, true);
    document.addEventListener('keydown', onKey, true);
    const onAsk = () => setAsked(true);
    window.addEventListener(ASK_EVENT, onAsk);
    return () => {
      window.removeEventListener(ASK_EVENT, onAsk);
      delete document.documentElement.dataset.planViewOnly;
      document.removeEventListener('click', stop, true);
      document.removeEventListener('auxclick', stop, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [active, writePaths]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!active) return null;
  const close = () => setAsked(false);
  return (
    <dialog
      ref={dialogRef}
      className="ks-viewonly"
      data-testid="view-only-dialog"
      data-mode={onWritePage ? 'page' : 'dialog'}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onClose={close}
      onCancel={(event) => {
        // On a create screen there is no form to go back to, so Escape does not close the message.
        if (onWritePage) event.preventDefault();
      }}
      onClick={(event) => {
        // A press on the backdrop closes the small dialog.
        if (!onWritePage && event.target === dialogRef.current) close();
      }}
    >
      <div className="ks-viewonly-card">
        <span className="ks-viewonly-mark">
          <LockIcon />
        </span>
        <h2 id={titleId} className="ks-viewonly-title">
          Your plan is view only right now
        </h2>
        <p id={textId} className="ks-viewonly-text" data-testid="view-only-text">
          {notice?.text ?? VIEW_ONLY_MESSAGE} You can still open, read and export everything.
        </p>
        <div className="ks-viewonly-actions">
          {notice?.action ? (
            <a href={notice.action.href} className="ks-viewonly-primary" data-testid="view-only-action">
              {notice.action.label}
            </a>
          ) : null}
          {onWritePage ? (
            <a href={homeHref} className="ks-viewonly-secondary" data-testid="view-only-back">
              Go back
            </a>
          ) : (
            <button type="button" className="ks-viewonly-secondary" data-testid="view-only-close" onClick={close} autoFocus={!notice?.action}>
              Close
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
