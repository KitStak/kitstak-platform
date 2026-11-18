import type { Metadata } from 'next';
import { AlertRulesPage } from '@/features/alerts';

export const metadata: Metadata = { title: 'Alert rules' };

export default function Page() {
  return <AlertRulesPage />;
}
