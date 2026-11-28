'use server';
/** Import center actions (docs/crew/SPEC.md section 7). Rows themselves go to `POST /api/v1/import/[batchId]/rows`. */
import { z } from 'zod';
import { checkImport, commitImport, createImportBatch, IMPORT_STREAMS, undoImport } from '@/server/domain/imports';
import { runAction } from './_action';

const id = z.string().uuid();
const optionsSchema = z.object({ mode: z.enum(['all', 'skip']).optional(), makeNumbers: z.boolean().optional(), makeAgencies: z.boolean().optional() });

const batchSchema = z.object({
  stream: z.enum(IMPORT_STREAMS),
  fileName: z.string().max(200),
  fileSize: z.number().int().min(0).max(10 * 1024 * 1024),
  fileHash: z.string().max(128).nullable().optional(),
  delimiter: z.string().max(2).nullable().optional(),
  headers: z.array(z.string().max(200)).min(1).max(200),
  columns: z.array(z.string().max(60).nullable()).min(1).max(200),
  options: optionsSchema.optional(),
});
export async function createImportBatchAction(input: z.input<typeof batchSchema>) {
  return runAction(batchSchema, input, (data, ctx) => createImportBatch(ctx, data), { revalidate: false });
}

const checkSchema = z.object({ batchId: id, options: optionsSchema.optional() });
export async function checkImportAction(input: z.input<typeof checkSchema>) {
  return runAction(checkSchema, input, (data, ctx) => checkImport(ctx, data.batchId, data.options));
}

const batchIdSchema = z.object({ batchId: id });
export async function commitImportAction(input: z.input<typeof batchIdSchema>) {
  return runAction(batchIdSchema, input, (data, ctx) => commitImport(ctx, data.batchId));
}
export async function undoImportAction(input: z.input<typeof batchIdSchema>) {
  return runAction(batchIdSchema, input, (data, ctx) => undoImport(ctx, data.batchId));
}
