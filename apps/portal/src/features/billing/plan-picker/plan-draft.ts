/**
 * An unsaved change to the apps in a free trial, kept in this browser so a refresh or a closed tab
 * does not lose it (docs/billing/SPEC.md 5.6). The plan to pay for and the signup cart are saved on
 * the server instead. A paid plan keeps no draft: its picker always opens on the plan as it is.
 *
 * A draft is tied to the plan it started from (`base`). When the plan changes (someone saved, a
 * renewal ran), the draft is dropped. It is also dropped after a day. Storage can be blocked or
 * full: every call is safe to fail, and the picker works the same without it.
 */
import { normalizeSelection, type PlanSelection } from '@kitstak/billing/catalog';

const PREFIX = 'kitstak.plan-draft.';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredDraft {
  readonly base: string;
  readonly savedAt: number;
  readonly selection: unknown;
}

export function readPlanDraft(key: string, base: string, now: number = Date.now()): PlanSelection | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredDraft> | null;
    if (!stored || stored.base !== base || typeof stored.savedAt !== 'number' || now - stored.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(PREFIX + key);
      return null;
    }
    // The stored value is cleaned like any other input. No price is ever stored.
    return normalizeSelection(stored.selection);
  } catch {
    return null;
  }
}

export function writePlanDraft(key: string, base: string, selection: PlanSelection, now: number = Date.now()): void {
  try {
    const stored: StoredDraft = { base, savedAt: now, selection };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(stored));
  } catch {
    // A convenience only. Losing it is fine.
  }
}

export function clearPlanDraft(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to clear.
  }
}
