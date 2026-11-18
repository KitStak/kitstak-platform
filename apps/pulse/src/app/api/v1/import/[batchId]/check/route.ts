import { z } from 'zod';
import { checkImportBatch } from '@/server/domain';
import { apiRoute } from '@/server/http/api';
import { parseBody } from '@/features/imports/server/body';

export const maxDuration = 300;

const schema = z.object({
  mapping: z.array(z.string().max(60).nullable()).max(200).optional(),
  options: z
    .object({ mode: z.enum(['all_or_nothing', 'skip_bad_rows']), dateOrder: z.enum(['MDY', 'DMY']).nullable(), createMissing: z.boolean(), createLaborClasses: z.boolean(), lookalikes: z.enum(['skip', 'add']) })
    .partial()
    .optional(),
  savePresetAs: z.string().max(80).nullable().optional(),
});

/** `POST /api/v1/import/<batch>/check`: the dry run. Counts what is new, changed, the same or wrong. Saves nothing. */
export const POST = apiRoute<{ batchId: string }>(async ({ ctx, params, request }) => checkImportBatch(ctx, params.batchId, await parseBody(request, schema)));
