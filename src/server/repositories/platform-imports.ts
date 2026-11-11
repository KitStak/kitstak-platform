/**
 * Route-side glue for the F6 import framework (BUILD_PLAN F7 `/api/imports/**`):
 * key resolution with permission checks, history and batch details.
 */
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { requirePermission } from "@/server/auth/permissions";
import {
  getImportBatch, getImportDefinition, listImportBatches, listImportRows, summarizeImport,
  type ImportBatch, type ImportBatchListRow, type ImportDefinition, type ImportDefinitionSummary, type ImportRowRecord,
} from "@/server/imports";
import { idSchema, pagingSchema } from "./platform-common";

export const importKeyParamsSchema = z.object({ key: z.string().trim().regex(/^[a-z0-9-]{1,60}$/, "Unknown import") });
export const importHistoryQuerySchema = pagingSchema;
export const importBatchParamsSchema = z.object({ id: idSchema });
export const importBatchQuerySchema = pagingSchema.extend({
  errorsOnly: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

/** Unknown key → NOT_FOUND; missing import permission → FORBIDDEN. */
export function requireImport(auth: AuthContext, key: string): ImportDefinition {
  const def = getImportDefinition(key);
  if (!def) throw notFoundError("Import");
  requirePermission(auth, def.permission);
  return def;
}

export async function importOverview(
  db: AppDb,
  auth: AuthContext,
  key: string,
  paging: z.output<typeof importHistoryQuerySchema>,
): Promise<{ readonly definition: ImportDefinitionSummary; readonly history: readonly ImportBatchListRow[]; readonly total: number }> {
  const def = requireImport(auth, key);
  const { rows, total } = await listImportBatches(db, def.key, paging.page, paging.ps);
  return { definition: summarizeImport(def), history: rows, total };
}

export async function importBatchDetails(
  db: AppDb,
  auth: AuthContext,
  id: string,
  query: z.output<typeof importBatchQuerySchema>,
): Promise<{ readonly batch: ImportBatch; readonly rows: readonly ImportRowRecord[]; readonly total: number }> {
  const batch = await getImportBatch(db, id);
  if (!batch) throw notFoundError("Import batch");
  const def = getImportDefinition(batch.importKey);
  if (!def) throw notFoundError("Import batch");
  requirePermission(auth, def.permission);
  const { rows, total } = await listImportRows(db, id, { errorsOnly: query.errorsOnly, page: query.page, pageSize: query.ps });
  return { batch, rows, total };
}

export const importUploadFieldsSchema = z.object({
  dryRun: z.enum(["true", "false", "1", "0"]).default("false").transform((v) => v === "true" || v === "1"),
});
