import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getAppDb } from '@/server/api/db';
import { requirePagePermission } from '@/server/auth/permissions';
import { getAuthContext } from '@/server/auth/context';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { DisplayShowcase } from './_components/display-showcase';
import { FormsShowcase } from './_components/forms-showcase';
import { GridShowcase } from './_components/grid-showcase';
import { HashScroll } from './_components/hash-scroll';
import { InputsShowcase } from './_components/inputs-showcase';
import { loadDevOrderLines, loadDevOrders } from './_components/load-dev-orders';
import { OverlaysShowcase } from './_components/overlays-showcase';
import { ShowcaseNav } from './_components/showcase-nav';

export const metadata: Metadata = { title: 'UI Showcase' };

/** Builders and critics use this page; it is limited to users who can configure screens. */
const SHOWCASE_PERMISSION = 'settings.screen_configuration.view';

async function Showcase() {
  await requirePagePermission(SHOWCASE_PERMISSION, '/dev/ui');
  const auth = await getAuthContext();
  const db = await getAppDb();
  const rows = auth ? await loadDevOrders(db, auth.viewScope) : [];
  const lines = await loadDevOrderLines(
    db,
    rows.map((r) => r.id),
  );
  return (
    <div className="grid gap-6 px-6 py-5 lg:grid-cols-[180px_minmax(0,1fr)]">
      <ShowcaseNav />
      <div className="min-w-0 space-y-6">
        <DisplayShowcase />
        <InputsShowcase />
        <OverlaysShowcase />
        <FormsShowcase />
        <GridShowcase rows={rows} lines={lines} />
      </div>
      <HashScroll />
    </div>
  );
}

/** `/dev/ui` — every shared primitive, the wizard (both modes) and the grid on seeded data. */
export default function DevUiPage() {
  return (
    <>
      <PageHeader title="UI Showcase" helper="Living reference for the KitStak design system." />
      <Suspense fallback={<PageSkeleton />}>
        <Showcase />
      </Suspense>
    </>
  );
}
