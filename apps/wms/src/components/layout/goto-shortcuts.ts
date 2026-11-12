'use client';

/**
 * Two-key "go to" sequences (G then D = Dashboard, G then O = Shipment Orders). Ignored
 * while typing in a field or when a modifier is held.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isEditableTarget } from '@/lib/keyboard';
import { GOTO_SHORTCUTS } from './help-content';

export const GOTO_WINDOW_MS = 1200;

/** Destination for the second key of an armed sequence, or null. */
export function gotoTarget(key: string): string | null {
  return GOTO_SHORTCUTS.find((s) => s.key === key.toLowerCase())?.href ?? null;
}

export function useGotoShortcuts(): void {
  const router = useRouter();
  React.useEffect(() => {
    let armedAt = 0;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target)
      )
        return;
      const key = event.key.toLowerCase();
      if (armedAt && event.timeStamp - armedAt <= GOTO_WINDOW_MS) {
        armedAt = 0;
        const href = gotoTarget(key);
        if (href) {
          event.preventDefault();
          router.push(href);
        }
        return;
      }
      armedAt = key === 'g' ? event.timeStamp : 0;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);
}
