import 'server-only';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Upload } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { DownloadLink } from '@/components/ledger/download-link';
import { Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, type BadgeTone } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { SETUP_STREAMS, STREAMS, isSetupStream, type SetupStream } from '@/server/csv/streams';
import { STREAM_READ_RIGHT, STREAM_WRITE_RIGHT } from '@/server/domain/setup-csv';
import { getImportBatch, listImportBatches } from '@/server/domain/setup-import';
import { isDomainError } from '@/server/errors';
import { ledgerPage } from '@/server/page';
import { routes } from '@/lib/routes';
import { ImportCommit } from './import-commit';
import { ImportUpload } from './import-upload';

const ACTION_WORDS: Readonly<Record<string, { readonly label: string; readonly tone: BadgeTone }>> = {
  create: { label: 'New', tone: 'success' },
  update: { label: 'Changed', tone: 'info' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  error: { label: 'Problem', tone: 'danger' },
  skip: { label: 'Skipped', tone: 'warning' },
};

const STATUS_WORDS: Readonly<Record<string, string>> = { checked: 'Checked, not brought in', committed: 'Brought in', failed: 'Failed' };

const when = (date: Date): string => date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** `/import` (SPEC 6, 7): the import center for the setup streams, with recent imports. */
export async function ImportsPage() {
  const page = await ledgerPage('/import', 'import');
  if (page.blocked) return <PageBlocked title="Import and export" role={page.access.role} />;
  const batches = page.can('import:run') ? await listImportBatches(page.ctx) : [];
  const actions = (
    <div className="flex gap-2">
      {page.can('export:run') ? (
        <ButtonLink href={routes.exportCenter()} variant="secondary" icon={<Download aria-hidden className="size-4" />}>
          Export data
        </ButtonLink>
      ) : null}
      {page.can('import:run') ? (
        <ButtonLink href={routes.newImport()} icon={<Upload aria-hidden className="size-4" />}>
          Import a file
        </ButtonLink>
      ) : null}
    </div>
  );
  return (
    <Page title="Import and export" subtitle="Bring in customers, vendors, items, accounts and tax rates, including QuickBooks exports. Download them as CSV files." actions={actions}>
      {batches.length === 0 ? (
        <EmptyState title="No imports yet" description="The check step shows what is new, changed, unchanged or has a problem before anything is saved." illustration="inbox" />
      ) : (
        <Panel title="Recent imports" bodyClassName="p-0">
          <Table aria-label="Recent imports" data-testid="imports-table">
            <TableHead>
              <tr>
                <TableHeaderCell>File</TableHeaderCell>
                <TableHeaderCell>Holds</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell numeric>New</TableHeaderCell>
                <TableHeaderCell numeric>Changed</TableHeaderCell>
                <TableHeaderCell numeric>Problems</TableHeaderCell>
                <TableHeaderCell>When</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell>
                    <Link href={routes.importBatch(batch.id)} className="font-medium text-fg hover:underline">
                      {batch.fileName ?? 'File'}
                    </Link>
                  </TableCell>
                  <TableCell>{batch.streamTitle}</TableCell>
                  <TableCell>{STATUS_WORDS[batch.status]}</TableCell>
                  <TableCell numeric>{batch.counts.create}</TableCell>
                  <TableCell numeric>{batch.counts.update}</TableCell>
                  <TableCell numeric>{batch.counts.error}</TableCell>
                  <TableCell className="text-fg-secondary">
                    {when(batch.createdAt)}
                    {batch.createdByName ? `, ${batch.createdByName}` : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </Page>
  );
}

/** `/import/new`: pick the stream and the file (the streams this person may bring in). */
export async function NewImportPage({ stream }: { readonly stream: string | null }) {
  const page = await ledgerPage('/import/new', 'import');
  if (page.blocked || !page.can('import:run')) return <PageBlocked title="Import a file" role={page.access.role} />;
  const allowed = SETUP_STREAMS.filter((id) => page.can(STREAM_WRITE_RIGHT[id]));
  const choices = allowed.map((id) => ({ id, title: STREAMS[id].title, file: STREAMS[id].file, match: STREAMS[id].match, columns: STREAMS[id].columns.map((column) => ({ key: column.key, required: Boolean(column.required) })) }));
  return (
    <Page title="Import a file" subtitle="Pick what the file holds and the CSV file. Ledger checks every row before anything is saved." width="narrow">
      <Panel>
        <ImportUpload streams={choices} initialStream={stream && isSetupStream(stream) && allowed.includes(stream) ? stream : null} />
      </Panel>
    </Page>
  );
}

/** `/import/[batchId]`: the check step's answer, row by row, and the commit. */
export async function ImportBatchPage({ batchId }: { readonly batchId: string }) {
  const page = await ledgerPage(`/import/${batchId}`, 'import');
  if (page.blocked || !page.can('import:run')) return <PageBlocked title="Import" role={page.access.role} />;
  const found = await getImportBatch(page.ctx, batchId).catch((error: unknown) => {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  });
  if (!found) notFound();
  const { batch, rows } = found;
  const columnLabel = (key: string): string => STREAMS[batch.stream].columns.find((column) => column.key === key)?.key ?? key;
  const writes = batch.counts.create + batch.counts.update;
  const left = batch.headers.filter((use) => !use.column);
  return (
    <Page
      title={batch.fileName ?? 'Import'}
      subtitle={`${batch.streamTitle} · ${STATUS_WORDS[batch.status]}`}
      actions={
        <div className="flex gap-2">
          <ButtonLink href={routes.importCenter()} variant="secondary">
            All imports
          </ButtonLink>
          {batch.counts.error > 0 ? (
            <DownloadLink href={routes.importErrors(batch.id)} icon={<Download aria-hidden className="size-4" />} testId="import-errors">
              Rows with problems
            </DownloadLink>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-testid="import-batch" data-status={batch.status}>
        <Panel title={batch.status === 'committed' ? 'What happened' : 'What the check found'}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="import-counts">
            {(
              [
                ['New', batch.counts.create],
                ['Changed', batch.counts.update],
                ['Unchanged', batch.counts.unchanged],
                [batch.status === 'committed' ? 'Skipped' : 'Problems', batch.counts.error],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border-subtle p-3">
                <dt className="text-xs text-fg-muted">{label}</dt>
                <dd className="text-2xl font-semibold text-fg tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {left.length > 0 ? <p className="mt-3 text-sm text-fg-secondary">Left out, no column matched: {left.map((use) => use.header).join(', ')}.</p> : null}
          {batch.status === 'checked' ? (
            <div className="mt-4">
              <ImportCommit batchId={batch.id} errors={batch.counts.error} writes={writes} />
            </div>
          ) : null}
        </Panel>
        <Panel title="Rows" bodyClassName="p-0">
          <Table aria-label="Rows of the file" data-testid="import-rows">
            <TableHead>
              <tr>
                <TableHeaderCell numeric>Row</TableHeaderCell>
                <TableHeaderCell>Record</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
                <TableHeaderCell>Details</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const words = ACTION_WORDS[row.action] ?? ACTION_WORDS.error!;
                return (
                  <TableRow key={row.rowNumber} data-testid="import-row" data-action={row.action}>
                    <TableCell numeric>{row.rowNumber}</TableCell>
                    <TableCell className="font-mono text-fg-secondary">{row.key}</TableCell>
                    <TableCell>
                      <Badge tone={words.tone}>{words.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.issues.length > 0
                        ? row.issues.map((issue) => `${issue.column ? `${columnLabel(issue.column)}: ` : ''}${issue.message}`).join(' ')
                        : row.action === 'update'
                          ? `Changes ${row.changes.map(columnLabel).join(', ')}`
                          : ''}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </Page>
  );
}

/** `/export`: download each setup stream in the columns the import reads (SPEC 7.1). */
export async function ExportPage() {
  const page = await ledgerPage('/export', 'import');
  if (page.blocked || !page.can('export:run')) return <PageBlocked title="Export data" role={page.access.role} />;
  const streams: SetupStream[] = SETUP_STREAMS.filter((id) => page.can(STREAM_READ_RIGHT[id]));
  return (
    <Page title="Export data" subtitle="Download your Ledger setup as CSV files. Each file reads back in through Import with every row unchanged." width="narrow">
      <Panel bodyClassName="p-0">
        <ul className="divide-y divide-border-subtle" data-testid="export-list">
          {streams.map((id) => (
            <li key={id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-medium text-fg">{STREAMS[id].title}</span>
                <span className="block font-mono text-xs text-fg-muted">{STREAMS[id].file}</span>
              </span>
              <DownloadLink href={routes.exportFile(STREAMS[id].file)} icon={<Download aria-hidden className="size-4" />} testId={`export-${id}`}>
                Download
              </DownloadLink>
            </li>
          ))}
        </ul>
      </Panel>
      <p className="mt-3 text-sm text-fg-secondary">Invoices, bills, payments and the journal join this list as they arrive. Exports leave out what your role cannot see.</p>
    </Page>
  );
}
