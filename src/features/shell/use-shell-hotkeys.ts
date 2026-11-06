'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { G_CHORDS } from './nav-registry';
import { startRouteProgress } from './route-progress';
import { useShellStore } from './store';

const CHORD_TIMEOUT_MS = 900;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.closest('[role="grid"] [data-editing="true"], [contenteditable="true"]'));
}

/**
 * Global shortcuts: ⌘/Ctrl+K palette, ⌘/Ctrl+\ sidebar, "?" cheat sheet, and g-chords
 * (g h home, g m my work, g i inbox, g d dashboards, g p pipeline). Ignored while typing.
 */
export function useShellHotkeys(orgSlug: string): void {
  const router = useRouter();
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const { panel, openPanel, closePanel, toggleSidebar } = useShellStore.getState();

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (panel === 'search') closePanel();
        else openPanel('search');
        return;
      }
      if (mod && event.key === '\\') {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod || event.altKey || isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]'))
        return;

      if (event.key === '?') {
        event.preventDefault();
        openPanel('shortcuts');
        return;
      }
      const key = event.key.toLowerCase();
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const chord = Object.hasOwn(G_CHORDS, key) ? G_CHORDS[key] : undefined;
        const target = chord ? chord(orgSlug) : null;
        if (target) {
          event.preventDefault();
          if (window.location.pathname !== target) {
            startRouteProgress();
            router.push(target);
          }
        }
        return;
      }
      if (key === 'g') {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, CHORD_TIMEOUT_MS);
      }
    };
    // Capture phase: page-level handlers (grids, editors) that stopPropagation can't swallow chords.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (pendingG.current !== null) window.clearTimeout(pendingG.current);
    };
  }, [orgSlug, router]);
}
