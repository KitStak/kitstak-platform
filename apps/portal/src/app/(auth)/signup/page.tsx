import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';
import { safeNextPath } from '@/lib/routes';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : null;
  if (await getSession()) redirect(safeNextPath(next, '/'));
  return <SignupForm next={next} />;
}
