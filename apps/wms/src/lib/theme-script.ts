/**
 * Pre-paint theme bootstrap, inlined by the root layout as a plain string (kept out of any
 * "use client" module). The storage keys and resolution order come from the shared
 * @kitstak/ui theme — cookie 'kitstak-theme' wins, then localStorage 'kitstak-theme',
 * then `prefers-color-scheme` — with one WMS addition: the old 'ks-theme' localStorage
 * key is read as a last stored fallback, so existing users keep their preference until
 * their next explicit change migrates it to the shared stores (src/lib/theme.ts).
 *
 * While no explicit preference is stored, the page keeps following OS changes (including
 * on route loading skeletons shown before any theme-aware component mounts).
 */
import { DARK_QUERY, THEME_COOKIE, THEME_STORAGE_KEY } from '@kitstak/ui/theme';

/** Pre-unification WMS localStorage key. Read as a migration fallback only, never written. */
export const LEGACY_THEME_STORAGE_KEY = 'ks-theme';

const cookiePattern = `(?:^|; )${THEME_COOKIE}=([^;]*)`;

export const THEME_INIT_SCRIPT =
  '(function(){try{' +
  `var q=${JSON.stringify(DARK_QUERY)},k=${JSON.stringify(THEME_STORAGE_KEY)},` +
  `l=${JSON.stringify(LEGACY_THEME_STORAGE_KEY)},` +
  `r=new RegExp(${JSON.stringify(cookiePattern)}),` +
  'm=window.matchMedia(q),d=document.documentElement;' +
  'function v(x){return x==="light"||x==="dark"?x:null;}' +
  'function a(){' +
  'var c=r.exec(document.cookie),t=v(c&&decodeURIComponent(c[1]));' +
  'if(!t){try{t=v(localStorage.getItem(k))||v(localStorage.getItem(l));}catch(e){t=null;}}' +
  'if(!t)t=m.matches?"dark":"light";' +
  'd.dataset.theme=t;d.style.colorScheme=t;' +
  '}' +
  'a();if(m.addEventListener)m.addEventListener("change",a);' +
  '}catch(e){}})();';
