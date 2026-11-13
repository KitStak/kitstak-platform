/** `GET /api/work-orders/:id/project-tasks` (KitStak Projects work linked to the work order) · `POST` create a linked task. */
import { WO_PERMISSIONS } from '@/server/repositories/work-orders-api';
import { projectTasksRoutes } from '@/server/projects/routes';

export const { GET, POST } = projectTasksRoutes('wms_work_order', WO_PERMISSIONS.view);
