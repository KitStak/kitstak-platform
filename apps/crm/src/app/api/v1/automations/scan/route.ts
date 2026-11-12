import { z } from 'zod';
import { withApi } from '@/server/api';
import { runDateArrivedScan } from '@/server/automations-engine/scan';
import { svc } from '../../_lib/route-helpers';

/**
 * "Date arrives" trigger scan for the caller's org. Idempotent per automation/item/day, so a
 * scheduler can call it every few minutes. Runs as the system (attributed to the automation).
 */
export const POST = withApi(
  {
    permission: 'automation:write',
    rateLimit: 'heavy',
    body: z.object({ date: z.iso.date().optional() }).optional(),
  },
  (ctx) => runDateArrivedScan({ ...svc(ctx), userId: null }, ctx.body?.date),
);
