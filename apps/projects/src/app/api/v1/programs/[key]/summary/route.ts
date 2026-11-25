import { apiRoute } from '@/server/http/api';
import { getProgramSummary } from '@/server/domain/programs';
import { monthParam } from '../../_lib';

/** GET /api/v1/programs/:key/summary?month=YYYY-MM (Overview). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => getProgramSummary(ctx, decodeURIComponent(params.key), { month: monthParam(searchParams.get('month')) }));
