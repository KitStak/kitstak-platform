/** GET /api/v1/import/[batchId]/errors.csv (SPEC 7): the rows with errors, with the message on each. */
import { z } from 'zod';
import { importErrorReport } from '@/server/domain/imports';
import { DomainError } from '@/server/errors';
import { csvRoute } from '@/server/http/api';

export const dynamic = 'force-dynamic';

export const GET = csvRoute<{ batchId: string }>(async ({ ctx, params }) => {
  if (!z.string().uuid().safeParse(params.batchId).success) throw new DomainError('NOT_FOUND', 'That import does not exist.');
  return importErrorReport(ctx, params.batchId);
});
