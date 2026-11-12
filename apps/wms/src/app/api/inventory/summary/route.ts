/** `GET /api/inventory/summary?kind=location|lp&id=` — Transfer drawer "Find" summary card. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { locationSummary, lpSummary } from '@/server/repositories/inventory-lookups';
import { INVENTORY_PERMISSIONS as P } from '@/lib/grid-defs/inventory/permissions';

export const GET = defineRoute({
  permission: P.byLocationView,
  query: z.object({ kind: z.enum(['location', 'lp']), id: z.string().trim().min(1).max(64) }),
  handler: async ({ db, auth, query }) =>
    query.kind === 'lp' ? await lpSummary(db, auth, query.id) : await locationSummary(db, auth, query.id),
});
