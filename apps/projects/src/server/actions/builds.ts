'use server';
import { z } from 'zod';
import { cancelBuilds, closeShort, copyDay, createBuild, createBuilds, duplicateBuild, moveBuild, restoreBuilds, splitBuild, undoCreateBuilds, updateBuild } from '@/server/domain/programs';
import { runAction } from './_action';
import { containerKey, isoDate, price, programKey, qty, uuid, version } from './program-schemas';

const createSchema = z.object({
  containerKey,
  variantId: uuid.nullable().optional(),
  buildDate: isoDate,
  plannedQty: qty,
  title: z.string().trim().max(500).nullable().optional(),
  assigneeId: uuid.nullable().optional(),
  statusId: uuid.nullable().optional(),
  rateOverride: price.nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});
export async function createBuildAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createBuild(ctx, data.containerKey, data), { revalidate: false });
}

const createManySchema = z.object({
  key: programKey,
  rows: z.array(z.object({ variantId: uuid.nullable(), buildDate: isoDate, plannedQty: qty, assigneeId: uuid.nullable().optional(), title: z.string().max(500).nullable().optional() })).max(500),
});
export async function createBuildsAction(input: z.input<typeof createManySchema>) {
  return runAction(createManySchema, input, (data, ctx) => createBuilds(ctx, data.key, data.rows), { revalidate: false });
}

const idsSchema = z.object({ ids: z.array(uuid).min(1).max(500) });
export async function undoCreateBuildsAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => undoCreateBuilds(ctx, data.ids), { revalidate: false });
}
export async function cancelBuildsAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => cancelBuilds(ctx, data.ids), { revalidate: false });
}
export async function restoreBuildsAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => restoreBuilds(ctx, data.ids), { revalidate: false });
}

const updateSchema = z.object({
  taskId: uuid,
  expectedVersion: version.nullable().optional(),
  patch: z.object({
    variantId: uuid.nullable().optional(),
    buildDate: isoDate.optional(),
    plannedQty: qty.optional(),
    rateOverride: price.nullable().optional(),
    rateOverrideReason: z.string().max(500).nullable().optional(),
    title: z.string().trim().min(1).max(500).optional(),
    assigneeId: uuid.nullable().optional(),
  }),
});
export async function updateBuildAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateBuild(ctx, data.taskId, { ...data.patch, rateOverride: data.patch.rateOverride === undefined ? undefined : data.patch.rateOverride ? data.patch.rateOverride.replace('$', '') : null }, data.expectedVersion ?? null), { revalidate: false });
}

const moveSchema = z.object({ taskId: uuid, toContainerKey: containerKey, variantId: uuid.nullable().optional() });
export async function moveBuildAction(input: z.input<typeof moveSchema>) {
  return runAction(moveSchema, input, (data, ctx) => moveBuild(ctx, data.taskId, { toContainerKey: data.toContainerKey, variantId: data.variantId }), { revalidate: false });
}

const splitSchema = z.object({ taskId: uuid, qty: qty.nullable().optional(), toDate: isoDate });
export async function splitBuildAction(input: z.input<typeof splitSchema>) {
  return runAction(splitSchema, input, (data, ctx) => splitBuild(ctx, data.taskId, { qty: data.qty, toDate: data.toDate }), { revalidate: false });
}

const shortSchema = z.object({ taskId: uuid, reason: z.string().trim().min(1, 'Say why the build closed short.').max(500) });
export async function closeShortAction(input: z.input<typeof shortSchema>) {
  return runAction(shortSchema, input, (data, ctx) => closeShort(ctx, data.taskId, { reason: data.reason }), { revalidate: false });
}

const duplicateSchema = z.object({ taskId: uuid, to: z.union([z.enum(['here', 'tomorrow', 'next_scheduled']), isoDate]) });
export async function duplicateBuildAction(input: z.input<typeof duplicateSchema>) {
  return runAction(duplicateSchema, input, (data, ctx) => duplicateBuild(ctx, data.taskId, { to: data.to }), { revalidate: false });
}

const copyDaySchema = z.object({ key: programKey, fromDate: isoDate, toDates: z.array(isoDate).min(1).max(31), mode: z.enum(['planned', 'built']) });
export async function copyDayAction(input: z.input<typeof copyDaySchema>) {
  return runAction(copyDaySchema, input, (data, ctx) => copyDay(ctx, data.key, data), { revalidate: false });
}
