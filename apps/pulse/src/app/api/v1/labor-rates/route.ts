import { apiRoute } from '@/server/http/api';
import { uuidParam } from '@/server/http/params';
import { listLaborRates } from '@/server/domain';

/** Dated rate rows. 403 for readers without `money:read`; wage detail is null without `wage:read`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listLaborRates(ctx, { laborClassId: uuidParam(searchParams, 'laborClass') }));
