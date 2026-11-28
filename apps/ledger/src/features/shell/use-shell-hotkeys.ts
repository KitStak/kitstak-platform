'use client';
/**
 * Global shortcuts (SPEC 6): mod+k and / (search and commands), ? (shortcut sheet), n (new
 * invoice) and g then a letter (go to, from src/lib/nav.ts).
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isEditableTarget, useHotkey } from '@/lib/hooks/use-hotkeys';
import { chordTargets } from '@/lib/nav';
import { routes } from '@/lib/routes';
import { PALETTE_INPUT, catchTypeAhead } from '@/features/command/type-ahead';
import { useShell } from './shell-context';
import { useShellStore } from './store';

/** True while a dialog, menu or the palette is open: single letter shortcuts stay quiet. */
function overlayIsOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [cmdk-dialog]') !== null;
}

export function useShellHotkeys(): void {
  const router = useRouter();
  const { rights } = useShell();
  const store = useShellStore;
  useHotkey(
    'mod+k',
    () => {
      const state = store.getState();
      if (state.paletteOpen) state.closePalette();
      else {
        catchTypeAhead(PALETTE_INPUT);
        state.openPalette();
      }
    },
    { allowInInputs: true, allowInDialogs: true },
  );
  useHotkey('/', () => {
    catchTypeAhead(PALETTE_INPUT);
    store.getState().openPalette();
  });
  useHotkey('?', () => store.getState().openShortcuts());

  const pendingG = useRef<number | null>(null);
  useEffect(() => {
    const chords = chordTargets(rights);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      if (overlayIsOpen()) return;
      const key = event.key.toLowerCase();
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = chords[key];
        if (target) {
          event.preventDefault();
          router.push(target);
        }
        return;
      }
      if (key === 'g') {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
        return;
      }
      // A capital letter (Caps Lock, Shift) is text, not a shortcut.
      if (event.key === 'n' && rights.includes('invoice:write')) {
        event.preventDefault();
        router.push(routes.newInvoice());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (pendingG.current !== null) window.clearTimeout(pendingG.current);
      pendingG.current = null;
    };
  }, [router, rights]);
}
