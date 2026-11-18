'use server';
import { z } from 'zod';
import {
  deleteIndirectEntry,
  deletePaidHours,
  deleteProductionEntries,
  markDayComplete,
  restoreIndirectEntry,
  restorePaidHours,
  restoreProductionEntries,
  reviewDay,
  saveIndirectEntry,
  savePaidHours,
  saveProductionBulk,
  saveProductionEntry,
  startJobForDay,
} from '@/server/domain';
import { runAction } from './_action';
import { headcount, hours, indirectReason, isoDate, positiveCents, productionInput, text, uuid, version } from './schemas';

export type SaveProductionActionInput = z.input<typeof productionInput>;
/** Saves one production row (autosave of a grid row). Does not revalidate the page: the grid keeps its own state. */
export async function saveProductionEntryAction(input: SaveProductionActionInput) {
  return runAction(productionInput, input, (data, ctx) => saveProductionEntry(ctx, data), { revalidate: false });
}

const bulkSchema = z.object({ entries: z.array(productionInput).min(1).max(5000) });
/** Saves many rows at once, all or nothing (paste, "Copy yesterday's crew"). */
export async function saveProductionBulkAction(input: z.input<typeof bulkSchema>) {
  return runAction(bulkSchema, input, (data, ctx) => saveProductionBulk(ctx, data.entries));
}

const idsSchema = z.object({ ids: z.array(uuid).min(1).max(2000) });
/** Soft deletes entries. Pair with `restoreProductionEntriesAction` for the undo toast. */
export async function deleteProductionEntriesAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => deleteProductionEntries(ctx, data.ids));
}
export async function restoreProductionEntriesAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => restoreProductionEntries(ctx, data.ids));
}

const indirectSchema = z.object({
  id: uuid.nullable().optional(),
  siteId: uuid.nullable().optional(),
  workDate: isoDate,
  laborClassId: uuid.nullable().optional(),
  reason: indirectReason,
  headcount: headcount.nullable().optional(),
  hours,
  overtimeHours: hours.optional(),
  note: text(1000).nullable().optional(),
  version,
});
export type SaveIndirectActionInput = z.input<typeof indirectSchema>;
/** Time not on a job: meetings, cleanup, waiting and so on. */
export async function saveIndirectEntryAction(input: SaveIndirectActionInput) {
  return runAction(indirectSchema, input, (data, ctx) => saveIndirectEntry(ctx, data));
}

const idSchema = z.object({ id: uuid });
export async function deleteIndirectEntryAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteIndirectEntry(ctx, data.id));
}
export async function restoreIndirectEntryAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreIndirectEntry(ctx, data.id));
}

const paidSchema = z.object({ siteId: uuid.nullable().optional(), workDate: isoDate, laborClassId: uuid.nullable().optional(), paidHours: hours, paidCents: positiveCents.nullable().optional(), version });
/** Paid hours for a site, day and labor class (one row per key). */
export async function savePaidHoursAction(input: z.input<typeof paidSchema>) {
  return runAction(paidSchema, input, (data, ctx) => savePaidHours(ctx, data));
}
export async function deletePaidHoursAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deletePaidHours(ctx, data.id));
}
export async function restorePaidHoursAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restorePaidHours(ctx, data.id));
}

const completeSchema = z.object({ siteId: uuid.nullable().optional(), date: isoDate });
/** "Mark day complete". */
export async function markDayCompleteAction(input: z.input<typeof completeSchema>) {
  return runAction(completeSchema, input, (data, ctx) => markDayComplete(ctx, data));
}

const reviewSchema = z.object({ siteId: uuid, date: isoDate, decision: z.enum(['approve', 'send_back', 'reopen']), note: text(1000).nullable().optional() });
/** Approve a completed day, send it back with a note, or reopen it. */
export async function reviewDayAction(input: z.input<typeof reviewSchema>) {
  return runAction(reviewSchema, input, (data, ctx) => reviewDay(ctx, data));
}

const startSchema = z.object({ jobId: uuid, date: isoDate });
/** Puts a planned or on hold job on the day so work can be logged on it (the "Log work" links from CRM and WMS). */
export async function startJobForDayAction(input: z.input<typeof startSchema>) {
  return runAction(startSchema, input, (data, ctx) => startJobForDay(ctx, data.jobId, data.date));
}
