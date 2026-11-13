'use server';
import { z } from 'zod';
import { addManualTime, deleteTimeEntry, startTimer, stopTimer, updateTimeEntry } from '@/server/domain';
import { runAction } from './_action';
import { isoDate, uuid } from './schemas';

const startSchema = z.object({ taskId: uuid, note: z.string().max(500).nullable().optional() });
export async function startTimerAction(input: z.input<typeof startSchema>) {
  return runAction(startSchema, input, (data, ctx) => startTimer(ctx, data.taskId, data.note));
}

export async function stopTimerAction() {
  return runAction(z.object({}), {}, (_data, ctx) => stopTimer(ctx));
}

const manualSchema = z.object({
  taskId: uuid,
  minutes: z.number().int().min(1, 'Enter at least 1 minute.').max(1440, 'Enter up to 24 hours.'),
  date: isoDate.optional(),
  note: z.string().max(500).nullable().optional(),
  billable: z.boolean().optional(),
});
export async function addManualTimeAction(input: z.input<typeof manualSchema>) {
  return runAction(manualSchema, input, (data, ctx) => addManualTime(ctx, data));
}

const updateSchema = z.object({
  entryId: uuid,
  minutes: z.number().int().min(1).max(1440).optional(),
  note: z.string().max(500).nullable().optional(),
  billable: z.boolean().optional(),
});
export async function updateTimeEntryAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => {
    const { entryId, ...patch } = data;
    return updateTimeEntry(ctx, entryId, patch);
  });
}

const idSchema = z.object({ entryId: uuid });
export async function deleteTimeEntryAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteTimeEntry(ctx, data.entryId));
}
