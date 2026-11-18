import Link from 'next/link';
import { ChevronRight, FileSearch, FileSpreadsheet, Upload } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { canImportStream, canPulse } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { STREAMS, streamInfo, type StreamInfo } from '@/lib/streams';
import { getImportBatch, listImportBatches, listImportStreams } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pulsePage, type PulsePage } from '@/server/page';
import { ImportBatch } from './import-batch';
import { ImportCenter } from './import-center';
import { ImportUpload } from './import-upload';
import type { ImportBatchDTO } from './types';

export function DataTabs({ active }: { readonly active: 'import' | 'export' }) {
  return (
    <RouteTabs
      label="Import and export"
      active={active}
      tabs={[
        { id: 'import', label: 'Import', href: routes.importCenter() },
        { id: 'export', label: 'Export', href: routes.exportCenter() },
      ]}
    />
  );
}

/** The streams this person may import (supervisors only get the floor streams, labor rates need an admin). */
function allowedStreams(page: PulsePage): readonly StreamInfo[] {
  return STREAMS.filter((stream) => canImportStream(page.access.role, stream.id) && (stream.id !== 'labor_rates' || canPulse(page.access.role, 'rate:manage')));
}

const SUBTITLE = 'Bring in spreadsheets and download your data as CSV files. Pulse works with nothing else installed.';

/** Import center: one card per data stream with its template, and the history of past imports. */
export async function ImportsPage() {
  const page = await pulsePage(routes.importCenter(), 'import');
  if (page.blocked) return <PageBlocked title="Import and export" role={page.access.role} />;
  const streams = allowedStreams(page);
  if (streams.length === 0) {
    return (
      <Page title="Import and export" subtitle={SUBTITLE} tabs={<DataTabs active="import" />}>
        <Panel>
          <Teach icon={FileSpreadsheet} title="Your role cannot import files" why="Importing changes the numbers everyone sees, so it needs a supervisor or a manager. You can still download data from the Export tab." actions={<ButtonLink href={routes.exportCenter()}>Go to Export</ButtonLink>} />
        </Panel>
      </Page>
    );
  }
  const [batches, summary] = await Promise.all([listImportBatches(page.ctx, { limit: 50 }), listImportStreams(page.ctx)]);
  return (
    <Page
      title="Import and export"
      subtitle={SUBTITLE}
      tabs={<DataTabs active="import" />}
      actions={
        <ButtonLink href={routes.newImport()} icon={<Upload aria-hidden />} testId="import-new">
          New import
        </ButtonLink>
      }
    >
      <ImportCenter initial={{ batches, streams: summary }} allowed={streams.map((stream) => stream.id)} />
    </Page>
  );
}

/** New import: pick what you are bringing in, then upload the file. */
export async function NewImportPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).stream;
  const requested = streamInfo((Array.isArray(raw) ? raw[0] : raw) ?? '');
  const page = await pulsePage(routes.newImport(requested?.id), 'import');
  if (page.blocked) return <PageBlocked title="New import" role={page.access.role} />;
  const streams = allowedStreams(page);
  if (streams.length === 0 || (requested && !streams.some((stream) => stream.id === requested.id))) {
    return <PageBlocked title="New import" role={page.access.role} />;
  }
  const breadcrumbs = [{ label: 'Import and export', href: routes.importCenter() }, { label: requested ? `Import ${requested.name.toLowerCase()}` : 'New import' }];
  if (requested) {
    return (
      <Page
        title={`Import ${requested.name.toLowerCase()}`}
        subtitle={requested.description}
        breadcrumbs={breadcrumbs}
        actions={
          <ButtonLink href={routes.newImport()} variant="secondary" testId="import-pick-other">
            Pick something else
          </ButtonLink>
        }
      >
        <ImportUpload stream={requested} />
      </Page>
    );
  }
  return (
    <Page title="New import" subtitle="Pick what you are bringing in. Each kind of data has its own simple file." breadcrumbs={breadcrumbs} width="narrow">
      <Panel title="What are you bringing in?">
        <ul className="-my-1 flex flex-col divide-y divide-border-subtle">
          {streams.map((stream) => (
            <li key={stream.id}>
              <Link
                href={routes.newImport(stream.id)}
                data-testid={`pick-${stream.id}`}
                className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <FileSpreadsheet aria-hidden className="size-[18px] shrink-0 text-icon" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{stream.name}</span>
                  <span className="block text-sm text-fg-muted">{stream.description}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </Page>
  );
}

/** One import batch: match columns, check, and the result with Undo. */
export async function ImportBatchPage({ params }: { readonly params: Promise<{ batchId: string }> }) {
  const batchId = decodeURIComponent((await params).batchId);
  const page = await pulsePage(routes.importBatch(batchId), 'import');
  if (page.blocked) return <PageBlocked title="Import" role={page.access.role} />;
  const crumbs = [{ label: 'Import and export', href: routes.importCenter() }, { label: 'Import' }];
  let batch: ImportBatchDTO | null = null;
  let problem: { denied: boolean; message: string } | null = null;
  try {
    batch = await getImportBatch(page.ctx, batchId);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    problem = { denied: error.code === 'FORBIDDEN', message: error.message };
  }
  if (batch) {
    return (
      <Page title={`Import ${batch.streamName.toLowerCase()}`} subtitle={batch.fileName ?? 'Pasted rows'} breadcrumbs={[crumbs[0]!, { label: batch.fileName ?? batch.streamName }]} width="full">
        <ImportBatch initial={batch} />
      </Page>
    );
  }
  return (
    <Page title="Import" breadcrumbs={crumbs}>
      <Panel>
        <Teach
          testId="import-not-found"
          icon={FileSearch}
          title={problem?.denied ? 'Your role cannot open this import' : 'We could not find that import'}
          why={problem?.denied ? problem.message : 'This import is not in your workspace. It may have been discarded, or the link may belong to another workspace.'}
          actions={<ButtonLink href={routes.importCenter()}>Back to imports</ButtonLink>}
        />
      </Panel>
    </Page>
  );
}
