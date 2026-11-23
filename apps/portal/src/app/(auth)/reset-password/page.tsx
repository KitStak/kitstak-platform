import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { EMAIL_CODE_MINUTES } from '@/server/auth';
import { getSession } from '@/server/session';
import { devOutboxOn } from '@/server/signup';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password' };

/** Takes the emailed code and a new password. The rules and the meter are the ones signup uses. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getSession()) redirect('/');
  const params = await searchParams;
  return (
    <ResetPasswordForm
      justSent={params.sent === '1'}
      minutes={EMAIL_CODE_MINUTES}
      devOutbox={devOutboxOn()}
    />
  );
}
