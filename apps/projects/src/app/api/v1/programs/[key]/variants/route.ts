import { apiRoute, boolParam } from '@/server/http/api';
import { listVariants } from '@/server/domain/programs';

/** GET /api/v1/programs/:key/variants?retired=1 */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => listVariants(ctx, decodeURIComponent(params.key), { includeRetired: boolParam(searchParams.get('retired'), false) }));
