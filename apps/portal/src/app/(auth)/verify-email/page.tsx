import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/routes';
import { EMAIL_CODE_MINUTES } from '@/server/auth';
import { getSession } from '@/server/session';
import { devOutboxOn } from '@/server/signup';
import { VerifyEmailForm } from './verify-email-form';

export const metadata: Metadata = { title: 'Check your email' };

const RESEND_WAIT_SECONDS = 30;

/**
 * Enter the 6 digit code (docs/billing/SPEC.md section 5.4). Verification never blocks the first
 * session: "I will do this later" goes on. Paying and inviting send an unverified person here with
 * `?next=` and bring them straight back.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null, '/');
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/verify-email?next=${next}`)}`);
  if (session.user.emailVerified) redirect(next);

  // A code went out when the account was made. Hold "Send a new code" for the rest of 30 seconds.
  const ageSeconds = Math.floor((Date.now() - new Date(session.user.createdAt).getTime()) / 1000);
  const waitSeconds = ageSeconds >= 0 && ageSeconds < RESEND_WAIT_SECONDS ? RESEND_WAIT_SECONDS - ageSeconds : 0;
  // Outside production with no mail key, emails land in the dev outbox page instead of an inbox.
  const devOutbox = devOutboxOn();

  return (
    <VerifyEmailForm
      email={session.user.email}
      next={next}
      minutes={EMAIL_CODE_MINUTES}
      initialWaitSeconds={waitSeconds}
      resendWaitSeconds={RESEND_WAIT_SECONDS}
      devOutbox={devOutbox}
    />
  );
}
