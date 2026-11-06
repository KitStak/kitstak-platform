import { withApi } from '@/server/api';
import { recordAudit } from '@/server/audit';
import { completeOnboarding, onboardingSchema } from '@/server/services/onboarding';
import { created } from '../_lib/route-helpers';

/** Create an organization (caller becomes owner) with a ready-to-use CRM workspace. */
export const POST = withApi({ org: 'none', rateLimit: 'heavy', body: onboardingSchema }, async (ctx) => {
  const result = await completeOnboarding(ctx.user.id, ctx.body, ctx.db);
  await recordAudit({
    orgId: result.organization.id,
    actorId: ctx.user.id,
    action: 'org.created',
    targetType: 'organization',
    targetId: result.organization.id,
    ipAddress: ctx.ip,
    userAgent: ctx.request.headers.get('user-agent'),
    requestId: ctx.requestId,
  });
  return created(result);
});
