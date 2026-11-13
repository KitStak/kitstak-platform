/**
 * Task feature (owner: task team). Drawer host + detail view + full page.
 * Client code must import client files by path (`@/features/task/task-detail`), not this index:
 * it also exports the server `TaskPage`.
 */
export { TaskDrawerHost, TaskDrawerProvider } from './task-drawer';
export { TaskDetailView, TaskDetailSkeleton, type TaskDetailViewProps } from './task-detail';
export { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
export { TaskPage } from './task-page';
