import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAppDb } from '@/server/api/db';
import { getAuthContext } from '@/server/auth/context';
import { requirePagePermission } from '@/server/auth/permissions';
import { getUser } from '@/server/repositories/users';
import { splitName } from '@/lib/grid-defs/admin/account';
import { PageHeader } from '@/components/layout/page-header';
import { AccountShell } from '@/components/layout/account/account-shell';
import { ProfileForm } from '@/components/admin/account/profile-form';
import { SkeletonText } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'My Profile' };

const ROUTE = '/account/profile';

async function ProfileBody() {
  await requirePagePermission('settings.my_profile.view', ROUTE);
  const auth = await getAuthContext();
  if (!auth) redirect(`/login?next=${encodeURIComponent(ROUTE)}`);
  const d = await getUser(await getAppDb(), auth.user.id);
  const split = splitName(d.name);
  return (
    <ProfileForm
      profile={{
        displayName: d.name,
        firstName: d.firstName ?? split.first,
        lastName: d.lastName ?? split.last,
        email: d.email,
        roles: d.roles.map((r) => r.name),
        warehouses: d.warehouses.map((w) => w.name),
        allClients: d.allClients,
        clientCount: d.clients.length,
        userType: d.userType,
        lastLoginAt: d.lastLoginAt,
        passwordChangedAt: d.passwordChangedAt,
      }}
    />
  );
}

/** `/account/profile` — edit your display name, names and sign-in email. */
export default function ProfilePage() {
  return (
    <>
      <PageHeader
        title="My Profile"
        helper="Edit your account details. Your roles and access are managed by an administrator."
      />
      <AccountShell
        active="profile"
        title="My profile"
        description="Your name and sign-in email in this workspace."
      >
        <Suspense fallback={<SkeletonText lines={6} />}>
          <ProfileBody />
        </Suspense>
      </AccountShell>
    </>
  );
}
