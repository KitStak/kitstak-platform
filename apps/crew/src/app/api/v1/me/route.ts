/** GET /api/v1/me (SPEC 8.8): user, org, Crew role, site scope, pay sight, linked person, integration availability. */
import { crewAvailability } from '@kitstak/crew-bridge';
import { db } from '@/server/db';
import { crewAccessFor } from '@/server/domain/access';
import { apiRoute } from '@/server/http/api';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async ({ ctx, context }) => {
  const access = await crewAccessFor(ctx);
  return {
    user: context.user,
    org: { id: context.org.id, name: context.org.name, slug: context.org.slug },
    crewRole: access.role,
    siteIds: access.siteIds,
    canSeePay: access.canSeePay,
    canSeePrivate: access.canSeePrivate,
    linkedPersonId: access.linkedPersonId,
    // Sibling reads arrive in Phase 8; Phase 0 reports only its own schema.
    integrations: { crew: (await crewAvailability(db)).installed, pulse: false, projects: false, wms: false, crm: false, ledger: false },
  };
});
