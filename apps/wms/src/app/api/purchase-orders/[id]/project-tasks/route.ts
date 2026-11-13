/** `GET /api/purchase-orders/:id/project-tasks` (KitStak Projects work linked to the receipt) · `POST` create a linked task. */
import { projectTasksRoutes } from '@/server/projects/routes';

export const { GET, POST } = projectTasksRoutes('wms_receipt', 'inventory.purchase_orders.view');
