import { apiRoute } from '@/server/http/api';
import { getCloseChecklist } from '@/server/domain/programs';
import { requireMonth } from '../../_lib';

/** GET /api/v1/programs/:key/close?month= (month close checklist). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => getCloseChecklist(ctx, decodeURIComponent(params.key), requireMonth(searchParams.get('month'))));
