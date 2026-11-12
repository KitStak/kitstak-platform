/** `GET|PATCH|DELETE /api/shipment-packages/[id]` — detail, edit (optimistic `version`), guarded delete. */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { shipmentPackageSchema } from '@/lib/grid-defs/facility/shipment-packages';
import { idParamsSchema } from '@/server/repositories/platform-common';
import {
  deleteShipmentPackages,
  getShipmentPackage,
  updateShipmentPackage,
} from '@/server/repositories/shipment-packages';

export const GET = defineRoute({
  permission: ['settings.shipment_packages.view', 'inventory.inventory_by_location.view'],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getShipmentPackage(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: 'settings.shipment_packages.edit',
  params: idParamsSchema,
  body: shipmentPackageSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await updateShipmentPackage(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: 'settings.shipment_packages.delete',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteShipmentPackages(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure)
      throw new AppError(failure.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_STATE', failure.message);
    return result;
  },
});
