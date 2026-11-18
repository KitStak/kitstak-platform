'use client';
/**
 * Global shortcuts: mod+k and / (search and commands), ? (shortcut sheet), l (log work),
 * n (new job), mod+z (undo the last change that showed an Undo toast) and g then h, j, l, p, a
 * (go to). `[` and `]` belong to the log page (previous and next day), so the shell leaves them alone.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isEditableTarget, useHotkey } from '@/lib/hooks/use-hotkeys';
import { chordTargets } from '@/lib/nav';
import { canPulse } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { toast } from '@/components/ui';
import { PALETTE_INPUT, catchTypeAhead } from '@/features/command/type-ahead';
import { useShell } from './shell-context';
import { useShellStore } from './store';

/** True while a dialog, menu or the palette is open: single letter shortcuts stay quiet. */
function overlayIsOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [cmdk-dialog]') !== null;
}

export function useShellHotkeys(): void {
  const router = useRouter();
  const { pulseRole, seesMoney } = useShell();
  const store = useShellStore;
  useHotkey(
    'mod+k',
    () => {
      const state = store.getState();
      if (state.paletteOpen) state.closePalette();
      else {
        // Letters typed before the palette input has focus land in it, never on the page.
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
  // Undo anywhere, not only from the toast. Text fields keep their own Ctrl/Cmd+Z.
  useHotkey(
    'mod+z',
    () => {
      if (!toast.undoLast()) toast.info('Nothing to undo', 'Changes you can take back show an Undo button when you make them.');
    },
    { allowInDialogs: true },
  );

  const pendingG = useRef<number | null>(null);
  useEffect(() => {
    const chords = chordTargets(pulseRole, seesMoney);
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
      if (event.key === 'l' && canPulse(pulseRole, 'production:log')) {
        event.preventDefault();
        router.push(routes.log());
      } else if (event.key === 'n' && canPulse(pulseRole, 'job:manage')) {
        event.preventDefault();
        router.push(routes.newJob());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (pendingG.current !== null) window.clearTimeout(pendingG.current);
      pendingG.current = null;
    };
  }, [router, pulseRole, seesMoney]);
}
