import { undoImportBatch } from '@/server/domain';
import { apiRoute } from '@/server/http/api';

export const maxDuration = 300;

/** `POST /api/v1/import/<batch>/undo`: takes a saved batch back out (for 7 days). */
export const POST = apiRoute<{ batchId: string }>(async ({ ctx, params }) => undoImportBatch(ctx, params.batchId));
