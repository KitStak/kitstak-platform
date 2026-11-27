import { apiRoute } from '@/server/http/api';
import { variantKit } from '@/server/domain/programs';

/** GET /api/v1/programs/:key/variants/:id/kit (WMS read only). */
export const GET = apiRoute<{ key: string; id: string }>(async ({ ctx, params }) => variantKit(ctx, decodeURIComponent(params.key), params.id));
