/** `GET /api/packing/hospitals/warehouses` — per in-scope warehouse: hospital locations and units (default warehouse pick). */
import { defineRoute } from '@/server/api/define-route';
import { hospitalWarehouses } from '@/server/repositories/packing-hospitals';
import { PACKING_PERMISSIONS } from '@/server/repositories/packing-scan';

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  handler: async ({ db, auth }) => await hospitalWarehouses(db, auth.scope),
});
