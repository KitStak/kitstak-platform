'use client';
/**
 * `c` pressed while the page is still loading (before React has wired up shortcuts) used to do
 * nothing. This tiny script, rendered into the server HTML, remembers a `c` and whatever is typed
 * after it until the app is ready; the shell then opens quick add with that text
 * (`replayEarlyKeys` in `use-shell-hotkeys.ts`). Text fields and modifier keys are left alone.
 */
const EARLY_KEYS_SCRIPT = `(function(){var q=[];window.__ksEarlyKeys=q;function h(e){if(window.__ksHydrated){removeEventListener('keydown',h,true);return}if(e.metaKey||e.ctrlKey||e.altKey||e.key.length!==1)return;var t=e.target;if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;if(!q.length&&e.key!=='c')return;if(q.length<300)q.push(e.key);e.preventDefault()}addEventListener('keydown',h,true)})();`;

/** Server-rendered only, like ThemeScript: on the client the tag would never run anyway. */
export function EarlyKeysScript() {
  if (typeof window !== 'undefined') return null;
  return <script id="ks-early-keys" dangerouslySetInnerHTML={{ __html: EARLY_KEYS_SCRIPT }} />;
}

declare global {
  interface Window {
    __ksEarlyKeys?: string[];
    __ksHydrated?: boolean;
  }
}

/**
 * Called once shortcuts are live: stops the early catcher and returns what it caught after a
 * `c` (the start of a task name), or null when nothing was pressed.
 */
export function takeEarlyKeys(): string | null {
  window.__ksHydrated = true;
  const queue = window.__ksEarlyKeys;
  if (!queue?.length || queue[0] !== 'c') return null;
  const text = queue.slice(1).join('');
  queue.length = 0;
  return text;
}
