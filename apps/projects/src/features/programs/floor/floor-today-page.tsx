import { floorToday, scheduleProgramSweep } from '@/server/domain/programs';
import { pageContext } from '@/server/page';
import { FloorToday } from './floor-today';

/** Floor today (docs/programs/SPEC.md 5.18). Seeds today's runs on the server, then lives on the client. */
export async function FloorTodayPage() {
  const { ctx } = await pageContext('/programs/today');
  const data = await floorToday(ctx, {}).catch(() => null);
  scheduleProgramSweep(ctx);
  return <FloorToday initialDate={data?.date ?? null} />;
}
