'use server';
import { z } from 'zod';
import { deleteView, recordRecentJob, saveView, updateUserPrefs } from '@/server/domain';
import { runAction } from './_action';
import { name, savedViewPage, uuid } from './schemas';

const viewSchema = z.object({ id: uuid.nullable().optional(), page: savedViewPage, name: name(80), config: z.record(z.string(), z.unknown()), shared: z.boolean().optional(), isDefault: z.boolean().optional(), position: z.number().int().min(0).max(10_000).optional() });
export type SaveViewActionInput = z.input<typeof viewSchema>;
/** Saves the filters, sort, grouping, columns and date range of a page as a named view. */
export async function saveViewAction(input: SaveViewActionInput) {
  return runAction(viewSchema, input, (data, ctx) => saveView(ctx, data), { revalidate: false });
}

const viewIdSchema = z.object({ viewId: uuid });
export async function deleteViewAction(input: z.input<typeof viewIdSchema>) {
  return runAction(viewIdSchema, input, (data, ctx) => deleteView(ctx, data.viewId), { revalidate: false });
}

const prefsSchema = z.object({ patch: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/), z.unknown()) });
/** Shallow merges into the caller's preferences (default site, pinned jobs, hidden tips). A null value removes a key. */
export async function updateUserPrefsAction(input: z.input<typeof prefsSchema>) {
  return runAction(prefsSchema, input, (data, ctx) => updateUserPrefs(ctx, data.patch), { revalidate: false, read: true });
}

const jobIdSchema = z.object({ jobId: uuid });
export async function recordRecentJobAction(input: z.input<typeof jobIdSchema>) {
  return runAction(jobIdSchema, input, (data, ctx) => recordRecentJob(ctx, data.jobId), { revalidate: false, read: true });
}
