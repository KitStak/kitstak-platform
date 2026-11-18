import { commitImportBatch } from '@/server/domain';
import { apiRoute } from '@/server/http/api';

export const maxDuration = 300;

/** `POST /api/v1/import/<batch>/commit`: saves the checked batch in one transaction. */
export const POST = apiRoute<{ batchId: string }>(async ({ ctx, params }) => commitImportBatch(ctx, params.batchId));
