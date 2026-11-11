/**
 * Import pipeline (BUILD_PLAN F6 `POST /api/imports/[key]`):
 *   1. parse the xlsx/csv and validate every row against the template columns (+ the
 *      handler's row schema);
 *   2. apply the valid rows in chunked transactions (one savepoint per row, so a failing
 *      row rolls back alone);
 *   3. write one `import_rows` record per row and the `import_batches` totals;
 *   4. build an xlsx error file of the failed rows.
 *
 * `previewImport` runs step 1 only (validation preview, nothing written).
 */
import { and, eq, sql } from "drizzle-orm";
import { desc } from "@/server/db/order";
import type { AppDb } from "@/server/api/db";
import { AppError, toAppError, validationError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { can } from "@/server/auth/permissions";
import { files, importBatches, importRows, users } from "@/server/db/schema";
import { fileStore, type FileStore } from "@/server/files/files";
import { log } from "@/server/log";
import { parseImportFile, type ParsedImportFile } from "./parser";
import { buildErrorFile, errorFileName, type FailedRow } from "./template";
import type { ImportDefinition, ImportRowValues } from "./types";
import { buildPreview, validateRows, type ImportPreview, type RowValidation } from "./validate";
import { mapSeq, withWriteTx } from "@/server/db/sql";

/** Prefix of the actor source for rows written by an import (Logiwa change-log SOURCE: UI / import / integration). */
export const IMPORT_SOURCE_PREFIX = "Import · ";

export const IMPORT_CHUNK_SIZE = 200;

export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportRowRecord = typeof importRows.$inferSelect;

export interface ImportUpload {
  readonly def: ImportDefinition;
  readonly auth: AuthContext;
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

function assertCanImport(def: ImportDefinition, auth: AuthContext): void {
  if (!can(auth, def.permission)) throw new AppError("FORBIDDEN", "You do not have permission to run this import");
}

function assertHeaders(missing: readonly string[]): void {
  if (missing.length > 0) {
    throw validationError(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`, {
      file: missing.map((header) => `Missing column "${header}"`),
    });
  }
}

async function parseAndValidate(upload: ImportUpload): Promise<{ file: ParsedImportFile; rows: readonly RowValidation[]; preview: ImportPreview }> {
  const file = await parseImportFile(upload.bytes, upload.fileName);
  const validation = validateRows(upload.def, file);
  return { file, rows: validation.rows, preview: buildPreview(upload.def, validation) };
}

/** Rows a dry run applies (inside a rolled-back transaction) to catch referential errors. */
export const PREVIEW_APPLY_LIMIT = 2000;

class PreviewRollback extends Error {}

/**
 * Validation preview, writes nothing. With `db` (the API route passes it) every column-valid
 * row is also run through the handler inside a transaction that is always rolled back, so the
 * preview reports the same referential errors as the real run (unknown client, warehouse, SKU…).
 */
export async function previewImport(upload: ImportUpload, db?: AppDb): Promise<ImportPreview> {
  assertCanImport(upload.def, upload.auth);
  const { rows, preview } = await parseAndValidate(upload);
  if (!db || !upload.def.handler.configured || preview.missingColumns.length > 0) return preview;
  const valid = rows.filter((r) => r.errors.length === 0).slice(0, PREVIEW_APPLY_LIMIT);
  if (valid.length === 0) return preview;
  const failures = new Map<number, string>();
  try {
    await withWriteTx(db, async (tx) => {
      const file = (await tx.insert(files).values({ name: upload.fileName, mime: "application/octet-stream", size: upload.bytes.length, sha256: "dry-run", storagePath: "dry-run", uploadedBy: upload.auth.user.id, ownerEntityType: "import_batch" }).returning({ id: files.id }))[0];
      const batch = (await tx.insert(importBatches).values({ importKey: upload.def.key, status: "Processing", masterRowCount: valid.length, fileId: file.id, uploadedBy: upload.auth.user.id }).returning({ id: importBatches.id }))[0];
      for (const row of valid) {
        const outcome = await applyRow(tx, upload, batch.id, row);
        if (!outcome.success) failures.set(row.rowNumber, outcome.message ?? "Failed");
      }
      throw new PreviewRollback("dry run");
    });
  } catch (error: unknown) {
    if (!(error instanceof PreviewRollback)) throw error;
  }
  return mergeApplyFailures(preview, failures);
}

/** Folds dry-run apply failures into the column-validation preview (errors first). */
export function mergeApplyFailures(preview: ImportPreview, failures: ReadonlyMap<number, string>): ImportPreview {
  if (failures.size === 0) return preview;
  const rows = preview.rows.map((r) => {
    const message = failures.get(r.rowNumber);
    return message && r.valid ? { ...r, valid: false, errors: [message] } : r;
  }).sort((a, b) => Number(!a.valid) === Number(!b.valid) ? a.rowNumber - b.rowNumber : Number(!b.valid) - Number(!a.valid));
  return { ...preview, validCount: Math.max(0, preview.validCount - failures.size), errorCount: preview.errorCount + failures.size, rows };
}

interface RowOutcome {
  readonly rowNumber: number;
  readonly success: boolean;
  readonly message: string | null;
  readonly entityId: string | null;
  readonly raw: Readonly<Record<string, string>>;
}

async function applyRow(tx: AppDb, upload: ImportUpload, batchId: string, row: RowValidation): Promise<RowOutcome> {
  const base = { rowNumber: row.rowNumber, raw: row.raw };
  if (row.errors.length > 0) return { ...base, success: false, message: row.errors.join("; "), entityId: null };
  try {
    const result = await withWriteTx(tx, async (savepoint) => await upload.def.handler.apply({
      db: savepoint,
      auth: upload.auth,
      // The channel is part of the source, so change-log rows written by imports read "Import · <user>".
      actor: { userId: upload.auth.user.id, source: `${IMPORT_SOURCE_PREFIX}${upload.auth.user.email}` },
      batchId,
      rowNumber: row.rowNumber,
    }, row.values as ImportRowValues));
    return { ...base, success: true, message: result.message ?? null, entityId: result.entityId ?? null };
  } catch (error: unknown) {
    const appError = toAppError(error);
    if (appError.code === "INTERNAL") log.error("import row failed", { importKey: upload.def.key, batchId, rowNumber: row.rowNumber, err: error });
    return { ...base, success: false, message: appError.code === "INTERNAL" ? "Unexpected error while importing this row" : appError.message, entityId: null };
  }
}

async function applyChunk(db: AppDb, upload: ImportUpload, batchId: string, chunk: readonly RowValidation[]): Promise<RowOutcome[]> {
  return await withWriteTx(db, async (tx) => {
    const outcomes = await mapSeq(chunk, async (row) => await applyRow(tx, upload, batchId, row));
    await tx.insert(importRows).values(outcomes.map((o) => ({
      batchId,
      rowNumber: o.rowNumber,
      success: o.success,
      data: JSON.stringify(o.raw),
      message: o.message,
      entityId: o.entityId,
    })));
    return outcomes;
  });
}

export function batchStatus(successCount: number, errorCount: number): ImportBatch["status"] {
  if (errorCount === 0 && successCount > 0) return "Successful";
  if (successCount === 0) return "Failed";
  return "Partially Successful";
}

export interface RunImportOptions {
  readonly store?: FileStore;
  readonly now?: () => Date;
}

/** Runs an upload end to end and returns the finished batch. */
export async function runImport(db: AppDb, upload: ImportUpload, options: RunImportOptions = {}): Promise<ImportBatch> {
  const now = options.now ?? (() => new Date());
  const store = options.store ?? fileStore();
  assertCanImport(upload.def, upload.auth);
  if (!upload.def.handler.configured) throw new AppError("INVALID_STATE", `${upload.def.title} is not configured yet`);

  const { file, rows, preview } = await parseAndValidate(upload);
  assertHeaders(preview.missingColumns);
  if (rows.length === 0) throw validationError("The file has no data rows");

  const original = await store.store(db, { name: upload.fileName, bytes: upload.bytes, purpose: "import", uploadedBy: upload.auth.user.id, ownerEntityType: "import_batch" });
  const batch = (await db.insert(importBatches).values({
    importKey: upload.def.key,
    status: "Processing",
    masterRowCount: rows.length,
    fileId: original.id,
    uploadedBy: upload.auth.user.id,
    createdAt: now().toISOString(),
  }).returning())[0];

  const outcomes: RowOutcome[] = [];
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
    outcomes.push(...await applyChunk(db, upload, batch.id, rows.slice(i, i + IMPORT_CHUNK_SIZE)));
  }

  const failed: FailedRow[] = outcomes.filter((o) => !o.success).map((o) => ({ rowNumber: o.rowNumber, raw: o.raw, message: o.message ?? "Failed" }));
  const successCount = outcomes.length - failed.length;
  const errorFileId = failed.length > 0
    ? (await store.store(db, {
      name: errorFileName(upload.def),
      bytes: await buildErrorFile(upload.def, file.headers, failed),
      purpose: "import-errors",
      uploadedBy: upload.auth.user.id,
      ownerEntityType: "import_batch",
      ownerEntityId: batch.id,
      expiresAt: null,
    })).id
    : null;

  await db.update(importBatches).set({
    status: batchStatus(successCount, failed.length),
    successCount,
    errorCount: failed.length,
    errorFileId,
    finishedAt: now().toISOString(),
  }).where(eq(importBatches.id, batch.id));
  log.info("import finished", { importKey: upload.def.key, batchId: batch.id, rows: rows.length, failed: failed.length });
  return (await db.select().from(importBatches).where(eq(importBatches.id, batch.id)).limit(1))[0] ?? batch;
}

export interface ImportBatchListRow extends ImportBatch {
  readonly uploadedByName: string | null;
}

/** Import history grid for one import key (newest first). */
export async function listImportBatches(db: AppDb, importKey: string, page: number, pageSize: number): Promise<{ rows: ImportBatchListRow[]; total: number }> {
  const where = eq(importBatches.importKey, importKey);
  const total = (await db.select({ n: sql<number>`count(*)` }).from(importBatches).where(where).limit(1))[0]?.n ?? 0;
  const rows = (await db.select({ batch: importBatches, uploadedByName: users.name })
    .from(importBatches)
    .leftJoin(users, eq(users.id, importBatches.uploadedBy))
    .where(where)
    .orderBy(desc(importBatches.createdAt))
    .limit(pageSize)
    .offset((Math.max(1, page) - 1) * pageSize))
    .map((r) => ({ ...r.batch, uploadedByName: r.uploadedByName }));
  return { rows, total };
}

export async function getImportBatch(db: AppDb, batchId: string): Promise<ImportBatch | undefined> {
  return (await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1))[0];
}

/** Details drawer rows (paged at 100 in the UI); `errorsOnly` = the "Show Errors" box. */
export async function listImportRows(
  db: AppDb,
  batchId: string,
  options: { readonly errorsOnly?: boolean; readonly page: number; readonly pageSize: number },
): Promise<{ rows: ImportRowRecord[]; total: number }> {
  const where = options.errorsOnly
    ? and(eq(importRows.batchId, batchId), eq(importRows.success, false))
    : eq(importRows.batchId, batchId);
  const total = (await db.select({ n: sql<number>`count(*)` }).from(importRows).where(where).limit(1))[0]?.n ?? 0;
  const rows = await db.select().from(importRows).where(where).orderBy(importRows.rowNumber)
    .limit(options.pageSize).offset((Math.max(1, options.page) - 1) * options.pageSize);
  return { rows, total };
}
