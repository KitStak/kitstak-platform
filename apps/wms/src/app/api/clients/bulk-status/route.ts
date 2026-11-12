/** `POST /api/clients/bulk-status { ids, status }` — Activate / Deactivate (clients with open orders can't be deactivated). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/organization/common';
import { setClientStatus } from '@/server/repositories/clients';

export const POST = defineRoute({
  permission: 'settings.clients.edit',
  body: bulkIds.extend({ status: z.enum(['Active', 'Inactive']) }),
  handler: async ({ db, auth, actor, body }) => await setClientStatus(db, auth, actor, body.ids, body.status),
});
