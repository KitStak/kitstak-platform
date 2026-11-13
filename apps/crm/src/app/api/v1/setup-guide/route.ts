import { withApi } from '@/server/api';
import { applySetupGuideAction, getSetupGuide, setupGuideActionSchema } from '@/server/services/setup-guide';
import { svc } from '../_lib/route-helpers';

/**
 * Getting-started guide state: live-derived steps + org-level progress rows.
 * `recordSeen` writes the rollout-guard seen marker via `after()` (post-response).
 */
export const GET = withApi({ permission: 'org:read' }, (ctx) =>
  getSetupGuide(svc(ctx), { recordSeen: true }),
);

/** Skip/unskip a step or dismiss/restore the guide (owners/admins; org-level state). */
export const POST = withApi(
  { permission: 'org:update', body: setupGuideActionSchema },
  (ctx) => applySetupGuideAction(svc(ctx), ctx.body),
);
