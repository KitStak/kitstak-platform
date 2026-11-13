'use server';
import { z } from 'zod';
import { createSpace, deleteSpace, updateSpace } from '@/server/domain';
import { runAction } from './_action';
import { color, icon, name, rank, uuid } from './schemas';

const fields = {
  name: name(80),
  description: z.string().max(1000).nullable().optional(),
  color: color.optional(),
  icon: icon.optional(),
  isPrivate: z.boolean().optional(),
};

const createSchema = z.object(fields);
export async function createSpaceAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createSpace(ctx, data));
}

const updateSchema = z.object({
  spaceId: uuid,
  patch: z.object({ ...fields, name: name(80).optional(), position: rank.optional(), archived: z.boolean().optional() }),
});
export async function updateSpaceAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateSpace(ctx, data.spaceId, data.patch));
}

const idSchema = z.object({ spaceId: uuid });
export async function deleteSpaceAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteSpace(ctx, data.spaceId));
}
