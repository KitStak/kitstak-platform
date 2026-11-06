import { withApi } from '@/server/api';
import { pipelineSettingsSchema } from '@/server/services/crm-contracts';
import { savePipelineSettings } from '@/server/services/crm-pipeline';
import { svc } from '../../../_lib/route-helpers';

/** Save stage probabilities, rep quotas and the stale threshold (boards.settings.crm). */
export const PUT = withApi(
  {
    permission: 'board:write',
    body: pipelineSettingsSchema,
    audit: { action: 'crm.pipeline_settings_updated', target: (ctx) => ({ type: 'board', id: (ctx.body as { boardId: string }).boardId }) },
  },
  (ctx) => savePipelineSettings(svc(ctx), ctx.body),
);
