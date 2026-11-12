/** `GET /api/kits/search?clientId&q&limit`: kit-to-stock kit picker for the wizard. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { searchKits } from '@/server/repositories/kits';
import { KIT_PERMISSIONS, WO_PERMISSIONS } from '@/server/repositories/work-orders-api';

export const GET = defineRoute({
  permission: [WO_PERMISSIONS.view, KIT_PERMISSIONS.inventory],
  query: z.object({
    clientId: z.string().trim().min(1).max(64),
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }),
  handler: async ({ db, auth, query }) =>
    await searchKits(db, auth.scope, { clientId: query.clientId, q: query.q, limit: query.limit }),
});
