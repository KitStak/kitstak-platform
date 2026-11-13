/** `DELETE /api/purchase-orders/:id/project-tasks/:linkId`: unlink a Projects task or project from the receipt. */
import { projectLinkRoutes } from '@/server/projects/routes';

export const { DELETE } = projectLinkRoutes('wms_receipt', 'inventory.purchase_orders.view');
