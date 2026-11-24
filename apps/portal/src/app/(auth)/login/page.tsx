import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { handoffRecord, hasHandoff, readHandoff, withHandoff } from '@/features/signup/cart';
import { appEntryUrl } from '@kitstak/auth/front-door';
import { safeNextPath, safeReturnUrl } from '@/lib/routes';
import { env, legalUrls, trustedOrigins } from '@/server/env';
import { getSession } from '@/server/session';
import { devOutboxOn, getSignupResumeHref, socialProviders } from '@/server/signup';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Readonly<Record<string, string>> = {
  'signed-out': 'You have been signed out.',
  'password-reset': 'Your password is changed. Sign in with your new password.',
  // The WMS signs a person out after a long time away and sends them here.
  idle: 'You were signed out because you were away for a while. Sign in to pick up where you left off.',
};

/**
 * Where sign in goes afterwards (review round 4: one front door). `next` is a Portal path, or the
 * full address of a page in the CRM, the WMS, Projects or Pulse, which send their signed out
 * visitors here. Only the trusted KitStak origins are let through; anything else is dropped. An
 * address on the Portal itself becomes a plain path.
 */
function nextTarget(raw: string | null): string | null {
  if (!raw) return null;
  const safe = safeReturnUrl(raw, trustedOrigins(), '');
  if (safe === '') return null;
  if (safe.startsWith('/')) return safe;
  try {
    const url = new URL(safe);
    if (url.origin === new URL(env.BETTER_AUTH_URL).origin) return safeNextPath(`${url.pathname}${url.search}`, '/');
  } catch {
    return null;
  }
  return safe;
}

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = nextTarget(typeof params.next === 'string' ? params.next : null);
  const handoff = readHandoff(params);
  const session = await getSession();
  if (session) {
    // A place the person asked for wins. A cart from the link goes through signup, which keeps it.
    // Otherwise a half done signup picks up where it stopped (SPEC 5.6). A page in another app is
    // entered through that app's own door, marked as coming from here, so the two can never send
    // a person back and forth (`appEntryUrl`).
    if (next) redirect(next.startsWith('/') ? next : appEntryUrl(next));
    if (hasHandoff(handoff)) redirect(withHandoff('/signup', handoff));
    redirect(await getSignupResumeHref(session));
  }
  const noticeKey = typeof params.notice === 'string' ? params.notice : '';
  return (
    <LoginForm
      next={next}
      notice={NOTICES[noticeKey] ?? null}
      handoff={handoffRecord(handoff)}
      providers={socialProviders()}
      legal={legalUrls()}
      providerError={typeof params.error === 'string' ? params.error : null}
      devOutbox={devOutboxOn()}
    />
  );
}
