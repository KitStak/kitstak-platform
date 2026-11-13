import { getUserPrefs, listGoals, listMyTasks, listNotifications, listProjects } from '@/server/domain';
import { pageContext } from '@/server/page';
import { HomeView } from './home-view';

export async function HomePage({ searchParams }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx } = await pageContext('/');
  const params = (await searchParams) ?? {};
  const [tasks, created, projects, inbox, goals, prefs] = await Promise.all([
    listMyTasks(ctx, { scope: 'assigned' }),
    listMyTasks(ctx, { scope: 'created', includeCompleted: true, limit: 1 }),
    listProjects(ctx),
    listNotifications(ctx, { filter: 'unread', limit: 6 }),
    listGoals(ctx),
    getUserPrefs(ctx),
  ]);
  const home = (prefs.home ?? {}) as { gettingStartedDismissed?: boolean };
  return (
    <HomeView
      initialTasks={tasks}
      initialProjects={projects}
      initialInbox={inbox}
      initialGoals={goals}
      createdTaskCount={created.length}
      gettingStartedDismissed={Boolean(home.gettingStartedDismissed)}
      forceGettingStarted={params.tour === '1'}
    />
  );
}
