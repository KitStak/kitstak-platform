/**
 * Pure helpers for the item panel's URL state (`?item=<id>&itemTab=<tab>&update=<id>`).
 * The React hook lives in `use-item-panel-url-state.ts`; these are unit tested.
 */

export const ITEM_PARAM = 'item';
export const TAB_PARAM = 'itemTab';
export const UPDATE_PARAM = 'update';

export const PANEL_TABS = ['updates', 'files', 'activity', 'card', 'projects', 'pulse'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
export const DEFAULT_TAB: PanelTab = 'updates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function parseTab(value: string | null | undefined): PanelTab {
  return (PANEL_TABS as readonly string[]).includes(value ?? '') ? (value as PanelTab) : DEFAULT_TAB;
}

export interface PanelUrlState {
  readonly itemId: string | null;
  readonly tab: PanelTab;
  readonly updateId: string | null;
}

export function readPanelState(params: Pick<URLSearchParams, 'get'>): PanelUrlState {
  const item = params.get(ITEM_PARAM);
  const update = params.get(UPDATE_PARAM);
  return {
    itemId: isUuid(item) ? item : null,
    tab: parseTab(params.get(TAB_PARAM)),
    updateId: isUuid(update) ? update : null,
  };
}

export type PanelPatch = Partial<{ itemId: string | null; tab: PanelTab | null; updateId: string | null }>;

/**
 * Apply a patch to the current query string and return `pathname?query`. Other params are kept.
 * The default tab is omitted to keep links short; closing the item drops every panel param.
 */
export function buildPanelHref(pathname: string, current: string, patch: PanelPatch): string {
  const params = new URLSearchParams(current);
  const set = (key: string, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value === null) params.delete(key);
    else params.set(key, value);
  };
  if (patch.itemId === null) {
    params.delete(ITEM_PARAM);
    params.delete(TAB_PARAM);
    params.delete(UPDATE_PARAM);
  } else {
    set(ITEM_PARAM, patch.itemId);
    if (patch.tab !== undefined) set(TAB_PARAM, patch.tab === DEFAULT_TAB ? null : patch.tab);
    set(UPDATE_PARAM, patch.updateId);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Absolute shareable link to an item (and optionally one update) from the current location. */
export function itemShareUrl(
  location: Pick<Location, 'origin' | 'pathname' | 'search'>,
  itemId: string,
  options: { tab?: PanelTab; updateId?: string } = {},
): string {
  return `${location.origin}${buildPanelHref(location.pathname, location.search, {
    itemId,
    tab: options.tab ?? (options.updateId ? 'updates' : null),
    updateId: options.updateId ?? null,
  })}`;
}
