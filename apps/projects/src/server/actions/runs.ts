'use server';
import { z } from 'zod';
import { cancelRun, closeRun, copyRun, moveRun } from '@/server/domain/programs';
import { runAction } from './_action';
import { isoDate, programKey, runIdSchema, uuid } from './program-schemas';

const moveSchema = z.object({ runId: runIdSchema, key: programKey.optional(), toDate: isoDate });
export async function moveRunAction(input: z.input<typeof moveSchema>) {
  return runAction(moveSchema, input, (data, ctx) => moveRun(ctx, data.runId, { toDate: data.toDate, key: data.key }), { revalidate: false });
}

const cancelSchema = z.object({ runId: runIdSchema, key: programKey.optional() });
export async function cancelRunAction(input: z.input<typeof cancelSchema>) {
  return runAction(cancelSchema, input, (data, ctx) => cancelRun(ctx, data.runId, { key: data.key }), { revalidate: false });
}

const copySchema = z.object({ runId: runIdSchema, key: programKey.optional(), toDates: z.array(isoDate).min(1).max(31) });
export async function copyRunAction(input: z.input<typeof copySchema>) {
  return runAction(copySchema, input, (data, ctx) => copyRun(ctx, data.runId, { toDates: data.toDates, key: data.key }), { revalidate: false });
}

const closeSchema = z.object({
  runId: runIdSchema,
  key: programKey.optional(),
  decisions: z.array(z.object({ buildId: uuid, action: z.enum(['close_short', 'move_rest', 'leave_open']), reason: z.string().max(500).optional(), toDate: isoDate.optional() })).max(500),
});
export async function closeRunAction(input: z.input<typeof closeSchema>) {
  return runAction(closeSchema, input, (data, ctx) => closeRun(ctx, data.runId, { key: data.key, decisions: data.decisions }), { revalidate: false });
}
