import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Labor rules' };

export default function Page() {
  return <PhasePage id="settings-rules" path="/settings/rules" />;
}
