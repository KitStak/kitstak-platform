/** `POST /api/end-of-day/schedule-pickup` `{ ids, pickupAt, closeAt?, note? }` — books a carrier pickup per manifest. */
import { defineRoute } from '@/server/api/define-route';
import { domainCtx } from '@/server/repositories/platform-common';
import { schedulePickup, schedulePickupSchema } from '@/server/repositories/shipping-carrier-ops';

export const POST = defineRoute({
  permission: 'fulfillment.end_of_day.print_end_of_the_day_report',
  body: schedulePickupSchema,
  transaction: false,
  handler: async ({ db, auth, actor, body }) => await schedulePickup(db, auth, domainCtx(actor, auth), body),
});
