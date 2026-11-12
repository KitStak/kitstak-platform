import type { Metadata } from 'next';
import { AnalyticsLanding } from '@/components/analytics/analytics-landing';

export const metadata: Metadata = { title: 'Labor Analytics' };

export default function Page() {
  return <AnalyticsLanding section="labor" />;
}
