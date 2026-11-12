/** `GET /api/company/code-generation` — Auto Code Generation preferences. `PUT` — save one sequence. */
import { defineRoute } from '@/server/api/define-route';
import { sequenceSchema } from '@/lib/grid-defs/admin/lookups';
import { listSequences, updateSequence } from '@/server/repositories/company-sequences';

export const GET = defineRoute({
  permission: 'settings.data_setup.view',
  handler: async ({ db }) => await listSequences(db),
});

export const PUT = defineRoute({
  permission: 'settings.data_setup.view',
  body: sequenceSchema,
  handler: async ({ db, auth, actor, body, audit }) => {
    const row = await updateSequence(db, auth, actor, body);
    await audit({
      action: 'sequence.update',
      entity: 'sequence',
      entityId: body.key,
      detail: { mode: body.autoGenerate ? 'auto' : 'manual', prefix: row.prefix },
    });
    return row;
  },
});
