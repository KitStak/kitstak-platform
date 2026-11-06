/** Pure decision for the route progress bar: does this link click start an in-app navigation? */
export interface LinkClick {
  readonly href: string;
  readonly target: string;
  readonly download: boolean;
  readonly button: number;
  readonly modified: boolean;
  readonly defaultPrevented: boolean;
  /** window.location.href at click time. */
  readonly current: string;
}

export function shouldTrackLinkClick(click: LinkClick): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.modified || click.download) return false;
  if (click.target && click.target !== '_self') return false;
  let next: URL;
  let now: URL;
  try {
    next = new URL(click.href);
    now = new URL(click.current);
  } catch {
    return false;
  }
  if (next.origin !== now.origin) return false;
  if (next.protocol !== 'http:' && next.protocol !== 'https:') return false;
  // Same page (hash jumps, identical URL) never navigates.
  return next.pathname !== now.pathname;
}
