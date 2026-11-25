import { apiRoute } from '@/server/http/api';
import { listOneTimeCharges } from '@/server/domain/programs';
import { monthParam } from '../../_lib';

/** GET /api/v1/programs/:key/one-time?month= */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => listOneTimeCharges(ctx, decodeURIComponent(params.key), { month: monthParam(searchParams.get('month')) }));
