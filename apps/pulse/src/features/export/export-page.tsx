import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { DataTabs } from '@/features/imports/imports-page';
import { canImportStream } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { STREAMS } from '@/lib/streams';
import { countStreamRows } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { ExportView } from './export-view';

/** Export: one click CSV download per data stream, in the same columns as its import template. */
export async function ExportPage() {
  const page = await pulsePage(routes.exportCenter(), 'import');
  if (page.blocked || !page.can('export:run')) return <PageBlocked title="Export" role={page.access.role} />;
  const canImport = STREAMS.some((stream) => canImportStream(page.access.role, stream.id));
  const counts = await countStreamRows(page.ctx);
  return (
    <Page title="Import and export" subtitle="Bring in spreadsheets and download your data as CSV files. Pulse works with nothing else installed." tabs={<DataTabs active="export" />}>
      <ExportView initialCounts={counts} seesMoney={page.access.seesMoney} canImport={canImport} />
    </Page>
  );
}
