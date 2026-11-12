/**
 * Theme constants shared by the server root layout (pre-paint script) and the client theme hook.
 * Kept out of the "use client" module so the server can inline the script as a plain string.
 */
export const THEME_STORAGE_KEY = 'ks-theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Runs before first paint: stored "light"/"dark" wins, otherwise follow the OS. It also keeps
 * following the OS while the preference is "system", so every surface (including route loading
 * skeletons shown before any theme-aware component mounts) switches with it.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=window.matchMedia(${JSON.stringify(DARK_QUERY)}),d=document.documentElement;function a(){var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark")p=m.matches?"dark":"light";d.dataset.theme=p;d.style.colorScheme=p;}a();if(m.addEventListener)m.addEventListener("change",a);}catch(e){}})();`;
