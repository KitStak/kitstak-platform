import { getImportProgress } from '@/server/domain';
import { apiRoute } from '@/server/http/api';

/** `GET /api/v1/import/<batch>/progress`: where a running check or save is. */
export const GET = apiRoute<{ batchId: string }>(async ({ ctx, params }) => getImportProgress(ctx, params.batchId));
