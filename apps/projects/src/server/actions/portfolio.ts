'use server';
/** Portfolio team actions: project status updates and goal check-ins. */
import { z } from 'zod';
import { checkInGoal, postProjectUpdate } from '@/server/domain';
import { runAction } from './_action';
import { goalHealth, projectHealth, projectStatus, uuid } from './schemas';

const updateSchema = z.object({
  projectId: uuid,
  health: projectHealth,
  note: z.string().max(2000, 'Keep the update under 2000 characters.').nullable().optional(),
  status: projectStatus.optional(),
});
export async function postProjectUpdateAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => {
    const { projectId, ...rest } = data;
    return postProjectUpdate(ctx, projectId, rest);
  });
}

const checkInSchema = z.object({
  goalId: uuid,
  health: goalHealth,
  note: z.string().max(2000, 'Keep the note under 2000 characters.').nullable().optional(),
  keyResults: z.array(z.object({ id: uuid, currentValue: z.number().finite() })).max(50).optional(),
  manualProgress: z.number().min(0).max(100).optional(),
});
export async function checkInGoalAction(input: z.input<typeof checkInSchema>) {
  return runAction(checkInSchema, input, (data, ctx) => {
    const { goalId, ...rest } = data;
    return checkInGoal(ctx, goalId, rest);
  });
}
