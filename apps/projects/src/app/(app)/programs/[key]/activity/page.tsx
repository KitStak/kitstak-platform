import type { Metadata } from 'next';
import { ActivityTab } from '@/features/programs/activity/activity-tab';

export const metadata: Metadata = { title: 'Activity' };

/** Program Activity tab (docs/programs/SPEC.md 5.15). */
export default function Page() {
  return <ActivityTab />;
}
