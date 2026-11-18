'use server';
import { z } from 'zod';
import { clearSampleData, loadSampleData, purgeAllData } from '@/server/domain';
import { runAction } from './_action';

const none = z.object({}).optional();

/** Loads the made up shop (admin). Every row is marked as sample so it can be removed again. */
export async function loadSampleDataAction() {
  return runAction(none, {}, (_data, ctx) => loadSampleData(ctx));
}

/** Removes every sample row and leaves real work untouched (admin). */
export async function clearSampleDataAction() {
  return runAction(none, {}, (_data, ctx) => clearSampleData(ctx));
}

const purgeSchema = z.object({ confirm: z.string().min(1, 'Type the workspace name to confirm.').max(120) });
/** Owner only: deletes all Pulse data of the workspace. `confirm` is the workspace slug as typed. */
export async function purgeAllDataAction(input: z.input<typeof purgeSchema>) {
  return runAction(purgeSchema, input, (data, ctx) => purgeAllData(ctx, data.confirm));
}
