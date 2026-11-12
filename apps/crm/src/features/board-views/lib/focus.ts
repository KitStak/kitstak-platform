/**
 * Return focus to whatever represents an item in the current view (Kanban card, calendar
 * event, timeline bar, file tile) — call it from the item drawer's close-auto-focus so focus
 * goes back to the invoker instead of an unrelated button. Returns true when it moved focus.
 */
export function focusItemInView(itemId: string | null | undefined): boolean {
  if (!itemId || typeof document === 'undefined') return false;
  const id = CSS.escape(itemId);
  const target =
    document.querySelector<HTMLElement>(`[data-card-id="${id}"]`) ??
    document.querySelector<HTMLElement>(`[data-item-id="${id}"][tabindex], button[data-item-id="${id}"], a[data-item-id="${id}"]`) ??
    document.querySelector<HTMLElement>(`[data-item-id="${id}"] [tabindex="0"], [data-item-id="${id}"] button`);
  if (!target) return false;
  target.focus({ preventScroll: false });
  return document.activeElement === target;
}
