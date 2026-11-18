import { countStreamRows } from '@/server/domain';
import { apiRoute } from '@/server/http/api';

/** `GET /api/v1/export`: how many rows each stream holds, for the export page. */
export const GET = apiRoute(async ({ ctx }) => countStreamRows(ctx));
