/**
 * Pre-paint theme bootstrap, inlined by each app's root layout so a dark-mode
 * user never sees a light flash. Kept out of any "use client" module so server
 * layouts can embed it as a plain string.
 *
 * Resolution order (cookie wins — it is the cross-app, server-readable store):
 *   1. cookie `kitstak-theme` ("light" | "dark")
 *   2. localStorage `kitstak-theme` ("light" | "dark")
 *   3. `prefers-color-scheme` — and while no explicit preference is stored,
 *      the page keeps following OS changes (preserves WMS behavior).
 *
 * Applies `<html data-theme="light|dark">` + `color-scheme`, which tokens.css
 * keys on. Writes happen in `persistTheme` (theme.ts), never here.
 */
import { DARK_QUERY, THEME_COOKIE, THEME_STORAGE_KEY } from './theme';

const cookiePattern = `(?:^|; )${THEME_COOKIE}=([^;]*)`;

export const THEME_INIT_SCRIPT =
  '(function(){try{' +
  `var q=${JSON.stringify(DARK_QUERY)},k=${JSON.stringify(THEME_STORAGE_KEY)},` +
  `r=new RegExp(${JSON.stringify(cookiePattern)}),` +
  'm=window.matchMedia(q),d=document.documentElement;' +
  'function v(x){return x==="light"||x==="dark"?x:null;}' +
  'function a(){' +
  'var c=r.exec(document.cookie),t=v(c&&decodeURIComponent(c[1]));' +
  'if(!t){try{t=v(localStorage.getItem(k));}catch(e){t=null;}}' +
  'if(!t)t=m.matches?"dark":"light";' +
  'd.dataset.theme=t;d.style.colorScheme=t;' +
  '}' +
  'a();if(m.addEventListener)m.addEventListener("change",a);' +
  '}catch(e){}})();';
