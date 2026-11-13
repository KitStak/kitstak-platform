import { listGoals, listProjects } from '@/server/domain';
import { pageContext } from '@/server/page';
import { GoalsView } from './goals-view';

export async function GoalsPage() {
  const { ctx } = await pageContext('/goals');
  const [goals, projects] = await Promise.all([listGoals(ctx), listProjects(ctx)]);
  return <GoalsView initialGoals={goals} initialProjects={projects} />;
}
