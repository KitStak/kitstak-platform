/**
 * `GET /api/files/[id]?inline=1` — download, authorized through the file's owner
 * (record view permission + scope, own task/import, or own upload); otherwise 404.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { fileStore } from '@/server/files';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { authorizeFileRead, fileResponse } from '@/server/repositories/platform-files';

export const GET = defineRoute({
  params: idParamsSchema,
  query: z.object({ inline: z.enum(['0', '1']).default('0') }),
  handler: async ({ db, auth, params, query }) => {
    const store = fileStore();
    await authorizeFileRead(db, store, auth, params.id);
    const { record, bytes } = await store.read(db, params.id);
    return fileResponse(record, bytes, query.inline === '1');
  },
});
