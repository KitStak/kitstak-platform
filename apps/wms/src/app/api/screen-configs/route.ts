/**
 * `GET /api/screen-configs` — Receiving screen configuration grid (grid grammar, caller's
 * warehouse scope). `POST` — create from the General / Conditions / Configuration page.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { OPERATION_TYPES, screenConfigSchema } from '@/lib/grid-defs/admin/screen-configs';
import { createScreenConfig, listScreenConfigs } from '@/server/repositories/screen-configs';

export const GET = defineRoute({
  permission: 'settings.screen_configuration.view',
  query: z.object({ operationType: z.enum(OPERATION_TYPES).default('Receiving') }).passthrough(),
  handler: async ({ db, auth, query, grid }) => {
    const gq = grid();
    const { rows, total } = await listScreenConfigs(db, auth, gq, query.operationType);
    return listResult(rows, { total, page: gq.page, pageSize: gq.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'settings.screen_configuration.create',
  body: screenConfigSchema,
  handler: async ({ db, auth, actor, body, audit }) => {
    const row = await createScreenConfig(db, auth, actor, body);
    await audit({
      action: 'screen_config.create',
      entity: 'screen_config',
      entityId: row.id,
      detail: { name: row.name },
    });
    return created(row);
  },
});
