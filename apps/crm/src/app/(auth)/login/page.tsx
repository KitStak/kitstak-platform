import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { portalSignInUrl, staysOnLocalSignIn } from '@kitstak/auth/front-door';
import { getSession } from '@/server/auth/session';
import { env } from '@/server/env';
import { safeNextPath } from '@/features/shell/routes';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Readonly<Record<string, string>> = {
  'password-reset': 'Your password was updated. Sign in with your new password.',
  'signed-out': 'You have been signed out.',
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : null;
  if (await getSession()) redirect(safeNextPath(next, '/'));
  // One front door (billing review round 4): KitStak has one sign in page, the Portal's. It is the
  // only one with every way in (password, emailed code, Google, Microsoft). A signed out visit goes
  // there, with the full address of the page that was asked for, and comes back here signed in.
  // This form stays for `?local=1` (tests, and the day the Portal is down) and for a visit the
  // Portal itself sent (`from=portal`), so the two can never bounce a person back and forth.
  if (!staysOnLocalSignIn(params)) {
    const door = portalSignInUrl({
      portalUrl: process.env.NEXT_PUBLIC_PORTAL_URL,
      appUrl: env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL,
      next: next ? safeNextPath(next, '/') : null,
      notice: typeof params.notice === 'string' ? params.notice : null,
    });
    if (door) redirect(door);
  }
  const noticeKey = typeof params.notice === 'string' ? params.notice : '';
  return <LoginForm next={next} notice={NOTICES[noticeKey] ?? null} />;
}
