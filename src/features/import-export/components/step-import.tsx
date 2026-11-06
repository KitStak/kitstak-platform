'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  Download,
  Pause,
  RotateCw,
  Undo2,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  ProgressBar,
  Spinner,
  buttonVariants,
  cn,
} from '@/components/ui';
import { ColumnTypeIcon, LabelChip } from '@/features/cells';
import { useOrg } from '@/features/shell/org-context';
import type { ColumnType } from '@/server/db/schema/cell-values';
import { buildErrorReport, baseFileName, downloadBlob } from '../lib/error-report';
import { IMPORT_LIMITS } from '../lib/types';
import { canResume, cancelRun, resumeRun, undoRun } from '../runner';
import type { AddedSchema, ImportRun } from '../store';
import { pluralize } from '../use-import-model';

function Count({
  label,
  value,
  tone,
  testId,
  muted,
}: {
  label: string;
  value: number;
  tone: string;
  testId: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn('rounded-lg border border-border-subtle bg-panel px-4 py-3', muted && 'bg-sunken')}
      data-testid={testId}
    >
      <p
        className={cn(
          'font-heading text-2xl font-semibold tabular-nums',
          muted ? 'text-fg-muted line-through decoration-1' : tone,
        )}
      >
        {value.toLocaleString('en-US')}
      </p>
      <p className="text-sm text-fg-secondary">{label}</p>
    </div>
  );
}

/** Seconds until the next retry, ticking while the run is reconnecting. */
function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

function WhatWasAdded({ added, undone }: { readonly added: AddedSchema; readonly undone: boolean }) {
  if (added.columns.length === 0 && added.labels.length === 0) return null;
  return (
    <section
      aria-labelledby="import-added-title"
      className="rounded-lg border border-border-subtle bg-panel p-4"
      data-testid="import-added"
    >
      <h3 id="import-added-title" className="text-base font-semibold text-fg">
        {undone ? 'Added by this import' : 'What was added'}
      </h3>
      {added.columns.length ? (
        <div className="mt-3">
          <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            {added.columns.length} new {added.columns.length === 1 ? 'column' : 'columns'}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {added.columns.map((column) => (
              <li
                key={column.title}
                className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border-subtle bg-sunken px-2 text-sm text-fg"
              >
                <ColumnTypeIcon type={column.type as ColumnType} size="sm" />
                <span className="max-w-[180px] truncate">{column.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {added.labels.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            {added.labels.length} new {added.labels.length === 1 ? 'label' : 'labels'}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {added.labels.map(({ column, label }) => (
              <li key={`${column}:${label.id}`} title={column}>
                <LabelChip label={label} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export interface StepImportProps {
  readonly run: ImportRun;
  readonly onAnother: () => void;
  readonly onBackground?: () => void;
}

function title(run: ImportRun, term: string): string {
  switch (run.status) {
    case 'preparing':
      return 'Setting up your board…';
    case 'running':
      return 'Importing your data…';
    case 'done':
      return `${run.created.toLocaleString('en-US')} ${pluralize(term, run.created)} imported${run.updated ? `, ${run.updated.toLocaleString('en-US')} updated` : ''}`;
    case 'undoing':
      return 'Undoing the import…';
    case 'undone':
      return 'Import undone';
    case 'cancelled':
      return 'Import stopped';
    default:
      return 'The import paused';
  }
}

function subtitle(run: ImportRun): string {
  if (run.status === 'preparing' || run.status === 'running') {
    return `${run.fileName} → ${run.boardName || 'new board'}. You can keep working; we'll let you know when it's done.`;
  }
  if (run.status === 'failed') return run.error ?? 'Something went wrong.';
  if (run.status === 'cancelled') {
    return `Stopped after ${run.processed.toLocaleString('en-US')} of ${run.total.toLocaleString('en-US')} rows. Rows imported so far are kept.`;
  }
  if (run.status === 'undone') {
    if (run.undo?.boardDeleted) return `The board “${run.boardName}” was moved to the trash.`;
    return 'Imported items were archived and updated items restored. Archived items can be restored from the board’s archive.';
  }
  return `Into ${run.boardName}${run.linkedCreated ? ` · ${run.linkedCreated} connected items created` : ''}`;
}

export function StepImport({ run, onAnother, onBackground }: StepImportProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { org } = useOrg();
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [deleteBoard, setDeleteBoard] = useState(true);
  const [mountedAt] = useState(() => Date.now());
  const active = run.status === 'preparing' || run.status === 'running';
  const percent = run.total ? Math.round((run.processed / run.total) * 100) : 0;
  const term = run.terminology || 'Item';
  const skipped = run.skipped + run.clientSkipped;
  const settled = run.status === 'done' || run.status === 'cancelled' || run.status === 'failed';
  const somethingToUndo =
    run.created > 0 || run.updated > 0 || run.schemaAdded > 0 || (run.boardCreated && run.boardId !== null);
  const undoAvailable =
    settled && somethingToUndo && mountedAt - (run.finishedAt ?? run.startedAt) < IMPORT_LIMITS.undoWindowMs;
  const resumable =
    (run.status === 'failed' || run.status === 'cancelled') && run.resumable && canResume(run.batchId);
  const href = run.boardId && !run.undo?.boardDeleted ? `/${run.orgSlug}/boards/${run.boardId}` : null;
  const failures = run.errorDetail
    ? [{ row: 0, message: `Import stopped: ${run.errorDetail}` }, ...run.failures]
    : run.failures;
  const undone = run.status === 'undone' || run.status === 'undoing';
  // After an undo only real failures are worth a report (the file's fixable problems no longer matter).
  const hasReport = undone ? failures.length > 0 : failures.length > 0 || run.clientIssues.length > 0;
  const reconnect = active ? (run.reconnect ?? null) : null;
  const retryIn = useCountdown(reconnect?.retryAt ?? null);
  const nothingImported = run.created === 0 && run.updated === 0;

  // "Run in background" should feel instant: warm the destination route while the import runs.
  useEffect(() => {
    if (active && onBackground) router.prefetch(`/${org.slug}`);
  }, [active, onBackground, router, org.slug]);

  return (
    <div className="flex flex-col gap-6" data-testid="import-run" data-status={run.status}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-full',
            active && 'bg-primary-subtle text-primary-text',
            run.status === 'done' && 'bg-success-subtle text-success-text',
            (run.status === 'undone' || run.status === 'undoing') && 'bg-muted text-fg-secondary',
            (run.status === 'failed' || run.status === 'cancelled') && 'bg-warning-subtle text-warning-text',
          )}
        >
          {active || run.status === 'undoing' ? (
            <Spinner size="md" label={null} />
          ) : run.status === 'done' ? (
            <CheckCircle2 className="size-5" />
          ) : run.status === 'undone' ? (
            <Undo2 className="size-5" />
          ) : (
            <AlertOctagon className="size-5" />
          )}
        </span>
        <div className="min-w-0" aria-live="polite">
          <h2
            className="font-heading text-xl font-semibold text-balance text-fg outline-none"
            data-testid="import-run-title"
          >
            {title(run, term)}
          </h2>
          <p className="mt-1 text-base text-fg-secondary" data-testid="import-run-subtitle">
            {subtitle(run)}
          </p>
        </div>
      </div>

      {reconnect ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-sm text-warning-text"
          data-testid="import-reconnecting"
        >
          <WifiOff aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Connection lost. {retryIn > 0 ? `Retrying in ${retryIn}s… ` : 'Retrying now… '}
            <span className="tabular-nums">
              (attempt {reconnect.attempt} of {reconnect.of})
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Pause aria-hidden />}
            onClick={() => cancelRun(run.batchId)}
            data-testid="import-pause"
          >
            Pause now
          </Button>
        </div>
      ) : null}

      {active ? (
        <div className="flex flex-col gap-2">
          <ProgressBar
            value={run.status === 'preparing' ? undefined : percent}
            label="Import progress"
            showValue
            tone="primary"
          />
          <p className="text-sm text-fg-secondary tabular-nums" data-testid="import-progress-text">
            {run.status === 'preparing'
              ? `Creating columns and labels for ${run.total.toLocaleString('en-US')} rows…`
              : `${run.processed.toLocaleString('en-US')} of ${run.total.toLocaleString('en-US')} rows`}
          </p>
        </div>
      ) : null}

      {run.status === 'undone' && run.undo ? (
        <div className="grid grid-cols-3 gap-3">
          <Count testId="import-count-archived" label="Archived" value={run.undo.archived} tone="text-fg" />
          <Count
            testId="import-count-restored"
            label="Restored"
            value={run.undo.reverted}
            tone="text-primary-text"
          />
          {run.boardCreated ? (
            <Count testId="import-count-created" label="Removed" value={run.created} tone="text-fg" muted />
          ) : (
            <Count
              testId="import-count-columns-removed"
              label="New columns removed"
              value={run.undo.removedColumns}
              tone="text-fg"
            />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Count testId="import-count-created" label="Created" value={run.created} tone="text-success-text" />
          <Count testId="import-count-updated" label="Updated" value={run.updated} tone="text-primary-text" />
          <Count testId="import-count-skipped" label="Skipped" value={skipped} tone="text-fg" />
          <Count
            testId="import-count-failed"
            label="Failed"
            value={run.failures.length}
            tone={run.failures.length ? 'text-danger-text' : 'text-fg'}
          />
        </div>
      )}

      {!active && run.failures.length ? (
        <p
          className="rounded-md border border-warning bg-warning-subtle px-3 py-2 text-sm text-warning-text"
          role="status"
        >
          Some rows couldn&apos;t be saved. Download the error report to fix and re-import them.
        </p>
      ) : null}

      {active ? (
        <div className="flex flex-wrap items-center gap-2">
          {onBackground ? (
            <Button variant="secondary" onClick={onBackground} data-testid="import-background">
              Run in background
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => cancelRun(run.batchId)} disabled={run.cancelRequested}>
            {run.cancelRequested ? 'Stopping…' : 'Stop import'}
          </Button>
        </div>
      ) : (
        // Phones: primary actions stack full width; the report and "Import another" share a row.
        <div
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          data-testid="import-actions"
        >
          {resumable ? (
            <Button
              leadingIcon={<RotateCw aria-hidden />}
              onClick={() => resumeRun(run.batchId)}
              data-testid="import-resume"
              className="w-full sm:w-auto"
            >
              Resume import
            </Button>
          ) : null}
          {href && run.status !== 'undoing' ? (
            <Link
              href={href}
              data-testid="import-go-to-board"
              className={cn(
                buttonVariants({ variant: resumable || undone ? 'secondary' : 'primary' }),
                'w-full sm:w-auto',
              )}
            >
              Go to board <ArrowRight aria-hidden />
            </Link>
          ) : null}
          {undoAvailable ? (
            <Button
              variant="secondary"
              leadingIcon={<Undo2 aria-hidden />}
              onClick={() => setConfirmUndo(true)}
              data-testid="import-undo"
              className="w-full sm:w-auto"
            >
              {nothingImported ? 'Remove what was added' : 'Undo import'}
            </Button>
          ) : null}
          <div className={cn('grid gap-2 sm:contents', hasReport ? 'grid-cols-2' : 'grid-cols-1')}>
            {hasReport ? (
              <Button
                variant="secondary"
                leadingIcon={<Download aria-hidden />}
                onClick={() =>
                  downloadBlob(
                    buildErrorReport(run.clientIssues, failures),
                    `${baseFileName(run.fileName)} – import report.csv`,
                    'text/csv;charset=utf-8',
                  )
                }
              >
                Error report
              </Button>
            ) : null}
            <Button variant="tertiary" onClick={onAnother} data-testid="import-another">
              Import another file
            </Button>
          </div>
        </div>
      )}

      {!active && run.added && run.status !== 'undoing' ? (
        <WhatWasAdded added={run.added} undone={run.status === 'undone'} />
      ) : null}

      <Dialog open={confirmUndo} onOpenChange={setConfirmUndo}>
        <DialogContent size="sm" hideClose role="alertdialog" data-testid="import-undo-dialog">
          <DialogHeader
            title={nothingImported ? 'Remove what this import added?' : 'Undo this import?'}
            description={
              [
                run.created
                  ? `${run.created.toLocaleString('en-US')} imported ${pluralize(term, run.created)} will be archived.`
                  : null,
                run.updated
                  ? `${run.updated.toLocaleString('en-US')} updated ${pluralize(term, run.updated)} go back to their previous values.`
                  : null,
                !run.boardCreated && run.schemaAdded
                  ? 'New columns and labels nothing else uses are removed.'
                  : null,
              ]
                .filter(Boolean)
                .join(' ') || 'The board this import created can be moved to the trash.'
            }
          />
          {run.boardCreated && run.boardId ? (
            <div className="px-6 pb-2">
              <Checkbox
                checked={deleteBoard}
                onCheckedChange={(checked) => setDeleteBoard(checked === true)}
                label={`Also delete the board “${run.boardName}”`}
                description="It's empty after the undo. You can restore it from the trash."
                data-testid="import-undo-delete-board"
              />
            </div>
          ) : null}
          <DialogFooter className="border-t-0 pt-2">
            <DialogClose asChild>
              <Button variant="ghost" autoFocus>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="danger"
              data-testid="import-undo-confirm"
              onClick={() => {
                setConfirmUndo(false);
                void undoRun(run.batchId, queryClient, { deleteBoard: run.boardCreated && deleteBoard });
              }}
            >
              {nothingImported ? 'Remove' : 'Undo import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
