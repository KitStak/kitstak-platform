/** `GET /api/orders/:id/project-tasks` (KitStak Projects work linked to the order) · `POST` create a linked task. */
import { ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { projectTasksRoutes } from '@/server/projects/routes';

export const { GET, POST } = projectTasksRoutes('wms_order', ORDER_PERMISSIONS.view);
