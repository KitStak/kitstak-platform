'use client';
/** Small per-browser flags that drive the Home getting-started checklist (e.g. "has used ⌘K search"). */
import { useSyncExternalStore } from 'react';

const USED_SEARCH_KEY = 'kitstak-projects:used-search';
const EVENT = 'kitstak-projects:usage-flags';

export function markUsedSearch(): void {
  try {
    if (window.localStorage.getItem(USED_SEARCH_KEY) === '1') return;
    window.localStorage.setItem(USED_SEARCH_KEY, '1');
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

function read(): boolean {
  try {
    return window.localStorage.getItem(USED_SEARCH_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** False on the server and until the browser value is read. */
export function useUsedSearch(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
