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
 *   - any link to one of the app's create screens (`writePaths`, for example `/jobs/new`),
 *   - with `writeLabel`: any button, link or menu row whose label starts with a word that changes
 *     data ("Create client", "Add a labor class", "Bulk import/update", "Save"). The guard puts
 *     the `data-plan-write` mark on these by itself, so an app with hundreds of screens (the WMS)
 *     is covered without a mark on every button, and a new button cannot be missed.
 * Marked controls look held back (see view-only.css) and still take a press: the press opens the
 * dialog.
 *
 * What never counts, whatever its label says (review round 4): the way out of view only. The plan
 * banner and its button ("Add WMS", "Update card"), the lock screen, the app switcher, and any link
 * that leaves this app for another address (the Portal). These are never marked, never dimmed and
 * never caught, so one press on the banner's button lands on Billing from every app. A create screen opened by typing its address is covered too: the app shell shows
 * `ViewOnlyPage` in place of the form, inside the app frame, with the same words and a way back.
 * When the server still refuses a change (a control nothing marked), the app calls `askViewOnly()`
 * and the same dialog opens, so the answer always has the banner's words and button.
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
  /**
   * Labels that start a change, for example `WRITE_LABEL`. Every button, link and menu row whose
   * label matches gets the `data-plan-write` mark while the plan is view only. Leave it out and
   * only hand marked controls count.
   */
  readonly writeLabel?: RegExp;
  /** Labels that match `writeLabel` but only change what this person sees ("Add filter"). Never marked. */
  readonly readLabel?: RegExp;
  /**
   * `inline`: the app shell shows `ViewOnlyPage` in place of a create screen, so the guard opens
   * no dialog for it. `cover` (default) keeps the old behavior: the dialog covers the page.
   */
  readonly writePage?: 'cover' | 'inline';
}

/**
 * The words a write control starts with across the KitStak apps: "Create client", "Add user",
 * "New order", "Edit", "Bulk import/update", "Import clients", "Update clients", "Save the rate",
 * "Delete", "Upload", "Invite", "Duplicate", "Receive", "Log work". Matched at the start of the
 * label only, so "Export", "Open" or "Newest first" never match.
 */
export const WRITE_LABEL =
  /^(add|create|new|edit|bulk (import|update|edit)|import|update|save|delete|remove|upload|invite|duplicate|clone|rename|receive|log (work|production|time|hours|many)|assign|archive|restore|activate|deactivate|approve|adjust|transfer|connect|re-create|change status)\b/i;

/**
 * Labels that start with a write word but change no data: a person's own view of a list (filters,
 * columns, saved views, a new tab) and pages that only list things ("Import and export", "Import
 * details"). These keep working in view only. A whole part of a page can opt out the same way with
 * the `data-plan-read` attribute (a filter popover, a column chooser, a saved views menu).
 */
export const READ_LABEL =
  /^(add|new|edit|save|remove|delete|update|create|rename|duplicate|restore)\b.*\b(filter|filters|column|columns|view|views|search|tab|window|condition|sort|group|layout|defaults)\b|^import (and|&) export\b|^import (details|history|log|results|batches)\b/i;

/**
 * Controls that pick something and do not start a change, whatever their label says: a tab named
 * "New", a radio, a switch, a checkbox, a row of a list box.
 */
const CHOICES = '[role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * The shared plan surfaces. Everything inside them is the way OUT of view only: the banner's
 * button, the lock screen's button, the "Add" rows of the app switcher. Never marked, never caught.
 */
const PLAN_SURFACES = '.ks-planbanner, .ks-planlock-frame, .ks-appswitcher-menu, [data-plan-way-out]';
/** Parts of the page the guard leaves alone: its own dialog and page, a part that opted out, the plan surfaces. */
const LEFT_ALONE = `.ks-viewonly, .ks-viewonly-page, [data-plan-read], ${PLAN_SURFACES}`;

/**
 * True when a control is a link that leaves this app (another origin, such as the Portal's Billing).
 * A change to this app's data cannot start there. PURE apart from reading the page address;
 * exported for tests.
 */
export function leavesApp(control: { closest(selector: string): unknown } | null, here: string = typeof window === 'undefined' ? '' : window.location.href): boolean {
  const link = control?.closest('a[href]') as { readonly href?: string; getAttribute?(name: string): string | null } | null | undefined;
  const href = link?.href ?? link?.getAttribute?.('href') ?? null;
  if (!href || here === '') return false;
  try {
    return new URL(href, here).origin !== new URL(here).origin;
  } catch {
    return false;
  }
}

/** True when the guard must not touch this element: see `LEFT_ALONE` and `leavesApp`. Exported for tests. */
export function isWayOut(control: Element): boolean {
  return control.closest(LEFT_ALONE) !== null || leavesApp(control);
}

const MARK = 'data-plan-write';
const AUTO = 'data-plan-write-auto';
const CANDIDATES = 'button, a[href], [role="button"], [role="menuitem"], input[type="submit"]';

/** The label a person reads or hears for a control. PURE, exported for tests. */
export function controlLabel(control: { getAttribute(name: string): string | null; textContent: string | null }): string {
  const text = (control.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text !== '' ? text : (control.getAttribute('aria-label') ?? control.getAttribute('title') ?? control.getAttribute('value') ?? '').trim();
}

/** True when a label starts a change. PURE, exported for tests. */
export function isWriteLabel(label: string, writeLabel: RegExp, readLabel: RegExp = READ_LABEL): boolean {
  const text = label.replace(/^[+＋]\s*/, '').trim();
  return text !== '' && writeLabel.test(text) && !readLabel.test(text);
}

/** The parts of a React fiber this file reads. React keeps one per element it renders. */
interface FiberNode {
  readonly tag: number;
  readonly return: FiberNode | null;
  readonly child: FiberNode | null;
  readonly sibling: FiberNode | null;
  readonly alternate: FiberNode | null;
  readonly stateNode: unknown;
}

/** React's number for the fiber at the top of a tree (the root). */
const HOST_ROOT = 3;

/** Elements that are known to be on the page for good. An element never goes back to "not yet". */
const settled = new WeakSet<Element>();

/**
 * True once React has put this element on the page for good: it was hydrated and that work was
 * committed, or React made it in the browser. PURE apart from the cache, exported for tests.
 *
 * Why it matters: a page streams in pieces and each piece is hydrated when its code arrives. An
 * attribute put on server HTML that React still has to compare is reported as a hydration
 * mismatch in the console. So the mark waits for hydration. A press is still caught before that,
 * because presses are judged by the label, not by the mark.
 *
 * Why "React has seen it" is not enough: React attaches itself to an element (a `__reactFiber$...`
 * key) while it is still working. That work can be thrown away and done again, for example when a
 * part of the page waits for code, or when something more urgent happens first. The second time
 * React compares the element with its props again, and a mark put on in between is a mismatch.
 * Only a commit ends the comparing. So this walks from the root of React's CURRENT tree (the one
 * that is committed) down to the element. Work in progress hangs on the other tree and is not
 * found. When React's inner shape is not what this expects, the answer is false: no mark, and
 * never a console error.
 */
export function isSettled(control: Element): boolean {
  if (settled.has(control)) return true;
  let fiber: FiberNode | null = null;
  for (const key in control) {
    if (key.startsWith('__reactFiber$')) {
      fiber = (control as unknown as Record<string, FiberNode | null>)[key] ?? null;
      break;
    }
  }
  if (!fiber) return false;
  // The way up names the element's ancestors. Each one may be the committed fiber or its twin.
  const path: FiberNode[] = [];
  for (let node: FiberNode | null = fiber; node; node = node.return) {
    path.push(node);
    if (path.length > 10_000) return false;
  }
  const top = path[path.length - 1]!;
  if (top.tag !== HOST_ROOT) return false;
  const current = (top.stateNode as { readonly current?: FiberNode | null } | null)?.current ?? null;
  if (!current || (current !== top && current !== top.alternate)) return false;
  // The way down follows child links of the committed tree only.
  let at: FiberNode = current;
  for (let index = path.length - 2; index >= 0; index -= 1) {
    const want = path[index]!;
    let found: FiberNode | null = null;
    for (let child = at.child; child; child = child.sibling) {
      if (child === want || (want.alternate !== null && child === want.alternate)) {
        found = child;
        break;
      }
    }
    if (!found) return false;
    at = found;
  }
  if (at.stateNode !== control) return false;
  settled.add(control);
  return true;
}

/**
 * Puts the mark on every control whose label starts a change, and takes it off when the label
 * stops matching. Returns how many matching controls could not be marked yet (hydration not done).
 */
function markWriteControls(root: ParentNode, writeLabel: RegExp, readLabel: RegExp): number {
  let waiting = 0;
  for (const control of root.querySelectorAll(CANDIDATES)) {
    // The view only dialog itself, a part of the page that opted out, the plan banner and every other
    // way out of view only, and hand marked controls are left alone. A mark this guard put on
    // earlier (before the control moved into a banner, say) comes off again.
    const auto = control.hasAttribute(AUTO);
    if (isWayOut(control)) {
      if (auto) {
        control.removeAttribute(MARK);
        control.removeAttribute(AUTO);
      }
      continue;
    }
    if (control.hasAttribute(MARK) && !auto) continue;
    // A control that is switched off already looks held back, and cannot be pressed.
    const off = control.matches(':disabled, [aria-disabled="true"]') || control.matches(CHOICES);
    const write = !off && isWriteLabel(controlLabel(control), writeLabel, readLabel);
    if (write && !auto) {
      if (!isSettled(control)) {
        waiting += 1;
        continue;
      }
      control.setAttribute(MARK, '');
      control.setAttribute(AUTO, '');
    } else if (!write && auto) {
      control.removeAttribute(MARK);
      control.removeAttribute(AUTO);
    }
  }
  return waiting;
}

const ASK_EVENT = 'kitstak:view-only';

/**
 * Opens the view only dialog from code, for an app whose create dialogs open through a store and
 * not through one button (the CRM): the store asks here instead of opening the form.
 */
export function askViewOnly(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ASK_EVENT));
}

/**
 * For an app's toast or error helper: call it with the server's error message before showing it.
 * When the message is the view only refusal (`VIEW_ONLY_MESSAGE`) and the guard is on this page,
 * the view only dialog opens, with the banner's words and button, and this returns true: the
 * caller then shows no toast. Anything else returns false and the caller goes on as before.
 */
export function answerViewOnly(...messages: readonly (string | null | undefined)[]): boolean {
  if (typeof document === 'undefined') return false;
  if (!messages.some((message) => typeof message === 'string' && message.includes(VIEW_ONLY_MESSAGE))) return false;
  if (document.documentElement.dataset.planViewOnly !== 'true') return false;
  askViewOnly();
  return true;
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

/** The words of the view only message: the banner's own sentence, then what still works. */
function viewOnlyText(notice: PlanBannerNotice | null): string {
  return `${notice?.text ?? VIEW_ONLY_MESSAGE} You can still open, read and export everything.`;
}

export interface ViewOnlyPageProps {
  /** The plan banner's notice. Its words and its button are repeated here. */
  readonly notice: PlanBannerNotice | null;
  /** Where "Go back" leads. Default: the app's home. */
  readonly homeHref?: string;
}

/**
 * A create screen opened by its address while the plan is view only. The app shell renders this in
 * place of the form, inside the app frame, so the top bar, the banner and the way to every other
 * screen stay where they are. Same words and same button as the dialog.
 */
export function ViewOnlyPage({ notice, homeHref = '/' }: ViewOnlyPageProps): React.JSX.Element {
  const titleId = React.useId();
  return (
    <section className="ks-viewonly-page" data-testid="view-only-page" aria-labelledby={titleId}>
      <div className="ks-viewonly-card">
        <span className="ks-viewonly-mark">
          <LockIcon />
        </span>
        <h1 id={titleId} className="ks-viewonly-title">
          Your plan is view only right now
        </h1>
        <p className="ks-viewonly-text" data-testid="view-only-text">
          {viewOnlyText(notice)}
        </p>
        <div className="ks-viewonly-actions">
          {notice?.action ? (
            <a href={notice.action.href} className="ks-viewonly-primary" data-testid="view-only-action">
              {notice.action.label}
            </a>
          ) : null}
          <a href={homeHref} className="ks-viewonly-secondary" data-testid="view-only-back">
            Go back
          </a>
        </div>
      </div>
    </section>
  );
}

export function ViewOnlyGuard({ active, notice, pathname, writePaths, homeHref = '/', writeLabel, readLabel, writePage = 'cover' }: ViewOnlyGuardProps): React.JSX.Element | null {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const [asked, setAsked] = React.useState(false);
  const titleId = React.useId();
  const textId = React.useId();
  const onWritePage = active && writePage === 'cover' && isWritePath(pathname, writePaths);
  const open = active && (asked || onWritePage);

  // With `writeLabel`: mark every control whose label starts a change, now and as the page changes.
  React.useEffect(() => {
    if (!active || !writeLabel) return;
    const reads = readLabel ?? READ_LABEL;
    let frame = 0;
    let retry = 0;
    let tries = 0;
    const run = () => {
      frame = 0;
      window.clearTimeout(retry);
      // Controls that are still server HTML are marked a little later, once React has hydrated them
      // and committed that work. Hydration changes nothing in the page, so no observer reports it:
      // look again shortly, for up to 12 seconds after the page last changed.
      if (markWriteControls(document, writeLabel, reads) > 0 && tries < 30) {
        tries += 1;
        retry = window.setTimeout(schedule, 400);
      }
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(run);
    };
    schedule();
    const observer = new MutationObserver(() => {
      tries = 0;
      schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-label'] });
    return () => {
      observer.disconnect();
      window.clearTimeout(retry);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      for (const control of document.querySelectorAll(`[${AUTO}]`)) {
        control.removeAttribute(MARK);
        control.removeAttribute(AUTO);
      }
    };
  }, [active, writeLabel, readLabel]);

  // A press on anything that starts a change is caught before the app sees it.
  React.useEffect(() => {
    if (!active) return;
    document.documentElement.dataset.planViewOnly = 'true';
    const paths = writePaths ?? [];
    const reads = readLabel ?? READ_LABEL;
    const starts = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      if (target.closest('.ks-viewonly, .ks-viewonly-page')) return false;
      // The banner's own button, the lock screen, the app switcher and links to the Portal are the
      // way out of view only. A press on them goes straight through, whatever the label says.
      if (target.closest(PLAN_SURFACES) || leavesApp(target)) return false;
      if (target.closest('[data-plan-write]')) return true;
      // A control that appeared in this same frame may not carry the mark yet: read its label now.
      if (writeLabel) {
        const control = target.closest(CANDIDATES);
        if (control && !control.matches(CHOICES) && !control.closest('[data-plan-read]') && isWriteLabel(controlLabel(control), writeLabel, reads)) return true;
      }
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
  }, [active, writePaths, writeLabel, readLabel]);

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
          {viewOnlyText(notice)}
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
