import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProfilePage } from '@/features/admin/profile/profile-page';

export const metadata: Metadata = { title: 'My profile' };

export default function Page() {
  // ProfilePage reads ?tab= with useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ProfilePage />
    </Suspense>
  );
}
