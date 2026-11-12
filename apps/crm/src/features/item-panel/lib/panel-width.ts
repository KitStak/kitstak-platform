/** Resizable drawer width: clamping, keyboard steps and per-viewer persistence. */

export const PANEL_DEFAULT_WIDTH = 640;
export const PANEL_MIN_WIDTH = 480;
export const PANEL_MAX_WIDTH = 1200;
export const PANEL_KEY_STEP = 32;
/** Keep at least this much of the board visible when not expanded. */
export const PANEL_VIEWPORT_GUTTER = 64;
const STORAGE_KEY = 'kitstak.itemPanel.width';

export function clampPanelWidth(width: number, viewport: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, viewport - PANEL_VIEWPORT_GUTTER));
  if (!Number.isFinite(width)) return Math.min(PANEL_DEFAULT_WIDTH, max);
  return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, width)));
}

/** Width from a pointer x position (the drawer is anchored to the right edge). */
export function widthFromPointer(clientX: number, viewport: number): number {
  return clampPanelWidth(viewport - clientX, viewport);
}

export function readStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : PANEL_DEFAULT_WIDTH;
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

export function storeWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Storage may be unavailable (private mode); width simply isn't remembered.
  }
}
