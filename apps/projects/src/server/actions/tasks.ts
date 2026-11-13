'use server';
/** Task mutations for the client. Each returns ActionResult<T> (see _action.ts). */
import { z } from 'zod';
import {
  addDependency,
  addTaskLabel,
  bulkUpdateTasks,
  createSubtask,
  createTask,
  deleteTasks,
  duplicateTask,
  moveTask,
  moveTaskToProject,
  removeDependency,
  removeTaskLabel,
  restoreTasks,
  setTaskDone,
  setTaskLabels,
  setWatching,
  updateTask,
} from '@/server/domain';
import { runAction } from './_action';
import {
  customFieldValues,
  dependencyKind,
  name,
  nullableDate,
  placement,
  priority,
  recurrence,
  richText,
  uuid,
} from './schemas';

const taskFields = {
  title: name(500),
  description: richText.optional(),
  statusId: uuid.nullable().optional(),
  sectionId: uuid.nullable().optional(),
  priority: priority.optional(),
  assigneeId: uuid.nullable().optional(),
  startDate: nullableDate.optional(),
  dueDate: nullableDate.optional(),
  estimatePoints: z.number().int().min(0).max(1000).nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  milestoneId: uuid.nullable().optional(),
  isMilestone: z.boolean().optional(),
  labelIds: z.array(uuid).max(50).optional(),
  customFields: customFieldValues.optional(),
  recurrence: recurrence.optional(),
  watcherIds: z.array(uuid).max(50).optional(),
};

const createSchema = z.object({ projectId: uuid, parentTaskId: uuid.nullable().optional(), ...taskFields, ...placement });
export type CreateTaskActionInput = z.input<typeof createSchema>;
export async function createTaskAction(input: CreateTaskActionInput) {
  return runAction(createSchema, input, (data, ctx) => createTask(ctx, data));
}

const subtaskSchema = z.object({ parentTaskId: uuid, ...taskFields, ...placement });
export async function createSubtaskAction(input: z.input<typeof subtaskSchema>) {
  return runAction(subtaskSchema, input, (data, ctx) => {
    const { parentTaskId, ...rest } = data;
    return createSubtask(ctx, parentTaskId, rest);
  });
}

const patchSchema = z.object({
  title: name(500).optional(),
  description: richText.optional(),
  statusId: uuid.optional(),
  sectionId: uuid.nullable().optional(),
  priority: priority.optional(),
  assigneeId: uuid.nullable().optional(),
  reporterId: uuid.nullable().optional(),
  startDate: nullableDate.optional(),
  dueDate: nullableDate.optional(),
  estimatePoints: z.number().int().min(0).max(1000).nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  milestoneId: uuid.nullable().optional(),
  isMilestone: z.boolean().optional(),
  customFields: customFieldValues.optional(),
  recurrence: recurrence.optional(),
});
export type TaskPatch = z.input<typeof patchSchema>;

const updateSchema = z.object({ taskId: uuid, patch: patchSchema });
export async function updateTaskAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateTask(ctx, data.taskId, data.patch));
}

const bulkSchema = z.object({
  taskIds: z.array(uuid).min(1).max(500),
  patch: patchSchema.extend({ addLabelIds: z.array(uuid).optional(), removeLabelIds: z.array(uuid).optional() }),
});
export async function bulkUpdateTasksAction(input: z.input<typeof bulkSchema>) {
  return runAction(bulkSchema, input, (data, ctx) => bulkUpdateTasks(ctx, data.taskIds, data.patch));
}

const moveSchema = z.object({
  taskId: uuid,
  statusId: uuid.optional(),
  sectionId: uuid.nullable().optional(),
  parentTaskId: uuid.nullable().optional(),
  ...placement,
});
export type MoveTaskActionInput = z.input<typeof moveSchema>;
export async function moveTaskAction(input: MoveTaskActionInput) {
  return runAction(moveSchema, input, (data, ctx) => {
    const { taskId, ...rest } = data;
    return moveTask(ctx, taskId, rest);
  });
}

const moveProjectSchema = z.object({ taskId: uuid, projectId: uuid, statusId: uuid.optional() });
export async function moveTaskToProjectAction(input: z.input<typeof moveProjectSchema>) {
  return runAction(moveProjectSchema, input, (data, ctx) => moveTaskToProject(ctx, data.taskId, data.projectId, { statusId: data.statusId }));
}

const duplicateSchema = z.object({ taskId: uuid, includeSubtasks: z.boolean().optional(), title: z.string().max(500).optional() });
export async function duplicateTaskAction(input: z.input<typeof duplicateSchema>) {
  return runAction(duplicateSchema, input, (data, ctx) => duplicateTask(ctx, data.taskId, data));
}

const idsSchema = z.object({ taskIds: z.array(uuid).min(1).max(500) });
/** Soft delete; returns every id removed (incl. subtasks) — pass them to restoreTasksAction for Undo. */
export async function deleteTasksAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => deleteTasks(ctx, data.taskIds));
}
export async function restoreTasksAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => restoreTasks(ctx, data.taskIds));
}

const labelsSchema = z.object({ taskId: uuid, labelIds: z.array(uuid).max(50) });
export async function setTaskLabelsAction(input: z.input<typeof labelsSchema>) {
  return runAction(labelsSchema, input, (data, ctx) => setTaskLabels(ctx, data.taskId, data.labelIds));
}

const labelSchema = z.object({ taskId: uuid, labelId: uuid, on: z.boolean() });
export async function toggleTaskLabelAction(input: z.input<typeof labelSchema>) {
  return runAction(labelSchema, input, (data, ctx) =>
    data.on ? addTaskLabel(ctx, data.taskId, data.labelId) : removeTaskLabel(ctx, data.taskId, data.labelId),
  );
}

const depSchema = z.object({ blockingTaskId: uuid, blockedTaskId: uuid, kind: dependencyKind.optional(), lagDays: z.number().int().min(-365).max(365).optional() });
export async function addDependencyAction(input: z.input<typeof depSchema>) {
  return runAction(depSchema, input, (data, ctx) => addDependency(ctx, data));
}

const removeDepSchema = z.object({ dependencyId: uuid });
export async function removeDependencyAction(input: z.input<typeof removeDepSchema>) {
  return runAction(removeDepSchema, input, (data, ctx) => removeDependency(ctx, data.dependencyId));
}

const watchSchema = z.object({ taskId: uuid, watching: z.boolean(), userId: uuid.optional() });
export async function setWatchingAction(input: z.input<typeof watchSchema>) {
  return runAction(watchSchema, input, (data, ctx) => setWatching(ctx, data.taskId, data.watching, data.userId));
}

const doneSchema = z.object({ taskId: uuid, done: z.boolean() });
/** Checkbox complete/reopen without knowing the project's statuses. */
export async function setTaskDoneAction(input: z.input<typeof doneSchema>) {
  return runAction(doneSchema, input, (data, ctx) => setTaskDone(ctx, data.taskId, data.done));
}
