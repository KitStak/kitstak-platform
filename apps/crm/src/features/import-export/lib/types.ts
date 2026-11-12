/** Shared types and limits for the import / export module (client-safe). */
import type { ColumnType, Label, StoredCellValue } from '@/server/db/schema/cell-values';
import type { DateOrder } from './parse-values';

export const IMPORT_LIMITS = {
  /** Max upload size accepted by the parse endpoint (the proxy buffers 10MB bodies). */
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 10_000,
  maxColumns: 200,
  /** Rows sent per batch request (each batch runs in its own transaction). */
  batchSize: 200,
  maxStatusLabels: 40,
  /** Undo is offered for this long after an import finishes. */
  undoWindowMs: 24 * 60 * 60 * 1000,
} as const;

export const ACCEPTED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx'] as const;

/** Types the importer can infer from file contents. */
export type InferredType =
  | 'text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'link'
  | 'number'
  | 'currency'
  | 'date'
  | 'checkbox'
  | 'status'
  | 'people'
  | 'tags'
  | 'country';

/** Column types that can be created by the importer. */
export const CREATABLE_TYPES = [
  'text',
  'long_text',
  'status',
  'dropdown',
  'people',
  'date',
  'number',
  'currency',
  'email',
  'phone',
  'link',
  'tags',
  'checkbox',
  'rating',
  'location',
  'country',
] as const satisfies readonly ColumnType[];
export type CreatableType = (typeof CREATABLE_TYPES)[number];

export interface ColumnProfile {
  readonly index: number;
  readonly header: string;
  /** First non-empty values (for the mapping table). */
  readonly samples: readonly string[];
  readonly nonEmpty: number;
  readonly distinct: readonly string[];
  readonly distinctCount: number;
  readonly inferred: InferredType;
  /** 0–1 share of non-empty values that parse as `inferred`. */
  readonly confidence: number;
  readonly dateOrder: DateOrder;
  readonly currency: string | null;
}

export type MappingTarget =
  | { readonly kind: 'name' }
  | { readonly kind: 'existing'; readonly columnKey: string }
  | { readonly kind: 'new'; readonly type: CreatableType; readonly title: string }
  /** Route rows into the board group with this value as its title (created when missing). */
  | { readonly kind: 'group' }
  | { readonly kind: 'skip' };

export interface ColumnMapping {
  readonly sourceIndex: number;
  readonly target: MappingTarget;
  /** Auto-map confidence (0–1); 0 when the user picked it. */
  readonly confidence: number;
  readonly auto: boolean;
}

/** Minimal column shape the converter needs (ColumnDto-compatible). */
export interface TargetColumn {
  readonly key: string;
  readonly title: string;
  readonly type: ColumnType;
  readonly settings: unknown;
}

export interface MemberRef {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

export type ConvertResult =
  | { readonly ok: true; readonly value: StoredCellValue | null }
  | { readonly ok: true; readonly value: null; readonly links: readonly string[] }
  | { readonly ok: false; readonly message: string };

export interface RowIssue {
  /** 1-based row number in the source file (header = row 1 when present). */
  readonly row: number;
  readonly sourceIndex: number;
  readonly column: string;
  readonly raw: string;
  readonly message: string;
}

export type DedupeMode = 'create' | 'skip' | 'update';

export interface DedupeConfig {
  readonly mode: DedupeMode;
  /** `name` or a column key used as the match key. */
  readonly key: string | null;
}

export interface ImportRowPayload {
  readonly row: number;
  readonly name: string;
  readonly values: Record<string, StoredCellValue | null>;
  /** connect_boards columns: item names to resolve on the connected board. */
  readonly links?: Record<string, string[]>;
  /** Raw match key (normalized server side) for dedupe. */
  readonly key?: string;
  /** Group title the row is routed into (group mapping). */
  readonly groupTitle?: string;
}

export type { Label };
