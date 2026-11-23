import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { handoffRecord, hasHandoff, readHandoff, withHandoff } from '@/features/signup/cart';
import { safeNextPath } from '@/lib/routes';
import { legalUrls } from '@/server/env';
import { getSession } from '@/server/session';
import { getSignupResumeHref, socialProviders } from '@/server/signup';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Readonly<Record<string, string>> = {
  'signed-out': 'You have been signed out.',
  'password-reset': 'Your password is changed. Sign in with your new password.',
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : null;
  const handoff = readHandoff(params);
  const session = await getSession();
  if (session) {
    // A place the person asked for wins. A cart from the link goes through signup, which keeps it.
    // Otherwise a half done signup picks up where it stopped (SPEC 5.6).
    if (next) redirect(safeNextPath(next, '/'));
    if (hasHandoff(handoff)) redirect(withHandoff('/signup', handoff));
    redirect(await getSignupResumeHref(session));
  }
  const noticeKey = typeof params.notice === 'string' ? params.notice : '';
  return (
    <LoginForm
      next={next ? safeNextPath(next, '/') : null}
      notice={NOTICES[noticeKey] ?? null}
      handoff={handoffRecord(handoff)}
      providers={socialProviders()}
      legal={legalUrls()}
      providerError={typeof params.error === 'string' ? params.error : null}
    />
  );
}
