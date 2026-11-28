/** POST /api/v1/import/[batchId]/rows (SPEC 8.8): one chunk of raw rows, up to 1,000 at a time. */
import { z } from 'zod';
import { addImportRows, MAX_CHUNK_ROWS } from '@/server/domain/imports';
import { DomainError } from '@/server/errors';
import { apiRoute, readJson } from '@/server/http/api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  rows: z
    .array(z.object({ rowNumber: z.number().int().min(2).max(1_000_000), cells: z.array(z.string().max(2000)).max(200) }))
    .min(1)
    .max(MAX_CHUNK_ROWS),
});

export const POST = apiRoute<{ batchId: string }>(async ({ ctx, request, params }) => {
  if (!z.string().uuid().safeParse(params.batchId).success) throw new DomainError('NOT_FOUND', 'That import does not exist.');
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) throw new DomainError('VALIDATION', 'The rows of this chunk are not in the right shape.');
  return addImportRows(ctx, params.batchId, parsed.data.rows);
});
