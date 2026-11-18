import { z } from 'zod';
import { deleteImportPreset, renameImportPreset } from '@/server/domain';
import { apiRoute } from '@/server/http/api';
import { parseBody } from '@/features/imports/server/body';

type Params = { presetId: string };

/** `PATCH /api/v1/import/presets/<id>`: renames a saved mapping. */
export const PATCH = apiRoute<Params>(async ({ ctx, params, request }) => {
  const body = await parseBody(request, z.object({ name: z.string().trim().min(1, 'Give the saved mapping a name.').max(80) }));
  await renameImportPreset(ctx, params.presetId, body.name);
  return { renamed: true };
});

/** `DELETE /api/v1/import/presets/<id>`: forgets a saved mapping. */
export const DELETE = apiRoute<Params>(async ({ ctx, params }) => {
  await deleteImportPreset(ctx, params.presetId);
  return { deleted: true };
});
