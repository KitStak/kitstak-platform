'use server';
import { z } from 'zod';
import { addLink, refreshLinks, removeLink } from '@/server/domain';
import { runAction } from './_action';
import { integrationTargetType, uuid } from './schemas';

const addSchema = z.object({
  taskId: uuid.nullable().optional(),
  projectId: uuid.nullable().optional(),
  targetType: integrationTargetType,
  targetId: z.string().min(1).max(100),
});
export async function addLinkAction(input: z.input<typeof addSchema>) {
  return runAction(addSchema, input, (data, ctx) => addLink(ctx, data));
}

const idSchema = z.object({ linkId: uuid });
export async function removeLinkAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => removeLink(ctx, data.linkId));
}

const refreshSchema = z.union([z.object({ taskId: uuid }), z.object({ projectId: uuid })]);
export async function refreshLinksAction(input: z.input<typeof refreshSchema>) {
  return runAction(refreshSchema, input, (data, ctx) => refreshLinks(ctx, data), { revalidate: false });
}
