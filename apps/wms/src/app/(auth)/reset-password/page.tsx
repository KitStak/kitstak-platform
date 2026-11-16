import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getAppDb } from '@/server/api/db';
import { getPasswordPolicy } from '@/server/auth/password-policy';
import { AuthFrame } from '@/components/layout/auth-frame';
import { ResetPasswordForm } from '@/components/layout/reset-password-form';
import { Callout } from '@/components/ui/callout';

export const metadata: Metadata = { title: 'Reset password' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 200;

async function ResetBody({ searchParams }: { readonly searchParams: SearchParams }) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    return (
      <Callout variant="error" title="This reset link is invalid">
        The link is incomplete or has expired.{' '}
        <Link href="/forgot-password" className="font-semibold underline">
          Request a new link
        </Link>
        .
      </Callout>
    );
  }
  const policy = await getPasswordPolicy(await getAppDb());
  return (
    <ResetPasswordForm
      token={token}
      policy={{
        minLength: policy.minLength,
        requireUpper: policy.requireUpper,
        requireNumber: policy.requireNumber,
        requireSymbol: policy.requireSymbol,
      }}
    />
  );
}

export default function ResetPasswordPage({ searchParams }: { readonly searchParams: SearchParams }) {
  return (
    <AuthFrame title="Choose a new password" description={null}>
      <Suspense fallback={null}>
        <ResetBody searchParams={searchParams} />
      </Suspense>
    </AuthFrame>
  );
}
