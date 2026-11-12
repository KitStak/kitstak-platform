/**
 * Scoping rules for single-character view shortcuts (WCAG 2.1.4): they only fire while focus is
 * on the view's own shortcut region (not on a button, event, card or field inside it), never
 * with modifiers, and never while typing.
 */
const INTERACTIVE =
  'button, a[href], input, select, textarea, [contenteditable="true"], [role="button"], [role="menuitem"], [role="option"], [role="dialog"], [role="menu"], [role="listbox"], [tabindex]:not([tabindex="-1"])';

export interface ShortcutKeyEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly target: EventTarget | null;
  readonly currentTarget?: EventTarget | null;
}

/** True when `event` may trigger a view shortcut whose region is `region`. */
export function isViewShortcut(event: ShortcutKeyEvent, region: Element | null, enabled: boolean): boolean {
  if (!enabled || !region || event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as Element | null;
  if (!target || !region.contains(target)) return false;
  if (target === region) return true;
  return !target.closest(INTERACTIVE) || target.closest(INTERACTIVE) === region;
}
