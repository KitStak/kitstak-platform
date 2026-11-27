import type { Metadata } from 'next';
import { FloorTodayPage } from '@/features/programs/floor/floor-today-page';

export const metadata: Metadata = { title: 'Floor today' };

/** `/programs/today`: a static segment, so it wins over `/programs/[key]` (keys are upper case). */
export default function Page() {
  return <FloorTodayPage />;
}
