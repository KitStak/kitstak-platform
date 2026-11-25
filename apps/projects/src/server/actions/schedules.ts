'use server';
import { z } from 'zod';
import { createSchedule, endSchedule, pauseSchedule, resumeSchedule, runScheduleGeneration, skipDate, updateSchedule } from '@/server/domain/programs';
import { getProgramDetail } from '@/server/domain/programs';
import { runAction } from './_action';
import { isoDate, programKey, scheduleInputSchema, uuid, version } from './program-schemas';

const createSchema = z.object({ key: programKey, input: scheduleInputSchema });
export async function createScheduleAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createSchedule(ctx, data.key, data.input), { revalidate: false });
}

const updateSchema = z.object({ id: uuid, expectedVersion: version, patch: scheduleInputSchema.partial(), regenerateFuture: z.boolean().optional() });
export async function updateScheduleAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateSchedule(ctx, data.id, data.patch, data.expectedVersion, { regenerateFuture: data.regenerateFuture }), { revalidate: false });
}

const idOnly = z.object({ id: uuid });
export async function pauseScheduleAction(input: z.input<typeof idOnly>) {
  return runAction(idOnly, input, (data, ctx) => pauseSchedule(ctx, data.id), { revalidate: false });
}
export async function resumeScheduleAction(input: z.input<typeof idOnly>) {
  return runAction(idOnly, input, (data, ctx) => resumeSchedule(ctx, data.id), { revalidate: false });
}

const endSchema = z.object({ id: uuid, endsOn: isoDate });
export async function endScheduleAction(input: z.input<typeof endSchema>) {
  return runAction(endSchema, input, (data, ctx) => endSchedule(ctx, data.id, { endsOn: data.endsOn }), { revalidate: false });
}

const skipSchema = z.object({ id: uuid, date: isoDate });
export async function skipScheduleDateAction(input: z.input<typeof skipSchema>) {
  return runAction(skipSchema, input, (data, ctx) => skipDate(ctx, data.id, data.date), { revalidate: false });
}

const runSchema = z.object({ key: programKey });
export async function runScheduleNowAction(input: z.input<typeof runSchema>) {
  return runAction(runSchema, input, async (data, ctx) => {
    const detail = await getProgramDetail(ctx, data.key);
    return runScheduleGeneration(ctx, { programId: detail.id });
  }, { revalidate: false });
}
