/**
 * The app a person came from to fix something on Billing, kept for this browser tab.
 *
 * A late payment banner in the CRM links to `/billing?fix=payment&from=crm`. Fixing the card goes
 * through the card page and back, and the link's `from` is gone by then. It is kept here, so the
 * line that confirms the fix ("Card updated. Your payment went through.") can offer the way back
 * ("Back to CRM"). Session storage only: it is gone when the tab closes, and it never leaves the
 * browser. Every read and write is safe when storage is blocked.
 *
 * Only the app id and a path are stored. The link is built from the Portal's own list of app
 * addresses, and the path is checked again when it is read (`appReturnPath`).
 */
import { appReturnPath } from './routes';

const KEY = 'kitstak.portal.appReturn';
const MAX_AGE_MS = 60 * 60 * 1000;

export interface AppReturn {
  /** The app id from the link: crm, wms, projects or pulse. */
  readonly from: string;
  /** The page in that app the person left, or null for the app's front door. */
  readonly path: string | null;
}

export function saveAppReturn(from: string, path: string | null): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ from, path, savedAt: Date.now() }));
  } catch {
    // A convenience only. Without storage the confirm line has no way back and the app switcher is one press away.
  }
}

export function readAppReturn(): AppReturn | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { from?: unknown; path?: unknown; savedAt?: unknown };
    if (typeof value.from !== 'string' || typeof value.savedAt !== 'number') return null;
    if (Date.now() - value.savedAt > MAX_AGE_MS) return null;
    return { from: value.from, path: typeof value.path === 'string' ? appReturnPath(value.path) : null };
  } catch {
    return null;
  }
}

export function clearAppReturn(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
