import type { Metadata } from 'next';
import { WorkCalendarPage } from '@/features/settings/work-calendar-page';

export const metadata: Metadata = { title: 'Work calendar' };

export default async function Page() {
  return <WorkCalendarPage />;
}
