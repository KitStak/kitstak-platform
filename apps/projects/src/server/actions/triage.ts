'use server';
import { z } from 'zod';
import { acceptTriageItem, createTriageItem, declineTriageItem, mergeTriageItem, reopenTriageItem, snoozeTriageItem } from '@/server/domain';
import { runAction } from './_action';
import { integrationTargetType, isoDate, nullableDate, priority, uuid } from './schemas';

const createSchema = z.object({
  projectId: uuid,
  title: z.string().trim().min(1, 'Give the request a short title.').max(500),
  description: z.string().max(20_000).nullable().optional(),
  priority: priority.optional(),
  requesterName: z.string().trim().max(120).nullable().optional(),
  requesterEmail: z.string().trim().max(200).nullable().optional(),
  link: z.object({ targetType: integrationTargetType, targetId: z.string().min(1).max(200) }).nullable().optional(),
});
export async function createTriageItemAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createTriageItem(ctx, { ...data, source: 'manual' }));
}

const acceptSchema = z.object({
  itemId: uuid,
  title: z.string().trim().max(500).optional(),
  statusId: uuid.nullable().optional(),
  assigneeId: uuid.nullable().optional(),
  priority: priority.optional(),
  dueDate: nullableDate.optional(),
});
export async function acceptTriageItemAction(input: z.input<typeof acceptSchema>) {
  return runAction(acceptSchema, input, (data, ctx) => acceptTriageItem(ctx, data.itemId, data));
}

const declineSchema = z.object({ itemId: uuid, reason: z.string().trim().max(500).nullable().optional() });
export async function declineTriageItemAction(input: z.input<typeof declineSchema>) {
  return runAction(declineSchema, input, (data, ctx) => declineTriageItem(ctx, data.itemId, data.reason));
}

const snoozeSchema = z.object({ itemId: uuid, until: isoDate });
export async function snoozeTriageItemAction(input: z.input<typeof snoozeSchema>) {
  return runAction(snoozeSchema, input, (data, ctx) => snoozeTriageItem(ctx, data.itemId, data.until));
}

const mergeSchema = z.object({ itemId: uuid, taskId: uuid });
export async function mergeTriageItemAction(input: z.input<typeof mergeSchema>) {
  return runAction(mergeSchema, input, (data, ctx) => mergeTriageItem(ctx, data.itemId, data.taskId));
}

const idSchema = z.object({ itemId: uuid });
export async function reopenTriageItemAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => reopenTriageItem(ctx, data.itemId));
}
