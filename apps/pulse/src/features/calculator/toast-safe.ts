/**
 * Keeps a dialog or drawer open when a person clicks a toast (for example its Undo button).
 * Radix treats that click as "outside" and would close the panel under the toast.
 *
 *   <DrawerContent onInteractOutside={keepOpenForToasts} ...>
 */
export function keepOpenForToasts(event: Event): void {
  // Radix wraps the real pointer or focus event in a custom event.
  const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
  const target = original?.target ?? event.target;
  if (target instanceof Element && target.closest('[data-sonner-toaster]')) event.preventDefault();
}
