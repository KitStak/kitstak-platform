'use server';
import { z } from 'zod';
import {
  addKeyResult,
  createGoal,
  deleteGoal,
  deleteKeyResult,
  linkGoalProject,
  restoreGoal,
  updateGoal,
  updateKeyResult,
} from '@/server/domain';
import { runAction } from './_action';
import { color, goalHealth, goalProgressMode, keyResultKind, name, nullableDate, rank, uuid } from './schemas';

const goalFields = {
  name: name(200),
  description: z.string().max(5000).nullable().optional(),
  ownerId: uuid.nullable().optional(),
  parentGoalId: uuid.nullable().optional(),
  period: z.string().max(40).nullable().optional(),
  startDate: nullableDate.optional(),
  dueDate: nullableDate.optional(),
  health: goalHealth.optional(),
  progressMode: goalProgressMode.optional(),
  manualProgress: z.number().min(0).max(100).optional(),
  color: color.optional(),
};

const createSchema = z.object(goalFields);
export async function createGoalAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createGoal(ctx, data));
}

const updateSchema = z.object({ goalId: uuid, patch: z.object({ ...goalFields, name: name(200).optional(), position: rank.optional() }) });
export async function updateGoalAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateGoal(ctx, data.goalId, data.patch));
}

const idSchema = z.object({ goalId: uuid });
export async function deleteGoalAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteGoal(ctx, data.goalId));
}
export async function restoreGoalAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreGoal(ctx, data.goalId));
}

const krFields = {
  name: name(200),
  kind: keyResultKind.optional(),
  startValue: z.number().finite().optional(),
  targetValue: z.number().finite().optional(),
  currentValue: z.number().finite().optional(),
  unit: z.string().max(20).nullable().optional(),
  projectId: uuid.nullable().optional(),
};
const addKrSchema = z.object({ goalId: uuid, ...krFields });
export async function addKeyResultAction(input: z.input<typeof addKrSchema>) {
  return runAction(addKrSchema, input, (data, ctx) => {
    const { goalId, ...rest } = data;
    return addKeyResult(ctx, goalId, rest);
  });
}
const updateKrSchema = z.object({ keyResultId: uuid, patch: z.object({ ...krFields, name: name(200).optional(), position: rank.optional() }) });
export async function updateKeyResultAction(input: z.input<typeof updateKrSchema>) {
  return runAction(updateKrSchema, input, (data, ctx) => updateKeyResult(ctx, data.keyResultId, data.patch));
}
const krIdSchema = z.object({ keyResultId: uuid });
export async function deleteKeyResultAction(input: z.input<typeof krIdSchema>) {
  return runAction(krIdSchema, input, (data, ctx) => deleteKeyResult(ctx, data.keyResultId));
}

const linkSchema = z.object({ goalId: uuid, projectId: uuid, linked: z.boolean() });
export async function linkGoalProjectAction(input: z.input<typeof linkSchema>) {
  return runAction(linkSchema, input, (data, ctx) => linkGoalProject(ctx, data.goalId, data.projectId, data.linked));
}
