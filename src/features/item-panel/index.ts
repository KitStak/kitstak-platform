/**
 * Item panel module: the item card that slides in from the right.
 *
 *   const panel = useItemPanelUrlState();          // ?item=<id>&itemTab=<tab>&update=<id>
 *   panel.open(item.id)                            // from a row's "Open" button / update bubble
 *   panel.open(item.id, 'updates')
 *   <ItemPanel boardId={boardId} itemId={panel.itemId} open={panel.isOpen}
 *     onOpenChange={panel.onOpenChange} tab={panel.tab} onTabChange={panel.setTab}
 *     onNavigateItem={panel.setItem} focusUpdateId={panel.updateId} realtime={false} />
 *
 * or the one-liner `<ItemPanelRoute boardId={boardId} />`. Must render inside `<OrgProvider>`
 * (src/lib/hooks) and under a Suspense boundary (it reads `useSearchParams`).
 */
export { ItemPanel, ItemPanelRoute, type ItemPanelProps } from './item-panel';
export { useItemPanelUrlState, type ItemPanelUrlState } from './use-item-panel-url-state';
export {
  ITEM_PARAM,
  TAB_PARAM,
  UPDATE_PARAM,
  PANEL_TABS,
  buildPanelHref,
  itemShareUrl,
  readPanelState,
  type PanelTab,
} from './lib/url-state';
