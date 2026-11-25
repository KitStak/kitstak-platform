import { getProgramPulse } from '@kitstak/pulse-bridge/programs';
import type { BridgeExecutor } from '@kitstak/pulse-bridge';
import { apiRoute } from '@/server/http/api';
import { db } from '@/server/db';
import { requireProgram } from '@/server/domain/programs';
import { monthParam } from '../../_lib';

/** GET /api/v1/programs/:key/pulse (Pulse side of the program; sync details only for owners and admins). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const access = await requireProgram(ctx, decodeURIComponent(params.key));
  const month = monthParam(searchParams.get('month')) ?? new Date().toISOString().slice(0, 7);
  const result = await getProgramPulse(db as unknown as BridgeExecutor, { orgId: ctx.orgId, userId: ctx.userId }, { programId: access.program.id, month });
  if (!result.available) return result;
  const hidden = !access.caps.seesMoney || result.moneyHidden;
  return {
    ...result,
    moneyHidden: hidden,
    stamped: hidden ? { perUnitCents: null, feesCents: null, totalCents: null, byVariant: result.stamped.byVariant.map((v) => ({ variantId: v.variantId, units: v.units })) } : result.stamped,
    pendingSince: access.caps.seesSync ? result.pendingSince : null,
    lastSyncAt: access.caps.seesSync ? result.lastSyncAt : null,
  };
});
