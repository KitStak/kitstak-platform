'use client';
/**
 * Tooltip state for a menu trigger. The tooltip never shows while its menu is open (it would
 * cover the menu), is dismissed on pointerdown, and does not pop when the menu closes and
 * Radix returns focus to the trigger. Hover and keyboard focus still show it.
 *
 * `onCloseAutoFocus` also skips Radix's focus restore when the trigger has been removed (the
 * row was deleted / left the Unread tab) or when the caller asked to place focus itself.
 */
import { useCallback, useRef, useState, type RefObject } from 'react';

export interface MenuTooltip {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Spread on `<DropdownMenu>`: tracks the menu's open state. */
  readonly menuProps: { readonly onOpenChange: (open: boolean) => void };
  /** Pass to the menu content's `onCloseAutoFocus`. */
  readonly onCloseAutoFocus: (event: Event) => void;
  /** Call from a menu action that moves focus itself (e.g. removes the row). */
  readonly skipFocusRestore: () => void;
  /** Spread on the trigger: hover/blur re-arm the tooltip, pointerdown hides it. */
  readonly triggerProps: {
    readonly ref: RefObject<HTMLButtonElement | null>;
    readonly onPointerLeave: () => void;
    readonly onPointerDown: () => void;
    readonly onBlur: () => void;
  };
}

export function useMenuTooltip(): MenuTooltip {
  const [open, setOpen] = useState(false);
  const suppressed = useRef(false);
  const menuOpen = useRef(false);
  const skipRestore = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const onOpenChange = useCallback((next: boolean) => {
    if (next && (suppressed.current || menuOpen.current)) return;
    setOpen(next);
  }, []);
  const onMenuOpenChange = useCallback((next: boolean) => {
    menuOpen.current = next;
    if (next) {
      suppressed.current = true;
      setOpen(false);
    }
  }, []);
  const onCloseAutoFocus = useCallback((event: Event) => {
    suppressed.current = true;
    setOpen(false);
    if (skipRestore.current || !triggerRef.current?.isConnected) event.preventDefault();
    skipRestore.current = false;
  }, []);
  const skipFocusRestore = useCallback(() => {
    skipRestore.current = true;
  }, []);
  const hide = useCallback(() => {
    suppressed.current = true;
    setOpen(false);
  }, []);
  const rearm = useCallback(() => {
    if (!menuOpen.current) suppressed.current = false;
  }, []);
  return {
    open,
    onOpenChange,
    menuProps: { onOpenChange: onMenuOpenChange },
    onCloseAutoFocus,
    skipFocusRestore,
    triggerProps: { ref: triggerRef, onPointerLeave: rearm, onPointerDown: hide, onBlur: rearm },
  };
}
