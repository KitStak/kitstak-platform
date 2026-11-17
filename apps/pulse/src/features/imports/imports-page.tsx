import Link from 'next/link';
import { ChevronRight, FileSearch, FileSpreadsheet, Upload } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { StepList, Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { canImportStream } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { STREAMS, STREAM_GROUP_LABELS, streamInfo, type StreamGroup, type StreamInfo } from '@/lib/streams';
import { pulsePage, type PulsePage } from '@/server/page';

const GROUPS: readonly StreamGroup[] = ['setup', 'daily', 'money'];

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

/** The streams this person may import (supervisors only get the floor streams). */
function allowedStreams(page: PulsePage): readonly StreamInfo[] {
  return STREAMS.filter((stream) => canImportStream(page.access.role, stream.id));
}

function Columns({ stream }: { readonly stream: StreamInfo }) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {stream.needed.map((column) => (
        <code key={column} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-2xs text-fg-secondary">
          {column}
        </code>
      ))}
    </span>
  );
}

/** Import center: one card per data stream, and the history of past imports. */
export async function ImportsPage() {
  const page = await pulsePage(routes.importCenter(), 'import');
  if (page.blocked) return <PageBlocked title="Import and export" role={page.access.role} />;
  const streams = allowedStreams(page);
  return (
    <Page
      title="Import and export"
      subtitle="Bring in spreadsheets and download your data as CSV files. Pulse works with nothing else installed."
      tabs={<DataTabs active="import" />}
      actions={
        streams.length > 0 ? (
          <ButtonLink href={routes.newImport()} icon={<Upload aria-hidden />} testId="import-new">
            New import
          </ButtonLink>
        ) : null
      }
    >
      {streams.length === 0 ? (
        <Panel>
          <Teach icon={FileSpreadsheet} title="Your role cannot import files" why="Importing changes the numbers everyone sees, so it needs a supervisor or a manager. You can still download data from the Export tab." actions={<ButtonLink href={routes.exportCenter()}>Go to Export</ButtonLink>} />
        </Panel>
      ) : (
        <div className="flex flex-col gap-6">
          {GROUPS.map((group) => {
            const rows = streams.filter((stream) => stream.group === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`streams-${group}`}>
                <h2 id={`streams-${group}`} className="mb-2 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
                  {STREAM_GROUP_LABELS[group]}
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((stream) => (
                    <li key={stream.id}>
                      <Link
                        href={routes.newImport(stream.id)}
                        data-testid={`stream-${stream.id}`}
                        className="group flex h-full items-start gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
                          <FileSpreadsheet className="size-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-fg">{stream.name}</span>
                          <span className="mt-0.5 block text-sm text-fg-muted">{stream.description}</span>
                          <span className="mt-2 block text-xs text-fg-muted">Never imported</span>
                        </span>
                        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <Panel title="Past imports">
            <Teach
              size="sm"
              icon={FileSearch}
              title="No imports yet"
              why="Every import is kept here with who ran it, how many rows were new or changed, and an Undo button for 7 days."
            />
          </Panel>
        </div>
      )}
    </Page>
  );
}

/** New import: pick what you are bringing in, then upload, match columns, check and finish. */
export async function NewImportPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).stream;
  const requested = streamInfo((Array.isArray(raw) ? raw[0] : raw) ?? '');
  const page = await pulsePage(routes.newImport(requested?.id), 'import');
  if (page.blocked) return <PageBlocked title="New import" role={page.access.role} />;
  const streams = allowedStreams(page);
  if (streams.length === 0 || (requested && !streams.some((stream) => stream.id === requested.id))) {
    return <PageBlocked title="New import" role={page.access.role} />;
  }
  const breadcrumbs = [{ label: 'Import and export', href: routes.importCenter() }, { label: 'New import' }];
  return (
    <Page title={requested ? `Import ${requested.name.toLowerCase()}` : 'New import'} subtitle={requested ? requested.description : 'Pick what you are bringing in. Each kind of data has its own simple file.'} breadcrumbs={breadcrumbs}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={requested ? 'What the file needs' : 'What are you bringing in?'}>
          {requested ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm text-fg-secondary">
                  One file named <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">{requested.file}</code>, or any spreadsheet saved as CSV. These columns must be filled in on every row:
                </p>
                <Columns stream={requested} />
              </div>
              <p className="text-sm text-fg-muted">
                Column names do not have to match exactly. Pulse matches them for you, ignoring capitals, spaces and underscores, and remembers your choices for next time.
              </p>
              <div>
                <ButtonLink href={routes.newImport()} variant="secondary">
                  Pick something else
                </ButtonLink>
              </div>
            </div>
          ) : (
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
                      <span className="block truncate text-sm text-fg-muted">{stream.description}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="How an import works">
          <StepList
            steps={[
              { title: 'Upload', detail: 'Drag a file in, or paste rows straight from a spreadsheet.' },
              { title: 'Match columns', detail: 'Pulse lines up your columns with its own and shows sample values.' },
              { title: 'Check', detail: 'See what is new, changed or wrong, in plain words on the exact cell. Nothing is saved yet.' },
              { title: 'Done', detail: 'The rows are saved together. You can undo the whole import for 7 days.' },
            ]}
          />
        </Panel>
      </div>
    </Page>
  );
}

/** One import batch: its check results, error report and undo. */
export async function ImportBatchPage({ params }: { readonly params: Promise<{ batchId: string }> }) {
  const batchId = decodeURIComponent((await params).batchId);
  const page = await pulsePage(routes.importBatch(batchId), 'import');
  if (page.blocked) return <PageBlocked title="Import" role={page.access.role} />;
  return (
    <Page title="Import" breadcrumbs={[{ label: 'Import and export', href: routes.importCenter() }, { label: 'Import' }]}>
      <Panel>
        <Teach
          testId="import-not-found"
          icon={FileSearch}
          title="We could not find that import"
          why="This import is not in your workspace. It may have been cleaned up after its 7 day undo window, or the link may belong to another workspace."
          actions={<ButtonLink href={routes.importCenter()}>Back to imports</ButtonLink>}
        />
      </Panel>
    </Page>
  );
}
