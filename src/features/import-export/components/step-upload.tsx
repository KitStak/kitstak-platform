'use client';
import { useRef, useState, type DragEvent } from 'react';
import { AlertCircle, ArrowRight, FileSpreadsheet, Info, UploadCloud, X } from 'lucide-react';
import { Button, IconButton, ProgressBar, Switch, Textarea, cn } from '@/components/ui';
import { errorMessage, useOrgId } from '@/lib/hooks';
import type { ParseFileResult } from '@/server/services/import-export-contracts';
import { uploadForParse } from '../api';
import { parseCsv } from '../lib/csv';
import { detectHeaderRow } from '../lib/infer';
import { ACCEPTED_EXTENSIONS, IMPORT_LIMITS } from '../lib/types';
import type { SourceKind } from '../store';
import { ScrollFade } from './scroll-fade';
import { SourcePicker } from './step-source';

export interface StepUploadProps {
  readonly source: SourceKind | null;
  readonly file: ParseFileResult | null;
  readonly sheetIndex: number;
  readonly headerRow: number;
  /** Next was pressed without a file: highlight the drop zone and say what's missing. */
  readonly showErrors: boolean;
  readonly onParsed: (file: ParseFileResult, headerRow: number) => void;
  readonly onSheet: (index: number, headerRow: number) => void;
  readonly onHeaderRow: (row: number) => void;
  readonly onClear: () => void;
  /** Switch between uploading a file and pasting rows. */
  readonly onSource: (source: SourceKind) => void;
}

function validateLocal(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xls')) return 'Legacy .xls workbooks are not supported. Save the file as .xlsx or .csv and try again.';
  if (!ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'Upload a .csv, .tsv or .xlsx file.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > IMPORT_LIMITS.maxFileBytes) return 'This file is larger than 10 MB. Split it into smaller files and import them one at a time.';
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function StepUpload(props: StepUploadProps) {
  const { file } = props;
  const source: SourceKind = props.source ?? 'file';
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold text-balance text-fg outline-none">
          {file ? 'Check your data' : 'Import your data'}
        </h2>
        <p className="mt-1 text-base text-fg-secondary">
          {file
            ? 'Confirm the sheet and header row. You map columns and review every row before anything is saved.'
            : source === 'paste'
              ? 'Copy cells from Excel, Google Sheets or Numbers (including the header row) and paste them below.'
              : 'Drop a spreadsheet to start. Nothing is saved to a board until you confirm the import.'}
        </p>
      </div>
      {file ? (
        <ParsedSummary {...props} file={file} />
      ) : (
        <>
          <SourcePicker value={source} onSelect={props.onSource} />
          {source === 'paste' ? (
            <PasteArea onParsed={props.onParsed} showErrors={props.showErrors} />
          ) : (
            <DropZone onParsed={props.onParsed} showErrors={props.showErrors} />
          )}
          <div className="grid gap-2 text-sm text-fg-secondary sm:grid-cols-2">
            <p className="rounded-md border border-border-subtle bg-sunken px-3 py-2.5">
              <span className="font-semibold text-fg">From Google Sheets?</span> Choose File → Download → .xlsx or .csv, then drop
              the file here.
            </p>
            <p className="rounded-md border border-border-subtle bg-sunken px-3 py-2.5">
              <span className="font-semibold text-fg">Moving from another CRM?</span> Export contacts, companies or deals to CSV or
              Excel. Duplicates can be matched by email or name.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

const MISSING_FILE = 'Choose a file or drop one here to continue.';

function DropZone({ onParsed, showErrors }: { readonly onParsed: StepUploadProps['onParsed']; readonly showErrors: boolean }) {
  const orgId = useOrgId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const problem = validateLocal(file);
    setError(problem);
    if (problem) return;
    setPendingName(`${file.name} · ${formatBytes(file.size)}`);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const parsed = await uploadForParse(orgId, file, (fraction) => setProgress(fraction), abort.current.signal);
      const first = parsed.sheets[0];
      onParsed(parsed, first ? detectHeaderRow(first.rows) : 0);
    } catch (thrown) {
      if (thrown instanceof DOMException && thrown.name === 'AbortError') setError(null);
      else setError(errorMessage(thrown, "We couldn't read this file. Check that it's a .csv or .xlsx and try again."));
    } finally {
      setProgress(null);
      setPendingName(null);
      if (input.current) input.current.value = '';
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void handle(event.dataTransfer.files[0]);
  };

  const uploading = progress !== null;
  const message = error ?? (showErrors && !uploading ? MISSING_FILE : null);
  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="import-dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-busy={uploading}
        className={cn(
          'relative flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center',
          'transition-colors duration-[var(--duration-fast)] ease-out',
          dragging ? 'border-primary bg-primary-subtle' : 'border-border-strong bg-sunken',
          message && !dragging && 'border-danger bg-danger-subtle/40',
        )}
      >
        <span
          className={cn(
            'inline-flex size-12 items-center justify-center rounded-full bg-panel shadow-xs transition-transform duration-[var(--duration-normal)] ease-out',
            dragging ? 'scale-110 text-primary-text' : 'text-icon',
          )}
        >
          <UploadCloud aria-hidden className="size-6" />
        </span>
        {uploading ? (
          <div className="flex w-full max-w-sm flex-col gap-2" data-testid="import-upload-progress">
            <p className="truncate text-base font-semibold text-fg">{(progress ?? 0) < 1 ? 'Uploading' : 'Reading'} {pendingName}</p>
            {/* Determinate while bytes upload, indeterminate while the server parses. */}
            <ProgressBar
              value={(progress ?? 0) < 1 ? Math.round((progress ?? 0) * 100) : undefined}
              label={(progress ?? 0) < 1 ? 'Upload progress' : 'Reading the file'}
              size="sm"
            />
            <p className="text-xs text-fg-muted" aria-live="polite">
              {(progress ?? 0) < 1 ? `${Math.round((progress ?? 0) * 100)}% uploaded` : 'Detecting the header row and column types…'}
            </p>
            <Button variant="tertiary" size="sm" className="self-center" onClick={() => abort.current?.abort()} data-testid="import-upload-cancel">
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <p className="text-md font-semibold text-fg">
              Drag and drop your file here, or{' '}
              <button
                type="button"
                data-testid="import-browse"
                {...(message ? { 'data-error-focus': true, 'aria-describedby': 'import-upload-error' } : {})}
                onClick={() => input.current?.click()}
                className="rounded-xs text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              >
                browse
              </button>
            </p>
            <p className="text-sm text-fg-secondary">Accepts .xlsx, .csv and .tsv up to 10 MB and 10,000 rows</p>
          </>
        )}
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a file to import"
          data-testid="import-file-input"
          accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void handle(event.target.files?.[0])}
        />
      </div>
      {message ? (
        <p id="import-upload-error" role="alert" className="flex items-start gap-2 text-sm text-danger-text" data-testid="import-upload-error">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

function PasteArea({ onParsed, showErrors }: { readonly onParsed: StepUploadProps['onParsed']; readonly showErrors: boolean }) {
  const [text, setText] = useState('');
  const [localError, setError] = useState<string | null>(null);
  const error = localError ?? (showErrors ? 'Paste your rows, then choose “Use these rows” to continue.' : null);
  const submit = () => {
    const parsed = parseCsv(text, { maxRows: IMPORT_LIMITS.maxRows + 10, maxColumns: IMPORT_LIMITS.maxColumns });
    if (parsed.rows.length === 0) {
      setError('Paste at least one row of data.');
      return;
    }
    const result: ParseFileResult = {
      fileName: 'Pasted data',
      format: 'csv',
      sheets: [{ name: 'Pasted data', rows: parsed.rows, totalRows: parsed.totalRows, truncated: parsed.truncated }],
    };
    onParsed(result, detectHeaderRow(parsed.rows));
  };
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="import-paste" className="text-sm font-semibold text-fg">
        Rows
      </label>
      <Textarea
        id="import-paste"
        data-testid="import-paste"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        rows={10}
        invalid={Boolean(error)}
        aria-describedby={error ? 'import-paste-error' : undefined}
        placeholder={'Name\tEmail\tStatus\nAda Lovelace\tada@example.com\tQualified'}
        className="font-mono text-sm"
      />
      {error ? (
        <p id="import-paste-error" role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}
      <Button className="self-start" onClick={submit} disabled={!text.trim()} data-testid="import-paste-submit">
        Use these rows
      </Button>
    </div>
  );
}

function ParsedSummary({ file, sheetIndex, headerRow, onSheet, onHeaderRow, onClear }: StepUploadProps & { readonly file: ParseFileResult }) {
  const sheet = file.sheets[sheetIndex] ?? file.sheets[0];
  const rows = sheet?.rows ?? [];
  const width = Math.max(0, ...rows.slice(0, 50).map((row) => row.length));
  const dataCount = Math.max(0, (sheet?.totalRows ?? 0) - (headerRow + 1));
  const preview = rows.slice(Math.max(0, headerRow), Math.max(0, headerRow) + 6);
  const [overflowing, setOverflowing] = useState(false);
  return (
    <div className="flex flex-col gap-5" data-testid="import-file-summary">
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-panel p-4 shadow-xs">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-success-subtle text-success-text">
          <FileSpreadsheet aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-fg">{file.fileName}</p>
          <p className="text-sm text-fg-secondary tabular-nums">
            {dataCount.toLocaleString('en-US')} rows · {width} columns
            {file.sheets.length > 1 ? ` · ${file.sheets.length} sheets` : ''}
          </p>
        </div>
        <IconButton label="Choose a different file" icon={<X aria-hidden />} size="sm" onClick={onClear} />
      </div>
      {sheet && dataCount > IMPORT_LIMITS.maxRows ? (
        <p role="status" className="rounded-md border border-warning bg-warning-subtle px-3 py-2 text-sm text-warning-text">
          Only the first {IMPORT_LIMITS.maxRows.toLocaleString('en-US')} rows will be imported. Split larger files and import them one at a time.
        </p>
      ) : null}
      {file.sheets.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-fg">Which sheet should we import?</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sheet">
            {file.sheets.map((entry, index) => (
              <button
                key={`${entry.name}-${index}`}
                type="button"
                role="radio"
                aria-checked={index === sheetIndex}
                onClick={() => onSheet(index, detectHeaderRow(entry.rows))}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-sm border px-3 text-sm transition-colors duration-[var(--duration-fast)]',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  index === sheetIndex
                    ? 'border-primary bg-primary-selected font-semibold text-primary-text'
                    : 'border-border-input bg-panel text-fg hover:bg-muted',
                )}
              >
                {entry.name}
                <span className="text-xs text-fg-muted tabular-nums">{entry.totalRows}</span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Switch
        checked={headerRow >= 0}
        onCheckedChange={(checked) => onHeaderRow(checked ? Math.max(0, detectHeaderRow(rows)) : -1)}
        label="First row contains column names"
        description={headerRow > 0 ? `Detected on row ${headerRow + 1}; the rows above it are skipped.` : 'Turn off if your file starts with data.'}
      />
      {preview.length ? (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
          <ScrollFade label="File preview" onOverflowChange={setOverflowing} testId="import-file-preview">
            <table className="w-full min-w-max border-collapse text-sm">
              <tbody>
                {preview.map((row, rowIndex) => (
                  <tr key={rowIndex} className={cn(rowIndex === 0 && headerRow >= 0 ? 'bg-sunken font-semibold text-fg' : 'text-fg-secondary', 'border-b border-border-subtle last:border-b-0')}>
                    {Array.from({ length: Math.min(width, 12) }, (_, col) => (
                      <td key={col} className="max-w-[220px] min-w-[96px] truncate px-3 py-2" title={row[col] ?? ''}>
                        {row[col] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFade>
          {width > 12 || overflowing ? (
            <p className="flex items-center gap-1.5 border-t border-border-subtle bg-sunken px-3 py-1.5 text-xs text-fg-muted" data-testid="import-preview-hint">
              <Info aria-hidden className="size-3" />
              {width > 12 ? `Showing 12 of ${width} columns. ` : `${width} columns. `}
              {overflowing ? (
                <span className="inline-flex items-center gap-1">
                  Scroll sideways to see more <ArrowRight aria-hidden className="size-3" />
                </span>
              ) : (
                "You'll map every column next."
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
