import { apiRoute } from '@/server/http/api';
import { allLinkedWork } from '@/server/domain/programs';
import { monthParam } from '../../_lib';

/** GET /api/v1/programs/:key/linked-work?month= */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => allLinkedWork(ctx, decodeURIComponent(params.key), monthParam(searchParams.get('month')) ?? new Date().toISOString().slice(0, 7)));
