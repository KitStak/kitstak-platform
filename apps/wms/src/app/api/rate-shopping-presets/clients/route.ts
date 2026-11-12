/** `GET /api/rate-shopping-presets/clients?warehouseId` — clients with carrier services at the warehouse (Client combobox on step 1). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { servedClients } from '@/server/repositories/rate-shopping';

export const GET = defineRoute({
  permission: 'automation.rate_shopping.view',
  query: z.object({ warehouseId: z.string().trim().max(64).optional() }),
  handler: async ({ db, auth, query }) => {
    // A plain-language message (not a raw schema error) when the wizard asks before a warehouse is chosen.
    if (!query.warehouseId)
      throw new AppError('VALIDATION', 'Choose a warehouse first', {
        fieldErrors: { warehouseId: ['Choose a warehouse first'] },
      });
    return await servedClients(db, auth, query.warehouseId);
  },
});
