'use server';
import { z } from 'zod';
import { deleteOutput, logOutput, undoLogOutput } from '@/server/domain/programs';
import { logOutputInputSchema } from '@/lib/program-types';
import { runAction } from './_action';
import { containerKey, isoDate, qty, uuid, version } from './program-schemas';

const logSchema = z.object({ key: containerKey }).and(logOutputInputSchema);
export async function logOutputAction(input: z.input<typeof logSchema>) {
  return runAction(logSchema, input, (data, ctx) => logOutput(ctx, data.key, { date: data.date, entries: data.entries, endOfDay: data.endOfDay }), { revalidate: false });
}

const undoSchema = z.object({
  key: containerKey,
  undo: z.object({
    date: isoDate,
    entries: z.array(z.object({ buildId: uuid, qty, scrapQty: qty, statusId: uuid })).max(500),
    createdBuildIds: z.array(uuid).max(500),
  }),
});
export async function undoLogOutputAction(input: z.input<typeof undoSchema>) {
  return runAction(undoSchema, input, (data, ctx) => undoLogOutput(ctx, data.key, data.undo), { revalidate: false });
}

const deleteSchema = z.object({ outputId: uuid, expectedVersion: version });
export async function deleteOutputAction(input: z.input<typeof deleteSchema>) {
  return runAction(deleteSchema, input, async (data, ctx) => {
    await deleteOutput(ctx, data.outputId, data.expectedVersion);
    return {};
  }, { revalidate: false });
}
