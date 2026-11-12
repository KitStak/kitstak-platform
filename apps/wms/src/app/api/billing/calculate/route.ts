/**
 * `POST /api/billing/calculate { ids, mode, start?, end?, replaceDrafts? }` — runs the billing engine now and
 * writes one bill per contract. The dialog preview lives at `/api/billing/calculate/preview` (read-only);
 * a body that still carries `dryRun: true` is answered with the preview and never writes.
 * Approved bills always block a re-run; Draft ones need `replaceDrafts`. `lastClosed` refuses while
 * no period has closed. Contracts without fees are refused (409) before anything is written.
 */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import {
  calculateContracts,
  calculateSchema,
  previewCalculation,
} from '@/server/repositories/billing-reports';

export const POST = defineRoute({
  permission: 'settings.billing.calculate',
  body: calculateSchema,
  handler: async ({ db, auth, actor, body }) => {
    if (body.dryRun === true) return await previewCalculation(db, auth, body);
    const result = await calculateContracts(db, auth, actor, body);
    // Nothing calculated (e.g. a single contract with no fees): a real 409, matching Approve.
    const first = result.failed[0];
    if (result.succeeded.length === 0 && first)
      throw new AppError(first.code === 'DUPLICATE' ? 'DUPLICATE' : 'INVALID_STATE', first.message);
    return result;
  },
});
