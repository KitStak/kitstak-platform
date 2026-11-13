import { listMyTasks } from '@/server/domain';
import { pageContext } from '@/server/page';
import { MyWorkView } from './my-work-view';

export async function MyWorkPage() {
  const { ctx } = await pageContext('/my-work');
  const tasks = await listMyTasks(ctx, { scope: 'assigned' });
  return <MyWorkView initialTasks={tasks} />;
}
