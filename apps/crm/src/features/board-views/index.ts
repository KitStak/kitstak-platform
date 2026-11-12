/**
 * Board views beyond the table. Each view takes `{ boardId, view, onOpenItem }` and reads the
 * board payload through `useBoard(boardId)`; settings persist per view under
 * `view.config.<kanban|calendar|timeline|chartView|files|form>`.
 *
 *   <KanbanView boardId={id} view={view} onOpenItem={openPanel} />
 *   VIEW_TYPES → icon / label / description for the "Add view" menu.
 *   <BoardView> picks the component for `view.type` (null for table / dashboard).
 */
export { KanbanView, KanbanSkeleton } from './kanban/kanban-view';
export { CalendarView, CalendarSkeleton } from './calendar/calendar-view';
export { TimelineView, TimelineSkeleton } from './timeline/timeline-view';
export { ChartView, ChartSkeleton } from './chart/chart-view';
export { FormView, FormSkeleton } from './form/form-view';
export { FilesView, FilesSkeleton } from './files/files-view';
export { PublicForm, type PublicFormProps } from './form/public-form';
export { BoardView, hasBoardViewComponent } from './board-view';
export { VIEW_TYPES, VIEW_TYPE_BY_TYPE, viewTypeMeta, type ViewTypeMeta } from './view-types';
export type { BoardViewProps } from './types';
export { focusItemInView } from './lib/focus';
