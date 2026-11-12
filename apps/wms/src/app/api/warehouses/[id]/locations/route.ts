/** `GET /api/warehouses/[id]/locations?area=Receiving,Returns` — default-location picker options. */
import { z } from 'zod';
import { AREA_TYPES } from '@/lib/enums';
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { warehouseLocationOptions } from '@/server/repositories/warehouses';

const query = z.object({
  area: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((a) => a.trim())
            .filter((a) => (AREA_TYPES as readonly string[]).includes(a))
        : [],
    ),
});

export const GET = defineRoute({
  // Read-only, warehouse-scoped option list: every role that can open an M10 page may read it
  // (critic R4: viewer/operator page views logged a 403 from the default-location picker data).
  permission: [
    'settings.warehouse.view',
    'settings.shipment_packages.view',
    'settings.lp_numbers.view',
    'settings.locations.view',
    'inventory.inventory_by_location.view',
  ],
  params: idParamsSchema,
  query,
  handler: async ({ db, auth, params, query: q }) =>
    await warehouseLocationOptions(db, auth, params.id, q.area),
});
