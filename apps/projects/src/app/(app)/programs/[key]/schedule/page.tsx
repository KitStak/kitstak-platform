import type { Metadata } from 'next';
import { ScheduleTab } from '@/features/programs/schedule/schedule-tab';
import { listSchedules } from '@/server/domain/programs';
import { pageContext } from '@/server/page';

type Params = Promise<{ key: string }>;

export const metadata: Metadata = { title: 'Schedule' };

/** Schedule tab (docs/programs/SPEC.md 5.13). `?new=1` opens the new schedule editor. */
export default async function Page({ params }: { readonly params: Params }) {
  const { key } = await params;
  const programKey = decodeURIComponent(key).toUpperCase();
  const { ctx } = await pageContext(`/programs/${programKey}/schedule`);
  return <ScheduleTab initialSchedules={await listSchedules(ctx, programKey)} />;
}
