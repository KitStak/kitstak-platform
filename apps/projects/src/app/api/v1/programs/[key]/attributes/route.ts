import { apiRoute } from '@/server/http/api';
import { listAttributes } from '@/server/domain/programs';

/** GET /api/v1/programs/:key/attributes */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => listAttributes(ctx, decodeURIComponent(params.key)));
