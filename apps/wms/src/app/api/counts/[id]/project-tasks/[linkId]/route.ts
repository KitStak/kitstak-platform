/** `DELETE /api/counts/:id/project-tasks/:linkId`: unlink a Projects task or project from the cycle count. */
import { COUNT_ANY_VIEW } from '@/lib/grid-defs/counts/count-grids';
import { projectLinkRoutes } from '@/server/projects/routes';

export const { DELETE } = projectLinkRoutes('wms_count', COUNT_ANY_VIEW);
