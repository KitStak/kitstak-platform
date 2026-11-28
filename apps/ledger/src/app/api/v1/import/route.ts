import { z } from 'zod';
import { apiRoute, readJson } from '@/server/http/api';
import { checkSetupImport } from '@/server/domain/setup-import';
import { SETUP_STREAMS } from '@/server/csv/streams';
import { DomainError } from '@/server/errors';

/** Route handlers may take a large body; the file is read as text in the browser and sent as JSON. */
export const maxDuration = 60;

const bodySchema = z.object({
  stream: z.enum(SETUP_STREAMS),
  fileName: z.string().trim().max(200).nullable().optional(),
  text: z.string().min(1, 'The file is empty.'),
});

/** `POST /api/v1/import`: the check step of a setup import (SPEC 7). Answers the batch id and counts; saves no record. */
export const POST = apiRoute(
  async ({ ctx, request }) => {
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new DomainError('VALIDATION', parsed.error.issues[0]?.message ?? 'Pick what the file holds and a CSV file.');
    return checkSetupImport(ctx, { stream: parsed.data.stream, fileName: parsed.data.fileName ?? null, text: parsed.data.text });
  },
  { rights: ['import:run'] },
);
