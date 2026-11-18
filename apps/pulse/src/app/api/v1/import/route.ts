import { z } from 'zod';
import { createImportBatch, listImportBatches, listImportStreams } from '@/server/domain';
import { apiRoute } from '@/server/http/api';
import { intParam, str } from '@/server/http/params';
import { parseBody } from '@/features/imports/server/body';

/** `GET /api/v1/import`: past imports (newest first) and one line per stream for the import center. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const [batches, streams] = await Promise.all([listImportBatches(ctx, { limit: intParam(searchParams, 'limit', 30, 100), stream: str(searchParams, 'stream') }), listImportStreams(ctx)]);
  return { batches, streams };
});

const createSchema = z.object({
  stream: z.string().min(1).max(40),
  fileName: z.string().max(300).nullable().optional(),
  fileSize: z.number().int().min(0).max(100_000_000).nullable().optional(),
  fileHash: z.string().max(128).nullable().optional(),
  delimiter: z.enum([',', ';', '\t']).nullable().optional(),
  headers: z.array(z.string().max(2000)).min(1).max(200),
});

/** `POST /api/v1/import`: opens a batch for a file and answers with the first column mapping. */
export const POST = apiRoute(async ({ ctx, request }) => createImportBatch(ctx, await parseBody(request, createSchema)));
