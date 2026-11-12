import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { UsersPage } from '@/components/admin/users/users-page';
import { PasswordPolicySeed } from '@/components/admin/password-meter';
import { getAppDb } from '@/server/api/db';
import { getPasswordPolicy } from '@/server/auth/password-policy';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Users' };

async function Guard() {
  await requirePagePermission('settings.users.view', '/settings/users');
  // Seed the live company policy so the Add user meter never shows placeholder rules.
  const p = await getPasswordPolicy(await getAppDb());
  return (
    <PasswordPolicySeed
      policy={{
        minLength: p.minLength,
        requireUpper: p.requireUpper,
        requireNumber: p.requireNumber,
        requireSymbol: p.requireSymbol,
      }}
    >
      <UsersPage />
    </PasswordPolicySeed>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
