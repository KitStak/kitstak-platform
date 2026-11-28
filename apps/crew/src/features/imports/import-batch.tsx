'use client';
import { useState } from 'react';
import { Download, Undo2, Upload } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, Checkbox, ConfirmDialog, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, ToggleGroup, type BadgeTone } from '@/components/ui';
import { checkImportAction, commitImportAction, undoImportAction } from '@/server/actions/imports';
import type { ImportBatchDetail } from '@/server/domain/imports';
import { formatWhen } from '@/lib/dates';
import { useRun } from '@/features/people/bits';
import { PinSlipsButton } from '@/features/people/pin-slips';
import { BATCH_STATUS, ROW_ACTION } from './words';

function Count({ label, value, tone }: { readonly label: string; readonly value: number; readonly tone: BadgeTone }) {
  return (
    <div className="flex flex-col rounded-lg border border-border-subtle bg-sunken px-3 py-2">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${tone === 'danger' && value > 0 ? 'text-danger-text' : 'text-fg'}`}>{value}</span>
    </div>
  );
}

export function ImportBatchView({ detail }: { readonly detail: ImportBatchDetail }) {
  const { run, pending } = useRun();
  const [only, setOnly] = useState<'problems' | 'all'>(detail.batch.counts.error + detail.batch.counts.skip > 0 ? 'problems' : 'all');
  const [undoing, setUndoing] = useState(false);
  const { batch } = detail;
  const keys = detail.columns.filter((column): column is string => column !== null);
  const rows = only === 'problems' ? detail.rows.filter((row) => row.action === 'error' || row.action === 'lookalike' || row.messages.length > 0) : detail.rows;
  const status = BATCH_STATUS[batch.status] ?? { label: batch.status, tone: 'neutral' as const };
  const blocked = detail.options.mode === 'all' && batch.counts.error > 0;
  const undoOpen = batch.status === 'committed' && batch.undoUntil !== null && new Date(batch.undoUntil) > new Date();

  return (
    <div className="flex flex-col gap-4" data-testid="import-batch">
      <Panel title={<span className="flex items-center gap-2">This file <Badge tone={status.tone}>{status.label}</Badge></span>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="import-counts">
          <Count label="New people" value={batch.counts.create} tone="success" />
          <Count label="Changed" value={batch.counts.update} tone="info" />
          <Count label="No change" value={batch.counts.unchanged} tone="neutral" />
          <Count label="Looks the same, left out" value={batch.counts.skip} tone="warning" />
          <Count label="Errors" value={batch.counts.error} tone="danger" />
        </div>
        {batch.status === 'checked' ? (
          <div className="mt-4 flex flex-col gap-3">
            <Checkbox
              label="Skip bad rows"
              description="Bring in the good rows and leave the rows with errors out. Off means nothing comes in while any row has an error."
              checked={detail.options.mode === 'skip'}
              onCheckedChange={(on) => void run('mode', () => checkImportAction({ batchId: batch.id, options: { mode: on === true ? 'skip' : 'all' } }))}
              disabled={pending !== null}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                leadingIcon={<Upload aria-hidden />}
                disabled={blocked || batch.counts.create + batch.counts.update === 0}
                loading={pending === 'commit'}
                onClick={() => void run('commit', () => commitImportAction({ batchId: batch.id }), { success: 'People brought in' })}
                data-testid="import-commit"
              >
                Bring in {batch.counts.create + batch.counts.update} {batch.counts.create + batch.counts.update === 1 ? 'person' : 'people'}
              </Button>
              {blocked ? <span className="text-sm text-danger-text">Fix the rows with errors, or turn on Skip bad rows.</span> : null}
            </div>
          </div>
        ) : null}
        {batch.status === 'committed' ? (
          <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="import-done">
            <p className="text-sm text-fg-secondary">Brought in {formatWhen(batch.committedAt)}.</p>
            {detail.createdPersonIds.length > 0 ? <PinSlipsButton personIds={detail.createdPersonIds} variant="primary" label={`Print PIN slips for ${detail.createdPersonIds.length} new ${detail.createdPersonIds.length === 1 ? 'person' : 'people'}`} testId="import-pin-slips" /> : null}
            {undoOpen ? (
              <Button variant="ghost" leadingIcon={<Undo2 aria-hidden />} onClick={() => setUndoing(true)}>
                Undo this import
              </Button>
            ) : null}
          </div>
        ) : null}
      </Panel>
      <Panel
        title="Rows"
        action={
          <div className="flex items-center gap-2">
            {batch.counts.error + batch.counts.skip > 0 ? (
              <a href={`/api/v1/import/${batch.id}/errors.csv`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-input bg-panel px-2.5 text-xs font-medium text-fg hover:bg-muted">
                <Download aria-hidden className="size-3.5" />
                Rows with errors
              </a>
            ) : null}
            <ToggleGroup
              label="Which rows"
              size="sm"
              value={only}
              onValueChange={setOnly}
              options={[
                { value: 'problems', label: 'Needs a look' },
                { value: 'all', label: 'All rows' },
              ]}
            />
          </div>
        }
        bodyClassName="p-0"
      >
        <Table data-testid="import-rows">
          <TableHead>
            <TableRow>
              <TableHeaderCell numeric>Row</TableHeaderCell>
              <TableHeaderCell>Result</TableHeaderCell>
              <TableHeaderCell>What Crew says</TableHeaderCell>
              {keys.slice(0, 6).map((key) => (
                <TableHeaderCell key={key}>{key}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-sm text-fg-muted">
                  Every row reads clean.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const action = row.action ? ROW_ACTION[row.action] : null;
                return (
                  <TableRow key={row.rowNumber} data-testid="import-row">
                    <TableCell numeric>{row.rowNumber}</TableCell>
                    <TableCell>{action ? <Badge tone={action.tone}>{action.label}</Badge> : null}</TableCell>
                    <TableCell className="max-w-md text-sm">
                      {row.messages.map((issue, index) => (
                        <p key={index} className={issue.level === 'error' ? 'text-danger-text' : 'text-warning-text'}>
                          {issue.column ? <span className="font-mono text-xs">{issue.column}: </span> : null}
                          {issue.message}
                        </p>
                      ))}
                      {row.action === 'update' && row.changes.length > 0 ? <p className="text-fg-secondary">Changes {row.changes.join(', ')}</p> : null}
                    </TableCell>
                    {keys.slice(0, 6).map((key) => (
                      <TableCell key={key} className="text-fg-secondary">
                        {row.cells[key] ?? ''}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Panel>
      <ConfirmDialog
        open={undoing}
        onOpenChange={setUndoing}
        destructive
        title="Undo this import?"
        description="People this file added are removed. People it changed go back to how they were."
        confirmLabel="Undo"
        loading={pending === 'undo'}
        onConfirm={async () => {
          if (await run('undo', () => undoImportAction({ batchId: batch.id }), { success: 'Import undone' })) setUndoing(false);
        }}
      />
    </div>
  );
}
