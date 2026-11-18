'use client';
/**
 * Step 1 of an import: drag a file in or paste rows. The file is read and split into rows in the
 * browser (so a big file never has to fit in one request), then sent to the server in chunks as
 * plain text. The server does every check itself from those raw strings.
 */
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardPaste, Download, FileSpreadsheet, FileUp, TriangleAlert, X } from 'lucide-react';
import { Button, Field, ProgressBar, Select, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { mapHeaders } from '@/lib/csv/headers';
import { CSV_LIMITS, DELIMITERS, DELIMITER_LABELS, parseCsv, type Delimiter, type ParsedCsv } from '@/lib/csv/parse';
import { anyStreamDef } from '@/lib/csv/streams';
import { formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';
import type { StreamInfo } from '@/lib/streams';
import { errorText, fileLinks, importApi } from './api';
import { IMPORT_LIMITS } from './types';

interface Loaded {
  readonly name: string | null;
  readonly size: number;
  readonly text: string;
}

const LINE_BREAK = /\r\n|\n|\r/;

/** Drops the lines above the header row (a title or a blank line some exports put first). */
function fromHeaderRow(text: string, headerRow: number): string {
  if (headerRow <= 1) return text;
  let rest = text;
  for (let skipped = 1; skipped < headerRow; skipped += 1) {
    const match = LINE_BREAK.exec(rest);
    if (!match) return '';
    rest = rest.slice(match.index + match[0].length);
  }
  return rest;
}

/** Which of the first five rows names the columns: the one that matches the most stream columns. */
function guessHeaderRow(text: string, stream: StreamInfo): number {
  const columns = anyStreamDef(stream.id).columns;
  let best = 1;
  let bestScore = -1;
  for (let row = 1; row <= 5; row += 1) {
    const part = fromHeaderRow(text, row);
    if (part.trim() === '') break;
    const parsed = parseCsv(part, { maxRows: 1 });
    const score = mapHeaders(parsed.headers, columns, { fuzzy: true }).columns.filter((column) => column !== null).length;
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

async function sha256(text: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, { maxDigits: 0 })} KB`;
  return `${formatNumber(bytes / (1024 * 1024), { maxDigits: 1 })} MB`;
}

export function ImportUpload({ stream }: { readonly stream: StreamInfo }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pasted, setPasted] = useState('');
  const [dragging, setDragging] = useState(false);
  const [delimiter, setDelimiter] = useState<Delimiter | 'auto'>('auto');
  const [headerRow, setHeaderRow] = useState(1);
  const [readError, setReadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);

  const parsed: ParsedCsv | null = useMemo(() => {
    if (!loaded) return null;
    return parseCsv(fromHeaderRow(loaded.text, headerRow), delimiter === 'auto' ? {} : { delimiter });
  }, [loaded, delimiter, headerRow]);

  const take = useCallback(
    (next: Loaded) => {
      setReadError(null);
      if (next.size > CSV_LIMITS.maxBytes) {
        setLoaded(null);
        setReadError(`This file is ${sizeText(next.size)}. The most Pulse can read at once is 10 MB. Split it into smaller files and import them one at a time.`);
        return;
      }
      setDelimiter('auto');
      setHeaderRow(guessHeaderRow(next.text, stream));
      setLoaded(next);
    },
    [stream],
  );

  const readFile = useCallback(
    async (file: File) => {
      if (file.size > CSV_LIMITS.maxBytes) {
        take({ name: file.name, size: file.size, text: '' });
        return;
      }
      if (/\.(xlsx|xls|numbers|ods)$/i.test(file.name)) {
        setLoaded(null);
        setReadError('That is a spreadsheet file. Open it and use "Save as" or "Download" to make a CSV file, then bring the CSV here. You can also copy the rows and paste them.');
        return;
      }
      try {
        take({ name: file.name, size: file.size, text: await file.text() });
      } catch {
        setLoaded(null);
        setReadError('We could not read that file. Try saving it again as a CSV file.');
      }
    },
    [take],
  );

  const usePasted = (): void => {
    const text = pasted.trim();
    if (text === '') {
      setReadError('Paste your rows first, with the row of column names on top.');
      return;
    }
    take({ name: null, size: new Blob([pasted]).size, text: pasted });
  };

  const blocking = parsed ? parsed.problems.filter((problem) => problem.level === 'error') : [];
  const warnings = parsed ? parsed.problems.filter((problem) => problem.level === 'warning') : [];
  const canUpload = parsed !== null && blocking.length === 0 && parsed.headers.length > 0 && parsed.rows.length > 0 && progress === null;

  const upload = async (): Promise<void> => {
    if (!parsed || !loaded) return;
    const total = parsed.rows.length;
    setProgress({ sent: 0, total });
    let batchId: string | null = null;
    try {
      const start = await importApi.start({ stream: stream.id, fileName: loaded.name, fileSize: loaded.size, fileHash: await sha256(loaded.text), delimiter: parsed.delimiter, headers: parsed.headers });
      batchId = start.batch.id;
      const offsetRows = headerRow - 1;
      for (let offset = 0; offset < total; offset += IMPORT_LIMITS.chunkRows) {
        const chunk = parsed.rows.slice(offset, offset + IMPORT_LIMITS.chunkRows).map((cells, index) => ({ n: (parsed.rowNumbers[offset + index] as number) + offsetRows, cells }));
        await importApi.appendRows(batchId, chunk, offset + IMPORT_LIMITS.chunkRows >= total);
        setProgress({ sent: Math.min(offset + IMPORT_LIMITS.chunkRows, total), total });
      }
      router.push(routes.importBatch(batchId));
    } catch (error) {
      setProgress(null);
      toast.error('The upload did not finish', errorText(error));
      if (batchId) void importApi.discard(batchId).catch(() => undefined);
    }
  };

  const reset = (): void => {
    setLoaded(null);
    setReadError(null);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
      <Panel title="1. Upload your file">
        {loaded && parsed ? (
          <div className="flex flex-col gap-4" data-testid="upload-preview">
            <div className="flex items-start gap-3 rounded-lg border border-border-subtle bg-sunken px-3 py-2.5">
              <FileSpreadsheet aria-hidden className="mt-0.5 size-5 shrink-0 text-icon-strong" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{loaded.name ?? 'Pasted rows'}</p>
                <p className="text-xs text-fg-muted tabular-nums">
                  {sizeText(loaded.size)}, {formatNumber(parsed.rows.length, { maxDigits: 0 })} {parsed.rows.length === 1 ? 'row' : 'rows'}, {parsed.headers.length} columns
                </p>
              </div>
              <Button variant="ghost" size="sm" leadingIcon={<X aria-hidden className="size-3.5" />} onClick={reset} disabled={progress !== null}>
                Use another file
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Columns are split by" hint={delimiter === 'auto' ? `Pulse found: ${DELIMITER_LABELS[parsed.delimiter].toLowerCase()}.` : 'Change this only when the columns look wrong below.'}>
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={delimiter}
                    onValueChange={(value) => setDelimiter(value as Delimiter | 'auto')}
                    options={[{ value: 'auto', label: `Work it out (${DELIMITER_LABELS[parsed.delimiter].toLowerCase()})` }, ...DELIMITERS.map((value) => ({ value, label: DELIMITER_LABELS[value] }))]}
                  />
                )}
              </Field>
              <Field label="Row with the column names" hint="Pick another row when your file has a title above the column names.">
                {({ inputId }) => <Select id={inputId} value={String(headerRow)} onValueChange={(value) => setHeaderRow(Number(value))} options={[1, 2, 3, 4, 5].map((row) => ({ value: String(row), label: `Row ${row}` }))} />}
              </Field>
            </div>

            {blocking.length > 0 ? (
              <ul className="flex flex-col gap-1.5 rounded-lg border border-danger/40 bg-danger-subtle px-3 py-2.5 text-sm text-danger-text" role="alert" data-testid="upload-problems">
                {blocking.map((problem) => (
                  <li key={`${problem.code}-${problem.row ?? 0}-${problem.message}`} className="flex items-start gap-2">
                    <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span>{problem.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {warnings.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2.5 text-sm text-warning-text" data-testid="upload-warnings">
                {warnings.slice(0, 5).map((problem) => (
                  <li key={`${problem.code}-${problem.row ?? 0}-${problem.message}`}>{problem.message}</li>
                ))}
                {warnings.length > 5 ? <li>And {warnings.length - 5} more like these.</li> : null}
              </ul>
            ) : null}

            {parsed.headers.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-fg-muted">The first rows, as Pulse reads them</p>
                <div className="overflow-x-auto rounded-lg border border-border-subtle">
                  <table className="w-full min-w-max border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-sunken">
                        {parsed.headers.map((header, index) => (
                          <th key={`${header}-${index}`} scope="col" className="border-b border-border-subtle px-2.5 py-1.5 font-semibold whitespace-nowrap text-fg">
                            {header || <span className="text-fg-muted">(no name)</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 4).map((row, rowIndex) => (
                        <tr key={parsed.rowNumbers[rowIndex]} className="border-b border-border-subtle last:border-0">
                          {row.map((cell, index) => (
                            <td key={index} className="max-w-[220px] truncate px-2.5 py-1.5 text-fg-secondary">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {progress ? (
              <div role="status" aria-live="polite" data-testid="upload-progress">
                <p className="mb-1 text-sm text-fg-secondary tabular-nums">
                  Sending rows: {formatNumber(progress.sent, { maxDigits: 0 })} of {formatNumber(progress.total, { maxDigits: 0 })}
                </p>
                <ProgressBar value={Math.round((progress.sent / Math.max(progress.total, 1)) * 100)} label="Sending rows" showValue />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-fg-muted">Nothing is saved yet. Next you match the columns and see a check of every row.</p>
              <Button onClick={() => void upload()} disabled={!canUpload} loading={progress !== null} data-testid="upload-continue">
                Match columns
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div role="tablist" aria-label="How to bring the rows in" className="inline-flex self-start rounded-lg border border-border-subtle bg-sunken p-0.5">
              {(
                [
                  ['file', 'Upload a file', FileUp],
                  ['paste', 'Paste rows', ClipboardPaste],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  data-testid={`upload-mode-${id}`}
                  onClick={() => {
                    setMode(id);
                    setReadError(null);
                  }}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    mode === id ? 'bg-panel text-fg shadow-xs' : 'text-fg-secondary hover:text-fg',
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {mode === 'file' ? (
              <label
                htmlFor={dropId}
                data-testid="upload-drop"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void readFile(file);
                }}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                  'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
                  dragging ? 'border-primary bg-primary-subtle' : 'border-border-strong bg-sunken hover:border-primary hover:bg-hover',
                )}
              >
                <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary-text">
                  <FileUp className="size-6" />
                </span>
                <span className="text-base font-medium text-fg">Drag your {stream.name.toLowerCase()} file here</span>
                <span className="text-sm text-fg-muted">or press Enter to pick it from your computer. CSV files up to 10 MB and {formatNumber(CSV_LIMITS.maxRows, { maxDigits: 0 })} rows.</span>
                <input
                  ref={inputRef}
                  id={dropId}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
                  className="sr-only"
                  data-testid="upload-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                  }}
                />
              </label>
            ) : (
              <div className="flex flex-col gap-2">
                <Field label="Rows from your spreadsheet" hint="Copy the rows in Excel or Google Sheets, with the row of column names on top, and paste them here.">
                  {({ inputId, describedBy }) => (
                    <Textarea id={inputId} aria-describedby={describedBy} rows={8} value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={`${stream.needed.join('\t')}\n...`} className="font-mono text-xs" data-testid="upload-paste" spellCheck={false} />
                  )}
                </Field>
                <div>
                  <Button onClick={usePasted} data-testid="upload-paste-use">
                    Read these rows
                  </Button>
                </div>
              </div>
            )}

            {readError ? (
              <p role="alert" data-testid="upload-error" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-subtle px-3 py-2.5 text-sm text-danger-text">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{readError}</span>
              </p>
            ) : null}
          </div>
        )}
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel title="What the file needs">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-fg-secondary">{stream.description} These columns must be filled in on every row:</p>
            <ul className="flex flex-wrap gap-1">
              {stream.needed.map((column) => (
                <li key={column}>
                  <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-secondary">{column}</code>
                </li>
              ))}
            </ul>
            <p className="text-sm text-fg-muted">Your column names do not have to match. Pulse lines them up for you and remembers your choices for next time.</p>
            <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
              <a href={fileLinks.template(stream.file)} download data-testid="upload-template" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                <Download aria-hidden className="size-4" />
                Template with examples
              </a>
              <a href={fileLinks.howTo(stream.file)} download className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                How to fill it in
              </a>
              {stream.id === 'job_plans' ? (
                <a href={fileLinks.templateLines()} download className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  Line by line template
                </a>
              ) : null}
            </div>
          </div>
        </Panel>
        <Panel title="How an import works">
          <ol className="flex flex-col gap-2.5 text-sm">
            {[
              ['Upload', 'Drag a file in, or paste rows straight from a spreadsheet.'],
              ['Match columns', 'Pulse lines up your columns with its own and shows sample values.'],
              ['Check', 'See what is new, changed or wrong, in plain words on the exact cell. Nothing is saved yet.'],
              ['Done', 'The rows are saved together. You can undo the whole import for 7 days.'],
            ].map(([title, detail], index) => (
              <li key={title} className="flex items-start gap-2.5">
                <span aria-hidden className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular-nums', index === 0 ? 'bg-primary text-primary-fg' : 'bg-muted text-fg-secondary')}>
                  {index + 1}
                </span>
                <span>
                  <span className="font-medium text-fg">{title}.</span> <span className="text-fg-muted">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
