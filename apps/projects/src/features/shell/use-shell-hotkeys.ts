'use client';
/**
 * Global shortcuts: c (new task), / and mod+k (palette), ? (help), [ (sidebar), mod+z (undo the
 * last change that showed an Undo toast), g then h/m/i/s/p/g/d/a/t (go to).
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isEditableTarget, useHotkey } from '@/lib/hooks/use-hotkeys';
import { routes } from '@/lib/routes';
import { toast } from '@/components/ui';
import { useShellStore } from './store';

export function useShellHotkeys(): void {
  const router = useRouter();
  const store = useShellStore;
  useHotkey('mod+k', () => {
    const state = store.getState();
    if (state.paletteOpen) state.closePalette();
    else state.openPalette();
  }, { allowInInputs: true, allowInDialogs: true });
  useHotkey('/', () => store.getState().openPalette());
  useHotkey('c', () => store.getState().openQuickAdd());
  useHotkey('?', () => store.getState().openShortcuts());
  useHotkey('[', () => store.getState().toggleSidebar());
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const key = event.key.toLowerCase();
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = {
          h: routes.home(),
          m: routes.myWork(),
          i: routes.inbox(),
          s: routes.search(),
          p: routes.projects(),
          g: routes.goals(),
          d: routes.dashboards(),
          a: routes.automations(),
          t: routes.templates(),
        }[key];
        if (target) {
          event.preventDefault();
          router.push(target);
        }
        return;
      }
      if (key === 'g') pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);
}
