/**
 * Page helper for server components:
 *   const page = await pageFor('/people');
 *   if (page.locked) return null;
 * Redirects to sign in when signed out (returning to `returnTo`), checks the preview gate, builds
 * the DomainContext and resolves the person's Crew access, so a page can hide what the role may
 * not do. The domain layer re-checks every read and write.
 *
 * Why the gate is checked here too: Next renders a page in parallel with its layout, so a page
 * runs even when the (app) layout shows the locked screen instead of it. A locked workspace must
 * read no crew data and send no page content, so a locked page renders nothing.
 */
import 'server-only';
import { NO_CREW_ACCESS } from '@kitstak/crew-bridge';
import { crewAccessFor, type CrewAccess } from '@/server/domain/access';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { orgCrewAccess } from '@/server/entitlements';
import { requirePageContext, type CrewContext } from '@/server/session';
import { canCrew, canSelf, type CrewAction } from '@/lib/permissions';

export interface CrewPageContext {
  readonly ctx: DomainContext;
  readonly context: CrewContext;
  readonly access: CrewAccess;
  /** The workspace is not in the preview (SPEC 3.4): render nothing. */
  readonly locked: boolean;
  readonly can: (action: CrewAction | 'self') => boolean;
}

export async function pageFor(returnTo: string): Promise<CrewPageContext> {
  const context = await requirePageContext(returnTo);
  const ctx = toDomainContext(context);
  const locked = (await orgCrewAccess(context.org)) === 'locked';
  const access = locked ? NO_CREW_ACCESS : await crewAccessFor(ctx);
  return {
    ctx,
    context,
    access,
    locked,
    can: (action) => !locked && (action === 'self' ? canSelf(access.linkedPersonId) : canCrew(access.role, action)),
  };
}
