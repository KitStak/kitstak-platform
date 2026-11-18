import { z } from 'zod';
import { listImportPresets, saveImportPreset } from '@/server/domain';
import { invalid } from '@/server/errors';
import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { parseBody } from '@/features/imports/server/body';

/** `GET /api/v1/import/presets?stream=`: the saved column mappings of a stream. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const stream = str(searchParams, 'stream');
  if (!stream) throw invalid('Say which kind of file: add ?stream= to the address.');
  return listImportPresets(ctx, stream);
});

const schema = z.object({
  stream: z.string().min(1).max(40),
  name: z.string().trim().min(1, 'Give the saved mapping a name.').max(80),
  headers: z.array(z.string().max(2000)).min(1).max(200),
  mapping: z.array(z.string().max(60).nullable()).max(200),
  options: z
    .object({ mode: z.enum(['all_or_nothing', 'skip_bad_rows']), dateOrder: z.enum(['MDY', 'DMY']).nullable(), createMissing: z.boolean(), lookalikes: z.enum(['skip', 'add']) })
    .partial()
    .optional(),
});

/** `POST /api/v1/import/presets`: saves a mapping under a name (the same name saves over it). */
export const POST = apiRoute(async ({ ctx, request }) => saveImportPreset(ctx, await parseBody(request, schema)));
