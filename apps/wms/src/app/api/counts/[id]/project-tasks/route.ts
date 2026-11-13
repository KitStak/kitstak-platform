/** `GET /api/counts/:id/project-tasks` (KitStak Projects work linked to the cycle count) · `POST` create a linked task. */
import { COUNT_ANY_VIEW } from '@/lib/grid-defs/counts/count-grids';
import { projectTasksRoutes } from '@/server/projects/routes';

export const { GET, POST } = projectTasksRoutes('wms_count', COUNT_ANY_VIEW);
