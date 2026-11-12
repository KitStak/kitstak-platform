import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrgAutomationsPage } from '@/features/automations/org-automations';

export const metadata: Metadata = { title: 'Automations' };

export default function AutomationsPage() {
  return (
    <Suspense>
      <OrgAutomationsPage />
    </Suspense>
  );
}
