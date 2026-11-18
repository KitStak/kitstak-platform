'use client';
/**
 * Shared pieces of the entry ledgers (other costs, material usage, money in, extra services):
 *
 * - `Ledger`: a table whose cells can be edited in place (click, or Enter on a focused cell),
 *   with row checkboxes for deleting many rows, a lock mark on rows in a closed month, and a
 *   stacked card layout on a phone.
 * - `BulkAddDialog`: a small grid to add many rows at once, with paste from a spreadsheet.
 * - `useLedgerRows` and `refreshAfterEntry`: optimistic rows and the cache refresh after a write.
 *
 * The ledgers stay thin: each one names its columns, how a cell edit becomes a save, and how a
 * typed bulk row becomes an input.
 */
import { useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { CircleAlert, ClipboardPaste, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, IconButton, Skeleton, Tooltip, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { keepOpenForToasts } from '@/features/calculator/toast-safe';
import { centsToDecimal, centsToNumber, decimalToCents } from '@/lib/money';
import { qk } from '@/lib/query-keys';

/** Refreshes everything a stream write can move: the ledgers, jobs, profit, the summary and the badges. */
export async function refreshAfterEntry(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.streams() }),
    queryClient.invalidateQueries({ queryKey: qk.jobsRoot() }),
    queryClient.invalidateQueries({ queryKey: qk.profitRoot() }),
    queryClient.invalidateQueries({ queryKey: qk.summaryRoot() }),
    queryClient.invalidateQueries({ queryKey: qk.badges() }),
  ]);
}

/**
 * Rows from the server with local changes laid over them until the next refetch lands:
 * `patch` shows an edit at once, `hide` removes a row at once, `add` shows new rows at once.
 */
export function useLedgerRows<Row extends { id: string }>(serverRows: readonly Row[] | undefined) {
  const [patches, setPatches] = useState<ReadonlyMap<string, Row>>(new Map());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<readonly Row[]>([]);
  // New server data wins: drop the overlay (state is reset while rendering, not in an effect).
  const [seen, setSeen] = useState(serverRows);
  if (seen !== serverRows) {
    setSeen(serverRows);
    setPatches(new Map());
    setAdded([]);
    setHidden(new Set());
  }
  const rows = useMemo(() => {
    const base = serverRows ?? [];
    const known = new Set(base.map((row) => row.id));
    return [...added.filter((row) => !known.has(row.id)), ...base].filter((row) => !hidden.has(row.id)).map((row) => patches.get(row.id) ?? row);
  }, [serverRows, patches, hidden, added]);
  return {
    rows,
    patch: (row: Row) => setPatches((current) => new Map(current).set(row.id, row)),
    unpatch: (id: string) =>
      setPatches((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      }),
    hide: (ids: readonly string[]) => setHidden((current) => new Set([...current, ...ids])),
    unhide: (ids: readonly string[]) => setHidden((current) => new Set([...current].filter((id) => !ids.includes(id)))),
    add: (rows: readonly Row[]) => setAdded((current) => [...rows, ...current]),
  };
}

/* ------------------------------------------------------------------ editable cell */

export interface CellEditor {
  readonly kind: 'text' | 'money' | 'number' | 'date' | 'select';
  /** The raw value put in the input when editing starts. */
  readonly value: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly placeholder?: string;
}

function EditableCell({
  label,
  display,
  editor,
  numeric,
  onCommit,
  testId,
}: {
  readonly label: string;
  readonly display: ReactNode;
  readonly editor: CellEditor;
  readonly numeric?: boolean;
  /** Returns an error to keep the cell open, or null when the save went through. */
  readonly onCommit: (value: string) => Promise<string | null>;
  readonly testId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(editor.value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const cancelled = useRef(false);

  const start = () => {
    setValue(editor.value);
    setError(null);
    cancelled.current = false;
    setEditing(true);
  };
  const finish = (focusBack: boolean) => {
    setEditing(false);
    setError(null);
    if (focusBack) window.requestAnimationFrame(() => button.current?.focus());
  };
  const commit = async (next: string, focusBack: boolean) => {
    if (cancelled.current || saving) return;
    if (next.trim() === editor.value.trim()) {
      finish(focusBack);
      return;
    }
    setSaving(true);
    const problem = await onCommit(next);
    setSaving(false);
    if (problem) setError(problem);
    else finish(focusBack);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit(event.currentTarget.value, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelled.current = true;
      finish(true);
    }
  };

  if (!editing) {
    return (
      <button
        ref={button}
        type="button"
        onClick={start}
        aria-label={`Edit ${label}`}
        data-testid={testId}
        className={cn(
          'group/cell -mx-1.5 inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          numeric && 'flex-row-reverse text-right',
        )}
      >
        <span className={cn('min-w-0', numeric || editor.kind === 'date' || editor.kind === 'money' || editor.kind === 'number' ? 'whitespace-nowrap' : 'truncate')}>{display}</span>
        <Pencil aria-hidden className="size-3 shrink-0 text-fg-muted opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100" />
      </button>
    );
  }
  const shared = {
    'aria-label': label,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    disabled: saving,
    autoFocus: true,
    'data-testid': testId ? `${testId}-input` : undefined,
    className: cn('h-7 w-full min-w-[84px] rounded-md border bg-panel px-1.5 text-sm text-fg outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]', error ? 'border-danger' : 'border-border-input', numeric && 'text-right tabular-nums'),
  };
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {editor.kind === 'select' ? (
        <select
          {...shared}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            void commit(event.target.value, true);
          }}
          onBlur={() => finish(false)}
          onKeyDown={onKey}
        >
          {(editor.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          type={editor.kind === 'date' ? 'date' : 'text'}
          inputMode={editor.kind === 'money' || editor.kind === 'number' ? 'decimal' : undefined}
          value={value}
          placeholder={editor.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => (editor.kind === 'date' ? undefined : event.currentTarget.select())}
          onBlur={(event) => void commit(event.currentTarget.value, false)}
          onKeyDown={onKey}
        />
      )}
      {error ? (
        <span id={errorId} role="alert" className="flex items-start gap-1 text-left text-2xs font-medium whitespace-normal text-danger-text">
          <CircleAlert aria-hidden className="mt-px size-3 shrink-0" />
          {error}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ ledger table */

export interface LedgerColumn<Row> {
  readonly id: string;
  readonly header: string;
  readonly numeric?: boolean;
  /** The column that names the row (used as the card title on a phone and in aria labels). */
  readonly primary?: boolean;
  readonly className?: string;
  readonly render: (row: Row) => ReactNode;
  /** Leave out for a read only column. Return null for a row that cannot be edited in this column. */
  readonly editor?: (row: Row) => CellEditor | null;
  /** Hide the column on a phone card when it has nothing to say for this row. */
  readonly emptyWhen?: (row: Row) => boolean;
}

export interface LedgerProps<Row extends { id: string; locked: boolean }> {
  readonly testId: string;
  readonly caption: string;
  readonly columns: readonly LedgerColumn<Row>[];
  readonly rows: readonly Row[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly empty: ReactNode;
  readonly canEdit: boolean;
  /** What a row is called in aria labels: "the freight cost of Nov 3". */
  readonly rowName: (row: Row) => string;
  readonly onCommit: (row: Row, columnId: string, value: string) => Promise<string | null>;
  readonly onDelete?: (rows: readonly Row[]) => void;
  /** Small marks after the first cell, like "From the warehouse". */
  readonly rowBadges?: (row: Row) => ReactNode;
  readonly footer?: ReactNode;
  readonly lockedHint?: string;
}

export function Ledger<Row extends { id: string; locked: boolean }>({ testId, caption, columns, rows, loading, error, onRetry, empty, canEdit, rowName, onCommit, onDelete, rowBadges, footer, lockedHint = 'This month is closed, so this row cannot change.' }: LedgerProps<Row>) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const live = rows.filter((row) => selected.has(row.id));
  const selectable = canEdit && Boolean(onDelete);
  const open = rows.filter((row) => !row.locked);
  const allChecked = open.length > 0 && open.every((row) => selected.has(row.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const cell = (row: Row, column: LedgerColumn<Row>, suffix: string) => {
    const editor = canEdit && !row.locked ? (column.editor?.(row) ?? null) : null;
    // In the table a cell that cannot be edited stays on one line; the phone card (suffix set) lets it wrap.
    if (!editor) return suffix ? column.render(row) : <span className={cn('block', column.numeric ? 'whitespace-nowrap' : 'max-w-[240px] truncate')}>{column.render(row)}</span>;
    return <EditableCell label={`${column.header.toLowerCase()} of ${rowName(row)}`} display={column.render(row)} editor={editor} numeric={column.numeric} onCommit={(value) => onCommit(row, column.id, value)} testId={`${testId}-${row.id}-${column.id}${suffix}`} />;
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2 p-4" data-testid={`${testId}-loading`}>
        <span className="sr-only">Loading {caption.toLowerCase()}</span>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} height={32} rounded="md" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm" data-testid={`${testId}-error`}>
        <p className="font-medium text-danger-text">We could not load {caption.toLowerCase()}.</p>
        <p className="text-fg-secondary">{error}</p>
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  if (rows.length === 0) return <div data-testid={`${testId}-empty`}>{empty}</div>;

  const primary = columns.find((column) => column.primary) ?? columns[0]!;
  return (
    <div data-testid={testId} className="flex flex-col">
      {selectable && live.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-selected px-4 py-2 text-sm" role="region" aria-label="Selected rows">
          <span className="font-medium text-fg" aria-live="polite">
            {live.length} {live.length === 1 ? 'row' : 'rows'} picked
          </span>
          <span className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              variant="danger"
              size="sm"
              leadingIcon={<Trash2 aria-hidden />}
              data-testid={`${testId}-bulk-delete`}
              onClick={() => {
                onDelete?.(live);
                setSelected(new Set());
              }}
            >
              Delete {live.length === 1 ? 'row' : `${live.length} rows`}
            </Button>
          </span>
        </div>
      ) : null}

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left text-sm text-fg tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border-default text-xs text-fg-muted">
              {selectable ? (
                <th scope="col" className="w-9 py-2 pr-0 pl-4">
                  <Checkbox size="sm" aria-label="Pick every row" checked={allChecked ? true : live.length > 0 ? 'indeterminate' : false} onCheckedChange={(value) => setSelected(value === true ? new Set(open.map((row) => row.id)) : new Set())} />
                </th>
              ) : null}
              {columns.map((column) => (
                <th key={column.id} scope="col" className={cn('px-3 py-2 font-medium whitespace-nowrap first:pl-4', column.numeric && 'text-right', column.className)}>
                  {column.header}
                </th>
              ))}
              {canEdit && onDelete ? <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-selected={selected.has(row.id) || undefined} data-testid={`${testId}-row`} className="border-b border-border-subtle last:border-b-0 hover:bg-hover data-[selected=true]:bg-selected">
                {selectable ? (
                  <td className="py-1.5 pr-0 pl-4">
                    {row.locked ? (
                      <Tooltip content={lockedHint}>
                        <span className="inline-flex size-4 items-center justify-center text-fg-muted" role="img" aria-label="Locked">
                          <Lock aria-hidden className="size-3.5" />
                        </span>
                      </Tooltip>
                    ) : (
                      <Checkbox size="sm" aria-label={`Pick ${rowName(row)}`} checked={selected.has(row.id)} onCheckedChange={(value) => toggle(row.id, value === true)} />
                    )}
                  </td>
                ) : null}
                {columns.map((column, index) => (
                  <td key={column.id} className={cn('max-w-[260px] px-3 py-1.5 align-middle first:pl-4', column.numeric && 'text-right whitespace-nowrap', column.className)}>
                    {index === 0 && rowBadges ? (
                      <span className="flex items-center gap-2">
                        {cell(row, column, '')}
                        {rowBadges(row)}
                      </span>
                    ) : (
                      cell(row, column, '')
                    )}
                  </td>
                ))}
                {canEdit && onDelete ? (
                  <td className="px-2 py-1.5 text-right">
                    {row.locked ? null : <IconButton label={`Delete ${rowName(row)}`} icon={<Trash2 aria-hidden />} variant="ghost" size="sm" onClick={() => onDelete([row])} data-testid={`${testId}-${row.id}-delete`} />}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot className="border-t border-border-default text-sm font-semibold">{footer}</tfoot> : null}
        </table>
      </div>

      <ul className="flex flex-col divide-y divide-border-subtle sm:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1.5 px-4 py-3" data-testid={`${testId}-card`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                {cell(row, primary, '-m')}
                {rowBadges?.(row)}
                {row.locked ? <Lock aria-label="Locked" role="img" className="size-3.5 text-fg-muted" /> : null}
              </div>
              {canEdit && onDelete && !row.locked ? <IconButton label={`Delete ${rowName(row)}`} icon={<Trash2 aria-hidden />} variant="ghost" size="sm" onClick={() => onDelete([row])} /> : null}
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm tabular-nums">
              {columns
                .filter((column) => column.id !== primary.id && !column.emptyWhen?.(row))
                .map((column) => (
                  <div key={column.id} className="contents">
                    <dt className="py-0.5 text-xs text-fg-muted">{column.header}</dt>
                    <dd className="min-w-0 text-right text-fg">{cell(row, column, '-m')}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ bulk add */

export interface BulkColumn {
  readonly id: string;
  readonly label: string;
  readonly kind: 'text' | 'money' | 'number' | 'date' | 'select';
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly required?: boolean;
  readonly placeholder?: string;
  /** Starting value of the column in every new row. */
  readonly initial?: string;
  readonly width?: string;
}

export type BulkCells = Readonly<Record<string, string>>;
export type BulkRowResult<Input> = { readonly input: Input } | { readonly errors: Readonly<Record<string, string>> };

const START_ROWS = 4;

/** Matches a pasted cell to a select option by value or by label, ignoring case. */
function matchOption(column: BulkColumn, text: string): string {
  if (column.kind !== 'select') return text;
  const wanted = text.trim().toLowerCase();
  return column.options?.find((option) => option.value.toLowerCase() === wanted || option.label.toLowerCase() === wanted)?.value ?? column.initial ?? '';
}

export function BulkAddDialog<Input>({
  open,
  onOpenChange,
  title,
  description,
  columns,
  noun,
  nouns,
  toInput,
  onSubmit,
  testId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly columns: readonly BulkColumn[];
  /** One row, in the count on the button: "cost", "material row". */
  readonly noun: string;
  /** The plural, when adding an s is wrong ("entries"). */
  readonly nouns?: string;
  /** Checks one typed row. Rows with every cell empty (or still at the starting values) are skipped before this is called. */
  readonly toInput: (cells: BulkCells) => BulkRowResult<Input>;
  /** Saves the rows. Returns null when it worked, or a message, with the row it is about when known. */
  readonly onSubmit: (inputs: readonly Input[]) => Promise<{ readonly message: string; readonly row?: number } | null>;
  readonly testId: string;
}) {
  const blank = useMemo<BulkCells>(() => Object.fromEntries(columns.map((column) => [column.id, column.initial ?? ''])), [columns]);
  const [rows, setRows] = useState<BulkCells[]>(() => Array.from({ length: START_ROWS }, () => blank));
  const [errors, setErrors] = useState<Readonly<Record<number, Readonly<Record<string, string>>>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh grid each time the dialog opens (state is reset while rendering, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setRows(Array.from({ length: START_ROWS }, () => blank));
      setErrors({});
      setMessage(null);
    }
  }

  const touchedRow = (cells: BulkCells): boolean => columns.some((column) => (cells[column.id] ?? '').trim() !== (column.initial ?? '').trim());
  const filled = rows.map((cells, index) => ({ cells, index })).filter((row) => touchedRow(row.cells));
  const setCell = (rowIndex: number, columnId: string, value: string) => {
    setRows((current) => current.map((cells, index) => (index === rowIndex ? { ...cells, [columnId]: value } : cells)));
    setMessage(null);
    setErrors((current) => {
      if (!current[rowIndex]?.[columnId]) return current;
      const rest = { ...current[rowIndex] };
      delete rest[columnId];
      return { ...current, [rowIndex]: rest };
    });
  };

  const paste = (event: ClipboardEvent<HTMLInputElement | HTMLSelectElement>, rowIndex: number, columnIndex: number) => {
    const text = event.clipboardData.getData('text');
    if (!/[\t\n]/.test(text)) return;
    event.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((line, index, all) => line.length > 0 || index < all.length - 1);
    const grid = lines.map((line) => line.split('\t'));
    // A header row copied along is dropped when it names our columns.
    const first = (grid[0] ?? []).map((value) => value.trim().toLowerCase());
    const body = first.length > 0 && first.every((value, offset) => columns[columnIndex + offset]?.label.toLowerCase() === value) ? grid.slice(1) : grid;
    setRows((current) => {
      const next = [...current];
      body.slice(0, 200).forEach((values, offset) => {
        const at = rowIndex + offset;
        const base = next[at] ?? blank;
        const cells: Record<string, string> = { ...base };
        values.forEach((value, valueOffset) => {
          const column = columns[columnIndex + valueOffset];
          if (column) cells[column.id] = matchOption(column, value.trim());
        });
        next[at] = cells;
      });
      return next;
    });
    setMessage(null);
  };

  const submit = async () => {
    setMessage(null);
    if (filled.length === 0) {
      setMessage('Type at least one row first.');
      return;
    }
    const nextErrors: Record<number, Readonly<Record<string, string>>> = {};
    const inputs: Input[] = [];
    for (const row of filled) {
      const result = toInput(row.cells);
      if ('errors' in result) nextErrors[row.index] = result.errors;
      else inputs.push(result.input);
    }
    setErrors(nextErrors);
    const bad = Object.keys(nextErrors).length;
    if (bad > 0) {
      setMessage(`${bad} ${bad === 1 ? 'row needs' : 'rows need'} another look. Nothing was added yet.`);
      return;
    }
    setSaving(true);
    const problem = await onSubmit(inputs);
    setSaving(false);
    if (problem) {
      setMessage(problem.message);
      if (problem.row !== undefined && filled[problem.row]) setErrors({ [filled[problem.row]!.index]: { _row: problem.message } });
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" data-testid={testId} onInteractOutside={keepOpenForToasts}>
        <DialogHeader title={title} description={description} />
        <DialogBody className="flex flex-col gap-3 pb-4">
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            <ClipboardPaste aria-hidden className="size-3.5 shrink-0" />
            Copy rows from a spreadsheet and paste them into the first cell. The columns fill in order.
          </p>
          <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[640px] border-separate border-spacing-x-1.5 border-spacing-y-1 text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="text-left text-xs text-fg-muted">
                  <th scope="col" className="w-6 font-medium">
                    <span className="sr-only">Row</span>
                  </th>
                  {columns.map((column) => (
                    <th key={column.id} scope="col" className="pb-0.5 font-medium whitespace-nowrap" style={{ width: column.width }}>
                      {column.label}
                      {column.required ? (
                        <span aria-hidden className="ml-0.5 text-danger-text">
                          *
                        </span>
                      ) : null}
                    </th>
                  ))}
                  <th scope="col" className="w-8">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((cells, rowIndex) => {
                  const rowErrors = errors[rowIndex] ?? {};
                  const firstError = Object.values(rowErrors)[0];
                  return (
                    <tr key={rowIndex} data-testid={`${testId}-row-${rowIndex}`} className="align-top">
                      <th scope="row" className="pt-1.5 text-right text-xs font-normal text-fg-muted tabular-nums">
                        {rowIndex + 1}
                      </th>
                      {columns.map((column, columnIndex) => {
                        const bad = Boolean(rowErrors[column.id]);
                        const shared = {
                          'aria-label': `${column.label}, row ${rowIndex + 1}`,
                          'aria-invalid': bad || undefined,
                          title: rowErrors[column.id],
                          'data-testid': `${testId}-${rowIndex}-${column.id}`,
                          className: cn('h-8 w-full rounded-md border bg-panel px-2 text-sm text-fg outline-none hover:border-border-input-hover focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]', bad ? 'border-danger' : 'border-border-input', (column.kind === 'money' || column.kind === 'number') && 'text-right tabular-nums'),
                        };
                        return (
                          <td key={column.id}>
                            {column.kind === 'select' ? (
                              <select {...shared} value={cells[column.id] ?? ''} onChange={(event) => setCell(rowIndex, column.id, event.target.value)} onPaste={(event) => paste(event, rowIndex, columnIndex)}>
                                {column.required && column.initial ? null : <option value="">{column.placeholder ?? 'Pick one'}</option>}
                                {(column.options ?? []).map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input {...shared} type={column.kind === 'date' ? 'date' : 'text'} inputMode={column.kind === 'money' || column.kind === 'number' ? 'decimal' : undefined} value={cells[column.id] ?? ''} placeholder={column.placeholder} autoComplete="off" onChange={(event) => setCell(rowIndex, column.id, event.target.value)} onPaste={(event) => paste(event, rowIndex, columnIndex)} />
                            )}
                            {columnIndex === 0 && firstError ? (
                              <p role="alert" className="mt-0.5 flex items-start gap-1 text-2xs font-medium whitespace-nowrap text-danger-text">
                                <CircleAlert aria-hidden className="mt-px size-3 shrink-0" />
                                {firstError}
                              </p>
                            ) : null}
                          </td>
                        );
                      })}
                      <td>
                        <IconButton label={`Remove row ${rowIndex + 1}`} icon={<Trash2 aria-hidden />} variant="ghost" size="sm" disabled={rows.length === 1} onClick={() => { setRows((current) => current.filter((_, index) => index !== rowIndex)); setErrors({}); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setRows((current) => [...current, ...Array.from({ length: 3 }, () => blank)])} data-testid={`${testId}-more`}>
              Add 3 more rows
            </Button>
            {message ? (
              <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger-text" data-testid={`${testId}-message`}>
                <CircleAlert aria-hidden className="size-4 shrink-0" />
                {message}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving} data-testid={`${testId}-save`}>
            {filled.length === 0 ? `Add ${nouns ?? `${noun}s`}` : `Add ${filled.length} ${filled.length === 1 ? noun : (nouns ?? `${noun}s`)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ typed values */

/** A typed dollar amount ("1,250.50", "$40", "-12") as whole cents. Null when it is not money. */
export function readMoney(value: string, allowNegative = false): number | null {
  const text = value.replace(/[$,\s]/g, '');
  const pattern = allowNegative ? /^-?\d{1,10}(\.\d{1,2})?$/ : /^\d{1,10}(\.\d{1,2})?$/;
  if (!pattern.test(text)) return null;
  return centsToNumber(decimalToCents(text));
}

/** A typed plain number with up to `scale` decimal places, as exact text. Null when it is not one. */
export function readNumber(value: string, scale: number): string | null {
  const text = value.replace(/[$,\s]/g, '');
  if (!new RegExp(`^\\d{1,9}(\\.\\d{1,${scale}})?$`).test(text)) return null;
  return text;
}

export const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Stored cents as the text a person edits: 125050 gives "1250.50". */
export function centsText(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : centsToDecimal(cents);
}

/* ------------------------------------------------------------------ save, delete, undo */

interface ActionLike<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string; readonly fields?: Readonly<Record<string, string>> };
}

/** Runs a server action and never throws: a dropped connection reads as a plain failure. */
async function attempt<T>(run: () => Promise<ActionLike<T>>): Promise<ActionLike<T>> {
  try {
    return await run();
  } catch {
    return { ok: false, error: { code: 'INTERNAL', message: 'Check your connection and try again.' } };
  }
}

/**
 * The write side every ledger shares. An edit shows at once and is taken back if the server
 * says no; a delete hides the rows at once; both end in a toast with Undo (also Ctrl or Cmd+Z).
 */
export function useLedgerActions<Row extends { id: string; version: number }, Input extends { id?: string | null; version?: number | null }>({
  overlay,
  save,
  remove,
  restore,
  toInput,
  noun,
  nouns,
  refresh,
}: {
  readonly overlay: ReturnType<typeof useLedgerRows<Row>>;
  readonly save: (input: Input) => Promise<ActionLike<Row>>;
  readonly remove: (input: { id: string }) => Promise<ActionLike<Row>>;
  readonly restore: (input: { id: string }) => Promise<ActionLike<Row>>;
  /** The whole row as a save input, with its id and version. */
  readonly toInput: (row: Row) => Input;
  /** One row in words: "cost", "material row". */
  readonly noun: string;
  /** The plural, when adding an s is wrong ("entries"). */
  readonly nouns?: string;
  readonly refresh: () => Promise<void>;
}) {
  const Noun = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
  /** Saves one changed row. Returns the message to show in the cell when it did not work. */
  const commit = async (row: Row, optimistic: Row, input: Input): Promise<string | null> => {
    overlay.patch(optimistic);
    const result = await attempt(() => save(input));
    if (!result.ok || !result.data) {
      overlay.unpatch(row.id);
      if (result.error?.code === 'CONFLICT') void refresh();
      return Object.values(result.error?.fields ?? {})[0] ?? result.error?.message ?? 'That did not save. Try again.';
    }
    const saved = result.data;
    overlay.patch(saved);
    void refresh();
    toast.undo(`${Noun} updated`, {
      onUndo: async () => {
        const back = await attempt(() => save({ ...toInput(row), version: saved.version }));
        if (!back.ok) throw new Error(back.error?.message ?? 'Please try again.');
        await refresh();
      },
    });
    return null;
  };
  const removeRows = async (rows: readonly Row[]): Promise<void> => {
    const ids = rows.map((row) => row.id);
    overlay.hide(ids);
    const gone: string[] = [];
    let problem: string | null = null;
    for (const id of ids) {
      const result = await attempt(() => remove({ id }));
      if (result.ok) gone.push(id);
      else problem = result.error?.message ?? 'Please try again.';
    }
    const kept = ids.filter((id) => !gone.includes(id));
    if (kept.length > 0) overlay.unhide(kept);
    if (problem) toast.error(kept.length === ids.length ? `Couldn't delete the ${noun}` : `${kept.length} of ${ids.length} could not be deleted`, problem);
    if (gone.length === 0) return;
    void refresh();
    toast.undo(gone.length === 1 ? `${Noun} deleted` : `${gone.length} ${nouns ?? `${noun}s`} deleted`, {
      onUndo: async () => {
        for (const id of gone) {
          const back = await attempt(() => restore({ id }));
          if (!back.ok) throw new Error(back.error?.message ?? 'Please try again.');
        }
        overlay.unhide(gone);
        await refresh();
      },
    });
  };
  /** After a bulk add went through: show the rows, refresh, and offer to take them back out. */
  const added = (rows: readonly Row[]): void => {
    overlay.add(rows);
    void refresh();
    toast.undo(rows.length === 1 ? `${Noun} added` : `${rows.length} ${nouns ?? `${noun}s`} added`, {
      onUndo: async () => {
        overlay.hide(rows.map((row) => row.id));
        for (const row of rows) {
          const back = await attempt(() => remove({ id: row.id }));
          if (!back.ok) throw new Error(back.error?.message ?? 'Please try again.');
        }
        await refresh();
      },
    });
  };
  return { commit, removeRows, added };
}

/** Turns a failed bulk action into the dialog's message, with the row number when the server named one. */
export function bulkProblem(error: { readonly message: string; readonly fields?: Readonly<Record<string, string>> } | undefined): { message: string; row?: number } {
  const key = Object.keys(error?.fields ?? {}).find((name) => /^rows\.\d+$/.test(name));
  return { message: error?.message ?? 'Check your connection and try again.', row: key ? Number(key.split('.')[1]) : undefined };
}
