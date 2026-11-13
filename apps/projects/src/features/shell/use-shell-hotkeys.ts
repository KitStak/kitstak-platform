'use client';
/**
 * Global shortcuts: c (new task, also from the task drawer), mod+k (palette), / (filter the current view like Linear and Jira;
 * the palette on pages without a view search), ? (help), [ (sidebar), mod+z (undo the
 * last change that showed an Undo toast), g then h/m/i/s/p/g/d/a/t (go to).
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isEditableTarget, useHotkey } from '@/lib/hooks/use-hotkeys';
import { routes } from '@/lib/routes';
import { toast } from '@/components/ui';
import { takeEarlyKeys } from '@/features/command/early-keys';
import { PALETTE_INPUT, QUICK_ADD_INPUT, catchTypeAhead } from '@/features/command/type-ahead';
import { letterKeysPaused, startLetterKeyGuard } from '@/features/task/task-keys';
import { useShellStore } from './store';

export function useShellHotkeys(): void {
  const router = useRouter();
  const store = useShellStore;
  useHotkey('mod+k', () => {
    const state = store.getState();
    if (state.paletteOpen) state.closePalette();
    else {
      // Letters typed before the palette input has focus land in it, never on the page.
      catchTypeAhead(PALETTE_INPUT);
      state.openPalette();
    }
  }, { allowInInputs: true, allowInDialogs: true });
  useHotkey('/', () => {
    // List, Board, Table and the other project views own a "Search tasks" field (also Ctrl/Cmd+F).
    // Hand '/' to it so it filters the view in place; elsewhere it opens the palette.
    if (document.querySelector('[data-testid="view-toolbar"]')) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, metaKey: false, bubbles: true, cancelable: true }));
      return;
    }
    catchTypeAhead(PALETTE_INPUT);
    store.getState().openPalette();
  });
  // c works everywhere, the task drawer included (like Linear): only another dialog, menu or the
  // palette (or one that closed in the last moment) keeps it. What is typed right after it goes
  // into the new task's name, never to drawer shortcuts like i (assign) or t (due today).
  useHotkey(
    'c',
    (event) => {
      if (letterKeysPaused()) return;
      event.preventDefault();
      catchTypeAhead(QUICK_ADD_INPUT);
      store.getState().openQuickAdd();
    },
    { allowInDialogs: true, preventDefault: false },
  );
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
    startLetterKeyGuard();
    // `c` pressed while the page was still loading: open quick add now, with what came after it.
    const early = takeEarlyKeys();
    if (early !== null) {
      catchTypeAhead(QUICK_ADD_INPUT, early);
      // Let the rest of the page finish hydrating before the modal hides it from screen readers.
      const openNow = () => useShellStore.getState().openQuickAdd();
      // Not cancelled on cleanup: the keys were already taken, so the open must still happen.
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(openNow, { timeout: 600 });
      else window.setTimeout(openNow, 100);
    }
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
