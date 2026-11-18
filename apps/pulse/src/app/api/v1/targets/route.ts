import { apiRoute } from '@/server/http/api';
import { oneOf, str, uuidParam } from '@/server/http/params';
import { listTargets } from '@/server/domain';
import { TARGET_SCOPES } from '@/lib/constants';

/** Goals. `?scope=&scopeId=&month=YYYY-MM`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listTargets(ctx, { scope: oneOf(searchParams, 'scope', TARGET_SCOPES), scopeId: uuidParam(searchParams, 'scopeId'), month: str(searchParams, 'month') }));
