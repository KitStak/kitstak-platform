import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { portalForgotPasswordUrl } from '@kitstak/auth/front-door';
import { env } from '@/server/env';
import { ForgotForm } from './forgot-form';

export const metadata: Metadata = { title: 'Reset your password' };

/**
 * One place to reset a password (billing review round 4): the Portal. It emails a 6 digit code and
 * the new password works in every KitStak app. This page used to say "ask your KitStak
 * administrator", which is no answer for an owner. The form below stays only for a CRM that runs
 * with no Portal address set.
 */
export default function ForgotPasswordPage() {
  const door = portalForgotPasswordUrl(process.env.NEXT_PUBLIC_PORTAL_URL, env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL);
  if (door) redirect(door);
  return <ForgotForm />;
}
