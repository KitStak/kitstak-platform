/** `GET /api/carriers/catalog?provider` — credential fields, services and packages a new setup starts with. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { providerCatalog } from '@/server/integrations/carriers';

export const GET = defineRoute({
  permission: [
    'integrations.integrations.create_setup',
    'integrations.integrations.edit_setup',
    'integrations.integrations.delete_setup',
  ],
  query: z.object({ provider: z.string().trim().min(1).max(40) }),
  handler: ({ query }) => providerCatalog(query.provider),
});
