import { Download, Upload } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { DataTabs } from '@/features/imports/imports-page';
import { canImportStream } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { STREAMS } from '@/lib/streams';
import { pulsePage } from '@/server/page';

/** Export: one click CSV download per data stream, in the same columns as its import template. */
export async function ExportPage() {
  const page = await pulsePage(routes.exportCenter(), 'import');
  if (page.blocked || !page.can('export:run')) return <PageBlocked title="Export" role={page.access.role} />;
  const canImport = STREAMS.some((stream) => canImportStream(page.access.role, stream.id));
  return (
    <Page title="Import and export" subtitle="Bring in spreadsheets and download your data as CSV files. Pulse works with nothing else installed." tabs={<DataTabs active="export" />}>
      <Panel>
        <Teach
          icon={Download}
          title="Nothing to export yet"
          why={`Your data is always yours. Once there are rows in Pulse, each of the ${STREAMS.length} kinds of data downloads as a CSV file with one click, in the same columns as its import template, so a file you export can be fixed and brought straight back in.`}
          points={['Pick a date range and filters, or take everything in one zip file', 'Files open cleanly in Excel and Google Sheets', page.access.seesMoney ? 'Money columns are included for you' : 'Money columns are left out for your role']}
          actions={
            canImport ? (
              <ButtonLink href={routes.importCenter()} icon={<Upload aria-hidden />}>
                Import your first file
              </ButtonLink>
            ) : (
              <ButtonLink href={routes.jobs()}>Open jobs</ButtonLink>
            )
          }
        />
      </Panel>
    </Page>
  );
}
