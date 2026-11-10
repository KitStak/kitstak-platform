/**
 * Theme constants shared by the server root layout (pre-paint script) and the client theme hook.
 * Kept out of the "use client" module so the server can inline the script as a plain string.
 */
export const THEME_STORAGE_KEY = "ks-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Runs before first paint: stored "light"/"dark" wins, otherwise follow the OS. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(p!=="light"&&p!=="dark")p=window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light";document.documentElement.dataset.theme=p;document.documentElement.style.colorScheme=p;}catch(e){}})();`;
