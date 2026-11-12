/** `GET /api/wave-rules/options?warehouseId=` — choices for the wave-rule wizard. */
import { z } from 'zod';
import { withBusyRetry } from '@/server/repositories/jobs-read-retry';
import { defineRoute } from '@/server/api/define-route';
import { waveRuleOptions } from '@/server/repositories/wave-rules-options';

export const GET = defineRoute({
  permission: ['automation.wave_rules.create', 'automation.wave_rules.edit', 'automation.wave_rules.view'],
  query: z.object({ warehouseId: z.string().max(64).optional() }),
  handler: ({ db, auth, query }) =>
    withBusyRetry(async () => await waveRuleOptions(db, auth, query.warehouseId ?? null)),
});
