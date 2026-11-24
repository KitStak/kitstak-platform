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
