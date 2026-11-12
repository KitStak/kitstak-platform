/**
 * Zod contracts for `/api/v1/imports/*` and `/api/v1/exports`. CLIENT-SAFE (zod only).
 */
import { z } from 'zod';
import { boardKindSchema, boardPrivacySchema, viewConfigSchema } from './contracts/structure-inputs';
import type { BoardSummaryDto, ColumnDto } from './contracts/dto';

const columnKey = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const valuesSchema = z.record(columnKey, z.unknown()).refine((value) => Object.keys(value).length <= 200, {
  message: 'Too many columns in one row',
});

export const IMPORT_MAX_ROWS = 10_000;
export const IMPORT_BATCH_MAX = 250;

export const importNewColumnSchema = z.object({
  ref: columnKey,
  title: z.string().trim().min(1).max(255),
  type: z.enum([
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
  ]),
  settings: z.unknown().optional(),
});

const batchIdSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const prepareImportSchema = z.object({
  /** Client-generated run id; schema changes are recorded under it so Undo can remove them. */
  batchId: batchIdSchema.optional(),
  destination: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('new'),
      workspaceId: z.uuid(),
      folderId: z.uuid().nullish(),
      name: z.string().trim().min(1).max(255),
      kind: boardKindSchema.default('custom'),
      privacy: boardPrivacySchema.default('main'),
      nameColumnTitle: z.string().trim().min(1).max(255).optional(),
      groupTitle: z.string().trim().min(1).max(255).optional(),
    }),
    z.object({
      type: z.literal('existing'),
      boardId: z.uuid(),
      groupId: z.uuid().optional(),
      newGroupTitle: z.string().trim().min(1).max(255).optional(),
    }),
  ]),
  newColumns: z.array(importNewColumnSchema).max(200).default([]),
  /** Label additions for existing status/dropdown columns (full label list). */
  labelUpdates: z
    .array(z.object({ columnKey, settings: z.unknown() }))
    .max(200)
    .default([]),
  /** Header → column key, stored on the board as a reusable mapping template. */
  savedMapping: z.record(z.string().max(200), columnKey).optional(),
});
export type PrepareImportInput = z.infer<typeof prepareImportSchema>;

export interface PrepareImportResult {
  readonly board: BoardSummaryDto;
  readonly groupId: string;
  readonly columns: readonly ColumnDto[];
  /** New column ref → real column key. */
  readonly keyByRef: Record<string, string>;
  /** True when this import created the board. */
  readonly boardCreated: boolean;
  /** Columns created on an existing board (new boards count their file columns). */
  readonly createdColumns: number;
  /** Labels added to existing status / dropdown columns. */
  readonly addedLabels: number;
}

export const importDedupeSchema = z.object({
  mode: z.enum(['create', 'skip', 'update']).default('create'),
  /** `name` or a column key. */
  key: z.union([z.literal('name'), columnKey]).nullable().default(null),
});

export const importBatchSchema = z.object({
  batchId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  boardId: z.uuid(),
  groupId: z.uuid(),
  fileName: z.string().max(255).default('import'),
  dedupe: importDedupeSchema.default({ mode: 'create', key: null }),
  /** Create connected items that don't exist yet (relationship mapping). */
  createMissingLinks: z.boolean().default(true),
  rows: z
    .array(
      z.object({
        row: z.number().int().min(1).max(1_000_000),
        name: z.string().trim().min(1).max(2_000),
        values: valuesSchema.default({}),
        links: z.record(columnKey, z.array(z.string().trim().min(1).max(500)).max(50)).optional(),
        key: z.string().max(500).optional(),
        /** Route the row into the group with this title (created when missing). */
        groupTitle: z.string().trim().min(1).max(255).optional(),
      }),
    )
    .min(1)
    .max(IMPORT_BATCH_MAX),
});
export type ImportBatchInput = z.infer<typeof importBatchSchema>;

export interface ImportBatchResult {
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly linkedCreated: number;
  readonly failed: readonly { readonly row: number; readonly message: string }[];
}

export const importMatchSchema = z.object({
  boardId: z.uuid(),
  key: z.union([z.literal('name'), columnKey]),
  values: z.array(z.string().max(500)).max(IMPORT_MAX_ROWS),
});
export type ImportMatchInput = z.infer<typeof importMatchSchema>;

export interface ImportMatchResult {
  /** Normalized keys that already exist on the board. */
  readonly matched: readonly string[];
}

/** Counts and file name are rebuilt on the server from the run's audit rows. */
export const importCompleteSchema = z.object({
  batchId: batchIdSchema,
  boardId: z.uuid(),
});
export type ImportCompleteInput = z.infer<typeof importCompleteSchema>;

export const importUndoSchema = z.object({
  batchId: batchIdSchema,
  boardId: z.uuid(),
  /** Remove the columns / labels / group this import created (only when nothing else uses them). */
  removeSchema: z.boolean().default(true),
  /** Delete the board too, when the import created it and it is empty afterwards. */
  deleteBoard: z.boolean().default(false),
});
export type ImportUndoInput = z.infer<typeof importUndoSchema>;

export interface ImportUndoResult {
  readonly archived: number;
  readonly reverted: number;
  readonly removedColumns: number;
  readonly removedLabels: number;
  readonly boardDeleted: boolean;
}

export const importRunQuerySchema = z.object({ batchId: batchIdSchema });

/** Server-side summary of a past import (from its audit rows), for `/import?run=<batchId>`. */
export interface ImportRunSummary {
  readonly batchId: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly boardDeleted: boolean;
  readonly itemTerminology: string;
  readonly fileName: string;
  readonly boardCreated: boolean;
  readonly created: number;
  readonly updated: number;
  readonly failed: number;
  readonly undone: { readonly archived: number; readonly reverted: number } | null;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface ParsedSheetDto {
  readonly name: string;
  readonly rows: string[][];
  readonly totalRows: number;
  readonly truncated: boolean;
}

export interface ParseFileResult {
  readonly fileName: string;
  readonly format: 'csv' | 'xlsx';
  readonly sheets: readonly ParsedSheetDto[];
}

export const exportSchema = z.object({
  boardId: z.uuid(),
  format: z.enum(['csv', 'xlsx']),
  viewConfig: viewConfigSchema.optional(),
  groupId: z.uuid().optional(),
  itemIds: z.array(z.uuid()).max(5_000).optional(),
  includeSubitems: z.boolean().default(false),
});
export type ExportInput = z.infer<typeof exportSchema>;

/** Normalize a dedupe key (shared by client previews and the server). */
export function normalizeMatchKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
