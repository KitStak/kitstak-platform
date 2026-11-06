import type { Metadata } from 'next';
import { ResetForm } from './reset-form';

export const metadata: Metadata = { title: 'Choose a new password' };

const TOKEN_RE = /^[A-Za-z0-9_-]{8,256}$/;

export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = typeof params.token === 'string' ? params.token : null;
  const token = raw && TOKEN_RE.test(raw) ? raw : null;
  return <ResetForm token={token} linkError={typeof params.error === 'string'} />;
}
