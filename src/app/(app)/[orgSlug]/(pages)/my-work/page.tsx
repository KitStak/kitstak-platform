import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MyWorkPage } from '@/features/inbox-mywork';

export const metadata: Metadata = { title: 'My work' };

export default function Page() {
  return (
    <Suspense>
      <MyWorkPage />
    </Suspense>
  );
}
