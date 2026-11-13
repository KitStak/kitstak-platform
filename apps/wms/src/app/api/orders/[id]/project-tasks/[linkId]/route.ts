/** `DELETE /api/orders/:id/project-tasks/:linkId` — unlink a Projects task/project from the order. */
import { ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { projectLinkRoutes } from '@/server/projects/routes';

export const { DELETE } = projectLinkRoutes('wms_order', ORDER_PERMISSIONS.view);
