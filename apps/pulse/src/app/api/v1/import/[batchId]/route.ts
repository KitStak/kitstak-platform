import { discardImportBatch, getImportBatch } from '@/server/domain';
import { apiRoute } from '@/server/http/api';

type Params = { batchId: string };

/** `GET /api/v1/import/<batch>`: one batch with its counts. */
export const GET = apiRoute<Params>(async ({ ctx, params }) => getImportBatch(ctx, params.batchId));

/** `DELETE /api/v1/import/<batch>`: throws away a batch that was never saved. */
export const DELETE = apiRoute<Params>(async ({ ctx, params }) => {
  await discardImportBatch(ctx, params.batchId);
  return { discarded: true };
});
