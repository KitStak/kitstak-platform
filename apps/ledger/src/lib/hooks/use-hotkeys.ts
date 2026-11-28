'use client';
/**
 * Single-key and chord shortcuts that never fire while typing in a field.
 *   useHotkey('c', () => openQuickAdd());
 *   useHotkey('mod+k', togglePalette, { allowInInputs: true });
 *   useHotkey(['j', 'ArrowDown'], next);
 * `mod` = ⌘ on Mac, Ctrl elsewhere.
 */
import { useEffect, useRef } from 'react';

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
  );
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  const mod = event.metaKey || event.ctrlKey;
  if (wantMod !== mod) return false;
  if (wantAlt !== event.altKey) return false;
  if (parts.includes('shift') && !event.shiftKey) return false;
  if (!wantShift && event.shiftKey && key.length === 1 && /[a-z]/.test(key)) return false;
  return event.key.toLowerCase() === key;
}

export interface HotkeyOptions {
  readonly allowInInputs?: boolean;
  /** Keep firing while a modal dialog / drawer is open (default false). */
  readonly allowInDialogs?: boolean;
  readonly enabled?: boolean;
  readonly preventDefault?: boolean;
}

export function useHotkey(combos: string | readonly string[], handler: (event: KeyboardEvent) => void, options: HotkeyOptions = {}) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const list = typeof combos === 'string' ? [combos] : combos;
  const signature = list.join('|');
  const { allowInInputs = false, allowInDialogs = false, enabled = true, preventDefault = true } = options;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!allowInInputs && isEditableTarget(event.target)) return;
      if (!allowInDialogs && document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (!signature.split('|').some((combo) => matches(event, combo))) return;
      if (preventDefault) event.preventDefault();
      ref.current(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [signature, allowInInputs, allowInDialogs, enabled, preventDefault]);
}
