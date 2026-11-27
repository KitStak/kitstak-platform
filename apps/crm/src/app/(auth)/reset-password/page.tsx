import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { portalForgotPasswordUrl } from '@kitstak/auth/front-door';
import { env } from '@/server/env';
import { ResetForm } from './reset-form';

export const metadata: Metadata = { title: 'Choose a new password' };

const TOKEN_RE = /^[A-Za-z0-9_-]{8,256}$/;

export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // No reset link is ever mailed by the CRM. A visit with no token is a person looking for the
  // way to reset: that is the Portal's page (billing review round 4).
  if (typeof params.token !== 'string') {
    const door = portalForgotPasswordUrl(process.env.NEXT_PUBLIC_PORTAL_URL, env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL);
    if (door) redirect(door);
  }
  const raw = typeof params.token === 'string' ? params.token : null;
  const token = raw && TOKEN_RE.test(raw) ? raw : null;
  return <ResetForm token={token} linkError={typeof params.error === 'string'} />;
}
