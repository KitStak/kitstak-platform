import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { env } from '@/server/env';
import { mustChangePassword } from '@/server/password-change';
import { requirePageSession } from '@/server/session';
import { safeReturnUrl } from '@/lib/routes';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Choose a new password' };

/**
 * Shown to a signed-in user whose password was set by an administrator. The portal and CRM
 * guards send them here until it is changed; anyone else is passed straight through.
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : null;
  // Only sibling KitStak apps may be returned to; anything else falls back to the launcher.
  const returnTo = safeReturnUrl(next, [env.NEXT_PUBLIC_CRM_URL, env.NEXT_PUBLIC_WMS_URL], '/');

  const session = await requirePageSession('/change-password');
  if (!(await mustChangePassword(session.user.id))) redirect(returnTo);

  return <ChangePasswordForm email={session.user.email} returnTo={returnTo} />;
}
