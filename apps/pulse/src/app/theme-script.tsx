'use client';
import { THEME_INIT_SCRIPT } from '@kitstak/ui/theme';

/**
 * Sets data-theme before first paint. Rendered into the server HTML only: on the client the tag
 * would never run anyway, and React warns when it creates a <script> (for example when a 404
 * re-renders the root layout). React 19 skips extra server-only tags in <head> while hydrating.
 */
export function ThemeScript() {
  if (typeof window !== 'undefined') return null;
  return <script id="ks-theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
