'use server';
import { z } from 'zod';
import { completeCycle, createCycle, deleteCycle, setTasksCycle, updateCycle } from '@/server/domain';
import { runAction } from './_action';
import { isoDate, uuid } from './schemas';

const fields = {
  name: z.string().trim().max(80).nullable().optional(),
  goal: z.string().trim().max(500).nullable().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  autoRollover: z.boolean().optional(),
};

const createSchema = z.object({ projectId: uuid, lengthDays: z.number().int().min(1).max(91).optional(), ...fields });
export async function createCycleAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createCycle(ctx, data.projectId, data));
}

const updateSchema = z.object({ cycleId: uuid, patch: z.object(fields) });
export async function updateCycleAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateCycle(ctx, data.cycleId, data.patch));
}

const completeSchema = z.object({ cycleId: uuid, unfinished: z.enum(['next', 'backlog']).default('next') });
export async function completeCycleAction(input: z.input<typeof completeSchema>) {
  return runAction(completeSchema, input, (data, ctx) => completeCycle(ctx, data.cycleId, data.unfinished));
}

const idSchema = z.object({ cycleId: uuid });
export async function deleteCycleAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteCycle(ctx, data.cycleId));
}

const setSchema = z.object({ taskIds: z.array(uuid).min(1).max(500), cycleId: uuid.nullable() });
export async function setTasksCycleAction(input: z.input<typeof setSchema>) {
  return runAction(setSchema, input, (data, ctx) => setTasksCycle(ctx, data.taskIds, data.cycleId), { revalidate: false });
}
