'use server';
import { z } from 'zod';
import { addComment, deleteComment, editComment, restoreComment, toggleReaction } from '@/server/domain';
import { runAction } from './_action';
import { uuid } from './schemas';

const addSchema = z.object({
  taskId: uuid,
  body: z.string().trim().min(1, 'Write something before posting.').max(20_000),
  parentCommentId: uuid.nullable().optional(),
  attachmentIds: z.array(uuid).max(20).optional(),
});
export async function addCommentAction(input: z.input<typeof addSchema>) {
  return runAction(addSchema, input, (data, ctx) => addComment(ctx, data));
}

const editSchema = z.object({ commentId: uuid, body: z.string().trim().min(1).max(20_000) });
export async function editCommentAction(input: z.input<typeof editSchema>) {
  return runAction(editSchema, input, (data, ctx) => editComment(ctx, data.commentId, data.body));
}

const idSchema = z.object({ commentId: uuid });
export async function deleteCommentAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteComment(ctx, data.commentId));
}
export async function restoreCommentAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreComment(ctx, data.commentId));
}

const reactSchema = z.object({ commentId: uuid, emoji: z.string().min(1).max(16) });
export async function toggleReactionAction(input: z.input<typeof reactSchema>) {
  return runAction(reactSchema, input, (data, ctx) => toggleReaction(ctx, data.commentId, data.emoji), { revalidate: false });
}
