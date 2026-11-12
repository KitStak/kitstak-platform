import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth/session';
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
  const noticeKey = typeof params.notice === 'string' ? params.notice : '';
  return <LoginForm next={next} notice={NOTICES[noticeKey] ?? null} />;
}
