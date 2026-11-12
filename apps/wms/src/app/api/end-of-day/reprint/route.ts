/** `POST /api/end-of-day/reprint` `{ ids }` — re-renders closed manifests' End of the Day Report. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { reprintManifests } from '@/server/repositories/end-of-day';

export const POST = defineRoute({
  permission: 'fulfillment.end_of_day.print_end_of_the_day_report',
  body: z.object({
    ids: z.array(z.string().trim().min(1).max(200)).min(1, 'Select at least one manifest').max(200),
  }),
  transaction: false,
  handler: ({ db, auth, body }) => reprintManifests(db, auth, body.ids),
});
