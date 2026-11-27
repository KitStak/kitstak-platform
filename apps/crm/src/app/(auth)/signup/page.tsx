import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DEFAULT_SELECTION } from '@kitstak/billing/catalog';
import { signupUrl } from '@kitstak/billing/handoff';
import { getSession } from '@/server/auth/session';
import { entitlementsAllowAll } from '@/server/entitlements';
import { safeNextPath } from '@/features/shell/routes';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignupPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? safeNextPath(params.next, '') || null : null;
  if (await getSession()) redirect(safeNextPath(next, '/'));
  // One front door (docs/billing/SPEC.md section 9.5): when plans are enforced, new accounts are
  // made in the Portal, with the CRM already picked for the free trial. People who follow an
  // invitation keep this page, because they join an existing team and start no trial.
  const portal = process.env.NEXT_PUBLIC_PORTAL_URL?.trim();
  const invited = Boolean(next && next.startsWith('/welcome/invite/'));
  if (portal && !invited && !entitlementsAllowAll()) {
    redirect(signupUrl(portal, { selection: { ...DEFAULT_SELECTION, products: ['crm'] }, profile: {}, source: 'app' }));
  }
  return <SignupForm next={next} />;
}
