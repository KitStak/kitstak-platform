/** `POST /api/clients/bulk-delete { ids }` — per-id result; clients with products, orders, POs, stock or billing forms are skipped. */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/organization/common';
import { deleteClients } from '@/server/repositories/clients';

export const POST = defineRoute({
  permission: 'settings.clients.delete',
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteClients(db, auth, actor, body.ids),
});
