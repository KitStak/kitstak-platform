'use server';
import { z } from 'zod';
import {
  addOneTimeCharge,
  createDraftVersion,
  deleteOneTimeCharge,
  deleteVersion,
  publishVersion,
  requestReview,
  sendBack,
  unpublishVersion,
  updateDraftVersion,
  updateOneTimeCharge,
} from '@/server/domain/programs';
import { runAction } from './_action';
import { cents, isoDate, lines, programKey, rules, uuid, version } from './program-schemas';

const createSchema = z.object({ key: programKey, from: z.union([z.literal('current'), z.literal('empty'), uuid]), effectiveFrom: isoDate });
export async function createDraftVersionAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createDraftVersion(ctx, data.key, { from: data.from, effectiveFrom: data.effectiveFrom }), { revalidate: false });
}

const updateSchema = z.object({ versionId: uuid, expectedVersion: version, effectiveFrom: isoDate.optional(), label: z.string().max(80).nullable().optional(), note: z.string().max(2000).nullable().optional(), lines: lines.optional(), rules: rules.optional() });
export async function updateDraftVersionAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateDraftVersion(ctx, data.versionId, data, data.expectedVersion), { revalidate: false });
}

const publishSchema = z.object({ versionId: uuid, expectedVersion: version });
export async function publishVersionAction(input: z.input<typeof publishSchema>) {
  return runAction(publishSchema, input, (data, ctx) => publishVersion(ctx, data.versionId, data.expectedVersion), { revalidate: false });
}

const versionOnly = z.object({ versionId: uuid });
export async function unpublishVersionAction(input: z.input<typeof versionOnly>) {
  return runAction(versionOnly, input, async (data, ctx) => {
    await unpublishVersion(ctx, data.versionId);
    return {};
  }, { revalidate: false });
}
export async function deleteVersionAction(input: z.input<typeof versionOnly>) {
  return runAction(versionOnly, input, async (data, ctx) => {
    await deleteVersion(ctx, data.versionId);
    return {};
  }, { revalidate: false });
}
export async function requestReviewAction(input: z.input<typeof versionOnly>) {
  return runAction(versionOnly, input, async (data, ctx) => {
    await requestReview(ctx, data.versionId);
    return {};
  }, { revalidate: false });
}

const sendBackSchema = z.object({ versionId: uuid, note: z.string().trim().min(1, 'Add a note that says what to change.').max(2000) });
export async function sendBackAction(input: z.input<typeof sendBackSchema>) {
  return runAction(sendBackSchema, input, async (data, ctx) => {
    await sendBack(ctx, data.versionId, data.note);
    return {};
  }, { revalidate: false });
}

const chargeSchema = z.object({
  key: programKey,
  kind: z.enum(['setup', 'adjustment']),
  chargeOn: isoDate,
  amountCents: cents,
  label: z.string().trim().min(1).max(120),
  reason: z.string().max(2000).nullable().optional(),
  variantId: uuid.nullable().optional(),
  countsTowardMinimum: z.boolean().optional(),
});
export async function addOneTimeChargeAction(input: z.input<typeof chargeSchema>) {
  return runAction(chargeSchema, input, (data, ctx) => addOneTimeCharge(ctx, data.key, data), { revalidate: false });
}

const chargeUpdateSchema = z.object({ id: uuid, expectedVersion: version, patch: chargeSchema.omit({ key: true, kind: true }).partial() });
export async function updateOneTimeChargeAction(input: z.input<typeof chargeUpdateSchema>) {
  return runAction(chargeUpdateSchema, input, (data, ctx) => updateOneTimeCharge(ctx, data.id, data.patch, data.expectedVersion), { revalidate: false });
}

export async function deleteOneTimeChargeAction(input: { id: string }) {
  return runAction(z.object({ id: uuid }), input, async (data, ctx) => {
    await deleteOneTimeCharge(ctx, data.id);
    return {};
  }, { revalidate: false });
}
