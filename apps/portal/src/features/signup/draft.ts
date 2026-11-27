/**
 * The three identity fields of the signup form (name, work email, company), kept in THIS TAB until
 * the account exists, so a refresh does not empty the form (docs/billing/SPEC.md 5.6). The link from
 * the marketing wizard carries them after the "#", and that part is taken out of the address bar
 * the moment it is read, so without this a refresh would show three empty fields.
 *
 * `sessionStorage` on purpose: it ends with the tab, it is never sent to a server, and no other
 * site can read it. The password is never stored. Storage can be blocked: every call is safe to fail.
 */
const KEY = 'kitstak.signup.identity';
const MAX = 320;

export interface SignupDraft {
  readonly name: string;
  readonly email: string;
  readonly company: string;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX) : '';
}

export function readSignupDraft(): SignupDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Record<string, unknown> | null;
    if (!stored || typeof stored !== 'object') return null;
    const draft = { name: clean(stored.name), email: clean(stored.email), company: clean(stored.company) };
    return draft.name || draft.email || draft.company ? draft : null;
  } catch {
    return null;
  }
}

export function writeSignupDraft(draft: SignupDraft): void {
  try {
    if (!draft.name && !draft.email && !draft.company) {
      window.sessionStorage.removeItem(KEY);
      return;
    }
    window.sessionStorage.setItem(KEY, JSON.stringify({ name: clean(draft.name), email: clean(draft.email), company: clean(draft.company) }));
  } catch {
    // A convenience only. The form works the same without it.
  }
}

export function clearSignupDraft(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
