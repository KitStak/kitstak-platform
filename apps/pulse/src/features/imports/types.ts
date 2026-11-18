/**
 * Shapes shared by the import engine (src/server/domain/imports.ts), its routes and the import
 * screens. Pure types and small constants: safe in client components.
 */
import type { StreamId } from '@/lib/streams';

export const IMPORT_ACTIONS = ['create', 'update', 'unchanged', 'lookalike', 'skip', 'error'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

/** What each row action is called on screen. */
export const IMPORT_ACTION_LABELS: Readonly<Record<ImportAction, string>> = {
  create: 'New',
  update: 'Changed',
  unchanged: 'No change',
  lookalike: 'Looks the same',
  skip: 'Skipped',
  error: 'Problem',
};

export const IMPORT_STATUSES = ['uploading', 'mapped', 'checked', 'committed', 'failed', 'undone'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_STATUS_LABELS: Readonly<Record<ImportStatus, string>> = {
  uploading: 'Not finished',
  mapped: 'Not finished',
  checked: 'Checked, not saved',
  committed: 'Saved',
  failed: 'Did not save',
  undone: 'Undone',
};

export interface ImportOptions {
  /** `all_or_nothing`: one problem stops the whole file. `skip_bad_rows`: good rows are saved, bad rows are left out. */
  readonly mode: 'all_or_nothing' | 'skip_bad_rows';
  /** How to read 3/4/2026. `null` lets Pulse work it out from the file. */
  readonly dateOrder: 'MDY' | 'DMY' | null;
  /** Add clients, job types, labor classes and items the file mentions and Pulse does not have yet. */
  readonly createMissing: boolean;
  /** What to do with rows that look the same as rows already here. */
  readonly lookalikes: 'skip' | 'add';
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { mode: 'all_or_nothing', dateOrder: null, createMissing: true, lookalikes: 'skip' };

export interface ImportMessage {
  readonly level: 'error' | 'warning' | 'info';
  /** The stream column the message is about, or `null` for the whole row. */
  readonly column: string | null;
  readonly text: string;
}

export interface ImportChange {
  readonly column: string;
  readonly from: string;
  readonly to: string;
}

export interface ImportRowDTO {
  readonly rowNumber: number;
  /** The raw cells in the order of the file's headers. */
  readonly cells: readonly string[];
  readonly action: ImportAction | null;
  /** True when the person chose to leave this row out. */
  readonly skippedByUser: boolean;
  readonly messages: readonly ImportMessage[];
  readonly changes: readonly ImportChange[];
  readonly entityId: string | null;
}

export interface ImportCounts {
  readonly create: number;
  readonly update: number;
  readonly unchanged: number;
  readonly lookalike: number;
  readonly skip: number;
  readonly error: number;
  readonly warning: number;
}

export const EMPTY_IMPORT_COUNTS: ImportCounts = { create: 0, update: 0, unchanged: 0, lookalike: 0, skip: 0, error: 0, warning: 0 };

export interface ImportWillCreate {
  readonly kind: 'client' | 'job_type' | 'labor_class' | 'item';
  readonly code: string;
}

export interface ImportBatchDTO {
  readonly id: string;
  readonly stream: StreamId;
  readonly streamName: string;
  readonly fileName: string | null;
  readonly fileSize: number | null;
  readonly status: ImportStatus;
  readonly headers: readonly string[];
  /** For each header: the stream column it feeds, or `null` when it is ignored. */
  readonly mapping: readonly (string | null)[];
  readonly options: ImportOptions;
  readonly totalRows: number;
  readonly counts: ImportCounts;
  /** Records Pulse will add because the file mentions them (only with Create missing). */
  readonly willCreate: readonly ImportWillCreate[];
  /** Problems with the file as a whole, like a needed column that is not matched. */
  readonly problems: readonly string[];
  /** "You imported this same file on Nov 3." or `null`. */
  readonly sameFileNote: string | null;
  /** How dates like 3/4/2026 were read, in words. */
  readonly dateOrderNote: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly createdByName: string | null;
  readonly committedAt: string | null;
  readonly undoneAt: string | null;
  readonly undoUntil: string | null;
  /** True while the 7 day undo window is open and the batch was saved. */
  readonly canUndo: boolean;
  /** Rows left alone by the last undo because someone changed them after the import. */
  readonly undoLeft: number;
  /** A link to the rows this import made, when there is a good page for them. */
  readonly resultUrl: string | null;
}

export interface ImportPresetDTO {
  readonly id: string;
  readonly stream: StreamId;
  readonly name: string;
  /** Header text to stream column, or `null` to ignore the header. */
  readonly mapping: Readonly<Record<string, string | null>>;
  readonly options: Partial<ImportOptions>;
  readonly lastUsedAt: string | null;
  /** True when this preset was saved for exactly the headers of the current file. */
  readonly matchesFile?: boolean;
}

export interface ImportStartDTO {
  readonly batch: ImportBatchDTO;
  readonly presets: readonly ImportPresetDTO[];
  /** The preset that was applied to the first mapping, if any. */
  readonly appliedPresetId: string | null;
}

export interface ImportProgressDTO {
  readonly phase: 'idle' | 'checking' | 'saving' | 'totals' | 'done';
  readonly done: number;
  readonly total: number;
}

export interface ImportStreamSummaryDTO {
  readonly stream: StreamId;
  readonly rows: number;
  readonly lastImportAt: string | null;
  readonly lastImportRows: number | null;
  readonly lastBatchId: string | null;
}

export interface ImportRowsPage {
  readonly rows: readonly ImportRowDTO[];
  readonly total: number;
}

/** Upload limits (SPEC section 7). The browser checks them first; the server checks them again. */
export const IMPORT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 200,
  maxCellChars: 2000,
  chunkRows: 500,
  unfinishedPerOrg: 5,
  uploadsPerHour: 20,
  undoDays: 7,
} as const;
