/**
 * Page helper for server components: `const { ctx, context } = await pageContext('/my-work');`
 * Redirects to sign-in when signed out (returning to `returnTo`), and builds the DomainContext.
 */
import 'server-only';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { requirePageContext, type ProjectsContext } from '@/server/session';

export async function pageContext(returnTo: string): Promise<{ ctx: DomainContext; context: ProjectsContext }> {
  const context = await requirePageContext(returnTo);
  return { ctx: toDomainContext(context), context };
}
