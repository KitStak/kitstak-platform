/**
 * Board page composition: header, view tabs, toolbar, the active view and the item panel.
 *
 *   <BoardPage boardId={id} />          // inside the app shell, under <Suspense> (reads the URL)
 *
 * URL state: `?view=<id>` (active tab), `?vs=<overlay>` (unsaved toolbar changes),
 * `?q=<search>`, plus the item panel's `?item=`. Toolbar changes are temporary until
 * "Save to this view"; widths / row height / collapsed columns auto-save to the view.
 */
export { BoardPage } from './board-page';
export { BoardPageSkeleton } from './board-states';
export { encodeOverlay, decodeOverlay, readBoardUrl, patchBoardSearch } from './lib/url-state';
export type { DraftOverlay, GroupBySpec, ToolbarDraft } from './lib/draft';
