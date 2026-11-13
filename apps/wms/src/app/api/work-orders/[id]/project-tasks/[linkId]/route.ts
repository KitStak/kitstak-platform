/** `DELETE /api/work-orders/:id/project-tasks/:linkId` — unlink a Projects task/project from the work order. */
import { WO_PERMISSIONS } from '@/server/repositories/work-orders-api';
import { projectLinkRoutes } from '@/server/projects/routes';

export const { DELETE } = projectLinkRoutes('wms_work_order', WO_PERMISSIONS.view);
