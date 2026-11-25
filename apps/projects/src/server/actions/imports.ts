'use server';
import { z } from 'zod';
import { commitOutputImport, commitPlanImport, previewOutputImport, previewPlanImport } from '@/server/domain/programs';
import { runAction } from './_action';
import { isoDate, programKey } from './program-schemas';

const previewSchema = z.object({ key: programKey, text: z.string().min(1, 'Paste or upload a file first.').max(2_000_000) });
export async function previewOutputImportAction(input: z.input<typeof previewSchema>) {
  return runAction(previewSchema, input, (data, ctx) => previewOutputImport(ctx, data.key, data.text), { revalidate: false });
}

const planPreviewSchema = previewSchema.extend({ dates: z.array(isoDate).max(62).optional() });
export async function previewPlanImportAction(input: z.input<typeof planPreviewSchema>) {
  return runAction(planPreviewSchema, input, (data, ctx) => previewPlanImport(ctx, data.key, data.text, { dates: data.dates }), { revalidate: false });
}

const commitSchema = z.object({ key: programKey, token: z.string().min(10).max(4_000_000) });
export async function commitOutputImportAction(input: z.input<typeof commitSchema>) {
  return runAction(commitSchema, input, (data, ctx) => commitOutputImport(ctx, data.key, data.token), { revalidate: false });
}
export async function commitPlanImportAction(input: z.input<typeof commitSchema>) {
  return runAction(commitSchema, input, (data, ctx) => commitPlanImport(ctx, data.key, data.token), { revalidate: false });
}
