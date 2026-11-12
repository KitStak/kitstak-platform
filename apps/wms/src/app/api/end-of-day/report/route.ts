/**
 * `POST /api/end-of-day/report` `{ id }` — Open printed report. Returns the closed manifest's stored End of the
 * Day Report, regenerating and linking it when the manifest is printed but has no retrievable file.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { openManifestReport } from '@/server/repositories/end-of-day';
import { domainCtx } from '@/server/repositories/platform-common';

export const POST = defineRoute({
  permission: 'fulfillment.end_of_day.view',
  body: z.object({ id: z.string().trim().min(1, 'Choose a manifest').max(200) }),
  transaction: false,
  handler: ({ db, auth, actor, body }) => openManifestReport(db, auth, domainCtx(actor, auth), body.id),
});
