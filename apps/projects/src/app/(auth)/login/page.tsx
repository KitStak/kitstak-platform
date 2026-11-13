import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appUrls } from '@/server/env';
import { getSession } from '@/server/session';
import { safeNextPath } from '@/lib/routes';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Readonly<Record<string, string>> = {
  'signed-out': 'You have been signed out.',
};

export default async function LoginPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : null;
  if (await getSession()) redirect(safeNextPath(next, '/'));
  const noticeKey = typeof params.notice === 'string' ? params.notice : '';
  return <LoginForm next={next} notice={NOTICES[noticeKey] ?? null} portalUrl={appUrls().portal} resetUrl="/forgot-password" />;
}
