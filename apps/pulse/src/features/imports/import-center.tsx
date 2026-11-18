'use client';
/**
 * The import center: one card per kind of data with its template, and the history of past
 * imports with Undo, the error report and a way to finish or discard a file that was left open.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleHelp, Download, FileSearch, FileSpreadsheet, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, toast } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { STREAMS, STREAM_GROUP_LABELS, type StreamGroup, type StreamId } from '@/lib/streams';
import { errorText, fileLinks, importApi, importKeys, type ImportCenterData } from './api';
import { IMPORT_STATUS_LABELS, type ImportBatchDTO, type ImportStatus } from './types';
import { When } from './when';

const GROUPS: readonly StreamGroup[] = ['setup', 'daily', 'money'];

const STATUS_TONE: Readonly<Record<ImportStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'>> = {
  uploading: 'warning',
  mapped: 'warning',
  checked: 'info',
  committed: 'success',
  failed: 'danger',
  undone: 'neutral',
};

export function ImportStatusBadge({ status }: { readonly status: ImportStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{IMPORT_STATUS_LABELS[status]}</Badge>;
}

function rowsWord(count: number): string {
  return `${formatNumber(count, { maxDigits: 0 })} ${count === 1 ? 'row' : 'rows'}`;
}

export function ImportCenter({ initial, allowed }: { readonly initial: ImportCenterData; readonly allowed: readonly StreamId[] }) {
  const queryClient = useQueryClient();
  const center = useQuery({ queryKey: importKeys.center(), queryFn: importApi.center, initialData: initial, staleTime: 15_000 });
  const [undoing, setUndoing] = useState<ImportBatchDTO | null>(null);
  const [discarding, setDiscarding] = useState<ImportBatchDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const data = center.data;
  const summary = new Map(data.streams.map((row) => [row.stream, row]));
  const streams = STREAMS.filter((stream) => allowed.includes(stream.id));

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: importKeys.root });
    for (const key of [qk.streams(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot(), qk.badges()]) await queryClient.invalidateQueries({ queryKey: key });
  };

  const runUndo = async (): Promise<void> => {
    if (!undoing) return;
    setBusy(true);
    try {
      const batch = await importApi.undo(undoing.id);
      toast.success('Import undone', batch.undoLeft > 0 ? `${rowsWord(batch.undoLeft)} were changed after the import, so they were left as they are.` : 'The rows it added are gone and the rows it changed are back to what they were.');
      setUndoing(null);
      await refresh();
    } catch (error) {
      toast.error('Could not undo the import', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const runDiscard = async (): Promise<void> => {
    if (!discarding) return;
    setBusy(true);
    try {
      await importApi.discard(discarding.id);
      toast.success('Import discarded', 'Nothing from that file was saved.');
      setDiscarding(null);
      await refresh();
    } catch (error) {
      toast.error('Could not discard the import', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-sunken px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-fg-secondary">
          Each kind of data has its own simple file. Download a template, fill it in with any spreadsheet, and bring it back here. Nothing is saved until you have seen a check of every row.
        </p>
        <a href={fileLinks.allTemplates()} download data-testid="templates-all" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <Download aria-hidden className="size-4" />
          All templates (zip)
        </a>
      </div>

      {GROUPS.map((group) => {
        const list = streams.filter((stream) => stream.group === group);
        if (list.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`streams-${group}`}>
            <h2 id={`streams-${group}`} className="mb-2 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
              {STREAM_GROUP_LABELS[group]}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((stream) => {
                const info = summary.get(stream.id);
                return (
                  <li key={stream.id} data-testid={`stream-${stream.id}`} className="flex h-full flex-col rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
                    <div className="flex items-start gap-3">
                      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
                        <FileSpreadsheet className="size-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-fg">{stream.name}</h3>
                        <p className="mt-0.5 text-sm text-fg-muted">{stream.description}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-fg-muted" data-testid={`stream-${stream.id}-state`}>
                      {info ? `${rowsWord(info.rows)} in Pulse. ` : ''}
                      {info?.lastImportAt ? (
                        <>
                          Last import <When iso={info.lastImportAt} dayOnly />
                          {info.lastImportRows !== null ? `, ${rowsWord(info.lastImportRows)} saved.` : '.'}
                        </>
                      ) : (
                        'Never imported.'
                      )}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                      <ButtonLink href={routes.newImport(stream.id)} size="sm" variant="secondary" icon={<Upload aria-hidden className="size-3.5" />} testId={`import-${stream.id}`}>
                        Import
                      </ButtonLink>
                      <a href={fileLinks.template(stream.file)} download aria-label={`Download the ${stream.name} template`} data-testid={`template-${stream.id}`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                        <Download aria-hidden className="size-3.5" />
                        Template
                      </a>
                      <a href={fileLinks.howTo(stream.file)} download aria-label={`Download how to fill in the ${stream.name} file`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                        <CircleHelp aria-hidden className="size-3.5" />
                        How to fill it in
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Panel title="Past imports" bodyClassName="p-0">
        {center.isError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm text-fg-secondary">We could not load your imports. {errorText(center.error)}</p>
            <Button variant="secondary" onClick={() => void center.refetch()}>
              Try again
            </Button>
          </div>
        ) : center.isLoading ? (
          <div className="p-4">
            <Skeleton height={120} />
          </div>
        ) : data.batches.length === 0 ? (
          <Teach
            size="sm"
            icon={FileSearch}
            title="No imports yet"
            why="Every import is kept here with who ran it, how many rows were new or changed, and an Undo button for 7 days."
            actions={
              streams[0] ? (
                <ButtonLink href={routes.newImport()} icon={<Upload aria-hidden />}>
                  Import your first file
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table data-testid="import-history">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>File</TableHeaderCell>
                    <TableHeaderCell>When</TableHeaderCell>
                    <TableHeaderCell>Who</TableHeaderCell>
                    <TableHeaderCell numeric>New</TableHeaderCell>
                    <TableHeaderCell numeric>Changed</TableHeaderCell>
                    <TableHeaderCell numeric>Problems</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.batches.map((batch) => (
                    <TableRow key={batch.id} data-testid={`batch-${batch.id}`}>
                      <TableCell>
                        <Link href={routes.importBatch(batch.id)} className="font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                          {batch.fileName ?? 'Pasted rows'}
                        </Link>
                        <span className="block text-xs text-fg-muted">
                          {batch.streamName}, {rowsWord(batch.totalRows)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <When iso={batch.committedAt ?? batch.createdAt} className="text-sm text-fg-secondary" />
                      </TableCell>
                      <TableCell className="text-sm text-fg-secondary">{batch.createdByName ?? 'Someone who has left'}</TableCell>
                      <TableCell numeric>{formatNumber(batch.counts.create, { maxDigits: 0 })}</TableCell>
                      <TableCell numeric>{formatNumber(batch.counts.update, { maxDigits: 0 })}</TableCell>
                      <TableCell numeric>{formatNumber(batch.counts.error, { maxDigits: 0 })}</TableCell>
                      <TableCell>
                        <ImportStatusBadge status={batch.status} />
                      </TableCell>
                      <TableCell>
                        <BatchActions batch={batch} onUndo={setUndoing} onDiscard={setDiscarding} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border-subtle md:hidden" data-testid="import-history-cards">
              {data.batches.map((batch) => (
                <li key={batch.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={routes.importBatch(batch.id)} className="block truncate text-sm font-medium text-fg hover:underline">
                        {batch.fileName ?? 'Pasted rows'}
                      </Link>
                      <span className="block text-xs text-fg-muted">
                        {batch.streamName}, {rowsWord(batch.totalRows)}, <When iso={batch.committedAt ?? batch.createdAt} />
                      </span>
                    </div>
                    <ImportStatusBadge status={batch.status} />
                  </div>
                  <p className="text-xs text-fg-secondary tabular-nums">
                    {batch.counts.create} new, {batch.counts.update} changed, {batch.counts.error} with problems
                  </p>
                  <BatchActions batch={batch} onUndo={setUndoing} onDiscard={setDiscarding} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={undoing !== null}
        onOpenChange={(open) => !open && setUndoing(null)}
        title="Undo this import?"
        description={
          undoing
            ? `The ${formatNumber(undoing.counts.create, { maxDigits: 0 })} rows it added will be removed and the ${formatNumber(undoing.counts.update, { maxDigits: 0 })} rows it changed will go back to what they were. Rows that someone changed after the import are left alone.`
            : ''
        }
        confirmLabel="Undo the import"
        destructive
        loading={busy}
        onConfirm={() => void runUndo()}
      />
      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => !open && setDiscarding(null)}
        title="Discard this import?"
        description="Nothing from this file was saved yet. Discarding it removes the uploaded rows."
        confirmLabel="Discard"
        destructive
        loading={busy}
        onConfirm={() => void runDiscard()}
      />
    </div>
  );
}

function BatchActions({ batch, onUndo, onDiscard }: { readonly batch: ImportBatchDTO; readonly onUndo: (batch: ImportBatchDTO) => void; readonly onDiscard: (batch: ImportBatchDTO) => void }) {
  const open = batch.status === 'uploading' || batch.status === 'mapped' || batch.status === 'checked';
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {open ? (
        <>
          {batch.status !== 'uploading' ? (
            <ButtonLink href={routes.importBatch(batch.id)} size="sm" variant="secondary" testId={`continue-${batch.id}`}>
              Continue
            </ButtonLink>
          ) : null}
          <Button size="sm" variant="ghost" leadingIcon={<Trash2 aria-hidden className="size-3.5" />} onClick={() => onDiscard(batch)} data-testid={`discard-${batch.id}`}>
            Discard
          </Button>
        </>
      ) : (
        <>
          {batch.counts.error + batch.counts.lookalike > 0 ? (
            <a href={fileLinks.errorReport(batch.id)} download className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <Download aria-hidden className="size-3.5" />
              Rows left out
            </a>
          ) : null}
          {batch.canUndo ? (
            <Button size="sm" variant="secondary" leadingIcon={<RotateCcw aria-hidden className="size-3.5" />} onClick={() => onUndo(batch)} data-testid={`undo-${batch.id}`}>
              Undo
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
