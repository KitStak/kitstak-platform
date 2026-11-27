/**
 * The invite a person was in the middle of, kept for this browser tab.
 *
 * When adding a seat for an invite fails because the card is declined, the fix is on the Billing
 * page ("Update card"). The addresses and the role are kept here, so the way back ("Back to your
 * invite") finds the form as it was. Session storage only: it is gone when the tab closes, and it
 * never leaves the browser. Every read and write is safe when storage is blocked.
 */
const KEY = 'kitstak.portal.inviteDraft';
const MAX_AGE_MS = 60 * 60 * 1000;

export interface InviteDraft {
  readonly emails: string;
  readonly role: string;
  readonly savedAt: number;
}

export function saveInviteDraft(emails: string, role: string): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ emails, role, savedAt: Date.now() } satisfies InviteDraft));
  } catch {
    // A convenience only. Without storage the person types the address again.
  }
}

export function readInviteDraft(): InviteDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<InviteDraft>;
    if (typeof value.emails !== 'string' || typeof value.role !== 'string' || typeof value.savedAt !== 'number') return null;
    if (value.emails.trim() === '' || Date.now() - value.savedAt > MAX_AGE_MS) return null;
    return { emails: value.emails, role: value.role, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

export function clearInviteDraft(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * The people an invite could not reach because every paid seat was in use. The form sends the
 * invites that fit and offers seats for the rest. A reload must not lose the rest without a word,
 * so they are kept for this tab until they are sent or the person says "Not now".
 */
const WAITING_KEY = 'kitstak.portal.inviteWaiting';
const WAITING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface InviteWaiting {
  readonly orgId: string;
  readonly emails: readonly string[];
  readonly role: string;
  /** The server's own sentence for why they wait ("All 5 seats are in use. Add a seat first."). */
  readonly message: string;
}

export function saveInviteWaiting(waiting: InviteWaiting): void {
  try {
    window.sessionStorage.setItem(WAITING_KEY, JSON.stringify({ ...waiting, savedAt: Date.now() }));
  } catch {
    // A convenience only. Without storage the addresses stay in the field until the page is left.
  }
}

export function readInviteWaiting(orgId: string): InviteWaiting | null {
  try {
    const raw = window.sessionStorage.getItem(WAITING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<InviteWaiting> & { savedAt?: unknown };
    if (value.orgId !== orgId || typeof value.role !== 'string' || typeof value.message !== 'string' || typeof value.savedAt !== 'number') return null;
    if (Date.now() - value.savedAt > WAITING_MAX_AGE_MS) return null;
    const emails = Array.isArray(value.emails) ? value.emails.filter((email): email is string => typeof email === 'string' && email.trim() !== '') : [];
    if (emails.length === 0) return null;
    return { orgId, emails, role: value.role, message: value.message };
  } catch {
    return null;
  }
}

export function clearInviteWaiting(): void {
  try {
    window.sessionStorage.removeItem(WAITING_KEY);
  } catch {
    // Nothing to clear.
  }
}
