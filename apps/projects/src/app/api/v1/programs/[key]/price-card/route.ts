import { apiRoute } from '@/server/http/api';
import { listCardVersions } from '@/server/domain/programs';

/** GET /api/v1/programs/:key/price-card (every version, newest first). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => listCardVersions(ctx, decodeURIComponent(params.key)));
