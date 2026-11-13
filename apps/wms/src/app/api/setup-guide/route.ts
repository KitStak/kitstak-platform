/**
 * `GET /api/setup-guide` — derived "Get set up" state for the dashboard panel
 * (every signed-in user sees it; step CTAs are permission-gated client side and
 * re-checked by each target page).
 * `POST /api/setup-guide` — explicit guide actions (skip / unskip a step,
 * dismiss / restore the guide). Admin-ish only: these are org-level decisions, so
 * they ride the same key as company settings changes.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { applySetupGuideAction, loadSetupGuide } from '@/server/setup/setup-guide';

export const GET = defineRoute({
  handler: async ({ db }) => await loadSetupGuide(db),
});

const actionBody = z.object({
  action: z.enum(['skip', 'unskip', 'dismiss', 'restore']),
  stepKey: z.string().max(64).optional(),
});

export const POST = defineRoute({
  permission: 'settings.company_settings.update',
  body: actionBody,
  handler: async ({ db, auth, body, audit }) => {
    const guide = await applySetupGuideAction(db, body.action, body.stepKey, auth.user.id);
    await audit({
      action: `setup_guide.${body.action}`,
      entity: 'setup_guide',
      entityId: body.stepKey ?? 'guide',
      detail: { action: body.action, stepKey: body.stepKey ?? null },
    });
    return guide;
  },
});
