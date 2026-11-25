'use client';
/**
 * Import output or a plan from a CSV (docs/programs/SPEC.md 5.20, B.2): `?import=output|plan`.
 * Drop or paste a file (columns date, SKU or variant, qty, and scrap for output), see a preview
 * (rows that match, builds that will be made per day and variant, closed days that will be
 * refused) and a "Could not read" list, then import in one batch. Plan imports have Undo.
 */
import { useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, FileSpreadsheet, Lock, Upload } from 'lucide-react';
import { formatQty, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Textarea, cn, toast } from '@/components/ui';
import { programInvalidations, useProgram } from '@/lib/hooks/use-programs';
import type { ImportPreviewDTO } from '@/lib/program-types';
import { commitOutputImportAction, commitPlanImportAction, previewOutputImportAction, previewPlanImportAction } from '@/server/actions/imports';
import { undoCreateBuildsAction } from '@/server/actions/builds';
import { useQueryClient } from '@tanstack/react-query';
import { dayLabel } from '../kit/format';

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string } };

const ACTION_TEXT: Readonly<Record<ImportPreviewDTO['rows'][number]['action'], string>> = {
  log: 'Logs output',
  create: 'Makes a build',
  create_and_log: 'Makes a build and logs',
  refused: 'Refused',
};

const MAX_FILE = 2_000_000;

export function ImportDialog({ programKey, kind, onClose }: { readonly programKey: string; readonly kind: 'output' | 'plan'; readonly onClose: () => void }) {
  const queryClient = useQueryClient();
  const program = useProgram(programKey, { staleTime: 30_000 });
  const unit = program.data?.unit ?? { singular: 'unit', plural: 'units' };
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const title = kind === 'output' ? 'Import output' : 'Import a plan';
  const columns = kind === 'output' ? 'date, SKU or variant, qty, scrap' : 'date, SKU or variant, qty';

  const read = async (file: File) => {
    if (file.size > MAX_FILE) {
      toast.error('That file is too big', 'Import up to 2 MB at a time.');
      return;
    }
    setFileName(file.name);
    setText(await file.text());
    setPreview(null);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void read(file);
  };

  const check = async () => {
    setBusy(true);
    const result = (kind === 'output' ? await previewOutputImportAction({ key: programKey, text }) : await previewPlanImportAction({ key: programKey, text })) as Result<ImportPreviewDTO>;
    setBusy(false);
    if (!result.ok) {
      toast.error("Couldn't read the file", result.error.message);
      return;
    }
    setPreview(result.data);
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    const result = (kind === 'output' ? await commitOutputImportAction({ key: programKey, token: preview.token }) : await commitPlanImportAction({ key: programKey, token: preview.token })) as Result<{ created: number; logged: number; refused: number; createdIds?: string[] }>;
    setBusy(false);
    for (const key of programInvalidations(programKey)) void queryClient.invalidateQueries({ queryKey: key });
    if (!result.ok) {
      toast.error("Couldn't import", result.error.message);
      return;
    }
    const { created, logged, refused, createdIds } = result.data;
    const parts = [logged ? `logged ${logged} ${logged === 1 ? 'row' : 'rows'}` : null, created ? `made ${created} ${created === 1 ? 'build' : 'builds'}` : null, refused ? `refused ${refused} on closed days` : null].filter(Boolean).join(', ');
    const message = `Imported: ${parts || 'nothing changed'}`;
    if (createdIds?.length) {
      toast.undo(message, {
        onUndo: async () => {
          const back = (await undoCreateBuildsAction({ ids: createdIds })) as Result<{ removed: number; kept: number }>;
          for (const key of programInvalidations(programKey)) void queryClient.invalidateQueries({ queryKey: key });
          if (!back.ok) toast.error("Couldn't undo the import", back.error.message);
          else toast.success(back.data.kept ? `Removed ${back.data.removed} builds. Kept ${back.data.kept} with work on them.` : `Removed ${back.data.removed} builds`);
        },
      });
    } else toast.success(message);
    onClose();
  };

  const okRows = preview?.rows.filter((row) => row.action !== 'refused') ?? [];
  const problems = preview ? [...preview.problems.map((problem) => ({ where: `Row ${problem.line}`, message: problem.message })), ...preview.unmatched.map((entry) => ({ where: entry.lines.length > 1 ? `Rows ${entry.lines.slice(0, 4).join(', ')}${entry.lines.length > 4 ? ' and more' : ''}` : `Row ${entry.lines[0]}`, message: entry.message }))] : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-48px)]" data-testid="import-dialog">
        <DialogHeader title={title} description={kind === 'output' ? 'Bring in past output from a spreadsheet. Builds are made for days and variants that have none.' : 'Make planned builds from a spreadsheet.'} icon={<FileSpreadsheet aria-hidden className="size-5 text-icon" />} />
        <DialogBody className="flex flex-col gap-4 pb-4">
          {!preview ? (
            <>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
                className={cn('flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors', over ? 'border-primary bg-primary-subtle' : 'border-border-default bg-sunken/50')}
                data-testid="import-drop"
              >
                <Upload aria-hidden className="size-6 text-icon" />
                <p className="text-sm font-medium text-fg">{fileName ? fileName : 'Drop a CSV file here'}</p>
                <p className="text-xs text-fg-muted">Columns: {columns}. A header row helps but is not required.</p>
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                  Choose a file
                </Button>
                <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(event) => event.target.files?.[0] && void read(event.target.files[0])} />
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-secondary">Or paste the rows</span>
                <Textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} placeholder={kind === 'output' ? '2026-11-24, GLOVE-S-BR, 100, 2' : '2026-12-01, GLOVE-S-BR, 100'} className="font-mono text-xs" data-testid="import-text" />
              </label>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone="success" size="md">
                  {okRows.length} {okRows.length === 1 ? 'row' : 'rows'} ready
                </Badge>
                <Badge tone="neutral" size="md">
                  {unitLabel(preview.totals.units, unit)}
                </Badge>
                <Badge tone="info" size="md">
                  {preview.totals.builds} {preview.totals.builds === 1 ? 'build' : 'builds'} made
                </Badge>
                {problems.length ? (
                  <Badge tone="warning" size="md">
                    {problems.length} could not be read
                  </Badge>
                ) : null}
              </div>
              {preview.refusedDays.length ? (
                <div className="rounded-lg border border-border-subtle bg-sunken px-3 py-2 text-sm text-fg-secondary">
                  <p className="flex items-center gap-1.5 font-medium text-fg">
                    <Lock aria-hidden className="size-3.5" /> Closed days are refused
                  </p>
                  <ul className="mt-1 text-xs">
                    {preview.refusedDays.map((day) => (
                      <li key={day.date}>
                        {dayLabel(day.date)}: {day.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="max-h-72 overflow-auto rounded-lg border border-border-subtle">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-raised text-left text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Day</th>
                      <th className="px-3 py-2">Variant</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      {kind === 'output' ? <th className="px-3 py-2 text-right">Scrap</th> : null}
                      <th className="px-3 py-2">What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 200).map((row) => (
                      <tr key={`${row.line}-${row.variantId}-${row.date}`} className="border-t border-border-subtle">
                        <td className="px-3 py-1.5 text-fg-muted tabular-nums">{row.line}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{dayLabel(row.date)}</td>
                        <td className="px-3 py-1.5">{row.variantName}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(row.qty)}</td>
                        {kind === 'output' ? <td className="px-3 py-1.5 text-right tabular-nums">{row.scrapQty ? formatQty(row.scrapQty) : ''}</td> : null}
                        <td className={cn('px-3 py-1.5', row.action === 'refused' ? 'text-danger-text' : 'text-fg-secondary')}>{row.note ?? ACTION_TEXT[row.action]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > 200 ? <p className="border-t border-border-subtle px-3 py-2 text-xs text-fg-muted">Showing the first 200 of {preview.rows.length} rows. Every row is imported.</p> : null}
              </div>
              {problems.length ? (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-fg">
                    <AlertTriangle aria-hidden className="size-4 text-warning" />
                    Could not read
                  </p>
                  <ul className="max-h-40 overflow-auto rounded-lg border border-border-subtle text-sm" data-testid="import-problems">
                    {problems.map((problem, index) => (
                      <li key={index} className="flex gap-3 border-b border-border-subtle px-3 py-1.5 last:border-b-0">
                        <span className="w-24 shrink-0 text-fg-muted">{problem.where}</span>
                        <span className="text-fg-secondary">{problem.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {preview ? (
            <Button variant="ghost" className="mr-auto" onClick={() => setPreview(null)}>
              Back
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={() => void commit()} loading={busy} disabled={okRows.length === 0} data-testid="import-commit">
              Import {okRows.length.toLocaleString('en-US')} {okRows.length === 1 ? 'row' : 'rows'}
            </Button>
          ) : (
            <Button onClick={() => void check()} loading={busy} disabled={!text.trim()} data-testid="import-preview">
              Check the file
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
