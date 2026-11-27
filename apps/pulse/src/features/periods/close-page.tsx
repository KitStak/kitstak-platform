import { Page } from '@/components/layout/page';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { getCloseBoard, getCloseDetail, listCloseEvents } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { CloseView } from './close-view';
import { pickMonth } from './close-model';

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Month close: the checklist, the lock, reopening with a reason, and who did what. */
export async function ClosePage({ searchParams }: { readonly searchParams?: Search }) {
  const params = (await searchParams) ?? {};
  const wanted = typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? `${params.month}-01` : null;
  const page = await pulsePage(routes.settingsClose(), 'settings');
  if (page.blocked) return <PageBlocked title="Month close" role={page.access.role} />;
  const [board, events] = await Promise.all([getCloseBoard(page.ctx), listCloseEvents(page.ctx)]);
  const month = pickMonth(board.months, wanted);
  const detail = month ? await getCloseDetail(page.ctx, month) : null;
  return (
    <Page
      title="Settings"
      subtitle="How Pulse is set up for your workspace."
      tabs={
        <RouteTabs
          label="Settings sections"
          active="close"
          tabs={[
            { id: 'all', label: 'Workspace', href: routes.settings() },
            { id: 'close', label: 'Month close', href: routes.settingsClose() },
            { id: 'apps', label: 'Connected apps', href: routes.settingsApps() },
            { id: 'audit', label: 'Audit log', href: routes.settingsAudit() },
          ]}
        />
      }
    >
      <CloseView initialBoard={board} initialMonth={month} initialDetail={detail} initialEvents={events} />
    </Page>
  );
}
